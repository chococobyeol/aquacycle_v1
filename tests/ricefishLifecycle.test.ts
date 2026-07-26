import { describe, expect, it } from 'vitest';
import { SCENARIOS } from '../src/simulation/config';
import { SimulationWorld } from '../src/simulation/SimulationWorld';
import type {
  AnimalSpeciesId,
  SpeciesId,
  Vec2,
} from '../src/simulation/types';

const RICEFISH: AnimalSpeciesId = 'japanese-ricefish';

type InternalAnimal = {
  id: string;
  speciesId: AnimalSpeciesId;
  position: Vec2;
  bodyLength: number;
  lifeStage: 'egg' | 'fry' | 'juvenile' | 'adult';
  sex: 'female' | 'male';
  energy: number;
  health: number;
  storedBiomass: number;
  structuralBiomass: number;
  reproductiveBiomass: number;
  recentFood: string | null;
  reproductionCooldown: number;
  gestationRemaining: number | null;
  matingAccumulator: number;
  behavior: string;
  behaviorTimer: number;
  targetAnimalId: string | null;
};

type WorldInternals = {
  animals: InternalAnimal[];
  stepRicefishEcology(deltaSeconds: number): void;
};

const placeAnimal = (
  world: SimulationWorld,
  speciesId: AnimalSpeciesId,
  point: Vec2,
): void => {
  world.handle({ type: 'pick-animal', speciesId, point });
  world.handle({ type: 'drop-held', point });
};

const placeSeed = (
  world: SimulationWorld,
  speciesId: SpeciesId,
  point: Vec2,
): void => {
  world.handle({ type: 'pick-seed', speciesId, point });
  world.handle({ type: 'drop-held', point });
};

describe('ricefish lifecycle core', () => {
  it('keeps ricefish in the laboratory while mission 7 validates plankton first', () => {
    expect(SCENARIOS.laboratory.allowedAnimals).toContain(RICEFISH);
    expect(SCENARIOS['mission-7'].allowedAnimals).not.toContain(RICEFISH);
    expect(SCENARIOS['mission-7'].target).toMatchObject({
      type: 'plankton-generation',
    });
  });

  it('supplies a reproducible 2F/1M trio without coupling age and lifespan to IDs', () => {
    const world = new SimulationWorld('laboratory');
    placeAnimal(world, RICEFISH, { x: 500, y: 220 });
    placeAnimal(world, RICEFISH, { x: 550, y: 220 });
    placeAnimal(world, RICEFISH, { x: 600, y: 220 });
    const fish = world.snapshot().animals.filter((animal) => animal.speciesId === RICEFISH);

    expect(fish.map((animal) => animal.sex)).toEqual(['female', 'male', 'female']);
    expect(new Set(fish.map((animal) => animal.lifespanSeconds)).size).toBe(3);
    for (const animal of fish) {
      expect(animal.ageSeconds).toBeGreaterThanOrEqual(620);
      expect(animal.ageSeconds).toBeLessThanOrEqual(900);
      expect(animal.lifespanSeconds).toBeGreaterThanOrEqual(2_400);
      expect(animal.lifespanSeconds).toBeLessThanOrEqual(3_300);
    }
  });

  it('restores ricefish species, sex, life stage, age, and biomass from a frozen aquarium', () => {
    const world = new SimulationWorld('laboratory');
    placeAnimal(world, RICEFISH, { x: 500, y: 220 });
    placeAnimal(world, RICEFISH, { x: 550, y: 220 });
    placeAnimal(world, RICEFISH, { x: 600, y: 220 });
    const before = world.exportSaveData().animals.filter((animal) => animal.speciesId === RICEFISH);

    const restored = new SimulationWorld('mission-1');
    restored.loadSaveData(world.exportSaveData());
    const after = restored.exportSaveData().animals.filter((animal) => animal.speciesId === RICEFISH);

    expect(after.map((animal) => ({
      id: animal.id,
      speciesId: animal.speciesId,
      sex: animal.sex,
      lifeStage: animal.lifeStage,
      ageSeconds: animal.ageSeconds,
      lifespanSeconds: animal.lifespanSeconds,
      structuralBiomass: animal.structuralBiomass,
      storedBiomass: animal.storedBiomass,
      reproductiveBiomass: animal.reproductiveBiomass,
    }))).toEqual(before.map((animal) => ({
      id: animal.id,
      speciesId: animal.speciesId,
      sex: animal.sex,
      lifeStage: animal.lifeStage,
      ageSeconds: animal.ageSeconds,
      lifespanSeconds: animal.lifespanSeconds,
      structuralBiomass: animal.structuralBiomass,
      storedBiomass: animal.storedBiomass,
      reproductiveBiomass: animal.reproductiveBiomass,
    })));
  });

  it('removes a locally captured juvenile shrimp and records predation without a carcass', () => {
    const world = new SimulationWorld('laboratory');
    placeAnimal(world, RICEFISH, { x: 600, y: 330 });
    placeAnimal(world, 'cherry-shrimp', { x: 610, y: 330 });
    const internals = world as unknown as WorldInternals;
    const fish = internals.animals.find((animal) => animal.speciesId === RICEFISH)!;
    const shrimp = internals.animals.find((animal) => animal.speciesId === 'cherry-shrimp')!;
    shrimp.lifeStage = 'juvenile';
    shrimp.bodyLength = 10;
    shrimp.position = { x: 606, y: 330 };
    fish.energy = 0.2;
    fish.behavior = 'hunting';
    fish.behaviorTimer = 0;
    fish.targetAnimalId = shrimp.id;

    for (let attempt = 0; attempt < 20; attempt += 1) {
      internals.stepRicefishEcology(0.25);
      if (!internals.animals.some((animal) => animal.id === shrimp.id)) break;
      fish.behavior = 'hunting';
      fish.behaviorTimer = 0;
      fish.targetAnimalId = shrimp.id;
    }

    const snapshot = world.snapshot();
    expect(snapshot.animals.some((animal) => animal.id === shrimp.id)).toBe(false);
    expect(snapshot.carcasses.some((carcass) => carcass.sourceAnimalId === shrimp.id)).toBe(false);
    expect(snapshot.animalPopulationEvents.some((event) =>
      event.animalId === shrimp.id &&
      event.kind === 'death' &&
      event.cause === 'predation')).toBe(true);
    expect(snapshot.animals.find((animal) => animal.id === fish.id)?.recentFood)
      .toBe('어린 체리새우');
  });

  it('attaches conserved eggs to habitat and hatches a born fry', () => {
    const world = new SimulationWorld('laboratory');
    const substrate = world.snapshot().cells.filter((cell) => cell.surfaceKind === 'substrate');
    const plantCell = substrate.sort((left, right) =>
      Math.abs(left.x - 620) - Math.abs(right.x - 620))[0]!;
    placeSeed(world, 'vallisneria', plantCell);
    placeAnimal(world, RICEFISH, { x: 590, y: 410 });
    placeAnimal(world, RICEFISH, { x: 620, y: 410 });
    const internals = world as unknown as WorldInternals;
    const female = internals.animals.find((animal) =>
      animal.speciesId === RICEFISH && animal.sex === 'female')!;
    const male = internals.animals.find((animal) =>
      animal.speciesId === RICEFISH && animal.sex === 'male')!;
    female.position = { x: 600, y: 410 };
    male.position = { x: 610, y: 410 };
    female.energy = 1;
    female.health = 1;
    female.reproductionCooldown = 0;
    female.reproductiveBiomass = 0.3;
    female.storedBiomass = 0.8;
    female.recentFood = '표면 규조류';
    male.energy = 1;
    male.health = 1;
    male.reproductionCooldown = 0;

    let hatched = false;
    for (let step = 0; step < 650; step += 1) {
      internals.stepRicefishEcology(0.25);
      const fry = internals.animals.find((animal) =>
        animal.speciesId === RICEFISH &&
        animal.lifeStage === 'fry');
      if (fry) {
        hatched = true;
        break;
      }
      // Keep the courtship pair within the local encounter radius while this
      // unit test isolates reproduction from the separate motion controller.
      female.position = { x: 600, y: 410 };
      male.position = { x: 610, y: 410 };
    }

    const snapshot = world.snapshot();
    expect(hatched).toBe(true);
    expect(snapshot.animalPopulation[RICEFISH].fry).toBeGreaterThanOrEqual(1);
    expect(snapshot.animalPopulationEventTotals.births).toBeGreaterThanOrEqual(2);
    expect(snapshot.animalPopulationEventTotals.hatches).toBeGreaterThanOrEqual(1);
    expect(snapshot.animalPopulationEvents.some((event) => event.kind === 'hatched')).toBe(true);
    expect(snapshot.animals.find((animal) => animal.lifeStage === 'fry')?.attachmentLabel)
      .toBeNull();
  });
});
