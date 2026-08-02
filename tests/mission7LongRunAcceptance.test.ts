import { describe, expect, it } from 'vitest';
import {
  acuteWaterDeathCount,
  analyzeRecoveryOscillation,
  recentHalf,
  summarizeLinearTailTrend,
  summarizePostTroughRecovery,
  summarizePopulationEvents,
  sustainedProjectedCeilingBreach,
  sustainedProjectedFloorBreach,
  type LongRunPopulationEvent,
  type TimedValue,
} from '../scripts/mission7LongRunAcceptance';

describe('mission 7 long-run acceptance helpers', () => {
  const timed = (values: readonly number[]): TimedValue[] =>
    values.map((value, index) => ({
      time: index * 120,
      value,
    }));

  it('lets a terminal recent decline override earlier population growth', () => {
    const values = Array.from({ length: 61 }, (_, index) =>
      index <= 30
        ? 4 + 96 * index / 30
        : 100 - 96 * (index - 30) / 30
    );
    const full = summarizeLinearTailTrend(timed(values));
    const recent = summarizeLinearTailTrend(recentHalf(timed(values)));

    expect(Math.min(...values)).toBe(4);
    expect(values.at(-1)).toBe(4);
    expect(full.slopeUpper95).toBeGreaterThan(0);
    expect(recent.slopeUpper95).toBeLessThan(0);
    expect(recent.projectedAfterSameDuration).toBeLessThan(4);
    expect(sustainedProjectedFloorBreach(recent, 4)).toBe(true);
  });

  it('does not infer a trajectory collapse from one final snapshot dip', () => {
    const values = [...Array<number>(30).fill(20), 4];
    const recent = summarizeLinearTailTrend(timed(values));

    expect(recent.slopePerSecond).toBeLessThan(0);
    expect(recent.slopeUpper95).toBeGreaterThan(0);
    expect(sustainedProjectedFloorBreach(recent, 4)).toBe(false);
  });

  it('confirms a cohort-sized post-trough recovery with net recruitment', () => {
    const recent = timed([59, 61, 63, 58, 50, 42, 34, 28, 30, 32, 33]);
    const events: LongRunPopulationEvent[] = [
      ...Array.from({ length: 7 }, (_, index) => ({
        speciesId: 'cherry-shrimp' as const,
        kind: 'birth' as const,
        cause: null,
        elapsedSeconds: 1_000 + index,
      })),
      {
        speciesId: 'cherry-shrimp',
        kind: 'death',
        cause: 'starvation',
        elapsedSeconds: 1_020,
      },
      {
        speciesId: 'cherry-shrimp',
        kind: 'death',
        cause: 'old-age',
        elapsedSeconds: 1_030,
      },
      {
        speciesId: 'cherry-shrimp',
        kind: 'matured',
        cause: null,
        elapsedSeconds: 1_040,
      },
    ];

    const recovery = summarizePostTroughRecovery(
      recent,
      events,
      'cherry-shrimp',
      {
        populationFloor: 4,
        cohortStep: 3,
        confirmationSeconds: 240,
      },
    );

    expect(recovery.troughTimeSeconds).toBe(840);
    expect(recovery.troughPopulation).toBe(28);
    expect(recovery.observedAfterTroughSeconds).toBe(360);
    expect(recovery.finalThreeMedianPopulation).toBe(32);
    expect(recovery.postTroughRecruitment.births).toBe(7);
    expect(recovery.postTroughRecruitment.deaths).toBe(2);
    expect(recovery.postTroughRecruitment.maturations).toBe(1);
    expect(recovery.confirmed).toBe(true);
  });

  it('uses the last absolute recent trough and only later events', () => {
    const recent = timed([20, 6, 10, 6, 8, 9, 10]);
    const events: LongRunPopulationEvent[] = [
      ...Array.from({ length: 9 }, (_, index) => ({
        speciesId: 'cherry-shrimp' as const,
        kind: 'birth' as const,
        cause: null,
        elapsedSeconds: 180 + index,
      })),
      ...Array.from({ length: 4 }, (_, index) => ({
        speciesId: 'cherry-shrimp' as const,
        kind: 'birth' as const,
        cause: null,
        elapsedSeconds: 500 + index,
      })),
      {
        speciesId: 'cherry-shrimp',
        kind: 'death',
        cause: 'old-age',
        elapsedSeconds: 510,
      },
      {
        speciesId: 'cherry-shrimp',
        kind: 'matured',
        cause: null,
        elapsedSeconds: 520,
      },
    ];

    const recovery = summarizePostTroughRecovery(
      recent,
      events,
      'cherry-shrimp',
      {
        populationFloor: 4,
        cohortStep: 3,
        confirmationSeconds: 240,
      },
    );

    expect(recovery.troughTimeSeconds).toBe(360);
    expect(recovery.postTroughRecruitment.births).toBe(4);
    expect(recovery.postTroughRecruitment.deaths).toBe(1);
    expect(recovery.confirmed).toBe(true);
  });

  it('rejects a rebound observed for less than the confirmation window', () => {
    const recovery = summarizePostTroughRecovery(
      timed([20, 18, 16, 14, 12, 10, 8, 6, 4, 7]),
      [
        {
          speciesId: 'cherry-shrimp',
          kind: 'birth',
          cause: null,
          elapsedSeconds: 1_090,
        },
        {
          speciesId: 'cherry-shrimp',
          kind: 'matured',
          cause: null,
          elapsedSeconds: 1_095,
        },
      ],
      'cherry-shrimp',
      {
        populationFloor: 4,
        cohortStep: 3,
        confirmationSeconds: 240,
      },
    );

    expect(recovery.observedAfterTroughSeconds).toBe(120);
    expect(recovery.confirmed).toBe(false);
  });

  it('requires a final-three cohort rise, net births and maturation', () => {
    const options = {
      populationFloor: 4,
      cohortStep: 3,
      confirmationSeconds: 240,
    };
    const enoughEvents: LongRunPopulationEvent[] = [
      {
        speciesId: 'cherry-shrimp',
        kind: 'birth',
        cause: null,
        elapsedSeconds: 500,
      },
      {
        speciesId: 'cherry-shrimp',
        kind: 'birth',
        cause: null,
        elapsedSeconds: 510,
      },
      {
        speciesId: 'cherry-shrimp',
        kind: 'matured',
        cause: null,
        elapsedSeconds: 520,
      },
    ];

    expect(summarizePostTroughRecovery(
      timed([20, 8, 6, 4, 5, 6, 6]),
      enoughEvents,
      'cherry-shrimp',
      options,
    ).confirmed).toBe(false);
    expect(summarizePostTroughRecovery(
      timed([20, 8, 6, 4, 7, 8, 9]),
      [
        ...enoughEvents,
        {
          speciesId: 'cherry-shrimp',
          kind: 'death',
          cause: 'starvation',
          elapsedSeconds: 530,
        },
        {
          speciesId: 'cherry-shrimp',
          kind: 'death',
          cause: 'old-age',
          elapsedSeconds: 540,
        },
      ],
      'cherry-shrimp',
      options,
    ).confirmed).toBe(false);
    expect(summarizePostTroughRecovery(
      timed([20, 8, 6, 4, 7, 8, 9]),
      enoughEvents.filter((event) => event.kind !== 'matured'),
      'cherry-shrimp',
      options,
    ).confirmed).toBe(false);
  });

  it('does not let the death-cause composition change recovery', () => {
    const recent = timed([20, 8, 4, 6, 7, 8, 9]);
    const commonEvents: LongRunPopulationEvent[] = [
      ...Array.from({ length: 3 }, (_, index) => ({
        speciesId: 'cherry-shrimp' as const,
        kind: 'birth' as const,
        cause: null,
        elapsedSeconds: 400 + index,
      })),
      {
        speciesId: 'cherry-shrimp',
        kind: 'matured',
        cause: null,
        elapsedSeconds: 410,
      },
    ];
    const evaluateWithCause = (
      cause: 'starvation' | 'old-age',
    ): boolean => summarizePostTroughRecovery(
      recent,
      [
        ...commonEvents,
        {
          speciesId: 'cherry-shrimp',
          kind: 'death',
          cause,
          elapsedSeconds: 420,
        },
      ],
      'cherry-shrimp',
      {
        populationFloor: 4,
        cohortStep: 3,
        confirmationSeconds: 240,
      },
    ).confirmed;

    expect(evaluateWithCause('starvation')).toBe(true);
    expect(evaluateWithCause('old-age')).toBe(true);
  });

  it('detects a sustained recent rise projected through a safety ceiling', () => {
    const trend = summarizeLinearTailTrend(timed(
      Array.from({ length: 31 }, (_, index) => 1 + index * 0.12),
    ));

    expect(trend.slopeLower95).toBeGreaterThan(0);
    expect(trend.projectedAfterSameDuration).toBeGreaterThan(6);
    expect(sustainedProjectedCeilingBreach(trend, 6)).toBe(true);
  });

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
