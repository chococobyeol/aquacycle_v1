/**
 * Fixed shared-memory channels for the two high-frequency worker streams.
 *
 * Structured-cloning and the former JSON bridge both created fresh large
 * intermediate storage for every snapshot. Chromium retains those V8 sandbox
 * mappings for the renderer process lifetime on macOS, so a long-running tank
 * eventually hit the VM-region limit and terminated with SIGTRAP. This codec
 * writes the object graph directly into one SharedArrayBuffer. It never creates
 * a packet-sized string or ArrayBuffer, and newer generations replace older
 * ones in place.
 */

export const SHARED_TELEMETRY_PAYLOAD_BYTES = 4 * 1024 * 1024;

const CONTROL_SEQUENCE = 0;
const CONTROL_LENGTH = 1;
const CONTROL_OVERFLOW_COUNT = 2;
const CONTROL_WORDS = 4;

const enum ValueTag {
  Null = 0,
  False = 1,
  True = 2,
  Number = 3,
  String = 4,
  Array = 5,
  Object = 6,
  Undefined = 7,
}

const writeUtf8ToSharedBuffer = (
  value: string,
  destination: Uint8Array,
  start: number,
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
    if (start + written + byteCount > destination.length) break;

    if (byteCount === 1) {
      destination[start + written] = codePoint;
    } else if (byteCount === 2) {
      destination[start + written] = 0xc0 | (codePoint >> 6);
      destination[start + written + 1] = 0x80 | (codePoint & 0x3f);
    } else if (byteCount === 3) {
      destination[start + written] = 0xe0 | (codePoint >> 12);
      destination[start + written + 1] = 0x80 | ((codePoint >> 6) & 0x3f);
      destination[start + written + 2] = 0x80 | (codePoint & 0x3f);
    } else {
      destination[start + written] = 0xf0 | (codePoint >> 18);
      destination[start + written + 1] = 0x80 | ((codePoint >> 12) & 0x3f);
      destination[start + written + 2] = 0x80 | ((codePoint >> 6) & 0x3f);
      destination[start + written + 3] = 0x80 | (codePoint & 0x3f);
    }
    read += codeUnits;
    written += byteCount;
  }
  return { read, written };
};

class SharedValueWriter {
  private readonly bytes: Uint8Array;
  private readonly view: DataView;
  private offset = 0;

  public constructor(buffer: SharedArrayBuffer) {
    this.bytes = new Uint8Array(buffer);
    this.view = new DataView(buffer);
  }

  public encode(value: unknown): number {
    this.offset = 0;
    this.writeValue(value);
    return this.offset;
  }

  private reserve(byteLength: number): void {
    if (this.offset + byteLength > this.bytes.byteLength) {
      throw new RangeError('Shared telemetry payload overflow.');
    }
  }

  private writeByte(value: number): void {
    this.reserve(1);
    this.bytes[this.offset] = value;
    this.offset += 1;
  }

  private writeUint32(value: number): void {
    this.reserve(Uint32Array.BYTES_PER_ELEMENT);
    this.view.setUint32(this.offset, value, true);
    this.offset += Uint32Array.BYTES_PER_ELEMENT;
  }

  private writeNumber(value: number): void {
    this.writeByte(ValueTag.Number);
    this.reserve(Float64Array.BYTES_PER_ELEMENT);
    this.view.setFloat64(this.offset, value, true);
    this.offset += Float64Array.BYTES_PER_ELEMENT;
  }

  private writeString(value: string): void {
    this.writeByte(ValueTag.String);
    const lengthOffset = this.offset;
    this.writeUint32(0);
    const result = writeUtf8ToSharedBuffer(value, this.bytes, this.offset);
    if (result.read !== value.length) {
      throw new RangeError('Shared telemetry payload overflow.');
    }
    this.view.setUint32(lengthOffset, result.written, true);
    this.offset += result.written;
  }

  private writeValue(value: unknown): void {
    if (value === null) {
      this.writeByte(ValueTag.Null);
      return;
    }
    if (value === undefined) {
      this.writeByte(ValueTag.Undefined);
      return;
    }
    if (value === false) {
      this.writeByte(ValueTag.False);
      return;
    }
    if (value === true) {
      this.writeByte(ValueTag.True);
      return;
    }
    if (typeof value === 'number') {
      this.writeNumber(value);
      return;
    }
    if (typeof value === 'string') {
      this.writeString(value);
      return;
    }
    if (Array.isArray(value)) {
      this.writeByte(ValueTag.Array);
      this.writeUint32(value.length);
      for (let index = 0; index < value.length; index += 1) {
        this.writeValue(value[index]);
      }
      return;
    }
    if (typeof value === 'object') {
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record);
      this.writeByte(ValueTag.Object);
      this.writeUint32(keys.length);
      for (const key of keys) {
        this.writeString(key);
        this.writeValue(record[key]);
      }
      return;
    }
    throw new TypeError(`Unsupported telemetry value: ${typeof value}`);
  }
}

class SharedValueReader {
  private readonly bytes: Uint8Array;
  private readonly view: DataView;
  private offset = 0;
  private limit = 0;

  public constructor(buffer: SharedArrayBuffer) {
    this.bytes = new Uint8Array(buffer);
    this.view = new DataView(buffer);
  }

  public decode(byteLength: number): unknown {
    this.offset = 0;
    this.limit = byteLength;
    const value = this.readValue();
    if (this.offset !== this.limit) {
      throw new RangeError('Trailing shared telemetry bytes.');
    }
    return value;
  }

  private reserve(byteLength: number): void {
    if (this.offset + byteLength > this.limit) {
      throw new RangeError('Incomplete shared telemetry payload.');
    }
  }

  private readByte(): number {
    this.reserve(1);
    const value = this.bytes[this.offset];
    this.offset += 1;
    return value;
  }

  private readUint32(): number {
    this.reserve(Uint32Array.BYTES_PER_ELEMENT);
    const value = this.view.getUint32(this.offset, true);
    this.offset += Uint32Array.BYTES_PER_ELEMENT;
    return value;
  }

  private readNumber(): number {
    this.reserve(Float64Array.BYTES_PER_ELEMENT);
    const value = this.view.getFloat64(this.offset, true);
    this.offset += Float64Array.BYTES_PER_ELEMENT;
    return value;
  }

  private readString(): string {
    const byteLength = this.readUint32();
    this.reserve(byteLength);
    const end = this.offset + byteLength;
    let value = '';
    while (this.offset < end) {
      const first = this.bytes[this.offset];
      this.offset += 1;
      let codePoint: number;
      if (first <= 0x7f) {
        codePoint = first;
      } else if ((first & 0xe0) === 0xc0) {
        if (this.offset >= end) throw new TypeError('Invalid UTF-8 telemetry string.');
        const second = this.bytes[this.offset];
        this.offset += 1;
        if ((second & 0xc0) !== 0x80) throw new TypeError('Invalid UTF-8 telemetry string.');
        codePoint = ((first & 0x1f) << 6) | (second & 0x3f);
      } else if ((first & 0xf0) === 0xe0) {
        if (this.offset + 1 >= end) throw new TypeError('Invalid UTF-8 telemetry string.');
        const second = this.bytes[this.offset];
        const third = this.bytes[this.offset + 1];
        this.offset += 2;
        if ((second & 0xc0) !== 0x80 || (third & 0xc0) !== 0x80) {
          throw new TypeError('Invalid UTF-8 telemetry string.');
        }
        codePoint = ((first & 0x0f) << 12) |
          ((second & 0x3f) << 6) |
          (third & 0x3f);
      } else if ((first & 0xf8) === 0xf0) {
        if (this.offset + 2 >= end) throw new TypeError('Invalid UTF-8 telemetry string.');
        const second = this.bytes[this.offset];
        const third = this.bytes[this.offset + 1];
        const fourth = this.bytes[this.offset + 2];
        this.offset += 3;
        if (
          (second & 0xc0) !== 0x80 ||
          (third & 0xc0) !== 0x80 ||
          (fourth & 0xc0) !== 0x80
        ) {
          throw new TypeError('Invalid UTF-8 telemetry string.');
        }
        codePoint = ((first & 0x07) << 18) |
          ((second & 0x3f) << 12) |
          ((third & 0x3f) << 6) |
          (fourth & 0x3f);
      } else {
        throw new TypeError('Invalid UTF-8 telemetry string.');
      }
      value += String.fromCodePoint(codePoint);
    }
    return value;
  }

  private readValue(): unknown {
    const tag = this.readByte();
    switch (tag) {
      case ValueTag.Null: return null;
      case ValueTag.False: return false;
      case ValueTag.True: return true;
      case ValueTag.Number: return this.readNumber();
      case ValueTag.String: return this.readString();
      case ValueTag.Undefined: return undefined;
      case ValueTag.Array: {
        const length = this.readUint32();
        // Every encoded value consumes at least one tag byte. A concurrent
        // writer can temporarily corrupt the count, so reject impossible
        // lengths before allocating the result array.
        if (length > this.limit - this.offset) {
          throw new RangeError('Invalid shared telemetry array length.');
        }
        const values = new Array<unknown>(length);
        for (let index = 0; index < length; index += 1) {
          values[index] = this.readValue();
        }
        return values;
      }
      case ValueTag.Object: {
        const keyCount = this.readUint32();
        // Each entry needs at least a string tag, a uint32 byte length, and a
        // value tag. Guard the allocation/loop against a mixed-generation
        // header while the worker is publishing the next snapshot.
        if (keyCount > Math.floor((this.limit - this.offset) / 6)) {
          throw new RangeError('Invalid shared telemetry object length.');
        }
        const value: Record<string, unknown> = {};
        for (let index = 0; index < keyCount; index += 1) {
          if (this.readByte() !== ValueTag.String) {
            throw new TypeError('Invalid shared telemetry object key.');
          }
          const key = this.readString();
          Object.defineProperty(value, key, {
            value: this.readValue(),
            enumerable: true,
            configurable: true,
            writable: true,
          });
        }
        return value;
      }
      default:
        throw new TypeError(`Unknown shared telemetry tag: ${tag}`);
    }
  }
}

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
  private readonly encoder: SharedValueWriter;

  public constructor(channel: SharedTelemetryChannel) {
    this.control = new Int32Array(channel.control);
    this.encoder = new SharedValueWriter(channel.payload);
  }

  public publish(value: unknown): boolean {
    // Odd sequence numbers mean that the writer owns the payload. The reader
    // accepts a packet only when the same even number brackets its read.
    Atomics.add(this.control, CONTROL_SEQUENCE, 1);
    try {
      const byteLength = this.encoder.encode(value);
      Atomics.store(this.control, CONTROL_LENGTH, byteLength);
      return true;
    } catch {
      Atomics.store(this.control, CONTROL_LENGTH, 0);
      Atomics.add(this.control, CONTROL_OVERFLOW_COUNT, 1);
      return false;
    } finally {
      Atomics.add(this.control, CONTROL_SEQUENCE, 1);
    }
  }
}

export class SharedTelemetryReader<T> {
  private readonly control: Int32Array;
  private readonly payloadByteLength: number;
  private readonly decoder: SharedValueReader;
  private lastSequence = 0;

  public constructor(channel: SharedTelemetryChannel) {
    this.control = new Int32Array(channel.control);
    this.payloadByteLength = channel.payload.byteLength;
    this.decoder = new SharedValueReader(channel.payload);
  }

  /** Returns only the newest complete packet; overwritten intermediate frames are intentionally coalesced. */
  public readLatest(): T | null {
    const sequenceBefore = Atomics.load(this.control, CONTROL_SEQUENCE);
    if (sequenceBefore === this.lastSequence || sequenceBefore % 2 !== 0) return null;
    const byteLength = Atomics.load(this.control, CONTROL_LENGTH);
    if (byteLength <= 0 || byteLength > this.payloadByteLength) return null;

    try {
      const decoded = this.decoder.decode(byteLength) as T;
      const sequenceAfter = Atomics.load(this.control, CONTROL_SEQUENCE);
      if (sequenceBefore !== sequenceAfter || sequenceAfter % 2 !== 0) return null;
      // Check once more after decoding. A writer can begin while the object
      // graph is being rebuilt; that mixed-generation value must be ignored.
      if (Atomics.load(this.control, CONTROL_SEQUENCE) !== sequenceAfter) return null;
      this.lastSequence = sequenceAfter;
      return decoded;
    } catch {
      // A concurrent write can make the transient packet invalid. The completed
      // generation is retried on the next animation frame.
      return null;
    }
  }

  public overflowCount(): number {
    return Atomics.load(this.control, CONTROL_OVERFLOW_COUNT);
  }
}
