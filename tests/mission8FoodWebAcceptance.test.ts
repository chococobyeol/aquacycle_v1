import { describe, expect, it } from 'vitest';
import {
  MISSION8_TRAJECTORY_FULL_WINDOW_SECONDS,
  evaluateMission8AnimalTrajectory,
  resolveMission8TrajectoryEndSeconds,
  type Mission8TrajectoryEvent,
  type Mission8TrajectoryInput,
  type Mission8TrajectoryPoint,
  type Mission8TrajectorySpeciesId,
} from '../scripts/mission8FoodWebAcceptance';

const END_SECONDS = MISSION8_TRAJECTORY_FULL_WINDOW_SECONDS;
const SAMPLE_SECONDS = 120;

const samplesWith = (
  populationAt: (time: number) => number,
  secondGenerationAt?: (time: number) => number,
  biomassAt?: (time: number) => number,
  adultsAt?: (time: number) => number,
  secondGenerationAdultsAt?: (time: number) => number,
): Mission8TrajectoryPoint[] => Array.from(
  { length: END_SECONDS / SAMPLE_SECONDS + 1 },
  (_, index) => {
    const time = index * SAMPLE_SECONDS;
    const total = Math.max(0, Math.round(populationAt(time)));
    const adults = Math.min(
      total,
      Math.max(0, Math.round(adultsAt?.(time) ?? 4)),
    );
    const secondGenerationOrLater = Math.min(
      total,
      Math.max(
        0,
        Math.round(secondGenerationAt?.(time) ?? total),
      ),
    );
    return {
      time,
      total,
      adults,
      totalBiomass: Math.max(0, biomassAt?.(time) ?? total),
      secondGenerationOrLater,
      secondGenerationOrLaterAdults: Math.min(
        adults,
        secondGenerationOrLater,
        Math.max(
          0,
          Math.round(
            secondGenerationAdultsAt?.(time) ??
              adultsAt?.(time) ??
              4,
          ),
        ),
      ),
    };
  },
);

const completeEvents = (
  speciesId: Mission8TrajectorySpeciesId,
): Mission8TrajectoryEvent[] => [
  { time: 600, kind: 'birth' },
  ...(speciesId === 'japanese-ricefish'
    ? [{ time: 720, kind: 'hatched' as const }]
    : []),
  { time: 960, kind: 'matured' },
  { time: 3_900, kind: 'birth' },
  ...(speciesId === 'japanese-ricefish'
    ? [{ time: 4_020, kind: 'hatched' as const }]
    : []),
  { time: 4_320, kind: 'matured' },
];

const inputFor = (
  samples: Mission8TrajectoryPoint[],
  overrides: Partial<Mission8TrajectoryInput> = {},
): Mission8TrajectoryInput => {
  const speciesId = overrides.speciesId ?? 'daphnia';
  return {
    speciesId,
    requestedPostReleaseDurationSeconds: END_SECONDS,
    releaseSeconds: 0,
    endSeconds: END_SECONDS,
    samples,
    events: completeEvents(speciesId),
    ...overrides,
  };
};

describe('Mission 8 development food-web trajectory acceptance', () => {
  it('catches grow-then-collapse even when the full-window slope is neutral', () => {
    const result = evaluateMission8AnimalTrajectory(inputFor(samplesWith(
      (time) => time <= END_SECONDS / 2
        ? 12 + 18 * (time / (END_SECONDS / 2))
        : 30 - 18 * ((time - END_SECONDS / 2) / (END_SECONDS / 2)),
    )));

    expect(result.fullWindow.trend.slopeLower95).toBeLessThan(0);
    expect(result.fullWindow.trend.slopeUpper95).toBeGreaterThan(0);
    expect(result.recentWindow.trend.slopeUpper95).toBeLessThan(0);
    expect(result.projectedCollapse).toBe(true);
    expect(result.confirmedRecovery).toBe(false);
    expect(result.recoveryEvidence.troughTimeSeconds).toBe(END_SECONDS);
    expect(result.recoveryEvidence.observedAfterTroughSeconds).toBe(0);
    expect(result.status).toBe('terminal-collapse');
    expect(result.passed).toBe(false);
  });

  it('does not treat one isolated final census dip as a terminal trend', () => {
    const result = evaluateMission8AnimalTrajectory(inputFor(
      samplesWith((time) => time === END_SECONDS ? 4 : 20),
      { speciesId: 'cherry-shrimp' },
    ));

    expect(result.recentWindow.medianPopulation).toBe(20);
    expect(result.recentWindow.minimumPopulation).toBe(4);
    expect(result.recentWindow.fractionAtOrAbovePopulationFloor)
      .toBeCloseTo(27 / 28);
    expect(result.projectedCollapse).toBe(false);
    expect(result.status).toBe('persistent');
    expect(result.passed).toBe(true);
  });

  it('rejects a sustained terminal descent that has not recovered or cycled', () => {
    const result = evaluateMission8AnimalTrajectory(inputFor(
      samplesWith((time) => {
        if (time <= 6_240) return 20;
        if (time === 6_360) return 15;
        if (time === 6_480) return 9;
        return 4;
      }),
      { speciesId: 'cherry-shrimp' },
    ));

    expect(result.recentWindow.medianPopulation).toBe(20);
    expect(result.projectedCollapse).toBe(false);
    expect(result.recentWindow.finalPopulation)
      .toBeLessThan(result.populationFloor);
    expect(result.reason).toContain('terminal population samples');
    expect(result.status).toBe('terminal-collapse');
    expect(result.passed).toBe(false);
  });

  it('rejects a sustained terminal biomass descent hidden by stable counts', () => {
    const result = evaluateMission8AnimalTrajectory(inputFor(samplesWith(
      () => 20,
      undefined,
      (time) => {
        if (time <= 6_240) return 20;
        if (time === 6_360) return 12;
        if (time === 6_480) return 7;
        return 4;
      },
    )));

    expect(result.recentWindow.medianBiomass).toBe(20);
    expect(result.biomassProjectedCollapse).toBe(false);
    expect(result.recentWindow.finalBiomass)
      .toBeLessThan(result.biomassFloor);
    expect(result.reason).toContain('terminal conserved-biomass samples');
    expect(result.status).toBe('terminal-collapse');
    expect(result.passed).toBe(false);
  });

  it('accepts a bounded cycle whose final census is at a low point', () => {
    const result = evaluateMission8AnimalTrajectory(inputFor(samplesWith(
      (time) => time < END_SECONDS / 2
        ? 20
        : 20 - 16 * Math.cos(
          6 * Math.PI *
            ((time - END_SECONDS / 2) / (END_SECONDS / 2)),
        ),
    ), { speciesId: 'cherry-shrimp' }));

    expect(result.recentWindow.finalPopulation).toBe(4);
    expect(result.recentWindow.medianPopulation).toBeGreaterThanOrEqual(5);
    expect(result.directionChanges).toBeGreaterThanOrEqual(2);
    expect(result.projectedCollapse).toBe(false);
    expect(result.status).toBe('cyclic');
    expect(result.passed).toBe(true);
  });

  it('rejects stable counts when conserved biomass is collapsing', () => {
    const result = evaluateMission8AnimalTrajectory(inputFor(samplesWith(
      () => 20,
      undefined,
      (time) => 20 - 19.2 * (time / END_SECONDS),
    )));

    expect(result.recentWindow.medianPopulation).toBe(20);
    expect(result.recentBiomassMedianPassed).toBe(true);
    expect(result.recentWindow.biomassTrend.slopeUpper95).toBeLessThan(0);
    expect(result.recentWindow.biomassTrend.projectedAfterSameDuration)
      .toBeLessThan(result.biomassFloor);
    expect(result.biomassProjectedCollapse).toBe(true);
    expect(result.biomassRecoveryConfirmed).toBe(false);
    expect(result.status).toBe('terminal-collapse');
    expect(result.passed).toBe(false);
  });

  it('does not mistake a robust population descent with stable individual mass for depletion', () => {
    const populationAt = (time: number): number =>
      time <= END_SECONDS / 2
        ? 400
        : 400 - 160 * (
          (time - END_SECONDS / 2) /
          (END_SECONDS / 2)
        );
    const result = evaluateMission8AnimalTrajectory(inputFor(samplesWith(
      populationAt,
      undefined,
      (time) => populationAt(time) * 0.003,
      (time) => populationAt(time) * 0.32,
    )));

    expect(result.recentWindow.trend.projectedAfterSameDuration)
      .toBeGreaterThan(result.populationFloor);
    expect(result.recentWindow.biomassTrend.projectedAfterSameDuration)
      .toBeLessThan(result.biomassFloor);
    expect(result.biomassProjectedCollapse).toBe(false);
    expect(result.passed).toBe(true);
  });

  it('does not extrapolate through an actively recruiting juvenile cohort', () => {
    const result = evaluateMission8AnimalTrajectory(inputFor(
      samplesWith(
        () => 8,
        () => 8,
        (time) => time <= END_SECONDS / 2
          ? 0.12
          : 0.12 - 0.06 * (
            (time - END_SECONDS / 2) /
            (END_SECONDS / 2)
          ),
        (time) => time <= END_SECONDS / 2
          ? 4
          : 4 * (
            1 - (time - END_SECONDS / 2) /
              (END_SECONDS / 2)
          ),
        (time) => time <= END_SECONDS / 2
          ? 4
          : 4 * (
            1 - (time - END_SECONDS / 2) /
              (END_SECONDS / 2)
          ),
      ),
      { speciesId: 'japanese-ricefish' },
    ));

    expect(result.recentWindow.finalAdults).toBe(0);
    expect(result.recentWindow.medianAdults).toBeGreaterThanOrEqual(1);
    expect(result.recentWindow.biomassTrend.projectedAfterSameDuration)
      .toBeLessThan(result.biomassFloor);
    expect(result.biomassProjectedCollapse).toBe(false);
    expect(result.passed).toBe(true);
  });

  it('rejects a flat post-collapse biomass remnant despite stable counts', () => {
    const result = evaluateMission8AnimalTrajectory(inputFor(samplesWith(
      () => 20,
      undefined,
      (time) => time <= END_SECONDS / 2 ? 12 : 1,
    )));

    expect(result.projectedCollapse).toBe(false);
    expect(result.recentWindow.medianPopulation).toBe(20);
    expect(result.recentWindow.medianBiomass).toBe(1);
    expect(result.recentBiomassMedianPassed).toBe(false);
    expect(result.status).toBe('terminal-collapse');
    expect(result.passed).toBe(false);
  });

  it('allows a bounded conserved-biomass cohort cycle', () => {
    const result = evaluateMission8AnimalTrajectory(inputFor(samplesWith(
      () => 20,
      undefined,
      (time) => 12 - 8 * Math.cos(4 * Math.PI * time / END_SECONDS),
    )));

    expect(result.recentWindow.finalBiomass).toBeCloseTo(4);
    expect(result.recentWindow.medianBiomass).toBeGreaterThan(
      result.biomassFloor,
    );
    expect(result.biomassDirectionChanges).toBeGreaterThanOrEqual(3);
    expect(result.biomassProjectedCollapse).toBe(false);
    expect(result.passed).toBe(true);
  });

  it('reports adult count and adult-fraction trends separately', () => {
    const result = evaluateMission8AnimalTrajectory(inputFor(samplesWith(
      () => 20,
      undefined,
      () => 20,
      (time) => 2 + 8 * time / END_SECONDS,
    )));

    expect(result.fullWindow.adultCountTrend.slopePerSecond)
      .toBeGreaterThan(0);
    expect(result.fullWindow.adultFractionTrend.slopePerSecond)
      .toBeGreaterThan(0);
    expect(result.recentWindow.medianAdults).toBeGreaterThan(0);
    expect(result.recentWindow.finalAdults).toBe(10);
    expect(result.recentWindow.finalAdultFraction).toBeCloseTo(0.5);
    expect(result.passed).toBe(true);
  });

  it('rejects a lineage whose adult stage disappears through the recent window', () => {
    const result = evaluateMission8AnimalTrajectory(inputFor(samplesWith(
      () => 20,
      undefined,
      () => 20,
      () => 0,
    )));

    expect(result.recentWindow.medianAdults).toBe(0);
    expect(result.adultStagePassed).toBe(false);
    expect(result.status).toBe('non-persistent');
    expect(result.passed).toBe(false);
  });

  it('does not fail solely because the final census lands between adult cohorts', () => {
    const result = evaluateMission8AnimalTrajectory(inputFor(samplesWith(
      () => 20,
      undefined,
      () => 20,
      (time) => time === END_SECONDS ? 0 : 4,
    )));

    expect(result.recentWindow.finalAdults).toBe(0);
    expect(result.recentWindow.medianAdults).toBe(4);
    expect(result.adultStagePassed).toBe(true);
    expect(result.passed).toBe(true);
  });

  it('requires the later generations themselves to reach adulthood', () => {
    const result = evaluateMission8AnimalTrajectory(inputFor(samplesWith(
      () => 20,
      () => 12,
      () => 20,
      () => 4,
      () => 0,
    )));

    expect(result.recentWindow.medianAdults).toBe(4);
    expect(result.recentWindow.medianSecondGenerationOrLater).toBe(12);
    expect(result.recentWindow.medianSecondGenerationOrLaterAdults).toBe(0);
    expect(result.livingAdultGenerationPassed).toBe(false);
    expect(result.status).toBe('non-persistent');
    expect(result.passed).toBe(false);
  });

  it('rejects a flat token remnant below the recent median floor', () => {
    const result = evaluateMission8AnimalTrajectory(inputFor(samplesWith(
      () => 2,
    )));

    expect(result.recentWindow.minimumPopulation).toBe(2);
    expect(result.recentWindow.medianPopulation).toBe(2);
    expect(result.recentWindow.fractionAtOrAbovePopulationFloor).toBe(0);
    expect(result.recentMedianPassed).toBe(false);
    expect(result.status).toBe('non-persistent');
    expect(result.passed).toBe(false);
  });

  it('allows a significant downswing when post-trough recruitment confirms recovery', () => {
    const recoveryEvents: Mission8TrajectoryEvent[] = [
      ...completeEvents('daphnia'),
      // Events at the absolute trough are not post-trough evidence.
      { time: 6_000, kind: 'death' },
      { time: 6_120, kind: 'birth' },
      { time: 6_180, kind: 'birth' },
      { time: 6_360, kind: 'matured' },
    ];
    const result = evaluateMission8AnimalTrajectory(inputFor(samplesWith(
      (time) => {
        if (time < END_SECONDS / 2) return 20;
        if (time <= 6_000) {
          return 30 - 24 * (
            (time - END_SECONDS / 2) /
            (6_000 - END_SECONDS / 2)
          );
        }
        return 6 + 12 * ((time - 6_000) / (END_SECONDS - 6_000));
      },
    ), { events: recoveryEvents }));

    expect(result.projectedCollapse).toBe(true);
    expect(result.confirmedRecovery).toBe(true);
    expect(result.recoveryOverrideApplied).toBe(true);
    expect(result.recoveryEvidence.troughTimeSeconds).toBe(6_000);
    expect(result.recoveryEvidence.observedAfterTroughSeconds).toBe(600);
    expect(result.recoveryEvidence.postTroughRecruitment.deaths).toBe(0);
    expect(result.status).toBe('recovering');
    expect(result.passed).toBe(true);
  });

  it('does not call a rebound recovered when its tail is falling again', () => {
    const events: Mission8TrajectoryEvent[] = [
      ...completeEvents('daphnia'),
      { time: 5_040, kind: 'birth' },
      { time: 5_100, kind: 'birth' },
      { time: 5_160, kind: 'matured' },
      { time: 5_220, kind: 'death' },
    ];
    const result = evaluateMission8AnimalTrajectory(inputFor(samplesWith(
      (time) => {
        if (time < 3_360) return 30;
        if (time <= 3_600) {
          return 5 + 25 * (
            (time - 3_360) /
            (3_600 - 3_360)
          );
        }
        if (time <= 5_400) return 30;
        return 30 - 21 * ((time - 5_400) / 1_200);
      },
      undefined,
      () => 20,
    ), { events }));

    expect(result.projectedCollapse).toBe(true);
    expect(result.recoveryEvidence.finalThreeMedianPopulation)
      .toBeGreaterThanOrEqual(7);
    expect(result.recoveryEvidence.tailSlopePerSecond).toBeLessThan(0);
    expect(result.confirmedRecovery).toBe(false);
    expect(result.status).toBe('terminal-collapse');
    expect(result.passed).toBe(false);
  });

  it('accepts a biomass rebound only with sustained recruitment evidence', () => {
    const troughSeconds = 4_800;
    const result = evaluateMission8AnimalTrajectory(inputFor(
      samplesWith(
        () => 20,
        undefined,
        (time) => {
          if (time <= END_SECONDS / 2) return 20;
          if (time <= troughSeconds) {
            return 20 - 18 * (
              (time - END_SECONDS / 2) /
              (troughSeconds - END_SECONDS / 2)
            );
          }
          return 2 + 14 * (
            (time - troughSeconds) /
            (END_SECONDS - troughSeconds)
          );
        },
      ),
      {
        events: [
          ...completeEvents('daphnia'),
          { time: 4_920, kind: 'birth' },
          { time: 5_160, kind: 'matured' },
        ],
      },
    ));

    expect(result.biomassRecoveryEvidence.troughTimeSeconds)
      .toBe(troughSeconds);
    expect(result.biomassRecoveryEvidence.observedAfterTroughSeconds)
      .toBe(END_SECONDS - troughSeconds);
    expect(result.biomassRecoveryEvidence.postTroughRecruitment)
      .toMatchObject({ births: 1, maturations: 1 });
    expect(result.biomassRecoveryConfirmed).toBe(true);
    expect(result.passed).toBe(true);
  });

  it('does not confirm a recovery observed for less than 240 seconds', () => {
    const result = evaluateMission8AnimalTrajectory(inputFor(
      samplesWith((time) => {
        if (time < 6_480) return 30;
        if (time === 6_480) return 4;
        return 20;
      }),
      {
        events: [
          ...completeEvents('daphnia'),
          { time: 6_540, kind: 'birth' },
          { time: 6_580, kind: 'matured' },
        ],
      },
    ));

    expect(result.recoveryEvidence.troughTimeSeconds).toBe(6_480);
    expect(result.recoveryEvidence.observedAfterTroughSeconds).toBe(120);
    expect(result.recoveryEvidence.postTroughRecruitment.births).toBe(1);
    expect(result.recoveryEvidence.postTroughRecruitment.maturations).toBe(1);
    expect(result.confirmedRecovery).toBe(false);
    expect(result.recoveryOverrideApplied).toBe(false);
  });

  it('records a 18,12,6,4,8,13,18 post-trough recovery', () => {
    const knots = [
      { time: 3_360, population: 18 },
      { time: 3_840, population: 12 },
      { time: 4_320, population: 6 },
      { time: 4_800, population: 4 },
      { time: 5_280, population: 8 },
      { time: 5_880, population: 13 },
      { time: 6_600, population: 18 },
    ];
    const populationAt = (time: number): number => {
      if (time <= knots[0]!.time) return knots[0]!.population;
      const rightIndex = knots.findIndex((knot) => knot.time >= time);
      const left = knots[rightIndex - 1]!;
      const right = knots[rightIndex]!;
      const progress = (time - left.time) / (right.time - left.time);
      return left.population +
        (right.population - left.population) * progress;
    };
    const speciesId = 'japanese-ricefish';
    const result = evaluateMission8AnimalTrajectory(inputFor(
      samplesWith(populationAt),
      {
        speciesId,
        events: [
          ...completeEvents(speciesId),
          { time: 4_920, kind: 'birth' },
          { time: 5_040, kind: 'hatched' },
          { time: 5_160, kind: 'matured' },
        ],
      },
    ));

    expect(knots.map((knot) => populationAt(knot.time)))
      .toEqual([18, 12, 6, 4, 8, 13, 18]);
    expect(result.confirmedRecovery).toBe(true);
    expect(result.recoveryEvidence.troughPopulation).toBe(4);
    expect(result.recoveryEvidence.troughTimeSeconds).toBe(4_800);
    expect(result.recoveryEvidence.postTroughRecruitment).toMatchObject({
      births: 1,
      hatches: 1,
      maturations: 1,
    });
    expect(result.status === 'recovering')
      .toBe(result.recoveryOverrideApplied);
    expect(result.passed).toBe(true);
  });

  it('fails closed when a strict run lacks full-window sample coverage', () => {
    const samples = samplesWith(() => 20).filter((sample) =>
      sample.time >= 600);
    const result = evaluateMission8AnimalTrajectory(inputFor(samples));

    expect(result.applicable).toBe(true);
    expect(result.status).toBe('insufficient');
    expect(result.fullWindow.coverageRatio).toBeLessThan(0.95);
    expect(result.passed).toBe(false);
  });

  it('fails closed when the recent half has a sampling gap', () => {
    const samples = samplesWith(() => 20).filter((sample) =>
      sample.time < 4_500 || sample.time > 4_860);
    const result = evaluateMission8AnimalTrajectory(inputFor(samples));

    expect(result.applicable).toBe(true);
    expect(result.status).toBe('insufficient');
    expect(result.fullWindow.coverageRatio).toBeGreaterThanOrEqual(0.95);
    expect(result.recentWindow.coverageRatio).toBeLessThan(0.95);
    expect(result.passed).toBe(false);
  });

  it('fails closed with only two boundary samples', () => {
    const samples = samplesWith(() => 20).filter((sample) =>
      sample.time === 0 || sample.time === END_SECONDS);
    const result = evaluateMission8AnimalTrajectory(inputFor(samples));

    expect(result.applicable).toBe(true);
    expect(result.fullWindow.samples).toBe(2);
    expect(result.status).toBe('insufficient');
    expect(result.passed).toBe(false);
  });

  it('rejects historical lineage turnover without recent living generation 2', () => {
    const result = evaluateMission8AnimalTrajectory(inputFor(samplesWith(
      () => 20,
      (time) => time === END_SECONDS ? 0 : 10,
    )));

    expect(result.recruitmentPassed).toBe(true);
    expect(result.recentWindow.medianSecondGenerationOrLater).toBe(10);
    expect(result.recentWindow.finalSecondGenerationOrLater).toBe(0);
    expect(result.livingGenerationPassed).toBe(false);
    expect(result.status).toBe('non-persistent');
    expect(result.passed).toBe(false);
  });

  it.each([
    {
      speciesId: 'cherry-shrimp' as const,
      population: 12,
      livingGeneration2: 2,
      required: 3,
    },
    {
      speciesId: 'daphnia' as const,
      population: 20,
      livingGeneration2: 9,
      required: 10,
    },
    {
      speciesId: 'japanese-ricefish' as const,
      population: 4,
      livingGeneration2: 1,
      required: 2,
    },
  ])(
    'rejects $speciesId below its living generation-2 cohort floor',
    ({ speciesId, population, livingGeneration2, required }) => {
      const result = evaluateMission8AnimalTrajectory(inputFor(samplesWith(
        () => population,
        () => livingGeneration2,
      ), { speciesId }));

      expect(result.livingGenerationFloor).toBe(required);
      expect(result.recentMedianPassed).toBe(true);
      expect(result.recruitmentPassed).toBe(true);
      expect(result.livingGenerationPassed).toBe(false);
      expect(result.status).toBe('non-persistent');
      expect(result.passed).toBe(false);
    },
  );

  it('requires births and maturations in both trajectory halves', () => {
    const events = completeEvents('daphnia').filter((event) =>
      !(event.kind === 'matured' && event.time < END_SECONDS / 2));
    const result = evaluateMission8AnimalTrajectory(inputFor(
      samplesWith(() => 20),
      { events },
    ));

    expect(result.olderHalfRecruitment.births).toBeGreaterThan(0);
    expect(result.olderHalfRecruitment.maturations).toBe(0);
    expect(result.recruitmentPassed).toBe(false);
    expect(result.passed).toBe(false);
  });

  it('requires ricefish hatches in both trajectory halves', () => {
    const speciesId = 'japanese-ricefish';
    const events = completeEvents(speciesId).filter((event) =>
      !(event.kind === 'hatched' && event.time > END_SECONDS / 2));
    const result = evaluateMission8AnimalTrajectory(inputFor(
      samplesWith(() => 4),
      { speciesId, events },
    ));

    expect(result.recentHalfRecruitment.births).toBeGreaterThan(0);
    expect(result.recentHalfRecruitment.hatches).toBe(0);
    expect(result.recruitmentPassed).toBe(false);
    expect(result.passed).toBe(false);
  });

  it.each([60, 1_200, 3_600])(
    'reports a %ss diagnostic duration as explicitly not applicable',
    (durationSeconds) => {
      const result = evaluateMission8AnimalTrajectory(inputFor(
        samplesWith(() => 20).filter((sample) =>
          sample.time <= durationSeconds),
        {
          requestedPostReleaseDurationSeconds: durationSeconds,
          endSeconds: durationSeconds,
        },
      ));

      expect(result.applicable).toBe(false);
      expect(result.status).toBe('not-applicable');
      expect(result.reason).toContain('requires at least 6600s');
      expect(result.passed).toBe(true);
    },
  );

  it('keeps real trend and recruitment diagnostics in a short no-op run', () => {
    const durationSeconds = 3_600;
    const result = evaluateMission8AnimalTrajectory(inputFor(
      samplesWith((time) =>
        40 - 35 * (time / durationSeconds),
      )
        .filter((sample) => sample.time <= durationSeconds),
      {
        requestedPostReleaseDurationSeconds: durationSeconds,
        endSeconds: durationSeconds,
        events: [
          { time: 120, kind: 'birth' },
          { time: 240, kind: 'matured' },
          { time: 1_200, kind: 'birth' },
          { time: 1_320, kind: 'matured' },
        ],
      },
    ));

    expect(result.applicable).toBe(false);
    expect(result.status).toBe('not-applicable');
    expect(result.passed).toBe(true);
    expect(result.recentWindow.trend.slopeUpper95).toBeLessThan(0);
    expect(result.projectedCollapse).toBe(true);
    expect(result.olderHalfRecruitment).toMatchObject({
      births: 1,
      maturations: 1,
    });
    expect(result.recentHalfRecruitment).toMatchObject({
      births: 1,
      maturations: 1,
    });
    expect(result.recruitmentPassed).toBe(true);
  });

  it('uses the actual final snapshot boundary after a batched target overshoot', () => {
    expect(resolveMission8TrajectoryEndSeconds(
      8_524,
      8_524,
      8_515,
    )).toBe(8_524);
  });

  it('cannot change its verdict when external mortality observations change', () => {
    const base = inputFor(samplesWith(() => 20));
    const evaluateWithObservation = (
      _observation: { starvation: number; oldAge: number },
    ) => ({
      trajectory: evaluateMission8AnimalTrajectory(base),
      observationLevel: 'info',
    });
    const starvationHeavy = evaluateWithObservation({
      starvation: 20,
      oldAge: 1,
    });
    const oldAgeHeavy = evaluateWithObservation({
      starvation: 1,
      oldAge: 20,
    });

    expect(starvationHeavy.observationLevel)
      .toBe(oldAgeHeavy.observationLevel);
    expect(starvationHeavy.trajectory).toEqual(oldAgeHeavy.trajectory);
  });

  it('still rejects a collapse when external deaths are old-age dominant', () => {
    const collapsing = inputFor(samplesWith(
      (time) => time <= END_SECONDS / 2
        ? 12 + 18 * (time / (END_SECONDS / 2))
        : 30 - 28 * ((time - END_SECONDS / 2) / (END_SECONDS / 2)),
    ));
    const mortalityObservation = { starvation: 1, oldAge: 40 };
    const result = evaluateMission8AnimalTrajectory(collapsing);

    expect(mortalityObservation.oldAge)
      .toBeGreaterThan(mortalityObservation.starvation);
    expect(result.projectedCollapse).toBe(true);
    expect(result.confirmedRecovery).toBe(false);
    expect(result.status).toBe('terminal-collapse');
    expect(result.passed).toBe(false);
  });
});
