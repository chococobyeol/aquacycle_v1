import { describe, expect, it } from 'vitest';
import {
  SHRIMP_TECHNICAL_POPULATION_LIMIT,
  SimulationWorld,
} from '../src/simulation/SimulationWorld';
import type { Vec2 } from '../src/simulation/types';

const SHRIMP = 'cherry-shrimp' as const;

interface ReproductionAnimalState {
  sex: 'female' | 'male';
  energy: number;
  recentIntake: number;
  secondsSinceFood: number;
  reproductionCooldown: number;
  gestationRemaining: number | null;
  matingAccumulator: number;
}

interface ReproductionWorldInternals {
  animals: ReproductionAnimalState[];
  stepAnimalEcology(deltaSeconds: number): void;
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
    mother.gestationRemaining = 1;

    internals.stepAnimalEcology(1);

    expect(world.snapshot().animalPopulation[SHRIMP].total).toBeGreaterThan(14);
    expect(world.snapshot().animalPopulation[SHRIMP].total).toBeLessThan(
      SHRIMP_TECHNICAL_POPULATION_LIMIT,
    );
  });

  it('requires energy and recent feeding before mating, then food-supported gestation before birth', () => {
    const depletedWorld = new SimulationWorld('laboratory');
    const depleted = configureReadyPair(depletedWorld, false);
    const depletedFemale = depleted.animals.find((animal) => animal.sex === 'female');
    if (!depletedFemale) throw new Error('depleted fixture needs a female shrimp');

    const nourishedWorld = new SimulationWorld('laboratory');
    const nourished = configureReadyPair(nourishedWorld, true);
    const nourishedFemale = nourished.animals.find((animal) => animal.sex === 'female');
    if (!nourishedFemale) throw new Error('nourished fixture needs a female shrimp');

    for (let second = 0; second < 3; second += 1) {
      depleted.stepAnimalEcology(1);
      nourished.stepAnimalEcology(1);
    }

    expect(depletedFemale.gestationRemaining).toBeNull();
    expect(depletedWorld.snapshot().animalPopulation[SHRIMP].total).toBe(2);
    expect(nourishedFemale.gestationRemaining).not.toBeNull();

    nourishedFemale.energy = 0.9;
    nourishedFemale.recentIntake = 1;
    nourishedFemale.secondsSinceFood = 0;
    nourishedFemale.gestationRemaining = 1;
    nourished.stepAnimalEcology(1);

    expect(nourishedWorld.snapshot().animalPopulation[SHRIMP].total).toBeGreaterThan(2);
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
