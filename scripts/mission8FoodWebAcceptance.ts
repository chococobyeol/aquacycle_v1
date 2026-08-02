/**
 * Pure trajectory evaluation for the Mission 8 development verifier.
 *
 * This module does not define a player-facing mission completion condition.
 * It only decides whether a long development fixture contains enough sampled
 * evidence to call each required animal lineage persistent.
 */

export type Mission8TrajectorySpeciesId =
  | 'cherry-shrimp'
  | 'daphnia'
  | 'japanese-ricefish';

export type Mission8TrajectoryEventKind =
  | 'birth'
  | 'hatched'
  | 'matured'
  | 'death';

export interface Mission8TrajectoryPoint {
  time: number;
  total: number;
  adults: number;
  /** Living structural + stored + reproductive biomass for the species. */
  totalBiomass: number;
  secondGenerationOrLater: number;
  secondGenerationOrLaterAdults: number;
}

export interface Mission8TrajectoryEvent {
  time: number;
  kind: Mission8TrajectoryEventKind;
}

export interface Mission8TrajectoryInput {
  speciesId: Mission8TrajectorySpeciesId;
  requestedPostReleaseDurationSeconds: number;
  releaseSeconds: number;
  endSeconds: number;
  samples: readonly Mission8TrajectoryPoint[];
  events: readonly Mission8TrajectoryEvent[];
}

export interface LinearTrajectoryTrend {
  samples: number;
  slopePerSecond: number;
  slopeLower95: number;
  slopeUpper95: number;
  fittedAtEnd: number;
  projectedAfterSameDuration: number;
}

export interface Mission8RecruitmentSummary {
  births: number;
  hatches: number;
  maturations: number;
  deaths: number;
}

export interface Mission8RecoveryEvidence {
  troughTimeSeconds: number | null;
  troughPopulation: number | null;
  observedAfterTroughSeconds: number;
  finalThreeMedianPopulation: number;
  tailSlopePerSecond: number;
  postTroughRecruitment: Mission8RecruitmentSummary;
}

export interface Mission8BiomassRecoveryEvidence {
  troughTimeSeconds: number | null;
  troughBiomass: number | null;
  observedAfterTroughSeconds: number;
  finalThreeMedianBiomass: number;
  finalThreeMedianAdults: number;
  requiredBiomassGain: number;
  tailSlopePerSecond: number;
  postTroughRecruitment: Mission8RecruitmentSummary;
}

export type Mission8TrajectoryStatus =
  | 'not-applicable'
  | 'insufficient'
  | 'persistent'
  | 'recovering'
  | 'cyclic'
  | 'terminal-collapse'
  | 'non-persistent';

export interface Mission8TrajectoryResult {
  applicable: boolean;
  passed: boolean;
  status: Mission8TrajectoryStatus;
  reason: string;
  populationFloor: number;
  cohortStep: number;
  livingGenerationFloor: number;
  biomassReference: number;
  biomassFloor: number;
  fullWindow: {
    startsAtSeconds: number;
    endsAtSeconds: number;
    samples: number;
    coverageRatio: number;
    trend: LinearTrajectoryTrend;
    biomassTrend: LinearTrajectoryTrend;
    adultCountTrend: LinearTrajectoryTrend;
    adultFractionTrend: LinearTrajectoryTrend;
  };
  recentWindow: {
    startsAtSeconds: number;
    endsAtSeconds: number;
    samples: number;
    coverageRatio: number;
    minimumPopulation: number;
    medianPopulation: number;
    fractionAtOrAbovePopulationFloor: number;
    medianSecondGenerationOrLater: number;
    finalPopulation: number;
    finalSecondGenerationOrLater: number;
    medianSecondGenerationOrLaterAdults: number;
    finalSecondGenerationOrLaterAdults: number;
    minimumBiomass: number;
    medianBiomass: number;
    finalBiomass: number;
    biomassRetentionRatio: number;
    medianAdults: number;
    finalAdults: number;
    medianAdultFraction: number;
    finalAdultFraction: number;
    trend: LinearTrajectoryTrend;
    biomassTrend: LinearTrajectoryTrend;
    adultCountTrend: LinearTrajectoryTrend;
    adultFractionTrend: LinearTrajectoryTrend;
  };
  olderHalfRecruitment: Mission8RecruitmentSummary;
  recentHalfRecruitment: Mission8RecruitmentSummary;
  recruitmentPassed: boolean;
  livingGenerationPassed: boolean;
  livingAdultGenerationPassed: boolean;
  recentMedianPassed: boolean;
  recentBiomassMedianPassed: boolean;
  adultStagePassed: boolean;
  projectedCollapse: boolean;
  biomassProjectedCollapse: boolean;
  confirmedRecovery: boolean;
  biomassRecoveryConfirmed: boolean;
  recoveryOverrideApplied: boolean;
  biomassRecoveryOverrideApplied: boolean;
  recoveryEvidence: Mission8RecoveryEvidence;
  biomassRecoveryEvidence: Mission8BiomassRecoveryEvidence;
  directionChanges: number;
  biomassDirectionChanges: number;
  adultCountDirectionChanges: number;
}

export const MISSION8_TRAJECTORY_SAMPLE_SECONDS = 120;
export const MISSION8_TRAJECTORY_FULL_WINDOW_SECONDS = 6_600;
export const MISSION8_TRAJECTORY_RECENT_WINDOW_SECONDS = 3_300;
export const MISSION8_TRAJECTORY_MINIMUM_COVERAGE = 0.95;
export const MISSION8_TRAJECTORY_MINIMUM_FULL_SAMPLES = 20;
export const MISSION8_TRAJECTORY_MINIMUM_RECENT_SAMPLES = 10;
export const MISSION8_TRAJECTORY_RECOVERY_CONFIRMATION_SECONDS = 240;
// This is a relative, window-derived guard rather than a species mass target.
// It permits large cohort oscillations while rejecting a lineage whose count is
// being maintained by progressively smaller, depleted animals.
export const MISSION8_TRAJECTORY_MINIMUM_BIOMASS_RETENTION = 0.25;
export const MISSION8_TRAJECTORY_MINIMUM_BIOMASS_RECOVERY_GAIN = 0.10;
export const MISSION8_TRAJECTORY_MAXIMUM_SAMPLE_GAP_SECONDS =
  MISSION8_TRAJECTORY_SAMPLE_SECONDS * 1.5;

export const MISSION8_TRAJECTORY_POPULATION_FLOORS:
Record<Mission8TrajectorySpeciesId, number> = {
  'cherry-shrimp': 5,
  daphnia: 10,
  'japanese-ricefish': 2,
};

// Each step is one already-configured rendered cohort, not a new population
// constant invented by the verifier.
export const MISSION8_TRAJECTORY_COHORT_STEPS:
Record<Mission8TrajectorySpeciesId, number> = {
  'cherry-shrimp': 3,
  daphnia: 2,
  'japanese-ricefish': 2,
};

export const MISSION8_TRAJECTORY_LIVING_GENERATION_FLOORS:
Record<Mission8TrajectorySpeciesId, number> = {
  'cherry-shrimp': 3,
  daphnia: 10,
  'japanese-ricefish': 2,
};

/**
 * Keep the trajectory boundary on the state that was actually sampled.
 *
 * A batched verifier can finish a few simulated seconds after its requested
 * target. The final snapshot and final sample are still real observations and
 * must not be discarded merely because the requested target was crossed.
 */
export const resolveMission8TrajectoryEndSeconds = (
  finalSnapshotElapsedSeconds: number,
  finalSampleTimeSeconds: number | null,
  requestedTargetEndSeconds: number | null,
): number => Number.isFinite(finalSnapshotElapsedSeconds)
  ? finalSnapshotElapsedSeconds
  : finalSampleTimeSeconds !== null &&
      Number.isFinite(finalSampleTimeSeconds)
    ? finalSampleTimeSeconds
    : requestedTargetEndSeconds !== null &&
        Number.isFinite(requestedTargetEndSeconds)
      ? requestedTargetEndSeconds
      : 0;

const emptyRecruitment = (): Mission8RecruitmentSummary => ({
  births: 0,
  hatches: 0,
  maturations: 0,
  deaths: 0,
});

const mean = (values: readonly number[]): number =>
  values.reduce((total, value) => total + value, 0) /
  Math.max(1, values.length);

const median = (values: readonly number[]): number => {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[midpoint]!
    : (sorted[midpoint - 1]! + sorted[midpoint]!) / 2;
};

const adultFraction = (sample: Mission8TrajectoryPoint): number =>
  sample.total > 0
    ? Math.min(1, Math.max(0, sample.adults / sample.total))
    : 0;

const individualBiomass = (sample: Mission8TrajectoryPoint): number =>
  sample.total > 0
    ? sample.totalBiomass / sample.total
    : 0;

const metricTrend = (
  samples: readonly Mission8TrajectoryPoint[],
  value: (sample: Mission8TrajectoryPoint) => number,
): LinearTrajectoryTrend => summarizeLinearTrajectoryTrend(
  samples.map((sample) => ({ time: sample.time, value: value(sample) })),
);

export const summarizeLinearTrajectoryTrend = (
  series: ReadonlyArray<{ time: number; value: number }>,
): LinearTrajectoryTrend => {
  if (series.length < 3) {
    const value = series.at(-1)?.value ?? 0;
    return {
      samples: series.length,
      slopePerSecond: 0,
      slopeLower95: Number.NEGATIVE_INFINITY,
      slopeUpper95: Number.POSITIVE_INFINITY,
      fittedAtEnd: value,
      projectedAfterSameDuration: value,
    };
  }
  const meanTime = mean(series.map((sample) => sample.time));
  const meanValue = mean(series.map((sample) => sample.value));
  let timeVariance = 0;
  let covariance = 0;
  for (const sample of series) {
    const centeredTime = sample.time - meanTime;
    timeVariance += centeredTime * centeredTime;
    covariance += centeredTime * (sample.value - meanValue);
  }
  const slopePerSecond = timeVariance > 0
    ? covariance / timeVariance
    : 0;
  const intercept = meanValue - slopePerSecond * meanTime;
  let residualSquares = 0;
  for (const sample of series) {
    const residual =
      sample.value - (intercept + slopePerSecond * sample.time);
    residualSquares += residual * residual;
  }
  const slopeStandardError = timeVariance > 0
    ? Math.sqrt(
      residualSquares /
        Math.max(1, series.length - 2) /
        timeVariance,
    )
    : Number.POSITIVE_INFINITY;
  const confidenceWidth = 1.96 * slopeStandardError;
  const endTime = series.at(-1)!.time;
  const duration = Math.max(0, endTime - series[0]!.time);
  const fittedAtEnd = intercept + slopePerSecond * endTime;
  return {
    samples: series.length,
    slopePerSecond,
    slopeLower95: slopePerSecond - confidenceWidth,
    slopeUpper95: slopePerSecond + confidenceWidth,
    fittedAtEnd,
    projectedAfterSameDuration:
      fittedAtEnd + slopePerSecond * duration,
  };
};

const summarizeRecruitment = (
  events: readonly Mission8TrajectoryEvent[],
  startsAtSeconds: number,
  endsAtSeconds: number,
  includeEnd: boolean,
): Mission8RecruitmentSummary => {
  const summary = emptyRecruitment();
  for (const event of events) {
    if (
      event.time + 1e-6 < startsAtSeconds ||
      (includeEnd
        ? event.time - 1e-6 > endsAtSeconds
        : event.time + 1e-6 >= endsAtSeconds)
    ) continue;
    if (event.kind === 'birth') summary.births += 1;
    else if (event.kind === 'hatched') summary.hatches += 1;
    else if (event.kind === 'matured') summary.maturations += 1;
    else if (event.kind === 'death') summary.deaths += 1;
  }
  return summary;
};

const recruitmentComplete = (
  speciesId: Mission8TrajectorySpeciesId,
  summary: Mission8RecruitmentSummary,
): boolean =>
  summary.births > 0 &&
  summary.maturations > 0 &&
  (
    speciesId !== 'japanese-ricefish' ||
    summary.hatches > 0
  );

const summarizeTrajectoryRecruitment = (
  input: Mission8TrajectoryInput,
  fullStartsAtSeconds: number,
  recentStartsAtSeconds: number,
): {
  older: Mission8RecruitmentSummary;
  recent: Mission8RecruitmentSummary;
} => {
  const observedStartsAtSeconds = Math.max(
    input.releaseSeconds,
    fullStartsAtSeconds,
  );
  const splitSeconds = Math.max(
    observedStartsAtSeconds,
    Math.min(input.endSeconds, recentStartsAtSeconds),
  );
  return {
    older: summarizeRecruitment(
      input.events,
      observedStartsAtSeconds,
      splitSeconds,
      false,
    ),
    recent: summarizeRecruitment(
      input.events,
      splitSeconds,
      input.endSeconds,
      true,
    ),
  };
};

const sampleCoverage = (
  samples: readonly Mission8TrajectoryPoint[],
  startsAtSeconds: number,
  endsAtSeconds: number,
): number => samples.length < 2
  ? 0
  : Math.min(
    1,
    Math.max(
      0,
      1 - (
        Math.max(0, samples[0]!.time - startsAtSeconds) +
        Math.max(0, endsAtSeconds - samples.at(-1)!.time) +
        samples.slice(1).reduce(
          (missingSeconds, sample, index) =>
            missingSeconds + Math.max(
              0,
              sample.time - samples[index]!.time -
                MISSION8_TRAJECTORY_MAXIMUM_SAMPLE_GAP_SECONDS,
            ),
          0,
        )
      ) / Math.max(1, endsAtSeconds - startsAtSeconds),
    ),
  );

const countMetricDirectionChanges = (
  samples: readonly Mission8TrajectoryPoint[],
  value: (sample: Mission8TrajectoryPoint) => number,
): number => {
  const directions = samples.slice(1).map((sample, index) =>
    Math.sign(value(sample) - value(samples[index]!)))
    .filter((direction) => direction !== 0);
  return directions.slice(1).reduce(
    (changes, direction, index) =>
      changes + (direction !== directions[index] ? 1 : 0),
    0,
  );
};

const countDirectionChanges = (
  samples: readonly Mission8TrajectoryPoint[],
): number => countMetricDirectionChanges(samples, (sample) => sample.total);

const hasStrictTerminalDescent = (
  samples: readonly Mission8TrajectoryPoint[],
  value: (sample: Mission8TrajectoryPoint) => number,
): boolean => {
  const tail = samples.slice(-4);
  return tail.length === 4 &&
    tail.slice(1).every((sample, index) => {
      const previous = value(tail[index]!);
      const current = value(sample);
      const tolerance = Math.max(
        1e-12,
        Math.max(Math.abs(previous), Math.abs(current)) * 1e-9,
      );
      return current < previous - tolerance;
    });
};

const summarizeRecovery = (
  speciesId: Mission8TrajectorySpeciesId,
  recentSamples: readonly Mission8TrajectoryPoint[],
  events: readonly Mission8TrajectoryEvent[],
  populationFloor: number,
  cohortStep: number,
  endSeconds: number,
): {
  confirmed: boolean;
  evidence: Mission8RecoveryEvidence;
} => {
  if (recentSamples.length === 0) {
    return {
      confirmed: false,
      evidence: {
        troughTimeSeconds: null,
        troughPopulation: null,
        observedAfterTroughSeconds: 0,
        finalThreeMedianPopulation: Number.NaN,
        tailSlopePerSecond: Number.NaN,
        postTroughRecruitment: emptyRecruitment(),
      },
    };
  }
  const minimumPopulation = Math.min(
    ...recentSamples.map((sample) => sample.total),
  );
  let troughIndex = recentSamples.length - 1;
  while (
    troughIndex > 0 &&
    recentSamples[troughIndex]!.total !== minimumPopulation
  ) {
    troughIndex -= 1;
  }
  const trough = recentSamples[troughIndex]!;
  const final = recentSamples.at(-1)!;
  const finalThreeMedian = median(
    recentSamples.slice(-3).map((sample) => sample.total),
  );
  const postTroughRecruitment = summarizeRecruitment(
    events.filter((event) => event.time > trough.time + 1e-6),
    trough.time,
    endSeconds,
    true,
  );
  const recoveryWindow = recentSamples.slice(troughIndex);
  const recoveryTail = recoveryWindow.slice(-4);
  const recoveryTailTrend = metricTrend(
    recoveryTail,
    (sample) => sample.total,
  );
  const hasPriorCohortDecline = troughIndex === 0 ||
    Math.max(
      ...recentSamples
        .slice(0, troughIndex)
        .map((sample) => sample.total),
    ) - trough.total >= cohortStep;
  const evidence: Mission8RecoveryEvidence = {
    troughTimeSeconds: trough.time,
    troughPopulation: trough.total,
    observedAfterTroughSeconds: Math.max(0, final.time - trough.time),
    finalThreeMedianPopulation: finalThreeMedian,
    tailSlopePerSecond: recoveryTailTrend.slopePerSecond,
    postTroughRecruitment,
  };
  return {
    confirmed:
      recentSamples.length >= 4 &&
      troughIndex !== recentSamples.length - 1 &&
      evidence.observedAfterTroughSeconds >=
        MISSION8_TRAJECTORY_RECOVERY_CONFIRMATION_SECONDS &&
      hasPriorCohortDecline &&
      final.total >= populationFloor &&
      finalThreeMedian >= trough.total + cohortStep &&
      recoveryTail.length >= 3 &&
      recoveryTailTrend.slopePerSecond >= 0 &&
      postTroughRecruitment.births > postTroughRecruitment.deaths &&
      postTroughRecruitment.maturations > 0 &&
      (
        speciesId !== 'japanese-ricefish' ||
        postTroughRecruitment.hatches > 0
      ),
    evidence,
  };
};

const summarizeBiomassRecovery = (
  speciesId: Mission8TrajectorySpeciesId,
  recentSamples: readonly Mission8TrajectoryPoint[],
  events: readonly Mission8TrajectoryEvent[],
  biomassFloor: number,
  biomassReference: number,
  endSeconds: number,
): {
  confirmed: boolean;
  evidence: Mission8BiomassRecoveryEvidence;
} => {
  const requiredBiomassGain =
    biomassReference * MISSION8_TRAJECTORY_MINIMUM_BIOMASS_RECOVERY_GAIN;
  if (recentSamples.length === 0) {
    return {
      confirmed: false,
      evidence: {
        troughTimeSeconds: null,
        troughBiomass: null,
        observedAfterTroughSeconds: 0,
        finalThreeMedianBiomass: Number.NaN,
        finalThreeMedianAdults: Number.NaN,
        requiredBiomassGain,
        tailSlopePerSecond: Number.NaN,
        postTroughRecruitment: emptyRecruitment(),
      },
    };
  }
  const minimumBiomass = Math.min(
    ...recentSamples.map((sample) => sample.totalBiomass),
  );
  let troughIndex = recentSamples.length - 1;
  while (
    troughIndex > 0 &&
    recentSamples[troughIndex]!.totalBiomass !== minimumBiomass
  ) {
    troughIndex -= 1;
  }
  const trough = recentSamples[troughIndex]!;
  const final = recentSamples.at(-1)!;
  const finalThreeMedianBiomass = median(
    recentSamples.slice(-3).map((sample) => sample.totalBiomass),
  );
  const finalThreeMedianAdults = median(
    recentSamples.slice(-3).map((sample) => sample.adults),
  );
  const postTroughRecruitment = summarizeRecruitment(
    events.filter((event) => event.time > trough.time + 1e-6),
    trough.time,
    endSeconds,
    true,
  );
  const recoveryWindow = recentSamples.slice(troughIndex);
  const recoveryTrend = metricTrend(
    recoveryWindow,
    (sample) => sample.totalBiomass,
  );
  const recoveryTail = recoveryWindow.slice(-4);
  const recoveryTailTrend = metricTrend(
    recoveryTail,
    (sample) => sample.totalBiomass,
  );
  const hasPostTroughRecruitment =
    postTroughRecruitment.births > 0 &&
    postTroughRecruitment.maturations > 0 &&
    (
      speciesId !== 'japanese-ricefish' ||
      postTroughRecruitment.hatches > 0
    );
  const evidence: Mission8BiomassRecoveryEvidence = {
    troughTimeSeconds: trough.time,
    troughBiomass: trough.totalBiomass,
    observedAfterTroughSeconds: Math.max(0, final.time - trough.time),
    finalThreeMedianBiomass,
    finalThreeMedianAdults,
    requiredBiomassGain,
    tailSlopePerSecond: recoveryTailTrend.slopePerSecond,
    postTroughRecruitment,
  };
  return {
    confirmed:
      recoveryWindow.length >= 3 &&
      troughIndex !== recentSamples.length - 1 &&
      evidence.observedAfterTroughSeconds >=
        MISSION8_TRAJECTORY_RECOVERY_CONFIRMATION_SECONDS &&
      finalThreeMedianBiomass >= biomassFloor &&
      finalThreeMedianBiomass >=
        trough.totalBiomass + requiredBiomassGain &&
      recoveryTrend.slopePerSecond > 0 &&
      recoveryTail.length >= 3 &&
      recoveryTailTrend.slopePerSecond >= 0 &&
      finalThreeMedianAdults > 0 &&
      hasPostTroughRecruitment,
    evidence,
  };
};

const emptyResult = (
  input: Mission8TrajectoryInput,
  status: 'not-applicable' | 'insufficient',
  reason: string,
  applicable: boolean,
  fullStartsAtSeconds: number,
  recentStartsAtSeconds: number,
  fullSamples: readonly Mission8TrajectoryPoint[],
  recentSamples: readonly Mission8TrajectoryPoint[],
): Mission8TrajectoryResult => {
  const populationFloor =
    MISSION8_TRAJECTORY_POPULATION_FLOORS[input.speciesId];
  const cohortStep = MISSION8_TRAJECTORY_COHORT_STEPS[input.speciesId];
  const livingGenerationFloor =
    MISSION8_TRAJECTORY_LIVING_GENERATION_FLOORS[input.speciesId];
  const fullTrend = summarizeLinearTrajectoryTrend(
    fullSamples.map((sample) => ({ time: sample.time, value: sample.total })),
  );
  const recentTrend = summarizeLinearTrajectoryTrend(
    recentSamples.map((sample) => ({
      time: sample.time,
      value: sample.total,
    })),
  );
  const fullBiomassTrend = metricTrend(
    fullSamples,
    (sample) => sample.totalBiomass,
  );
  const recentBiomassTrend = metricTrend(
    recentSamples,
    (sample) => sample.totalBiomass,
  );
  const fullAdultCountTrend = metricTrend(
    fullSamples,
    (sample) => sample.adults,
  );
  const recentAdultCountTrend = metricTrend(
    recentSamples,
    (sample) => sample.adults,
  );
  const fullAdultFractionTrend = metricTrend(fullSamples, adultFraction);
  const recentAdultFractionTrend = metricTrend(recentSamples, adultFraction);
  const biomassReference = median(
    fullSamples.map((sample) => sample.totalBiomass),
  );
  const biomassFloor = Number.isFinite(biomassReference)
    ? Math.max(0, biomassReference) *
      MISSION8_TRAJECTORY_MINIMUM_BIOMASS_RETENTION
    : Number.NaN;
  const recentMinimum = recentSamples.length === 0
    ? Number.NaN
    : Math.min(...recentSamples.map((sample) => sample.total));
  const recentMedian = median(recentSamples.map((sample) => sample.total));
  const recentMinimumBiomass = recentSamples.length === 0
    ? Number.NaN
    : Math.min(...recentSamples.map((sample) => sample.totalBiomass));
  const recentMedianBiomass = median(
    recentSamples.map((sample) => sample.totalBiomass),
  );
  const recentMedianAdults = median(
    recentSamples.map((sample) => sample.adults),
  );
  const recentMedianAdultFraction = median(
    recentSamples.map(adultFraction),
  );
  const recentGenerationMedian = median(
    recentSamples.map((sample) => sample.secondGenerationOrLater),
  );
  const recentAdultGenerationMedian = median(
    recentSamples.map((sample) => sample.secondGenerationOrLaterAdults),
  );
  const final = recentSamples.at(-1);
  const recruitment = summarizeTrajectoryRecruitment(
    input,
    fullStartsAtSeconds,
    recentStartsAtSeconds,
  );
  const recruitmentPassed =
    recruitmentComplete(input.speciesId, recruitment.older) &&
    recruitmentComplete(input.speciesId, recruitment.recent);
  const livingGenerationPassed =
    Number.isFinite(recentGenerationMedian) &&
    recentGenerationMedian >= livingGenerationFloor &&
    (final?.secondGenerationOrLater ?? 0) >= livingGenerationFloor;
  const livingAdultGenerationPassed =
    Number.isFinite(recentAdultGenerationMedian) &&
    recentAdultGenerationMedian >= 1;
  const recentMedianPassed =
    Number.isFinite(recentMedian) &&
    recentMedian >= populationFloor;
  const recentBiomassMedianPassed =
    Number.isFinite(recentMedianBiomass) &&
    Number.isFinite(biomassFloor) &&
    recentMedianBiomass >= biomassFloor;
  const adultStagePassed =
    Number.isFinite(recentMedianAdults) &&
    recentMedianAdults >= 1;
  const projectedCollapse =
    recentTrend.slopeUpper95 < 0 &&
    recentTrend.projectedAfterSameDuration < populationFloor;
  const biomassProjectedCollapse =
    recentBiomassTrend.slopeUpper95 < 0 &&
    recentBiomassTrend.projectedAfterSameDuration < biomassFloor;
  const recovery = summarizeRecovery(
    input.speciesId,
    recentSamples,
    input.events,
    populationFloor,
    cohortStep,
    input.endSeconds,
  );
  const biomassRecovery = summarizeBiomassRecovery(
    input.speciesId,
    recentSamples,
    input.events,
    biomassFloor,
    biomassReference,
    input.endSeconds,
  );
  return {
    applicable,
    passed: !applicable,
    status,
    reason,
    populationFloor,
    cohortStep,
    livingGenerationFloor,
    biomassReference,
    biomassFloor,
    fullWindow: {
      startsAtSeconds: fullStartsAtSeconds,
      endsAtSeconds: input.endSeconds,
      samples: fullSamples.length,
      coverageRatio: sampleCoverage(
        fullSamples,
        fullStartsAtSeconds,
        input.endSeconds,
      ),
      trend: fullTrend,
      biomassTrend: fullBiomassTrend,
      adultCountTrend: fullAdultCountTrend,
      adultFractionTrend: fullAdultFractionTrend,
    },
    recentWindow: {
      startsAtSeconds: recentStartsAtSeconds,
      endsAtSeconds: input.endSeconds,
      samples: recentSamples.length,
      coverageRatio: sampleCoverage(
        recentSamples,
        recentStartsAtSeconds,
        input.endSeconds,
      ),
      minimumPopulation: recentMinimum,
      medianPopulation: recentMedian,
      fractionAtOrAbovePopulationFloor: recentSamples.length === 0
        ? Number.NaN
        : recentSamples.filter((sample) =>
          sample.total >= populationFloor).length / recentSamples.length,
      medianSecondGenerationOrLater: recentGenerationMedian,
      finalPopulation: final?.total ?? 0,
      finalSecondGenerationOrLater:
        final?.secondGenerationOrLater ?? 0,
      medianSecondGenerationOrLaterAdults: recentAdultGenerationMedian,
      finalSecondGenerationOrLaterAdults:
        final?.secondGenerationOrLaterAdults ?? 0,
      minimumBiomass: recentMinimumBiomass,
      medianBiomass: recentMedianBiomass,
      finalBiomass: final?.totalBiomass ?? 0,
      biomassRetentionRatio:
        biomassReference > 0
          ? recentMedianBiomass / biomassReference
          : Number.NaN,
      medianAdults: recentMedianAdults,
      finalAdults: final?.adults ?? 0,
      medianAdultFraction: recentMedianAdultFraction,
      finalAdultFraction: final ? adultFraction(final) : 0,
      trend: recentTrend,
      biomassTrend: recentBiomassTrend,
      adultCountTrend: recentAdultCountTrend,
      adultFractionTrend: recentAdultFractionTrend,
    },
    olderHalfRecruitment: recruitment.older,
    recentHalfRecruitment: recruitment.recent,
    recruitmentPassed,
    livingGenerationPassed,
    livingAdultGenerationPassed,
    recentMedianPassed,
    recentBiomassMedianPassed,
    adultStagePassed,
    projectedCollapse,
    biomassProjectedCollapse,
    confirmedRecovery: recovery.confirmed,
    biomassRecoveryConfirmed: biomassRecovery.confirmed,
    recoveryOverrideApplied: projectedCollapse && recovery.confirmed,
    biomassRecoveryOverrideApplied:
      (
        biomassProjectedCollapse ||
        !recentBiomassMedianPassed
      ) && biomassRecovery.confirmed,
    recoveryEvidence: recovery.evidence,
    biomassRecoveryEvidence: biomassRecovery.evidence,
    directionChanges: countDirectionChanges(fullSamples),
    biomassDirectionChanges: countMetricDirectionChanges(
      fullSamples,
      (sample) => sample.totalBiomass,
    ),
    adultCountDirectionChanges: countMetricDirectionChanges(
      fullSamples,
      (sample) => sample.adults,
    ),
  };
};

export const evaluateMission8AnimalTrajectory = (
  input: Mission8TrajectoryInput,
): Mission8TrajectoryResult => {
  const fullStartsAtSeconds =
    input.endSeconds - MISSION8_TRAJECTORY_FULL_WINDOW_SECONDS;
  const recentStartsAtSeconds =
    input.endSeconds - MISSION8_TRAJECTORY_RECENT_WINDOW_SECONDS;
  const postReleaseSamples = [...input.samples]
    .filter((sample) =>
      sample.time + 1e-6 >= input.releaseSeconds &&
      sample.time - 1e-6 <= input.endSeconds)
    .sort((left, right) => left.time - right.time);
  const fullSamples = postReleaseSamples.filter((sample) =>
    sample.time + 1e-6 >= fullStartsAtSeconds);
  const recentSamples = fullSamples.filter((sample) =>
    sample.time + 1e-6 >= recentStartsAtSeconds);

  if (
    input.requestedPostReleaseDurationSeconds <
      MISSION8_TRAJECTORY_FULL_WINDOW_SECONDS
  ) {
    return emptyResult(
      input,
      'not-applicable',
      `strict trajectory persistence requires at least ` +
        `${MISSION8_TRAJECTORY_FULL_WINDOW_SECONDS}s post-release; ` +
        `requested=${input.requestedPostReleaseDurationSeconds}s`,
      false,
      fullStartsAtSeconds,
      recentStartsAtSeconds,
      fullSamples,
      recentSamples,
    );
  }

  const samplesAreValid = fullSamples.every((sample) =>
    Number.isFinite(sample.total) &&
    sample.total >= 0 &&
    Number.isFinite(sample.adults) &&
    sample.adults >= 0 &&
    sample.adults <= sample.total &&
    Number.isFinite(sample.totalBiomass) &&
    sample.totalBiomass >= 0 &&
    Number.isFinite(sample.secondGenerationOrLater) &&
    sample.secondGenerationOrLater >= 0 &&
    sample.secondGenerationOrLater <= sample.total &&
    Number.isFinite(sample.secondGenerationOrLaterAdults) &&
    sample.secondGenerationOrLaterAdults >= 0 &&
    sample.secondGenerationOrLaterAdults <= sample.adults &&
    sample.secondGenerationOrLaterAdults <=
      sample.secondGenerationOrLater);
  if (!samplesAreValid) {
    return emptyResult(
      input,
      'insufficient',
      'trajectory samples contain invalid population, adult, or biomass values',
      true,
      fullStartsAtSeconds,
      recentStartsAtSeconds,
      fullSamples,
      recentSamples,
    );
  }

  const fullCoverage = sampleCoverage(
    fullSamples,
    fullStartsAtSeconds,
    input.endSeconds,
  );
  const recentCoverage = sampleCoverage(
    recentSamples,
    recentStartsAtSeconds,
    input.endSeconds,
  );
  if (
    fullCoverage < MISSION8_TRAJECTORY_MINIMUM_COVERAGE ||
    recentCoverage < MISSION8_TRAJECTORY_MINIMUM_COVERAGE ||
    fullSamples.length < MISSION8_TRAJECTORY_MINIMUM_FULL_SAMPLES ||
    recentSamples.length < MISSION8_TRAJECTORY_MINIMUM_RECENT_SAMPLES
  ) {
    return emptyResult(
      input,
      'insufficient',
      `trajectory coverage is insufficient: ` +
        `full=${(fullCoverage * 100).toFixed(1)}%/${fullSamples.length}, ` +
        `recent=${(recentCoverage * 100).toFixed(1)}%/${recentSamples.length}`,
      true,
      fullStartsAtSeconds,
      recentStartsAtSeconds,
      fullSamples,
      recentSamples,
    );
  }

  const populationFloor =
    MISSION8_TRAJECTORY_POPULATION_FLOORS[input.speciesId];
  const cohortStep = MISSION8_TRAJECTORY_COHORT_STEPS[input.speciesId];
  const livingGenerationFloor =
    MISSION8_TRAJECTORY_LIVING_GENERATION_FLOORS[input.speciesId];
  const fullTrend = summarizeLinearTrajectoryTrend(
    fullSamples.map((sample) => ({ time: sample.time, value: sample.total })),
  );
  const recentTrend = summarizeLinearTrajectoryTrend(
    recentSamples.map((sample) => ({
      time: sample.time,
      value: sample.total,
    })),
  );
  const fullBiomassTrend = metricTrend(
    fullSamples,
    (sample) => sample.totalBiomass,
  );
  const recentBiomassTrend = metricTrend(
    recentSamples,
    (sample) => sample.totalBiomass,
  );
  const recentIndividualBiomassTrend = metricTrend(
    recentSamples,
    individualBiomass,
  );
  const fullAdultCountTrend = metricTrend(
    fullSamples,
    (sample) => sample.adults,
  );
  const recentAdultCountTrend = metricTrend(
    recentSamples,
    (sample) => sample.adults,
  );
  const fullAdultFractionTrend = metricTrend(fullSamples, adultFraction);
  const recentAdultFractionTrend = metricTrend(recentSamples, adultFraction);
  const biomassReference = median(
    fullSamples.map((sample) => sample.totalBiomass),
  );
  const biomassFloor =
    biomassReference * MISSION8_TRAJECTORY_MINIMUM_BIOMASS_RETENTION;
  const individualBiomassReference = median(
    fullSamples
      .filter((sample) => sample.total > 0)
      .map(individualBiomass),
  );
  const individualBiomassFloor =
    individualBiomassReference *
    MISSION8_TRAJECTORY_MINIMUM_BIOMASS_RETENTION;
  const recentMinimum = Math.min(
    ...recentSamples.map((sample) => sample.total),
  );
  const recentMedian = median(recentSamples.map((sample) => sample.total));
  const recentMinimumBiomass = Math.min(
    ...recentSamples.map((sample) => sample.totalBiomass),
  );
  const recentMedianBiomass = median(
    recentSamples.map((sample) => sample.totalBiomass),
  );
  const recentMedianAdults = median(
    recentSamples.map((sample) => sample.adults),
  );
  const recentMedianAdultFraction = median(
    recentSamples.map(adultFraction),
  );
  const recentFractionAtOrAboveFloor =
    recentSamples.filter((sample) =>
      sample.total >= populationFloor).length / recentSamples.length;
  const recentGenerationMedian = median(
    recentSamples.map((sample) => sample.secondGenerationOrLater),
  );
  const recentAdultGenerationMedian = median(
    recentSamples.map((sample) => sample.secondGenerationOrLaterAdults),
  );
  const final = recentSamples.at(-1)!;
  const recruitment = summarizeTrajectoryRecruitment(
    input,
    fullStartsAtSeconds,
    recentStartsAtSeconds,
  );
  const olderHalfRecruitment = recruitment.older;
  const recentHalfRecruitment = recruitment.recent;
  const recruitmentPassed =
    recruitmentComplete(input.speciesId, olderHalfRecruitment) &&
    recruitmentComplete(input.speciesId, recentHalfRecruitment);
  const livingGenerationPassed =
    recentGenerationMedian >= livingGenerationFloor &&
    final.secondGenerationOrLater >= livingGenerationFloor;
  const livingAdultGenerationPassed =
    recentAdultGenerationMedian >= 1;
  const recentMedianPassed = recentMedian >= populationFloor;
  const recentBiomassMedianPassed =
    recentMedianBiomass >= biomassFloor &&
    recentMedianBiomass > 0;
  const adultStagePassed = recentMedianAdults >= 1;
  const projectedCollapse =
    recentTrend.slopeUpper95 < 0 &&
    recentTrend.projectedAfterSameDuration < populationFloor;
  const rawBiomassProjectedCollapse =
    recentBiomassTrend.slopeUpper95 < 0 &&
    recentBiomassTrend.projectedAfterSameDuration < biomassFloor;
  const individualBiomassProjectedCollapse =
    recentIndividualBiomassTrend.slopeUpper95 < 0 &&
    recentIndividualBiomassTrend.projectedAfterSameDuration <
      individualBiomassFloor;
  // Total biomass follows ordinary population waves and drops temporarily
  // when old adults are replaced by smaller, fully funded juveniles. Treat it
  // as condition collapse only if per-capita mass also projects below its own
  // relative floor. A recently recruiting cohort gets one further guard
  // against extrapolating straight through that stage transition, but only
  // while final per-capita mass remains at least half of its full-window
  // reference and the population projection stays above the species floor.
  const activeCohortSuccession =
    recruitmentComplete(input.speciesId, recentHalfRecruitment) &&
    recentMedianAdults >= 1 &&
    final.total >= populationFloor &&
    final.secondGenerationOrLater >= livingGenerationFloor &&
    recentTrend.projectedAfterSameDuration >= populationFloor &&
    individualBiomassReference > 0 &&
    individualBiomass(final) >= individualBiomassReference * 0.5;
  const biomassProjectedCollapse =
    rawBiomassProjectedCollapse &&
    individualBiomassProjectedCollapse &&
    !activeCohortSuccession;
  const recovery = summarizeRecovery(
    input.speciesId,
    recentSamples,
    input.events,
    populationFloor,
    cohortStep,
    input.endSeconds,
  );
  const biomassRecovery = summarizeBiomassRecovery(
    input.speciesId,
    recentSamples,
    input.events,
    biomassFloor,
    biomassReference,
    input.endSeconds,
  );
  const confirmedRecovery = recovery.confirmed;
  const biomassRecoveryConfirmed = biomassRecovery.confirmed;
  const recoveryOverrideApplied =
    projectedCollapse && confirmedRecovery;
  const biomassRecoveryOverrideApplied =
    (
      biomassProjectedCollapse ||
      !recentBiomassMedianPassed
    ) && biomassRecoveryConfirmed;
  const recentDirectionChanges = countDirectionChanges(recentSamples);
  const recentBiomassDirectionChanges = countMetricDirectionChanges(
    recentSamples,
    (sample) => sample.totalBiomass,
  );
  const terminalPopulationTailCollapse =
    final.total < populationFloor &&
    recentDirectionChanges < 2 &&
    hasStrictTerminalDescent(recentSamples, (sample) => sample.total) &&
    !confirmedRecovery;
  const terminalBiomassTailCollapse =
    final.totalBiomass < biomassFloor &&
    recentBiomassDirectionChanges < 2 &&
    hasStrictTerminalDescent(
      recentSamples,
      (sample) => sample.totalBiomass,
    ) &&
    !biomassRecoveryConfirmed;
  const terminalCollapse =
    final.total <= 0 ||
    final.totalBiomass <= 0 ||
    terminalPopulationTailCollapse ||
    terminalBiomassTailCollapse ||
    (projectedCollapse && !confirmedRecovery) ||
    (
      (
        biomassProjectedCollapse ||
        !recentBiomassMedianPassed
      ) &&
      !biomassRecoveryConfirmed
    );
  const directionChanges = countDirectionChanges(fullSamples);
  const biomassDirectionChanges = countMetricDirectionChanges(
    fullSamples,
    (sample) => sample.totalBiomass,
  );
  const adultCountDirectionChanges = countMetricDirectionChanges(
    fullSamples,
    (sample) => sample.adults,
  );
  const passed =
    !terminalCollapse &&
    recentMedianPassed &&
    adultStagePassed &&
    recruitmentPassed &&
    livingGenerationPassed &&
    livingAdultGenerationPassed;
  const status: Mission8TrajectoryStatus = terminalCollapse
    ? 'terminal-collapse'
    : !passed
      ? 'non-persistent'
      : recoveryOverrideApplied || biomassRecoveryOverrideApplied
        ? 'recovering'
        : directionChanges >= 2
          ? 'cyclic'
          : 'persistent';
  const reason = terminalCollapse
    ? final.total <= 0
      ? 'the final sampled population is extinct'
      : final.totalBiomass <= 0
        ? 'the final sampled conserved animal biomass is depleted'
        : terminalPopulationTailCollapse
          ? 'the terminal population samples descend below the floor without an observed bounded cycle or recovery'
          : terminalBiomassTailCollapse
            ? 'the terminal conserved-biomass samples descend below the floor without an observed bounded cycle or recovery'
            : projectedCollapse && !confirmedRecovery
              ? 'the recent decline is significant and projects below the population floor'
              : !recentBiomassMedianPassed
                ? 'the recent median conserved biomass fell below its window-relative floor without confirmed recovery'
                : 'the recent conserved biomass decline projects below its window-relative floor without confirmed recovery'
    : !recentMedianPassed
      ? 'the recent median population is below the persistence floor'
      : !adultStagePassed
        ? 'the adult life stage did not persist through the recent trajectory window'
        : !recruitmentPassed
        ? 'birth and maturation recruitment did not continue in both trajectory halves'
        : !livingGenerationPassed
          ? 'living generation-2-or-later animals did not persist through the recent window'
          : !livingAdultGenerationPassed
            ? 'generation-2-or-later adults did not persist through the recent trajectory window'
            : recoveryOverrideApplied || biomassRecoveryOverrideApplied
            ? 'post-trough population and conserved-biomass recovery evidence is confirmed'
            : directionChanges >= 2
              ? 'the bounded trajectory contains repeated direction changes'
              : 'the recent population and recruitment trajectory persists';

  return {
    applicable: true,
    passed,
    status,
    reason,
    populationFloor,
    cohortStep,
    livingGenerationFloor,
    biomassReference,
    biomassFloor,
    fullWindow: {
      startsAtSeconds: fullStartsAtSeconds,
      endsAtSeconds: input.endSeconds,
      samples: fullSamples.length,
      coverageRatio: fullCoverage,
      trend: fullTrend,
      biomassTrend: fullBiomassTrend,
      adultCountTrend: fullAdultCountTrend,
      adultFractionTrend: fullAdultFractionTrend,
    },
    recentWindow: {
      startsAtSeconds: recentStartsAtSeconds,
      endsAtSeconds: input.endSeconds,
      samples: recentSamples.length,
      coverageRatio: recentCoverage,
      minimumPopulation: recentMinimum,
      medianPopulation: recentMedian,
      fractionAtOrAbovePopulationFloor:
        recentFractionAtOrAboveFloor,
      medianSecondGenerationOrLater: recentGenerationMedian,
      finalPopulation: final.total,
      finalSecondGenerationOrLater: final.secondGenerationOrLater,
      medianSecondGenerationOrLaterAdults: recentAdultGenerationMedian,
      finalSecondGenerationOrLaterAdults:
        final.secondGenerationOrLaterAdults,
      minimumBiomass: recentMinimumBiomass,
      medianBiomass: recentMedianBiomass,
      finalBiomass: final.totalBiomass,
      biomassRetentionRatio:
        biomassReference > 0
          ? recentMedianBiomass / biomassReference
          : Number.NaN,
      medianAdults: recentMedianAdults,
      finalAdults: final.adults,
      medianAdultFraction: recentMedianAdultFraction,
      finalAdultFraction: adultFraction(final),
      trend: recentTrend,
      biomassTrend: recentBiomassTrend,
      adultCountTrend: recentAdultCountTrend,
      adultFractionTrend: recentAdultFractionTrend,
    },
    olderHalfRecruitment,
    recentHalfRecruitment,
    recruitmentPassed,
    livingGenerationPassed,
    livingAdultGenerationPassed,
    recentMedianPassed,
    recentBiomassMedianPassed,
    adultStagePassed,
    projectedCollapse,
    biomassProjectedCollapse,
    confirmedRecovery,
    biomassRecoveryConfirmed,
    recoveryOverrideApplied,
    biomassRecoveryOverrideApplied,
    recoveryEvidence: recovery.evidence,
    biomassRecoveryEvidence: biomassRecovery.evidence,
    directionChanges,
    biomassDirectionChanges,
    adultCountDirectionChanges,
  };
};
