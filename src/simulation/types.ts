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

export type ScenarioId = 'mission-1' | 'mission-2' | 'mission-3' | 'mission-4' | 'laboratory';
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
export type AnimalDeathCause = 'starvation' | 'old-age';
export type StructureDefinitionId = 'flat-stone' | 'round-stone' | 'tall-stone';
export type InteractionTool = 'select' | 'move' | 'light-probe' | 'temperature-probe';
export type InventoryCategory = 'structures' | 'organisms' | 'instruments';
export type SelectionFilter = 'all' | 'structure' | 'organism' | 'measurement';
export type MeasurementKind = 'light' | 'temperature';
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
 * A short-lived visual record of an animal's death. The body chemistry is
 * recorded separately; this snapshot only preserves the pose needed to draw
 * the carcass and its visual lifetime.
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
  ageSeconds: number;
  lifetimeSeconds: number;
  progress: number;
}

export interface AnimalPopulationSnapshot {
  total: number;
  adults: number;
  juveniles: number;
}

export interface BiogeochemistrySnapshot {
  effectsEnabled: false;
  potentialOxygenProduction: number;
  potentialOxygenDemand: number;
  dissolvedWasteProduced: number;
  detritusMass: number;
}

export interface HoldingSnapshot {
  kind: 'structure' | 'seed' | 'animal';
  source: 'inventory' | 'existing';
  valid: boolean;
  x: number;
  y: number;
  structureId?: string;
  structureDefinitionId?: StructureDefinitionId;
  speciesId?: SpeciesId;
  animalId?: string;
  animalSpeciesId?: AnimalSpeciesId;
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
  locationLabel: string;
  surfaceCellId?: string;
  trends: Record<SpeciesId, GrowthTrend>;
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
  unit: 'coverage' | 'habitat-coverage' | 'biomass' | 'adult-count';
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
  remainingStructures: Record<StructureDefinitionId, number | null>;
  totalBiomass: SpeciesBiomass;
  totalAlgaeConsumed: number;
  animalPopulation: Record<AnimalSpeciesId, AnimalPopulationSnapshot>;
  biogeochemistry: BiogeochemistrySnapshot;
  coverageRatio: number;
  missionProgress: MissionProgressSnapshot | null;
  message: string;
  revision: number;
}

export type SimulationCommand =
  | { type: 'initialize'; scenarioId: ScenarioId }
  | { type: 'start' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'reset' }
  | { type: 'set-speed'; speed: SimulationSpeed }
  | { type: 'pointer-move'; point: Vec2 }
  | { type: 'pick-structure'; definitionId: StructureDefinitionId; point?: Vec2 }
  | { type: 'pick-seed'; speciesId: SpeciesId; point?: Vec2 }
  | { type: 'pick-animal'; speciesId: AnimalSpeciesId; point?: Vec2 }
  | { type: 'pick-at'; point: Vec2 }
  | { type: 'select-at'; point: Vec2; filter: SelectionFilter }
  | { type: 'select-region'; from: Vec2; to: Vec2; filter: 'organism' }
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

export type WorkerMessage = WorkerSnapshotMessage | WorkerMotionMessage;
