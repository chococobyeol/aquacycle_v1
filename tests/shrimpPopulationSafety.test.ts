import { describe, expect, it } from 'vitest';
import {
  SHRIMP_TECHNICAL_POPULATION_LIMIT,
  SimulationWorld,
} from '../src/simulation/SimulationWorld';
import { BiogeochemistryLedger } from '../src/simulation/biogeochemistry';
import {
  SHRIMP_ECOLOGY_RULES,
  WATER_CYCLE_RULES,
} from '../src/simulation/config';
import {
  GROUND_Y,
  TANK_WIDTH,
  WATER_TOP,
  type AnimalSpeciesId,
  type Vec2,
} from '../src/simulation/types';

const SHRIMP = 'cherry-shrimp' as const;

interface ReproductionAnimalState {
  id: string;
  speciesId: AnimalSpeciesId;
  position: Vec2;
  velocity: Vec2;
  facing: -1 | 1;
  targetAnimalId: string | null;
  targetCellId: string | null;
  behavior: string;
  behaviorTimer: number;
  nextTargetEvaluation: number;
  lifeStage: 'juvenile' | 'adult' | 'egg';
  grazingSessionIntake: number;
  grazingSessionSeconds?: number;
  recentGrazingCellId?: string | null;
  recentGrazingCellCooldown?: number;
  sex: 'female' | 'male';
  energy: number;
  recentIntake: number;
  structuralBiomass: number;
  peakStructuralBiomass?: number;
  storedBiomass: number;
  reproductiveBiomass: number;
  secondsSinceFood: number;
  reproductionCooldown: number;
  ovarianProgress: number;
  reproductiveCycleIndex: number;
  gestationRemaining: number | null;
  matingAccumulator: number;
}

interface ReproductionWorldInternals {
  animals: ReproductionAnimalState[];
  stepAnimalEcology(deltaSeconds: number): void;
  stepAnimalMotion(deltaSeconds: number): void;
  rebuildShrimpMotionBuckets(): void;
  shrimpMotionBucketsScratch: ReproductionAnimalState[][];
  shrimpMotionUsedBucketIndicesScratch: number[];
  chooseFoodTarget(animal: ReproductionAnimalState): TestSurfaceCell | null;
  shrimpRealisedGrazingReturn(animal: ReproductionAnimalState): number;
  shrimpGrazingMaintenancePerSecond(animal: ReproductionAnimalState): number;
  shrimpReserveCapacity(animal: ReproductionAnimalState): number;
  allCells(): TestSurfaceCell[];
  shrimpSurfaceContactPoint(cell: TestSurfaceCell): Vec2;
  biogeochemistry: BiogeochemistryLedger;
}

interface TestSurfaceCell {
  id: string;
  x: number;
  y: number;
  surfaceKind: 'substrate' | 'structure';
  biomass: {
    oedogonium: number;
    nitzschia: number;
    vallisneria: number;
  };
  biofilm: {
    decomposer: number;
    nitrifier: number;
  };
}

type WorldSnapshot = ReturnType<SimulationWorld['snapshot']>;

const placeShrimp = (world: SimulationWorld, point: Vec2): void => {
  world.handle({ type: 'pick-animal', speciesId: SHRIMP, point });
  world.handle({ type: 'drop-held', point });
};

const placeDaphnia = (world: SimulationWorld, point: Vec2): void => {
  world.handle({ type: 'pick-plankton', planktonKind: 'daphnia', point });
  world.handle({ type: 'drop-held', point });
};

const reproductionInternals = (
  world: SimulationWorld,
): ReproductionWorldInternals =>
  world as unknown as ReproductionWorldInternals;

const configureReadyPair = (
  world: SimulationWorld,
  nourished: boolean,
): ReproductionWorldInternals => {
  placeShrimp(world, { x: 560, y: 590 });
  placeShrimp(world, { x: 590, y: 590 });
  const internals = reproductionInternals(world);
  for (const animal of internals.animals) {
    animal.energy = nourished ? 0.9 : 0.2;
    animal.recentIntake = nourished ? 1 : 0;
    animal.secondsSinceFood = nourished ? 0 : 30;
    animal.reproductionCooldown = 0;
    animal.ovarianProgress = nourished ? 1 : 0;
    animal.reproductiveCycleIndex = 0;
    animal.gestationRemaining = null;
    animal.matingAccumulator = 0;
  }
  return internals;
};

const directArrayLengths = (world: SimulationWorld): Record<string, number> =>
  Object.fromEntries(
    Object.entries(world as unknown as Record<string, unknown>)
      .filter((entry): entry is [string, unknown[]] =>
        Array.isArray(entry[1]) &&
        !entry[0].endsWith('Scratch') &&
        entry[0] !== 'producerFluxHistory')
      .map(([key, value]) => [key, value.length]),
  );

const expectBoundedReactionWorkspaces = (
  world: SimulationWorld,
  snapshot: WorldSnapshot,
): void => {
  const workspaces = world as unknown as {
    biofilmReactionSitesScratch: unknown[];
    shrimpFoodCueSitesScratch: unknown[];
    shrimpMateCueSitesScratch: unknown[];
  };
  expect(workspaces.biofilmReactionSitesScratch.length)
    .toBeLessThanOrEqual(snapshot.cells.length);
  expect(workspaces.shrimpFoodCueSitesScratch.length)
    .toBeLessThanOrEqual(snapshot.cells.length);
  expect(workspaces.shrimpMateCueSitesScratch.length)
    .toBeLessThanOrEqual(snapshot.animals.length);
};

const recursiveArrayEntryCount = (value: unknown): number => {
  if (Array.isArray(value)) {
    return value.length + value.reduce(
      (total, entry) => total + recursiveArrayEntryCount(entry),
      0,
    );
  }
  if (value && typeof value === 'object') {
    return Object.values(value).reduce(
      (total, entry) => total + recursiveArrayEntryCount(entry),
      0,
    );
  }
  return 0;
};

const advanceTo = (
  world: SimulationWorld,
  targetSeconds: number,
): WorldSnapshot => {
  world.handle({ type: 'set-speed', speed: 64 });
  let snapshot = world.snapshot();
  let frames = 0;
  while (snapshot.elapsedSeconds < targetSeconds && frames < 100) {
    world.tick(0.1);
    snapshot = world.snapshot();
    frames += 1;
  }
  expect(frames).toBeLessThan(100);
  return snapshot;
};

const waterFieldIndex = (point: Vec2): number => {
  const column = Math.max(
    0,
    Math.min(35, Math.floor(point.x / TANK_WIDTH * 36)),
  );
  const row = Math.max(
    0,
    Math.min(
      19,
      Math.floor((point.y - WATER_TOP) / (GROUND_Y - WATER_TOP) * 20),
    ),
  );
  return row * 36 + column;
};

const waterFields = (
  world: SimulationWorld,
): { oxygen: Float64Array; toxicWaste: Float64Array } =>
  reproductionInternals(world).biogeochemistry as unknown as {
    oxygen: Float64Array;
    toxicWaste: Float64Array;
  };

const moveShrimpWithNeighbor = (
  neighbor: 'none' | 'daphnia' | 'cherry-shrimp',
  deltaSeconds: number,
): { position: Vec2; velocity: Vec2 } => {
  const world = new SimulationWorld('mission-7');
  const start = { x: 600, y: 300 };
  placeShrimp(world, start);
  if (neighbor === 'daphnia') {
    placeDaphnia(world, { x: start.x + 8, y: start.y });
  } else if (neighbor === 'cherry-shrimp') {
    placeShrimp(world, { x: start.x + 8, y: start.y });
  }

  const internals = reproductionInternals(world);
  const shrimp = internals.animals.find(
    (animal) => animal.speciesId === SHRIMP,
  );
  if (!shrimp) throw new Error('motion fixture needs a cherry shrimp');
  shrimp.position = { ...start };
  shrimp.velocity = { x: 0, y: 0 };
  shrimp.energy = 0.4;
  shrimp.ovarianProgress = 0;
  shrimp.reproductiveBiomass = 0;
  shrimp.behavior = 'traveling';
  shrimp.behaviorTimer = 10;
  shrimp.nextTargetEvaluation = 10;
  const target = internals.allCells().reduce((farthest, cell) =>
    Math.abs(cell.x - start.x) > Math.abs(farthest.x - start.x)
      ? cell
      : farthest
  );
  shrimp.targetCellId = target.id;

  for (const other of internals.animals) {
    if (other.id === shrimp.id) continue;
    other.position = { x: start.x + 8, y: start.y };
    other.velocity = { x: 0, y: 0 };
  }

  internals.stepAnimalMotion(deltaSeconds);
  return {
    position: { ...shrimp.position },
    velocity: { ...shrimp.velocity },
  };
};

describe('shrimp population safety contract', () => {
  it('keeps a ready female from chasing or shaking while contact remains local', () => {
    const world = new SimulationWorld('laboratory');
    placeShrimp(world, { x: 600, y: 300 });
    placeShrimp(world, { x: 604, y: 300 });
    const internals = reproductionInternals(world);
    const female = internals.animals[0];
    const male = internals.animals[1];
    // Isolate local mating motion from the ordinary young-adult drive to find
    // food for continued somatic growth.
    for (const animal of [female, male]) {
      animal.structuralBiomass =
        WATER_CYCLE_RULES.shrimp.adultStructuralBiomass;
      animal.peakStructuralBiomass = animal.structuralBiomass;
      animal.storedBiomass = WATER_CYCLE_RULES.shrimp.adultReserveBiomass;
    }
    female.sex = 'female';
    female.position = { x: 600, y: 300 };
    female.velocity = { x: 0, y: 0 };
    female.facing = 1;
    female.energy = 0.9;
    female.ovarianProgress = 1;
    female.reproductiveBiomass = 1;
    female.gestationRemaining = null;
    female.reproductionCooldown = 0;
    female.behavior = 'resting';
    female.behaviorTimer = 0;
    female.nextTargetEvaluation = 0;
    female.targetCellId = null;
    female.targetAnimalId = null;
    male.sex = 'male';
    male.position = { x: 604, y: 300 };
    male.velocity = { x: 0, y: 0 };
    male.energy = 0.9;
    male.reproductionCooldown = 0;
    male.behavior = 'resting';
    male.behaviorTimer = 100;
    male.targetCellId = null;

    let facingChanges = 0;
    let previousFacing = female.facing;
    for (let step = 0; step < 80; step += 1) {
      // 0.1 s is the actual 32x/64x steering step, where the old fixed-speed
      // close approach made the left/right reversal most obvious.
      internals.stepAnimalMotion(0.1);
      if (female.facing !== previousFacing) facingChanges += 1;
      previousFacing = female.facing;
    }
    const finalDistance = Math.hypot(
      female.position.x - male.position.x,
      female.position.y - male.position.y,
    );

    expect(facingChanges).toBeLessThanOrEqual(1);
    expect(finalDistance).toBeLessThan(36);
    expect(female.targetAnimalId).toBeNull();
  });

  it('does not assign a ready female a global male target as proximity changes', () => {
    const world = new SimulationWorld('laboratory');
    for (const x of [600, 620, 660]) {
      placeShrimp(world, { x, y: 300 });
    }
    const internals = reproductionInternals(world);
    const [female, firstMale, secondMale] = internals.animals;
    female.sex = 'female';
    female.position = { x: 600, y: 300 };
    female.energy = 0.9;
    female.ovarianProgress = 1;
    female.reproductiveBiomass = 1;
    female.gestationRemaining = null;
    female.reproductionCooldown = 0;
    female.targetAnimalId = null;
    for (const [index, male] of [firstMale, secondMale].entries()) {
      male.sex = 'male';
      male.position = { x: index === 0 ? 620 : 660, y: 300 };
      male.energy = 0.9;
      male.reproductionCooldown = 0;
      male.behavior = 'resting';
      male.behaviorTimer = 100;
      male.targetCellId = null;
    }

    internals.stepAnimalMotion(0.1);
    expect(female.targetAnimalId).toBeNull();

    firstMale.position = { x: 640, y: 300 };
    secondMale.position = { x: 610, y: 300 };
    internals.stepAnimalMotion(0.1);

    expect(female.targetAnimalId).toBeNull();
  });

  it('does not let unrelated Daphnia IDs change supplied shrimp traits', () => {
    const direct = new SimulationWorld('mission-7');
    placeShrimp(direct, { x: 420, y: 610 });

    const afterDaphnia = new SimulationWorld('mission-7');
    for (const x of [420, 600, 780]) {
      const point = { x, y: 320 };
      afterDaphnia.handle({
        type: 'pick-plankton',
        planktonKind: 'daphnia',
        point,
      });
      afterDaphnia.handle({ type: 'drop-held', point });
    }
    placeShrimp(afterDaphnia, { x: 420, y: 610 });

    const traits = (world: SimulationWorld) => {
      const shrimp = world.exportSaveData().animals.find(
        (animal) => animal.speciesId === SHRIMP,
      );
      return shrimp && {
        lifespanSeconds: shrimp.lifespanSeconds,
        maturationTargetSeconds: shrimp.maturationTargetSeconds,
        ovarianProgress: shrimp.ovarianProgress,
        randomSeed: shrimp.randomSeed,
      };
    };

    expect(traits(afterDaphnia)).toEqual(traits(direct));
  });

  it('ignores Daphnia in shrimp separation at normal and coarse motion steps', () => {
    for (const deltaSeconds of [0.1, 0.25]) {
      const alone = moveShrimpWithNeighbor('none', deltaSeconds);
      const withDaphnia = moveShrimpWithNeighbor('daphnia', deltaSeconds);

      expect(withDaphnia).toEqual(alone);
    }
  });

  it('preserves the shrimp separation force in bucket and fallback paths', () => {
    for (const deltaSeconds of [0.1, 0.25]) {
      const alone = moveShrimpWithNeighbor('none', deltaSeconds);
      const withShrimp = moveShrimpWithNeighbor('cherry-shrimp', deltaSeconds);
      const separationPressure = (24 - 8) / 24;
      const response = 1 - Math.exp(-deltaSeconds * 4.2);
      const expectedVelocityDifference =
        -separationPressure * 34 * response;

      expect(withShrimp.velocity.x - alone.velocity.x)
        .toBeCloseTo(expectedVelocityDifference, 10);
      expect(withShrimp.velocity.y).toBeCloseTo(alone.velocity.y, 10);
      expect(withShrimp.position.x - alone.position.x)
        .toBeCloseTo(expectedVelocityDifference * deltaSeconds, 10);
    }
  });

  it('finds a shrimp that moved in from the second neighboring bucket ring', () => {
    const advancePair = (
      leadingStartX: number,
    ): { leading: ReproductionAnimalState; following: ReproductionAnimalState } => {
      const world = new SimulationWorld('mission-7');
      placeShrimp(world, { x: leadingStartX, y: 300 });
      placeShrimp(world, { x: 600, y: 300 });
      const internals = reproductionInternals(world);
      const [leading, following] = internals.animals;
      const target = internals.allCells().reduce((rightmost, cell) =>
        cell.x > rightmost.x ? cell : rightmost
      );
      for (const animal of internals.animals) {
        animal.energy = 0.4;
        animal.ovarianProgress = 0;
        animal.reproductiveBiomass = 0;
        animal.behavior = 'traveling';
        animal.behaviorTimer = 10;
        animal.nextTargetEvaluation = 10;
        animal.targetCellId = target.id;
      }
      leading.position = { x: leadingStartX, y: 300 };
      leading.velocity = { x: 100, y: 0 };
      following.position = { x: 600, y: 300 };
      following.velocity = { x: 0, y: 0 };

      internals.stepAnimalMotion(0.1);
      return { leading, following };
    };

    // 575 and 600 begin two 24 px bucket columns apart and just outside the
    // separation radius. The first shrimp then moves inside the radius before
    // the second shrimp is processed.
    const nearby = advancePair(575);
    const distant = advancePair(300);

    expect(nearby.leading.position.x).toBeGreaterThan(576);
    expect(600 - nearby.leading.position.x).toBeLessThan(24);
    expect(nearby.following.velocity.x).toBeGreaterThan(
      distant.following.velocity.x,
    );
  });

  it('keeps only shrimp in reusable motion buckets and clears references on reset', () => {
    const world = new SimulationWorld('mission-7');
    placeShrimp(world, { x: 600, y: 300 });
    placeDaphnia(world, { x: 608, y: 300 });
    const internals = reproductionInternals(world);

    internals.rebuildShrimpMotionBuckets();
    const bucketAnimals = internals.shrimpMotionBucketsScratch.flat();
    expect(bucketAnimals).toHaveLength(1);
    expect(bucketAnimals.every((animal) => animal.speciesId === SHRIMP)).toBe(true);
    expect(internals.shrimpMotionUsedBucketIndicesScratch.length).toBeGreaterThan(0);

    world.initialize('laboratory');

    expect(internals.shrimpMotionUsedBucketIndicesScratch).toHaveLength(0);
    expect(
      internals.shrimpMotionBucketsScratch.every((bucket) => bucket.length === 0),
    ).toBe(true);
  });

  it('makes a ready female emit while an eligible male follows the local cue', () => {
    const world = new SimulationWorld('laboratory');
    placeShrimp(world, { x: 500, y: 300 });
    placeShrimp(world, { x: 600, y: 300 });
    const internals = reproductionInternals(world);
    const female = internals.animals.find((animal) => animal.sex === 'female');
    const male = internals.animals.find((animal) => animal.sex === 'male');
    if (!female || !male) {
      throw new Error('mate-cue fixture needs one female and one male');
    }

    for (const animal of internals.animals) {
      animal.velocity = { x: 0, y: 0 };
      animal.energy = 0.9;
      animal.reproductionCooldown = 0;
      animal.ovarianProgress = 0;
      animal.reproductiveBiomass = 0;
      animal.behavior = 'resting';
      animal.behaviorTimer = 100;
    }
    female.position = { x: 600, y: 300 };
    female.ovarianProgress = 1;
    female.reproductiveBiomass = 1;
    female.gestationRemaining = null;
    male.position = { x: 500, y: 300 };
    for (let second = 0; second < 12; second += 1) {
      internals.biogeochemistry.advance(1, [], [{
        point: female.position,
        strength: 1,
      }]);
    }

    const femaleStartX = female.position.x;
    const maleStartX = male.position.x;
    internals.stepAnimalMotion(0.1);

    expect(female.targetAnimalId).toBeNull();
    expect(female.position.x).toBe(femaleStartX);
    expect(male.targetAnimalId).toBeNull();
    expect(male.position.x).toBeGreaterThan(maleStartX);
  });

  it('keeps a nutritionally foraging male on food instead of diverting him to a mate plume', () => {
    const world = new SimulationWorld('laboratory');
    placeShrimp(world, { x: 600, y: 621 });
    const internals = reproductionInternals(world);
    const male = internals.animals[0];
    const foodCell = internals.allCells()
      .filter((cell) => cell.surfaceKind === 'substrate')
      .sort((left, right) =>
        Math.abs(left.x - 600) - Math.abs(right.x - 600))[0];
    if (!male || !foodCell) {
      throw new Error('male foraging fixture needs a shrimp and substrate');
    }

    male.lifeStage = 'adult';
    male.sex = 'male';
    male.structuralBiomass = 1;
    // Sixteen percent of the adult reserve is just above the courtship floor,
    // but remains below the foraging hysteresis stop condition.
    male.storedBiomass = 0.0096;
    male.energy = 0.3952;
    male.reproductionCooldown = 0;
    male.position = internals.shrimpSurfaceContactPoint(foodCell);
    male.behavior = 'exploring';
    male.behaviorTimer = 0;
    male.nextTargetEvaluation = 0;
    male.targetCellId = null;
    foodCell.biomass.nitzschia = 0.2;

    const mateCuePoint = { x: foodCell.x + 100, y: foodCell.y };
    for (let second = 0; second < 45; second += 1) {
      internals.biogeochemistry.advance(1, [], [{
        point: mateCuePoint,
        strength: 1,
      }]);
    }

    internals.stepAnimalMotion(0.1);

    expect(male.targetCellId).toBe(foodCell.id);
    expect(male.behavior).toBe('grazing');
  });

  it('derives condition from conserved body matter instead of killing on a stale hunger value', () => {
    const world = new SimulationWorld('laboratory');
    placeShrimp(world, { x: 600, y: 590 });
    const internals = reproductionInternals(world);
    const animal = internals.animals[0];

    animal.energy = 0;
    animal.structuralBiomass = 1;
    animal.storedBiomass = 0.08;
    internals.stepAnimalEcology(0.1);

    expect(world.snapshot().animals).toHaveLength(1);
    expect(world.snapshot().animals[0].energy).toBeGreaterThan(0);
    expect(world.snapshot().animalPopulationEventTotals.deathsByCause.starvation).toBe(0);
  });

  it('uses only a thousands-level technical guard and permits a brood above the old 8/12 cap', () => {
    expect(SHRIMP_TECHNICAL_POPULATION_LIMIT).toBeGreaterThanOrEqual(2_000);
    expect(SHRIMP_TECHNICAL_POPULATION_LIMIT).toBeGreaterThan(12);

    const world = new SimulationWorld('laboratory');
    for (let index = 0; index < 14; index += 1) {
      placeShrimp(world, {
        x: 260 + (index % 7) * 105,
        y: 270 + Math.floor(index / 7) * 80,
      });
    }
    const internals = reproductionInternals(world);
    const mother = internals.animals.find((animal) => animal.sex === 'female');
    if (!mother) throw new Error('technical guard fixture needs a female shrimp');
    mother.energy = 0.9;
    mother.recentIntake = 1;
    mother.secondsSinceFood = 0;
    mother.storedBiomass = 0.5;
    mother.reproductiveBiomass = 0.5;
    mother.gestationRemaining = 1;

    internals.stepAnimalEcology(1);

    expect(world.snapshot().animalPopulation[SHRIMP].total).toBeGreaterThan(14);
    expect(world.snapshot().animalPopulation[SHRIMP].total).toBeLessThan(
      SHRIMP_TECHNICAL_POPULATION_LIMIT,
    );
  });

  it('requires a conserved brood reserve and a nearby mate before gestation and birth', () => {
    const depletedWorld = new SimulationWorld('laboratory');
    const depleted = configureReadyPair(depletedWorld, false);
    const depletedFemale = depleted.animals.find((animal) => animal.sex === 'female');
    if (!depletedFemale) throw new Error('depleted fixture needs a female shrimp');

    const nourishedWorld = new SimulationWorld('laboratory');
    const nourished = configureReadyPair(nourishedWorld, true);
    const nourishedFemale = nourished.animals.find((animal) => animal.sex === 'female');
    if (!nourishedFemale) throw new Error('nourished fixture needs a female shrimp');
    nourishedFemale.storedBiomass = 0.5;
    nourishedFemale.reproductiveBiomass = 0.5;

    for (let second = 0; second < 3; second += 1) {
      depleted.stepAnimalEcology(1);
      nourished.stepAnimalEcology(1);
    }

    expect(depletedFemale.gestationRemaining).toBeNull();
    expect(depletedWorld.snapshot().animalPopulation[SHRIMP].total).toBe(2);
    expect(nourishedFemale.gestationRemaining).not.toBeNull();

    // Once the brood has been funded, a gap since the last bite must not
    // freeze embryo development. Its material is already protected in reserve.
    nourishedFemale.secondsSinceFood = 120;
    nourishedFemale.recentIntake = 0;
    nourishedFemale.gestationRemaining = 1;
    nourished.stepAnimalEcology(1);

    expect(nourishedWorld.snapshot().animalPopulation[SHRIMP].total).toBeGreaterThan(2);
  });

  it('reduces production continuously with reserve density without a survival floor', () => {
    const allocationAtReserveFraction = (reserveFraction: number): number => {
      const world = new SimulationWorld('laboratory');
      const internals = configureReadyPair(world, true);
      const female = internals.animals.find((animal) => animal.sex === 'female');
      if (!female) throw new Error('reserve fixture needs a female shrimp');
      female.storedBiomass =
        internals.shrimpReserveCapacity(female) * reserveFraction;
      female.reproductiveBiomass = 0;
      // Isolate reserve density from the separate recent net-production gate.
      female.recentIntake = 1;

      internals.stepAnimalEcology(1);
      expect(female.gestationRemaining).toBeNull();
      expect(world.snapshot().animalPopulation[SHRIMP].total).toBe(2);
      return female.reproductiveBiomass;
    };

    const fullReserveAllocation = allocationAtReserveFraction(1);
    const midReserveAllocation = allocationAtReserveFraction(0.5);
    const lowReserveAllocation = allocationAtReserveFraction(0.1);

    expect(fullReserveAllocation).toBeGreaterThan(0);
    expect(midReserveAllocation).toBeGreaterThan(0);
    expect(midReserveAllocation).toBeLessThan(fullReserveAllocation);
    expect(lowReserveAllocation).toBeGreaterThan(0);
    expect(lowReserveAllocation).toBeLessThan(midReserveAllocation);
  });

  it('lets a funded pair mate and develop embryos across independent feeding gaps', () => {
    const world = new SimulationWorld('laboratory');
    const internals = configureReadyPair(world, true);
    const female = internals.animals.find((animal) => animal.sex === 'female');
    const male = internals.animals.find((animal) => animal.sex === 'male');
    if (!female || !male) throw new Error('funded fixture needs both sexes');
    // Once the brood is fully funded, its ring-fenced matter—not a second
    // arbitrary short-term reserve threshold—keeps the female eligible to
    // mate. The male still needs his ordinary courtship reserve.
    female.storedBiomass = 0;
    female.reproductiveBiomass =
      SHRIMP_ECOLOGY_RULES.maximumClutchSize *
      WATER_CYCLE_RULES.shrimp.juvenileBirthBiomass;
    female.recentIntake = 0;
    male.storedBiomass = 0.012;
    male.recentIntake = 0;

    for (let second = 0; second < 5; second += 1) {
      internals.stepAnimalEcology(1);
    }
    expect(female.gestationRemaining).not.toBeNull();

    female.gestationRemaining = 20;
    internals.stepAnimalEcology(1);
    expect(female.gestationRemaining).toBeLessThan(20);
  });

  it('allocates a limited conserved somatic surplus to the brood reserve', () => {
    const world = new SimulationWorld('laboratory');
    const internals = configureReadyPair(world, true);
    const female = internals.animals.find((animal) => animal.sex === 'female');
    if (!female) throw new Error('allocation fixture needs a female shrimp');
    female.storedBiomass = 0.5;
    female.reproductiveBiomass = 0;
    const totalBefore =
      female.storedBiomass + female.reproductiveBiomass;

    internals.stepAnimalEcology(1);

    expect(female.reproductiveBiomass).toBeGreaterThan(0);
    expect(female.reproductiveBiomass).toBeLessThan(0.05);
    expect(female.storedBiomass + female.reproductiveBiomass)
      .toBeLessThanOrEqual(totalBefore);
  });

  it('provisions the next conserved brood during cooldown without mating early', () => {
    const world = new SimulationWorld('laboratory');
    const internals = configureReadyPair(world, true);
    const female = internals.animals.find((animal) => animal.sex === 'female');
    if (!female) throw new Error('cooldown fixture needs a female shrimp');
    female.storedBiomass = 0.5;
    female.reproductiveBiomass = 0;
    female.ovarianProgress = 0.5;

    internals.stepAnimalEcology(1);

    expect(female.reproductiveBiomass).toBeGreaterThan(0);
    expect(female.gestationRemaining).toBeNull();
    expect(female.matingAccumulator).toBe(0);
  });

  it('does not detect a reproductive partner across the whole tank', () => {
    const world = new SimulationWorld('laboratory');
    const internals = configureReadyPair(world, true);
    const female = internals.animals.find((animal) => animal.sex === 'female');
    const male = internals.animals.find((animal) => animal.sex === 'male');
    if (!female || !male) throw new Error('local mating fixture needs both sexes');
    female.storedBiomass = 0.5;
    male.position = { x: 1_100, y: 590 };

    for (let second = 0; second < 5; second += 1) {
      internals.stepAnimalEcology(1);
    }

    expect(female.gestationRemaining).toBeNull();
  });

  it('cannot target a food colony outside its local sensing radius', () => {
    const world = new SimulationWorld('laboratory');
    const farCell = world.snapshot().cells
      .filter((cell) => cell.surfaceKind === 'substrate' && cell.x > 1_000)
      .sort((a, b) => b.x - a.x)[0];
    if (!farCell) throw new Error('local food fixture needs a far substrate cell');
    world.handle({
      type: 'pick-seed',
      speciesId: 'nitzschia',
      point: farCell,
    });
    world.handle({ type: 'drop-held', point: farCell });
    placeShrimp(world, { x: 120, y: farCell.y });

    const internals = reproductionInternals(world);
    const shrimp = internals.animals[0];
    shrimp.energy = 0.1;

    expect(internals.chooseFoodTarget(shrimp)).toBeNull();

    shrimp.position = { x: farCell.x - 50, y: farCell.y };
    expect(internals.chooseFoodTarget(shrimp)).not.toBeNull();
  });

  it('samples a microscopic film underfoot instead of knowing a richer cell remotely', () => {
    const world = new SimulationWorld('laboratory');
    placeShrimp(world, { x: 600, y: 621 });
    const internals = reproductionInternals(world);
    const shrimp = internals.animals[0];
    const substrate = internals.allCells()
      .filter((cell) => cell.surfaceKind === 'substrate')
      .sort((left, right) => left.x - right.x);
    const trace = substrate.reduce((best, cell) =>
      Math.abs(cell.x - 600) < Math.abs(best.x - 600) ? cell : best
    );
    const colony = substrate.reduce((best, cell) =>
      Math.abs(cell.x - (trace.x - 45)) <
        Math.abs(best.x - (trace.x - 45))
        ? cell
        : best
    );
    trace.biofilm.decomposer = 0.00001;
    colony.biomass.oedogonium = 0.5;
    shrimp.position = internals.shrimpSurfaceContactPoint(trace);
    shrimp.energy = 0.1;

    expect(internals.chooseFoodTarget(shrimp)?.id).toBe(trace.id);

    // After the poor patch has actually been sampled and left, the short
    // revisit memory allows the stronger nearby cue to guide the next choice.
    (
      shrimp as ReproductionAnimalState & {
        recentGrazingCellId?: string | null;
        recentGrazingCellCooldown?: number;
      }
    ).recentGrazingCellId = trace.id;
    (
      shrimp as ReproductionAnimalState & {
        recentGrazingCellCooldown?: number;
      }
    ).recentGrazingCellCooldown = 10;
    expect(internals.chooseFoodTarget(shrimp)?.id).toBe(colony.id);
  });

  it('does not let growth or ovarian state reveal a better remote food cell', () => {
    const world = new SimulationWorld('laboratory');
    placeShrimp(world, { x: 600, y: 621 });
    const internals = reproductionInternals(world);
    const shrimp = internals.animals[0];
    const substrate = internals.allCells()
      .filter((cell) => cell.surfaceKind === 'substrate')
      .sort((left, right) => left.x - right.x);
    const near = substrate.reduce((best, cell) =>
      Math.abs(cell.x - 600) < Math.abs(best.x - 600) ? cell : best
    );
    const far = substrate.reduce((best, cell) =>
      Math.abs(cell.x - (near.x - 42)) <
        Math.abs(best.x - (near.x - 42))
        ? cell
        : best
    );
    near.biomass.nitzschia = 0.18;
    far.biomass.nitzschia = 0.42;
    shrimp.position = internals.shrimpSurfaceContactPoint(near);
    shrimp.energy = 0.1;

    shrimp.lifeStage = 'juvenile';
    const juvenileTarget = internals.chooseFoodTarget(shrimp)?.id;
    shrimp.lifeStage = 'adult';
    shrimp.sex = 'female';
    shrimp.ovarianProgress = 1;
    shrimp.reproductiveBiomass = 0;
    const reproductiveFemaleTarget = internals.chooseFoodTarget(shrimp)?.id;
    shrimp.sex = 'male';
    shrimp.ovarianProgress = 0;
    const adultMaleTarget = internals.chooseFoodTarget(shrimp)?.id;

    expect(reproductiveFemaleTarget).toBe(juvenileTarget);
    expect(adultMaleTarget).toBe(juvenileTarget);
  });

  it('samples but leaves a trace film whose realised intake cannot pay grazing metabolism', () => {
    const world = new SimulationWorld('laboratory');
    placeShrimp(world, { x: 600, y: 621 });
    const internals = reproductionInternals(world);
    const shrimp = internals.animals[0];
    const trace = internals.allCells()
      .filter((cell) => cell.surfaceKind === 'substrate')
      .sort((left, right) =>
        Math.abs(left.x - 600) - Math.abs(right.x - 600))[0];
    if (!trace) throw new Error('trace-film fixture needs a substrate cell');
    trace.biofilm.decomposer = 0.00001;
    shrimp.position = internals.shrimpSurfaceContactPoint(trace);
    shrimp.targetCellId = trace.id;
    shrimp.behavior = 'grazing';
    shrimp.behaviorTimer = 10;
    shrimp.grazingSessionIntake = 0;
    shrimp.grazingSessionSeconds = 3.1;
    shrimp.energy = 0.1;
    shrimp.lifeStage = 'juvenile';

    internals.stepAnimalMotion(0.25);

    expect(shrimp.behavior).not.toBe('grazing');
    expect(shrimp.targetCellId).not.toBe(trace.id);
    expect(shrimp.recentGrazingCellId).toBe(trace.id);
    // The memory must survive the complete mandatory roam so the next target
    // decision can reject this sampled trace when another local patch exists.
    expect(shrimp.recentGrazingCellCooldown ?? 0)
      .toBeGreaterThan(shrimp.behaviorTimer);
  });

  it('requires a sampled juvenile patch to fund development as well as maintenance', () => {
    const world = new SimulationWorld('laboratory');
    placeShrimp(world, { x: 600, y: 621 });
    const internals = reproductionInternals(world);
    const shrimp = internals.animals[0];
    shrimp.structuralBiomass = 0.05;
    shrimp.storedBiomass = 0.002;
    shrimp.reproductiveBiomass = 0;
    shrimp.grazingSessionSeconds = 4;
    const maintenance = internals.shrimpGrazingMaintenancePerSecond(shrimp);
    shrimp.grazingSessionIntake = maintenance * 4 /
      WATER_CYCLE_RULES.shrimp.assimilationFraction * 1.2;

    shrimp.lifeStage = 'adult';
    const adultReturn = internals.shrimpRealisedGrazingReturn(shrimp);
    shrimp.lifeStage = 'juvenile';
    const juvenileReturn = internals.shrimpRealisedGrazingReturn(shrimp);

    expect(adultReturn).toBeCloseTo(1.2, 8);
    expect(juvenileReturn).toBeLessThan(1);
  });

  it('depletes a sparse edible film continuously instead of clipping it to zero', () => {
    const world = new SimulationWorld('laboratory');
    const internals = reproductionInternals(world);
    const foodCell = internals.allCells()
      .filter((cell) => cell.surfaceKind === 'substrate')
      .sort((left, right) =>
        Math.abs(left.x - 600) - Math.abs(right.x - 600))[0];
    if (!foodCell) throw new Error('continuous grazing fixture needs a substrate cell');
    foodCell.biomass.oedogonium = 0.01;
    const contact = internals.shrimpSurfaceContactPoint(foodCell);
    for (let index = 0; index < 4; index += 1) {
      placeShrimp(world, contact);
      const shrimp = internals.animals.at(-1)!;
      shrimp.position = { ...contact };
      shrimp.targetCellId = foodCell.id;
      shrimp.behavior = 'grazing';
      shrimp.behaviorTimer = 2;
      shrimp.energy = 0.1;
    }

    internals.stepAnimalEcology(1);

    expect(foodCell.biomass.oedogonium).toBeGreaterThan(0);
    expect(foodCell.biomass.oedogonium).toBeLessThan(0.01);
  });

  it('abandons a harmful local water pocket without sensing across the tank', () => {
    const world = new SimulationWorld('mission-7');
    const start = { x: 600, y: 400 };
    placeShrimp(world, start);
    const internals = reproductionInternals(world);
    const fields = waterFields(world);
    fields.oxygen.fill(78);
    fields.toxicWaste.fill(1);
    const startIndex = waterFieldIndex(start);
    fields.oxygen[startIndex] = 8;
    fields.toxicWaste[startIndex] = 24;

    const beforeStress = internals.biogeochemistry.sampleAt(start);
    internals.stepAnimalMotion(1);
    const moved = internals.animals[0];
    const afterStress = internals.biogeochemistry.sampleAt(moved.position);

    expect(Math.hypot(
      moved.position.x - start.x,
      moved.position.y - start.y,
    )).toBeGreaterThan(30);
    expect(afterStress.oxygen).toBeGreaterThan(beforeStress.oxygen);
    expect(afterStress.toxicWaste).toBeLessThan(beforeStress.toxicWaste);
    expect(moved.targetCellId).toBeNull();
  });

  it('does not knowingly return to an unsafe food surface inside local cue range', () => {
    const world = new SimulationWorld('mission-7');
    const foodCell = world.snapshot().cells
      .filter((cell) => cell.surfaceKind === 'substrate')
      .sort((left, right) =>
        Math.abs(left.x - 600) - Math.abs(right.x - 600))[0];
    if (!foodCell) throw new Error('water-cue fixture needs a substrate cell');
    world.handle({ type: 'pick-seed', speciesId: 'nitzschia', point: foodCell });
    world.handle({ type: 'drop-held', point: foodCell });
    placeShrimp(world, foodCell);

    const internals = reproductionInternals(world);
    const shrimp = internals.animals[0];
    expect(internals.chooseFoodTarget(shrimp)).not.toBeNull();

    const fields = waterFields(world);
    fields.toxicWaste[waterFieldIndex(foodCell)] = 24;
    fields.oxygen[waterFieldIndex(foodCell)] = 8;

    const saferTarget = internals.chooseFoodTarget(shrimp);
    expect(saferTarget?.id ?? null).not.toBe(foodCell.id);
    if (saferTarget) {
      expect(
        internals.biogeochemistry.sampleAt(
          internals.shrimpSurfaceContactPoint(saferTarget),
        ).oxygen,
      ).toBeGreaterThan(8);
    }
  });

  it('keeps persistent and snapshot arrays bounded with 64 live shrimp', () => {
    const world = new SimulationWorld('laboratory');
    for (let row = 0; row < 8; row += 1) {
      for (let column = 0; column < 8; column += 1) {
        placeShrimp(world, {
          x: 150 + column * 128,
          y: 140 + row * 62,
        });
      }
    }
    // This test isolates persistent-array growth, not starvation. Put each
    // fixture at a fully grown, fully reserved non-growing state so the
    // no-food laboratory does not turn a memory assertion into a life-history
    // calibration test.
    const save = world.exportSaveData();
    for (const animal of save.animals) {
      animal.structuralBiomass =
        WATER_CYCLE_RULES.shrimp.adultStructuralBiomass;
      animal.peakStructuralBiomass = animal.structuralBiomass;
      animal.storedBiomass = WATER_CYCLE_RULES.shrimp.adultReserveBiomass;
      animal.reproductiveBiomass = 0;
      animal.lifeStage = 'adult';
      animal.sex = 'male';
    }
    save.materialReference = null;
    world.loadSaveData(save);
    world.handle({ type: 'start' });
    const baseline = world.snapshot();
    const baselineWorldArrays = directArrayLengths(world);
    const baselineSnapshotEntries =
      recursiveArrayEntryCount(baseline) - baseline.producerFluxHistory.length;

    expect(baseline.animalPopulation[SHRIMP].total).toBe(64);
    const afterFastForward = advanceTo(world, 48);

    expect(afterFastForward.animalPopulation[SHRIMP].total).toBe(64);
    expect(afterFastForward.carcasses).toHaveLength(0);
    expect(directArrayLengths(world)).toEqual(baselineWorldArrays);
    expect((world as unknown as { producerFluxHistory: unknown[] })
      .producerFluxHistory.length).toBeLessThanOrEqual(91);
    expect(
      recursiveArrayEntryCount(afterFastForward) -
        afterFastForward.producerFluxHistory.length,
    ).toBe(
      baselineSnapshotEntries,
    );
    expectBoundedReactionWorkspaces(world, afterFastForward);
  });
});
