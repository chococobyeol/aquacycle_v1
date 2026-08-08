import { describe, expect, it } from 'vitest';
import {
  shrimpMaintenanceDeficitClockDelta,
  SimulationWorld,
} from '../src/simulation/SimulationWorld';
import {
  continuousBodyMassMaintenance,
  SHRIMP_ECOLOGY_RULES,
  WATER_CYCLE_RULES,
} from '../src/simulation/config';
import type {
  AnimalLifeStage,
  AnimalSpeciesId,
  Vec2,
} from '../src/simulation/types';

interface TestAnimal {
  id: string;
  speciesId: AnimalSpeciesId;
  lifeStage: AnimalLifeStage;
  ageSeconds: number;
  lifespanSeconds: number;
  health: number;
  energy: number;
  structuralBiomass: number;
  peakStructuralBiomass?: number;
  storedBiomass: number;
  secondsSinceFood: number;
  behavior: string;
}

interface StarvationWorldInternals {
  animals: TestAnimal[];
  carcasses: Array<{
    sourceAnimalId: string;
    cause: string;
  }>;
  stepAnimalEcology(deltaSeconds: number): void;
  stepAnimalMotion(deltaSeconds: number): void;
  stepRicefishEcology(deltaSeconds: number): void;
}

interface ShrimpBirthInternals extends StarvationWorldInternals {
  createJuvenileAnimalState(
    parent: TestAnimal,
    clutchIndex: number,
  ): TestAnimal;
  shrimpReserveCapacity(animal: TestAnimal): number;
}

const internalsOf = (
  world: SimulationWorld,
): StarvationWorldInternals =>
  world as unknown as StarvationWorldInternals;

const placeAnimal = (
  world: SimulationWorld,
  speciesId: AnimalSpeciesId,
  point: Vec2,
): void => {
  world.handle({ type: 'pick-animal', speciesId, point });
  world.handle({ type: 'drop-held', point });
};

const placeDaphnia = (world: SimulationWorld, point: Vec2): void => {
  world.handle({ type: 'pick-plankton', planktonKind: 'daphnia', point });
  world.handle({ type: 'drop-held', point });
};

const advanceUntilDeath = (
  world: StarvationWorldInternals,
  animalId: string,
  maximumSeconds: number,
  ricefishOnly = false,
  stepSeconds = 1,
): number => {
  let elapsed = 0;
  while (
    world.animals.some((animal) => animal.id === animalId) &&
    elapsed < maximumSeconds
  ) {
    if (ricefishOnly) world.stepRicefishEcology(stepSeconds);
    else world.stepAnimalEcology(stepSeconds);
    elapsed += stepSeconds;
  }
  return elapsed;
};

describe('compressed starvation calibration', () => {
  it('keeps small-shrimp maintenance on one monotonic allometric curve', () => {
    const adultReferenceMass =
      WATER_CYCLE_RULES.shrimp.adultStructuralBiomass;
    const maintenanceAt = (structuralBiomass: number): number =>
      continuousBodyMassMaintenance(
        structuralBiomass,
        adultReferenceMass,
        SHRIMP_ECOLOGY_RULES.adultRoutineMaintenanceBiomassPerSecond /
          adultReferenceMass,
        SHRIMP_ECOLOGY_RULES.metabolicMassExponent,
      );
    const hatchlingStructure =
      WATER_CYCLE_RULES.shrimp.juvenileBirthBiomass /
      (
        1 + WATER_CYCLE_RULES.shrimp.adultReserveBiomass /
          adultReferenceMass
      );
    const suppliedYoungAdultStructure = 0.09;
    const hatchlingMaintenance = maintenanceAt(hatchlingStructure);
    const youngAdultMaintenance = maintenanceAt(suppliedYoungAdultStructure);
    const referenceAdultMaintenance = maintenanceAt(adultReferenceMass);

    expect(hatchlingMaintenance).toBeLessThan(youngAdultMaintenance);
    expect(youngAdultMaintenance).toBeLessThan(referenceAdultMaintenance);
    expect(hatchlingMaintenance / referenceAdultMaintenance)
      .toBeCloseTo(
        Math.pow(
          hatchlingStructure / adultReferenceMass,
          SHRIMP_ECOLOGY_RULES.metabolicMassExponent,
        ),
        10,
      );
    expect(youngAdultMaintenance / referenceAdultMaintenance)
      .toBeCloseTo(
        Math.pow(
          suppliedYoungAdultStructure / adultReferenceMass,
          SHRIMP_ECOLOGY_RULES.metabolicMassExponent,
        ),
        10,
      );
    // Mild negative allometry may raise mass-specific demand, but a small
    // shrimp must never receive an adult-sized absolute respiration charge.
    expect(youngAdultMaintenance / suppliedYoungAdultStructure)
      .toBeLessThan(
        referenceAdultMaintenance / adultReferenceMass * 1.35,
      );
  });

  it('does not add a juvenile-only respiration charge in the ecology step', () => {
    const adultWorld = new SimulationWorld('laboratory');
    placeAnimal(adultWorld, 'cherry-shrimp', { x: 520, y: 310 });
    const adultInternals = adultWorld as unknown as ShrimpBirthInternals;
    const adult = adultInternals.animals.find(
      (animal) => animal.speciesId === 'cherry-shrimp',
    )!;
    adult.lifespanSeconds = 10_000;
    adult.storedBiomass = 0;
    adult.behavior = 'resting';
    const adultInitialStructure = adult.structuralBiomass;
    adultInternals.stepAnimalEcology(1);
    const adultLoss = adultInitialStructure - adult.structuralBiomass;

    const juvenileWorld = new SimulationWorld('laboratory');
    placeAnimal(juvenileWorld, 'cherry-shrimp', { x: 520, y: 310 });
    const juvenileInternals = juvenileWorld as unknown as ShrimpBirthInternals;
    const parent = juvenileInternals.animals.find(
      (animal) => animal.speciesId === 'cherry-shrimp',
    )!;
    const juvenile = juvenileInternals.createJuvenileAnimalState(parent, 0);
    juvenile.lifespanSeconds = 10_000;
    juvenile.storedBiomass = 0;
    juvenile.behavior = 'resting';
    juvenileInternals.animals.splice(0, juvenileInternals.animals.length, juvenile);
    const juvenileInitialStructure = juvenile.structuralBiomass;
    juvenileInternals.stepAnimalEcology(1);
    const juvenileLoss = juvenileInitialStructure - juvenile.structuralBiomass;

    expect(juvenileLoss).toBeLessThan(adultLoss);
    expect(juvenileLoss / adultLoss).toBeCloseTo(
      Math.pow(
        juvenileInitialStructure / adultInitialStructure,
        SHRIMP_ECOLOGY_RULES.metabolicMassExponent,
      ),
      8,
    );
  });

  it('keeps even maximum wasting metabolism below maximum assimilable intake', () => {
    const adultReferenceMass =
      WATER_CYCLE_RULES.shrimp.adultStructuralBiomass;
    const maximumWastingMaintenance = continuousBodyMassMaintenance(
      adultReferenceMass,
      adultReferenceMass,
      SHRIMP_ECOLOGY_RULES.adultRoutineMaintenanceBiomassPerSecond /
        adultReferenceMass,
      SHRIMP_ECOLOGY_RULES.metabolicMassExponent,
    ) * SHRIMP_ECOLOGY_RULES.starvingActivityMultiplier;
    const maximumAssimilableIntake =
      SHRIMP_ECOLOGY_RULES.maximumBiteBiomassPerSecond *
      WATER_CYCLE_RULES.shrimp.assimilationFraction;

    expect(maximumWastingMaintenance).toBeLessThan(maximumAssimilableIntake);
    // Keep a real feeding margin rather than merely clearing the inequality
    // by floating-point noise. Dense food must still restore a starving adult.
    expect(maximumAssimilableIntake / maximumWastingMaintenance)
      .toBeGreaterThan(5);
  });

  it('integrates shrimp ration deficit continuously instead of resetting on a bite', () => {
    const maintenance = 0.00005;
    const fullRecentGrossRation = maintenance * 8 /
      WATER_CYCLE_RULES.shrimp.assimilationFraction;

    expect(shrimpMaintenanceDeficitClockDelta(0, maintenance, 10))
      .toBeCloseTo(10);
    expect(shrimpMaintenanceDeficitClockDelta(
      fullRecentGrossRation * 0.3,
      maintenance,
      10,
    )).toBeCloseTo(7);
    expect(shrimpMaintenanceDeficitClockDelta(
      fullRecentGrossRation,
      maintenance,
      10,
    )).toBeCloseTo(0);
    expect(shrimpMaintenanceDeficitClockDelta(
      fullRecentGrossRation * 1.5,
      maintenance,
      10,
    )).toBeCloseTo(-5);
  });

  it('spends shrimp reserve and tissue before starvation without draining physiological health', () => {
    const shrimpWorld = new SimulationWorld('laboratory');
    placeAnimal(shrimpWorld, 'cherry-shrimp', { x: 520, y: 310 });
    const shrimpInternals = internalsOf(shrimpWorld);
    const shrimp = shrimpInternals.animals.find(
      (animal) => animal.speciesId === 'cherry-shrimp',
    )!;
    shrimp.lifespanSeconds = 10_000;
    const initialShrimpStructure = shrimp.structuralBiomass;
    const shrimpSurvival = advanceUntilDeath(
      shrimpInternals,
      shrimp.id,
      3_600,
      false,
      5,
    );

    const daphniaWorld = new SimulationWorld('laboratory');
    placeDaphnia(daphniaWorld, { x: 520, y: 310 });
    const daphniaInternals = internalsOf(daphniaWorld);
    const daphnia = daphniaInternals.animals.find(
      (animal) => animal.speciesId === 'daphnia',
    )!;
    const daphniaSurvival = advanceUntilDeath(
      daphniaInternals,
      daphnia.id,
      720,
    );

    // Adult N. davidi reaches its nutritional point of no return over a small
    // fraction of its natural lifespan. On the compressed birth-to-death
    // clock, the stocked reserve and one-percent viable tissue margin must
    // therefore expose a complete food loss well before an ovarian cycle,
    // rather than letting the adult coast for most of a modelled generation.
    expect(shrimpSurvival).toBeGreaterThanOrEqual(50);
    expect(shrimpSurvival).toBeLessThan(120);
    expect(shrimp.storedBiomass).toBeCloseTo(0, 8);
    expect(shrimp.structuralBiomass).toBeLessThan(initialShrimpStructure);
    expect(shrimp.health).toBeCloseTo(1, 8);
    expect(daphniaSurvival).toBeGreaterThan(240);
    expect(daphniaSurvival).toBeLessThan(600);
    expect(shrimpInternals.carcasses.find(
      (carcass) => carcass.sourceAnimalId === shrimp.id,
    )?.cause).toBe('starvation');
    expect(daphniaInternals.carcasses.find(
      (carcass) => carcass.sourceAnimalId === daphnia.id,
    )?.cause).toBe('starvation');
  });

  it('enters weak active search from real tissue wasting and charges it above rest', () => {
    const restingWorld = new SimulationWorld('laboratory');
    placeAnimal(restingWorld, 'cherry-shrimp', { x: 520, y: 310 });
    const restingInternals = internalsOf(restingWorld);
    const restingShrimp = restingInternals.animals.find(
      (animal) => animal.speciesId === 'cherry-shrimp',
    )!;
    restingShrimp.lifespanSeconds = 10_000;
    restingShrimp.storedBiomass = 0;
    const restingStructure = restingShrimp.structuralBiomass;
    restingInternals.stepAnimalEcology(1);
    const restingLoss = restingStructure - restingShrimp.structuralBiomass;

    const wastingWorld = new SimulationWorld('laboratory');
    placeAnimal(wastingWorld, 'cherry-shrimp', { x: 520, y: 310 });
    const wastingInternals = internalsOf(wastingWorld);
    const wastingShrimp = wastingInternals.animals.find(
      (animal) => animal.speciesId === 'cherry-shrimp',
    )!;
    wastingShrimp.lifespanSeconds = 10_000;
    wastingShrimp.storedBiomass = 0;
    wastingShrimp.structuralBiomass = 0.995;
    wastingShrimp.peakStructuralBiomass = 1;
    wastingShrimp.behavior = 'resting';
    wastingInternals.stepAnimalMotion(0.1);
    expect(wastingShrimp.behavior).toBe('starving');
    const wastingStructure = wastingShrimp.structuralBiomass;
    wastingInternals.stepAnimalEcology(1);
    const starvingLoss = wastingStructure - wastingShrimp.structuralBiomass;

    expect(restingLoss).toBeGreaterThan(0);
    expect(starvingLoss).toBeGreaterThan(restingLoss);
    expect(starvingLoss / restingLoss).toBeGreaterThan(1.4);
  });

  it('derives supplied shrimp condition from its real stored matter immediately', () => {
    const world = new SimulationWorld('laboratory');
    placeAnimal(world, 'cherry-shrimp', { x: 520, y: 310 });
    const shrimp = internalsOf(world).animals.find(
      (animal) => animal.speciesId === 'cherry-shrimp',
    )!;
    const expected = 0.28 + 0.72 *
      WATER_CYCLE_RULES.shrimp.suppliedReserveBiomass /
      WATER_CYCLE_RULES.shrimp.adultReserveBiomass;

    expect(shrimp.energy).toBeCloseTo(expected, 10);
  });

  it('lets a tank-born shrimp fast on conserved body matter, then starve', () => {
    const world = new SimulationWorld('laboratory');
    placeAnimal(world, 'cherry-shrimp', { x: 520, y: 310 });
    const internals = world as unknown as ShrimpBirthInternals;
    const parent = internals.animals.find(
      (animal) => animal.speciesId === 'cherry-shrimp',
    )!;
    const newborn = internals.createJuvenileAnimalState(parent, 0);
    newborn.lifespanSeconds = 10_000;
    const initialMatter =
      newborn.structuralBiomass + newborn.storedBiomass;
    const initialReserve = newborn.storedBiomass;
    const initialEnergy = newborn.energy;
    internals.animals.splice(0, internals.animals.length, newborn);

    const survival = advanceUntilDeath(
      internals,
      newborn.id,
      1_800,
      false,
      2,
    );

    expect(initialMatter).toBeCloseTo(
      WATER_CYCLE_RULES.shrimp.juvenileBirthBiomass,
      8,
    );
    expect(initialReserve).toBeGreaterThan(0);
    expect(initialEnergy).toBeGreaterThan(0.8);
    // Food-deprived juveniles reach the point of no return sooner than adults;
    // the individual hatchling has no hidden cohort store or stage discount.
    expect(survival).toBeGreaterThan(45);
    expect(survival).toBeLessThan(100);
    expect(newborn.structuralBiomass).toBeLessThan(initialMatter);
    expect(newborn.health).toBeCloseTo(1, 8);
    expect(internals.carcasses.find(
      (carcass) => carcass.sourceAnimalId === newborn.id,
    )?.cause).toBe('starvation');
  });

  it('scales an adult reserve compartment to achieved body size', () => {
    const world = new SimulationWorld('laboratory');
    placeAnimal(world, 'cherry-shrimp', { x: 520, y: 310 });
    const internals = world as unknown as ShrimpBirthInternals;
    const supplied = internals.animals.find(
      (animal) => animal.speciesId === 'cherry-shrimp',
    )!;
    const bornAdult = internals.createJuvenileAnimalState(supplied, 0);
    bornAdult.lifeStage = 'adult';
    bornAdult.structuralBiomass = 0.20;
    bornAdult.peakStructuralBiomass = 0.20;

    expect(internals.shrimpReserveCapacity(supplied)).toBeCloseTo(
      supplied.structuralBiomass *
        WATER_CYCLE_RULES.shrimp.adultReserveBiomass /
        WATER_CYCLE_RULES.shrimp.adultStructuralBiomass,
      10,
    );
    expect(internals.shrimpReserveCapacity(bornAdult)).toBeCloseTo(0.012, 10);

    // The former shared 0.06-B ceiling was 30% of this animal's structure
    // and could pay maintenance beyond its remaining natural lifespan.
    // Also exercise old-save normalisation: a legacy small adult may arrive
    // with the former full-sized 0.06-B store, but cannot keep that excess.
    bornAdult.storedBiomass = WATER_CYCLE_RULES.shrimp.adultReserveBiomass;
    bornAdult.lifespanSeconds = 10_000;
    internals.animals.splice(0, internals.animals.length, bornAdult);
    const survival = advanceUntilDeath(
      internals,
      bornAdult.id,
      1_800,
      false,
      2,
    );

    // This is the real size-scaled 0.012-B reserve plus the adult's narrow
    // structural margin. It must remain far shorter than the 1,800-second
    // minimum lifespan, but must not rely on an excessive optional-growth
    // sink to manufacture an earlier starvation result.
    expect(survival).toBeGreaterThan(120);
    expect(survival).toBeLessThan(220);
    expect(internals.carcasses.find(
      (carcass) => carcass.sourceAnimalId === bornAdult.id,
    )?.cause).toBe('starvation');
  });

  it('scales juvenile reserve to current structure without a hidden growth floor', () => {
    const world = new SimulationWorld('laboratory');
    placeAnimal(world, 'cherry-shrimp', { x: 520, y: 310 });
    const internals = world as unknown as ShrimpBirthInternals;
    const parent = internals.animals.find(
      (animal) => animal.speciesId === 'cherry-shrimp',
    )!;
    const juvenile = internals.createJuvenileAnimalState(parent, 0);

    expect(internals.shrimpReserveCapacity(juvenile)).toBeCloseTo(
      juvenile.structuralBiomass *
        WATER_CYCLE_RULES.shrimp.adultReserveBiomass /
        WATER_CYCLE_RULES.shrimp.adultStructuralBiomass,
      10,
    );
    juvenile.structuralBiomass = 0.082;
    juvenile.peakStructuralBiomass = 0.082;
    expect(internals.shrimpReserveCapacity(juvenile)).toBeCloseTo(
      0.082 * 0.06,
      10,
    );
  });

  it('removes a legacy oversized juvenile store and exposes food loss before old age', () => {
    const world = new SimulationWorld('laboratory', undefined, 17);
    placeAnimal(world, 'cherry-shrimp', { x: 520, y: 310 });
    const internals = world as unknown as ShrimpBirthInternals;
    const parent = internals.animals.find(
      (animal) => animal.speciesId === 'cherry-shrimp',
    )!;
    const juvenile = internals.createJuvenileAnimalState(parent, 0);
    juvenile.structuralBiomass = 0.082;
    juvenile.peakStructuralBiomass = 0.082;
    juvenile.storedBiomass = 0.030;
    juvenile.lifespanSeconds = 10_000;
    internals.animals.splice(0, internals.animals.length, juvenile);

    internals.stepAnimalEcology(1);
    expect(juvenile.storedBiomass).toBeLessThanOrEqual(
      internals.shrimpReserveCapacity(juvenile),
    );

    const survival = 1 + advanceUntilDeath(
      internals,
      juvenile.id,
      2_400,
      false,
      2,
    );
    // The old fixed store is discarded into detritus, leaving only the
    // structure-scaled DEB reserve. Food loss therefore reaches the juvenile
    // on the same short fractional-lifespan scale as a hatchling instead of
    // being hidden behind an adult-sized compartment.
    expect(survival).toBeGreaterThan(40);
    expect(survival).toBeLessThan(180);
    expect(internals.carcasses.find(
      (carcass) => carcass.sourceAnimalId === juvenile.id,
    )?.cause).toBe('starvation');
  });

  it('makes an unfed supplied adult ricefish starve before old age', () => {
    const world = new SimulationWorld('mission-8');
    placeAnimal(world, 'japanese-ricefish', { x: 800, y: 320 });
    const internals = internalsOf(world);
    const fish = internals.animals.find(
      (animal) => animal.speciesId === 'japanese-ricefish',
    )!;
    const naturalRemainingLifetime =
      fish.lifespanSeconds - fish.ageSeconds;
    const survival = advanceUntilDeath(
      internals,
      fish.id,
      Math.ceil(naturalRemainingLifetime) + 1,
      true,
    );

    expect(survival).toBeGreaterThan(240);
    expect(survival).toBeLessThan(800);
    expect(survival).toBeLessThan(naturalRemainingLifetime);
    expect(internals.carcasses.find(
      (carcass) => carcass.sourceAnimalId === fish.id,
    )?.cause).toBe('starvation');
  });

  it('recovers health when a lean ricefish has eaten recently', () => {
    const world = new SimulationWorld('mission-8');
    placeAnimal(world, 'japanese-ricefish', { x: 800, y: 320 });
    const internals = internalsOf(world);
    const fish = internals.animals.find(
      (animal) => animal.speciesId === 'japanese-ricefish',
    )!;
    fish.storedBiomass = 0.001;
    fish.secondsSinceFood = 10;
    fish.health = 0.5;
    const before = fish.health;

    internals.stepRicefishEcology(1);

    expect(fish.health).toBeGreaterThan(before);
  });

  it('does not turn ordinary intermittent feeding into irreversible damage', () => {
    const world = new SimulationWorld('mission-8');
    placeAnimal(world, 'japanese-ricefish', { x: 800, y: 320 });
    const internals = internalsOf(world);
    const fish = internals.animals.find(
      (animal) => animal.speciesId === 'japanese-ricefish',
    )!;
    fish.health = 0.72;
    fish.lifespanSeconds = 10_000;
    fish.storedBiomass = 0;
    fish.secondsSinceFood = 180;
    const initialStructure = fish.structuralBiomass;

    // One small but sufficient animal meal every 180 seconds. The pulse is a
    // physiological fixture: matter is added only to the fish's conserved
    // reserve, and maintenance continues to remove it normally.
    for (let elapsed = 0; elapsed < 1_440; elapsed += 1) {
      if (elapsed % 180 === 0) {
        fish.storedBiomass += 0.004;
        fish.secondsSinceFood = 0;
      }
      internals.stepRicefishEcology(1);
    }

    const survivor = internals.animals.find(
      (animal) => animal.id === fish.id,
    );
    expect(survivor).toBeDefined();
    expect(survivor!.health).toBeGreaterThanOrEqual(0.70);
    expect(survivor!.structuralBiomass).toBeGreaterThanOrEqual(
      initialStructure * 0.98,
    );
  });

  it('does not let an old food-stunted juvenile persist indefinitely', () => {
    const world = new SimulationWorld('mission-8');
    placeAnimal(world, 'japanese-ricefish', { x: 800, y: 320 });
    const internals = internalsOf(world);
    const fish = internals.animals.find(
      (animal) => animal.speciesId === 'japanese-ricefish',
    )!;
    fish.lifeStage = 'juvenile';
    fish.ageSeconds = 5_000;
    fish.lifespanSeconds = 2_800;
    fish.structuralBiomass = 0.012;
    fish.peakStructuralBiomass = 0.018;
    fish.storedBiomass = 0;
    fish.secondsSinceFood = 500;

    const survival = advanceUntilDeath(internals, fish.id, 240, true);

    expect(survival).toBeGreaterThan(45);
    expect(survival).toBeLessThan(150);
    expect(internals.carcasses.find(
      (carcass) => carcass.sourceAnimalId === fish.id,
    )?.cause).toBe('starvation');
  });

  it('preserves achieved ricefish body mass through freeze and restore', () => {
    const world = new SimulationWorld('mission-8');
    placeAnimal(world, 'japanese-ricefish', { x: 800, y: 320 });
    const internals = internalsOf(world);
    const fish = internals.animals.find(
      (animal) => animal.speciesId === 'japanese-ricefish',
    )!;
    fish.peakStructuralBiomass = 0.11;
    fish.structuralBiomass = 0.08;

    const restored = new SimulationWorld('mission-8');
    restored.loadSaveData(world.exportSaveData());
    const restoredFish = internalsOf(restored).animals.find(
      (animal) => animal.id === fish.id,
    )!;

    expect(restoredFish.structuralBiomass).toBeCloseTo(0.08);
    expect(restoredFish.peakStructuralBiomass).toBeCloseTo(0.11);
  });
});
