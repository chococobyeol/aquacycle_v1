import {
  ricefishForagingAppetite,
  ricefishGutCapacityReferenceBiomass,
  ricefishMaximumDaphniaStructureForBodyLength,
  ricefishPreyDetectionRadiusForBodyLength,
  SimulationWorld,
  type RicefishForagingDiagnosticSnapshot,
} from '../src/simulation/SimulationWorld';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import {
  PLANKTON_ECOLOGY_RULES,
  RICEFISH_ECOLOGY_RULES,
  SCENARIOS,
  SHRIMP_ECOLOGY_RULES,
  STRUCTURES,
} from '../src/simulation/config';
import { CLOSED_MATERIAL_RELATIVE_TOLERANCE } from '../src/simulation/stoichiometry';
import {
  MISSION8_TRAJECTORY_FULL_WINDOW_SECONDS,
  MISSION8_TRAJECTORY_MINIMUM_BIOMASS_RECOVERY_GAIN,
  MISSION8_TRAJECTORY_MINIMUM_BIOMASS_RETENTION,
  MISSION8_TRAJECTORY_MINIMUM_COVERAGE,
  MISSION8_TRAJECTORY_RECENT_WINDOW_SECONDS,
  MISSION8_TRAJECTORY_SAMPLE_SECONDS,
  evaluateMission8AnimalTrajectory,
  resolveMission8TrajectoryEndSeconds,
  type Mission8TrajectoryEventKind,
  type Mission8TrajectoryResult,
} from './mission8FoodWebAcceptance';
import type {
  AnimalDeathCause,
  AnimalPopulationEventSnapshot,
  AnimalSnapshot,
  AnimalSpeciesId,
  MicrobeGuildId,
  PlanktonKind,
  SimulationSnapshot,
  SimulationSaveData,
  SpeciesId,
  StructureDefinitionId,
  SurfaceCellSnapshot,
  Vec2,
} from '../src/simulation/types';

/**
 * Mission 8 has no player-facing completion condition yet. This executable is
 * deliberately a development acceptance probe: it stocks every available
 * trophic guild in the long tank, records lineage turnover and predation, and
 * exits non-zero when the fixture cannot demonstrate a functioning food web.
 *
 * Smoke/intermediate/full examples:
 *   npx vite-node scripts/verifyMission8FoodWeb.ts --duration=600
 *   npx vite-node scripts/verifyMission8FoodWeb.ts --duration 1800
 *   MISSION8_VERIFY_DURATION_SECONDS=10800 npx vite-node scripts/verifyMission8FoodWeb.ts
 */

const commandLineNumber = (name: string): number | null => {
  const equalsArgument = process.argv.find((argument) =>
    argument.startsWith(`--${name}=`));
  if (equalsArgument) {
    const value = Number(equalsArgument.slice(`--${name}=`.length));
    return Number.isFinite(value) ? value : null;
  }
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0) {
    const value = Number(process.argv[index + 1]);
    return Number.isFinite(value) ? value : null;
  }
  return null;
};

const commandLineText = (name: string): string | null => {
  const equalsArgument = process.argv.find((argument) =>
    argument.startsWith(`--${name}=`));
  if (equalsArgument) {
    const value = equalsArgument.slice(`--${name}=`.length).trim();
    return value || null;
  }
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0) {
    const value = process.argv[index + 1]?.trim();
    return value || null;
  }
  return null;
};

const numericOption = (
  commandLineName: string,
  environmentName: string,
  fallback: number,
  minimum: number,
): number => {
  const commandLineValue = commandLineNumber(commandLineName);
  const value = commandLineValue ??
    Number(process.env[environmentName] ?? fallback);
  return Number.isFinite(value) ? Math.max(minimum, value) : fallback;
};

const booleanOption = (
  environmentName: string,
  fallback: boolean,
): boolean => {
  const raw = process.env[environmentName];
  if (raw === undefined) return fallback;
  return !['0', 'false', 'no', 'off'].includes(raw.trim().toLowerCase());
};

const DURATION_SECONDS = numericOption(
  'duration',
  'MISSION8_VERIFY_DURATION_SECONDS',
  10_800,
  60,
);
const SAMPLE_SECONDS = numericOption(
  'sample',
  'MISSION8_VERIFY_SAMPLE_SECONDS',
  MISSION8_TRAJECTORY_SAMPLE_SECONDS,
  10,
);
const REAL_TICK_SECONDS = numericOption(
  'real-tick',
  'MISSION8_VERIFY_REAL_TICK_SECONDS',
  0.1,
  0.01,
);
// Full snapshots are observational and do not affect ecology. Batching a few
// 0.1-second worker ticks between them keeps long verification practical while
// the 240-event ring remains far larger than the events produced in one batch.
const OBSERVATION_BATCH_TICKS = Math.floor(numericOption(
  'observation-batch',
  'MISSION8_VERIFY_OBSERVATION_BATCH_TICKS',
  4,
  1,
));
const MINIMUM_SAFE_OXYGEN = numericOption(
  'minimum-oxygen',
  'MISSION8_VERIFY_MINIMUM_OXYGEN',
  10,
  0,
);
const MAXIMUM_SAFE_TOXIC_WASTE = numericOption(
  'maximum-toxic-waste',
  'MISSION8_VERIFY_MAXIMUM_TOXIC_WASTE',
  20,
  0,
);
const MISSION8_SCENARIO = SCENARIOS['mission-8'];
const PHYTOPLANKTON_INOCULA = numericOption(
  'phytoplankton',
  'MISSION8_VERIFY_PHYTOPLANKTON_INOCULA',
  MISSION8_SCENARIO.planktonBudget.phytoplankton ?? 4,
  1,
);
const DAPHNIA_FOUNDERS = numericOption(
  'daphnia',
  'MISSION8_VERIFY_DAPHNIA_FOUNDERS',
  MISSION8_SCENARIO.planktonBudget.daphnia ?? 6,
  1,
);
const NITZSCHIA_SEEDS = numericOption(
  'nitzschia',
  'MISSION8_VERIFY_NITZSCHIA_SEEDS',
  MISSION8_SCENARIO.seedBudget.nitzschia ?? 0,
  0,
);
const OEDOGONIUM_SEEDS = numericOption(
  'oedogonium',
  'MISSION8_VERIFY_OEDOGONIUM_SEEDS',
  MISSION8_SCENARIO.seedBudget.oedogonium ?? 0,
  0,
);
const VALLISNERIA_SEEDS = numericOption(
  'vallisneria',
  'MISSION8_VERIFY_VALLISNERIA_SEEDS',
  MISSION8_SCENARIO.seedBudget.vallisneria ?? 0,
  0,
);
const DAPHNIA_ESTABLISHMENT_TIMEOUT_SECONDS = numericOption(
  'establishment-timeout',
  'MISSION8_VERIFY_ESTABLISHMENT_TIMEOUT_SECONDS',
  7_200,
  300,
);
// This is a development-fixture release point, not a player-facing mission
// gate. Six founders must create several generations and a genuinely
// distributed cohort before the two predators arrive; merely observing the
// first brood is not enough in a 2,400-pixel tank.
const DAPHNIA_ESTABLISHMENT_POPULATION = numericOption(
  'establishment-population',
  'MISSION8_VERIFY_ESTABLISHMENT_POPULATION',
  Math.max(120, Math.ceil(DAPHNIA_FOUNDERS * 20)),
  DAPHNIA_FOUNDERS + 1,
);
const DAPHNIA_ESTABLISHMENT_DESCENDANTS = numericOption(
  'establishment-descendants',
  'MISSION8_VERIFY_ESTABLISHMENT_DESCENDANTS',
  Math.max(114, Math.ceil(DAPHNIA_FOUNDERS * 19)),
  1,
);
const DAPHNIA_ESTABLISHMENT_ADULT_DESCENDANTS = numericOption(
  'establishment-adult-descendants',
  'MISSION8_VERIFY_ESTABLISHMENT_ADULT_DESCENDANTS',
  Math.max(30, DAPHNIA_FOUNDERS * 5),
  1,
);
const DAPHNIA_ESTABLISHMENT_HOLD_SECONDS = numericOption(
  'establishment-hold',
  'MISSION8_VERIFY_ESTABLISHMENT_HOLD_SECONDS',
  300,
  0,
);
const DAPHNIA_ESTABLISHMENT_HOLD_POPULATION = numericOption(
  'establishment-hold-population',
  'MISSION8_VERIFY_ESTABLISHMENT_HOLD_POPULATION',
  Math.max(96, Math.ceil(DAPHNIA_FOUNDERS * 16)),
  DAPHNIA_FOUNDERS + 1,
);
const DAPHNIA_ESTABLISHMENT_HOLD_DESCENDANTS = numericOption(
  'establishment-hold-descendants',
  'MISSION8_VERIFY_ESTABLISHMENT_HOLD_DESCENDANTS',
  Math.max(90, Math.ceil(DAPHNIA_FOUNDERS * 15)),
  1,
);
const DAPHNIA_ESTABLISHMENT_HOLD_ADULT_DESCENDANTS = numericOption(
  'establishment-hold-adult-descendants',
  'MISSION8_VERIFY_ESTABLISHMENT_HOLD_ADULT_DESCENDANTS',
  Math.max(24, DAPHNIA_FOUNDERS * 4),
  1,
);
const DAPHNIA_ESTABLISHMENT_RECENT_BIRTH_SECONDS = numericOption(
  'establishment-recent-birth',
  'MISSION8_VERIFY_ESTABLISHMENT_RECENT_BIRTH_SECONDS',
  180,
  1,
);
const RELEASE_RICEFISH = booleanOption(
  'MISSION8_VERIFY_RELEASE_RICEFISH',
  true,
);
const RICEFISH_RELEASE_COUNT = Math.floor(numericOption(
  'ricefish-count',
  'MISSION8_VERIFY_RICEFISH_COUNT',
  2,
  0,
));
const IMMORTAL_RICEFISH = numericOption(
  'immortal-ricefish',
  'MISSION8_VERIFY_IMMORTAL_RICEFISH',
  0,
  0,
) > 0;
const DISABLE_RICEFISH_REPRODUCTION = numericOption(
  'disable-ricefish-reproduction',
  'MISSION8_VERIFY_DISABLE_RICEFISH_REPRODUCTION',
  0,
  0,
) > 0;
const QUIET_OUTPUT = numericOption(
  'quiet',
  'MISSION8_VERIFY_QUIET',
  0,
  0,
) > 0;
const FIXTURE_ONLY = booleanOption(
  'MISSION8_VERIFY_FIXTURE_ONLY',
  false,
);
const SAVE_OUTPUT_PATH = commandLineText('save-output');
const REPORT_OUTPUT_PATH = commandLineText('report-output');
const FORAGING_DIAGNOSTICS_OUTPUT_PATH =
  commandLineText('foraging-diagnostics-output');
const RESUME_SAVE_PATH = commandLineText('resume') ??
  process.env.MISSION8_VERIFY_RESUME?.trim() ??
  null;
const DEFAULT_ESTABLISHED_PRESET_PATH = fileURLToPath(
  new URL('fixtures/mission8-established-prey.json', import.meta.url),
);
const ESTABLISHED_PRESET_PATH = commandLineText('preset') ??
  process.env.MISSION8_VERIFY_PRESET?.trim() ??
  DEFAULT_ESTABLISHED_PRESET_PATH;
const USE_ESTABLISHED_PRESET = booleanOption(
  'MISSION8_VERIFY_USE_PRESET',
  true,
);

// Match the user-provided reference aquarium: the six supplied Vallisneria
// begin as one right-side stand beyond the last upright shading stone.
const VALLISNERIA_BED_TARGET_MINIMUM_FRACTION = 0.68;
const VALLISNERIA_BED_TARGET_MAXIMUM_FRACTION = 0.96;
const VALLISNERIA_PLANTING_EDGE_FRACTION = 0.59;

type MutableDaphniaCalibrationRules = {
  phytoplanktonHalfSaturation: number;
  minimumFoodQualityForReproduction: number;
  highFoodBroodResponseThreshold: number;
  reproductionFoodResponseExponent: number;
  reproductionAllocationPerSecondIndividual: number;
  maximumBroodSize: number;
  minimumLifespanSeconds: number;
  maximumLifespanSeconds: number;
  predatorCueMinimumFoodQualityForReproduction: number;
  predatorCueHighFoodBroodResponseThreshold: number;
  predatorCueReproductionAllocationMultiplier: number;
  predatorCueMaximumBroodSize: number;
};

type MutableRicefishCalibrationRules = {
  gutEvacuationSeconds: number;
  subadultGutEvacuationSeconds: number;
  minimumLifespanSeconds: number;
  maximumLifespanSeconds: number;
  matingEnergy: number;
};

// Optional calibration overrides use the exact Mission 8 fixture without
// changing the shipped rule set. Normal package commands supply none.
const mutableDaphniaRules =
  PLANKTON_ECOLOGY_RULES.daphnia as unknown as MutableDaphniaCalibrationRules;
const mutableRicefishRules =
  RICEFISH_ECOLOGY_RULES as unknown as MutableRicefishCalibrationRules;
if (IMMORTAL_RICEFISH) {
  mutableRicefishRules.minimumLifespanSeconds = 1_000_000_000;
  mutableRicefishRules.maximumLifespanSeconds = 1_000_000_000;
}
if (DISABLE_RICEFISH_REPRODUCTION) {
  // This is an experiment-only gate. It prevents courtship and spawning
  // without changing feeding, maintenance, starvation or movement.
  mutableRicefishRules.matingEnergy = 2;
}
if (RICEFISH_RELEASE_COUNT >
  (MISSION8_SCENARIO.animalBudget['japanese-ricefish'] ?? 0)) {
  (
    MISSION8_SCENARIO.animalBudget as Record<AnimalSpeciesId, number | null>
  )['japanese-ricefish'] = RICEFISH_RELEASE_COUNT;
}
if (process.env.MISSION8_VERIFY_RICEFISH_GUT_EVACUATION_SECONDS) {
  mutableRicefishRules.gutEvacuationSeconds = Number(
    process.env.MISSION8_VERIFY_RICEFISH_GUT_EVACUATION_SECONDS,
  );
}
if (process.env.MISSION8_VERIFY_RICEFISH_SUBADULT_GUT_EVACUATION_SECONDS) {
  mutableRicefishRules.subadultGutEvacuationSeconds = Number(
    process.env.MISSION8_VERIFY_RICEFISH_SUBADULT_GUT_EVACUATION_SECONDS,
  );
}
if (process.env.MISSION8_VERIFY_DAPHNIA_PHYTOPLANKTON_HALF_SATURATION) {
  mutableDaphniaRules.phytoplanktonHalfSaturation = Number(
    process.env.MISSION8_VERIFY_DAPHNIA_PHYTOPLANKTON_HALF_SATURATION,
  );
}
if (process.env.MISSION8_VERIFY_DAPHNIA_REPRODUCTION_FOOD) {
  mutableDaphniaRules.minimumFoodQualityForReproduction = Number(
    process.env.MISSION8_VERIFY_DAPHNIA_REPRODUCTION_FOOD,
  );
}
if (process.env.MISSION8_VERIFY_DAPHNIA_HIGH_FOOD_BROOD) {
  mutableDaphniaRules.highFoodBroodResponseThreshold = Number(
    process.env.MISSION8_VERIFY_DAPHNIA_HIGH_FOOD_BROOD,
  );
}
if (process.env.MISSION8_VERIFY_DAPHNIA_REPRODUCTION_FOOD_EXPONENT) {
  mutableDaphniaRules.reproductionFoodResponseExponent = Number(
    process.env.MISSION8_VERIFY_DAPHNIA_REPRODUCTION_FOOD_EXPONENT,
  );
}
if (
  process.env
    .MISSION8_VERIFY_DAPHNIA_REPRODUCTION_ALLOCATION_PER_SECOND_INDIVIDUAL
) {
  mutableDaphniaRules.reproductionAllocationPerSecondIndividual = Number(
    process.env
      .MISSION8_VERIFY_DAPHNIA_REPRODUCTION_ALLOCATION_PER_SECOND_INDIVIDUAL,
  );
}
if (process.env.MISSION8_VERIFY_DAPHNIA_MAXIMUM_BROOD_SIZE) {
  mutableDaphniaRules.maximumBroodSize = Number(
    process.env.MISSION8_VERIFY_DAPHNIA_MAXIMUM_BROOD_SIZE,
  );
}
if (process.env.MISSION8_VERIFY_DAPHNIA_MINIMUM_LIFESPAN_SECONDS) {
  mutableDaphniaRules.minimumLifespanSeconds = Number(
    process.env.MISSION8_VERIFY_DAPHNIA_MINIMUM_LIFESPAN_SECONDS,
  );
}
if (process.env.MISSION8_VERIFY_DAPHNIA_MAXIMUM_LIFESPAN_SECONDS) {
  mutableDaphniaRules.maximumLifespanSeconds = Number(
    process.env.MISSION8_VERIFY_DAPHNIA_MAXIMUM_LIFESPAN_SECONDS,
  );
}
if (process.env.MISSION8_VERIFY_DAPHNIA_CUE_REPRODUCTION_FOOD) {
  mutableDaphniaRules.predatorCueMinimumFoodQualityForReproduction = Number(
    process.env.MISSION8_VERIFY_DAPHNIA_CUE_REPRODUCTION_FOOD,
  );
}
if (process.env.MISSION8_VERIFY_DAPHNIA_CUE_HIGH_FOOD_BROOD) {
  mutableDaphniaRules.predatorCueHighFoodBroodResponseThreshold = Number(
    process.env.MISSION8_VERIFY_DAPHNIA_CUE_HIGH_FOOD_BROOD,
  );
}
if (process.env.MISSION8_VERIFY_DAPHNIA_CUE_REPRODUCTION_ALLOCATION_MULTIPLIER) {
  mutableDaphniaRules.predatorCueReproductionAllocationMultiplier = Number(
    process.env
      .MISSION8_VERIFY_DAPHNIA_CUE_REPRODUCTION_ALLOCATION_MULTIPLIER,
  );
}
if (process.env.MISSION8_VERIFY_DAPHNIA_CUE_MAXIMUM_BROOD_SIZE) {
  mutableDaphniaRules.predatorCueMaximumBroodSize = Number(
    process.env.MISSION8_VERIFY_DAPHNIA_CUE_MAXIMUM_BROOD_SIZE,
  );
}

const animalSpecies: AnimalSpeciesId[] = [
  'cherry-shrimp',
  'daphnia',
  'japanese-ricefish',
];
const structureTypes: StructureDefinitionId[] = [
  'flat-stone',
  'round-stone',
  'tall-stone',
  'small-flat-stone',
  'small-wedge-stone',
];
// The fixed fixture follows the user's reference placement, which uses two
// small flat stones and no wedge. The wedge remains available to the player
// but is not manufactured solely to satisfy this authored-layout check.
const requiredFixtureStructureTypes: StructureDefinitionId[] = [
  'flat-stone',
  'round-stone',
  'tall-stone',
  'small-flat-stone',
];
const deathCauses: AnimalDeathCause[] = [
  'starvation',
  'old-age',
  'hypoxia',
  'toxicity',
  'temperature',
  'predation',
];

const rounded = (value: number, digits = 6): number =>
  Number(value.toFixed(digits));

const medianValue = (values: readonly number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[midpoint]!
    : (sorted[midpoint - 1]! + sorted[midpoint]!) / 2;
};

// Diagnostic mirrors of the shrimp's local target search. Keep these values
// aligned with SimulationWorld's edibleBiomass() weights and 64 px encounter
// radius; they only describe food that is physically near each animal and
// never feed back into target choice or ecology.
const SHRIMP_TELEMETRY_LOCAL_FOOD_RADIUS = 64;
const shrimpTelemetryContactPoint = (
  cell: SurfaceCellSnapshot,
  snapshot: SimulationSnapshot,
): Vec2 => ({
  x: Math.min(
    snapshot.tank.width - 18,
    Math.max(18, cell.x),
  ),
  y: Math.min(
    snapshot.tank.groundY - 16,
    Math.max(snapshot.tank.waterTop + 18, cell.y),
  ),
});
const shrimpTelemetryEdibleBiomass = (
  cell: SurfaceCellSnapshot,
): number =>
  Math.max(0, cell.biomass.nitzschia) +
  Math.max(0, cell.biomass.oedogonium) * 0.72 +
  Math.max(0, cell.biofilm.decomposer) * 0.45 +
  Math.max(0, cell.biofilm.nitrifier) * 0.22;

const placeStructure = (
  world: SimulationWorld,
  definitionId: StructureDefinitionId,
  point: Vec2,
): void => {
  world.handle({ type: 'pick-structure', definitionId, point });
  world.handle({ type: 'drop-held', point });
  const snapshot = world.snapshot();
  if (snapshot.holding) {
    world.handle({ type: 'cancel-held' });
    throw new Error(
      `structure placement failed: ${definitionId} at ${point.x},${point.y}`,
    );
  }
};

const placeSeed = (
  world: SimulationWorld,
  speciesId: SpeciesId,
  cell: SurfaceCellSnapshot,
): void => {
  const before = world.snapshot().seeds.length;
  world.handle({ type: 'pick-seed', speciesId, point: cell });
  world.handle({ type: 'drop-held', point: cell });
  const snapshot = world.snapshot();
  if (snapshot.holding || snapshot.seeds.length !== before + 1) {
    world.handle({ type: 'cancel-held' });
    throw new Error(
      `producer placement failed: ${speciesId} at cell ${cell.id}`,
    );
  }
};

const placeAnimal = (
  world: SimulationWorld,
  speciesId: Exclude<AnimalSpeciesId, 'daphnia'>,
  point: Vec2,
): void => {
  const before = world.snapshot().animals.length;
  world.handle({ type: 'pick-animal', speciesId, point });
  world.handle({ type: 'drop-held', point });
  const snapshot = world.snapshot();
  if (snapshot.holding || snapshot.animals.length !== before + 1) {
    world.handle({ type: 'cancel-held' });
    throw new Error(
      `animal placement failed: ${speciesId} at ${point.x},${point.y}`,
    );
  }
};

const RICEFISH_RELEASE_FRACTIONS = [
  0.43,
  0.57,
  0.35,
  0.65,
  0.27,
  0.73,
  0.19,
  0.81,
  0.50,
  0.12,
  0.88,
] as const;

const ricefishReleasePoint = (
  index: number,
  tank: SimulationSnapshot['tank'],
): Vec2 => {
  const fraction = RICEFISH_RELEASE_FRACTIONS[index] ??
    0.1 + (
      (index * 0.6180339887498949) % 1
    ) * 0.8;
  return {
    x: tank.width * fraction,
    y: 290 + (index % 4) * 40,
  };
};

const placePlankton = (
  world: SimulationWorld,
  planktonKind: PlanktonKind,
  point: Vec2,
): void => {
  const beforeAnimals = world.snapshot().animals.length;
  const beforePhytoplankton =
    world.snapshot().biogeochemistry.plankton.phytoplanktonBiomass;
  world.handle({ type: 'pick-plankton', planktonKind, point });
  world.handle({ type: 'drop-held', point });
  const snapshot = world.snapshot();
  const placed = planktonKind === 'daphnia'
    ? snapshot.animals.length === beforeAnimals + 1
    : snapshot.biogeochemistry.plankton.phytoplanktonBiomass >
      beforePhytoplankton;
  if (snapshot.holding || !placed) {
    world.handle({ type: 'cancel-held' });
    throw new Error(
      `plankton placement failed: ${planktonKind} at ${point.x},${point.y}`,
    );
  }
};

const placeBiofilm = (
  world: SimulationWorld,
  guildId: MicrobeGuildId,
  cell: SurfaceCellSnapshot,
): void => {
  const before = world.snapshot().biogeochemistry.biofilmTotals[guildId];
  world.handle({ type: 'pick-biofilm', guildId, point: cell });
  world.handle({ type: 'drop-held', point: cell });
  const snapshot = world.snapshot();
  if (
    snapshot.holding ||
    snapshot.biogeochemistry.biofilmTotals[guildId] <= before
  ) {
    world.handle({ type: 'cancel-held' });
    throw new Error(
      `biofilm placement failed: ${guildId} at cell ${cell.id}`,
    );
  }
};

const settleStructures = (world: SimulationWorld): void => {
  let stableFrames = 0;
  for (let frame = 0; frame < 1_800 && stableFrames < 30; frame += 1) {
    world.tick(1 / 60);
    if (world.snapshot().allSettled) stableFrames += 1;
    else stableFrames = 0;
  }
  if (!world.snapshot().allSettled) {
    throw new Error('representative rock placement did not settle');
  }
};

const unusedNearestCell = (
  cells: SurfaceCellSnapshot[],
  target: Vec2,
  used: Set<string>,
  predicate: (cell: SurfaceCellSnapshot) => boolean,
): SurfaceCellSnapshot => {
  const candidate = cells
    .filter((cell) => !used.has(cell.id) && predicate(cell))
    .sort((left, right) =>
      Math.hypot(left.x - target.x, left.y - target.y) -
      Math.hypot(right.x - target.x, right.y - target.y))[0];
  if (!candidate) throw new Error('fixture ran out of eligible surface cells');
  used.add(candidate.id);
  return candidate;
};

const evenlySpacedFractions = (
  count: number,
  minimum = 0.08,
  maximum = 0.92,
): number[] => Array.from(
  { length: count },
  (_, index) => minimum +
    (maximum - minimum) * ((index + 1) / (count + 1)),
);

interface FixtureSummary {
  vallisneriaInitialRootXs: number[];
  tank: {
    id: string;
    width: number;
    height: number;
    waterColumns: number;
    waterRows: number;
  };
  structures: Record<string, number>;
  seeds: Record<string, number>;
  initialAnimals: Record<AnimalSpeciesId, number>;
  phytoplanktonBiomass: number;
  biofilm: Record<MicrobeGuildId, number>;
  refugeGapCount: number;
  structurePlacements: Array<{
    definitionId: StructureDefinitionId;
    x: number;
    y: number;
  }>;
  vallisneriaPlantingBeds: Array<{
    id: string;
    minimumX: number;
    maximumX: number;
    width: number;
    tankFraction: number;
    initialRootXs: number[];
    initialRootsOutside: number;
    leftBoundary: {
      kind: 'structure';
      structureId: string;
      definitionId: StructureDefinitionId;
      rightmostX: number;
      gapToBed: number;
    };
    rightBoundary: {
      kind: 'tank-wall';
      x: number;
    };
  }>;
}

type VallisneriaPlantingBed = FixtureSummary['vallisneriaPlantingBeds'][number];

const structureRightmostX = (
  structure: SimulationSnapshot['structures'][number],
): number => {
  const polygon = STRUCTURES[structure.definitionId].collisionPolygon;
  const cosine = Math.cos(structure.angle);
  const sine = Math.sin(structure.angle);
  return Math.max(...polygon.map((point) =>
    structure.x + point.x * cosine - point.y * sine));
};

const vallisneriaPlantingBedForX = (
  x: number,
  beds: readonly VallisneriaPlantingBed[],
): VallisneriaPlantingBed | null =>
  beds.find((bed) => x >= bed.minimumX && x <= bed.maximumX) ?? null;

const vallisneriaEscapeDistance = (
  x: number,
  beds: readonly VallisneriaPlantingBed[],
): number => {
  if (beds.length === 0) return 0;
  if (vallisneriaPlantingBedForX(x, beds)) return 0;
  return Math.min(...beds.map((bed) =>
    x < bed.minimumX ? bed.minimumX - x : x - bed.maximumX));
};

const stockMission8Fixture = (world: SimulationWorld): FixtureSummary => {
  const width = world.snapshot().tank.width;
  const rockPlacements: Array<[StructureDefinitionId, number, number]> = [
    // Reproduce the user's reference screenshot from left to right. The
    // stones remain ordinary light occluders and refuge geometry; none is a
    // physical Vallisneria-runner wall.
    ['flat-stone', width * 0.018, 360],
    ['tall-stone', width * 0.145, 310],
    ['tall-stone', width * 0.255, 310],
    ['small-flat-stone', width * 0.34, 560],
    ['small-flat-stone', width * 0.39, 560],
    ['round-stone', width * 0.515, 350],
    ['tall-stone', width * VALLISNERIA_PLANTING_EDGE_FRACTION, 310],
  ];
  for (const [definitionId, x, y] of rockPlacements) {
    placeStructure(world, definitionId, { x, y });
  }
  settleStructures(world);

  // The player-facing debug overlay is intentionally laboratory-only. The
  // development gate reads the same derived gaps directly so Mission 8 does
  // not need to expose a hidden challenge-mode UI command.
  const spatialInternals = world as unknown as {
    refugeGaps: unknown[];
    rebuildRefugeGaps(): void;
  };
  spatialInternals.rebuildRefugeGaps();
  const refugeGapCount = spatialInternals.refugeGaps.length;
  const settled = world.snapshot();
  const cells = settled.cells;
  const substrate = cells
    .filter((cell) => cell.surfaceKind === 'substrate')
    .sort((left, right) => left.x - right.x);
  const structureFaces = cells
    .filter((cell) => cell.surfaceKind === 'structure-face')
    .sort((left, right) => left.x - right.x);
  if (substrate.length < 12 || structureFaces.length < 8) {
    throw new Error(
      `fixture needs substrate and rock cells, got ${substrate.length}/${structureFaces.length}`,
    );
  }

  const used = new Set<string>();
  const plantingEdgeStructure = settled.structures
    .filter((structure) => structure.definitionId === 'tall-stone')
    .sort((left, right) =>
      Math.abs(left.x - width * VALLISNERIA_PLANTING_EDGE_FRACTION) -
      Math.abs(right.x - width * VALLISNERIA_PLANTING_EDGE_FRACTION))[0];
  if (!plantingEdgeStructure) {
    throw new Error('fixture needs the Vallisneria-bed shading marker stone');
  }
  const boundaryRightmostX = structureRightmostX(plantingEdgeStructure);
  const vallisneriaPlantingBed: VallisneriaPlantingBed = {
    id: 'right-side-vallisneria-bed',
    minimumX: boundaryRightmostX,
    maximumX: width,
    width: width - boundaryRightmostX,
    tankFraction: (width - boundaryRightmostX) / width,
    initialRootXs: [],
    initialRootsOutside: 0,
    leftBoundary: {
      kind: 'structure',
      structureId: plantingEdgeStructure.id,
      definitionId: plantingEdgeStructure.definitionId,
      rightmostX: boundaryRightmostX,
      gapToBed: 0,
    },
    rightBoundary: {
      kind: 'tank-wall',
      x: width,
    },
  };
  const vallisneriaCount = VALLISNERIA_SEEDS;
  const vallisneriaFractions = evenlySpacedFractions(
    vallisneriaCount,
    VALLISNERIA_BED_TARGET_MINIMUM_FRACTION,
    VALLISNERIA_BED_TARGET_MAXIMUM_FRACTION,
  );
  for (const fraction of vallisneriaFractions) {
    const target = { x: width * fraction, y: settled.tank.groundY };
    placeSeed(
      world,
      'vallisneria',
      unusedNearestCell(
        substrate,
        target,
        used,
        (cell) => cell.surfaceKind === 'substrate',
      ),
    );
  }
  const plantedSnapshot = world.snapshot();
  const vallisneriaInitialRootXs = plantedSnapshot.plants
    .filter((plant) => plant.origin === 'supplied')
    .map((plant) => plant.x)
    .sort((left, right) => left - right);
  vallisneriaPlantingBed.initialRootXs = vallisneriaInitialRootXs;
  vallisneriaPlantingBed.initialRootsOutside =
    vallisneriaPlantingBed.initialRootXs.filter((x) =>
      !vallisneriaPlantingBedForX(x, [vallisneriaPlantingBed])).length;
  for (const [speciesId, count, offset] of [
    ['nitzschia', NITZSCHIA_SEEDS, 0],
    ['oedogonium', OEDOGONIUM_SEEDS, 0.018],
  ] as const) {
    for (const [index, baseFraction] of
      evenlySpacedFractions(count, 0.10, 0.90).entries()) {
      const pool = index % 2 === 0 ? substrate : structureFaces;
      placeSeed(
        world,
        speciesId,
        unusedNearestCell(
          pool,
          {
            x: width * Math.min(
              0.94,
              Math.max(0.06, baseFraction + offset),
            ),
            y: settled.tank.groundY - 60,
          },
          used,
          () => true,
        ),
      );
    }
  }

  const biofilmTargets = [
    ['decomposer', 0.24, structureFaces],
    ['decomposer', 0.55, substrate],
    ['nitrifier', 0.51, structureFaces],
    ['nitrifier', 0.75, substrate],
  ] as const;
  for (const [guildId, fraction, pool] of biofilmTargets) {
    placeBiofilm(
      world,
      guildId,
      unusedNearestCell(
        [...pool],
        { x: width * fraction, y: settled.tank.groundY - 40 },
        used,
        () => true,
      ),
    );
  }

  for (let index = 0; index < PHYTOPLANKTON_INOCULA; index += 1) {
    const fraction = (index + 1) / (PHYTOPLANKTON_INOCULA + 1);
    placePlankton(world, 'phytoplankton', {
      x: width * fraction,
      y: 250 + (index % 2) * 140,
    });
  }
  for (let index = 0; index < DAPHNIA_FOUNDERS; index += 1) {
    const column = index % Math.min(12, DAPHNIA_FOUNDERS);
    const row = Math.floor(index / Math.min(12, DAPHNIA_FOUNDERS));
    placePlankton(world, 'daphnia', {
      x: width * (0.12 + column * 0.069),
      y: 220 + ((index + row) % 5) * 82,
    });
  }
  const shrimpCount =
    MISSION8_SCENARIO.animalBudget['cherry-shrimp'] ?? 0;
  for (let index = 0; index < shrimpCount; index += 1) {
    placeAnimal(world, 'cherry-shrimp', {
      x: width * ((index + 1) / (shrimpCount + 1)),
      y: settled.tank.groundY - 36,
    });
  }
  const snapshot = world.snapshot();
  const structureCounts = Object.fromEntries(
    structureTypes.map((definitionId) => [
      definitionId,
      snapshot.structures.filter((structure) =>
        structure.definitionId === definitionId).length,
    ]),
  );
  const seedCounts = Object.fromEntries(
    (['nitzschia', 'oedogonium', 'vallisneria'] as SpeciesId[]).map(
      (speciesId) => [
        speciesId,
        snapshot.seeds.filter((seed) => seed.speciesId === speciesId).length,
      ],
    ),
  );
  const initialAnimals = Object.fromEntries(
    animalSpecies.map((speciesId) => [
      speciesId,
      snapshot.animals.filter((animal) =>
        animal.speciesId === speciesId).length,
    ]),
  ) as Record<AnimalSpeciesId, number>;
  return {
    vallisneriaInitialRootXs,
    tank: {
      id: snapshot.tank.id,
      width: snapshot.tank.width,
      height: snapshot.tank.height,
      waterColumns: snapshot.tank.waterColumns,
      waterRows: snapshot.tank.waterRows,
    },
    structures: structureCounts,
    seeds: seedCounts,
    initialAnimals,
    phytoplanktonBiomass:
      snapshot.biogeochemistry.plankton.phytoplanktonBiomass,
    biofilm: {
      decomposer: snapshot.biogeochemistry.biofilmTotals.decomposer,
      nitrifier: snapshot.biogeochemistry.biofilmTotals.nitrifier,
    },
    refugeGapCount,
    structurePlacements: snapshot.structures
      .map((structure) => ({
        definitionId: structure.definitionId,
        x: structure.x,
        y: structure.y,
      }))
      .sort((left, right) => left.x - right.x),
    vallisneriaPlantingBeds: [vallisneriaPlantingBed],
  };
};

interface EventSummary {
  introduced: number;
  births: number;
  hatches: number;
  maturations: number;
  deaths: number;
  deathsByCause: Record<AnimalDeathCause, number>;
}

const emptyEventSummary = (): EventSummary => ({
  introduced: 0,
  births: 0,
  hatches: 0,
  maturations: 0,
  deaths: 0,
  deathsByCause: Object.fromEntries(
    deathCauses.map((cause) => [cause, 0]),
  ) as Record<AnimalDeathCause, number>,
});

const summarizeEvents = (
  events: AnimalPopulationEventSnapshot[],
  speciesId: AnimalSpeciesId,
): EventSummary => {
  const result = emptyEventSummary();
  for (const event of events) {
    if (event.speciesId !== speciesId) continue;
    if (event.kind === 'introduced') result.introduced += 1;
    else if (event.kind === 'birth') result.births += 1;
    else if (event.kind === 'hatched') result.hatches += 1;
    else if (event.kind === 'matured') result.maturations += 1;
    else if (event.kind === 'death') {
      result.deaths += 1;
      if (event.cause) result.deathsByCause[event.cause] += 1;
    }
  }
  return result;
};

const subtractEventSummary = (
  after: EventSummary,
  before: EventSummary,
): EventSummary => ({
  introduced: after.introduced - before.introduced,
  births: after.births - before.births,
  hatches: after.hatches - before.hatches,
  maturations: after.maturations - before.maturations,
  deaths: after.deaths - before.deaths,
  deathsByCause: Object.fromEntries(
    deathCauses.map((cause) => [
      cause,
      after.deathsByCause[cause] - before.deathsByCause[cause],
    ]),
  ) as Record<AnimalDeathCause, number>,
});

interface PopulationSummary {
  total: number;
  eggs: number;
  fry: number;
  juveniles: number;
  adults: number;
  founders: number;
  descendants: number;
  secondGenerationOrLater: number;
  secondGenerationOrLaterAdults: number;
  maximumLivingGeneration: number;
  maximumObservedGeneration: number;
}

interface LineageTracker {
  animalGeneration: Map<string, number>;
  maximumAnimalGeneration: Record<AnimalSpeciesId, number>;
  plantGeneration: Map<string, number>;
  maximumPlantGeneration: number;
  runnerBirths: number;
  plantingBeds: readonly VallisneriaPlantingBed[];
  escapedRunnerBirths: number;
  maximumRunnerEscapeDistance: number;
}

const createLineageTracker = (
  snapshot: SimulationSnapshot,
  plantingBeds: readonly VallisneriaPlantingBed[],
): LineageTracker => {
  const animalGeneration = new Map<string, number>();
  for (const animal of snapshot.animals) {
    animalGeneration.set(animal.id, animal.generation ?? 0);
  }
  const plantGeneration = new Map<string, number>();
  for (const plant of snapshot.plants) plantGeneration.set(plant.id, 0);
  return {
    animalGeneration,
    maximumAnimalGeneration: {
      'cherry-shrimp': 0,
      daphnia: 0,
      'japanese-ricefish': 0,
    },
    plantGeneration,
    maximumPlantGeneration: 0,
    runnerBirths: 0,
    plantingBeds,
    escapedRunnerBirths: 0,
    maximumRunnerEscapeDistance: 0,
  };
};

const observePlants = (
  tracker: LineageTracker,
  snapshot: SimulationSnapshot,
): void => {
  let changed = true;
  while (changed) {
    changed = false;
    for (const plant of snapshot.plants) {
      if (tracker.plantGeneration.has(plant.id)) continue;
      const generation = plant.origin === 'supplied'
        ? 0
        : plant.parentId && tracker.plantGeneration.has(plant.parentId)
          ? (tracker.plantGeneration.get(plant.parentId) ?? 0) + 1
          : 1;
      tracker.plantGeneration.set(plant.id, generation);
      tracker.maximumPlantGeneration = Math.max(
        tracker.maximumPlantGeneration,
        generation,
      );
      if (plant.origin === 'runner') {
        tracker.runnerBirths += 1;
        const escapeDistance = vallisneriaEscapeDistance(
          plant.x,
          tracker.plantingBeds,
        );
        if (escapeDistance > 0) tracker.escapedRunnerBirths += 1;
        tracker.maximumRunnerEscapeDistance = Math.max(
          tracker.maximumRunnerEscapeDistance,
          escapeDistance,
        );
      }
      changed = true;
    }
  }
};

const observeAnimals = (
  tracker: LineageTracker,
  snapshot: SimulationSnapshot,
): void => {
  for (const animal of snapshot.animals) {
    const inherited = animal.parentId
      ? (tracker.animalGeneration.get(animal.parentId) ?? 0) + 1
      : 0;
    // The snapshot generation field is authoritative only for Daphnia.
    // Compatibility snapshots expose zero for the other species, including
    // born shrimp and ricefish, so preferring it would relabel every living
    // descendant as a founder after each sample.
    const generation = animal.speciesId === 'daphnia'
      ? animal.generation ??
        tracker.animalGeneration.get(animal.id) ??
        inherited
      : tracker.animalGeneration.get(animal.id) ?? inherited;
    tracker.animalGeneration.set(animal.id, generation);
    tracker.maximumAnimalGeneration[animal.speciesId] = Math.max(
      tracker.maximumAnimalGeneration[animal.speciesId],
      generation,
    );
  }
  observePlants(tracker, snapshot);
};

const observeBirthEvent = (
  tracker: LineageTracker,
  event: AnimalPopulationEventSnapshot,
): void => {
  if (event.kind !== 'birth') return;
  const generation = event.parentId
    ? (tracker.animalGeneration.get(event.parentId) ?? 0) + 1
    : 1;
  tracker.animalGeneration.set(event.animalId, generation);
  tracker.maximumAnimalGeneration[event.speciesId] = Math.max(
    tracker.maximumAnimalGeneration[event.speciesId],
    generation,
  );
};

const populationSummary = (
  snapshot: SimulationSnapshot,
  speciesId: AnimalSpeciesId,
  tracker: LineageTracker,
): PopulationSummary => {
  const living = snapshot.animals.filter((animal) =>
    animal.speciesId === speciesId);
  const generations = living.map((animal) =>
    animal.speciesId === 'daphnia'
      ? animal.generation ??
        tracker.animalGeneration.get(animal.id) ??
        0
      : tracker.animalGeneration.get(animal.id) ?? 0);
  return {
    total: living.length,
    eggs: living.filter((animal) => animal.lifeStage === 'egg').length,
    fry: living.filter((animal) => animal.lifeStage === 'fry').length,
    juveniles: living.filter((animal) =>
      animal.lifeStage === 'juvenile').length,
    adults: living.filter((animal) => animal.lifeStage === 'adult').length,
    founders: generations.filter((generation) => generation === 0).length,
    descendants: generations.filter((generation) => generation >= 1).length,
    secondGenerationOrLater:
      generations.filter((generation) => generation >= 2).length,
    secondGenerationOrLaterAdults:
      living.filter((animal, index) =>
        generations[index]! >= 2 &&
        animal.lifeStage === 'adult').length,
    maximumLivingGeneration: Math.max(0, ...generations),
    maximumObservedGeneration:
      tracker.maximumAnimalGeneration[speciesId],
  };
};

interface FishFoodTracker {
  priorConsumption: Map<string, number>;
  totals: Map<string, number>;
  totalObservedIncrease: number;
}

const createFishFoodTracker = (
  animals: AnimalSnapshot[],
): FishFoodTracker => ({
  priorConsumption: new Map(
    animals
      .filter((animal) => animal.speciesId === 'japanese-ricefish')
      .map((animal) => [animal.id, animal.consumedBiomass]),
  ),
  totals: new Map<string, number>(),
  totalObservedIncrease: 0,
});

const observeFishFood = (
  tracker: FishFoodTracker,
  animals: AnimalSnapshot[],
): void => {
  for (const fish of animals) {
    if (fish.speciesId !== 'japanese-ricefish') continue;
    const prior = tracker.priorConsumption.get(fish.id) ?? 0;
    const increase = Math.max(0, fish.consumedBiomass - prior);
    if (increase > 1e-12) {
      const label = fish.recentFood ?? '미분류';
      tracker.totals.set(label, (tracker.totals.get(label) ?? 0) + increase);
      tracker.totalObservedIncrease += increase;
    }
    tracker.priorConsumption.set(fish.id, fish.consumedBiomass);
  }
};

const foodTotals = (tracker: FishFoodTracker): Record<string, number> =>
  Object.fromEntries(
    [...tracker.totals.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([label, value]) => [label, rounded(value)]),
  );

interface WaterExtremes {
  allFiniteAndNonNegative: boolean;
  minimumOxygen: number;
  maximumToxicWaste: number;
  maximumOrganicMatter: number;
  maximumNitrogenDrift: number;
  maximumCarbonDrift: number;
  maximumOxygenEquivalentDrift: number;
}

const createWaterExtremes = (): WaterExtremes => ({
  allFiniteAndNonNegative: true,
  minimumOxygen: Number.POSITIVE_INFINITY,
  maximumToxicWaste: 0,
  maximumOrganicMatter: 0,
  maximumNitrogenDrift: 0,
  maximumCarbonDrift: 0,
  maximumOxygenEquivalentDrift: 0,
});

const observeWater = (
  extremes: WaterExtremes,
  snapshot: SimulationSnapshot,
): void => {
  const average = snapshot.biogeochemistry.average;
  const carbon =
    snapshot.biogeochemistry.carbonCycle.dissolvedInorganicCarbon;
  const values = [
    average.oxygen,
    average.toxicWaste,
    average.organicMatter,
    average.nutrients,
    carbon,
    snapshot.waterTemperature,
  ];
  if (values.some((value) => !Number.isFinite(value) || value < 0)) {
    extremes.allFiniteAndNonNegative = false;
  }
  extremes.minimumOxygen = Math.min(
    extremes.minimumOxygen,
    average.oxygen,
  );
  extremes.maximumToxicWaste = Math.max(
    extremes.maximumToxicWaste,
    average.toxicWaste,
  );
  extremes.maximumOrganicMatter = Math.max(
    extremes.maximumOrganicMatter,
    average.organicMatter,
  );
  const balance = snapshot.biogeochemistry.materialBalance;
  extremes.maximumNitrogenDrift = Math.max(
    extremes.maximumNitrogenDrift,
    Math.abs(balance.nitrogenDriftRatio),
  );
  extremes.maximumCarbonDrift = Math.max(
    extremes.maximumCarbonDrift,
    Math.abs(balance.carbonDriftRatio),
  );
  extremes.maximumOxygenEquivalentDrift = Math.max(
    extremes.maximumOxygenEquivalentDrift,
    Math.abs(balance.oxygenEquivalentDriftRatio),
  );
};

interface VerificationSample {
  time: number;
  population: Record<AnimalSpeciesId, PopulationSummary>;
  animalBiomass: Record<AnimalSpeciesId, {
    structural: number;
    stored: number;
    reproductive: number;
    total: number;
    adultTotal: number;
    adultCount: number;
    adultFraction: number;
  }>;
  events: Record<AnimalSpeciesId, EventSummary>;
  vallisneria: {
    supplied: number;
    runners: number;
    runnerBirths: number;
    plantingBedContainmentApplicable: boolean;
    livingInsidePlantingBeds: number;
    livingOutsidePlantingBeds: number;
    livingRunnersOutsidePlantingBeds: number;
    escapedRunnerBirths: number;
    maximumRunnerEscapeDistance: number;
    minimumLivingRootX: number | null;
    maximumLivingRootX: number | null;
    secondGenerationOrLater: number;
    maximumLivingGeneration: number;
    maximumObservedGeneration: number;
  };
  producers: {
    phytoplankton: number;
    nitzschia: number;
    oedogonium: number;
    vallisneria: number;
  };
  microbes: {
    decomposer: number;
    nitrifier: number;
    planktonicDecomposer: number;
  };
  daphniaCondition: {
    juveniles: number;
    adults: number;
    gestatingAdults: number;
    broodReadyAdults: number;
    fundedOffspringEquivalent: number;
    medianAdultAgeSeconds: number | null;
    medianAdultRemainingLifespanSeconds: number | null;
    medianAdultEnergy: number | null;
    medianAdultStoredBiomass: number | null;
    medianJuvenileAgeSeconds: number | null;
  };
  ricefishFood: Record<string, number>;
  shrimpCondition?: Array<{
    id: string;
    generation: number;
    sex: string;
    lifeStage: string;
    behavior: string;
    x: number;
    y: number;
    structuralBiomass: number;
    storedBiomass: number;
    reproductiveBiomass: number;
    recentIntake: number;
    secondsSinceFood: number;
    energy: number;
    targetCellId: string | null;
    targetDistance: number | null;
    targetEdibleBiomass: number | null;
    localEdibleBiomassSum: number;
    localEdibleBiomassMaximum: number;
    localEdibleCellCount: number;
  }>;
  ricefishCondition: Array<{
    id: string;
    generation: number;
    lifeStage: string;
    sex: string;
    behavior: string;
    ageSeconds: number;
    bodyLength: number;
    x: number;
    y: number;
    velocityX: number;
    velocityY: number;
    facing: number;
    patchOriginX: number | null;
    patchOriginY: number | null;
    localLight: number;
    nearestDaphniaDistance: number | null;
    detectionRadius: number;
    secondsSinceFood: number;
    behaviorTimer: number;
    nextTargetEvaluation: number;
    targetAnimalId: string | null;
    strikeRecoveryUses: number;
    targetSpeciesId: string | null;
    targetLifeStage: string | null;
    targetDistance: number | null;
    targetStructuralBiomass: number | null;
    targetTotalBiomass: number | null;
    physicallyEdibleDaphniaInRadius: number;
    physicallyEdibleDaphniaBiomassSum: number;
    physicallyEdibleDaphniaBiomassMaximum: number;
    energy: number;
    structuralBiomass: number;
    storedBiomass: number;
    reproductiveBiomass: number;
    recentIntake: number;
    gutCapacityReferenceBiomass: number;
    foragingAppetite: number;
    consumedBiomass: number;
    reproductionCooldown: number;
    gestationRemaining: number | null;
  }>;
  daphniaDistribution: {
    phase: string | null;
    meanY: number | null;
    medianY: number | null;
    meanDepthFraction: number | null;
    meanCanopyShelter: number | null;
    fractionInCanopy: number | null;
    fractionInDenseCanopy: number | null;
  };
  water: {
    oxygen: number;
    toxicWaste: number;
    organicMatter: number;
    nutrients: number;
    dissolvedInorganicCarbon: number;
    temperature: number;
    nitrogenDriftRatio: number;
    carbonDriftRatio: number;
    oxygenEquivalentDriftRatio: number;
  };
}

const sampleVerification = (
  world: SimulationWorld,
  snapshot: SimulationSnapshot,
  tracker: LineageTracker,
  events: AnimalPopulationEventSnapshot[],
  fishFood: FishFoodTracker,
): VerificationSample => {
  const populations = Object.fromEntries(
    animalSpecies.map((speciesId) => [
      speciesId,
      populationSummary(snapshot, speciesId, tracker),
    ]),
  ) as Record<AnimalSpeciesId, PopulationSummary>;
  const eventSummaries = Object.fromEntries(
    animalSpecies.map((speciesId) => [
      speciesId,
      summarizeEvents(events, speciesId),
    ]),
  ) as Record<AnimalSpeciesId, EventSummary>;
  const livingPlantGenerations = snapshot.plants.map((plant) =>
    tracker.plantGeneration.get(plant.id) ?? 0);
  const plantingBedContainmentApplicable = tracker.plantingBeds.length > 0;
  const plantsOutsidePlantingBeds = !plantingBedContainmentApplicable
    ? []
    : snapshot.plants.filter((plant) =>
      !vallisneriaPlantingBedForX(plant.x, tracker.plantingBeds));
  const livingRootXs = snapshot.plants.map((plant) => plant.x);
  const average = snapshot.biogeochemistry.average;
  const balance = snapshot.biogeochemistry.materialBalance;
  const savedAnimals = world.exportSaveData().animals;
  const savedShrimp = savedAnimals.filter(
    (animal) => animal.speciesId === 'cherry-shrimp',
  );
  const savedRicefish = savedAnimals.filter(
    (animal) => animal.speciesId === 'japanese-ricefish',
  );
  const savedDaphnia = savedAnimals.filter(
    (animal) => animal.speciesId === 'daphnia',
  );
  const adultDaphnia = savedDaphnia.filter(
    (animal) => animal.lifeStage === 'adult',
  );
  const juvenileDaphnia = savedDaphnia.filter(
    (animal) => animal.lifeStage === 'juvenile',
  );
  const roundedMedian = (
    values: readonly number[],
    digits = 6,
  ): number | null => {
    const value = medianValue(values);
    return value === null ? null : rounded(value, digits);
  };
  const savedAnimalById = new Map(
    savedAnimals.map((animal) => [animal.id, animal] as const),
  );
  const animalBiomass = Object.fromEntries(
    animalSpecies.map((speciesId) => {
      const living = savedAnimals.filter((animal) =>
        animal.speciesId === speciesId);
      const structural = living.reduce(
        (total, animal) => total + animal.structuralBiomass,
        0,
      );
      const stored = living.reduce(
        (total, animal) => total + animal.storedBiomass,
        0,
      );
      const reproductive = living.reduce(
        (total, animal) => total + (animal.reproductiveBiomass ?? 0),
        0,
      );
      const adultAnimals = living.filter((animal) =>
        animal.lifeStage === 'adult');
      const adultTotal = adultAnimals.reduce(
        (total, animal) =>
          total +
          animal.structuralBiomass +
          animal.storedBiomass +
          (animal.reproductiveBiomass ?? 0),
        0,
      );
      return [speciesId, {
        structural: rounded(structural, 9),
        stored: rounded(stored, 9),
        reproductive: rounded(reproductive, 9),
        total: rounded(structural + stored + reproductive, 9),
        adultTotal: rounded(adultTotal, 9),
        adultCount: adultAnimals.length,
        adultFraction:
          living.length > 0
            ? rounded(adultAnimals.length / living.length, 6)
            : 0,
      }];
    }),
  ) as VerificationSample['animalBiomass'];
  const cellById = new Map(
    snapshot.cells.map((cell) => [cell.id, cell] as const),
  );
  const spatialDiagnostics = world as unknown as {
    sampleLightField(point: Vec2): number;
    ricefishShelterAt(point: Vec2): number;
  };
  const livingDaphnia = snapshot.animals.filter(
    (animal) => animal.speciesId === 'daphnia',
  );
  const sortedDaphniaY = livingDaphnia
    .map((animal) => animal.y)
    .sort((left, right) => left - right);
  const meanDaphniaY = sortedDaphniaY.length
    ? sortedDaphniaY.reduce((total, value) => total + value, 0) /
      sortedDaphniaY.length
    : null;
  const medianDaphniaY = sortedDaphniaY.length
    ? sortedDaphniaY.length % 2 === 1
      ? sortedDaphniaY[(sortedDaphniaY.length - 1) / 2]
      : (
        sortedDaphniaY[sortedDaphniaY.length / 2 - 1] +
        sortedDaphniaY[sortedDaphniaY.length / 2]
      ) / 2
    : null;
  const daphniaCanopyShelters = savedDaphnia.map((animal) =>
    spatialDiagnostics.ricefishShelterAt(animal.position));
  const meanDaphniaCanopyShelter = daphniaCanopyShelters.length
    ? daphniaCanopyShelters.reduce((total, value) => total + value, 0) /
      daphniaCanopyShelters.length
    : null;
  return {
    time: rounded(snapshot.elapsedSeconds, 1),
    population: populations,
    animalBiomass,
    events: eventSummaries,
    vallisneria: {
      supplied: snapshot.plants.filter((plant) =>
        plant.origin === 'supplied').length,
      runners: snapshot.plants.filter((plant) =>
        plant.origin === 'runner').length,
      runnerBirths: tracker.runnerBirths,
      plantingBedContainmentApplicable,
      livingInsidePlantingBeds: plantingBedContainmentApplicable
        ? snapshot.plants.length - plantsOutsidePlantingBeds.length
        : 0,
      livingOutsidePlantingBeds: plantsOutsidePlantingBeds.length,
      livingRunnersOutsidePlantingBeds:
        plantsOutsidePlantingBeds.filter((plant) =>
          plant.origin === 'runner').length,
      escapedRunnerBirths: tracker.escapedRunnerBirths,
      maximumRunnerEscapeDistance:
        rounded(tracker.maximumRunnerEscapeDistance, 1),
      minimumLivingRootX: livingRootXs.length
        ? rounded(Math.min(...livingRootXs), 1)
        : null,
      maximumLivingRootX: livingRootXs.length
        ? rounded(Math.max(...livingRootXs), 1)
        : null,
      secondGenerationOrLater:
        livingPlantGenerations.filter((generation) => generation >= 2).length,
      maximumLivingGeneration: Math.max(0, ...livingPlantGenerations),
      maximumObservedGeneration: tracker.maximumPlantGeneration,
    },
    producers: {
      phytoplankton: rounded(
        snapshot.biogeochemistry.plankton.phytoplanktonBiomass,
      ),
      nitzschia: rounded(snapshot.totalBiomass.nitzschia),
      oedogonium: rounded(snapshot.totalBiomass.oedogonium),
      vallisneria: rounded(snapshot.totalBiomass.vallisneria),
    },
    microbes: {
      decomposer: rounded(
        snapshot.biogeochemistry.biofilmTotals.decomposer,
      ),
      nitrifier: rounded(
        snapshot.biogeochemistry.biofilmTotals.nitrifier,
      ),
      planktonicDecomposer: rounded(
        snapshot.biogeochemistry.plankton.planktonicDecomposerBiomass,
      ),
    },
    daphniaCondition: {
      juveniles: juvenileDaphnia.length,
      adults: adultDaphnia.length,
      gestatingAdults: adultDaphnia.filter((animal) =>
        animal.gestationRemaining !== null).length,
      broodReadyAdults: adultDaphnia.filter((animal) =>
        (animal.reproductiveBiomass ?? 0) + 1e-12 >=
          PLANKTON_ECOLOGY_RULES.daphnia.juvenileBirthBiomass).length,
      fundedOffspringEquivalent: rounded(
        savedDaphnia.reduce(
          (total, animal) =>
            total + (animal.reproductiveBiomass ?? 0),
          0,
        ) /
          PLANKTON_ECOLOGY_RULES.daphnia.juvenileBirthBiomass,
        3,
      ),
      medianAdultAgeSeconds: roundedMedian(
        adultDaphnia.map((animal) => animal.ageSeconds),
        1,
      ),
      medianAdultRemainingLifespanSeconds: roundedMedian(
        adultDaphnia.map((animal) =>
          Math.max(0, animal.lifespanSeconds - animal.ageSeconds)),
        1,
      ),
      medianAdultEnergy: roundedMedian(
        adultDaphnia.map((animal) => animal.energy),
      ),
      medianAdultStoredBiomass: roundedMedian(
        adultDaphnia.map((animal) => animal.storedBiomass),
        9,
      ),
      medianJuvenileAgeSeconds: roundedMedian(
        juvenileDaphnia.map((animal) => animal.ageSeconds),
        1,
      ),
    },
    ricefishFood: foodTotals(fishFood),
    shrimpCondition: savedShrimp.map((animal) => {
      const targetCell = animal.targetCellId
        ? cellById.get(animal.targetCellId) ?? null
        : null;
      const targetPoint = targetCell
        ? shrimpTelemetryContactPoint(targetCell, snapshot)
        : null;
      let localEdibleBiomassSum = 0;
      let localEdibleBiomassMaximum = 0;
      let localEdibleCellCount = 0;
      for (const cell of snapshot.cells) {
        const contactPoint = shrimpTelemetryContactPoint(cell, snapshot);
        if (
          Math.hypot(
            contactPoint.x - animal.position.x,
            contactPoint.y - animal.position.y,
          ) > SHRIMP_TELEMETRY_LOCAL_FOOD_RADIUS
        ) continue;
        const edible = shrimpTelemetryEdibleBiomass(cell);
        localEdibleBiomassSum += edible;
        localEdibleBiomassMaximum = Math.max(
          localEdibleBiomassMaximum,
          edible,
        );
        if (edible > 0) localEdibleCellCount += 1;
      }
      return {
        id: animal.id,
        generation: animal.generation ?? 0,
        sex: animal.sex,
        lifeStage: animal.lifeStage,
        behavior: animal.behavior,
        x: rounded(animal.position.x, 1),
        y: rounded(animal.position.y, 1),
        structuralBiomass: rounded(animal.structuralBiomass),
        storedBiomass: rounded(animal.storedBiomass),
        reproductiveBiomass: rounded(animal.reproductiveBiomass ?? 0),
        recentIntake: rounded(animal.recentIntake),
        secondsSinceFood: rounded(animal.secondsSinceFood, 1),
        energy: rounded(animal.energy),
        targetCellId: animal.targetCellId,
        targetDistance: targetPoint
          ? rounded(Math.hypot(
            targetPoint.x - animal.position.x,
            targetPoint.y - animal.position.y,
          ), 1)
          : null,
        targetEdibleBiomass: targetCell
          ? rounded(shrimpTelemetryEdibleBiomass(targetCell))
          : null,
        localEdibleBiomassSum: rounded(localEdibleBiomassSum),
        localEdibleBiomassMaximum:
          rounded(localEdibleBiomassMaximum),
        localEdibleCellCount,
      };
    }),
    ricefishCondition: savedRicefish.map((animal) => {
      const gutCapacityReferenceBiomass =
        ricefishGutCapacityReferenceBiomass(
          animal.lifeStage,
          animal.ageSeconds,
          animal.structuralBiomass,
        );
      const detectionRadius =
        ricefishPreyDetectionRadiusForBodyLength(animal.bodyLength);
      const maximumEdibleDaphniaStructure =
        ricefishMaximumDaphniaStructureForBodyLength(animal.bodyLength);
      const physicallyEdibleDaphnia = savedDaphnia.filter((daphnia) =>
        daphnia.structuralBiomass <= maximumEdibleDaphniaStructure &&
        Math.hypot(
          daphnia.position.x - animal.position.x,
          daphnia.position.y - animal.position.y,
        ) <= detectionRadius);
      const target = animal.targetAnimalId
        ? savedAnimalById.get(animal.targetAnimalId) ?? null
        : null;
      const physicallyEdibleDaphniaBiomasses =
        physicallyEdibleDaphnia.map((daphnia) =>
          daphnia.structuralBiomass +
          daphnia.storedBiomass +
          (daphnia.reproductiveBiomass ?? 0));
      return {
        id: animal.id,
        generation: animal.generation ?? 0,
        lifeStage: animal.lifeStage,
        sex: animal.sex,
        behavior: animal.behavior,
        ageSeconds: rounded(animal.ageSeconds, 1),
        bodyLength: rounded(animal.bodyLength, 2),
        x: rounded(animal.position.x, 1),
        y: rounded(animal.position.y, 1),
        velocityX: rounded(animal.velocity.x, 1),
        velocityY: rounded(animal.velocity.y, 1),
        facing: animal.facing,
        patchOriginX: animal.foragingPatchOrigin
          ? rounded(animal.foragingPatchOrigin.x, 1)
          : null,
        patchOriginY: animal.foragingPatchOrigin
          ? rounded(animal.foragingPatchOrigin.y, 1)
          : null,
        localLight: rounded(
          spatialDiagnostics.sampleLightField(animal.position),
          2,
        ),
        nearestDaphniaDistance: livingDaphnia.length
          ? rounded(Math.min(...livingDaphnia.map((daphnia) =>
            Math.hypot(
              daphnia.x - animal.position.x,
              daphnia.y - animal.position.y,
            ))), 1)
          : null,
        detectionRadius: rounded(detectionRadius, 1),
        secondsSinceFood: rounded(animal.secondsSinceFood, 1),
        behaviorTimer: rounded(animal.behaviorTimer, 1),
        nextTargetEvaluation: rounded(animal.nextTargetEvaluation, 1),
        targetAnimalId: animal.targetAnimalId ?? null,
        strikeRecoveryUses: animal.strikeRecoveryUses ?? 0,
        targetSpeciesId: target?.speciesId ?? null,
        targetLifeStage: target?.lifeStage ?? null,
        targetDistance: target
          ? rounded(Math.hypot(
            target.position.x - animal.position.x,
            target.position.y - animal.position.y,
          ), 1)
          : null,
        targetStructuralBiomass: target
          ? rounded(target.structuralBiomass)
          : null,
        targetTotalBiomass: target
          ? rounded(
            target.structuralBiomass +
            target.storedBiomass +
            (target.reproductiveBiomass ?? 0),
          )
          : null,
        physicallyEdibleDaphniaInRadius: physicallyEdibleDaphnia.length,
        physicallyEdibleDaphniaBiomassSum: rounded(
          physicallyEdibleDaphniaBiomasses.reduce(
            (total, biomass) => total + biomass,
            0,
          ),
        ),
        physicallyEdibleDaphniaBiomassMaximum: rounded(
          Math.max(0, ...physicallyEdibleDaphniaBiomasses),
        ),
        energy: rounded(animal.energy),
        structuralBiomass: rounded(animal.structuralBiomass),
        storedBiomass: rounded(animal.storedBiomass),
        reproductiveBiomass: rounded(animal.reproductiveBiomass),
        recentIntake: rounded(animal.recentIntake),
        gutCapacityReferenceBiomass:
          rounded(gutCapacityReferenceBiomass),
        foragingAppetite: rounded(
          ricefishForagingAppetite(
            animal.recentIntake,
            gutCapacityReferenceBiomass,
          ),
        ),
        consumedBiomass: rounded(animal.consumedBiomass),
        reproductionCooldown: rounded(animal.reproductionCooldown, 1),
        gestationRemaining: animal.gestationRemaining === null
          ? null
          : rounded(animal.gestationRemaining, 1),
      };
    }),
    daphniaDistribution: {
      phase: snapshot.dayNight?.phase ?? null,
      meanY: meanDaphniaY === null ? null : rounded(meanDaphniaY, 1),
      medianY: medianDaphniaY === null ? null : rounded(medianDaphniaY, 1),
      meanDepthFraction: meanDaphniaY === null
        ? null
        : rounded(
          (meanDaphniaY - snapshot.tank.waterTop) /
            (snapshot.tank.groundY - snapshot.tank.waterTop),
          4,
        ),
      meanCanopyShelter: meanDaphniaCanopyShelter === null
        ? null
        : rounded(meanDaphniaCanopyShelter, 4),
      fractionInCanopy: daphniaCanopyShelters.length === 0
        ? null
        : rounded(
          daphniaCanopyShelters.filter((value) => value >= 0.12).length /
            daphniaCanopyShelters.length,
          4,
        ),
      fractionInDenseCanopy: daphniaCanopyShelters.length === 0
        ? null
        : rounded(
          daphniaCanopyShelters.filter((value) => value >= 0.4).length /
            daphniaCanopyShelters.length,
          4,
        ),
    },
    water: {
      oxygen: rounded(average.oxygen),
      toxicWaste: rounded(average.toxicWaste),
      organicMatter: rounded(average.organicMatter),
      nutrients: rounded(average.nutrients),
      dissolvedInorganicCarbon: rounded(
        snapshot.biogeochemistry.carbonCycle.dissolvedInorganicCarbon,
      ),
      temperature: rounded(snapshot.waterTemperature, 3),
      nitrogenDriftRatio: balance.nitrogenDriftRatio,
      carbonDriftRatio: balance.carbonDriftRatio,
      oxygenEquivalentDriftRatio: balance.oxygenEquivalentDriftRatio,
    },
  };
};

interface AcceptanceCheck {
  label: string;
  passed: boolean;
  detail: string;
}

interface AcceptanceObservation {
  label: string;
  level: 'info' | 'warning';
  detail: string;
}

const vallisneriaFixtureChecks = (
  fixture: FixtureSummary,
): AcceptanceCheck[] => {
  const beds = fixture.vallisneriaPlantingBeds;
  const initialRoots = fixture.vallisneriaInitialRootXs;
  return [
    {
      label: '나사말 6포기를 참고 화면과 같은 오른쪽 식재 구역에 배치',
      passed:
        beds.length === 1 &&
        initialRoots.length === VALLISNERIA_SEEDS &&
        beds.every((bed) => bed.initialRootsOutside === 0) &&
        beds[0]!.tankFraction <= 0.42,
      detail:
        `beds=${beds.length}, roots=${initialRoots.map((x) =>
          x.toFixed(1)).join('/')}, outside=` +
        `${beds.reduce((total, bed) => total + bed.initialRootsOutside, 0)}, ` +
        `tankFraction=${beds[0]?.tankFraction.toFixed(3) ?? 'n/a'}`,
    },
    {
      label: '나사말 초기 식재대 시작점에 실제 돌을 함께 배치',
      passed:
        beds.length === 1 &&
        beds.every((bed) =>
          bed.leftBoundary.kind === 'structure' &&
          bed.leftBoundary.definitionId === 'tall-stone' &&
          Math.abs(bed.leftBoundary.gapToBed) <= 1e-6 &&
          bed.rightBoundary.kind === 'tank-wall' &&
          Math.abs(bed.rightBoundary.x - fixture.tank.width) <= 1e-6),
      detail: JSON.stringify(beds.map((bed) => ({
        id: bed.id,
        minimumX: rounded(bed.minimumX, 1),
        maximumX: rounded(bed.maximumX, 1),
        leftBoundary: bed.leftBoundary,
        rightBoundary: bed.rightBoundary,
      }))),
    },
  ];
};

const main = (): void => {
  const world = new SimulationWorld('mission-8');
  if (FORAGING_DIAGNOSTICS_OUTPUT_PATH) {
    world.enableRicefishForagingDiagnostics(true);
  }
  const fixture = stockMission8Fixture(world);
  if (FIXTURE_ONLY) {
    const checks = vallisneriaFixtureChecks(fixture);
    const failed = checks.filter((check) => !check.passed);
    console.log(JSON.stringify({
      verification: 'mission-8-development-food-web-fixture',
      fixtureOnly: true,
      fixture,
      acceptance: {
        passed: failed.length === 0,
        failedCount: failed.length,
        checks,
      },
    }, null, 2));
    if (failed.length > 0) process.exitCode = 1;
    return;
  }
  const resumeUsed =
    RESUME_SAVE_PATH !== null && existsSync(RESUME_SAVE_PATH);
  const presetUsed =
    !resumeUsed &&
    USE_ESTABLISHED_PRESET &&
    existsSync(ESTABLISHED_PRESET_PATH);
  if (resumeUsed) {
    const resumed = JSON.parse(
      readFileSync(RESUME_SAVE_PATH, 'utf8'),
    ) as SimulationSaveData;
    world.loadSaveData(resumed);
  } else if (presetUsed) {
    const preset = JSON.parse(
      readFileSync(ESTABLISHED_PRESET_PATH, 'utf8'),
    ) as SimulationSaveData;
    world.loadSaveData(preset);
  }
  let snapshot = world.snapshot();
  const lineage = createLineageTracker(
    snapshot,
    fixture.vallisneriaPlantingBeds,
  );
  const observedEvents: AnimalPopulationEventSnapshot[] = [];
  let lastEventSequence = 0;
  let latestSecondGenerationDaphniaBirthSeconds =
    Number.NEGATIVE_INFINITY;
  const captureEvents = (events: AnimalPopulationEventSnapshot[]): void => {
    for (const event of events) {
      if (event.sequence <= lastEventSequence) continue;
      observedEvents.push({ ...event });
      observeBirthEvent(lineage, event);
      if (
        event.kind === 'birth' &&
        event.speciesId === 'daphnia' &&
        (lineage.animalGeneration.get(event.animalId) ?? 0) >= 2
      ) {
        latestSecondGenerationDaphniaBirthSeconds =
          event.elapsedSeconds;
      }
      lastEventSequence = event.sequence;
    }
  };
  captureEvents(snapshot.animalPopulationEvents);
  const fishFood = createFishFoodTracker(snapshot.animals);
  const waterExtremes = createWaterExtremes();
  const maximumPopulationObserved: Record<AnimalSpeciesId, number> = {
    'cherry-shrimp': fixture.initialAnimals['cherry-shrimp'],
    daphnia: fixture.initialAnimals.daphnia,
    'japanese-ricefish': fixture.initialAnimals['japanese-ricefish'],
  };
  const samples: VerificationSample[] = [];
  const foragingDiagnosticIntervals: Array<{
    time: number;
    fishPopulation: number;
    daphniaPopulation: number;
    records: Array<RicefishForagingDiagnosticSnapshot & {
      generation: number;
      lifeStage: string;
      sex: string;
      behavior: string;
      energy: number;
      structuralBiomass: number;
      storedBiomass: number;
      reproductiveBiomass: number;
      secondsSinceFood: number;
      consumedBiomass: number;
    }>;
  }> = [];
  const captureForagingDiagnostics = (): void => {
    if (!FORAGING_DIAGNOSTICS_OUTPUT_PATH) return;
    const diagnostics = world.takeRicefishForagingDiagnostics();
    if (diagnostics.length === 0) return;
    // Render snapshots deliberately omit the internal matter compartments.
    // This path is development-only, so join the drained counters to the
    // authoritative save state instead of writing misleading zeroes.
    const animalById = new Map(
      world.exportSaveData().animals.map((animal) => [animal.id, animal]),
    );
    foragingDiagnosticIntervals.push({
      time: rounded(snapshot.elapsedSeconds, 1),
      fishPopulation: snapshot.animals.filter((animal) =>
        animal.speciesId === 'japanese-ricefish').length,
      daphniaPopulation: snapshot.animals.filter((animal) =>
        animal.speciesId === 'daphnia').length,
      records: diagnostics.map((diagnostic) => {
        const animal = animalById.get(diagnostic.animalId);
        return {
          ...diagnostic,
          generation: animal?.generation ?? 0,
          lifeStage: animal?.lifeStage ?? 'dead',
          sex: animal?.sex ?? 'unknown',
          behavior: animal?.behavior ?? 'dead',
          energy: rounded(animal?.energy ?? 0),
          structuralBiomass: rounded(animal?.structuralBiomass ?? 0),
          storedBiomass: rounded(animal?.storedBiomass ?? 0),
          reproductiveBiomass: rounded(
            animal?.reproductiveBiomass ?? 0,
          ),
          secondsSinceFood: rounded(animal?.secondsSinceFood ?? 0, 1),
          consumedBiomass: rounded(animal?.consumedBiomass ?? 0),
        };
      }),
    });
  };
  const captureState = (): void => {
    observeAnimals(lineage, snapshot);
    captureEvents(snapshot.animalPopulationEvents);
    observeFishFood(fishFood, snapshot.animals);
    observeWater(waterExtremes, snapshot);
    for (const speciesId of animalSpecies) {
      maximumPopulationObserved[speciesId] = Math.max(
        maximumPopulationObserved[speciesId],
        snapshot.animals.filter((animal) =>
          animal.speciesId === speciesId).length,
      );
    }
  };

  captureState();
  samples.push(
    sampleVerification(world, snapshot, lineage, observedEvents, fishFood),
  );
  let nextSampleSeconds = snapshot.elapsedSeconds + SAMPLE_SECONDS;
  let guard = 0;
  const maximumTicks = Math.ceil(
    (DAPHNIA_ESTABLISHMENT_TIMEOUT_SECONDS + DURATION_SECONDS) /
      (REAL_TICK_SECONDS * 64),
  ) * 4 + 1_000;
  let abnormalReason: string | null = null;
  let ricefishIntroducedAtSeconds: number | null = null;
  let targetEndSeconds: number | null = null;
  let establishmentPopulation = 0;
  let establishmentDescendants = 0;
  let establishmentAdultDescendants = 0;
  let establishmentSecondGeneration = 0;
  let establishmentArmedAtSeconds: number | null = null;
  let establishmentStableSeconds = 0;
  let releasedRicefish = 0;
  let releaseEventBaseline: Record<AnimalSpeciesId, EventSummary> | null =
    null;
  let latestSecondGenerationDaphniaBirthAtRelease: number | null = null;
  world.handle({ type: presetUsed || resumeUsed ? 'resume' : 'start' });
  world.handle({ type: 'set-speed', speed: 64 });
  const advanceObservationBatch = (): void => {
    for (
      let index = 0;
      index < OBSERVATION_BATCH_TICKS && guard < maximumTicks;
      index += 1
    ) {
      world.tick(REAL_TICK_SECONDS);
      guard += 1;
    }
    snapshot = world.snapshot();
    captureForagingDiagnostics();
    captureState();
  };

  try {
    // A playable predator mission must not assume that the player releases
    // fish into a six-animal founder inoculum at time zero. First establish
    // several born Daphnia generations and hold their replacement activity,
    // then pause and add the two supplied ricefish.
    // DURATION_SECONDS starts at predator release so the acceptance interval
    // still spans several complete fish lifetimes.
    if (presetUsed || resumeUsed) {
      const livingDaphnia = snapshot.animals.filter(
        (animal) => animal.speciesId === 'daphnia',
      );
      establishmentPopulation = livingDaphnia.length;
      establishmentDescendants = livingDaphnia.filter(
        (animal) => (animal.generation ?? 0) >= 1,
      ).length;
      establishmentAdultDescendants = livingDaphnia.filter(
        (animal) =>
          (animal.generation ?? 0) >= 1 &&
          animal.lifeStage === 'adult',
      ).length;
      establishmentSecondGeneration = livingDaphnia.filter(
        (animal) => (animal.generation ?? 0) >= 2,
      ).length;
      establishmentArmedAtSeconds =
        snapshot.elapsedSeconds - DAPHNIA_ESTABLISHMENT_HOLD_SECONDS;
      establishmentStableSeconds = DAPHNIA_ESTABLISHMENT_HOLD_SECONDS;
      latestSecondGenerationDaphniaBirthSeconds = snapshot.elapsedSeconds;
    }
    while (
      !presetUsed &&
      !resumeUsed &&
      snapshot.elapsedSeconds < DAPHNIA_ESTABLISHMENT_TIMEOUT_SECONDS &&
      guard < maximumTicks
    ) {
      const livingDaphnia = snapshot.animals.filter(
        (animal) => animal.speciesId === 'daphnia',
      );
      establishmentPopulation = livingDaphnia.length;
      establishmentDescendants = livingDaphnia.filter(
        (animal) => (animal.generation ?? 0) >= 1,
      ).length;
      establishmentAdultDescendants = livingDaphnia.filter(
        (animal) =>
          (animal.generation ?? 0) >= 1 &&
          animal.lifeStage === 'adult',
      ).length;
      establishmentSecondGeneration = livingDaphnia.filter(
        (animal) => (animal.generation ?? 0) >= 2,
      ).length;
      const reachesReleasePeak =
        establishmentPopulation >= DAPHNIA_ESTABLISHMENT_POPULATION &&
        establishmentDescendants >= DAPHNIA_ESTABLISHMENT_DESCENDANTS &&
        establishmentAdultDescendants >=
          DAPHNIA_ESTABLISHMENT_ADULT_DESCENDANTS &&
        establishmentSecondGeneration > 0;
      if (establishmentArmedAtSeconds === null && reachesReleasePeak) {
        establishmentArmedAtSeconds = snapshot.elapsedSeconds;
      }
      if (establishmentArmedAtSeconds !== null) {
        const keepsDistributedCohort =
          establishmentPopulation >=
            DAPHNIA_ESTABLISHMENT_HOLD_POPULATION &&
          establishmentDescendants >=
            DAPHNIA_ESTABLISHMENT_HOLD_DESCENDANTS &&
          establishmentAdultDescendants >=
            DAPHNIA_ESTABLISHMENT_HOLD_ADULT_DESCENDANTS &&
          establishmentSecondGeneration > 0;
        if (!keepsDistributedCohort) {
          establishmentArmedAtSeconds = null;
          establishmentStableSeconds = 0;
        } else {
          establishmentStableSeconds =
            snapshot.elapsedSeconds - establishmentArmedAtSeconds;
          const hasRecentSecondGenerationBirth =
            snapshot.elapsedSeconds -
              latestSecondGenerationDaphniaBirthSeconds <=
                DAPHNIA_ESTABLISHMENT_RECENT_BIRTH_SECONDS;
          if (
            establishmentStableSeconds >=
              DAPHNIA_ESTABLISHMENT_HOLD_SECONDS &&
            hasRecentSecondGenerationBirth
          ) break;
        }
      }

      advanceObservationBatch();
      if (snapshot.elapsedSeconds + 1e-6 >= nextSampleSeconds) {
        samples.push(
          sampleVerification(world, snapshot, lineage, observedEvents, fishFood),
        );
        nextSampleSeconds += SAMPLE_SECONDS;
      }
    }

    const established =
      presetUsed || resumeUsed || (
      establishmentArmedAtSeconds !== null &&
      establishmentStableSeconds >= DAPHNIA_ESTABLISHMENT_HOLD_SECONDS &&
      snapshot.elapsedSeconds - latestSecondGenerationDaphniaBirthSeconds <=
        DAPHNIA_ESTABLISHMENT_RECENT_BIRTH_SECONDS);
    if (!established) {
      abnormalReason =
        'Daphnia founder culture did not establish before predator release';
    } else if (resumeUsed) {
      releasedRicefish =
        snapshot.animals.filter((animal) =>
          animal.speciesId === 'japanese-ricefish').length;
      if (releasedRicefish === 0) {
        abnormalReason =
          'Continuation save contains no living ricefish';
      } else {
        ricefishIntroducedAtSeconds = snapshot.elapsedSeconds;
        latestSecondGenerationDaphniaBirthAtRelease =
          latestSecondGenerationDaphniaBirthSeconds;
        targetEndSeconds = ricefishIntroducedAtSeconds + DURATION_SECONDS;
        captureState();
        releaseEventBaseline = Object.fromEntries(
          animalSpecies.map((speciesId) => [
            speciesId,
            summarizeEvents(observedEvents, speciesId),
          ]),
        ) as Record<AnimalSpeciesId, EventSummary>;
        world.handle({ type: 'resume' });
        world.handle({ type: 'set-speed', speed: 64 });
      }
    } else {
      world.handle({ type: 'pause' });
      if (RELEASE_RICEFISH) {
        for (let index = 0; index < RICEFISH_RELEASE_COUNT; index += 1) {
          placeAnimal(
            world,
            'japanese-ricefish',
            ricefishReleasePoint(index, snapshot.tank),
          );
        }
      }
      snapshot = world.snapshot();
      releasedRicefish =
        snapshot.animals.filter((animal) =>
          animal.speciesId === 'japanese-ricefish').length;
      ricefishIntroducedAtSeconds = snapshot.elapsedSeconds;
      latestSecondGenerationDaphniaBirthAtRelease =
        latestSecondGenerationDaphniaBirthSeconds;
      targetEndSeconds = ricefishIntroducedAtSeconds + DURATION_SECONDS;
      captureState();
      releaseEventBaseline = Object.fromEntries(
        animalSpecies.map((speciesId) => [
          speciesId,
          summarizeEvents(observedEvents, speciesId),
        ]),
      ) as Record<AnimalSpeciesId, EventSummary>;
      world.handle({ type: 'resume' });
      world.handle({ type: 'set-speed', speed: 64 });
    }

    while (
      abnormalReason === null &&
      targetEndSeconds !== null &&
      snapshot.elapsedSeconds < targetEndSeconds &&
      guard < maximumTicks
    ) {
      const previousElapsed = snapshot.elapsedSeconds;
      advanceObservationBatch();
      if (!Number.isFinite(snapshot.elapsedSeconds)) {
        abnormalReason = 'elapsed simulation time became non-finite';
        break;
      }
      if (
        guard > 120 &&
        snapshot.elapsedSeconds <= previousElapsed
      ) {
        abnormalReason = 'simulation clock stopped advancing';
        break;
      }
      if (snapshot.elapsedSeconds + 1e-6 < nextSampleSeconds) continue;
      samples.push(
        sampleVerification(world, snapshot, lineage, observedEvents, fishFood),
      );
      nextSampleSeconds += SAMPLE_SECONDS;
    }
  } catch (error) {
    abnormalReason = error instanceof Error
      ? `${error.name}: ${error.message}`
      : String(error);
  }

  if (
    samples.at(-1)?.time !== rounded(snapshot.elapsedSeconds, 1)
  ) {
    samples.push(
      sampleVerification(world, snapshot, lineage, observedEvents, fishFood),
    );
  }

  const finalPopulation = Object.fromEntries(
    animalSpecies.map((speciesId) => [
      speciesId,
      populationSummary(snapshot, speciesId, lineage),
    ]),
  ) as Record<AnimalSpeciesId, PopulationSummary>;
  const finalEvents = Object.fromEntries(
    animalSpecies.map((speciesId) => [
      speciesId,
      summarizeEvents(observedEvents, speciesId),
    ]),
  ) as Record<AnimalSpeciesId, EventSummary>;
  const postReleaseEvents = releaseEventBaseline
    ? Object.fromEntries(
      animalSpecies.map((speciesId) => [
        speciesId,
        subtractEventSummary(
          finalEvents[speciesId],
          releaseEventBaseline![speciesId],
        ),
      ]),
    ) as Record<AnimalSpeciesId, EventSummary>
    : null;
  // The observation batch can cross the requested target by a few simulated
  // seconds. Align the trajectory with the final sampled state so that real
  // recruitment and the final population are not silently discarded.
  const trajectoryEndSeconds = resolveMission8TrajectoryEndSeconds(
    rounded(snapshot.elapsedSeconds, 1),
    samples.at(-1)?.time ?? null,
    targetEndSeconds,
  );
  const trajectoryEvents = (
    speciesId: AnimalSpeciesId,
  ): Array<{ time: number; kind: Mission8TrajectoryEventKind }> =>
    observedEvents
      .filter((event) =>
        event.speciesId === speciesId &&
        (
          event.kind === 'birth' ||
          event.kind === 'hatched' ||
          event.kind === 'matured' ||
          event.kind === 'death'
        ))
      .map((event) => ({
        time: event.elapsedSeconds,
        kind: event.kind as Mission8TrajectoryEventKind,
      }));
  const trajectoryResults = Object.fromEntries(
    animalSpecies.map((speciesId) => [
      speciesId,
      evaluateMission8AnimalTrajectory({
        speciesId,
        requestedPostReleaseDurationSeconds: DURATION_SECONDS,
        releaseSeconds:
          ricefishIntroducedAtSeconds ?? trajectoryEndSeconds,
        endSeconds: trajectoryEndSeconds,
        samples: samples.map((sample) => ({
          time: sample.time,
          total: sample.population[speciesId].total,
          adults: sample.population[speciesId].adults,
          totalBiomass: sample.animalBiomass[speciesId].total,
          secondGenerationOrLater:
            sample.population[speciesId].secondGenerationOrLater,
          secondGenerationOrLaterAdults:
            sample.population[speciesId].secondGenerationOrLaterAdults,
        })),
        events: trajectoryEvents(speciesId),
      }),
    ]),
  ) as Record<AnimalSpeciesId, Mission8TrajectoryResult>;
  const checks: AcceptanceCheck[] = [];
  const observations: AcceptanceObservation[] = [];
  const check = (
    label: string,
    passed: boolean,
    detail: string,
  ): void => {
    checks.push({ label, passed, detail });
  };
  const observe = (
    label: string,
    level: AcceptanceObservation['level'],
    detail: string,
  ): void => {
    observations.push({ label, level, detail });
  };

  checks.push(...vallisneriaFixtureChecks(fixture));
  check(
    '긴 수조·72×20 물 격자 사용',
    fixture.tank.id === 'long' &&
      fixture.tank.waterColumns === 72 &&
      fixture.tank.waterRows === 20,
    `${fixture.tank.id} ${fixture.tank.width}×${fixture.tank.height}, ` +
      `${fixture.tank.waterColumns}×${fixture.tank.waterRows}`,
  );
  check(
    '참고 배치에 사용한 네 돌 종류 배치',
    requiredFixtureStructureTypes.every((definitionId) =>
      fixture.structures[definitionId] >= 1),
    JSON.stringify(fixture.structures),
  );
  check(
    '작은 돌 조합에 실제 체급 틈 형성',
    fixture.refugeGapCount >= 1,
    `gaps=${fixture.refugeGapCount}`,
  );
  check(
    '지급 생산자·동물·플랑크톤·균 배치',
    fixture.seeds.nitzschia ===
        MISSION8_SCENARIO.seedBudget.nitzschia &&
      fixture.seeds.oedogonium ===
        MISSION8_SCENARIO.seedBudget.oedogonium &&
      fixture.seeds.vallisneria ===
        MISSION8_SCENARIO.seedBudget.vallisneria &&
      fixture.initialAnimals['cherry-shrimp'] ===
        MISSION8_SCENARIO.animalBudget['cherry-shrimp'] &&
      fixture.initialAnimals.daphnia === DAPHNIA_FOUNDERS &&
      fixture.initialAnimals['japanese-ricefish'] === 0 &&
      (resumeUsed ? releasedRicefish > 0 : releasedRicefish === 2) &&
      fixture.phytoplanktonBiomass > 0 &&
      fixture.biofilm.decomposer > 0 &&
      fixture.biofilm.nitrifier > 0,
    `seeds=${JSON.stringify(fixture.seeds)}, ` +
      `initialAnimals=${JSON.stringify(fixture.initialAnimals)}, ` +
      `lateRicefish=${releasedRicefish}, ` +
      `phyto=${fixture.phytoplanktonBiomass.toFixed(4)}, ` +
      `biofilm=${JSON.stringify(fixture.biofilm)}`,
  );
  check(
    '다세대 물벼룩 군집 안정 뒤 송사리 후속 방류',
    resumeUsed
      ? ricefishIntroducedAtSeconds !== null &&
        establishmentSecondGeneration > 0 &&
        releasedRicefish > 0
      : ricefishIntroducedAtSeconds !== null &&
      establishmentStableSeconds >= DAPHNIA_ESTABLISHMENT_HOLD_SECONDS &&
      establishmentSecondGeneration > 0 &&
      latestSecondGenerationDaphniaBirthAtRelease !== null &&
      ricefishIntroducedAtSeconds -
        latestSecondGenerationDaphniaBirthAtRelease <=
          DAPHNIA_ESTABLISHMENT_RECENT_BIRTH_SECONDS,
    `population=${establishmentPopulation}, ` +
      `descendants=${establishmentDescendants}, ` +
      `adultDescendants=${establishmentAdultDescendants}, ` +
      `secondGeneration=${establishmentSecondGeneration}, ` +
      `stable=${establishmentStableSeconds.toFixed(1)}s`,
  );
  check(
    '요청 장기 구간 정상 완료',
    abnormalReason === null &&
      guard < maximumTicks &&
      targetEndSeconds !== null &&
      snapshot.elapsedSeconds >= targetEndSeconds,
    `elapsed=${snapshot.elapsedSeconds.toFixed(1)}, ` +
      `postPredator=${ricefishIntroducedAtSeconds === null
        ? 'n/a'
        : (snapshot.elapsedSeconds - ricefishIntroducedAtSeconds).toFixed(1)}, ` +
      `ticks=${guard}, ` +
      `abnormal=${abnormalReason ?? 'none'}`,
  );
  check(
    '세 동물군 최종 생존',
    animalSpecies.every((speciesId) =>
      finalPopulation[speciesId].total > 0),
    animalSpecies.map((speciesId) =>
      `${speciesId}=${finalPopulation[speciesId].total}`).join(', '),
  );
  for (const speciesId of animalSpecies) {
    const result = trajectoryResults[speciesId];
    check(
      `${speciesId} 후반 개체군·생체량·성체·모집·다세대 궤적`,
      result.passed,
      `applicable=${result.applicable}, status=${result.status}, ` +
        `reason=${result.reason}, ` +
        `fullCoverage=${(result.fullWindow.coverageRatio * 100).toFixed(1)}%/` +
          `${result.fullWindow.samples}, ` +
        `recentCoverage=${(result.recentWindow.coverageRatio * 100).toFixed(1)}%/` +
          `${result.recentWindow.samples}, ` +
        `recentMinimum=${result.recentWindow.minimumPopulation}, ` +
        `recentMedian=${result.recentWindow.medianPopulation}, ` +
        `recentAtOrAboveFloor=` +
          `${(result.recentWindow.fractionAtOrAbovePopulationFloor * 100)
            .toFixed(1)}%, ` +
        `floor=${result.populationFloor}, ` +
        `recentGeneration2Median=` +
          `${result.recentWindow.medianSecondGenerationOrLater}, ` +
        `finalGeneration2=` +
          `${result.recentWindow.finalSecondGenerationOrLater}, ` +
        `generation2Required=${result.livingGenerationFloor}, ` +
        `recentGeneration2AdultsMedian=` +
          `${result.recentWindow.medianSecondGenerationOrLaterAdults}, ` +
        `finalGeneration2Adults=` +
          `${result.recentWindow.finalSecondGenerationOrLaterAdults}, ` +
        `livingAdultGenerationPassed=` +
          `${result.livingAdultGenerationPassed}, ` +
        `recentSlope95=[` +
          `${result.recentWindow.trend.slopeLower95.toExponential(3)},` +
          `${result.recentWindow.trend.slopeUpper95.toExponential(3)}], ` +
        `recentProjected=` +
          `${result.recentWindow.trend.projectedAfterSameDuration.toFixed(2)}, ` +
        `biomassReference=${result.biomassReference.toExponential(3)}, ` +
        `biomassFloor=${result.biomassFloor.toExponential(3)}, ` +
        `recentBiomassMinimum=` +
          `${result.recentWindow.minimumBiomass.toExponential(3)}, ` +
        `recentBiomassMedian=` +
          `${result.recentWindow.medianBiomass.toExponential(3)}, ` +
        `finalBiomass=${result.recentWindow.finalBiomass.toExponential(3)}, ` +
        `biomassRetention=` +
          `${(result.recentWindow.biomassRetentionRatio * 100).toFixed(1)}%, ` +
        `recentBiomassSlope95=[` +
          `${result.recentWindow.biomassTrend.slopeLower95.toExponential(3)},` +
          `${result.recentWindow.biomassTrend.slopeUpper95.toExponential(3)}], ` +
        `recentBiomassProjected=` +
          `${result.recentWindow.biomassTrend.projectedAfterSameDuration
            .toExponential(3)}, ` +
        `recentAdultsMedian=${result.recentWindow.medianAdults}, ` +
        `finalAdults=${result.recentWindow.finalAdults}, ` +
        `adultStagePassed=${result.adultStagePassed}, ` +
        `recentAdultFractionMedian=` +
          `${(result.recentWindow.medianAdultFraction * 100).toFixed(1)}%, ` +
        `finalAdultFraction=` +
          `${(result.recentWindow.finalAdultFraction * 100).toFixed(1)}%, ` +
        `recentAdultCountSlope95=[` +
          `${result.recentWindow.adultCountTrend.slopeLower95.toExponential(3)},` +
          `${result.recentWindow.adultCountTrend.slopeUpper95.toExponential(3)}], ` +
        `recentAdultFractionSlope95=[` +
          `${result.recentWindow.adultFractionTrend.slopeLower95
            .toExponential(3)},` +
          `${result.recentWindow.adultFractionTrend.slopeUpper95
            .toExponential(3)}], ` +
        `trough=${result.recoveryEvidence.troughPopulation}@` +
          `${result.recoveryEvidence.troughTimeSeconds}s, ` +
        `postTroughObserved=` +
          `${result.recoveryEvidence.observedAfterTroughSeconds}s, ` +
        `postTroughRecruitment=` +
          `${JSON.stringify(result.recoveryEvidence.postTroughRecruitment)}, ` +
        `olderRecruitment=${JSON.stringify(result.olderHalfRecruitment)}, ` +
        `recentRecruitment=${JSON.stringify(result.recentHalfRecruitment)}, ` +
        `projectedCollapse=${result.projectedCollapse}, ` +
        `biomassProjectedCollapse=${result.biomassProjectedCollapse}, ` +
        `confirmedRecovery=${result.confirmedRecovery}, ` +
        `recoveryTailSlope=` +
          `${result.recoveryEvidence.tailSlopePerSecond.toExponential(3)}, ` +
        `biomassRecoveryConfirmed=${result.biomassRecoveryConfirmed}, ` +
        `biomassRecoveryTailSlope=` +
          `${result.biomassRecoveryEvidence.tailSlopePerSecond
            .toExponential(3)}, ` +
        `biomassTrough=${result.biomassRecoveryEvidence.troughBiomass}@` +
          `${result.biomassRecoveryEvidence.troughTimeSeconds}s, ` +
        `biomassRecoveryRecruitment=` +
          `${JSON.stringify(
            result.biomassRecoveryEvidence.postTroughRecruitment,
          )}, ` +
        `recoveryOverride=${result.recoveryOverrideApplied}, ` +
        `biomassRecoveryOverride=` +
          `${result.biomassRecoveryOverrideApplied}`,
    );
  }
  const standardTankDensityEquivalent =
    maximumPopulationObserved.daphnia /
    Math.max(
      1,
      snapshot.tank.width / 1_200 * snapshot.tank.height / 720,
    );
  observe(
    '물벼룩 최대 개체 수와 표준 수조 환산 밀도',
    'info',
    `maximum=${maximumPopulationObserved.daphnia}, ` +
      `standardTankEquivalent=${standardTankDensityEquivalent.toFixed(1)}; ` +
      '개체 수만으로 렌더링 합격선을 만들지 않고 실제 성능 검증에서 판정',
  );

  const daphniaTurnover =
    finalEvents.daphnia.births > 0 &&
    finalEvents.daphnia.maturations > 0 &&
    finalPopulation.daphnia.descendants > 0;
  check(
    '큰물벼룩 출생·성숙·살아 있는 후손',
    daphniaTurnover,
    `births=${finalEvents.daphnia.births}, ` +
      `matured=${finalEvents.daphnia.maturations}, ` +
      `livingDescendants=${finalPopulation.daphnia.descendants}, ` +
      `founders=${finalPopulation.daphnia.founders}`,
  );
  const shrimpTurnover =
    finalEvents['cherry-shrimp'].births > 0 &&
    finalEvents['cherry-shrimp'].maturations > 0 &&
    finalPopulation['cherry-shrimp'].descendants > 0;
  check(
    '체리새우 출생·성숙·살아 있는 후손',
    shrimpTurnover,
    `births=${finalEvents['cherry-shrimp'].births}, ` +
      `matured=${finalEvents['cherry-shrimp'].maturations}, ` +
      `livingDescendants=${finalPopulation['cherry-shrimp'].descendants}, ` +
      `founders=${finalPopulation['cherry-shrimp'].founders}`,
  );
  const ricefishTurnover =
    finalEvents['japanese-ricefish'].births > 0 &&
    finalEvents['japanese-ricefish'].hatches > 0 &&
    finalEvents['japanese-ricefish'].maturations > 0 &&
    finalPopulation['japanese-ricefish'].descendants > 0;
  check(
    '송사리 산란·부화·성숙·살아 있는 후손',
    ricefishTurnover,
    `births=${finalEvents['japanese-ricefish'].births}, ` +
      `hatched=${finalEvents['japanese-ricefish'].hatches}, ` +
      `matured=${finalEvents['japanese-ricefish'].maturations}, ` +
      `livingDescendants=${finalPopulation['japanese-ricefish'].descendants}, ` +
      `founders=${finalPopulation['japanese-ricefish'].founders}`,
  );

  const requiresFounderReplacement = {
    daphnia:
      DURATION_SECONDS >= mutableDaphniaRules.maximumLifespanSeconds,
    'cherry-shrimp':
      DURATION_SECONDS >= SHRIMP_ECOLOGY_RULES.maximumLifespanSeconds,
    'japanese-ricefish':
      DURATION_SECONDS >= RICEFISH_ECOLOGY_RULES.maximumLifespanSeconds,
  } as const;
  check(
    '수명 구간 이후 창시자만 남은 상태 금지',
    animalSpecies.every((speciesId) =>
      !requiresFounderReplacement[speciesId] ||
      finalPopulation[speciesId].founders === 0),
    animalSpecies.map((speciesId) =>
      `${speciesId}: founders=${finalPopulation[speciesId].founders}, ` +
      `descendants=${finalPopulation[speciesId].descendants}`)
      .join('; '),
  );
  const livingMobileRicefish = snapshot.animals.filter(
    (animal) =>
      animal.speciesId === 'japanese-ricefish' &&
      (animal.lifeStage === 'juvenile' || animal.lifeStage === 'adult'),
  );
  const livingMobileRicefishSexes = new Set(
    livingMobileRicefish.map((animal) => animal.sex),
  );
  check(
    '최종 송사리 계통에 성장 가능한 암수 유지',
    livingMobileRicefish.length >= 2 &&
      livingMobileRicefishSexes.has('female') &&
      livingMobileRicefishSexes.has('male'),
    `mobile=${livingMobileRicefish.length}, ` +
      `female=${livingMobileRicefish.filter((animal) =>
        animal.sex === 'female').length}, ` +
      `male=${livingMobileRicefish.filter((animal) =>
        animal.sex === 'male').length}`,
  );
  const livingAdultShrimp = snapshot.animals.filter(
    (animal) =>
      animal.speciesId === 'cherry-shrimp' &&
      animal.lifeStage === 'adult',
  );
  const livingAdultShrimpSexes = new Set(
    livingAdultShrimp.map((animal) => animal.sex),
  );
  check(
    '최종 체리새우 계통에 성체 암수 유지',
    livingAdultShrimpSexes.has('female') &&
      livingAdultShrimpSexes.has('male'),
    `adults=${livingAdultShrimp.length}, ` +
      `female=${livingAdultShrimp.filter((animal) =>
        animal.sex === 'female').length}, ` +
      `male=${livingAdultShrimp.filter((animal) =>
        animal.sex === 'male').length}`,
  );

  const preyPredationDeaths =
    finalEvents.daphnia.deathsByCause.predation +
    finalEvents['cherry-shrimp'].deathsByCause.predation;
  check(
    '송사리의 큰물벼룩 주식 포식이 실제 사망으로 관측됨',
    preyPredationDeaths > 0 &&
      finalEvents.daphnia.deathsByCause.predation > 0,
    `daphnia=${finalEvents.daphnia.deathsByCause.predation}, ` +
      `shrimp=${finalEvents['cherry-shrimp'].deathsByCause.predation}, ` +
      `inferredFood=${JSON.stringify(foodTotals(fishFood))}`,
  );
  const observedFishFoods = Object.keys(foodTotals(fishFood));
  const allowedFishFoods = new Set([
    '어린 큰물벼룩',
    '큰물벼룩',
    '어린 체리새우',
  ]);
  const forbiddenFishFoods = observedFishFoods.filter(
    (label) => !allowedFishFoods.has(label),
  );
  check(
    '송사리 직접 먹이는 큰물벼룩·어린 새우로 한정',
    fishFood.totalObservedIncrease > 0 && forbiddenFishFoods.length === 0,
    `observed=${JSON.stringify(observedFishFoods)}, ` +
      `forbidden=${JSON.stringify(forbiddenFishFoods)}`,
  );
  check(
    '포식 뒤 피식자 후손 유지',
    finalPopulation.daphnia.descendants > 0 &&
      finalPopulation['cherry-shrimp'].descendants > 0,
    `daphniaDescendants=${finalPopulation.daphnia.descendants}, ` +
      `shrimpDescendants=${finalPopulation['cherry-shrimp'].descendants}`,
  );

  const finalSample = samples.at(-1);
  check(
    '세 생산자군과 식물플랑크톤 최종 잔존',
    Boolean(
      finalSample &&
      finalSample.producers.phytoplankton > 0 &&
      finalSample.producers.nitzschia > 0 &&
      finalSample.producers.oedogonium > 0 &&
      finalSample.producers.vallisneria > 0,
    ),
    JSON.stringify(finalSample?.producers ?? {}),
  );
  check(
    '나사말 러너 다세대 후손 유지',
    lineage.runnerBirths > 0 &&
      (finalSample?.vallisneria.maximumLivingGeneration ?? 0) >= 2 &&
      (finalSample?.vallisneria.secondGenerationOrLater ?? 0) > 0,
    `runnerBirths=${lineage.runnerBirths}, ` +
      `maximumObservedGeneration=${lineage.maximumPlantGeneration}, ` +
      `maximumLivingGeneration=` +
        `${finalSample?.vallisneria.maximumLivingGeneration ?? 0}, ` +
      `livingGeneration2=` +
        `${finalSample?.vallisneria.secondGenerationOrLater ?? 0}`,
  );
  observe(
    '나사말 초기 식재대 밖 정착 경과',
    'info',
    `runnerBirths=${lineage.runnerBirths}, ` +
      `escapedRunnerBirths=${lineage.escapedRunnerBirths}, ` +
      `maximumEscapeDistance=` +
        `${lineage.maximumRunnerEscapeDistance.toFixed(1)}, ` +
      `finalOutside=${finalSample?.vallisneria
        .livingOutsidePlantingBeds ?? 0}, ` +
      `maximumSampledOutside=${Math.max(
        0,
        ...samples.map((sample) =>
          sample.vallisneria.livingOutsidePlantingBeds),
      )}`,
  );
  check(
    '두 부착 균 군집 최종 잔존',
    Boolean(
      finalSample &&
      finalSample.microbes.decomposer > 0 &&
      finalSample.microbes.nitrifier > 0,
    ),
    JSON.stringify(finalSample?.microbes ?? {}),
  );
  check(
    '수질 값 유한·비음수 및 급성 범위 회피',
    waterExtremes.allFiniteAndNonNegative &&
      waterExtremes.minimumOxygen > MINIMUM_SAFE_OXYGEN &&
      waterExtremes.maximumToxicWaste < MAXIMUM_SAFE_TOXIC_WASTE,
    `finiteNonNegative=${waterExtremes.allFiniteAndNonNegative}, ` +
      `oxygenMin=${waterExtremes.minimumOxygen.toFixed(4)}, ` +
      `toxicMax=${waterExtremes.maximumToxicWaste.toFixed(4)}, ` +
      `organicMax=${waterExtremes.maximumOrganicMatter.toFixed(4)}`,
  );
  const acuteWaterDeaths = animalSpecies.reduce(
    (total, speciesId) =>
      total +
      finalEvents[speciesId].deathsByCause.hypoxia +
      finalEvents[speciesId].deathsByCause.toxicity +
      finalEvents[speciesId].deathsByCause.temperature,
    0,
  );
  check(
    '급성 수질·수온 사망 없음',
    acuteWaterDeaths === 0,
    `acuteDeaths=${acuteWaterDeaths}`,
  );
  check(
    '전 구간 닫힌 물질 장부',
    waterExtremes.maximumNitrogenDrift <
        CLOSED_MATERIAL_RELATIVE_TOLERANCE &&
      waterExtremes.maximumCarbonDrift <
        CLOSED_MATERIAL_RELATIVE_TOLERANCE &&
      waterExtremes.maximumOxygenEquivalentDrift <
        CLOSED_MATERIAL_RELATIVE_TOLERANCE,
    `maxN=${waterExtremes.maximumNitrogenDrift.toExponential(3)}, ` +
      `maxC=${waterExtremes.maximumCarbonDrift.toExponential(3)}, ` +
      `maxO=${waterExtremes.maximumOxygenEquivalentDrift.toExponential(3)}`,
  );

  const mortalityObservationEvents = postReleaseEvents ?? finalEvents;
  for (const speciesId of animalSpecies) {
    const starvation =
      mortalityObservationEvents[speciesId].deathsByCause.starvation;
    const oldAge =
      mortalityObservationEvents[speciesId].deathsByCause['old-age'];
    observe(
      `${speciesId} 방류 후 사망 원인 구성`,
      'info',
      `starvation=${starvation}, oldAge=${oldAge}; ` +
        '사망 원인은 전 구간 진단용 누계이며 비율·대소 관계는 ' +
        '궤적 유효성 조건이나 경고 조건이 아님',
    );
  }

  const failed = checks.filter((item) => !item.passed);
  const report = {
    verification: 'mission-8-development-food-web',
    developmentAcceptanceOnly: true,
    missionCompletionCondition: null,
    foodAttribution: {
      method:
        'Each ricefish consumedBiomass increase is assigned to its latest recentFood label.',
      limitation:
        'More than one food type consumed inside one worker tick is attributed to the last label.',
      totalObservedIncrease: rounded(fishFood.totalObservedIncrease),
      byLatestFoodLabel: foodTotals(fishFood),
    },
    configuration: {
      durationSeconds: DURATION_SECONDS,
      sampleSeconds: SAMPLE_SECONDS,
      strictTrajectoryApplicable:
        DURATION_SECONDS >= MISSION8_TRAJECTORY_FULL_WINDOW_SECONDS,
      trajectoryFullWindowSeconds:
        MISSION8_TRAJECTORY_FULL_WINDOW_SECONDS,
      trajectoryRecentWindowSeconds:
        MISSION8_TRAJECTORY_RECENT_WINDOW_SECONDS,
      trajectoryMinimumCoverage:
        MISSION8_TRAJECTORY_MINIMUM_COVERAGE,
      trajectoryMinimumBiomassRetention:
        MISSION8_TRAJECTORY_MINIMUM_BIOMASS_RETENTION,
      trajectoryMinimumBiomassRecoveryGain:
        MISSION8_TRAJECTORY_MINIMUM_BIOMASS_RECOVERY_GAIN,
      realTickSeconds: REAL_TICK_SECONDS,
      observationBatchTicks: OBSERVATION_BATCH_TICKS,
      simulationSpeed: 64,
      phytoplanktonInocula: PHYTOPLANKTON_INOCULA,
      daphniaFounders: DAPHNIA_FOUNDERS,
      nitzschiaSeeds: NITZSCHIA_SEEDS,
      oedogoniumSeeds: OEDOGONIUM_SEEDS,
      vallisneriaSeeds: VALLISNERIA_SEEDS,
      daphniaEstablishmentTimeoutSeconds:
        DAPHNIA_ESTABLISHMENT_TIMEOUT_SECONDS,
      daphniaEstablishmentPopulation:
        DAPHNIA_ESTABLISHMENT_POPULATION,
      daphniaEstablishmentDescendants:
        DAPHNIA_ESTABLISHMENT_DESCENDANTS,
      daphniaEstablishmentAdultDescendants:
        DAPHNIA_ESTABLISHMENT_ADULT_DESCENDANTS,
      daphniaEstablishmentHoldSeconds:
        DAPHNIA_ESTABLISHMENT_HOLD_SECONDS,
      daphniaEstablishmentHoldPopulation:
        DAPHNIA_ESTABLISHMENT_HOLD_POPULATION,
      daphniaEstablishmentHoldDescendants:
        DAPHNIA_ESTABLISHMENT_HOLD_DESCENDANTS,
      daphniaEstablishmentHoldAdultDescendants:
        DAPHNIA_ESTABLISHMENT_HOLD_ADULT_DESCENDANTS,
      daphniaEstablishmentRecentBirthSeconds:
        DAPHNIA_ESTABLISHMENT_RECENT_BIRTH_SECONDS,
      releaseRicefish: RELEASE_RICEFISH,
      ricefishReleaseCount: RICEFISH_RELEASE_COUNT,
      immortalRicefish: IMMORTAL_RICEFISH,
      ricefishReproductionDisabled: DISABLE_RICEFISH_REPRODUCTION,
      establishedPreset: {
        used: presetUsed,
        path: ESTABLISHED_PRESET_PATH,
      },
      continuationSave: {
        used: resumeUsed,
        path: RESUME_SAVE_PATH,
      },
      minimumSafeOxygen: MINIMUM_SAFE_OXYGEN,
      maximumSafeToxicWaste: MAXIMUM_SAFE_TOXIC_WASTE,
      ricefishGutEvacuationSeconds:
        mutableRicefishRules.gutEvacuationSeconds,
      ricefishSubadultGutEvacuationSeconds:
        mutableRicefishRules.subadultGutEvacuationSeconds,
      daphniaPhytoplanktonHalfSaturation:
        mutableDaphniaRules.phytoplanktonHalfSaturation,
      daphniaReproductionFood:
        mutableDaphniaRules.minimumFoodQualityForReproduction,
      daphniaHighFoodBrood:
        mutableDaphniaRules.highFoodBroodResponseThreshold,
      daphniaReproductionFoodResponseExponent:
        mutableDaphniaRules.reproductionFoodResponseExponent,
      daphniaReproductionAllocationPerSecondIndividual:
        mutableDaphniaRules.reproductionAllocationPerSecondIndividual,
      daphniaMaximumBroodSize:
        mutableDaphniaRules.maximumBroodSize,
      daphniaMinimumLifespanSeconds:
        mutableDaphniaRules.minimumLifespanSeconds,
      daphniaMaximumLifespanSeconds:
        mutableDaphniaRules.maximumLifespanSeconds,
      daphniaCueReproductionFood:
        mutableDaphniaRules.predatorCueMinimumFoodQualityForReproduction,
      daphniaCueHighFoodBrood:
        mutableDaphniaRules.predatorCueHighFoodBroodResponseThreshold,
      daphniaCueReproductionAllocationMultiplier:
        mutableDaphniaRules.predatorCueReproductionAllocationMultiplier,
      daphniaCueMaximumBroodSize:
        mutableDaphniaRules.predatorCueMaximumBroodSize,
    },
    fixture,
    runtime: {
      elapsedSeconds: snapshot.elapsedSeconds,
      ticks: guard,
      maximumTicks,
      abnormalReason,
      ricefishIntroducedAtSeconds,
      targetEndSeconds,
      postPredatorDurationSeconds: ricefishIntroducedAtSeconds === null
        ? null
        : snapshot.elapsedSeconds - ricefishIntroducedAtSeconds,
      establishmentPopulation,
      establishmentDescendants,
      establishmentAdultDescendants,
      establishmentSecondGeneration,
      establishmentStableSeconds,
      latestSecondGenerationDaphniaBirthSeconds:
        Number.isFinite(latestSecondGenerationDaphniaBirthSeconds)
          ? latestSecondGenerationDaphniaBirthSeconds
          : null,
      maximumPopulationObserved,
      trajectoryResults,
    },
    final: {
      population: finalPopulation,
      animalBiomass: finalSample?.animalBiomass ?? null,
      events: finalEvents,
      postReleaseEvents,
      vallisneria: finalSample?.vallisneria ?? null,
      producers: finalSample?.producers ?? null,
      microbes: finalSample?.microbes ?? null,
      water: finalSample?.water ?? null,
      waterExtremes,
      ricefishLifecycleEvents: observedEvents
        .filter((event) => event.speciesId === 'japanese-ricefish')
        .map((event) => ({
          sequence: event.sequence,
          kind: event.kind,
          elapsedSeconds: rounded(event.elapsedSeconds, 1),
          animalId: event.animalId,
          parentId: event.parentId,
          lifeStage: event.lifeStage,
          sex: event.sex,
          x: rounded(event.x, 1),
          y: rounded(event.y, 1),
          ageSeconds: rounded(event.ageSeconds, 1),
          energy: rounded(event.energy),
          cause: event.cause,
          localWater: event.water
            ? {
              oxygen: rounded(event.water.oxygen),
              toxicWaste: rounded(event.water.toxicWaste),
              organicMatter: rounded(event.water.organicMatter),
            }
            : null,
          localTemperature: event.temperature === null
            ? null
            : rounded(event.temperature),
        })),
    },
    acceptance: {
      passed: failed.length === 0,
      failedCount: failed.length,
      checks,
      observations,
    },
    samples,
  };
  if (SAVE_OUTPUT_PATH) {
    writeFileSync(
      resolve(SAVE_OUTPUT_PATH),
      JSON.stringify(world.exportSaveData()),
      'utf8',
    );
  }
  if (REPORT_OUTPUT_PATH) {
    writeFileSync(
      resolve(REPORT_OUTPUT_PATH),
      JSON.stringify(report, null, 2),
      'utf8',
    );
  }
  if (FORAGING_DIAGNOSTICS_OUTPUT_PATH) {
    writeFileSync(
      resolve(FORAGING_DIAGNOSTICS_OUTPUT_PATH),
      JSON.stringify({
        verification: 'mission-8-ricefish-foraging-diagnostics',
        intervalSeconds:
          REAL_TICK_SECONDS * 64 * OBSERVATION_BATCH_TICKS,
        intervals: foragingDiagnosticIntervals,
      }, null, 2),
      'utf8',
    );
  }
  if (!QUIET_OUTPUT) {
    console.log(JSON.stringify(report, null, 2));
  }
  if (failed.length > 0) process.exitCode = 1;
};

try {
  main();
} catch (error) {
  console.error(JSON.stringify({
    verification: 'mission-8-development-food-web',
    developmentAcceptanceOnly: true,
    passed: false,
    setupFailure: error instanceof Error
      ? `${error.name}: ${error.message}`
      : String(error),
  }, null, 2));
  process.exitCode = 1;
}
