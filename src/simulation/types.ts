import type { SimulationSpeed } from './speed';
import type { DayNightState } from './dayNight';

export const TANK_WIDTH = 1200;
export const TANK_HEIGHT = 720;
export const WATER_TOP = 56;
export const GROUND_Y = 646;
export const WATER_COLUMNS = 36;
export const WATER_ROWS = 20;

export type TankTypeId = 'standard' | 'long';

export interface TankDefinition {
  id: TankTypeId;
  label: string;
  width: number;
  height: number;
  waterTop: number;
  groundY: number;
  waterColumns: number;
  waterRows: number;
}

export const TANK_DEFINITIONS: Record<TankTypeId, TankDefinition> = {
  standard: {
    id: 'standard',
    label: '표준 수조',
    width: TANK_WIDTH,
    height: TANK_HEIGHT,
    waterTop: WATER_TOP,
    groundY: GROUND_Y,
    waterColumns: WATER_COLUMNS,
    waterRows: WATER_ROWS,
  },
  long: {
    id: 'long',
    label: '긴 수조',
    width: TANK_WIDTH * 2,
    height: TANK_HEIGHT,
    waterTop: WATER_TOP,
    groundY: GROUND_Y,
    waterColumns: WATER_COLUMNS * 2,
    waterRows: WATER_ROWS,
  },
};

export const tankDefinition = (id: TankTypeId | undefined): TankDefinition =>
  TANK_DEFINITIONS[id ?? 'standard'];
/**
 * Structures settle on the middle of the shallow substrate depth band. The
 * lower substrate row remains visually in front of them while the upper rows
 * read as background habitat.
 */
export const STRUCTURE_SUPPORT_Y = GROUND_Y - 12;

/**
 * Visual motion is sampled on a real-time clock, independently of simulation
 * speed and of the heavier ecology snapshots. Keeping one cadence makes the
 * two most recent samples suitable for renderer-side interpolation.
 */
export const MOTION_SAMPLE_RATE_HZ = 30;
export const MOTION_SAMPLE_INTERVAL_MS = 1000 / MOTION_SAMPLE_RATE_HZ;

export type ScenarioId =
  | 'mission-1'
  | 'mission-2'
  | 'mission-3'
  | 'mission-4'
  | 'mission-5'
  | 'mission-6'
  | 'mission-7'
  | 'mission-8'
  | 'laboratory';
export type SimulationMode = 'challenge' | 'laboratory';
export type SimulationPhase = 'setup' | 'running' | 'paused';
export type MissionOutcome = 'pending' | 'success' | 'failure';
export type SpeciesId = 'oedogonium' | 'nitzschia' | 'vallisneria';
export type AnimalSpeciesId = 'cherry-shrimp' | 'japanese-ricefish' | 'daphnia';
export type AnimalLifeStage = 'egg' | 'fry' | 'juvenile' | 'adult';
export type AnimalSex = 'female' | 'male';
export type AnimalBehavior =
  | 'held'
  | 'exploring'
  | 'traveling'
  | 'grazing'
  | 'resting'
  | 'starving'
  | 'hunting'
  | 'courting'
  | 'carrying-eggs'
  | 'incubating';
export type AnimalReproductiveState =
  | 'none'
  | 'ready'
  | 'berried'
  | 'carrying-eggs'
  | 'incubating';
export type AnimalDeathCause =
  | 'starvation'
  | 'old-age'
  | 'hypoxia'
  | 'toxicity'
  | 'temperature'
  | 'predation';
export type AnimalPopulationEventKind =
  | 'introduced'
  | 'removed'
  | 'birth'
  | 'hatched'
  | 'matured'
  | 'death';
export type StructureDefinitionId =
  | 'flat-stone'
  | 'round-stone'
  | 'tall-stone'
  | 'small-flat-stone'
  | 'small-wedge-stone';
export type MicrobeGuildId = 'decomposer' | 'nitrifier';
export type PlanktonKind = 'phytoplankton' | 'daphnia';
export type WaterQualityVariable = 'organicMatter' | 'toxicWaste' | 'nutrients' | 'oxygen';
export type InteractionTool =
  | 'select'
  | 'move'
  | 'light-probe'
  | 'temperature-probe'
  | 'water-quality-probe';
export type InventoryCategory = 'structures' | 'organisms' | 'instruments';
export type SelectionFilter = 'all' | 'structure' | 'organism' | 'measurement';
export type MeasurementKind = 'light' | 'temperature' | 'water-quality';
export type GrowthTrend = 'growing' | 'stable' | 'declining';
export type SurfaceKind = 'structure-face' | 'substrate';

export interface Vec2 {
  x: number;
  y: number;
}

export interface SpeciesBiomass {
  oedogonium: number;
  nitzschia: number;
  vallisneria: number;
}

export interface BiofilmBiomass {
  decomposer: number;
  nitrifier: number;
}

export interface WaterQualityValues {
  organicMatter: number;
  toxicWaste: number;
  nutrients: number;
  oxygen: number;
}

export interface StructureSnapshot {
  id: string;
  definitionId: StructureDefinitionId;
  label: string;
  assetPath: string;
  x: number;
  y: number;
  angle: number;
  width: number;
  height: number;
  isSleeping: boolean;
  locked: boolean;
  isHeld: boolean;
  placementValid: boolean;
}

export interface SurfaceCellSnapshot {
  id: string;
  ownerId: string;
  ownerLabel: string;
  surfaceKind: SurfaceKind;
  index: number;
  x: number;
  y: number;
  cellSize: number;
  light: number;
  /** Canopy light is only meaningful for rooted macrophytes. */
  plantCanopyLight: number | null;
  biomass: SpeciesBiomass;
  biofilm: BiofilmBiomass;
  targetEligible: boolean;
}

export interface SeedSnapshot {
  id: string;
  speciesId: SpeciesId;
  cellId: string;
  x: number;
  y: number;
  locked: boolean;
}

export type PlantLifeStage = 'juvenile' | 'mature' | 'senescent';

/** One rooted Vallisneria rosette (ramet), including runner-born daughters. */
export interface PlantRametSnapshot {
  id: string;
  speciesId: 'vallisneria';
  cellId: string;
  x: number;
  y: number;
  origin: 'supplied' | 'runner';
  parentId: string | null;
  /** Runner-born daughters remain physiologically connected while juvenile. */
  connectedToParent: boolean;
  ageSeconds: number;
  lifespanSeconds: number;
  lifeStage: PlantLifeStage;
  structuralScale: number;
  health: number;
  runnerProgress: number;
  reproductionCount: number;
}

export interface AnimalSnapshot {
  id: string;
  speciesId: AnimalSpeciesId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: -1 | 1;
  poseAngle: number;
  bodyLength: number;
  lifeStage: AnimalLifeStage;
  sex: AnimalSex;
  ageSeconds: number;
  lifespanSeconds: number;
  energy: number;
  /** Conserved structure, reserve and reproductive matter carried by this animal. */
  biomass?: number;
  /** Living body tissue, excluding short-term reserve and reproductive matter. */
  structuralBiomass?: number;
  /** Assimilated short-term nutrient reserve used before body tissue is catabolised. */
  storedBiomass?: number;
  /** Conserved matter already allocated to eggs or a brood. */
  reproductiveBiomass?: number;
  health: number;
  behavior: AnimalBehavior;
  reproductiveState: AnimalReproductiveState;
  recentIntake: number;
  consumedBiomass: number;
  /**
   * Feeding deficit clock. For shrimp this accumulates the maintenance ration
   * that recent intake did not cover; other animals use elapsed time since a
   * non-zero ration.
   */
  secondsSinceFood: number;
  /** Food-funded progress toward the next life stage, from 0 to 1. */
  growthProgress?: number;
  recentFood?: string | null;
  attachmentLabel?: string | null;
  developmentProgress?: number | null;
  oxygen?: number | null;
  toxicWaste?: number | null;
  temperature: number;
  metabolicTemperatureFactor: number;
  reproductionTemperatureFactor: number;
  thermalHealthSuitability: number;
  /** Supplied animals are generation 0; their descendants increment it. */
  generation?: number;
  parentId?: string | null;
}

/**
 * A short-lived visual and diagnostic record of an animal's death. It keeps
 * the pose needed to draw the carcass together with the local water sample at
 * the instant of death; decomposition chemistry is still tracked separately.
 */
export interface AnimalCarcassSnapshot {
  id: string;
  sourceAnimalId: string;
  speciesId: AnimalSpeciesId;
  x: number;
  y: number;
  facing: -1 | 1;
  poseAngle: number;
  bodyLength: number;
  lifeStage: AnimalLifeStage;
  cause: AnimalDeathCause;
  waterAtDeath: WaterQualityValues | null;
  temperatureAtDeath: number | null;
  ageSeconds: number;
  lifetimeSeconds: number;
  progress: number;
}

export interface AnimalPopulationSnapshot {
  total: number;
  eggs: number;
  fry: number;
  adults: number;
  juveniles: number;
  adultFemales: number;
  adultMales: number;
  juvenileFemales: number;
  juvenileMales: number;
}

/**
 * Persistent diagnostic record. Unlike a carcass, this remains available
 * after the visual body has decomposed so a long-running extinction can be
 * reconstructed from sex, life stage, cause and local water conditions.
 */
export interface AnimalPopulationEventSnapshot {
  sequence: number;
  kind: AnimalPopulationEventKind;
  elapsedSeconds: number;
  animalId: string;
  speciesId: AnimalSpeciesId;
  lifeStage: AnimalLifeStage;
  sex: AnimalSex;
  x: number;
  y: number;
  ageSeconds: number;
  energy: number;
  /** Lineage generation at the instant of this event. */
  generation?: number;
  cause: AnimalDeathCause | null;
  parentId: string | null;
  water: WaterQualityValues | null;
  temperature: number | null;
}

export interface AnimalPopulationEventTotals {
  introduced: number;
  removed: number;
  births: number;
  hatches: number;
  maturations: number;
  deaths: number;
  deathsByCause: Record<AnimalDeathCause, number>;
}

export interface WaterQualityFieldSnapshot {
  columns: number;
  rows: number;
  organicMatter: number[];
  toxicWaste: number[];
  nutrients: number[];
  oxygen: number[];
  dissolvedInorganicCarbon: number[];
  /** Free-living heterotrophic decomposers carried by the water column. */
  planktonicDecomposer: number[];
  /** Suspended photosynthetic biomass, separate from attached algae. */
  phytoplankton: number[];
  daphniaJuveniles: number[];
  daphniaAdults: number[];
  revision: number;
}

export interface PlanktonSnapshot {
  phytoplanktonBiomass: number;
  planktonicDecomposerBiomass: number;
  daphniaJuvenileBiomass: number;
  daphniaAdultBiomass: number;
  daphniaFounderAdultBiomass: number;
  daphniaBornAdultBiomass: number;
  approximateDaphniaCount: number;
  cumulativeFiltration: {
    phytoplankton: number;
    planktonicDecomposer: number;
  };
  cumulativeEvents: {
    births: number;
    maturations: number;
    secondGenerationBirths: number;
    deaths: number;
  };
  fluxes: {
    phytoplanktonGrowthPerSecond: number;
    phytoplanktonRespirationPerSecond: number;
    phytoplanktonMortalityPerSecond: number;
    daphniaFoodAssimilatedPerSecond: number;
    daphniaRespirationPerSecond: number;
    daphniaMortalityPerSecond: number;
  };
}

export interface WaterTransportSnapshot {
  columns: number;
  rows: number;
  temperature: number[];
  velocityX: number[];
  velocityY: number[];
  solidFraction: number[];
  flowResistance: number[];
  averageTemperature: number;
  minimumTemperature: number;
  maximumTemperature: number;
  maximumSpeed: number;
  cumulativeExternalHeat: number;
  revision: number;
}

export interface BiogeochemistrySnapshot {
  effectsEnabled: boolean;
  potentialOxygenProduction: number;
  potentialOxygenDemand: number;
  dissolvedWasteProduced: number;
  detritusMass: number;
  water: WaterQualityFieldSnapshot;
  transport: WaterTransportSnapshot;
  average: WaterQualityValues;
  biofilmTotals: BiofilmBiomass;
  plankton: PlanktonSnapshot;
  algaeFluxes: {
    grossProductionBiomassPerSecond: number;
    respirationBiomassPerSecond: number;
    stressTurnoverBiomassPerSecond: number;
    oxygenProducedPerSecond: number;
    oxygenConsumedPerSecond: number;
  };
  carbonCycle: {
    dissolvedInorganicCarbon: number;
    headspaceCarbonDioxide: number;
    headspaceOxygen: number;
  };
  gasExchange: {
    surfaceTemperature: number;
    oxygenSolubilityMgL: number;
    oxygenSolubilityRatio: number;
    oxygenWaterEquilibrium: number;
  };
  materialBalance: {
    totalNitrogen: number;
    totalCarbon: number;
    oxygenEquivalent: number;
    referenceNitrogen: number | null;
    referenceCarbon: number | null;
    referenceOxygenEquivalent: number | null;
    nitrogenDriftRatio: number;
    carbonDriftRatio: number;
    oxygenEquivalentDriftRatio: number;
  };
}

export interface HoldingSnapshot {
  kind: 'structure' | 'seed' | 'animal' | 'biofilm' | 'plankton';
  source: 'inventory' | 'existing';
  valid: boolean;
  x: number;
  y: number;
  structureId?: string;
  structureDefinitionId?: StructureDefinitionId;
  speciesId?: SpeciesId;
  animalId?: string;
  animalSpeciesId?: AnimalSpeciesId;
  animalSex?: AnimalSex;
  microbeGuildId?: MicrobeGuildId;
  planktonKind?: PlanktonKind;
}

export interface LightFieldSnapshot {
  columns: number;
  rows: number;
  values: number[];
  revision: number;
}

export interface ProbeSnapshot {
  x: number;
  y: number;
  light: number;
  temperature: number;
  waterVelocity: Vec2;
  waterSpeed: number;
  locationLabel: string;
  surfaceCellId?: string;
  trends: Record<SpeciesId, GrowthTrend>;
  water: WaterQualityValues;
  biofilm: BiofilmBiomass;
  microbeNetGrowth: Record<MicrobeGuildId, number>;
  plankton: {
    phytoplankton: number;
    planktonicDecomposer: number;
    daphniaJuveniles: number;
    daphniaAdults: number;
  };
}

export interface MeasurementSnapshot extends ProbeSnapshot {
  id: string;
  kind: MeasurementKind;
}

export interface SelectionSnapshot {
  kind: 'structure' | 'colony' | 'animal' | 'carcass' | 'region' | 'measurement';
  x: number;
  y: number;
  ownerLabel: string;
  structureId?: string;
  cellId?: string;
  plantId?: string;
  speciesId?: SpeciesId;
  speciesIds?: SpeciesId[];
  measurementId?: string;
  animalId?: string;
  carcassId?: string;
  animalIds?: string[];
  structureIds?: string[];
  measurementIds?: string[];
  cellIds?: string[];
  microbeGuildIds?: MicrobeGuildId[];
  bounds?: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  };
}

export interface MissionProgressSnapshot {
  current: number;
  target: number;
  unit:
    | 'coverage'
    | 'habitat-coverage'
    | 'biomass'
    | 'adult-count'
    | 'population-count'
    | 'born-count'
    | 'generation-count';
  label: string;
  ratio: number;
  holdCurrent: number;
  holdTarget: number;
  /** Optional second requirement that must remain true during the same hold. */
  supportingCurrent?: number;
  supportingTarget?: number;
  supportingLabel?: string;
}

export interface SpatialDebugGapSnapshot {
  id: string;
  x: number;
  y: number;
  clearance: number;
  usableClearance: number;
  first: Vec2;
  second: Vec2;
  structureIds: [string, string];
}

export interface SpatialDebugAgentSnapshot {
  id: string;
  speciesId: AnimalSpeciesId;
  x: number;
  y: number;
  bodyThickness: number;
}

export interface SpatialDebugSnapshot {
  enabled: boolean;
  gaps: SpatialDebugGapSnapshot[];
  agents: SpatialDebugAgentSnapshot[];
}

export interface SimulationSnapshot {
  scenarioId: ScenarioId;
  tank: TankDefinition;
  mode: SimulationMode;
  phase: SimulationPhase;
  outcome: MissionOutcome;
  outcomeAtSeconds: number | null;
  currentTargetMet: boolean;
  elapsedSeconds: number;
  timeLimitSeconds: number | null;
  speed: SimulationSpeed;
  allSettled: boolean;
  hasStarted: boolean;
  /** Artificial overhead fixture output. Zero means that no fixture is installed. */
  lightOutput: number;
  /** Broad sky daylight at full daytime intensity. */
  naturalLightOutput: number;
  dayNightEnabled: boolean;
  dayNight: (DayNightState & {
    effectiveNaturalLightOutput: number;
    effectiveLightOutput: number;
  }) | null;
  waterTemperature: number;
  structures: StructureSnapshot[];
  cells: SurfaceCellSnapshot[];
  seeds: SeedSnapshot[];
  plants: PlantRametSnapshot[];
  animals: AnimalSnapshot[];
  carcasses: AnimalCarcassSnapshot[];
  holding: HoldingSnapshot | null;
  lightField: LightFieldSnapshot;
  probe: ProbeSnapshot | null;
  measurements: MeasurementSnapshot[];
  selection: SelectionSnapshot | null;
  remainingSeeds: Record<SpeciesId, number | null>;
  remainingAnimals: Record<AnimalSpeciesId, number | null>;
  remainingAnimalSexes: Partial<
    Record<AnimalSpeciesId, Record<AnimalSex, number | null>>
  >;
  remainingMicrobes: Record<MicrobeGuildId, number | null>;
  remainingPlankton: Record<PlanktonKind, number | null>;
  remainingStructures: Record<StructureDefinitionId, number | null>;
  /** Populated only while the laboratory spatial-debug view is enabled. */
  spatialDebug: SpatialDebugSnapshot;
  totalBiomass: SpeciesBiomass;
  totalAlgaeConsumed: number;
  animalPopulation: Record<AnimalSpeciesId, AnimalPopulationSnapshot>;
  animalPopulationEvents: AnimalPopulationEventSnapshot[];
  animalPopulationEventTotals: AnimalPopulationEventTotals;
  biogeochemistry: BiogeochemistrySnapshot;
  coverageRatio: number;
  missionProgress: MissionProgressSnapshot | null;
  message: string;
  revision: number;
}

export interface BiogeochemistrySaveState {
  detritus: number[];
  organicMatter: number[];
  toxicWaste: number[];
  nutrients: number[];
  oxygen: number[];
  dissolvedInorganicCarbon: number;
  dissolvedInorganicCarbonField?: number[];
  planktonicDecomposer?: number[];
  phytoplankton?: number[];
  daphniaJuveniles?: number[];
  daphniaFounderAdults?: number[];
  daphniaBornAdults?: number[];
  /** Optional, non-material behavioural field for version-1 save compatibility. */
  daphniaCrowdingCue?: number[];
  /**
   * Dissolved food odour used only for shrimp navigation. It is deliberately
   * excluded from the closed material ledger.
   */
  shrimpFoodCue?: number[];
  /**
   * Short-lived reproductive cue from receptive shrimp females. Like food
   * odour, this is behavioural information rather than conserved matter.
   */
  shrimpMateCue?: number[];
  /**
   * Short-lived non-material predator/attack cue. It carries no predator ID
   * or exact coordinate and is excluded from the closed material ledger.
   */
  predatorDangerCue?: number[];
  planktonCounters?: PlanktonSnapshot['cumulativeEvents'] & {
    filteredPhytoplankton: number;
    filteredPlanktonicDecomposer: number;
  };
  headspaceCarbonDioxide: number;
  headspaceOxygen: number;
  cumulativeOxygenProduction: number;
  cumulativeOxygenDemand: number;
  cumulativeDissolvedWaste: number;
  fieldRevision: number;
  /** Optional so existing version-1 frozen aquariums remain loadable. */
  transport?: WaterTransportSaveState;
}

export interface WaterTransportSaveState {
  temperature: number[];
  velocityX: number[];
  velocityY: number[];
  cumulativeExternalHeat: number;
  revision: number;
}

export interface SavedSurfaceCellBiology {
  id: string;
  biomass: SpeciesBiomass;
  biofilm: BiofilmBiomass;
}

export interface SavedStructureState {
  id: string;
  definitionId: StructureDefinitionId;
  x: number;
  y: number;
  angle: number;
  vx: number;
  vy: number;
  angularVelocity: number;
  isSleeping: boolean;
  locked: boolean;
  cells: SavedSurfaceCellBiology[];
}

export interface SavedAnimalState {
  id: string;
  speciesId: AnimalSpeciesId;
  origin: 'supplied' | 'born';
  position: Vec2;
  velocity: Vec2;
  facing: -1 | 1;
  poseAngle: number;
  bodyLength: number;
  lifeStage: AnimalLifeStage;
  sex: AnimalSex;
  ageSeconds: number;
  lifespanSeconds: number;
  energy: number;
  structuralBiomass: number;
  /**
   * Greatest post-hatch structural mass reached by this animal. Ricefish use
   * it to distinguish healthy small juveniles from individuals that have
   * wasted away. Optional so older frozen aquariums remain loadable.
   */
  peakStructuralBiomass?: number;
  storedBiomass: number;
  /**
   * Portion of storedBiomass that is still endogenous post-hatch yolk.
   * It is a subset marker, not additional matter. Optional for old saves.
   */
  yolkBiomass?: number;
  /** Conserved egg/reproduction buffer; optional only for version-1 save compatibility. */
  reproductiveBiomass?: number;
  health: number;
  behavior: AnimalBehavior;
  behaviorTimer: number;
  targetCellId: string | null;
  /** Optional so version-1 shrimp-only frozen aquariums remain loadable. */
  targetAnimalId?: string | null;
  /**
   * Reciprocal ricefish courtship partner. Optional so older frozen aquariums
   * resume without a stale pairing.
   */
  courtshipPartnerId?: string | null;
  /**
   * Missed-strike recovery already spent on the current prey (0 or 1).
   * Optional so older frozen aquariums restore with no spent recovery.
   */
  strikeRecoveryUses?: number;
  /**
   * Consecutive energetic effort spent pursuing visible prey. Optional so
   * older frozen aquariums resume fully recovered.
   */
  pursuitEffort?: number;
  /**
   * Centre of the last prey-poor ricefish search patch. Optional so aquariums
   * frozen before spatial patch departure was modelled remain loadable.
   */
  foragingPatchOrigin?: Vec2 | null;
  /**
   * Position of the last visual inspection along that patch transect.
   * Optional so older frozen aquariums resume with a conservative first
   * observation instead of becoming unloadable.
   */
  foragingLastInspectionPosition?: Vec2 | null;
  /** Egg attachment surface; null for mobile life stages. */
  attachmentCellId?: string | null;
  /** Remaining embryo development time for ricefish eggs. */
  incubationRemaining?: number | null;
  /** Last consumed item, used by observation rather than feeding logic. */
  recentFood?: string | null;
  nextTargetEvaluation: number;
  recentIntake: number;
  consumedBiomass: number;
  grazingSessionIntake: number;
  /** Elapsed time in the current finite grazing bout; absent in older saves. */
  grazingSessionSeconds?: number;
  /** Most recently completed shrimp grazing patch; optional for old saves. */
  recentGrazingCellId?: string | null;
  /** Remaining local revisit delay for recentGrazingCellId. */
  recentGrazingCellCooldown?: number;
  secondsSinceFood: number;
  growthProgress: number;
  reproductionCooldown: number;
  gestationRemaining: number | null;
  /**
   * Species-specific juvenile schedule. Shrimp use seconds and Daphnia use
   * the instar target below. Optional so version-1 frozen aquariums hydrate
   * deterministic defaults instead of becoming unloadable.
   */
  maturationTargetSeconds?: number;
  maturationTargetInstars?: number;
  /** Female shrimp ovarian/molt readiness, independent of funded egg matter. */
  ovarianProgress?: number;
  /**
   * Cherry-shrimp clutch size fixed when the current ovarian cycle began.
   * Optional so older frozen aquariums derive it from the female's own size.
   */
  ovarianClutchSize?: number;
  /** Completed broods; seeds stable per-cycle life-history variation. */
  reproductiveCycleIndex?: number;
  /** Daphnia molt state. Broods are deposited and released only at a molt. */
  moltProgress?: number;
  moltCycleSeconds?: number;
  moltCount?: number;
  /** Locked Daphnia clutch size; optional for older frozen aquariums. */
  gestatingBroodSize?: number | null;
  matingAccumulator: number;
  randomSeed: number;
  /** Optional so frozen aquariums created before individual Daphnia still load. */
  generation?: number;
  parentId?: string | null;
}

export interface SavedAnimalCarcassState {
  id: string;
  sourceAnimalId: string;
  speciesId: AnimalSpeciesId;
  position: Vec2;
  facing: -1 | 1;
  poseAngle: number;
  bodyLength: number;
  lifeStage: AnimalLifeStage;
  cause: AnimalDeathCause;
  waterAtDeath: WaterQualityValues | null;
  temperatureAtDeath?: number | null;
  ageSeconds: number;
}

export interface SimulationSaveData {
  version: 1;
  scenarioId: ScenarioId;
  /** Fresh-tank biological draw; persisted so thawing cannot reroll offspring. */
  runSeed?: number;
  /** Optional so frozen aquariums created before selectable tanks load as standard. */
  tankType?: TankTypeId;
  savedPhase: SimulationPhase;
  outcome: MissionOutcome;
  outcomeAtSeconds: number | null;
  elapsedSeconds: number;
  speed: SimulationSpeed;
  hasStarted: boolean;
  allSettled: boolean;
  successHoldAccumulator: number;
  structureCounter: number;
  seedCounter: number;
  animalCounter: number;
  measurementCounter: number;
  lightOutput: number;
  /** Optional so frozen aquariums saved before natural daylight remain loadable. */
  naturalLightOutput?: number;
  /** Optional so older laboratory saves keep their former steady lighting. */
  dayNightEnabled?: boolean;
  waterTemperature: number;
  structures: SavedStructureState[];
  substrateCells: SavedSurfaceCellBiology[];
  seedPlacements: Array<{
    id: string;
    speciesId: SpeciesId;
    cellId: string;
    locked: boolean;
    /** Exact visual/ecological root point; older saves fall back to a stable in-cell offset. */
    rootPosition?: Vec2;
    /** Optional fields keep older version-1 frozen aquariums loadable. */
    origin?: 'supplied' | 'runner';
    plant?: {
      parentId: string | null;
      /** Optional so older frozen aquariums restore juvenile connections safely. */
      connectedToParent?: boolean;
      ageSeconds: number;
      lifespanSeconds: number;
      structuralScale: number;
      runnerProgress: number;
      reproductionCount: number;
      stressSeconds: number;
    };
  }>;
  animals: SavedAnimalState[];
  carcasses: SavedAnimalCarcassState[];
  measurements: Array<{ id: string; kind: MeasurementKind; point: Vec2 }>;
  animalPopulationEvents: AnimalPopulationEventSnapshot[];
  animalPopulationEventTotals: AnimalPopulationEventTotals;
  animalPopulationEventSequence: number;
  totalAlgaeConsumed: number;
  animalInventoryUsed: Record<AnimalSpeciesId, number>;
  /** Optional so frozen aquariums saved before sex-specific stocking remain loadable. */
  animalSexInventoryUsed?: Partial<
    Record<AnimalSpeciesId, Record<AnimalSex, number>>
  >;
  microbeInventoryUsed: Record<MicrobeGuildId, number>;
  suspendedBiofilm: BiofilmBiomass;
  /** Optional so frozen aquariums from before mission 7 remain loadable. */
  planktonInventoryUsed?: Record<PlanktonKind, number>;
  biofilmSettlementCursor: number;
  /** Optional so saves made before time-step-independent settlement still load. */
  biofilmSettlementAttemptAccumulator?: Record<MicrobeGuildId, number>;
  materialReference: {
    nitrogen: number;
    carbon: number;
    /** Optional so frozen aquariums from before redox auditing still load. */
    oxygenEquivalent?: number;
  } | null;
  biogeochemistry: BiogeochemistrySaveState;
}

export type SimulationCommand =
  | {
    type: 'initialize';
    scenarioId: ScenarioId;
    tankType?: TankTypeId;
    runSeed?: number;
  }
  | { type: 'start' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'reset'; runSeed?: number }
  | { type: 'export-save'; requestId: number }
  | { type: 'load-save'; data: SimulationSaveData }
  | { type: 'set-speed'; speed: SimulationSpeed }
  | { type: 'pointer-move'; point: Vec2 }
  | { type: 'pick-structure'; definitionId: StructureDefinitionId; point?: Vec2 }
  | { type: 'pick-seed'; speciesId: SpeciesId; point?: Vec2 }
  | {
      type: 'pick-animal';
      speciesId: AnimalSpeciesId;
      sex?: AnimalSex;
      point?: Vec2;
    }
  | { type: 'pick-biofilm'; guildId: MicrobeGuildId; point?: Vec2 }
  | { type: 'pick-plankton'; planktonKind: PlanktonKind; point?: Vec2 }
  | { type: 'pick-at'; point: Vec2 }
  | { type: 'hold-structure'; id: string; point?: Vec2 }
  | { type: 'rotate-structure'; id: string; radians: number }
  | { type: 'select-at'; point: Vec2; filter: SelectionFilter }
  | { type: 'select-region'; from: Vec2; to: Vec2; filter: SelectionFilter }
  | { type: 'select-measurement'; id: string }
  | { type: 'clear-selection' }
  | { type: 'drop-held'; point: Vec2 }
  | { type: 'cancel-held' }
  | { type: 'retrieve-held' }
  | { type: 'rotate-held'; radians: number }
  | { type: 'probe'; point: Vec2 }
  | { type: 'place-measurement'; kind: MeasurementKind; point: Vec2 }
  | { type: 'remove-measurement'; id: string }
  | { type: 'clear-probe' }
  | { type: 'remove-held-structure' }
  | { type: 'retrieve-structure'; id: string }
  | { type: 'retrieve-animal'; id: string }
  | { type: 'remove-selected-algae'; speciesId: SpeciesId }
  | { type: 'set-light-output'; output: number }
  | { type: 'set-natural-light-output'; output: number }
  | { type: 'set-day-night-enabled'; enabled: boolean }
  | { type: 'set-spatial-debug'; enabled: boolean };

export interface WorkerSnapshotMessage {
  type: 'snapshot';
  snapshot: SimulationSnapshot;
}

export interface WorkerSaveMessage {
  type: 'save-data';
  requestId: number;
  data: SimulationSaveData;
}

export interface WorkerMotionMessage {
  type: 'motion';
  /** Monotonically increases for the lifetime of a simulation worker. */
  sequence: number;
  /** `performance.now()` when the worker sampled the motion state. */
  sampledAtMs: number;
  /** Full-snapshot revision that was authoritative for this motion sample. */
  snapshotRevision: number;
  structures: StructureSnapshot[];
  animals: AnimalSnapshot[];
  holding: HoldingSnapshot | null;
  probe: ProbeSnapshot | null;
}

export interface WorkerMotionOverlayMessage {
  type: 'motion-overlay';
  /** Matches the binary motion sample whose pointer metadata this accompanies. */
  sequence: number;
  sampledAtMs: number;
  /**
   * Full-snapshot revision that was authoritative when this overlay was sampled.
   * Separate shared channels may be polled in a different order, so the renderer
   * uses this barrier to reject an old held-item pose after a newer drop snapshot.
   */
  snapshotRevision: number;
  holding: HoldingSnapshot | null;
  probe: ProbeSnapshot | null;
}

export interface WorkerTelemetryResizeRequestMessage {
  type: 'telemetry-resize-request';
  stream: 'snapshot';
  minimumPayloadBytes: number;
}

export interface WorkerFaultMessage {
  type: 'worker-fault';
  operation: 'command' | 'export-save' | 'simulation-tick';
  message: string;
  stack?: string;
}

export type WorkerMessage =
  | WorkerSnapshotMessage
  | WorkerMotionMessage
  | WorkerMotionOverlayMessage
  | WorkerSaveMessage
  | WorkerTelemetryResizeRequestMessage
  | WorkerFaultMessage;
