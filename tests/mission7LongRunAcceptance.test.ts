import { describe, expect, it } from 'vitest';
import {
  acuteWaterDeathCount,
  analyzeRecoveryOscillation,
  summarizePopulationEvents,
  type LongRunPopulationEvent,
} from '../scripts/mission7LongRunAcceptance';

describe('mission 7 long-run acceptance helpers', () => {
  it('does not mistake monotonic resource drift for recovery oscillation', () => {
    const summary = analyzeRecoveryOscillation(
      [4.2, 3.8, 3.3, 2.9, 2.5, 2.2],
      0.02,
      0.15,
    );

    expect(summary.falls).toBeGreaterThan(0);
    expect(summary.rises).toBe(0);
    expect(summary.hasDepletionAndRecovery).toBe(false);
  });

  it('requires a meaningful trough and later food recovery', () => {
    const summary = analyzeRecoveryOscillation(
      [3.6, 3.1, 2.4, 1.9, 2.0, 2.5, 3.0, 2.7],
      0.02,
      0.15,
    );

    expect(summary.span).toBeCloseTo(1.7);
    expect(summary.largestDeclineBeforeTrough).toBeGreaterThanOrEqual(1.7);
    expect(summary.largestRecoveryAfterTrough).toBeGreaterThanOrEqual(1.1);
    expect(summary.directionChanges).toBeGreaterThanOrEqual(2);
    expect(summary.hasDepletionAndRecovery).toBe(true);
  });

  it('separates late births, maturations and each death cause by species', () => {
    const events: LongRunPopulationEvent[] = [
      {
        speciesId: 'daphnia',
        kind: 'birth',
        cause: null,
        elapsedSeconds: 3_900,
      },
      {
        speciesId: 'daphnia',
        kind: 'matured',
        cause: null,
        elapsedSeconds: 4_100,
      },
      {
        speciesId: 'daphnia',
        kind: 'death',
        cause: 'old-age',
        elapsedSeconds: 4_500,
      },
      {
        speciesId: 'cherry-shrimp',
        kind: 'death',
        cause: 'toxicity',
        elapsedSeconds: 5_200,
      },
    ];

    const daphnia = summarizePopulationEvents(events, 'daphnia');
    const shrimp = summarizePopulationEvents(events, 'cherry-shrimp');

    expect(daphnia.births).toBe(1);
    expect(daphnia.maturations).toBe(1);
    expect(daphnia.deathsByCause['old-age']).toBe(1);
    expect(acuteWaterDeathCount(daphnia)).toBe(0);
    expect(shrimp.deaths).toBe(1);
    expect(shrimp.deathsByCause.toxicity).toBe(1);
    expect(acuteWaterDeathCount(shrimp)).toBe(1);
  });
});

