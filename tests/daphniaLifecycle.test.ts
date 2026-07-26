import { describe, expect, it } from 'vitest';
import { SimulationWorld } from '../src/simulation/SimulationWorld';
import { BiogeochemistryLedger } from '../src/simulation/biogeochemistry';
import {
  continuousBodyMassFeedingScale,
  continuousBodyMassMaintenance,
  DAPHNIA_BODY_BUDGET,
  PLANKTON_ECOLOGY_RULES,
  SHRIMP_ECOLOGY_RULES,
  WATER_CYCLE_RULES,
} from '../src/simulation/config';
import { CLOSED_MATERIAL_RELATIVE_TOLERANCE } from '../src/simulation/stoichiometry';
import {
  GROUND_Y,
  TANK_WIDTH,
  WATER_TOP,
  type Vec2,
} from '../src/simulation/types';

const inoculateDaphnia = (world: SimulationWorld): void => {
  const point = { x: 520, y: 310 };
  world.handle({ type: 'pick-plankton', planktonKind: 'daphnia', point });
  world.handle({ type: 'drop-held', point });
};

interface DaphniaMotionInternals {
  animals: Array<{
    speciesId: string;
    position: Vec2;
  }>;
  biogeochemistry: BiogeochemistryLedger;
  stepAnimalMotion(deltaSeconds: number): void;
}

const daphniaMotionInternals = (
  world: SimulationWorld,
): DaphniaMotionInternals =>
  world as unknown as DaphniaMotionInternals;

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

describe('individual Daphnia life cycle', () => {
  it('keeps the compressed Daphnia life cycle shorter than the shrimp life cycle', () => {
    const daphnia = PLANKTON_ECOLOGY_RULES.daphnia;
    const daphniaMean = (
      daphnia.minimumLifespanSeconds + daphnia.maximumLifespanSeconds
    ) / 2;
    const shrimpMean = (
      SHRIMP_ECOLOGY_RULES.minimumLifespanSeconds +
      SHRIMP_ECOLOGY_RULES.maximumLifespanSeconds
    ) / 2;

    expect(daphniaMean).toBeLessThan(shrimpMean);
    expect(daphnia.maturationSeconds + daphnia.broodDevelopmentSeconds)
      .toBeLessThan(daphnia.minimumLifespanSeconds);
  });

  it('uses one Daphnia body budget in the ledger and individual model', () => {
    const daphnia = PLANKTON_ECOLOGY_RULES.daphnia;
    expect(WATER_CYCLE_RULES.daphnia.adultStructuralBiomass)
      .toBe(DAPHNIA_BODY_BUDGET.adultStructuralBiomass);
    expect(WATER_CYCLE_RULES.daphnia.juvenileBirthBiomass)
      .toBe(DAPHNIA_BODY_BUDGET.juvenileBirthBiomass);
    expect(WATER_CYCLE_RULES.daphnia.suppliedReserveBiomass)
      .toBe(DAPHNIA_BODY_BUDGET.suppliedReserveBiomass);
    expect(daphnia.adultStructuralBiomass)
      .toBe(DAPHNIA_BODY_BUDGET.adultStructuralBiomass);
    expect(daphnia.juvenileBirthBiomass)
      .toBe(DAPHNIA_BODY_BUDGET.juvenileBirthBiomass);
    expect(daphnia.adultReserveCapacity)
      .toBe(DAPHNIA_BODY_BUDGET.adultReserveBiomass);
    expect(daphnia.maturationStructuralBiomass).toBeCloseTo(
      daphnia.adultStructuralBiomass *
        daphnia.maturationStructuralFraction,
      12,
    );
    expect(daphnia.maturationStructuralBiomass)
      .toBeGreaterThan(daphnia.adultMinimumStructure);
  });

  it('stores Daphnia biomass only on individuals, not in a second density ledger', () => {
    const world = new SimulationWorld('mission-7');
    inoculateDaphnia(world);
    const snapshot = world.snapshot();
    const animals = snapshot.animals.filter((animal) => animal.speciesId === 'daphnia');

    expect(animals).toHaveLength(1);
    expect(animals[0]).toMatchObject({ x: 520, y: 310 });
    expect(snapshot.biogeochemistry.plankton.approximateDaphniaCount).toBe(1);
    const savedAnimal = world.exportSaveData().animals.find(
      (animal) => animal.speciesId === 'daphnia',
    );
    expect(savedAnimal).toBeDefined();
    const conservedIndividualBiomass = savedAnimal
      ? savedAnimal.structuralBiomass +
        savedAnimal.storedBiomass +
        (savedAnimal.reproductiveBiomass ?? 0)
      : 0;
    expect(snapshot.biogeochemistry.plankton.daphniaAdultBiomass).toBeCloseTo(
      conservedIndividualBiomass,
      8,
    );
    expect(snapshot.biogeochemistry.water.daphniaAdults.every((value) => value === 0))
      .toBe(true);
    expect(snapshot.biogeochemistry.water.daphniaJuveniles.every((value) => value === 0))
      .toBe(true);
  });

  it('freezes individual motion while paused and resumes from the same positions', () => {
    const world = new SimulationWorld('mission-7');
    inoculateDaphnia(world);
    world.handle({ type: 'start' });
    for (let index = 0; index < 20; index += 1) world.tick(0.05);
    world.handle({ type: 'pause' });
    const before = world.motionSnapshot().animals
      .filter((animal) => animal.speciesId === 'daphnia')
      .map((animal) => [animal.id, animal.x, animal.y]);

    for (let index = 0; index < 40; index += 1) world.tick(0.05);
    const paused = world.motionSnapshot().animals
      .filter((animal) => animal.speciesId === 'daphnia')
      .map((animal) => [animal.id, animal.x, animal.y]);
    expect(paused).toEqual(before);

    world.handle({ type: 'resume' });
    for (let index = 0; index < 20; index += 1) world.tick(0.05);
    const resumed = world.motionSnapshot().animals
      .filter((animal) => animal.speciesId === 'daphnia');
    expect(resumed.some((animal, index) =>
      Math.hypot(
        animal.x - Number(before[index][1]),
        animal.y - Number(before[index][2]),
      ) > 0.2,
    )).toBe(true);
  });

  it('turns back into the water instead of remaining pinned to the glass', () => {
    const world = new SimulationWorld('mission-7');
    inoculateDaphnia(world);
    const save = world.exportSaveData();
    const daphnia = save.animals.find((animal) => animal.speciesId === 'daphnia');
    expect(daphnia).toBeDefined();
    if (!daphnia) return;
    daphnia.position = { x: 1_190, y: 310 };
    daphnia.velocity = { x: 80, y: 0 };
    world.loadSaveData(save);
    world.handle({ type: 'start' });

    let minimumX = Number.POSITIVE_INFINITY;
    for (let index = 0; index < 200; index += 1) {
      world.tick(0.05);
      const target = world.motionSnapshot().animals
        .find((animal) => animal.speciesId === 'daphnia');
      expect(target).toBeDefined();
      if (target) minimumX = Math.min(minimumX, target.x);
    }

    expect(minimumX).toBeLessThan(1_170);
  });

  it('crosses the water column without accumulating at the surface', () => {
    const world = new SimulationWorld('mission-7');
    const point = { x: 600, y: 330 };
    world.handle({ type: 'pick-plankton', planktonKind: 'daphnia', point });
    world.handle({ type: 'drop-held', point });
    world.handle({ type: 'start' });

    let minimumX = Number.POSITIVE_INFINITY;
    let maximumX = Number.NEGATIVE_INFINITY;
    let minimumY = Number.POSITIVE_INFINITY;
    let maximumY = Number.NEGATIVE_INFINITY;
    let surfaceSamples = 0;
    let samples = 0;
    for (let index = 0; index < 1_800; index += 1) {
      world.tick(0.1);
      const animal = world.motionSnapshot().animals
        .find((candidate) => candidate.speciesId === 'daphnia');
      expect(animal).toBeDefined();
      if (!animal) break;
      minimumX = Math.min(minimumX, animal.x);
      maximumX = Math.max(maximumX, animal.x);
      minimumY = Math.min(minimumY, animal.y);
      maximumY = Math.max(maximumY, animal.y);
      if (animal.y < 180) surfaceSamples += 1;
      samples += 1;
    }

    expect(maximumX - minimumX).toBeGreaterThan(240);
    expect(maximumY - minimumY).toBeGreaterThan(120);
    expect(surfaceSamples / samples).toBeLessThan(0.4);
  }, 15_000);

  it('leaves an immediately harmful water pocket using only local cues', () => {
    const world = new SimulationWorld('mission-7');
    const start = { x: 600, y: 560 };
    world.handle({
      type: 'pick-plankton',
      planktonKind: 'daphnia',
      point: start,
    });
    world.handle({ type: 'drop-held', point: start });
    const internals = daphniaMotionInternals(world);
    const fields = internals.biogeochemistry as unknown as {
      oxygen: Float64Array;
      toxicWaste: Float64Array;
    };
    fields.oxygen.fill(78);
    fields.toxicWaste.fill(1);
    const startIndex = waterFieldIndex(start);
    fields.oxygen[startIndex] = 5;
    fields.toxicWaste[startIndex] = 18;

    const before = internals.biogeochemistry.sampleAt(start);
    internals.stepAnimalMotion(1);
    const moved = internals.animals.find(
      (animal) => animal.speciesId === 'daphnia',
    );
    expect(moved).toBeDefined();
    if (!moved) return;
    const after = internals.biogeochemistry.sampleAt(moved.position);

    expect(Math.hypot(
      moved.position.x - start.x,
      moved.position.y - start.y,
    )).toBeGreaterThan(20);
    expect(after.oxygen).toBeGreaterThan(before.oxygen);
    expect(after.toxicWaste).toBeLessThan(before.toxicWaste);
  });

  it('finds and actually filters a nearby phytoplankton patch', () => {
    const world = new SimulationWorld('mission-7');
    const foodPoint = { x: 520, y: 400 };
    const animalPoint = { x: 520, y: 300 };
    world.handle({
      type: 'pick-plankton',
      planktonKind: 'phytoplankton',
      point: foodPoint,
    });
    world.handle({ type: 'drop-held', point: foodPoint });
    world.handle({
      type: 'pick-plankton',
      planktonKind: 'daphnia',
      point: animalPoint,
    });
    world.handle({ type: 'drop-held', point: animalPoint });
    world.handle({ type: 'start' });

    for (let index = 0; index < 400; index += 1) world.tick(0.05);
    const animal = world.snapshot().animals
      .find((candidate) => candidate.speciesId === 'daphnia');

    expect(animal).toBeDefined();
    expect(Math.hypot(
      (animal?.x ?? animalPoint.x) - animalPoint.x,
      (animal?.y ?? animalPoint.y) - animalPoint.y,
    )).toBeGreaterThan(10);
    expect(animal?.consumedBiomass ?? 0).toBeGreaterThan(0.00125);
    expect(animal?.secondsSinceFood ?? Number.POSITIVE_INFINITY).toBeLessThan(2);
  }, 15_000);

  it('keeps a dead Daphnia visible long enough to read at high speed', () => {
    const world = new SimulationWorld('mission-7');
    inoculateDaphnia(world);
    const save = world.exportSaveData();
    const daphnia = save.animals.find((animal) => animal.speciesId === 'daphnia');
    expect(daphnia).toBeDefined();
    if (!daphnia) return;
    daphnia.ageSeconds = 100;
    daphnia.lifespanSeconds = 101;
    world.loadSaveData(save);
    world.handle({ type: 'start' });
    world.handle({ type: 'set-speed', speed: 64 });
    world.tick(0.1);

    const dead = world.snapshot().carcasses
      .find((carcass) => carcass.speciesId === 'daphnia');
    expect(dead).toMatchObject({ cause: 'old-age' });

    for (let index = 0; index < 15; index += 1) world.tick(0.1);
    expect(world.snapshot().carcasses.some(
      (carcass) => carcass.speciesId === 'daphnia',
    )).toBe(true);

    for (let index = 0; index < 10; index += 1) world.tick(0.1);
    expect(world.snapshot().carcasses.some(
      (carcass) => carcass.speciesId === 'daphnia',
    )).toBe(false);
  });

  it('continues an already funded brood through a temporary food trough', () => {
    const world = new SimulationWorld('mission-7');
    inoculateDaphnia(world);
    const save = world.exportSaveData();
    const mother = save.animals.find((animal) => animal.speciesId === 'daphnia');
    expect(mother).toBeDefined();
    if (!mother) return;

    const rules = PLANKTON_ECOLOGY_RULES.daphnia;
    mother.lifeStage = 'adult';
    mother.reproductiveBiomass = rules.juvenileBirthBiomass * 2;
    mother.gestatingBroodSize = rules.minimumBroodSize;
    mother.gestationRemaining = 1;
    mother.moltCycleSeconds = rules.broodCooldownSeconds;
    mother.moltProgress = 0.98;
    mother.moltCount = rules.maturationInstarsMaximum;
    mother.reproductionCooldown =
      (1 - mother.moltProgress) * mother.moltCycleSeconds;
    mother.storedBiomass = Math.max(
      mother.storedBiomass,
      rules.reproductiveReserveFloor,
    );
    world.loadSaveData(save);
    world.handle({ type: 'start' });

    for (
      let elapsed = 0;
      elapsed < 30;
      elapsed += 0.1
    ) {
      world.tick(0.1);
    }

    const offspring = world.exportSaveData().animals.filter(
      (animal) =>
        animal.speciesId === 'daphnia' &&
        animal.origin === 'born',
    );
    expect(offspring.length).toBeGreaterThanOrEqual(1);
    expect(offspring.every((animal) => animal.parentId === mother.id)).toBe(true);
    expect(offspring).toHaveLength(rules.minimumBroodSize);
    expect(offspring.reduce(
      (total, animal) =>
        total +
        animal.structuralBiomass +
        animal.storedBiomass +
        (animal.reproductiveBiomass ?? 0),
      0,
    )).toBeGreaterThan(
      rules.minimumBroodSize * rules.juvenileBirthBiomass * 0.95,
    );
    const afterMother = world.exportSaveData().animals.find(
      (animal) => animal.id === mother.id,
    );
    // The released brood consumes exactly one neonate's mass. A second funded
    // ovary reserve may remain and be deposited at the same molt.
    expect(afterMother?.reproductiveBiomass ?? Number.NaN)
      .toBeCloseTo(rules.juvenileBirthBiomass, 8);
    const balance = world.snapshot().biogeochemistry.materialBalance;
    expect(Math.abs(balance.nitrogenDriftRatio))
      .toBeLessThan(CLOSED_MATERIAL_RELATIVE_TOLERANCE);
    expect(Math.abs(balance.carbonDriftRatio))
      .toBeLessThan(CLOSED_MATERIAL_RELATIVE_TOLERANCE);
    expect(Math.abs(balance.oxygenEquivalentDriftRatio))
      .toBeLessThan(CLOSED_MATERIAL_RELATIVE_TOLERANCE);
  });

  it('matures without a mass jump and keeps growing as a reproductive adult', () => {
    const world = new SimulationWorld('mission-7');
    const point = { x: 600, y: 330 };
    const internals = world as unknown as {
      biogeochemistry: {
        addPlankton(
          point: { x: number; y: number },
          kind: 'phytoplankton',
          biomass: number,
        ): number;
      };
    };
    internals.biogeochemistry.addPlankton(point, 'phytoplankton', 24);
    inoculateDaphnia(world);
    const save = world.exportSaveData();
    const animal = save.animals.find(
      (candidate) => candidate.speciesId === 'daphnia',
    );
    expect(animal).toBeDefined();
    if (!animal) return;
    const rules = PLANKTON_ECOLOGY_RULES.daphnia;
    animal.lifeStage = 'juvenile';
    animal.origin = 'born';
    animal.ageSeconds = 1;
    animal.structuralBiomass = rules.maturationStructuralBiomass;
    animal.storedBiomass = rules.juvenileBirthBiomass;
    animal.reproductiveBiomass = 0;
    animal.maturationTargetInstars = rules.maturationInstarsMinimum;
    animal.moltCount = rules.maturationInstarsMinimum - 1;
    animal.moltCycleSeconds =
      rules.maturationSeconds / rules.maturationInstarsMinimum;
    animal.moltProgress = 0.999;
    animal.growthProgress =
      animal.structuralBiomass / rules.adultStructuralBiomass;
    const matterBeforeTransition =
      animal.structuralBiomass +
      animal.storedBiomass +
      animal.reproductiveBiomass;
    world.loadSaveData(save);
    world.handle({ type: 'start' });
    for (let index = 0; index < 4; index += 1) world.tick(0.1);

    const matured = world.exportSaveData().animals.find(
      (candidate) => candidate.id === animal.id,
    );
    expect(matured).toBeDefined();
    if (!matured) return;
    expect(matured.lifeStage).toBe('adult');
    expect(matured.growthProgress).toBeLessThan(1);
    expect(matured.bodyLength).toBeLessThan(9);
    expect(matured.reproductionCooldown).toBeGreaterThan(0);
    expect(matured.reproductionCooldown)
      .toBeLessThan(matured.moltCycleSeconds ?? Number.POSITIVE_INFINITY);
    expect(matured.moltProgress ?? 0).toBeGreaterThanOrEqual(0.55);
    expect(matured.moltProgress ?? 1).toBeLessThanOrEqual(0.9);
    const matterAfterTransition =
      matured.structuralBiomass +
      matured.storedBiomass +
      (matured.reproductiveBiomass ?? 0);
    // The only change across the label transition is the explicitly booked
    // sub-tick feeding/respiration, never a jump to full adult structure.
    expect(Math.abs(matterAfterTransition - matterBeforeTransition))
      .toBeLessThan(0.0005);

    const structureAtMaturity = matured.structuralBiomass;
    for (let index = 0; index < 200; index += 1) world.tick(0.1);
    const grown = world.exportSaveData().animals.find(
      (candidate) => candidate.id === animal.id,
    );
    expect(grown?.structuralBiomass ?? 0).toBeGreaterThan(
      structureAtMaturity + 0.0001,
    );
    expect(grown?.structuralBiomass ?? Number.POSITIVE_INFINITY)
      .toBeLessThanOrEqual(rules.adultStructuralBiomass);
    const balance = world.snapshot().biogeochemistry.materialBalance;
    // This isolated fixture injects an extremely concentrated point patch
    // through the low-level grid helper. Interpolation round-off is larger
    // than in a normally inoculated world, but remains far below any
    // ecologically meaningful amount. Whole-world conservation is enforced
    // at the stricter shared tolerance by closedCycleMassBalance.test.ts.
    expect(Math.abs(balance.nitrogenDriftRatio)).toBeLessThan(1e-7);
    expect(Math.abs(balance.carbonDriftRatio)).toBeLessThan(1e-7);
    expect(Math.abs(balance.oxygenEquivalentDriftRatio)).toBeLessThan(1e-7);
  });

  it('does not classify a well-fed growing juvenile as chronically starving', () => {
    const world = new SimulationWorld('mission-7');
    const point = { x: 600, y: 330 };
    const internals = world as unknown as {
      biogeochemistry: {
        addPlankton(
          point: Vec2,
          kind: 'phytoplankton',
          biomass: number,
        ): number;
      };
    };
    internals.biogeochemistry.addPlankton(point, 'phytoplankton', 24);
    inoculateDaphnia(world);
    const save = world.exportSaveData();
    const juvenile = save.animals.find(
      (animal) => animal.speciesId === 'daphnia',
    );
    expect(juvenile).toBeDefined();
    if (!juvenile) return;
    const rules = PLANKTON_ECOLOGY_RULES.daphnia;
    juvenile.lifeStage = 'juvenile';
    juvenile.origin = 'born';
    juvenile.ageSeconds = 0;
    juvenile.structuralBiomass = rules.juvenileMinimumStructure;
    juvenile.storedBiomass =
      rules.juvenileBirthBiomass - rules.juvenileMinimumStructure;
    juvenile.reproductiveBiomass = 0;
    juvenile.energy =
      juvenile.storedBiomass / rules.juvenileReserveCapacity;
    juvenile.health = 1;
    juvenile.growthProgress =
      juvenile.structuralBiomass / rules.adultStructuralBiomass;
    world.loadSaveData(save);
    world.handle({ type: 'start' });
    world.handle({ type: 'set-speed', speed: 64 });

    while (world.snapshot().elapsedSeconds < 120) world.tick(0.1);
    const growing = world.exportSaveData().animals.find(
      (animal) => animal.id === juvenile.id,
    );

    expect(growing?.lifeStage).toBe('juvenile');
    expect(growing?.structuralBiomass ?? 0)
      .toBeGreaterThan(juvenile.structuralBiomass);
    expect(growing?.energy ?? 0)
      .toBeGreaterThanOrEqual(rules.juvenileProtectedReserveFraction - 0.01);
    expect(growing?.health ?? 0).toBeGreaterThan(0.99);
  });

  it('pays current maintenance and egg allocation before overflowing a full reserve', () => {
    const world = new SimulationWorld('mission-7');
    const point = { x: 600, y: 330 };
    const internals = world as unknown as {
      biogeochemistry: {
        addPlankton(
          point: { x: number; y: number },
          kind: 'phytoplankton',
          biomass: number,
        ): number;
      };
    };
    internals.biogeochemistry.addPlankton(point, 'phytoplankton', 24);
    inoculateDaphnia(world);
    const save = world.exportSaveData();
    const adult = save.animals.find(
      (animal) => animal.speciesId === 'daphnia',
    );
    expect(adult).toBeDefined();
    if (!adult) return;
    const rules = PLANKTON_ECOLOGY_RULES.daphnia;
    adult.lifeStage = 'adult';
    adult.structuralBiomass = rules.adultStructuralBiomass;
    adult.storedBiomass = rules.adultReserveCapacity;
    adult.reproductiveBiomass = 0;
    adult.reproductionCooldown = 0;
    // This test deliberately replaces individual matter in an exported save.
    // Establish a fresh conservation reference after that fixture mutation.
    save.materialReference = null;
    world.loadSaveData(save);
    world.handle({ type: 'start' });
    for (let index = 0; index < 20; index += 1) world.tick(0.05);

    const after = world.exportSaveData().animals.find(
      (animal) => animal.id === adult.id,
    );
    expect(after).toBeDefined();
    if (!after) return;
    expect(after.consumedBiomass).toBeGreaterThan(0);
    expect(after.reproductiveBiomass ?? 0).toBeGreaterThan(0);
    expect(after.storedBiomass).toBeCloseTo(rules.adultReserveCapacity, 8);
    const balance = world.snapshot().biogeochemistry.materialBalance;
    expect(Math.abs(balance.nitrogenDriftRatio)).toBeLessThan(1e-7);
    expect(Math.abs(balance.carbonDriftRatio)).toBeLessThan(1e-7);
    expect(Math.abs(balance.oxygenEquivalentDriftRatio)).toBeLessThan(1e-7);
  });

  it('releases multiple fully funded broods within one compressed lifespan', () => {
    const world = new SimulationWorld('mission-7');
    const point = { x: 600, y: 330 };
    const internals = world as unknown as {
      biogeochemistry: {
        addPlankton(
          point: { x: number; y: number },
          kind: 'phytoplankton',
          biomass: number,
        ): number;
      };
    };
    internals.biogeochemistry.addPlankton(point, 'phytoplankton', 24);
    inoculateDaphnia(world);
    const save = world.exportSaveData();
    const animal = save.animals.find(
      (candidate) => candidate.speciesId === 'daphnia',
    );
    expect(animal).toBeDefined();
    if (!animal) return;
    const rules = PLANKTON_ECOLOGY_RULES.daphnia;
    animal.lifeStage = 'juvenile';
    animal.origin = 'born';
    animal.ageSeconds = 0;
    animal.structuralBiomass = rules.juvenileMinimumStructure;
    animal.storedBiomass =
      rules.juvenileBirthBiomass - rules.juvenileMinimumStructure;
    animal.reproductiveBiomass = 0;
    animal.growthProgress =
      animal.structuralBiomass / rules.adultStructuralBiomass;
    animal.generation = 1;
    animal.lifespanSeconds = rules.maximumLifespanSeconds;
    world.loadSaveData(save);
    world.handle({ type: 'start' });
    world.handle({ type: 'set-speed', speed: 64 });

    let snapshot = world.snapshot();
    let directBirthTimes: number[] = [];
    let guard = 0;
    while (
      directBirthTimes.length < 2 &&
      snapshot.elapsedSeconds < rules.maximumLifespanSeconds
    ) {
      world.tick(0.1);
      snapshot = world.snapshot();
      directBirthTimes = Array.from(new Set(
        snapshot.animalPopulationEvents
          .filter(
            (event) =>
              event.kind === 'birth' &&
              event.parentId === animal.id,
          )
          .map((event) => Number(event.elapsedSeconds.toFixed(3))),
      ));
      guard += 1;
      if (guard > 500) break;
    }
    const maturation = snapshot.animalPopulationEvents.find(
      (event) =>
        event.kind === 'matured' &&
        event.animalId === animal.id,
    );
    expect(maturation).toBeDefined();
    expect(animal.maturationTargetInstars).toBeGreaterThanOrEqual(
      rules.maturationInstarsMinimum,
    );
    expect(animal.maturationTargetInstars).toBeLessThanOrEqual(
      rules.maturationInstarsMaximum,
    );
    expect(directBirthTimes).toHaveLength(2);
    expect(directBirthTimes[0]).toBeGreaterThan(
      maturation?.elapsedSeconds ?? 0,
    );
    expect(directBirthTimes[1] - directBirthTimes[0])
      .toBeGreaterThanOrEqual(
        rules.broodCooldownSeconds *
          rules.adultMoltCycleMinimumFactor *
          0.8,
      );
    expect(directBirthTimes[1] - directBirthTimes[0])
      .toBeLessThanOrEqual(
        rules.broodCooldownSeconds *
          rules.adultMoltCycleMaximumFactor *
          1.3,
      );
    expect(directBirthTimes[1])
      .toBeLessThan(animal.lifespanSeconds);
  }, 60_000);

  it('gives a neonate lower absolute but higher mass-specific filtration than an adult', () => {
    const world = new SimulationWorld('mission-7');
    const points = [
      { x: 330, y: 310 },
      { x: 870, y: 310 },
    ] as const;
    for (const point of points) {
      world.handle({
        type: 'pick-plankton',
        planktonKind: 'phytoplankton',
        point,
      });
      world.handle({ type: 'drop-held', point });
      world.handle({ type: 'pick-plankton', planktonKind: 'daphnia', point });
      world.handle({ type: 'drop-held', point });
    }
    const save = world.exportSaveData();
    const animals = save.animals.filter(
      (animal) => animal.speciesId === 'daphnia',
    );
    expect(animals).toHaveLength(2);
    const [juvenile, adult] = animals;
    const rules = PLANKTON_ECOLOGY_RULES.daphnia;
    juvenile.lifeStage = 'juvenile';
    juvenile.ageSeconds = 0;
    juvenile.structuralBiomass = rules.juvenileMinimumStructure;
    juvenile.storedBiomass =
      rules.juvenileBirthBiomass - rules.juvenileMinimumStructure;
    juvenile.reproductiveBiomass = 0;
    juvenile.consumedBiomass = 0;
    adult.consumedBiomass = 0;
    world.loadSaveData(save);
    world.handle({ type: 'start' });
    for (let index = 0; index < 20; index += 1) world.tick(0.05);

    const after = world.exportSaveData().animals.filter(
      (animal) => animal.speciesId === 'daphnia',
    );
    const fedJuvenile = after.find((animal) => animal.id === juvenile.id);
    const fedAdult = after.find((animal) => animal.id === adult.id);
    expect(fedJuvenile).toBeDefined();
    expect(fedAdult).toBeDefined();
    if (!fedJuvenile || !fedAdult) return;
    const juvenileMass = rules.juvenileBirthBiomass;
    const adultMass = adult.structuralBiomass + adult.storedBiomass;
    expect(fedJuvenile.consumedBiomass).toBeLessThan(
      fedAdult.consumedBiomass,
    );
    expect(fedJuvenile.consumedBiomass / juvenileMass).toBeGreaterThan(
      fedAdult.consumedBiomass / adultMass,
    );
  });

  it('keeps neonate clearance below fifteen percent of the adult reference', () => {
    const rules = PLANKTON_ECOLOGY_RULES.daphnia;
    const birthScale = continuousBodyMassFeedingScale(
      rules.juvenileBirthBiomass,
      rules.representativeAdultBiomass,
      rules.filtrationMassExponent,
    );

    expect(birthScale).toBeGreaterThan(0.1);
    expect(birthScale).toBeLessThan(0.12);
    expect(birthScale).toBeLessThan(0.15);
  });

  it('keeps maintenance continuous across maturation', () => {
    const rules = PLANKTON_ECOLOGY_RULES.daphnia;
    const threshold = rules.maturationStructuralBiomass;
    const justBelow = continuousBodyMassMaintenance(
      threshold * (1 - 1e-6),
      rules.representativeAdultBiomass,
      rules.adultMaintenancePerSecond,
      rules.maintenanceMassExponent,
    );
    const justAbove = continuousBodyMassMaintenance(
      threshold * (1 + 1e-6),
      rules.representativeAdultBiomass,
      rules.adultMaintenancePerSecond,
      rules.maintenanceMassExponent,
    );
    const adultReference = continuousBodyMassMaintenance(
      rules.representativeAdultBiomass,
      rules.representativeAdultBiomass,
      rules.adultMaintenancePerSecond,
      rules.maintenanceMassExponent,
    );

    expect(justAbove / justBelow).toBeCloseTo(1, 5);
    expect(justBelow / (threshold * (1 - 1e-6))).toBeGreaterThan(
      adultReference / rules.representativeAdultBiomass,
    );
  });
});
