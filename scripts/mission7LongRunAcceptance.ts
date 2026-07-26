import type {
  AnimalDeathCause,
  AnimalPopulationEventKind,
  AnimalSpeciesId,
} from '../src/simulation/types';

export const MISSION7_LONG_RUN_ACCEPTANCE = {
  durationSeconds: 7_200,
  tailStartSeconds: 3_600,
  sampleSeconds: 120,
  daphnia: {
    // Mission 7 verifies an independently renewing Daphnia lineage, not a
    // stockpile for a future fish mission. A trough of one living descendant
    // is valid if births and maturations continue; a higher arbitrary count
    // would turn population phase into a hidden mission answer.
    minimumCount: 1,
    // This is only a runaway diagnostic, never a gameplay population cap.
    // Hundreds of small zooplankton are expected; only an approach toward the
    // thousands within this two-hour fixture indicates unbounded growth.
    maximumCount: 1_000,
    minimumTailBirths: 1,
    minimumTailMaturations: 1,
    minimumFinalDescendants: 1,
    minimumLivingGeneration: 2,
  },
  shrimp: {
    minimumTailBirths: 1,
    minimumTailMaturations: 1,
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
  events: LongRunPopulationEvent[],
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
