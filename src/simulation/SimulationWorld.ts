import Matter, { type Body as MatterBody } from 'matter-js';
import {
  ALGAE_RENDER_TRACE_BIOMASS,
  ALGAE_VISIBLE_BIOMASS,
  ANIMALS,
  continuousBodyMassFeedingScale,
  continuousBodyMassMaintenance,
  daphniaReproductionFoodFactor,
  daphniaSuspendedFoodResponse,
  initialWaterTemperatureForLight,
  MICROBE_ECOLOGY_RULES,
  MICROBES,
  PLANKTON_ECOLOGY_RULES,
  RICEFISH_ECOLOGY_RULES,
  SCENARIOS,
  SHRIMP_ECOLOGY_RULES,
  SPECIES,
  STRUCTURES,
  SURFACE_ALGAE_INOCULUM_BIOMASS,
  WATER_CYCLE_RULES,
  type ScenarioDefinition,
} from './config';
import {
  BiogeochemistryLedger,
  emptyBiofilm,
  type BiofilmReactionSite,
  type PredatorDangerCueSite,
  type PlanktonSample,
  type ShrimpFoodCueSite,
  type ShrimpMateCueSite,
} from './biogeochemistry';
import {
  animalCarcassVisualPoint,
  animalVisualHitRadii,
  presentedAnimalCarcasses,
} from './animalPresentation';
import { oxygenEquivalentInventory } from './stoichiometry';
import { FIXED_LAMP_WIDTH, FIXED_LAMP_X, FIXED_LAMP_Y } from './lightGeometry';
import {
  daylightAngleRadians,
  dayNightStateAt,
  type DayNightPhase,
  type DayNightState,
} from './dayNight';
import {
  ALGAE_PHYSIOLOGY_GROSS,
  ALGAE_PHYSIOLOGY_NET,
  ALGAE_PHYSIOLOGY_RESPIRATION,
  ALGAE_PHYSIOLOGY_STRESS,
  ALGAE_PHYSIOLOGY_VALUE_COUNT,
  algaePhysiology,
  clamp01,
  emptyBiomass,
  growthTrend,
  habitatSuitability,
  netGrowthPotential,
  occupied,
  producerProcessRateScale,
  type AlgaePhysiologyRates,
  writeAlgaePhysiologyRates,
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
  vallisneriaRenderDepth,
  writeVallisneriaCanopyBounds,
  writeVallisneriaLeaves,
  type VallisneriaCanopyBounds as VallisneriaCanopyBoundsState,
  type VallisneriaLeafGeometry,
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
  TANK_DEFINITIONS,
  tankDefinition,
  type AnimalBehavior,
  type AnimalDeathCause,
  type AnimalLifeStage,
  type AnimalPopulationEventKind,
  type AnimalPopulationEventSnapshot,
  type AnimalPopulationEventTotals,
  type AnimalPopulationSnapshot,
  type AnimalSnapshot,
  type AnimalSex,
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
  type PlanktonKind,
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
  type TankDefinition,
  type TankTypeId,
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
  /** Reused runtime coordinates; never serialized into saves or snapshots. */
  worldPoint: Vec2;
  shrimpContactPoint: Vec2;
  worldTransformX: number;
  worldTransformY: number;
  worldTransformAngle: number;
  shrimpContactSourceX: number;
  shrimpContactSourceY: number;
}

interface MissionCellView {
  surfaceKind: SurfaceKind;
  light: number;
  biomass: SpeciesBiomass;
  targetEligible?: boolean;
}

interface GrowthRecruitmentTransfer {
  sourceIndex: number;
  receiverIndex: number;
  speciesId: SpeciesId;
  amount: number;
}

interface WaterEscapeVector extends Vec2 {
  stress: number;
  /** Sustained diel migration uses ordinary swimming, not a startle stroke. */
  response?: 'escape' | 'migration';
}

interface RefugeGap {
  id: string;
  point: Vec2;
  clearance: number;
  first: Vec2;
  second: Vec2;
  structureIds: [string, string];
}

interface MotionSnapshotState {
  structures: StructureSnapshot[];
  animals: AnimalSnapshot[];
  holding: HoldingSnapshot | null;
  probe: ProbeSnapshot | null;
}

const GROWTH_SPECIES_INDEX: Record<SpeciesId, number> = {
  oedogonium: 0,
  nitzschia: 1,
  vallisneria: 2,
};

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
  directDaylightCoefficient: number;
}

interface LightReflectionPath {
  source: LightReflectionSource;
  transportFactor: number;
}

interface LightTransportPath {
  ambientBase: number;
  ambientLampCoefficient: number;
  lampCoefficient: number;
  skyAmbientCoefficient: number;
  reflections: LightReflectionPath[];
}

interface VallisneriaCanopyOptics {
  plantId: string;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  structuralScale: number;
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
  /** Greatest post-hatch body structure reached; used for wasting condition. */
  peakStructuralBiomass?: number;
  storedBiomass: number;
  /** Subset of storedBiomass still supplied by the egg yolk. */
  yolkBiomass?: number;
  reproductiveBiomass: number;
  health: number;
  behavior: AnimalBehavior;
  behaviorTimer: number;
  targetCellId: string | null;
  targetAnimalId: string | null;
  /**
   * Reciprocal ricefish courtship lock. Unlike prey targets, this is retained
   * while a male follows one receptive female and while that female accepts
   * one nearby suitor.
   */
  courtshipPartnerId?: string | null;
  /**
   * Number of missed-strike retentions already spent on the current prey.
   * At most one recovery/retry is allowed before the fish must search again.
   */
  strikeRecoveryUses?: number;
  /**
   * Consecutive energetic pursuit effort. It rises only while a visible prey
   * remains tracked and decays during cruise/recovery.
   */
  pursuitEffort?: number;
  /** Centre of the last prey-poor visual patch, until the fish leaves it. */
  foragingPatchOrigin?: Vec2 | null;
  /**
   * Last point actually inspected while crossing that patch. Search may
   * resume only after real travel, so a stationary fish cannot reroll sight.
   */
  foragingLastInspectionPosition?: Vec2 | null;
  attachmentCellId: string | null;
  incubationRemaining: number | null;
  recentFood: string | null;
  nextTargetEvaluation: number;
  recentIntake: number;
  consumedBiomass: number;
  grazingSessionIntake: number;
  grazingSessionSeconds?: number;
  recentGrazingCellId?: string | null;
  recentGrazingCellCooldown?: number;
  secondsSinceFood: number;
  growthProgress: number;
  reproductionCooldown: number;
  gestationRemaining: number | null;
  maturationTargetSeconds?: number;
  maturationTargetInstars?: number;
  ovarianProgress?: number;
  /** Shrimp clutch size fixed at the beginning of this female's ovarian cycle. */
  ovarianClutchSize?: number;
  reproductiveCycleIndex?: number;
  moltProgress?: number;
  moltCycleSeconds?: number;
  moltCount?: number;
  /** Daphnia clutch size fixed when embryo development begins. */
  gestatingBroodSize?: number | null;
  matingAccumulator: number;
  randomSeed: number;
  /** Daphnia generations are tracked per individual; other animals default to 0. */
  generation?: number;
  parentId?: string | null;
}

export type RicefishTrackLossReason =
  | 'distance'
  | 'line-of-sight'
  | 'refuge'
  | 'darkness';

/**
 * Optional development-only counters for locating a broken ricefish feeding
 * stage. They are never enabled by the renderer, saved, or placed in ordinary
 * snapshots, so a long player session cannot accumulate this diagnostic data.
 */
export interface RicefishForagingDiagnosticSnapshot {
  animalId: string;
  searchCalls: number;
  daphniaInRadius: number;
  daphniaRejectedInedible: number;
  daphniaRejectedLineOfSight: number;
  daphniaRejectedRefuge: number;
  daphniaRejectedDarkness: number;
  daphniaAfterAccessChecks: number;
  daphniaVisualEvaluations: number;
  daphniaDetectionRejections: number;
  daphniaTargetsAcquired: number;
  targetLossDistance: number;
  targetLossLineOfSight: number;
  targetLossRefuge: number;
  targetLossDarkness: number;
  pursuitExhaustions: number;
  mouthContacts: number;
  refugeBlockedMouthContacts: number;
  strikeAttempts: number;
  strikeCaptureProbabilitySum: number;
  captures: number;
  capturedBiomass: number;
  assimilatedBiomass: number;
  retainedBiomass: number;
  assimilationOverflowBiomass: number;
  respirationBiomass: number;
  reserveRespirationBiomass: number;
  structuralRespirationBiomass: number;
  starvationHealthDamage: number;
  somaticGrowthBiomass: number;
  reproductiveAllocationBiomass: number;
}

const emptyRicefishForagingDiagnostic = (
  animalId: string,
): RicefishForagingDiagnosticSnapshot => ({
  animalId,
  searchCalls: 0,
  daphniaInRadius: 0,
  daphniaRejectedInedible: 0,
  daphniaRejectedLineOfSight: 0,
  daphniaRejectedRefuge: 0,
  daphniaRejectedDarkness: 0,
  daphniaAfterAccessChecks: 0,
  daphniaVisualEvaluations: 0,
  daphniaDetectionRejections: 0,
  daphniaTargetsAcquired: 0,
  targetLossDistance: 0,
  targetLossLineOfSight: 0,
  targetLossRefuge: 0,
  targetLossDarkness: 0,
  pursuitExhaustions: 0,
  mouthContacts: 0,
  refugeBlockedMouthContacts: 0,
  strikeAttempts: 0,
  strikeCaptureProbabilitySum: 0,
  captures: 0,
  capturedBiomass: 0,
  assimilatedBiomass: 0,
  retainedBiomass: 0,
  assimilationOverflowBiomass: 0,
  respirationBiomass: 0,
  reserveRespirationBiomass: 0,
  structuralRespirationBiomass: 0,
  starvationHealthDamage: 0,
  somaticGrowthBiomass: 0,
  reproductiveAllocationBiomass: 0,
});

type ShrimpEnvironmentalDeathCause =
  | 'hypoxia'
  | 'toxicity'
  | 'temperature'
  | 'starvation';

interface GrazingRequest {
  animal: AnimalState;
  cell: SurfaceCellState;
  nitzschia: number;
  oedogonium: number;
  decomposer: number;
  nitrifier: number;
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
  sex?: AnimalSex;
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

interface HeldPlanktonState {
  kind: 'plankton';
  source: 'inventory';
  planktonKind: PlanktonKind;
  position: Vec2;
  valid: boolean;
}

type HeldState =
  | HeldStructureState
  | HeldSeedState
  | HeldAnimalState
  | HeldBiofilmState
  | HeldPlanktonState;

const AREA_LIGHT_SAMPLES = 5;
const AMBIENT_SKY_SAMPLES = 7;
const DIRECT_LIGHT_HALF_ANGLE = Math.PI * 0.49;
const DAYLIGHT_ANGLE_RECOMPUTE_STEP = 2 * Math.PI / 180;
const quantizedDaylightAngleRadians = (angle: number): number =>
  Math.round(angle / DAYLIGHT_ANGLE_RECOMPUTE_STEP) *
    DAYLIGHT_ANGLE_RECOMPUTE_STEP;
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
  geometry: 'area-source' | 'parallel-rays';
  samples: Vec2[];
  emissionScale: number;
  occludedTransmission: number;
  angleRadians?: number;
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
// Surface-film spread transfers conserved producer matter; it does not create
// biomass. Producer growth was rescaled to the shared ledger, but applying the
// same factor to lateral colonization made every new ring wait minutes before
// exporting propagules. Keep growth/respiration at their ledger rates while
// restoring the visibly quick, thin surface advance of the earlier model.
const SURFACE_FILM_TARGET_FRONT_DISPERSAL_RATE = 0.38;
export const SURFACE_FILM_DISPERSAL_TIME_SCALE =
  SURFACE_FILM_TARGET_FRONT_DISPERSAL_RATE / SPECIES.oedogonium.dispersalRate;
const SURFACE_FILM_FRONT_DISPERSAL_RATE_CAP = 0.42;
// A newly arrived real propagule can continue the thin colonisation front.
// Waiting for a food-density patch here turned a continuous surface spread
// into a sequence of stationary clumps.
const SURFACE_FILM_DISPERSAL_SOURCE_BIOMASS =
  ALGAE_VISIBLE_BIOMASS * 0.25;
// Fast colonisation moves only a thread-thin conserved propagule packet. It
// may be visually amplified, but remains real biomass and is fully grazeable.
// Bulk food stays in locally growing patches instead of being homogenised.
const SURFACE_FILM_FRONT_TRANSFER_PER_EDGE_PER_SECOND =
  ALGAE_VISIBLE_BIOMASS * 0.08;
// Crossing the render threshold is only the first propagule, not an
// established neighboring patch. Keep the front transfer active until the
// receiving cell contains a small but grazeable film. Transfer remains
// mass-conserving; this threshold never protects a source-cell remnant.
const SURFACE_FILM_FRONT_ESTABLISHMENT_BIOMASS = 0.04;
// The shared ledger's biomass unit has the C:N of active microbial/animal
// matter. A macrophyte rosette contains much more low-nitrogen structural
// tissue, so represent the same visible Vallisneria at a smaller ledger mass
// instead of charging one full algal cell of nitrogen for its long leaves.
// All Vallisneria reserve, runner and display thresholds use this same scale.
const VALLISNERIA_LEDGER_BIOMASS_SCALE = 0.55;
// Rooted-plant stock is a separate object budget. Do not silently change its
// supplied matter whenever the surface-film inoculum is recalibrated.
const VALLISNERIA_SEED_BIOMASS =
  0.4 * VALLISNERIA_LEDGER_BIOMASS_SCALE;
const VALLISNERIA_CELL_BIOMASS_CAPACITY =
  VALLISNERIA_LEDGER_BIOMASS_SCALE;
const VALLISNERIA_VISIBLE_BIOMASS =
  0.004 * VALLISNERIA_LEDGER_BIOMASS_SCALE;
// One authored day/night cycle is 360 seconds. A runner-born ramet therefore
// needs about a day and a half to establish instead of becoming reproductive
// after a single cycle.
const VALLISNERIA_JUVENILE_SECONDS = 540;
const VALLISNERIA_MIN_LIFESPAN_SECONDS = 2_400;
const VALLISNERIA_MAX_LIFESPAN_SECONDS = 3_300;
const VALLISNERIA_SENESCENCE_START_RATIO = 0.82;
// Healthy ramets still spread visibly during a mission, but no longer create
// another daughter every ~1.7 authored days before density feedback matters.
const VALLISNERIA_RUNNER_INTERVAL_SECONDS = 900;
const VALLISNERIA_RUNNER_BIOMASS =
  0.16 * VALLISNERIA_LEDGER_BIOMASS_SCALE;
const VALLISNERIA_RUNNER_MIN_DISTANCE = 42;
const VALLISNERIA_RUNNER_MAX_DISTANCE = 170;
const VALLISNERIA_LOW_RESERVE =
  0.055 * VALLISNERIA_LEDGER_BIOMASS_SCALE;
const VALLISNERIA_LOW_RESERVE_GRACE_SECONDS = 150;
// A stolon stays connected through the daughter's juvenile establishment.
// Transfer is deliberately bounded and mass-conserving: it buffers a shaded
// daughter but cannot create biomass or drain the parent below its own reserve.
const VALLISNERIA_CLONAL_SUPPORT_PER_SECOND =
  0.00055 * VALLISNERIA_LEDGER_BIOMASS_SCALE;
const VALLISNERIA_CLONAL_SUPPORT_TARGET =
  0.22 * VALLISNERIA_LEDGER_BIOMASS_SCALE;
// The ledger does not yet expose a separate sediment nutrient pool. Split
// uptake between the rooted bottom-water proxy and the leaf surfaces instead
// of pretending the root cell contains the entire sediment reserve.
const VALLISNERIA_ROOT_UPTAKE_SHARE = 0.55;
// Five-percent structural steps are visually/ecologically smooth at the
// 36×20 light-field resolution and avoid rebuilding the field for imperceptible
// sub-pixel leaf growth during fast-forward.
const VALLISNERIA_CANOPY_LIGHT_QUANTIZATION = 0.05;
const BIOFILM_INOCULUM_BIOMASS = 0.18;
const PICK_SEED_DISTANCE = 18;
const SHRIMP_ADULT_LENGTH = 36;
const SHRIMP_JUVENILE_LENGTH = 14;
// Real juvenile development is compressed into an individual 12–20-minute
// target. Conserved structural growth remains a second requirement, so this
// range distributes cohorts without turning age into free maturation.
const SHRIMP_MIN_LIFESPAN_SECONDS = SHRIMP_ECOLOGY_RULES.minimumLifespanSeconds;
const SHRIMP_MAX_LIFESPAN_SECONDS = SHRIMP_ECOLOGY_RULES.maximumLifespanSeconds;
const SHRIMP_SUPPLIED_ADULT_MIN_AGE_SECONDS =
  SHRIMP_ECOLOGY_RULES.suppliedAdultMinimumAgeSeconds;
const SHRIMP_SUPPLIED_ADULT_MAX_AGE_SECONDS =
  SHRIMP_ECOLOGY_RULES.suppliedAdultMaximumAgeSeconds;
const SHRIMP_OXYGEN_STRESS_START = SHRIMP_ECOLOGY_RULES.oxygenStressStart;
const SHRIMP_TOXIC_STRESS_START = SHRIMP_ECOLOGY_RULES.toxicWasteStressStart;
const SHRIMP_TOXIC_STRESS_FULL = SHRIMP_ECOLOGY_RULES.toxicWasteFullStress;
const SHRIMP_WATER_RECOVERY_RATE = SHRIMP_ECOLOGY_RULES.healthyWaterRecoveryPerSecond;
// The condition meter includes 28% healthy structure plus short-term reserve.
// Starting at 0.48 and stopping at 0.70 made a structurally complete adult
// keep scraping until it had stored an implausibly large fraction of its body
// mass. Preserve visible feeding and hysteresis, but stop after a plausible
// short feeding buffer.
const SHRIMP_ADULT_FORAGE_START_ENERGY = 0.38;
const SHRIMP_ADULT_FORAGE_STOP_ENERGY = 0.44;
// The energy meter describes present somatic condition. Juvenile growth demand
// is handled separately in the foraging decision below, so a healthy but
// undersized animal does not need an oversized hidden reserve just to keep
// looking for the material required for maturity.
const SHRIMP_JUVENILE_FORAGE_START_ENERGY = 0.52;
const SHRIMP_JUVENILE_FORAGE_STOP_ENERGY = 0.60;
// Grazing must remove enough visible algae for consumers to affect the tank.
// Intake itself stays on the density-dependent functional response below;
// survival is now determined by the conserved reserve/structure budget.
const SHRIMP_BITE_RATE = SHRIMP_ECOLOGY_RULES.maximumBiteBiomassPerSecond;
const SHRIMP_GRAZE_DISTANCE = 15;
// Target choice and intake both use the real remaining biomass. Density
// response below makes a trace patch unattractive without reserving an
// uneatable floor.
// Surface-cell biomass is bounded to 1. At the current 0.00155-B/s maximum
// bite, K=0.07 gives a low-density slope of about 0.022/s: thin spread remains
// edible and visibly grazed without letting a one-second fast-forward ecology
// step erase a propagule cell numerically.
const SHRIMP_OEDOGONIUM_FOOD_QUALITY = 0.72;
const SHRIMP_DECOMPOSER_FOOD_WEIGHT = 0.45;
const SHRIMP_NITRIFIER_FOOD_WEIGHT = 0.22;
const SHRIMP_LOCAL_FOOD_RADIUS = 64;
// Surface-cell feeding requests already share the exact remaining biomass.
// The former 20-point score penalty made a bookkeeping tile behave like an
// exclusive territory and split identical hatchmates into fed/starved paths.
// Retain only a mild preference for another equally profitable nearby tile;
// the request allocator below remains the actual competition mechanism.
const SHRIMP_TARGET_CELL_CONGESTION_PENALTY = 5;
// Dissolved food odour is sampled across approximately one water-grid cell.
// It guides movement without identifying a distant food cell.
const SHRIMP_FOOD_CUE_SAMPLE_RADIUS = 42;
const SHRIMP_FOOD_CUE_MINIMUM = 0.004;
const SHRIMP_FOOD_CUE_GRADIENT_MINIMUM = 0.0008;
const SHRIMP_FOOD_CUE_UPSTREAM_WEIGHT = 0.18;
// A trace film remains edible on physical contact, but is too weak to become
// a navigational target from another tile. Otherwise adjacent numerical
// remnants repeatedly override the dissolved cue from a visibly rich colony.
const SHRIMP_LOCAL_PATCH_NAVIGATION_CUE_MINIMUM = 0.05;
// Within roughly two adult body lengths, stronger food odour/contact cues can
// outweigh a modest extra walk. This is sensory salience, not foreknowledge of
// how much growth or egg production the patch could fund.
const SHRIMP_LOCAL_PATCH_CUE_DISTANCE_WEIGHT = 0.85;
// A shrimp must physically sample a patch before deciding that its realised
// intake is not paying the activity cost. Gross intake is converted through
// the ordinary assimilation fraction before comparison with grazing
// maintenance; no remote cell is evaluated against an internal matter budget.
const SHRIMP_PATCH_SAMPLE_MINIMUM_SECONDS = 3;
const SHRIMP_MINIMUM_REALISED_GRAZING_RETURN = 1;
// N. davidi males are pure-searching rather than long-range mate homing.
// A ready female therefore supplies only a short-lived local chemical hint;
// physical proximity is still required for mating.
const SHRIMP_MATE_CUE_SAMPLE_RADIUS = 42;
const SHRIMP_MATE_CUE_MINIMUM = 0.006;
const SHRIMP_MATE_CUE_GRADIENT_MINIMUM = 0.001;
const SHRIMP_MATE_CUE_UPSTREAM_WEIGHT = 0.12;

const SHRIMP_MATE_CUE_EMISSION_START_PROGRESS = 0.82;
// Cherry shrimp detect deteriorating water with short-range chemical and
// oxygen cues. The probe radius is deliberately about one-and-a-half adult
// body lengths: it lets an animal follow a local gradient away from a waste
// pocket without revealing safe water elsewhere in the tank.
const SHRIMP_LOCAL_WATER_SENSE_RADIUS = 54;
const SHRIMP_WATER_ESCAPE_SPEED = 68;
// Daphnia react to oxygen and dissolved-waste cues over only a few body
// lengths. This is local avoidance of an immediately harmful pocket, not
// knowledge of water conditions across the tank.
const DAPHNIA_LOCAL_WATER_SENSE_RADIUS = 42;
const DAPHNIA_WATER_ESCAPE_SPEED = 34;
// Daphnia use a rapid directed stroke only at immediate range or once an
// approaching fish is actually pursuing that individual. More diffuse
// predator kairomone is sampled from the shared local cue field below; neither
// path grants a tank-wide predator query.
const DAPHNIA_DIRECT_PREDATOR_SENSE_RADIUS = 150;
const DAPHNIA_IMMEDIATE_PREDATOR_RADIUS = 62;
const DAPHNIA_PREDATOR_ESCAPE_SPEED = 58;
const DAPHNIA_NEWBORN_BODY_LENGTH = 4.6;
const DAPHNIA_MAXIMUM_BODY_LENGTH = 9;
// Daphnia do not know where a distant plant bed is, but within a few dozen
// rendered body lengths they can follow the same local light/cue/structural
// gradient that produces fish-cue redistribution into macrophytes. The probe
// remains far smaller than either tank dimension.
const DAPHNIA_DANGER_CUE_SAMPLE_RADIUS = 64;
const DAPHNIA_DANGER_CUE_MINIMUM = 0.025;
// Shelter probes are one of the hottest Daphnia motion paths. Bucket the
// already-cached canopy geometry so a local probe never rebuilds leaf curves
// or scans a tank-wide runner colony.
const VALLISNERIA_SHELTER_BUCKET_SIZE = 96;
// Renderer sizes deliberately exaggerate both animals for readability, so
// they cannot be compared as literal mouth-gape geometry. A newly released
// shrimp is about 2 mm long while an adult is roughly 25 mm; the authored
// 35 mm adult medaka can take only the youngest part of that continuum.
const SHRIMP_NEWBORN_PHYSICAL_LENGTH_MM = 2.2;
const SHRIMP_ADULT_PHYSICAL_LENGTH_MM = 25;
const RICEFISH_ADULT_PHYSICAL_LENGTH_MM = 35;
const RICEFISH_MAXIMUM_PREY_PHYSICAL_LENGTH_RATIO = 0.25;
// Visual evidence is refreshed on a natural scan cadence, but only after the
// fish has physically covered the distance it would cruise in that interval.
// The timer and travel gate together prevent both one-shot sensory blindness
// and stationary repeated dice rolls.
const RICEFISH_VISUAL_INSPECTION_SECONDS = 0.7;
// A numerically non-zero light sample is not automatically usable vision.
// This rejects effectively black pixels while retaining the authored night
// illumination (4.5% of daytime light) as a dim but functional visual phase.
const RICEFISH_TRACKED_PREY_MINIMUM_LIGHT_EXPOSURE = 0.001;
// A ready female's ovulatory cue can recruit a male over a few rendered body
// lengths. The female does not home symmetrically: she accepts a displaying
// male only after he reaches her local courtship neighbourhood.
const RICEFISH_MATING_ATTRACTION_RADIUS = 420;
const RICEFISH_MAXIMUM_POSE_ANGLE = 0.42;
// The canonical renderer spans 85 local units from tail tip to snout and its
// closed mouth sits at x ~= 39 relative to the animal origin. Keep capture
// geometry tied to that authored proportion so the visible mouth, rather than
// the invisible centre point, is what reaches prey.
const RICEFISH_MOUTH_OFFSET_BODY_FRACTION = 39 / 85;
// A shrimp works one local patch for several seconds, then walks or swims to
// another nearby surface. This is a behavioural bout, not a requirement to eat
// a fixed fraction of the old pre-rescaling producer mass.
const SHRIMP_GRAZING_BOUT_MIN_SECONDS = 7;
const SHRIMP_GRAZING_BOUT_VARIANCE_SECONDS = 4;
// Food-deprived decapod shrimp spend more time feeding and show stronger
// attraction to feed. Model that motivation by extending work on a patch that
// has actually been reached, never by revealing a richer remote cell.
const SHRIMP_HUNGRY_GRAZING_BOUT_MAXIMUM_MULTIPLIER = 2.2;
// After a feeding bout, shrimp visibly leave the feeding surface before they
// are allowed to seek food again.
const SHRIMP_POST_GRAZE_ROAM_MIN_SECONDS = 2.5;
const SHRIMP_POST_GRAZE_ROAM_VARIANCE_SECONDS = 1.5;
// A hungry animal still releases the surface and moves, but resumes feeding
// sooner after a productive bout. Sampling an underpaying patch retains the
// full roaming interval so it can search elsewhere.
const SHRIMP_HUNGRY_POST_GRAZE_ROAM_MAXIMUM_REDUCTION = 0.65;
// Leaving a feeding bout must produce real movement rather than selecting the
// identical bookkeeping cell on the next evaluation. This is a short local
// revisit delay; the old cell remains a fallback when no other profitable
// surface is available.
const SHRIMP_RECENT_GRAZING_CELL_COOLDOWN_SECONDS = 10;
const SHRIMP_JUVENILE_RECENT_GRAZING_CELL_COOLDOWN_SECONDS = 15;
// In a healthy tank adults settle near 0.5 energy. Reproduction is therefore
// gated by current reserve and recent access to food rather than a hidden
// population-capacity formula.
const SHRIMP_RECENT_INTAKE_WINDOW_SECONDS = 8;

/**
 * `secondsSinceFood` is retained in saves/UI, but physiologically represents
 * accumulated maintenance deficit. Gross recent intake is converted through
 * the ordinary assimilation fraction and compared continuously with routine
 * metabolism. A partial ration slows the clock proportionally; surplus ration
 * repays it gradually instead of resetting starvation in one bite.
 */
export const shrimpMaintenanceDeficitClockDelta = (
  recentGrossIntake: number,
  maintenanceBiomassPerSecond: number,
  deltaSeconds: number,
): number => {
  if (deltaSeconds <= 0) return 0;
  if (maintenanceBiomassPerSecond <= 0) return -deltaSeconds;
  const requiredRecentGrossIntake =
    maintenanceBiomassPerSecond * SHRIMP_RECENT_INTAKE_WINDOW_SECONDS /
    WATER_CYCLE_RULES.shrimp.assimilationFraction;
  const ration = Math.max(0, recentGrossIntake) /
    Math.max(1e-12, requiredRecentGrossIntake);
  return ration < 1
    ? deltaSeconds * (1 - ration)
    : -deltaSeconds * Math.min(1, ration - 1);
};

/**
 * Recent digestible intake needed to pay one female's ordinary maintenance
 * and maximum egg-matter transfer over the same observation window.
 *
 * This is a matter budget rather than a population setting. A smaller
 * tank-born female has lower maintenance than a supplied 1-B adult, while the
 * actual clutch transfer remains explicit in the second term.
 */
export const shrimpOvarianRecentIntakeRequirement = (
  maintenanceBiomassPerSecond: number,
  ovarianAllocationBiomassPerSecond: number,
  assimilationFraction: number,
  observationWindowSeconds: number,
): number => (
  Math.max(0, maintenanceBiomassPerSecond) +
  Math.max(0, ovarianAllocationBiomassPerSecond)
) * Math.max(0, observationWindowSeconds) /
  Math.max(1e-9, assimilationFraction);
// The visible 0..1 nutritional condition is derived from conserved animal
// matter instead of being a second, independently drained hunger tank.
// Reserve and a small viable share of structure therefore pay maintenance,
// growth, and reproduction exactly once. An adult first loses its short
// 0.015-B supplied reserve and then 1% of achieved structure; even a fully fed
// 0.06-B reserve no longer masks a producer collapse for most of a lifetime.
// Hatchlings retain a slightly wider structural margin while learning to
// forage, but still die from exact matter depletion rather than a timer.
const SHRIMP_ADULT_MINIMUM_VIABLE_STRUCTURE_RATIO = 0.99;
// Juvenile N. davidi reaches the point of no return under food deprivation
// sooner than an adult. A five-percent expendable body margin made a hatchling
// outlast a stocked adult even though the hatchling has no separate reserve.
// Two percent keeps starvation a consequence of conserved tissue loss while
// restoring the observed juvenile vulnerability instead of adding a second
// hidden health drain.
const SHRIMP_JUVENILE_MINIMUM_VIABLE_STRUCTURE_RATIO = 0.98;
// The condition meter is reserve-led. Healthy structure contributes a small
// baseline, but it is not treated as ordinary stored food; structure is only
// catabolised after reserve is gone during true starvation.
// A newly supplied adult carries 0.015 reserve and begins near 0.46 condition:
// able to mate after feeding, but with a visibly short fasting buffer.
const SHRIMP_STRUCTURE_CONDITION_SHARE = 0.28;
const SHRIMP_RESERVE_CONDITION_SHARE = 1 - SHRIMP_STRUCTURE_CONDITION_SHARE;
const SHRIMP_SUPPLIED_INITIAL_ENERGY =
  SHRIMP_STRUCTURE_CONDITION_SHARE +
  SHRIMP_RESERVE_CONDITION_SHARE *
    WATER_CYCLE_RULES.shrimp.suppliedReserveBiomass /
    WATER_CYCLE_RULES.shrimp.adultReserveBiomass;
// Adult females gradually allocate feeding surplus to eggs instead of needing
// the complete clutch to appear in ordinary reserve at a single instant.
// Egg matter and somatic condition recover in parallel after feeding. Protect
// a size-scaled 1.2% structural reserve from
// egg allocation and post-maturity growth. The same floor keeps a mature male
// in mating condition after paying for real somatic growth; without it, every
// tank-born male consumed his entire courtship reserve while growing and the
// lineage stopped even as algae recovered. This is an individual body-
// condition budget, not a population-count override.
// With reserve capacity fixed at 6% of achieved structure, 1.2% retained
// reserve produces condition 0.424 (= 0.28 structure + 0.72 × 0.20 reserve).
// That is deliberately just above the 0.40 female mating gate. The former
// 0.8% floor produced condition 0.376: a female that finished paying for her
// eggs stopped reproductive foraging and simultaneously became ineligible to
// mate, even in a food-rich tank.
const SHRIMP_REPRODUCTIVE_ALLOCATION_PROTECTED_RESERVE_FRACTION = 0.012;
// Juvenile growth is paid continuously from conserved reserve after
// maintenance. Four percent of that individual's achieved structure remains
// protected between grazing bouts. This must be a body-size ratio: the former
// fixed 0.024-B floor was larger than a hatchling's whole 0.0175-B body and
// left a half-grown juvenile with tens of compressed minutes of hidden food.
const SHRIMP_JUVENILE_GROWTH_RESERVE_FRACTION = 0.04;
// Metamorphosis into the adult feeding/reproductive state requires a small
// conserved reserve as well as mature structure. Otherwise a juvenile reaches
// the mass threshold with only the growth floor, immediately loses its
// juvenile foraging capacity, and can never fund its first ovary or molt.
const SHRIMP_MATURATION_RESERVE_BIOMASS =
  WATER_CYCLE_RULES.shrimp.adultReserveBiomass *
  SHRIMP_ECOLOGY_RULES.maturationStructuralBiomass /
  WATER_CYCLE_RULES.shrimp.adultStructuralBiomass * 0.5;
// Longer approach is handled by the dissolved female cue sampled by males;
// the mating timer itself still requires near-body contact.
const SHRIMP_MATING_ENCOUNTER_RADIUS = 36;
const SHRIMP_MATING_SECONDS = 3;
const SHRIMP_MALE_POST_MATING_COOLDOWN = 45;
const SHRIMP_SEPARATION_RADIUS = 24;
const SHRIMP_SEPARATION_FORCE = 34;
const SHRIMP_MOTION_BUCKET_SIZE = SHRIMP_SEPARATION_RADIUS;
const SHRIMP_MOTION_BUCKET_NEIGHBOR_RANGE = 2;
const SHRIMP_DIRECT_PREDATOR_SENSE_RADIUS = 220;
const REFUGE_GAP_MINIMUM_CLEARANCE = 6;
const REFUGE_GAP_MAXIMUM_CLEARANCE = 48;
const REFUGE_SEARCH_RADIUS = 260;
const LOCAL_WATER_SENSE_DIRECTIONS: readonly Readonly<Vec2>[] = [
  { x: 1, y: 0 },
  { x: Math.SQRT1_2, y: Math.SQRT1_2 },
  { x: 0, y: 1 },
  { x: -Math.SQRT1_2, y: Math.SQRT1_2 },
  { x: -1, y: 0 },
  { x: -Math.SQRT1_2, y: -Math.SQRT1_2 },
  { x: 0, y: -1 },
  { x: Math.SQRT1_2, y: -Math.SQRT1_2 },
];
const LOCAL_CUE_SENSE_DIRECTIONS: readonly Readonly<Vec2>[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
  { x: Math.SQRT1_2, y: Math.SQRT1_2 },
  { x: Math.SQRT1_2, y: -Math.SQRT1_2 },
  { x: -Math.SQRT1_2, y: Math.SQRT1_2 },
  { x: -Math.SQRT1_2, y: -Math.SQRT1_2 },
];
const SHRIMP_CARCASS_LIFETIME_SECONDS = 55;
const DAPHNIA_CARCASS_LIFETIME_SECONDS = 140;
const RICEFISH_CARCASS_LIFETIME_SECONDS = 70;
const MAX_ANIMAL_POPULATION_EVENTS = 240;

const animalCarcassLifetimeSeconds = (speciesId: AnimalSpeciesId): number =>
  speciesId === 'japanese-ricefish'
    ? RICEFISH_CARCASS_LIFETIME_SECONDS
    : speciesId === 'daphnia'
      ? DAPHNIA_CARCASS_LIFETIME_SECONDS
      : SHRIMP_CARCASS_LIFETIME_SECONDS;

const maximumCarcassBodyLength = (speciesId: AnimalSpeciesId): number =>
  speciesId === 'daphnia'
    ? 10
    : speciesId === 'japanese-ricefish'
      ? RICEFISH_ECOLOGY_RULES.adultLength * 1.2
      : SHRIMP_ADULT_LENGTH * 1.2;

const fallbackCarcassBodyLength = (
  speciesId: AnimalSpeciesId,
  lifeStage: AnimalLifeStage,
): number => speciesId === 'daphnia'
  ? lifeStage === 'adult' ? 8.2 : 4.6
  : speciesId === 'japanese-ricefish'
    ? lifeStage === 'adult'
      ? RICEFISH_ECOLOGY_RULES.adultLength
      : lifeStage === 'juvenile'
        ? RICEFISH_ECOLOGY_RULES.juvenileLength
        : lifeStage === 'fry'
          ? RICEFISH_ECOLOGY_RULES.fryLength
          : 6
    : lifeStage === 'adult' ? SHRIMP_ADULT_LENGTH : SHRIMP_JUVENILE_LENGTH;
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

const stableHorizontalFacing = (
  currentFacing: -1 | 1,
  horizontalVelocity: number,
  reversalSpeed = 7.5,
): -1 | 1 => horizontalVelocity > reversalSpeed
  ? 1
  : horizontalVelocity < -reversalSpeed
    ? -1
    : currentFacing;

/**
 * A tracked prey crossing the fish centre by a few pixels does not teleport
 * the mouth to the opposite side of the body. Keep the current head direction
 * until the prey is clearly behind enough of the body for a real turn.
 */
const ricefishPursuitFacing = (
  currentFacing: -1 | 1,
  preyHorizontalOffset: number,
  bodyLength: number,
): -1 | 1 => {
  const reversalDistance = Math.max(8, bodyLength * 0.36);
  if (preyHorizontalOffset * currentFacing >= -reversalDistance) {
    return currentFacing;
  }
  return currentFacing === 1 ? -1 : 1;
};

const shrimpArrivalScale = (
  distance: number,
  slowingRadius: number,
): number => clamp(distance / Math.max(1, slowingRadius), 0, 1);

/**
 * Local daytime exposure perceived by a Daphnia.
 *
 * Fish kairomone is only risk information. Vallisneria does not make that cue
 * disappear or grant immunity; its canopy lowers the visual-predation part of
 * the same risk already used by ricefish detection and capture. The daytime
 * risk gradient drives descent; dusk/night reversal is handled by the diel
 * migration branch. A nearby fish can still trigger the separate direct
 * escape path at any time.
 */
export const daphniaDaytimeVisualPredationRisk = (
  dangerCue: number,
  canopyShelter: number,
  isNight: boolean,
  waterColumnLightExposure = 1,
): number => isNight
  ? 0
  : clamp(dangerCue, 0, 1) *
    clamp(waterColumnLightExposure, 0, 1) *
    Math.pow(1 - clamp(canopyShelter, 0, 0.96), 1.8);

/**
 * Local refuge residency under daytime fish risk.
 *
 * This is deliberately not a plant-seeking vector. A Daphnia that already
 * occupies locally complex cover wanders out of it less readily while fish
 * cue is present, but a Daphnia in open water receives no knowledge of a
 * distant Vallisneria bed. Direct escape and the local vertical risk gradient
 * still take priority over this reduction in ordinary roaming.
 */
export const daphniaLocalRefugeResidency = (
  dangerCue: number,
  canopyShelter: number,
  isNight: boolean,
): number => isNight
  ? 0
  : clamp(dangerCue / 0.12, 0, 1) *
    clamp(canopyShelter / 0.86, 0, 1);

/**
 * Convert the shared, cached light field to a visual-exposure fraction.
 * Daphnia migration, ricefish detection and the final strike therefore all
 * see the same dawn/dusk, rock shadow and Vallisneria transmission result.
 */
export const visualLightExposure = (
  light: number,
): number => clamp(light / 100, 0, 1);

/**
 * Plant cover is a relative refuge, not an inaccessible safe zone.
 *
 * A predator outside the bed loses visibility of prey deeper in the canopy.
 * A predator entering the bed weakens that advantage, but does not gain
 * x-ray vision: shared stems and blades still interrupt sight and manoeuvring.
 * Rock gaps use a separate physical body-clearance rule.
 */
export const ricefishRelativeCanopyShelter = (
  preyCanopyShelter: number,
  predatorCanopyShelter: number,
): number => {
  const preyCover = clamp(preyCanopyShelter, 0, 0.96);
  const predatorCover = clamp(predatorCanopyShelter, 0, 0.96);
  const sharedComplexity = Math.min(preyCover, predatorCover);
  return clamp(
    preyCover * (1 - predatorCover * 0.72) +
      sharedComplexity * predatorCover * 0.35,
    0,
    0.96,
  );
};

/**
 * Dense vegetation shortens the radius that can be searched from one view.
 *
 * It never changes the recognisability of an animal already at the mouth:
 * this scale is applied to long-range acquisition and retained tracking only.
 */
export const ricefishCanopyDetectionScale = (
  predatorCanopyShelter: number,
): number => 1 - clamp(predatorCanopyShelter, 0, 0.96) * 0.68;

/**
 * Pursuit through a plant bed is slower than pursuit in open water.
 *
 * Cover around the prey already matters while the fish approaches the bed;
 * complexity shared by predator and prey matters more once both animals are
 * weaving among the same blades.
 */
export const ricefishCanopyPursuitScale = (
  preyCanopyShelter: number,
  predatorCanopyShelter: number,
): number => {
  const preyCover = clamp(preyCanopyShelter, 0, 0.96);
  const predatorCover = clamp(predatorCanopyShelter, 0, 0.96);
  const sharedComplexity = Math.min(preyCover, predatorCover);
  const routeComplexity = preyCover * 0.45 + sharedComplexity * 0.55;
  return 1 - clamp(routeComplexity, 0, 0.96) * 0.62;
};

/**
 * Dense blades interrupt a retained visual lock as well as first detection.
 * Mouth-scale contact remains trackable, but a fish cannot follow one target
 * across the full search radius after both animals enter the plant bed.
 */
export const ricefishCanopyTrackingScale = (
  relativeShelter: number,
): number => 1 - clamp(relativeShelter, 0, 0.96) * 0.74;

/**
 * Once prey overlaps the mouth, vegetation has already affected detection,
 * tracking and the approach path. Applying the same canopy penalty again here
 * made a located Daphnia survive repeated physical contacts. Keep only
 * contact alignment, light and the prey's active escape stroke in the final
 * capture roll.
 */
export const ricefishContactCaptureProbability = (
  contactCloseness: number,
  _relativeShelter: number,
  localVisualExposure: number,
  escapeCaptureFactor: number,
): number => clamp(
  (0.74 + clamp(contactCloseness, 0, 1) * 0.18) *
    clamp(localVisualExposure, 0, 1) *
    (0.85 + clamp(escapeCaptureFactor, 0, 1) * 0.15),
  0,
  0.92,
);

/**
 * Structural reference used only for the non-material stomach-fullness signal.
 *
 * Gut capacity follows the largest body the fish has actually built. This
 * avoids both failure modes: wasting does not instantly shrink the virtual
 * stomach, while an underfed juvenile does not acquire an adult-sized stomach
 * merely because time passed. The adult floor is the conserved maturity
 * compartment for legacy saves that lack a recorded peak.
 */
export const ricefishGutCapacityReferenceBiomass = (
  lifeStage: AnimalLifeStage,
  _ageSeconds: number,
  structuralBiomass: number,
  achievedStructuralBiomass: number = structuralBiomass,
): number => {
  const achievedStructure = Math.max(
    0,
    structuralBiomass,
    achievedStructuralBiomass,
  );
  if (lifeStage === 'adult') {
    return Math.max(
      achievedStructure,
      WATER_CYCLE_RULES.ricefish.juvenileStructuralBiomass,
    );
  }
  return achievedStructure;
};

/**
 * Reserve reference used by body condition and sub-adult growth.
 *
 * Condition follows the body the fish has actually built, not the body an
 * age-based growth schedule says it ought to have built. Otherwise a
 * food-limited juvenile becomes weaker merely because time passes, which then
 * suppresses the very foraging needed to recover when prey returns.
 *
 * `achievedStructuralBiomass` is normally the fish's recorded peak structure.
 * Retained meal matter still uses the separate stage storage cap.
 */
export const ricefishConditionReserveCapacity = (
  lifeStage: AnimalLifeStage,
  _ageSeconds: number,
  structuralBiomass: number,
  achievedStructuralBiomass: number = structuralBiomass,
): number => {
  if (lifeStage === 'egg') return 0;
  const achievedBodyReference = Math.max(
    0,
    structuralBiomass,
    achievedStructuralBiomass,
  );
  const massRatio = clamp(
    achievedBodyReference /
      Math.max(1e-9, WATER_CYCLE_RULES.ricefish.adultStructuralBiomass),
    0,
    1,
  );
  return WATER_CYCLE_RULES.ricefish.adultReserveBiomass *
    Math.pow(massRatio, RICEFISH_ECOLOGY_RULES.metabolicMassExponent);
};

const ricefishBodyScaledAdultReserveFloor = (
  structuralBiomass: number,
  maximumAdultFloor: number,
): number => {
  const adultStructure =
    WATER_CYCLE_RULES.ricefish.adultStructuralBiomass;
  const maturityStructure =
    WATER_CYCLE_RULES.ricefish.juvenileStructuralBiomass;
  const massRatio = clamp(
    Math.max(maturityStructure, structuralBiomass) /
      Math.max(1e-9, adultStructure),
    0,
    1,
  );
  return maximumAdultFloor *
    Math.pow(massRatio, RICEFISH_ECOLOGY_RULES.metabolicMassExponent);
};

/**
 * Reserve that remains unavailable to ovarian allocation.
 *
 * Scaling by the existing metabolic exponent preserves the same resting
 * maintenance duration at every adult body size. The smaller reproductive
 * floor lets repeated food-funded meals finish a clutch without changing gut
 * handling or prey encounters.
 */
export const ricefishReproductionReserveFloor = (
  structuralBiomass: number,
): number => ricefishBodyScaledAdultReserveFloor(
  structuralBiomass,
  RICEFISH_ECOLOGY_RULES.reproductionReserveFloor,
);

/**
 * Longer reserve retained before optional maximum-adult somatic growth.
 *
 * This separate floor keeps the ovarian calibration from making males and
 * post-spawn females convert their fasting buffer into size and immediately
 * seek more prey.
 */
export const ricefishAdultSomaticGrowthReserveFloor = (
  structuralBiomass: number,
): number => ricefishBodyScaledAdultReserveFloor(
  structuralBiomass,
  RICEFISH_ECOLOGY_RULES.adultSomaticGrowthReserveFloor,
);

/**
 * Relative ceiling for food-funded somatic growth after sexual maturity.
 *
 * Medaka keep growing after maturity, but not at the same rate all the way to
 * their maximum body size. The continuous remaining-gap curve avoids both an
 * abrupt stage multiplier and a lifetime-long full-rate adult growth sink.
 */
export const ricefishAdultSomaticGrowthRateScale = (
  structuralBiomass: number,
): number => {
  const maturityStructure =
    WATER_CYCLE_RULES.ricefish.juvenileStructuralBiomass;
  const maximumStructure =
    WATER_CYCLE_RULES.ricefish.adultStructuralBiomass;
  const adultSizeProgress = clamp01(
    (structuralBiomass - maturityStructure) /
      Math.max(1e-9, maximumStructure - maturityStructure),
  );
  return Math.pow(
    1 - adultSizeProgress,
    RICEFISH_ECOLOGY_RULES.adultSomaticGrowthTaperExponent,
  );
};

/**
 * Stomach fullness briefly overrides physiological demand for more prey.
 *
 * This is deliberately a behavioural signal, not a second biomass store:
 * captured matter has already been routed through the water ledger. A
 * stage-and-body-proportional reference prevents a single absolute threshold
 * from starving fry or letting adults chain-capture an entire local swarm.
 */
export const ricefishForagingAppetite = (
  recentIntake: number,
  structuralBiomass: number,
): number => {
  const capacity = Math.max(
    1e-9,
    structuralBiomass *
      RICEFISH_ECOLOGY_RULES.gutCapacityStructuralFraction,
  );
  return clamp(1 - Math.max(0, recentIntake) / capacity, 0, 1);
};

/**
 * Add one prey encounter to the non-material handling signal.
 *
 * Rendered prey are compressed population tokens, so their conserved biomass
 * cannot also be treated as literal stomach volume. A capture can fill the
 * current stomach reference, but can never overfill it and turn one bite into
 * several hundred seconds of artificial fasting.
 */
export const ricefishRecentIntakeAfterCapture = (
  recentIntake: number,
  consumedBiomass: number,
  structuralReferenceBiomass: number,
): number => {
  const capacity = Math.max(
    1e-9,
    Math.max(0, structuralReferenceBiomass) *
      RICEFISH_ECOLOGY_RULES.gutCapacityStructuralFraction,
  );
  return Math.min(
    capacity,
    Math.max(0, recentIntake) + Math.min(
      Math.max(0, consumedBiomass),
      capacity,
    ),
  );
};

export const ricefishEvacuatedRecentIntake = (
  recentIntake: number,
  deltaSeconds: number,
  evacuationSeconds: number = RICEFISH_ECOLOGY_RULES.gutEvacuationSeconds,
): number => Math.max(0, recentIntake) * Math.exp(
  -Math.max(0, deltaSeconds) /
    Math.max(1e-9, evacuationSeconds),
);

/**
 * Gut handling changes with body development rather than a named-stage jump.
 *
 * A newly mature fish is still the same size it was one tick earlier. Making
 * its already ingested meal suddenly evacuate at the maximum-adult rate kept
 * it falsely satiated through the small reserve it had just grown with.
 */
export const ricefishGutEvacuationSecondsForStructure = (
  lifeStage: AnimalLifeStage,
  structuralBiomass: number,
): number => {
  if (lifeStage !== 'adult') {
    return RICEFISH_ECOLOGY_RULES.subadultGutEvacuationSeconds;
  }
  const progress = clamp(
    (
      Math.max(0, structuralBiomass) -
        WATER_CYCLE_RULES.ricefish.juvenileStructuralBiomass
    ) / Math.max(
      1e-9,
      WATER_CYCLE_RULES.ricefish.adultStructuralBiomass -
        WATER_CYCLE_RULES.ricefish.juvenileStructuralBiomass,
    ),
    0,
    1,
  );
  return RICEFISH_ECOLOGY_RULES.subadultGutEvacuationSeconds +
    (
      RICEFISH_ECOLOGY_RULES.gutEvacuationSeconds -
        RICEFISH_ECOLOGY_RULES.subadultGutEvacuationSeconds
    ) * progress;
};

export const ricefishLifeStageMetabolismScale = (
  _lifeStage: AnimalLifeStage,
): number => 1;

/**
 * Yolk is part of storedBiomass, not a second matter compartment.
 *
 * Maintenance can draw on it immediately, while this helper meters the share
 * available for somatic growth across the compressed yolk-absorption period.
 * External food stored alongside it remains available to growth at once.
 */
export const ricefishYolkGrowthRelease = (
  yolkBiomass: number,
  ageSeconds: number,
  deltaSeconds: number,
): number => {
  const yolk = Math.max(0, yolkBiomass);
  const elapsed = Math.max(0, ageSeconds);
  const step = Math.max(0, deltaSeconds);
  const remainingSeconds =
    RICEFISH_ECOLOGY_RULES.yolkAbsorptionSeconds - elapsed;
  if (yolk <= 0 || step <= 0) return 0;
  if (remainingSeconds <= step) return yolk;
  return Math.min(yolk, yolk * step / remainingSeconds);
};

/**
 * Locomotion cost follows the movement that is actually being performed.
 *
 * `hunting` also labels a hungry fish crossing an already inspected patch so
 * the foraging hysteresis survives between observations. That search transect
 * still uses ordinary cruise speed and must not be billed as a high-speed
 * pursuit. Otherwise a missed local search raises maintenance, erodes soma,
 * and makes the fish remain in the expensive hungry state even longer.
 */
export const ricefishActivityCostPerSecond = (
  lifeStage: AnimalLifeStage,
  behavior: AnimalBehavior,
  hasTrackedPrey: boolean,
  pursuitEffort = 0,
  locomotionIntensity = 1,
): number => {
  if (lifeStage === 'egg' || behavior === 'resting') {
    return RICEFISH_ECOLOGY_RULES.restingActivityCostPerSecond;
  }
  if (behavior === 'hunting' && hasTrackedPrey) {
    const speedEffort = 0.72 + clamp(locomotionIntensity, 0, 1.25) * 0.28;
    const accumulatedEffort = clamp(
      pursuitEffort / RICEFISH_ECOLOGY_RULES.maximumContinuousPursuitEffort,
      0,
      1,
    );
    return RICEFISH_ECOLOGY_RULES.huntingActivityCostPerSecond * speedEffort +
      RICEFISH_ECOLOGY_RULES.longPursuitActivityCostPerSecond *
        accumulatedEffort;
  }
  return RICEFISH_ECOLOGY_RULES.swimmingActivityCostPerSecond;
};

/**
 * Accumulate fatigue only from an actual retained pursuit.
 *
 * A fast chase costs more than following a nearby slow prey, and vegetation
 * adds turning/acceleration work. The fish never consults prey population
 * size: only its own velocity and the cover at the two current positions.
 */
export const ricefishPursuitEffortRate = (
  locomotionIntensity: number,
  preyCanopyShelter: number,
  predatorCanopyShelter: number,
): number => {
  const speed = clamp(locomotionIntensity, 0, 1.25);
  const sharedComplexity = Math.min(
    clamp(preyCanopyShelter, 0, 0.96),
    clamp(predatorCanopyShelter, 0, 0.96),
  );
  return 0.55 + speed * speed * 0.62 + sharedComplexity * 0.72;
};

/**
 * A Daphnia's visible escape stroke must change whether the pursuing fish can
 * complete a strike.  Merely increasing the prey's velocity is not enough:
 * once the fish entered strike range the old capture roll ignored that motion.
 *
 * Only the predator-triggered `traveling` state earns this reduction. Ordinary
 * wandering, a sideways stroke, or movement toward the fish remains fully
 * catchable. Even a maximum escape stroke only reduces the chance; it never
 * grants immunity.
 */
export const ricefishDaphniaEscapeCaptureFactor = (
  predatorPosition: Vec2,
  preyPosition: Vec2,
  preyVelocity: Vec2,
  preyBehavior: AnimalBehavior,
): number => {
  if (preyBehavior !== 'traveling') return 1;
  const awayX = preyPosition.x - predatorPosition.x;
  const awayY = preyPosition.y - predatorPosition.y;
  const distance = Math.hypot(awayX, awayY);
  if (distance <= 1e-6) return 1;
  const awaySpeed = (
    preyVelocity.x * awayX +
      preyVelocity.y * awayY
  ) / distance;
  const escapeProgress = clamp(
    awaySpeed / DAPHNIA_PREDATOR_ESCAPE_SPEED,
    0,
    1,
  );
  return 1 - escapeProgress * 0.58;
};

/**
 * Absolute Daphnia escape speed grows with body size.
 *
 * Neonates can accelerate sharply relative to their own length, but they do
 * not cover the same world-space distance per second as a full adult. This is
 * especially important for larval ricefish, which can swallow only the small
 * end of the Daphnia size continuum. The response remains continuous through
 * every instar and never consults population density.
 */
export const daphniaPredatorEscapeSpeedScaleForBodyLength = (
  bodyLength: number,
): number => 0.66 + clamp(
  (
    Math.max(0, bodyLength) - DAPHNIA_NEWBORN_BODY_LENGTH
  ) / Math.max(
    1e-9,
    DAPHNIA_MAXIMUM_BODY_LENGTH - DAPHNIA_NEWBORN_BODY_LENGTH,
  ),
  0,
  1,
) * 0.34;

/**
 * Medaka eggs remain fixed to the selected surface, so a spawning adult must
 * reject a locally harmful attachment site even when the tank-wide average
 * looks safe. Returning zero is a hard rejection; positive values rank the
 * remaining sites without creating any oxygen or removing any waste.
 */
export const ricefishEggAttachmentWaterSuitability = (
  oxygen: number,
  toxicWaste: number,
): number => {
  const rules = RICEFISH_ECOLOGY_RULES;
  if (
    oxygen < rules.oxygenStressStart ||
    toxicWaste > rules.toxicWasteStressStart
  ) return 0;
  const oxygenMargin = clamp(
    (oxygen - rules.oxygenStressStart) /
      Math.max(1, 100 - rules.oxygenStressStart),
    0,
    1,
  );
  const toxicMargin = clamp(
    (rules.toxicWasteStressStart - toxicWaste) /
      Math.max(1e-6, rules.toxicWasteStressStart),
    0,
    1,
  );
  return 0.35 + oxygenMargin * 0.35 + toxicMargin * 0.30;
};

/**
 * Bounded local-search effort for a food-funded young ricefish.
 *
 * A juvenile that is still missing conserved structure for maturity keeps
 * casting for nearby prey more actively than a sibling that has already
 * reached adult structure. This does not expand the sensory radius, reveal a
 * remote prey coordinate or add food. It only affects how often locally
 * encountered candidates are noticed and reconsidered.
 */
export const ricefishDevelopmentForagingUrgency = (
  lifeStage: AnimalLifeStage,
  structuralBiomass: number,
): number => {
  const developmentTarget = lifeStage === 'fry'
    ? WATER_CYCLE_RULES.ricefish.fryBirthBiomass * 0.72
    : lifeStage === 'juvenile'
      ? WATER_CYCLE_RULES.ricefish.juvenileStructuralBiomass
      : 0;
  if (developmentTarget <= 0) return 0;
  return clamp(
    (developmentTarget - structuralBiomass) / developmentTarget,
    0,
    1,
  );
};

/**
 * Combine growth demand with the individual's own depleted condition.
 *
 * This never reads prey abundance. It only makes a hungry fish inspect more
 * independent local views; distance, light, line of sight, canopy shelter and
 * the presence of a real edible candidate still decide whether anything is
 * found. Adults therefore do not keep the juvenile growth urgency, but unlike
 * the former model they also do not search at the satiated rate while starving.
 */
export const ricefishForagingUrgency = (
  lifeStage: AnimalLifeStage,
  structuralBiomass: number,
  energy: number,
): number => {
  const hungerMotivation = clamp(
    (
      RICEFISH_ECOLOGY_RULES.forageStartEnergy - energy
    ) / Math.max(
      1e-9,
      RICEFISH_ECOLOGY_RULES.forageStartEnergy - 0.24,
    ),
    0,
    1,
  );
  // Moderate food deprivation raises feeding motivation, but a severely
  // wasted fish cannot turn that motivation into unlimited search effort.
  // Retain a small emergency floor so weakness does not become a hard
  // behavioural death sentence beside mouth-scale prey.
  const starvationPerformance =
    energy >= RICEFISH_ECOLOGY_RULES.starvationEmergencyForageEnergy
    ? 1
    : clamp(
      (energy - 0.03) /
        (RICEFISH_ECOLOGY_RULES.starvationEmergencyForageEnergy - 0.03),
      0.2,
      1,
    );
  return Math.max(
    ricefishDevelopmentForagingUrgency(lifeStage, structuralBiomass),
    hungerMotivation,
  ) * starvationPerformance;
};

/**
 * Severe wasting reduces sustained swimming ability after feeding motivation
 * has already peaked. Ordinary hunger (energy >= 0.24) leaves speed intact.
 */
export const ricefishStarvationActivityScale = (
  energy: number,
): number => energy >=
  RICEFISH_ECOLOGY_RULES.starvationEmergencyForageEnergy
  ? 1
  : 0.45 + clamp(
    energy / RICEFISH_ECOLOGY_RULES.starvationEmergencyForageEnergy,
    0,
    1,
  ) * 0.55;

/**
 * Treat urgency as at most one extra independent inspection of the same
 * locally exposed prey. This increases a missed candidate's chance smoothly
 * without turning a moderate base probability straight into certainty.
 */
export const ricefishLocalPreyDetectionChance = (
  baseChance: number,
  foragingUrgency: number,
): number => {
  const boundedBase = clamp(baseChance, 0, 1);
  return 1 - Math.pow(
    1 - boundedBase,
    1 + clamp(foragingUrgency, 0, 1),
  );
};

/**
 * Continuous monocular visual-search geometry for a laterally eyed medaka.
 *
 * High-speed prey-capture observations show medaka retaining prey laterally
 * instead of centring it in a frontal binocular strike zone. The broad side
 * fields are therefore strongest, the front remains usable, and the exact
 * rear is weak rather than being treated as equal evidence. Distance reduces
 * visual evidence continuously without applying a second prey-density gate.
 */
export const ricefishVisualSearchGeometry = (
  predatorPosition: Vec2,
  predatorVelocity: Vec2,
  predatorFacing: -1 | 1,
  preyPosition: Vec2,
  detectionRadius: number,
): number => {
  const dx = preyPosition.x - predatorPosition.x;
  const dy = preyPosition.y - predatorPosition.y;
  const distance = Math.hypot(dx, dy);
  const boundedRadius = Math.max(1e-9, detectionRadius);
  if (distance >= boundedRadius) return 0;
  const speed = Math.hypot(predatorVelocity.x, predatorVelocity.y);
  const headingX = speed > RICEFISH_ECOLOGY_RULES.cruiseSpeed * 0.12
    ? predatorVelocity.x / speed
    : predatorFacing;
  const headingY = speed > RICEFISH_ECOLOGY_RULES.cruiseSpeed * 0.12
    ? predatorVelocity.y / speed
    : 0;
  const directionX = distance > 1e-9 ? dx / distance : headingX;
  const directionY = distance > 1e-9 ? dy / distance : headingY;
  const forwardDot = clamp(
    headingX * directionX + headingY * directionY,
    -1,
    1,
  );
  const lateralEvidence = Math.abs(
    headingX * directionY - headingY * directionX,
  );
  const angularEvidence = clamp(
    0.48 +
      lateralEvidence * 0.52 +
      Math.max(0, forwardDot) * 0.12 -
      Math.max(0, -forwardDot) * 0.45,
    0.05,
    1,
  );
  const distanceEvidence = 1 - distance / boundedRadius;
  return angularEvidence * distanceEvidence;
};

/**
 * Short side-swing velocity used for an actual capture attempt.
 *
 * The main component still closes on the prey. A smaller perpendicular
 * component produces the characteristic lateral sweep without teleporting
 * either animal or changing the capture probability.
 */
export const ricefishSideSwingStrikeVelocity = (
  predatorPosition: Vec2,
  predatorVelocity: Vec2,
  predatorFacing: -1 | 1,
  preyPosition: Vec2,
  strikeSpeed: number,
  preferredSide: -1 | 1,
): Vec2 => {
  const dx = preyPosition.x - predatorPosition.x;
  const dy = preyPosition.y - predatorPosition.y;
  const distance = Math.hypot(dx, dy);
  const predatorSpeed = Math.hypot(predatorVelocity.x, predatorVelocity.y);
  const towardX = distance > 1e-9
    ? dx / distance
    : predatorSpeed > 1e-9
      ? predatorVelocity.x / predatorSpeed
      : predatorFacing;
  const towardY = distance > 1e-9
    ? dy / distance
    : predatorSpeed > 1e-9
      ? predatorVelocity.y / predatorSpeed
      : 0;
  const sideX = -towardY * preferredSide;
  const sideY = towardX * preferredSide;
  const combinedX = towardX + sideX * 0.24;
  const combinedY = towardY + sideY * 0.24;
  const combinedLength = Math.max(1e-9, Math.hypot(combinedX, combinedY));
  const speed = Math.max(0, strikeSpeed);
  return {
    x: combinedX / combinedLength * speed,
    y: combinedY / combinedLength * speed,
  };
};

/**
 * World-space centre of the visible ricefish mouth.
 *
 * The renderer mirrors local X before applying its signed pose rotation. The
 * resulting forward vector is therefore `(facing * cos(angle), sin(angle))`
 * for both left- and right-facing fish.
 */
export const ricefishMouthPoint = (
  position: Vec2,
  facing: -1 | 1,
  poseAngle: number,
  bodyLength: number,
): Vec2 => {
  const offset = Math.max(0, bodyLength) *
    RICEFISH_MOUTH_OFFSET_BODY_FRACTION;
  return {
    x: position.x + facing * Math.cos(poseAngle) * offset,
    y: position.y + Math.sin(poseAngle) * offset,
  };
};

/**
 * Radius within which a prey silhouette overlaps the open mouth.
 *
 * This is deliberately body-scale geometry, not the former fixed centre
 * distance. The prey contribution represents its visible half-width, while
 * the smaller predator contribution represents the mouth opening.
 */
export const ricefishMouthContactRadius = (
  predatorBodyLength: number,
  preyBodyLength: number,
): number => Math.max(
  3.2,
  Math.max(0, predatorBodyLength) * 0.075 +
    Math.max(0, preyBodyLength) * 0.32,
);

/**
 * Visual reaction distance grows with fish body/eye scale.
 *
 * Fry still inspect a smaller nearby patch than adults. The non-zero authored
 * floor represents the compressed prey field rather than a distant radar:
 * angular evidence, distance decay, light, line of sight and vegetation
 * shelter remain part of every actual recognition attempt.
 */
export const ricefishPreyDetectionRadiusForBodyLength = (
  bodyLength: number,
): number => {
  const effectiveLength = clamp(
    Math.max(0, bodyLength),
    RICEFISH_ECOLOGY_RULES.fryLength,
    RICEFISH_ECOLOGY_RULES.adultLength,
  );
  const growthProgress = (
    effectiveLength - RICEFISH_ECOLOGY_RULES.fryLength
  ) / Math.max(
    1e-9,
    RICEFISH_ECOLOGY_RULES.adultLength -
      RICEFISH_ECOLOGY_RULES.fryLength,
  );
  const fryRadius =
    RICEFISH_ECOLOGY_RULES.animalPreyDetectionRadius *
    RICEFISH_ECOLOGY_RULES.fryPreyDetectionRadiusFraction;
  return fryRadius +
    (
      RICEFISH_ECOLOGY_RULES.animalPreyDetectionRadius - fryRadius
    ) * growthProgress;
};

/**
 * Compatibility helper for callers that only have a named stage.
 * Simulation agents use their continuous `bodyLength` instead.
 */
export const ricefishPreyDetectionRadius = (
  lifeStage: AnimalLifeStage,
): number => {
  if (lifeStage === 'egg') return 0;
  const nominalLength = lifeStage === 'fry'
    ? RICEFISH_ECOLOGY_RULES.fryLength
    : lifeStage === 'juvenile'
      ? RICEFISH_ECOLOGY_RULES.juvenileLength
      : RICEFISH_ECOLOGY_RULES.adultLength;
  return ricefishPreyDetectionRadiusForBodyLength(nominalLength);
};

/**
 * Hydrodynamic warning distance scales with the approaching fish, not with an
 * adult-sized constant attached to every life stage.
 *
 * Diffuse fish kairomone still changes migration and vigilance. This radius
 * is only for the rapid, directed escape stroke triggered by the local flow
 * of an approaching fish. Keeping it inside that stage's visual reaction
 * distance prevents a small fry from repelling prey before it can see it.
 */
export const daphniaDirectPredatorSenseRadiusForBodyLength = (
  predatorBodyLength: number,
): number => {
  const effectiveLength = clamp(
    Math.max(0, predatorBodyLength),
    RICEFISH_ECOLOGY_RULES.fryLength,
    RICEFISH_ECOLOGY_RULES.adultLength,
  );
  // The prey's hydrodynamic warning distance follows the approaching body's
  // physical scale. It must not inherit the gameplay floor used for the
  // predator's visual search patch.
  return DAPHNIA_DIRECT_PREDATOR_SENSE_RADIUS *
    effectiveLength / RICEFISH_ECOLOGY_RULES.adultLength;
};

/**
 * Compatibility helper for stage-only tests and external diagnostics.
 */
export const daphniaDirectPredatorSenseRadius = (
  predatorLifeStage: AnimalLifeStage,
): number => {
  if (predatorLifeStage === 'egg') return 0;
  const nominalLength = predatorLifeStage === 'fry'
    ? RICEFISH_ECOLOGY_RULES.fryLength
    : predatorLifeStage === 'juvenile'
      ? RICEFISH_ECOLOGY_RULES.juvenileLength
      : RICEFISH_ECOLOGY_RULES.adultLength;
  return daphniaDirectPredatorSenseRadiusForBodyLength(nominalLength);
};

/**
 * Swimming capacity follows actual length, with the authored fry, juvenile
 * and adult values serving as interpolation anchors rather than hard stages.
 */
export const ricefishSwimmingSpeedScaleForBodyLength = (
  bodyLength: number,
): number => {
  const fryLength = RICEFISH_ECOLOGY_RULES.fryLength;
  const juvenileLength = RICEFISH_ECOLOGY_RULES.juvenileLength;
  const adultLength = RICEFISH_ECOLOGY_RULES.adultLength;
  const length = clamp(Math.max(0, bodyLength), fryLength, adultLength);
  if (length <= juvenileLength) {
    const progress = (length - fryLength) /
      Math.max(1e-9, juvenileLength - fryLength);
    return 0.58 + (0.82 - 0.58) * progress;
  }
  const progress = (length - juvenileLength) /
    Math.max(1e-9, adultLength - juvenileLength);
  return 0.82 + (1 - 0.82) * progress;
};

/**
 * Food-funded pre-adult length on the same three-dimensional mass axis.
 *
 * Hatch mass and maturity mass differ by roughly the cube of the authored
 * 10 px and 27 px lengths. Age can permit a stage transition, but it cannot
 * make a food-limited 0.001-mass fry look and forage like a 0.020-mass fish.
 */
export const ricefishSubadultBodyLengthForStructure = (
  structuralBiomass: number,
): number => clamp(
  RICEFISH_ECOLOGY_RULES.fryLength *
    Math.cbrt(
      Math.max(0, structuralBiomass) /
        Math.max(1e-9, WATER_CYCLE_RULES.ricefish.fryBirthBiomass),
    ),
  RICEFISH_ECOLOGY_RULES.fryLength,
  RICEFISH_ECOLOGY_RULES.juvenileLength,
);

/**
 * Continuous Daphnia size preference. Displayed Daphnia remain deliberately
 * enlarged, but a fish's own side of the ratio follows its actual length.
 */
export const ricefishDaphniaSizePreferenceForBodyLength = (
  predatorBodyLength: number,
  candidateBodyLength: number,
): number => {
  const fryLength = RICEFISH_ECOLOGY_RULES.fryLength;
  const juvenileLength = RICEFISH_ECOLOGY_RULES.juvenileLength;
  const adultLength = RICEFISH_ECOLOGY_RULES.adultLength;
  const length = clamp(
    Math.max(0, predatorBodyLength),
    fryLength,
    adultLength,
  );
  const preferredRatio = length <= juvenileLength
    ? 0.38 + (0.24 - 0.38) *
      (length - fryLength) /
        Math.max(1e-9, juvenileLength - fryLength)
    : 0.24 + (0.16 - 0.24) *
      (length - juvenileLength) /
        Math.max(1e-9, adultLength - juvenileLength);
  const ratio = Math.max(0, candidateBodyLength) / Math.max(1, length);
  return clamp(1 - Math.abs(ratio - preferredRatio) / 0.18, 0, 1);
};

/**
 * Biological Daphnia-size preference for simulation agents.
 *
 * The visible sprite is intentionally enlarged, so conserved structure—not
 * rendered pixels—places prey on the size axis. The broad log-scale hump
 * favours intermediate Daphnia, while keeping both neonates and large adults
 * possible. This mirrors the measured 27 mm medaka response: 2–3 day prey
 * were taken more often than either neonates or the largest 6-day class.
 */
export const ricefishDaphniaSizePreferenceForStructure = (
  predatorBodyLength: number,
  candidateStructuralBiomass: number,
): number => {
  const edibleMaximum = Math.max(
    1e-9,
    ricefishMaximumDaphniaStructureForBodyLength(predatorBodyLength),
  );
  const sizeRatio = clamp(
    Math.max(0, candidateStructuralBiomass) / edibleMaximum,
    0.02,
    1,
  );
  const preferredRatio = 0.38;
  const logDistance =
    Math.log(sizeRatio / preferredRatio) / 0.72;
  return 0.18 + 0.82 * Math.exp(-0.5 * logDistance * logDistance);
};

/**
 * Continuous physical upper bound for Daphnia prey. The prey sprites are
 * enlarged for selection, so conserved structure remains their size proxy;
 * the predator side follows actual fish length without a fry-stage cliff.
 */
export const ricefishMaximumDaphniaStructureForBodyLength = (
  predatorBodyLength: number,
): number => {
  const progress = clamp(
    (
      Math.max(0, predatorBodyLength) -
        RICEFISH_ECOLOGY_RULES.fryLength
    ) /
      Math.max(
        1e-9,
        RICEFISH_ECOLOGY_RULES.juvenileLength -
          RICEFISH_ECOLOGY_RULES.fryLength,
      ),
    0,
    1,
  );
  return RICEFISH_ECOLOGY_RULES.fryMaximumDaphniaStructuralBiomass +
    (
      WATER_CYCLE_RULES.daphnia.adultStructuralBiomass -
        RICEFISH_ECOLOGY_RULES.fryMaximumDaphniaStructuralBiomass
    ) * progress;
};

/**
 * Largest cherry-shrimp growth fraction that fits a ricefish's mouth.
 *
 * `bodyLength` and the shrimp sprite length are presentation units, not a
 * shared physical scale. Map the fish continuously to its authored real-world
 * adult length and compare it with the shrimp's biological growth continuum.
 * This lets juveniles and adults take genuine newborn shrimp while a growing
 * shrimp naturally leaves the edible window; fry remain too small.
 */
export const ricefishMaximumShrimpGrowthProgressForBodyLength = (
  predatorBodyLength: number,
): number => {
  const fishPhysicalLength =
    clamp(
      Math.max(0, predatorBodyLength),
      0,
      RICEFISH_ECOLOGY_RULES.adultLength,
    ) /
    RICEFISH_ECOLOGY_RULES.adultLength *
    RICEFISH_ADULT_PHYSICAL_LENGTH_MM;
  const maximumPreyLength =
    fishPhysicalLength * RICEFISH_MAXIMUM_PREY_PHYSICAL_LENGTH_RATIO;
  return clamp(
    (
      maximumPreyLength - SHRIMP_NEWBORN_PHYSICAL_LENGTH_MM
    ) /
      (
        SHRIMP_ADULT_PHYSICAL_LENGTH_MM -
        SHRIMP_NEWBORN_PHYSICAL_LENGTH_MM
      ),
    0,
    1,
  );
};

export const ricefishLocalSearchRetrySeconds = (
  foragingUrgency: number,
  detectionRadius: number =
    RICEFISH_ECOLOGY_RULES.animalPreyDetectionRadius,
): number => (
  Math.max(0, detectionRadius) /
  RICEFISH_ECOLOGY_RULES.cruiseSpeed
) / (1 + clamp(foragingUrgency, 0, 1));

/**
 * Preserve the intended adult-life budget when food delays maturity.
 *
 * At nominal 480-second maturation this returns the original birth-to-death
 * deadline unchanged. A delayed fish receives the same remaining adult span
 * instead of becoming an adult only to hit an already-spent juvenile clock.
 */
export const ricefishLifespanDeadlineAtMaturity = (
  originalLifespanSeconds: number,
  actualMaturationAgeSeconds: number,
): number => Math.max(0, actualMaturationAgeSeconds) +
  Math.max(
    0,
    originalLifespanSeconds - RICEFISH_ECOLOGY_RULES.maturationSeconds,
  );

interface RicefishPatchExitBounds {
  minimumX: number;
  maximumX: number;
  minimumY: number;
  maximumY: number;
}

/**
 * Select one stable, reachable point outside a prey-poor visual patch.
 *
 * Merely reflecting an outward heading at a tank margin creates a boundary
 * equilibrium: one frame points inward, then the remembered patch centre
 * points the fish outward again. Sampling a fixed point on the search circle
 * lets a fish near an edge leave tangentially or inward and actually obtain
 * an independent view.
 */
export const ricefishPatchExitPoint = (
  patchOrigin: Vec2,
  minimumDistance: number,
  bounds: RicefishPatchExitBounds,
  deterministicSeed: number,
): Vec2 => {
  const requiredDistance = Math.max(1, minimumDistance);
  const travelDistance = requiredDistance * 1.08 + 4;
  const baseAngle = deterministicNoise(
    deterministicSeed * 0.31 +
      patchOrigin.x * 0.017 +
      patchOrigin.y * 0.029,
  ) * Math.PI * 2;
  const candidateCount = 24;
  for (let index = 0; index < candidateCount; index += 1) {
    const angle = baseAngle + index * Math.PI * 2 / candidateCount;
    const candidate = {
      x: patchOrigin.x + Math.cos(angle) * travelDistance,
      y: patchOrigin.y + Math.sin(angle) * travelDistance,
    };
    if (
      candidate.x >= bounds.minimumX &&
      candidate.x <= bounds.maximumX &&
      candidate.y >= bounds.minimumY &&
      candidate.y <= bounds.maximumY
    ) {
      return candidate;
    }
  }

  // A very narrow future tank may not contain the requested circle. Pick the
  // farthest reachable corner so movement still increases independence
  // instead of settling on a reflected boundary.
  const corners = [
    { x: bounds.minimumX, y: bounds.minimumY },
    { x: bounds.minimumX, y: bounds.maximumY },
    { x: bounds.maximumX, y: bounds.minimumY },
    { x: bounds.maximumX, y: bounds.maximumY },
  ];
  return corners.reduce((farthest, candidate) =>
    distanceSquared(candidate, patchOrigin) >
      distanceSquared(farthest, patchOrigin)
      ? candidate
      : farthest);
};

const completeDepletionScale = (
  available: number,
  requested: number,
): number => {
  if (available <= 0 || requested <= 0) return 0;
  return Math.min(1, available / requested);
};

const distanceSquared = (a: Vec2, b: Vec2): number => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
};

const closestPointOnSegment = (point: Vec2, from: Vec2, to: Vec2): Vec2 => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 1e-12) return { x: from.x, y: from.y };
  const t = clamp(
    ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared,
    0,
    1,
  );
  return { x: from.x + dx * t, y: from.y + dy * t };
};

const closestPolygonGap = (
  first: Vec2[],
  second: Vec2[],
): { first: Vec2; second: Vec2; distance: number } | null => {
  let nearest: { first: Vec2; second: Vec2; distanceSquared: number } | null =
    null;
  const consider = (point: Vec2, from: Vec2, to: Vec2, reversed: boolean): void => {
    const projected = closestPointOnSegment(point, from, to);
    const separation = distanceSquared(point, projected);
    if (nearest && separation >= nearest.distanceSquared) return;
    nearest = reversed
      ? { first: projected, second: point, distanceSquared: separation }
      : { first: point, second: projected, distanceSquared: separation };
  };
  for (const point of first) {
    for (let index = 0; index < second.length; index += 1) {
      consider(point, second[index], second[(index + 1) % second.length], false);
    }
  }
  for (const point of second) {
    for (let index = 0; index < first.length; index += 1) {
      consider(point, first[index], first[(index + 1) % first.length], true);
    }
  }
  const result = nearest as {
    first: Vec2;
    second: Vec2;
    distanceSquared: number;
  } | null;
  return result
    ? {
      first: result.first,
      second: result.second,
      distance: Math.sqrt(result.distanceSquared),
    }
    : null;
};

const cloneBiomass = (biomass: SpeciesBiomass): SpeciesBiomass => ({
  oedogonium: biomass.oedogonium,
  nitzschia: biomass.nitzschia,
  vallisneria: biomass.vallisneria ?? 0,
});

const copyNumericArray = (
  source: ArrayLike<number>,
  target: number[] | undefined,
): number[] => {
  const values = target ?? new Array<number>(source.length);
  for (let index = 0; index < source.length; index += 1) {
    values[index] = source[index];
  }
  values.length = source.length;
  return values;
};

const emptyAnimalPopulationEventTotals = (): AnimalPopulationEventTotals => ({
  introduced: 0,
  removed: 0,
  births: 0,
  hatches: 0,
  maturations: 0,
  deaths: 0,
  deathsByCause: {
    starvation: 0,
    'old-age': 0,
    hypoxia: 0,
    toxicity: 0,
    temperature: 0,
    predation: 0,
  },
});

const cloneAnimalState = (animal: AnimalState): AnimalState => ({
  ...animal,
  position: { ...animal.position },
  velocity: { ...animal.velocity },
  foragingPatchOrigin: animal.foragingPatchOrigin
    ? { ...animal.foragingPatchOrigin }
    : null,
  foragingLastInspectionPosition: animal.foragingLastInspectionPosition
    ? { ...animal.foragingLastInspectionPosition }
    : null,
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

// FNV-1a is stable and inexpensive, but neighbouring lineage strings can keep
// visible bit patterns. Run the result through a 32-bit avalanche before it is
// used as an independent biological draw (sex, clutch variation, etc.). This
// depends only on that individual's lineage key, never on the current tank
// population or sex ratio.
const deterministicIndependentSeed = (value: string): number => {
  let hash = deterministicStringSeed(value);
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  hash ^= hash >>> 16;
  return hash >>> 0;
};

const daphniaMotionSeed = (animalId: string): number =>
  deterministicStringSeed(`daphnia-motion-${animalId}`) * 0.001;

const daphniaRoamingHeading = (
  motionSeed: number,
  segment: number,
): number =>
  deterministicNoise(
    motionSeed * 0.071 + segment * 7.193 + 3.17,
  ) * Math.PI * 2;

const seededRange = (
  seed: number,
  minimum: number,
  maximum: number,
): number => minimum + deterministicNoise(seed) * (maximum - minimum);

const shrimpMaturationTargetSeconds = (seed: number): number =>
  seededRange(
    seed * 0.053 + 17.3,
    SHRIMP_ECOLOGY_RULES.maturationMinimumSeconds,
    SHRIMP_ECOLOGY_RULES.maturationMaximumSeconds,
  );

const shrimpLifespanSeconds = (seed: number): number =>
  seededRange(
    seed * 19 + 13.7,
    SHRIMP_MIN_LIFESPAN_SECONDS,
    SHRIMP_MAX_LIFESPAN_SECONDS,
  );

const shrimpOvarianCycleSeconds = (
  seed: number,
  cycleIndex: number,
): number =>
  seededRange(
    seed * 0.071 + cycleIndex * 19.31 + 23.7,
    SHRIMP_ECOLOGY_RULES.ovarianCycleMinimumSeconds,
    SHRIMP_ECOLOGY_RULES.ovarianCycleMaximumSeconds,
  );

const shrimpClutchSizeForStructure = (structuralBiomass: number): number => {
  const maturity = SHRIMP_ECOLOGY_RULES.maturationStructuralBiomass;
  const fullSize = WATER_CYCLE_RULES.shrimp.adultStructuralBiomass;
  const sizeProgress = clamp01(
    (structuralBiomass - maturity) /
      Math.max(1e-9, fullSize - maturity),
  );
  return Math.round(
    SHRIMP_ECOLOGY_RULES.minimumClutchSize +
      (
        SHRIMP_ECOLOGY_RULES.maximumClutchSize -
        SHRIMP_ECOLOGY_RULES.minimumClutchSize
      ) * sizeProgress,
  );
};

const shrimpGestationSeconds = (
  seed: number,
  cycleIndex: number,
): number =>
  seededRange(
    seed * 0.083 + cycleIndex * 13.73 + 41.9,
    SHRIMP_ECOLOGY_RULES.gestationMinimumSeconds,
    SHRIMP_ECOLOGY_RULES.gestationMaximumSeconds,
  );

const daphniaMaturationInstarTarget = (seed: number): number =>
  PLANKTON_ECOLOGY_RULES.daphnia.maturationInstarsMinimum +
  Math.floor(
    deterministicNoise(seed * 0.061 + 29.1) * (
      PLANKTON_ECOLOGY_RULES.daphnia.maturationInstarsMaximum -
      PLANKTON_ECOLOGY_RULES.daphnia.maturationInstarsMinimum + 1
    ),
  );

const daphniaJuvenileMoltCycleSeconds = (
  seed: number,
  instarTarget: number,
): number =>
  PLANKTON_ECOLOGY_RULES.daphnia.maturationSeconds /
  Math.max(1, instarTarget) *
  seededRange(seed * 0.067 + 31.7, 0.88, 1.12);

const daphniaAdultMoltCycleSeconds = (
  seed: number,
  moltCount: number,
): number => {
  const rules = PLANKTON_ECOLOGY_RULES.daphnia;
  return rules.broodCooldownSeconds * seededRange(
    seed * 0.073 + moltCount * 11.17 + 37.1,
    rules.adultMoltCycleMinimumFactor,
    rules.adultMoltCycleMaximumFactor,
  );
};

const countByDefinition = (
  structures: StructureState[],
  definitionId: StructureDefinitionId,
): number => structures.filter((structure) => structure.definitionId === definitionId).length;

export class SimulationWorld {
  private runSeed = 0;
  private tank: TankDefinition = tankDefinition('standard');
  private structureSupportY = this.tank.groundY - 12;
  private shrimpMotionBucketColumns = Math.ceil(
    this.tank.width / SHRIMP_MOTION_BUCKET_SIZE,
  );
  private shrimpMotionBucketRows = Math.ceil(
    (this.tank.groundY - this.tank.waterTop) / SHRIMP_MOTION_BUCKET_SIZE,
  );
  private engine = Engine.create({ enableSleeping: true });
  private scenario: ScenarioDefinition = SCENARIOS['mission-1'];
  private phase: SimulationPhase = 'setup';
  private outcome: MissionOutcome = 'pending';
  private outcomeAtSeconds: number | null = null;
  private structures: StructureState[] = [];
  private substrateCells: SurfaceCellState[] = [];
  private allCellsCache: SurfaceCellState[] = [];
  private allCellsCacheDirty = true;
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
  private pointer: Vec2 = { x: this.tank.width / 2, y: this.tank.waterTop + 120 };
  private probe: ProbeSnapshot | null = null;
  private measurements: MeasurementState[] = [];
  private selection: SelectionSnapshot | null = null;
  private seedPlacements: SeedPlacementState[] = [];
  private animals: AnimalState[] = [];
  private ricefishForagingDiagnostics:
    Map<string, RicefishForagingDiagnosticSnapshot> | null = null;
  private carcasses: AnimalCarcassState[] = [];
  private animalPopulationEvents: AnimalPopulationEventSnapshot[] = [];
  private animalPopulationEventTotals = emptyAnimalPopulationEventTotals();
  private animalPopulationEventSequence = 0;
  private totalAlgaeConsumed = 0;
  private animalInventoryUsed: Record<AnimalSpeciesId, number> = {
    'cherry-shrimp': 0,
    'japanese-ricefish': 0,
    daphnia: 0,
  };
  private animalSexInventoryUsed: Record<
    AnimalSpeciesId,
    Record<AnimalSex, number>
  > = {
    'cherry-shrimp': { female: 0, male: 0 },
    'japanese-ricefish': { female: 0, male: 0 },
    daphnia: { female: 0, male: 0 },
  };
  private microbeInventoryUsed: Record<MicrobeGuildId, number> = {
    decomposer: 0,
    nitrifier: 0,
  };
  private planktonInventoryUsed: Record<PlanktonKind, number> = {
    phytoplankton: 0,
    daphnia: 0,
  };
  private suspendedBiofilm: BiofilmBiomass = emptyBiofilm();
  private biofilmSettlementCursor = 0;
  private biofilmSettlementAttemptAccumulator: Record<MicrobeGuildId, number> = {
    decomposer: 0,
    nitrifier: 0,
  };
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
  private appliedDaylightAngleRadians = 0;
  private waterTemperature = 23.5;
  private lightDirty = true;
  private lightTransportDirty = true;
  private daylightTransportDirty = true;
  private canopyLightSignature = '';
  private crossConnectionsDirty = true;
  private lightRevision = 0;
  private lightField: LightFieldSnapshot = {
    columns: this.tank.waterColumns,
    rows: this.tank.waterRows,
    values: Array.from({ length: this.tank.waterColumns * this.tank.waterRows }, () => 0),
    revision: 0,
  };
  private lightEmitters: LightEmitter[] = [];
  private lightReflectionSources: LightReflectionSource[] = [];
  private lightTransportCache = new Map<string, LightTransportPath>();
  /**
   * One bounded direct-shadow field per 2-degree daylight direction.
   * Hardscape cannot move while a simulation is running, so later day/night
   * cycles can reuse the same fields instead of ray-casting them again.
   */
  private directDaylightCoefficientCache =
    new Map<number, Map<string, number>>();
  private vallisneriaCanopyOptics: VallisneriaCanopyOptics[] = [];
  private vallisneriaShelterBucketColumns = Math.ceil(
    this.tank.width / VALLISNERIA_SHELTER_BUCKET_SIZE,
  );
  private vallisneriaShelterBucketRows = Math.ceil(
    (this.tank.groundY - this.tank.waterTop) /
      VALLISNERIA_SHELTER_BUCKET_SIZE,
  );
  private vallisneriaShelterBuckets: VallisneriaCanopyOptics[][] =
    Array.from(
      {
        length:
          this.vallisneriaShelterBucketColumns *
          this.vallisneriaShelterBucketRows,
      },
      () => [],
    );
  private canopyTransmissionCache = new Map<string, number>();
  private readonly biofilmReactionSitesScratch: BiofilmReactionSite[] = [];
  private readonly shrimpFoodCueSitesScratch: ShrimpFoodCueSite[] = [];
  private readonly shrimpMateCueSitesScratch: ShrimpMateCueSite[] = [];
  private readonly predatorDangerCueSitesScratch: PredatorDangerCueSite[] = [];
  private readonly shrimpFoodCellIndexByIdScratch = new Map<string, number>();
  private shrimpFoodReservationCountsScratch = new Uint16Array(0);
  private shrimpFoodReservationsActive = false;
  private readonly planktonSampleScratch: PlanktonSample = {
    phytoplankton: 0,
    planktonicDecomposer: 0,
    daphniaJuveniles: 0,
    daphniaAdults: 0,
  };
  private readonly waterVelocityScratch: Vec2 = { x: 0, y: 0 };
  private readonly localSamplePointScratch: Vec2 = { x: 0, y: 0 };
  private readonly waterEscapeScratch: WaterEscapeVector = {
    x: 0,
    y: 0,
    stress: 0,
  };
  private readonly cueDirectionScratch: Vec2 = { x: 0, y: 0 };
  private shrimpMotionBucketsScratch: AnimalState[][] = Array.from(
    {
      length:
        this.shrimpMotionBucketColumns * this.shrimpMotionBucketRows,
    },
    () => [],
  );
  private readonly shrimpMotionUsedBucketIndicesScratch: number[] = [];
  private ricefishMotionBucketsScratch: AnimalState[][] = Array.from(
    {
      length:
        this.shrimpMotionBucketColumns * this.shrimpMotionBucketRows,
    },
    () => [],
  );
  private readonly ricefishMotionUsedBucketIndicesScratch: number[] = [];
  private daphniaMotionBucketsScratch: AnimalState[][] = Array.from(
    {
      length:
        this.shrimpMotionBucketColumns * this.shrimpMotionBucketRows,
    },
    () => [],
  );
  private readonly daphniaMotionUsedBucketIndicesScratch: number[] = [];
  private animalMotionBucketsPopulated = false;
  private readonly nearbyAnimalCandidatesScratch: AnimalState[] = [];
  private readonly nearbyPredatorsScratch: AnimalState[] = [];
  private readonly structureBodiesScratch: MatterBody[] = [];
  private readonly predatorEscapeScratch: WaterEscapeVector = {
    x: 0,
    y: 0,
    stress: 0,
  };
  private refugeGaps: RefugeGap[] = [];
  private refugeGapsDirty = true;
  private spatialDebugEnabled = false;
  /**
   * Species ecology runs sequentially. Reuse these three flat workspaces so a
   * fast-forward tick does not allocate two filtered copies plus one spread
   * copy of the complete animal population for every species.
   */
  private readonly ecologySpeciesAnimalsScratch: AnimalState[] = [];
  private readonly ecologyLivingAnimalsScratch: AnimalState[] = [];
  private readonly ecologyNewbornAnimalsScratch: AnimalState[] = [];
  private readonly ecologyEatenAnimalIdsScratch = new Set<string>();
  private readonly shrimpMaintenanceRequestsScratch: number[] = [];
  private readonly shrimpEnvironmentalDeathCausesScratch: Array<
    ShrimpEnvironmentalDeathCause | null
  > = [];
  private readonly shrimpGrazingRequestsScratch: GrazingRequest[] = [];
  private readonly shrimpGrazingRequestsByCellScratch =
    new Map<string, GrazingRequest[]>();
  private readonly biofilmCellIndexByIdScratch = new Map<string, number>();
  private biofilmTransferSourceScratch = new Int32Array(0);
  private biofilmTransferReceiverScratch = new Int32Array(0);
  private biofilmTransferGuildScratch = new Uint8Array(0);
  private biofilmTransferAmountScratch = new Float64Array(0);
  private biofilmIncomingDemandScratch = new Float64Array(0);
  private biofilmOutgoingDemandScratch = new Float64Array(0);
  private growthOriginalScratch = new Float64Array(0);
  private growthNextScratch = new Float64Array(0);
  private growthRatesByCellScratch = new Float64Array(0);
  private growthPhysiologyByCellScratch = new Float64Array(0);
  private growthProductionRequestsByCellScratch = new Float64Array(0);
  private readonly growthCellIndexByIdScratch = new Map<string, number>();
  private readonly growthRecruitmentTransfersScratch: GrowthRecruitmentTransfer[] = [];
  private growthIncomingDemandScratch = new Float64Array(0);
  private growthOutgoingDemandScratch = new Float64Array(0);
  private readonly growthResourceFactorsScratch = new Float64Array(3);
  private readonly growthProductionsScratch = new Float64Array(3);
  private readonly growthRespirationRequestsScratch = new Float64Array(3);
  private readonly growthRespirationsScratch = new Float64Array(3);
  private readonly vallisneriaPhysiologySampleScratch: AlgaePhysiologyRates = {
    grossPhotosynthesis: 0,
    respiration: 0,
    lightStressTurnover: 0,
    netGrowth: 0,
  };
  private readonly vallisneriaPhysiologyTotalScratch: AlgaePhysiologyRates = {
    grossPhotosynthesis: 0,
    respiration: 0,
    lightStressTurnover: 0,
    netGrowth: 0,
  };
  private readonly vallisneriaLeavesScratch: VallisneriaLeafGeometry[] = [];
  private readonly vallisneriaCanopyPointsScratch: Vec2[] = [];
  private readonly vallisneriaCanopyLightsScratch = new Float64Array(32);
  private readonly vallisneriaCanopyProductionWeightsScratch =
    new Float64Array(32);
  private readonly vallisneriaLeafPointScratch: Vec2 = { x: 0, y: 0 };
  private readonly vallisneriaActivityPointScratch: Vec2 = { x: 0, y: 0 };
  private readonly vallisneriaUptakePointScratch: Vec2 = { x: 0, y: 0 };
  private readonly ricefishEggAttachmentPointScratch: Vec2 = { x: 0, y: 0 };
  private readonly vallisneriaCanopyBoundsScratch: VallisneriaCanopyBoundsState = {
    minX: 0,
    minY: 0,
    maxX: 0,
    maxY: 0,
  };
  private readonly vallisneriaPhysiologyRatesScratch = new Float64Array(
    ALGAE_PHYSIOLOGY_VALUE_COUNT,
  );
  private message = '목록에서 구조물과 생물을 꺼내 수조를 구성하세요.';

  public constructor(
    scenarioId: ScenarioId = 'mission-1',
    tankType?: TankTypeId,
    runSeed = 0,
  ) {
    this.initialize(scenarioId, tankType, runSeed);
  }

  public enableRicefishForagingDiagnostics(enabled = true): void {
    this.ricefishForagingDiagnostics = enabled ? new Map() : null;
  }

  public takeRicefishForagingDiagnostics():
    RicefishForagingDiagnosticSnapshot[] {
    if (!this.ricefishForagingDiagnostics) return [];
    const diagnostics = Array.from(
      this.ricefishForagingDiagnostics.values(),
      (entry) => ({ ...entry }),
    );
    this.ricefishForagingDiagnostics.clear();
    return diagnostics;
  }

  private ricefishForagingDiagnostic(
    fish: AnimalState,
  ): RicefishForagingDiagnosticSnapshot | null {
    const diagnostics = this.ricefishForagingDiagnostics;
    if (!diagnostics || fish.speciesId !== 'japanese-ricefish') return null;
    const existing = diagnostics.get(fish.id);
    if (existing) return existing;
    const created = emptyRicefishForagingDiagnostic(fish.id);
    diagnostics.set(fish.id, created);
    return created;
  }

  private recordRicefishTrackLoss(
    fish: AnimalState,
    reason: RicefishTrackLossReason,
  ): void {
    const diagnostic = this.ricefishForagingDiagnostic(fish);
    if (!diagnostic) return;
    if (reason === 'distance') diagnostic.targetLossDistance += 1;
    else if (reason === 'line-of-sight') {
      diagnostic.targetLossLineOfSight += 1;
    } else if (reason === 'refuge') {
      diagnostic.targetLossRefuge += 1;
    } else {
      diagnostic.targetLossDarkness += 1;
    }
  }

  public initialize(
    scenarioId: ScenarioId,
    tankType?: TankTypeId,
    runSeed = 0,
  ): void {
    // `initialize` can switch a live laboratory between long and standard
    // tanks. Clear used indices while they still address the old bucket arrays
    // before replacing those arrays with the new geometry.
    this.clearShrimpMotionBuckets();
    const resolvedTankType = tankType ??
      SCENARIOS[scenarioId].tankType ??
      (scenarioId === 'laboratory' ? this.tank.id : 'standard');
    this.tank = TANK_DEFINITIONS[resolvedTankType];
    this.structureSupportY = this.tank.groundY - 12;
    this.shrimpMotionBucketColumns = Math.ceil(
      this.tank.width / SHRIMP_MOTION_BUCKET_SIZE,
    );
    this.shrimpMotionBucketRows = Math.ceil(
      (this.tank.groundY - this.tank.waterTop) / SHRIMP_MOTION_BUCKET_SIZE,
    );
    this.shrimpMotionBucketsScratch = Array.from(
      {
        length: this.shrimpMotionBucketColumns * this.shrimpMotionBucketRows,
      },
      () => [],
    );
    this.ricefishMotionBucketsScratch = Array.from(
      {
        length: this.shrimpMotionBucketColumns * this.shrimpMotionBucketRows,
      },
      () => [],
    );
    this.daphniaMotionBucketsScratch = Array.from(
      {
        length: this.shrimpMotionBucketColumns * this.shrimpMotionBucketRows,
      },
      () => [],
    );
    this.vallisneriaShelterBucketColumns = Math.ceil(
      this.tank.width / VALLISNERIA_SHELTER_BUCKET_SIZE,
    );
    this.vallisneriaShelterBucketRows = Math.ceil(
      (this.tank.groundY - this.tank.waterTop) /
        VALLISNERIA_SHELTER_BUCKET_SIZE,
    );
    this.vallisneriaShelterBuckets = Array.from(
      {
        length:
          this.vallisneriaShelterBucketColumns *
          this.vallisneriaShelterBucketRows,
      },
      () => [],
    );
    this.animalMotionBucketsPopulated = false;
    this.ricefishForagingDiagnostics?.clear();
    this.scenario = SCENARIOS[scenarioId];
    this.runSeed = Math.trunc(runSeed) >>> 0;
    this.spatialDebugEnabled = false;
    this.engine = Engine.create({ enableSleeping: true });
    this.engine.gravity.x = 0;
    this.engine.gravity.y = 1;
    this.engine.gravity.scale = 0.0012;
    this.phase = 'setup';
    this.outcome = 'pending';
    this.outcomeAtSeconds = null;
    this.structures = [];
    this.substrateCells = this.createSubstrateCells();
    this.allCellsCacheDirty = true;
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
    this.pointer = { x: this.tank.width / 2, y: this.tank.waterTop + 120 };
    this.probe = null;
    this.measurements = [];
    this.selection = null;
    this.seedPlacements = [];
    this.clearShrimpMotionBuckets();
    this.animals = [];
    this.carcasses = [];
    this.animalPopulationEvents = [];
    this.animalPopulationEventTotals = emptyAnimalPopulationEventTotals();
    this.animalPopulationEventSequence = 0;
    this.totalAlgaeConsumed = 0;
    this.animalInventoryUsed = {
      'cherry-shrimp': 0,
      'japanese-ricefish': 0,
      daphnia: 0,
    };
    this.animalSexInventoryUsed = {
      'cherry-shrimp': { female: 0, male: 0 },
      'japanese-ricefish': { female: 0, male: 0 },
      daphnia: { female: 0, male: 0 },
    };
    this.microbeInventoryUsed = { decomposer: 0, nitrifier: 0 };
    this.planktonInventoryUsed = { phytoplankton: 0, daphnia: 0 };
    this.suspendedBiofilm = emptyBiofilm();
    this.biofilmSettlementCursor = 0;
    this.biofilmSettlementAttemptAccumulator = {
      decomposer: 0,
      nitrifier: 0,
    };
    this.materialReference = null;
    this.lightOutput = this.scenario.lightOutput;
    this.naturalLightOutput = this.scenario.naturalLightOutput;
    this.dayNightEnabled = this.scenario.dayNightCycleInitiallyEnabled;
    const initialDayNight = this.currentDayNightState();
    this.appliedDayNightMultiplier = initialDayNight?.lightMultiplier ?? 1;
    this.appliedDayNightPhase = initialDayNight?.phase ?? null;
    this.appliedDaylightAngleRadians = quantizedDaylightAngleRadians(
      daylightAngleRadians(initialDayNight),
    );
    // A tank is presented after its configured sources have already been on,
    // so begin near their well-mixed thermal equilibrium instead of making
    // every mission spend its short time limit warming from room temperature.
    this.waterTemperature = initialWaterTemperatureForLight(
      this.lightOutput + this.naturalLightOutput * this.appliedDayNightMultiplier,
    );
    this.biogeochemistry = new BiogeochemistryLedger({
      effectsEnabled: Boolean(this.scenario.waterCycle),
      initial: this.scenario.waterCycle?.initial,
      initialMaterialScale: this.scenario.waterCycle?.initialMaterialScale,
      initialTemperature: this.waterTemperature,
      columns: this.tank.waterColumns,
      rows: this.tank.waterRows,
      tankWidth: this.tank.width,
      waterTop: this.tank.waterTop,
      groundY: this.tank.groundY,
    });
    this.lightDirty = true;
    this.lightTransportDirty = true;
    this.daylightTransportDirty = true;
    this.canopyLightSignature = '';
    this.lightReflectionSources = [];
    this.lightTransportCache.clear();
    this.directDaylightCoefficientCache.clear();
    this.vallisneriaCanopyOptics = [];
    for (const bucket of this.vallisneriaShelterBuckets) bucket.length = 0;
    this.canopyTransmissionCache.clear();
    this.crossConnectionsDirty = true;
    this.refugeGapsDirty = true;
    this.message = '목록에서 구조물과 생물을 꺼내 수조를 구성하세요.';

    this.boundaries = [
      Bodies.rectangle(this.tank.width / 2, this.structureSupportY + 58, this.tank.width + 120, 116, {
        isStatic: true,
        label: 'boundary:ground',
        friction: 1,
      }),
      Bodies.rectangle(-30, this.tank.height / 2, 60, this.tank.height, {
        isStatic: true,
        label: 'boundary:left',
      }),
      Bodies.rectangle(this.tank.width + 30, this.tank.height / 2, 60, this.tank.height, {
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
        this.initialize(command.scenarioId, command.tankType, command.runSeed);
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
        this.initialize(
          this.scenario.id,
          this.tank.id,
          command.runSeed ?? this.runSeed,
        );
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
        this.pickAnimalFromInventory(command.speciesId, command.sex);
        break;
      case 'pick-biofilm':
        if (command.point) this.pointer = this.clampPointer(command.point);
        this.pickBiofilmFromInventory(command.guildId);
        break;
      case 'pick-plankton':
        if (command.point) this.pointer = this.clampPointer(command.point);
        this.pickPlanktonFromInventory(command.planktonKind);
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
          this.appliedDaylightAngleRadians = quantizedDaylightAngleRadians(
            daylightAngleRadians(state),
          );
          this.daylightTransportDirty = true;
          this.lightDirty = true;
          if (this.allSettled && !this.held) this.recomputeLight();
        }
        break;
      case 'set-spatial-debug':
        if (this.scenario.mode === 'laboratory') {
          this.spatialDebugEnabled = command.enabled;
          if (command.enabled && this.allSettled && !this.held) {
            this.rebuildRefugeGaps();
          }
          this.snapshotDirty = true;
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
      this.refugeGapsDirty = true;
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
          this.beginAmmoniumCompetition(growthStepSeconds);
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

  public snapshot(reuse?: SimulationSnapshot): SimulationSnapshot {
    this.refreshColonySelection();
    const target = reuse ?? {} as SimulationSnapshot;
    const cells = this.surfaceSnapshots(target.cells);
    const totalBiomass = target.totalBiomass ?? emptyBiomass();
    totalBiomass.oedogonium = 0;
    totalBiomass.nitzschia = 0;
    totalBiomass.vallisneria = 0;
    let eligibleCellCount = 0;
    let occupiedCellCount = 0;
    let decomposerBiofilm = 0;
    let nitrifierBiofilm = 0;
    for (const cell of cells) {
      totalBiomass.oedogonium += cell.biomass.oedogonium;
      totalBiomass.nitzschia += cell.biomass.nitzschia;
      totalBiomass.vallisneria += cell.biomass.vallisneria;
      decomposerBiofilm += cell.biofilm.decomposer;
      nitrifierBiofilm += cell.biofilm.nitrifier;
      if (!cell.targetEligible) continue;
      eligibleCellCount += 1;
      if (occupied(cell.biomass)) occupiedCellCount += 1;
    }
    const coverageRatio = eligibleCellCount
      ? occupiedCellCount / eligibleCellCount
      : 0;
    const missionProgress = this.missionProgress(coverageRatio, cells);
    const biogeochemistry = this.biogeochemistry.snapshot(target.biogeochemistry);
    biogeochemistry.biofilmTotals.decomposer = decomposerBiofilm;
    biogeochemistry.biofilmTotals.nitrifier = nitrifierBiofilm;
    const materialTotals = this.computeMaterialTotals();
    const reference = this.materialReference;
    const materialBalance = biogeochemistry.materialBalance;
    materialBalance.totalNitrogen = materialTotals.nitrogen;
    materialBalance.totalCarbon = materialTotals.carbon;
    materialBalance.oxygenEquivalent = materialTotals.oxygenEquivalent;
    materialBalance.referenceNitrogen = reference?.nitrogen ?? null;
    materialBalance.referenceCarbon = reference?.carbon ?? null;
    materialBalance.referenceOxygenEquivalent = reference?.oxygenEquivalent ?? null;
    materialBalance.nitrogenDriftRatio = reference && reference.nitrogen > 0
      ? (materialTotals.nitrogen - reference.nitrogen) / reference.nitrogen
      : 0;
    materialBalance.carbonDriftRatio = reference && reference.carbon > 0
      ? (materialTotals.carbon - reference.carbon) / reference.carbon
      : 0;
    materialBalance.oxygenEquivalentDriftRatio = reference &&
      Math.abs(reference.oxygenEquivalent) > 1e-9
      ? (materialTotals.oxygenEquivalent - reference.oxygenEquivalent) /
        Math.abs(reference.oxygenEquivalent)
      : 0;

    this.revision += 1;
    this.snapshotDirty = false;
    target.scenarioId = this.scenario.id;
    target.tank = this.tank;
    target.mode = this.scenario.mode;
    target.phase = this.phase;
    target.outcome = this.outcome;
    target.outcomeAtSeconds = this.outcomeAtSeconds;
    target.currentTargetMet = missionProgress
      ? missionProgress.current >= missionProgress.target
      : false;
    target.elapsedSeconds = this.elapsedSeconds;
    target.timeLimitSeconds = this.scenario.timeLimitSeconds;
    target.speed = this.speed;
    target.allSettled = this.allSettled;
    target.hasStarted = this.hasStarted;
    target.lightOutput = this.lightOutput;
    target.naturalLightOutput = this.naturalLightOutput;
    target.dayNightEnabled = this.dayNightEnabled;
    target.dayNight = this.currentDayNightSnapshot();
    target.waterTemperature = this.waterTemperature;
    target.structures = this.structureSnapshots(target.structures);
    target.cells = cells;
    target.seeds = this.seedSnapshots(target.seeds);
    target.plants = this.plantSnapshots(target.plants);
    target.animals = this.animalSnapshots(target.animals);
    target.carcasses = this.carcassSnapshots(target.carcasses);
    target.holding = this.holdingSnapshot();
    const lightField = target.lightField ?? {} as LightFieldSnapshot;
    lightField.columns = this.lightField.columns;
    lightField.rows = this.lightField.rows;
    lightField.values = copyNumericArray(this.lightField.values, lightField.values);
    lightField.revision = this.lightField.revision;
    target.lightField = lightField;
    target.probe = this.probe ? { ...this.probe, trends: { ...this.probe.trends } } : null;
    target.measurements = this.measurementSnapshots(target.measurements);
    target.selection = this.selection ? { ...this.selection } : null;

    target.remainingSeeds ??= {} as SimulationSnapshot['remainingSeeds'];
    target.remainingSeeds.oedogonium = this.remainingSeeds('oedogonium');
    target.remainingSeeds.nitzschia = this.remainingSeeds('nitzschia');
    target.remainingSeeds.vallisneria = this.remainingSeeds('vallisneria');
    target.remainingAnimals ??= {} as SimulationSnapshot['remainingAnimals'];
    target.remainingAnimals['cherry-shrimp'] = this.remainingAnimals('cherry-shrimp');
    target.remainingAnimals['japanese-ricefish'] = this.remainingAnimals('japanese-ricefish');
    target.remainingAnimals.daphnia = this.remainingAnimals('daphnia');
    target.remainingAnimalSexes ??= {};
    for (const speciesId of [
      'cherry-shrimp',
      'japanese-ricefish',
      'daphnia',
    ] as const) {
      if (!this.scenario.animalSexBudget?.[speciesId]) {
        delete target.remainingAnimalSexes[speciesId];
        continue;
      }
      target.remainingAnimalSexes[speciesId] = {
        female: this.remainingAnimalSex(speciesId, 'female'),
        male: this.remainingAnimalSex(speciesId, 'male'),
      };
    }
    target.remainingMicrobes ??= {} as SimulationSnapshot['remainingMicrobes'];
    target.remainingMicrobes.decomposer = this.remainingMicrobes('decomposer');
    target.remainingMicrobes.nitrifier = this.remainingMicrobes('nitrifier');
    target.remainingPlankton ??= {} as SimulationSnapshot['remainingPlankton'];
    target.remainingPlankton.phytoplankton = this.remainingPlankton('phytoplankton');
    target.remainingPlankton.daphnia = this.remainingPlankton('daphnia');
    target.remainingStructures ??= {} as SimulationSnapshot['remainingStructures'];
    target.remainingStructures['flat-stone'] = this.remainingStructures('flat-stone');
    target.remainingStructures['round-stone'] = this.remainingStructures('round-stone');
    target.remainingStructures['tall-stone'] = this.remainingStructures('tall-stone');
    target.remainingStructures['small-flat-stone'] =
      this.remainingStructures('small-flat-stone');
    target.remainingStructures['small-wedge-stone'] =
      this.remainingStructures('small-wedge-stone');
    const spatialDebug = target.spatialDebug ?? {
      enabled: false,
      gaps: [],
      agents: [],
    };
    spatialDebug.enabled = this.spatialDebugEnabled;
    if (this.spatialDebugEnabled && this.allSettled && !this.held) {
      this.rebuildRefugeGaps();
      for (let index = 0; index < this.refugeGaps.length; index += 1) {
        const source = this.refugeGaps[index];
        const gap = spatialDebug.gaps[index] ?? {
          id: '',
          x: 0,
          y: 0,
          clearance: 0,
          usableClearance: 0,
          first: { x: 0, y: 0 },
          second: { x: 0, y: 0 },
          structureIds: ['', ''],
        };
        gap.id = source.id;
        gap.x = source.point.x;
        gap.y = source.point.y;
        gap.clearance = source.clearance;
        gap.usableClearance = source.clearance * 0.84;
        gap.first.x = source.first.x;
        gap.first.y = source.first.y;
        gap.second.x = source.second.x;
        gap.second.y = source.second.y;
        gap.structureIds[0] = source.structureIds[0];
        gap.structureIds[1] = source.structureIds[1];
        spatialDebug.gaps[index] = gap;
      }
      spatialDebug.gaps.length = this.refugeGaps.length;
      for (let index = 0; index < this.animals.length; index += 1) {
        const source = this.animals[index];
        const agent = spatialDebug.agents[index] ?? {
          id: '',
          speciesId: 'cherry-shrimp',
          x: 0,
          y: 0,
          bodyThickness: 0,
        };
        agent.id = source.id;
        agent.speciesId = source.speciesId;
        agent.x = source.position.x;
        agent.y = source.position.y;
        agent.bodyThickness = this.animalBodyThickness(source);
        spatialDebug.agents[index] = agent;
      }
      spatialDebug.agents.length = this.animals.length;
    } else {
      spatialDebug.gaps.length = 0;
      spatialDebug.agents.length = 0;
    }
    target.spatialDebug = spatialDebug;
    target.totalBiomass = totalBiomass;
    target.totalAlgaeConsumed = this.totalAlgaeConsumed;

    target.animalPopulation ??= {} as SimulationSnapshot['animalPopulation'];
    target.animalPopulation['cherry-shrimp'] = this.animalPopulation(
      'cherry-shrimp',
      target.animalPopulation['cherry-shrimp'],
    );
    target.animalPopulation['japanese-ricefish'] = this.animalPopulation(
      'japanese-ricefish',
      target.animalPopulation['japanese-ricefish'],
    );
    target.animalPopulation.daphnia = this.animalPopulation(
      'daphnia',
      target.animalPopulation.daphnia,
    );

    const populationEvents = target.animalPopulationEvents ?? [];
    for (let index = 0; index < this.animalPopulationEvents.length; index += 1) {
      const event = this.animalPopulationEvents[index];
      const eventSnapshot = populationEvents[index] ??
        {} as AnimalPopulationEventSnapshot;
      const reusableWater = eventSnapshot.water;
      Object.assign(eventSnapshot, event);
      eventSnapshot.water = event.water
        ? Object.assign(reusableWater ?? {}, event.water)
        : null;
      populationEvents[index] = eventSnapshot;
    }
    populationEvents.length = this.animalPopulationEvents.length;
    target.animalPopulationEvents = populationEvents;

    const eventTotals = target.animalPopulationEventTotals ??
      emptyAnimalPopulationEventTotals();
    const deathsByCause = eventTotals.deathsByCause;
    eventTotals.introduced = this.animalPopulationEventTotals.introduced;
    eventTotals.removed = this.animalPopulationEventTotals.removed;
    eventTotals.births = this.animalPopulationEventTotals.births;
    eventTotals.hatches = this.animalPopulationEventTotals.hatches;
    eventTotals.maturations = this.animalPopulationEventTotals.maturations;
    eventTotals.deaths = this.animalPopulationEventTotals.deaths;
    Object.assign(deathsByCause, this.animalPopulationEventTotals.deathsByCause);
    target.animalPopulationEventTotals = eventTotals;
    target.biogeochemistry = biogeochemistry;
    target.coverageRatio = coverageRatio;
    target.missionProgress = missionProgress;
    target.message = this.message;
    target.revision = this.revision;
    return target;
  }

  /**
   * The 30 Hz binary channel needs only fields encoded by SharedMotionWriter.
   * Keep observational water, attachment, generation, and thermal calculations
   * on the one-second full snapshot path instead of repeating them for every
   * animal on every presentation sample.
   */
  public motionTransportSnapshot(reuse?: MotionSnapshotState): MotionSnapshotState {
    const target = reuse ?? {
      structures: [],
      animals: [],
      holding: null,
      probe: null,
    };
    target.structures = this.structureSnapshots(target.structures);
    target.animals = this.animalMotionSnapshots(target.animals);
    target.holding = this.holdingSnapshot();
    target.probe = this.probe ? { ...this.probe, trends: { ...this.probe.trends } } : null;
    return target;
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
      runSeed: this.runSeed,
      tankType: this.tank.id,
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
      animalSexInventoryUsed: Object.fromEntries(
        Object.entries(this.animalSexInventoryUsed).map(([speciesId, used]) => [
          speciesId,
          { ...used },
        ]),
      ),
      microbeInventoryUsed: { ...this.microbeInventoryUsed },
      suspendedBiofilm: { ...this.suspendedBiofilm },
      planktonInventoryUsed: { ...this.planktonInventoryUsed },
      biofilmSettlementCursor: this.biofilmSettlementCursor,
      biofilmSettlementAttemptAccumulator: {
        ...this.biofilmSettlementAttemptAccumulator,
      },
      materialReference: this.materialReference ? { ...this.materialReference } : null,
      biogeochemistry: this.biogeochemistry.exportSaveState(),
    };
  }

  public loadSaveData(data: SimulationSaveData): void {
    if (data.version !== 1) throw new Error('지원하지 않는 냉동 수조 형식입니다.');
    this.initialize(data.scenarioId, data.tankType, data.runSeed ?? 0);

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
    this.appliedDaylightAngleRadians = quantizedDaylightAngleRadians(
      daylightAngleRadians(restoredDayNight),
    );
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
    this.animals = data.animals.map((animal) => {
      const daphniaInstars = animal.maturationTargetInstars ??
        daphniaMaturationInstarTarget(animal.randomSeed);
      const daphniaMoltCount = animal.moltCount ?? (
        animal.speciesId === 'daphnia' && animal.lifeStage === 'adult'
          ? daphniaInstars
          : 0
      );
      const daphniaMoltSeconds = animal.moltCycleSeconds ?? (
        animal.speciesId === 'daphnia'
          ? animal.lifeStage === 'adult'
            ? daphniaAdultMoltCycleSeconds(
              animal.randomSeed,
              daphniaMoltCount,
            )
            : daphniaJuvenileMoltCycleSeconds(
              animal.randomSeed,
              daphniaInstars,
            )
          : 0
      );
      const shrimpCycleIndex = animal.reproductiveCycleIndex ?? 0;
      const shrimpCycleSeconds = shrimpOvarianCycleSeconds(
        animal.randomSeed,
        shrimpCycleIndex,
      );
      // Legacy saves may contain the former maturation-time-plus-adult-stage
      // deadline. All cherry shrimp now use one total-life deadline, so clamp
      // both supplied and born animals to the same 45-minute maximum.
      const restoredLifespanSeconds =
        animal.speciesId === 'cherry-shrimp'
          ? Math.min(
            animal.lifespanSeconds,
            SHRIMP_MAX_LIFESPAN_SECONDS,
          )
          : animal.lifespanSeconds;
      return cloneAnimalState({
        ...animal,
        lifespanSeconds: restoredLifespanSeconds,
        peakStructuralBiomass: animal.peakStructuralBiomass ?? (
          (
            animal.speciesId === 'japanese-ricefish' &&
            animal.lifeStage !== 'egg'
          ) ||
          animal.speciesId === 'cherry-shrimp'
            ? animal.structuralBiomass
            : undefined
        ),
        yolkBiomass: animal.speciesId === 'japanese-ricefish' &&
          animal.lifeStage === 'fry'
          ? clamp(
            animal.yolkBiomass ?? 0,
            0,
            Math.max(0, animal.storedBiomass),
          )
          : 0,
        reproductiveBiomass: animal.reproductiveBiomass ?? 0,
        maturationTargetSeconds: animal.maturationTargetSeconds ?? (
          animal.speciesId === 'cherry-shrimp'
            ? shrimpMaturationTargetSeconds(animal.randomSeed)
            : 0
        ),
        maturationTargetInstars: daphniaInstars,
        ovarianProgress: animal.ovarianProgress ?? (
          animal.speciesId === 'cherry-shrimp' &&
          animal.lifeStage === 'adult' &&
          animal.sex === 'female'
            ? clamp01(1 - animal.reproductionCooldown / shrimpCycleSeconds)
            : 0
        ),
        ovarianClutchSize:
          animal.speciesId === 'cherry-shrimp' &&
          animal.lifeStage === 'adult' &&
          animal.sex === 'female'
            ? clamp(
              Math.round(
                animal.ovarianClutchSize ??
                  shrimpClutchSizeForStructure(animal.structuralBiomass),
              ),
              SHRIMP_ECOLOGY_RULES.minimumClutchSize,
              SHRIMP_ECOLOGY_RULES.maximumClutchSize,
            )
            : undefined,
        reproductiveCycleIndex: shrimpCycleIndex,
        moltProgress: animal.moltProgress ?? (
          animal.speciesId === 'daphnia'
            ? clamp01(1 - animal.reproductionCooldown /
              Math.max(1, daphniaMoltSeconds))
            : 0
        ),
        moltCycleSeconds: daphniaMoltSeconds,
        moltCount: daphniaMoltCount,
        generation: animal.generation ?? 0,
        parentId: animal.parentId ?? null,
        targetAnimalId: animal.targetAnimalId ?? null,
        courtshipPartnerId: animal.courtshipPartnerId ?? null,
        strikeRecoveryUses: clamp(
          Math.floor(animal.strikeRecoveryUses ?? 0),
          0,
          1,
        ),
        pursuitEffort: clamp(
          animal.pursuitEffort ?? 0,
          0,
          RICEFISH_ECOLOGY_RULES.maximumContinuousPursuitEffort * 1.25,
        ),
        foragingPatchOrigin: animal.foragingPatchOrigin ?? null,
        foragingLastInspectionPosition:
          animal.foragingLastInspectionPosition ??
          animal.foragingPatchOrigin ??
          null,
        attachmentCellId: animal.attachmentCellId ?? null,
        incubationRemaining: animal.incubationRemaining ?? null,
        recentFood: animal.recentFood ?? null,
        grazingSessionSeconds: animal.grazingSessionSeconds ?? 0,
        recentGrazingCellId: animal.recentGrazingCellId ?? null,
        recentGrazingCellCooldown: Math.max(
          0,
          animal.recentGrazingCellCooldown ?? 0,
        ),
        gestatingBroodSize: animal.gestatingBroodSize ?? null,
      });
    });
    this.carcasses = [];
    for (const carcass of data.carcasses) {
      const lifetimeSeconds = animalCarcassLifetimeSeconds(carcass.speciesId);
      const ageSeconds = Number.isFinite(carcass.ageSeconds)
        ? Math.max(0, carcass.ageSeconds)
        : 0;
      // Old or malformed frozen-aquarium data must not resurrect an expired
      // corpse or turn one corrupt length into a screen-sized Daphnia.
      if (ageSeconds >= lifetimeSeconds) continue;
      const fallbackLength = fallbackCarcassBodyLength(
        carcass.speciesId,
        carcass.lifeStage,
      );
      const bodyLength = Number.isFinite(carcass.bodyLength)
        ? clamp(carcass.bodyLength, 1, maximumCarcassBodyLength(carcass.speciesId))
        : fallbackLength;
      this.carcasses.push({
        ...carcass,
        position: {
          x: Number.isFinite(carcass.position.x)
            ? clamp(carcass.position.x, 0, this.tank.width)
            : this.tank.width / 2,
          y: Number.isFinite(carcass.position.y)
            ? clamp(carcass.position.y, this.tank.waterTop, this.tank.groundY)
            : (this.tank.waterTop + this.tank.groundY) / 2,
        },
        facing: carcass.facing < 0 ? -1 : 1,
        poseAngle: Number.isFinite(carcass.poseAngle) ? carcass.poseAngle : 0,
        bodyLength,
        waterAtDeath: carcass.waterAtDeath ? { ...carcass.waterAtDeath } : null,
        temperatureAtDeath: carcass.temperatureAtDeath ?? null,
        ageSeconds,
      });
    }
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
      hatches: data.animalPopulationEventTotals.hatches ?? 0,
      deathsByCause: {
        ...data.animalPopulationEventTotals.deathsByCause,
        temperature: data.animalPopulationEventTotals.deathsByCause.temperature ?? 0,
        predation: data.animalPopulationEventTotals.deathsByCause.predation ?? 0,
      },
    };
    this.animalPopulationEventSequence = data.animalPopulationEventSequence;
    this.totalAlgaeConsumed = data.totalAlgaeConsumed;
    this.animalInventoryUsed = {
      'cherry-shrimp': data.animalInventoryUsed['cherry-shrimp'] ?? 0,
      'japanese-ricefish': data.animalInventoryUsed['japanese-ricefish'] ?? 0,
      daphnia: data.animalInventoryUsed.daphnia ?? 0,
    };
    const legacySexUsage = (speciesId: AnimalSpeciesId): Record<AnimalSex, number> => {
      const total = this.animalInventoryUsed[speciesId];
      return { female: Math.ceil(total / 2), male: Math.floor(total / 2) };
    };
    this.animalSexInventoryUsed = {
      'cherry-shrimp': {
        ...legacySexUsage('cherry-shrimp'),
        ...data.animalSexInventoryUsed?.['cherry-shrimp'],
      },
      'japanese-ricefish': {
        ...legacySexUsage('japanese-ricefish'),
        ...data.animalSexInventoryUsed?.['japanese-ricefish'],
      },
      daphnia: {
        ...legacySexUsage('daphnia'),
        ...data.animalSexInventoryUsed?.daphnia,
      },
    };
    this.microbeInventoryUsed = { ...data.microbeInventoryUsed };
    this.planktonInventoryUsed = {
      phytoplankton: data.planktonInventoryUsed?.phytoplankton ?? 0,
      daphnia: data.planktonInventoryUsed?.daphnia ?? 0,
    };
    this.suspendedBiofilm = { ...data.suspendedBiofilm };
    this.biofilmSettlementCursor = data.biofilmSettlementCursor;
    this.biofilmSettlementAttemptAccumulator = {
      decomposer:
        data.biofilmSettlementAttemptAccumulator?.decomposer ?? 0,
      nitrifier:
        data.biofilmSettlementAttemptAccumulator?.nitrifier ?? 0,
    };
    this.biogeochemistry.restoreSaveState(data.biogeochemistry, data.waterTemperature);
    if (
      !data.biogeochemistry.planktonicDecomposer &&
      this.suspendedBiofilm.decomposer > 0
    ) {
      this.biogeochemistry.addPlanktonicDecomposer(
        { x: this.tank.width / 2, y: (this.tank.waterTop + this.tank.groundY) / 2 },
        this.suspendedBiofilm.decomposer,
      );
    }
    this.suspendedBiofilm.decomposer = 0;
    const restoredPlankton = this.biogeochemistry.planktonState();
    if (
      !this.animals.some((animal) => animal.speciesId === 'daphnia') &&
      restoredPlankton.daphniaJuvenileBiomass +
        restoredPlankton.daphniaAdultBiomass > 1e-9
    ) {
      const totalBiomass = restoredPlankton.daphniaJuvenileBiomass +
        restoredPlankton.daphniaAdultBiomass;
      const count = Math.max(1, restoredPlankton.approximateDaphniaCount);
      for (let index = 0; index < count; index += 1) {
        const angle = index / count * Math.PI * 2;
        const animal = this.createAdultDaphniaState(
          `animal-${++this.animalCounter}`,
          {
            x: this.tank.width / 2 + Math.cos(angle) * Math.min(120, 12 * count),
            y: (this.tank.waterTop + this.tank.groundY) / 2 + Math.sin(angle) * 36,
          },
          index < Math.max(1, Math.round(
            count * restoredPlankton.daphniaFounderAdultBiomass /
              Math.max(1e-9, restoredPlankton.daphniaAdultBiomass),
          ))
            ? 'supplied'
            : 'born',
          index < Math.max(1, Math.round(
            count * restoredPlankton.daphniaFounderAdultBiomass /
              Math.max(1e-9, restoredPlankton.daphniaAdultBiomass),
          ))
            ? 0
            : 1,
          null,
          index,
        );
        const individualMass = totalBiomass / count;
        animal.structuralBiomass = Math.min(
          PLANKTON_ECOLOGY_RULES.daphnia.adultStructuralBiomass,
          individualMass * 0.72,
        );
        animal.storedBiomass = Math.max(
          0,
          individualMass - animal.structuralBiomass,
        );
        this.animals.push(animal);
      }
    }
    this.syncDaphniaIndividuals();
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
    this.pointer = { x: this.tank.width / 2, y: this.tank.waterTop + 120 };
    this.settleAccumulator = 0;
    this.physicsAccumulator = 0;
    this.growthAccumulator = 0;
    this.animalMotionAccumulator = 0;
    this.snapshotAccumulator = 0;
    this.revision = 0;
    this.crossConnectionsDirty = true;
    this.refugeGapsDirty = true;
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
    const suspended = this.suspendedBiofilm.nitrifier;
    const biologicalMatter = water.organicMatter + water.detritus +
      surfaceBiomass + animalBiomass + suspended +
      water.planktonicDecomposer + water.phytoplankton + water.daphnia;
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
    const sampled = sampleSubstrate(
      10,
      3,
      this.tank.width,
      this.tank.groundY,
    );
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
      worldPoint: { x: cell.x, y: cell.y },
      shrimpContactPoint: {
        x: clamp(cell.x, 18, this.tank.width - 18),
        y: clamp(cell.y, this.tank.waterTop + 18, this.tank.groundY - 16),
      },
      worldTransformX: cell.x,
      worldTransformY: cell.y,
      worldTransformAngle: 0,
      shrimpContactSourceX: cell.x,
      shrimpContactSourceY: cell.y,
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
        worldPoint: { x: 0, y: 0 },
        shrimpContactPoint: { x: 0, y: 0 },
        worldTransformX: Number.NaN,
        worldTransformY: Number.NaN,
        worldTransformAngle: Number.NaN,
        shrimpContactSourceX: Number.NaN,
        shrimpContactSourceY: Number.NaN,
      })),
    };
    this.structures.push(structure);
    this.allCellsCacheDirty = true;
    Composite.add(this.engine.world, body);
    this.crossConnectionsDirty = true;
    this.refugeGapsDirty = true;
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
    if (
      !this.canPlaceInventorySeed() ||
      this.held ||
      !this.scenario.allowedSpecies.includes(speciesId)
    ) return;
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

  private pickAnimalFromInventory(
    speciesId: AnimalSpeciesId,
    requestedSex?: AnimalSex,
  ): void {
    if (
      !this.canPlaceInventoryAnimal() ||
      this.held ||
      !this.scenario.allowedAnimals.includes(speciesId)
    ) return;
    const remaining = this.remainingAnimals(speciesId);
    if (remaining !== null && remaining <= 0) {
      this.message = `지급된 ${ANIMALS[speciesId].displayName}는 모두 수조에 방류했습니다.`;
      return;
    }
    const sexBudget = this.scenario.animalSexBudget?.[speciesId];
    const sex = requestedSex ?? (sexBudget
      ? (this.remainingAnimalSex(speciesId, 'female') ?? 0) > 0
        ? 'female'
        : 'male'
      : undefined);
    if (sex && sexBudget) {
      const remainingForSex = this.remainingAnimalSex(speciesId, sex);
      if (remainingForSex !== null && remainingForSex <= 0) {
        const sexLabel = sex === 'female' ? '암컷' : '수컷';
        this.message = `지급된 ${ANIMALS[speciesId].displayName} ${sexLabel}은 모두 방류했습니다.`;
        return;
      }
    }
    const position = this.clampAnimalPoint(this.pointer);
    this.held = {
      kind: 'animal',
      source: 'inventory',
      speciesId,
      sex,
      animalId: `animal-${++this.animalCounter}`,
      position,
      valid: true,
    };
    this.pointer = position;
    this.selection = null;
    const sexLabel = sex ? ` ${sex === 'female' ? '암컷' : '수컷'}` : '';
    this.message = `${ANIMALS[speciesId].displayName}${sexLabel}가 커서에 붙었습니다. 수중의 원하는 위치에 놓으세요.`;
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

  private pickPlanktonFromInventory(planktonKind: PlanktonKind): void {
    if (
      !this.canEdit() ||
      this.held ||
      !this.scenario.allowedPlankton.includes(planktonKind)
    ) return;
    const remaining = this.remainingPlankton(planktonKind);
    if (remaining !== null && remaining <= 0) {
      this.message = '이 부유 생물 접종체는 모두 사용했습니다.';
      return;
    }
    const position = this.clampAnimalPoint(this.pointer);
    this.held = {
      kind: 'plankton',
      source: 'inventory',
      planktonKind,
      position,
      valid: this.isAnimalPlacementPoint(position),
    };
    this.pointer = position;
    this.selection = null;
    this.message = planktonKind === 'phytoplankton'
      ? '식물플랑크톤 접종체가 커서에 붙었습니다. 수중에 방류하세요.'
      : '큰물벼룩 성체 한 마리가 커서에 붙었습니다. 수중에 놓으세요.';
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

    const animalHit = this.nearestAnimalHit(this.pointer);
    if (animalHit) {
      const animal = animalHit.animal;
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
    const structureAtPoint = filter === 'structure' || filter === 'all'
      ? this.structureAtPoint(exact)
      : undefined;
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
      const animalHit = this.nearestAnimalHit(exact);
      const carcassHit = this.nearestCarcassHit(exact);
      const selectedAnimalHit = Boolean(
        animalHit &&
        this.selection?.kind === 'animal' &&
        this.selection.animalId === animalHit.animal.id,
      );
      const selectedCarcassHit = Boolean(
        carcassHit &&
        this.selection?.kind === 'carcass' &&
        this.selection.carcassId === carcassHit.carcass.id,
      );
      // Dense blooms can put a living Daphnia directly over a corpse. Prefer
      // the corpse on an exact tie, and cycle between the two on repeated
      // clicks so neither target becomes permanently unreachable.
      if (
        animalHit &&
        (
          !carcassHit ||
          selectedCarcassHit ||
          (!selectedAnimalHit && animalHit.score < carcassHit.score)
        )
      ) {
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
        const { carcass, visualPoint } = carcassHit;
        this.selection = {
          kind: 'carcass',
          ...visualPoint,
          ownerLabel: `${ANIMALS[carcass.speciesId].displayName} · 죽은 개체`,
          carcassId: carcass.id,
        };
        this.message = `${ANIMALS[carcass.speciesId].displayName}의 사체를 선택했습니다.`;
        return;
      }
      const plantHit = this.nearestVallisneria(exact);
      const plantCell = plantHit ? this.cellById(plantHit.placement.cellId) : undefined;
      const plantRoot = plantHit && plantCell
        ? this.vallisneriaRootPosition(plantHit.placement, plantCell)
        : undefined;
      // In open water a small allowance keeps thin leaves practical to click.
      // Over a structure, only the actually painted front ribbon may win; a
      // back-layer leaf is visually occluded and must not intercept the stone.
      const plantHitTolerance = structureAtPoint ? 2 : 10;
      const plantIsVisibleAtPoint = Boolean(
        plantHit &&
        plantCell &&
        plantRoot &&
        plantHit.distance <= plantHitTolerance &&
        (
          filter === 'organism' ||
          !structureAtPoint ||
          vallisneriaRenderDepth(plantRoot) === 'front'
        )
      );
      if (plantHit && plantCell && plantIsVisibleAtPoint) {
        this.selection = {
          kind: 'colony',
          ...exact,
          ownerLabel: '나사말 포기',
          cellId: plantCell.id,
          plantId: plantHit.placement.id,
          speciesId: 'vallisneria',
          speciesIds: ['vallisneria'],
          microbeGuildIds: [],
        };
        this.message = '나사말 포기를 선택했습니다. 잎·저장량·러너 상태를 관찰할 수 있습니다.';
        return;
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
      if (structureAtPoint) {
        this.selection = {
          kind: 'structure',
          x: structureAtPoint.body.position.x,
          y: structureAtPoint.body.position.y,
          ownerLabel: STRUCTURES[structureAtPoint.definitionId].label,
          structureId: structureAtPoint.id,
        };
        this.message = `${STRUCTURES[structureAtPoint.definitionId].label}을 선택했습니다.`;
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
        cell.biomass.vallisneria > VALLISNERIA_VISIBLE_BIOMASS)
      : undefined;
    const speciesId = activePlant
      ? 'vallisneria'
      : selection.speciesId && speciesIds.includes(selection.speciesId)
        ? selection.speciesId
        : [...speciesIds].sort((first, second) =>
          cell.biomass[second] - cell.biomass[first])[0];
    // Keep the marker where the user actually clicked. Moving it to the root
    // on every snapshot made a correct leaf click look like an offset hit.
    const point = activePlant
      ? { x: selection.x, y: selection.y }
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
        if (!cell || cell.biomass.vallisneria <= VALLISNERIA_VISIBLE_BIOMASS) return [];
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
    } else if (this.held.kind === 'animal') {
      this.held.position = this.clampAnimalPoint(this.pointer);
      this.held.valid = this.isAnimalPlacementPoint(this.held.position);
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
          ? `${ANIMALS[held.speciesId].displayName}는 수면 아래와 바닥 위의 수중에 놓아야 합니다.`
        : held.kind === 'biofilm'
          ? '균 필름은 돌의 보이는 앞면이나 바닥재 표면에 접종해야 합니다.'
        : held.kind === 'plankton'
          ? '부유 생물은 수면 아래와 바닥 위의 물속에 방류해야 합니다.'
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
      this.refugeGapsDirty = true;
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
          heldAnimal.sex,
        );
      this.animals.push(restored);
      if (heldAnimal.source === 'inventory') {
        this.animalInventoryUsed[heldAnimal.speciesId] += 1;
        this.animalSexInventoryUsed[heldAnimal.speciesId][restored.sex] += 1;
        if (this.hasStarted) this.recordAnimalPopulationEvent('introduced', restored);
        if (
          this.hasStarted &&
          this.scenario.mode === 'challenge' &&
          this.materialReference
        ) {
          const added = restored.structuralBiomass +
            restored.storedBiomass +
            restored.reproductiveBiomass;
          this.materialReference.nitrogen +=
            added * WATER_CYCLE_RULES.biomassNitrogen;
          this.materialReference.carbon +=
            added * WATER_CYCLE_RULES.biomassCarbon;
          this.materialReference.oxygenEquivalent -=
            added * WATER_CYCLE_RULES.biomassCarbon *
            WATER_CYCLE_RULES.oxygenPerOrganicCarbon;
        }
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

    if (this.held.kind === 'plankton') {
      const heldPlankton = this.held;
      let added = 0;
      if (heldPlankton.planktonKind === 'daphnia') {
        const rules = PLANKTON_ECOLOGY_RULES.daphnia;
        const founders: AnimalState[] = [];
        for (let index = 0; index < rules.foundersPerInoculum; index += 1) {
          const angle = index / rules.foundersPerInoculum * Math.PI * 2;
          const radius = rules.foundersPerInoculum === 1
            ? 0
            : 8 + index % 3 * 5;
          const founder = this.createAdultDaphniaState(
            `animal-${++this.animalCounter}`,
            this.clampDaphniaPoint({
              x: heldPlankton.position.x + Math.cos(angle) * radius,
              y: heldPlankton.position.y + Math.sin(angle) * radius,
            }),
            'supplied',
            0,
            null,
            this.planktonInventoryUsed.daphnia *
              rules.foundersPerInoculum + index,
          );
          founders.push(founder);
          added += founder.structuralBiomass + founder.storedBiomass;
        }
        this.animals.push(...founders);
        for (const founder of founders) {
          if (this.hasStarted) this.recordAnimalPopulationEvent('introduced', founder);
        }
        this.syncDaphniaIndividuals();
      } else {
        added = this.biogeochemistry.addPlankton(
          heldPlankton.position,
          'phytoplankton',
          PLANKTON_ECOLOGY_RULES.inoculum.phytoplanktonBiomass,
        );
      }
      if (added <= 0) {
        this.message = '이 위치에는 접종체가 퍼질 물 공간이 부족합니다.';
        return;
      }
      this.planktonInventoryUsed[heldPlankton.planktonKind] += 1;
      if (
        this.hasStarted &&
        this.scenario.mode === 'challenge' &&
        this.materialReference
      ) {
        this.materialReference.nitrogen += added * WATER_CYCLE_RULES.biomassNitrogen;
        this.materialReference.carbon += added * WATER_CYCLE_RULES.biomassCarbon;
        this.materialReference.oxygenEquivalent -=
          added * WATER_CYCLE_RULES.biomassCarbon *
          WATER_CYCLE_RULES.oxygenPerOrganicCarbon;
      }
      this.held = null;
      this.message = heldPlankton.planktonKind === 'phytoplankton'
        ? '식물플랑크톤을 물기둥에 접종했습니다.'
        : '큰물벼룩 한 마리를 물기둥에 방류했습니다.';
      this.snapshotDirty = true;
      return;
    }

    const heldSeed = this.held;
    const cellId = heldSeed.candidateCellId;
    const cell = cellId ? this.cellById(cellId) : undefined;
    if (!cell || !cellId) return;
    const suppliedBiomass = this.seedInoculumBiomass(heldSeed.speciesId);
    const previousBiomass = cell.biomass[heldSeed.speciesId];
    cell.biomass[heldSeed.speciesId] = Math.max(
      previousBiomass,
      suppliedBiomass,
    );
    const addedBiomass = cell.biomass[heldSeed.speciesId] - previousBiomass;
    if (
      addedBiomass > 0 &&
      this.hasStarted &&
      this.scenario.mode === 'challenge' &&
      this.materialReference
    ) {
      this.materialReference.nitrogen +=
        addedBiomass * WATER_CYCLE_RULES.biomassNitrogen;
      this.materialReference.carbon +=
        addedBiomass * WATER_CYCLE_RULES.biomassCarbon;
      this.materialReference.oxygenEquivalent -=
        addedBiomass * WATER_CYCLE_RULES.biomassCarbon *
        WATER_CYCLE_RULES.oxygenPerOrganicCarbon;
    }
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
      if (origin) {
        origin.biomass[this.held.speciesId] = this.held.originBiomass ??
          this.seedInoculumBiomass(this.held.speciesId);
      }
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
        this.animalSexInventoryUsed[this.held.speciesId][this.held.originState.sex] =
          Math.max(
            0,
            this.animalSexInventoryUsed[this.held.speciesId][this.held.originState.sex] - 1,
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
      this.animalSexInventoryUsed[animal.speciesId][animal.sex] = Math.max(
        0,
        this.animalSexInventoryUsed[animal.speciesId][animal.sex] - 1,
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
    this.allCellsCacheDirty = true;
    if (this.selection?.kind === 'structure' && this.selection.structureId === structure.id) {
      this.selection = null;
    }
    this.lightDirty = true;
    this.lightTransportDirty = true;
    this.crossConnectionsDirty = true;
    this.refugeGapsDirty = true;
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
    this.refugeGapsDirty = true;
    this.message = `${STRUCTURES[structure.definitionId].label}을 회전했습니다. 접점에 따라 다시 안착합니다.`;
    this.snapshotDirty = true;
  }

  private constrainHeldStructure(structure: StructureState): void {
    const padding = 5;
    const bounds = structure.body.bounds;
    let dx = 0;
    let dy = 0;
    if (bounds.min.x < padding) dx = padding - bounds.min.x;
    if (bounds.max.x > this.tank.width - padding) dx = this.tank.width - padding - bounds.max.x;
    if (bounds.min.y < this.tank.waterTop + padding) dy = this.tank.waterTop + padding - bounds.min.y;
    if (bounds.max.y > this.structureSupportY - padding) {
      dy = this.structureSupportY - padding - bounds.max.y;
    }
    if (dx || dy) Body.translate(structure.body, { x: dx, y: dy });
  }

  private updateHeldStructureValidity(structure: StructureState): void {
    if (!this.held || this.held.kind !== 'structure') return;
    const bounds = structure.body.bounds;
    const inTank =
      bounds.min.x >= 2 &&
      bounds.max.x <= this.tank.width - 2 &&
      bounds.min.y >= this.tank.waterTop + 2 &&
      bounds.max.y <= this.structureSupportY - 2;
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
        x: clamp(point.x, 2, this.tank.width - 2),
        y: clamp(
          point.y,
          this.tank.groundY - nearest.cell.cellSize * 3 + 1,
          this.tank.groundY - 1,
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

  private canPlaceInventoryAnimal(): boolean {
    return this.canEdit() ||
      (
        (
          this.scenario.id === 'mission-4' ||
          this.scenario.id === 'mission-5' ||
          this.scenario.id === 'mission-8'
        ) &&
        this.phase === 'paused'
      );
  }

  private canPlaceInventorySeed(): boolean {
    return this.canEdit() ||
      (
        (this.scenario.id === 'mission-4' || this.scenario.id === 'mission-5') &&
        this.phase === 'paused'
      );
  }

  private canInoculateBiofilm(): boolean {
    if (!this.scenario.waterCycle) return false;
    if (this.phase === 'setup') return true;
    return this.phase === 'paused';
  }

  private canPlaceHeld(held: HeldState): boolean {
    if (held.kind === 'biofilm') return this.canInoculateBiofilm();
    if (held.kind === 'seed') {
      return held.source === 'inventory'
        ? this.canPlaceInventorySeed()
        : this.canEdit();
    }
    if (held.kind === 'animal') {
      return held.source === 'inventory'
        ? this.canPlaceInventoryAnimal()
        : this.canEdit();
    }
    return this.canEdit();
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
      : this.scenario.id === 'mission-4'
        ? '일시정지됨 · 남겨 둔 조류나 새우를 수조에 추가할 수 있습니다.'
      : this.scenario.id === 'mission-5'
        ? '일시정지됨 · 남겨 둔 조류·새우를 추가하거나 균 필름을 접종할 수 있습니다.'
      : this.scenario.id === 'mission-8'
        ? '일시정지됨 · 남겨 둔 동물을 수조에 추가하거나 균 필름을 접종할 수 있습니다.'
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

  private seedInoculumBiomass(speciesId: SpeciesId): number {
    if (speciesId === 'vallisneria') return VALLISNERIA_SEED_BIOMASS;
    return SURFACE_ALGAE_INOCULUM_BIOMASS;
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

  private remainingAnimalSex(
    speciesId: AnimalSpeciesId,
    sex: AnimalSex,
  ): number | null {
    const budget = this.scenario.animalSexBudget?.[speciesId]?.[sex];
    if (budget === undefined) return 0;
    if (budget === null) return null;
    const held = this.held?.kind === 'animal' &&
      this.held.source === 'inventory' &&
      this.held.speciesId === speciesId &&
      this.held.sex === sex
      ? 1
      : 0;
    return Math.max(
      0,
      budget - this.animalSexInventoryUsed[speciesId][sex] - held,
    );
  }

  private remainingMicrobes(guildId: MicrobeGuildId): number | null {
    if (!this.scenario.waterCycle) return 0;
    const budget = this.scenario.waterCycle.microbeBudget[guildId];
    if (budget === null) return null;
    const held = this.held?.kind === 'biofilm' && this.held.guildId === guildId ? 1 : 0;
    return Math.max(0, budget - this.microbeInventoryUsed[guildId] - held);
  }

  private remainingPlankton(planktonKind: PlanktonKind): number | null {
    const budget = this.scenario.planktonBudget[planktonKind];
    if (budget === null) return null;
    const held = this.held?.kind === 'plankton' &&
      this.held.planktonKind === planktonKind
      ? 1
      : 0;
    return Math.max(
      0,
      budget - this.planktonInventoryUsed[planktonKind] - held,
    );
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
      plankton: this.biogeochemistry.planktonAt(measuredPoint),
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

  private measurementSnapshots(reuse?: MeasurementSnapshot[]): MeasurementSnapshot[] {
    const snapshots = reuse ?? [];
    for (let index = 0; index < this.measurements.length; index += 1) {
      const measurement = this.measurements[index];
      const snapshot = snapshots[index] ?? {} as MeasurementSnapshot;
      Object.assign(snapshot, this.measureAt(measurement.point));
      snapshot.id = measurement.id;
      snapshot.kind = measurement.kind;
      snapshots[index] = snapshot;
    }
    snapshots.length = this.measurements.length;
    return snapshots;
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
   * Brightness and solar direction are continuous, but the expensive
   * occlusion field only needs perceptually meaningful steps. Phase edges are
   * always exact; the 4% brightness and 2-degree direction thresholds bound
   * chemistry error while avoiding a complete ray-field rebuild every tick.
   */
  private updateDayNightLighting(): void {
    const state = this.currentDayNightState();
    const multiplier = state?.lightMultiplier ?? 1;
    const angle = quantizedDaylightAngleRadians(
      daylightAngleRadians(state),
    );
    const crossedPhaseEdge = (state?.phase ?? null) !== this.appliedDayNightPhase;
    const directionalDaylightVisible = state?.phase !== 'night';
    const angleChanged = directionalDaylightVisible && (
      Math.abs(angle - this.appliedDaylightAngleRadians) >=
        DAYLIGHT_ANGLE_RECOMPUTE_STEP ||
      (
        crossedPhaseEdge &&
        Math.abs(angle - this.appliedDaylightAngleRadians) > 1e-9
      )
    );
    if (
      Math.abs(multiplier - this.appliedDayNightMultiplier) >= 0.04 ||
      crossedPhaseEdge ||
      angleChanged
    ) {
      this.appliedDayNightMultiplier = multiplier;
      this.appliedDayNightPhase = state?.phase ?? null;
      if (angleChanged) {
        this.appliedDaylightAngleRadians = angle;
        this.daylightTransportDirty = true;
      }
      this.lightDirty = true;
    }
  }

  private effectiveNaturalLightOutput(): number {
    return this.naturalLightOutput * this.appliedDayNightMultiplier;
  }

  private diffuseNaturalLightOutput(): number {
    if (!this.dayNightEnabled || !this.scenario.dayNightCycle) return 0;
    return this.naturalLightOutput *
      clamp(this.scenario.dayNightCycle.nightLightMultiplier, 0, 1);
  }

  private directNaturalLightOutput(): number {
    return Math.max(
      0,
      this.effectiveNaturalLightOutput() -
        this.diffuseNaturalLightOutput(),
    );
  }

  private recomputeLight(): void {
    const transportChanged = this.lightTransportDirty;
    const daylightTransportChanged =
      transportChanged || this.daylightTransportDirty;
    if (transportChanged) {
      this.lightEmitters = this.buildLightEmitters();
      this.lightReflectionSources = this.buildLightReflectionSources();
      this.lightTransportCache.clear();
    } else if (daylightTransportChanged) {
      this.lightEmitters = this.buildLightEmitters();
      this.refreshDirectDaylightReflectionSources();
    }
    if (transportChanged) {
      this.directDaylightCoefficientCache.clear();
    }
    const nextCanopySignature = this.currentCanopyLightSignature();
    if (nextCanopySignature !== this.canopyLightSignature) {
      this.rebuildVallisneriaCanopyOptics();
      this.canopyTransmissionCache.clear();
    }
    const values: number[] = [];
    for (let row = 0; row < this.tank.waterRows; row += 1) {
      for (let column = 0; column < this.tank.waterColumns; column += 1) {
        values.push(this.lightAtWithCanopy({
          x: ((column + 0.5) / this.tank.waterColumns) * this.tank.width,
          y: this.tank.waterTop + ((row + 0.5) / this.tank.waterRows) * (this.tank.groundY - this.tank.waterTop),
        }, undefined, true));
      }
    }
    this.lightRevision += 1;
    this.lightField = {
      columns: this.tank.waterColumns,
      rows: this.tank.waterRows,
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
    this.daylightTransportDirty = false;
    this.canopyLightSignature = nextCanopySignature;
    this.snapshotDirty = true;
  }

  private buildLightEmitters(): LightEmitter[] {
    return [
      {
        id: 'ceiling-lamp',
        geometry: 'area-source',
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
        geometry: 'parallel-rays',
        samples: [],
        emissionScale: NATURAL_LIGHT_SCALE,
        angleRadians: this.appliedDaylightAngleRadians,
        // The direct daylight field is a tank-width-independent bundle of
        // parallel rays. A small residual transmission softens daytime stone
        // shadows; the truly directionless night/sky remainder is transported
        // separately and never borrows this beam direction.
        occludedTransmission: 0.06,
      },
    ];
  }

  private emitterLightCoefficientAt(
    emitter: LightEmitter,
    point: Vec2,
    occluders: MatterBody[],
  ): number {
    const depth = Math.max(0, point.y - this.tank.waterTop);
    const waterAttenuation = Math.exp(-depth * 0.00072);
    if (emitter.geometry === 'parallel-rays') {
      const sourceY = this.tank.waterTop - 12;
      const verticalSpan = Math.max(1, point.y - sourceY);
      const sourcePoint = {
        x: point.x -
          Math.tan(emitter.angleRadians ?? 0) * verticalSpan,
        y: sourceY,
      };
      const clear =
        Query.ray(occluders, sourcePoint, point, 1.1).length === 0;
      return emitter.emissionScale * waterAttenuation *
        (clear ? 1 : emitter.occludedTransmission);
    }
    if (emitter.samples.length === 0) return 0;
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
        directDaylightCoefficient: incident.daylight,
      };
    });
  }

  private refreshDirectDaylightReflectionSources(): void {
    const daylightEmitter = this.lightEmitters.find(
      (emitter) => emitter.id === 'daylight',
    );
    if (!daylightEmitter) return;
    const activeStructures = this.structures.filter(
      (structure) => !this.isHeldStructure(structure.id),
    );
    for (const source of this.lightReflectionSources) {
      const blockers = activeStructures
        .filter((structure) => structure.body.id !== source.bodyId)
        .map((structure) => structure.body);
      source.directDaylightCoefficient = this.emitterLightCoefficientAt(
        daylightEmitter,
        source.point,
        blockers,
      );
    }
  }

  private directDaylightCoefficientAt(
    point: Vec2,
    excludedBodyId?: number,
    cache = false,
  ): number {
    const key = `${point.x}:${point.y}:${excludedBodyId ?? 'water'}`;
    const angleKey = Math.round(
      this.appliedDaylightAngleRadians /
        DAYLIGHT_ANGLE_RECOMPUTE_STEP,
    );
    let angleCache = this.directDaylightCoefficientCache.get(angleKey);
    if (cache) {
      const cached = angleCache?.get(key);
      if (cached !== undefined) return cached;
    }
    const daylightEmitter = this.lightEmitters.find(
      (emitter) => emitter.id === 'daylight',
    );
    if (!daylightEmitter) return 0;
    const occluders = this.structures
      .filter((structure) =>
        structure.body.id !== excludedBodyId &&
        !this.isHeldStructure(structure.id))
      .map((structure) => structure.body);
    const coefficient = this.emitterLightCoefficientAt(
      daylightEmitter,
      point,
      occluders,
    );
    if (cache) {
      if (!angleCache) {
        angleCache = new Map<string, number>();
        this.directDaylightCoefficientCache.set(angleKey, angleCache);
      }
      angleCache.set(key, coefficient);
    }
    return coefficient;
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
    const lampEmitter = this.lightEmitters.find(
      (emitter) => emitter.id === 'ceiling-lamp',
    );
    const lampCoefficient = lampEmitter
      ? this.emitterLightCoefficientAt(lampEmitter, point, occluders)
      : 0;
    const depth = Math.max(0, point.y - this.tank.waterTop);
    let skyExposure = 0;
    for (let index = 0; index < AMBIENT_SKY_SAMPLES; index += 1) {
      const skyPoint = {
        x: ((index + 0.5) / AMBIENT_SKY_SAMPLES) * this.tank.width,
        y: this.tank.waterTop - 12,
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
      lampCoefficient,
      skyAmbientCoefficient: NATURAL_LIGHT_SCALE * ambientTransport,
      reflections,
    };
    if (cache) this.lightTransportCache.set(key, path);
    return path;
  }

  private evaluateLightTransport(
    path: LightTransportPath,
    directDaylightCoefficient: number,
  ): number {
    const directDaylightOutput = this.directNaturalLightOutput();
    const skyAmbientOutput = this.diffuseNaturalLightOutput();
    let reflected = 0;
    for (const reflection of path.reflections) {
      const incident =
        reflection.source.lampCoefficient * this.lightOutput +
        reflection.source.directDaylightCoefficient *
          directDaylightOutput;
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
      directDaylightCoefficient * directDaylightOutput +
      path.skyAmbientCoefficient * skyAmbientOutput +
      reflected,
      0,
      100,
    );
  }

  private lightAt(point: Vec2, excludedBodyId?: number, cache = false): number {
    return this.evaluateLightTransport(
      this.lightTransportPathAt(point, excludedBodyId, cache),
      this.directDaylightCoefficientAt(point, excludedBodyId, cache),
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
      if (!cell || cell.biomass.vallisneria <= VALLISNERIA_VISIBLE_BIOMASS) return [];
      const anchor = this.vallisneriaRootPosition(placement, cell);
      const scale = placement.plant.structuralScale;
      return [{
        plantId: placement.id,
        bounds: vallisneriaCanopyBounds(cell.index, anchor, scale),
        structuralScale: scale,
        leafOpticalDepth: 0.035 + scale * 0.028,
        leafSamples: vallisneriaLeaves(cell.index, anchor, scale).map((leaf) =>
          Array.from({ length: 7 }, (_, index) =>
            vallisneriaLeafPoint(leaf, (index + 1) / 8)
          )
        ),
      }];
    });
    for (const bucket of this.vallisneriaShelterBuckets) bucket.length = 0;
    for (const canopy of this.vallisneriaCanopyOptics) {
      const minColumn = clamp(
        Math.floor(
          (canopy.bounds.minX - 16) / VALLISNERIA_SHELTER_BUCKET_SIZE,
        ),
        0,
        this.vallisneriaShelterBucketColumns - 1,
      );
      const maxColumn = clamp(
        Math.floor(
          (canopy.bounds.maxX + 16) / VALLISNERIA_SHELTER_BUCKET_SIZE,
        ),
        0,
        this.vallisneriaShelterBucketColumns - 1,
      );
      const minRow = clamp(
        Math.floor(
          (canopy.bounds.minY - 12 - this.tank.waterTop) /
            VALLISNERIA_SHELTER_BUCKET_SIZE,
        ),
        0,
        this.vallisneriaShelterBucketRows - 1,
      );
      const maxRow = clamp(
        Math.floor(
          (canopy.bounds.maxY + 18 - this.tank.waterTop) /
            VALLISNERIA_SHELTER_BUCKET_SIZE,
        ),
        0,
        this.vallisneriaShelterBucketRows - 1,
      );
      for (let row = minRow; row <= maxRow; row += 1) {
        for (let column = minColumn; column <= maxColumn; column += 1) {
          this.vallisneriaShelterBuckets[
            row * this.vallisneriaShelterBucketColumns + column
          ].push(canopy);
        }
      }
    }
  }

  private currentCanopyLightSignature(): string {
    return this.seedPlacements
      .filter((placement) => placement.speciesId === 'vallisneria' && placement.plant)
      .map((placement) => {
        const cell = this.cellById(placement.cellId);
        const alive = cell &&
          cell.biomass.vallisneria > VALLISNERIA_VISIBLE_BIOMASS;
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

  private clearShrimpMotionBuckets(): void {
    for (const index of this.shrimpMotionUsedBucketIndicesScratch) {
      this.shrimpMotionBucketsScratch[index].length = 0;
    }
    this.shrimpMotionUsedBucketIndicesScratch.length = 0;
    for (const index of this.ricefishMotionUsedBucketIndicesScratch) {
      this.ricefishMotionBucketsScratch[index].length = 0;
    }
    this.ricefishMotionUsedBucketIndicesScratch.length = 0;
    for (const index of this.daphniaMotionUsedBucketIndicesScratch) {
      this.daphniaMotionBucketsScratch[index].length = 0;
    }
    this.daphniaMotionUsedBucketIndicesScratch.length = 0;
    this.animalMotionBucketsPopulated = false;
  }

  private shrimpMotionBucketIndex(point: Vec2): number {
    const column = clamp(
      Math.floor(point.x / SHRIMP_MOTION_BUCKET_SIZE),
      0,
      this.shrimpMotionBucketColumns - 1,
    );
    const row = clamp(
      Math.floor((point.y - this.tank.waterTop) / SHRIMP_MOTION_BUCKET_SIZE),
      0,
      this.shrimpMotionBucketRows - 1,
    );
    return row * this.shrimpMotionBucketColumns + column;
  }

  private rebuildShrimpMotionBuckets(): void {
    this.clearShrimpMotionBuckets();
    for (const animal of this.animals) {
      if (animal.lifeStage === 'egg') continue;
      const index = this.shrimpMotionBucketIndex(animal.position);
      const bucket = animal.speciesId === 'cherry-shrimp'
        ? this.shrimpMotionBucketsScratch[index]
        : animal.speciesId === 'japanese-ricefish'
          ? this.ricefishMotionBucketsScratch[index]
          : animal.speciesId === 'daphnia'
            ? this.daphniaMotionBucketsScratch[index]
            : null;
      if (!bucket) continue;
      if (bucket.length === 0) {
        if (animal.speciesId === 'cherry-shrimp') {
          this.shrimpMotionUsedBucketIndicesScratch.push(index);
        } else if (animal.speciesId === 'japanese-ricefish') {
          this.ricefishMotionUsedBucketIndicesScratch.push(index);
        } else {
          this.daphniaMotionUsedBucketIndicesScratch.push(index);
        }
      }
      bucket.push(animal);
    }
    this.animalMotionBucketsPopulated = true;
  }

  private collectNearbyAnimals(
    point: Vec2,
    radius: number,
    speciesId: AnimalSpeciesId,
    reuse: AnimalState[],
  ): AnimalState[] {
    reuse.length = 0;
    const radiusSquared = radius * radius;
    const buckets = speciesId === 'japanese-ricefish'
      ? this.ricefishMotionBucketsScratch
      : speciesId === 'cherry-shrimp'
        ? this.shrimpMotionBucketsScratch
        : speciesId === 'daphnia'
          ? this.daphniaMotionBucketsScratch
          : null;
    const usedIndices = speciesId === 'japanese-ricefish'
      ? this.ricefishMotionUsedBucketIndicesScratch
      : speciesId === 'cherry-shrimp'
        ? this.shrimpMotionUsedBucketIndicesScratch
        : speciesId === 'daphnia'
          ? this.daphniaMotionUsedBucketIndicesScratch
          : [];
    if (buckets && this.animalMotionBucketsPopulated) {
      if (usedIndices.length === 0) return reuse;
    } else {
      for (const animal of this.animals) {
        if (
          animal.speciesId === speciesId &&
          distanceSquared(point, animal.position) <= radiusSquared
        ) reuse.push(animal);
      }
      return reuse;
    }
    const centerIndex = this.shrimpMotionBucketIndex(point);
    const centerColumn = centerIndex % this.shrimpMotionBucketColumns;
    const centerRow = Math.floor(centerIndex / this.shrimpMotionBucketColumns);
    const range = Math.ceil(radius / SHRIMP_MOTION_BUCKET_SIZE);
    const minimumColumn = Math.max(0, centerColumn - range);
    const maximumColumn = Math.min(
      this.shrimpMotionBucketColumns - 1,
      centerColumn + range,
    );
    const minimumRow = Math.max(0, centerRow - range);
    const maximumRow = Math.min(
      this.shrimpMotionBucketRows - 1,
      centerRow + range,
    );
    for (let row = minimumRow; row <= maximumRow; row += 1) {
      const rowOffset = row * this.shrimpMotionBucketColumns;
      for (let column = minimumColumn; column <= maximumColumn; column += 1) {
        for (const animal of buckets[rowOffset + column]) {
          if (
            animal.speciesId === speciesId &&
            distanceSquared(point, animal.position) <= radiusSquared
          ) reuse.push(animal);
        }
      }
    }
    return reuse;
  }

  private stepAnimalMotion(deltaSeconds: number): void {
    const useShrimpMotionBuckets =
      deltaSeconds <= FAST_ANIMAL_MOTION_STEP_SECONDS + 1e-10;
    if (useShrimpMotionBuckets) {
      this.rebuildShrimpMotionBuckets();
    } else {
      // Direct tests and diagnostic callers sometimes use a coarse motion
      // delta. Do not leave prior bucket references alive when falling back to
      // the exact species-filtered scan.
      this.clearShrimpMotionBuckets();
    }
    if (!this.animals.length) {
      this.clearShrimpMotionBuckets();
      return;
    }
    // Build target occupancy once for the substep. Removing each animal before
    // it moves and restoring its final target preserves the previous
    // "scan every other animal" ordering, including targets changed by animals
    // processed earlier in this same substep.
    this.prepareShrimpFoodReservations();
    this.shrimpFoodReservationsActive = true;
    for (const animal of this.animals) {
      animal.nextTargetEvaluation -= deltaSeconds;
      animal.behaviorTimer = Math.max(0, animal.behaviorTimer - deltaSeconds);
      this.adjustShrimpFoodReservation(animal.targetCellId, -1);
      try {
        if (animal.speciesId === 'japanese-ricefish') {
          this.stepRicefishMotion(animal, deltaSeconds);
          continue;
        }
        if (animal.speciesId === 'daphnia') {
          this.stepDaphniaMotion(animal, deltaSeconds);
          continue;
        }
      const waterEscape = this.shrimpLocalWaterEscape(animal);
      if (waterEscape) {
        // Unsafe water takes priority over courtship and feeding. A shrimp
        // abandons the current surface, samples only its immediate
        // neighbourhood, and swims down the locally improving gradient.
        animal.targetCellId = null;
        animal.targetAnimalId = null;
        animal.behavior = 'traveling';
        animal.behaviorTimer = 0;
        animal.nextTargetEvaluation = 0;
        animal.grazingSessionIntake = 0;
        const desiredSpeed = SHRIMP_WATER_ESCAPE_SPEED *
          (0.8 + waterEscape.stress * 0.45);
        const response = 1 - Math.exp(-deltaSeconds * 5.4);
        animal.velocity.x +=
          (waterEscape.x * desiredSpeed - animal.velocity.x) * response;
        animal.velocity.y +=
          (waterEscape.y * desiredSpeed - animal.velocity.y) * response;
        animal.position.x += animal.velocity.x * deltaSeconds;
        animal.position.y += animal.velocity.y * deltaSeconds;
        this.clampAnimalPoint(animal.position, animal.position);
        if (Math.abs(animal.velocity.x) > 2.5) {
          animal.facing = animal.velocity.x < 0 ? -1 : 1;
        }
        animal.poseAngle = clamp(
          Math.atan2(animal.velocity.y, Math.max(5, Math.abs(animal.velocity.x))),
          -0.34,
          0.34,
        );
        continue;
      }
      const directPredator = this.directPredatorForShrimp(animal);
      if (directPredator) {
        this.shrimpPredatorEscape(animal, directPredator, deltaSeconds);
        continue;
      }
      const localDanger = animal.lifeStage === 'juvenile'
        ? this.biogeochemistry.predatorDangerCueAt(animal.position)
        : 0;
      if (
        localDanger >= 0.12 &&
        animal.behavior === 'resting'
      ) {
        // A dissolved cue contains no direction or predator identity. It only
        // raises vigilance; directional escape waits for a nearby eligible
        // predator or attack.
        animal.behavior = 'exploring';
        animal.behaviorTimer = 0;
        animal.nextTargetEvaluation = 0;
      }
      // N. davidi uses a pure-searching system: an ovulatory female emits the
      // local cue, while eligible males search along that cue. The female does
      // not query nearby males and home directly to one. Actual mating remains
      // gated by physical contact in the ecology step below.
      animal.targetAnimalId = null;
      let currentTarget = animal.targetCellId ? this.cellById(animal.targetCellId) : undefined;
      let targetFood = currentTarget ? this.edibleBiomass(currentTarget) : 0;
      let currentTargetDistance = currentTarget
        ? Math.sqrt(distanceSquared(
          animal.position,
          this.shrimpSurfaceContactPoint(currentTarget),
        ))
        : Number.POSITIVE_INFINITY;
      const wasForaging = animal.behavior === 'traveling' ||
        animal.behavior === 'grazing' || animal.behavior === 'starving' ||
        animal.behavior === 'exploring';
      // Severe nutritional deficiency is a material state, not an arbitrary
      // UI-energy threshold. Once reserve is exhausted and achieved body
      // structure is being catabolised, the shrimp is genuinely wasting.
      // The former 0.18 energy threshold was below the ~0.28 structural
      // baseline at the point of death, so normal animals could never enter
      // the starving search state before they died.
      const nutritionallyWasting = this.shrimpIsWasting(animal);
      const behaviorNoise = deterministicNoise(animal.randomSeed + animal.ageSeconds * 0.17);
      let forcedRoaming = animal.behavior === 'exploring' &&
        animal.behaviorTimer > 0 && !nutritionallyWasting;
      const forageStartEnergy = animal.lifeStage === 'juvenile'
        ? SHRIMP_JUVENILE_FORAGE_START_ENERGY
        : SHRIMP_ADULT_FORAGE_START_ENERGY;
      const forageStopEnergy = animal.lifeStage === 'juvenile'
        ? SHRIMP_JUVENILE_FORAGE_STOP_ENERGY
        : SHRIMP_ADULT_FORAGE_STOP_ENERGY;
      // A male that is already foraging remains committed to food until the
      // upper hysteresis threshold is restored.  Previously any mate plume
      // suppressed food seeking first, even when reserve condition was only
      // barely high enough to court.  The male then followed the plume until
      // it crossed the lower threshold with almost no recoverable reserve,
      // creating sex-selective starvation despite edible food nearby.
      const nutritionalForaging =
        animal.energy <= forageStartEnergy ||
        (wasForaging && animal.energy < forageStopEnergy);
      const mateCueDirection = nutritionalForaging
        ? null
        : this.shrimpMateCueDirection(animal);
      const reserveCondition = this.shrimpReserveCondition(animal);
      const reproductiveForaging =
        animal.lifeStage === 'adult' &&
        animal.sex === 'female' &&
        (
          animal.reproductiveBiomass + 1e-9 <
            this.shrimpOvarianMatterTarget(animal) ||
          (animal.ovarianProgress ?? 0) < 1
        );
      // Present condition and developmental demand are different signals.
      // A juvenile with a full short-term reserve still has to acquire the
      // conserved structural matter missing from sexual maturity. Previously
      // that demand was represented by a fixed 0.09-B store; shrinking the
      // physical store then made healthy hatchlings stop feeding permanently.
      const juvenileGrowthForaging =
        animal.lifeStage === 'juvenile' &&
        animal.structuralBiomass + 1e-9 <
          SHRIMP_ECOLOGY_RULES.maturationStructuralBiomass;
      let seeking = !mateCueDirection && !forcedRoaming && (
        reproductiveForaging ||
        juvenileGrowthForaging ||
        nutritionalForaging
      );
      const foragingMotivation = Math.max(
        reproductiveForaging ? 0.45 : 0,
        juvenileGrowthForaging
          ? 0.35 + 0.35 * clamp01(
            1 - animal.structuralBiomass /
              SHRIMP_ECOLOGY_RULES.maturationStructuralBiomass,
          )
          : 0,
        clamp(
          (
            forageStopEnergy - animal.energy
          ) / Math.max(
            1e-6,
            forageStopEnergy -
              SHRIMP_STRUCTURE_CONDITION_SHARE,
          ),
          0,
          1,
        ),
      );
      let justFinishedGrazing = false;

      // A male already above the mating-condition floor switches from a food
      // target to the locally sampled female cue. This is not remote partner
      // selection: the cue exposes only a neighbouring concentration gradient,
      // and reproduction still requires a real 36-unit encounter for 3 s.
      if (mateCueDirection && animal.targetCellId) {
        animal.targetCellId = null;
        animal.behavior = 'exploring';
        animal.behaviorTimer = 0;
        animal.nextTargetEvaluation = 0;
        animal.grazingSessionIntake = 0;
        animal.grazingSessionSeconds = 0;
        currentTarget = undefined;
        targetFood = 0;
        currentTargetDistance = Number.POSITIVE_INFINITY;
        forcedRoaming = false;
        seeking = false;
      }

      // A fed shrimp releases the colony after a short grazing bout, then must
      // spend a visible interval roaming before food targeting can resume.
      // A hungry shrimp also releases a trace film after sampling it when the
      // realised ration cannot pay its grazing metabolism. Trace biomass is
      // still consumed; it simply cannot pin the animal in place forever.
      const grazingBoutFinished =
        animal.behavior === 'grazing' &&
        animal.behaviorTimer <= 0;
      const currentPatchUnprofitable =
        animal.behavior === 'grazing' &&
        (animal.grazingSessionSeconds ?? 0) >=
          SHRIMP_PATCH_SAMPLE_MINIMUM_SECONDS &&
        this.shrimpRealisedGrazingReturn(animal) <
          SHRIMP_MINIMUM_REALISED_GRAZING_RETURN;
      if (
        animal.behavior === 'grazing' &&
        (
          grazingBoutFinished ||
          currentPatchUnprofitable ||
          (
            !reproductiveForaging &&
            !juvenileGrowthForaging &&
            animal.energy >= forageStopEnergy
          ) ||
          targetFood <= 0
        )
      ) {
        const completedGrazingCellId = animal.targetCellId;
        animal.targetCellId = null;
        animal.recentGrazingCellId = completedGrazingCellId;
        animal.recentGrazingCellCooldown = animal.lifeStage === 'juvenile'
          ? SHRIMP_JUVENILE_RECENT_GRAZING_CELL_COOLDOWN_SECONDS
          : SHRIMP_RECENT_GRAZING_CELL_COOLDOWN_SECONDS;
        animal.behavior = 'exploring';
        const productiveBout = !currentPatchUnprofitable && targetFood > 0;
        const roamScale = productiveBout
          ? 1 -
            foragingMotivation *
              SHRIMP_HUNGRY_POST_GRAZE_ROAM_MAXIMUM_REDUCTION
          : 1;
        animal.behaviorTimer = (
          SHRIMP_POST_GRAZE_ROAM_MIN_SECONDS +
          behaviorNoise * SHRIMP_POST_GRAZE_ROAM_VARIANCE_SECONDS
        ) * roamScale;
        animal.nextTargetEvaluation = 0;
        animal.grazingSessionIntake = 0;
        animal.grazingSessionSeconds = 0;
        currentTarget = undefined;
        targetFood = 0;
        currentTargetDistance = Number.POSITIVE_INFINITY;
        forcedRoaming = true;
        seeking = false;
        justFinishedGrazing = true;
      }

      if (mateCueDirection && animal.behavior === 'resting') {
        animal.behavior = 'exploring';
        animal.behaviorTimer = 0;
        animal.nextTargetEvaluation = 0;
      }
      if (
        animal.behavior === 'resting' &&
        animal.behaviorTimer > 0 &&
        !nutritionallyWasting &&
        !mateCueDirection
      ) {
        animal.targetCellId = null;
        const damping = Math.exp(-deltaSeconds * 5);
        animal.velocity.x *= damping;
        animal.velocity.y *= damping;
        animal.poseAngle *= damping;
        continue;
      }

      // Crossing the full-energy threshold ends food pursuit immediately rather
      // than leaving the animal parked on a still-edible surface until retarget.
      if (
        !seeking &&
        !forcedRoaming &&
        wasForaging &&
        !justFinishedGrazing &&
        animal.behavior !== 'resting' &&
        !mateCueDirection
      ) {
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
        ? Math.sqrt(distanceSquared(
          animal.position,
          this.shrimpSurfaceContactPoint(currentTarget),
        ))
        : Number.POSITIVE_INFINITY;

      if (
        !seeking &&
        !mateCueDirection &&
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
        (seeking && targetFood <= 0 && currentTargetDistance <= 24)
      ) {
        const foodTarget = seeking ? this.chooseFoodTarget(animal) : null;
        const foodCueDirection =
          seeking && !foodTarget ? this.shrimpFoodCueDirection(animal) : null;
        const localCueDirection = foodCueDirection ?? mateCueDirection;
        const retainExplorationTarget = Boolean(
          seeking && currentTarget &&
          targetFood <= 0 && currentTargetDistance > 24,
        );
        animal.targetCellId = foodTarget?.id ??
          (retainExplorationTarget
            ? currentTarget!.id
            : this.chooseExplorationTarget(animal, localCueDirection)?.id ?? null);
        animal.nextTargetEvaluation = foodTarget
          ? 0.8 + behaviorNoise * 0.6
          : forcedRoaming
            ? Math.max(0.1, animal.behaviorTimer)
            : 3.4 + behaviorNoise * 2.2;
      }

      const target = animal.targetCellId ? this.cellById(animal.targetCellId) : undefined;
      if (!target) {
        animal.behavior = nutritionallyWasting ? 'starving' : 'resting';
        const damping = Math.exp(-deltaSeconds * 5);
        animal.velocity.x *= damping;
        animal.velocity.y *= damping;
        continue;
      }

      const targetPoint = this.shrimpSurfaceContactPoint(target);
      const dx = targetPoint.x - animal.position.x;
      const dy = targetPoint.y - animal.position.y;
      const distance = Math.max(0.001, Math.hypot(dx, dy));
      const hasFood = this.edibleBiomass(target) > 0;
      const grazing = seeking && hasFood &&
        distance <= Math.max(SHRIMP_GRAZE_DISTANCE, target.cellSize * 1.4);
      if (grazing) {
        if (animal.behavior !== 'grazing') {
          const boutMultiplier = 1 +
            foragingMotivation *
              (SHRIMP_HUNGRY_GRAZING_BOUT_MAXIMUM_MULTIPLIER - 1);
          animal.behaviorTimer = (
            SHRIMP_GRAZING_BOUT_MIN_SECONDS +
            behaviorNoise * SHRIMP_GRAZING_BOUT_VARIANCE_SECONDS
          ) * boutMultiplier;
          animal.grazingSessionIntake = 0;
          animal.grazingSessionSeconds = 0;
        }
        animal.behavior = 'grazing';
        const settle = 1 - Math.exp(-deltaSeconds * 8);
        animal.velocity.x += (-animal.velocity.x) * settle;
        animal.velocity.y += (-animal.velocity.y) * settle;
        animal.position.x += (targetPoint.x - animal.position.x) * Math.min(0.2, deltaSeconds * 2.2);
        animal.position.y += (targetPoint.y - animal.position.y) * Math.min(0.2, deltaSeconds * 2.2);
      } else {
        animal.behavior = nutritionallyWasting
          ? 'starving'
          : seeking && hasFood ? 'traveling' : 'exploring';
        const weakFactor = nutritionallyWasting ? 0.45 : 1;
        const arrivalScale = shrimpArrivalScale(distance, 32);
        const baseSpeed = (distance > 80 ? 78 : 30) * arrivalScale;
        const individualSpeed = 0.88 + deterministicNoise(animal.randomSeed) * 0.24;
        const lateralWave =
          Math.sin(animal.ageSeconds * 4.1 + animal.randomSeed) *
          3.6 *
          arrivalScale;
        let desiredX = (dx / distance) * baseSpeed * individualSpeed * weakFactor;
        let desiredY = (dy / distance) * baseSpeed * individualSpeed * weakFactor;
        desiredX += (-dy / distance) * lateralWave;
        desiredY += (dx / distance) * lateralWave;

        if (useShrimpMotionBuckets) {
          const bucketIndex = this.shrimpMotionBucketIndex(animal.position);
          const bucketColumn = bucketIndex % this.shrimpMotionBucketColumns;
          const bucketRow = Math.floor(
            bucketIndex / this.shrimpMotionBucketColumns,
          );
          const minimumColumn = Math.max(
            0,
            bucketColumn - SHRIMP_MOTION_BUCKET_NEIGHBOR_RANGE,
          );
          const maximumColumn = Math.min(
            this.shrimpMotionBucketColumns - 1,
            bucketColumn + SHRIMP_MOTION_BUCKET_NEIGHBOR_RANGE,
          );
          const minimumRow = Math.max(
            0,
            bucketRow - SHRIMP_MOTION_BUCKET_NEIGHBOR_RANGE,
          );
          const maximumRow = Math.min(
            this.shrimpMotionBucketRows - 1,
            bucketRow + SHRIMP_MOTION_BUCKET_NEIGHBOR_RANGE,
          );
          for (let row = minimumRow; row <= maximumRow; row += 1) {
            const rowOffset = row * this.shrimpMotionBucketColumns;
            for (
              let column = minimumColumn;
              column <= maximumColumn;
              column += 1
            ) {
              const bucket =
                this.shrimpMotionBucketsScratch[rowOffset + column];
              for (const other of bucket) {
                if (
                  other.id === animal.id ||
                  other.speciesId !== 'cherry-shrimp'
                ) continue;
                const separationX = animal.position.x - other.position.x;
                const separationY = animal.position.y - other.position.y;
                const separationDistance = Math.hypot(
                  separationX,
                  separationY,
                );
                if (
                  separationDistance <= 0.001 ||
                  separationDistance >= SHRIMP_SEPARATION_RADIUS
                ) continue;
                const pressure =
                  (SHRIMP_SEPARATION_RADIUS - separationDistance) /
                  SHRIMP_SEPARATION_RADIUS;
                desiredX +=
                  (separationX / separationDistance) *
                  pressure *
                  SHRIMP_SEPARATION_FORCE;
                desiredY +=
                  (separationY / separationDistance) *
                  pressure *
                  SHRIMP_SEPARATION_FORCE;
              }
            }
          }
        } else {
          for (const other of this.animals) {
            if (
              other.id === animal.id ||
              other.speciesId !== 'cherry-shrimp'
            ) continue;
            const separationX = animal.position.x - other.position.x;
            const separationY = animal.position.y - other.position.y;
            const separationDistance = Math.hypot(separationX, separationY);
            if (
              separationDistance <= 0.001 ||
              separationDistance >= SHRIMP_SEPARATION_RADIUS
            ) continue;
            const pressure =
              (SHRIMP_SEPARATION_RADIUS - separationDistance) /
              SHRIMP_SEPARATION_RADIUS;
            desiredX +=
              (separationX / separationDistance) *
              pressure *
              SHRIMP_SEPARATION_FORCE;
            desiredY +=
              (separationY / separationDistance) *
              pressure *
              SHRIMP_SEPARATION_FORCE;
          }
        }

        const response = 1 - Math.exp(-deltaSeconds * 4.2);
        animal.velocity.x += (desiredX - animal.velocity.x) * response;
        animal.velocity.y += (desiredY - animal.velocity.y) * response;
        animal.position.x += animal.velocity.x * deltaSeconds;
        animal.position.y += animal.velocity.y * deltaSeconds;
      }

      this.clampAnimalPoint(animal.position, animal.position);
      animal.facing = stableHorizontalFacing(
        animal.facing,
        animal.velocity.x,
      );
      animal.poseAngle = clamp(
        Math.atan2(animal.velocity.y, Math.max(5, Math.abs(animal.velocity.x))),
        -0.34,
        0.34,
      );
      } finally {
        this.adjustShrimpFoodReservation(animal.targetCellId, 1);
      }
    }
    this.shrimpFoodReservationsActive = false;
    // Buckets are rebuilt from current positions for every motion substep.
    // Releasing their object references now also keeps animals removed by the
    // following ecology step from being retained while the simulation pauses.
    this.clearShrimpMotionBuckets();
  }

  private stepDaphniaMotion(
    animal: AnimalState,
    deltaSeconds: number,
  ): void {
    const rules = PLANKTON_ECOLOGY_RULES.daphnia;
    const localFood = this.biogeochemistry.planktonAt(
      animal.position,
      this.planktonSampleScratch,
    );
    const centerFood = localFood.phytoplankton +
      localFood.planktonicDecomposer * rules.maximumBacteriaDietFraction;
    const hungry = centerFood < rules.phytoplanktonHalfSaturation ||
      animal.energy < 0.38;

    // Daphnia filter the water they happen to occupy; they do not sample
    // distant cells and steer toward the richest one. A correlated random walk
    // plus current and boundary response still lets them cross the tank
    // without granting an invisible food-direction sensor.
    // Locomotion has its own per-individual identity. Demographic traits can
    // legitimately match within a cohort (and old saves may contain duplicate
    // seeds), but that must never make multiple animals share one swimming
    // clock. Independent period, phase and headings produce an asynchronous
    // correlated random walk without separation pressure or schooling.
    const motionSeed = daphniaMotionSeed(animal.id);
    const roamingPeriod = rules.roamingDirectionSeconds * seededRange(
      motionSeed * 0.037 + 7.1,
      0.76,
      1.24,
    );
    const roamingPhase = deterministicNoise(
      motionSeed * 0.043 + 11.9,
    );
    const roamingTime = animal.ageSeconds / roamingPeriod + roamingPhase;
    const roamingSegment = Math.floor(roamingTime);
    const roamingBlend = roamingTime - roamingSegment;
    const firstHeading = daphniaRoamingHeading(motionSeed, roamingSegment);
    const nextHeading = daphniaRoamingHeading(
      motionSeed,
      roamingSegment + 1,
    );
    const firstX = Math.cos(firstHeading);
    const firstY = Math.sin(firstHeading);
    const nextX = Math.cos(nextHeading);
    const nextY = Math.sin(nextHeading);
    const smoothBlend = roamingBlend * roamingBlend * (3 - 2 * roamingBlend);
    const wanderX = firstX + (nextX - firstX) * smoothBlend;
    const wanderY = (firstY + (nextY - firstY) * smoothBlend) * 0.72;

    // A power stroke followed by passive sinking produces the characteristic
    // hop, but subtracting its cycle mean prevents the old permanent upward
    // drift that pinned the whole population to the surface.
    const strokeRate = seededRange(
      motionSeed * 0.089 + 17.3,
      3.05,
      3.78,
    );
    const strokePhase = deterministicNoise(
      motionSeed * 0.097 + 19.7,
    ) * Math.PI * 2;
    const phase = animal.ageSeconds * strokeRate + strokePhase;
    const hop = Math.max(0, Math.sin(phase));
    const balancedHop = -(hop - 1 / Math.PI) * 0.34;
    const localFoodResponse = centerFood <= 0
      ? 0
      : centerFood / (rules.phytoplanktonHalfSaturation + centerFood);
    // Animals increase search activity in poor water but keep the same
    // stochastic heading. In food-rich water the slower walk lengthens local
    // residence without revealing the direction of another patch.
    let roamingWeight = hungry
      ? 1.08
      : 0.78 + (1 - localFoodResponse) * 0.18;
    const refugeResidency = daphniaLocalRefugeResidency(
      this.biogeochemistry.predatorDangerCueAt(animal.position),
      this.ricefishShelterAt(animal.position),
      this.currentDayNightState()?.phase === 'night',
    );
    // Refuge is a local residence effect, not a destination. A direct
    // predator escape or the local vertical migration below still overrides
    // this ordinary-wander reduction.
    roamingWeight *= 1 - refugeResidency * 0.8;
    const current = this.biogeochemistry.velocityAt(
      animal.position,
      this.waterVelocityScratch,
    );
    // A hard positional clamp leaves outward velocity intact and can pin a
    // Daphnia to the glass while only its appendages animate. Steer away
    // before contact, then reflect any remaining outward velocity.
    const horizontalMargin = 72;
    const verticalMargin = 58;
    const waterTop = this.tank.waterTop + 12;
    const waterBottom = this.tank.groundY - 14;
    const waterColumnMiddle = (waterTop + waterBottom) / 2;
    const verticalBalance = clamp(
      (waterColumnMiddle - animal.position.y) /
        ((waterBottom - waterTop) * 0.42),
      -1,
      1,
    ) * 0.22;
    const boundaryX = clamp(
      (horizontalMargin - animal.position.x) / horizontalMargin,
      0,
      1,
    ) - clamp(
      (animal.position.x - (this.tank.width - horizontalMargin)) / horizontalMargin,
      0,
      1,
    );
    const boundaryY = clamp(
      (waterTop + verticalMargin - animal.position.y) / verticalMargin,
      0,
      1,
    ) - clamp(
      (animal.position.y - (waterBottom - verticalMargin)) / verticalMargin,
      0,
      1,
    );
    const activityScale = animal.behavior === 'starving'
      ? 0.52
      : 0.72 + animal.energy * 0.28;
    let desiredX = (
      wanderX * roamingWeight + boundaryX * 1.35
    ) * rules.swimmingSpeed * activityScale +
      current.x * rules.currentVelocityScale;
    let desiredY = (
      wanderY * roamingWeight + balancedHop +
        // Daphnia are slightly denser than water between power strokes. A
        // small settling term plus a weak return toward the water column keeps
        // an unfed cohort suspended instead of accumulating at the surface.
        0.08 + verticalBalance +
        boundaryY * 1.2
    ) * rules.swimmingSpeed * activityScale +
      current.y * rules.currentVelocityScale;
    const waterEscape = this.daphniaLocalWaterEscape(animal);
    const predatorEscape = this.daphniaPredatorEscape(animal);
    if (predatorEscape && predatorEscape.response !== 'migration') {
      const escapeSpeed = DAPHNIA_PREDATOR_ESCAPE_SPEED *
        daphniaPredatorEscapeSpeedScaleForBodyLength(animal.bodyLength) *
        (0.78 + predatorEscape.stress * 0.52);
      desiredX = predatorEscape.x * escapeSpeed +
        current.x * rules.currentVelocityScale * 0.35;
      desiredY = predatorEscape.y * escapeSpeed +
        current.y * rules.currentVelocityScale * 0.35;
    } else if (waterEscape) {
      const escapeSpeed = DAPHNIA_WATER_ESCAPE_SPEED *
        (0.82 + waterEscape.stress * 0.5);
      desiredX = waterEscape.x * escapeSpeed +
        current.x * rules.currentVelocityScale;
      desiredY = waterEscape.y * escapeSpeed +
        current.y * rules.currentVelocityScale;
    } else if (predatorEscape) {
      // Predator kairomone and daylight induce a sustained vertical
      // redistribution. It is ordinary swimming layered over the correlated
      // walk, not a tank-long repetition of the high-speed escape stroke.
      const migrationSpeed = rules.swimmingSpeed * predatorEscape.stress;
      desiredX += predatorEscape.x * migrationSpeed;
      desiredY += predatorEscape.y * migrationSpeed;
    }
    const response = 1 - Math.exp(-deltaSeconds * (hop > 0 ? 7 : 2.8));
    animal.velocity.x += (desiredX - animal.velocity.x) * response;
    animal.velocity.y += (desiredY - animal.velocity.y) * response;
    const proposedX = animal.position.x + animal.velocity.x * deltaSeconds;
    const proposedY = animal.position.y + animal.velocity.y * deltaSeconds;
    const clampedX = clamp(proposedX, 10, this.tank.width - 10);
    const clampedY = clamp(proposedY, this.tank.waterTop + 12, this.tank.groundY - 14);
    if (clampedX !== proposedX) {
      animal.velocity.x = clampedX <= 10
        ? Math.abs(animal.velocity.x) * 0.62
        : -Math.abs(animal.velocity.x) * 0.62;
    }
    if (clampedY !== proposedY) {
      animal.velocity.y = clampedY <= waterTop
        ? Math.abs(animal.velocity.y) * 0.58
        : -Math.abs(animal.velocity.y) * 0.58;
    }
    animal.position.x = clampedX;
    animal.position.y = clampedY;
    if (Math.abs(animal.velocity.x) > 0.8) animal.facing = animal.velocity.x < 0 ? -1 : 1;
    animal.poseAngle = clamp(
      Math.atan2(animal.velocity.y, Math.max(3, Math.abs(animal.velocity.x))),
      -0.55,
      0.55,
    );
    animal.behavior = predatorEscape
      ? 'traveling'
      : animal.secondsSinceFood > 30 && animal.energy < 0.18
        ? 'starving'
        : animal.secondsSinceFood <= 2
          ? 'grazing'
          : 'exploring';
  }

  private stepRicefishMotion(animal: AnimalState, deltaSeconds: number): void {
    if (animal.lifeStage === 'egg') {
      const attachment = animal.attachmentCellId
        ? this.cellById(animal.attachmentCellId)
        : undefined;
      if (attachment) {
        const point = this.cellWorldPoint(attachment);
        animal.position.x = point.x;
        animal.position.y = point.y;
      }
      animal.velocity.x = 0;
      animal.velocity.y = 0;
      animal.poseAngle = 0;
      animal.behavior = 'incubating';
      return;
    }

    const rules = RICEFISH_ECOLOGY_RULES;
    // A prey-poor search patch owns the visual radius measured where that
    // inspection failed. Re-sampling canopy at the moving fish made the
    // radius wobble by fractions of a pixel; near a tank/plant boundary that
    // could select a completely different exit candidate on alternate steps.
    // Keep one transect geometry until the fish has actually left the patch.
    const preyDetectionRadius = this.ricefishPreyDetectionRadiusAt(
      animal,
      animal.foragingPatchOrigin ?? animal.position,
    );
    const localOxygen = this.biogeochemistry.effectsEnabled
      ? this.biogeochemistry.oxygenAt(animal.position)
      : null;
    const oxygenActivity = localOxygen !== null
      ? clamp((localOxygen - rules.oxygenSevereStress) /
        (rules.oxygenStressStart - rules.oxygenSevereStress), 0.35, 1)
      : 1;
    const isNight = this.currentDayNightState()?.phase === 'night';
    const bodySizeSpeed = ricefishSwimmingSpeedScaleForBodyLength(
      animal.bodyLength,
    );
    const activityScale =
      oxygenActivity *
      (isNight ? 0.58 : 1) *
      bodySizeSpeed *
      ricefishStarvationActivityScale(animal.energy);
    const inspectionTravelDistance = Math.max(
      1,
      rules.cruiseSpeed * activityScale *
        RICEFISH_VISUAL_INSPECTION_SECONDS,
    );
    const matingReady = this.ricefishFemaleReadyToMate(animal) ||
      this.ricefishMaleReadyToMate(animal);
    let mate = matingReady
      ? this.chooseRicefishCourtshipPartner(animal)
      : undefined;
    animal.courtshipPartnerId = mate?.id ?? null;

    let prey = animal.targetAnimalId
      ? this.animals.find((candidate) =>
        candidate.id === animal.targetAnimalId &&
        this.isRicefishAnimalPrey(animal, candidate))
      : undefined;
    if (animal.targetAnimalId && !prey) {
      // Saved targets can become orphaned after an older-version load, and a
      // prey captured earlier in this motion/ecology cycle must not leave a
      // fish chasing a missing identifier until its ordinary timer expires.
      animal.targetAnimalId = null;
      animal.strikeRecoveryUses = 0;
      animal.nextTargetEvaluation = 0;
    }
    // Medaka do not scrape attached algae in this food web. Old saves may
    // still contain a legacy surface target, so clear it for every mobile
    // life stage before either motion or ecology can consume from that cell.
    animal.targetCellId = null;
    const motionTrackLossReason = prey
      ? this.ricefishPreyTrackLossReason(
        animal,
        prey,
        preyDetectionRadius,
      )
      : null;
    if (prey && motionTrackLossReason) {
      this.recordRicefishTrackLoss(animal, motionTrackLossReason);
      prey = undefined;
      animal.targetAnimalId = null;
      animal.strikeRecoveryUses = 0;
      animal.foragingPatchOrigin = { ...animal.position };
      animal.foragingLastInspectionPosition = { ...animal.position };
    }

    const developmentStructureTarget = animal.lifeStage === 'fry'
      ? WATER_CYCLE_RULES.ricefish.fryBirthBiomass * 0.72
      : animal.lifeStage === 'juvenile'
        ? WATER_CYCLE_RULES.ricefish.juvenileStructuralBiomass
        : 0;
    const developmentNeedsFood = developmentStructureTarget > 0 &&
      animal.structuralBiomass + 1e-9 < developmentStructureTarget &&
      animal.energy < rules.forageStopEnergy;
    // Newly hatched medaka overlap endogenous yolk absorption with exogenous
    // feeding. Do not wait for the yolk-supported condition score to collapse
    // before a still-growing fry begins inspecting real nearby prey.
    const fryMixedFeedingNeedsFood =
      animal.lifeStage === 'fry' &&
      animal.ageSeconds >=
        rules.yolkAbsorptionSeconds * rules.exogenousFeedingOnsetFraction &&
      animal.structuralBiomass + 1e-9 <
        WATER_CYCLE_RULES.ricefish.fryBirthBiomass;
    const foragingUrgency = ricefishForagingUrgency(
      animal.lifeStage,
      animal.structuralBiomass,
      animal.energy,
    );
    const independentSearchDistance =
      preyDetectionRadius / (1 + foragingUrgency);
    if (
      animal.foragingPatchOrigin &&
      distanceSquared(animal.position, animal.foragingPatchOrigin) >=
        independentSearchDistance * independentSearchDistance
    ) {
      // The transect is complete only after the fish has physically left that
      // visual neighbourhood. Intermediate observations may notice prey that
      // entered the forward field, but they do not move this fixed origin or
      // choose a fresh exit.
      animal.foragingPatchOrigin = null;
      animal.foragingLastInspectionPosition = null;
    }
    const minimumEggMatter =
      rules.eggClutchMinimum * WATER_CYCLE_RULES.ricefish.eggBiomass;
    const eggMatterAvailable =
      animal.reproductiveBiomass +
      Math.max(
        0,
        animal.storedBiomass -
          ricefishReproductionReserveFloor(animal.structuralBiomass),
      );
    const reproductionNeedsFood =
      animal.lifeStage === 'adult' &&
      animal.sex === 'female' &&
      animal.gestationRemaining === null &&
      animal.reproductionCooldown <= 0 &&
      eggMatterAvailable + 1e-9 < minimumEggMatter;
    const physiologicalHunger = developmentNeedsFood ||
      fryMixedFeedingNeedsFood ||
      reproductionNeedsFood ||
      animal.energy <= rules.forageStartEnergy ||
      (
        (animal.behavior === 'hunting' || animal.behavior === 'grazing') &&
        animal.energy < rules.forageStopEnergy
      );
    const foragingReferenceBiomass = ricefishGutCapacityReferenceBiomass(
      animal.lifeStage,
      animal.ageSeconds,
      animal.structuralBiomass,
      animal.peakStructuralBiomass ?? animal.structuralBiomass,
    );
    const foragingAppetite = ricefishForagingAppetite(
      animal.recentIntake,
      foragingReferenceBiomass,
    );
    const conditionReserveCapacity = ricefishConditionReserveCapacity(
      animal.lifeStage,
      animal.ageSeconds,
      animal.structuralBiomass,
      animal.peakStructuralBiomass ?? animal.structuralBiomass,
    );
    const reserveDepletedAfterHandling =
      animal.storedBiomass <=
        conditionReserveCapacity *
          rules.starvationReserveStressStartFraction &&
      animal.secondsSinceFood >= rules.starvationFeedingGapGraceSeconds;
    const hungry = physiologicalHunger && (
      foragingAppetite >= rules.foragingResumeAppetite ||
      (
        (animal.lifeStage === 'fry' || animal.lifeStage === 'juvenile') &&
        animal.energy <= rules.starvationEmergencyForageEnergy
      ) ||
      reserveDepletedAfterHandling
    );
    // Feeding and reproduction are tightly coupled in medaka. A fish that has
    // crossed its physiological forage threshold first restores condition
    // instead of abandoning a visible meal for courtship.
    if (hungry) {
      mate = undefined;
      animal.courtshipPartnerId = null;
    }
    if (hungry && prey) {
      const immediatePrey = this.chooseRicefishImmediatePrey(animal, prey);
      if (immediatePrey) {
        prey = immediatePrey;
        animal.targetAnimalId = immediatePrey.id;
        if (immediatePrey.speciesId === 'daphnia') {
          const diagnostic = this.ricefishForagingDiagnostic(animal);
          if (diagnostic) diagnostic.daphniaTargetsAcquired += 1;
        }
        animal.strikeRecoveryUses = 0;
        animal.behaviorTimer = 0;
        // Commit briefly to the new opportunity. A prey that literally enters
        // the mouth can still override this inside chooseRicefishImmediatePrey,
        // but a dense swarm cannot make the target alternate every motion step.
        animal.nextTargetEvaluation = RICEFISH_VISUAL_INSPECTION_SECONDS;
        animal.foragingPatchOrigin = null;
        animal.foragingLastInspectionPosition = null;
      }
    }
    const movedSinceLastInspection =
      animal.foragingLastInspectionPosition === null ||
      animal.foragingLastInspectionPosition === undefined ||
      distanceSquared(
        animal.position,
        animal.foragingLastInspectionPosition,
      ) >= inspectionTravelDistance * inspectionTravelDistance;
    if (mate) {
      animal.targetAnimalId = null;
      animal.strikeRecoveryUses = 0;
      animal.targetCellId = null;
      animal.foragingPatchOrigin = null;
      animal.foragingLastInspectionPosition = null;
    } else if (
      hungry &&
      !prey &&
      animal.nextTargetEvaluation <= 0 &&
      (!animal.foragingPatchOrigin || movedSinceLastInspection)
    ) {
      prey = this.chooseRicefishPrey(animal, foragingUrgency) ?? undefined;
      animal.targetAnimalId = prey?.id ?? null;
      if (prey?.speciesId === 'daphnia') {
        const diagnostic = this.ricefishForagingDiagnostic(animal);
        if (diagnostic) diagnostic.daphniaTargetsAcquired += 1;
      }
      animal.strikeRecoveryUses = 0;
      if (prey) {
        animal.foragingPatchOrigin = null;
        animal.foragingLastInspectionPosition = null;
      } else {
        if (!animal.foragingPatchOrigin) {
          animal.foragingPatchOrigin = { ...animal.position };
        }
        animal.foragingLastInspectionPosition = { ...animal.position };
      }
      animal.nextTargetEvaluation = prey
        ? 0.45
        : RICEFISH_VISUAL_INSPECTION_SECONDS;
    } else if (!hungry) {
      animal.targetAnimalId = null;
      animal.strikeRecoveryUses = 0;
      animal.targetCellId = null;
      animal.foragingPatchOrigin = null;
      animal.foragingLastInspectionPosition = null;
      prey = undefined;
    }

    let targetPoint: Vec2;
    if (mate) {
      targetPoint = this.ricefishCourtshipTargetPoint(animal, mate);
      animal.behavior = 'courting';
    } else if (prey) {
      const preyDx = prey.position.x - animal.position.x;
      const preyDy = prey.position.y - animal.position.y;
      const aimFacing = ricefishPursuitFacing(
        animal.facing,
        preyDx,
        animal.bodyLength,
      );
      const aimAngle = clamp(
        Math.atan2(preyDy, Math.max(12, Math.abs(preyDx))),
        -RICEFISH_MAXIMUM_POSE_ANGLE,
        RICEFISH_MAXIMUM_POSE_ANGLE,
      );
      const aimX = aimFacing * Math.cos(aimAngle);
      const aimY = Math.sin(aimAngle);
      const mouthOffset =
        animal.bodyLength * RICEFISH_MOUTH_OFFSET_BODY_FRACTION;
      // Bring the fish centre only as far as needed for its visible mouth to
      // meet the prey. Aiming the body centre at the prey made the snout pass
      // through it, then produced an obvious left/right overshoot loop. Use
      // the same pitch limit as the side-on renderer: an almost vertical prey
      // must be approached from the side, not from an impossible invisible
      // mouth direction.
      targetPoint = {
        x: prey.position.x - aimX * mouthOffset,
        y: prey.position.y - aimY * mouthOffset,
      };
      animal.behavior = 'hunting';
    } else if (animal.foragingPatchOrigin) {
      targetPoint = ricefishPatchExitPoint(
        animal.foragingPatchOrigin,
        independentSearchDistance,
        {
          minimumX: 170,
          maximumX: this.tank.width - 170,
          minimumY: this.tank.waterTop + 95,
          maximumY: this.tank.groundY - 95,
        },
        animal.randomSeed,
      );
      animal.behavior = hungry
        ? 'hunting'
        : isNight
          ? 'resting'
          : 'exploring';
    } else {
      // Cruise on one correlated heading instead of choosing an unrelated
      // point across the whole tank every few seconds. The old global
      // retargeting made a fish reverse before it had travelled anywhere,
      // which looked like a stationary left/right head shake—especially
      // when simulation time was accelerated.
      const cruisePeriod = 13.5 + deterministicNoise(
        animal.randomSeed * 0.071 + 12.4,
      ) * 5.5;
      const cruiseTime = animal.ageSeconds / cruisePeriod +
        deterministicNoise(animal.randomSeed * 0.083 + 21.7);
      const cruiseSegment = Math.floor(cruiseTime);
      const cruiseBlend = cruiseTime - cruiseSegment;
      const smoothBlend = cruiseBlend * cruiseBlend * (3 - 2 * cruiseBlend);
      const firstHeading = deterministicNoise(
        animal.randomSeed + cruiseSegment * 17.31,
      ) * Math.PI * 2;
      const nextHeading = deterministicNoise(
        animal.randomSeed + (cruiseSegment + 1) * 17.31,
      ) * Math.PI * 2;
      let cruiseX = Math.cos(firstHeading) * (1 - smoothBlend) +
        Math.cos(nextHeading) * smoothBlend +
        animal.facing * 0.82;
      let cruiseY = (
        Math.sin(firstHeading) * (1 - smoothBlend) +
        Math.sin(nextHeading) * smoothBlend
      ) * (hungry ? 0.62 : 0.46);
      const horizontalMargin = 170;
      const verticalMargin = 95;
      cruiseX += clamp(
        (horizontalMargin - animal.position.x) / horizontalMargin,
        0,
        1,
      ) * 2.4;
      cruiseX -= clamp(
        (animal.position.x - (this.tank.width - horizontalMargin)) /
          horizontalMargin,
        0,
        1,
      ) * 2.4;
      cruiseY += clamp(
        (this.tank.waterTop + verticalMargin - animal.position.y) /
          verticalMargin,
        0,
        1,
      ) * 1.9;
      cruiseY -= clamp(
        (animal.position.y - (this.tank.groundY - verticalMargin)) /
          verticalMargin,
        0,
        1,
      ) * 1.9;
      const cruiseLength = Math.max(0.001, Math.hypot(cruiseX, cruiseY));
      targetPoint = {
        x: animal.position.x + cruiseX / cruiseLength * 520,
        y: animal.position.y + cruiseY / cruiseLength * 360,
      };
      // Keep the foraging intent while the short strike/search cooldown is
      // running. If this branch overwrites `hunting` with `exploring`, the
      // next motion step loses the forage-stop side of the hysteresis and a
      // fish that has only just crossed forageStart stops after one bite.
      animal.behavior = hungry
        ? 'hunting'
        : isNight
          ? 'resting'
          : 'exploring';
    }

    const dx = targetPoint.x - animal.position.x;
    const dy = targetPoint.y - animal.position.y;
    const distance = Math.max(0.001, Math.hypot(dx, dy));
    const baseSpeed = prey
      ? rules.preyPursuitSpeed
      : mate
        ? rules.cruiseSpeed * (animal.sex === 'male' ? 1.28 : 0.42)
        : rules.cruiseSpeed;
    const arrivalScale = mate
        ? animal.sex === 'male'
          ? clamp(distance / 54, 0.18, 1)
          : 1
        : 1;
    let desiredX: number;
    let desiredY: number;
    if (prey) {
      // Track the moving prey with a damped centre offset instead of charging
      // through its centre at a fixed minimum speed. Velocity feed-forward
      // lets the mouth remain alongside a fleeing Daphnia after catching up.
      const pursuitHabitatScale = ricefishCanopyPursuitScale(
        this.ricefishShelterAt(prey.position),
        this.ricefishShelterAt(animal.position),
      );
      // In dense leaves, do not mirror every Daphnia stroke with an immediate
      // full reversal. Follow a smoothed intercept and either close cleanly or
      // lose the visual lock instead of appearing snagged while nodding.
      const preyVelocityWeight = 0.28 + pursuitHabitatScale * 0.72;
      const interceptResponse = 3.8 + pursuitHabitatScale * 2.7;
      const pursuitX =
        prey.velocity.x * preyVelocityWeight + dx * interceptResponse;
      const pursuitY =
        prey.velocity.y * preyVelocityWeight + dy * interceptResponse;
      const pursuitMagnitude = Math.hypot(pursuitX, pursuitY);
      const maximumPursuitSpeed =
        baseSpeed * activityScale * pursuitHabitatScale;
      const pursuitScale = pursuitMagnitude > maximumPursuitSpeed
        ? maximumPursuitSpeed / Math.max(1e-9, pursuitMagnitude)
        : 1;
      desiredX = pursuitX * pursuitScale;
      desiredY = pursuitY * pursuitScale;
    } else {
      desiredX =
        (dx / distance) * baseSpeed * activityScale * arrivalScale;
      desiredY =
        (dy / distance) * baseSpeed * activityScale * arrivalScale;
    }

    // Weak schooling: local neighbours influence heading and cohesion, but do
    // not force every fish onto one identical point or target.
    let neighbourCount = 0;
    let centreX = 0;
    let centreY = 0;
    let headingX = 0;
    let headingY = 0;
    for (const other of this.animals) {
      if (
        other.id === animal.id ||
        other.speciesId !== 'japanese-ricefish' ||
        other.lifeStage === 'egg'
      ) continue;
      const d2 = distanceSquared(animal.position, other.position);
      if (d2 > 220 * 220) continue;
      neighbourCount += 1;
      centreX += other.position.x;
      centreY += other.position.y;
      headingX += other.velocity.x;
      headingY += other.velocity.y;
      const isSelectedCourtshipPair =
        mate?.id === other.id &&
        animal.courtshipPartnerId === other.id &&
        other.courtshipPartnerId === animal.id;
      if (d2 < 28 * 28 && d2 > 0.001 && !isSelectedCourtshipPair) {
        const d = Math.sqrt(d2);
        desiredX += (animal.position.x - other.position.x) / d * 28;
        desiredY += (animal.position.y - other.position.y) / d * 28;
      }
    }
    if (neighbourCount > 0 && !prey && !hungry) {
      centreX /= neighbourCount;
      centreY /= neighbourCount;
      desiredX += (centreX - animal.position.x) * 0.11 + headingX / neighbourCount * 0.12;
      desiredY += (centreY - animal.position.y) * 0.11 + headingY / neighbourCount * 0.12;
    }

    // Structure silhouettes block sight, but not the foreground/open-water
    // channel represented by the same 2-D coordinate. Treating every painted
    // rock as a full-depth wall created an invisible barrier and prevented a
    // fish that was too thick for a crevice from simply swimming in front.

    const pursuitSteeringScale = prey
      ? ricefishCanopyPursuitScale(
        this.ricefishShelterAt(prey.position),
        this.ricefishShelterAt(animal.position),
      )
      : 1;
    const steeringRate = prey
      ? 3.4 + pursuitSteeringScale * 6.1
      : mate && animal.sex === 'male'
        ? 5.6
        : 4.1;
    const response = 1 - Math.exp(-deltaSeconds * steeringRate);
    animal.velocity.x += (desiredX - animal.velocity.x) * response;
    animal.velocity.y += (desiredY - animal.velocity.y) * response;
    animal.position.x += animal.velocity.x * deltaSeconds;
    animal.position.y += animal.velocity.y * deltaSeconds;
    this.clampAnimalPoint(animal.position, animal.position);
    const preyHorizontalOffset = prey
      ? prey.position.x - animal.position.x
      : 0;
    if (prey) {
      // Braking beside prey can briefly reverse velocity without meaning the
      // fish has turned its head away. Only reverse after the prey is clearly
      // behind enough of the body for a visible turn.
      animal.facing = ricefishPursuitFacing(
        animal.facing,
        preyHorizontalOffset,
        animal.bodyLength,
      );
    } else {
      animal.facing = stableHorizontalFacing(
        animal.facing,
        animal.velocity.x,
      );
    }
    animal.poseAngle = prey
      ? clamp(
        Math.atan2(
          prey.position.y - animal.position.y,
          Math.max(12, Math.abs(preyHorizontalOffset)),
        ),
        -RICEFISH_MAXIMUM_POSE_ANGLE,
        RICEFISH_MAXIMUM_POSE_ANGLE,
      )
      : clamp(
        Math.atan2(
          animal.velocity.y,
          Math.max(12, Math.abs(animal.velocity.x)),
        ),
        -RICEFISH_MAXIMUM_POSE_ANGLE,
        RICEFISH_MAXIMUM_POSE_ANGLE,
      );
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
    const predatorDangerCueSites = this.predatorDangerCueSitesScratch;
    let predatorDangerCueCount = 0;
    for (const animal of this.animals) {
      if (
        animal.speciesId !== 'japanese-ricefish' ||
        animal.lifeStage === 'egg'
      ) continue;
      const site = predatorDangerCueSites[predatorDangerCueCount] ?? {
        point: { x: 0, y: 0 },
        strength: 0,
      };
      site.point.x = animal.position.x;
      site.point.y = animal.position.y;
      site.strength = animal.behavior === 'hunting' ? 0.16 : 0.06;
      predatorDangerCueSites[predatorDangerCueCount] = site;
      predatorDangerCueCount += 1;
    }
    predatorDangerCueSites.length = predatorDangerCueCount;
    const shrimpMateCueSites = this.shrimpMateCueSitesScratch;
    let shrimpMateCueCount = 0;
    for (const animal of this.animals) {
      if (
        animal.speciesId !== 'cherry-shrimp' ||
        animal.lifeStage !== 'adult' ||
        animal.sex !== 'female' ||
        animal.gestationRemaining !== null ||
        this.shrimpReserveCondition(animal) <
          SHRIMP_ECOLOGY_RULES.reproductionReserveFraction ||
        animal.matingAccumulator >= SHRIMP_MATING_SECONDS
      ) continue;
      const progress = animal.ovarianProgress ?? 0;
      if (progress < SHRIMP_MATE_CUE_EMISSION_START_PROGRESS) continue;
      const site = shrimpMateCueSites[shrimpMateCueCount] ?? {
        point: { x: 0, y: 0 },
        strength: 0,
      };
      site.point.x = animal.position.x;
      site.point.y = animal.position.y;
      site.strength = clamp01(
        (progress - SHRIMP_MATE_CUE_EMISSION_START_PROGRESS) /
          (1 - SHRIMP_MATE_CUE_EMISSION_START_PROGRESS),
      ) * animal.health;
      shrimpMateCueSites[shrimpMateCueCount] = site;
      shrimpMateCueCount += 1;
    }
    shrimpMateCueSites.length = shrimpMateCueCount;

    const cells = this.allCells();
    const reactionSites = this.biofilmReactionSitesScratch;
    const shrimpFoodCueSites = this.shrimpFoodCueSitesScratch;
    let reactionSiteCount = 0;
    let shrimpFoodCueCount = 0;
    const hasShrimp = this.animals.some(
      (animal) => animal.speciesId === 'cherry-shrimp',
    );
    // Food can only reach a surface after an algae or microbial inoculation.
    // Skip four diet-component reads per bare cell in empty layout and
    // rendering-performance fixtures.
    const surfaceFoodMayExist = hasShrimp && (
      this.seedPlacements.some(
        (placement) => placement.speciesId !== 'vallisneria',
      ) ||
      this.microbeInventoryUsed.decomposer > 0 ||
      this.microbeInventoryUsed.nitrifier > 0
    );
    for (const cell of cells) {
      const point = this.cellWorldPoint(cell);
      const reactionSite = reactionSites[reactionSiteCount] ?? {
        point: { x: 0, y: 0 },
        biofilm: cell.biofilm,
      };
      reactionSite.point.x = point.x;
      reactionSite.point.y = point.y;
      reactionSite.biofilm = cell.biofilm;
      reactionSites[reactionSiteCount] = reactionSite;
      reactionSiteCount += 1;
      if (!surfaceFoodMayExist) continue;
      const strength = this.edibleBiomass(cell);
      if (strength > 0) {
        const foodSite = shrimpFoodCueSites[shrimpFoodCueCount] ?? {
          point: { x: 0, y: 0 },
          strength: 0,
        };
        foodSite.point.x = point.x;
        foodSite.point.y = point.y;
        foodSite.strength = strength;
        shrimpFoodCueSites[shrimpFoodCueCount] = foodSite;
        shrimpFoodCueCount += 1;
      }
    }
    reactionSites.length = reactionSiteCount;
    shrimpFoodCueSites.length = shrimpFoodCueCount;

    this.biogeochemistry.advance(
      deltaSeconds,
      reactionSites,
      shrimpMateCueSites,
      shrimpFoodCueSites,
      predatorDangerCueSites,
    );
    if (this.probe) this.setProbe(this.probe);
  }

  /**
   * Captures nitrifier demand before producers, grazers or decomposers alter
   * this ecology step's dissolved ammonium. Producer demand is added by
   * stepGrowth once its actual light-limited fixation requests are known.
   */
  private beginAmmoniumCompetition(deltaSeconds: number): void {
    const sites = this.biofilmReactionSitesScratch;
    const cells = this.allCells();
    let siteCount = 0;
    for (const cell of cells) {
      const point = this.cellWorldPoint(cell);
      const site = sites[siteCount] ?? {
        point: { x: 0, y: 0 },
        biofilm: cell.biofilm,
      };
      site.point.x = point.x;
      site.point.y = point.y;
      site.biofilm = cell.biofilm;
      sites[siteCount] = site;
      siteCount += 1;
    }
    sites.length = siteCount;
    this.biogeochemistry.beginAmmoniumCompetition(deltaSeconds, sites);
  }

  private stepBiofilmDispersal(deltaSeconds: number): void {
    if (!this.biogeochemistry.effectsEnabled || deltaSeconds <= 0) return;
    const cells = this.allCells();
    const cellIndexById = this.biofilmCellIndexByIdScratch;
    cellIndexById.clear();
    let maximumTransferCount = 0;
    for (let index = 0; index < cells.length; index += 1) {
      const cell = cells[index];
      cellIndexById.set(cell.id, index);
      // An undirected edge can propose two guild transfers; the sum of the
      // directed neighbor counts is exactly that upper bound.
      maximumTransferCount += cell.neighborIds.length;
    }
    if (this.biofilmTransferAmountScratch.length < maximumTransferCount) {
      this.biofilmTransferSourceScratch = new Int32Array(maximumTransferCount);
      this.biofilmTransferReceiverScratch = new Int32Array(maximumTransferCount);
      this.biofilmTransferGuildScratch = new Uint8Array(maximumTransferCount);
      this.biofilmTransferAmountScratch = new Float64Array(maximumTransferCount);
    }
    if (this.biofilmIncomingDemandScratch.length !== cells.length) {
      this.biofilmIncomingDemandScratch = new Float64Array(cells.length);
      this.biofilmOutgoingDemandScratch = new Float64Array(cells.length * 2);
    }
    const transferSources = this.biofilmTransferSourceScratch;
    const transferReceivers = this.biofilmTransferReceiverScratch;
    const transferGuilds = this.biofilmTransferGuildScratch;
    const transferAmounts = this.biofilmTransferAmountScratch;
    let transferCount = 0;

    for (let cellIndex = 0; cellIndex < cells.length; cellIndex += 1) {
      const cell = cells[cellIndex];
      for (const neighborId of cell.neighborIds) {
        if (cell.id >= neighborId) continue;
        const neighborIndex = cellIndexById.get(neighborId);
        if (neighborIndex === undefined) continue;
        const neighbor = cells[neighborIndex];
        for (let guildIndex = 0; guildIndex < 2; guildIndex += 1) {
          const guildId: MicrobeGuildId = guildIndex === 0
            ? 'decomposer'
            : 'nitrifier';
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
          if (amount <= 0) continue;
          transferSources[transferCount] = difference > 0 ? cellIndex : neighborIndex;
          transferReceivers[transferCount] = difference > 0 ? neighborIndex : cellIndex;
          transferGuilds[transferCount] = guildIndex;
          transferAmounts[transferCount] = amount;
          transferCount += 1;
        }
      }
    }

    const incomingDemand = this.biofilmIncomingDemandScratch;
    const outgoingDemand = this.biofilmOutgoingDemandScratch;
    incomingDemand.fill(0);
    outgoingDemand.fill(0);
    for (let index = 0; index < transferCount; index += 1) {
      const amount = transferAmounts[index];
      incomingDemand[transferReceivers[index]] += amount;
      outgoingDemand[transferSources[index] * 2 + transferGuilds[index]] += amount;
    }
    for (let index = 0; index < transferCount; index += 1) {
      const sourceIndex = transferSources[index];
      const receiverIndex = transferReceivers[index];
      const guildIndex = transferGuilds[index];
      const guildId: MicrobeGuildId = guildIndex === 0
        ? 'decomposer'
        : 'nitrifier';
      const source = cells[sourceIndex];
      const receiver = cells[receiverIndex];
      const receiverCapacity = Math.max(
        0,
        1 - receiver.biofilm.decomposer - receiver.biofilm.nitrifier,
      );
      const receiverDemand = incomingDemand[receiverIndex];
      if (receiverDemand > receiverCapacity && receiverDemand > 0) {
        transferAmounts[index] *= receiverCapacity / receiverDemand;
      }
      const sourceDemand = outgoingDemand[sourceIndex * 2 + guildIndex];
      const available = source.biofilm[guildId];
      if (sourceDemand > available && sourceDemand > 0) {
        transferAmounts[index] *= available / sourceDemand;
      }
    }
    for (let index = 0; index < transferCount; index += 1) {
      const source = cells[transferSources[index]];
      const receiver = cells[transferReceivers[index]];
      const guildId: MicrobeGuildId = transferGuilds[index] === 0
        ? 'decomposer'
        : 'nitrifier';
      const amount = transferAmounts[index];
      source.biofilm[guildId] = Math.max(
        0,
        source.biofilm[guildId] - amount,
      );
      receiver.biofilm[guildId] += amount;
    }

    // A small viable fraction leaves mature films, is carried by unresolved
    // tank circulation, and can establish on a disconnected wetted surface.
    // This is mass-conserving: every suspended propagule is removed from a
    // source film first, then either settles or loses viability.
    for (const cell of cells) {
      for (let guildIndex = 0; guildIndex < 2; guildIndex += 1) {
        const guildId: MicrobeGuildId = guildIndex === 0
          ? 'decomposer'
          : 'nitrifier';
        const kinetics = MICROBE_ECOLOGY_RULES[guildId];
        const detached = cell.biofilm[guildId] *
          (1 - Math.exp(-kinetics.waterborneExportRate * deltaSeconds));
        if (detached <= 0) continue;
        cell.biofilm[guildId] = Math.max(0, cell.biofilm[guildId] - detached);
        if (guildId === 'decomposer') {
          this.biogeochemistry.addPlanktonicDecomposer(
            this.cellWorldPoint(cell),
            detached,
          );
        } else {
          this.suspendedBiofilm.nitrifier += detached;
        }
      }
    }

    for (let guildIndex = 0; guildIndex < 2; guildIndex += 1) {
      const guildId: MicrobeGuildId = guildIndex === 0
        ? 'decomposer'
        : 'nitrifier';
      const kinetics = MICROBE_ECOLOGY_RULES[guildId];
      if (guildId === 'nitrifier') {
        const suspendedBeforeDecay = this.suspendedBiofilm.nitrifier;
        this.suspendedBiofilm.nitrifier *= Math.exp(
          -kinetics.suspendedDecayRate * deltaSeconds,
        );
        this.biogeochemistry.recordSuspendedBiomassDeath(
          { x: this.tank.width / 2, y: (this.tank.waterTop + this.tank.groundY) / 2 },
          suspendedBeforeDecay - this.suspendedBiofilm.nitrifier,
        );
      }
      // Preserve the authored attempts-per-simulated-second at every worker
      // speed. `max(1, round(rate * dt))` ran four attempts/s at the ordinary
      // 0.25-s ecology step but only two attempts/s at the fast 1-s step.
      // Carry the fractional attempt instead of manufacturing one each call.
      const accumulatedAttempts =
        this.biofilmSettlementAttemptAccumulator[guildId] +
        MICROBE_ECOLOGY_RULES.settlementAttemptsPerSecond * deltaSeconds;
      const attempts = Math.floor(accumulatedAttempts + 1e-12);
      this.biofilmSettlementAttemptAccumulator[guildId] =
        accumulatedAttempts - attempts;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const suspendedAvailable = guildId === 'decomposer'
          ? this.biogeochemistry.planktonicDecomposerMass()
          : this.suspendedBiofilm.nitrifier;
        if (suspendedAvailable <= 1e-8 || cells.length === 0) break;
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
          suspendedAvailable *
            MICROBE_ECOLOGY_RULES.settlementFractionPerAttempt,
        );
        const amount = Math.min(
          available,
          suspendedAvailable,
          offered * retention,
        );
        if (amount <= 0) continue;
        const settled = guildId === 'decomposer'
          ? this.biogeochemistry.removePlanktonicDecomposer(
            this.cellWorldPoint(receiver),
            amount,
          )
          : amount;
        receiver.biofilm[guildId] += settled;
        if (guildId === 'nitrifier') this.suspendedBiofilm.nitrifier -= settled;
      }
    }
  }

  private collectAnimalSpecies(speciesId: AnimalSpeciesId): AnimalState[] {
    const collected = this.ecologySpeciesAnimalsScratch;
    collected.length = 0;
    for (let index = 0; index < this.animals.length; index += 1) {
      const animal = this.animals[index];
      if (animal.speciesId === speciesId) collected.push(animal);
    }
    return collected;
  }

  /**
   * Preserve the former `[...nonSpecies, ...living, ...newborns]` ordering
   * while compacting the owned array in place.
   */
  private replaceAnimalSpecies(
    speciesId: AnimalSpeciesId,
    living: AnimalState[],
    newborns: AnimalState[],
  ): void {
    let writeIndex = 0;
    for (let readIndex = 0; readIndex < this.animals.length; readIndex += 1) {
      const animal = this.animals[readIndex];
      if (animal.speciesId === speciesId) continue;
      this.animals[writeIndex] = animal;
      writeIndex += 1;
    }
    for (let index = 0; index < living.length; index += 1) {
      this.animals[writeIndex] = living[index];
      writeIndex += 1;
    }
    for (let index = 0; index < newborns.length; index += 1) {
      this.animals[writeIndex] = newborns[index];
      writeIndex += 1;
    }
    this.animals.length = writeIndex;
    this.ecologySpeciesAnimalsScratch.length = 0;
    living.length = 0;
    newborns.length = 0;
  }

  private removeAnimalsById(ids: ReadonlySet<string>): void {
    if (!ids.size) return;
    let writeIndex = 0;
    for (let readIndex = 0; readIndex < this.animals.length; readIndex += 1) {
      const animal = this.animals[readIndex];
      if (ids.has(animal.id)) continue;
      this.animals[writeIndex] = animal;
      writeIndex += 1;
    }
    this.animals.length = writeIndex;
  }

  private stepAnimalEcology(deltaSeconds: number): void {
    if (this.carcasses.length) {
      let retainedCarcasses = 0;
      for (const carcass of this.carcasses) {
        carcass.ageSeconds += deltaSeconds;
        if (carcass.ageSeconds >= animalCarcassLifetimeSeconds(carcass.speciesId)) continue;
        this.carcasses[retainedCarcasses] = carcass;
        retainedCarcasses += 1;
      }
      this.carcasses.length = retainedCarcasses;
      if (
        this.selection?.kind === 'carcass' &&
        !this.carcasses.some((carcass) => carcass.id === this.selection?.carcassId)
      ) {
        this.selection = null;
      }
      this.snapshotDirty = true;
    }
    this.stepDaphniaEcology(deltaSeconds);
    this.stepRicefishEcology(deltaSeconds);
    if (!this.animals.length) return;
    const shrimpAnimals = this.collectAnimalSpecies('cherry-shrimp');
    if (!shrimpAnimals.length) return;
    const requestsByCell = this.shrimpGrazingRequestsByCellScratch;
    for (const requests of requestsByCell.values()) requests.length = 0;
    const environmentalDeathCauses =
      this.shrimpEnvironmentalDeathCausesScratch;
    const maintenanceRequests = this.shrimpMaintenanceRequestsScratch;
    environmentalDeathCauses.length = shrimpAnimals.length;
    maintenanceRequests.length = shrimpAnimals.length;

    for (
      let shrimpIndex = 0;
      shrimpIndex < shrimpAnimals.length;
      shrimpIndex += 1
    ) {
      const animal = shrimpAnimals[shrimpIndex];
      environmentalDeathCauses[shrimpIndex] = null;
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
      if (animal.sex === 'male') {
        animal.reproductionCooldown = Math.max(
          0,
          animal.reproductionCooldown -
            deltaSeconds * reproductionTemperatureFactor,
        );
      }
      animal.recentIntake *= Math.exp(
        -deltaSeconds / SHRIMP_RECENT_INTAKE_WINDOW_SECONDS,
      );
      const reserveCapacity = this.shrimpReserveCapacity(animal);
      const excessReserve = Math.max(
        0,
        animal.storedBiomass - reserveCapacity,
      );
      if (excessReserve > 0) {
        // Normalise older saves. Juveniles previously shared a fixed 0.09-B
        // compartment and could therefore keep more stored food than their
        // own body size justified. Released matter remains in the closed tank
        // as detritus rather than disappearing.
        animal.storedBiomass -= excessReserve;
        this.biogeochemistry.recordAnimalAssimilationOverflow(
          animal.position,
          excessReserve,
        );
      }
      animal.recentGrazingCellCooldown = Math.max(
        0,
        (animal.recentGrazingCellCooldown ?? 0) - deltaSeconds,
      );
      if (animal.recentGrazingCellCooldown <= 0) {
        animal.recentGrazingCellId = null;
      }
      animal.grazingSessionSeconds = animal.behavior === 'grazing'
        ? (animal.grazingSessionSeconds ?? 0) + deltaSeconds
        : 0;

      const stageScale = continuousBodyMassFeedingScale(
        animal.structuralBiomass,
        WATER_CYCLE_RULES.shrimp.adultStructuralBiomass,
        WATER_CYCLE_RULES.shrimp.feedingMassExponent,
      );
      const activityMultiplier = animal.behavior === 'traveling'
        ? SHRIMP_ECOLOGY_RULES.travelingActivityMultiplier
        : animal.behavior === 'starving'
          ? SHRIMP_ECOLOGY_RULES.starvingActivityMultiplier
          : animal.behavior === 'grazing' || animal.behavior === 'exploring'
            ? SHRIMP_ECOLOGY_RULES.grazingActivityMultiplier
            : SHRIMP_ECOLOGY_RULES.restingActivityMultiplier;
      const bodyMass = animal.structuralBiomass + animal.storedBiomass +
        animal.reproductiveBiomass;
      const adultReferenceMass =
        WATER_CYCLE_RULES.shrimp.adultStructuralBiomass +
        WATER_CYCLE_RULES.shrimp.suppliedReserveBiomass;
      maintenanceRequests[shrimpIndex] = continuousBodyMassMaintenance(
        bodyMass,
        adultReferenceMass,
        SHRIMP_ECOLOGY_RULES.adultRoutineMaintenanceBiomassPerSecond /
          adultReferenceMass,
        SHRIMP_ECOLOGY_RULES.metabolicMassExponent,
      ) * activityMultiplier *
        metabolicTemperatureFactor *
        deltaSeconds;
      animal.secondsSinceFood = Math.max(
        0,
        animal.secondsSinceFood + shrimpMaintenanceDeficitClockDelta(
          animal.recentIntake,
          maintenanceRequests[shrimpIndex] / Math.max(1e-9, deltaSeconds),
          deltaSeconds,
        ),
      );

      const localOxygen = this.biogeochemistry.effectsEnabled
        ? this.biogeochemistry.oxygenAt(animal.position)
        : null;
      const localToxicWaste = this.biogeochemistry.effectsEnabled
        ? this.biogeochemistry.toxicWasteAt(animal.position)
        : null;
      const oxygenStress = localOxygen !== null
        ? clamp(
          (SHRIMP_OXYGEN_STRESS_START - localOxygen) /
            SHRIMP_OXYGEN_STRESS_START,
          0,
          1,
        )
        : 0;
      const toxicStress = localToxicWaste !== null
        ? clamp(
          (localToxicWaste - SHRIMP_TOXIC_STRESS_START) /
            (SHRIMP_TOXIC_STRESS_FULL - SHRIMP_TOXIC_STRESS_START),
          0,
          1,
        )
        : 0;
      const thermalStress = clamp(1 - thermalHealthSuitability, 0, 1);
      // Hunger is already represented by conserved reserve and body tissue.
      // Do not drain a second generic health pool for the same shortage.
      // Physiological health below is reserved for non-mass environmental
      // damage: hypoxia, ammonia toxicity, and thermal stress.
      const damageRate =
        Math.pow(oxygenStress, 1.35) *
          SHRIMP_ECOLOGY_RULES.oxygenMaximumDamagePerSecond +
        Math.pow(toxicStress, 1.25) *
          SHRIMP_ECOLOGY_RULES.toxicMaximumDamagePerSecond +
        Math.pow(thermalStress, 1.35) *
          temperatureProfile.maximumThermalDamagePerSecond;
      const recoveryRate = Math.max(
        0,
        1 - Math.max(
          oxygenStress,
          toxicStress,
          thermalStress,
        ),
      ) * SHRIMP_WATER_RECOVERY_RATE;
      animal.health = clamp01(
        animal.health + (recoveryRate - damageRate) * deltaSeconds,
      );
      if (animal.health <= 0) {
        const highestStress = Math.max(
          oxygenStress,
          toxicStress,
          thermalStress,
        );
        environmentalDeathCauses[shrimpIndex] =
          highestStress === thermalStress
            ? 'temperature'
            : highestStress === oxygenStress
              ? 'hypoxia'
              : 'toxicity';
      }

      const target = animal.targetCellId ? this.cellById(animal.targetCellId) : undefined;
      if (target && animal.behavior === 'grazing') {
        const targetPoint = this.shrimpSurfaceContactPoint(target);
        const distance = Math.sqrt(distanceSquared(animal.position, targetPoint));
        const food = this.edibleBiomass(target);
        if (
          food > 0 &&
          distance <= Math.max(SHRIMP_GRAZE_DISTANCE, target.cellSize * 1.4)
        ) {
          const requested = SHRIMP_BITE_RATE *
            (
              food /
              (food +
                WATER_CYCLE_RULES.shrimp.grazingHalfSaturationBiomass)
            ) *
            deltaSeconds * stageScale;
          const nitzschiaWeight = Math.max(0, target.biomass.nitzschia);
          const oedogoniumWeight =
            Math.max(0, target.biomass.oedogonium) *
              SHRIMP_OEDOGONIUM_FOOD_QUALITY;
          const decomposerWeight =
            Math.max(0, target.biofilm.decomposer) *
            SHRIMP_DECOMPOSER_FOOD_WEIGHT;
          const nitrifierWeight =
            Math.max(0, target.biofilm.nitrifier) *
            SHRIMP_NITRIFIER_FOOD_WEIGHT;
          const algaeWeight = nitzschiaWeight + oedogoniumWeight;
          const biofilmWeight = decomposerWeight + nitrifierWeight;
          const totalWeight = algaeWeight + biofilmWeight;
          if (totalWeight > 0) {
            // Food weights already express preference and nutritional
            // accessibility. A fixed minimum algae share made a shrimp spend
            // most of every bite on a trace algal remnant even when edible
            // biofilm was abundant, causing starvation beside visible food.
            const algaeShare = algaeWeight <= 0
              ? 0
              : biofilmWeight <= 0
                ? 1
                : algaeWeight / totalWeight;
            const biofilmShare = 1 - algaeShare;
            const nitzschiaShare = algaeWeight > 0
              ? algaeShare * (nitzschiaWeight / algaeWeight)
              : 0;
            const oedogoniumShare = algaeWeight > 0
              ? algaeShare * (oedogoniumWeight / algaeWeight)
              : 0;
            const decomposerShare = biofilmWeight > 0
              ? biofilmShare * (decomposerWeight / biofilmWeight)
              : 0;
            const nitrifierShare = biofilmWeight > 0
              ? biofilmShare * (nitrifierWeight / biofilmWeight)
              : 0;
            const expectedFoodQuality =
              nitzschiaShare +
              oedogoniumShare * SHRIMP_OEDOGONIUM_FOOD_QUALITY +
              decomposerShare * SHRIMP_DECOMPOSER_FOOD_WEIGHT +
              nitrifierShare * SHRIMP_NITRIFIER_FOOD_WEIGHT;
            const assimilationDemand = this.shrimpAssimilationDemandForStep(
              animal,
              maintenanceRequests[shrimpIndex] ?? 0,
              reproductionTemperatureFactor,
              deltaSeconds,
            );
            // The type-II response describes encounter/processing capacity,
            // not permission to assimilate many times the matter the animal
            // can use. Bound the raw bite by this individual's current
            // reserve and allocation demand. Positive traces remain edible;
            // this only prevents a full reproductive female from stripping a
            // patch and sending almost the whole assimilated bite straight
            // back to detritus.
            const demandLimitedRequest = Math.min(
              requested,
              assimilationDemand /
                Math.max(
                  1e-9,
                  WATER_CYCLE_RULES.shrimp.assimilationFraction *
                    expectedFoodQuality,
                ),
            );
            const request = this.shrimpGrazingRequestsScratch[shrimpIndex] ??
              {} as GrazingRequest;
            this.shrimpGrazingRequestsScratch[shrimpIndex] = request;
            request.animal = animal;
            request.cell = target;
            request.nitzschia = demandLimitedRequest * nitzschiaShare;
            request.oedogonium = demandLimitedRequest * oedogoniumShare;
            request.decomposer = demandLimitedRequest * decomposerShare;
            request.nitrifier = demandLimitedRequest * nitrifierShare;
            const requests = requestsByCell.get(target.id) ?? [];
            requests.push(request);
            if (!requestsByCell.has(target.id)) {
              requestsByCell.set(target.id, requests);
            }
          }
        }
      }
    }

    for (const requests of requestsByCell.values()) {
      if (requests.length === 0) continue;
      const cell = requests[0].cell;
      let totalNitzschia = 0;
      let totalOedogonium = 0;
      let totalDecomposer = 0;
      let totalNitrifier = 0;
      for (let index = 0; index < requests.length; index += 1) {
        const request = requests[index];
        totalNitzschia += request.nitzschia;
        totalOedogonium += request.oedogonium;
        totalDecomposer += request.decomposer;
        totalNitrifier += request.nitrifier;
      }
      // Share simultaneous requests proportionally, but never protect a
      // hidden remnant. If the combined bite demand reaches the standing
      // biomass, every last unit is removed and the rendered cell becomes
      // exactly empty.
      const availableNitzschia = Math.max(0, cell.biomass.nitzschia);
      const availableOedogonium = Math.max(0, cell.biomass.oedogonium);
      const availableDecomposer = Math.max(0, cell.biofilm.decomposer);
      const availableNitrifier = Math.max(0, cell.biofilm.nitrifier);
      const nitzschiaScale = totalNitzschia > 0
        ? completeDepletionScale(
          availableNitzschia,
          totalNitzschia,
        )
        : 0;
      const oedogoniumScale = totalOedogonium > 0
        ? completeDepletionScale(
          availableOedogonium,
          totalOedogonium,
        )
        : 0;
      const decomposerScale = totalDecomposer > 0
        ? completeDepletionScale(
          availableDecomposer,
          totalDecomposer,
        )
        : 0;
      const nitrifierScale = totalNitrifier > 0
        ? completeDepletionScale(
          availableNitrifier,
          totalNitrifier,
        )
        : 0;
      let consumedNitzschia = 0;
      let consumedOedogonium = 0;
      let consumedDecomposer = 0;
      let consumedNitrifier = 0;
      for (const request of requests) {
        const actualNitzschia = request.nitzschia * nitzschiaScale;
        const actualOedogonium = request.oedogonium * oedogoniumScale;
        const actualDecomposer = request.decomposer * decomposerScale;
        const actualNitrifier = request.nitrifier * nitrifierScale;
        const consumed = actualNitzschia + actualOedogonium +
          actualDecomposer + actualNitrifier;
        const digestibleFoodEquivalent = actualNitzschia +
          actualOedogonium * SHRIMP_OEDOGONIUM_FOOD_QUALITY +
          actualDecomposer * SHRIMP_DECOMPOSER_FOOD_WEIGHT +
          actualNitrifier * SHRIMP_NITRIFIER_FOOD_WEIGHT;
        consumedNitzschia += actualNitzschia;
        consumedOedogonium += actualOedogonium;
        consumedDecomposer += actualDecomposer;
        consumedNitrifier += actualNitrifier;
        // Recent nutritional state and ovarian progress must follow the food
        // that can actually be assimilated. Previously these used raw grazed
        // mass, so a dense decomposer/nitrifier film that was absent from the
        // producer graph could fund reproduction exactly like diatoms.
        request.animal.recentIntake += digestibleFoodEquivalent;
        request.animal.consumedBiomass += consumed;
        request.animal.grazingSessionIntake += digestibleFoodEquivalent;
        this.totalAlgaeConsumed += actualNitzschia + actualOedogonium;
        request.animal.recentFood =
          actualNitzschia + actualOedogonium >=
            actualDecomposer + actualNitrifier
            ? actualNitzschia >= actualOedogonium
              ? '표면 규조류'
              : '붓뚜껑말'
            : '생물막';
        const assimilated = this.biogeochemistry.recordAnimalFeeding(
          request.animal.position,
          consumed,
          'shrimp',
          consumed > 0 ? digestibleFoodEquivalent / consumed : 0,
        );
        // Assimilation enters a transient reserve first. Maintenance, somatic
        // growth and ovarian provisioning below must be allowed to spend the
        // current meal before anything still above the physical reserve
        // capacity is returned to detritus. Overflowing here made a full but
        // actively reproducing female discard usable food immediately, then
        // drain her pre-existing reserve for costs later in the same tick.
        request.animal.storedBiomass += assimilated;
      }
      // Do not leave a floating-point crumb after a bite that demanded the
      // whole patch. Exact depletion is ecologically meaningful here: the
      // cell has no food and its visual layer must disappear completely.
      cell.biomass.nitzschia = totalNitzschia >= availableNitzschia
        ? 0
        : Math.max(0, availableNitzschia - consumedNitzschia);
      cell.biomass.oedogonium = totalOedogonium >= availableOedogonium
        ? 0
        : Math.max(0, availableOedogonium - consumedOedogonium);
      cell.biofilm.decomposer = totalDecomposer >= availableDecomposer
        ? 0
        : Math.max(0, availableDecomposer - consumedDecomposer);
      cell.biofilm.nitrifier = totalNitrifier >= availableNitrifier
        ? 0
        : Math.max(0, availableNitrifier - consumedNitrifier);
    }

    const newborns = this.ecologyNewbornAnimalsScratch;
    const living = this.ecologyLivingAnimalsScratch;
    newborns.length = 0;
    living.length = 0;
    for (
      let shrimpIndex = 0;
      shrimpIndex < shrimpAnimals.length;
      shrimpIndex += 1
    ) {
      const animal = shrimpAnimals[shrimpIndex];
      const temperature = this.biogeochemistry.temperatureAt(animal.position);
      const temperatureProfile = ANIMALS[animal.speciesId].temperature;
      const reproductionTemperatureFactor = interpolateTemperatureResponse(
        temperatureProfile.reproductionCurve,
        temperature,
      );
      const maintenanceRequest = maintenanceRequests[shrimpIndex] ?? 0;
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

      const environmentalDeathCause =
        environmentalDeathCauses[shrimpIndex];
      if (environmentalDeathCause) {
        this.killAnimal(animal, environmentalDeathCause);
        continue;
      }

      // Every shrimp carries one birth-to-death deadline. Maturation can be
      // delayed by food, but reaching it late must not reset the biological
      // clock and grant an additional adult lifespan.
      if (animal.ageSeconds >= animal.lifespanSeconds) {
        this.killAnimal(animal, 'old-age');
        continue;
      }

      if (animal.lifeStage === 'juvenile') {
        const birthBiomass = WATER_CYCLE_RULES.shrimp.juvenileBirthBiomass;
        const maturationBiomass =
          SHRIMP_ECOLOGY_RULES.maturationStructuralBiomass;
        const maturationTargetSeconds =
          animal.maturationTargetSeconds ??
          shrimpMaturationTargetSeconds(animal.randomSeed);
        animal.maturationTargetSeconds = maturationTargetSeconds;
        const maximumGrowth = this.shrimpJuvenileGrowthAllowance(
          animal,
          deltaSeconds,
          reproductionTemperatureFactor,
        );
        const materialUsed = Math.min(
          Math.max(0, maturationBiomass - animal.structuralBiomass),
          maximumGrowth,
          Math.max(
            0,
            animal.storedBiomass -
              this.shrimpJuvenileGrowthReserveFloor(animal),
          ),
        );
        animal.storedBiomass -= materialUsed;
        animal.structuralBiomass += materialUsed;
        animal.peakStructuralBiomass = Math.max(
          animal.peakStructuralBiomass ?? 0,
          animal.structuralBiomass,
        );
        animal.growthProgress = clamp01(
          (animal.structuralBiomass - birthBiomass) /
            (maturationBiomass - birthBiomass),
        );
        animal.bodyLength = SHRIMP_JUVENILE_LENGTH +
          (SHRIMP_ADULT_LENGTH - SHRIMP_JUVENILE_LENGTH) * animal.growthProgress;
        if (
          animal.ageSeconds >= maturationTargetSeconds &&
          animal.growthProgress >= 1 &&
          animal.storedBiomass >= SHRIMP_MATURATION_RESERVE_BIOMASS
        ) {
          animal.lifeStage = 'adult';
          animal.bodyLength = SHRIMP_ADULT_LENGTH;
          animal.reproductiveCycleIndex = 0;
          animal.ovarianClutchSize = animal.sex === 'female'
            ? shrimpClutchSizeForStructure(animal.structuralBiomass)
            : undefined;
          animal.ovarianProgress = animal.sex === 'female'
            ? deterministicNoise(animal.randomSeed * 0.091 + 47.3) *
              SHRIMP_ECOLOGY_RULES.newAdultOvarianProgressMaximum
            : 0;
          const ovarianCycleSeconds = shrimpOvarianCycleSeconds(
            animal.randomSeed,
            0,
          );
          animal.reproductionCooldown = animal.sex === 'female'
            ? (1 - animal.ovarianProgress) * ovarianCycleSeconds
            : 0;
          this.recordAnimalPopulationEvent('matured', animal);
        }
        this.synchroniseAnimalEnergy(animal);
      }

      if (animal.lifeStage === 'adult' && animal.sex === 'female') {
        animal.ovarianClutchSize ??=
          shrimpClutchSizeForStructure(animal.structuralBiomass);
        const cycleIndex = animal.reproductiveCycleIndex ?? 0;
        animal.reproductiveCycleIndex = cycleIndex;
        // N. davidi ovarian rematuration can proceed while the current brood
        // is carried. The locked embryo matter remains separate; only the
        // readiness of the next ovarian cycle overlaps gestation.
        const activeOvarianCycleIndex = animal.gestationRemaining !== null
          ? cycleIndex + 1
          : cycleIndex;
        const ovarianCycleSeconds = shrimpOvarianCycleSeconds(
          animal.randomSeed,
          activeOvarianCycleIndex,
        );
        const ovarianReserveCondition = this.shrimpReserveCondition(animal);
        const ovarianEnergyFactor = clamp(
          (
            ovarianReserveCondition -
              SHRIMP_ECOLOGY_RULES.ovarianProgressReserveFloor
          ) /
            Math.max(
              1e-6,
              SHRIMP_ECOLOGY_RULES.ovarianFullSpeedReserveFraction -
                SHRIMP_ECOLOGY_RULES.ovarianProgressReserveFloor,
            ),
          0,
          1,
        );
        const ovarianRecentIntakeRequirement =
          shrimpOvarianRecentIntakeRequirement(
            this.shrimpGrazingMaintenancePerSecond(animal),
            Math.min(
              SHRIMP_ECOLOGY_RULES.ovarianAllocationPerSecond,
              Math.max(
                0,
                this.shrimpOvarianMatterTarget(animal) -
                  animal.reproductiveBiomass,
              ) / Math.max(1e-9, deltaSeconds),
            ),
            WATER_CYCLE_RULES.shrimp.assimilationFraction,
            SHRIMP_RECENT_INTAKE_WINDOW_SECONDS,
          );
        const ovarianFoodFactor = clamp(
          animal.recentIntake / ovarianRecentIntakeRequirement,
          0,
          1,
        );
        animal.ovarianProgress = clamp01(
          (animal.ovarianProgress ?? 0) +
            deltaSeconds *
              reproductionTemperatureFactor *
              ovarianEnergyFactor *
              ovarianFoodFactor *
              animal.health /
              ovarianCycleSeconds,
        );
        animal.reproductionCooldown = Math.max(
          0,
          (1 - (animal.ovarianProgress ?? 0)) * ovarianCycleSeconds,
        );

        // Egg matter is a conserved transfer from somatic reserve. When the
        // next ovary rematures during incubation, its matter is provisioned at
        // the same time; ovarian progress is never a free head start. The
        // first brood remains locked in the leading brood-sized portion.
        const ovarianMatterTarget = this.shrimpOvarianMatterTarget(animal);
        if (
          ovarianEnergyFactor > 0 &&
          animal.reproductiveBiomass < ovarianMatterTarget
        ) {
          const reproductiveSomaticReserveFloor =
            SHRIMP_REPRODUCTIVE_ALLOCATION_PROTECTED_RESERVE_FRACTION *
            clamp(
              this.animalTargetStructuralBiomass(animal) /
                WATER_CYCLE_RULES.shrimp.adultStructuralBiomass,
              SHRIMP_ECOLOGY_RULES.maturationStructuralBiomass /
                WATER_CYCLE_RULES.shrimp.adultStructuralBiomass,
              1,
          );
          const allocationCondition =
            ovarianEnergyFactor * ovarianFoodFactor * animal.health *
            reproductionTemperatureFactor;
          const allocation = Math.min(
            Math.max(
              0,
              animal.storedBiomass - reproductiveSomaticReserveFloor,
            ),
            SHRIMP_ECOLOGY_RULES.ovarianAllocationPerSecond *
              allocationCondition * deltaSeconds,
            ovarianMatterTarget - animal.reproductiveBiomass,
          );
          animal.storedBiomass -= allocation;
          animal.reproductiveBiomass += allocation;
          this.synchroniseAnimalEnergy(animal);
        }
        if (animal.gestationRemaining !== null) {
          // Embryos were funded from the mother's conserved reserve when
          // mating completed. Development therefore follows temperature and
          // maternal health instead of stopping merely because the parents'
          // independent grazing bouts did not overlap inside one short recent-
          // intake window.
          const gestationCanAdvance =
            animal.health > 0.5 &&
            animal.reproductiveBiomass >= this.shrimpBroodBiomass(animal);
          if (gestationCanAdvance) {
            animal.gestationRemaining -= deltaSeconds * reproductionTemperatureFactor;
          }
          if (animal.gestationRemaining <= 0) {
            const desiredClutchSize = this.shrimpClutchSize(animal);
            const availableSlots = Math.max(
              0,
              SHRIMP_TECHNICAL_POPULATION_LIMIT - shrimpAnimals.length - newborns.length,
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
              animal.reproductiveCycleIndex = cycleIndex + 1;
              // The next brood is set by this female's size now, at the start
              // of her new ovarian cycle. It never follows another female's
              // timing or grows into a moving material target mid-cycle.
              animal.ovarianClutchSize =
                shrimpClutchSizeForStructure(animal.structuralBiomass);
              animal.reproductionCooldown = Math.max(
                0,
                (1 - (animal.ovarianProgress ?? 0)) *
                  shrimpOvarianCycleSeconds(
                    animal.randomSeed,
                    cycleIndex + 1,
                  ),
              );
              this.synchroniseAnimalEnergy(animal);
            } else {
              // This can only occur after loading an older save whose gestation
              // did not reserve a brood. Let the mother rebuild that conserved
              // material instead of creating offspring from nothing.
              animal.gestationRemaining = 0;
            }
          }
        } else if (
          (animal.ovarianProgress ?? 0) >= 1 &&
          this.shrimpReserveCondition(animal) >=
            SHRIMP_ECOLOGY_RULES.reproductionReserveFraction &&
          shrimpAnimals.length + newborns.length < SHRIMP_TECHNICAL_POPULATION_LIMIT
        ) {
          const matingWasComplete =
            animal.matingAccumulator >= SHRIMP_MATING_SECONDS;
          const eligibleMale = matingWasComplete
            ? undefined
            : shrimpAnimals.find((candidate) =>
              candidate.id !== animal.id &&
              candidate.speciesId === 'cherry-shrimp' &&
              candidate.lifeStage === 'adult' &&
              candidate.sex === 'male' &&
              this.shrimpReserveCondition(candidate) >=
                SHRIMP_ECOLOGY_RULES.maleReproductionReserveFraction &&
              candidate.reproductionCooldown <= 0 &&
              distanceSquared(candidate.position, animal.position) <=
                SHRIMP_MATING_ENCOUNTER_RADIUS * SHRIMP_MATING_ENCOUNTER_RADIUS,
            );
          if (eligibleMale) {
            animal.matingAccumulator = Math.min(
              SHRIMP_MATING_SECONDS,
              animal.matingAccumulator +
                deltaSeconds * reproductionTemperatureFactor,
            );
            if (
              !matingWasComplete &&
              animal.matingAccumulator >= SHRIMP_MATING_SECONDS
            ) {
              eligibleMale.reproductionCooldown =
                SHRIMP_MALE_POST_MATING_COOLDOWN;
            }
          } else if (!matingWasComplete) {
            animal.matingAccumulator = Math.max(
              0,
              animal.matingAccumulator - deltaSeconds,
            );
          }
          if (
            animal.matingAccumulator >= SHRIMP_MATING_SECONDS &&
            animal.reproductiveBiomass >= this.shrimpBroodBiomass(animal)
          ) {
            // Completed contact can precede the final transfer of conserved
            // egg matter. It represents retained sperm/contact readiness, not
            // a free brood: gestation still cannot begin until the mother's
            // complete locked clutch has been funded from actual food.
            animal.gestationRemaining = shrimpGestationSeconds(
              animal.randomSeed,
              cycleIndex,
            );
            // Embryos are now locked in the first brood-sized portion of
            // reproductiveBiomass. Readiness and conserved provisioning for
            // the following brood may both advance during gestation.
            animal.ovarianProgress = 0;
            animal.matingAccumulator = 0;
          }
        } else {
          if (animal.matingAccumulator < SHRIMP_MATING_SECONDS) {
            animal.matingAccumulator = Math.max(
              0,
              animal.matingAccumulator - deltaSeconds,
            );
          }
        }
      }

      if (
        animal.lifeStage === 'adult' &&
        animal.structuralBiomass <
          WATER_CYCLE_RULES.shrimp.adultStructuralBiomass &&
        (
          animal.sex === 'male' ||
          animal.reproductiveBiomass + 1e-9 >=
            this.shrimpBroodBiomass(animal)
        )
      ) {
        // Females first finish funding the already committed clutch. During
        // gestation, later feeding surplus can return to somatic growth. That
        // creates a real allocation trade-off without letting growth erase a
        // nearly completed brood target on every step.
        const growthReserveFloor =
          SHRIMP_REPRODUCTIVE_ALLOCATION_PROTECTED_RESERVE_FRACTION *
          animal.structuralBiomass;
        const adultGrowth = Math.min(
          WATER_CYCLE_RULES.shrimp.adultStructuralBiomass -
            animal.structuralBiomass,
          SHRIMP_ECOLOGY_RULES.adultSomaticGrowthPerSecond *
            reproductionTemperatureFactor * deltaSeconds,
          Math.max(0, animal.storedBiomass - growthReserveFloor),
        );
        animal.storedBiomass -= adultGrowth;
        animal.structuralBiomass += adultGrowth;
        animal.peakStructuralBiomass = Math.max(
          animal.peakStructuralBiomass ?? 0,
          animal.structuralBiomass,
        );
        this.synchroniseAnimalEnergy(animal);
      }

      // Only the portion left after this tick's real maintenance, growth and
      // reproduction costs is physiologically in excess. Keeping this final
      // capacity check in one place also avoids a stage-transition path that
      // discarded a juvenile's current meal before its adult allocation ran.
      const finalReserveCapacity = this.shrimpReserveCapacity(animal);
      const assimilationOverflow = Math.max(
        0,
        animal.storedBiomass - finalReserveCapacity,
      );
      if (assimilationOverflow > 0) {
        animal.storedBiomass -= assimilationOverflow;
        this.biogeochemistry.recordAnimalAssimilationOverflow(
          animal.position,
          assimilationOverflow,
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
    this.replaceAnimalSpecies('cherry-shrimp', living, newborns);
    this.snapshotDirty = true;
  }

  private stepDaphniaEcology(deltaSeconds: number): void {
    const daphnia = this.collectAnimalSpecies('daphnia');
    if (!daphnia.length) {
      this.syncDaphniaIndividuals();
      return;
    }
    const rules = PLANKTON_ECOLOGY_RULES.daphnia;
    const living = this.ecologyLivingAnimalsScratch;
    const newborns = this.ecologyNewbornAnimalsScratch;
    living.length = 0;
    newborns.length = 0;
    for (const animal of daphnia) {
      animal.ageSeconds += deltaSeconds;
      animal.recentIntake *= Math.exp(-deltaSeconds / 6);
      animal.secondsSinceFood += deltaSeconds;
      const local = this.biogeochemistry.planktonAt(
        animal.position,
        this.planktonSampleScratch,
      );
      // Suspended-food intake follows ordinary type-II saturation. At trace
      // concentrations intake becomes proportionally tiny but no hidden
      // uneatable food floor remains.
      const {
        phytoplanktonPotential: phytoResponse,
        combinedResponse,
        bacteriaShare,
      } = daphniaSuspendedFoodResponse(
        local.phytoplankton,
        local.planktonicDecomposer,
      );
      const bodyMass = Math.max(
        0,
        animal.structuralBiomass + animal.storedBiomass +
          animal.reproductiveBiomass,
      );
      // Apply one continuous allometric curve across the juvenile/adult
      // boundary. The former stage switch changed from M^b to M at
      // maturation, so the same body could abruptly lose filtration capacity
      // merely because its label changed. A continuous curve gives neonates
      // lower absolute but higher mass-specific clearance and leaves no
      // artificial maturation discontinuity.
      const filtrationBodyMass = animal.structuralBiomass <= 0
        ? 0
        : rules.representativeAdultBiomass *
          continuousBodyMassFeedingScale(
          animal.structuralBiomass,
          rules.adultStructuralBiomass,
          rules.filtrationMassExponent,
        );
      // Filtering limbs do not remain at full activity after the animal has
      // exhausted most of its transient reserve.  This is an individual
      // condition response: no population count, protected food floor or
      // tank-wide crowding signal is involved.
      const filtrationCondition = animal.energy >= rules.fullFiltrationEnergy
        ? 1
        : rules.minimumStarvedFiltrationFraction +
          (1 - rules.minimumStarvedFiltrationFraction) *
          Math.pow(
            clamp(
              animal.energy / Math.max(1e-9, rules.fullFiltrationEnergy),
              0,
              1,
            ),
            rules.filtrationConditionExponent,
          );
      const requestedFood = filtrationBodyMass *
        rules.maximumFiltrationPerBiomassSecond *
        combinedResponse * filtrationCondition * deltaSeconds;
      const consumed = this.biogeochemistry.consumeDaphniaFood(
        animal.position,
        requestedFood * (1 - bacteriaShare),
        requestedFood * bacteriaShare,
      );
      const assimilated = this.biogeochemistry.recordDaphniaFeeding(
        animal.position,
        consumed.phytoplankton,
        consumed.planktonicDecomposer,
      );
      // Reproduction must be funded by the food this individual actually
      // retained, not merely by a high ambient concentration sampled before
      // neighbouring animals had filtered the same patch. The distinction is
      // what lets ordinary local food competition reduce brood production
      // before a whole cohort strips the producer and crashes together.
      const currentPhytoplanktonAssimilation =
        consumed.phytoplankton * rules.phytoplanktonAssimilation;
      const currentBacterioplanktonAssimilation =
        consumed.planktonicDecomposer * rules.bacterioplanktonAssimilation;
      const predatorLifeHistoryResponse = clamp(
        this.biogeochemistry.predatorDangerCueAt(animal.position) /
          rules.predatorCueLifeHistorySaturation,
        0,
        1,
      );
      if (assimilated > 0) {
        // Assimilation enters a transient reserve first. Maintenance, somatic
        // growth and egg provisioning all draw from it below; only the amount
        // still above the final reserve capacity is egested afterward. The old
        // order overflowed a full reserve before paying this tick's costs,
        // turning usable food straight into detritus.
        animal.storedBiomass += assimilated;
        animal.recentIntake += consumed.phytoplankton +
          consumed.planktonicDecomposer;
        animal.consumedBiomass += consumed.phytoplankton +
          consumed.planktonicDecomposer;
        animal.secondsSinceFood = 0;
        animal.recentFood = consumed.phytoplankton >=
          consumed.planktonicDecomposer
          ? '식물플랑크톤'
          : '부유 분해균';
      }

      const temperature = this.biogeochemistry.temperatureAt(animal.position);
      const temperatureProfile = ANIMALS.daphnia.temperature;
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
      const maintenanceRequest = continuousBodyMassMaintenance(
        bodyMass,
        rules.representativeAdultBiomass,
        rules.adultMaintenancePerSecond,
        rules.maintenanceMassExponent,
      ) *
        metabolicTemperatureFactor * deltaSeconds;
      const minimumStructure = animal.lifeStage === 'juvenile'
        ? rules.juvenileMinimumStructure
        : rules.adultMinimumStructure;
      const availableForMaintenance = animal.storedBiomass +
        Math.max(0, animal.structuralBiomass - minimumStructure);
      const requestedRespiration = Math.min(
        maintenanceRequest,
        availableForMaintenance,
      );
      const respired = this.biogeochemistry.recordDaphniaRespiration(
        animal.position,
        requestedRespiration,
      );
      const maintenanceShortfall = Math.max(
        0,
        maintenanceRequest - respired,
      );
      const fromReserve = Math.min(animal.storedBiomass, respired);
      animal.storedBiomass -= fromReserve;
      animal.structuralBiomass = Math.max(
        0,
        animal.structuralBiomass - (respired - fromReserve),
      );
      const currentSomaticSurplus = Math.max(
        0,
        assimilated - maintenanceRequest,
      );

      if (animal.lifeStage === 'juvenile') {
        const instarTarget = animal.maturationTargetInstars ??
          daphniaMaturationInstarTarget(animal.randomSeed);
        animal.maturationTargetInstars = instarTarget;
        const effectiveInstarTarget = Math.max(
          1,
          instarTarget - Math.round(
            predatorLifeHistoryResponse *
              rules.predatorCueMaturationInstarReduction,
          ),
        );
        const effectiveMaturationStructure = Math.max(
          rules.adultMinimumStructure,
          rules.maturationStructuralBiomass * (
            1 -
                predatorLifeHistoryResponse *
                  rules.predatorCueMaturationStructureReductionFraction
          ),
        );
        const juvenileMoltSeconds = animal.moltCycleSeconds && animal.moltCycleSeconds > 0
          ? animal.moltCycleSeconds
          : daphniaJuvenileMoltCycleSeconds(
            animal.randomSeed,
            instarTarget,
          );
        animal.moltCycleSeconds = juvenileMoltSeconds;
        animal.moltProgress = (animal.moltProgress ?? 0) +
          deltaSeconds * reproductionTemperatureFactor /
            juvenileMoltSeconds;
        while ((animal.moltProgress ?? 0) >= 1) {
          animal.moltProgress = (animal.moltProgress ?? 0) - 1;
          animal.moltCount = (animal.moltCount ?? 0) + 1;
        }
        animal.reproductionCooldown =
          (1 - (animal.moltProgress ?? 0)) * juvenileMoltSeconds;

        // A neonate must keep a small metabolic reserve. Converting the entire
        // birth reserve into structure in the first few seconds made its energy
        // read zero and killed it before local filtration could fund growth.
        const juvenileMetabolicReserve = Math.min(
          rules.juvenileBirthBiomass * 0.3,
          rules.juvenileReserveCapacity *
            rules.juvenileProtectedReserveFraction,
        );
        const growth = Math.min(
          Math.max(0, animal.storedBiomass - juvenileMetabolicReserve),
          Math.max(0, rules.adultStructuralBiomass - animal.structuralBiomass),
          rules.juvenileGrowthPerSecond * deltaSeconds,
        );
        animal.storedBiomass -= growth;
        animal.structuralBiomass += growth;
        animal.growthProgress = clamp(
          animal.structuralBiomass / rules.adultStructuralBiomass,
          0,
          1,
        );
        animal.bodyLength = 4.6 + animal.growthProgress * 4.4;
        if (
          (animal.moltCount ?? 0) >= effectiveInstarTarget &&
          animal.structuralBiomass >= effectiveMaturationStructure
        ) {
          animal.lifeStage = 'adult';
          // Maturation is a label change at the animal's current conserved
          // structure, not a free jump to full adult size. Daphnia continue
          // indeterminate somatic growth after their first reproductive stage.
          animal.moltCount = Math.max(
            effectiveInstarTarget,
            animal.moltCount ?? effectiveInstarTarget,
          );
          animal.moltProgress = seededRange(
            animal.randomSeed * 0.097 + 53.7,
            0.55,
            0.9,
          );
          animal.moltCycleSeconds = daphniaAdultMoltCycleSeconds(
            animal.randomSeed,
            instarTarget,
          );
          animal.reproductionCooldown =
            (1 - animal.moltProgress) * animal.moltCycleSeconds;
          this.biogeochemistry.recordDaphniaMaturation();
          this.recordAnimalPopulationEvent('matured', animal);
        }
      } else {
        const priorMoltCount = animal.moltCount ??
          animal.maturationTargetInstars ??
          rules.maturationInstarsMinimum;
        const adultMoltSeconds = animal.moltCycleSeconds &&
            animal.moltCycleSeconds > 0
          ? animal.moltCycleSeconds
          : daphniaAdultMoltCycleSeconds(
            animal.randomSeed,
            priorMoltCount,
          );
        animal.moltCycleSeconds = adultMoltSeconds;
        animal.moltProgress = (animal.moltProgress ?? 0) +
          deltaSeconds * reproductionTemperatureFactor /
            adultMoltSeconds;
        const moltOccurred = (animal.moltProgress ?? 0) >= 1;
        if (moltOccurred) {
          animal.moltProgress = (animal.moltProgress ?? 0) - 1;
        }

        // A newly mature Daphnia is reproductive before reaching final adult
        // structure. Somatic growth and egg provisioning compete for the same
        // genuinely assimilated reserve; this transfer cannot create matter.
        const somaticReserveFloor =
          rules.reproductiveReserveFloor *
          clamp(
            animal.structuralBiomass / rules.adultStructuralBiomass,
            0.25,
            1,
          );
        const adultSomaticGrowth = Math.min(
          Math.max(0, animal.storedBiomass - somaticReserveFloor),
          Math.max(
            0,
            rules.adultStructuralBiomass - animal.structuralBiomass,
          ),
          rules.adultSomaticGrowthPerSecond * deltaSeconds,
          currentSomaticSurplus * (
            rules.adultSomaticGrowthAllocationFraction +
              (
                rules.predatorCueAdultSomaticGrowthAllocationFraction -
                rules.adultSomaticGrowthAllocationFraction
              ) * predatorLifeHistoryResponse
          ),
        );
        animal.storedBiomass -= adultSomaticGrowth;
        animal.structuralBiomass += adultSomaticGrowth;
        animal.growthProgress = clamp(
          animal.structuralBiomass / rules.adultStructuralBiomass,
          0,
          1,
        );
        animal.bodyLength = 4.6 + animal.growthProgress * 4.4;

        const adultSizeScale = clamp(
          animal.structuralBiomass / rules.adultStructuralBiomass,
          0.25,
          1,
        );
        const adultReserveCapacity =
          rules.adultReserveCapacity * adultSizeScale;
        const maternalReserveRatio = clamp(
          animal.storedBiomass / Math.max(1e-9, adultReserveCapacity),
          0,
          1,
        );
        const effectiveReproductionStartEnergy =
          rules.reproductionStartEnergy +
          (
            rules.predatorCueReproductionStartEnergy -
              rules.reproductionStartEnergy
          ) * predatorLifeHistoryResponse;
        // Food concentration alone is not enough to fund eggs: low-ration
        // females first lose somatic reserve and then provision progressively
        // fewer eggs. This is an individual condition response, not a
        // population-count limiter.
        const maternalCondition = clamp(
          (
            maternalReserveRatio -
            effectiveReproductionStartEnergy
          ) /
            Math.max(1e-6, 1 - effectiveReproductionStartEnergy),
          0,
          1,
        );
        const reserveAboveFloor = Math.max(
          0,
          animal.storedBiomass -
            Math.max(
              rules.reproductiveReserveFloor * adultSizeScale,
              adultReserveCapacity * effectiveReproductionStartEnergy,
            ),
        );
        // Bacterial food can cover part of maintenance, but it must not turn a
        // stored reserve into several delayed broods after phytoplankton has
        // already collapsed. Reproductive allocation follows the current
        // high-quality food response.
        const effectiveMinimumFoodQualityForReproduction =
          rules.minimumFoodQualityForReproduction +
          (
            rules.predatorCueMinimumFoodQualityForReproduction -
              rules.minimumFoodQualityForReproduction
          ) * predatorLifeHistoryResponse;
        const effectiveHighFoodBroodResponseThreshold =
          rules.highFoodBroodResponseThreshold +
          (
            rules.predatorCueHighFoodBroodResponseThreshold -
              rules.highFoodBroodResponseThreshold
          ) * predatorLifeHistoryResponse;
        const reproductiveFoodFactor = daphniaReproductionFoodFactor(
          phytoResponse,
          effectiveMinimumFoodQualityForReproduction,
          effectiveHighFoodBroodResponseThreshold,
          rules.reproductionFoodResponseExponent,
        );
        const lockedBroodBiomass =
          (animal.gestatingBroodSize ?? 0) *
          rules.juvenileBirthBiomass;
        // Low-quality bacterioplankton can pay part of somatic maintenance,
        // leaving genuinely assimilated phytoplankton available for eggs. It
        // still cannot create a brood on its own: the eligible surplus is
        // capped by this tick's phytoplankton assimilation. The former formula
        // subtracted the whole maintenance request from phytoplankton even
        // after bacterial food had already paid that cost, producing an
        // artificial reproductive cliff in mixed-food water.
        const maintenanceNotCoveredByBacteria = Math.max(
          0,
          maintenanceRequest - currentBacterioplanktonAssimilation,
        );
        const currentReproductiveSurplus = Math.max(
          0,
          currentPhytoplanktonAssimilation -
            maintenanceNotCoveredByBacteria,
        );
        const effectiveMaximumBroodSize = Math.round(
          rules.maximumBroodSize +
            (
              rules.predatorCueMaximumBroodSize -
                rules.maximumBroodSize
            ) * predatorLifeHistoryResponse,
        );
        // The brood chamber and ovary overlap in real time. Locked embryo mass
        // remains in this conserved compartment while current food can fund at
        // most one following fully funded brood. Nothing hatches from that
        // reserve until a later molt actually deposits and then releases it.
        const broodReserveCapacity = effectiveMaximumBroodSize *
          rules.juvenileBirthBiomass;
        const reproductiveCapacity =
          lockedBroodBiomass + broodReserveCapacity;
        const allocation = Math.min(
          reserveAboveFloor,
          Math.max(
            0,
            reproductiveCapacity - animal.reproductiveBiomass,
          ),
          rules.reproductionAllocationPerSecondIndividual *
            (
              1 +
                (
                  rules.predatorCueReproductionAllocationMultiplier - 1
                ) * predatorLifeHistoryResponse
            ) *
            reproductiveFoodFactor *
            maternalCondition * deltaSeconds,
          currentReproductiveSurplus *
            (
              1 -
                (
                  rules.adultSomaticGrowthAllocationFraction +
                    (
                      rules.predatorCueAdultSomaticGrowthAllocationFraction -
                      rules.adultSomaticGrowthAllocationFraction
                    ) * predatorLifeHistoryResponse
                )
            ),
        );
        animal.storedBiomass -= allocation;
        animal.reproductiveBiomass += allocation;
        if (animal.gestationRemaining !== null) {
          animal.gestationRemaining = Math.max(
            0,
            animal.gestationRemaining -
              deltaSeconds * reproductionTemperatureFactor,
          );
        }
        if (moltOccurred) {
          if (
            animal.gestationRemaining !== null &&
            animal.gestationRemaining <= 0
          ) {
            const desiredBrood =
              animal.gestatingBroodSize ?? rules.minimumBroodSize;
            const affordableBrood = Math.floor(
              animal.reproductiveBiomass / rules.juvenileBirthBiomass,
            );
            const broodSize = Math.min(
              desiredBrood,
              affordableBrood,
            );
            for (let index = 0; index < broodSize; index += 1) {
              const newborn = this.createJuvenileDaphniaState(animal, index);
              newborns.push(newborn);
              animal.reproductiveBiomass -= rules.juvenileBirthBiomass;
              this.biogeochemistry.recordDaphniaBirth(
                (animal.generation ?? 0) >= 1,
                rules.juvenileBirthBiomass,
              );
              this.recordAnimalPopulationEvent('birth', newborn, {
                parentId: animal.id,
              });
            }
            animal.gestationRemaining = null;
            animal.gestatingBroodSize = null;
          }
          if (
            animal.gestationRemaining === null &&
            animal.health >= 0.3 &&
            animal.reproductiveBiomass >=
              rules.minimumBroodSize * rules.juvenileBirthBiomass
          ) {
            const affordableBrood = Math.floor(
              animal.reproductiveBiomass /
                rules.juvenileBirthBiomass,
            );
            const highFoodBrood = phytoResponse >=
                effectiveHighFoodBroodResponseThreshold
              ? effectiveMaximumBroodSize
              : rules.minimumBroodSize;
            animal.gestatingBroodSize = Math.min(
              highFoodBrood,
              affordableBrood,
            );
            animal.gestationRemaining =
              rules.broodDevelopmentSeconds;
          }
          animal.moltCount = priorMoltCount + 1;
          animal.moltCycleSeconds = daphniaAdultMoltCycleSeconds(
            animal.randomSeed,
            animal.moltCount,
          );
        }
        animal.reproductionCooldown = Math.max(
          0,
          (1 - (animal.moltProgress ?? 0)) *
            (animal.moltCycleSeconds ?? adultMoltSeconds),
        );
      }

      const finalAdultSizeScale = clamp(
        animal.structuralBiomass / rules.adultStructuralBiomass,
        0.25,
        1,
      );
      const finalReserveCapacity = animal.lifeStage === 'juvenile'
        ? rules.juvenileReserveCapacity
        : rules.adultReserveCapacity * finalAdultSizeScale;
      const assimilationOverflow = Math.max(
        0,
        animal.storedBiomass - finalReserveCapacity,
      );
      if (assimilationOverflow > 0) {
        animal.storedBiomass -= assimilationOverflow;
        this.biogeochemistry.recordAnimalAssimilationOverflow(
          animal.position,
          assimilationOverflow,
        );
      }

      const localOxygen = this.biogeochemistry.effectsEnabled
        ? this.biogeochemistry.oxygenAt(animal.position)
        : null;
      const localToxicWaste = this.biogeochemistry.effectsEnabled
        ? this.biogeochemistry.toxicWasteAt(animal.position)
        : null;
      const oxygenStress = localOxygen !== null
        ? clamp((rules.oxygenStressStart - localOxygen) /
          rules.oxygenStressStart, 0, 1)
        : 0;
      const toxicityStress = localToxicWaste !== null
        ? clamp((localToxicWaste - rules.toxicWasteStressStart) /
          Math.max(1, 24 - rules.toxicWasteStressStart), 0, 1)
        : 0;
      const thermalSuitability = interpolateTemperatureResponse(
        temperatureProfile.healthCurve,
        temperature,
      );
      const adultSizeScale = clamp(
        animal.structuralBiomass / rules.adultStructuralBiomass,
        0.25,
        1,
      );
      const reserveCapacity = animal.lifeStage === 'juvenile'
        ? rules.juvenileReserveCapacity
        : rules.adultReserveCapacity * adultSizeScale;
      animal.energy = clamp(animal.storedBiomass / reserveCapacity, 0, 1);
      const reserveStress = clamp((0.18 - animal.energy) / 0.18, 0, 1);
      const feedingGapStress = clamp(
        (animal.secondsSinceFood - 30) / 150,
        0,
        1,
      );
      // A trace particle can reset secondsSinceFood without replacing the
      // animal's depleted reserve. Requiring both a long feeding gap and low
      // reserve therefore let a crowded cohort survive on negligible bites
      // until every member died of old age, continuing to suppress its food
      // throughout the whole interval. Reserve depletion is itself chronic
      // starvation; the feeding gap only makes that stress more acute.
      const starvationStress = reserveStress * (
        0.7 + feedingGapStress * 0.3
      );
      const damage = (
        oxygenStress * oxygenStress * rules.oxygenMaximumDamagePerSecond +
        toxicityStress * toxicityStress * rules.toxicMaximumDamagePerSecond +
        (1 - thermalSuitability) * 0.012 +
        starvationStress * rules.starvationMortalityPerSecond
      ) * deltaSeconds;
      const recovery = (
        oxygenStress <= 0 &&
        toxicityStress <= 0 &&
        thermalSuitability >= 0.75 &&
        animal.energy >= 0.18
      ) ? rules.healthyWaterRecoveryPerSecond * deltaSeconds : 0;
      animal.health = clamp(animal.health - damage + recovery, 0, 1);

      let deathCause: AnimalCarcassSnapshot['cause'] | null = null;
      const terminalStarvation =
        maintenanceShortfall > 1e-12 &&
        animal.storedBiomass <= 1e-9 &&
        animal.structuralBiomass <= minimumStructure + 1e-9;
      if (terminalStarvation) deathCause = 'starvation';
      else if (animal.ageSeconds >= animal.lifespanSeconds) deathCause = 'old-age';
      else if (animal.health <= 0) {
        deathCause = oxygenStress >= toxicityStress && oxygenStress > 0.35
          ? 'hypoxia'
          : toxicityStress > 0.35
            ? 'toxicity'
            : thermalSuitability < 0.3
              ? 'temperature'
              : 'starvation';
      }
      if (deathCause) {
        this.killAnimal(animal, deathCause);
      } else {
        living.push(animal);
      }
    }
    this.replaceAnimalSpecies('daphnia', living, newborns);
    this.syncDaphniaIndividuals();
    this.snapshotDirty = true;
  }

  private stepRicefishEcology(deltaSeconds: number): void {
    const ricefish = this.collectAnimalSpecies('japanese-ricefish');
    if (!ricefish.length) return;
    const rules = RICEFISH_ECOLOGY_RULES;
    const eatenAnimalIds = this.ecologyEatenAnimalIdsScratch;
    const newbornEggs = this.ecologyNewbornAnimalsScratch;
    const livingFish = this.ecologyLivingAnimalsScratch;
    eatenAnimalIds.clear();
    newbornEggs.length = 0;
    livingFish.length = 0;
    let daphniaPredationOccurred = false;

    for (const fish of ricefish) {
      fish.ageSeconds += deltaSeconds;
      const gutReferenceBiomass = ricefishGutCapacityReferenceBiomass(
        fish.lifeStage,
        fish.ageSeconds,
        fish.structuralBiomass,
        fish.peakStructuralBiomass ?? fish.structuralBiomass,
      );
      const gutSignalCapacity = Math.max(
        1e-9,
        gutReferenceBiomass * rules.gutCapacityStructuralFraction,
      );
      fish.recentIntake = Math.min(
        gutSignalCapacity,
        ricefishEvacuatedRecentIntake(
          fish.recentIntake,
          deltaSeconds,
          ricefishGutEvacuationSecondsForStructure(
            fish.lifeStage,
            fish.structuralBiomass,
          ),
        ),
      );
      fish.secondsSinceFood += deltaSeconds;
      const temperature = this.biogeochemistry.temperatureAt(fish.position);
      const profile = ANIMALS[fish.speciesId].temperature;
      const metabolicTemperatureFactor = thetaTemperatureFactor(
        temperature,
        profile.referenceTemperature,
        profile.metabolicTheta,
        profile.minimumMetabolicFactor,
        profile.maximumMetabolicFactor,
      );
      const reproductionTemperatureFactor = interpolateTemperatureResponse(
        profile.reproductionCurve,
        temperature,
      );
      const thermalSuitability = interpolateTemperatureResponse(
        profile.healthCurve,
        temperature,
      );
      fish.reproductionCooldown = Math.max(
        0,
        fish.reproductionCooldown - deltaSeconds * reproductionTemperatureFactor,
      );

      const localOxygen = this.biogeochemistry.effectsEnabled
        ? this.biogeochemistry.oxygenAt(fish.position)
        : null;
      const localToxicWaste = this.biogeochemistry.effectsEnabled
        ? this.biogeochemistry.toxicWasteAt(fish.position)
        : null;
      const oxygenStress = localOxygen !== null
        ? clamp(
          (rules.oxygenStressStart - localOxygen) /
            rules.oxygenStressStart,
          0,
          1,
        )
        : 0;
      const toxicStress = localToxicWaste !== null
        ? clamp(
          (localToxicWaste - rules.toxicWasteStressStart) /
            (rules.toxicWasteFullStress - rules.toxicWasteStressStart),
          0,
          1,
        )
        : 0;
      const thermalStress = clamp(1 - thermalSuitability, 0, 1);
      const peakStructure = fish.lifeStage === 'egg'
        ? fish.structuralBiomass
        : Math.max(
          fish.structuralBiomass,
          fish.peakStructuralBiomass ?? fish.structuralBiomass,
        );
      fish.peakStructuralBiomass = fish.lifeStage === 'egg'
        ? fish.peakStructuralBiomass
        : peakStructure;
      const reserveCapacity = fish.lifeStage === 'egg'
        ? 0
        : this.ricefishReserveCapacity(fish);
      const reserveCondition = fish.lifeStage === 'egg'
        ? 1
        : clamp01(
          fish.storedBiomass / Math.max(1e-9, reserveCapacity),
        );
      const reserveStarvationStress = fish.lifeStage === 'egg'
        ? 0
        : clamp(
          (
            rules.starvationReserveStressStartFraction -
              reserveCondition
          ) / Math.max(
            1e-9,
            rules.starvationReserveStressStartFraction,
          ),
          0,
          1,
        );
      const feedingGapStress = fish.lifeStage === 'egg'
        ? 0
        : clamp(
          (
            fish.secondsSinceFood -
              rules.starvationFeedingGapGraceSeconds
          ) / Math.max(
            1,
            rules.starvationFeedingGapFullSeconds -
              rules.starvationFeedingGapGraceSeconds,
          ),
          0,
          1,
        );
      const structuralCondition = fish.lifeStage === 'egg'
        ? 1
        : clamp01(
          fish.structuralBiomass / Math.max(1e-9, peakStructure),
        );
      const structuralStarvationStress = fish.lifeStage === 'egg'
        ? 0
        : clamp(
          (
            rules.starvationStructuralStressStartFraction -
              structuralCondition
          ) / Math.max(
            1e-9,
            rules.starvationStructuralStressStartFraction -
              rules.starvationMinimumStructuralFraction,
          ),
          0,
          1,
        );
      // Empty short-term reserve is already paid for by catabolising conserved
      // body structure below. Do not begin at the former 72% of maximum health
      // damage merely because a naturally intermittent hunter is between
      // meals. A prolonged empty reserve still causes real condition loss,
      // while sustained wasting toward the individual's minimum viable
      // structure makes it progressively acute.
      const starvationStress =
        reserveStarvationStress * feedingGapStress * (
        0.55 + structuralStarvationStress * 0.45
      );
      const damageRate =
        Math.pow(oxygenStress, 1.35) * rules.oxygenMaximumDamagePerSecond +
        Math.pow(toxicStress, 1.25) * rules.toxicMaximumDamagePerSecond +
        Math.pow(thermalStress, 1.35) * profile.maximumThermalDamagePerSecond +
        starvationStress * rules.starvationMaximumDamagePerSecond;
      const recovery = Math.max(
        0,
        1 - Math.max(
          oxygenStress,
          toxicStress,
          thermalStress,
          starvationStress,
        ),
      ) * rules.healthyWaterRecoveryPerSecond;
      const feedingDiagnostic = this.ricefishForagingDiagnostic(fish);
      if (feedingDiagnostic) {
        feedingDiagnostic.starvationHealthDamage +=
          starvationStress *
          rules.starvationMaximumDamagePerSecond *
          deltaSeconds;
      }
      fish.health = clamp01(fish.health + (recovery - damageRate) * deltaSeconds);
      if (fish.health <= 0) {
        const strongest = Math.max(
          oxygenStress,
          toxicStress,
          thermalStress,
          starvationStress,
        );
        this.killAnimal(
          fish,
          strongest === starvationStress
            ? 'starvation'
            : strongest === thermalStress
            ? 'temperature'
            : strongest === oxygenStress
              ? 'hypoxia'
              : 'toxicity',
        );
        continue;
      }

      const somaticMetabolicScale = fish.lifeStage === 'egg'
        ? 0
        : Math.pow(
          clamp(
            fish.structuralBiomass /
              WATER_CYCLE_RULES.ricefish.adultStructuralBiomass,
            0.015,
            1,
          ),
          rules.metabolicMassExponent,
        );
      const baseMetabolism = fish.lifeStage === 'egg'
        ? rules.eggBaseMetabolismPerSecond
        : rules.adultBaseMetabolismPerSecond * somaticMetabolicScale;
      const trackedPrey = fish.targetAnimalId === null
        ? undefined
        : this.animals.find((candidate) =>
          candidate.id === fish.targetAnimalId &&
          !eatenAnimalIds.has(candidate.id) &&
          this.isRicefishAnimalPrey(fish, candidate) &&
          this.ricefishCanTrackPrey(fish, candidate));
      const hasTrackedPrey = trackedPrey !== undefined;
      const predatorCanopyShelter = this.ricefishShelterAt(fish.position);
      const preyCanopyShelter = trackedPrey
        ? this.ricefishShelterAt(trackedPrey.position)
        : 0;
      const pursuitHabitatScale = trackedPrey
        ? ricefishCanopyPursuitScale(
          preyCanopyShelter,
          predatorCanopyShelter,
        )
        : 1;
      const pursuitSpeedReference = Math.max(
        1,
        rules.preyPursuitSpeed *
          ricefishSwimmingSpeedScaleForBodyLength(fish.bodyLength) *
          pursuitHabitatScale,
      );
      const pursuitLocomotionIntensity = hasTrackedPrey
        ? clamp(
          Math.hypot(fish.velocity.x, fish.velocity.y) /
            pursuitSpeedReference,
          0,
          1.25,
        )
        : 0;
      if (fish.behavior === 'hunting' && hasTrackedPrey) {
        fish.pursuitEffort = clamp(
          (fish.pursuitEffort ?? 0) +
            ricefishPursuitEffortRate(
              pursuitLocomotionIntensity,
              preyCanopyShelter,
              predatorCanopyShelter,
            ) * deltaSeconds,
          0,
          rules.maximumContinuousPursuitEffort * 1.25,
        );
      } else {
        fish.pursuitEffort = Math.max(
          0,
          (fish.pursuitEffort ?? 0) -
            rules.pursuitEffortRecoveryPerSecond * deltaSeconds,
        );
      }
      const pursuitExhausted =
        hasTrackedPrey &&
        (fish.pursuitEffort ?? 0) >= rules.maximumContinuousPursuitEffort;
      const activity = ricefishActivityCostPerSecond(
        fish.lifeStage,
        fish.behavior,
        hasTrackedPrey,
        fish.pursuitEffort,
        pursuitLocomotionIntensity,
      );
      const requestedRespiration = (
        baseMetabolism +
          (fish.lifeStage === 'egg' ? 0 : activity * somaticMetabolicScale)
      ) * ricefishLifeStageMetabolismScale(fish.lifeStage) *
        metabolicTemperatureFactor * deltaSeconds;
      const minimumStructure = this.ricefishMinimumViableStructure(fish);
      const availableForRespiration = fish.storedBiomass +
        Math.max(0, fish.structuralBiomass - minimumStructure);
      const actualRespiration = this.biogeochemistry.recordAnimalRespiration(
        fish.position,
        Math.min(requestedRespiration, availableForRespiration),
      );
      const reserveLoss = Math.min(fish.storedBiomass, actualRespiration);
      fish.storedBiomass -= reserveLoss;
      fish.yolkBiomass = Math.max(
        0,
        Math.min(
          fish.storedBiomass,
          (fish.yolkBiomass ?? 0) - reserveLoss,
        ),
      );
      const structuralRespirationLoss = Math.min(
        Math.max(0, fish.structuralBiomass - minimumStructure),
        Math.max(0, actualRespiration - reserveLoss),
      );
      fish.structuralBiomass -= structuralRespirationLoss;
      if (feedingDiagnostic) {
        feedingDiagnostic.respirationBiomass += actualRespiration;
        feedingDiagnostic.reserveRespirationBiomass += reserveLoss;
        feedingDiagnostic.structuralRespirationBiomass +=
          structuralRespirationLoss;
      }

      if (fish.lifeStage === 'egg') {
        const developmentFactor = reproductionTemperatureFactor *
          (localOxygen !== null
            ? clamp((localOxygen - 12) / 28, 0, 1)
            : 1) *
          (localToxicWaste !== null
            ? clamp((14 - localToxicWaste) / 10, 0, 1)
            : 1);
        fish.incubationRemaining = Math.max(
          0,
          (fish.incubationRemaining ?? rules.eggIncubationSecondsAt25C) -
            deltaSeconds * developmentFactor,
        );
        fish.energy = clamp01(fish.health);
        if (fish.incubationRemaining <= 0) {
          const remainingEggMatter =
            fish.structuralBiomass + fish.storedBiomass;
          const minimumFryStructure =
            WATER_CYCLE_RULES.ricefish.fryBirthBiomass * 0.24;
          const yolkReserve = Math.min(
            remainingEggMatter * rules.hatchYolkReserveFraction,
            Math.max(0, remainingEggMatter - minimumFryStructure),
          );
          fish.lifeStage = 'fry';
          // Stage durations are measured from free swimming, not from egg
          // fertilisation. Keeping embryonic age here shortened the nominal
          // fry period from 150 seconds to roughly 55 seconds.
          fish.ageSeconds = 0;
          fish.behavior = 'resting';
          fish.bodyLength = rules.fryLength;
          fish.structuralBiomass = remainingEggMatter - yolkReserve;
          fish.peakStructuralBiomass = fish.structuralBiomass;
          fish.storedBiomass = yolkReserve;
          // This marks a subset of storedBiomass; it does not add matter.
          fish.yolkBiomass = yolkReserve;
          fish.attachmentCellId = null;
          fish.incubationRemaining = null;
          fish.velocity = { x: 0, y: 0 };
          fish.secondsSinceFood = 0;
          this.synchroniseRicefishEnergy(fish);
          this.recordAnimalPopulationEvent('hatched', fish);
        }
        livingFish.push(fish);
        continue;
      }

      const targetPrey = fish.targetAnimalId
        ? this.animals.find((candidate) =>
          candidate.id === fish.targetAnimalId &&
          !eatenAnimalIds.has(candidate.id) &&
          this.isRicefishAnimalPrey(fish, candidate))
        : undefined;
      const ecologyTrackLossReason = targetPrey
        ? this.ricefishPreyTrackLossReason(fish, targetPrey)
        : null;
      const targetPreyTrackable =
        targetPrey !== undefined && ecologyTrackLossReason === null;
      if (targetPrey && ecologyTrackLossReason) {
        this.recordRicefishTrackLoss(fish, ecologyTrackLossReason);
        fish.targetAnimalId = null;
        fish.strikeRecoveryUses = 0;
        fish.foragingPatchOrigin = { ...fish.position };
        fish.foragingLastInspectionPosition = { ...fish.position };
        fish.nextTargetEvaluation = 0;
      }
      const mouthPoint = targetPrey
        ? ricefishMouthPoint(
          fish.position,
          fish.facing,
          fish.poseAngle,
          fish.bodyLength,
        )
        : null;
      const mouthContactRadius = targetPrey
        ? ricefishMouthContactRadius(
          fish.bodyLength,
          targetPrey.bodyLength,
        )
        : 0;
      const mouthDistanceSquared = targetPrey && mouthPoint
        ? distanceSquared(mouthPoint, targetPrey.position)
        : Number.POSITIVE_INFINITY;
      if (
        targetPrey &&
        targetPreyTrackable &&
        fish.behavior === 'hunting' &&
        fish.behaviorTimer <= 0 &&
        mouthDistanceSquared <= mouthContactRadius * mouthContactRadius
      ) {
        let capturedPrey = false;
        let strikeHadVisualOpportunity = false;
        const feedingDiagnostic = this.ricefishForagingDiagnostic(fish);
        if (feedingDiagnostic) feedingDiagnostic.mouthContacts += 1;
        // A narrow, visible gap is an access constraint rather than an
        // opacity bonus. If the prey fits and this pursuer does not, neither
        // repeated detection rolls nor the strike's probability floor may
        // eventually bite through the rock.
        const refugeBlocksMouth =
          this.ricefishRelativeRefugeAt(targetPrey, fish);
        if (!refugeBlocksMouth) {
          this.biogeochemistry.emitPredatorDangerPulse(
            targetPrey.position,
            1,
          );
          const shelter = this.ricefishPreyShelter(targetPrey, fish);
          const contactCloseness = clamp(
            1 - Math.sqrt(mouthDistanceSquared) /
              Math.max(1e-9, mouthContactRadius),
            0,
            1,
          );
          const localVisualExposure = visualLightExposure(
            this.sampleLightField(targetPrey.position),
          );
          const escapeCaptureFactor = targetPrey.speciesId === 'daphnia'
            ? ricefishDaphniaEscapeCaptureFactor(
              fish.position,
              targetPrey.position,
              targetPrey.velocity,
              targetPrey.behavior,
            )
            : 1;
          const ordinaryCaptureProbability =
            (0.52 + contactCloseness * 0.34) *
              Math.pow(1 - shelter, 1.8) *
              localVisualExposure *
              (0.72 + escapeCaptureFactor * 0.28);
          // Once the visible prey overlaps the mouth, it has already passed
          // the canopy-limited detection, tracking and approach phases. Dim
          // light and an active escape stroke still matter, but plant cover is
          // not charged a second time at point-blank range.
          const contactCaptureProbability =
            ricefishContactCaptureProbability(
              contactCloseness,
              shelter,
              localVisualExposure,
              escapeCaptureFactor,
            );
          const captureProbability = clamp(
            Math.max(
              ordinaryCaptureProbability,
              contactCaptureProbability,
            ),
            0,
            0.95,
          );
          if (feedingDiagnostic) {
            feedingDiagnostic.strikeAttempts += 1;
            feedingDiagnostic.strikeCaptureProbabilitySum +=
              captureProbability;
          }
          strikeHadVisualOpportunity = captureProbability > 1e-9;
          const attempt = Math.floor(fish.ageSeconds / Math.max(deltaSeconds, 0.01));
          if (strikeHadVisualOpportunity) {
            const strikeVelocity = ricefishSideSwingStrikeVelocity(
              fish.position,
              fish.velocity,
              fish.facing,
              targetPrey.position,
              rules.strikeBurstSpeed *
                ricefishSwimmingSpeedScaleForBodyLength(fish.bodyLength),
              deterministicNoise(
                fish.randomSeed + attempt * 3.71 + targetPrey.randomSeed * 0.19,
              ) < 0.5
                ? -1
                : 1,
            );
            fish.velocity.x = strikeVelocity.x;
            fish.velocity.y = strikeVelocity.y;
          }
          if (deterministicNoise(fish.randomSeed + attempt * 9.17) < captureProbability) {
            capturedPrey = true;
            const consumed = targetPrey.structuralBiomass +
              targetPrey.storedBiomass +
              targetPrey.reproductiveBiomass;
            eatenAnimalIds.add(targetPrey.id);
            this.recordAnimalPopulationEvent('death', targetPrey, { cause: 'predation' });
            const assimilated = this.biogeochemistry.recordAnimalFeeding(
              fish.position,
              consumed,
              'ricefish',
            );
            const retained = this.addRicefishReserve(fish, assimilated);
            if (feedingDiagnostic) {
              feedingDiagnostic.captures += 1;
              feedingDiagnostic.capturedBiomass += consumed;
              feedingDiagnostic.assimilatedBiomass += assimilated;
              feedingDiagnostic.retainedBiomass += retained;
              feedingDiagnostic.assimilationOverflowBiomass +=
                Math.max(0, assimilated - retained);
            }
            fish.recentIntake = ricefishRecentIntakeAfterCapture(
              fish.recentIntake,
              consumed,
              ricefishGutCapacityReferenceBiomass(
                fish.lifeStage,
                fish.ageSeconds,
                fish.structuralBiomass,
                fish.peakStructuralBiomass ?? fish.structuralBiomass,
              ),
            );
            fish.consumedBiomass += consumed;
            fish.recentFood = targetPrey.speciesId === 'daphnia'
              ? targetPrey.lifeStage === 'juvenile'
                ? '어린 큰물벼룩'
                : '큰물벼룩'
              : '어린 체리새우';
            fish.secondsSinceFood = 0;
            if (targetPrey.speciesId === 'daphnia') {
              daphniaPredationOccurred = true;
            }
          }
        } else if (feedingDiagnostic) {
          feedingDiagnostic.refugeBlockedMouthContacts += 1;
        }
        // A missed lunge is not sensory amnesia. If the prey remains physically
        // accessible and visible, keep pursuing it through one short recovery;
        // its actual escape motion can still carry it out of sight or into a
        // refuge before the retry.
        const continuePursuit =
          !capturedPrey &&
          strikeHadVisualOpportunity &&
          !eatenAnimalIds.has(targetPrey.id) &&
          (fish.strikeRecoveryUses ?? 0) < 1;
        fish.foragingPatchOrigin =
          capturedPrey || continuePursuit
            ? null
            : { ...fish.position };
        fish.foragingLastInspectionPosition =
          capturedPrey || continuePursuit
            ? null
            : { ...fish.position };
        fish.behaviorTimer = rules.strikeCooldownSeconds;
        fish.targetAnimalId = continuePursuit ? targetPrey.id : null;
        fish.strikeRecoveryUses = continuePursuit
          ? (fish.strikeRecoveryUses ?? 0) + 1
          : 0;
        fish.nextTargetEvaluation = continuePursuit
          ? rules.strikeCooldownSeconds
          : rules.strikeCooldownSeconds * 0.55;
      }
      if (
        pursuitExhausted &&
        fish.targetAnimalId !== null &&
        !eatenAnimalIds.has(fish.targetAnimalId)
      ) {
        const feedingDiagnostic = this.ricefishForagingDiagnostic(fish);
        if (feedingDiagnostic) feedingDiagnostic.pursuitExhaustions += 1;
        // Sustained pursuit has a finite energetic budget. The fish abandons
        // only this locally observed chase, crosses out of the inspected patch
        // at cruise speed, and can forage again after recovery. It never uses
        // tank-wide prey abundance to make this decision.
        fish.targetAnimalId = null;
        fish.strikeRecoveryUses = 0;
        fish.foragingPatchOrigin = { ...fish.position };
        fish.foragingLastInspectionPosition = { ...fish.position };
        fish.nextTargetEvaluation = Math.max(
          fish.nextTargetEvaluation,
          rules.pursuitRecoverySeconds,
        );
      }

      this.growRicefish(fish, deltaSeconds, reproductionTemperatureFactor);
      this.synchroniseRicefishEnergy(fish);

      if (fish.lifeStage === 'adult' && fish.sex === 'female') {
        if (fish.gestationRemaining !== null) {
          fish.courtshipPartnerId = null;
          fish.behavior = 'carrying-eggs';
          fish.gestationRemaining -= deltaSeconds * reproductionTemperatureFactor;
          if (fish.gestationRemaining <= 0) {
            const attachment = this.chooseRicefishEggAttachmentCell(fish);
            if (attachment) {
              const clutchSize = Math.min(
                rules.eggClutchMaximum,
                Math.floor(
                  fish.reproductiveBiomass /
                    WATER_CYCLE_RULES.ricefish.eggBiomass,
                ),
                Math.max(
                  0,
                  rules.technicalPopulationLimit - ricefish.length - newbornEggs.length,
                ),
              );
              if (clutchSize >= rules.eggClutchMinimum) {
                const cycleIndex = fish.reproductiveCycleIndex ?? 0;
                fish.reproductiveCycleIndex = cycleIndex;
                fish.reproductiveBiomass -=
                  clutchSize * WATER_CYCLE_RULES.ricefish.eggBiomass;
                for (let index = 0; index < clutchSize; index += 1) {
                  const egg = this.createRicefishEggState(fish, attachment, index);
                  newbornEggs.push(egg);
                  this.recordAnimalPopulationEvent('birth', egg, { parentId: fish.id });
                }
                fish.reproductiveCycleIndex = cycleIndex + 1;
                fish.gestationRemaining = null;
                fish.reproductionCooldown = rules.postSpawnCooldownSeconds;
                fish.courtshipPartnerId = null;
                fish.behavior = 'resting';
              }
            }
          }
        } else if (this.ricefishFemaleReadyToMate(fish)) {
          const male = fish.behavior === 'courting' &&
              fish.courtshipPartnerId
            ? ricefish.find((candidate) =>
              candidate.id === fish.courtshipPartnerId &&
              candidate.behavior === 'courting' &&
              candidate.courtshipPartnerId === fish.id &&
              this.ricefishMaleReadyToMate(candidate) &&
              distanceSquared(candidate.position, fish.position) <=
                rules.matingContactRadius * rules.matingContactRadius &&
              this.ricefishHasLineOfSight(fish.position, candidate.position),
            )
            : undefined;
          fish.matingAccumulator = male
            ? fish.matingAccumulator + deltaSeconds * reproductionTemperatureFactor
            : Math.max(0, fish.matingAccumulator - deltaSeconds);
          if (male) {
            fish.behavior = 'courting';
            male.behavior = 'courting';
          }
          if (fish.matingAccumulator >= rules.matingSeconds) {
            fish.gestationRemaining = rules.carriedEggSeconds;
            fish.matingAccumulator = 0;
            fish.courtshipPartnerId = null;
            if (male) {
              male.reproductionCooldown = 35;
              male.courtshipPartnerId = null;
              male.behavior = 'exploring';
            }
          }
        } else {
          fish.courtshipPartnerId = null;
          fish.matingAccumulator = Math.max(0, fish.matingAccumulator - deltaSeconds);
        }
      }

      if (
        fish.lifeStage === 'adult' &&
        fish.ageSeconds >= fish.lifespanSeconds
      ) {
        this.killAnimal(fish, 'old-age');
        continue;
      }
      if (
        fish.storedBiomass <= 1e-9 &&
        fish.structuralBiomass <= this.ricefishMinimumViableStructure(fish) + 1e-9
      ) {
        this.killAnimal(fish, 'starvation');
        continue;
      }
      livingFish.push(fish);
    }

    if (eatenAnimalIds.size) {
      if (
        this.selection?.kind === 'animal' &&
        this.selection.animalId &&
        eatenAnimalIds.has(this.selection.animalId)
      ) this.selection = null;
      for (const animal of this.animals) {
        if (
          animal.speciesId === 'japanese-ricefish' &&
          animal.targetAnimalId &&
          eatenAnimalIds.has(animal.targetAnimalId)
        ) {
          animal.targetAnimalId = null;
          animal.strikeRecoveryUses = 0;
          animal.foragingPatchOrigin = { ...animal.position };
          animal.foragingLastInspectionPosition = { ...animal.position };
          animal.nextTargetEvaluation = 0;
        }
      }
      this.removeAnimalsById(eatenAnimalIds);
      if (daphniaPredationOccurred) this.syncDaphniaIndividuals();
    }
    this.replaceAnimalSpecies('japanese-ricefish', livingFish, newbornEggs);
    eatenAnimalIds.clear();
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
    const conservedBodyMass = animal.structuralBiomass +
      animal.storedBiomass + animal.reproductiveBiomass;
    if (animal.speciesId === 'daphnia') {
      this.biogeochemistry.recordDaphniaDeath(
        animal.position,
        conservedBodyMass,
      );
    } else {
      this.biogeochemistry.recordDeath(
        animal.position,
        this.biogeochemistry.effectsEnabled ||
          animal.speciesId === 'japanese-ricefish'
          ? conservedBodyMass
          : animal.lifeStage === 'adult'
            ? WATER_CYCLE_RULES.shrimp.adultStructuralBiomass
            : WATER_CYCLE_RULES.shrimp.juvenileBirthBiomass,
      );
    }
    if (this.selection?.kind === 'animal' && this.selection.animalId === animal.id) {
      this.selection = null;
    }
  }

  private edibleBiomass(cell: SurfaceCellState): number {
    return Math.max(0, cell.biomass.nitzschia) +
      Math.max(0, cell.biomass.oedogonium) *
        SHRIMP_OEDOGONIUM_FOOD_QUALITY +
      Math.max(0, cell.biofilm.decomposer) *
        SHRIMP_DECOMPOSER_FOOD_WEIGHT +
      Math.max(0, cell.biofilm.nitrifier) *
        SHRIMP_NITRIFIER_FOOD_WEIGHT;
  }

  private rebuildRefugeGaps(): void {
    if (!this.refugeGapsDirty) return;
    this.refugeGaps.length = 0;
    const structures = this.structures.filter(
      (structure) => !this.isHeldStructure(structure.id),
    );
    const polygons = structures.map((structure) => {
      const definition = STRUCTURES[structure.definitionId];
      return structureAuthoredPolygonToWorld(
        definition.collisionPolygon,
        definition.collisionPolygon,
        structure.body.position,
        structure.body.angle,
      );
    });
    for (let firstIndex = 0; firstIndex < structures.length; firstIndex += 1) {
      for (
        let secondIndex = firstIndex + 1;
        secondIndex < structures.length;
        secondIndex += 1
      ) {
        const nearest = closestPolygonGap(
          polygons[firstIndex],
          polygons[secondIndex],
        );
        if (
          !nearest ||
          nearest.distance < REFUGE_GAP_MINIMUM_CLEARANCE ||
          nearest.distance > REFUGE_GAP_MAXIMUM_CLEARANCE
        ) continue;
        const point = {
          x: (nearest.first.x + nearest.second.x) / 2,
          y: (nearest.first.y + nearest.second.y) / 2,
        };
        if (
          point.y < this.tank.waterTop + 10 ||
          point.y > this.tank.groundY - 8
        ) continue;
        const blockingBodies = structures
          .filter(
            (_, index) => index !== firstIndex && index !== secondIndex,
          )
          .map((structure) => structure.body);
        if (blockingBodies.length && Query.point(blockingBodies, point).length) {
          continue;
        }
        this.refugeGaps.push({
          id: `${structures[firstIndex].id}:${structures[secondIndex].id}`,
          point,
          clearance: nearest.distance,
          first: nearest.first,
          second: nearest.second,
          structureIds: [
            structures[firstIndex].id,
            structures[secondIndex].id,
          ],
        });
      }
    }
    this.refugeGapsDirty = false;
  }

  private animalBodyThickness(animal: AnimalState): number {
    return animal.speciesId === 'japanese-ricefish'
      ? Math.max(2.8, animal.bodyLength * 0.3)
      : animal.speciesId === 'cherry-shrimp'
        ? Math.max(2.2, animal.bodyLength * 0.22)
        : Math.max(1.2, animal.bodyLength * 0.3);
  }

  private daphniaPredatorEscape(animal: AnimalState): WaterEscapeVector | null {
    const predators = this.collectNearbyAnimals(
      animal.position,
      DAPHNIA_DIRECT_PREDATOR_SENSE_RADIUS,
      'japanese-ricefish',
      this.nearbyPredatorsScratch,
    );
    let nearest: {
      predator: AnimalState;
      distance: number;
      approachSpeed: number;
      score: number;
    } | null = null;
    for (const predator of predators) {
      if (
        !this.isRicefishAnimalPrey(predator, animal) ||
        !this.ricefishHasLineOfSight(predator.position, animal.position)
      ) continue;
      const dx = animal.position.x - predator.position.x;
      const dy = animal.position.y - predator.position.y;
      const distance = Math.max(0.001, Math.hypot(dx, dy));
      const directSenseRadius = daphniaDirectPredatorSenseRadiusForBodyLength(
        predator.bodyLength,
      );
      if (distance > directSenseRadius) continue;
      const immediatePredatorRadius =
        DAPHNIA_IMMEDIATE_PREDATOR_RADIUS *
        directSenseRadius /
        DAPHNIA_DIRECT_PREDATOR_SENSE_RADIUS;
      const relativeVx = predator.velocity.x - animal.velocity.x;
      const relativeVy = predator.velocity.y - animal.velocity.y;
      const approachSpeed = (relativeVx * dx + relativeVy * dy) / distance;
      const activePursuit =
        predator.behavior === 'hunting' &&
        predator.targetAnimalId === animal.id;
      if (
        distance > immediatePredatorRadius &&
        (!activePursuit || approachSpeed < 2.5)
      ) continue;
      const score = distance - Math.max(0, approachSpeed) * 2.2;
      if (!nearest || score < nearest.score) {
        nearest = { predator, distance, approachSpeed, score };
      }
    }
    if (nearest) {
      const dx = animal.position.x - nearest.predator.position.x;
      const dy = animal.position.y - nearest.predator.position.y;
      const distance = Math.max(0.001, Math.hypot(dx, dy));
      this.predatorEscapeScratch.x = dx / distance;
      this.predatorEscapeScratch.y = dy / distance;
      const phase = this.currentDayNightState()?.phase;
      if (phase !== 'night' && phase !== 'dusk') {
        // During the lit phase, a modest downward component carries an
        // escaping Daphnia toward darker/deeper water without overriding the
        // immediate away-from-predator vector.
        this.predatorEscapeScratch.y += 0.22;
        const escapeLength = Math.max(
          0.001,
          Math.hypot(
            this.predatorEscapeScratch.x,
            this.predatorEscapeScratch.y,
          ),
        );
        this.predatorEscapeScratch.x /= escapeLength;
        this.predatorEscapeScratch.y /= escapeLength;
      }
      this.predatorEscapeScratch.stress = clamp(
        1 - nearest.distance /
          daphniaDirectPredatorSenseRadiusForBodyLength(
            nearest.predator.bodyLength,
          ) +
          Math.max(0, nearest.approachSpeed) / 90,
        0.35,
        1,
      );
      this.predatorEscapeScratch.response = 'escape';
      return this.predatorEscapeScratch;
    }

    const phase = this.currentDayNightState()?.phase;
    const isAscendingPhase = phase === 'dusk' || phase === 'night';
    const localDanger =
      this.biogeochemistry.predatorDangerCueAt(animal.position);
    if (localDanger < DAPHNIA_DANGER_CUE_MINIMUM) return null;
    if (isAscendingPhase) {
      // Fish kairomone plus the disappearance of daylight reverses the diel
      // migration: animals can return toward productive surface water while
      // the visual predator is least effective. An actually approaching fish
      // was already handled by the direct line-of-sight escape above.
      this.predatorEscapeScratch.x = 0;
      this.predatorEscapeScratch.y = -1;
      this.predatorEscapeScratch.stress = clamp(
        localDanger / 0.16,
        0.2,
        0.8,
      );
      this.predatorEscapeScratch.response = 'migration';
      return this.predatorEscapeScratch;
    }
    const sample = this.localSamplePointScratch;
    const radius = DAPHNIA_DANGER_CUE_SAMPLE_RADIUS;
    sample.x = clamp(animal.position.x + radius, 0, this.tank.width);
    sample.y = animal.position.y;
    const right = daphniaDaytimeVisualPredationRisk(
      this.biogeochemistry.predatorDangerCueAt(sample),
      this.ricefishShelterAt(sample),
      false,
      visualLightExposure(this.sampleLightField(sample)),
    );
    sample.x = clamp(animal.position.x - radius, 0, this.tank.width);
    const left = daphniaDaytimeVisualPredationRisk(
      this.biogeochemistry.predatorDangerCueAt(sample),
      this.ricefishShelterAt(sample),
      false,
      visualLightExposure(this.sampleLightField(sample)),
    );
    sample.x = animal.position.x;
    sample.y = clamp(
      animal.position.y + radius,
      this.tank.waterTop,
      this.tank.groundY,
    );
    const down = daphniaDaytimeVisualPredationRisk(
      this.biogeochemistry.predatorDangerCueAt(sample),
      this.ricefishShelterAt(sample),
      false,
      visualLightExposure(this.sampleLightField(sample)),
    );
    sample.y = clamp(
      animal.position.y - radius,
      this.tank.waterTop,
      this.tank.groundY,
    );
    const up = daphniaDaytimeVisualPredationRisk(
      this.biogeochemistry.predatorDangerCueAt(sample),
      this.ricefishShelterAt(sample),
      false,
      visualLightExposure(this.sampleLightField(sample)),
    );
    const gradientX = right - left;
    const gradientY = down - up;
    const magnitude = Math.hypot(gradientX, gradientY);
    if (magnitude <= 1e-5) return null;
    // The gradient points toward greater effective visual risk. Moving down
    // its negative therefore responds to both the local fish-cue field and a
    // nearby Vallisneria canopy without identifying a fish or scanning for a
    // remote plant elsewhere in the tank.
    this.predatorEscapeScratch.x = -gradientX / magnitude;
    this.predatorEscapeScratch.y = -gradientY / magnitude;
    this.predatorEscapeScratch.stress = clamp(
      localDanger / 0.16,
      0.2,
      0.8,
    );
    this.predatorEscapeScratch.response = 'migration';
    return this.predatorEscapeScratch;
  }

  private relativeRefugeFor(
    prey: AnimalState,
    predator: AnimalState,
  ): RefugeGap | null {
    this.rebuildRefugeGaps();
    const preyThickness = this.animalBodyThickness(prey);
    const predatorThickness = this.animalBodyThickness(predator);
    let best: { gap: RefugeGap; score: number } | null = null;
    for (const gap of this.refugeGaps) {
      const usableClearance = gap.clearance * 0.84;
      if (
        preyThickness > usableClearance ||
        predatorThickness <= usableClearance
      ) continue;
      const preyDistance = Math.sqrt(distanceSquared(prey.position, gap.point));
      if (preyDistance > REFUGE_SEARCH_RADIUS) continue;
      const predatorDistance = Math.sqrt(
        distanceSquared(predator.position, gap.point),
      );
      const score = preyDistance - Math.min(80, predatorDistance * 0.22);
      if (!best || score < best.score) best = { gap, score };
    }
    return best?.gap ?? null;
  }

  private directPredatorForShrimp(shrimp: AnimalState): AnimalState | null {
    const candidates = this.collectNearbyAnimals(
      shrimp.position,
      SHRIMP_DIRECT_PREDATOR_SENSE_RADIUS,
      'japanese-ricefish',
      this.nearbyPredatorsScratch,
    );
    let best: { predator: AnimalState; score: number } | null = null;
    for (const predator of candidates) {
      if (!this.isRicefishAnimalPrey(predator, shrimp)) continue;
      const dx = shrimp.position.x - predator.position.x;
      const dy = shrimp.position.y - predator.position.y;
      const distance = Math.max(0.001, Math.hypot(dx, dy));
      const relativeVx = predator.velocity.x - shrimp.velocity.x;
      const relativeVy = predator.velocity.y - shrimp.velocity.y;
      const approachSpeed = (relativeVx * dx + relativeVy * dy) / distance;
      if (distance > 120 && approachSpeed < 4) continue;
      if (!this.ricefishHasLineOfSight(predator.position, shrimp.position)) {
        continue;
      }
      const score = distance - Math.max(0, approachSpeed) * 2.4;
      if (!best || score < best.score) best = { predator, score };
    }
    return best?.predator ?? null;
  }

  private shrimpPredatorEscape(
    shrimp: AnimalState,
    predator: AnimalState,
    deltaSeconds: number,
  ): void {
    const refuge = this.relativeRefugeFor(shrimp, predator);
    let desiredX: number;
    let desiredY: number;
    if (refuge) {
      const dx = refuge.point.x - shrimp.position.x;
      const dy = refuge.point.y - shrimp.position.y;
      const distance = Math.max(0.001, Math.hypot(dx, dy));
      desiredX = dx / distance;
      desiredY = dy / distance;
    } else {
      const dx = shrimp.position.x - predator.position.x;
      const dy = shrimp.position.y - predator.position.y;
      const distance = Math.max(0.001, Math.hypot(dx, dy));
      desiredX = dx / distance;
      desiredY = dy / distance;
    }
    const desiredSpeed = 112;
    const response = 1 - Math.exp(-deltaSeconds * 8);
    shrimp.velocity.x +=
      (desiredX * desiredSpeed - shrimp.velocity.x) * response;
    shrimp.velocity.y +=
      (desiredY * desiredSpeed - shrimp.velocity.y) * response;
    shrimp.position.x += shrimp.velocity.x * deltaSeconds;
    shrimp.position.y += shrimp.velocity.y * deltaSeconds;
    this.clampAnimalPoint(shrimp.position, shrimp.position);
    shrimp.targetCellId = null;
    shrimp.targetAnimalId = null;
    shrimp.behavior = 'traveling';
    shrimp.behaviorTimer = 0.8;
    shrimp.nextTargetEvaluation = 0.8;
    shrimp.grazingSessionIntake = 0;
    if (Math.abs(shrimp.velocity.x) > 2.5) {
      shrimp.facing = shrimp.velocity.x < 0 ? -1 : 1;
    }
    shrimp.poseAngle = clamp(
      Math.atan2(
        shrimp.velocity.y,
        Math.max(5, Math.abs(shrimp.velocity.x)),
      ),
      -0.42,
      0.42,
    );
  }

  private isRicefishAnimalPrey(predator: AnimalState, candidate: AnimalState): boolean {
    if (
      predator.speciesId !== 'japanese-ricefish' ||
      predator.lifeStage === 'egg'
    ) return false;
    if (candidate.speciesId === 'daphnia') {
      // Daphnia are deliberately enlarged on screen so a player can see and
      // select them. Their rendered bodyLength must not be treated as literal
      // mouth-gape geometry. Fry can take only physically small individuals;
      // an early cue-driven molt must not make the same-sized prey suddenly
      // inedible. Larger ricefish can take either stage and the preference
      // curve below still favours intermediate prey over the largest adults.
      return candidate.structuralBiomass <=
        ricefishMaximumDaphniaStructureForBodyLength(predator.bodyLength);
    }
    return candidate.speciesId === 'cherry-shrimp' &&
      candidate.lifeStage === 'juvenile' &&
      candidate.growthProgress <=
        ricefishMaximumShrimpGrowthProgressForBodyLength(
          predator.bodyLength,
        ) + 1e-9;
  }

  private ricefishPreyDetectionRadiusAt(
    predator: AnimalState,
    point: Vec2 = predator.position,
  ): number {
    return ricefishPreyDetectionRadiusForBodyLength(predator.bodyLength) *
      ricefishCanopyDetectionScale(
        this.ricefishShelterAt(point),
      );
  }

  private ricefishPreyTrackLossReason(
    predator: AnimalState,
    prey: AnimalState,
    detectionRadius = this.ricefishPreyDetectionRadiusAt(predator),
  ): RicefishTrackLossReason | null {
    const relativeShelter = this.ricefishPreyShelter(prey, predator);
    const trackingRadius = Math.max(
      RICEFISH_ECOLOGY_RULES.strikeDistance * 0.9,
      detectionRadius * ricefishCanopyTrackingScale(relativeShelter),
    );
    if (
      distanceSquared(predator.position, prey.position) >
        trackingRadius * trackingRadius
    ) return 'distance';
    if (!this.ricefishHasLineOfSight(predator.position, prey.position)) {
      return 'line-of-sight';
    }
    if (this.ricefishRelativeRefugeAt(prey, predator)) return 'refuge';
    if (
      visualLightExposure(this.sampleLightField(prey.position)) <
        RICEFISH_TRACKED_PREY_MINIMUM_LIGHT_EXPOSURE
    ) return 'darkness';
    return null;
  }

  private ricefishCanTrackPrey(
    predator: AnimalState,
    prey: AnimalState,
    detectionRadius = this.ricefishPreyDetectionRadiusAt(predator),
  ): boolean {
    return this.ricefishPreyTrackLossReason(
      predator,
      prey,
      detectionRadius,
    ) === null;
  }

  private chooseRicefishCourtshipPartner(
    fish: AnimalState,
  ): AnimalState | undefined {
    if (fish.sex === 'male') {
      if (!this.ricefishMaleReadyToMate(fish)) return undefined;
      const current = fish.courtshipPartnerId
        ? this.animals.find((candidate) =>
          candidate.id === fish.courtshipPartnerId)
        : undefined;
      if (
        current &&
        this.ricefishFemaleReadyToMate(current) &&
        distanceSquared(fish.position, current.position) <=
          (RICEFISH_MATING_ATTRACTION_RADIUS * 1.18) ** 2 &&
        (
          !current.courtshipPartnerId ||
          current.courtshipPartnerId === fish.id
        )
      ) return current;

      let best: { female: AnimalState; score: number } | null = null;
      for (const candidate of this.animals) {
        if (
          !this.ricefishFemaleReadyToMate(candidate) ||
          (
            candidate.courtshipPartnerId &&
            candidate.courtshipPartnerId !== fish.id
          )
        ) continue;
        const distance = Math.sqrt(
          distanceSquared(fish.position, candidate.position),
        );
        if (distance > RICEFISH_MATING_ATTRACTION_RADIUS) continue;
        // The distance term is a compact local proxy for the ovulatory cue
        // plume. Visual contact strengthens selection but is not mandatory:
        // the actual courtship-inducing cue is olfactory and a rock silhouette
        // must not turn it into an impossible line-of-sight signal.
        const cueStrength =
          1 - distance / RICEFISH_MATING_ATTRACTION_RADIUS;
        const clutchMatter =
          RICEFISH_ECOLOGY_RULES.eggClutchMinimum *
          WATER_CYCLE_RULES.ricefish.eggBiomass;
        const ovulatoryReadiness = clamp(
          candidate.reproductiveBiomass / Math.max(1e-9, clutchMatter),
          0,
          1,
        );
        const visualContact = this.ricefishHasLineOfSight(
          fish.position,
          candidate.position,
        ) ? 1 : 0;
        const score =
          cueStrength * 0.67 +
          ovulatoryReadiness * 0.23 +
          visualContact * 0.1;
        if (
          !best ||
          score > best.score + 1e-9 ||
          (
            Math.abs(score - best.score) <= 1e-9 &&
            candidate.id < best.female.id
          )
        ) {
          best = { female: candidate, score };
        }
      }
      return best?.female;
    }

    if (!this.ricefishFemaleReadyToMate(fish)) return undefined;
    const current = fish.courtshipPartnerId
      ? this.animals.find((candidate) =>
        candidate.id === fish.courtshipPartnerId)
      : undefined;
    if (
      current &&
      this.ricefishMaleReadyToMate(current) &&
      current.courtshipPartnerId === fish.id &&
      distanceSquared(fish.position, current.position) <=
        (RICEFISH_ECOLOGY_RULES.matingEncounterRadius * 1.2) ** 2 &&
      this.ricefishHasLineOfSight(fish.position, current.position)
    ) return current;

    let best: { male: AnimalState; score: number } | null = null;
    const adultLength = RICEFISH_ECOLOGY_RULES.adultLength;
    for (const candidate of this.animals) {
      if (
        !this.ricefishMaleReadyToMate(candidate) ||
        candidate.courtshipPartnerId !== fish.id ||
        candidate.behavior !== 'courting'
      ) continue;
      const distance = Math.sqrt(
        distanceSquared(fish.position, candidate.position),
      );
      if (
        distance > RICEFISH_ECOLOGY_RULES.matingEncounterRadius ||
        !this.ricefishHasLineOfSight(fish.position, candidate.position)
      ) continue;
      // Female medaka do not accept an arbitrary courting male. Body size has
      // a measured mating advantage, while proximity and current condition
      // keep the choice local and prevent a remote "best male" query.
      const sizeEvidence = clamp(
        (candidate.bodyLength / adultLength - 0.82) / 0.36,
        0,
        1,
      );
      const proximity =
        1 - distance / RICEFISH_ECOLOGY_RULES.matingEncounterRadius;
      const condition = clamp(
        (candidate.energy + candidate.health) * 0.5,
        0,
        1,
      );
      const score =
        sizeEvidence * 0.46 +
        proximity * 0.34 +
        condition * 0.2;
      if (
        !best ||
        score > best.score + 1e-9 ||
        (
          Math.abs(score - best.score) <= 1e-9 &&
          candidate.id < best.male.id
        )
      ) {
        best = { male: candidate, score };
      }
    }
    return best?.male;
  }

  private ricefishCourtshipTargetPoint(
    fish: AnimalState,
    mate: AnimalState,
  ): Vec2 {
    if (fish.sex === 'female') {
      // A receptive female continues a slow, readable swim; she does not home
      // on the male. Acceptance is expressed by retaining one nearby suitor.
      const velocityLength = Math.hypot(fish.velocity.x, fish.velocity.y);
      const headingX = velocityLength > 8
        ? fish.velocity.x / velocityLength
        : fish.facing;
      const headingY = velocityLength > 8
        ? clamp(fish.velocity.y / velocityLength, -0.35, 0.35)
        : 0;
      return {
        x: fish.position.x + headingX * 150,
        y: fish.position.y + headingY * 90,
      };
    }

    const accepted = mate.courtshipPartnerId === fish.id;
    const pairDistance = Math.sqrt(
      distanceSquared(fish.position, mate.position),
    );
    const bodyLength = Math.max(24, mate.bodyLength);
    if (
      !accepted ||
      pairDistance > RICEFISH_ECOLOGY_RULES.matingEncounterRadius * 0.72
    ) {
      // "Following" and "positioning": the male closes from slightly behind
      // and below rather than aiming at the female's centre.
      return {
        x: mate.position.x - mate.facing * bodyLength * 0.62,
        y: mate.position.y + bodyLength * 0.42,
      };
    }

    const progress = clamp(
      mate.matingAccumulator / RICEFISH_ECOLOGY_RULES.matingSeconds,
      0,
      1,
    );
    if (progress < 0.3) {
      return {
        x: mate.position.x - mate.facing * bodyLength * 0.34,
        y: mate.position.y + bodyLength * 0.36,
      };
    }
    if (progress < 0.78) {
      // "Quick-circle": circle the snout and then return alongside. The phase
      // is tied to the accepted female's courtship progress, so both ecology
      // and visible movement describe the same event.
      const circleProgress = (progress - 0.3) / 0.48;
      const direction = deterministicNoise(fish.randomSeed * 0.17) < 0.5
        ? -1
        : 1;
      const angle =
        circleProgress * Math.PI * 2 * direction +
        (mate.facing < 0 ? Math.PI : 0);
      const snoutX = mate.position.x + mate.facing * bodyLength * 0.42;
      const radius = bodyLength * 0.72;
      return {
        x: snoutX + Math.cos(angle) * radius,
        y: mate.position.y + Math.sin(angle) * radius * 0.68,
      };
    }
    // Close contact/wrapping immediately before spawning.
    return {
      x: mate.position.x - mate.facing * bodyLength * 0.05,
      y: mate.position.y + bodyLength * 0.12,
    };
  }

  private ricefishFemaleReadyToMate(fish: AnimalState): boolean {
    return fish.speciesId === 'japanese-ricefish' &&
      fish.lifeStage === 'adult' &&
      fish.sex === 'female' &&
      fish.gestationRemaining === null &&
      fish.reproductionCooldown <= 0 &&
      fish.reproductiveBiomass + 1e-9 >=
        RICEFISH_ECOLOGY_RULES.eggClutchMinimum *
          WATER_CYCLE_RULES.ricefish.eggBiomass &&
      fish.health > 0.72 &&
      fish.energy >= RICEFISH_ECOLOGY_RULES.reproductionEnergy;
  }

  private ricefishMaleReadyToMate(fish: AnimalState): boolean {
    return fish.speciesId === 'japanese-ricefish' &&
      fish.lifeStage === 'adult' &&
      fish.sex === 'male' &&
      fish.reproductionCooldown <= 0 &&
      fish.health > 0.72 &&
      fish.energy >= RICEFISH_ECOLOGY_RULES.matingEnergy;
  }

  private ricefishHasLineOfSight(from: Vec2, to: Vec2): boolean {
    if (distanceSquared(from, to) < 4) return true;
    const bodies = this.structureBodiesScratch;
    bodies.length = this.structures.length;
    for (let index = 0; index < this.structures.length; index += 1) {
      bodies[index] = this.structures[index].body;
    }
    return Query.ray(
      bodies,
      from,
      to,
      2,
    ).length === 0;
  }

  private ricefishShelterAt(point: Vec2): number {
    let opticalDepth = 0;
    if (this.vallisneriaShelterBuckets.length === 0) return 0;
    const column = clamp(
      Math.floor(point.x / VALLISNERIA_SHELTER_BUCKET_SIZE),
      0,
      this.vallisneriaShelterBucketColumns - 1,
    );
    const row = clamp(
      Math.floor(
        (point.y - this.tank.waterTop) /
          VALLISNERIA_SHELTER_BUCKET_SIZE,
      ),
      0,
      this.vallisneriaShelterBucketRows - 1,
    );
    const canopies = this.vallisneriaShelterBuckets[
      row * this.vallisneriaShelterBucketColumns + column
    ];
    for (const canopy of canopies) {
      const { bounds } = canopy;
      if (
        point.x < bounds.minX - 16 ||
        point.x > bounds.maxX + 16 ||
        point.y < bounds.minY - 12 ||
        point.y > bounds.maxY + 18
      ) continue;
      const horizontal = clamp(
        1 - Math.abs(point.x - (bounds.minX + bounds.maxX) / 2) /
          Math.max(1, (bounds.maxX - bounds.minX) / 2 + 16),
        0,
        1,
      );
      opticalDepth += horizontal * canopy.structuralScale * 0.42;
    }
    return clamp(1 - Math.exp(-opticalDepth), 0, 0.86);
  }

  private ricefishPreyShelter(
    prey: AnimalState,
    predator?: AnimalState,
    knownPredatorCanopyShelter?: number,
  ): number {
    const preyCanopyShelter = this.ricefishShelterAt(prey.position);
    let shelter = predator
      ? ricefishRelativeCanopyShelter(
        preyCanopyShelter,
        knownPredatorCanopyShelter ??
          this.ricefishShelterAt(predator.position),
      )
      : preyCanopyShelter;
    if (predator && this.ricefishRelativeRefugeAt(prey, predator)) {
      shelter = Math.max(shelter, 0.96);
    }
    return clamp(shelter, 0, 0.96);
  }

  private ricefishRelativeRefugeAt(
    prey: AnimalState,
    predator: AnimalState,
  ): RefugeGap | null {
    const refuge = this.relativeRefugeFor(prey, predator);
    return refuge &&
      distanceSquared(prey.position, refuge.point) <=
        Math.max(18, refuge.clearance * 0.8) ** 2
      ? refuge
      : null;
  }

  private ricefishDaphniaSizePreference(
    predator: AnimalState,
    candidate: AnimalState,
  ): number {
    return ricefishDaphniaSizePreferenceForStructure(
      predator.bodyLength,
      candidate.structuralBiomass,
    );
  }

  /**
   * Compare already-detected prey across guilds by immediate opportunity.
   *
   * Species identity is not a hard priority. A visible edible juvenile shrimp
   * can be a better target than a distant Daphnia, while prey size, cover and
   * distance still make an exposed well-sized Daphnia attractive.
   */
  private ricefishPreyOpportunityScore(
    predator: AnimalState,
    candidate: AnimalState,
  ): number {
    const detectionRadius = this.ricefishPreyDetectionRadiusAt(predator);
    const distance = Math.sqrt(distanceSquared(
      predator.position,
      candidate.position,
    ));
    const proximity = clamp(1 - distance / Math.max(1, detectionRadius), 0, 1);
    const shelter = this.ricefishPreyShelter(candidate, predator);
    const exposure = visualLightExposure(
      this.sampleLightField(candidate.position),
    ) * Math.pow(1 - shelter, 1.8);
    const mealBiomass =
      candidate.structuralBiomass +
      candidate.storedBiomass +
      candidate.reproductiveBiomass;
    const gutReference = ricefishGutCapacityReferenceBiomass(
      predator.lifeStage,
      predator.ageSeconds,
      predator.structuralBiomass,
      predator.peakStructuralBiomass ?? predator.structuralBiomass,
    ) * RICEFISH_ECOLOGY_RULES.gutCapacityStructuralFraction;
    const mealValue = clamp(mealBiomass / Math.max(1e-9, gutReference), 0, 1);
    const sizeFit = candidate.speciesId === 'daphnia'
      ? this.ricefishDaphniaSizePreference(predator, candidate)
      : RICEFISH_ECOLOGY_RULES.juvenileShrimpPreference;
    return proximity * 0.5 + exposure * 0.2 + mealValue * 0.2 + sizeFit * 0.1;
  }

  /**
   * A hungry fish can opportunistically switch to edible prey that enters the
   * mouth-scale field during pursuit. The small radius and improvement margin
   * prevent target jitter while avoiding tunnel vision toward a distant prey.
   */
  private chooseRicefishImmediatePrey(
    predator: AnimalState,
    currentTarget: AnimalState,
  ): AnimalState | null {
    const immediateRadius = RICEFISH_ECOLOGY_RULES.strikeDistance * 0.78;
    const mouthPoint = ricefishMouthPoint(
      predator.position,
      predator.facing,
      predator.poseAngle,
      predator.bodyLength,
    );
    const currentMouthRadius = ricefishMouthContactRadius(
      predator.bodyLength,
      currentTarget.bodyLength,
    );
    // Do not abandon prey that is already touching the rendered mouth merely
    // because a different member of a dense swarm is closer to the body
    // centre. The old centre-distance comparison could alternate targets on
    // opposite sides on every 0.1 s steering step.
    if (
      distanceSquared(mouthPoint, currentTarget.position) <=
        (currentMouthRadius * 1.12) ** 2
    ) return null;
    const reserved = new Set(
      this.animals
        .filter((animal) =>
          animal.speciesId === 'japanese-ricefish' &&
          animal.id !== predator.id &&
          animal.behavior === 'hunting' &&
          animal.targetAnimalId)
        .map((animal) => animal.targetAnimalId as string),
    );
    let best: { prey: AnimalState; score: number; distance: number } | null =
      null;
    let mouthContact: {
      prey: AnimalState;
      normalizedDistance: number;
    } | null = null;
    for (const speciesId of ['daphnia', 'cherry-shrimp'] as const) {
      const nearby = this.collectNearbyAnimals(
        predator.position,
        immediateRadius,
        speciesId,
        this.nearbyAnimalCandidatesScratch,
      );
      for (const candidate of nearby) {
        if (
          reserved.has(candidate.id) ||
          !this.isRicefishAnimalPrey(predator, candidate) ||
          !this.ricefishHasLineOfSight(predator.position, candidate.position) ||
          this.ricefishRelativeRefugeAt(candidate, predator) ||
          visualLightExposure(this.sampleLightField(candidate.position)) <
            RICEFISH_TRACKED_PREY_MINIMUM_LIGHT_EXPOSURE
        ) continue;
        const distance = Math.sqrt(distanceSquared(
          predator.position,
          candidate.position,
        ));
        const candidateMouthRadius = ricefishMouthContactRadius(
          predator.bodyLength,
          candidate.bodyLength,
        );
        const mouthDistance = Math.sqrt(distanceSquared(
          mouthPoint,
          candidate.position,
        ));
        if (mouthDistance <= candidateMouthRadius) {
          const normalizedDistance =
            mouthDistance / Math.max(1e-9, candidateMouthRadius);
          if (
            candidate.id !== currentTarget.id &&
            (
              !mouthContact ||
              normalizedDistance < mouthContact.normalizedDistance
            )
          ) {
            mouthContact = { prey: candidate, normalizedDistance };
          }
        }
        const score =
          this.ricefishPreyOpportunityScore(predator, candidate) * 24 -
          distance;
        if (!best || score > best.score) {
          best = { prey: candidate, score, distance };
        }
      }
    }
    // A genuinely different prey entering the mouth is the one immediate
    // interruption that should bypass target commitment.
    if (mouthContact) return mouthContact.prey;
    if (predator.nextTargetEvaluation > 0) return null;
    if (!best || best.prey.id === currentTarget.id) return null;
    const currentDistance = Math.sqrt(distanceSquared(
      predator.position,
      currentTarget.position,
    ));
    const currentScore =
      this.ricefishPreyOpportunityScore(predator, currentTarget) * 24 -
      currentDistance;
    return (
      best.distance + 6 < currentDistance &&
      best.score > currentScore + 2
    )
      ? best.prey
      : null;
  }

  private chooseRicefishPreySpecies(
    predator: AnimalState,
    speciesId: 'daphnia' | 'cherry-shrimp',
    reserved: ReadonlySet<string>,
    foragingUrgency: number,
  ): AnimalState | null {
    const detectionRadius = this.ricefishPreyDetectionRadiusAt(predator);
    const nearby = this.collectNearbyAnimals(
      predator.position,
      detectionRadius,
      speciesId,
      this.nearbyAnimalCandidatesScratch,
    );
    const diagnostic = speciesId === 'daphnia'
      ? this.ricefishForagingDiagnostic(predator)
      : null;
    if (diagnostic) {
      diagnostic.searchCalls += 1;
      diagnostic.daphniaInRadius += nearby.length;
    }
    let candidateCount = 0;
    for (const candidate of nearby) {
      if (!this.isRicefishAnimalPrey(predator, candidate)) {
        if (diagnostic) diagnostic.daphniaRejectedInedible += 1;
        continue;
      }
      if (!this.ricefishHasLineOfSight(predator.position, candidate.position)) {
        if (diagnostic) diagnostic.daphniaRejectedLineOfSight += 1;
        continue;
      }
      if (this.ricefishRelativeRefugeAt(candidate, predator)) {
        if (diagnostic) diagnostic.daphniaRejectedRefuge += 1;
        continue;
      }
      nearby[candidateCount] = candidate;
      candidateCount += 1;
    }
    nearby.length = candidateCount;
    if (diagnostic) {
      diagnostic.daphniaAfterAccessChecks += candidateCount;
    }
    const predatorCanopyShelter = this.ricefishShelterAt(predator.position);
    const visualEvidenceFor = (candidate: AnimalState): number => {
      const shelter = this.ricefishPreyShelter(
        candidate,
        predator,
        predatorCanopyShelter,
      );
      const sizePreference = candidate.speciesId === 'daphnia'
        ? this.ricefishDaphniaSizePreference(predator, candidate)
        : 1;
      return ricefishVisualSearchGeometry(
        predator.position,
        predator.velocity,
        predator.facing,
        candidate.position,
        detectionRadius,
      ) *
        visualLightExposure(this.sampleLightField(candidate.position)) *
        Math.pow(1 - shelter, 1.8) *
        (0.58 + sizePreference * 0.42);
    };
    // A food-limited fry has a deliberately small visual radius, but an edible
    // animal already at its mouth is a direct encounter rather than a new
    // long-range search. Point-blank recognition still requires light, line of
    // sight and physical access, and capture remains subject to the ordinary
    // shelter/escape strike probability.
    const nearFieldDistance = Math.min(
      RICEFISH_ECOLOGY_RULES.strikeDistance * 0.75,
      detectionRadius * 0.35,
    );
    let nearField: { prey: AnimalState; score: number } | null = null;
    for (const candidate of nearby) {
      if (reserved.has(candidate.id)) continue;
      if (
        distanceSquared(predator.position, candidate.position) >
          nearFieldDistance * nearFieldDistance
      ) continue;
      if (
        visualLightExposure(this.sampleLightField(candidate.position)) <
          RICEFISH_TRACKED_PREY_MINIMUM_LIGHT_EXPOSURE
      ) {
        if (diagnostic) diagnostic.daphniaRejectedDarkness += 1;
        continue;
      }
      const sizePreference = speciesId === 'daphnia'
        ? this.ricefishDaphniaSizePreference(predator, candidate)
        : 1;
      const score = sizePreference * 2 +
        (
          candidate.structuralBiomass +
          candidate.storedBiomass +
          candidate.reproductiveBiomass
        ) /
          Math.max(
            1e-9,
            speciesId === 'daphnia'
              ? WATER_CYCLE_RULES.daphnia.adultStructuralBiomass
              : WATER_CYCLE_RULES.shrimp.juvenileBirthBiomass,
          );
      if (!nearField || score > nearField.score) {
        nearField = { prey: candidate, score };
      }
    }
    if (nearField) return nearField.prey;
    // Scarce prey are encountered less often because there are fewer actual
    // candidates in the local visual patch. Do not additionally reduce the
    // recognition probability of each already-visible individual according to
    // guild count: that made a conspicuous lone Daphnia artificially invisible
    // and double-counted low density.
    let best: { prey: AnimalState; score: number } | null = null;
    for (const candidate of nearby) {
      if (reserved.has(candidate.id)) continue;
      if (diagnostic) diagnostic.daphniaVisualEvaluations += 1;
      const shelter = this.ricefishPreyShelter(
        candidate,
        predator,
        predatorCanopyShelter,
      );
      const sizePreference = speciesId === 'daphnia'
        ? this.ricefishDaphniaSizePreference(predator, candidate)
        : 1;
      const visualEvidence = visualEvidenceFor(candidate);
      const detectionChance = ricefishLocalPreyDetectionChance(
        visualEvidence,
        foragingUrgency,
      );
      const epoch = Math.floor(predator.ageSeconds / 0.7);
      if (
        deterministicNoise(
          predator.randomSeed + epoch * 11.7 + candidate.randomSeed * 0.13,
        ) > detectionChance
      ) {
        if (diagnostic) diagnostic.daphniaDetectionRejections += 1;
        continue;
      }
      const sizeSelection = speciesId === 'daphnia'
        ? sizePreference * 36
        : 0;
      const score = visualEvidence * 180 - shelter * 24 + sizeSelection +
        deterministicNoise(predator.randomSeed + candidate.randomSeed) * 8;
      if (!best || score > best.score) best = { prey: candidate, score };
    }
    return best?.prey ?? null;
  }

  private chooseRicefishPrey(
    predator: AnimalState,
    foragingUrgency: number,
  ): AnimalState | null {
    const reserved = new Set(
      this.animals
        .filter((animal) =>
          animal.speciesId === 'japanese-ricefish' &&
          animal.id !== predator.id &&
          animal.behavior === 'hunting' &&
          animal.targetAnimalId)
        .map((animal) => animal.targetAnimalId as string),
    );
    const daphnia = this.chooseRicefishPreySpecies(
      predator,
      'daphnia',
      reserved,
      foragingUrgency,
    );
    const juvenileShrimp = this.chooseRicefishPreySpecies(
      predator,
      'cherry-shrimp',
      reserved,
      foragingUrgency,
    );
    if (!daphnia) return juvenileShrimp;
    if (!juvenileShrimp) return daphnia;
    return this.ricefishPreyOpportunityScore(predator, juvenileShrimp) >
      this.ricefishPreyOpportunityScore(predator, daphnia)
      ? juvenileShrimp
      : daphnia;
  }

  private chooseRicefishEggAttachmentCell(fish: AnimalState): SurfaceCellState | null {
    let best: { cell: SurfaceCellState; score: number } | null = null;
    for (const cell of this.allCells()) {
      const point = this.ricefishEggAttachmentPoint(cell, fish);
      const distance = Math.sqrt(distanceSquared(fish.position, point));
      if (distance > 260) continue;
      const waterSuitability = this.biogeochemistry.effectsEnabled
        ? ricefishEggAttachmentWaterSuitability(
          this.biogeochemistry.oxygenAt(point),
          this.biogeochemistry.toxicWasteAt(point),
        )
        : 1;
      // Carry the eggs until the fish reaches another candidate instead of
      // fixing them to a local toxic or hypoxic pocket. This is site choice,
      // not an immunity applied after spawning.
      if (waterSuitability <= 0) continue;
      const vallisneria = cell.biomass.vallisneria;
      const filamentous = cell.biomass.oedogonium;
      const roughAlternative = cell.surfaceKind === 'structure-face' ? 0.25 : 0.08;
      const substrateQuality = vallisneria > ALGAE_VISIBLE_BIOMASS
        ? 1 + Math.min(0.5, vallisneria)
        : filamentous > 0.04
          ? 0.78 + Math.min(0.3, filamentous)
          : roughAlternative;
      const score = substrateQuality * 180 + waterSuitability * 70 - distance +
        deterministicNoise(fish.randomSeed + cell.index * 5.9) * 9;
      if (!best || score > best.score) best = { cell, score };
    }
    return best?.cell ?? null;
  }

  /**
   * Return a real point on the painted Vallisneria canopy for egg attachment.
   * The surface cell remains the stable ownership/save key, but using its
   * substrate centre as the animal position put every "plant-attached" clutch
   * at the dark root instead of beside oxygen-producing leaf tissue.
   */
  private ricefishEggAttachmentPoint(
    cell: SurfaceCellState,
    fish: AnimalState,
  ): Vec2 {
    const ramet = this.vallisneriaRametForCell(cell);
    if (
      !ramet ||
      cell.biomass.vallisneria <= ALGAE_VISIBLE_BIOMASS
    ) {
      const surfacePoint = this.cellWorldPoint(cell);
      this.ricefishEggAttachmentPointScratch.x = surfacePoint.x;
      this.ricefishEggAttachmentPointScratch.y = surfacePoint.y;
      return this.ricefishEggAttachmentPointScratch;
    }
    const root = this.vallisneriaRootPosition(ramet, cell);
    const structuralScale = ramet.plant?.structuralScale ?? 0.72;
    const leafCount = writeVallisneriaLeaves(
      cell.index,
      root,
      structuralScale,
      this.vallisneriaLeavesScratch,
    );
    if (leafCount === 0) {
      this.ricefishEggAttachmentPointScratch.x = root.x;
      this.ricefishEggAttachmentPointScratch.y = root.y;
      return this.ricefishEggAttachmentPointScratch;
    }
    const spawningPhase = Math.floor(fish.ageSeconds / 10);
    const seed =
      fish.randomSeed +
      spawningPhase * 1.137 +
      cell.index * 4.731;
    const leafIndex = Math.min(
      leafCount - 1,
      Math.floor(deterministicNoise(seed) * leafCount),
    );
    // Avoid both the sediment boundary and the freely whipping leaf tip. Eggs
    // remain visibly attached within the stable middle half of one blade.
    const progress = 0.32 + deterministicNoise(seed + 17.9) * 0.46;
    return vallisneriaLeafPoint(
      this.vallisneriaLeavesScratch[leafIndex],
      progress,
      this.ricefishEggAttachmentPointScratch,
    );
  }

  /**
   * Maximum structure that can be built at this developmental time.
   *
   * This is only a growth-rate ceiling. `growRicefish` must still transfer
   * every gained unit from stored food matter, and delayed juveniles can catch
   * up later. It is never used as body condition or gut capacity.
   */
  private ricefishDevelopmentalGrowthCeiling(fish: AnimalState): number {
    if (fish.lifeStage === 'egg') return WATER_CYCLE_RULES.ricefish.eggBiomass;
    if (fish.lifeStage === 'fry') return WATER_CYCLE_RULES.ricefish.fryBirthBiomass;
    if (fish.lifeStage === 'juvenile') {
      const progress = clamp01(
        (fish.ageSeconds - RICEFISH_ECOLOGY_RULES.fryStageSeconds) /
          Math.max(
            1,
            RICEFISH_ECOLOGY_RULES.maturationSeconds -
              RICEFISH_ECOLOGY_RULES.fryStageSeconds,
          ),
      );
      return WATER_CYCLE_RULES.ricefish.fryBirthBiomass +
        (
          WATER_CYCLE_RULES.ricefish.juvenileStructuralBiomass -
          WATER_CYCLE_RULES.ricefish.fryBirthBiomass
        ) * progress;
    }
    return WATER_CYCLE_RULES.ricefish.adultStructuralBiomass;
  }

  private ricefishReserveCapacity(fish: AnimalState): number {
    return ricefishConditionReserveCapacity(
      fish.lifeStage,
      fish.ageSeconds,
      fish.structuralBiomass,
      fish.peakStructuralBiomass ?? fish.structuralBiomass,
    );
  }

  /**
   * Physical retention for one assimilated meal remains distinct from the
   * condition denominator. A juvenile can retain a large captured Daphnia and
   * turn it into growth over subsequent steps without an artificial overflow,
   * while its displayed condition still changes continuously at stage edges.
   */
  private ricefishAssimilationRetentionCapacity(fish: AnimalState): number {
    return fish.lifeStage === 'fry'
      ? WATER_CYCLE_RULES.ricefish.fryReserveBiomass
      : fish.lifeStage === 'juvenile'
        ? WATER_CYCLE_RULES.ricefish.juvenileReserveBiomass
        : WATER_CYCLE_RULES.ricefish.adultReserveBiomass;
  }

  private ricefishMinimumViableStructure(fish: AnimalState): number {
    if (fish.lifeStage === 'egg') {
      return WATER_CYCLE_RULES.ricefish.fryBirthBiomass * 0.24;
    }
    const achievedStructure = Math.max(
      fish.structuralBiomass,
      fish.peakStructuralBiomass ?? fish.structuralBiomass,
    );
    return achievedStructure *
      RICEFISH_ECOLOGY_RULES.starvationMinimumStructuralFraction;
  }

  private synchroniseRicefishEnergy(fish: AnimalState): void {
    if (fish.lifeStage === 'egg') {
      fish.energy = fish.health;
      return;
    }
    // Growth destinations are not condition denominators. Only loss from a
    // body the fish really achieved counts as structural starvation; being
    // small for its age does not by itself disable swimming and prey search.
    const achievedStructure = Math.max(
      1e-9,
      fish.structuralBiomass,
      fish.peakStructuralBiomass ?? fish.structuralBiomass,
    );
    const structural = clamp01(
      fish.structuralBiomass /
        achievedStructure,
    );
    const reserve = clamp01(
      fish.storedBiomass / Math.max(1e-9, this.ricefishReserveCapacity(fish)),
    );
    fish.energy = clamp01(structural * 0.28 + reserve * 0.72);
  }

  private addRicefishReserve(fish: AnimalState, biomass: number): number {
    if (biomass <= 0) return 0;
    const capacity = this.ricefishAssimilationRetentionCapacity(fish);
    const retained = Math.min(biomass, Math.max(0, capacity - fish.storedBiomass));
    fish.storedBiomass += retained;
    this.biogeochemistry.recordAnimalAssimilationOverflow(
      fish.position,
      biomass - retained,
    );
    this.synchroniseRicefishEnergy(fish);
    return retained;
  }

  private growRicefish(
    fish: AnimalState,
    deltaSeconds: number,
    temperatureFactor: number,
  ): void {
    if (fish.lifeStage === 'egg') return;
    const protectedYolk = fish.lifeStage === 'fry'
      ? Math.min(
        Math.max(0, fish.yolkBiomass ?? 0),
        Math.max(0, fish.storedBiomass),
      )
      : 0;
    fish.yolkBiomass = protectedYolk;
    this.synchroniseRicefishEnergy(fish);
    if (
      fish.lifeStage === 'adult' &&
      fish.sex === 'female' &&
      fish.gestationRemaining === null &&
      fish.reproductionCooldown <= 0
    ) {
      const maximumEggMatter =
        RICEFISH_ECOLOGY_RULES.eggClutchMaximum *
        WATER_CYCLE_RULES.ricefish.eggBiomass;
      const surplus = Math.max(
        0,
        fish.storedBiomass -
          ricefishReproductionReserveFloor(fish.structuralBiomass),
      );
      const allocationFractionForStep = 1 - Math.pow(
        1 - RICEFISH_ECOLOGY_RULES.reproductionAllocationFraction,
        Math.max(0, deltaSeconds),
      );
      const allocation = Math.min(
        surplus * allocationFractionForStep,
        maximumEggMatter - fish.reproductiveBiomass,
      );
      fish.storedBiomass -= Math.max(0, allocation);
      fish.reproductiveBiomass += Math.max(0, allocation);
      const diagnostic = this.ricefishForagingDiagnostic(fish);
      if (diagnostic) {
        diagnostic.reproductiveAllocationBiomass +=
          Math.max(0, allocation);
      }
    }
    const nextTarget = this.ricefishDevelopmentalGrowthCeiling(fish);
    // Maintenance has already been paid above. Immature fish route net
    // production above their fasting reserve into somatic growth. Mature
    // females first transfer real conserved matter into eggs above, so their
    // remaining somatic growth slows through the actual reproduction cost
    // rather than an unrelated fixed percentage of each meal.
    if (fish.storedBiomass > 0) {
      const somaticGrowthRateScale = fish.lifeStage === 'adult'
        ? ricefishAdultSomaticGrowthRateScale(fish.structuralBiomass)
        : 1;
      const growthReserveFloor = fish.lifeStage === 'adult'
        ? ricefishAdultSomaticGrowthReserveFloor(fish.structuralBiomass)
        : Math.min(
          fish.storedBiomass,
          this.ricefishReserveCapacity(fish) *
            RICEFISH_ECOLOGY_RULES.subadultGrowthReserveFraction,
        );
      const nonYolkReserve = Math.max(
        0,
        fish.storedBiomass - protectedYolk,
      );
      const yolkReleasedForGrowth = fish.lifeStage === 'fry'
        ? ricefishYolkGrowthRelease(
          protectedYolk,
          fish.ageSeconds,
          deltaSeconds,
        )
        : 0;
      const reserveAvailableForGrowth = Math.min(
        Math.max(0, fish.storedBiomass - growthReserveFloor),
        nonYolkReserve + yolkReleasedForGrowth,
      );
      const desired = Math.min(
        nextTarget - fish.structuralBiomass,
        deltaSeconds * temperatureFactor *
          RICEFISH_ECOLOGY_RULES.maximumSomaticGrowthPerSecond *
          somaticGrowthRateScale,
        reserveAvailableForGrowth,
      );
      const committedGrowth = Math.max(0, desired);
      const yolkUsedForGrowth = Math.max(
        0,
        committedGrowth - nonYolkReserve,
      );
      fish.structuralBiomass += committedGrowth;
      fish.storedBiomass -= committedGrowth;
      const diagnostic = this.ricefishForagingDiagnostic(fish);
      if (diagnostic) {
        diagnostic.somaticGrowthBiomass += committedGrowth;
      }
      fish.yolkBiomass = Math.max(
        0,
        Math.min(
          fish.storedBiomass,
          protectedYolk - yolkUsedForGrowth,
        ),
      );
    }
    fish.peakStructuralBiomass = Math.max(
      fish.peakStructuralBiomass ?? fish.structuralBiomass,
      fish.structuralBiomass,
    );
    if (
      fish.lifeStage === 'fry' &&
      fish.ageSeconds >= RICEFISH_ECOLOGY_RULES.fryStageSeconds &&
      fish.structuralBiomass >= WATER_CYCLE_RULES.ricefish.fryBirthBiomass * 0.72
    ) {
      fish.lifeStage = 'juvenile';
      // The compressed yolk-absorption interval is complete. Any conserved
      // remainder stays in storedBiomass as ordinary reserve.
      fish.yolkBiomass = 0;
    }
    if (
      fish.lifeStage === 'juvenile' &&
      fish.ageSeconds >= RICEFISH_ECOLOGY_RULES.maturationSeconds &&
      fish.structuralBiomass >= WATER_CYCLE_RULES.ricefish.juvenileStructuralBiomass
    ) {
      fish.lifeStage = 'adult';
      fish.lifespanSeconds = ricefishLifespanDeadlineAtMaturity(
        fish.lifespanSeconds,
        fish.ageSeconds,
      );
      fish.reproductionCooldown = 120;
      fish.targetAnimalId = null;
      fish.strikeRecoveryUses = 0;
      fish.nextTargetEvaluation = 0.8;
      fish.behavior = 'exploring';
      this.recordAnimalPopulationEvent('matured', fish);
    }
    const somaticProgress = clamp01(
      (fish.structuralBiomass - WATER_CYCLE_RULES.ricefish.fryBirthBiomass) /
        (
          WATER_CYCLE_RULES.ricefish.adultStructuralBiomass -
          WATER_CYCLE_RULES.ricefish.fryBirthBiomass
        ),
    );
    fish.growthProgress = somaticProgress;
    // Length and every size-dependent ecological ability share one continuous
    // body-size axis. The named fry/juvenile/adult stages are lifecycle gates,
    // not permission to jump the rendered body or its sensory footprint.
    if (fish.lifeStage === 'fry' || fish.lifeStage === 'juvenile') {
      fish.bodyLength = ricefishSubadultBodyLengthForStructure(
        fish.structuralBiomass,
      );
    } else {
      const adultMassDevelopment = clamp01(
        (fish.structuralBiomass -
          WATER_CYCLE_RULES.ricefish.juvenileStructuralBiomass) /
          Math.max(
            1e-9,
            WATER_CYCLE_RULES.ricefish.adultStructuralBiomass -
              WATER_CYCLE_RULES.ricefish.juvenileStructuralBiomass,
          ),
      );
      fish.bodyLength = RICEFISH_ECOLOGY_RULES.juvenileLength +
        (
          RICEFISH_ECOLOGY_RULES.adultLength -
          RICEFISH_ECOLOGY_RULES.juvenileLength
        ) * adultMassDevelopment;
    }
  }

  private animalTargetStructuralBiomass(animal: AnimalState): number {
    if (animal.lifeStage === 'adult') {
      if (animal.origin === 'born') {
        return Math.max(
          SHRIMP_ECOLOGY_RULES.maturationStructuralBiomass,
          animal.peakStructuralBiomass ?? animal.structuralBiomass,
        );
      }
      return WATER_CYCLE_RULES.shrimp.adultStructuralBiomass;
    }
    const birth = WATER_CYCLE_RULES.shrimp.juvenileBirthBiomass;
    // A juvenile's achieved size is a one-way physiological reference. Using
    // its current growthProgress here made the reference shrink whenever the
    // body was catabolised, so both displayed condition and the minimum viable
    // structure followed a starving animal downward indefinitely. Old saves
    // without a peak fall back to their current conserved structure once.
    return Math.max(
      birth,
      animal.peakStructuralBiomass ?? animal.structuralBiomass,
    );
  }

  private shrimpClutchSize(animal: AnimalState): number {
    return clamp(
      Math.round(
        animal.ovarianClutchSize ??
          shrimpClutchSizeForStructure(animal.structuralBiomass),
      ),
      SHRIMP_ECOLOGY_RULES.minimumClutchSize,
      SHRIMP_ECOLOGY_RULES.maximumClutchSize,
    );
  }

  private shrimpBroodBiomass(animal: AnimalState): number {
    return this.shrimpClutchSize(animal) *
      WATER_CYCLE_RULES.shrimp.juvenileBirthBiomass;
  }

  private shrimpOvarianMatterTarget(animal: AnimalState): number {
    return this.shrimpBroodBiomass(animal) *
      (animal.gestationRemaining === null ? 1 : 2);
  }

  private animalMinimumViableStructure(animal: AnimalState): number {
    return this.animalTargetStructuralBiomass(animal) *
      (animal.lifeStage === 'adult'
        ? SHRIMP_ADULT_MINIMUM_VIABLE_STRUCTURE_RATIO
        : SHRIMP_JUVENILE_MINIMUM_VIABLE_STRUCTURE_RATIO);
  }

  /**
   * Reserve storage scales with the body that can physically carry it.
   *
   * Tank-born shrimp and juveniles are smaller than the supplied 1-B adult.
   * Their reserve compartment therefore uses the same six-percent body ratio
   * at every stage. The former fixed juvenile 0.09-B compartment let a
   * half-grown animal bank a substantial fraction of its own structure, so a
   * producer collapse did not reach the consumer graph until much later.
   */
  private shrimpReserveCapacity(animal: AnimalState): number {
    return WATER_CYCLE_RULES.shrimp.adultReserveBiomass *
      clamp(
        this.animalTargetStructuralBiomass(animal) /
          WATER_CYCLE_RULES.shrimp.adultStructuralBiomass,
        WATER_CYCLE_RULES.shrimp.juvenileBirthBiomass /
          WATER_CYCLE_RULES.shrimp.adultStructuralBiomass,
        1,
      );
  }

  private shrimpReserveCondition(animal: AnimalState): number {
    return clamp01(
      Math.max(0, animal.storedBiomass) /
        Math.max(1e-9, this.shrimpReserveCapacity(animal)),
    );
  }

  private shrimpIsWasting(animal: AnimalState): boolean {
    return animal.storedBiomass <= 1e-9 &&
      animal.structuralBiomass + 1e-9 <
        this.animalTargetStructuralBiomass(animal);
  }

  private shrimpJuvenileGrowthReserveFloor(animal: AnimalState): number {
    return this.animalTargetStructuralBiomass(animal) *
      SHRIMP_JUVENILE_GROWTH_RESERVE_FRACTION;
  }

  /**
   * A juvenile may retain only the material it can turn into structure during
   * this ecology step above its ordinary reserve capacity. That transient
   * allowance funds continuous growth without becoming a long-lived hidden
   * food store when grazing stops.
   */
  private shrimpJuvenileGrowthAllowance(
    animal: AnimalState,
    deltaSeconds: number,
    knownTemperatureFactor?: number,
  ): number {
    if (animal.lifeStage !== 'juvenile') return 0;
    const birthBiomass = WATER_CYCLE_RULES.shrimp.juvenileBirthBiomass;
    const maturationBiomass =
      SHRIMP_ECOLOGY_RULES.maturationStructuralBiomass;
    const maturationTargetSeconds =
      animal.maturationTargetSeconds ??
      shrimpMaturationTargetSeconds(animal.randomSeed);
    const temperatureFactor = knownTemperatureFactor ??
      interpolateTemperatureResponse(
        ANIMALS[animal.speciesId].temperature.reproductionCurve,
        this.biogeochemistry.temperatureAt(animal.position),
      );
    const structuralProgress = clamp01(
      (animal.structuralBiomass - birthBiomass) /
        Math.max(1e-9, maturationBiomass - birthBiomass),
    );
    const ageScheduleProgress = clamp01(
      animal.ageSeconds / Math.max(1e-9, maturationTargetSeconds),
    );
    const scheduleDeficit = Math.max(
      0,
      ageScheduleProgress - structuralProgress,
    );
    const compensatoryMultiplier = 1 + scheduleDeficit *
      (SHRIMP_ECOLOGY_RULES.maximumCompensatoryGrowthMultiplier - 1);
    return Math.min(
      Math.max(0, maturationBiomass - animal.structuralBiomass),
      (maturationBiomass - birthBiomass) *
        Math.max(0, deltaSeconds) * temperatureFactor *
        compensatoryMultiplier /
      Math.max(1e-9, maturationTargetSeconds),
    );
  }

  /**
   * Maximum assimilated matter this individual can use or retain this step.
   *
   * This is an appetite/material cap on the ordinary local functional
   * response, not a carrying-capacity rule. It reads only the individual's
   * current compartments and the costs that the same ecology step can
   * actually pay.
   */
  private shrimpAssimilationDemandForStep(
    animal: AnimalState,
    maintenanceRequest: number,
    reproductionTemperatureFactor: number,
    deltaSeconds: number,
  ): number {
    const freeReserve = Math.max(
      0,
      this.shrimpReserveCapacity(animal) - animal.storedBiomass,
    );
    const juvenileGrowth = this.shrimpJuvenileGrowthAllowance(
      animal,
      deltaSeconds,
      reproductionTemperatureFactor,
    );
    const ovarianAllocation =
      animal.lifeStage === 'adult' &&
      animal.sex === 'female' &&
      animal.reproductiveBiomass < this.shrimpOvarianMatterTarget(animal)
        ? Math.min(
          this.shrimpOvarianMatterTarget(animal) -
            animal.reproductiveBiomass,
          SHRIMP_ECOLOGY_RULES.ovarianAllocationPerSecond *
            Math.max(0, reproductionTemperatureFactor) *
            Math.max(0, animal.health) *
            Math.max(0, deltaSeconds),
        )
        : 0;
    const adultGrowthEligible =
      animal.lifeStage === 'adult' &&
      animal.structuralBiomass <
        WATER_CYCLE_RULES.shrimp.adultStructuralBiomass &&
      (
        animal.sex === 'male' ||
        animal.reproductiveBiomass + 1e-9 >=
          this.shrimpBroodBiomass(animal)
      );
    const adultGrowth = adultGrowthEligible
      ? Math.min(
        WATER_CYCLE_RULES.shrimp.adultStructuralBiomass -
          animal.structuralBiomass,
        SHRIMP_ECOLOGY_RULES.adultSomaticGrowthPerSecond *
          Math.max(0, reproductionTemperatureFactor) *
          Math.max(0, deltaSeconds),
      )
      : 0;
    return freeReserve + Math.max(0, maintenanceRequest) +
      juvenileGrowth + ovarianAllocation + adultGrowth;
  }

  private synchroniseAnimalEnergy(animal: AnimalState): void {
    const availableReserve = Math.max(0, animal.storedBiomass);
    const reserveCapacity = this.shrimpReserveCapacity(animal);
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

  private prepareShrimpFoodReservations(): void {
    this.allCells();
    const reservations = this.shrimpFoodReservationCountsScratch;
    reservations.fill(0);
    for (const animal of this.animals) {
      if (!animal.targetCellId) continue;
      const cellIndex = this.shrimpFoodCellIndexByIdScratch.get(
        animal.targetCellId,
      );
      if (cellIndex === undefined) continue;
      reservations[cellIndex] += 1;
    }
  }

  private adjustShrimpFoodReservation(
    targetCellId: string | null,
    delta: -1 | 1,
  ): void {
    if (!targetCellId) return;
    const cellIndex = this.shrimpFoodCellIndexByIdScratch.get(targetCellId);
    if (cellIndex === undefined) return;
    this.shrimpFoodReservationCountsScratch[cellIndex] += delta;
  }

  private chooseFoodTarget(animal: AnimalState): SurfaceCellState | null {
    if (!this.shrimpFoodReservationsActive) {
      this.prepareShrimpFoodReservations();
    }
    const ownTargetIndex = !this.shrimpFoodReservationsActive &&
      animal.targetCellId
      ? this.shrimpFoodCellIndexByIdScratch.get(animal.targetCellId)
      : undefined;
    let bestCell: SurfaceCellState | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    let recentFallbackCell: SurfaceCellState | null = null;
    let recentFallbackScore = Number.NEGATIVE_INFINITY;
    const cells = this.allCells();
    for (let cellIndex = 0; cellIndex < cells.length; cellIndex += 1) {
      const cell = cells[cellIndex];
      const food = this.edibleBiomass(cell);
      if (food <= 0) continue;
      const point = this.shrimpSurfaceContactPoint(cell);
      const distance = Math.sqrt(distanceSquared(animal.position, point));
      if (distance > SHRIMP_LOCAL_FOOD_RADIUS) continue;
      if (this.shrimpWaterStressAt(point) > 0) continue;
      const congestion =
        this.shrimpFoodReservationCountsScratch[cellIndex] -
        (cellIndex === ownTargetIndex ? 1 : 0);
      // Preserve a target only while traveling toward it, so movement does not
      // jitter between neighboring cells.
      const targetCommitment = cell.id === animal.targetCellId ? 14 : 0;
      const noise = deterministicNoise(
        animal.randomSeed + cell.index * 1.7 + point.x * 0.01,
      ) * 3;
      // Nearby food produces a stronger chemical/contact signal as the film
      // becomes denser, but the response saturates. Life stage, ovarian
      // progress and future growth demand do not reveal which cell is better.
      // Those physiological states affect whether the animal is hungry; patch
      // quality is learned only from realised intake after arrival.
      const localPatchCue =
        food / (
          food + WATER_CYCLE_RULES.shrimp.foragingCueHalfSaturationBiomass
        );
      if (
        distance > Math.max(4, cell.cellSize * 0.3) &&
        localPatchCue < SHRIMP_LOCAL_PATCH_NAVIGATION_CUE_MINIMUM
      ) {
        continue;
      }
      const foodUtility =
        localPatchCue *
        SHRIMP_LOCAL_FOOD_RADIUS *
        SHRIMP_LOCAL_PATCH_CUE_DISTANCE_WEIGHT;
      // Food search is a local encounter: choose a nearby sensed surface.
      // A stronger cue may justify a somewhat longer walk, while dissolved
      // gradients guide exploration when no edible surface is yet in range.
      // A surface cell is a sampling tile, not one shrimp-sized territory.
      // Multiple shrimp may share it; the later mass-conserving request
      // allocator divides the actually available film between them. Do not
      // add a second artificial territorial cost here.
      const score =
        -distance + foodUtility -
        congestion * SHRIMP_TARGET_CELL_CONGESTION_PENALTY +
        targetCommitment + noise;
      if (
        (animal.recentGrazingCellCooldown ?? 0) > 0 &&
        cell.id === animal.recentGrazingCellId
      ) {
        if (score > recentFallbackScore) {
          recentFallbackCell = cell;
          recentFallbackScore = score;
        }
        continue;
      }
      if (score > bestScore) {
        bestCell = cell;
        bestScore = score;
      }
    }
    return bestCell ?? recentFallbackCell;
  }

  private shrimpRealisedGrazingReturn(animal: AnimalState): number {
    const sampledSeconds = animal.grazingSessionSeconds ?? 0;
    if (sampledSeconds <= 0) return 0;
    const realisedAssimilationPerSecond =
      animal.grazingSessionIntake *
      WATER_CYCLE_RULES.shrimp.assimilationFraction /
      sampledSeconds;
    return realisedAssimilationPerSecond /
      Math.max(1e-9, this.shrimpGrazingMaintenancePerSecond(animal));
  }

  private shrimpGrazingMaintenancePerSecond(animal: AnimalState): number {
    const temperature = this.biogeochemistry.temperatureAt(animal.position);
    const temperatureProfile = ANIMALS[animal.speciesId].temperature;
    const metabolicTemperatureFactor = thetaTemperatureFactor(
      temperature,
      temperatureProfile.referenceTemperature,
      temperatureProfile.metabolicTheta,
      temperatureProfile.minimumMetabolicFactor,
      temperatureProfile.maximumMetabolicFactor,
    );
    const bodyMass = animal.structuralBiomass + animal.storedBiomass +
      animal.reproductiveBiomass;
    const adultReferenceMass =
      WATER_CYCLE_RULES.shrimp.adultStructuralBiomass +
      WATER_CYCLE_RULES.shrimp.suppliedReserveBiomass;
    return continuousBodyMassMaintenance(
      bodyMass,
      adultReferenceMass,
      SHRIMP_ECOLOGY_RULES.adultRoutineMaintenanceBiomassPerSecond /
        adultReferenceMass,
      SHRIMP_ECOLOGY_RULES.metabolicMassExponent,
    ) * SHRIMP_ECOLOGY_RULES.grazingActivityMultiplier *
      metabolicTemperatureFactor;
  }

  private daphniaWaterStressAt(point: Vec2): number {
    if (!this.biogeochemistry.effectsEnabled) return 0;
    const rules = PLANKTON_ECOLOGY_RULES.daphnia;
    const oxygen = this.biogeochemistry.oxygenAt(point);
    const toxicWaste = this.biogeochemistry.toxicWasteAt(point);
    const oxygenStress = clamp(
      (rules.oxygenStressStart - oxygen) /
        rules.oxygenStressStart,
      0,
      1,
    );
    const toxicStress = clamp(
      (toxicWaste - rules.toxicWasteStressStart) /
        Math.max(
          1,
          rules.toxicWasteFullStress - rules.toxicWasteStressStart,
        ),
      0,
      1,
    );
    return Math.max(oxygenStress, toxicStress);
  }

  /**
   * Compare only the current chemistry cell and its immediate neighbours.
   * Daphnia can alter swimming when their appendages encounter low oxygen or
   * dissolved waste, but they are never told where a remote safe cell lies.
   */
  private daphniaLocalWaterEscape(
    animal: AnimalState,
  ): { x: number; y: number; stress: number } | null {
    const currentStress = this.daphniaWaterStressAt(animal.position);
    if (currentStress <= 0) return null;

    let bestDirectionIndex = -1;
    let bestStress = currentStress;
    const candidate = this.localSamplePointScratch;
    for (
      let directionIndex = 0;
      directionIndex < LOCAL_WATER_SENSE_DIRECTIONS.length;
      directionIndex += 1
    ) {
      const direction = LOCAL_WATER_SENSE_DIRECTIONS[directionIndex];
      candidate.x = clamp(
        animal.position.x +
          direction.x * DAPHNIA_LOCAL_WATER_SENSE_RADIUS,
        10,
        this.tank.width - 10,
      );
      candidate.y = clamp(
        animal.position.y +
          direction.y * DAPHNIA_LOCAL_WATER_SENSE_RADIUS,
        this.tank.waterTop + 12,
        this.tank.groundY - 14,
      );
      const candidateX = candidate.x - animal.position.x;
      const candidateY = candidate.y - animal.position.y;
      if (candidateX * candidateX + candidateY * candidateY < 1) continue;
      const stress = this.daphniaWaterStressAt(candidate);
      if (stress < bestStress - 1e-4) {
        bestStress = stress;
        bestDirectionIndex = directionIndex;
      }
    }
    const escape = this.waterEscapeScratch;
    if (bestDirectionIndex >= 0) {
      const direction = LOCAL_WATER_SENSE_DIRECTIONS[bestDirectionIndex];
      escape.x = direction.x;
      escape.y = direction.y;
      escape.stress = currentStress;
      return escape;
    }

    // In the flat centre of a plume, retain one local escape heading for a
    // few seconds rather than jittering in place. This is ordinary correlated
    // motion and contains no sample from outside the local cue radius.
    const motionSeed = daphniaMotionSeed(animal.id);
    const escapePeriod = seededRange(
      motionSeed * 0.103 + 29.3,
      4.2,
      5.8,
    );
    const escapePhase = deterministicNoise(
      motionSeed * 0.107 + 31.7,
    );
    const phase = Math.floor(
      animal.ageSeconds / escapePeriod + escapePhase,
    );
    const angle = deterministicNoise(
      motionSeed * 2.17 + phase * 13.9,
    ) * Math.PI * 2;
    escape.x = Math.cos(angle);
    escape.y = Math.sin(angle);
    escape.stress = currentStress;
    return escape;
  }

  private shrimpWaterStressAt(point: Vec2): number {
    if (!this.biogeochemistry.effectsEnabled) return 0;
    const oxygen = this.biogeochemistry.oxygenAt(point);
    const toxicWaste = this.biogeochemistry.toxicWasteAt(point);
    const oxygenStress = clamp(
      (SHRIMP_OXYGEN_STRESS_START - oxygen) /
        SHRIMP_OXYGEN_STRESS_START,
      0,
      1,
    );
    const toxicStress = clamp(
      (toxicWaste - SHRIMP_TOXIC_STRESS_START) /
        (SHRIMP_TOXIC_STRESS_FULL - SHRIMP_TOXIC_STRESS_START),
      0,
      1,
    );
    return Math.max(oxygenStress, toxicStress);
  }

  /**
   * Return a unit vector away from the current harmful pocket. This is a
   * chemotactic local comparison, not a search for the tank-wide safest cell.
   * When all nearby samples are equally poor, one stable individual heading
   * prevents the animal from freezing in the centre of a broad flat hotspot.
   */
  private shrimpLocalWaterEscape(
    animal: AnimalState,
  ): { x: number; y: number; stress: number } | null {
    const currentStress = this.shrimpWaterStressAt(animal.position);
    if (currentStress <= 0) return null;

    let bestDirectionIndex = -1;
    let bestStress = currentStress;
    const candidate = this.localSamplePointScratch;
    for (
      let directionIndex = 0;
      directionIndex < LOCAL_WATER_SENSE_DIRECTIONS.length;
      directionIndex += 1
    ) {
      const direction = LOCAL_WATER_SENSE_DIRECTIONS[directionIndex];
      candidate.x = clamp(
        animal.position.x +
          direction.x * SHRIMP_LOCAL_WATER_SENSE_RADIUS,
        18,
        this.tank.width - 18,
      );
      candidate.y = clamp(
        animal.position.y +
          direction.y * SHRIMP_LOCAL_WATER_SENSE_RADIUS,
        this.tank.waterTop + 18,
        this.tank.groundY - 16,
      );
      const candidateX = candidate.x - animal.position.x;
      const candidateY = candidate.y - animal.position.y;
      if (candidateX * candidateX + candidateY * candidateY < 1) continue;
      const stress = this.shrimpWaterStressAt(candidate);
      if (stress < bestStress - 1e-4) {
        bestStress = stress;
        bestDirectionIndex = directionIndex;
      }
    }

    const escape = this.waterEscapeScratch;
    if (bestDirectionIndex >= 0) {
      const direction = LOCAL_WATER_SENSE_DIRECTIONS[bestDirectionIndex];
      escape.x = direction.x;
      escape.y = direction.y;
      escape.stress = currentStress;
      return escape;
    }

    // A deterministic six-second heading is local random motion, not hidden
    // knowledge. Keeping it stable long enough to cross several chemistry
    // cells lets a shrimp escape the flat centre of a freshly formed plume.
    const phase = Math.floor(animal.ageSeconds / 6);
    const angle = deterministicNoise(
      animal.randomSeed * 1.91 + phase * 17.3,
    ) * Math.PI * 2;
    escape.x = Math.cos(angle);
    escape.y = Math.sin(angle);
    escape.stress = currentStress;
    return escape;
  }

  private shrimpFoodCueDirection(animal: AnimalState): Vec2 | null {
    return this.shrimpLocalCueDirection(
      animal,
      'food',
      SHRIMP_FOOD_CUE_SAMPLE_RADIUS,
      SHRIMP_FOOD_CUE_MINIMUM,
      SHRIMP_FOOD_CUE_GRADIENT_MINIMUM,
      SHRIMP_FOOD_CUE_UPSTREAM_WEIGHT,
    );
  }

  private shrimpMateCueDirection(animal: AnimalState): Vec2 | null {
    if (
      animal.speciesId !== 'cherry-shrimp' ||
      animal.lifeStage !== 'adult' ||
      animal.sex !== 'male' ||
      this.shrimpReserveCondition(animal) <
        SHRIMP_ECOLOGY_RULES.maleReproductionReserveFraction ||
      animal.reproductionCooldown > 0
    ) return null;
    return this.shrimpLocalCueDirection(
      animal,
      'mate',
      SHRIMP_MATE_CUE_SAMPLE_RADIUS,
      SHRIMP_MATE_CUE_MINIMUM,
      SHRIMP_MATE_CUE_GRADIENT_MINIMUM,
      SHRIMP_MATE_CUE_UPSTREAM_WEIGHT,
    );
  }

  /**
   * Sample a dissolved cue only at the animal and eight neighbouring points.
   * The caller supplies cue identity and sensory thresholds; no emitter
   * position or remote surface/animal id is exposed to movement.
   */
  private shrimpLocalCueDirection(
    animal: AnimalState,
    cueKind: 'food' | 'mate',
    sampleRadius: number,
    minimumCue: number,
    minimumGradient: number,
    upstreamWeight: number,
  ): Vec2 | null {
    const centreCue = cueKind === 'food'
      ? this.biogeochemistry.shrimpFoodCueAt(animal.position)
      : this.biogeochemistry.shrimpMateCueAt(animal.position);
    let strongestCue = centreCue;
    let gradientX = 0;
    let gradientY = 0;
    const samplePoint = this.localSamplePointScratch;
    for (
      let directionIndex = 0;
      directionIndex < LOCAL_CUE_SENSE_DIRECTIONS.length;
      directionIndex += 1
    ) {
      const direction = LOCAL_CUE_SENSE_DIRECTIONS[directionIndex];
      samplePoint.x = clamp(
        animal.position.x + direction.x * sampleRadius,
        18,
        this.tank.width - 18,
      );
      samplePoint.y = clamp(
        animal.position.y + direction.y * sampleRadius,
        this.tank.waterTop + 18,
        this.tank.groundY - 16,
      );
      const cue = cueKind === 'food'
        ? this.biogeochemistry.shrimpFoodCueAt(samplePoint)
        : this.biogeochemistry.shrimpMateCueAt(samplePoint);
      strongestCue = Math.max(strongestCue, cue);
      const difference = cue - centreCue;
      gradientX += difference * direction.x;
      gradientY += difference * direction.y;
    }
    if (strongestCue < minimumCue) return null;

    const gradientMagnitude = Math.hypot(gradientX, gradientY);
    const velocity = this.biogeochemistry.velocityAt(
      animal.position,
      this.waterVelocityScratch,
    );
    const flowMagnitude = Math.hypot(velocity.x, velocity.y);
    if (gradientMagnitude >= minimumGradient) {
      gradientX /= gradientMagnitude;
      gradientY /= gradientMagnitude;
      if (flowMagnitude > 1e-4) {
        const upstreamX = -velocity.x / flowMagnitude;
        const upstreamY = -velocity.y / flowMagnitude;
        gradientX =
          gradientX * (1 - upstreamWeight) +
          upstreamX * upstreamWeight;
        gradientY =
          gradientY * (1 - upstreamWeight) +
          upstreamY * upstreamWeight;
      }
      const blendedMagnitude = Math.hypot(gradientX, gradientY);
      if (blendedMagnitude > 1e-6) {
        this.cueDirectionScratch.x = gradientX / blendedMagnitude;
        this.cueDirectionScratch.y = gradientY / blendedMagnitude;
        return this.cueDirectionScratch;
      }
    }

    // In a locally flat part of a moving plume, upstream rheotaxis remains a
    // local response. With neither a gradient nor flow, ordinary casting is
    // handled by the existing correlated random walk.
    if (flowMagnitude <= 1e-4) return null;
    this.cueDirectionScratch.x = -velocity.x / flowMagnitude;
    this.cueDirectionScratch.y = -velocity.y / flowMagnitude;
    return this.cueDirectionScratch;
  }

  private chooseExplorationTarget(
    animal: AnimalState,
    localCueDirection: Vec2 | null = null,
  ): SurfaceCellState | null {
    const cells = this.allCells();
    if (!cells.length) return null;
    const phase = Math.floor(animal.ageSeconds / 4.5);
    const randomHeading =
      deterministicNoise(animal.randomSeed + phase * 19 + 0.37) * Math.PI * 2;
    const direction = localCueDirection ?? {
      x: Math.cos(randomHeading),
      y: Math.sin(randomHeading),
    };
    const roamingDistance = animal.lifeStage === 'juvenile'
      ? localCueDirection ? 112 : 72
      : localCueDirection ? 210 : 170;
    const desiredPoint = {
      x: animal.position.x + direction.x * roamingDistance,
      y: animal.position.y + direction.y * roamingDistance,
    };
    let best: { cell: SurfaceCellState; score: number } | null = null;
    const samples = Math.min(48, cells.length);
    for (let index = 0; index < samples; index += 1) {
      const sampleIndex = Math.floor(deterministicNoise(
        animal.randomSeed + phase * 19 + index * 7.3,
      ) * cells.length);
      const cell = cells[sampleIndex];
      const point = this.shrimpSurfaceContactPoint(cell);
      // Geometry alone chooses the next reachable surface. The heading is
      // either the correlated random walk or a locally sampled food/mate
      // odour-flow direction; a source cell or animal itself remains unknown
      // until it enters the existing contact-scale encounter radius.
      const score =
        -Math.sqrt(distanceSquared(point, desiredPoint)) -
        (point.y < this.tank.waterTop + 80 ? 120 : 0);
      if (!best || score > best.score) best = { cell, score };
    }
    return best?.cell ?? cells[0];
  }

  private sampleLightField(point: Vec2): number {
    const column = clamp(
      Math.floor((point.x / this.tank.width) * this.lightField.columns),
      0,
      this.lightField.columns - 1,
    );
    const row = clamp(
      Math.floor(((point.y - this.tank.waterTop) / (this.tank.groundY - this.tank.waterTop)) * this.lightField.rows),
      0,
      this.lightField.rows - 1,
    );
    return this.lightField.values[row * this.lightField.columns + column] ?? 0;
  }

  private vallisneriaRametForCell(
    cell: SurfaceCellState,
  ): SeedPlacementState | undefined {
    for (let index = 0; index < this.seedPlacements.length; index += 1) {
      const placement = this.seedPlacements[index];
      if (
        placement.speciesId === 'vallisneria' &&
        placement.cellId === cell.id
      ) return placement;
    }
    return undefined;
  }

  private producerActivityPoint(
    cell: SurfaceCellState,
    speciesId: SpeciesId,
  ): Vec2 {
    const surfacePoint = this.cellWorldPoint(cell);
    if (speciesId !== 'vallisneria') return surfacePoint;
    // Structural leaf size follows the much slower ramet life cycle, not the
    // reserve biomass lost and regained within one night/day cycle.
    const ramet = this.vallisneriaRametForCell(cell);
    const anchor = ramet ? this.vallisneriaRootPosition(ramet, cell) : surfacePoint;
    const structuralScale = ramet?.plant?.structuralScale ?? 0.72;
    const canopy = writeVallisneriaCanopyBounds(
      cell.index,
      anchor,
      structuralScale,
      this.vallisneriaCanopyBoundsScratch,
      this.vallisneriaLeavesScratch,
      this.vallisneriaLeafPointScratch,
    );
    this.vallisneriaActivityPointScratch.x = anchor.x;
    this.vallisneriaActivityPointScratch.y = Math.max(
      this.tank.waterTop + 16,
      canopy.minY + 5,
    );
    return this.vallisneriaActivityPointScratch;
  }

  /**
   * A rooted macrophyte photosynthesizes across its leaf blades. Sampling one
   * point above the root made an otherwise exposed rosette behave as though
   * its whole canopy were hidden whenever that point happened to sit behind a
   * stone. Average several positions along every painted leaf so partial shade
   * reduces production without creating a single-point collapse loop.
   */
  private vallisneriaCanopySamplePoints(cell: SurfaceCellState): number {
    const ramet = this.vallisneriaRametForCell(cell);
    const anchor = ramet
      ? this.vallisneriaRootPosition(ramet, cell)
      : this.cellWorldPoint(cell);
    const structuralScale = ramet?.plant?.structuralScale ?? 0.72;
    const leafCount = writeVallisneriaLeaves(
      cell.index,
      anchor,
      structuralScale,
      this.vallisneriaLeavesScratch,
    );
    let pointCount = 0;
    for (let leafIndex = 0; leafIndex < leafCount; leafIndex += 1) {
      const leaf = this.vallisneriaLeavesScratch[leafIndex];
      for (let positionIndex = 0; positionIndex < 4; positionIndex += 1) {
        const point = this.vallisneriaCanopyPointsScratch[pointCount] ?? {
          x: 0,
          y: 0,
        };
        vallisneriaLeafPoint(leaf, (positionIndex + 1) * 0.25, point);
        this.vallisneriaCanopyPointsScratch[pointCount] = point;
        pointCount += 1;
      }
    }
    return pointCount;
  }

  private vallisneriaCanopyLightSamples(cell: SurfaceCellState): number {
    const pointCount = this.vallisneriaCanopySamplePoints(cell);
    for (let index = 0; index < pointCount; index += 1) {
      this.vallisneriaCanopyLightsScratch[index] = this.sampleLightField(
        this.vallisneriaCanopyPointsScratch[index],
      );
    }
    return pointCount;
  }

  /**
   * Approximate sediment-root nutrition with the bottom-water ledger at the
   * actual root. The previous "best of every leaf and root sample" query let a
   * ramet drain whichever distant water cell happened to be richest on every
   * step. Carbon uptake is not yet a separate leaf flux, but a stable root
   * proxy is less omniscient and keeps mineral competition spatially local.
   */
  private vallisneriaUptakePoint(cell: SurfaceCellState): Vec2 {
    const ramet = this.vallisneriaRametForCell(cell);
    const root = ramet
      ? this.vallisneriaRootPosition(ramet, cell)
      : this.cellWorldPoint(cell);
    this.vallisneriaUptakePointScratch.x = root.x;
    this.vallisneriaUptakePointScratch.y = root.y;
    return this.vallisneriaUptakePointScratch;
  }

  /**
   * Rooted uptake remains the larger share, while submerged leaves can use
   * locally dissolved nutrients and carbon. Averaging every actual tissue
   * sample prevents both the former richest-cell selection and the root-only
   * starvation caused by treating bottom water as if it were sediment.
   */
  private vallisneriaResourceFactor(cell: SurfaceCellState): number {
    const rootFactor = this.biogeochemistry.algaeResourceFactor(
      this.vallisneriaUptakePoint(cell),
    );
    const sampleCount = this.vallisneriaCanopySamplePoints(cell);
    if (sampleCount === 0) return rootFactor;
    let leafTotal = 0;
    for (let index = 0; index < sampleCount; index += 1) {
      leafTotal += this.biogeochemistry.algaeResourceFactor(
        this.vallisneriaCanopyPointsScratch[index],
      );
    }
    const leafFactor = leafTotal / sampleCount;
    return rootFactor * VALLISNERIA_ROOT_UPTAKE_SHARE +
      leafFactor * (1 - VALLISNERIA_ROOT_UPTAKE_SHARE);
  }

  private vallisneriaCanopyLight(cell: SurfaceCellState): number {
    const sampleCount = this.vallisneriaCanopyLightSamples(cell);
    if (sampleCount === 0) {
      return this.sampleLightField(this.producerActivityPoint(cell, 'vallisneria'));
    }
    let total = 0;
    for (let index = 0; index < sampleCount; index += 1) {
      total += this.vallisneriaCanopyLightsScratch[index];
    }
    return total / sampleCount;
  }

  private vallisneriaCanopyPhysiology(
    cell: SurfaceCellState,
    temperature: number,
    reuse?: AlgaePhysiologyRates,
  ): ReturnType<typeof algaePhysiology> {
    const sampleCount = this.vallisneriaCanopyLightSamples(cell);
    if (sampleCount === 0) {
      const activityPoint = this.producerActivityPoint(cell, 'vallisneria');
      return algaePhysiology(
        'vallisneria',
        this.vallisneriaCanopyLight(cell) *
          this.biogeochemistry.algaeLightTransmissionAt(activityPoint),
        temperature,
        reuse,
      );
    }
    const output = reuse ?? {
      grossPhotosynthesis: 0,
      respiration: 0,
      lightStressTurnover: 0,
      netGrowth: 0,
    };
    // Keep the per-leaf result distinct from the accumulator even if a future
    // caller accidentally passes the usual sample scratch as its reuse target.
    // Aliasing these objects overwrites the running sum on every leaf.
    const total = output === this.vallisneriaPhysiologySampleScratch
      ? this.vallisneriaPhysiologyTotalScratch
      : output;
    total.grossPhotosynthesis = 0;
    total.respiration = 0;
    total.lightStressTurnover = 0;
    total.netGrowth = 0;
    const rates = this.vallisneriaPhysiologyRatesScratch;
    for (let index = 0; index < sampleCount; index += 1) {
      writeAlgaePhysiologyRates(
        'vallisneria',
        this.vallisneriaCanopyLightsScratch[index] *
          this.biogeochemistry.algaeLightTransmissionAt(
            this.vallisneriaCanopyPointsScratch[index],
          ),
        temperature,
        rates,
      );
      total.grossPhotosynthesis += rates[ALGAE_PHYSIOLOGY_GROSS];
      total.respiration += rates[ALGAE_PHYSIOLOGY_RESPIRATION];
      total.lightStressTurnover += rates[ALGAE_PHYSIOLOGY_STRESS];
      total.netGrowth += rates[ALGAE_PHYSIOLOGY_NET];
    }
    total.grossPhotosynthesis /= sampleCount;
    total.respiration /= sampleCount;
    total.lightStressTurnover /= sampleCount;
    total.netGrowth /= sampleCount;
    if (total !== output) {
      output.grossPhotosynthesis = total.grossPhotosynthesis;
      output.respiration = total.respiration;
      output.lightStressTurnover = total.lightStressTurnover;
      output.netGrowth = total.netGrowth;
    }
    return output;
  }

  /**
   * Withdraw one canopy's finite carbon/nutrients at its rooted uptake point,
   * but release the resulting oxygen along the illuminated leaf tissue.
   * A single root-cell oxygen pulse made a tall plant spatially equivalent to
   * a bottom film and exaggerated day/night swings around attached eggs.
   */
  private commitVallisneriaProduction(
    cell: SurfaceCellState,
    uptakePoint: Vec2,
    requestedBiomass: number,
    temperature: number,
  ): number {
    const requested = Math.max(0, requestedBiomass);
    if (requested <= 0) return 0;
    const sampleCount = this.vallisneriaCanopyLightSamples(cell);
    if (sampleCount === 0) {
      return this.biogeochemistry.commitAlgaeProduction(
        uptakePoint,
        requested,
        this.producerActivityPoint(cell, 'vallisneria'),
      );
    }

    let totalWeight = 0;
    for (let index = 0; index < sampleCount; index += 1) {
      writeAlgaePhysiologyRates(
        'vallisneria',
        this.vallisneriaCanopyLightsScratch[index] *
          this.biogeochemistry.algaeLightTransmissionAt(
            this.vallisneriaCanopyPointsScratch[index],
          ),
        temperature,
        this.vallisneriaPhysiologyRatesScratch,
      );
      const weight = Math.max(
        0,
        this.vallisneriaPhysiologyRatesScratch[
          ALGAE_PHYSIOLOGY_GROSS
        ],
      );
      this.vallisneriaCanopyProductionWeightsScratch[index] = weight;
      totalWeight += weight;
    }
    if (totalWeight <= 1e-12) return 0;

    let committed = 0;
    for (let index = 0; index < sampleCount; index += 1) {
      const share = requested *
        this.vallisneriaCanopyProductionWeightsScratch[index] /
        totalWeight;
      if (share <= 0) continue;
      const rootCommitted = this.biogeochemistry.commitAlgaeProduction(
        uptakePoint,
        share * VALLISNERIA_ROOT_UPTAKE_SHARE,
        this.vallisneriaCanopyPointsScratch[index],
      );
      // If the bottom-water proxy cannot supply its nominal rooted share,
      // permit the illuminated leaf at this exact location to take up the
      // remainder. This is local plasticity, not a scan for the richest cell.
      const leafCommitted = this.biogeochemistry.commitAlgaeProduction(
        this.vallisneriaCanopyPointsScratch[index],
        share - rootCommitted,
        this.vallisneriaCanopyPointsScratch[index],
      );
      committed += rootCommitted + leafCommitted;
    }
    return committed;
  }

  /** Registers the rooted and leaf shares before the shared N pool is split. */
  private registerVallisneriaProductionDemand(
    cell: SurfaceCellState,
    requestedBiomass: number,
    temperature: number,
  ): void {
    const requested = Math.max(0, requestedBiomass);
    if (requested <= 0) return;
    const uptakePoint = this.vallisneriaUptakePoint(cell);
    const sampleCount = this.vallisneriaCanopyLightSamples(cell);
    if (sampleCount === 0) {
      this.biogeochemistry.registerAlgaeProductionDemand(
        uptakePoint,
        requested,
      );
      return;
    }

    let totalWeight = 0;
    for (let index = 0; index < sampleCount; index += 1) {
      writeAlgaePhysiologyRates(
        'vallisneria',
        this.vallisneriaCanopyLightsScratch[index] *
          this.biogeochemistry.algaeLightTransmissionAt(
            this.vallisneriaCanopyPointsScratch[index],
          ),
        temperature,
        this.vallisneriaPhysiologyRatesScratch,
      );
      const weight = Math.max(
        0,
        this.vallisneriaPhysiologyRatesScratch[ALGAE_PHYSIOLOGY_GROSS],
      );
      this.vallisneriaCanopyProductionWeightsScratch[index] = weight;
      totalWeight += weight;
    }
    if (totalWeight <= 1e-12) return;

    for (let index = 0; index < sampleCount; index += 1) {
      const share = requested *
        this.vallisneriaCanopyProductionWeightsScratch[index] /
        totalWeight;
      this.biogeochemistry.registerAlgaeProductionDemand(
        uptakePoint,
        share * VALLISNERIA_ROOT_UPTAKE_SHARE,
      );
      this.biogeochemistry.registerAlgaeProductionDemand(
        this.vallisneriaCanopyPointsScratch[index],
        share * (1 - VALLISNERIA_ROOT_UPTAKE_SHARE),
      );
    }
  }

  /**
   * Submerged leaf tissue also respires in place. Divide the canopy demand by
   * painted leaf area instead of consuming the entire plant's night oxygen at
   * whichever single point happened to win the nutrient-uptake comparison.
   */
  private commitVallisneriaRespiration(
    cell: SurfaceCellState,
    requestedBiomass: number,
  ): number {
    const requested = Math.max(0, requestedBiomass);
    if (requested <= 0) return 0;
    const sampleCount = this.vallisneriaCanopySamplePoints(cell);
    if (sampleCount === 0) {
      return this.biogeochemistry.commitAlgaeRespiration(
        this.producerActivityPoint(cell, 'vallisneria'),
        requested,
      );
    }
    const share = requested / sampleCount;
    let committed = 0;
    for (let index = 0; index < sampleCount; index += 1) {
      committed += this.biogeochemistry.commitAlgaeRespiration(
        this.vallisneriaCanopyPointsScratch[index],
        share,
      );
    }
    return committed;
  }

  private vallisneriaCanopySuitability(
    cell: SurfaceCellState,
    temperature: number,
  ): number {
    const sampleCount = this.vallisneriaCanopyLightSamples(cell);
    if (sampleCount === 0) {
      const activityPoint = this.producerActivityPoint(cell, 'vallisneria');
      return habitatSuitability(
        'vallisneria',
        this.vallisneriaCanopyLight(cell) *
          this.biogeochemistry.algaeLightTransmissionAt(activityPoint),
        temperature,
      );
    }
    let total = 0;
    for (let index = 0; index < sampleCount; index += 1) {
      total += habitatSuitability(
        'vallisneria',
        this.vallisneriaCanopyLightsScratch[index] *
          this.biogeochemistry.algaeLightTransmissionAt(
            this.vallisneriaCanopyPointsScratch[index],
          ),
        temperature,
      );
    }
    return total / sampleCount;
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
        this.tank.width - 2,
      ),
      y: clamp(
        cell.y + (deterministicNoise(seed * 0.0713 + 17) * 2 - 1) * radius,
        this.tank.groundY - cell.cellSize * 3 + 1,
        this.tank.groundY - 1,
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
        // Inventory stock is an established rooted rosette, not a newly
        // detached runner. Its leaves must begin tall enough to sample the
        // water above ordinary hardscape instead of shrinking forever inside
        // one stone's shadow.
        ? 0.62 + deterministicNoise(seed * 0.0319) * 0.08
        // A runner plantlet remains visibly smaller, but retains enough leaf
        // area to use the support it receives from its connected parent.
        : 0.24,
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
    const reserveHealth = clamp01(
      (
        cell.biomass.vallisneria -
          0.018 * VALLISNERIA_LEDGER_BIOMASS_SCALE
      ) /
        (0.27 * VALLISNERIA_LEDGER_BIOMASS_SCALE),
    );
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
    const sourceTemperature = this.biogeochemistry.temperatureAt(
      this.producerActivityPoint(source, 'vallisneria'),
    );
    const sourceSuitability = this.vallisneriaCanopySuitability(
      source,
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
      const targetSuitability = this.vallisneriaCanopySuitability(
        cell,
        this.biogeochemistry.temperatureAt(targetPoint),
      );
      const targetResourceSuitability = this.biogeochemistry.algaeResourceFactor(
        this.vallisneriaUptakePoint(cell),
      );
      // Clonal foraging is a bias, not omniscience: habitat and competition
      // matter, while deterministic noise still produces varied directions.
      const competition = clamp01(total);
      const score = Math.abs(distance - preferredDistance) +
        (1 - targetSuitability) * 68 +
        (1 - targetResourceSuitability) * 42 +
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
      const parentSurplus = Math.max(
        0,
        parentCell.biomass.vallisneria -
          0.24 * VALLISNERIA_LEDGER_BIOMASS_SCALE,
      );
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
      const reserveScale = 0.16 + 0.84 * clamp01(
        (
          biomass - 0.02 * VALLISNERIA_LEDGER_BIOMASS_SCALE
        ) /
          (0.46 * VALLISNERIA_LEDGER_BIOMASS_SCALE),
      );
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
      if (
        expired ||
        reserveCollapsed ||
        cell.biomass.vallisneria <= VALLISNERIA_VISIBLE_BIOMASS
      ) {
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
      if (
        stage !== 'mature' ||
        health < 0.68 ||
        biomass <
          VALLISNERIA_RUNNER_BIOMASS +
            0.18 * VALLISNERIA_LEDGER_BIOMASS_SCALE
      ) {
        life.runnerProgress = Math.max(0, life.runnerProgress - deltaSeconds / 1_800);
        continue;
      }
      const temperature = this.biogeochemistry.temperatureAt(this.producerActivityPoint(cell, 'vallisneria'));
      const suitability = this.vallisneriaCanopySuitability(cell, temperature);
      life.runnerProgress += deltaSeconds / VALLISNERIA_RUNNER_INTERVAL_SECONDS *
        clamp(
          health * suitability *
            (
              biomass /
                (0.5 * VALLISNERIA_LEDGER_BIOMASS_SCALE)
            ),
          0,
          1.35,
        );
      if (life.runnerProgress < 1) continue;

      const destination = this.runnerDestination(placement);
      if (!destination) {
        life.runnerProgress = Math.min(1, life.runnerProgress);
        continue;
      }
      const transferred = Math.min(
        VALLISNERIA_RUNNER_BIOMASS,
        cell.biomass.vallisneria -
          0.18 * VALLISNERIA_LEDGER_BIOMASS_SCALE,
      );
      if (
        transferred <=
          0.04 * VALLISNERIA_LEDGER_BIOMASS_SCALE
      ) continue;
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
    const biomassValueCount = cells.length * 3;
    if (this.growthOriginalScratch.length !== biomassValueCount) {
      this.growthOriginalScratch = new Float64Array(biomassValueCount);
      this.growthNextScratch = new Float64Array(biomassValueCount);
      this.growthRatesByCellScratch = new Float64Array(biomassValueCount);
      this.growthProductionRequestsByCellScratch =
        new Float64Array(biomassValueCount);
      this.growthPhysiologyByCellScratch = new Float64Array(
        biomassValueCount * ALGAE_PHYSIOLOGY_VALUE_COUNT,
      );
    }
    const original = this.growthOriginalScratch;
    const next = this.growthNextScratch;
    const rates = this.growthRatesByCellScratch;
    const productionRequests = this.growthProductionRequestsByCellScratch;
    const physiology = this.growthPhysiologyByCellScratch;
    const cellIndexById = this.growthCellIndexByIdScratch;
    cellIndexById.clear();
    let currentProducerBiomass = 0;
    for (let index = 0; index < cells.length; index += 1) {
      const cell = cells[index];
      const source = cell.biomass;
      const offset = index * 3;
      original[offset + GROWTH_SPECIES_INDEX.oedogonium] = source.oedogonium;
      original[offset + GROWTH_SPECIES_INDEX.nitzschia] = source.nitzschia;
      original[offset + GROWTH_SPECIES_INDEX.vallisneria] = source.vallisneria;
      cellIndexById.set(cell.id, index);
      currentProducerBiomass +=
        source.oedogonium + source.nitzschia + source.vallisneria;
    }
    next.fill(0);
    rates.fill(0);
    productionRequests.fill(0);
    physiology.fill(0);
    const backgroundProducerCapacity = this.scenario.waterCycle
      ? null
      : this.scenario.backgroundProducerCapacity;
    const tankBackgroundNutrientFactor = backgroundProducerCapacity === null
      ? 1
      : clamp01(1 - currentProducerBiomass / backgroundProducerCapacity);

    // First calculate every producer's request from the same pre-reaction
    // state. The ledger needs this complete demand field before it can divide
    // finite ammonium fairly between producers and nitrifiers.
    for (let cellIndex = 0; cellIndex < cells.length; cellIndex += 1) {
      const cell = cells[cellIndex];
      const cellOffset = cellIndex * 3;
      const total =
        original[cellOffset + GROWTH_SPECIES_INDEX.oedogonium] +
        original[cellOffset + GROWTH_SPECIES_INDEX.nitzschia] +
        original[cellOffset + GROWTH_SPECIES_INDEX.vallisneria];
      const backgroundNutrientFactor =
        backgroundProducerCapacity !== null &&
        this.scenario.backgroundProducerResourceMode === 'surface'
          ? clamp01(
            1 - total / (
              backgroundProducerCapacity / Math.max(1, cells.length)
            ),
          )
          : tankBackgroundNutrientFactor;
      const freeCapacity = clamp01(1 - total);
      const resourceFactors = this.growthResourceFactorsScratch;
      resourceFactors.fill(0);
      for (const speciesId of this.scenario.allowedSpecies) {
        const speciesIndex = GROWTH_SPECIES_INDEX[speciesId];
        // An absent producer contributes neither to this cell's weighted
        // growth nor to its material flux. In particular, do not build a full
        // Vallisneria leaf canopy for every empty grid cell once per ecology
        // second.
        if (original[cellOffset + speciesIndex] <= 0) continue;
        const physiologyPoint = this.producerActivityPoint(cell, speciesId);
        const activityPoint = speciesId === 'vallisneria'
          ? this.vallisneriaUptakePoint(cell)
          : physiologyPoint;
        const localTemperature = this.biogeochemistry.temperatureAt(physiologyPoint);
        const physiologyOffset = (cellOffset + speciesIndex) *
          ALGAE_PHYSIOLOGY_VALUE_COUNT;
        if (speciesId === 'vallisneria') {
          const response = this.vallisneriaCanopyPhysiology(
            cell,
            localTemperature,
            // The accumulator must not alias the per-leaf sample scratch used
            // inside vallisneriaCanopyPhysiology. Aliasing overwrites the
            // running sum on every leaf and underestimates the canopy rate.
            this.vallisneriaPhysiologyTotalScratch,
          );
          physiology[physiologyOffset + ALGAE_PHYSIOLOGY_GROSS] =
            response.grossPhotosynthesis;
          physiology[physiologyOffset + ALGAE_PHYSIOLOGY_RESPIRATION] =
            response.respiration;
          physiology[physiologyOffset + ALGAE_PHYSIOLOGY_STRESS] =
            response.lightStressTurnover;
          physiology[physiologyOffset + ALGAE_PHYSIOLOGY_NET] =
            response.netGrowth;
        } else {
          writeAlgaePhysiologyRates(
            speciesId,
            cell.light *
              this.biogeochemistry.algaeLightTransmissionAt(physiologyPoint),
            localTemperature,
            physiology,
            physiologyOffset,
          );
        }
        const resourceFactor = (
          speciesId === 'vallisneria'
            ? this.vallisneriaResourceFactor(cell)
            : this.biogeochemistry.algaeResourceFactor(activityPoint)
        ) * backgroundNutrientFactor;
        resourceFactors[speciesIndex] = resourceFactor;
        const grossPhotosynthesis =
          physiology[physiologyOffset + ALGAE_PHYSIOLOGY_GROSS];
        const respirationRate =
          physiology[physiologyOffset + ALGAE_PHYSIOLOGY_RESPIRATION];
        const lightStressTurnover =
          physiology[physiologyOffset + ALGAE_PHYSIOLOGY_STRESS];
        // Resource limitation acts on all new biomass fixation. The previous
        // formulation reduced only the positive surplus after replacing
        // respiration and stress, allowing a nearly nutrient-free film to
        // maintain itself indefinitely as long as a trace pool remained.
        rates[cellOffset + speciesIndex] =
          grossPhotosynthesis * resourceFactor -
          respirationRate - lightStressTurnover;
        const amount = original[cellOffset + speciesIndex];
        const speciesFreeCapacity = speciesId === 'vallisneria'
          ? clamp01(
            (VALLISNERIA_CELL_BIOMASS_CAPACITY - amount) /
              VALLISNERIA_CELL_BIOMASS_CAPACITY,
          )
          : freeCapacity;
        const resourceAdjustedGross = grossPhotosynthesis * resourceFactor;
        const resourceAdjustedNet = resourceAdjustedGross - respirationRate -
          lightStressTurnover;
        // Space limitation throttles only a genuinely positive surplus. If
        // resource-limited fixation cannot replace maintenance and stress,
        // preserve that deficit so the standing film actually declines.
        const densityAdjustedGross = resourceAdjustedNet > 0
          ? respirationRate + lightStressTurnover +
            resourceAdjustedNet * speciesFreeCapacity
          : resourceAdjustedGross;
        const productionRequest =
          amount * densityAdjustedGross * deltaSeconds;
        productionRequests[cellOffset + speciesIndex] = productionRequest;
        if (speciesId === 'vallisneria') {
          this.registerVallisneriaProductionDemand(
            cell,
            productionRequest,
            localTemperature,
          );
        } else {
          this.biogeochemistry.registerAlgaeProductionDemand(
            activityPoint,
            productionRequest,
          );
        }
      }
    }

    this.biogeochemistry.finalizeAmmoniumCompetition();

    for (let cellIndex = 0; cellIndex < cells.length; cellIndex += 1) {
      const cell = cells[cellIndex];
      const cellOffset = cellIndex * 3;
      const total =
        original[cellOffset + GROWTH_SPECIES_INDEX.oedogonium] +
        original[cellOffset + GROWTH_SPECIES_INDEX.nitzschia] +
        original[cellOffset + GROWTH_SPECIES_INDEX.vallisneria];
      const cellPoint = this.cellWorldPoint(cell);
      const weightedAverage = total > 0
        ? (
          original[cellOffset + GROWTH_SPECIES_INDEX.oedogonium] *
            rates[cellOffset + GROWTH_SPECIES_INDEX.oedogonium] +
          original[cellOffset + GROWTH_SPECIES_INDEX.nitzschia] *
            rates[cellOffset + GROWTH_SPECIES_INDEX.nitzschia] +
          original[cellOffset + GROWTH_SPECIES_INDEX.vallisneria] *
            rates[cellOffset + GROWTH_SPECIES_INDEX.vallisneria]
        ) / total
        : 0;
      const productions = this.growthProductionsScratch;
      const respirationRequests = this.growthRespirationRequestsScratch;
      const respirations = this.growthRespirationsScratch;
      productions.fill(0);
      respirationRequests.fill(0);
      respirations.fill(0);

      // The two attached algae use identical C/N stoichiometry at the same
      // surface point, so commit their combined allocation once and divide the
      // finite result proportionally.

      const oedogoniumSpeciesIndex = GROWTH_SPECIES_INDEX.oedogonium;
      const nitzschiaSpeciesIndex = GROWTH_SPECIES_INDEX.nitzschia;
      const vallisneriaSpeciesIndex = GROWTH_SPECIES_INDEX.vallisneria;
      const attachedProductionRequest =
        productionRequests[cellOffset + oedogoniumSpeciesIndex] +
        productionRequests[cellOffset + nitzschiaSpeciesIndex];
      if (attachedProductionRequest > 0) {
        const committed = this.biogeochemistry.commitAlgaeProduction(
          cellPoint,
          attachedProductionRequest,
        );
        productions[oedogoniumSpeciesIndex] = committed *
          productionRequests[cellOffset + oedogoniumSpeciesIndex] /
          attachedProductionRequest;
        productions[nitzschiaSpeciesIndex] = committed *
          productionRequests[cellOffset + nitzschiaSpeciesIndex] /
          attachedProductionRequest;
      }
      if (productionRequests[cellOffset + vallisneriaSpeciesIndex] > 0) {
        productions[vallisneriaSpeciesIndex] = this.commitVallisneriaProduction(
          cell,
          this.vallisneriaUptakePoint(cell),
          productionRequests[cellOffset + vallisneriaSpeciesIndex],
          this.biogeochemistry.temperatureAt(
            this.producerActivityPoint(cell, 'vallisneria'),
          ),
        );
      }

      for (const speciesId of this.scenario.allowedSpecies) {
        const speciesIndex = GROWTH_SPECIES_INDEX[speciesId];
        const amount = original[cellOffset + speciesIndex];
        if (amount <= 0) continue;
        const physiologyOffset = (cellOffset + speciesIndex) *
          ALGAE_PHYSIOLOGY_VALUE_COUNT;
        const respirationRate =
          physiology[physiologyOffset + ALGAE_PHYSIOLOGY_RESPIRATION];
        respirationRequests[speciesIndex] = Math.min(
          amount + productions[speciesIndex],
          amount * respirationRate * deltaSeconds,
        );
      }
      const attachedRespirationRequest =
        respirationRequests[oedogoniumSpeciesIndex] +
        respirationRequests[nitzschiaSpeciesIndex];
      if (attachedRespirationRequest > 0) {
        const committed = this.biogeochemistry.commitAlgaeRespiration(
          cellPoint,
          attachedRespirationRequest,
        );
        respirations[oedogoniumSpeciesIndex] = committed *
          respirationRequests[oedogoniumSpeciesIndex] /
          attachedRespirationRequest;
        respirations[nitzschiaSpeciesIndex] = committed *
          respirationRequests[nitzschiaSpeciesIndex] /
          attachedRespirationRequest;
      }
      if (respirationRequests[vallisneriaSpeciesIndex] > 0) {
        respirations[vallisneriaSpeciesIndex] =
          this.commitVallisneriaRespiration(
            cell,
            respirationRequests[vallisneriaSpeciesIndex],
          );
      }

      let fixedBiomass = 0;
      let respiredBiomass = 0;
      for (const speciesId of this.scenario.allowedSpecies) {
        const speciesIndex = GROWTH_SPECIES_INDEX[speciesId];
        const amount = original[cellOffset + speciesIndex];
        if (amount <= 0) continue;
        const physiologyOffset = (cellOffset + speciesIndex) *
          ALGAE_PHYSIOLOGY_VALUE_COUNT;
        const lightStressTurnover =
          physiology[physiologyOffset + ALGAE_PHYSIOLOGY_STRESS];
        const rate = rates[cellOffset + speciesIndex];
        const production = productions[speciesIndex];
        const respiration = respirations[speciesIndex];
        fixedBiomass += production;
        respiredBiomass += respiration;
        const stressTurnover = amount * lightStressTurnover * deltaSeconds;
        const replacement = total > 0.04
          ? amount * (rate - weightedAverage) * total * 1.35 * deltaSeconds
          : 0;
        const naturalTurnover = amount *
          SPECIES[speciesId].naturalTurnoverPerSecond *
          producerProcessRateScale(speciesId) *
          deltaSeconds;
        // Aerobic respiration can be limited by local oxygen. The unmet
        // maintenance demand still costs living tissue; otherwise anoxia
        // paradoxically preserves algae by preventing respiration from being
        // booked. This non-respired loss becomes detritus in localLoss below.
        const unmetMaintenanceTurnover = Math.max(
          0,
          respirationRequests[speciesIndex] - respiration,
        );
        next[cellOffset + speciesIndex] = Math.max(
          0,
          amount + production - respiration - unmetMaintenanceTurnover -
            stressTurnover + replacement - naturalTurnover,
        );
      }

      // A developed filamentous canopy shades the low-profile diatom film below it.
      const oedogoniumIndex = cellOffset + GROWTH_SPECIES_INDEX.oedogonium;
      const nitzschiaIndex = cellOffset + GROWTH_SPECIES_INDEX.nitzschia;
      const vallisneriaIndex = cellOffset + GROWTH_SPECIES_INDEX.vallisneria;
      if (
        original[oedogoniumIndex] > 0.24 &&
        rates[cellOffset + GROWTH_SPECIES_INDEX.oedogonium] >
          rates[cellOffset + GROWTH_SPECIES_INDEX.nitzschia]
      ) {
        next[nitzschiaIndex] = Math.max(
          0,
          next[nitzschiaIndex] -
            original[nitzschiaIndex] * original[oedogoniumIndex] * 0.018 * deltaSeconds,
        );
      }
      const localLoss = Math.max(
        0,
        total + fixedBiomass - respiredBiomass -
          next[oedogoniumIndex] - next[nitzschiaIndex] - next[vallisneriaIndex],
      );
      this.biogeochemistry.recordAlgaeTurnover(cellPoint, localLoss);
    }
    const recruitmentTransfers = this.growthRecruitmentTransfersScratch;
    let recruitmentTransferCount = 0;

    // Colonies export real biomass as propagules. Proposals are calculated from
    // the same pre-step state, then capacity-scaled and applied together, so the
    // result stays deterministic and independent of cell iteration order.
    for (let sourceIndex = 0; sourceIndex < cells.length; sourceIndex += 1) {
      const cell = cells[sourceIndex];
      const sourceOffset = sourceIndex * 3;
      for (const neighborId of cell.neighborIds) {
        const receiverIndex = cellIndexById.get(neighborId);
        if (receiverIndex === undefined) continue;
        const neighbor = cells[receiverIndex];
        const receiverOffset = receiverIndex * 3;
        const receiverTotal =
          next[receiverOffset + GROWTH_SPECIES_INDEX.oedogonium] +
          next[receiverOffset + GROWTH_SPECIES_INDEX.nitzschia] +
          next[receiverOffset + GROWTH_SPECIES_INDEX.vallisneria];
        const freeCapacity = clamp01(1 - receiverTotal);
        if (freeCapacity <= 0.0001) continue;
        for (const speciesId of this.scenario.allowedSpecies) {
          const speciesIndex = GROWTH_SPECIES_INDEX[speciesId];
          if (SPECIES[speciesId].dispersalRate <= 0) continue;
          const sourceAmount = original[sourceOffset + speciesIndex];
          const receiverAmount = original[receiverOffset + speciesIndex];
          if (
            sourceAmount < SURFACE_FILM_DISPERSAL_SOURCE_BIOMASS ||
            receiverAmount >= sourceAmount
          ) continue;
          // Dispersal is a conserved physical transfer. Dissolved turbidity
          // acts on the receiving film's photosynthesis in the next growth
          // step; applying it here as well would charge the same optical
          // stress once to arrival and again to survival. Surface exposure
          // and temperature still gate whether a propagule can establish.
          const suitability = habitatSuitability(
            speciesId,
            neighbor.light,
            this.biogeochemistry.temperatureAt(this.cellWorldPoint(neighbor)),
          );
          if (suitability <= 0.01) continue;
          // Accelerate only the thin colonization front. Once the receiving
          // sample is ecologically occupied, return to the ledger-scaled
          // mixing rate so a mature patch is not rapidly homogenized or
          // stripped merely to make its picture spread faster.
          const dispersalTimeScale =
            receiverAmount < SURFACE_FILM_FRONT_ESTABLISHMENT_BIOMASS
              ? SURFACE_FILM_DISPERSAL_TIME_SCALE
              : 1;
          const dispersalRate = dispersalTimeScale > 1
            ? Math.min(
                SURFACE_FILM_FRONT_DISPERSAL_RATE_CAP,
                SPECIES[speciesId].dispersalRate * dispersalTimeScale,
              )
            : SPECIES[speciesId].dispersalRate;
          const rawRecruitment =
            dispersalRate *
            sourceAmount *
            deltaSeconds *
            suitability *
            freeCapacity /
            Math.max(2, cell.neighborIds.length);
          const recruitment = dispersalTimeScale > 1
            ? Math.min(
              rawRecruitment,
              SURFACE_FILM_FRONT_TRANSFER_PER_EDGE_PER_SECOND *
                deltaSeconds,
            )
            : rawRecruitment;
          if (recruitment <= 0) continue;
          const transfer = recruitmentTransfers[recruitmentTransferCount] ?? {
            sourceIndex,
            receiverIndex,
            speciesId,
            amount: recruitment,
          };
          transfer.sourceIndex = sourceIndex;
          transfer.receiverIndex = receiverIndex;
          transfer.speciesId = speciesId;
          transfer.amount = recruitment;
          recruitmentTransfers[recruitmentTransferCount] = transfer;
          recruitmentTransferCount += 1;
        }
      }
    }

    // Several colonies can target the same free space. Scale all incoming
    // propagules proportionally rather than letting whichever cell is visited
    // first claim the receiver. This also prevents final capacity clamping from
    // silently destroying transferred mass.
    if (this.growthIncomingDemandScratch.length !== cells.length) {
      this.growthIncomingDemandScratch = new Float64Array(cells.length);
    }
    const incomingDemand = this.growthIncomingDemandScratch;
    incomingDemand.fill(0);
    for (let index = 0; index < recruitmentTransferCount; index += 1) {
      const transfer = recruitmentTransfers[index];
      incomingDemand[transfer.receiverIndex] += transfer.amount;
    }
    for (let index = 0; index < recruitmentTransferCount; index += 1) {
      const transfer = recruitmentTransfers[index];
      const receiverOffset = transfer.receiverIndex * 3;
      const freeCapacity = clamp01(
        1 -
          next[receiverOffset + GROWTH_SPECIES_INDEX.oedogonium] -
          next[receiverOffset + GROWTH_SPECIES_INDEX.nitzschia] -
          next[receiverOffset + GROWTH_SPECIES_INDEX.vallisneria],
      );
      const demand = incomingDemand[transfer.receiverIndex];
      if (demand > freeCapacity && demand > 0) {
        transfer.amount *= freeCapacity / demand;
      }
    }

    // A source cannot export more than remains after its own growth/turnover.
    // The same scale is applied to every destination for that species.
    const outgoingDemandLength = cells.length * 3;
    if (this.growthOutgoingDemandScratch.length !== outgoingDemandLength) {
      this.growthOutgoingDemandScratch = new Float64Array(outgoingDemandLength);
    }
    const outgoingDemand = this.growthOutgoingDemandScratch;
    outgoingDemand.fill(0);
    for (let index = 0; index < recruitmentTransferCount; index += 1) {
      const transfer = recruitmentTransfers[index];
      const demandIndex =
        transfer.sourceIndex * 3 + GROWTH_SPECIES_INDEX[transfer.speciesId];
      outgoingDemand[demandIndex] += transfer.amount;
    }
    for (let index = 0; index < recruitmentTransferCount; index += 1) {
      const transfer = recruitmentTransfers[index];
      const demandIndex =
        transfer.sourceIndex * 3 + GROWTH_SPECIES_INDEX[transfer.speciesId];
      const demand = outgoingDemand[demandIndex];
      const available = Math.max(0, next[demandIndex]);
      if (demand > available && demand > 0) {
        transfer.amount *= available / demand;
      }
    }

    for (let index = 0; index < recruitmentTransferCount; index += 1) {
      const transfer = recruitmentTransfers[index];
      const speciesIndex = GROWTH_SPECIES_INDEX[transfer.speciesId];
      next[transfer.sourceIndex * 3 + speciesIndex] -= transfer.amount;
      next[transfer.receiverIndex * 3 + speciesIndex] += transfer.amount;
    }

    for (let index = 0; index < cells.length; index += 1) {
      const cell = cells[index];
      const offset = index * 3;
      const oedogoniumIndex = offset + GROWTH_SPECIES_INDEX.oedogonium;
      const nitzschiaIndex = offset + GROWTH_SPECIES_INDEX.nitzschia;
      const vallisneriaIndex = offset + GROWTH_SPECIES_INDEX.vallisneria;
      const total =
        next[oedogoniumIndex] + next[nitzschiaIndex] + next[vallisneriaIndex];
      if (total > 1) {
        // This path is normally only a floating-point/legacy-save safety net.
        // If it does activate, the removed living biomass must remain in the
        // closed material ledger instead of disappearing during normalisation.
        this.biogeochemistry.recordAlgaeTurnover(
          this.cellWorldPoint(cell),
          total - 1,
        );
        next[oedogoniumIndex] /= total;
        next[nitzschiaIndex] /= total;
        next[vallisneriaIndex] /= total;
      }
      cell.biomass.oedogonium = clamp01(next[oedogoniumIndex]);
      cell.biomass.nitzschia = clamp01(next[nitzschiaIndex]);
      cell.biomass.vallisneria = clamp01(next[vallisneriaIndex]);
    }
  }

  private stepTemperature(deltaSeconds: number): void {
    this.biogeochemistry.advanceTemperature(
      deltaSeconds,
      22,
    );
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

  private missionProgress(
    coverageRatio: number,
    cells?: readonly MissionCellView[],
  ): MissionProgressSnapshot | null {
    const target = this.scenario.target;
    if (!target) return null;
    if (target.type === 'born-stage') {
      let current = 0;
      for (const animal of this.animals) {
        if (
          animal.speciesId === target.speciesId &&
          animal.origin === 'born' &&
          animal.lifeStage === target.lifeStage
        ) current += 1;
      }
      return {
        current,
        target: target.count,
        unit: 'born-count',
        label: target.label,
        ratio: current / target.count,
        holdCurrent: this.successHoldAccumulator,
        holdTarget: target.holdSeconds,
      };
    }
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
    if (target.type === 'animal-generation') {
      const population = this.animals.filter(
        (animal) => animal.speciesId === target.speciesId,
      );
      const current = population.filter(
        (animal) => (animal.generation ?? 0) >= target.minimumGeneration,
      ).length;
      return {
        current,
        target: target.generationCount,
        unit: 'generation-count',
        label: target.label,
        ratio: Math.min(
          current / target.generationCount,
          population.length / target.minimumPopulation,
        ),
        holdCurrent: this.successHoldAccumulator,
        holdTarget: target.holdSeconds,
        ...(target.minimumPopulation > target.generationCount
          ? {
            supportingCurrent: population.length,
            supportingTarget: target.minimumPopulation,
            supportingLabel: '전체 체리새우 군집',
          }
          : {}),
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
      const sourceCells: readonly MissionCellView[] = cells ?? this.allCells();
      let eligibleCount = 0;
      let suitableCount = 0;
      for (const cell of sourceCells) {
        const eligible = cell.targetEligible ??
          (cell.surfaceKind === 'structure-face' ||
            this.scenario.targetIncludesSubstrate);
        if (!eligible) continue;
        eligibleCount += 1;
        if (
          cell.light >= target.minLight &&
          cell.light <= target.maxLight &&
          cell.biomass[target.speciesId] >= target.minBiomass
        ) suitableCount += 1;
      }
      const current = eligibleCount ? suitableCount / eligibleCount : 0;
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
    if (target.type === 'coverage') {
      const sourceCells: readonly MissionCellView[] = cells ?? this.allCells();
      let eligibleCount = 0;
      let occupiedCount = 0;
      for (const cell of sourceCells) {
        const eligible = cell.targetEligible ??
          (cell.surfaceKind === 'structure-face' ||
            this.scenario.targetIncludesSubstrate);
        if (!eligible) continue;
        eligibleCount += 1;
        if (cell.biomass[target.speciesId] >= target.minBiomass) {
          occupiedCount += 1;
        }
      }
      const current = eligibleCount ? occupiedCount / eligibleCount : 0;
      return {
        current,
        target: target.ratio,
        unit: 'coverage',
        label: target.label,
        ratio: current / target.ratio,
        holdCurrent: this.successHoldAccumulator,
        holdTarget: target.holdSeconds,
      };
    }
    if (target.type === 'biomass') {
      let current = 0;
      for (const cell of cells ?? this.allCells()) {
        current += cell.biomass[target.speciesId];
      }
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
    if (target.type === 'plankton-generation') {
      const plankton = this.biogeochemistry.planktonState();
      // Supplied founders cannot satisfy the hold condition on behalf of a
      // failed lineage. Only animals descended from the inoculated adults
      // contribute to the living reserve that must cross the next day/night.
      let bornLineageBiomass = 0;
      for (const animal of this.animals) {
        if (animal.speciesId !== 'daphnia' || (animal.generation ?? 0) < 1) continue;
        bornLineageBiomass += animal.structuralBiomass +
          animal.storedBiomass +
          animal.reproductiveBiomass;
      }
      const current =
        bornLineageBiomass >= target.minimumBornLineageBiomass
        ? plankton.cumulativeEvents.secondGenerationBirths
        : 0;
      return {
        current,
        target: target.secondGenerationBirthBiomass,
        unit: 'biomass',
        label: target.label,
        ratio: current / target.secondGenerationBirthBiomass,
        holdCurrent: this.successHoldAccumulator,
        holdTarget: target.holdSeconds,
      };
    }
    return null;
  }

  private currentTargetMet(): boolean {
    const target = this.scenario.target;
    if (target?.type === 'animal-generation') {
      let population = 0;
      let generationCount = 0;
      for (const animal of this.animals) {
        if (animal.speciesId !== target.speciesId) continue;
        population += 1;
        if ((animal.generation ?? 0) >= target.minimumGeneration) {
          generationCount += 1;
        }
      }
      return generationCount >= target.generationCount &&
        population >= target.minimumPopulation;
    }
    const cells = this.allCells();
    let eligibleCount = 0;
    let occupiedCount = 0;
    for (const cell of cells) {
      const eligible = cell.surfaceKind === 'structure-face' ||
        this.scenario.targetIncludesSubstrate;
      if (!eligible) continue;
      eligibleCount += 1;
      if (occupied(cell.biomass)) occupiedCount += 1;
    }
    const coverageRatio = eligibleCount ? occupiedCount / eligibleCount : 0;
    const progress = this.missionProgress(coverageRatio, cells);
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

  private animalMotionSnapshots(reuse?: AnimalSnapshot[]): AnimalSnapshot[] {
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
      snapshot.biomass = animal.structuralBiomass + animal.storedBiomass +
        animal.reproductiveBiomass;
      snapshot.structuralBiomass = animal.structuralBiomass;
      snapshot.storedBiomass = animal.storedBiomass;
      snapshot.reproductiveBiomass = animal.reproductiveBiomass;
      snapshot.health = animal.health;
      snapshot.behavior = this.held?.kind === 'animal' && this.held.animalId === animal.id
        ? 'held'
        : animal.behavior;
      snapshot.reproductiveState = animal.speciesId === 'japanese-ricefish'
        ? animal.lifeStage === 'egg'
          ? 'incubating'
          : animal.gestationRemaining !== null
            ? 'carrying-eggs'
            : animal.lifeStage === 'adult' &&
              animal.reproductionCooldown <= 0 &&
              animal.reproductiveBiomass >=
                RICEFISH_ECOLOGY_RULES.eggClutchMinimum *
                WATER_CYCLE_RULES.ricefish.eggBiomass
              ? 'ready'
              : 'none'
        : animal.speciesId === 'daphnia'
          ? animal.gestationRemaining !== null
            ? 'carrying-eggs'
            : animal.lifeStage === 'adult' &&
              (animal.moltProgress ?? 0) >= 0.75 &&
              animal.energy >=
                PLANKTON_ECOLOGY_RULES.daphnia.reproductionStartEnergy &&
              animal.reproductiveBiomass >=
                PLANKTON_ECOLOGY_RULES.daphnia.minimumBroodSize *
                PLANKTON_ECOLOGY_RULES.daphnia.juvenileBirthBiomass
              ? 'ready'
              : 'none'
          : animal.gestationRemaining !== null
            ? 'berried'
            : animal.lifeStage === 'adult' &&
              (animal.ovarianProgress ?? 0) >= 1 &&
              this.shrimpReserveCondition(animal) >=
                SHRIMP_ECOLOGY_RULES.reproductionReserveFraction &&
              animal.reproductiveBiomass >= this.shrimpBroodBiomass(animal) &&
              this.animals.length < SHRIMP_TECHNICAL_POPULATION_LIMIT
              ? 'ready'
              : 'none';
      snapshot.recentIntake = animal.recentIntake;
      snapshot.consumedBiomass = animal.consumedBiomass;
      snapshot.secondsSinceFood = animal.secondsSinceFood;
      snapshot.growthProgress = animal.growthProgress;
      snapshots[index] = snapshot;
    }
    snapshots.length = this.animals.length;
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
      snapshot.biomass = animal.structuralBiomass + animal.storedBiomass +
        animal.reproductiveBiomass;
      snapshot.structuralBiomass = animal.structuralBiomass;
      snapshot.storedBiomass = animal.storedBiomass;
      snapshot.reproductiveBiomass = animal.reproductiveBiomass;
      snapshot.health = animal.health;
      snapshot.behavior = this.held?.kind === 'animal' && this.held.animalId === animal.id
        ? 'held'
        : animal.behavior;
      snapshot.reproductiveState = animal.speciesId === 'japanese-ricefish'
        ? animal.lifeStage === 'egg'
          ? 'incubating'
          : animal.gestationRemaining !== null
            ? 'carrying-eggs'
            : animal.lifeStage === 'adult' &&
              animal.reproductionCooldown <= 0 &&
              animal.reproductiveBiomass >=
                RICEFISH_ECOLOGY_RULES.eggClutchMinimum *
                WATER_CYCLE_RULES.ricefish.eggBiomass
              ? 'ready'
              : 'none'
        : animal.speciesId === 'daphnia'
          ? animal.gestationRemaining !== null
            ? 'carrying-eggs'
            : animal.lifeStage === 'adult' &&
              (animal.moltProgress ?? 0) >= 0.75 &&
              animal.energy >=
                PLANKTON_ECOLOGY_RULES.daphnia.reproductionStartEnergy &&
              animal.reproductiveBiomass >=
                PLANKTON_ECOLOGY_RULES.daphnia.minimumBroodSize *
                PLANKTON_ECOLOGY_RULES.daphnia.juvenileBirthBiomass
              ? 'ready'
              : 'none'
        : animal.gestationRemaining !== null
          ? 'berried'
          : animal.lifeStage === 'adult' &&
            (animal.ovarianProgress ?? 0) >= 1 &&
            this.shrimpReserveCondition(animal) >=
              SHRIMP_ECOLOGY_RULES.reproductionReserveFraction &&
            animal.reproductiveBiomass >= this.shrimpBroodBiomass(animal) &&
            this.animals.length < SHRIMP_TECHNICAL_POPULATION_LIMIT
            ? 'ready'
            : 'none';
      snapshot.recentIntake = animal.recentIntake;
      snapshot.consumedBiomass = animal.consumedBiomass;
      snapshot.secondsSinceFood = animal.secondsSinceFood;
      snapshot.growthProgress = animal.growthProgress;
      snapshot.recentFood = animal.recentFood;
      snapshot.generation = animal.generation ?? 0;
      snapshot.parentId = animal.parentId ?? null;
      snapshot.attachmentLabel = animal.attachmentCellId
        ? this.cellById(animal.attachmentCellId)?.ownerLabel ?? null
        : null;
      snapshot.developmentProgress = animal.lifeStage === 'egg'
        ? clamp01(
          1 - (animal.incubationRemaining ?? RICEFISH_ECOLOGY_RULES.eggIncubationSecondsAt25C) /
            RICEFISH_ECOLOGY_RULES.eggIncubationSecondsAt25C,
        )
        : null;
      snapshot.oxygen = this.biogeochemistry.effectsEnabled
        ? this.biogeochemistry.oxygenAt(animal.position)
        : null;
      snapshot.toxicWaste = this.biogeochemistry.effectsEnabled
        ? this.biogeochemistry.toxicWasteAt(animal.position)
        : null;
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

  private carcassSnapshots(reuse?: AnimalCarcassSnapshot[]): AnimalCarcassSnapshot[] {
    if (this.selection?.kind === 'carcass' && this.selection.carcassId) {
      const selected = this.carcasses.find(
        (carcass) => carcass.id === this.selection?.carcassId,
      );
      if (selected) {
        const visualPoint = animalCarcassVisualPoint({
          speciesId: selected.speciesId,
          x: selected.position.x,
          y: selected.position.y,
          ageSeconds: selected.ageSeconds,
        });
        this.selection.x = visualPoint.x;
        this.selection.y = visualPoint.y;
      }
    }
    const snapshots = reuse ?? [];
    for (let index = 0; index < this.carcasses.length; index += 1) {
      const carcass = this.carcasses[index];
      const lifetimeSeconds = animalCarcassLifetimeSeconds(carcass.speciesId);
      const snapshot = snapshots[index] ?? {} as AnimalCarcassSnapshot;
      snapshot.id = carcass.id;
      snapshot.sourceAnimalId = carcass.sourceAnimalId;
      snapshot.speciesId = carcass.speciesId;
      snapshot.x = carcass.position.x;
      snapshot.y = carcass.position.y;
      snapshot.facing = carcass.facing;
      snapshot.poseAngle = carcass.poseAngle;
      snapshot.bodyLength = carcass.bodyLength;
      snapshot.lifeStage = carcass.lifeStage;
      snapshot.cause = carcass.cause;
      snapshot.waterAtDeath = carcass.waterAtDeath
        ? Object.assign(snapshot.waterAtDeath ?? {}, carcass.waterAtDeath)
        : null;
      snapshot.temperatureAtDeath = carcass.temperatureAtDeath;
      snapshot.ageSeconds = carcass.ageSeconds;
      snapshot.lifetimeSeconds = lifetimeSeconds;
      snapshot.progress = clamp01(carcass.ageSeconds / lifetimeSeconds);
      snapshots[index] = snapshot;
    }
    snapshots.length = this.carcasses.length;
    return snapshots;
  }

  private animalPopulation(
    speciesId: AnimalSpeciesId,
    reuse?: AnimalPopulationSnapshot,
  ): AnimalPopulationSnapshot {
    const snapshot = reuse ?? {} as AnimalPopulationSnapshot;
    let total = 0;
    let eggs = 0;
    let fry = 0;
    let adultFemales = 0;
    let adultMales = 0;
    let juvenileFemales = 0;
    let juvenileMales = 0;
    for (const animal of this.animals) {
      if (animal.speciesId !== speciesId) continue;
      total += 1;
      if (animal.lifeStage === 'egg') {
        eggs += 1;
      } else if (animal.lifeStage === 'adult') {
        if (animal.sex === 'female') adultFemales += 1;
        else adultMales += 1;
      } else {
        if (animal.lifeStage === 'fry') fry += 1;
        if (animal.sex === 'female') juvenileFemales += 1;
        else juvenileMales += 1;
      }
    }
    const adults = adultFemales + adultMales;
    snapshot.total = total;
    snapshot.eggs = eggs;
    snapshot.fry = fry;
    snapshot.adults = adults;
    snapshot.juveniles = total - adults - eggs;
    snapshot.adultFemales = adultFemales;
    snapshot.adultMales = adultMales;
    snapshot.juvenileFemales = juvenileFemales;
    snapshot.juvenileMales = juvenileMales;
    return snapshot;
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
      generation: animal.generation ?? 0,
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
    if (kind === 'hatched') this.animalPopulationEventTotals.hatches += 1;
    if (kind === 'matured') this.animalPopulationEventTotals.maturations += 1;
    if (kind === 'death' && cause) {
      this.animalPopulationEventTotals.deaths += 1;
      this.animalPopulationEventTotals.deathsByCause[cause] += 1;
    }
    this.snapshotDirty = true;
  }

  private surfaceSnapshots(reuse?: SurfaceCellSnapshot[]): SurfaceCellSnapshot[] {
    const cells = this.allCells();
    const snapshots = reuse ?? [];
    for (let index = 0; index < cells.length; index += 1) {
      const cell = cells[index];
      const point = this.cellWorldPoint(cell);
      const snapshot = snapshots[index] ?? {} as SurfaceCellSnapshot;
      snapshot.id = cell.id;
      snapshot.ownerId = cell.ownerId;
      snapshot.ownerLabel = cell.ownerLabel;
      snapshot.surfaceKind = cell.surfaceKind;
      snapshot.index = cell.index;
      snapshot.x = point.x;
      snapshot.y = point.y;
      snapshot.cellSize = cell.cellSize;
      snapshot.light = cell.light;
      snapshot.plantCanopyLight = cell.biomass.vallisneria > ALGAE_VISIBLE_BIOMASS
        ? this.vallisneriaCanopyLight(cell)
        : null;
      snapshot.biomass ??= emptyBiomass();
      snapshot.biomass.oedogonium = cell.biomass.oedogonium;
      snapshot.biomass.nitzschia = cell.biomass.nitzschia;
      snapshot.biomass.vallisneria = cell.biomass.vallisneria ?? 0;
      snapshot.biofilm ??= emptyBiofilm();
      snapshot.biofilm.decomposer = cell.biofilm.decomposer;
      snapshot.biofilm.nitrifier = cell.biofilm.nitrifier;
      snapshot.targetEligible =
        cell.surfaceKind === 'structure-face' || this.scenario.targetIncludesSubstrate;
      snapshots[index] = snapshot;
    }
    snapshots.length = cells.length;
    return snapshots;
  }

  private seedSnapshots(reuse?: SeedSnapshot[]): SeedSnapshot[] {
    const snapshots = reuse ?? [];
    if (this.hasStarted) {
      snapshots.length = 0;
      return snapshots;
    }
    let snapshotIndex = 0;
    for (const placement of this.seedPlacements) {
      const cell = this.cellById(placement.cellId);
      if (!cell) continue;
      const point = placement.speciesId === 'vallisneria' && placement.plant
        ? this.vallisneriaRootPosition(placement, cell)
        : this.cellWorldPoint(cell);
      const snapshot = snapshots[snapshotIndex] ?? {} as SeedSnapshot;
      snapshot.id = placement.id;
      snapshot.speciesId = placement.speciesId;
      snapshot.cellId = placement.cellId;
      snapshot.locked = placement.locked;
      snapshot.x = point.x;
      snapshot.y = point.y;
      snapshots[snapshotIndex] = snapshot;
      snapshotIndex += 1;
    }
    snapshots.length = snapshotIndex;
    return snapshots;
  }

  private plantSnapshots(reuse?: PlantRametSnapshot[]): PlantRametSnapshot[] {
    const snapshots = reuse ?? [];
    let snapshotIndex = 0;
    for (const placement of this.seedPlacements) {
      if (placement.speciesId !== 'vallisneria' || !placement.plant) continue;
      const cell = this.cellById(placement.cellId);
      if (!cell || cell.biomass.vallisneria <= VALLISNERIA_VISIBLE_BIOMASS) continue;
      const point = this.vallisneriaRootPosition(placement, cell);
      const snapshot = snapshots[snapshotIndex] ?? {} as PlantRametSnapshot;
      snapshot.id = placement.id;
      snapshot.speciesId = 'vallisneria';
      snapshot.cellId = placement.cellId;
      snapshot.x = point.x;
      snapshot.y = point.y;
      snapshot.origin = placement.origin;
      snapshot.parentId = placement.plant.parentId;
      snapshot.connectedToParent = placement.plant.connectedToParent;
      snapshot.ageSeconds = placement.plant.ageSeconds;
      snapshot.lifespanSeconds = placement.plant.lifespanSeconds;
      snapshot.lifeStage = this.vallisneriaLifeStage(placement.plant);
      snapshot.structuralScale = placement.plant.structuralScale;
      snapshot.health = this.vallisneriaHealth(placement, cell);
      snapshot.runnerProgress = clamp01(placement.plant.runnerProgress);
      snapshot.reproductionCount = placement.plant.reproductionCount;
      snapshots[snapshotIndex] = snapshot;
      snapshotIndex += 1;
    }
    snapshots.length = snapshotIndex;
    return snapshots;
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
        animalSex: this.held.sex ?? this.held.originState?.sex,
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
    if (this.held.kind === 'plankton') {
      return {
        kind: 'plankton',
        source: 'inventory',
        valid: this.held.valid,
        x: this.held.position.x,
        y: this.held.position.y,
        planktonKind: this.held.planktonKind,
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
    forcedSex?: AnimalSex,
  ): AnimalState {
    if (speciesId === 'japanese-ricefish') {
      return this.createAdultRicefishState(id, point, origin);
    }
    if (speciesId === 'daphnia') {
      return this.createAdultDaphniaState(
        id,
        point,
        origin,
        0,
        null,
        this.animalInventoryUsed.daphnia,
      );
    }
    // Inventory usage is the species-specific introduction sequence. Unlike
    // counting currently living founders, it does not restart after a supplied
    // animal dies in an unlimited laboratory scenario.
    const suppliedIndex = this.animalInventoryUsed['cherry-shrimp'];
    const characteristicSeed = deterministicStringSeed(
      origin === 'supplied'
        ? `shrimp-supplied-${suppliedIndex}`
        : `${id}:shrimp`,
    );
    const motionNoise = deterministicNoise(characteristicSeed * 0.031 + 31.1);
    const individualSeed = characteristicSeed * 0.001;
    const isFemale = forcedSex
      ? forcedSex === 'female'
      : suppliedIndex % 2 === 0;
    const ovarianProgress = isFemale
      ? seededRange(
        characteristicSeed * 0.059 + 43.1,
        SHRIMP_ECOLOGY_RULES.suppliedOvarianProgressMinimum,
        SHRIMP_ECOLOGY_RULES.suppliedOvarianProgressMaximum,
      )
      : 0;
    const ageSeconds = SHRIMP_SUPPLIED_ADULT_MIN_AGE_SECONDS +
      deterministicNoise(characteristicSeed * 0.013 + 7.1) *
      (SHRIMP_SUPPLIED_ADULT_MAX_AGE_SECONDS - SHRIMP_SUPPLIED_ADULT_MIN_AGE_SECONDS);
    const ovarianClutchSize = isFemale
      ? shrimpClutchSizeForStructure(
        WATER_CYCLE_RULES.shrimp.adultStructuralBiomass,
      )
      : undefined;
    return {
      id,
      speciesId,
      origin,
      position: this.clampAnimalPoint(point),
      velocity: { x: 0, y: 0 },
      facing: motionNoise < 0.5 ? -1 : 1,
      poseAngle: 0,
      bodyLength: SHRIMP_ADULT_LENGTH *
        (0.94 + deterministicNoise(characteristicSeed * 0.037) * 0.12),
      lifeStage: 'adult',
      sex: isFemale ? 'female' : 'male',
      ageSeconds,
      lifespanSeconds: shrimpLifespanSeconds(individualSeed),
      // Derive the very first displayed/behavioural condition from the same
      // conserved structure and reserve used on every later ecology step.
      // The former arbitrary 0.52-0.55 was immediately corrected to ~0.46,
      // creating a hidden one-step condition drop after stocking.
      energy: SHRIMP_SUPPLIED_INITIAL_ENERGY,
      structuralBiomass: WATER_CYCLE_RULES.shrimp.adultStructuralBiomass,
      storedBiomass: WATER_CYCLE_RULES.shrimp.suppliedReserveBiomass,
      reproductiveBiomass:
        isFemale && origin === 'supplied' && ovarianClutchSize !== undefined
          ? ovarianClutchSize *
            WATER_CYCLE_RULES.shrimp.juvenileBirthBiomass *
            ovarianProgress
          : 0,
      health: 1,
      behavior: 'resting',
      behaviorTimer: 1 + deterministicNoise(characteristicSeed * 0.043) * 2,
      targetCellId: null,
      targetAnimalId: null,
      attachmentCellId: null,
      incubationRemaining: null,
      recentFood: null,
      nextTargetEvaluation: 0,
      recentIntake: 0,
      consumedBiomass: 0,
      grazingSessionIntake: 0,
      recentGrazingCellId: null,
      recentGrazingCellCooldown: 0,
      secondsSinceFood: 0,
      growthProgress: 1,
      reproductionCooldown: isFemale
        ? (1 - ovarianProgress) *
          shrimpOvarianCycleSeconds(individualSeed, 0)
        : deterministicNoise(characteristicSeed * 0.047) *
          SHRIMP_MALE_POST_MATING_COOLDOWN,
      gestationRemaining: null,
      maturationTargetSeconds:
        shrimpMaturationTargetSeconds(individualSeed),
      ovarianProgress,
      ovarianClutchSize,
      reproductiveCycleIndex: 0,
      matingAccumulator: 0,
      randomSeed: individualSeed,
    };
  }

  private createAdultDaphniaState(
    id: string,
    point: Vec2,
    origin: 'supplied' | 'born',
    generation: number,
    parentId: string | null,
    suppliedSequence: number,
  ): AnimalState {
    const rules = PLANKTON_ECOLOGY_RULES.daphnia;
    // Founder traits belong to the Daphnia inoculation sequence, not the
    // global animal ID. Otherwise an unrelated shrimp birth just before an
    // inoculation changes the founder's lifespan and molt schedule. Daphnia
    // are stocked through the plankton inventory, so using animalInventoryUsed
    // here made every separate inoculum sequence zero and cloned its age,
    // lifespan, reproduction and movement traits.
    const seed = deterministicStringSeed(
      origin === 'supplied'
        ? `daphnia-supplied-${suppliedSequence}`
        : `${id}:daphnia`,
    );
    const lifespanNoise = deterministicNoise(seed * 0.019 + 13.7);
    const instarTarget = daphniaMaturationInstarTarget(seed * 0.001);
    const moltCount = instarTarget +
      Math.floor(deterministicNoise(seed * 0.041 + 19.7) * 3);
    const moltCycleSeconds = daphniaAdultMoltCycleSeconds(
      seed * 0.001,
      moltCount,
    );
    const moltProgress = seededRange(seed * 0.047 + 23.3, 0.08, 0.86);
    return {
      id,
      speciesId: 'daphnia',
      origin,
      position: this.clampDaphniaPoint(point),
      velocity: { x: 0, y: 0 },
      facing: deterministicNoise(seed * 0.031) < 0.5 ? -1 : 1,
      poseAngle: 0,
      bodyLength: 8.2 + deterministicNoise(seed * 0.037) * 1.6,
      lifeStage: 'adult',
      sex: 'female',
      ageSeconds: origin === 'supplied'
        ? rules.suppliedAdultAgeMinimumSeconds +
          deterministicNoise(seed * 0.013) * (
            rules.suppliedAdultAgeMaximumSeconds -
            rules.suppliedAdultAgeMinimumSeconds
          )
        : rules.maturationSeconds,
      lifespanSeconds: rules.minimumLifespanSeconds + lifespanNoise *
        (rules.maximumLifespanSeconds - rules.minimumLifespanSeconds),
      energy: rules.suppliedAdultReserveBiomass / rules.adultReserveCapacity,
      structuralBiomass: rules.adultStructuralBiomass,
      storedBiomass: rules.suppliedAdultReserveBiomass,
      reproductiveBiomass: 0,
      health: 1,
      behavior: 'exploring',
      behaviorTimer: 0,
      targetCellId: null,
      targetAnimalId: null,
      attachmentCellId: null,
      incubationRemaining: null,
      recentFood: null,
      nextTargetEvaluation: 0,
      recentIntake: 0,
      consumedBiomass: 0,
      grazingSessionIntake: 0,
      secondsSinceFood: 0,
      growthProgress: 1,
      reproductionCooldown: (1 - moltProgress) * moltCycleSeconds,
      gestationRemaining: null,
      maturationTargetInstars: instarTarget,
      moltProgress,
      moltCycleSeconds,
      moltCount,
      matingAccumulator: 0,
      randomSeed: seed * 0.001,
      generation,
      parentId,
    };
  }

  private createJuvenileDaphniaState(
    parent: AnimalState,
    broodIndex: number,
  ): AnimalState {
    const rules = PLANKTON_ECOLOGY_RULES.daphnia;
    const id = `animal-${++this.animalCounter}`;
    // Demographic variation follows the maternal lineage and brood number.
    // The display/event ID remains globally unique, but shrimp births can no
    // longer perturb Daphnia lifespan and instar draws by consuming IDs first.
    const seed = deterministicStringSeed(
      `daphnia-lineage-${parent.randomSeed.toPrecision(12)}-` +
      `${parent.moltCount ?? 0}-${broodIndex}`,
    );
    const angle = deterministicNoise(parent.randomSeed + broodIndex * 7.31) *
      Math.PI * 2;
    const distance = 4 + deterministicNoise(parent.randomSeed + broodIndex * 3.17) * 7;
    const initialStructure = rules.juvenileMinimumStructure;
    const instarTarget = daphniaMaturationInstarTarget(seed * 0.001);
    const moltCycleSeconds = daphniaJuvenileMoltCycleSeconds(
      seed * 0.001,
      instarTarget,
    );
    return {
      id,
      speciesId: 'daphnia',
      origin: 'born',
      position: this.clampDaphniaPoint({
        x: parent.position.x + Math.cos(angle) * distance,
        y: parent.position.y + Math.sin(angle) * distance,
      }),
      velocity: {
        x: Math.cos(angle) * 3,
        y: Math.sin(angle) * 3,
      },
      facing: Math.cos(angle) < 0 ? -1 : 1,
      poseAngle: 0,
      bodyLength: 4.6,
      lifeStage: 'juvenile',
      sex: 'female',
      ageSeconds: 0,
      lifespanSeconds: rules.minimumLifespanSeconds +
        deterministicNoise(seed * 0.019 + 13.7) *
        (rules.maximumLifespanSeconds - rules.minimumLifespanSeconds),
      energy: (
        rules.juvenileBirthBiomass - initialStructure
      ) / rules.juvenileReserveCapacity,
      structuralBiomass: initialStructure,
      storedBiomass: rules.juvenileBirthBiomass - initialStructure,
      reproductiveBiomass: 0,
      health: 1,
      behavior: 'exploring',
      behaviorTimer: 0,
      targetCellId: null,
      targetAnimalId: null,
      attachmentCellId: null,
      incubationRemaining: null,
      recentFood: null,
      nextTargetEvaluation: 0,
      recentIntake: 0,
      consumedBiomass: 0,
      grazingSessionIntake: 0,
      secondsSinceFood: 0,
      growthProgress: initialStructure / rules.adultStructuralBiomass,
      reproductionCooldown: 0,
      gestationRemaining: null,
      maturationTargetInstars: instarTarget,
      moltProgress: 0,
      moltCycleSeconds,
      moltCount: 0,
      matingAccumulator: 0,
      randomSeed: seed * 0.001,
      generation: (parent.generation ?? 0) + 1,
      parentId: parent.id,
    };
  }

  private syncDaphniaIndividuals(): void {
    this.biogeochemistry.setDaphniaIndividuals(
      this.animals.filter((animal) => animal.speciesId === 'daphnia'),
    );
  }

  private createJuvenileAnimalState(parent: AnimalState, clutchIndex: number): AnimalState {
    const id = `animal-${++this.animalCounter}`;
    // As with Daphnia, lineage traits must not depend on how many animals of
    // another species happened to consume global display IDs first.
    const lineageKey =
      `shrimp-lineage-${this.runSeed}-${parent.randomSeed.toPrecision(12)}-` +
      `${parent.reproductiveCycleIndex ?? 0}-${clutchIndex}`;
    const characteristicSeed = deterministicStringSeed(lineageKey);
    // This object is one individual shrimp. Its sex is an independent
    // deterministic 50:50 draw. Do not force every tiny brood to contain both
    // sexes: controlled N. davidi studies support an expected population ratio
    // near 1:1, not exact pairing within every clutch.
    // Use a separately avalanched full-width lineage hash for sex. Feeding and
    // motion traits use floating-point noise below; applying sine noise to
    // adjacent 32-bit hashes correlated sibling draws.
    const isFemale = deterministicIndependentSeed(`${lineageKey}:sex`) < 0x80000000;
    const angle = deterministicNoise(parent.randomSeed + clutchIndex * 3.7) * Math.PI * 2;
    const distance = 7 + deterministicNoise(parent.randomSeed + clutchIndex * 8.9) * 12;
    const individualSeed = characteristicSeed * 0.001;
    const maturationTargetSeconds =
      shrimpMaturationTargetSeconds(individualSeed);
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
      sex: isFemale ? 'female' : 'male',
      ageSeconds: 0,
      lifespanSeconds: shrimpLifespanSeconds(individualSeed),
      // The condition value is derived from conserved matter on the first
      // ecology step. A newborn has no reserve, so do not show a fictitious
      // well-fed value before that synchronization occurs.
      energy: SHRIMP_STRUCTURE_CONDITION_SHARE,
      structuralBiomass: WATER_CYCLE_RULES.shrimp.juvenileBirthBiomass,
      storedBiomass: 0,
      reproductiveBiomass: 0,
      health: 1,
      behavior: 'resting',
      behaviorTimer: deterministicNoise(characteristicSeed * 0.043),
      targetCellId: parent.targetCellId,
      targetAnimalId: null,
      attachmentCellId: null,
      incubationRemaining: null,
      recentFood: null,
      nextTargetEvaluation: deterministicNoise(characteristicSeed * 0.047) * 0.5,
      recentIntake: 0,
      consumedBiomass: 0,
      grazingSessionIntake: 0,
      recentGrazingCellId: null,
      recentGrazingCellCooldown: 0,
      secondsSinceFood: 0,
      growthProgress: 0,
      reproductionCooldown: 0,
      gestationRemaining: null,
      maturationTargetSeconds,
      ovarianProgress: 0,
      ovarianClutchSize: undefined,
      reproductiveCycleIndex: 0,
      matingAccumulator: 0,
      randomSeed: individualSeed,
      generation: (parent.generation ?? 0) + 1,
      parentId: parent.id,
    };
  }

  private createAdultRicefishState(
    id: string,
    point: Vec2,
    origin: 'supplied' | 'born',
  ): AnimalState {
    // Inventory usage is the introduction sequence, so holding the second
    // fish back (or saving after the first supplied fish dies) cannot restart
    // the female/male pairing from zero.
    const suppliedIndex =
      this.animalInventoryUsed['japanese-ricefish'];
    const characteristicSeed = deterministicStringSeed(
      origin === 'supplied'
        ? `ricefish-supplied-${suppliedIndex}`
        : `${id}:ricefish`,
    );
    const ageNoise = deterministicNoise(characteristicSeed * 0.013 + 7.1);
    const lifespanNoise = deterministicNoise(characteristicSeed * 0.019 + 13.7);
    const sexNoise = deterministicNoise(characteristicSeed * 0.023 + 29.3);
    // The repeatable supplied sequence starts female, male, female. Mission 8
    // uses its first pair; unlimited laboratory additions continue the cycle.
    const sex = origin === 'supplied'
      ? suppliedIndex % 3 === 1 ? 'male' : 'female'
      : sexNoise < 0.5 ? 'female' : 'male';
    return {
      id,
      speciesId: 'japanese-ricefish',
      origin,
      position: this.clampAnimalPoint(point),
      velocity: { x: 0, y: 0 },
      facing: deterministicNoise(characteristicSeed * 0.031) < 0.5 ? -1 : 1,
      poseAngle: 0,
      bodyLength: RICEFISH_ECOLOGY_RULES.adultLength *
        (0.93 + deterministicNoise(characteristicSeed * 0.037) * 0.14),
      lifeStage: 'adult',
      sex,
      ageSeconds: RICEFISH_ECOLOGY_RULES.suppliedAdultMinimumAgeSeconds +
        ageNoise * (
          RICEFISH_ECOLOGY_RULES.suppliedAdultMaximumAgeSeconds -
          RICEFISH_ECOLOGY_RULES.suppliedAdultMinimumAgeSeconds
        ),
      lifespanSeconds: RICEFISH_ECOLOGY_RULES.minimumLifespanSeconds +
        lifespanNoise * (
          RICEFISH_ECOLOGY_RULES.maximumLifespanSeconds -
          RICEFISH_ECOLOGY_RULES.minimumLifespanSeconds
        ),
      energy: 0.48,
      structuralBiomass: WATER_CYCLE_RULES.ricefish.adultStructuralBiomass,
      peakStructuralBiomass:
        WATER_CYCLE_RULES.ricefish.adultStructuralBiomass,
      storedBiomass: WATER_CYCLE_RULES.ricefish.suppliedReserveBiomass,
      reproductiveBiomass: sex === 'female' && origin === 'supplied'
        ? RICEFISH_ECOLOGY_RULES.eggClutchMinimum *
          WATER_CYCLE_RULES.ricefish.eggBiomass
        : 0,
      health: 1,
      behavior: 'exploring',
      behaviorTimer: 0,
      targetCellId: null,
      targetAnimalId: null,
      attachmentCellId: null,
      incubationRemaining: null,
      recentFood: null,
      nextTargetEvaluation: deterministicNoise(characteristicSeed * 0.041) * 1.2,
      recentIntake: 0,
      consumedBiomass: 0,
      grazingSessionIntake: 0,
      secondsSinceFood: 0,
      growthProgress: 1,
      reproductionCooldown: 55 + deterministicNoise(characteristicSeed * 0.043) * 55,
      gestationRemaining: null,
      matingAccumulator: 0,
      reproductiveCycleIndex: 0,
      randomSeed: characteristicSeed * 0.001,
      generation: 0,
      parentId: null,
    };
  }

  private createRicefishEggState(
    parent: AnimalState,
    cell: SurfaceCellState,
    clutchIndex: number,
  ): AnimalState {
    const id = `animal-${++this.animalCounter}`;
    // A ricefish lineage must not change because unrelated shrimp or Daphnia
    // happened to consume global display IDs first. Parent identity, completed
    // spawning cycle and clutch position are the biological lineage inputs;
    // `id` remains only the unique UI/save identifier.
    const seed = deterministicStringSeed(
      `ricefish-lineage-${parent.randomSeed.toPrecision(12)}-` +
      `${parent.reproductiveCycleIndex ?? 0}-${clutchIndex}`,
    );
    const point = this.ricefishEggAttachmentPoint(cell, parent);
    const angle = deterministicNoise(seed * 0.017 + clutchIndex) * Math.PI * 2;
    const radius = 3 + deterministicNoise(seed * 0.023 + clutchIndex * 2.1) * 6;
    const cohortSexOffset =
      deterministicNoise(parent.randomSeed + parent.ageSeconds * 0.019) < 0.5 ? 0 : 1;
    return {
      id,
      speciesId: 'japanese-ricefish',
      origin: 'born',
      position: this.clampAnimalPoint({
        x: point.x + Math.cos(angle) * radius,
        y: point.y + Math.sin(angle) * radius,
      }),
      velocity: { x: 0, y: 0 },
      facing: 1,
      poseAngle: 0,
      bodyLength: 6,
      lifeStage: 'egg',
      sex: (clutchIndex + cohortSexOffset) % 2 === 0 ? 'female' : 'male',
      ageSeconds: 0,
      lifespanSeconds: RICEFISH_ECOLOGY_RULES.minimumLifespanSeconds +
        deterministicNoise(seed * 0.037) * (
          RICEFISH_ECOLOGY_RULES.maximumLifespanSeconds -
          RICEFISH_ECOLOGY_RULES.minimumLifespanSeconds
        ),
      energy: 1,
      structuralBiomass: WATER_CYCLE_RULES.ricefish.eggBiomass,
      peakStructuralBiomass: WATER_CYCLE_RULES.ricefish.eggBiomass,
      storedBiomass: 0,
      reproductiveBiomass: 0,
      health: 1,
      behavior: 'incubating',
      behaviorTimer: 0,
      targetCellId: null,
      targetAnimalId: null,
      attachmentCellId: cell.id,
      incubationRemaining: RICEFISH_ECOLOGY_RULES.eggIncubationSecondsAt25C,
      recentFood: null,
      nextTargetEvaluation: 0,
      recentIntake: 0,
      consumedBiomass: 0,
      grazingSessionIntake: 0,
      secondsSinceFood: 0,
      growthProgress: 0,
      reproductionCooldown: 0,
      gestationRemaining: null,
      matingAccumulator: 0,
      reproductiveCycleIndex: 0,
      randomSeed: seed * 0.001,
      generation: (parent.generation ?? 0) + 1,
      parentId: parent.id,
    };
  }

  private animalHitScore(point: Vec2, animal: AnimalState): number | null {
    const radii = animalVisualHitRadii(animal.speciesId, animal.bodyLength);
    const facingSign = animal.facing < 0 ? -1 : 1;
    const rotation = animal.poseAngle * facingSign;
    const dx = point.x - animal.position.x;
    const dy = point.y - animal.position.y;
    const cosine = Math.cos(rotation);
    const sine = Math.sin(rotation);
    const localX = dx * cosine + dy * sine;
    const localY = -dx * sine + dy * cosine;
    const score = Math.sqrt(
      (localX * localX) / (radii.x * radii.x) +
      (localY * localY) / (radii.y * radii.y),
    );
    return score <= 1 ? score : null;
  }

  private nearestAnimalHit(point: Vec2): {
    animal: AnimalState;
    distance: number;
    score: number;
  } | null {
    let nearest: {
      animal: AnimalState;
      distance: number;
      score: number;
    } | null = null;
    for (const animal of this.animals) {
      const score = this.animalHitScore(point, animal);
      if (score === null) continue;
      const distance = Math.sqrt(distanceSquared(point, animal.position));
      if (!nearest || score < nearest.score) {
        nearest = { animal, distance, score };
      }
    }
    return nearest;
  }

  private carcassHitScore(
    point: Vec2,
    carcass: AnimalCarcassState,
    visualPoint: Vec2,
  ): number | null {
    const radii = carcass.speciesId === 'japanese-ricefish'
      ? {
        x: Math.max(16, carcass.bodyLength * 0.78),
        y: Math.max(16, carcass.bodyLength * 0.78),
      }
      : animalVisualHitRadii(carcass.speciesId, carcass.bodyLength);
    const facingSign = carcass.facing < 0 ? -1 : 1;
    const rotation = carcass.speciesId === 'daphnia'
      ? facingSign * 0.46
      : carcass.speciesId === 'cherry-shrimp'
        ? facingSign * 0.24
        : facingSign * 0.64;
    const dx = point.x - visualPoint.x;
    const dy = point.y - visualPoint.y;
    const cosine = Math.cos(rotation);
    const sine = Math.sin(rotation);
    const localX = dx * cosine + dy * sine;
    const localY = -dx * sine + dy * cosine;
    const score = Math.sqrt(
      (localX * localX) / (radii.x * radii.x) +
      (localY * localY) / (radii.y * radii.y),
    );
    return score <= 1 ? score : null;
  }

  private nearestCarcassHit(point: Vec2): {
    carcass: AnimalCarcassState;
    visualPoint: Vec2;
    distance: number;
    score: number;
  } | null {
    let nearest: {
      carcass: AnimalCarcassState;
      visualPoint: Vec2;
      distance: number;
      score: number;
    } | null = null;
    const selectableCarcasses = presentedAnimalCarcasses(
      this.carcasses,
      this.selection?.kind === 'carcass' ? this.selection.carcassId : null,
    );
    for (const carcass of selectableCarcasses) {
      const visualPoint = animalCarcassVisualPoint({
        speciesId: carcass.speciesId,
        x: carcass.position.x,
        y: carcass.position.y,
        ageSeconds: carcass.ageSeconds,
      });
      const score = this.carcassHitScore(point, carcass, visualPoint);
      if (score === null) continue;
      const distance = Math.sqrt(distanceSquared(point, visualPoint));
      if (!nearest || score < nearest.score) {
        nearest = { carcass, visualPoint, distance, score };
      }
    }
    return nearest;
  }

  private isAnimalPlacementPoint(point: Vec2): boolean {
    return point.x >= 18 && point.x <= this.tank.width - 18 &&
      point.y >= this.tank.waterTop + 18 && point.y <= this.tank.groundY - 16;
  }

  private clampAnimalPoint(point: Vec2, reuse?: Vec2): Vec2 {
    const x = clamp(point.x, 18, this.tank.width - 18);
    const y = clamp(point.y, this.tank.waterTop + 18, this.tank.groundY - 16);
    const target = reuse ?? { x: 0, y: 0 };
    target.x = x;
    target.y = y;
    return target;
  }

  /**
   * Surface cells describe the physical surface itself, while a shrimp's
   * position describes its body centre. Edge substrate cells can therefore
   * lie just outside the centre's legal movement bounds. Navigation, target
   * scoring and grazing must all use the same reachable contact point or an
   * animal can pursue a perfectly edible edge cell forever without getting
   * close enough to bite it.
   */
  private shrimpSurfaceContactPoint(cell: SurfaceCellState): Vec2 {
    const point = this.cellWorldPoint(cell);
    if (
      cell.shrimpContactSourceX === point.x &&
      cell.shrimpContactSourceY === point.y
    ) return cell.shrimpContactPoint;
    cell.shrimpContactPoint.x = clamp(point.x, 18, this.tank.width - 18);
    cell.shrimpContactPoint.y = clamp(point.y, this.tank.waterTop + 18, this.tank.groundY - 16);
    cell.shrimpContactSourceX = point.x;
    cell.shrimpContactSourceY = point.y;
    return cell.shrimpContactPoint;
  }

  private clampDaphniaPoint(point: Vec2, reuse?: Vec2): Vec2 {
    const x = clamp(point.x, 10, this.tank.width - 10);
    const y = clamp(point.y, this.tank.waterTop + 12, this.tank.groundY - 14);
    const target = reuse ?? { x: 0, y: 0 };
    target.x = x;
    target.y = y;
    return target;
  }

  private allCells(): SurfaceCellState[] {
    if (!this.allCellsCacheDirty) return this.allCellsCache;
    this.allCellsCache.length = 0;
    this.allCellsCache.push(...this.substrateCells);
    for (const structure of this.structures) {
      this.allCellsCache.push(...structure.cells);
    }
    this.shrimpFoodCellIndexByIdScratch.clear();
    for (let index = 0; index < this.allCellsCache.length; index += 1) {
      this.shrimpFoodCellIndexByIdScratch.set(
        this.allCellsCache[index].id,
        index,
      );
    }
    if (
      this.shrimpFoodReservationCountsScratch.length !==
      this.allCellsCache.length
    ) {
      this.shrimpFoodReservationCountsScratch = new Uint16Array(
        this.allCellsCache.length,
      );
    }
    this.allCellsCacheDirty = false;
    return this.allCellsCache;
  }

  private cellById(id: string): SurfaceCellState | undefined {
    if (id.startsWith('substrate:')) return this.substrateCells.find((cell) => cell.id === id);
    const ownerId = id.split(':cell-')[0];
    return this.structureById(ownerId)?.cells.find((cell) => cell.id === id);
  }

  private cellWorldPoint(cell: SurfaceCellState): Vec2 {
    if (cell.surfaceKind === 'substrate') return cell.worldPoint;
    const structure = this.structureById(cell.ownerId);
    if (!structure) {
      cell.worldPoint.x = cell.x;
      cell.worldPoint.y = cell.y;
      return cell.worldPoint;
    }
    const position = structure.body.position;
    const angle = structure.body.angle;
    if (
      cell.worldTransformX === position.x &&
      cell.worldTransformY === position.y &&
      cell.worldTransformAngle === angle
    ) return cell.worldPoint;
    const point = structureAuthoredPointToWorld(
      cell,
      STRUCTURES[structure.definitionId].collisionPolygon,
      position,
      angle,
      cell.worldPoint,
    );
    cell.worldTransformX = position.x;
    cell.worldTransformY = position.y;
    cell.worldTransformAngle = angle;
    return point;
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
      if (!cell || cell.biomass.vallisneria <= VALLISNERIA_VISIBLE_BIOMASS) continue;
      const anchor = this.vallisneriaRootPosition(placement, cell);
      const leafDistance = vallisneriaHitDistance(
        point,
        cell.index,
        anchor,
        placement.plant.structuralScale,
      );
      // Only the painted ribbons receive a hit area. Treating the entire
      // canopy bounding rectangle as the plant made its transparent gaps
      // intercept clicks intended for stones and other objects behind it.
      if (!nearest || leafDistance < nearest.distance) {
        nearest = { placement, distance: leafDistance };
      }
    }
    return nearest;
  }

  private structureById(id: string): StructureState | undefined {
    return this.structures.find((structure) => structure.id === id);
  }

  private structureAtPoint(point: Vec2): StructureState | undefined {
    const hits = Query.point(this.structures.map((structure) => structure.body), point);
    const body = hits.at(-1);
    return body
      ? this.structures.find((structure) => structure.body.id === body.id)
      : undefined;
  }

  private isHeldStructure(id: string): boolean {
    return this.held?.kind === 'structure' && this.held.structureId === id;
  }

  private clampPointer(point: Vec2): Vec2 {
    return {
      x: clamp(point.x, 0, this.tank.width),
      y: clamp(point.y, this.tank.waterTop, this.tank.groundY),
    };
  }
}
