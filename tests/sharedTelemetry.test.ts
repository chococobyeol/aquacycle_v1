import { describe, expect, it } from 'vitest';
import {
  createSharedTelemetryChannel,
  SharedTelemetryReader,
  SharedTelemetryWriter,
} from '../src/simulation/sharedTelemetry';

describe('bounded shared worker telemetry', () => {
  it('reuses one fixed payload while delivering the newest complete packet', () => {
    const channel = createSharedTelemetryChannel(4096);
    const writer = new SharedTelemetryWriter(channel);
    const reader = new SharedTelemetryReader<{ sequence: number; label: string }>(channel);
    const originalPayload = channel.payload;

    for (let sequence = 1; sequence <= 2_000; sequence += 1) {
      expect(writer.publish({ sequence, label: `새우-${sequence}` })).toBe(true);
    }

    expect(channel.payload).toBe(originalPayload);
    expect(reader.readLatest()).toEqual({ sequence: 2_000, label: '새우-2000' });
    expect(reader.readLatest()).toBeNull();
  });

  it('rejects an oversized generation without exposing a truncated packet', () => {
    const channel = createSharedTelemetryChannel(64);
    const writer = new SharedTelemetryWriter(channel);
    const reader = new SharedTelemetryReader<{ value: string }>(channel);

    expect(writer.publish({ value: 'x'.repeat(512) })).toBe(false);
    expect(reader.readLatest()).toBeNull();
    expect(reader.overflowCount()).toBe(1);

    expect(writer.publish({ value: '정상' })).toBe(true);
    expect(reader.readLatest()).toEqual({ value: '정상' });
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
});
