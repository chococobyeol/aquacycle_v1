import type { SimulationSpeed } from './speed';

export const TANK_WIDTH = 1200;
export const TANK_HEIGHT = 720;
export const WATER_TOP = 56;
export const GROUND_Y = 646;

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
  | 'laboratory';
export type SimulationMode = 'challenge' | 'laboratory';
export type SimulationPhase = 'setup' | 'running' | 'paused';
export type MissionOutcome = 'pending' | 'success' | 'failure';
export type SpeciesId = 'oedogonium' | 'nitzschia';
export type AnimalSpeciesId = 'cherry-shrimp';
export type AnimalLifeStage = 'juvenile' | 'adult';
export type AnimalSex = 'female' | 'male';
export type AnimalBehavior =
  | 'held'
  | 'exploring'
  | 'traveling'
  | 'grazing'
  | 'resting'
  | 'starving';
export type AnimalReproductiveState = 'none' | 'ready' | 'berried';
export type AnimalDeathCause = 'starvation' | 'old-age' | 'hypoxia' | 'toxicity';
export type AnimalPopulationEventKind = 'introduced' | 'removed' | 'birth' | 'matured' | 'death';
export type StructureDefinitionId = 'flat-stone' | 'round-stone' | 'tall-stone';
export type MicrobeGuildId = 'decomposer' | 'nitrifier';
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
  health: number;
  behavior: AnimalBehavior;
  reproductiveState: AnimalReproductiveState;
  recentIntake: number;
  consumedBiomass: number;
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
  ageSeconds: number;
  lifetimeSeconds: number;
  progress: number;
}

export interface AnimalPopulationSnapshot {
  total: number;
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
  cause: AnimalDeathCause | null;
  parentId: string | null;
  water: WaterQualityValues | null;
}

export interface AnimalPopulationEventTotals {
  introduced: number;
  removed: number;
  births: number;
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
  revision: number;
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
  carbonCycle: {
    dissolvedInorganicCarbon: number;
    headspaceCarbonDioxide: number;
    headspaceOxygen: number;
  };
  materialBalance: {
    totalNitrogen: number;
    totalCarbon: number;
    referenceNitrogen: number | null;
    referenceCarbon: number | null;
    nitrogenDriftRatio: number;
    carbonDriftRatio: number;
  };
}

export interface HoldingSnapshot {
  kind: 'structure' | 'seed' | 'animal' | 'biofilm';
  source: 'inventory' | 'existing';
  valid: boolean;
  x: number;
  y: number;
  structureId?: string;
  structureDefinitionId?: StructureDefinitionId;
  speciesId?: SpeciesId;
  animalId?: string;
  animalSpeciesId?: AnimalSpeciesId;
  microbeGuildId?: MicrobeGuildId;
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
  unit: 'coverage' | 'habitat-coverage' | 'biomass' | 'adult-count' | 'population-count';
  label: string;
  ratio: number;
  holdCurrent: number;
  holdTarget: number;
}

export interface SimulationSnapshot {
  scenarioId: ScenarioId;
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
  lightOutput: number;
  waterTemperature: number;
  structures: StructureSnapshot[];
  cells: SurfaceCellSnapshot[];
  seeds: SeedSnapshot[];
  animals: AnimalSnapshot[];
  carcasses: AnimalCarcassSnapshot[];
  holding: HoldingSnapshot | null;
  lightField: LightFieldSnapshot;
  probe: ProbeSnapshot | null;
  measurements: MeasurementSnapshot[];
  selection: SelectionSnapshot | null;
  remainingSeeds: Record<SpeciesId, number | null>;
  remainingAnimals: Record<AnimalSpeciesId, number | null>;
  remainingMicrobes: Record<MicrobeGuildId, number | null>;
  remainingStructures: Record<StructureDefinitionId, number | null>;
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
  storedBiomass: number;
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
  ageSeconds: number;
}

export interface SimulationSaveData {
  version: 1;
  scenarioId: ScenarioId;
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
  waterTemperature: number;
  structures: SavedStructureState[];
  substrateCells: SavedSurfaceCellBiology[];
  seedPlacements: Array<{
    id: string;
    speciesId: SpeciesId;
    cellId: string;
    locked: boolean;
  }>;
  animals: SavedAnimalState[];
  carcasses: SavedAnimalCarcassState[];
  measurements: Array<{ id: string; kind: MeasurementKind; point: Vec2 }>;
  animalPopulationEvents: AnimalPopulationEventSnapshot[];
  animalPopulationEventTotals: AnimalPopulationEventTotals;
  animalPopulationEventSequence: number;
  totalAlgaeConsumed: number;
  animalInventoryUsed: Record<AnimalSpeciesId, number>;
  microbeInventoryUsed: Record<MicrobeGuildId, number>;
  suspendedBiofilm: BiofilmBiomass;
  biofilmSettlementCursor: number;
  materialReference: { nitrogen: number; carbon: number } | null;
  biogeochemistry: BiogeochemistrySaveState;
}

export type SimulationCommand =
  | { type: 'initialize'; scenarioId: ScenarioId }
  | { type: 'start' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'reset' }
  | { type: 'export-save'; requestId: number }
  | { type: 'load-save'; data: SimulationSaveData }
  | { type: 'set-speed'; speed: SimulationSpeed }
  | { type: 'pointer-move'; point: Vec2 }
  | { type: 'pick-structure'; definitionId: StructureDefinitionId; point?: Vec2 }
  | { type: 'pick-seed'; speciesId: SpeciesId; point?: Vec2 }
  | { type: 'pick-animal'; speciesId: AnimalSpeciesId; point?: Vec2 }
  | { type: 'pick-biofilm'; guildId: MicrobeGuildId; point?: Vec2 }
  | { type: 'pick-at'; point: Vec2 }
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
  | { type: 'set-light-output'; output: number };

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
  structures: StructureSnapshot[];
  animals: AnimalSnapshot[];
  holding: HoldingSnapshot | null;
  probe: ProbeSnapshot | null;
}

export type WorkerMessage = WorkerSnapshotMessage | WorkerMotionMessage | WorkerSaveMessage;
