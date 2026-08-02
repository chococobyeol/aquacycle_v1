import { describe, expect, it } from 'vitest';
import {
  RICEFISH_ECOLOGY_RULES,
  SCENARIOS,
  WATER_CYCLE_RULES,
} from '../src/simulation/config';
import {
  ricefishMouthPoint,
  SimulationWorld,
} from '../src/simulation/SimulationWorld';
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
  velocity: Vec2;
  facing: -1 | 1;
  poseAngle: number;
  bodyLength: number;
  lifeStage: 'egg' | 'fry' | 'juvenile' | 'adult';
  sex: 'female' | 'male';
  ageSeconds: number;
  lifespanSeconds: number;
  energy: number;
  health: number;
  growthProgress: number;
  storedBiomass: number;
  structuralBiomass: number;
  reproductiveBiomass: number;
  recentFood: string | null;
  reproductionCooldown: number;
  gestationRemaining: number | null;
  matingAccumulator: number;
  reproductiveCycleIndex?: number;
  behavior: string;
  behaviorTimer: number;
  targetAnimalId: string | null;
  courtshipPartnerId?: string | null;
  randomSeed: number;
};

type WorldInternals = {
  animals: InternalAnimal[];
  allCells(): Array<{ id: string }>;
  createRicefishEggState(
    parent: InternalAnimal,
    cell: { id: string },
    clutchIndex: number,
  ): InternalAnimal;
  ricefishFemaleReadyToMate(animal: InternalAnimal): boolean;
  ricefishMaleReadyToMate(animal: InternalAnimal): boolean;
  stepRicefishEcology(deltaSeconds: number): void;
  stepRicefishMotion(animal: InternalAnimal, deltaSeconds: number): void;
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

  it('keeps offspring traits independent from unrelated animal IDs', () => {
    const baseline = new SimulationWorld('laboratory');
    placeAnimal(baseline, RICEFISH, { x: 500, y: 220 });
    const shifted = new SimulationWorld('laboratory');
    for (let index = 0; index < 24; index += 1) {
      shifted.handle({
        type: 'pick-animal',
        speciesId: 'cherry-shrimp',
        point: { x: 400, y: 300 },
      });
      shifted.handle({ type: 'cancel-held' });
    }
    placeAnimal(shifted, RICEFISH, { x: 500, y: 220 });

    const baselineInternals = baseline as unknown as WorldInternals;
    const shiftedInternals = shifted as unknown as WorldInternals;
    const baselineParent = baselineInternals.animals.find(
      (animal) => animal.speciesId === RICEFISH,
    )!;
    const shiftedParent = shiftedInternals.animals.find(
      (animal) => animal.speciesId === RICEFISH,
    )!;
    const baselineCell = baselineInternals.allCells()[0]!;
    const shiftedCell = shiftedInternals.allCells()[0]!;
    const baselineEgg = baselineInternals.createRicefishEggState(
      baselineParent,
      baselineCell,
      0,
    );
    const shiftedEgg = shiftedInternals.createRicefishEggState(
      shiftedParent,
      shiftedCell,
      0,
    );

    expect(shiftedParent.randomSeed).toBe(baselineParent.randomSeed);
    expect({
      randomSeed: shiftedEgg.randomSeed,
      lifespanSeconds: shiftedEgg.lifespanSeconds,
      sex: shiftedEgg.sex,
    }).toEqual({
      randomSeed: baselineEgg.randomSeed,
      lifespanSeconds: baselineEgg.lifespanSeconds,
      sex: baselineEgg.sex,
    });
    expect(shiftedEgg.id).not.toBe(baselineEgg.id);
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
    shrimp.structuralBiomass =
      WATER_CYCLE_RULES.shrimp.juvenileBirthBiomass;
    shrimp.storedBiomass = 0;
    shrimp.reproductiveBiomass = 0;
    shrimp.growthProgress = 0;
    fish.position = { x: 600, y: 330 };
    fish.facing = 1;
    fish.poseAngle = 0;
    fish.randomSeed = 0;
    shrimp.position = ricefishMouthPoint(
      fish.position,
      fish.facing,
      fish.poseAngle,
      fish.bodyLength,
    );
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
    female.behavior = 'courting';
    male.behavior = 'courting';
    female.courtshipPartnerId = male.id;
    male.courtshipPartnerId = female.id;

    let hatched = false;
    for (let step = 0; step < 650; step += 1) {
      female.behavior = 'courting';
      male.behavior = 'courting';
      female.courtshipPartnerId = male.id;
      male.courtshipPartnerId = female.id;
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
    expect(snapshot.animalPopulationEventTotals.births).toBeGreaterThanOrEqual(3);
    expect(snapshot.animalPopulationEventTotals.hatches).toBeGreaterThanOrEqual(1);
    expect(snapshot.animalPopulationEvents.some((event) => event.kind === 'hatched')).toBe(true);
    const bornCohort = snapshot.animals.filter((animal) =>
      animal.speciesId === RICEFISH &&
      (animal.generation ?? 0) >= 1);
    expect(new Set(bornCohort.map((animal) => animal.sex)))
      .toEqual(new Set(['female', 'male']));
    expect(snapshot.animals.find((animal) => animal.lifeStage === 'fry')?.attachmentLabel)
      .toBeNull();
  });

  it('has the male follow a ready female without making her home symmetrically', () => {
    const world = new SimulationWorld('mission-8');
    placeAnimal(world, RICEFISH, { x: 900, y: 320 });
    placeAnimal(world, RICEFISH, { x: 1_280, y: 320 });
    const internals = world as unknown as WorldInternals;
    const female = internals.animals.find((animal) =>
      animal.speciesId === RICEFISH && animal.sex === 'female')!;
    const male = internals.animals.find((animal) =>
      animal.speciesId === RICEFISH && animal.sex === 'male')!;
    female.position = { x: 900, y: 320 };
    male.position = { x: 1_280, y: 320 };
    female.velocity = { x: 0, y: 0 };
    male.velocity = { x: 0, y: 0 };
    female.facing = 1;
    male.facing = -1;
    female.reproductionCooldown = 0;
    male.reproductionCooldown = 0;
    female.reproductiveBiomass =
      RICEFISH_ECOLOGY_RULES.eggClutchMinimum *
      WATER_CYCLE_RULES.ricefish.eggBiomass;
    female.storedBiomass = WATER_CYCLE_RULES.ricefish.adultReserveBiomass;
    male.storedBiomass = WATER_CYCLE_RULES.ricefish.adultReserveBiomass;
    female.energy = 1;
    male.energy = 1;
    female.health = 1;
    male.health = 1;

    const initialFemaleX = female.position.x;
    const initialMaleX = male.position.x;
    const initialDistance = male.position.x - female.position.x;
    internals.stepRicefishMotion(male, 0.1);
    internals.stepRicefishMotion(female, 0.1);

    expect(male.behavior).toBe('courting');
    expect(male.position.x).toBeLessThan(initialMaleX);
    expect(Math.abs(female.position.x - initialFemaleX))
      .toBeLessThan(initialMaleX - male.position.x);
    expect(male.position.x - female.position.x).toBeLessThan(initialDistance);
    expect(male.courtshipPartnerId).toBe(female.id);
    expect(female.courtshipPartnerId).toBeNull();

    // A distant olfactory cue can recruit the male, but the female does not
    // accept him and cannot accumulate mating contact at this distance.
    internals.stepRicefishEcology(0.1);
    expect(female.matingAccumulator).toBe(0);
    expect(female.gestationRemaining).toBeNull();

    for (let step = 0; step < 300 && female.gestationRemaining === null; step += 1) {
      internals.stepRicefishMotion(male, 0.1);
      internals.stepRicefishMotion(female, 0.1);
      internals.stepRicefishEcology(0.1);
    }

    const finalDistance = Math.hypot(
      male.position.x - female.position.x,
      male.position.y - female.position.y,
    );
    expect(finalDistance).toBeLessThanOrEqual(
      RICEFISH_ECOLOGY_RULES.matingContactRadius,
    );
    expect(female.gestationRemaining).not.toBeNull();
    expect(male.reproductionCooldown).toBeGreaterThan(0);
  });

  it('lets a receptive female choose one local displaying male instead of any nearby male', () => {
    const world = new SimulationWorld('laboratory');
    placeAnimal(world, RICEFISH, { x: 900, y: 320 });
    placeAnimal(world, RICEFISH, { x: 970, y: 320 });
    placeAnimal(world, RICEFISH, { x: 990, y: 320 });
    const internals = world as unknown as WorldInternals;
    const fish = internals.animals.filter((animal) =>
      animal.speciesId === RICEFISH);
    const female = fish[0]!;
    const nearerSmallMale = fish[1]!;
    const fartherLargeMale = fish[2]!;
    female.sex = 'female';
    nearerSmallMale.sex = 'male';
    fartherLargeMale.sex = 'male';
    female.position = { x: 900, y: 320 };
    nearerSmallMale.position = { x: 968, y: 320 };
    fartherLargeMale.position = { x: 982, y: 320 };
    nearerSmallMale.bodyLength = RICEFISH_ECOLOGY_RULES.adultLength * 0.86;
    fartherLargeMale.bodyLength = RICEFISH_ECOLOGY_RULES.adultLength * 1.12;
    female.reproductiveBiomass =
      RICEFISH_ECOLOGY_RULES.eggClutchMinimum *
      WATER_CYCLE_RULES.ricefish.eggBiomass;
    for (const animal of fish) {
      animal.energy = 1;
      animal.health = 1;
      animal.reproductionCooldown = 0;
    }
    nearerSmallMale.courtshipPartnerId = female.id;
    fartherLargeMale.courtshipPartnerId = female.id;
    nearerSmallMale.behavior = 'courting';
    fartherLargeMale.behavior = 'courting';

    internals.stepRicefishMotion(female, 0.01);

    expect(female.behavior).toBe('courting');
    expect(female.courtshipPartnerId).toBe(fartherLargeMale.id);

    // The ecology step must not silently mate her with the unselected male.
    nearerSmallMale.position = { x: 902, y: 320 };
    fartherLargeMale.position = { x: 980, y: 320 };
    fartherLargeMale.courtshipPartnerId = female.id;
    female.behavior = 'courting';
    fartherLargeMale.behavior = 'courting';
    internals.stepRicefishEcology(0.5);
    expect(female.matingAccumulator).toBe(0);
  });

  it('does not home when the female lacks egg matter or the male is cooling down', () => {
    const makePair = (): {
      internals: WorldInternals;
      female: InternalAnimal;
      male: InternalAnimal;
    } => {
      const world = new SimulationWorld('mission-8');
      placeAnimal(world, RICEFISH, { x: 900, y: 320 });
      placeAnimal(world, RICEFISH, { x: 1_280, y: 320 });
      const internals = world as unknown as WorldInternals;
      const female = internals.animals.find((animal) =>
        animal.speciesId === RICEFISH && animal.sex === 'female')!;
      const male = internals.animals.find((animal) =>
        animal.speciesId === RICEFISH && animal.sex === 'male')!;
      female.position = { x: 900, y: 320 };
      male.position = { x: 1_280, y: 320 };
      female.velocity = { x: 0, y: 0 };
      male.velocity = { x: 0, y: 0 };
      female.reproductionCooldown = 0;
      male.reproductionCooldown = 0;
      female.energy = 1;
      male.energy = 1;
      female.health = 1;
      male.health = 1;
      return { internals, female, male };
    };

    const unfunded = makePair();
    unfunded.female.reproductiveBiomass = 0;
    unfunded.internals.stepRicefishMotion(unfunded.female, 0.1);
    unfunded.internals.stepRicefishMotion(unfunded.male, 0.1);
    expect(unfunded.female.behavior).not.toBe('courting');
    expect(unfunded.male.behavior).not.toBe('courting');

    const coolingDown = makePair();
    coolingDown.female.reproductiveBiomass =
      RICEFISH_ECOLOGY_RULES.eggClutchMinimum *
      WATER_CYCLE_RULES.ricefish.eggBiomass;
    coolingDown.male.reproductionCooldown = 35;
    coolingDown.internals.stepRicefishMotion(coolingDown.female, 0.1);
    coolingDown.internals.stepRicefishMotion(coolingDown.male, 0.1);
    expect(coolingDown.female.behavior).not.toBe('courting');
    expect(coolingDown.male.behavior).not.toBe('courting');
  });

  it('makes food-stressed adults restore their own condition before courtship', () => {
    const world = new SimulationWorld('mission-8');
    placeAnimal(world, RICEFISH, { x: 900, y: 320 });
    placeAnimal(world, RICEFISH, { x: 980, y: 320 });
    const internals = world as unknown as WorldInternals;
    const female = internals.animals.find((animal) =>
      animal.speciesId === RICEFISH && animal.sex === 'female')!;
    const male = internals.animals.find((animal) =>
      animal.speciesId === RICEFISH && animal.sex === 'male')!;

    female.health = 1;
    female.reproductionCooldown = 0;
    female.gestationRemaining = null;
    female.reproductiveBiomass =
      RICEFISH_ECOLOGY_RULES.eggClutchMinimum *
      WATER_CYCLE_RULES.ricefish.eggBiomass;
    female.energy = RICEFISH_ECOLOGY_RULES.reproductionEnergy - 0.001;
    expect(internals.ricefishFemaleReadyToMate(female)).toBe(false);
    female.energy = RICEFISH_ECOLOGY_RULES.reproductionEnergy;
    expect(internals.ricefishFemaleReadyToMate(female)).toBe(true);

    male.health = 1;
    male.reproductionCooldown = 0;
    male.energy = RICEFISH_ECOLOGY_RULES.matingEnergy - 0.001;
    expect(internals.ricefishMaleReadyToMate(male)).toBe(false);
    male.energy = RICEFISH_ECOLOGY_RULES.matingEnergy;
    expect(internals.ricefishMaleReadyToMate(male)).toBe(true);
  });
});
