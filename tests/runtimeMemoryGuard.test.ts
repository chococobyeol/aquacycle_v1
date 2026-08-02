import { describe, expect, it } from 'vitest';
import {
  createRendererMemoryGuardState,
  evaluateRendererMemoryGuard,
  rendererMemoryRecoveryThresholdMb,
} from '../src/runtimeMemoryGuard';

describe('renderer memory recovery guard', () => {
  it('uses a conservative system-memory-aware threshold', () => {
    expect(rendererMemoryRecoveryThresholdMb(8 * 1024 ** 3)).toBe(900);
    expect(rendererMemoryRecoveryThresholdMb(16 * 1024 ** 3)).toBeCloseTo(1_228.8);
    expect(rendererMemoryRecoveryThresholdMb(64 * 1024 ** 3)).toBe(1_400);
  });

  it('does not restart for a high but stable renderer', () => {
    const state = createRendererMemoryGuardState();
    for (const privateMb of [620, 1_050, 1_060, 1_055, 1_062, 1_058]) {
      expect(evaluateRendererMemoryGuard(
        state,
        privateMb,
        8 * 1024 ** 3,
        true,
      ).shouldRecover).toBe(false);
    }
  });

  it('requests recovery after sustained growth crosses the safe threshold', () => {
    const state = createRendererMemoryGuardState();
    const decisions = [180, 430, 680, 930].map((privateMb) =>
      evaluateRendererMemoryGuard(
        state,
        privateMb,
        8 * 1024 ** 3,
        true,
      ));
    expect(decisions.at(-1)).toMatchObject({
      shouldRecover: true,
      rising: true,
    });
  });

  it('honours the cooldown even at the hard limit', () => {
    const state = createRendererMemoryGuardState();
    expect(evaluateRendererMemoryGuard(
      state,
      2_100,
      16 * 1024 ** 3,
      false,
    ).shouldRecover).toBe(false);
  });
});
