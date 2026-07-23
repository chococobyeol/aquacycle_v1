import { describe, expect, it } from 'vitest';
import {
  SHRIMP_TECHNICAL_POPULATION_LIMIT,
  SimulationWorld,
} from '../src/simulation/SimulationWorld';
import type { Vec2 } from '../src/simulation/types';

const SHRIMP = 'cherry-shrimp' as const;

interface ReproductionAnimalState {
  position: Vec2;
  sex: 'female' | 'male';
  energy: number;
  recentIntake: number;
  structuralBiomass: number;
  storedBiomass: number;
  reproductiveBiomass: number;
  secondsSinceFood: number;
  reproductionCooldown: number;
  gestationRemaining: number | null;
  matingAccumulator: number;
}

interface ReproductionWorldInternals {
  animals: ReproductionAnimalState[];
  stepAnimalEcology(deltaSeconds: number): void;
  chooseFoodTarget(animal: ReproductionAnimalState): { id: string } | null;
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
  placeShrimp(world, { x: 600, y: 590 });
  const internals = reproductionInternals(world);
  for (const animal of internals.animals) {
    animal.energy = nourished ? 0.9 : 0.2;
    animal.recentIntake = nourished ? 1 : 0;
    animal.secondsSinceFood = nourished ? 0 : 30;
    animal.reproductionCooldown = 0;
    animal.gestationRemaining = null;
    animal.matingAccumulator = 0;
  }
  return internals;
};

const directArrayLengths = (world: SimulationWorld): Record<string, number> =>
  Object.fromEntries(
    Object.entries(world as unknown as Record<string, unknown>)
      .filter((entry): entry is [string, unknown[]] => Array.isArray(entry[1]))
      .map(([key, value]) => [key, value.length]),
  );

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

describe('shrimp population safety contract', () => {
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

    for (let second = 0; second < 3; second += 1) {
      depleted.stepAnimalEcology(1);
      nourished.stepAnimalEcology(1);
    }

    expect(depletedFemale.gestationRemaining).toBeNull();
    expect(depletedWorld.snapshot().animalPopulation[SHRIMP].total).toBe(2);
    expect(nourishedFemale.gestationRemaining).not.toBeNull();

    // Once the brood has been funded, a short gap since the last bite must not
    // freeze embryo development. Its material is already protected in reserve.
    nourishedFemale.secondsSinceFood = 120;
    nourishedFemale.gestationRemaining = 1;
    nourished.stepAnimalEcology(1);

    expect(nourishedWorld.snapshot().animalPopulation[SHRIMP].total).toBeGreaterThan(2);
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

    shrimp.position = { x: farCell.x - 80, y: farCell.y };
    expect(internals.chooseFoodTarget(shrimp)).not.toBeNull();
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
  });
});
