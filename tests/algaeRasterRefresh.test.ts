import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { userAgent: 'vitest' },
  });
});

import {
  algaeRasterRefreshIntervalMs,
  shouldRefreshAlgaeRasterNow,
} from '../src/renderer/tank/AquariumCanvas';

describe('algae raster refresh scheduling', () => {
  it('caps normal speeds near 4 Hz and high speeds near 2 Hz', () => {
    expect(algaeRasterRefreshIntervalMs(1)).toBe(250);
    expect(algaeRasterRefreshIntervalMs(8)).toBe(250);
    expect(algaeRasterRefreshIntervalMs(16)).toBe(500);
    expect(algaeRasterRefreshIntervalMs(64)).toBe(500);
  });

  it('waits for the running-speed interval but never delays paused editing', () => {
    expect(shouldRefreshAlgaeRasterNow({
      phase: 'running',
      speed: 8,
      editable: false,
      nowMs: 1_249,
      lastRefreshAtMs: 1_000,
    })).toBe(false);
    expect(shouldRefreshAlgaeRasterNow({
      phase: 'running',
      speed: 8,
      editable: false,
      nowMs: 1_250,
      lastRefreshAtMs: 1_000,
    })).toBe(true);
    expect(shouldRefreshAlgaeRasterNow({
      phase: 'running',
      speed: 64,
      editable: false,
      nowMs: 1_499,
      lastRefreshAtMs: 1_000,
    })).toBe(false);
    expect(shouldRefreshAlgaeRasterNow({
      phase: 'paused',
      speed: 64,
      editable: false,
      nowMs: 1_001,
      lastRefreshAtMs: 1_000,
    })).toBe(true);
    expect(shouldRefreshAlgaeRasterNow({
      phase: 'running',
      speed: 64,
      editable: true,
      nowMs: 1_001,
      lastRefreshAtMs: 1_000,
    })).toBe(true);
  });
});
