import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { userAgent: 'vitest' },
  });
});

import { shouldTriggerRicefishBitePulse } from '../src/renderer/tank/AquariumCanvas';
import { ricefishSideSwingPose } from '../src/renderer/tank/ricefishAnimation';

describe('ricefish bite telemetry', () => {
  it('uses the first worker sample only as a baseline', () => {
    expect(shouldTriggerRicefishBitePulse(null, 18, 0, 4.2)).toBe(false);
  });

  it('triggers once when a newer authoritative sample reports consumption', () => {
    expect(shouldTriggerRicefishBitePulse(18, 19, 4.2, 4.35)).toBe(true);
    expect(shouldTriggerRicefishBitePulse(19, 19, 4.2, 4.35)).toBe(false);
  });

  it('does not mistake interpolation, a reset, or a loaded baseline for a bite', () => {
    expect(shouldTriggerRicefishBitePulse(19, 19, 4.2, 4.3)).toBe(false);
    expect(shouldTriggerRicefishBitePulse(19, 1, 4.2, 8.1)).toBe(false);
    expect(shouldTriggerRicefishBitePulse(19, 20, 8.1, 8.1)).toBe(false);
  });

  it('adds a brief opposing trunk and tail flex during the bite', () => {
    expect(ricefishSideSwingPose(1, 1)).toEqual({
      bodyRotation: 0,
      bodySkewY: 0,
      tailSkewY: 0,
    });
    const middle = ricefishSideSwingPose(0.5, 1);
    expect(middle.bodyRotation).toBeGreaterThan(0);
    expect(middle.bodySkewY).toBeGreaterThan(0);
    expect(middle.tailSkewY).toBeLessThan(0);
    const opposite = ricefishSideSwingPose(0.5, -1);
    expect(opposite.bodyRotation).toBeCloseTo(-middle.bodyRotation);
    expect(ricefishSideSwingPose(0, 1).bodyRotation).toBeCloseTo(0);
  });
});
