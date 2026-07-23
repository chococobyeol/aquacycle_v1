import Matter, { type Body as MatterBody } from 'matter-js';
import {
  ALGAE_VISIBLE_BIOMASS,
  ANIMALS,
  initialWaterTemperatureForLight,
  MICROBE_ECOLOGY_RULES,
  MICROBES,
  SCENARIOS,
  SHRIMP_ECOLOGY_RULES,
  SPECIES,
  STRUCTURES,
  WATER_CYCLE_RULES,
  type ScenarioDefinition,
} from './config';
import {
  BiogeochemistryLedger,
  emptyBiofilm,
} from './biogeochemistry';
import { oxygenEquivalentInventory } from './stoichiometry';
import { FIXED_LAMP_WIDTH, FIXED_LAMP_X, FIXED_LAMP_Y } from './lightGeometry';
import { dayNightStateAt, type DayNightPhase, type DayNightState } from './dayNight';
import {
  algaePhysiology,
  clamp01,
  emptyBiomass,
  growthTrend,
  habitatSuitability,
  netGrowthPotential,
  occupied,
} from './growth';
import {
  sampleEcologyFace,
  sampleSubstrate,
  type LocalSurfaceCell,
} from './surfaces';
import {
  structureAuthoredPointToWorld,
  structureAuthoredPolygonToWorld,
} from './structureGeometry';
import {
  vallisneriaCanopyBounds,
  vallisneriaHitDistance,
  vallisneriaLeafPoint,
  vallisneriaLeaves,
} from './vallisneriaGeometry';
import {
  DEFAULT_SIMULATION_SPEED,
  normalizeSimulationSpeed,
  type SimulationSpeed,
} from './speed';
import {
  interpolateTemperatureResponse,
  thetaTemperatureFactor,
} from './temperatureResponse';
import {
  GROUND_Y,
  STRUCTURE_SUPPORT_Y,
  TANK_HEIGHT,
  TANK_WIDTH,
  WATER_TOP,
  type AnimalBehavior,
  type AnimalDeathCause,
  type AnimalLifeStage,
  type AnimalPopulationEventKind,
  type AnimalPopulationEventSnapshot,
  type AnimalPopulationEventTotals,
  type AnimalSnapshot,
  type BiofilmBiomass,
  type AnimalCarcassSnapshot,
  type AnimalSpeciesId,
  type HoldingSnapshot,
  type LightFieldSnapshot,
  type MeasurementKind,
  type MeasurementSnapshot,
  type MicrobeGuildId,
  type MissionOutcome,
  type MissionProgressSnapshot,
  type PlantLifeStage,
  type PlantRametSnapshot,
  type ProbeSnapshot,
  type ScenarioId,
  type SelectionFilter,
  type SeedSnapshot,
  type SelectionSnapshot,
  type SimulationCommand,
  type SimulationPhase,
  type SimulationSaveData,
  type SimulationSnapshot,
  type SpeciesBiomass,
  type SpeciesId,
  type StructureDefinitionId,
  type StructureSnapshot,
  type SurfaceCellSnapshot,
  type SurfaceKind,
  type Vec2,
} from './types';

const { Bodies, Body, Composite, Engine, Query, Sleeping, Vertices } = Matter;

interface SurfaceCellState extends LocalSurfaceCell {
  id: string;
  ownerId: string;
  ownerLabel: string;
  surfaceKind: SurfaceKind;
  index: number;
  light: number;
  biomass: SpeciesBiomass;
  biofilm: BiofilmBiomass;
  localNeighborIds: string[];
  neighborIds: string[];
}

interface StructureState {
  id: string;
  definitionId: StructureDefinitionId;
  body: MatterBody;
  cells: SurfaceCellState[];
  locked: boolean;
}

interface SeedPlacementState {
  id: string;
  speciesId: SpeciesId;
  cellId: string;
  locked: boolean;
  origin: 'supplied' | 'runner';
  /** Exact root point for macrophytes; ecology still belongs to cellId. */
  rootPosition?: Vec2;
  plant?: VallisneriaLifeState;
}

interface VallisneriaLifeState {
  parentId: string | null;
  connectedToParent: boolean;
  ageSeconds: number;
  lifespanSeconds: number;
  structuralScale: number;
  runnerProgress: number;
  reproductionCount: number;
  stressSeconds: number;
}

interface MeasurementState {
  id: string;
  kind: MeasurementKind;
  point: Vec2;
}

interface LightReflectionSource {
  bodyId: number;
  point: Vec2;
  lampCoefficient: number;
  daylightCoefficient: number;
}

interface LightReflectionPath {
  source: LightReflectionSource;
  transportFactor: number;
}

interface LightTransportPath {
  ambientBase: number;
  ambientLampCoefficient: number;
  lampCoefficient: number;
  daylightCoefficient: number;
  reflections: LightReflectionPath[];
}

interface VallisneriaCanopyOptics {
  plantId: string;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  leafOpticalDepth: number;
  leafSamples: Vec2[][];
}

interface HeldStructureState {
  kind: 'structure';
  source: 'inventory' | 'existing';
  structureId: string;
  offset: Vec2;
  valid: boolean;
  originPosition?: Vec2;
  originAngle?: number;
  originSleeping?: boolean;
}

interface HeldSeedState {
  kind: 'seed';
  source: 'inventory' | 'existing';
  speciesId: SpeciesId;
  seedId: string;
  candidateCellId: string | null;
  candidateRootPosition?: Vec2;
  valid: boolean;
  originCellId?: string;
  originBiomass?: number;
  originPlacement?: SeedPlacementState;
}

interface AnimalState {
  id: string;
  speciesId: AnimalSpeciesId;
  origin: 'supplied' | 'born';
  position: Vec2;
  velocity: Vec2;
  facing: -1 | 1;
  poseAngle: number;
  bodyLength: number;
  lifeStage: AnimalLifeStage;
  sex: 'female' | 'male';
  ageSeconds: number;
  lifespanSeconds: number;
  energy: number;
  structuralBiomass: number;
  storedBiomass: number;
  reproductiveBiomass: number;
  health: number;
  behavior: AnimalBehavior;
  behaviorTimer: number;
  targetCellId: string | null;
  nextTargetEvaluation: number;
  recentIntake: number;
  consumedBiomass: number;
  grazingSessionIntake: number;
  secondsSinceFood: number;
  growthProgress: number;
  reproductionCooldown: number;
  gestationRemaining: number | null;
  matingAccumulator: number;
  randomSeed: number;
}

interface AnimalCarcassState {
  id: string;
  sourceAnimalId: string;
  speciesId: AnimalSpeciesId;
  position: Vec2;
  facing: -1 | 1;
  poseAngle: number;
  bodyLength: number;
  lifeStage: AnimalLifeStage;
  cause: AnimalCarcassSnapshot['cause'];
  waterAtDeath: AnimalCarcassSnapshot['waterAtDeath'];
  temperatureAtDeath: number | null;
  ageSeconds: number;
}

interface HeldAnimalState {
  kind: 'animal';
  source: 'inventory' | 'existing';
  speciesId: AnimalSpeciesId;
  animalId: string;
  position: Vec2;
  valid: boolean;
  originState?: AnimalState;
}

interface HeldBiofilmState {
  kind: 'biofilm';
  source: 'inventory';
  guildId: MicrobeGuildId;
  candidateCellId: string | null;
  valid: boolean;
}

type HeldState = HeldStructureState | HeldSeedState | HeldAnimalState | HeldBiofilmState;

const LIGHT_COLUMNS = 36;
const LIGHT_ROWS = 20;
const AREA_LIGHT_SAMPLES = 5;
const AMBIENT_SKY_SAMPLES = 7;
const DIRECT_LIGHT_HALF_ANGLE = Math.PI * 0.49;
// Moving the physical source above the tank increases every ray distance.
// This calibrated scale preserves the existing mission light bands while the
// source geometry now truthfully lives outside the glass.
const DIRECT_LIGHT_SCALE = 2.85;
// Daylight is sampled across the whole open water surface. Even a point below
// an overhang receives some diffuse sky light, while a clear point receives
// nearly the configured daylight output instead of inheriting the lamp cone.
const NATURAL_LIGHT_SCALE = 0.9;
const REFLECTED_LIGHT_LIMIT = 6;

/**
 * Every visible light source enters the same transport calculation. Sources
 * differ only in geometry and emission properties; surfaces and organisms
 * receive the summed local irradiance and never branch on source kind.
 */
interface LightEmitter {
  id: 'ceiling-lamp' | 'daylight';
  samples: Vec2[];
  emissionScale: number;
  occludedTransmission: number;
  halfAngle?: number;
  angularExponent?: number;
  distanceScale?: number;
  distanceExponent?: number;
}
// Full ecology snapshots contain the complete surface and water grids. Motion
// has its own 30 Hz shared channel, so publishing this large immutable graph
// more than once per real second only churns V8 heap pages without making
// animals or settling stones look smoother.
const SNAPSHOT_INTERVAL_SECONDS = 1;
const PHYSICS_STEP_MS = 1000 / 60;
const MAX_PHYSICS_STEPS = 4;
const GROWTH_STEP_SECONDS = 0.25;
const ANIMAL_MOTION_STEP_SECONDS = 1 / 30;
const MAX_ANIMAL_MOTION_STEPS = 48;
// At fast-forward speeds the worker must not replay four ecology passes and
// thirty animal steering passes for every simulated second. The coarse steps
// are still short enough for the current growth, metabolism, and steering
// rates, while placing a strict upper bound on work done by a 100 ms worker
// tick (the largest delta accepted below).
const FAST_FORWARD_THRESHOLD = 32;
const FAST_GROWTH_STEP_SECONDS = 1;
const FAST_ANIMAL_MOTION_STEP_SECONDS = 0.1;
const MAX_FAST_GROWTH_STEPS = 7;
const MAX_FAST_ANIMAL_MOTION_STEPS = 65;
const growthStepSecondsForSpeed = (speed: SimulationSpeed): number =>
  speed >= FAST_FORWARD_THRESHOLD ? FAST_GROWTH_STEP_SECONDS : GROWTH_STEP_SECONDS;
const animalMotionStepSecondsForSpeed = (speed: SimulationSpeed): number =>
  speed >= FAST_FORWARD_THRESHOLD
    ? FAST_ANIMAL_MOTION_STEP_SECONDS
    : ANIMAL_MOTION_STEP_SECONDS;

const SETTLE_REQUIRED_SECONDS = 0.48;
const SEED_BIOMASS = 0.28;
const VALLISNERIA_JUVENILE_SECONDS = 360;
const VALLISNERIA_MIN_LIFESPAN_SECONDS = 2_400;
const VALLISNERIA_MAX_LIFESPAN_SECONDS = 3_300;
const VALLISNERIA_SENESCENCE_START_RATIO = 0.82;
const VALLISNERIA_RUNNER_INTERVAL_SECONDS = 600;
const VALLISNERIA_RUNNER_BIOMASS = 0.16;
const VALLISNERIA_RUNNER_MIN_DISTANCE = 42;
const VALLISNERIA_RUNNER_MAX_DISTANCE = 170;
const VALLISNERIA_LOW_RESERVE = 0.055;
const VALLISNERIA_LOW_RESERVE_GRACE_SECONDS = 150;
// A stolon stays connected through the daughter's juvenile establishment.
// Transfer is deliberately bounded and mass-conserving: it buffers a shaded
// daughter but cannot create biomass or drain the parent below its own reserve.
const VALLISNERIA_CLONAL_SUPPORT_PER_SECOND = 0.00055;
const VALLISNERIA_CLONAL_SUPPORT_TARGET = 0.22;
// Five-percent structural steps are visually/ecologically smooth at the
// 36×20 light-field resolution and avoid rebuilding the field for imperceptible
// sub-pixel leaf growth during fast-forward.
const VALLISNERIA_CANOPY_LIGHT_QUANTIZATION = 0.05;
const BIOFILM_INOCULUM_BIOMASS = 0.18;
const PICK_SEED_DISTANCE = 18;
const PICK_ANIMAL_DISTANCE = 28;
const SHRIMP_ADULT_LENGTH = 36;
const SHRIMP_JUVENILE_LENGTH = 14;
const SHRIMP_MATURITY_SECONDS = SHRIMP_ECOLOGY_RULES.maturationSeconds;
// Two real-world months are compressed to the 180-second maturation period.
// Keeping the same scale maps the observed 10–15 month life span to 15–22.5
// simulation minutes. A deterministic per-animal value prevents cohort-wide
// deaths while keeping replay results reproducible.
const SHRIMP_MIN_LIFESPAN_SECONDS = SHRIMP_ECOLOGY_RULES.minimumLifespanSeconds;
const SHRIMP_MAX_LIFESPAN_SECONDS = SHRIMP_ECOLOGY_RULES.maximumLifespanSeconds;
const SHRIMP_SUPPLIED_ADULT_MIN_AGE_SECONDS =
  SHRIMP_ECOLOGY_RULES.suppliedAdultMinimumAgeSeconds;
const SHRIMP_SUPPLIED_ADULT_MAX_AGE_SECONDS =
  SHRIMP_ECOLOGY_RULES.suppliedAdultMaximumAgeSeconds;
const SHRIMP_BASE_METABOLISM = SHRIMP_ECOLOGY_RULES.adultBaseMetabolismPerSecond;
const SHRIMP_WEAK_ENERGY = 0.18;
const SHRIMP_OXYGEN_STRESS_START = SHRIMP_ECOLOGY_RULES.oxygenStressStart;
const SHRIMP_TOXIC_STRESS_START = SHRIMP_ECOLOGY_RULES.toxicWasteStressStart;
const SHRIMP_TOXIC_STRESS_FULL = SHRIMP_ECOLOGY_RULES.toxicWasteFullStress;
const SHRIMP_WATER_RECOVERY_RATE = SHRIMP_ECOLOGY_RULES.healthyWaterRecoveryPerSecond;
const SHRIMP_FORAGE_START_ENERGY = 0.48;
const SHRIMP_FORAGE_STOP_ENERGY = 0.7;
// Grazing must remove enough visible algae for consumers to affect the tank.
// Intake itself stays on the density-dependent functional response below;
// survival is now determined by the conserved reserve/structure budget.
const SHRIMP_BITE_RATE = SHRIMP_ECOLOGY_RULES.maximumBiteBiomassPerSecond;
const SHRIMP_GRAZE_DISTANCE = 15;
// Target detection and ingestion are deliberately separate. Shrimp seek a
// visibly established patch instead of being distracted by every microscopic
// speck, while a shrimp already on a patch can keep grazing it continuously.
const SHRIMP_FOOD_TARGET_BIOMASS = 0.04;
// Ecology keeps trace film continuous instead of declaring an otherwise edible
// cell empty at 0.04 biomass. The existing half-saturation curve makes intake
// smoothly approach zero; this much smaller cutoff is only the point where the
// remaining film is mineralised into detritus rather than numerically stranded.
const SHRIMP_TRACE_GRAZABLE_BIOMASS = 0.0005;
const SHRIMP_GRAZING_HALF_SATURATION = 0.02;
const SHRIMP_LOCAL_FOOD_RADIUS = 64;
// A hungry shrimp samples a somewhat wider nearby area, never the whole tank.
// Longer-range discovery happens only through ordinary exploratory movement.
const SHRIMP_EMERGENCY_FOOD_RADIUS = 180;
const SHRIMP_EMERGENCY_SEARCH_ENERGY = 0.35;
const SHRIMP_GRAZING_BOUT_BIOMASS = 1.4;
// After a feeding bout, shrimp visibly leave the feeding surface before they
// are allowed to seek food again. Reusing behaviorTimer keeps this a simple
// graze -> roam -> forage state transition rather than a per-cell memory model.
const SHRIMP_POST_GRAZE_ROAM_MIN_SECONDS = 2.5;
const SHRIMP_POST_GRAZE_ROAM_VARIANCE_SECONDS = 1.5;
// In a healthy tank adults settle near 0.5 energy. Reproduction is therefore
// gated by current reserve and recent access to food rather than a hidden
// population-capacity formula.
const SHRIMP_REPRODUCTION_ENERGY = SHRIMP_ECOLOGY_RULES.reproductionEnergy;
// The visible 0..1 condition is derived from conserved animal matter instead
// of being a second, independently drained hunger tank. Reserve and expendable
// structure therefore pay maintenance, growth, and reproduction exactly once.
const SHRIMP_MINIMUM_VIABLE_STRUCTURE_RATIO = 0.22;
// The condition meter is reserve-led. Healthy structure contributes a small
// baseline, but it is not treated as ordinary stored food; structure is only
// catabolised after reserve is gone during true starvation.
// A newly supplied adult carries 0.08 reserve and should begin at roughly
// 0.36 condition: hungry enough to forage, but not biologically exhausted.
const SHRIMP_STRUCTURE_CONDITION_SHARE = 0.28;
const SHRIMP_RESERVE_CONDITION_SHARE = 1 - SHRIMP_STRUCTURE_CONDITION_SHARE;
const SHRIMP_ENERGY_CAPACITY_PER_STRUCTURAL_BIOMASS =
  WATER_CYCLE_RULES.shrimp.assimilationFraction /
  SHRIMP_ECOLOGY_RULES.energyPerConsumedBiomass;
const SHRIMP_NEW_ADULT_REPRODUCTION_COOLDOWN = 120;
const SHRIMP_MINIMUM_BROOD_BIOMASS =
  WATER_CYCLE_RULES.shrimp.juvenileBirthBiomass *
  SHRIMP_ECOLOGY_RULES.minimumClutchSize;
const SHRIMP_MAXIMUM_BROOD_BIOMASS =
  WATER_CYCLE_RULES.shrimp.juvenileBirthBiomass *
  SHRIMP_ECOLOGY_RULES.maximumClutchSize;
// Adult females gradually allocate feeding surplus to eggs instead of needing
// the complete clutch to appear in ordinary reserve at a single instant.
const SHRIMP_REPRODUCTIVE_SOMATIC_RESERVE_FLOOR = 0.16;
// Mating is a local encounter, not a tank-wide lookup. The radius is wider
// than the grazing contact distance to stand in for short-range chemical and
// tactile cues without revealing animals elsewhere in the aquarium.
const SHRIMP_MATING_ENCOUNTER_RADIUS = 140;
const SHRIMP_MATING_SECONDS = 3;
const SHRIMP_GESTATION_SECONDS = 75;
const SHRIMP_POST_BROOD_COOLDOWN = 160;
const SHRIMP_MALE_POST_MATING_COOLDOWN = 45;
const SHRIMP_CARCASS_LIFETIME_SECONDS = 55;
const MAX_ANIMAL_POPULATION_EVENTS = 240;
// This is not an ecological carrying capacity. It is only a last-resort guard
// against allocating an unbounded clutch after a corrupted/extreme run. Under
// normal rules, food depletion and mortality must limit the population first.
export const SHRIMP_TECHNICAL_POPULATION_LIMIT = 2_048;
// Ecology faces are inset from the collision hull. A short propagule bridge also
// lets colonies cross the shaded contact seam between physically touching rocks.
const CROSS_SURFACE_DISTANCE = 48;
const MAX_CROSS_SURFACE_NEIGHBORS = 4;

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const distanceSquared = (a: Vec2, b: Vec2): number => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
};

const cloneBiomass = (biomass: SpeciesBiomass): SpeciesBiomass => ({
  oedogonium: biomass.oedogonium,
  nitzschia: biomass.nitzschia,
  vallisneria: biomass.vallisneria ?? 0,
});

const emptyAnimalPopulationEventTotals = (): AnimalPopulationEventTotals => ({
  introduced: 0,
  removed: 0,
  births: 0,
  maturations: 0,
  deaths: 0,
  deathsByCause: {
    starvation: 0,
    'old-age': 0,
    hypoxia: 0,
    toxicity: 0,
    temperature: 0,
  },
});

const cloneAnimalState = (animal: AnimalState): AnimalState => ({
  ...animal,
  position: { ...animal.position },
  velocity: { ...animal.velocity },
});

const deterministicNoise = (seed: number): number => {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
};

const deterministicStringSeed = (value: string): number => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const countByDefinition = (
  structures: StructureState[],
  definitionId: StructureDefinitionId,
): number => structures.filter((structure) => structure.definitionId === definitionId).length;

export class SimulationWorld {
  private engine = Engine.create({ enableSleeping: true });
  private scenario: ScenarioDefinition = SCENARIOS['mission-1'];
  private phase: SimulationPhase = 'setup';
  private outcome: MissionOutcome = 'pending';
  private outcomeAtSeconds: number | null = null;
  private structures: StructureState[] = [];
  private substrateCells: SurfaceCellState[] = [];
  private boundaries: MatterBody[] = [];
  private structureCounter = 0;
  private seedCounter = 0;
  private animalCounter = 0;
  private measurementCounter = 0;
  private elapsedSeconds = 0;
  private speed: SimulationSpeed = DEFAULT_SIMULATION_SPEED;
  private hasStarted = false;
  private allSettled = true;
  private settleAccumulator = 0;
  private physicsAccumulator = 0;
  private growthAccumulator = 0;
  private animalMotionAccumulator = 0;
  private snapshotAccumulator = 0;
  private snapshotDirty = true;
  private successHoldAccumulator = 0;
  private revision = 0;
  private held: HeldState | null = null;
  private pointer: Vec2 = { x: TANK_WIDTH / 2, y: WATER_TOP + 120 };
  private probe: ProbeSnapshot | null = null;
  private measurements: MeasurementState[] = [];
  private selection: SelectionSnapshot | null = null;
  private seedPlacements: SeedPlacementState[] = [];
  private animals: AnimalState[] = [];
  private carcasses: AnimalCarcassState[] = [];
  private animalPopulationEvents: AnimalPopulationEventSnapshot[] = [];
  private animalPopulationEventTotals = emptyAnimalPopulationEventTotals();
  private animalPopulationEventSequence = 0;
  private totalAlgaeConsumed = 0;
  private animalInventoryUsed: Record<AnimalSpeciesId, number> = { 'cherry-shrimp': 0 };
  private microbeInventoryUsed: Record<MicrobeGuildId, number> = {
    decomposer: 0,
    nitrifier: 0,
  };
  private suspendedBiofilm: BiofilmBiomass = emptyBiofilm();
  private biofilmSettlementCursor = 0;
  private materialReference: {
    nitrogen: number;
    carbon: number;
    oxygenEquivalent: number;
  } | null = null;
  private biogeochemistry = new BiogeochemistryLedger();
  private lightOutput = 90;
  private naturalLightOutput = 0;
  private dayNightEnabled = false;
  private appliedDayNightMultiplier = 1;
  private appliedDayNightPhase: DayNightPhase | null = null;
  private waterTemperature = 23.5;
  private lightDirty = true;
  private lightTransportDirty = true;
  private canopyLightSignature = '';
  private crossConnectionsDirty = true;
  private lightRevision = 0;
  private lightField: LightFieldSnapshot = {
    columns: LIGHT_COLUMNS,
    rows: LIGHT_ROWS,
    values: Array.from({ length: LIGHT_COLUMNS * LIGHT_ROWS }, () => 0),
    revision: 0,
  };
  private lightEmitters: LightEmitter[] = [];
  private lightReflectionSources: LightReflectionSource[] = [];
  private lightTransportCache = new Map<string, LightTransportPath>();
  private vallisneriaCanopyOptics: VallisneriaCanopyOptics[] = [];
  private canopyTransmissionCache = new Map<string, number>();
  private message = '목록에서 구조물과 생물을 꺼내 수조를 구성하세요.';

  public constructor(scenarioId: ScenarioId = 'mission-1') {
    this.initialize(scenarioId);
  }

  public initialize(scenarioId: ScenarioId): void {
    this.scenario = SCENARIOS[scenarioId];
    this.engine = Engine.create({ enableSleeping: true });
    this.engine.gravity.x = 0;
    this.engine.gravity.y = 1;
    this.engine.gravity.scale = 0.0012;
    this.phase = 'setup';
    this.outcome = 'pending';
    this.outcomeAtSeconds = null;
    this.structures = [];
    this.substrateCells = this.createSubstrateCells();
    this.structureCounter = 0;
    this.seedCounter = 0;
    this.animalCounter = 0;
    this.measurementCounter = 0;
    this.elapsedSeconds = 0;
    this.speed = DEFAULT_SIMULATION_SPEED;
    this.hasStarted = false;
    this.allSettled = true;
    this.settleAccumulator = 0;
    this.physicsAccumulator = 0;
    this.growthAccumulator = 0;
    this.animalMotionAccumulator = 0;
    this.snapshotAccumulator = 0;
    this.snapshotDirty = true;
    this.successHoldAccumulator = 0;
    this.held = null;
    this.pointer = { x: TANK_WIDTH / 2, y: WATER_TOP + 120 };
    this.probe = null;
    this.measurements = [];
    this.selection = null;
    this.seedPlacements = [];
    this.animals = [];
    this.carcasses = [];
    this.animalPopulationEvents = [];
    this.animalPopulationEventTotals = emptyAnimalPopulationEventTotals();
    this.animalPopulationEventSequence = 0;
    this.totalAlgaeConsumed = 0;
    this.animalInventoryUsed = { 'cherry-shrimp': 0 };
    this.microbeInventoryUsed = { decomposer: 0, nitrifier: 0 };
    this.suspendedBiofilm = emptyBiofilm();
    this.biofilmSettlementCursor = 0;
    this.materialReference = null;
    this.lightOutput = this.scenario.lightOutput;
    this.naturalLightOutput = this.scenario.naturalLightOutput;
    this.dayNightEnabled = this.scenario.dayNightCycleInitiallyEnabled;
    const initialDayNight = this.currentDayNightState();
    this.appliedDayNightMultiplier = initialDayNight?.lightMultiplier ?? 1;
    this.appliedDayNightPhase = initialDayNight?.phase ?? null;
    // A tank is presented after its configured sources have already been on,
    // so begin near their well-mixed thermal equilibrium instead of making
    // every mission spend its short time limit warming from room temperature.
    this.waterTemperature = initialWaterTemperatureForLight(
      this.lightOutput + this.naturalLightOutput * this.appliedDayNightMultiplier,
    );
    this.biogeochemistry = new BiogeochemistryLedger({
      effectsEnabled: Boolean(this.scenario.waterCycle),
      initial: this.scenario.waterCycle?.initial,
      initialTemperature: this.waterTemperature,
    });
    this.lightDirty = true;
    this.lightTransportDirty = true;
    this.canopyLightSignature = '';
    this.lightReflectionSources = [];
    this.lightTransportCache.clear();
    this.vallisneriaCanopyOptics = [];
    this.canopyTransmissionCache.clear();
    this.crossConnectionsDirty = true;
    this.message = '목록에서 구조물과 생물을 꺼내 수조를 구성하세요.';

    this.boundaries = [
      Bodies.rectangle(TANK_WIDTH / 2, STRUCTURE_SUPPORT_Y + 58, TANK_WIDTH + 120, 116, {
        isStatic: true,
        label: 'boundary:ground',
        friction: 1,
      }),
      Bodies.rectangle(-30, TANK_HEIGHT / 2, 60, TANK_HEIGHT, {
        isStatic: true,
        label: 'boundary:left',
      }),
      Bodies.rectangle(TANK_WIDTH + 30, TANK_HEIGHT / 2, 60, TANK_HEIGHT, {
        isStatic: true,
        label: 'boundary:right',
      }),
    ];
    Composite.add(this.engine.world, this.boundaries);
    this.rebuildCrossConnections();
    this.recomputeLight();
  }

  public handle(command: SimulationCommand): void {
    switch (command.type) {
      case 'initialize':
        this.initialize(command.scenarioId);
        break;
      case 'start':
        this.start();
        break;
      case 'pause':
        this.pause();
        break;
      case 'resume':
        this.resume();
        break;
      case 'reset':
        this.initialize(this.scenario.id);
        break;
      case 'load-save':
        this.loadSaveData(command.data);
        break;
      case 'export-save':
        break;
      case 'set-speed': {
        const nextSpeed = normalizeSimulationSpeed(command.speed);
        if (nextSpeed !== this.speed) {
          // Both accumulators contain unprocessed simulation seconds, not a
          // unitless phase. Keep those seconds intact when the numerical step
          // size changes; rescaling would silently create time on 1x -> 64x
          // and discard time on 64x -> 1x.
          this.speed = nextSpeed;
          this.snapshotDirty = true;
        }
        break;
      }
      case 'pointer-move':
        this.movePointer(command.point);
        break;
      case 'pick-structure':
        if (command.point) this.pointer = this.clampPointer(command.point);
        this.pickStructureFromInventory(command.definitionId);
        break;
      case 'pick-seed':
        if (command.point) this.pointer = this.clampPointer(command.point);
        this.pickSeedFromInventory(command.speciesId);
        break;
      case 'pick-animal':
        if (command.point) this.pointer = this.clampPointer(command.point);
        this.pickAnimalFromInventory(command.speciesId);
        break;
      case 'pick-biofilm':
        if (command.point) this.pointer = this.clampPointer(command.point);
        this.pickBiofilmFromInventory(command.guildId);
        break;
      case 'pick-at':
        this.pickExistingAt(command.point);
        break;
      case 'hold-structure':
        this.holdExistingStructure(command.id, command.point);
        break;
      case 'rotate-structure':
        this.rotateStructure(command.id, command.radians);
        break;
      case 'select-at':
        this.selectAt(command.point, command.filter);
        break;
      case 'select-region':
        this.selectRegion(command.from, command.to, command.filter);
        break;
      case 'select-measurement':
        this.selectMeasurement(command.id);
        break;
      case 'clear-selection':
        this.selection = null;
        break;
      case 'drop-held':
        this.dropHeld(command.point);
        break;
      case 'cancel-held':
        this.cancelHeld();
        break;
      case 'retrieve-held':
        this.retrieveHeldSeed();
        break;
      case 'rotate-held':
        this.rotateHeld(command.radians);
        break;
      case 'probe':
        this.setProbe(command.point);
        break;
      case 'place-measurement':
        this.placeMeasurement(command.kind, command.point);
        break;
      case 'remove-measurement':
        this.removeMeasurement(command.id);
        break;
      case 'clear-probe':
        this.probe = null;
        break;
      case 'remove-held-structure':
        this.retrieveHeldStructure();
        break;
      case 'retrieve-structure':
        this.retrieveStructure(command.id);
        break;
      case 'retrieve-animal':
        this.retrieveAnimal(command.id);
        break;
      case 'remove-selected-algae':
        this.removeSelectedAlgae(command.speciesId);
        break;
      case 'set-light-output':
        if (this.scenario.mode === 'laboratory' && this.canEdit()) {
          this.lightOutput = clamp(command.output, 0, 120);
          this.lightDirty = true;
          if (this.allSettled && !this.held) this.recomputeLight();
        }
        break;
      case 'set-natural-light-output':
        if (this.scenario.mode === 'laboratory' && this.canEdit()) {
          this.naturalLightOutput = clamp(command.output, 0, 120);
          this.lightDirty = true;
          if (this.allSettled && !this.held) this.recomputeLight();
        }
        break;
      case 'set-day-night-enabled':
        if (
          this.scenario.mode === 'laboratory' &&
          this.scenario.dayNightCycle &&
          this.canEdit()
        ) {
          this.dayNightEnabled = command.enabled;
          const state = this.currentDayNightState();
          this.appliedDayNightMultiplier = state?.lightMultiplier ?? 1;
          this.appliedDayNightPhase = state?.phase ?? null;
          this.lightDirty = true;
          if (this.allSettled && !this.held) this.recomputeLight();
        }
        break;
      default:
        command satisfies never;
    }
  }

  public tick(realDeltaSeconds: number): boolean {
    const deltaSeconds = Math.min(0.1, Math.max(0, realDeltaSeconds));
    const canRunPhysics =
      !this.held &&
      this.structures.some(({ body }) => !body.isStatic && !body.isSleeping);

    if (canRunPhysics) {
      this.physicsAccumulator += deltaSeconds;
      let steps = 0;
      while (this.physicsAccumulator >= PHYSICS_STEP_MS / 1000 && steps < MAX_PHYSICS_STEPS) {
        Engine.update(this.engine, PHYSICS_STEP_MS);
        this.physicsAccumulator -= PHYSICS_STEP_MS / 1000;
        steps += 1;
      }
      if (steps === MAX_PHYSICS_STEPS) this.physicsAccumulator = 0;
    } else {
      this.physicsAccumulator = 0;
    }

    const wasSettled = this.allSettled;
    this.updateSettledState(deltaSeconds);
    if (!wasSettled && this.allSettled) {
      this.crossConnectionsDirty = true;
      this.rebuildCrossConnections();
      if (this.lightDirty) this.recomputeLight();
    }

    if (this.phase === 'running') {
      const simulationDeltaSeconds = deltaSeconds * this.speed;
      const fastForward = this.speed >= FAST_FORWARD_THRESHOLD;
      const animalMotionStepSeconds = animalMotionStepSecondsForSpeed(this.speed);
      const maxAnimalMotionSteps = fastForward
        ? MAX_FAST_ANIMAL_MOTION_STEPS
        : MAX_ANIMAL_MOTION_STEPS;
      const growthStepSeconds = growthStepSecondsForSpeed(this.speed);
      const maxGrowthSteps = fastForward ? MAX_FAST_GROWTH_STEPS : Number.POSITIVE_INFINITY;
      let animalMotionSteps = 0;
      let growthSteps = 0;
      let remainingSimulationSeconds = simulationDeltaSeconds;

      // Advance both clocks on one timeline. Running all steering first and all
      // ecology second made high speed depend on batch size: a shrimp could
      // spend several simulated seconds in a stale grazing state before any
      // food was removed. Interleaving the due events preserves the same causal
      // order at 1x, 16x, and 64x.
      while (remainingSimulationSeconds > 1e-10) {
        const untilMotion = animalMotionSteps < maxAnimalMotionSteps
          ? Math.max(0, animalMotionStepSeconds - this.animalMotionAccumulator)
          : Number.POSITIVE_INFINITY;
        const untilGrowth = growthSteps < maxGrowthSteps
          ? Math.max(0, growthStepSeconds - this.growthAccumulator)
          : Number.POSITIVE_INFINITY;
        const advanceSeconds = Math.min(
          remainingSimulationSeconds,
          untilMotion,
          untilGrowth,
        );

        if (advanceSeconds > 1e-10) {
          this.animalMotionAccumulator += advanceSeconds;
          this.growthAccumulator += advanceSeconds;
          remainingSimulationSeconds -= advanceSeconds;
        }

        let processedEvent = false;
        if (
          animalMotionSteps < maxAnimalMotionSteps &&
          this.animalMotionAccumulator + 1e-10 >= animalMotionStepSeconds
        ) {
          this.animalMotionAccumulator -= animalMotionStepSeconds;
          if (Math.abs(this.animalMotionAccumulator) < 1e-10) this.animalMotionAccumulator = 0;
          this.stepAnimalMotion(animalMotionStepSeconds);
          animalMotionSteps += 1;
          processedEvent = true;
        }
        if (
          growthSteps < maxGrowthSteps &&
          this.growthAccumulator + 1e-10 >= growthStepSeconds
        ) {
          this.growthAccumulator -= growthStepSeconds;
          if (Math.abs(this.growthAccumulator) < 1e-10) this.growthAccumulator = 0;
          this.elapsedSeconds += growthStepSeconds;
          this.updateDayNightLighting();
          if (this.lightDirty) this.recomputeLight();
          this.biogeochemistry.beginStep(growthStepSeconds);
          this.stepTemperature(growthStepSeconds);
          this.stepGrowth(growthStepSeconds);
          this.stepVallisneriaLifecycle(growthStepSeconds);
          this.stepAnimalEcology(growthStepSeconds);
          this.stepBiofilmDispersal(growthStepSeconds);
          this.resolveBiogeochemistry(growthStepSeconds);
          this.evaluateMission(growthStepSeconds);
          growthSteps += 1;
          processedEvent = true;
        }

        if (!processedEvent) {
          // Only a sub-epsilon remainder or an intentionally exhausted safety
          // budget can reach here. Preserve it in both accumulators for the next
          // worker tick instead of dropping simulated time.
          this.animalMotionAccumulator += remainingSimulationSeconds;
          this.growthAccumulator += remainingSimulationSeconds;
          remainingSimulationSeconds = 0;
        }
      }
    } else {
      this.animalMotionAccumulator = 0;
    }

    this.snapshotAccumulator += deltaSeconds;
    if (
      this.snapshotAccumulator >= SNAPSHOT_INTERVAL_SECONDS &&
      (this.phase === 'running' || this.snapshotDirty)
    ) {
      // Keep the fractional remainder. Resetting to zero makes a nominal 1 Hz
      // cadence drift toward 0.9 Hz with 60/10 Hz timer quantisation.
      this.snapshotAccumulator -= SNAPSHOT_INTERVAL_SECONDS;
      if (Math.abs(this.snapshotAccumulator) < 1e-10) this.snapshotAccumulator = 0;
      return true;
    }
    return false;
  }

  public snapshot(): SimulationSnapshot {
    this.refreshColonySelection();
    const cells = this.surfaceSnapshots();
    const eligibleCells = cells.filter((cell) => cell.targetEligible);
    const totalBiomass = cells.reduce<SpeciesBiomass>(
      (total, cell) => ({
        oedogonium: total.oedogonium + cell.biomass.oedogonium,
        nitzschia: total.nitzschia + cell.biomass.nitzschia,
        vallisneria: total.vallisneria + cell.biomass.vallisneria,
      }),
      emptyBiomass(),
    );
    const coverageRatio = eligibleCells.length
      ? eligibleCells.filter((cell) => occupied(cell.biomass)).length / eligibleCells.length
      : 0;
    const biogeochemistry = this.biogeochemistry.snapshot();
    biogeochemistry.biofilmTotals = cells.reduce<BiofilmBiomass>((total, cell) => ({
      decomposer: total.decomposer + cell.biofilm.decomposer,
      nitrifier: total.nitrifier + cell.biofilm.nitrifier,
    }), emptyBiofilm());
    const materialTotals = this.computeMaterialTotals();
    const reference = this.materialReference;
    biogeochemistry.materialBalance = {
      totalNitrogen: materialTotals.nitrogen,
      totalCarbon: materialTotals.carbon,
      oxygenEquivalent: materialTotals.oxygenEquivalent,
      referenceNitrogen: reference?.nitrogen ?? null,
      referenceCarbon: reference?.carbon ?? null,
      referenceOxygenEquivalent: reference?.oxygenEquivalent ?? null,
      nitrogenDriftRatio: reference && reference.nitrogen > 0
        ? (materialTotals.nitrogen - reference.nitrogen) / reference.nitrogen
        : 0,
      carbonDriftRatio: reference && reference.carbon > 0
        ? (materialTotals.carbon - reference.carbon) / reference.carbon
        : 0,
      oxygenEquivalentDriftRatio: reference &&
        Math.abs(reference.oxygenEquivalent) > 1e-9
        ? (materialTotals.oxygenEquivalent - reference.oxygenEquivalent) /
          Math.abs(reference.oxygenEquivalent)
        : 0,
    };

    this.revision += 1;
    this.snapshotDirty = false;
    return {
      scenarioId: this.scenario.id,
      mode: this.scenario.mode,
      phase: this.phase,
      outcome: this.outcome,
      outcomeAtSeconds: this.outcomeAtSeconds,
      currentTargetMet: this.currentTargetMet(),
      elapsedSeconds: this.elapsedSeconds,
      timeLimitSeconds: this.scenario.timeLimitSeconds,
      speed: this.speed,
      allSettled: this.allSettled,
      hasStarted: this.hasStarted,
      lightOutput: this.lightOutput,
      naturalLightOutput: this.naturalLightOutput,
      dayNightEnabled: this.dayNightEnabled,
      dayNight: this.currentDayNightSnapshot(),
      waterTemperature: this.waterTemperature,
      structures: this.structureSnapshots(),
      cells,
      seeds: this.seedSnapshots(),
      plants: this.plantSnapshots(),
      animals: this.animalSnapshots(),
      carcasses: this.carcassSnapshots(),
      holding: this.holdingSnapshot(),
      lightField: {
        columns: this.lightField.columns,
        rows: this.lightField.rows,
        values: [...this.lightField.values],
        revision: this.lightField.revision,
      },
      probe: this.probe ? { ...this.probe, trends: { ...this.probe.trends } } : null,
      measurements: this.measurementSnapshots(),
      selection: this.selection ? { ...this.selection } : null,
      remainingSeeds: {
        oedogonium: this.remainingSeeds('oedogonium'),
        nitzschia: this.remainingSeeds('nitzschia'),
        vallisneria: this.remainingSeeds('vallisneria'),
      },
      remainingAnimals: {
        'cherry-shrimp': this.remainingAnimals('cherry-shrimp'),
      },
      remainingMicrobes: {
        decomposer: this.remainingMicrobes('decomposer'),
        nitrifier: this.remainingMicrobes('nitrifier'),
      },
      remainingStructures: {
        'flat-stone': this.remainingStructures('flat-stone'),
        'round-stone': this.remainingStructures('round-stone'),
        'tall-stone': this.remainingStructures('tall-stone'),
      },
      totalBiomass,
      totalAlgaeConsumed: this.totalAlgaeConsumed,
      animalPopulation: {
        'cherry-shrimp': this.animalPopulation('cherry-shrimp'),
      },
      animalPopulationEvents: this.animalPopulationEvents.map((event) => ({
        ...event,
        water: event.water ? { ...event.water } : null,
      })),
      animalPopulationEventTotals: {
        ...this.animalPopulationEventTotals,
        deathsByCause: { ...this.animalPopulationEventTotals.deathsByCause },
      },
      biogeochemistry,
      coverageRatio,
      missionProgress: this.missionProgress(coverageRatio),
      message: this.message,
      revision: this.revision,
    };
  }

  public motionSnapshot(): {
    structures: StructureSnapshot[];
    animals: AnimalSnapshot[];
    holding: HoldingSnapshot | null;
    probe: ProbeSnapshot | null;
  };
  public motionSnapshot(reuse: {
    structures: StructureSnapshot[];
    animals: AnimalSnapshot[];
    holding: HoldingSnapshot | null;
    probe: ProbeSnapshot | null;
  }): {
    structures: StructureSnapshot[];
    animals: AnimalSnapshot[];
    holding: HoldingSnapshot | null;
    probe: ProbeSnapshot | null;
  };
  public motionSnapshot(reuse?: {
    structures: StructureSnapshot[];
    animals: AnimalSnapshot[];
    holding: HoldingSnapshot | null;
    probe: ProbeSnapshot | null;
  }): {
    structures: StructureSnapshot[];
    animals: AnimalSnapshot[];
    holding: HoldingSnapshot | null;
    probe: ProbeSnapshot | null;
  } {
    const target = reuse ?? {
      structures: [],
      animals: [],
      holding: null,
      probe: null,
    };
    target.structures = this.structureSnapshots(target.structures);
    target.animals = this.animalSnapshots(target.animals);
    target.holding = this.holdingSnapshot();
    target.probe = this.probe ? { ...this.probe, trends: { ...this.probe.trends } } : null;
    return target;
  }

  public exportSaveData(): SimulationSaveData {
    return {
      version: 1,
      scenarioId: this.scenario.id,
      savedPhase: this.phase,
      outcome: this.outcome,
      outcomeAtSeconds: this.outcomeAtSeconds,
      elapsedSeconds: this.elapsedSeconds,
      speed: this.speed,
      hasStarted: this.hasStarted,
      allSettled: this.allSettled,
      successHoldAccumulator: this.successHoldAccumulator,
      structureCounter: this.structureCounter,
      seedCounter: this.seedCounter,
      animalCounter: this.animalCounter,
      measurementCounter: this.measurementCounter,
      lightOutput: this.lightOutput,
      naturalLightOutput: this.naturalLightOutput,
      dayNightEnabled: this.dayNightEnabled,
      waterTemperature: this.waterTemperature,
      structures: this.structures.map((structure) => ({
        id: structure.id,
        definitionId: structure.definitionId,
        x: structure.body.position.x,
        y: structure.body.position.y,
        angle: structure.body.angle,
        vx: structure.body.velocity.x,
        vy: structure.body.velocity.y,
        angularVelocity: structure.body.angularVelocity,
        isSleeping: structure.body.isSleeping,
        locked: structure.locked,
        cells: structure.cells.map((cell) => ({
          id: cell.id,
          biomass: { ...cell.biomass },
          biofilm: { ...cell.biofilm },
        })),
      })),
      substrateCells: this.substrateCells.map((cell) => ({
        id: cell.id,
        biomass: { ...cell.biomass },
        biofilm: { ...cell.biofilm },
      })),
      seedPlacements: this.seedPlacements.map((placement) => ({
        ...placement,
        rootPosition: placement.rootPosition ? { ...placement.rootPosition } : undefined,
        plant: placement.plant ? { ...placement.plant } : undefined,
      })),
      animals: this.animals.map((animal) => cloneAnimalState(animal)),
      carcasses: this.carcasses.map((carcass) => ({
        ...carcass,
        position: { ...carcass.position },
        waterAtDeath: carcass.waterAtDeath ? { ...carcass.waterAtDeath } : null,
      })),
      measurements: this.measurements.map((measurement) => ({
        ...measurement,
        point: { ...measurement.point },
      })),
      animalPopulationEvents: this.animalPopulationEvents.map((event) => ({
        ...event,
        water: event.water ? { ...event.water } : null,
      })),
      animalPopulationEventTotals: {
        ...this.animalPopulationEventTotals,
        deathsByCause: { ...this.animalPopulationEventTotals.deathsByCause },
      },
      animalPopulationEventSequence: this.animalPopulationEventSequence,
      totalAlgaeConsumed: this.totalAlgaeConsumed,
      animalInventoryUsed: { ...this.animalInventoryUsed },
      microbeInventoryUsed: { ...this.microbeInventoryUsed },
      suspendedBiofilm: { ...this.suspendedBiofilm },
      biofilmSettlementCursor: this.biofilmSettlementCursor,
      materialReference: this.materialReference ? { ...this.materialReference } : null,
      biogeochemistry: this.biogeochemistry.exportSaveState(),
    };
  }

  public loadSaveData(data: SimulationSaveData): void {
    if (data.version !== 1) throw new Error('지원하지 않는 냉동 수조 형식입니다.');
    this.initialize(data.scenarioId);

    this.outcome = data.outcome;
    this.outcomeAtSeconds = data.outcomeAtSeconds;
    this.elapsedSeconds = Math.max(0, data.elapsedSeconds);
    this.speed = normalizeSimulationSpeed(data.speed);
    this.hasStarted = data.hasStarted;
    // A thawed tank always opens paused so no ecology time passes while the
    // player is still orienting themselves after loading.
    this.phase = data.hasStarted ? 'paused' : 'setup';
    this.allSettled = data.allSettled;
    this.successHoldAccumulator = Math.max(0, data.successHoldAccumulator);
    this.lightOutput = data.lightOutput;
    this.naturalLightOutput = data.naturalLightOutput ?? this.scenario.naturalLightOutput;
    this.dayNightEnabled = data.dayNightEnabled ?? this.scenario.dayNightCycleInitiallyEnabled;
    const restoredDayNight = this.currentDayNightState();
    this.appliedDayNightMultiplier = restoredDayNight?.lightMultiplier ?? 1;
    this.appliedDayNightPhase = restoredDayNight?.phase ?? null;
    this.waterTemperature = data.waterTemperature;

    for (const saved of data.structures) {
      const structure = this.createStructure(
        saved.definitionId,
        saved.x,
        saved.y,
        saved.angle,
        saved.locked,
        saved.id,
      );
      Body.setPosition(structure.body, { x: saved.x, y: saved.y });
      Body.setAngle(structure.body, saved.angle);
      Body.setVelocity(structure.body, { x: saved.vx, y: saved.vy });
      Body.setAngularVelocity(structure.body, saved.angularVelocity);
      Sleeping.set(structure.body, saved.isSleeping);
      const savedCells = new Map(saved.cells.map((cell) => [cell.id, cell]));
      for (const cell of structure.cells) {
        const restored = savedCells.get(cell.id);
        if (!restored) continue;
        cell.biomass = cloneBiomass(restored.biomass);
        cell.biofilm = { ...restored.biofilm };
      }
    }
    const savedSubstrate = new Map(data.substrateCells.map((cell) => [cell.id, cell]));
    for (const cell of this.substrateCells) {
      const restored = savedSubstrate.get(cell.id);
      if (!restored) continue;
      cell.biomass = cloneBiomass(restored.biomass);
      cell.biofilm = { ...restored.biofilm };
    }

    this.structureCounter = Math.max(this.structureCounter, data.structureCounter);
    this.seedCounter = data.seedCounter;
    this.animalCounter = data.animalCounter;
    this.measurementCounter = data.measurementCounter;
    this.seedPlacements = data.seedPlacements.map((placement) => {
      const origin = placement.origin ?? 'supplied';
      return {
        ...placement,
        origin,
        rootPosition: placement.rootPosition ? { ...placement.rootPosition } : undefined,
        plant: placement.speciesId === 'vallisneria'
          ? placement.plant
            ? {
              ...placement.plant,
              connectedToParent: placement.plant.connectedToParent ?? (
                placement.plant.parentId !== null &&
                placement.plant.ageSeconds < VALLISNERIA_JUVENILE_SECONDS
              ),
            }
            : this.createVallisneriaLifeState(placement.id, origin, null)
          : undefined,
      };
    });
    this.animals = data.animals.map((animal) => cloneAnimalState({
      ...animal,
      reproductiveBiomass: animal.reproductiveBiomass ?? 0,
    }));
    this.carcasses = data.carcasses.map((carcass) => ({
      ...carcass,
      position: { ...carcass.position },
      waterAtDeath: carcass.waterAtDeath ? { ...carcass.waterAtDeath } : null,
      temperatureAtDeath: carcass.temperatureAtDeath ?? null,
    }));
    this.measurements = data.measurements.map((measurement) => ({
      ...measurement,
      point: { ...measurement.point },
    }));
    this.animalPopulationEvents = data.animalPopulationEvents.map((event) => ({
      ...event,
      water: event.water ? { ...event.water } : null,
      temperature: event.temperature ?? null,
    }));
    this.animalPopulationEventTotals = {
      ...data.animalPopulationEventTotals,
      deathsByCause: {
        ...data.animalPopulationEventTotals.deathsByCause,
        temperature: data.animalPopulationEventTotals.deathsByCause.temperature ?? 0,
      },
    };
    this.animalPopulationEventSequence = data.animalPopulationEventSequence;
    this.totalAlgaeConsumed = data.totalAlgaeConsumed;
    this.animalInventoryUsed = { ...data.animalInventoryUsed };
    this.microbeInventoryUsed = { ...data.microbeInventoryUsed };
    this.suspendedBiofilm = { ...data.suspendedBiofilm };
    this.biofilmSettlementCursor = data.biofilmSettlementCursor;
    this.biogeochemistry.restoreSaveState(data.biogeochemistry, data.waterTemperature);
    const restoredTotals = this.computeMaterialTotals();
    this.materialReference = data.materialReference
      ? {
        nitrogen: data.materialReference.nitrogen,
        carbon: data.materialReference.carbon,
        oxygenEquivalent:
          data.materialReference.oxygenEquivalent ?? restoredTotals.oxygenEquivalent,
      }
      : null;
    this.waterTemperature = this.biogeochemistry.averageTemperature();

    this.held = null;
    this.probe = null;
    this.selection = null;
    this.pointer = { x: TANK_WIDTH / 2, y: WATER_TOP + 120 };
    this.settleAccumulator = 0;
    this.physicsAccumulator = 0;
    this.growthAccumulator = 0;
    this.animalMotionAccumulator = 0;
    this.snapshotAccumulator = 0;
    this.revision = 0;
    this.crossConnectionsDirty = true;
    this.lightDirty = true;
    this.lightTransportDirty = true;
    this.canopyLightSignature = '';
    this.rebuildCrossConnections();
    this.recomputeLight();
    this.snapshotDirty = true;
    this.message = data.hasStarted
      ? '냉동 수조를 해동했습니다. 일시정지 상태에서 이어서 관찰할 수 있습니다.'
      : '배치 중이던 냉동 수조를 해동했습니다.';
  }

  public hasActiveMotion(): boolean {
    return Boolean(this.held) || (this.phase === 'running' && this.animals.length > 0) || this.structures.some(
      ({ body }) => !body.isStatic && !body.isSleeping,
    );
  }

  private computeMaterialTotals(): {
    nitrogen: number;
    carbon: number;
    oxygenEquivalent: number;
  } {
    const water = this.biogeochemistry.materialState();
    const surfaceBiomass = this.allCells().reduce((sum, cell) => sum +
      cell.biomass.oedogonium + cell.biomass.nitzschia + cell.biomass.vallisneria +
      cell.biofilm.decomposer + cell.biofilm.nitrifier, 0);
    const animalBiomass = this.animals.reduce(
      (sum, animal) => sum + animal.structuralBiomass +
        animal.storedBiomass + animal.reproductiveBiomass,
      0,
    );
    const suspended = this.suspendedBiofilm.decomposer + this.suspendedBiofilm.nitrifier;
    const biologicalMatter = water.organicMatter + water.detritus +
      surfaceBiomass + animalBiomass + suspended;
    const organicCarbon = biologicalMatter * WATER_CYCLE_RULES.biomassCarbon;
    return {
      nitrogen: water.toxicWaste + water.nutrients +
        biologicalMatter * WATER_CYCLE_RULES.biomassNitrogen,
      carbon: water.dissolvedInorganicCarbon + water.headspaceCarbonDioxide +
        organicCarbon,
      oxygenEquivalent: oxygenEquivalentInventory({
        totalOxygen: water.dissolvedOxygen + water.headspaceOxygen,
        organicCarbon,
        nitrateNitrogen: water.nutrients,
      }),
    };
  }

  private createSubstrateCells(): SurfaceCellState[] {
    const sampled = sampleSubstrate();
    const ids = sampled.map((_, index) => `substrate:cell-${index}`);
    return sampled.map((cell, index) => ({
      ...cell,
      id: ids[index],
      ownerId: 'substrate',
      ownerLabel: '바닥재',
      surfaceKind: 'substrate',
      index,
      light: 0,
      biomass: emptyBiomass(),
      biofilm: emptyBiofilm(),
      localNeighborIds: cell.neighborIndices.map((neighbor) => ids[neighbor]),
      neighborIds: cell.neighborIndices.map((neighbor) => ids[neighbor]),
    }));
  }

  private createStructure(
    definitionId: StructureDefinitionId,
    x: number,
    y: number,
    angle = 0,
    locked = false,
    restoredId?: string,
  ): StructureState {
    const definition = STRUCTURES[definitionId];
    const options: Matter.IChamferableBodyDefinition = {
      label: `structure:${definitionId}`,
      angle,
      friction: definition.friction,
      frictionStatic: 1,
      frictionAir: 0.032,
      restitution: 0.025,
      sleepThreshold: 28,
    };
    const collisionHull = Vertices.hull(
      definition.collisionPolygon.map((point) => ({ ...point })) as Matter.Vertex[],
    );
    const body = Bodies.fromVertices(
      x,
      y,
      [collisionHull],
      options,
      true,
    );
    Body.setDensity(body, definition.density);
    Body.setAngle(body, angle);

    const id = restoredId ?? `structure-${++this.structureCounter}`;
    if (restoredId) {
      const restoredCounter = Number.parseInt(restoredId.replace(/^structure-/, ''), 10);
      if (Number.isFinite(restoredCounter)) {
        this.structureCounter = Math.max(this.structureCounter, restoredCounter);
      }
    }
    body.label = `structure:${id}`;
    const sampled = sampleEcologyFace(definition);
    const cellIds = sampled.map((_, index) => `${id}:cell-${index}`);
    const structure: StructureState = {
      id,
      definitionId,
      body,
      locked,
      cells: sampled.map((cell, index) => ({
        ...cell,
        id: cellIds[index],
        ownerId: id,
        ownerLabel: definition.label,
        surfaceKind: 'structure-face',
        index,
        light: 0,
        biomass: emptyBiomass(),
        biofilm: emptyBiofilm(),
        localNeighborIds: cell.neighborIndices.map((neighbor) => cellIds[neighbor]),
        neighborIds: cell.neighborIndices.map((neighbor) => cellIds[neighbor]),
      })),
    };
    this.structures.push(structure);
    Composite.add(this.engine.world, body);
    this.crossConnectionsDirty = true;
    this.lightDirty = true;
    this.lightTransportDirty = true;
    return structure;
  }

  private pickStructureFromInventory(definitionId: StructureDefinitionId): void {
    if (!this.canEdit() || this.held || !this.scenario.allowedStructures.includes(definitionId)) return;
    const remaining = this.remainingStructures(definitionId);
    if (remaining !== null && remaining <= 0) {
      this.message = '이 구조물은 모두 사용했습니다. 놓인 돌을 클릭해 옮기거나 회수하세요.';
      return;
    }
    const structure = this.createStructure(definitionId, this.pointer.x, this.pointer.y);
    Body.setStatic(structure.body, true);
    this.held = {
      kind: 'structure',
      source: 'inventory',
      structureId: structure.id,
      offset: { x: 0, y: 0 },
      valid: true,
    };
    this.selection = {
      kind: 'structure',
      x: structure.body.position.x,
      y: structure.body.position.y,
      ownerLabel: STRUCTURES[definitionId].label,
      structureId: structure.id,
    };
    this.constrainHeldStructure(structure);
    this.updateHeldStructureValidity(structure);
    this.allSettled = false;
    this.message = `${STRUCTURES[definitionId].label}이 커서에 붙었습니다. 위치를 정한 뒤 클릭해 놓으세요.`;
  }

  private pickSeedFromInventory(speciesId: SpeciesId): void {
    if (!this.canEdit() || this.held || !this.scenario.allowedSpecies.includes(speciesId)) return;
    const remaining = this.remainingSeeds(speciesId);
    if (remaining !== null && remaining <= 0) {
      this.message = '접종체를 모두 사용했습니다. 기존 접종 표시를 클릭해 이동하거나 회수하세요.';
      return;
    }
    this.held = {
      kind: 'seed',
      source: 'inventory',
      speciesId,
      seedId: `seed-${++this.seedCounter}`,
      candidateCellId: null,
      candidateRootPosition: undefined,
      valid: false,
    };
    this.updateHeldSeedCandidate(this.pointer);
    this.selection = null;
    this.message = `${SPECIES[speciesId].shortName} 접종체가 선택되었습니다. 돌 앞면이나 바닥재에 놓으세요.`;
  }

  private pickAnimalFromInventory(speciesId: AnimalSpeciesId): void {
    if (!this.canEdit() || this.held || !this.scenario.allowedAnimals.includes(speciesId)) return;
    const remaining = this.remainingAnimals(speciesId);
    if (remaining !== null && remaining <= 0) {
      this.message = '지급된 체리새우는 모두 수조에 방류했습니다.';
      return;
    }
    const position = this.clampAnimalPoint(this.pointer);
    this.held = {
      kind: 'animal',
      source: 'inventory',
      speciesId,
      animalId: `animal-${++this.animalCounter}`,
      position,
      valid: true,
    };
    this.pointer = position;
    this.selection = null;
    this.message = `${ANIMALS[speciesId].displayName}가 커서에 붙었습니다. 수중의 원하는 위치에 놓으세요.`;
  }

  private pickBiofilmFromInventory(guildId: MicrobeGuildId): void {
    if (
      !this.canInoculateBiofilm() ||
      this.held ||
      !this.scenario.waterCycle?.allowedMicrobes.includes(guildId)
    ) return;
    const remaining = this.remainingMicrobes(guildId);
    if (remaining !== null && remaining <= 0) {
      this.message = '이 균 접종체는 모두 사용했습니다.';
      return;
    }
    this.held = {
      kind: 'biofilm',
      source: 'inventory',
      guildId,
      candidateCellId: null,
      valid: false,
    };
    this.updateHeldBiofilmCandidate(this.pointer);
    this.selection = null;
    this.message = `${MICROBES[guildId].displayName} 접종체가 선택되었습니다. 부착할 표면을 고르세요.`;
    this.snapshotDirty = true;
  }

  private pickExistingAt(point: Vec2): void {
    if (!this.canEdit() || this.held) return;
    this.pointer = this.clampPointer(point);

    const nearestMeasurement = this.measurements.reduce<{
      measurement: MeasurementState;
      distance: number;
    } | null>((nearest, measurement) => {
      const distance = Math.sqrt(distanceSquared(this.pointer, measurement.point));
      return !nearest || distance < nearest.distance ? { measurement, distance } : nearest;
    }, null);
    if (nearestMeasurement && nearestMeasurement.distance <= 30) {
      this.selectMeasurement(nearestMeasurement.measurement.id);
      this.message = '측정점을 선택했습니다. 아래 편집 도구에서 회수할 수 있습니다.';
      return;
    }

    if (!this.hasStarted) {
      const seed = this.nearestSeed(this.pointer);
      if (seed && seed.distance <= PICK_SEED_DISTANCE) {
        const placementIndex = this.seedPlacements.findIndex((item) => item.id === seed.placement.id);
        const placement = this.seedPlacements[placementIndex];
        const originCell = this.cellById(placement.cellId);
        const originBiomass = originCell?.biomass[placement.speciesId] ?? 0;
        this.seedPlacements.splice(placementIndex, 1);
        const sameSpeciesRemains = this.seedPlacements.some((item) =>
          item.cellId === placement.cellId && item.speciesId === placement.speciesId,
        );
        if (originCell && !sameSpeciesRemains) originCell.biomass[placement.speciesId] = 0;
        this.held = {
          kind: 'seed',
          source: 'existing',
          speciesId: placement.speciesId,
          seedId: placement.id,
          candidateCellId: placement.cellId,
          candidateRootPosition: placement.rootPosition
            ? { ...placement.rootPosition }
            : originCell
              ? this.vallisneriaRootPosition(placement, originCell)
              : undefined,
          valid: true,
          originCellId: placement.cellId,
          originBiomass,
          originPlacement: {
            ...placement,
            rootPosition: placement.rootPosition ? { ...placement.rootPosition } : undefined,
            plant: placement.plant ? { ...placement.plant } : undefined,
          },
        };
        this.selection = null;
        this.message = '접종체를 옮기는 중입니다. 클릭해 다시 놓거나 회수할 수 있습니다.';
        return;
      }
    }

    const nearestAnimal = this.nearestAnimal(this.pointer);
    if (nearestAnimal && nearestAnimal.distance <= PICK_ANIMAL_DISTANCE) {
      const animal = nearestAnimal.animal;
      this.animals = this.animals.filter((candidate) => candidate.id !== animal.id);
      this.held = {
        kind: 'animal',
        source: 'existing',
        speciesId: animal.speciesId,
        animalId: animal.id,
        position: { ...animal.position },
        valid: true,
        originState: cloneAnimalState(animal),
      };
      this.selection = null;
      this.message = `${ANIMALS[animal.speciesId].displayName}를 옮기는 중입니다. 다시 클릭하면 놓습니다.`;
      return;
    }

    const hits = Query.point(this.structures.map((structure) => structure.body), this.pointer);
    const body = hits.at(-1);
    const structure = body
      ? this.structures.find((item) => item.body.id === body.id)
      : undefined;
    if (!structure) {
      this.message = '옮길 구조물이나 접종 표시를 클릭하세요.';
      return;
    }
    if (structure.locked) {
      this.message = '고정 접종 기반은 이 도전에서 옮길 수 없습니다.';
      return;
    }
    this.selection = {
      kind: 'structure',
      x: structure.body.position.x,
      y: structure.body.position.y,
      ownerLabel: STRUCTURES[structure.definitionId].label,
      structureId: structure.id,
    };
    this.message = `${STRUCTURES[structure.definitionId].label}을 선택했습니다. 이동·회전·삭제 동작을 고르세요.`;
    this.snapshotDirty = true;
  }

  private holdExistingStructure(id: string, point?: Vec2): void {
    if (!this.canEdit() || this.held) return;
    const structure = this.structureById(id);
    if (!structure || structure.locked) return;
    const originPosition = { ...structure.body.position };
    const originAngle = structure.body.angle;
    const originSleeping = structure.body.isSleeping;
    this.pointer = this.clampPointer(point ?? originPosition);
    Body.setStatic(structure.body, true);
    Body.setPosition(structure.body, this.pointer);
    this.held = {
      kind: 'structure',
      source: 'existing',
      structureId: structure.id,
      // Moving starts from the visual center, so the object does not jump to
      // an arbitrary edge based on where its selection click landed.
      offset: { x: 0, y: 0 },
      valid: true,
      originPosition,
      originAngle,
      originSleeping,
    };
    this.selection = {
      kind: 'structure',
      x: structure.body.position.x,
      y: structure.body.position.y,
      ownerLabel: STRUCTURES[structure.definitionId].label,
      structureId: structure.id,
    };
    this.constrainHeldStructure(structure);
    this.updateHeldStructureValidity(structure);
    this.allSettled = false;
    this.message = `${STRUCTURES[structure.definitionId].label}을 옮기는 중입니다. 휠이나 Q/E로 돌리고 클릭해 놓으세요.`;
    this.snapshotDirty = true;
  }

  private selectAt(point: Vec2, filter: SelectionFilter): void {
    const exact = this.clampPointer(point);
    if (filter === 'measurement' || filter === 'all') {
      const nearestMeasurement = this.measurements.reduce<{
        measurement: MeasurementState;
        distance: number;
      } | null>((nearest, measurement) => {
        const distance = Math.sqrt(distanceSquared(exact, measurement.point));
        return !nearest || distance < nearest.distance ? { measurement, distance } : nearest;
      }, null);
      if (nearestMeasurement && nearestMeasurement.distance <= 30) {
        this.selectMeasurement(nearestMeasurement.measurement.id);
        return;
      }
      if (filter === 'measurement') {
        this.clearSelectionWithMessage('이 위치에는 설치된 측정점이 없습니다.');
        return;
      }
    }

    if (filter === 'organism' || filter === 'all') {
      const nearestAnimal = this.nearestAnimal(exact);
      const nearestCarcass = this.nearestCarcass(exact);
      const animalHit = nearestAnimal &&
        nearestAnimal.distance <= this.animalHitRadius(nearestAnimal.animal)
        ? nearestAnimal
        : null;
      const carcassHit = nearestCarcass &&
        nearestCarcass.distance <= this.carcassHitRadius(nearestCarcass.carcass)
        ? nearestCarcass
        : null;
      if (animalHit && (!carcassHit || animalHit.distance <= carcassHit.distance)) {
        const animal = animalHit.animal;
        this.selection = {
          kind: 'animal',
          ...animal.position,
          ownerLabel: ANIMALS[animal.speciesId].displayName,
          animalId: animal.id,
        };
        this.message = `${ANIMALS[animal.speciesId].displayName}를 선택했습니다.`;
        return;
      }
      if (carcassHit) {
        const carcass = carcassHit.carcass;
        this.selection = {
          kind: 'carcass',
          ...carcass.position,
          ownerLabel: `${ANIMALS[carcass.speciesId].displayName} · 죽은 개체`,
          carcassId: carcass.id,
        };
        this.message = `${ANIMALS[carcass.speciesId].displayName}의 사체를 선택했습니다.`;
        return;
      }
      const plantHit = this.nearestVallisneria(exact);
      // Strap leaves are visually thin; a generous water-space tolerance
      // makes the whole rosette easy to inspect without demanding pixel-perfect clicks.
      if (plantHit && plantHit.distance <= 22) {
        const cell = this.cellById(plantHit.placement.cellId);
        if (cell) {
          this.selection = {
            kind: 'colony',
            ...exact,
            ownerLabel: '나사말 포기',
            cellId: cell.id,
            plantId: plantHit.placement.id,
            speciesId: 'vallisneria',
            speciesIds: ['vallisneria'],
            microbeGuildIds: [],
          };
          this.message = '나사말 포기를 선택했습니다. 잎·저장량·러너 상태를 관찰할 수 있습니다.';
          return;
        }
      }
      const nearest = this.nearestCell(exact);
      if (nearest && nearest.distance <= Math.max(13, nearest.cell.cellSize * 1.55)) {
        const biomass = nearest.cell.biomass;
        const speciesIds = (Object.keys(biomass) as SpeciesId[])
          .filter((speciesId) => biomass[speciesId] > ALGAE_VISIBLE_BIOMASS);
        const microbeGuildIds = (['decomposer', 'nitrifier'] as const)
          .filter((guildId) => nearest.cell.biofilm[guildId] >= 0.001);
        if (speciesIds.length || microbeGuildIds.length) {
          const speciesId = speciesIds.length
            ? [...speciesIds].sort((a, b) => biomass[b] - biomass[a])[0]
            : undefined;
          const location = this.cellWorldPoint(nearest.cell);
          this.selection = {
            kind: 'colony',
            ...location,
            ownerLabel: `${nearest.cell.ownerLabel} 표면`,
            cellId: nearest.cell.id,
            speciesId,
            speciesIds,
            microbeGuildIds,
          };
          this.message = speciesId
            ? `${SPECIES[speciesId].shortName} 군락과 같은 표면의 생태를 선택했습니다.`
            : `${nearest.cell.ownerLabel}의 균 필름을 선택했습니다.`;
          return;
        }
      }
      if (filter === 'organism') {
        this.clearSelectionWithMessage('이 위치에는 선택할 수 있는 군락이 없습니다.');
        return;
      }
    }

    if (filter === 'structure' || filter === 'all') {
      const hits = Query.point(this.structures.map((structure) => structure.body), exact);
      const body = hits.at(-1);
      const structure = body
        ? this.structures.find((item) => item.body.id === body.id)
        : undefined;
      if (structure) {
        this.selection = {
          kind: 'structure',
          x: structure.body.position.x,
          y: structure.body.position.y,
          ownerLabel: STRUCTURES[structure.definitionId].label,
          structureId: structure.id,
        };
        this.message = `${STRUCTURES[structure.definitionId].label}을 선택했습니다.`;
        return;
      }
      if (filter === 'structure') {
        this.clearSelectionWithMessage('이 위치에는 선택할 수 있는 구조물이 없습니다.');
        return;
      }
    }
    this.clearSelectionWithMessage('이 위치에는 선택할 수 있는 대상이 없습니다.');
  }

  /**
   * A colony selection follows a surface cell, not a historical species label.
   * The selected Vallisneria ramet can die while diatoms later occupy the same
   * cell; retaining its old plant/species metadata made the inspector describe
   * an organism that no longer existed.
   */
  private refreshColonySelection(): void {
    const selection = this.selection;
    if (selection?.kind !== 'colony' || !selection.cellId) return;

    const cell = this.cellById(selection.cellId);
    if (!cell) {
      this.selection = null;
      return;
    }

    const speciesIds = (Object.keys(cell.biomass) as SpeciesId[])
      .filter((speciesId) => cell.biomass[speciesId] > ALGAE_VISIBLE_BIOMASS);
    const microbeGuildIds = (['decomposer', 'nitrifier'] as const)
      .filter((guildId) => cell.biofilm[guildId] >= 0.001);
    const activePlant = selection.plantId
      ? this.seedPlacements.find((placement) =>
        placement.id === selection.plantId &&
        placement.speciesId === 'vallisneria' &&
        Boolean(placement.plant) &&
        cell.biomass.vallisneria > 0.004)
      : undefined;
    const speciesId = activePlant
      ? 'vallisneria'
      : selection.speciesId && speciesIds.includes(selection.speciesId)
        ? selection.speciesId
        : [...speciesIds].sort((first, second) =>
          cell.biomass[second] - cell.biomass[first])[0];
    const point = activePlant
      ? this.vallisneriaRootPosition(activePlant, cell)
      : this.cellWorldPoint(cell);

    this.selection = {
      ...selection,
      ...point,
      ownerLabel: activePlant ? '나사말 포기' : `${cell.ownerLabel} 표면`,
      plantId: activePlant?.id,
      speciesId,
      speciesIds,
      microbeGuildIds,
    };
  }

  private selectRegion(from: Vec2, to: Vec2, filter: SelectionFilter): void {
    const start = this.clampPointer(from);
    const end = this.clampPointer(to);
    const bounds = {
      minX: Math.min(start.x, end.x),
      minY: Math.min(start.y, end.y),
      maxX: Math.max(start.x, end.x),
      maxY: Math.max(start.y, end.y),
    };
    const cellsInBounds = (filter === 'organism' || filter === 'all')
      ? this.allCells().filter((cell) => {
      const point = this.cellWorldPoint(cell);
      const algae = cell.biomass.oedogonium + cell.biomass.nitzschia + cell.biomass.vallisneria;
      const microbes = cell.biofilm.decomposer + cell.biofilm.nitrifier;
      return (algae > ALGAE_VISIBLE_BIOMASS || microbes >= 0.001) &&
        point.x >= bounds.minX && point.x <= bounds.maxX &&
        point.y >= bounds.minY && point.y <= bounds.maxY;
      })
      : [];
    const plantCells = (filter === 'organism' || filter === 'all')
      ? this.seedPlacements.flatMap((placement) => {
        if (placement.speciesId !== 'vallisneria' || !placement.plant) return [];
        const cell = this.cellById(placement.cellId);
        if (!cell || cell.biomass.vallisneria <= 0.004) return [];
        const canopy = vallisneriaCanopyBounds(
          cell.index,
          this.cellWorldPoint(cell),
          placement.plant.structuralScale,
        );
        const intersects = canopy.maxX >= bounds.minX && canopy.minX <= bounds.maxX &&
          canopy.maxY >= bounds.minY && canopy.minY <= bounds.maxY;
        return intersects ? [cell] : [];
      })
      : [];
    const cells = Array.from(new Map(
      [...cellsInBounds, ...plantCells].map((cell) => [cell.id, cell]),
    ).values());
    const animals = (filter === 'organism' || filter === 'all')
      ? this.animals.filter((animal) =>
      animal.position.x >= bounds.minX && animal.position.x <= bounds.maxX &&
      animal.position.y >= bounds.minY && animal.position.y <= bounds.maxY)
      : [];
    const structures = (filter === 'structure' || filter === 'all')
      ? Query.region(this.structures.map((structure) => structure.body), {
        min: { x: bounds.minX, y: bounds.minY },
        max: { x: bounds.maxX, y: bounds.maxY },
      }).flatMap((body) => this.structures.filter((structure) => structure.body.id === body.id))
      : [];
    const measurements = (filter === 'measurement' || filter === 'all')
      ? this.measurements.filter(({ point }) =>
        point.x >= bounds.minX && point.x <= bounds.maxX &&
        point.y >= bounds.minY && point.y <= bounds.maxY)
      : [];
    if (!cells.length && !animals.length && !structures.length && !measurements.length) {
      this.clearSelectionWithMessage('선택 영역 안에 관찰할 대상이 없습니다.');
      return;
    }
    const totals = cells.reduce<SpeciesBiomass>((sum, cell) => ({
      oedogonium: sum.oedogonium + cell.biomass.oedogonium,
      nitzschia: sum.nitzschia + cell.biomass.nitzschia,
      vallisneria: sum.vallisneria + cell.biomass.vallisneria,
    }), emptyBiomass());
    const speciesIds = (Object.keys(totals) as SpeciesId[])
      .filter((speciesId) => totals[speciesId] > ALGAE_VISIBLE_BIOMASS);
    const speciesId = [...speciesIds].sort((a, b) => totals[b] - totals[a])[0];
    const microbeGuildIds = (['decomposer', 'nitrifier'] as const).filter((guildId) =>
      cells.some((cell) => cell.biofilm[guildId] >= 0.001));
    const summaryParts = [
      structures.length ? `구조물 ${structures.length}` : '',
      measurements.length ? `측정점 ${measurements.length}` : '',
      animals.length ? `새우 ${animals.length}` : '',
      cells.length ? `표면 ${cells.length}` : '',
    ].filter(Boolean);
    this.selection = {
      kind: 'region',
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2,
      ownerLabel: `선택 영역 · ${summaryParts.join(' · ')}`,
      speciesId,
      speciesIds,
      microbeGuildIds,
      cellIds: cells.map((cell) => cell.id),
      animalIds: animals.map((animal) => animal.id),
      structureIds: structures.map((structure) => structure.id),
      measurementIds: measurements.map((measurement) => measurement.id),
      bounds,
    };
    this.message = `영역 안에서 ${summaryParts.join(', ')}을 선택했습니다.`;
  }

  private selectMeasurement(id: string): void {
    const measurement = this.measurements.find((item) => item.id === id);
    if (!measurement) return;
    this.selection = {
      kind: 'measurement',
      ...measurement.point,
      ownerLabel: measurement.kind === 'light'
        ? '광량 측정점'
        : measurement.kind === 'temperature'
          ? '수온 측정점'
          : '수질 측정점',
      measurementId: measurement.id,
    };
    this.message = `${this.selection.ownerLabel}을 선택했습니다.`;
  }

  private clearSelectionWithMessage(message: string): void {
    this.selection = null;
    this.message = message;
  }

  private movePointer(point: Vec2): void {
    this.pointer = this.clampPointer(point);
    if (!this.held) return;
    if (this.held.kind === 'structure') {
      const structure = this.structureById(this.held.structureId);
      if (!structure) return;
      Body.setPosition(structure.body, {
        x: this.pointer.x + this.held.offset.x,
        y: this.pointer.y + this.held.offset.y,
      });
      Body.setVelocity(structure.body, { x: 0, y: 0 });
      Body.setAngularVelocity(structure.body, 0);
      this.constrainHeldStructure(structure);
      this.updateHeldStructureValidity(structure);
    } else if (this.held.kind === 'seed') {
      this.updateHeldSeedCandidate(this.pointer);
    } else if (this.held.kind === 'biofilm') {
      this.updateHeldBiofilmCandidate(this.pointer);
    } else {
      this.held.position = this.clampAnimalPoint(this.pointer);
      this.held.valid = this.isAnimalPlacementPoint(this.held.position);
    }
  }

  private dropHeld(point: Vec2): void {
    if (!this.held || !this.canPlaceHeld(this.held)) return;
    this.movePointer(point);
    if (!this.held.valid) {
      const held = this.held;
      const duplicateSeed = held.kind === 'seed' && held.candidateCellId
        ? this.seedPlacements.some((placement) =>
          placement.cellId === held.candidateCellId && placement.speciesId === held.speciesId,
        )
        : false;
      this.message = held.kind === 'structure'
        ? '다른 돌과 깊이 겹치지 않는 수조 안쪽 위치를 선택하세요.'
        : held.kind === 'animal'
          ? '체리새우는 수면 아래와 바닥 위의 수중에 놓아야 합니다.'
        : held.kind === 'biofilm'
          ? '균 필름은 돌의 보이는 앞면이나 바닥재 표면에 접종해야 합니다.'
        : duplicateSeed
          ? '이 표면에는 같은 조류가 이미 접종되어 있습니다. 다른 지점을 선택하세요.'
          : '접종체는 돌의 보이는 앞면이나 바닥재 표면에 놓아야 합니다.';
      return;
    }

    if (this.held.kind === 'structure') {
      const structure = this.structureById(this.held.structureId);
      if (!structure) return;
      Body.setStatic(structure.body, false);
      Sleeping.set(structure.body, false);
      this.held = null;
      this.wakeStructuresAfterTopologyChange();
      this.lightDirty = true;
      this.lightTransportDirty = true;
      this.crossConnectionsDirty = true;
      this.message = '돌을 놓았습니다. 중력과 접점에 따라 자연스럽게 안착하는 중입니다.';
      return;
    }

    if (this.held.kind === 'animal') {
      const heldAnimal = this.held;
      const restored = heldAnimal.source === 'existing' && heldAnimal.originState
        ? {
          ...cloneAnimalState(heldAnimal.originState),
          position: { ...heldAnimal.position },
          velocity: { x: 0, y: 0 },
          behavior: 'resting' as AnimalBehavior,
          targetCellId: null,
        }
        : this.createAdultAnimalState(
          heldAnimal.animalId,
          heldAnimal.speciesId,
          heldAnimal.position,
          'supplied',
        );
      this.animals.push(restored);
      if (heldAnimal.source === 'inventory') {
        this.animalInventoryUsed[heldAnimal.speciesId] += 1;
        if (this.hasStarted) this.recordAnimalPopulationEvent('introduced', restored);
      }
      this.held = null;
      this.message = `${ANIMALS[restored.speciesId].displayName}를 수조에 놓았습니다.`;
      this.snapshotDirty = true;
      return;
    }

    if (this.held.kind === 'biofilm') {
      const heldBiofilm = this.held;
      const cell = heldBiofilm.candidateCellId
        ? this.cellById(heldBiofilm.candidateCellId)
        : undefined;
      if (!cell) return;
      const total = cell.biofilm.decomposer + cell.biofilm.nitrifier;
      const available = Math.max(0, 1 - total);
      const inoculum = Math.min(BIOFILM_INOCULUM_BIOMASS, available);
      cell.biofilm[heldBiofilm.guildId] += inoculum;
      if (
        this.hasStarted &&
        this.scenario.mode === 'challenge' &&
        this.materialReference
      ) {
        this.materialReference.nitrogen += inoculum * WATER_CYCLE_RULES.biomassNitrogen;
        this.materialReference.carbon += inoculum * WATER_CYCLE_RULES.biomassCarbon;
        this.materialReference.oxygenEquivalent -=
          inoculum * WATER_CYCLE_RULES.biomassCarbon *
          WATER_CYCLE_RULES.oxygenPerOrganicCarbon;
      }
      this.microbeInventoryUsed[heldBiofilm.guildId] += 1;
      this.held = null;
      this.message = `${MICROBES[heldBiofilm.guildId].displayName}을 접종했습니다.`;
      this.snapshotDirty = true;
      return;
    }

    const heldSeed = this.held;
    const cellId = heldSeed.candidateCellId;
    const cell = cellId ? this.cellById(cellId) : undefined;
    if (!cell || !cellId) return;
    cell.biomass[heldSeed.speciesId] = Math.max(cell.biomass[heldSeed.speciesId], SEED_BIOMASS);
    this.seedPlacements.push(heldSeed.originPlacement
      ? {
        ...heldSeed.originPlacement,
        cellId,
        rootPosition: heldSeed.speciesId === 'vallisneria'
          ? heldSeed.candidateRootPosition
            ? { ...heldSeed.candidateRootPosition }
            : undefined
          : heldSeed.originPlacement.rootPosition,
        plant: heldSeed.originPlacement.plant
          ? { ...heldSeed.originPlacement.plant }
          : undefined,
      }
      : this.createSeedPlacement(
        heldSeed.seedId,
        heldSeed.speciesId,
        cellId,
        'supplied',
        null,
        heldSeed.candidateRootPosition,
      ));
    this.held = null;
    if (heldSeed.speciesId === 'vallisneria') {
      this.lightDirty = true;
      if (this.allSettled) this.recomputeLight();
    }
    this.message = `${SPECIES[heldSeed.speciesId].shortName} 접종 위치를 정했습니다.`;
  }

  private cancelHeld(): void {
    if (!this.held) return;
    if (this.held.kind === 'structure') {
      const held = this.held;
      const structure = this.structureById(held.structureId);
      if (structure) {
        if (held.source === 'inventory') {
          this.removeStructure(structure);
        } else if (held.originPosition && held.originAngle !== undefined) {
          Body.setPosition(structure.body, held.originPosition);
          Body.setAngle(structure.body, held.originAngle);
          Body.setStatic(structure.body, false);
          Body.setVelocity(structure.body, { x: 0, y: 0 });
          Body.setAngularVelocity(structure.body, 0);
          Sleeping.set(structure.body, held.originSleeping ?? true);
        }
      }
    } else if (this.held.kind === 'animal') {
      if (this.held.source === 'existing' && this.held.originState) {
        this.animals.push(cloneAnimalState(this.held.originState));
      }
    } else if (
      this.held.kind === 'seed' &&
      this.held.source === 'existing' &&
      this.held.originCellId
    ) {
      const origin = this.cellById(this.held.originCellId);
      if (origin) origin.biomass[this.held.speciesId] = this.held.originBiomass ?? SEED_BIOMASS;
      this.seedPlacements.push(this.held.originPlacement
        ? {
          ...this.held.originPlacement,
          cellId: this.held.originCellId,
          plant: this.held.originPlacement.plant
            ? { ...this.held.originPlacement.plant }
            : undefined,
        }
        : this.createSeedPlacement(
          this.held.seedId,
          this.held.speciesId,
          this.held.originCellId,
        ));
    }
    this.held = null;
    this.updateSettledState(SETTLE_REQUIRED_SECONDS);
    this.message = '들고 있던 항목을 취소했습니다.';
  }

  private retrieveHeldSeed(): void {
    if (!this.held || !this.canEdit()) return;
    if (this.held.kind === 'animal') {
      const label = ANIMALS[this.held.speciesId].displayName;
      if (this.held.source === 'existing' && this.held.originState?.origin === 'supplied') {
        this.animalInventoryUsed[this.held.speciesId] = Math.max(
          0,
          this.animalInventoryUsed[this.held.speciesId] - 1,
        );
      }
      this.held = null;
      this.message = `${label}를 목록으로 회수했습니다.`;
      this.snapshotDirty = true;
      return;
    }
    if (this.held.kind !== 'seed') return;
    const label = SPECIES[this.held.speciesId].shortName;
    this.held = null;
    this.message = `${label} 접종체를 목록으로 회수했습니다.`;
  }

  private retrieveHeldStructure(): void {
    if (!this.held || this.held.kind !== 'structure' || !this.canEdit()) return;
    const structure = this.structureById(this.held.structureId);
    if (!structure) return;
    const label = STRUCTURES[structure.definitionId].label;
    this.removeStructure(structure);
    this.held = null;
    this.wakeStructuresAfterTopologyChange();
    if (this.allSettled) {
      this.rebuildCrossConnections();
      this.recomputeLight();
    }
    this.message = `${label}을 목록으로 회수했습니다.`;
  }

  private retrieveStructure(id: string): void {
    if (!this.canEdit() || this.held) return;
    const structure = this.structureById(id);
    if (!structure || structure.locked) return;
    const label = STRUCTURES[structure.definitionId].label;
    this.removeStructure(structure);
    this.wakeStructuresAfterTopologyChange();
    if (this.allSettled) {
      this.rebuildCrossConnections();
      this.recomputeLight();
    }
    this.message = `${label}을 수조에서 치워 보유 목록으로 돌려보냈습니다.`;
    this.snapshotDirty = true;
  }

  private retrieveAnimal(id: string): void {
    if (!this.canEdit() || this.held) return;
    const animal = this.animals.find((candidate) => candidate.id === id);
    if (!animal) return;
    if (this.hasStarted) this.recordAnimalPopulationEvent('removed', animal);
    this.animals = this.animals.filter((candidate) => candidate.id !== id);
    if (animal.origin === 'supplied') {
      this.animalInventoryUsed[animal.speciesId] = Math.max(
        0,
        this.animalInventoryUsed[animal.speciesId] - 1,
      );
    }
    if (this.selection?.kind === 'animal' && this.selection.animalId === id) {
      this.selection = null;
    }
    this.message = `${ANIMALS[animal.speciesId].displayName}를 수조에서 회수했습니다.`;
    this.snapshotDirty = true;
  }

  private removeSelectedAlgae(speciesId: SpeciesId): void {
    if (!this.canEdit() || this.held) return;
    const selection = this.selection;
    if (!selection || (selection.kind !== 'colony' && selection.kind !== 'region')) return;
    const scopeLabel = selection.kind === 'colony' ? '선택 지점' : '선택 영역';

    const selectedCells = selection.kind === 'colony' && selection.cellId
      ? [this.cellById(selection.cellId)].filter((cell): cell is SurfaceCellState => Boolean(cell))
      : selection.bounds
        ? this.allCells().filter((cell) => {
          const point = this.cellWorldPoint(cell);
          return point.x >= selection.bounds!.minX && point.x <= selection.bounds!.maxX &&
            point.y >= selection.bounds!.minY && point.y <= selection.bounds!.maxY;
        })
        : [];
    const affectedCellIds = new Set(
      selectedCells
        .filter((cell) => cell.biomass[speciesId] > 0)
        .map((cell) => cell.id),
    );
    if (!affectedCellIds.size) {
      this.message = `${scopeLabel}에는 제거할 ${SPECIES[speciesId].shortName}이 없습니다.`;
      return;
    }

    for (const cell of selectedCells) {
      if (affectedCellIds.has(cell.id)) cell.biomass[speciesId] = 0;
    }
    this.seedPlacements = this.seedPlacements.filter((placement) =>
      placement.speciesId !== speciesId || !affectedCellIds.has(placement.cellId),
    );
    if (speciesId === 'vallisneria') {
      this.lightDirty = true;
      if (this.allSettled) this.recomputeLight();
    }
    this.selection = null;
    this.message = `${scopeLabel}에서 ${SPECIES[speciesId].shortName}을 걷어냈습니다.`;
    this.snapshotDirty = true;
  }

  private removeStructure(structure: StructureState): void {
    if (structure.locked) return;
    const cellIds = new Set(structure.cells.map((cell) => cell.id));
    this.seedPlacements = this.seedPlacements.filter((seed) => !cellIds.has(seed.cellId));
    Composite.remove(this.engine.world, structure.body);
    this.structures = this.structures.filter((item) => item.id !== structure.id);
    if (this.selection?.kind === 'structure' && this.selection.structureId === structure.id) {
      this.selection = null;
    }
    this.lightDirty = true;
    this.lightTransportDirty = true;
    this.crossConnectionsDirty = true;
  }

  private wakeStructuresAfterTopologyChange(): void {
    this.settleAccumulator = 0;
    this.physicsAccumulator = 0;
    let hasMovableStructure = false;
    for (const structure of this.structures) {
      if (structure.locked) continue;
      hasMovableStructure = true;
      if (structure.body.isStatic) Body.setStatic(structure.body, false);
      Sleeping.set(structure.body, false);
    }
    this.allSettled = !hasMovableStructure;
  }

  private rotateHeld(radians: number): void {
    if (!this.canEdit() || !this.held || this.held.kind !== 'structure') return;
    const structure = this.structureById(this.held.structureId);
    if (!structure) return;
    Body.setAngle(structure.body, structure.body.angle + radians);
    this.constrainHeldStructure(structure);
    this.updateHeldStructureValidity(structure);
  }

  private rotateStructure(id: string, radians: number): void {
    if (!this.canEdit() || this.held) return;
    const structure = this.structureById(id);
    if (!structure || structure.locked) return;
    if (structure.body.isStatic) Body.setStatic(structure.body, false);
    Body.setAngle(structure.body, structure.body.angle + radians);
    Body.setVelocity(structure.body, { x: 0, y: 0 });
    Body.setAngularVelocity(structure.body, 0);
    Sleeping.set(structure.body, false);
    this.selection = {
      kind: 'structure',
      x: structure.body.position.x,
      y: structure.body.position.y,
      ownerLabel: STRUCTURES[structure.definitionId].label,
      structureId: structure.id,
    };
    this.wakeStructuresAfterTopologyChange();
    this.lightDirty = true;
    this.lightTransportDirty = true;
    this.crossConnectionsDirty = true;
    this.message = `${STRUCTURES[structure.definitionId].label}을 회전했습니다. 접점에 따라 다시 안착합니다.`;
    this.snapshotDirty = true;
  }

  private constrainHeldStructure(structure: StructureState): void {
    const padding = 5;
    const bounds = structure.body.bounds;
    let dx = 0;
    let dy = 0;
    if (bounds.min.x < padding) dx = padding - bounds.min.x;
    if (bounds.max.x > TANK_WIDTH - padding) dx = TANK_WIDTH - padding - bounds.max.x;
    if (bounds.min.y < WATER_TOP + padding) dy = WATER_TOP + padding - bounds.min.y;
    if (bounds.max.y > STRUCTURE_SUPPORT_Y - padding) {
      dy = STRUCTURE_SUPPORT_Y - padding - bounds.max.y;
    }
    if (dx || dy) Body.translate(structure.body, { x: dx, y: dy });
  }

  private updateHeldStructureValidity(structure: StructureState): void {
    if (!this.held || this.held.kind !== 'structure') return;
    const bounds = structure.body.bounds;
    const inTank =
      bounds.min.x >= 2 &&
      bounds.max.x <= TANK_WIDTH - 2 &&
      bounds.min.y >= WATER_TOP + 2 &&
      bounds.max.y <= STRUCTURE_SUPPORT_Y - 2;
    const collisions = Query.collides(
      structure.body,
      this.structures.filter((item) => item.id !== structure.id).map((item) => item.body),
    );
    this.held.valid = inTank && collisions.every((collision) => collision.depth < 3.5);
  }

  private updateHeldSeedCandidate(point: Vec2): void {
    if (!this.held || this.held.kind !== 'seed') return;
    const held = this.held;
    // A rooted plant may occupy the foreground depth in front of a rock. If
    // structure-face cells participate here, the visually overlapping rock
    // always wins nearest-cell selection and makes foreground planting
    // impossible even though the substrate is directly beneath the pointer.
    const nearest = this.nearestCell(
      point,
      held.speciesId === 'vallisneria'
        ? (cell) => cell.surfaceKind === 'substrate'
        : undefined,
    );
    const validDistance = nearest
      ? Math.max(8, nearest.cell.cellSize * 0.9)
      : 0;
    const candidateCellId = nearest && nearest.distance <= validDistance ? nearest.cell.id : null;
    const rootedOnSubstrate = held.speciesId !== 'vallisneria' ||
      nearest?.cell.surfaceKind === 'substrate';
    const duplicate = candidateCellId
      ? this.seedPlacements.some((placement) =>
        placement.cellId === candidateCellId && placement.speciesId === held.speciesId,
      )
      : false;
    held.candidateCellId = candidateCellId;
    held.candidateRootPosition = held.speciesId === 'vallisneria' && nearest && candidateCellId && rootedOnSubstrate
      ? {
        x: clamp(point.x, 2, TANK_WIDTH - 2),
        y: clamp(
          point.y,
          GROUND_Y - nearest.cell.cellSize * 3 + 1,
          GROUND_Y - 1,
        ),
      }
      : undefined;
    held.valid = Boolean(candidateCellId) && rootedOnSubstrate && !duplicate;
  }

  private updateHeldBiofilmCandidate(point: Vec2): void {
    if (!this.held || this.held.kind !== 'biofilm') return;
    const nearest = this.nearestCell(point);
    const validDistance = nearest ? Math.max(8, nearest.cell.cellSize * 0.95) : 0;
    const candidateCellId = nearest && nearest.distance <= validDistance
      ? nearest.cell.id
      : null;
    const candidate = candidateCellId ? this.cellById(candidateCellId) : undefined;
    const occupied = candidate
      ? candidate.biofilm.decomposer + candidate.biofilm.nitrifier
      : 1;
    this.held.candidateCellId = candidateCellId;
    this.held.valid = Boolean(candidateCellId) && occupied < 0.995;
  }

  private canEdit(): boolean {
    if (this.phase === 'setup') return true;
    return this.scenario.mode === 'laboratory' && this.phase === 'paused';
  }

  private canInoculateBiofilm(): boolean {
    if (!this.scenario.waterCycle) return false;
    if (this.phase === 'setup') return true;
    return this.phase === 'paused';
  }

  private canPlaceHeld(held: HeldState): boolean {
    return held.kind === 'biofilm' ? this.canInoculateBiofilm() : this.canEdit();
  }

  private start(): void {
    if (this.phase !== 'setup') return;
    if (this.held) {
      this.message = '들고 있는 항목을 먼저 놓거나 취소하세요.';
      return;
    }
    if (!this.requiredStructuresPlaced()) {
      this.message = '지급된 필수 구조물을 모두 수조에 배치하세요.';
      return;
    }
    if (!this.hasTargetSurface()) {
      this.message = '미션 목표에 사용할 구조물 표면을 하나 이상 마련하세요.';
      return;
    }
    if (!this.allSettled) {
      this.message = '모든 구조물이 안착할 때까지 기다려 주세요.';
      return;
    }
    if (!this.requiredSeedsPlaced()) {
      this.message = this.scenario.targetIncludesSubstrate
        ? '필수 조류를 원하는 표면에 접종해 주세요.'
        : '필수 조류를 점수에 포함되는 구조물 앞면에 접종해 주세요.';
      return;
    }
    this.sleepStructures();
    if (this.crossConnectionsDirty) this.rebuildCrossConnections();
    if (this.lightDirty) this.recomputeLight();
    this.phase = 'running';
    this.hasStarted = true;
    for (const animal of this.animals) {
      this.recordAnimalPopulationEvent('introduced', animal);
    }
    this.materialReference = this.computeMaterialTotals();
    this.message = '배치가 잠겼습니다. 군락과 개체군의 변화를 관찰하세요.';
  }

  private pause(): void {
    if (this.phase !== 'running') return;
    this.phase = 'paused';
    this.message = this.scenario.mode === 'laboratory'
      ? '일시정지됨 · 구조물과 새 접종체를 편집할 수 있습니다.'
      : this.scenario.waterCycle
        ? '일시정지됨 · 일반 배치는 잠겨 있으며 균 필름만 접종할 수 있습니다.'
        : '일시정지됨 · 도전 중 배치는 계속 잠겨 있습니다.';
  }

  private resume(): void {
    if (this.phase !== 'paused') return;
    if (this.held || (this.scenario.mode === 'laboratory' && !this.allSettled)) {
      this.message = this.held
        ? '들고 있는 항목을 놓거나 취소해야 재개할 수 있습니다.'
        : '모든 구조물이 안착해야 재개할 수 있습니다.';
      return;
    }
    this.sleepStructures();
    if (this.crossConnectionsDirty) this.rebuildCrossConnections();
    if (this.lightDirty) this.recomputeLight();
    // Laboratory pause editing may import or remove arbitrary material, so a
    // resumed lab starts a new closed observation interval. Challenge-mode
    // inocula are accounted when placed and must not hide earlier drift.
    if (this.scenario.mode === 'laboratory') {
      this.materialReference = this.computeMaterialTotals();
    }
    this.phase = 'running';
    this.message = '생태 시뮬레이션이 진행 중입니다.';
  }

  private sleepStructures(): void {
    for (const structure of this.structures) {
      if (structure.locked) {
        Body.setStatic(structure.body, true);
        Body.setVelocity(structure.body, { x: 0, y: 0 });
        Body.setAngularVelocity(structure.body, 0);
        Sleeping.set(structure.body, true);
        continue;
      }
      if (structure.body.isStatic) Body.setStatic(structure.body, false);
      Body.setVelocity(structure.body, { x: 0, y: 0 });
      Body.setAngularVelocity(structure.body, 0);
      Sleeping.set(structure.body, true);
    }
    this.allSettled = true;
  }

  private updateSettledState(deltaSeconds: number): void {
    if (this.held) {
      this.settleAccumulator = 0;
      this.allSettled = false;
      return;
    }
    if (this.structures.length === 0) {
      const settlementChanged = !this.allSettled;
      this.settleAccumulator = SETTLE_REQUIRED_SECONDS;
      this.allSettled = true;
      // Picking an inventory item briefly marks the world as unsettled. When
      // there are no physical structures, publish the transition back to the
      // settled state so the setup button cannot remain stuck on the stale
      // "waiting to settle" snapshot.
      if (settlementChanged) {
        this.snapshotDirty = true;
        // User-visible placement readiness must not wait for the low-frequency
        // ecology snapshot cadence. Advance only this transition to the next
        // publish boundary; continuously changing animal/ecology state remains
        // rate-limited below.
        this.snapshotAccumulator = SNAPSHOT_INTERVAL_SECONDS;
      }
      return;
    }
    const stable = this.structures.every(({ body }) =>
      body.isSleeping || (body.speed < 0.13 && Math.abs(body.angularSpeed) < 0.014),
    );
    this.settleAccumulator = stable ? this.settleAccumulator + deltaSeconds : 0;
    const nextSettled = this.settleAccumulator >= SETTLE_REQUIRED_SECONDS;
    if (nextSettled && !this.allSettled) {
      for (const structure of this.structures) {
        if (!structure.body.isStatic) Sleeping.set(structure.body, true);
      }
      this.message = this.hasStarted
        ? '구조물이 다시 안정되었습니다.'
        : '배치가 안정되었습니다. 광량을 확인하고 접종한 뒤 시작하세요.';
      this.snapshotDirty = true;
    }
    this.allSettled = nextSettled;
  }

  private requiredStructuresPlaced(): boolean {
    return Object.entries(this.scenario.requiredStructures).every(([id, required]) =>
      countByDefinition(this.structures, id as StructureDefinitionId) >= (required ?? 0),
    );
  }

  private hasTargetSurface(): boolean {
    return this.scenario.targetIncludesSubstrate || this.allCells().some((cell) =>
      cell.surfaceKind === 'structure-face',
    );
  }

  private requiredSeedsPlaced(): boolean {
    return this.scenario.requiredSeedSpecies.every((speciesId) =>
      this.seedPlacements.some((placement) => {
        if (placement.speciesId !== speciesId) return false;
        const cell = this.cellById(placement.cellId);
        return Boolean(cell) && (this.scenario.targetIncludesSubstrate || cell!.surfaceKind === 'structure-face');
      }),
    );
  }

  private remainingSeeds(speciesId: SpeciesId): number | null {
    const budget = this.scenario.seedBudget[speciesId];
    if (budget === null) return null;
    const placed = this.seedPlacements.filter((placement) =>
      placement.speciesId === speciesId && placement.origin === 'supplied'
    ).length;
    const held = this.held?.kind === 'seed' && this.held.speciesId === speciesId ? 1 : 0;
    return Math.max(0, budget - placed - held);
  }

  private remainingAnimals(speciesId: AnimalSpeciesId): number | null {
    const budget = this.scenario.animalBudget[speciesId];
    if (budget === null) return null;
    const held = this.held?.kind === 'animal' &&
      this.held.source === 'inventory' &&
      this.held.speciesId === speciesId
      ? 1
      : 0;
    return Math.max(0, budget - this.animalInventoryUsed[speciesId] - held);
  }

  private remainingMicrobes(guildId: MicrobeGuildId): number | null {
    if (!this.scenario.waterCycle) return 0;
    const budget = this.scenario.waterCycle.microbeBudget[guildId];
    if (budget === null) return null;
    const held = this.held?.kind === 'biofilm' && this.held.guildId === guildId ? 1 : 0;
    return Math.max(0, budget - this.microbeInventoryUsed[guildId] - held);
  }

  private remainingStructures(definitionId: StructureDefinitionId): number | null {
    const budget = this.scenario.structureBudget[definitionId];
    if (budget === null) return null;
    return Math.max(0, budget - countByDefinition(this.structures, definitionId));
  }

  private setProbe(point: Vec2): void {
    this.probe = this.measureAt(point);
  }

  private measureAt(point: Vec2): ProbeSnapshot {
    const exact = this.clampPointer(point);
    const nearest = this.nearestCell(exact);
    const snapDistance = nearest ? Math.max(7, nearest.cell.cellSize * 0.72) : 0;
    const onSurface = nearest && nearest.distance <= snapDistance ? nearest : null;
    const light = onSurface ? onSurface.cell.light : this.lightAtWithCanopy(exact);
    const measuredPoint = onSurface ? this.cellWorldPoint(onSurface.cell) : exact;
    const biofilm = onSurface ? { ...onSurface.cell.biofilm } : emptyBiofilm();
    const localTemperature = this.biogeochemistry.temperatureAt(measuredPoint);
    const waterVelocity = this.biogeochemistry.velocityAt(measuredPoint);
    const occupiedBiofilm = biofilm.decomposer + biofilm.nitrifier;
    return {
      ...exact,
      light,
      temperature: localTemperature,
      waterVelocity,
      waterSpeed: Math.hypot(waterVelocity.x, waterVelocity.y),
      locationLabel: onSurface
        ? onSurface.cell.surfaceKind === 'substrate'
          ? '바닥재 표면'
          : `${onSurface.cell.ownerLabel} 앞면`
        : '수중',
      surfaceCellId: onSurface?.cell.id,
      trends: {
        oedogonium: growthTrend('oedogonium', light, localTemperature),
        nitzschia: growthTrend('nitzschia', light, localTemperature),
        vallisneria: growthTrend('vallisneria', light, localTemperature),
      },
      water: this.biogeochemistry.sampleAt(measuredPoint),
      biofilm,
      microbeNetGrowth: {
        decomposer: this.biogeochemistry.microbeNetGrowthAt(
          'decomposer',
          measuredPoint,
          occupiedBiofilm,
        ),
        nitrifier: this.biogeochemistry.microbeNetGrowthAt(
          'nitrifier',
          measuredPoint,
          occupiedBiofilm,
        ),
      },
    };
  }

  private placeMeasurement(kind: MeasurementKind, point: Vec2): void {
    const measured = this.measureAt(point);
    const measurement: MeasurementState = {
      id: `measurement-${++this.measurementCounter}`,
      kind,
      point: { x: measured.x, y: measured.y },
    };
    this.measurements.push(measurement);
    this.probe = null;
    this.selectMeasurement(measurement.id);
    this.snapshotDirty = true;
  }

  private removeMeasurement(id: string): void {
    this.measurements = this.measurements.filter((measurement) => measurement.id !== id);
    if (this.selection?.kind === 'measurement' && this.selection.measurementId === id) {
      this.selection = null;
    }
    this.message = '측정점을 회수했습니다.';
    this.snapshotDirty = true;
  }

  private measurementSnapshots(): MeasurementSnapshot[] {
    return this.measurements.map((measurement) => ({
      id: measurement.id,
      kind: measurement.kind,
      ...this.measureAt(measurement.point),
    }));
  }

  private currentDayNightState(): DayNightState | null {
    return this.scenario.dayNightCycle && this.dayNightEnabled
      ? dayNightStateAt(this.elapsedSeconds, this.scenario.dayNightCycle)
      : null;
  }

  private currentDayNightSnapshot(): SimulationSnapshot['dayNight'] {
    const state = this.currentDayNightState();
    return state ? {
      ...state,
      effectiveNaturalLightOutput: this.naturalLightOutput * state.lightMultiplier,
      effectiveLightOutput:
        this.lightOutput + this.naturalLightOutput * state.lightMultiplier,
    } : null;
  }

  /**
   * Dawn and dusk are continuous, but the expensive occlusion field only
   * needs perceptually meaningful steps. Phase edges are always exact and the
   * 4% threshold bounds both chemistry error and high-speed rendering cost.
   */
  private updateDayNightLighting(): void {
    const state = this.currentDayNightState();
    const multiplier = state?.lightMultiplier ?? 1;
    const crossedPhaseEdge = (state?.phase ?? null) !== this.appliedDayNightPhase;
    if (
      Math.abs(multiplier - this.appliedDayNightMultiplier) >= 0.04 ||
      crossedPhaseEdge
    ) {
      this.appliedDayNightMultiplier = multiplier;
      this.appliedDayNightPhase = state?.phase ?? null;
      this.lightDirty = true;
    }
  }

  private effectiveNaturalLightOutput(): number {
    return this.naturalLightOutput * this.appliedDayNightMultiplier;
  }

  private recomputeLight(): void {
    const transportChanged = this.lightTransportDirty;
    if (transportChanged) {
      this.lightEmitters = this.buildLightEmitters();
      this.lightReflectionSources = this.buildLightReflectionSources();
      this.lightTransportCache.clear();
    }
    const nextCanopySignature = this.currentCanopyLightSignature();
    if (nextCanopySignature !== this.canopyLightSignature) {
      this.rebuildVallisneriaCanopyOptics();
      this.canopyTransmissionCache.clear();
    }
    const values: number[] = [];
    for (let row = 0; row < LIGHT_ROWS; row += 1) {
      for (let column = 0; column < LIGHT_COLUMNS; column += 1) {
        values.push(this.lightAtWithCanopy({
          x: ((column + 0.5) / LIGHT_COLUMNS) * TANK_WIDTH,
          y: WATER_TOP + ((row + 0.5) / LIGHT_ROWS) * (GROUND_Y - WATER_TOP),
        }, undefined, true));
      }
    }
    this.lightRevision += 1;
    this.lightField = {
      columns: LIGHT_COLUMNS,
      rows: LIGHT_ROWS,
      values,
      revision: this.lightRevision,
    };
    if (transportChanged) {
      this.biogeochemistry.setTransportEnvironment(
        values,
        this.structures
          .filter((structure) => !this.isHeldStructure(structure.id))
          .map((structure) => {
            const definition = STRUCTURES[structure.definitionId];
            return {
              polygon: structureAuthoredPolygonToWorld(
                definition.collisionPolygon,
                definition.collisionPolygon,
                structure.body.position,
                structure.body.angle,
              ),
            };
          }),
      );
    } else {
      this.biogeochemistry.setTransportLight(values);
    }

    for (const cell of this.allCells()) {
      const ownerBodyId = cell.surfaceKind === 'structure-face'
        ? this.structureById(cell.ownerId)?.body.id
        : undefined;
      cell.light = this.lightAtWithCanopy(this.cellWorldPoint(cell), ownerBodyId, true);
    }
    if (this.probe) this.setProbe(this.probe);
    this.lightDirty = false;
    this.lightTransportDirty = false;
    this.canopyLightSignature = nextCanopySignature;
    this.snapshotDirty = true;
  }

  private buildLightEmitters(): LightEmitter[] {
    return [
      {
        id: 'ceiling-lamp',
        samples: Array.from({ length: AREA_LIGHT_SAMPLES }, (_, index) => ({
          x: FIXED_LAMP_X - FIXED_LAMP_WIDTH / 2 +
            (index / (AREA_LIGHT_SAMPLES - 1)) * FIXED_LAMP_WIDTH,
          y: FIXED_LAMP_Y,
        })),
        emissionScale: DIRECT_LIGHT_SCALE,
        occludedTransmission: 0,
        halfAngle: DIRECT_LIGHT_HALF_ANGLE,
        angularExponent: 1.48,
        distanceScale: 470,
        distanceExponent: 1.35,
      },
      {
        id: 'daylight',
        samples: Array.from({ length: AMBIENT_SKY_SAMPLES }, (_, index) => ({
          x: ((index + 0.5) / AMBIENT_SKY_SAMPLES) * TANK_WIDTH,
          y: WATER_TOP - 12,
        })),
        emissionScale: NATURAL_LIGHT_SCALE,
        // A broad sky source is not a set of laser rays. Blocked samples keep
        // a small diffuse component representing water/air scattering.
        occludedTransmission: 0.06,
      },
    ];
  }

  private emitterLightCoefficientAt(
    emitter: LightEmitter,
    point: Vec2,
    occluders: MatterBody[],
  ): number {
    if (emitter.samples.length === 0) return 0;
    const depth = Math.max(0, point.y - WATER_TOP);
    const waterAttenuation = Math.exp(-depth * 0.00072);
    let irradiance = 0;
    for (const sourcePoint of emitter.samples) {
      const dx = point.x - sourcePoint.x;
      const dy = Math.max(1, point.y - sourcePoint.y);
      const distance = Math.hypot(dx, dy);
      const angleFactor = emitter.halfAngle
        ? Math.pow(
          clamp(1 - Math.abs(Math.atan2(dx, dy)) / emitter.halfAngle, 0, 1),
          emitter.angularExponent ?? 1,
        )
        : 1;
      const distanceFactor = emitter.distanceScale
        ? 1 / (1 + Math.pow(
          distance / emitter.distanceScale,
          emitter.distanceExponent ?? 2,
        ))
        : 1;
      const clear = Query.ray(occluders, sourcePoint, point, 1.1).length === 0;
      const transmission = clear ? 1 : emitter.occludedTransmission;
      irradiance += emitter.emissionScale * angleFactor *
        distanceFactor * waterAttenuation * transmission;
    }
    return irradiance / emitter.samples.length;
  }

  private emittedLightCoefficientsAt(
    point: Vec2,
    occluders: MatterBody[],
  ): { lamp: number; daylight: number } {
    let lamp = 0;
    let daylight = 0;
    for (const emitter of this.lightEmitters) {
      const coefficient = this.emitterLightCoefficientAt(emitter, point, occluders);
      if (emitter.id === 'ceiling-lamp') lamp += coefficient;
      else daylight += coefficient;
    }
    return { lamp, daylight };
  }

  private buildLightReflectionSources(): LightReflectionSource[] {
    const activeStructures = this.structures.filter((structure) => !this.isHeldStructure(structure.id));
    return activeStructures.map((structure) => {
      const reflectionPoint = {
        x: structure.body.position.x,
        y: structure.body.bounds.min.y - 2,
      };
      const blockers = activeStructures
        .filter((candidate) => candidate.body.id !== structure.body.id)
        .map((candidate) => candidate.body);
      const incident = this.emittedLightCoefficientsAt(reflectionPoint, blockers);
      return {
        bodyId: structure.body.id,
        point: reflectionPoint,
        lampCoefficient: incident.lamp,
        daylightCoefficient: incident.daylight,
      };
    });
  }

  private lightTransportPathAt(
    point: Vec2,
    excludedBodyId?: number,
    cache = false,
  ): LightTransportPath {
    const key = `${point.x}:${point.y}:${excludedBodyId ?? 'water'}`;
    if (cache) {
      const cached = this.lightTransportCache.get(key);
      if (cached) return cached;
    }

    const occluders = this.structures
      .filter((structure) =>
        structure.body.id !== excludedBodyId && !this.isHeldStructure(structure.id))
      .map((structure) => structure.body);
    const emitted = this.emittedLightCoefficientsAt(point, occluders);
    const depth = Math.max(0, point.y - WATER_TOP);
    let skyExposure = 0;
    for (let index = 0; index < AMBIENT_SKY_SAMPLES; index += 1) {
      const skyPoint = {
        x: ((index + 0.5) / AMBIENT_SKY_SAMPLES) * TANK_WIDTH,
        y: WATER_TOP - 12,
      };
      if (Query.ray(occluders, skyPoint, point, 1).length === 0) skyExposure += 1;
    }
    skyExposure /= AMBIENT_SKY_SAMPLES;
    const ambientTransport =
      (0.35 + skyExposure * 0.65) * Math.exp(-depth * 0.00062);
    const reflections: LightReflectionPath[] = [];
    for (const source of this.lightReflectionSources) {
      if (source.bodyId === excludedBodyId) continue;
      const dx = point.x - source.point.x;
      const dy = point.y - source.point.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      if (distance >= 400) continue;
      const upwardDirection = clamp(-dy / distance, -1, 1);
      const facing = clamp(0.35 + upwardDirection * 0.65, 0.08, 1);
      const distanceFalloff = 1 / (1 + Math.pow(distance / 230, 2));
      const localFade = clamp((400 - distance) / 120, 0, 1);
      const transportFactor = facing * distanceFalloff * localFade;
      if (transportFactor * REFLECTED_LIGHT_LIMIT < 0.04) continue;
      const blockers = occluders.filter((body) => body.id !== source.bodyId);
      if (Query.ray(blockers, source.point, point, 1).length === 0) {
        reflections.push({ source, transportFactor });
      }
    }
    const path = {
      ambientBase: 1.1 * ambientTransport,
      ambientLampCoefficient: 0.03 * ambientTransport,
      lampCoefficient: emitted.lamp,
      daylightCoefficient: emitted.daylight,
      reflections,
    };
    if (cache) this.lightTransportCache.set(key, path);
    return path;
  }

  private evaluateLightTransport(path: LightTransportPath): number {
    const daylightOutput = this.effectiveNaturalLightOutput();
    let reflected = 0;
    for (const reflection of path.reflections) {
      const incident =
        reflection.source.lampCoefficient * this.lightOutput +
        reflection.source.daylightCoefficient * daylightOutput;
      const strength = clamp(incident * 0.065, 0, REFLECTED_LIGHT_LIMIT);
      if (strength < 0.08) continue;
      const contribution = strength * reflection.transportFactor;
      if (contribution < 0.04) continue;
      reflected += contribution;
      if (reflected >= REFLECTED_LIGHT_LIMIT) {
        reflected = REFLECTED_LIGHT_LIMIT;
        break;
      }
    }
    return clamp(
      path.ambientBase +
      path.ambientLampCoefficient * this.lightOutput +
      path.lampCoefficient * this.lightOutput +
      path.daylightCoefficient * daylightOutput +
      reflected,
      0,
      100,
    );
  }

  private lightAt(point: Vec2, excludedBodyId?: number, cache = false): number {
    return this.evaluateLightTransport(
      this.lightTransportPathAt(point, excludedBodyId, cache),
    );
  }

  /**
   * Vallisneria blades transmit most light but overlapping leaves accumulate
   * optical depth. This is a cheap Beer-Lambert canopy layer over the cached
   * stone/light transport, so living plants can cast soft shade without
   * rebuilding Matter ray paths or behaving like opaque rocks.
   */
  private computeCanopyTransmissionAt(point: Vec2, excludedPlantId?: string): number {
    let opticalDepth = 0;
    for (const canopy of this.vallisneriaCanopyOptics) {
      if (canopy.plantId === excludedPlantId) continue;
      const { bounds } = canopy;
      if (
        point.y <= bounds.minY ||
        point.x < bounds.minX - 18 ||
        point.x > bounds.maxX + 18
      ) continue;

      for (const samples of canopy.leafSamples) {
        let leafDensity = 0;
        for (const blade of samples) {
          const verticalGap = point.y - blade.y;
          if (verticalGap <= 3) continue;
          // Water scatter widens the penumbra below a translucent blade.
          const sigma = 4.5 + Math.min(12, verticalGap * 0.024);
          const dx = point.x - blade.x;
          leafDensity = Math.max(
            leafDensity,
            Math.exp(-(dx * dx) / (2 * sigma * sigma)),
          );
        }
        opticalDepth += leafDensity * canopy.leafOpticalDepth;
      }
    }
    return Math.exp(-Math.min(1.45, opticalDepth));
  }

  private canopyTransmissionAt(
    point: Vec2,
    excludedPlantId?: string,
    cache = false,
  ): number {
    if (this.vallisneriaCanopyOptics.length === 0) return 1;
    const key = `${point.x}:${point.y}:${excludedPlantId ?? 'all'}`;
    if (cache) {
      const cached = this.canopyTransmissionCache.get(key);
      if (cached !== undefined) return cached;
    }
    const transmission = this.computeCanopyTransmissionAt(point, excludedPlantId);
    if (cache) this.canopyTransmissionCache.set(key, transmission);
    return transmission;
  }

  private lightAtWithCanopy(
    point: Vec2,
    excludedBodyId?: number,
    cache = false,
    excludedPlantId?: string,
  ): number {
    return this.lightAt(point, excludedBodyId, cache) *
      this.canopyTransmissionAt(point, excludedPlantId, cache);
  }

  private rebuildVallisneriaCanopyOptics(): void {
    this.vallisneriaCanopyOptics = this.seedPlacements.flatMap((placement) => {
      if (placement.speciesId !== 'vallisneria' || !placement.plant) return [];
      const cell = this.cellById(placement.cellId);
      if (!cell || cell.biomass.vallisneria <= 0.004) return [];
      const anchor = this.vallisneriaRootPosition(placement, cell);
      const scale = placement.plant.structuralScale;
      return [{
        plantId: placement.id,
        bounds: vallisneriaCanopyBounds(cell.index, anchor, scale),
        leafOpticalDepth: 0.035 + scale * 0.028,
        leafSamples: vallisneriaLeaves(cell.index, anchor, scale).map((leaf) =>
          Array.from({ length: 7 }, (_, index) =>
            vallisneriaLeafPoint(leaf, (index + 1) / 8)
          )
        ),
      }];
    });
  }

  private currentCanopyLightSignature(): string {
    return this.seedPlacements
      .filter((placement) => placement.speciesId === 'vallisneria' && placement.plant)
      .map((placement) => {
        const cell = this.cellById(placement.cellId);
        const alive = cell && cell.biomass.vallisneria > 0.004;
        const scale = alive
          ? Math.round(placement.plant!.structuralScale / VALLISNERIA_CANOPY_LIGHT_QUANTIZATION)
          : 0;
        const root = cell ? this.vallisneriaRootPosition(placement, cell) : null;
        return `${placement.id}:${placement.cellId}:${root?.x.toFixed(2)}:${root?.y.toFixed(2)}:${scale}`;
      })
      .sort()
      .join('|');
  }

  private rebuildCrossConnections(): void {
    if (!this.crossConnectionsDirty) return;
    const cells = this.allCells();
    for (const cell of cells) cell.neighborIds = [...cell.localNeighborIds];

    const bucketSize = CROSS_SURFACE_DISTANCE;
    const buckets = new Map<string, SurfaceCellState[]>();
    const points = new Map<string, Vec2>();
    for (const cell of cells) {
      const point = this.cellWorldPoint(cell);
      points.set(cell.id, point);
      const key = `${Math.floor(point.x / bucketSize)}:${Math.floor(point.y / bucketSize)}`;
      const bucket = buckets.get(key) ?? [];
      bucket.push(cell);
      buckets.set(key, bucket);
    }

    interface CrossSurfaceCandidate {
      first: SurfaceCellState;
      second: SurfaceCellState;
      distanceSquared: number;
    }
    const compareCrossCandidates = (
      left: CrossSurfaceCandidate,
      right: CrossSurfaceCandidate,
    ): number =>
      left.distanceSquared - right.distanceSquared ||
      left.first.id.localeCompare(right.first.id) ||
      left.second.id.localeCompare(right.second.id);
    // Each cell contributes only a short nearest-candidate list. This avoids
    // materializing and sorting every pair in a dense rock pile before the
    // four-link cap is applied.
    const candidateByPair = new Map<string, CrossSurfaceCandidate>();
    const candidateLimitPerCell = MAX_CROSS_SURFACE_NEIGHBORS * 2;
    for (const cell of cells) {
      const point = points.get(cell.id)!;
      const bucketX = Math.floor(point.x / bucketSize);
      const bucketY = Math.floor(point.y / bucketSize);
      const nearestCandidates: CrossSurfaceCandidate[] = [];
      for (let yOffset = -1; yOffset <= 1; yOffset += 1) {
        for (let xOffset = -1; xOffset <= 1; xOffset += 1) {
          const nearbyCells = buckets.get(`${bucketX + xOffset}:${bucketY + yOffset}`) ?? [];
          for (const candidate of nearbyCells) {
            if (candidate.ownerId === cell.ownerId || candidate.id === cell.id) continue;
            const separation = distanceSquared(point, points.get(candidate.id)!);
            if (separation > CROSS_SURFACE_DISTANCE ** 2) continue;
            const pair = cell.id < candidate.id
              ? { first: cell, second: candidate, distanceSquared: separation }
              : { first: candidate, second: cell, distanceSquared: separation };
            if (nearestCandidates.length < candidateLimitPerCell) {
              nearestCandidates.push(pair);
              continue;
            }
            let worstIndex = 0;
            for (let index = 1; index < nearestCandidates.length; index += 1) {
              if (compareCrossCandidates(nearestCandidates[index], nearestCandidates[worstIndex]) > 0) {
                worstIndex = index;
              }
            }
            if (compareCrossCandidates(pair, nearestCandidates[worstIndex]) < 0) {
              nearestCandidates[worstIndex] = pair;
            }
          }
        }
      }
      for (const candidate of nearestCandidates) {
        candidateByPair.set(`${candidate.first.id}\0${candidate.second.id}`, candidate);
      }
    }

    const candidates = [...candidateByPair.values()].sort(compareCrossCandidates);
    const crossNeighborCounts = new Map<string, number>();
    for (const candidate of candidates) {
      const firstCount = crossNeighborCounts.get(candidate.first.id) ?? 0;
      const secondCount = crossNeighborCounts.get(candidate.second.id) ?? 0;
      if (
        firstCount >= MAX_CROSS_SURFACE_NEIGHBORS ||
        secondCount >= MAX_CROSS_SURFACE_NEIGHBORS
      ) continue;
      candidate.first.neighborIds.push(candidate.second.id);
      candidate.second.neighborIds.push(candidate.first.id);
      crossNeighborCounts.set(candidate.first.id, firstCount + 1);
      crossNeighborCounts.set(candidate.second.id, secondCount + 1);
    }
    this.crossConnectionsDirty = false;
  }

  private stepAnimalMotion(deltaSeconds: number): void {
    if (!this.animals.length) return;
    for (const animal of this.animals) {
      animal.nextTargetEvaluation -= deltaSeconds;
      animal.behaviorTimer = Math.max(0, animal.behaviorTimer - deltaSeconds);
      let currentTarget = animal.targetCellId ? this.cellById(animal.targetCellId) : undefined;
      let targetFood = currentTarget ? this.edibleBiomass(currentTarget) : 0;
      let currentTargetDistance = currentTarget
        ? Math.sqrt(distanceSquared(animal.position, this.cellWorldPoint(currentTarget)))
        : Number.POSITIVE_INFINITY;
      const wasForaging = animal.behavior === 'traveling' ||
        animal.behavior === 'grazing' || animal.behavior === 'starving' ||
        animal.behavior === 'exploring';
      const behaviorNoise = deterministicNoise(animal.randomSeed + animal.ageSeconds * 0.17);
      let forcedRoaming = animal.behavior === 'exploring' &&
        animal.behaviorTimer > 0 && animal.energy > SHRIMP_WEAK_ENERGY;
      let seeking = !forcedRoaming && (
        animal.energy <= SHRIMP_FORAGE_START_ENERGY ||
        (wasForaging && animal.energy < SHRIMP_FORAGE_STOP_ENERGY)
      );
      let justFinishedGrazing = false;

      // A fed shrimp releases the colony after a short grazing bout, then must
      // spend a visible interval roaming before food targeting can resume.
      if (
        animal.behavior === 'grazing' &&
        animal.energy >= SHRIMP_FORAGE_START_ENERGY &&
        (((animal.behaviorTimer <= 0 ||
          animal.grazingSessionIntake >= SHRIMP_GRAZING_BOUT_BIOMASS) &&
          animal.energy >= SHRIMP_FORAGE_START_ENERGY) ||
          animal.energy >= SHRIMP_FORAGE_STOP_ENERGY ||
          targetFood < SHRIMP_FOOD_TARGET_BIOMASS)
      ) {
        animal.targetCellId = null;
        animal.behavior = 'exploring';
        animal.behaviorTimer = SHRIMP_POST_GRAZE_ROAM_MIN_SECONDS +
          behaviorNoise * SHRIMP_POST_GRAZE_ROAM_VARIANCE_SECONDS;
        animal.nextTargetEvaluation = 0;
        animal.grazingSessionIntake = 0;
        currentTarget = undefined;
        targetFood = 0;
        currentTargetDistance = Number.POSITIVE_INFINITY;
        forcedRoaming = true;
        seeking = false;
        justFinishedGrazing = true;
      }

      if (animal.behavior === 'resting' && animal.behaviorTimer > 0 && animal.energy > SHRIMP_WEAK_ENERGY) {
        animal.targetCellId = null;
        const damping = Math.exp(-deltaSeconds * 5);
        animal.velocity.x *= damping;
        animal.velocity.y *= damping;
        animal.poseAngle *= damping;
        continue;
      }

      // Crossing the full-energy threshold ends food pursuit immediately rather
      // than leaving the animal parked on a still-edible surface until retarget.
      if (!seeking && wasForaging && !justFinishedGrazing && animal.behavior !== 'resting') {
        animal.targetCellId = null;
        animal.behavior = 'resting';
        animal.behaviorTimer = 1.8 + behaviorNoise * 2.6;
        animal.nextTargetEvaluation = animal.behaviorTimer;
        animal.grazingSessionIntake = 0;
        const damping = Math.exp(-deltaSeconds * 5);
        animal.velocity.x *= damping;
        animal.velocity.y *= damping;
        continue;
      }

      currentTarget = animal.targetCellId ? this.cellById(animal.targetCellId) : undefined;
      targetFood = currentTarget ? this.edibleBiomass(currentTarget) : 0;
      currentTargetDistance = currentTarget
        ? Math.sqrt(distanceSquared(animal.position, this.cellWorldPoint(currentTarget)))
        : Number.POSITIVE_INFINITY;

      if (
        !seeking &&
        animal.nextTargetEvaluation <= 0 &&
        currentTarget &&
        currentTargetDistance <= 24 &&
        behaviorNoise < 0.42
      ) {
        animal.targetCellId = null;
        animal.behavior = 'resting';
        animal.behaviorTimer = 1.6 + behaviorNoise * 4;
        animal.nextTargetEvaluation = animal.behaviorTimer;
        const damping = Math.exp(-deltaSeconds * 5);
        animal.velocity.x *= damping;
        animal.velocity.y *= damping;
        continue;
      }

      if (
        animal.nextTargetEvaluation <= 0 ||
        (!currentTarget && animal.behavior !== 'resting') ||
        (seeking && targetFood < SHRIMP_FOOD_TARGET_BIOMASS && currentTargetDistance <= 24)
      ) {
        const foodTarget = seeking ? this.chooseFoodTarget(animal) : null;
        const retainExplorationTarget = Boolean(
          seeking && currentTarget &&
          targetFood < SHRIMP_FOOD_TARGET_BIOMASS && currentTargetDistance > 24,
        );
        animal.targetCellId = foodTarget?.id ??
          (retainExplorationTarget ? currentTarget!.id : this.chooseExplorationTarget(animal)?.id ?? null);
        animal.nextTargetEvaluation = foodTarget
          ? 0.8 + behaviorNoise * 0.6
          : forcedRoaming
            ? Math.max(0.1, animal.behaviorTimer)
            : 3.4 + behaviorNoise * 2.2;
      }

      const target = animal.targetCellId ? this.cellById(animal.targetCellId) : undefined;
      if (!target) {
        animal.behavior = animal.energy <= SHRIMP_WEAK_ENERGY ? 'starving' : 'resting';
        const damping = Math.exp(-deltaSeconds * 5);
        animal.velocity.x *= damping;
        animal.velocity.y *= damping;
        continue;
      }

      const targetPoint = this.cellWorldPoint(target);
      const dx = targetPoint.x - animal.position.x;
      const dy = targetPoint.y - animal.position.y;
      const distance = Math.max(0.001, Math.hypot(dx, dy));
      const hasFood = this.edibleBiomass(target) >= SHRIMP_TRACE_GRAZABLE_BIOMASS;
      const grazing = seeking && hasFood &&
        distance <= Math.max(SHRIMP_GRAZE_DISTANCE, target.cellSize * 1.4);
      if (grazing) {
        if (animal.behavior !== 'grazing') {
          animal.behaviorTimer = 3 + behaviorNoise * 2;
          animal.grazingSessionIntake = 0;
        }
        animal.behavior = 'grazing';
        const settle = 1 - Math.exp(-deltaSeconds * 8);
        animal.velocity.x += (-animal.velocity.x) * settle;
        animal.velocity.y += (-animal.velocity.y) * settle;
        animal.position.x += (targetPoint.x - animal.position.x) * Math.min(0.2, deltaSeconds * 2.2);
        animal.position.y += (targetPoint.y - animal.position.y) * Math.min(0.2, deltaSeconds * 2.2);
      } else {
        animal.behavior = animal.energy <= SHRIMP_WEAK_ENERGY
          ? 'starving'
          : seeking && hasFood ? 'traveling' : 'exploring';
        const weakFactor = animal.energy <= SHRIMP_WEAK_ENERGY ? 0.45 : 1;
        const baseSpeed = distance > 80 ? 78 : 30;
        const individualSpeed = 0.88 + deterministicNoise(animal.randomSeed) * 0.24;
        const lateralWave = Math.sin(animal.ageSeconds * 4.1 + animal.randomSeed) * 3.6;
        let desiredX = (dx / distance) * baseSpeed * individualSpeed * weakFactor;
        let desiredY = (dy / distance) * baseSpeed * individualSpeed * weakFactor;
        desiredX += (-dy / distance) * lateralWave;
        desiredY += (dx / distance) * lateralWave;

        for (const other of this.animals) {
          if (other.id === animal.id) continue;
          const separationX = animal.position.x - other.position.x;
          const separationY = animal.position.y - other.position.y;
          const separationDistance = Math.hypot(separationX, separationY);
          if (separationDistance <= 0.001 || separationDistance >= 24) continue;
          const pressure = (24 - separationDistance) / 24;
          desiredX += (separationX / separationDistance) * pressure * 34;
          desiredY += (separationY / separationDistance) * pressure * 34;
        }

        const response = 1 - Math.exp(-deltaSeconds * 4.2);
        animal.velocity.x += (desiredX - animal.velocity.x) * response;
        animal.velocity.y += (desiredY - animal.velocity.y) * response;
        animal.position.x += animal.velocity.x * deltaSeconds;
        animal.position.y += animal.velocity.y * deltaSeconds;
      }

      animal.position = this.clampAnimalPoint(animal.position);
      if (Math.abs(animal.velocity.x) > 2.5) animal.facing = animal.velocity.x < 0 ? -1 : 1;
      animal.poseAngle = clamp(
        Math.atan2(animal.velocity.y, Math.max(5, Math.abs(animal.velocity.x))),
        -0.34,
        0.34,
      );
    }
  }

  private recordAlgaeBiogeochemistry(deltaSeconds: number): void {
    for (const cell of this.allCells()) {
      this.biogeochemistry.recordAlgae(
        this.cellWorldPoint(cell),
        cell.biomass,
        cell.light,
        deltaSeconds,
      );
    }
  }

  private resolveBiogeochemistry(deltaSeconds: number): void {
    this.biogeochemistry.advance(
      deltaSeconds,
      this.allCells().map((cell) => ({
        point: this.cellWorldPoint(cell),
        biofilm: cell.biofilm,
      })),
    );
    if (this.probe) this.setProbe(this.probe);
  }

  private stepBiofilmDispersal(deltaSeconds: number): void {
    if (!this.biogeochemistry.effectsEnabled || deltaSeconds <= 0) return;
    const cells = this.allCells();
    const byId = new Map(cells.map((cell) => [cell.id, cell]));
    interface Transfer {
      source: SurfaceCellState;
      receiver: SurfaceCellState;
      guildId: MicrobeGuildId;
      amount: number;
    }
    const transfers: Transfer[] = [];

    for (const cell of cells) {
      for (const neighborId of cell.neighborIds) {
        if (cell.id >= neighborId) continue;
        const neighbor = byId.get(neighborId);
        if (!neighbor) continue;
        for (const guildId of ['decomposer', 'nitrifier'] as const) {
          const response = 1 - Math.exp(
            -MICROBE_ECOLOGY_RULES[guildId].surfaceSpreadRate * deltaSeconds,
          );
          const difference = cell.biofilm[guildId] - neighbor.biofilm[guildId];
          if (Math.abs(difference) < 0.012) continue;
          const source = difference > 0 ? cell : neighbor;
          const receiver = difference > 0 ? neighbor : cell;
          const available = Math.max(
            0,
            1 - receiver.biofilm.decomposer - receiver.biofilm.nitrifier,
          );
          const amount = Math.min(available, Math.abs(difference) * response * 0.5);
          if (amount > 0) transfers.push({ source, receiver, guildId, amount });
        }
      }
    }

    const incoming = new Map<string, number>();
    const outgoing = new Map<string, number>();
    for (const transfer of transfers) {
      incoming.set(
        transfer.receiver.id,
        (incoming.get(transfer.receiver.id) ?? 0) + transfer.amount,
      );
      const sourceKey = `${transfer.source.id}\0${transfer.guildId}`;
      outgoing.set(sourceKey, (outgoing.get(sourceKey) ?? 0) + transfer.amount);
    }
    for (const transfer of transfers) {
      const receiverCapacity = Math.max(
        0,
        1 - transfer.receiver.biofilm.decomposer - transfer.receiver.biofilm.nitrifier,
      );
      const incomingDemand = incoming.get(transfer.receiver.id) ?? 0;
      if (incomingDemand > receiverCapacity && incomingDemand > 0) {
        transfer.amount *= receiverCapacity / incomingDemand;
      }
      const sourceKey = `${transfer.source.id}\0${transfer.guildId}`;
      const outgoingDemand = outgoing.get(sourceKey) ?? 0;
      const available = transfer.source.biofilm[transfer.guildId];
      if (outgoingDemand > available && outgoingDemand > 0) {
        transfer.amount *= available / outgoingDemand;
      }
    }
    for (const transfer of transfers) {
      transfer.source.biofilm[transfer.guildId] = Math.max(
        0,
        transfer.source.biofilm[transfer.guildId] - transfer.amount,
      );
      transfer.receiver.biofilm[transfer.guildId] += transfer.amount;
    }

    // A small viable fraction leaves mature films, is carried by unresolved
    // tank circulation, and can establish on a disconnected wetted surface.
    // This is mass-conserving: every suspended propagule is removed from a
    // source film first, then either settles or loses viability.
    for (const cell of cells) {
      for (const guildId of ['decomposer', 'nitrifier'] as const) {
        const kinetics = MICROBE_ECOLOGY_RULES[guildId];
        const detached = cell.biofilm[guildId] *
          (1 - Math.exp(-kinetics.waterborneExportRate * deltaSeconds));
        if (detached <= 0) continue;
        cell.biofilm[guildId] = Math.max(0, cell.biofilm[guildId] - detached);
        this.suspendedBiofilm[guildId] += detached;
      }
    }

    for (const guildId of ['decomposer', 'nitrifier'] as const) {
      const kinetics = MICROBE_ECOLOGY_RULES[guildId];
      const suspendedBeforeDecay = this.suspendedBiofilm[guildId];
      this.suspendedBiofilm[guildId] *= Math.exp(-kinetics.suspendedDecayRate * deltaSeconds);
      this.biogeochemistry.recordSuspendedBiomassDeath(
        { x: TANK_WIDTH / 2, y: (WATER_TOP + GROUND_Y) / 2 },
        suspendedBeforeDecay - this.suspendedBiofilm[guildId],
      );
      const attempts = Math.max(
        1,
        Math.round(MICROBE_ECOLOGY_RULES.settlementAttemptsPerSecond * deltaSeconds),
      );
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        if (this.suspendedBiofilm[guildId] <= 1e-8 || cells.length === 0) break;
        this.biofilmSettlementCursor += 1;
        const guildOffset = guildId === 'decomposer' ? 17.3 : 71.9;
        const candidateIndex = Math.min(
          cells.length - 1,
          Math.floor(
            deterministicNoise(this.biofilmSettlementCursor * 1.97 + guildOffset) * cells.length,
          ),
        );
        const receiver = cells[candidateIndex];
        const occupiedFraction = receiver.biofilm.decomposer + receiver.biofilm.nitrifier;
        const available = Math.max(0, 1 - occupiedFraction);
        if (available <= 0) continue;
        const netGrowth = this.biogeochemistry.microbeNetGrowthAt(
          guildId,
          this.cellWorldPoint(receiver),
          occupiedFraction,
        );
        // Propagules may land in a poor site, but a food- and oxygen-rich site
        // retains a much larger viable fraction and becomes a visible colony.
        const retention = clamp(0.12 + netGrowth * 38, 0.04, 1);
        const offered = Math.max(
          MICROBE_ECOLOGY_RULES.minimumSettlement,
          this.suspendedBiofilm[guildId] *
            MICROBE_ECOLOGY_RULES.settlementFractionPerAttempt,
        );
        const amount = Math.min(
          available,
          this.suspendedBiofilm[guildId],
          offered * retention,
        );
        if (amount <= 0) continue;
        receiver.biofilm[guildId] += amount;
        this.suspendedBiofilm[guildId] -= amount;
      }
    }
  }

  private stepAnimalEcology(deltaSeconds: number): void {
    if (this.carcasses.length) {
      this.carcasses = this.carcasses
        .map((carcass) => ({ ...carcass, ageSeconds: carcass.ageSeconds + deltaSeconds }))
        .filter((carcass) => carcass.ageSeconds < SHRIMP_CARCASS_LIFETIME_SECONDS);
      if (
        this.selection?.kind === 'carcass' &&
        !this.carcasses.some((carcass) => carcass.id === this.selection?.carcassId)
      ) {
        this.selection = null;
      }
      this.snapshotDirty = true;
    }
    if (!this.animals.length) return;
    interface GrazingRequest {
      animal: AnimalState;
      cell: SurfaceCellState;
      nitzschia: number;
      oedogonium: number;
    }
    const requestsByCell = new Map<string, GrazingRequest[]>();
    const environmentalDeathCauses = new Map<
      string,
      'hypoxia' | 'toxicity' | 'temperature'
    >();
    const maintenanceRequests = new Map<string, number>();

    for (const animal of this.animals) {
      animal.ageSeconds += deltaSeconds;
      const temperature = this.biogeochemistry.temperatureAt(animal.position);
      const temperatureProfile = ANIMALS[animal.speciesId].temperature;
      const metabolicTemperatureFactor = thetaTemperatureFactor(
        temperature,
        temperatureProfile.referenceTemperature,
        temperatureProfile.metabolicTheta,
        temperatureProfile.minimumMetabolicFactor,
        temperatureProfile.maximumMetabolicFactor,
      );
      const reproductionTemperatureFactor = interpolateTemperatureResponse(
        temperatureProfile.reproductionCurve,
        temperature,
      );
      const thermalHealthSuitability = interpolateTemperatureResponse(
        temperatureProfile.healthCurve,
        temperature,
      );
      animal.reproductionCooldown = Math.max(
        0,
        animal.reproductionCooldown - deltaSeconds * reproductionTemperatureFactor,
      );
      animal.recentIntake *= Math.exp(-deltaSeconds / 8);
      animal.secondsSinceFood += deltaSeconds;

      const stageScale = animal.lifeStage === 'adult' ? 1 : 0.58;
      const activityCost = animal.behavior === 'traveling'
        ? SHRIMP_ECOLOGY_RULES.travelingActivityCostPerSecond
        : animal.behavior === 'grazing' || animal.behavior === 'exploring'
          ? SHRIMP_ECOLOGY_RULES.grazingActivityCostPerSecond
          : SHRIMP_ECOLOGY_RULES.restingActivityCostPerSecond;
      const baseCost = animal.lifeStage === 'adult'
        ? SHRIMP_BASE_METABOLISM
        : SHRIMP_ECOLOGY_RULES.juvenileBaseMetabolismPerSecond;
      // Convert the former abstract energy cost into real animal biomass. The
      // conversion preserves the established food requirement because a bite's
      // assimilated fraction replenishes the same reserve that pays this cost.
      maintenanceRequests.set(
        animal.id,
        (baseCost + activityCost) *
          this.animalEnergyCapacity(animal) *
          metabolicTemperatureFactor *
          deltaSeconds,
      );

      const water = this.biogeochemistry.effectsEnabled
        ? this.biogeochemistry.sampleAt(animal.position)
        : null;
      const oxygenStress = water
        ? clamp(
          (SHRIMP_OXYGEN_STRESS_START - water.oxygen) / SHRIMP_OXYGEN_STRESS_START,
          0,
          1,
        )
        : 0;
      const toxicStress = water
        ? clamp(
          (water.toxicWaste - SHRIMP_TOXIC_STRESS_START) /
            (SHRIMP_TOXIC_STRESS_FULL - SHRIMP_TOXIC_STRESS_START),
          0,
          1,
        )
        : 0;
      const thermalStress = clamp(1 - thermalHealthSuitability, 0, 1);
      const damageRate =
        Math.pow(oxygenStress, 1.35) *
          SHRIMP_ECOLOGY_RULES.oxygenMaximumDamagePerSecond +
        Math.pow(toxicStress, 1.25) *
          SHRIMP_ECOLOGY_RULES.toxicMaximumDamagePerSecond +
        Math.pow(thermalStress, 1.35) *
          temperatureProfile.maximumThermalDamagePerSecond;
      const recoveryRate = Math.max(
        0,
        1 - Math.max(oxygenStress, toxicStress, thermalStress),
      ) * SHRIMP_WATER_RECOVERY_RATE;
      animal.health = clamp01(
        animal.health + (recoveryRate - damageRate) * deltaSeconds,
      );
      if (animal.health <= 0) {
        const highestStress = Math.max(oxygenStress, toxicStress, thermalStress);
        environmentalDeathCauses.set(
          animal.id,
          highestStress === thermalStress
            ? 'temperature'
            : highestStress === oxygenStress
              ? 'hypoxia'
              : 'toxicity',
        );
      }

      const target = animal.targetCellId ? this.cellById(animal.targetCellId) : undefined;
      if (target && animal.behavior === 'grazing') {
        const targetPoint = this.cellWorldPoint(target);
        const distance = Math.sqrt(distanceSquared(animal.position, targetPoint));
        const food = this.edibleBiomass(target);
        if (
          food >= SHRIMP_TRACE_GRAZABLE_BIOMASS &&
          distance <= Math.max(SHRIMP_GRAZE_DISTANCE, target.cellSize * 1.4)
        ) {
          const requested = SHRIMP_BITE_RATE *
            (food / (food + SHRIMP_GRAZING_HALF_SATURATION)) *
            deltaSeconds * stageScale;
          const nitzschiaWeight = target.biomass.nitzschia;
          const oedogoniumWeight = target.biomass.oedogonium * 0.72;
          const totalWeight = nitzschiaWeight + oedogoniumWeight;
          if (totalWeight > 0) {
            const request: GrazingRequest = {
              animal,
              cell: target,
              nitzschia: requested * (nitzschiaWeight / totalWeight),
              oedogonium: requested * (oedogoniumWeight / totalWeight),
            };
            const requests = requestsByCell.get(target.id) ?? [];
            requests.push(request);
            requestsByCell.set(target.id, requests);
          }
        }
      }
    }

    for (const requests of requestsByCell.values()) {
      const cell = requests[0].cell;
      const totalNitzschia = requests.reduce((sum, request) => sum + request.nitzschia, 0);
      const totalOedogonium = requests.reduce((sum, request) => sum + request.oedogonium, 0);
      const nitzschiaScale = totalNitzschia > 0
        ? Math.min(1, cell.biomass.nitzschia / totalNitzschia)
        : 0;
      const oedogoniumScale = totalOedogonium > 0
        ? Math.min(1, cell.biomass.oedogonium / totalOedogonium)
        : 0;
      let consumedNitzschia = 0;
      let consumedOedogonium = 0;
      for (const request of requests) {
        const actualNitzschia = request.nitzschia * nitzschiaScale;
        const actualOedogonium = request.oedogonium * oedogoniumScale;
        const consumed = actualNitzschia + actualOedogonium;
        consumedNitzschia += actualNitzschia;
        consumedOedogonium += actualOedogonium;
        request.animal.recentIntake += consumed;
        request.animal.consumedBiomass += consumed;
        request.animal.grazingSessionIntake += consumed;
        this.totalAlgaeConsumed += consumed;
        request.animal.secondsSinceFood = 0;
        const assimilated = this.biogeochemistry.recordAnimalFeeding(
          request.animal.position,
          consumed,
        );
        const reserveLimit = request.animal.lifeStage === 'adult'
          ? WATER_CYCLE_RULES.shrimp.adultReserveBiomass
          : WATER_CYCLE_RULES.shrimp.juvenileReserveBiomass;
        const retained = Math.min(
          assimilated,
          Math.max(0, reserveLimit - request.animal.storedBiomass),
        );
        request.animal.storedBiomass += retained;
        this.biogeochemistry.recordAnimalAssimilationOverflow(
          request.animal.position,
          assimilated - retained,
        );
      }
      cell.biomass.nitzschia = Math.max(0, cell.biomass.nitzschia - consumedNitzschia);
      cell.biomass.oedogonium = Math.max(0, cell.biomass.oedogonium - consumedOedogonium);
      let traceTurnover = 0;
      if (
        cell.biomass.nitzschia > 0 &&
        cell.biomass.nitzschia < SHRIMP_TRACE_GRAZABLE_BIOMASS
      ) {
        traceTurnover += cell.biomass.nitzschia;
        cell.biomass.nitzschia = 0;
      }
      if (
        cell.biomass.oedogonium > 0 &&
        cell.biomass.oedogonium < SHRIMP_TRACE_GRAZABLE_BIOMASS
      ) {
        traceTurnover += cell.biomass.oedogonium;
        cell.biomass.oedogonium = 0;
      }
      if (traceTurnover > 0) {
        this.biogeochemistry.recordAlgaeTurnover(
          this.cellWorldPoint(cell),
          traceTurnover,
        );
      }
    }

    const newborns: AnimalState[] = [];
    const living: AnimalState[] = [];
    for (const animal of this.animals) {
      const temperature = this.biogeochemistry.temperatureAt(animal.position);
      const temperatureProfile = ANIMALS[animal.speciesId].temperature;
      const reproductionTemperatureFactor = interpolateTemperatureResponse(
        temperatureProfile.reproductionCurve,
        temperature,
      );
      const maintenanceRequest = maintenanceRequests.get(animal.id) ?? 0;
      const minimumStructure = this.animalMinimumViableStructure(animal);
      const availableForRespiration = animal.storedBiomass +
        Math.max(0, animal.structuralBiomass - minimumStructure);
      const actualRespiration = this.biogeochemistry.recordAnimalRespiration(
        animal.position,
        Math.min(maintenanceRequest, availableForRespiration),
      );
      const reserveLoss = Math.min(animal.storedBiomass, actualRespiration);
      animal.storedBiomass -= reserveLoss;
      const structuralLoss = Math.min(
        Math.max(0, animal.structuralBiomass - minimumStructure),
        Math.max(0, actualRespiration - reserveLoss),
      );
      animal.structuralBiomass -= structuralLoss;
      this.synchroniseAnimalEnergy(animal);

      const environmentalDeathCause = environmentalDeathCauses.get(animal.id);
      if (environmentalDeathCause) {
        this.killAnimal(animal, environmentalDeathCause);
        continue;
      }

      if (animal.ageSeconds >= animal.lifespanSeconds) {
        this.killAnimal(animal, 'old-age');
        continue;
      }

      if (animal.lifeStage === 'juvenile') {
        if (animal.energy >= 0.44 && animal.secondsSinceFood < 12) {
          const desiredProgress = Math.min(
            1,
            animal.growthProgress +
              deltaSeconds * reproductionTemperatureFactor / SHRIMP_MATURITY_SECONDS,
          );
          const birthBiomass = WATER_CYCLE_RULES.shrimp.juvenileBirthBiomass;
          const adultBiomass = WATER_CYCLE_RULES.shrimp.adultStructuralBiomass;
          const desiredStructuralBiomass = birthBiomass +
            (adultBiomass - birthBiomass) * desiredProgress;
          const materialNeeded = Math.max(
            0,
            desiredStructuralBiomass - animal.structuralBiomass,
          );
          const materialUsed = Math.min(animal.storedBiomass, materialNeeded);
          animal.storedBiomass -= materialUsed;
          animal.structuralBiomass += materialUsed;
          animal.growthProgress = clamp01(
            (animal.structuralBiomass - birthBiomass) / (adultBiomass - birthBiomass),
          );
        }
        animal.bodyLength = SHRIMP_JUVENILE_LENGTH +
          (SHRIMP_ADULT_LENGTH - SHRIMP_JUVENILE_LENGTH) * animal.growthProgress;
        if (animal.ageSeconds >= SHRIMP_MATURITY_SECONDS && animal.growthProgress >= 1) {
          animal.lifeStage = 'adult';
          animal.bodyLength = SHRIMP_ADULT_LENGTH;
          animal.reproductionCooldown = SHRIMP_NEW_ADULT_REPRODUCTION_COOLDOWN;
          this.recordAnimalPopulationEvent('matured', animal);
          const overflow = Math.max(
            0,
            animal.storedBiomass - WATER_CYCLE_RULES.shrimp.adultReserveBiomass,
          );
          if (overflow > 0) {
            animal.storedBiomass -= overflow;
            this.biogeochemistry.recordAnimalAssimilationOverflow(
              animal.position,
              overflow,
            );
          }
        }
        this.synchroniseAnimalEnergy(animal);
      }

      if (animal.lifeStage === 'adult' && animal.sex === 'female') {
        if (
          animal.gestationRemaining === null &&
          animal.reproductionCooldown <= 0 &&
          animal.energy >= SHRIMP_REPRODUCTION_ENERGY &&
          animal.reproductiveBiomass < SHRIMP_MAXIMUM_BROOD_BIOMASS
        ) {
          const allocation = Math.min(
            Math.max(
              0,
              animal.storedBiomass - SHRIMP_REPRODUCTIVE_SOMATIC_RESERVE_FLOOR,
            ),
            SHRIMP_MAXIMUM_BROOD_BIOMASS - animal.reproductiveBiomass,
          );
          animal.storedBiomass -= allocation;
          animal.reproductiveBiomass += allocation;
          this.synchroniseAnimalEnergy(animal);
        }
        if (animal.gestationRemaining !== null) {
          // Embryos were funded from the mother's conserved reserve when
          // mating completed. Development therefore follows temperature and
          // maternal health instead of stopping merely because the last bite
          // was more than a few seconds ago.
          const gestationCanAdvance =
            animal.energy >= SHRIMP_ECOLOGY_RULES.gestationEnergy &&
            animal.health > 0.5 &&
            animal.reproductiveBiomass >= SHRIMP_MINIMUM_BROOD_BIOMASS;
          if (gestationCanAdvance) {
            animal.gestationRemaining -= deltaSeconds * reproductionTemperatureFactor;
          }
          if (animal.gestationRemaining <= 0) {
            const desiredClutchSize = SHRIMP_ECOLOGY_RULES.minimumClutchSize +
              Math.floor(deterministicNoise(
                animal.randomSeed + animal.ageSeconds * 0.31,
              ) * (
                SHRIMP_ECOLOGY_RULES.maximumClutchSize -
                SHRIMP_ECOLOGY_RULES.minimumClutchSize + 1
              ));
            const availableSlots = Math.max(
              0,
              SHRIMP_TECHNICAL_POPULATION_LIMIT - this.animals.length - newborns.length,
            );
            const materialSlots = Math.floor(
              animal.reproductiveBiomass /
                WATER_CYCLE_RULES.shrimp.juvenileBirthBiomass,
            );
            const clutchSize = Math.min(desiredClutchSize, availableSlots, materialSlots);
            if (clutchSize >= SHRIMP_ECOLOGY_RULES.minimumClutchSize) {
              animal.reproductiveBiomass -=
                clutchSize * WATER_CYCLE_RULES.shrimp.juvenileBirthBiomass;
              for (let index = 0; index < clutchSize; index += 1) {
                const newborn = this.createJuvenileAnimalState(animal, index);
                newborns.push(newborn);
                this.recordAnimalPopulationEvent('birth', newborn, { parentId: animal.id });
              }
              animal.gestationRemaining = null;
              animal.reproductionCooldown = SHRIMP_POST_BROOD_COOLDOWN;
              this.synchroniseAnimalEnergy(animal);
            } else {
              // This can only occur after loading an older save whose gestation
              // did not reserve a brood. Let the mother rebuild that conserved
              // material instead of creating offspring from nothing.
              animal.gestationRemaining = 0;
            }
          }
        } else if (
          animal.reproductionCooldown <= 0 &&
          animal.energy >= SHRIMP_REPRODUCTION_ENERGY &&
          animal.reproductiveBiomass >= SHRIMP_MINIMUM_BROOD_BIOMASS &&
          this.animals.length + newborns.length < SHRIMP_TECHNICAL_POPULATION_LIMIT
        ) {
          const eligibleMale = this.animals.find((candidate) =>
            candidate.id !== animal.id &&
            candidate.lifeStage === 'adult' &&
            candidate.sex === 'male' &&
            candidate.energy >= SHRIMP_ECOLOGY_RULES.maleReproductionEnergy &&
            candidate.reproductionCooldown <= 0 &&
            distanceSquared(candidate.position, animal.position) <=
              SHRIMP_MATING_ENCOUNTER_RADIUS * SHRIMP_MATING_ENCOUNTER_RADIUS,
          );
          animal.matingAccumulator = eligibleMale
            ? animal.matingAccumulator + deltaSeconds * reproductionTemperatureFactor
            : Math.max(0, animal.matingAccumulator - deltaSeconds);
          if (animal.matingAccumulator >= SHRIMP_MATING_SECONDS) {
            animal.gestationRemaining = SHRIMP_GESTATION_SECONDS;
            animal.matingAccumulator = 0;
            if (eligibleMale) {
              eligibleMale.reproductionCooldown = SHRIMP_MALE_POST_MATING_COOLDOWN;
            }
          }
        } else {
          animal.matingAccumulator = Math.max(0, animal.matingAccumulator - deltaSeconds);
        }
      }

      if (!this.biogeochemistry.effectsEnabled) {
        // Earlier missions still use energy as their simple health ceiling,
        // but it must not erase thermal damage accumulated from the shared
        // water-temperature field. Safe water can heal that damage gradually
        // on later steps; depleted energy can only lower the current health.
        animal.health = Math.min(
          animal.health,
          clamp01(animal.energy / SHRIMP_WEAK_ENERGY),
        );
      }
      if (
        animal.storedBiomass <= 1e-9 &&
        animal.structuralBiomass <=
          this.animalMinimumViableStructure(animal) + 1e-9
      ) {
        this.killAnimal(animal, 'starvation');
        continue;
      }
      living.push(animal);
    }
    this.animals = [...living, ...newborns];
    this.snapshotDirty = true;
  }

  private killAnimal(animal: AnimalState, cause: AnimalCarcassSnapshot['cause']): void {
    const waterAtDeath = this.biogeochemistry.effectsEnabled
      ? this.biogeochemistry.sampleAt(animal.position)
      : null;
    const temperatureAtDeath = this.biogeochemistry.temperatureAt(animal.position);
    this.recordAnimalPopulationEvent('death', animal, { cause, water: waterAtDeath });
    this.carcasses.push({
      id: `carcass:${animal.id}`,
      sourceAnimalId: animal.id,
      speciesId: animal.speciesId,
      position: { ...animal.position },
      facing: animal.facing,
      poseAngle: animal.poseAngle,
      bodyLength: animal.bodyLength,
      lifeStage: animal.lifeStage,
      cause,
      waterAtDeath,
      temperatureAtDeath,
      ageSeconds: 0,
    });
    this.biogeochemistry.recordDeath(
      animal.position,
      this.biogeochemistry.effectsEnabled
        ? animal.structuralBiomass + animal.storedBiomass +
          animal.reproductiveBiomass
        : animal.lifeStage === 'adult'
          ? WATER_CYCLE_RULES.shrimp.adultStructuralBiomass
          : WATER_CYCLE_RULES.shrimp.juvenileBirthBiomass,
    );
    if (this.selection?.kind === 'animal' && this.selection.animalId === animal.id) {
      this.selection = null;
    }
  }

  private edibleBiomass(cell: SurfaceCellState): number {
    return cell.biomass.nitzschia + cell.biomass.oedogonium * 0.72;
  }

  private animalTargetStructuralBiomass(animal: AnimalState): number {
    if (animal.lifeStage === 'adult') {
      return WATER_CYCLE_RULES.shrimp.adultStructuralBiomass;
    }
    const birth = WATER_CYCLE_RULES.shrimp.juvenileBirthBiomass;
    return birth + (
      WATER_CYCLE_RULES.shrimp.adultStructuralBiomass - birth
    ) * clamp01(animal.growthProgress);
  }

  private animalEnergyCapacity(animal: AnimalState): number {
    return this.animalTargetStructuralBiomass(animal) *
      SHRIMP_ENERGY_CAPACITY_PER_STRUCTURAL_BIOMASS;
  }

  private animalMinimumViableStructure(animal: AnimalState): number {
    return this.animalTargetStructuralBiomass(animal) *
      SHRIMP_MINIMUM_VIABLE_STRUCTURE_RATIO;
  }

  private synchroniseAnimalEnergy(animal: AnimalState): void {
    const availableReserve = Math.max(0, animal.storedBiomass);
    const reserveCapacity = animal.lifeStage === 'adult'
      ? WATER_CYCLE_RULES.shrimp.adultReserveBiomass
      : WATER_CYCLE_RULES.shrimp.juvenileReserveBiomass;
    const structuralCondition = clamp01(
      animal.structuralBiomass /
        Math.max(1e-9, this.animalTargetStructuralBiomass(animal)),
    );
    const reserveCondition = clamp01(
      availableReserve / Math.max(1e-9, reserveCapacity),
    );
    animal.energy = clamp01(
      structuralCondition * SHRIMP_STRUCTURE_CONDITION_SHARE +
      reserveCondition * SHRIMP_RESERVE_CONDITION_SHARE,
    );
  }

  private chooseFoodTarget(animal: AnimalState): SurfaceCellState | null {
    const detectionRadius = animal.energy <= SHRIMP_EMERGENCY_SEARCH_ENERGY
      ? SHRIMP_EMERGENCY_FOOD_RADIUS
      : SHRIMP_LOCAL_FOOD_RADIUS;
    const reservations = new Map<string, number>();
    for (const candidate of this.animals) {
      if (!candidate.targetCellId || candidate.id === animal.id) continue;
      reservations.set(candidate.targetCellId, (reservations.get(candidate.targetCellId) ?? 0) + 1);
    }
    let best: { cell: SurfaceCellState; score: number } | null = null;
    for (const cell of this.allCells()) {
      const food = this.edibleBiomass(cell);
      if (food < SHRIMP_FOOD_TARGET_BIOMASS) continue;
      const point = this.cellWorldPoint(cell);
      const distance = Math.sqrt(distanceSquared(animal.position, point));
      if (distance > detectionRadius) continue;
      const congestion = reservations.get(cell.id) ?? 0;
      // Preserve a target only while traveling toward it, so movement does not
      // jitter between neighboring cells. A completed grazing target is cleared
      // before this scorer runs and receives no persistent memory or tabu state.
      const targetCommitment = cell.id === animal.targetCellId ? 14 : 0;
      const noise = deterministicNoise(
        animal.randomSeed + cell.index * 1.7 + point.x * 0.01,
      ) * 3;
      // Food search is an encounter, not omniscience: choose a nearby edible
      // surface instead of steering toward the globally densest colony.
      const score = -distance - congestion * 20 + targetCommitment + noise;
      if (!best || score > best.score) best = { cell, score };
    }
    return best?.cell ?? null;
  }

  private chooseExplorationTarget(animal: AnimalState): SurfaceCellState | null {
    const cells = this.allCells();
    if (!cells.length) return null;
    const phase = Math.floor(animal.ageSeconds / 4.5);
    const heading =
      deterministicNoise(animal.randomSeed + phase * 19 + 0.37) * Math.PI * 2;
    const roamingDistance = 170;
    const desiredPoint = {
      x: animal.position.x + Math.cos(heading) * roamingDistance,
      y: animal.position.y + Math.sin(heading) * roamingDistance,
    };
    let best: { cell: SurfaceCellState; score: number } | null = null;
    const samples = Math.min(48, cells.length);
    for (let index = 0; index < samples; index += 1) {
      const sampleIndex = Math.floor(deterministicNoise(
        animal.randomSeed + phase * 19 + index * 7.3,
      ) * cells.length);
      const cell = cells[sampleIndex];
      const point = this.cellWorldPoint(cell);
      // Roaming has no hidden knowledge of food outside the local sensing
      // radius. A time-varying individual heading defines a local random walk,
      // and the closest reachable surface is chosen from geometry alone;
      // food can only become a target after the shrimp physically approaches
      // it and chooseFoodTarget detects it locally.
      const score =
        -Math.sqrt(distanceSquared(point, desiredPoint)) -
        (point.y < WATER_TOP + 80 ? 120 : 0);
      if (!best || score > best.score) best = { cell, score };
    }
    return best?.cell ?? cells[0];
  }

  private sampleLightField(point: Vec2): number {
    const column = clamp(
      Math.floor((point.x / TANK_WIDTH) * this.lightField.columns),
      0,
      this.lightField.columns - 1,
    );
    const row = clamp(
      Math.floor(((point.y - WATER_TOP) / (GROUND_Y - WATER_TOP)) * this.lightField.rows),
      0,
      this.lightField.rows - 1,
    );
    return this.lightField.values[row * this.lightField.columns + column] ?? 0;
  }

  private producerActivityPoint(
    cell: SurfaceCellState,
    speciesId: SpeciesId,
  ): Vec2 {
    const surfacePoint = this.cellWorldPoint(cell);
    if (speciesId !== 'vallisneria') return surfacePoint;
    // Structural leaf size follows the much slower ramet life cycle, not the
    // reserve biomass lost and regained within one night/day cycle.
    const ramet = this.seedPlacements.find((placement) =>
      placement.speciesId === 'vallisneria' && placement.cellId === cell.id
    );
    const anchor = ramet ? this.vallisneriaRootPosition(ramet, cell) : surfacePoint;
    const structuralScale = ramet?.plant?.structuralScale ?? 0.72;
    const canopy = vallisneriaCanopyBounds(cell.index, anchor, structuralScale);
    return {
      x: anchor.x,
      y: Math.max(WATER_TOP + 16, canopy.minY + 5),
    };
  }

  private createSeedPlacement(
    id: string,
    speciesId: SpeciesId,
    cellId: string,
    origin: 'supplied' | 'runner' = 'supplied',
    parentId: string | null = null,
    rootPosition?: Vec2,
  ): SeedPlacementState {
    const cell = this.cellById(cellId);
    return {
      id,
      speciesId,
      cellId,
      locked: false,
      origin,
      rootPosition: speciesId === 'vallisneria' && cell
        ? rootPosition
          ? { ...rootPosition }
          : this.defaultVallisneriaRootPosition(id, cell)
        : undefined,
      plant: speciesId === 'vallisneria'
        ? this.createVallisneriaLifeState(id, origin, parentId)
        : undefined,
    };
  }

  /**
   * The biology grid stays discrete, but a ramet roots at a stable continuous
   * point inside its cell. This prevents rows and columns from becoming a
   * visible planting grid while keeping deterministic replays.
   */
  private defaultVallisneriaRootPosition(id: string, cell: SurfaceCellState): Vec2 {
    const seed = deterministicStringSeed(id);
    const radius = Math.max(1, cell.cellSize * 0.43);
    return {
      x: clamp(
        cell.x + (deterministicNoise(seed * 0.0371) * 2 - 1) * radius,
        2,
        TANK_WIDTH - 2,
      ),
      y: clamp(
        cell.y + (deterministicNoise(seed * 0.0713 + 17) * 2 - 1) * radius,
        GROUND_Y - cell.cellSize * 3 + 1,
        GROUND_Y - 1,
      ),
    };
  }

  private vallisneriaRootPosition(
    placement: SeedPlacementState,
    cell: SurfaceCellState,
  ): Vec2 {
    return placement.rootPosition
      ? placement.rootPosition
      : this.defaultVallisneriaRootPosition(placement.id, cell);
  }

  private createVallisneriaLifeState(
    id: string,
    origin: 'supplied' | 'runner',
    parentId: string | null,
  ): VallisneriaLifeState {
    const seed = deterministicStringSeed(id);
    const lifespanSeconds = VALLISNERIA_MIN_LIFESPAN_SECONDS +
      deterministicNoise(seed * 0.0137) *
      (VALLISNERIA_MAX_LIFESPAN_SECONDS - VALLISNERIA_MIN_LIFESPAN_SECONDS);
    return {
      parentId,
      connectedToParent: origin === 'runner' && parentId !== null,
      // Inventory plants are established young rosettes, while a runner-born
      // daughter visibly starts small and must mature before making a runner.
      ageSeconds: origin === 'supplied'
        ? 180 + deterministicNoise(seed * 0.0211) * 120
        : 0,
      lifespanSeconds,
      structuralScale: origin === 'supplied'
        ? 0.48 + deterministicNoise(seed * 0.0319) * 0.1
        : 0.18,
      runnerProgress: origin === 'supplied'
        ? deterministicNoise(seed * 0.0473) * 0.12
        : 0,
      reproductionCount: 0,
      stressSeconds: 0,
    };
  }

  private vallisneriaLifeStage(life: VallisneriaLifeState): PlantLifeStage {
    if (life.ageSeconds < VALLISNERIA_JUVENILE_SECONDS) return 'juvenile';
    if (life.ageSeconds >= life.lifespanSeconds * VALLISNERIA_SENESCENCE_START_RATIO) {
      return 'senescent';
    }
    return 'mature';
  }

  private vallisneriaHealth(placement: SeedPlacementState, cell: SurfaceCellState): number {
    const life = placement.plant;
    if (!life) return 0;
    const reserveHealth = clamp01((cell.biomass.vallisneria - 0.018) / 0.27);
    const stressHealth = 1 - clamp01(life.stressSeconds / VALLISNERIA_LOW_RESERVE_GRACE_SECONDS);
    return reserveHealth * stressHealth;
  }

  private runnerDestination(parent: SeedPlacementState): SurfaceCellState | null {
    const source = this.cellById(parent.cellId);
    if (!source || source.surfaceKind !== 'substrate') return null;
    const sourcePoint = this.vallisneriaRootPosition(parent, source);
    const occupiedCells = new Set(this.seedPlacements
      .filter((placement) => placement.speciesId === 'vallisneria')
      .map((placement) => placement.cellId));
    const parentSeed = deterministicStringSeed(parent.id) + (parent.plant?.reproductionCount ?? 0) * 97;
    const sourceTotal = source.biomass.oedogonium +
      source.biomass.nitzschia + source.biomass.vallisneria;
    const sourceLight = this.sampleLightField(this.producerActivityPoint(source, 'vallisneria'));
    const sourceTemperature = this.biogeochemistry.temperatureAt(
      this.producerActivityPoint(source, 'vallisneria'),
    );
    const sourceSuitability = habitatSuitability(
      'vallisneria',
      sourceLight,
      sourceTemperature,
    );
    // Ramets in a poor or crowded patch tend to explore farther before
    // rooting; productive patches keep a shorter, denser clone network.
    const preferredDistance = 82 + (1 - sourceSuitability) * 34 +
      clamp01((sourceTotal - 0.62) / 0.38) * 24;
    const candidates = this.substrateCells.flatMap((cell) => {
      if (occupiedCells.has(cell.id) || cell.biomass.vallisneria > ALGAE_VISIBLE_BIOMASS) return [];
      const total = cell.biomass.oedogonium + cell.biomass.nitzschia + cell.biomass.vallisneria;
      if (total + VALLISNERIA_RUNNER_BIOMASS > 1) return [];
      const distance = Math.sqrt(distanceSquared(sourcePoint, this.cellWorldPoint(cell)));
      if (
        distance < VALLISNERIA_RUNNER_MIN_DISTANCE ||
        distance > VALLISNERIA_RUNNER_MAX_DISTANCE
      ) return [];
      const targetPoint = this.producerActivityPoint(cell, 'vallisneria');
      const targetSuitability = habitatSuitability(
        'vallisneria',
        this.sampleLightField(targetPoint),
        this.biogeochemistry.temperatureAt(targetPoint),
      );
      // Clonal foraging is a bias, not omniscience: habitat and competition
      // matter, while deterministic noise still produces varied directions.
      const competition = clamp01(total);
      const score = Math.abs(distance - preferredDistance) +
        (1 - targetSuitability) * 68 +
        competition * 54 +
        deterministicNoise(parentSeed + cell.index * 1.71) * 24;
      return [{ cell, score }];
    });
    candidates.sort((left, right) => left.score - right.score);
    return candidates[0]?.cell ?? null;
  }

  private stepVallisneriaClonalIntegration(deltaSeconds: number): void {
    const byId = new Map(this.seedPlacements.map((placement) => [placement.id, placement]));
    for (const daughter of this.seedPlacements) {
      const life = daughter.plant;
      if (
        daughter.speciesId !== 'vallisneria' ||
        !life ||
        !life.connectedToParent
      ) continue;
      const parent = life.parentId ? byId.get(life.parentId) : undefined;
      const parentCell = parent ? this.cellById(parent.cellId) : undefined;
      const daughterCell = this.cellById(daughter.cellId);
      if (
        !parent?.plant ||
        !parentCell ||
        !daughterCell ||
        life.ageSeconds >= VALLISNERIA_JUVENILE_SECONDS
      ) {
        life.connectedToParent = false;
        continue;
      }
      const parentSurplus = Math.max(0, parentCell.biomass.vallisneria - 0.24);
      const daughterDeficit = Math.max(
        0,
        VALLISNERIA_CLONAL_SUPPORT_TARGET - daughterCell.biomass.vallisneria,
      );
      const transfer = Math.min(
        parentSurplus,
        daughterDeficit,
        VALLISNERIA_CLONAL_SUPPORT_PER_SECOND * deltaSeconds,
      );
      if (transfer <= 0) continue;
      parentCell.biomass.vallisneria -= transfer;
      daughterCell.biomass.vallisneria += transfer;
    }
  }

  private stepVallisneriaLifecycle(deltaSeconds: number): void {
    const deaths = new Set<string>();
    const daughters: SeedPlacementState[] = [];
    this.stepVallisneriaClonalIntegration(deltaSeconds);

    for (const placement of this.seedPlacements) {
      if (placement.speciesId !== 'vallisneria' || !placement.plant) continue;
      const cell = this.cellById(placement.cellId);
      if (!cell) {
        deaths.add(placement.id);
        continue;
      }
      const life = placement.plant;
      life.ageSeconds += deltaSeconds;
      const biomass = cell.biomass.vallisneria;
      life.stressSeconds = biomass < VALLISNERIA_LOW_RESERVE
        ? life.stressSeconds + deltaSeconds
        : Math.max(0, life.stressSeconds - deltaSeconds * 1.8);

      const stage = this.vallisneriaLifeStage(life);
      const reserveScale = 0.16 + 0.84 * clamp01((biomass - 0.02) / 0.46);
      const juvenileLimit = stage === 'juvenile'
        ? 0.22 + 0.78 * clamp01(life.ageSeconds / VALLISNERIA_JUVENILE_SECONDS)
        : 1;
      const senescenceProgress = stage === 'senescent'
        ? clamp01(
          (life.ageSeconds - life.lifespanSeconds * VALLISNERIA_SENESCENCE_START_RATIO) /
          (life.lifespanSeconds * (1 - VALLISNERIA_SENESCENCE_START_RATIO)),
        )
        : 0;
      const targetScale = Math.min(reserveScale, juvenileLimit) * (1 - senescenceProgress * 0.42);
      const responseSeconds = targetScale >= life.structuralScale ? 150 : 360;
      life.structuralScale += (targetScale - life.structuralScale) *
        clamp01(deltaSeconds / responseSeconds);
      life.structuralScale = clamp(life.structuralScale, 0.12, 1);

      if (stage === 'senescent' && biomass > 0) {
        const senescenceLoss = Math.min(
          biomass,
          biomass * (0.0008 + senescenceProgress * 0.0024) * deltaSeconds,
        );
        cell.biomass.vallisneria -= senescenceLoss;
        this.biogeochemistry.recordAlgaeTurnover(
          this.vallisneriaRootPosition(placement, cell),
          senescenceLoss,
        );
      }

      const expired = life.ageSeconds >= life.lifespanSeconds;
      const reserveCollapsed = life.stressSeconds >= VALLISNERIA_LOW_RESERVE_GRACE_SECONDS;
      if (expired || reserveCollapsed || cell.biomass.vallisneria <= 0.004) {
        const remaining = Math.max(0, cell.biomass.vallisneria);
        if (remaining > 0) {
          this.biogeochemistry.recordAlgaeTurnover(
            this.vallisneriaRootPosition(placement, cell),
            remaining,
          );
          cell.biomass.vallisneria = 0;
        }
        deaths.add(placement.id);
        continue;
      }

      const health = this.vallisneriaHealth(placement, cell);
      if (stage !== 'mature' || health < 0.68 || biomass < VALLISNERIA_RUNNER_BIOMASS + 0.18) {
        life.runnerProgress = Math.max(0, life.runnerProgress - deltaSeconds / 1_800);
        continue;
      }
      const canopyLight = this.sampleLightField(this.producerActivityPoint(cell, 'vallisneria'));
      const temperature = this.biogeochemistry.temperatureAt(this.producerActivityPoint(cell, 'vallisneria'));
      const suitability = habitatSuitability('vallisneria', canopyLight, temperature);
      life.runnerProgress += deltaSeconds / VALLISNERIA_RUNNER_INTERVAL_SECONDS *
        clamp(health * suitability * (biomass / 0.5), 0, 1.35);
      if (life.runnerProgress < 1) continue;

      const destination = this.runnerDestination(placement);
      if (!destination) {
        life.runnerProgress = Math.min(1, life.runnerProgress);
        continue;
      }
      const transferred = Math.min(VALLISNERIA_RUNNER_BIOMASS, cell.biomass.vallisneria - 0.18);
      if (transferred <= 0.04) continue;
      cell.biomass.vallisneria -= transferred;
      destination.biomass.vallisneria += transferred;
      const daughterId = `seed-${++this.seedCounter}`;
      daughters.push(this.createSeedPlacement(
        daughterId,
        'vallisneria',
        destination.id,
        'runner',
        placement.id,
      ));
      life.runnerProgress -= 1;
      life.reproductionCount += 1;
    }

    if (deaths.size) {
      this.seedPlacements = this.seedPlacements.filter((placement) => !deaths.has(placement.id));
    }
    if (daughters.length) this.seedPlacements.push(...daughters);
    if (this.currentCanopyLightSignature() !== this.canopyLightSignature) {
      this.lightDirty = true;
    }
    if (deaths.size || daughters.length) this.snapshotDirty = true;
  }

  private stepGrowth(deltaSeconds: number): void {
    const cells = this.allCells();
    const byId = new Map(cells.map((cell) => [cell.id, cell]));
    const original = new Map(cells.map((cell) => [cell.id, cloneBiomass(cell.biomass)]));
    const next = new Map<string, SpeciesBiomass>();

    for (const cell of cells) {
      const current = original.get(cell.id)!;
      const total = current.oedogonium + current.nitzschia + current.vallisneria;
      const freeCapacity = clamp01(1 - total);
      const cellPoint = this.cellWorldPoint(cell);
      const rates = emptyBiomass();
      const physiology = new Map<SpeciesId, ReturnType<typeof algaePhysiology>>();
      const resourceFactors = new Map<SpeciesId, number>();
      for (const speciesId of this.scenario.allowedSpecies) {
        const activityPoint = this.producerActivityPoint(cell, speciesId);
        const activityLight = speciesId === 'vallisneria'
          ? this.sampleLightField(activityPoint)
          : cell.light;
        const localTemperature = this.biogeochemistry.temperatureAt(activityPoint);
        const response = algaePhysiology(speciesId, activityLight, localTemperature);
        const resourceFactor = this.biogeochemistry.algaeResourceFactor(activityPoint);
        physiology.set(speciesId, response);
        resourceFactors.set(speciesId, resourceFactor);
        rates[speciesId] = response.netGrowth > 0
          ? response.netGrowth * resourceFactor
          : response.netGrowth;
      }
      const weightedAverage = total > 0
        ? (
          current.oedogonium * rates.oedogonium +
          current.nitzschia * rates.nitzschia +
          current.vallisneria * rates.vallisneria
        ) / total
        : 0;
      const result = emptyBiomass();
      let fixedBiomass = 0;
      let respiredBiomass = 0;
      for (const speciesId of this.scenario.allowedSpecies) {
        const amount = current[speciesId];
        if (amount <= 0) continue;
        const response = physiology.get(speciesId)!;
        const activityPoint = this.producerActivityPoint(cell, speciesId);
        const resourceFactor = resourceFactors.get(speciesId) ?? 1;
        const rate = rates[speciesId];
        // Density-dependent limitation throttles only the photosynthesis left
        // after replacing respiration and stress losses. This preserves the
        // established logistic net-growth curve while the ledger can still
        // observe gross production and respiration as separate real fluxes.
        const densityAdjustedGross = response.netGrowth > 0
          ? response.respiration + response.lightStressTurnover +
            response.netGrowth * resourceFactor * freeCapacity
          : response.grossPhotosynthesis;
        const requestedProduction = amount * densityAdjustedGross * deltaSeconds;
        const production = this.biogeochemistry.commitAlgaeProduction(
          activityPoint,
          requestedProduction,
        );
        fixedBiomass += production;
        const requestedRespiration = Math.min(
          amount + production,
          amount * response.respiration * deltaSeconds,
        );
        const respiration = this.biogeochemistry.commitAlgaeRespiration(
          activityPoint,
          requestedRespiration,
        );
        respiredBiomass += respiration;
        const stressTurnover = amount * response.lightStressTurnover * deltaSeconds;
        const replacement = total > 0.04
          ? amount * (rate - weightedAverage) * total * 1.35 * deltaSeconds
          : 0;
        const naturalTurnover = amount * 0.0018 * deltaSeconds;
        result[speciesId] = Math.max(
          0,
          amount + production - respiration - stressTurnover + replacement - naturalTurnover,
        );
      }

      // A developed filamentous canopy shades the low-profile diatom film below it.
      if (current.oedogonium > 0.24 && rates.oedogonium > rates.nitzschia) {
        result.nitzschia = Math.max(
          0,
          result.nitzschia - current.nitzschia * current.oedogonium * 0.018 * deltaSeconds,
        );
      }
      const localLoss = Math.max(
        0,
        total + fixedBiomass - respiredBiomass -
          result.oedogonium - result.nitzschia - result.vallisneria,
      );
      this.biogeochemistry.recordAlgaeTurnover(cellPoint, localLoss);
      next.set(cell.id, result);
    }

    interface RecruitmentTransfer {
      sourceId: string;
      receiverId: string;
      speciesId: SpeciesId;
      amount: number;
    }
    const recruitmentTransfers: RecruitmentTransfer[] = [];

    // Colonies export real biomass as propagules. Proposals are calculated from
    // the same pre-step state, then capacity-scaled and applied together, so the
    // result stays deterministic and independent of cell iteration order.
    for (const cell of cells) {
      const source = original.get(cell.id)!;
      for (const neighborId of cell.neighborIds) {
        const neighbor = byId.get(neighborId);
        if (!neighbor) continue;
        const receiver = next.get(neighbor.id)!;
        const receiverTotal = receiver.oedogonium + receiver.nitzschia + receiver.vallisneria;
        const freeCapacity = clamp01(1 - receiverTotal);
        if (freeCapacity <= 0.0001) continue;
        for (const speciesId of this.scenario.allowedSpecies) {
          if (SPECIES[speciesId].dispersalRate <= 0) continue;
          if (source[speciesId] < 0.012) continue;
          const suitability = habitatSuitability(
            speciesId,
            neighbor.light,
            this.biogeochemistry.temperatureAt(this.cellWorldPoint(neighbor)),
          );
          if (suitability <= 0.01) continue;
          const recruitment =
            SPECIES[speciesId].dispersalRate *
            source[speciesId] *
            deltaSeconds *
            suitability *
            freeCapacity /
            Math.max(2, cell.neighborIds.length);
          if (recruitment <= 0) continue;
          recruitmentTransfers.push({
            sourceId: cell.id,
            receiverId: neighbor.id,
            speciesId,
            amount: recruitment,
          });
        }
      }
    }

    // Several colonies can target the same free space. Scale all incoming
    // propagules proportionally rather than letting whichever cell is visited
    // first claim the receiver. This also prevents final capacity clamping from
    // silently destroying transferred mass.
    const incomingDemand = new Map<string, number>();
    for (const transfer of recruitmentTransfers) {
      incomingDemand.set(
        transfer.receiverId,
        (incomingDemand.get(transfer.receiverId) ?? 0) + transfer.amount,
      );
    }
    for (const transfer of recruitmentTransfers) {
      const receiver = next.get(transfer.receiverId)!;
      const freeCapacity = clamp01(
        1 - receiver.oedogonium - receiver.nitzschia - receiver.vallisneria,
      );
      const demand = incomingDemand.get(transfer.receiverId) ?? 0;
      if (demand > freeCapacity && demand > 0) {
        transfer.amount *= freeCapacity / demand;
      }
    }

    // A source cannot export more than remains after its own growth/turnover.
    // The same scale is applied to every destination for that species.
    const outgoingDemand = new Map<string, number>();
    for (const transfer of recruitmentTransfers) {
      const key = `${transfer.sourceId}\0${transfer.speciesId}`;
      outgoingDemand.set(key, (outgoingDemand.get(key) ?? 0) + transfer.amount);
    }
    for (const transfer of recruitmentTransfers) {
      const key = `${transfer.sourceId}\0${transfer.speciesId}`;
      const demand = outgoingDemand.get(key) ?? 0;
      const available = next.get(transfer.sourceId)![transfer.speciesId];
      if (demand > available && demand > 0) {
        transfer.amount *= available / demand;
      }
    }

    for (const transfer of recruitmentTransfers) {
      const source = next.get(transfer.sourceId)!;
      const receiver = next.get(transfer.receiverId)!;
      source[transfer.speciesId] -= transfer.amount;
      receiver[transfer.speciesId] += transfer.amount;
    }

    for (const cell of cells) {
      const result = next.get(cell.id)!;
      const total = result.oedogonium + result.nitzschia + result.vallisneria;
      if (total > 1) {
        result.oedogonium /= total;
        result.nitzschia /= total;
        result.vallisneria /= total;
      }
      cell.biomass = {
        oedogonium: clamp01(result.oedogonium),
        nitzschia: clamp01(result.nitzschia),
        vallisneria: clamp01(result.vallisneria),
      };
    }
  }

  private stepTemperature(deltaSeconds: number): void {
    this.biogeochemistry.advanceTemperature(deltaSeconds, 22);
    this.waterTemperature = this.biogeochemistry.averageTemperature();
    if (this.probe) this.setProbe(this.probe);
  }

  private evaluateMission(deltaSeconds: number): void {
    if (
      this.scenario.mode !== 'challenge' ||
      !this.scenario.target ||
      this.outcome !== 'pending'
    ) return;
    if (this.currentTargetMet()) {
      this.successHoldAccumulator += deltaSeconds;
      if (this.successHoldAccumulator >= this.scenario.target.holdSeconds) {
        this.outcome = 'success';
        this.outcomeAtSeconds = this.elapsedSeconds;
        this.message = '실험 성공 · 수조는 계속 관찰 중입니다.';
        return;
      }
    } else {
      this.successHoldAccumulator = 0;
    }
    if (
      this.scenario.timeLimitSeconds !== null &&
      this.elapsedSeconds >= this.scenario.timeLimitSeconds
    ) {
      this.outcome = 'failure';
      this.outcomeAtSeconds = this.elapsedSeconds;
      this.message = '제한시간 실패 · 결과를 유지한 채 수조는 계속 관찰 중입니다.';
    }
  }

  private missionProgress(coverageRatio: number): MissionProgressSnapshot | null {
    const target = this.scenario.target;
    if (!target) return null;
    if (target.type === 'population-survival') {
      const current = this.animalPopulation(target.speciesId).total;
      return {
        current,
        target: target.count,
        unit: 'population-count',
        label: target.label,
        ratio: current / target.count,
        holdCurrent: this.successHoldAccumulator,
        holdTarget: target.holdSeconds,
      };
    }
    if (target.type === 'adult-population') {
      const current = this.animalPopulation(target.speciesId).adults;
      return {
        current,
        target: target.count,
        unit: 'adult-count',
        label: target.label,
        ratio: current / target.count,
        holdCurrent: this.successHoldAccumulator,
        holdTarget: target.holdSeconds,
      };
    }
    if (target.type === 'habitat-coverage') {
      const eligible = this.surfaceSnapshots().filter((cell) => cell.targetEligible);
      const current = eligible.length
        ? eligible.filter((cell) =>
          cell.light >= target.minLight &&
          cell.light <= target.maxLight &&
          cell.biomass[target.speciesId] >= target.minBiomass,
        ).length / eligible.length
        : 0;
      return {
        current,
        target: target.ratio,
        unit: 'habitat-coverage',
        label: target.label,
        ratio: current / target.ratio,
        holdCurrent: this.successHoldAccumulator,
        holdTarget: target.holdSeconds,
      };
    }
    if (target.type === 'biomass') {
      const current = this.surfaceSnapshots().reduce(
        (total, cell) => total + cell.biomass[target.speciesId],
        0,
      );
      return {
        current,
        target: target.amount,
        unit: 'biomass',
        label: target.label,
        ratio: current / target.amount,
        holdCurrent: this.successHoldAccumulator,
        holdTarget: target.holdSeconds,
      };
    }
    return {
      current: coverageRatio,
      target: target.ratio,
      unit: 'coverage',
      label: target.label,
      ratio: coverageRatio / target.ratio,
      holdCurrent: this.successHoldAccumulator,
      holdTarget: target.holdSeconds,
    };
  }

  private currentTargetMet(): boolean {
    const cells = this.surfaceSnapshots().filter((cell) => cell.targetEligible);
    const coverageRatio = cells.length
      ? cells.filter((cell) => occupied(cell.biomass)).length / cells.length
      : 0;
    const progress = this.missionProgress(coverageRatio);
    return progress ? progress.current >= progress.target : false;
  }

  private structureSnapshots(reuse?: StructureSnapshot[]): StructureSnapshot[] {
    const snapshots = reuse ?? [];
    for (let index = 0; index < this.structures.length; index += 1) {
      const structure = this.structures[index];
      const definition = STRUCTURES[structure.definitionId];
      const isHeld = this.isHeldStructure(structure.id);
      const snapshot = snapshots[index] ?? {} as StructureSnapshot;
      snapshot.id = structure.id;
      snapshot.definitionId = structure.definitionId;
      snapshot.label = definition.label;
      snapshot.assetPath = definition.assetPath;
      snapshot.x = structure.body.position.x;
      snapshot.y = structure.body.position.y;
      snapshot.angle = structure.body.angle;
      snapshot.width = definition.width;
      snapshot.height = definition.height;
      snapshot.locked = structure.locked;
      snapshot.isSleeping = structure.body.isSleeping;
      snapshot.isHeld = isHeld;
      snapshot.placementValid = isHeld && this.held?.kind === 'structure'
        ? this.held.valid
        : true;
      snapshots[index] = snapshot;
    }
    snapshots.length = this.structures.length;
    return snapshots;
  }

  private animalSnapshots(reuse?: AnimalSnapshot[]): AnimalSnapshot[] {
    if (this.selection?.kind === 'animal' && this.selection.animalId) {
      const selected = this.animals.find((animal) => animal.id === this.selection?.animalId);
      if (selected) {
        this.selection.x = selected.position.x;
        this.selection.y = selected.position.y;
      }
    }
    const snapshots = reuse ?? [];
    for (let index = 0; index < this.animals.length; index += 1) {
      const animal = this.animals[index];
      const snapshot = snapshots[index] ?? {} as AnimalSnapshot;
      snapshot.id = animal.id;
      snapshot.speciesId = animal.speciesId;
      snapshot.x = animal.position.x;
      snapshot.y = animal.position.y;
      snapshot.vx = animal.velocity.x;
      snapshot.vy = animal.velocity.y;
      snapshot.facing = animal.facing;
      snapshot.poseAngle = animal.poseAngle;
      snapshot.bodyLength = animal.bodyLength;
      snapshot.lifeStage = animal.lifeStage;
      snapshot.sex = animal.sex;
      snapshot.ageSeconds = animal.ageSeconds;
      snapshot.lifespanSeconds = animal.lifespanSeconds;
      snapshot.energy = animal.energy;
      snapshot.health = animal.health;
      snapshot.behavior = this.held?.kind === 'animal' && this.held.animalId === animal.id
        ? 'held'
        : animal.behavior;
      snapshot.reproductiveState = animal.gestationRemaining !== null
        ? 'berried'
        : animal.lifeStage === 'adult' &&
          animal.reproductionCooldown <= 0 &&
          animal.energy >= SHRIMP_REPRODUCTION_ENERGY &&
          animal.reproductiveBiomass >= SHRIMP_MINIMUM_BROOD_BIOMASS &&
          this.animals.length < SHRIMP_TECHNICAL_POPULATION_LIMIT
          ? 'ready'
          : 'none';
      snapshot.recentIntake = animal.recentIntake;
      snapshot.consumedBiomass = animal.consumedBiomass;
      snapshot.temperature = this.biogeochemistry.temperatureAt(animal.position);
      const temperatureProfile = ANIMALS[animal.speciesId].temperature;
      snapshot.metabolicTemperatureFactor = thetaTemperatureFactor(
        snapshot.temperature,
        temperatureProfile.referenceTemperature,
        temperatureProfile.metabolicTheta,
        temperatureProfile.minimumMetabolicFactor,
        temperatureProfile.maximumMetabolicFactor,
      );
      snapshot.reproductionTemperatureFactor = interpolateTemperatureResponse(
        temperatureProfile.reproductionCurve,
        snapshot.temperature,
      );
      snapshot.thermalHealthSuitability = interpolateTemperatureResponse(
        temperatureProfile.healthCurve,
        snapshot.temperature,
      );
      snapshots[index] = snapshot;
    }
    snapshots.length = this.animals.length;
    return snapshots;
  }

  private carcassSnapshots(): AnimalCarcassSnapshot[] {
    return this.carcasses.map((carcass) => ({
      id: carcass.id,
      sourceAnimalId: carcass.sourceAnimalId,
      speciesId: carcass.speciesId,
      x: carcass.position.x,
      y: carcass.position.y,
      facing: carcass.facing,
      poseAngle: carcass.poseAngle,
      bodyLength: carcass.bodyLength,
      lifeStage: carcass.lifeStage,
      cause: carcass.cause,
      waterAtDeath: carcass.waterAtDeath ? { ...carcass.waterAtDeath } : null,
      temperatureAtDeath: carcass.temperatureAtDeath,
      ageSeconds: carcass.ageSeconds,
      lifetimeSeconds: SHRIMP_CARCASS_LIFETIME_SECONDS,
      progress: clamp01(carcass.ageSeconds / SHRIMP_CARCASS_LIFETIME_SECONDS),
    }));
  }

  private animalPopulation(speciesId: AnimalSpeciesId): {
    total: number;
    adults: number;
    juveniles: number;
    adultFemales: number;
    adultMales: number;
    juvenileFemales: number;
    juvenileMales: number;
  } {
    const animals = this.animals.filter((animal) => animal.speciesId === speciesId);
    const adultFemales = animals.filter((animal) =>
      animal.lifeStage === 'adult' && animal.sex === 'female').length;
    const adultMales = animals.filter((animal) =>
      animal.lifeStage === 'adult' && animal.sex === 'male').length;
    const juvenileFemales = animals.filter((animal) =>
      animal.lifeStage === 'juvenile' && animal.sex === 'female').length;
    const juvenileMales = animals.filter((animal) =>
      animal.lifeStage === 'juvenile' && animal.sex === 'male').length;
    const adults = adultFemales + adultMales;
    return {
      total: animals.length,
      adults,
      juveniles: animals.length - adults,
      adultFemales,
      adultMales,
      juvenileFemales,
      juvenileMales,
    };
  }

  private recordAnimalPopulationEvent(
    kind: AnimalPopulationEventKind,
    animal: AnimalState,
    options?: {
      cause?: AnimalDeathCause;
      parentId?: string;
      water?: AnimalPopulationEventSnapshot['water'];
    },
  ): void {
    const cause = options?.cause ?? null;
    const water = options?.water !== undefined
      ? options.water
      : this.biogeochemistry.effectsEnabled
        ? this.biogeochemistry.sampleAt(animal.position)
        : null;
    this.animalPopulationEvents.push({
      sequence: ++this.animalPopulationEventSequence,
      kind,
      elapsedSeconds: this.elapsedSeconds,
      animalId: animal.id,
      speciesId: animal.speciesId,
      lifeStage: animal.lifeStage,
      sex: animal.sex,
      x: animal.position.x,
      y: animal.position.y,
      ageSeconds: animal.ageSeconds,
      energy: animal.energy,
      cause,
      parentId: options?.parentId ?? null,
      water: water ? { ...water } : null,
      temperature: this.biogeochemistry.temperatureAt(animal.position),
    });
    if (this.animalPopulationEvents.length > MAX_ANIMAL_POPULATION_EVENTS) {
      this.animalPopulationEvents.splice(
        0,
        this.animalPopulationEvents.length - MAX_ANIMAL_POPULATION_EVENTS,
      );
    }

    if (kind === 'introduced') this.animalPopulationEventTotals.introduced += 1;
    if (kind === 'removed') this.animalPopulationEventTotals.removed += 1;
    if (kind === 'birth') this.animalPopulationEventTotals.births += 1;
    if (kind === 'matured') this.animalPopulationEventTotals.maturations += 1;
    if (kind === 'death' && cause) {
      this.animalPopulationEventTotals.deaths += 1;
      this.animalPopulationEventTotals.deathsByCause[cause] += 1;
    }
    this.snapshotDirty = true;
  }

  private surfaceSnapshots(): SurfaceCellSnapshot[] {
    return this.allCells().map((cell) => {
      const point = this.cellWorldPoint(cell);
      return {
        id: cell.id,
        ownerId: cell.ownerId,
        ownerLabel: cell.ownerLabel,
        surfaceKind: cell.surfaceKind,
        index: cell.index,
        x: point.x,
        y: point.y,
        cellSize: cell.cellSize,
        light: cell.light,
        plantCanopyLight: cell.biomass.vallisneria > ALGAE_VISIBLE_BIOMASS
          ? this.sampleLightField(this.producerActivityPoint(cell, 'vallisneria'))
          : null,
        biomass: cloneBiomass(cell.biomass),
        biofilm: { ...cell.biofilm },
        targetEligible:
          cell.surfaceKind === 'structure-face' || this.scenario.targetIncludesSubstrate,
      };
    });
  }

  private seedSnapshots(): SeedSnapshot[] {
    if (this.hasStarted) return [];
    return this.seedPlacements.flatMap((placement) => {
      const cell = this.cellById(placement.cellId);
      if (!cell) return [];
      const point = placement.speciesId === 'vallisneria' && placement.plant
        ? this.vallisneriaRootPosition(placement, cell)
        : this.cellWorldPoint(cell);
      return [{
        id: placement.id,
        speciesId: placement.speciesId,
        cellId: placement.cellId,
        locked: placement.locked,
        x: point.x,
        y: point.y,
      }];
    });
  }

  private plantSnapshots(): PlantRametSnapshot[] {
    return this.seedPlacements.flatMap((placement) => {
      if (placement.speciesId !== 'vallisneria' || !placement.plant) return [];
      const cell = this.cellById(placement.cellId);
      if (!cell || cell.biomass.vallisneria <= 0.004) return [];
      const point = this.vallisneriaRootPosition(placement, cell);
      return [{
        id: placement.id,
        speciesId: 'vallisneria' as const,
        cellId: placement.cellId,
        x: point.x,
        y: point.y,
        origin: placement.origin,
        parentId: placement.plant.parentId,
        connectedToParent: placement.plant.connectedToParent,
        ageSeconds: placement.plant.ageSeconds,
        lifespanSeconds: placement.plant.lifespanSeconds,
        lifeStage: this.vallisneriaLifeStage(placement.plant),
        structuralScale: placement.plant.structuralScale,
        health: this.vallisneriaHealth(placement, cell),
        runnerProgress: clamp01(placement.plant.runnerProgress),
        reproductionCount: placement.plant.reproductionCount,
      }];
    });
  }

  private holdingSnapshot(): HoldingSnapshot | null {
    if (!this.held) return null;
    if (this.held.kind === 'structure') {
      const structure = this.structureById(this.held.structureId);
      if (!structure) return null;
      return {
        kind: 'structure',
        source: this.held.source,
        valid: this.held.valid,
        x: structure.body.position.x,
        y: structure.body.position.y,
        structureId: structure.id,
        structureDefinitionId: structure.definitionId,
      };
    }
    if (this.held.kind === 'animal') {
      return {
        kind: 'animal',
        source: this.held.source,
        valid: this.held.valid,
        x: this.held.position.x,
        y: this.held.position.y,
        animalId: this.held.animalId,
        animalSpeciesId: this.held.speciesId,
      };
    }
    if (this.held.kind === 'biofilm') {
      const candidate = this.held.candidateCellId
        ? this.cellById(this.held.candidateCellId)
        : undefined;
      const point = candidate ? this.cellWorldPoint(candidate) : this.pointer;
      return {
        kind: 'biofilm',
        source: 'inventory',
        valid: this.held.valid,
        x: point.x,
        y: point.y,
        microbeGuildId: this.held.guildId,
      };
    }
    const candidate = this.held.candidateCellId ? this.cellById(this.held.candidateCellId) : undefined;
    const point = this.held.speciesId === 'vallisneria' && this.held.candidateRootPosition
      ? this.held.candidateRootPosition
      : candidate
        ? this.cellWorldPoint(candidate)
        : this.pointer;
    return {
      kind: 'seed',
      source: this.held.source,
      valid: this.held.valid,
      x: point.x,
      y: point.y,
      speciesId: this.held.speciesId,
    };
  }

  private createAdultAnimalState(
    id: string,
    speciesId: AnimalSpeciesId,
    point: Vec2,
    origin: 'supplied' | 'born',
  ): AnimalState {
    const numericId = Number.parseInt(id.split('-').at(-1) ?? '1', 10) || 1;
    return {
      id,
      speciesId,
      origin,
      position: this.clampAnimalPoint(point),
      velocity: { x: 0, y: 0 },
      facing: numericId % 2 === 0 ? -1 : 1,
      poseAngle: 0,
      bodyLength: SHRIMP_ADULT_LENGTH * (0.94 + deterministicNoise(numericId * 5.1) * 0.12),
      lifeStage: 'adult',
      sex: numericId % 2 === 1 ? 'female' : 'male',
      ageSeconds: SHRIMP_SUPPLIED_ADULT_MIN_AGE_SECONDS +
        (numericId * 7) %
        (SHRIMP_SUPPLIED_ADULT_MAX_AGE_SECONDS - SHRIMP_SUPPLIED_ADULT_MIN_AGE_SECONDS),
      lifespanSeconds: SHRIMP_MIN_LIFESPAN_SECONDS +
        deterministicNoise(numericId * 29.73) *
        (SHRIMP_MAX_LIFESPAN_SECONDS - SHRIMP_MIN_LIFESPAN_SECONDS),
      energy: 0.52 + ((numericId - 1) % 4) * 0.01,
      structuralBiomass: WATER_CYCLE_RULES.shrimp.adultStructuralBiomass,
      storedBiomass: WATER_CYCLE_RULES.shrimp.suppliedReserveBiomass,
      reproductiveBiomass: 0,
      health: 1,
      behavior: 'resting',
      behaviorTimer: 1 + deterministicNoise(numericId * 2.7) * 2,
      targetCellId: null,
      nextTargetEvaluation: 0,
      recentIntake: 0,
      consumedBiomass: 0,
      grazingSessionIntake: 0,
      secondsSinceFood: Number.POSITIVE_INFINITY,
      growthProgress: 1,
      reproductionCooldown:
        SHRIMP_ECOLOGY_RULES.suppliedAdultReproductionCooldownMin +
        deterministicNoise(numericId * 11.3) * (
          SHRIMP_ECOLOGY_RULES.suppliedAdultReproductionCooldownMax -
          SHRIMP_ECOLOGY_RULES.suppliedAdultReproductionCooldownMin
        ),
      gestationRemaining: null,
      matingAccumulator: 0,
      randomSeed: numericId * 17.17,
    };
  }

  private createJuvenileAnimalState(parent: AnimalState, clutchIndex: number): AnimalState {
    const id = `animal-${++this.animalCounter}`;
    const numericId = this.animalCounter;
    const angle = deterministicNoise(parent.randomSeed + clutchIndex * 3.7) * Math.PI * 2;
    const distance = 7 + deterministicNoise(parent.randomSeed + clutchIndex * 8.9) * 12;
    return {
      id,
      speciesId: parent.speciesId,
      origin: 'born',
      position: this.clampAnimalPoint({
        x: parent.position.x + Math.cos(angle) * distance,
        y: parent.position.y + Math.sin(angle) * distance,
      }),
      velocity: { x: 0, y: 0 },
      facing: clutchIndex % 2 === 0 ? 1 : -1,
      poseAngle: 0,
      bodyLength: SHRIMP_JUVENILE_LENGTH,
      lifeStage: 'juvenile',
      sex: numericId % 2 === 1 ? 'female' : 'male',
      ageSeconds: 0,
      lifespanSeconds: SHRIMP_MIN_LIFESPAN_SECONDS +
        deterministicNoise(numericId * 29.73) *
        (SHRIMP_MAX_LIFESPAN_SECONDS - SHRIMP_MIN_LIFESPAN_SECONDS),
      energy: 0.46,
      structuralBiomass: WATER_CYCLE_RULES.shrimp.juvenileBirthBiomass,
      storedBiomass: 0,
      reproductiveBiomass: 0,
      health: 1,
      behavior: 'resting',
      behaviorTimer: deterministicNoise(numericId * 4.1),
      targetCellId: parent.targetCellId,
      nextTargetEvaluation: deterministicNoise(numericId * 2.3) * 0.5,
      recentIntake: 0,
      consumedBiomass: 0,
      grazingSessionIntake: 0,
      secondsSinceFood: 0,
      growthProgress: 0,
      reproductionCooldown: 0,
      gestationRemaining: null,
      matingAccumulator: 0,
      randomSeed: numericId * 17.17,
    };
  }

  private nearestAnimal(point: Vec2): { animal: AnimalState; distance: number } | null {
    let nearest: { animal: AnimalState; distance: number } | null = null;
    for (const animal of this.animals) {
      const distance = Math.sqrt(distanceSquared(point, animal.position));
      if (!nearest || distance < nearest.distance) nearest = { animal, distance };
    }
    return nearest;
  }

  private nearestCarcass(point: Vec2): { carcass: AnimalCarcassState; distance: number } | null {
    let nearest: { carcass: AnimalCarcassState; distance: number } | null = null;
    for (const carcass of this.carcasses) {
      const distance = Math.sqrt(distanceSquared(point, carcass.position));
      if (!nearest || distance < nearest.distance) nearest = { carcass, distance };
    }
    return nearest;
  }

  private animalHitRadius(animal: AnimalState): number {
    return Math.max(14, animal.bodyLength * 0.72);
  }

  private carcassHitRadius(carcass: AnimalCarcassState): number {
    return Math.max(16, carcass.bodyLength * 0.78);
  }

  private isAnimalPlacementPoint(point: Vec2): boolean {
    return point.x >= 18 && point.x <= TANK_WIDTH - 18 &&
      point.y >= WATER_TOP + 18 && point.y <= GROUND_Y - 16;
  }

  private clampAnimalPoint(point: Vec2): Vec2 {
    return {
      x: clamp(point.x, 18, TANK_WIDTH - 18),
      y: clamp(point.y, WATER_TOP + 18, GROUND_Y - 16),
    };
  }

  private allCells(): SurfaceCellState[] {
    return [...this.substrateCells, ...this.structures.flatMap((structure) => structure.cells)];
  }

  private cellById(id: string): SurfaceCellState | undefined {
    if (id.startsWith('substrate:')) return this.substrateCells.find((cell) => cell.id === id);
    const ownerId = id.split(':cell-')[0];
    return this.structureById(ownerId)?.cells.find((cell) => cell.id === id);
  }

  private cellWorldPoint(cell: SurfaceCellState): Vec2 {
    if (cell.surfaceKind === 'substrate') return { x: cell.x, y: cell.y };
    const structure = this.structureById(cell.ownerId);
    if (!structure) return { x: cell.x, y: cell.y };
    return structureAuthoredPointToWorld(
      { x: cell.x, y: cell.y },
      STRUCTURES[structure.definitionId].collisionPolygon,
      structure.body.position,
      structure.body.angle,
    );
  }

  private nearestCell(
    point: Vec2,
    predicate?: (cell: SurfaceCellState) => boolean,
  ): { cell: SurfaceCellState; distance: number } | null {
    let nearest: { cell: SurfaceCellState; distance: number } | null = null;
    for (const cell of this.allCells()) {
      if (predicate && !predicate(cell)) continue;
      const distance = Math.sqrt(distanceSquared(point, this.cellWorldPoint(cell)));
      if (!nearest || distance < nearest.distance) nearest = { cell, distance };
    }
    return nearest;
  }

  private nearestSeed(point: Vec2): { placement: SeedPlacementState; distance: number } | null {
    let nearest: { placement: SeedPlacementState; distance: number } | null = null;
    for (const placement of this.seedPlacements) {
      if (placement.locked) continue;
      const cell = this.cellById(placement.cellId);
      if (!cell) continue;
      const anchor = placement.speciesId === 'vallisneria' && placement.plant
        ? this.vallisneriaRootPosition(placement, cell)
        : this.cellWorldPoint(cell);
      const distance = placement.speciesId === 'vallisneria' && placement.plant
        ? vallisneriaHitDistance(
          point,
          cell.index,
          anchor,
          placement.plant.structuralScale,
        )
        : Math.sqrt(distanceSquared(point, anchor));
      if (!nearest || distance < nearest.distance) nearest = { placement, distance };
    }
    return nearest;
  }

  private nearestVallisneria(
    point: Vec2,
  ): { placement: SeedPlacementState; distance: number } | null {
    let nearest: { placement: SeedPlacementState; distance: number } | null = null;
    for (const placement of this.seedPlacements) {
      if (placement.speciesId !== 'vallisneria' || !placement.plant) continue;
      const cell = this.cellById(placement.cellId);
      if (!cell || cell.biomass.vallisneria <= 0.004) continue;
      const anchor = this.vallisneriaRootPosition(placement, cell);
      const leafDistance = vallisneriaHitDistance(
        point,
        cell.index,
        anchor,
        placement.plant.structuralScale,
      );
      const canopy = vallisneriaCanopyBounds(
        cell.index,
        anchor,
        placement.plant.structuralScale,
      );
      const boundsDx = Math.max(canopy.minX - point.x, 0, point.x - canopy.maxX);
      const boundsDy = Math.max(canopy.minY - point.y, 0, point.y - canopy.maxY);
      // The whole rosette silhouette is one inspectable organism. The leaf
      // centreline remains the precise path, while the canopy envelope fills
      // narrow gaps between overlapping ribbons for comfortable selection.
      const distance = Math.min(leafDistance, Math.hypot(boundsDx, boundsDy));
      if (!nearest || distance < nearest.distance) nearest = { placement, distance };
    }
    return nearest;
  }

  private structureById(id: string): StructureState | undefined {
    return this.structures.find((structure) => structure.id === id);
  }

  private isHeldStructure(id: string): boolean {
    return this.held?.kind === 'structure' && this.held.structureId === id;
  }

  private clampPointer(point: Vec2): Vec2 {
    return {
      x: clamp(point.x, 0, TANK_WIDTH),
      y: clamp(point.y, WATER_TOP, GROUND_Y),
    };
  }
}
