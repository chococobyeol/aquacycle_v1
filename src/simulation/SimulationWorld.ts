import Matter, { type Body as MatterBody } from 'matter-js';
import {
  ALGAE_VISIBLE_BIOMASS,
  ANIMALS,
  SCENARIOS,
  SPECIES,
  STRUCTURES,
  type ScenarioDefinition,
} from './config';
import { BiogeochemistryLedger } from './biogeochemistry';
import { FIXED_LAMP_WIDTH, FIXED_LAMP_X, FIXED_LAMP_Y } from './lightGeometry';
import {
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
import { structureAuthoredPointToWorld } from './structureGeometry';
import {
  DEFAULT_SIMULATION_SPEED,
  normalizeSimulationSpeed,
  type SimulationSpeed,
} from './speed';
import {
  GROUND_Y,
  TANK_HEIGHT,
  TANK_WIDTH,
  WATER_TOP,
  type AnimalBehavior,
  type AnimalLifeStage,
  type AnimalSnapshot,
  type AnimalCarcassSnapshot,
  type AnimalSpeciesId,
  type HoldingSnapshot,
  type LightFieldSnapshot,
  type MeasurementKind,
  type MeasurementSnapshot,
  type MissionOutcome,
  type MissionProgressSnapshot,
  type ProbeSnapshot,
  type ScenarioId,
  type SelectionFilter,
  type SeedSnapshot,
  type SelectionSnapshot,
  type SimulationCommand,
  type SimulationPhase,
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
}

interface MeasurementState {
  id: string;
  kind: MeasurementKind;
  point: Vec2;
}

interface LightReflectionSource {
  bodyId: number;
  point: Vec2;
  strength: number;
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
  valid: boolean;
  originCellId?: string;
  originBiomass?: number;
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

type HeldState = HeldStructureState | HeldSeedState | HeldAnimalState;

const LIGHT_COLUMNS = 36;
const LIGHT_ROWS = 20;
const AREA_LIGHT_SAMPLES = 5;
const AMBIENT_SKY_SAMPLES = 7;
const DIRECT_LIGHT_HALF_ANGLE = Math.PI * 0.49;
// Moving the physical source above the tank increases every ray distance.
// This calibrated scale preserves the existing mission light bands while the
// source geometry now truthfully lives outside the glass.
const DIRECT_LIGHT_SCALE = 2.85;
const REFLECTED_LIGHT_LIMIT = 6;
// Full snapshots clone the fixed ecology and light grids. Five publishes per
// second keeps HUD values responsive while motion is delivered separately at
// a higher rate by the worker.
const SNAPSHOT_INTERVAL_SECONDS = 0.2;
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
const PICK_SEED_DISTANCE = 18;
const PICK_ANIMAL_DISTANCE = 28;
const SHRIMP_ADULT_LENGTH = 36;
const SHRIMP_JUVENILE_LENGTH = 14;
const SHRIMP_MATURITY_SECONDS = 180;
// Two real-world months are compressed to the 180-second maturation period.
// Keeping the same scale maps the observed 10–15 month life span to 15–22.5
// simulation minutes. A deterministic per-animal value prevents cohort-wide
// deaths while keeping replay results reproducible.
const SHRIMP_MIN_LIFESPAN_SECONDS = 900;
const SHRIMP_MAX_LIFESPAN_SECONDS = 1350;
const SHRIMP_BASE_METABOLISM = 0.005;
const SHRIMP_WEAK_ENERGY = 0.18;
const SHRIMP_FORAGE_START_ENERGY = 0.48;
const SHRIMP_FORAGE_STOP_ENERGY = 0.7;
// Grazing must remove enough visible algae for consumers to affect the tank.
// The lower energy conversion keeps the energy gained per second near the
// earlier tuning while making the removed biomass truthful. At the measured
// sustained intake (~0.13 biomass/s), 0.08 leaves enough reserve above adult
// grazing metabolism for genuinely food-rich tanks to support reproduction;
// sparse/overgrazed tanks still fall below this intake and lose population.
const SHRIMP_BITE_RATE = 0.375;
const SHRIMP_ENERGY_PER_BIOMASS = 0.08;
const SHRIMP_GRAZE_DISTANCE = 15;
// Below this density the film is too sparse to be a useful grazing target.
// Using one threshold for detection, retargeting, and actual removal prevents
// shrimp from spending their energy on visible-but-nonnourishing specks.
const SHRIMP_EDIBLE_BIOMASS = 0.04;
const SHRIMP_GRAZING_HALF_SATURATION = 0.02;
const SHRIMP_LOCAL_FOOD_RADIUS = 64;
const SHRIMP_EMERGENCY_FOOD_RADIUS = 520;
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
const SHRIMP_REPRODUCTION_ENERGY = 0.46;
const SHRIMP_INITIAL_REPRODUCTION_COOLDOWN = 80;
const SHRIMP_NEW_ADULT_REPRODUCTION_COOLDOWN = 120;
const SHRIMP_MATING_SECONDS = 3;
const SHRIMP_GESTATION_SECONDS = 75;
const SHRIMP_POST_BROOD_COOLDOWN = 160;
const SHRIMP_MALE_POST_MATING_COOLDOWN = 45;
const SHRIMP_CARCASS_LIFETIME_SECONDS = 55;
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
  private totalAlgaeConsumed = 0;
  private animalInventoryUsed: Record<AnimalSpeciesId, number> = { 'cherry-shrimp': 0 };
  private biogeochemistry = new BiogeochemistryLedger();
  private lightOutput = 90;
  private waterTemperature = 23.5;
  private lightDirty = true;
  private crossConnectionsDirty = true;
  private lightRevision = 0;
  private lightField: LightFieldSnapshot = {
    columns: LIGHT_COLUMNS,
    rows: LIGHT_ROWS,
    values: Array.from({ length: LIGHT_COLUMNS * LIGHT_ROWS }, () => 0),
    revision: 0,
  };
  private lightReflectionSources: LightReflectionSource[] = [];
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
    this.totalAlgaeConsumed = 0;
    this.animalInventoryUsed = { 'cherry-shrimp': 0 };
    this.biogeochemistry = new BiogeochemistryLedger();
    this.lightOutput = this.scenario.lightOutput;
    this.waterTemperature = 22 + this.lightOutput * 0.018;
    this.lightDirty = true;
    this.lightReflectionSources = [];
    this.crossConnectionsDirty = true;
    this.message = '목록에서 구조물과 생물을 꺼내 수조를 구성하세요.';

    this.boundaries = [
      Bodies.rectangle(TANK_WIDTH / 2, GROUND_Y + 58, TANK_WIDTH + 120, 116, {
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
      case 'pick-at':
        this.pickExistingAt(command.point);
        break;
      case 'select-at':
        this.selectAt(command.point, command.filter);
        break;
      case 'select-region':
        this.selectRegion(command.from, command.to);
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
          this.lightOutput = clamp(command.output, 30, 120);
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
          this.stepTemperature(growthStepSeconds);
          this.stepGrowth(growthStepSeconds);
          this.stepBiogeochemistry(growthStepSeconds);
          this.stepAnimalEcology(growthStepSeconds);
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
      this.snapshotAccumulator = 0;
      return true;
    }
    return false;
  }

  public snapshot(): SimulationSnapshot {
    const cells = this.surfaceSnapshots();
    const eligibleCells = cells.filter((cell) => cell.targetEligible);
    const totalBiomass = cells.reduce<SpeciesBiomass>(
      (total, cell) => ({
        oedogonium: total.oedogonium + cell.biomass.oedogonium,
        nitzschia: total.nitzschia + cell.biomass.nitzschia,
      }),
      emptyBiomass(),
    );
    const coverageRatio = eligibleCells.length
      ? eligibleCells.filter((cell) => occupied(cell.biomass)).length / eligibleCells.length
      : 0;

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
      waterTemperature: this.waterTemperature,
      structures: this.structureSnapshots(),
      cells,
      seeds: this.seedSnapshots(),
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
      },
      remainingAnimals: {
        'cherry-shrimp': this.remainingAnimals('cherry-shrimp'),
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
      biogeochemistry: this.biogeochemistry.snapshot(),
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
  } {
    return {
      structures: this.structureSnapshots(),
      animals: this.animalSnapshots(),
      holding: this.holdingSnapshot(),
      probe: this.probe ? { ...this.probe, trends: { ...this.probe.trends } } : null,
    };
  }

  public hasActiveMotion(): boolean {
    return Boolean(this.held) || (this.phase === 'running' && this.animals.length > 0) || this.structures.some(
      ({ body }) => !body.isStatic && !body.isSleeping,
    );
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

    const id = `structure-${++this.structureCounter}`;
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
        localNeighborIds: cell.neighborIndices.map((neighbor) => cellIds[neighbor]),
        neighborIds: cell.neighborIndices.map((neighbor) => cellIds[neighbor]),
      })),
    };
    this.structures.push(structure);
    Composite.add(this.engine.world, body);
    this.crossConnectionsDirty = true;
    this.lightDirty = true;
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
      valid: false,
    };
    this.updateHeldSeedCandidate(this.pointer);
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

  private pickExistingAt(point: Vec2): void {
    if (!this.canEdit() || this.held) return;
    this.pointer = this.clampPointer(point);

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
          valid: true,
          originCellId: placement.cellId,
          originBiomass,
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
    const originPosition = { ...structure.body.position };
    const originAngle = structure.body.angle;
    const originSleeping = structure.body.isSleeping;
    Body.setStatic(structure.body, true);
    this.held = {
      kind: 'structure',
      source: 'existing',
      structureId: structure.id,
      offset: {
        x: structure.body.position.x - this.pointer.x,
        y: structure.body.position.y - this.pointer.y,
      },
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
    this.allSettled = false;
    this.message = `${STRUCTURES[structure.definitionId].label}을 옮기는 중입니다. 다시 클릭하면 놓습니다.`;
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
      const nearest = this.nearestCell(exact);
      if (nearest && nearest.distance <= Math.max(13, nearest.cell.cellSize * 1.55)) {
        const biomass = nearest.cell.biomass;
        const speciesIds = (Object.keys(biomass) as SpeciesId[])
          .filter((speciesId) => biomass[speciesId] > ALGAE_VISIBLE_BIOMASS);
        if (speciesIds.length) {
          const speciesId = [...speciesIds]
            .sort((a, b) => biomass[b] - biomass[a])[0];
          const location = this.cellWorldPoint(nearest.cell);
          this.selection = {
            kind: 'colony',
            ...location,
            ownerLabel: nearest.cell.ownerLabel,
            cellId: nearest.cell.id,
            speciesId,
            speciesIds,
          };
          this.message = `${SPECIES[speciesId].shortName} 군락을 선택했습니다.`;
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

  private selectRegion(from: Vec2, to: Vec2): void {
    const start = this.clampPointer(from);
    const end = this.clampPointer(to);
    const bounds = {
      minX: Math.min(start.x, end.x),
      minY: Math.min(start.y, end.y),
      maxX: Math.max(start.x, end.x),
      maxY: Math.max(start.y, end.y),
    };
    const cells = this.allCells().filter((cell) => {
      const point = this.cellWorldPoint(cell);
      const biomass = cell.biomass.oedogonium + cell.biomass.nitzschia;
      return biomass > ALGAE_VISIBLE_BIOMASS &&
        point.x >= bounds.minX && point.x <= bounds.maxX &&
        point.y >= bounds.minY && point.y <= bounds.maxY;
    });
    const animals = this.animals.filter((animal) =>
      animal.position.x >= bounds.minX && animal.position.x <= bounds.maxX &&
      animal.position.y >= bounds.minY && animal.position.y <= bounds.maxY,
    );
    if (!cells.length && !animals.length) {
      this.clearSelectionWithMessage('선택 영역 안에 보이는 생물이 없습니다.');
      return;
    }
    const totals = cells.reduce<SpeciesBiomass>((sum, cell) => ({
      oedogonium: sum.oedogonium + cell.biomass.oedogonium,
      nitzschia: sum.nitzschia + cell.biomass.nitzschia,
    }), emptyBiomass());
    const speciesIds = (Object.keys(totals) as SpeciesId[])
      .filter((speciesId) => totals[speciesId] > ALGAE_VISIBLE_BIOMASS);
    const speciesId = [...speciesIds].sort((a, b) => totals[b] - totals[a])[0];
    this.selection = {
      kind: 'region',
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2,
      ownerLabel: animals.length
        ? `선택 영역 · 새우 ${animals.length}마리${cells.length ? ` · 군락 ${cells.length}곳` : ''}`
        : `선택 영역 · 군락 관찰점 ${cells.length}개`,
      speciesId,
      speciesIds,
      animalIds: animals.map((animal) => animal.id),
      bounds,
    };
    this.message = animals.length
      ? `영역 안의 새우 ${animals.length}마리${cells.length ? `와 군락 ${cells.length}곳` : ''}을 선택했습니다.`
      : `영역 안의 군락 관찰점 ${cells.length}개를 선택했습니다.`;
  }

  private selectMeasurement(id: string): void {
    const measurement = this.measurements.find((item) => item.id === id);
    if (!measurement) return;
    this.selection = {
      kind: 'measurement',
      ...measurement.point,
      ownerLabel: measurement.kind === 'light' ? '광량 측정점' : '수온 측정점',
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
    } else {
      this.held.position = this.clampAnimalPoint(this.pointer);
      this.held.valid = this.isAnimalPlacementPoint(this.held.position);
    }
  }

  private dropHeld(point: Vec2): void {
    if (!this.held || !this.canEdit()) return;
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
      }
      this.held = null;
      this.message = `${ANIMALS[restored.speciesId].displayName}를 수조에 놓았습니다.`;
      this.snapshotDirty = true;
      return;
    }

    const heldSeed = this.held;
    const cellId = heldSeed.candidateCellId;
    const cell = cellId ? this.cellById(cellId) : undefined;
    if (!cell || !cellId) return;
    cell.biomass[heldSeed.speciesId] = Math.max(cell.biomass[heldSeed.speciesId], SEED_BIOMASS);
    this.seedPlacements.push({
      id: heldSeed.seedId,
      speciesId: heldSeed.speciesId,
      cellId,
      locked: false,
    });
    this.held = null;
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
    } else if (this.held.source === 'existing' && this.held.originCellId) {
      const origin = this.cellById(this.held.originCellId);
      if (origin) origin.biomass[this.held.speciesId] = this.held.originBiomass ?? SEED_BIOMASS;
      this.seedPlacements.push({
        id: this.held.seedId,
        speciesId: this.held.speciesId,
        cellId: this.held.originCellId,
        locked: false,
      });
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

  private constrainHeldStructure(structure: StructureState): void {
    const padding = 5;
    const bounds = structure.body.bounds;
    let dx = 0;
    let dy = 0;
    if (bounds.min.x < padding) dx = padding - bounds.min.x;
    if (bounds.max.x > TANK_WIDTH - padding) dx = TANK_WIDTH - padding - bounds.max.x;
    if (bounds.min.y < WATER_TOP + padding) dy = WATER_TOP + padding - bounds.min.y;
    if (bounds.max.y > GROUND_Y - padding) dy = GROUND_Y - padding - bounds.max.y;
    if (dx || dy) Body.translate(structure.body, { x: dx, y: dy });
  }

  private updateHeldStructureValidity(structure: StructureState): void {
    if (!this.held || this.held.kind !== 'structure') return;
    const bounds = structure.body.bounds;
    const inTank =
      bounds.min.x >= 2 &&
      bounds.max.x <= TANK_WIDTH - 2 &&
      bounds.min.y >= WATER_TOP + 2 &&
      bounds.max.y <= GROUND_Y - 2;
    const collisions = Query.collides(
      structure.body,
      this.structures.filter((item) => item.id !== structure.id).map((item) => item.body),
    );
    this.held.valid = inTank && collisions.every((collision) => collision.depth < 3.5);
  }

  private updateHeldSeedCandidate(point: Vec2): void {
    if (!this.held || this.held.kind !== 'seed') return;
    const held = this.held;
    const nearest = this.nearestCell(point);
    const validDistance = nearest
      ? Math.max(8, nearest.cell.cellSize * 0.9)
      : 0;
    const candidateCellId = nearest && nearest.distance <= validDistance ? nearest.cell.id : null;
    const duplicate = candidateCellId
      ? this.seedPlacements.some((placement) =>
        placement.cellId === candidateCellId && placement.speciesId === held.speciesId,
      )
      : false;
    held.candidateCellId = candidateCellId;
    held.valid = Boolean(candidateCellId) && !duplicate;
  }

  private canEdit(): boolean {
    if (this.phase === 'setup') return true;
    return this.scenario.mode === 'laboratory' && this.phase === 'paused';
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
        ? '붓뚜껑말을 원하는 표면에 접종해 주세요.'
        : '필수 조류를 점수에 포함되는 구조물 앞면에 접종해 주세요.';
      return;
    }
    this.sleepStructures();
    if (this.crossConnectionsDirty) this.rebuildCrossConnections();
    if (this.lightDirty) this.recomputeLight();
    this.phase = 'running';
    this.hasStarted = true;
    this.message = '배치가 잠겼습니다. 군락과 개체군의 변화를 관찰하세요.';
  }

  private pause(): void {
    if (this.phase !== 'running') return;
    this.phase = 'paused';
    this.message = this.scenario.mode === 'laboratory'
      ? '일시정지됨 · 구조물과 새 접종체를 편집할 수 있습니다.'
      : '일시정지됨 · 도전 중 배치는 계속 잠겨 있습니다.';
  }

  private resume(): void {
    if (this.phase !== 'paused') return;
    if (this.scenario.mode === 'laboratory' && (this.held || !this.allSettled)) {
      this.message = '들고 있는 항목을 놓고 모든 구조물이 안착해야 재개할 수 있습니다.';
      return;
    }
    this.sleepStructures();
    if (this.crossConnectionsDirty) this.rebuildCrossConnections();
    if (this.lightDirty) this.recomputeLight();
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
      if (settlementChanged) this.snapshotDirty = true;
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
    const placed = this.seedPlacements.filter((placement) => placement.speciesId === speciesId).length;
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
    const light = onSurface ? onSurface.cell.light : this.lightAt(exact);
    return {
      ...exact,
      light,
      temperature: this.waterTemperature,
      locationLabel: onSurface
        ? onSurface.cell.surfaceKind === 'substrate'
          ? '바닥재 표면'
          : `${onSurface.cell.ownerLabel} 앞면`
        : '수중',
      surfaceCellId: onSurface?.cell.id,
      trends: {
        oedogonium: growthTrend('oedogonium', light, this.waterTemperature),
        nitzschia: growthTrend('nitzschia', light, this.waterTemperature),
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

  private recomputeLight(): void {
    this.lightReflectionSources = this.buildLightReflectionSources();
    const values: number[] = [];
    for (let row = 0; row < LIGHT_ROWS; row += 1) {
      for (let column = 0; column < LIGHT_COLUMNS; column += 1) {
        values.push(this.lightAt({
          x: ((column + 0.5) / LIGHT_COLUMNS) * TANK_WIDTH,
          y: WATER_TOP + ((row + 0.5) / LIGHT_ROWS) * (GROUND_Y - WATER_TOP),
        }));
      }
    }
    this.lightRevision += 1;
    this.lightField = {
      columns: LIGHT_COLUMNS,
      rows: LIGHT_ROWS,
      values,
      revision: this.lightRevision,
    };

    for (const cell of this.allCells()) {
      const ownerBodyId = cell.surfaceKind === 'structure-face'
        ? this.structureById(cell.ownerId)?.body.id
        : undefined;
      cell.light = this.lightAt(this.cellWorldPoint(cell), ownerBodyId);
    }
    if (this.probe) this.setProbe(this.probe);
    this.lightDirty = false;
    this.snapshotDirty = true;
  }

  private directLightAt(point: Vec2, occluders: MatterBody[]): number {
    let direct = 0;
    for (let index = 0; index < AREA_LIGHT_SAMPLES; index += 1) {
      const ratio = index / (AREA_LIGHT_SAMPLES - 1);
      const lampPoint = {
        x: FIXED_LAMP_X - FIXED_LAMP_WIDTH / 2 + ratio * FIXED_LAMP_WIDTH,
        y: FIXED_LAMP_Y,
      };
      const dx = point.x - lampPoint.x;
      const dy = Math.max(1, point.y - lampPoint.y);
      const distance = Math.hypot(dx, dy);
      const angle = Math.abs(Math.atan2(dx, dy));
      const cone = Math.pow(clamp(1 - angle / DIRECT_LIGHT_HALF_ANGLE, 0, 1), 1.48);
      const distanceFalloff = 1 / (1 + Math.pow(distance / 470, 1.35));
      const depth = Math.max(0, point.y - WATER_TOP);
      const waterAttenuation = Math.exp(-depth * 0.00072);
      const visible = Query.ray(occluders, lampPoint, point, 1.1).length === 0 ? 1 : 0;
      direct += this.lightOutput * DIRECT_LIGHT_SCALE * cone * distanceFalloff * waterAttenuation * visible;
    }
    return direct / AREA_LIGHT_SAMPLES;
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
      return {
        bodyId: structure.body.id,
        point: reflectionPoint,
        strength: clamp(this.directLightAt(reflectionPoint, blockers) * 0.065, 0, REFLECTED_LIGHT_LIMIT),
      };
    }).filter((source) => source.strength >= 0.08);
  }

  private reflectedLightAt(point: Vec2, excludedBodyId: number | undefined, occluders: MatterBody[]): number {
    let reflected = 0;
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
      const contribution = source.strength * facing * distanceFalloff * localFade;
      if (contribution < 0.04) continue;
      const blockers = occluders.filter((body) => body.id !== source.bodyId);
      const visible = Query.ray(blockers, source.point, point, 1).length === 0 ? 1 : 0;
      reflected += contribution * visible;
      if (reflected >= REFLECTED_LIGHT_LIMIT) return REFLECTED_LIGHT_LIMIT;
    }
    return reflected;
  }

  private lightAt(point: Vec2, excludedBodyId?: number): number {
    const occluders = this.structures
      .filter((structure) => structure.body.id !== excludedBodyId && !this.isHeldStructure(structure.id))
      .map((structure) => structure.body);
    const direct = this.directLightAt(point, occluders);
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
    const ambient =
      (1.1 + this.lightOutput * 0.03) *
      (0.35 + skyExposure * 0.65) *
      Math.exp(-depth * 0.00062);
    const reflected = this.reflectedLightAt(point, excludedBodyId, occluders);
    return clamp(ambient + direct + reflected, 0, 100);
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
        animal.behavior === 'grazing' || animal.behavior === 'starving';
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
          targetFood < SHRIMP_EDIBLE_BIOMASS)
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
        (seeking && targetFood < SHRIMP_EDIBLE_BIOMASS && currentTargetDistance <= 24)
      ) {
        const foodTarget = seeking ? this.chooseFoodTarget(animal) : null;
        const retainExplorationTarget = Boolean(
          seeking && currentTarget &&
          targetFood < SHRIMP_EDIBLE_BIOMASS && currentTargetDistance > 24,
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
      const hasFood = this.edibleBiomass(target) >= SHRIMP_EDIBLE_BIOMASS;
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

  private stepBiogeochemistry(deltaSeconds: number): void {
    this.biogeochemistry.beginStep();
    for (const cell of this.allCells()) {
      this.biogeochemistry.recordAlgae(
        this.cellWorldPoint(cell),
        cell.biomass,
        cell.light,
        deltaSeconds,
      );
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
    const metabolismRecorded = new Set<string>();

    for (const animal of this.animals) {
      animal.ageSeconds += deltaSeconds;
      animal.reproductionCooldown = Math.max(0, animal.reproductionCooldown - deltaSeconds);
      animal.recentIntake *= Math.exp(-deltaSeconds / 8);
      animal.secondsSinceFood += deltaSeconds;

      const stageScale = animal.lifeStage === 'adult' ? 1 : 0.58;
      const activityCost = animal.behavior === 'traveling'
        ? 0.0018
        : animal.behavior === 'grazing' || animal.behavior === 'exploring'
          ? 0.0008
          : 0.0002;
      const baseCost = animal.lifeStage === 'adult' ? SHRIMP_BASE_METABOLISM : 0.003;
      animal.energy = Math.max(0, animal.energy - (baseCost + activityCost) * deltaSeconds);

      const target = animal.targetCellId ? this.cellById(animal.targetCellId) : undefined;
      if (target && animal.behavior === 'grazing') {
        const targetPoint = this.cellWorldPoint(target);
        const distance = Math.sqrt(distanceSquared(animal.position, targetPoint));
        const food = this.edibleBiomass(target);
        if (
          food >= SHRIMP_EDIBLE_BIOMASS &&
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
        request.animal.energy = clamp01(
          request.animal.energy + consumed * SHRIMP_ENERGY_PER_BIOMASS,
        );
        request.animal.recentIntake += consumed;
        request.animal.consumedBiomass += consumed;
        request.animal.grazingSessionIntake += consumed;
        this.totalAlgaeConsumed += consumed;
        request.animal.secondsSinceFood = 0;
        this.biogeochemistry.recordAnimalMetabolism(
          request.animal.position,
          request.animal.lifeStage === 'adult' ? 1 : 0.58,
          consumed,
          deltaSeconds,
        );
        metabolismRecorded.add(request.animal.id);
      }
      cell.biomass.nitzschia = Math.max(0, cell.biomass.nitzschia - consumedNitzschia);
      cell.biomass.oedogonium = Math.max(0, cell.biomass.oedogonium - consumedOedogonium);
      if (cell.biomass.nitzschia < 0.0005) cell.biomass.nitzschia = 0;
      if (cell.biomass.oedogonium < 0.0005) cell.biomass.oedogonium = 0;
    }

    const newborns: AnimalState[] = [];
    const living: AnimalState[] = [];
    for (const animal of this.animals) {
      if (!metabolismRecorded.has(animal.id)) {
        this.biogeochemistry.recordAnimalMetabolism(
          animal.position,
          animal.lifeStage === 'adult' ? 1 : 0.58,
          0,
          deltaSeconds,
        );
      }

      if (animal.ageSeconds >= animal.lifespanSeconds) {
        this.killAnimal(animal, 'old-age');
        continue;
      }

      if (animal.lifeStage === 'juvenile') {
        if (animal.energy >= 0.44 && animal.secondsSinceFood < 12) {
          animal.growthProgress = Math.min(1, animal.growthProgress + deltaSeconds / SHRIMP_MATURITY_SECONDS);
        }
        animal.bodyLength = SHRIMP_JUVENILE_LENGTH +
          (SHRIMP_ADULT_LENGTH - SHRIMP_JUVENILE_LENGTH) * animal.growthProgress;
        if (animal.ageSeconds >= SHRIMP_MATURITY_SECONDS && animal.growthProgress >= 1) {
          animal.lifeStage = 'adult';
          animal.bodyLength = SHRIMP_ADULT_LENGTH;
          animal.reproductionCooldown = SHRIMP_NEW_ADULT_REPRODUCTION_COOLDOWN;
        }
      }

      if (animal.lifeStage === 'adult' && animal.sex === 'female') {
        if (animal.gestationRemaining !== null) {
          // Embryo development pauses when the mother is no longer feeding;
          // it resumes after she recovers instead of producing young from
          // depleted reserves.
          const gestationCanAdvance = animal.energy >= 0.42 && animal.secondsSinceFood <= 20;
          if (gestationCanAdvance) animal.gestationRemaining -= deltaSeconds;
          if (animal.gestationRemaining <= 0) {
            const desiredClutchSize = 1 + Math.floor(deterministicNoise(
              animal.randomSeed + animal.ageSeconds * 0.31,
            ) * 2);
            const availableSlots = Math.max(
              0,
              SHRIMP_TECHNICAL_POPULATION_LIMIT - this.animals.length - newborns.length,
            );
            const clutchSize = Math.min(desiredClutchSize, availableSlots);
            if (clutchSize > 0) {
              for (let index = 0; index < clutchSize; index += 1) {
                newborns.push(this.createJuvenileAnimalState(animal, index));
              }
              animal.gestationRemaining = null;
              animal.reproductionCooldown = SHRIMP_POST_BROOD_COOLDOWN;
              animal.energy = Math.max(0, animal.energy - 0.1);
            } else {
              // The technical safety guard should be unreachable in normal
              // ecology. If an extreme/corrupted run reaches it, keep the clutch
              // pending instead of charging the mother for a zero-offspring birth.
              animal.gestationRemaining = 0;
            }
          }
        } else if (
          animal.reproductionCooldown <= 0 &&
          animal.energy >= SHRIMP_REPRODUCTION_ENERGY &&
          animal.secondsSinceFood < 8 &&
          this.animals.length + newborns.length < SHRIMP_TECHNICAL_POPULATION_LIMIT
        ) {
          const eligibleMale = this.animals.find((candidate) =>
            candidate.id !== animal.id &&
            candidate.lifeStage === 'adult' &&
            candidate.sex === 'male' &&
            candidate.energy >= 0.45 &&
            candidate.secondsSinceFood < 8 &&
            candidate.reproductionCooldown <= 0,
          );
          animal.matingAccumulator = eligibleMale
            ? animal.matingAccumulator + deltaSeconds
            : Math.max(0, animal.matingAccumulator - deltaSeconds);
          if (animal.matingAccumulator >= SHRIMP_MATING_SECONDS) {
            animal.gestationRemaining = SHRIMP_GESTATION_SECONDS;
            animal.matingAccumulator = 0;
            animal.energy = Math.max(0, animal.energy - 0.05);
            if (eligibleMale) {
              eligibleMale.reproductionCooldown = SHRIMP_MALE_POST_MATING_COOLDOWN;
            }
          }
        } else {
          animal.matingAccumulator = Math.max(0, animal.matingAccumulator - deltaSeconds);
        }
      }

      animal.health = clamp01(animal.energy / SHRIMP_WEAK_ENERGY);
      if (animal.energy <= 0) {
        this.killAnimal(animal, 'starvation');
        continue;
      }
      living.push(animal);
    }
    this.animals = [...living, ...newborns];
    this.snapshotDirty = true;
  }

  private killAnimal(animal: AnimalState, cause: AnimalCarcassSnapshot['cause']): void {
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
      ageSeconds: 0,
    });
    this.biogeochemistry.recordDeath(
      animal.position,
      animal.lifeStage === 'adult' ? 1 : Math.max(0.18, animal.growthProgress * 0.58),
    );
    if (this.selection?.kind === 'animal' && this.selection.animalId === animal.id) {
      this.selection = null;
    }
  }

  private edibleBiomass(cell: SurfaceCellState): number {
    return cell.biomass.nitzschia + cell.biomass.oedogonium * 0.72;
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
      if (food < SHRIMP_EDIBLE_BIOMASS) continue;
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
      // surface instead of steering toward the globally densest colony. Only a
      // severely hungry shrimp gets the wider emergency detection radius.
      const score = -distance - congestion * 20 + targetCommitment + noise;
      if (!best || score > best.score) best = { cell, score };
    }
    return best?.cell ?? null;
  }

  private chooseExplorationTarget(animal: AnimalState): SurfaceCellState | null {
    const cells = this.allCells();
    if (!cells.length) return null;
    const phase = Math.floor(animal.ageSeconds / 4.5);
    let best: { cell: SurfaceCellState; score: number } | null = null;
    const samples = Math.min(48, cells.length);
    for (let index = 0; index < samples; index += 1) {
      const sampleIndex = Math.floor(deterministicNoise(
        animal.randomSeed + phase * 19 + index * 7.3,
      ) * cells.length);
      const cell = cells[sampleIndex];
      const point = this.cellWorldPoint(cell);
      const distance = Math.sqrt(distanceSquared(animal.position, point));
      const preferredDistance = Math.abs(distance - 150);
      const foodPenalty = Math.min(90, this.edibleBiomass(cell) * 120);
      const score = -preferredDistance - foodPenalty - (point.y < WATER_TOP + 80 ? 120 : 0);
      if (!best || score > best.score) best = { cell, score };
    }
    return best?.cell ?? cells[0];
  }

  private stepGrowth(deltaSeconds: number): void {
    const cells = this.allCells();
    const byId = new Map(cells.map((cell) => [cell.id, cell]));
    const original = new Map(cells.map((cell) => [cell.id, cloneBiomass(cell.biomass)]));
    const next = new Map<string, SpeciesBiomass>();

    for (const cell of cells) {
      const current = original.get(cell.id)!;
      const total = current.oedogonium + current.nitzschia;
      const freeCapacity = clamp01(1 - total);
      const rates: SpeciesBiomass = {
        oedogonium: netGrowthPotential('oedogonium', cell.light, this.waterTemperature),
        nitzschia: netGrowthPotential('nitzschia', cell.light, this.waterTemperature),
      };
      const weightedAverage = total > 0
        ? (
          current.oedogonium * rates.oedogonium +
          current.nitzschia * rates.nitzschia
        ) / total
        : 0;
      const result = emptyBiomass();
      for (const speciesId of this.scenario.allowedSpecies) {
        const amount = current[speciesId];
        if (amount <= 0) continue;
        const rate = rates[speciesId];
        const expansion = amount * rate * (rate > 0 ? freeCapacity : 1) * deltaSeconds;
        const replacement = total > 0.04
          ? amount * (rate - weightedAverage) * total * 1.35 * deltaSeconds
          : 0;
        const naturalTurnover = amount * 0.0018 * deltaSeconds;
        result[speciesId] = Math.max(0, amount + expansion + replacement - naturalTurnover);
      }

      // A developed filamentous canopy shades the low-profile diatom film below it.
      if (current.oedogonium > 0.24 && rates.oedogonium > rates.nitzschia) {
        result.nitzschia = Math.max(
          0,
          result.nitzschia - current.nitzschia * current.oedogonium * 0.018 * deltaSeconds,
        );
      }
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
        const receiverTotal = receiver.oedogonium + receiver.nitzschia;
        const freeCapacity = clamp01(1 - receiverTotal);
        if (freeCapacity <= 0.0001) continue;
        for (const speciesId of this.scenario.allowedSpecies) {
          if (source[speciesId] < 0.012) continue;
          const suitability = habitatSuitability(
            speciesId,
            neighbor.light,
            this.waterTemperature,
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
      const freeCapacity = clamp01(1 - receiver.oedogonium - receiver.nitzschia);
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
      const total = result.oedogonium + result.nitzschia;
      if (total > 1) {
        result.oedogonium /= total;
        result.nitzschia /= total;
      }
      cell.biomass = {
        oedogonium: clamp01(result.oedogonium),
        nitzschia: clamp01(result.nitzschia),
      };
    }
  }

  private stepTemperature(deltaSeconds: number): void {
    const ambientTemperature = 22;
    const lampHeating = 1.2 + (this.lightOutput / 120) * 1.8;
    const targetTemperature = ambientTemperature + lampHeating;
    const response = 1 - Math.exp(-deltaSeconds / 55);
    this.waterTemperature += (targetTemperature - this.waterTemperature) * response;
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

  private structureSnapshots(): StructureSnapshot[] {
    return this.structures.map((structure) => {
      const definition = STRUCTURES[structure.definitionId];
      const isHeld = this.isHeldStructure(structure.id);
      return {
        id: structure.id,
        definitionId: structure.definitionId,
        label: definition.label,
        assetPath: definition.assetPath,
        x: structure.body.position.x,
        y: structure.body.position.y,
        angle: structure.body.angle,
        width: definition.width,
        height: definition.height,
        locked: structure.locked,
        isSleeping: structure.body.isSleeping,
        isHeld,
        placementValid: isHeld && this.held?.kind === 'structure' ? this.held.valid : true,
      };
    });
  }

  private animalSnapshots(): AnimalSnapshot[] {
    if (this.selection?.kind === 'animal' && this.selection.animalId) {
      const selected = this.animals.find((animal) => animal.id === this.selection?.animalId);
      if (selected) {
        this.selection.x = selected.position.x;
        this.selection.y = selected.position.y;
      }
    }
    return this.animals.map((animal) => ({
      id: animal.id,
      speciesId: animal.speciesId,
      x: animal.position.x,
      y: animal.position.y,
      vx: animal.velocity.x,
      vy: animal.velocity.y,
      facing: animal.facing,
      poseAngle: animal.poseAngle,
      bodyLength: animal.bodyLength,
      lifeStage: animal.lifeStage,
      sex: animal.sex,
      ageSeconds: animal.ageSeconds,
      lifespanSeconds: animal.lifespanSeconds,
      energy: animal.energy,
      health: animal.health,
      behavior: this.held?.kind === 'animal' && this.held.animalId === animal.id
        ? 'held'
        : animal.behavior,
      reproductiveState: animal.gestationRemaining !== null
        ? 'berried'
        : animal.lifeStage === 'adult' &&
          animal.reproductionCooldown <= 0 &&
          animal.energy >= SHRIMP_REPRODUCTION_ENERGY &&
          animal.secondsSinceFood < 8 &&
          this.animals.length < SHRIMP_TECHNICAL_POPULATION_LIMIT
          ? 'ready'
          : 'none',
      recentIntake: animal.recentIntake,
      consumedBiomass: animal.consumedBiomass,
    }));
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
      ageSeconds: carcass.ageSeconds,
      lifetimeSeconds: SHRIMP_CARCASS_LIFETIME_SECONDS,
      progress: clamp01(carcass.ageSeconds / SHRIMP_CARCASS_LIFETIME_SECONDS),
    }));
  }

  private animalPopulation(speciesId: AnimalSpeciesId): {
    total: number;
    adults: number;
    juveniles: number;
  } {
    const animals = this.animals.filter((animal) => animal.speciesId === speciesId);
    const adults = animals.filter((animal) => animal.lifeStage === 'adult').length;
    return {
      total: animals.length,
      adults,
      juveniles: animals.length - adults,
    };
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
        biomass: cloneBiomass(cell.biomass),
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
      const point = this.cellWorldPoint(cell);
      return [{ ...placement, x: point.x, y: point.y }];
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
    const candidate = this.held.candidateCellId ? this.cellById(this.held.candidateCellId) : undefined;
    const point = candidate ? this.cellWorldPoint(candidate) : this.pointer;
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
      ageSeconds: 180 + numericId * 7,
      lifespanSeconds: SHRIMP_MIN_LIFESPAN_SECONDS +
        deterministicNoise(numericId * 29.73) *
        (SHRIMP_MAX_LIFESPAN_SECONDS - SHRIMP_MIN_LIFESPAN_SECONDS),
      energy: 0.52 + ((numericId - 1) % 4) * 0.01,
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
      reproductionCooldown: SHRIMP_INITIAL_REPRODUCTION_COOLDOWN,
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

  private nearestCell(point: Vec2): { cell: SurfaceCellState; distance: number } | null {
    let nearest: { cell: SurfaceCellState; distance: number } | null = null;
    for (const cell of this.allCells()) {
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
      const distance = Math.sqrt(distanceSquared(point, this.cellWorldPoint(cell)));
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
