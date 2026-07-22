/**
 * Fixed shared-memory channels for the two high-frequency worker streams.
 *
 * Structured-cloning a fresh motion/snapshot object 35 times per second made
 * Chromium create a new V8 backing-store mapping for every packet. On macOS
 * those mappings accumulated until the renderer hit the process VM-region
 * limit and terminated with SIGTRAP. A shared channel owns one payload buffer
 * for its whole lifetime, so newer frames replace older frames instead of
 * allocating an unbounded transport history.
 */

export const SHARED_TELEMETRY_PAYLOAD_BYTES = 4 * 1024 * 1024;

const CONTROL_SEQUENCE = 0;
const CONTROL_LENGTH = 1;
const CONTROL_OVERFLOW_COUNT = 2;
const CONTROL_WORDS = 4;

const writeUtf8ToSharedBuffer = (
  value: string,
  destination: Uint8Array,
): { read: number; written: number } => {
  let read = 0;
  let written = 0;
  while (read < value.length) {
    const codePoint = value.codePointAt(read)!;
    const codeUnits = codePoint > 0xffff ? 2 : 1;
    const byteCount = codePoint <= 0x7f
      ? 1
      : codePoint <= 0x7ff
        ? 2
        : codePoint <= 0xffff
          ? 3
          : 4;
    if (written + byteCount > destination.length) break;

    if (byteCount === 1) {
      destination[written] = codePoint;
    } else if (byteCount === 2) {
      destination[written] = 0xc0 | (codePoint >> 6);
      destination[written + 1] = 0x80 | (codePoint & 0x3f);
    } else if (byteCount === 3) {
      destination[written] = 0xe0 | (codePoint >> 12);
      destination[written + 1] = 0x80 | ((codePoint >> 6) & 0x3f);
      destination[written + 2] = 0x80 | (codePoint & 0x3f);
    } else {
      destination[written] = 0xf0 | (codePoint >> 18);
      destination[written + 1] = 0x80 | ((codePoint >> 12) & 0x3f);
      destination[written + 2] = 0x80 | ((codePoint >> 6) & 0x3f);
      destination[written + 3] = 0x80 | (codePoint & 0x3f);
    }
    read += codeUnits;
    written += byteCount;
  }
  return { read, written };
};

export interface SharedTelemetryChannel {
  control: SharedArrayBuffer;
  payload: SharedArrayBuffer;
}

export const sharedTelemetryAvailable = (): boolean =>
  typeof SharedArrayBuffer !== 'undefined' && typeof Atomics !== 'undefined';

export const createSharedTelemetryChannel = (
  payloadBytes = SHARED_TELEMETRY_PAYLOAD_BYTES,
): SharedTelemetryChannel => {
  if (!sharedTelemetryAvailable()) {
    throw new Error('Shared telemetry is not available in this renderer.');
  }
  return {
    control: new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * CONTROL_WORDS),
    payload: new SharedArrayBuffer(payloadBytes),
  };
};

export class SharedTelemetryWriter {
  private readonly control: Int32Array;
  private readonly payload: Uint8Array;

  public constructor(channel: SharedTelemetryChannel) {
    this.control = new Int32Array(channel.control);
    this.payload = new Uint8Array(channel.payload);
  }

  public publish(value: unknown): boolean {
    const json = JSON.stringify(value);

    // Odd sequence numbers mean that the writer owns the payload. The reader
    // accepts a packet only when the same even number brackets its read.
    Atomics.add(this.control, CONTROL_SEQUENCE, 1);
    // TextEncoder.encodeInto rejects SharedArrayBuffer-backed views in
    // Chromium. Write UTF-8 directly so this hot path never allocates a fresh
    // ArrayBuffer—the exact resource that this channel is meant to bound.
    const result = writeUtf8ToSharedBuffer(json, this.payload);
    const complete = result.read === json.length;
    Atomics.store(this.control, CONTROL_LENGTH, complete ? result.written : 0);
    if (!complete) Atomics.add(this.control, CONTROL_OVERFLOW_COUNT, 1);
    Atomics.add(this.control, CONTROL_SEQUENCE, 1);
    return complete;
  }
}

export class SharedTelemetryReader<T> {
  private readonly control: Int32Array;
  private readonly payload: Uint8Array;
  private readonly decodeBuffer: Uint8Array;
  private readonly decoder = new TextDecoder();
  private lastSequence = 0;

  public constructor(channel: SharedTelemetryChannel) {
    this.control = new Int32Array(channel.control);
    this.payload = new Uint8Array(channel.payload);
    // TextDecoder rejects a SharedArrayBuffer view in Chromium. This one
    // ordinary buffer is allocated once, then reused for every generation.
    this.decodeBuffer = new Uint8Array(channel.payload.byteLength);
  }

  /** Returns only the newest complete packet; overwritten intermediate frames are intentionally coalesced. */
  public readLatest(): T | null {
    const sequenceBefore = Atomics.load(this.control, CONTROL_SEQUENCE);
    if (sequenceBefore === this.lastSequence || sequenceBefore % 2 !== 0) return null;
    const byteLength = Atomics.load(this.control, CONTROL_LENGTH);
    if (byteLength <= 0 || byteLength > this.payload.byteLength) return null;

    try {
      this.decodeBuffer.set(this.payload.subarray(0, byteLength), 0);
      const json = this.decoder.decode(this.decodeBuffer.subarray(0, byteLength));
      const sequenceAfter = Atomics.load(this.control, CONTROL_SEQUENCE);
      if (sequenceBefore !== sequenceAfter || sequenceAfter % 2 !== 0) return null;
      const parsed = JSON.parse(json) as T;
      // Check once more after parsing. A writer can begin after decoding but
      // before JSON.parse returns; that mixed-generation value must be ignored.
      if (Atomics.load(this.control, CONTROL_SEQUENCE) !== sequenceAfter) return null;
      this.lastSequence = sequenceAfter;
      return parsed;
    } catch {
      // A concurrent write can make the transient JSON invalid. The completed
      // generation is retried on the next animation frame.
      return null;
    }
  }

  public overflowCount(): number {
    return Atomics.load(this.control, CONTROL_OVERFLOW_COUNT);
  }
}
