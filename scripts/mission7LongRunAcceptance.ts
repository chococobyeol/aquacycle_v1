import type {
  AnimalDeathCause,
  AnimalPopulationEventKind,
  AnimalSpeciesId,
} from '../src/simulation/types';

export const MISSION7_LONG_RUN_ACCEPTANCE = {
  durationSeconds: 10_800,
  tailStartSeconds: 3_600,
  sampleSeconds: 120,
  daphnia: {
    // A single boundary sample at 19 versus 20 has no biological meaning.
    // Reject a true demographic bottleneck with a low tail floor, then require
    // the whole tail and final state to retain a prey reservoir measured in
    // tens rather than tuning life-history rates to one sampling edge.
    minimumCount: 15,
    minimumMeanCount: 30,
    minimumFinalCount: 20,
    // This is only a runaway diagnostic, never a gameplay population cap.
    // Hundreds of tiny zooplankton can be a healthy prey reservoir. Only an
    // approach toward the thousands in this small fixture indicates a likely
    // unbounded rise.
    maximumCount: 1_000,
    minimumTailBirths: 1,
    minimumTailMaturations: 1,
    minimumFinalDescendants: 1,
    minimumLivingGeneration: 2,
  },
  shrimp: {
    minimumCount: 4,
    minimumTailBirths: 1,
    minimumTailMaturations: 1,
    // One rendered brood contains three juveniles. A declining linear fit may
    // be overridden only after a complete cohort-sized rebound has persisted
    // for at least two 120-second census intervals.
    recoveryCohortStep: 3,
    recoveryConfirmationSeconds: 240,
  },
  phytoplankton: {
    minimumBiomass: 0.75,
    minimumSpan: 0.3,
    meaningfulStep: 0.02,
    minimumRecovery: 0.15,
  },
  vallisneria: {
    minimumTailRunners: 1,
    minimumFinalRunners: 1,
    minimumFinalBiomass: 0,
  },
  water: {
    minimumOxygen: 30,
    maximumToxicWaste: 6,
    maximumOrganicMatter: 18,
  },
} as const;

export interface LongRunPopulationEvent {
  speciesId: AnimalSpeciesId;
  kind: AnimalPopulationEventKind;
  cause: AnimalDeathCause | null;
  elapsedSeconds: number;
}

export interface SpeciesEventSummary {
  introduced: number;
  removed: number;
  births: number;
  hatches: number;
  maturations: number;
  deaths: number;
  deathsByCause: Record<AnimalDeathCause, number>;
}

const emptyDeathCauses = (): Record<AnimalDeathCause, number> => ({
  starvation: 0,
  'old-age': 0,
  hypoxia: 0,
  toxicity: 0,
  temperature: 0,
  predation: 0,
});

export const emptySpeciesEventSummary = (): SpeciesEventSummary => ({
  introduced: 0,
  removed: 0,
  births: 0,
  hatches: 0,
  maturations: 0,
  deaths: 0,
  deathsByCause: emptyDeathCauses(),
});

export const summarizePopulationEvents = (
  events: ReadonlyArray<LongRunPopulationEvent>,
  speciesId: AnimalSpeciesId,
): SpeciesEventSummary =>
  events.reduce<SpeciesEventSummary>((summary, event) => {
    if (event.speciesId !== speciesId) return summary;
    if (event.kind === 'introduced') summary.introduced += 1;
    if (event.kind === 'removed') summary.removed += 1;
    if (event.kind === 'birth') summary.births += 1;
    if (event.kind === 'hatched') summary.hatches += 1;
    if (event.kind === 'matured') summary.maturations += 1;
    if (event.kind === 'death') {
      summary.deaths += 1;
      if (event.cause) summary.deathsByCause[event.cause] += 1;
    }
    return summary;
  }, emptySpeciesEventSummary());

export const acuteWaterDeathCount = (
  summary: SpeciesEventSummary,
): number =>
  summary.deathsByCause.hypoxia +
  summary.deathsByCause.toxicity +
  summary.deathsByCause.temperature;

export interface TimedValue {
  time: number;
  value: number;
}

export interface LinearTailTrend {
  samples: number;
  slopePerSecond: number;
  slopeLower95: number;
  slopeUpper95: number;
  fittedAtEnd: number;
  projectedAfterSameDuration: number;
}

const mean = (values: readonly number[]): number =>
  values.reduce((total, value) => total + value, 0) /
  Math.max(1, values.length);

/**
 * Uses every sample in one observation window rather than comparing convenient
 * endpoints. The projection extends the fitted line by one more window of the
 * same duration; it is a verifier diagnostic and never changes the simulation.
 */
export const summarizeLinearTailTrend = (
  series: ReadonlyArray<TimedValue>,
): LinearTailTrend => {
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
  // The normal interval is stable with the verifier's 31-sample recent half.
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

export const recentHalf = <T>(values: readonly T[]): readonly T[] =>
  values.slice(Math.floor(values.length / 2));

export interface PostTroughRecoverySummary {
  troughTimeSeconds: number | null;
  troughPopulation: number | null;
  observedAfterTroughSeconds: number;
  finalPopulation: number;
  finalThreeMedianPopulation: number;
  postTroughRecruitment: SpeciesEventSummary;
  confirmed: boolean;
}

export interface PostTroughRecoveryOptions {
  populationFloor: number;
  cohortStep: number;
  confirmationSeconds: number;
}

const median = (values: readonly number[]): number => {
  if (values.length === 0) return Number.NaN;
  const ordered = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[midpoint - 1]! + ordered[midpoint]!) / 2
    : ordered[midpoint]!;
};

/**
 * Confirms that an apparent terminal decline has already turned into a real
 * cohort recovery.
 *
 * The last occurrence of the absolute recent minimum is used as the trough,
 * so an earlier, easier dip cannot lend recruitment evidence to a later
 * relapse. Mortality causes are deliberately ignored: only total births,
 * deaths and maturations after that trough can establish demographic
 * recovery.
 */
export const summarizePostTroughRecovery = (
  recentSeries: ReadonlyArray<TimedValue>,
  events: ReadonlyArray<LongRunPopulationEvent>,
  speciesId: AnimalSpeciesId,
  options: PostTroughRecoveryOptions,
): PostTroughRecoverySummary => {
  const samples = [...recentSeries].sort(
    (left, right) => left.time - right.time,
  );
  if (samples.length === 0) {
    return {
      troughTimeSeconds: null,
      troughPopulation: null,
      observedAfterTroughSeconds: 0,
      finalPopulation: 0,
      finalThreeMedianPopulation: Number.NaN,
      postTroughRecruitment: emptySpeciesEventSummary(),
      confirmed: false,
    };
  }

  const minimumPopulation = Math.min(
    ...samples.map((sample) => sample.value),
  );
  let troughIndex = samples.length - 1;
  while (
    troughIndex > 0 &&
    samples[troughIndex]!.value !== minimumPopulation
  ) {
    troughIndex -= 1;
  }
  const trough = samples[troughIndex]!;
  const final = samples.at(-1)!;
  const postTroughRecruitment = summarizePopulationEvents(
    events.filter(
      (event) =>
        event.elapsedSeconds > trough.time + 1e-6 &&
        event.elapsedSeconds <= final.time + 1e-6,
    ),
    speciesId,
  );
  const observedAfterTroughSeconds = Math.max(
    0,
    final.time - trough.time,
  );
  const finalThreeMedianPopulation = median(
    samples.slice(-3).map((sample) => sample.value),
  );

  return {
    troughTimeSeconds: trough.time,
    troughPopulation: trough.value,
    observedAfterTroughSeconds,
    finalPopulation: final.value,
    finalThreeMedianPopulation,
    postTroughRecruitment,
    confirmed:
      samples.length >= 4 &&
      troughIndex < samples.length - 1 &&
      observedAfterTroughSeconds >= options.confirmationSeconds &&
      final.value >= options.populationFloor &&
      finalThreeMedianPopulation >= trough.value + options.cohortStep &&
      postTroughRecruitment.births > postTroughRecruitment.deaths &&
      postTroughRecruitment.maturations > 0,
  };
};

/**
 * The recent half is independently long enough to contain several compressed
 * animal life cycles. A significant recent decline is therefore sufficient;
 * earlier growth remains useful context but must not veto a terminal decline.
 */
export const sustainedProjectedFloorBreach = (
  recent: LinearTailTrend,
  floor: number,
): boolean =>
  recent.slopeUpper95 < 0 &&
  recent.projectedAfterSameDuration < floor;

export const sustainedProjectedCeilingBreach = (
  recent: LinearTailTrend,
  ceiling: number,
): boolean =>
  recent.slopeLower95 > 0 &&
  recent.projectedAfterSameDuration > ceiling;

export interface OscillationSummary {
  minimum: number;
  maximum: number;
  span: number;
  rises: number;
  falls: number;
  directionChanges: number;
  largestRecoveryAfterTrough: number;
  largestDeclineBeforeTrough: number;
  hasDepletionAndRecovery: boolean;
}

/**
 * Distinguishes an actual resource trough followed by recovery from a
 * monotonic drift with tiny numerical noise. A valid trough needs both a
 * meaningful decline before it and a meaningful rise after it.
 */
export const analyzeRecoveryOscillation = (
  values: number[],
  meaningfulStep: number,
  minimumRecovery: number,
): OscillationSummary => {
  if (values.length === 0) {
    return {
      minimum: Number.NaN,
      maximum: Number.NaN,
      span: Number.NaN,
      rises: 0,
      falls: 0,
      directionChanges: 0,
      largestRecoveryAfterTrough: 0,
      largestDeclineBeforeTrough: 0,
      hasDepletionAndRecovery: false,
    };
  }

  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const directions = values.slice(1).map((value, index) => {
    const difference = value - values[index]!;
    if (difference > meaningfulStep) return 1;
    if (difference < -meaningfulStep) return -1;
    return 0;
  }).filter((direction) => direction !== 0);
  const directionChanges = directions.slice(1).reduce(
    (count, direction, index) =>
      count + (direction !== directions[index] ? 1 : 0),
    0,
  );

  let largestRecoveryAfterTrough = 0;
  let largestDeclineBeforeTrough = 0;
  let hasDepletionAndRecovery = false;
  let maximumBefore = values[0]!;
  const maximumAfter: number[] = new Array(values.length);
  let suffixMaximum = values.at(-1)!;
  for (let index = values.length - 1; index >= 0; index -= 1) {
    suffixMaximum = Math.max(suffixMaximum, values[index]!);
    maximumAfter[index] = suffixMaximum;
  }
  for (let index = 1; index < values.length - 1; index += 1) {
    const value = values[index]!;
    const decline = maximumBefore - value;
    const recovery = maximumAfter[index + 1]! - value;
    largestDeclineBeforeTrough = Math.max(
      largestDeclineBeforeTrough,
      decline,
    );
    largestRecoveryAfterTrough = Math.max(
      largestRecoveryAfterTrough,
      recovery,
    );
    if (
      decline >= minimumRecovery &&
      recovery >= minimumRecovery
    ) {
      hasDepletionAndRecovery = true;
    }
    maximumBefore = Math.max(maximumBefore, value);
  }

  return {
    minimum,
    maximum,
    span: maximum - minimum,
    rises: directions.filter((direction) => direction > 0).length,
    falls: directions.filter((direction) => direction < 0).length,
    directionChanges,
    largestRecoveryAfterTrough,
    largestDeclineBeforeTrough,
    hasDepletionAndRecovery,
  };
};
