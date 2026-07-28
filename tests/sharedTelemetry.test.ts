import { describe, expect, it } from 'vitest';
import {
  createSharedTelemetryChannel,
  SHARED_TELEMETRY_PAYLOAD_BYTES,
  SharedTelemetryReader,
  SharedTelemetryWriter,
} from '../src/simulation/sharedTelemetry';

describe('bounded shared worker telemetry', () => {
  it('reserves enough fixed space for legitimate population-bloom snapshots', () => {
    expect(SHARED_TELEMETRY_PAYLOAD_BYTES).toBe(8 * 1024 * 1024);
  });

  it('reuses three fixed publication slots while delivering the newest complete packet', () => {
    const channel = createSharedTelemetryChannel(4096);
    const writer = new SharedTelemetryWriter(channel);
    const reader = new SharedTelemetryReader<{ sequence: number; label: string }>(channel);
    const originalPayloads = [...channel.payloads];

    expect(channel.payloads[0]).not.toBe(channel.payloads[1]);
    expect(channel.payloads[0]).not.toBe(channel.payloads[2]);
    expect(channel.payloads[1]).not.toBe(channel.payloads[2]);
    for (let sequence = 1; sequence <= 2_000; sequence += 1) {
      expect(writer.publish({ sequence, label: `새우-${sequence}` })).toBe(true);
    }

    expect(channel.payloads).toEqual(originalPayloads);
    expect(reader.readLatest()).toEqual({ sequence: 2_000, label: '새우-2000' });
    expect(reader.readLatest()).toBeNull();
  });

  it('rejects an oversized generation without exposing a truncated packet', () => {
    const channel = createSharedTelemetryChannel(64);
    const writer = new SharedTelemetryWriter(channel);
    const reader = new SharedTelemetryReader<{ value: string }>(channel);

    expect(writer.publish({ value: '이전' })).toBe(true);
    expect(reader.readLatest()).toEqual({ value: '이전' });
    expect(writer.publish({ value: 'x'.repeat(512) })).toBe(false);
    expect(reader.readLatest()).toBeNull();
    expect(reader.overflowCount()).toBe(1);

    expect(writer.publish({ value: '정상' })).toBe(true);
    expect(reader.readLatest()).toEqual({ value: '정상' });
  });

  it('never overwrites a slot claimed by a slower renderer decode', () => {
    const channel = createSharedTelemetryChannel(4096);
    const writer = new SharedTelemetryWriter(channel);
    const reader = new SharedTelemetryReader<{ sequence: number }>(channel);
    const control = new Int32Array(channel.control);

    expect(writer.publish({ sequence: 1 })).toBe(true);
    const publishedSlot = Atomics.load(control, 3);
    // Control word 4 is the reader's encoded slot claim (zero means idle).
    Atomics.store(control, 4, publishedSlot + 1);
    const claimedBytes = new Uint8Array(channel.payloads[publishedSlot]);
    const before = claimedBytes.slice();

    for (let sequence = 2; sequence <= 500; sequence += 1) {
      expect(writer.publish({ sequence })).toBe(true);
    }

    expect(claimedBytes).toEqual(before);
    Atomics.store(control, 4, 0);
    expect(reader.readLatest()).toEqual({ sequence: 500 });
  });

  it('round-trips the nested values used by simulation snapshots without JSON', () => {
    const channel = createSharedTelemetryChannel(16 * 1024);
    const writer = new SharedTelemetryWriter(channel);
    const reader = new SharedTelemetryReader<{
      phase: string;
      values: unknown[];
      nested: Record<string, unknown>;
    }>(channel);
    const value = {
      phase: '관찰 중',
      values: [null, undefined, false, true, -0, 3.25, Number.NaN, '새우🦐'],
      nested: {
        arrays: [[1, 2, 3], [], ['붓뚜껑말']],
        optional: undefined,
      },
    };

    expect(writer.publish(value)).toBe(true);
    const decoded = reader.readLatest()!;
    expect(decoded.phase).toBe(value.phase);
    expect(decoded.values.slice(0, 4)).toEqual(value.values.slice(0, 4));
    expect(Object.is(decoded.values[4], -0)).toBe(true);
    expect(decoded.values[5]).toBe(3.25);
    expect(Number.isNaN(decoded.values[6])).toBe(true);
    expect(decoded.values[7]).toBe('새우🦐');
    expect(decoded.nested).toEqual(value.nested);
  });

  it('alternates two reusable object graphs instead of rebuilding every snapshot', () => {
    const channel = createSharedTelemetryChannel(16 * 1024);
    const writer = new SharedTelemetryWriter(channel);
    const reader = new SharedTelemetryReader<{
      sequence: number;
      animals: Array<{ id: string; x: number; traits: { stage: string } }>;
      holding: Record<string, unknown>;
    }>(channel);
    const roots = new Set<object>();
    const animalArrays = new Set<object>();
    const animals = new Set<object>();
    const traits = new Set<object>();

    for (let sequence = 1; sequence <= 2_000; sequence += 1) {
      const holding = sequence % 3 === 0
        ? { kind: 'seed', speciesId: 'vallisneria' }
        : { kind: 'animal', animalId: `animal-${sequence}` };
      expect(writer.publish({
        sequence,
        animals: [{
          id: `animal-${sequence}`,
          x: sequence * 0.5,
          traits: { stage: sequence % 2 === 0 ? 'adult' : 'juvenile' },
        }],
        holding,
      })).toBe(true);
      const decoded = reader.readLatest()!;
      roots.add(decoded);
      animalArrays.add(decoded.animals);
      animals.add(decoded.animals[0]);
      traits.add(decoded.animals[0].traits);
      expect(decoded.sequence).toBe(sequence);
      expect(decoded.animals[0].id).toBe(`animal-${sequence}`);
      expect(decoded.holding).toEqual(holding);
      expect(Object.keys(decoded.holding).sort()).toEqual(Object.keys(holding).sort());
    }

    expect(roots.size).toBe(2);
    expect(animalArrays.size).toBe(2);
    expect(animals.size).toBe(2);
    expect(traits.size).toBe(2);
  });
});
