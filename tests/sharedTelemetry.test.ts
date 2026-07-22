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

  it('rejects an oversized generation without exposing truncated JSON', () => {
    const channel = createSharedTelemetryChannel(64);
    const writer = new SharedTelemetryWriter(channel);
    const reader = new SharedTelemetryReader<{ value: string }>(channel);

    expect(writer.publish({ value: 'x'.repeat(512) })).toBe(false);
    expect(reader.readLatest()).toBeNull();
    expect(reader.overflowCount()).toBe(1);

    expect(writer.publish({ value: '정상' })).toBe(true);
    expect(reader.readLatest()).toEqual({ value: '정상' });
  });
});
