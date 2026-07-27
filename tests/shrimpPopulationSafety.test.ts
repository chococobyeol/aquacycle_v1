import { describe, expect, it } from 'vitest';
import {
  SHRIMP_TECHNICAL_POPULATION_LIMIT,
  SimulationWorld,
} from '../src/simulation/SimulationWorld';
import { BiogeochemistryLedger } from '../src/simulation/biogeochemistry';
import {
  GROUND_Y,
  TANK_WIDTH,
  WATER_TOP,
  type Vec2,
} from '../src/simulation/types';

const SHRIMP = 'cherry-shrimp' as const;

interface ReproductionAnimalState {
  position: Vec2;
  targetCellId: string | null;
  behavior: string;
  behaviorTimer: number;
  grazingSessionIntake: number;
  sex: 'female' | 'male';
  energy: number;
  recentIntake: number;
  structuralBiomass: number;
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
  chooseFoodTarget(animal: ReproductionAnimalState): TestSurfaceCell | null;
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
        Array.isArray(entry[1]) && !entry[0].endsWith('Scratch'))
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

describe('shrimp population safety contract', () => {
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

  it('does not allocate a new brood below the protected somatic reserve', () => {
    const world = new SimulationWorld('laboratory');
    const internals = configureReadyPair(world, true);
    const female = internals.animals.find((animal) => animal.sex === 'female');
    if (!female) throw new Error('surplus fixture needs a female shrimp');
    female.storedBiomass = 0.16;
    female.reproductiveBiomass = 0;
    female.recentIntake = 0;

    internals.stepAnimalEcology(1);

    expect(female.reproductiveBiomass).toBe(0);
    expect(female.matingAccumulator).toBe(0);
  });

  it('lets a funded pair mate and develop embryos across independent feeding gaps', () => {
    const world = new SimulationWorld('laboratory');
    const internals = configureReadyPair(world, true);
    const female = internals.animals.find((animal) => animal.sex === 'female');
    const male = internals.animals.find((animal) => animal.sex === 'male');
    if (!female || !male) throw new Error('funded fixture needs both sexes');
    female.storedBiomass = 0.5;
    female.reproductiveBiomass = 0.5;
    female.recentIntake = 0;
    male.storedBiomass = 0.5;
    male.recentIntake = 0;

    for (let second = 0; second < 3; second += 1) {
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

  it('prefers a locally sensed viable colony over a microscopic film underfoot', () => {
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

    expect(internals.chooseFoodTarget(shrimp)?.id).toBe(colony.id);
  });

  it('samples but leaves a trace film that cannot pay grazing metabolism', () => {
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
    shrimp.behaviorTimer = 0;
    shrimp.grazingSessionIntake = 0;
    shrimp.energy = 0.1;

    internals.stepAnimalMotion(0.25);

    expect(shrimp.behavior).not.toBe('grazing');
    expect(shrimp.targetCellId).not.toBe(trace.id);
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
    world.handle({ type: 'start' });
    const baseline = world.snapshot();
    const baselineWorldArrays = directArrayLengths(world);
    const baselineSnapshotEntries = recursiveArrayEntryCount(baseline);

    expect(baseline.animalPopulation[SHRIMP].total).toBe(64);
    const afterFastForward = advanceTo(world, 48);

    expect(afterFastForward.animalPopulation[SHRIMP].total).toBe(64);
    expect(afterFastForward.carcasses).toHaveLength(0);
    expect(directArrayLengths(world)).toEqual(baselineWorldArrays);
    expect(recursiveArrayEntryCount(afterFastForward)).toBe(
      baselineSnapshotEntries,
    );
    expectBoundedReactionWorkspaces(world, afterFastForward);
  });
});
