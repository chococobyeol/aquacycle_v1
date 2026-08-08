import { describe, expect, it } from "vitest";
import { SimulationWorld } from "../src/simulation/SimulationWorld";
import { BiogeochemistryLedger } from "../src/simulation/biogeochemistry";
import {
  continuousBodyMassFeedingScale,
  SHRIMP_ECOLOGY_RULES,
  WATER_CYCLE_RULES,
} from "../src/simulation/config";
import { CLOSED_MATERIAL_RELATIVE_TOLERANCE } from "../src/simulation/stoichiometry";
import type {
  AnimalSpeciesId,
  SpeciesId,
  Vec2,
} from "../src/simulation/types";

const SHRIMP: AnimalSpeciesId = "cherry-shrimp";
const MIN_LIFESPAN_SECONDS = SHRIMP_ECOLOGY_RULES.minimumLifespanSeconds;
const MAX_LIFESPAN_SECONDS = SHRIMP_ECOLOGY_RULES.maximumLifespanSeconds;
const MIN_SUPPLIED_ADULT_AGE_SECONDS =
  SHRIMP_ECOLOGY_RULES.suppliedAdultMinimumAgeSeconds;
const MAX_SUPPLIED_ADULT_AGE_SECONDS =
  SHRIMP_ECOLOGY_RULES.suppliedAdultMaximumAgeSeconds;
const MAX_TEST_TIME_SECONDS =
  MAX_SUPPLIED_ADULT_AGE_SECONDS + MAX_LIFESPAN_SECONDS + 100;
// The lifecycle simulation intentionally advances more than a thousand
// in-world seconds. On slower Macs or while other long-run suites execute in
// parallel it can take roughly a minute without indicating a simulation failure.
// Runtime performance has its own bounded long-run contract tests.
const LIFECYCLE_TEST_TIMEOUT_MS = 90_000;

type WorldSnapshot = ReturnType<SimulationWorld["snapshot"]>;

const placeSeed = (
  world: SimulationWorld,
  speciesId: SpeciesId,
  point: Vec2,
): void => {
  world.handle({ type: "pick-seed", speciesId, point });
  world.handle({ type: "drop-held", point });
};

const placeShrimp = (world: SimulationWorld, point: Vec2): void => {
  world.handle({ type: "pick-animal", speciesId: SHRIMP, point });
  world.handle({ type: "drop-held", point });
};

const advanceOneTick = (world: SimulationWorld): WorldSnapshot => {
  world.tick(0.1);
  return world.snapshot();
};

/**
 * Fill the substrate with both available foods. This deliberately removes food
 * scarcity from lifecycle tests so a death near the age limit cannot be
 * mistaken for starvation.
 */
const seedFoodRichSubstrate = (world: SimulationWorld): void => {
  const substrate = world
    .snapshot()
    .cells.filter((cell) => cell.surfaceKind === "substrate");

  for (const cell of substrate) {
    placeSeed(world, "oedogonium", cell);
    placeSeed(world, "nitzschia", cell);
  }
};

const configureFoodRichLaboratory = (
  shrimpPoints: Vec2[],
): { world: SimulationWorld; initial: WorldSnapshot } => {
  const world = new SimulationWorld("laboratory");
  // Lifecycle tests isolate age and reproduction. Laboratory mode now also
  // simulates water chemistry, which is covered independently by mission 5.
  (world as unknown as { biogeochemistry: BiogeochemistryLedger }).biogeochemistry =
    new BiogeochemistryLedger();
  seedFoodRichSubstrate(world);
  for (const point of shrimpPoints) placeShrimp(world, point);
  const initial = world.snapshot();
  world.handle({ type: "start" });
  world.handle({ type: "set-speed", speed: 64 });
  return { world, initial };
};

const lifespanOf = (animal: WorldSnapshot["animals"][number]): number => {
  const lifespan = animal.lifespanSeconds;
  expect(lifespan).toBeTypeOf("number");
  if (typeof lifespan !== "number") {
    throw new Error("animal snapshots must expose their individual lifespan");
  }
  return lifespan;
};

describe("cherry shrimp lifecycle", () => {
  it("rematures and materially provisions the next ovary while a brood is carried", () => {
    const world = new SimulationWorld("laboratory");
    placeShrimp(world, { x: 600, y: 610 });
    const save = world.exportSaveData();
    const female = save.animals[0]!;
    female.sex = "female";
    female.lifeStage = "adult";
    female.structuralBiomass = WATER_CYCLE_RULES.shrimp.adultStructuralBiomass;
    female.peakStructuralBiomass = female.structuralBiomass;
    female.storedBiomass = WATER_CYCLE_RULES.shrimp.adultReserveBiomass;
    female.ovarianClutchSize = SHRIMP_ECOLOGY_RULES.minimumClutchSize;
    female.reproductiveBiomass =
      SHRIMP_ECOLOGY_RULES.minimumClutchSize *
      WATER_CYCLE_RULES.shrimp.juvenileBirthBiomass;
    female.gestationRemaining = 1_000;
    female.ovarianProgress = 0;
    female.recentIntake = 0.1;
    female.health = 1;
    world.loadSaveData(save);

    (world as unknown as {
      stepAnimalEcology(deltaSeconds: number): void;
    }).stepAnimalEcology(10);
    // The first step advances the next ovarian cycle from zero; the following
    // step can provision matter up to that newly developed fraction.
    (world as unknown as {
      stepAnimalEcology(deltaSeconds: number): void;
    }).stepAnimalEcology(10);
    const after = world.exportSaveData().animals[0]!;

    expect(after.gestationRemaining).toBeLessThan(1_000);
    expect(after.ovarianProgress).toBeGreaterThan(0);
    expect(after.reproductiveBiomass).toBeGreaterThan(
      female.reproductiveBiomass,
    );
    expect(after.storedBiomass).toBeLessThan(female.storedBiomass);
  });

  it("splits adult female surplus between continued body growth and egg matter", () => {
    const world = new SimulationWorld("laboratory");
    placeShrimp(world, { x: 600, y: 610 });
    const save = world.exportSaveData();
    const female = save.animals[0]!;
    female.sex = "female";
    female.lifeStage = "adult";
    female.structuralBiomass = 0.2;
    female.peakStructuralBiomass = 0.2;
    female.bodyLength = 20;
    female.storedBiomass = WATER_CYCLE_RULES.shrimp.adultReserveBiomass;
    female.reproductiveBiomass = 0;
    female.ovarianClutchSize = SHRIMP_ECOLOGY_RULES.minimumClutchSize;
    female.ovarianProgress = 0.5;
    female.recentIntake = 0.02;
    female.health = 1;
    world.loadSaveData(save);

    (world as unknown as {
      stepAnimalEcology(deltaSeconds: number): void;
    }).stepAnimalEcology(10);
    const after = world.exportSaveData().animals[0]!;

    expect(after.structuralBiomass).toBeGreaterThan(0.2);
    expect(after.reproductiveBiomass).toBeGreaterThan(0);
    expect(after.bodyLength).toBeGreaterThan(female.bodyLength);
    expect(after.bodyLength).toBeLessThan(36);
  });

  it("pays current maintenance and ovarian allocation before overflowing a full reserve", () => {
    const world = new SimulationWorld("mission-5");
    const foodCell = world.snapshot().cells
      .filter((cell) => cell.surfaceKind === "substrate")
      .sort((left, right) =>
        Math.abs(left.x - 600) - Math.abs(right.x - 600))[0]!;
    placeShrimp(world, foodCell);

    const save = world.exportSaveData();
    const savedCell = save.substrateCells.find(
      (cell) => cell.id === foodCell.id,
    )!;
    const female = save.animals[0]!;
    savedCell.biomass.nitzschia = 0.5;
    savedCell.biomass.oedogonium = 0;
    savedCell.biofilm.decomposer = 0;
    savedCell.biofilm.nitrifier = 0;
    female.position = { x: foodCell.x, y: foodCell.y - 4 };
    female.lifeStage = "adult";
    female.sex = "female";
    female.structuralBiomass = WATER_CYCLE_RULES.shrimp.adultStructuralBiomass;
    female.peakStructuralBiomass = female.structuralBiomass;
    female.storedBiomass = WATER_CYCLE_RULES.shrimp.adultReserveBiomass;
    female.reproductiveBiomass = 0;
    female.ovarianClutchSize = SHRIMP_ECOLOGY_RULES.minimumClutchSize;
    female.ovarianProgress = 0.5;
    female.recentIntake = 0.01;
    female.health = 1;
    female.behavior = "grazing";
    female.targetCellId = foodCell.id;
    female.behaviorTimer = 10;
    // The fixture replaces producer and animal matter directly. Rebase the
    // conservation reference so this test measures only the ecology step.
    save.materialReference = null;
    world.loadSaveData(save);
    const ledger = (world as unknown as {
      biogeochemistry: BiogeochemistryLedger;
    }).biogeochemistry;
    const recordOverflow = ledger.recordAnimalAssimilationOverflow.bind(ledger);
    let assimilationOverflow = 0;
    ledger.recordAnimalAssimilationOverflow = (point, biomass): void => {
      assimilationOverflow += Math.max(0, biomass);
      recordOverflow(point, biomass);
    };

    (world as unknown as {
      stepAnimalEcology(deltaSeconds: number): void;
    }).stepAnimalEcology(1);
    const after = world.exportSaveData().animals[0]!;

    expect(after.consumedBiomass).toBeGreaterThan(0);
    expect(after.reproductiveBiomass).toBeGreaterThan(0);
    expect(after.storedBiomass).toBeCloseTo(
      WATER_CYCLE_RULES.shrimp.adultReserveBiomass,
      8,
    );
    expect(assimilationOverflow).toBeLessThan(1e-9);
  });

  it("uses a continuous body-mass feeding curve through maturation", () => {
    const rules = WATER_CYCLE_RULES.shrimp;
    const birthScale = continuousBodyMassFeedingScale(
      rules.juvenileBirthBiomass,
      rules.adultStructuralBiomass,
      rules.feedingMassExponent,
    );
    const immediatelyBeforeMaturation = continuousBodyMassFeedingScale(
      rules.adultStructuralBiomass - 1e-6,
      rules.adultStructuralBiomass,
      rules.feedingMassExponent,
    );
    const atMaturation = continuousBodyMassFeedingScale(
      rules.adultStructuralBiomass,
      rules.adultStructuralBiomass,
      rules.feedingMassExponent,
    );

    // The hatchling uses the configured mass ratio on the same M^0.65 curve;
    // there is no independent juvenile multiplier or stage discontinuity.
    expect(birthScale).toBeCloseTo(
      Math.pow(
        rules.juvenileBirthBiomass / rules.adultStructuralBiomass,
        rules.feedingMassExponent,
      ),
      12,
    );
    expect(Math.abs(atMaturation - immediatelyBeforeMaturation))
      .toBeLessThan(0.00001);
  });

  it("does not give the same-sized juvenile an adult-multiple grazing rate", () => {
    const consumedAtStage = (lifeStage: "juvenile" | "adult"): number => {
      const world = new SimulationWorld("mission-5");
      const cell = world.snapshot().cells
        .filter((candidate) => candidate.surfaceKind === "substrate")
        .sort((left, right) => Math.abs(left.x - 600) - Math.abs(right.x - 600))[0]!;
      placeShrimp(world, cell);
      const save = world.exportSaveData();
      const savedCell = save.substrateCells.find(
        (candidate) => candidate.id === cell.id,
      )!;
      const shrimp = save.animals[0]!;
      savedCell.biomass.nitzschia = 0.5;
      savedCell.biomass.oedogonium = 0;
      savedCell.biofilm.decomposer = 0;
      savedCell.biofilm.nitrifier = 0;
      shrimp.position = { x: cell.x, y: cell.y - 4 };
      shrimp.lifeStage = lifeStage;
      shrimp.sex = "male";
      shrimp.structuralBiomass =
        SHRIMP_ECOLOGY_RULES.maturationStructuralBiomass;
      shrimp.peakStructuralBiomass = shrimp.structuralBiomass;
      shrimp.storedBiomass = 0;
      shrimp.consumedBiomass = 0;
      shrimp.behavior = "grazing";
      shrimp.targetCellId = cell.id;
      shrimp.behaviorTimer = 10;
      world.loadSaveData(save);

      (world as unknown as {
        stepAnimalEcology(deltaSeconds: number): void;
      }).stepAnimalEcology(1);
      return world.exportSaveData().animals[0]!.consumedBiomass;
    };

    const juvenileConsumption = consumedAtStage("juvenile");
    const adultConsumption = consumedAtStage("adult");

    expect(juvenileConsumption).toBeGreaterThan(0);
    expect(juvenileConsumption).toBeCloseTo(adultConsumption, 10);
  });

  it("reduces grazing pressure sigmoidally as a contacted film becomes sparse", () => {
    const consumptionAtDensity = (foodBiomass: number): number => {
      const world = new SimulationWorld("mission-5");
      const cell = world.snapshot().cells
        .filter((candidate) => candidate.surfaceKind === "substrate")
        .sort((left, right) => Math.abs(left.x - 600) - Math.abs(right.x - 600))[0]!;
      placeShrimp(world, cell);
      const save = world.exportSaveData();
      const savedCell = save.substrateCells.find(
        (candidate) => candidate.id === cell.id,
      )!;
      const shrimp = save.animals[0]!;
      savedCell.biomass.nitzschia = foodBiomass;
      savedCell.biomass.oedogonium = 0;
      savedCell.biofilm.decomposer = 0;
      savedCell.biofilm.nitrifier = 0;
      shrimp.position = { x: cell.x, y: cell.y - 4 };
      shrimp.sex = "male";
      shrimp.behavior = "grazing";
      shrimp.targetCellId = cell.id;
      shrimp.behaviorTimer = 10;
      shrimp.consumedBiomass = 0;
      world.loadSaveData(save);

      (world as unknown as {
        stepAnimalEcology(deltaSeconds: number): void;
      }).stepAnimalEcology(1);
      return world.exportSaveData().animals[0]!.consumedBiomass;
    };

    const halfSaturation =
      WATER_CYCLE_RULES.shrimp.grazingHalfSaturationBiomass;
    const atHalfSaturation = consumptionAtDensity(halfSaturation);
    const atHalfThatDensity = consumptionAtDensity(halfSaturation / 2);

    expect(atHalfSaturation).toBeGreaterThan(0);
    expect(atHalfThatDensity).toBeGreaterThan(0);
    // With q=2, f(K/2)=0.2 and f(K)=0.5. Positive traces remain edible,
    // while grazing pressure falls faster than linearly as the film thins.
    expect(atHalfThatDensity / atHalfSaturation).toBeCloseTo(0.4, 6);
  });

  it("keeps consuming trace algae and biofilm without a hidden grazing floor", () => {
    const world = new SimulationWorld("mission-5");
    const cell = world.snapshot().cells
      .filter((candidate) => candidate.surfaceKind === "substrate")
      .sort((left, right) => Math.abs(left.x - 600) - Math.abs(right.x - 600))[0];
    expect(cell).toBeDefined();
    if (!cell) return;

    placeShrimp(world, cell);
    const save = world.exportSaveData();
    const savedCell = save.substrateCells.find(
      (candidate) => candidate.id === cell.id,
    );
    const shrimp = save.animals.find(
      (animal) => animal.speciesId === SHRIMP,
    );
    expect(savedCell).toBeDefined();
    expect(shrimp).toBeDefined();
    if (!savedCell || !shrimp) return;

    savedCell.biomass.nitzschia = 0.0004;
    savedCell.biomass.oedogonium = 0.0004;
    savedCell.biofilm.decomposer = 0.005;
    savedCell.biofilm.nitrifier = 0.005;
    shrimp.position = { x: cell.x, y: cell.y - 4 };
    shrimp.behavior = "grazing";
    shrimp.targetCellId = cell.id;
    shrimp.behaviorTimer = 10;
    world.loadSaveData(save);
    (world as unknown as {
      stepAnimalEcology(deltaSeconds: number): void;
    // Use a deliberately long isolated demand interval. Type-III intake is
    // very small at this trace density, so 1,000 s no longer requests the
    // whole patch before the unfed shrimp dies; 10,000 s makes total demand
    // exceed the standing food and verifies exact depletion, not survival.
    }).stepAnimalEcology(10_000);

    const afterCell = world.snapshot().cells.find(
      (candidate) => candidate.id === cell.id,
    );
    expect(afterCell).toBeDefined();
    if (!afterCell) return;
    // Demand exceeds every standing compartment. Simultaneous grazers may
    // share a patch proportionally, but no display or numerical refuge may
    // keep an uneaten remainder alive.
    expect(afterCell.biomass.nitzschia).toBe(0);
    expect(afterCell.biomass.oedogonium).toBe(0);
    expect(afterCell.biofilm.decomposer).toBe(0);
    expect(afterCell.biofilm.nitrifier).toBe(0);
    // The trace ration is exhausted rather than protected. The deliberately
    // oversized interval also removes the animal; its cause is not asserted
    // here because lifespan and starvation thresholds are tested separately.
    expect(world.exportSaveData().animals).toHaveLength(0);

    const balance = world.snapshot().biogeochemistry.materialBalance;
    expect(Math.abs(balance.nitrogenDriftRatio))
      .toBeLessThan(CLOSED_MATERIAL_RELATIVE_TOLERANCE);
    expect(Math.abs(balance.carbonDriftRatio))
      .toBeLessThan(CLOSED_MATERIAL_RELATIVE_TOLERANCE);
    expect(Math.abs(balance.oxygenEquivalentDriftRatio))
      .toBeLessThan(CLOSED_MATERIAL_RELATIVE_TOLERANCE);
  });

  it("counts bacterial film by digestible food value instead of raw grazed mass", () => {
    const world = new SimulationWorld("mission-5");
    const cell = world.snapshot().cells
      .filter((candidate) => candidate.surfaceKind === "substrate")
      .sort((left, right) => Math.abs(left.x - 600) - Math.abs(right.x - 600))[0]!;
    placeShrimp(world, cell);
    const save = world.exportSaveData();
    const savedCell = save.substrateCells.find((candidate) => candidate.id === cell.id)!;
    const shrimp = save.animals[0]!;
    savedCell.biomass.oedogonium = 0;
    savedCell.biomass.nitzschia = 0;
    savedCell.biofilm.decomposer = 0.5;
    savedCell.biofilm.nitrifier = 0;
    shrimp.position = { x: cell.x, y: cell.y - 4 };
    shrimp.behavior = "grazing";
    shrimp.targetCellId = cell.id;
    shrimp.behaviorTimer = 10;
    shrimp.storedBiomass = 0;
    shrimp.recentIntake = 0;
    shrimp.consumedBiomass = 0;
    world.loadSaveData(save);

    (world as unknown as {
      stepAnimalEcology(deltaSeconds: number): void;
    }).stepAnimalEcology(1);
    const after = world.exportSaveData().animals[0]!;

    expect(after.consumedBiomass).toBeGreaterThan(0);
    expect(after.recentIntake).toBeCloseTo(
      after.consumedBiomass * 0.45,
      8,
    );
    expect(after.storedBiomass).toBeLessThan(
      after.consumedBiomass * WATER_CYCLE_RULES.shrimp.assimilationFraction,
    );
  });

  it("assigns each supplied shrimp an individual compressed lifespan", () => {
    expect(MIN_LIFESPAN_SECONDS).toBe(1_800);
    expect(MAX_LIFESPAN_SECONDS).toBe(3_000);
    const world = new SimulationWorld("laboratory");
    for (const point of [
      { x: 300, y: 600 },
      { x: 500, y: 600 },
      { x: 700, y: 600 },
      { x: 900, y: 600 },
    ]) {
      placeShrimp(world, point);
    }

    const lifespans = world.snapshot().animals.map(lifespanOf);

    expect(lifespans).toHaveLength(4);
    for (const [index, lifespan] of lifespans.entries()) {
      const age = world.snapshot().animals[index]!.ageSeconds;
      expect(lifespan).toBeGreaterThanOrEqual(MIN_LIFESPAN_SECONDS);
      expect(lifespan).toBeLessThanOrEqual(MAX_LIFESPAN_SECONDS);
      expect(lifespan - age).toBeGreaterThanOrEqual(
        MIN_LIFESPAN_SECONDS - MAX_SUPPLIED_ADULT_AGE_SECONDS,
      );
      expect(lifespan).toBeLessThanOrEqual(50 * 60);
    }
    expect(new Set(lifespans).size).toBeGreaterThan(1);

    const legacySave = world.exportSaveData();
    legacySave.animals[0]!.lifespanSeconds = 75 * 60;
    const restored = new SimulationWorld("laboratory");
    restored.loadSaveData(legacySave);
    expect(restored.snapshot().animals[0]!.lifespanSeconds)
      .toBeLessThanOrEqual(50 * 60);
  });

  it("gives a cohort individual maturation and ovarian schedules", () => {
    const { world } = configureFoodRichLaboratory([
      { x: 520, y: 610 },
      { x: 550, y: 610 },
      { x: 580, y: 610 },
      { x: 610, y: 610 },
      { x: 640, y: 610 },
      { x: 670, y: 610 },
    ]);
    const save = world.exportSaveData();
    const supplied = save.animals.filter((animal) => animal.speciesId === SHRIMP);

    expect(new Set(supplied.map((animal) => animal.ovarianProgress)).size)
      .toBeGreaterThan(1);

    const parent = supplied.find((animal) => animal.sex === "female");
    expect(parent).toBeDefined();
    if (!parent) return;
    const newborns = Array.from({ length: 6 }, (_, index) =>
      (world as unknown as {
        createJuvenileAnimalState(
          animal: NonNullable<typeof parent>,
          birthIndex: number,
        ): NonNullable<typeof parent>;
      }).createJuvenileAnimalState(parent, index),
    );
    const targets = newborns.map((animal) => animal.maturationTargetSeconds ?? 0);
    expect(Math.min(...targets)).toBeGreaterThanOrEqual(
      SHRIMP_ECOLOGY_RULES.maturationMinimumSeconds,
    );
    expect(Math.max(...targets)).toBeLessThanOrEqual(
      SHRIMP_ECOLOGY_RULES.maturationMaximumSeconds,
    );
    expect(new Set(targets).size).toBeGreaterThan(1);
  });

  it("draws offspring sex independently without cohort balancing or hash bias", () => {
    const world = new SimulationWorld("laboratory", undefined, 17);
    placeShrimp(world, { x: 600, y: 610 });
    const parent = world.exportSaveData().animals[0]!;
    const internals = world as unknown as {
      createJuvenileAnimalState(
        animal: typeof parent,
        birthIndex: number,
      ): typeof parent;
    };
    let females = 0;
    let sameSexSiblingPairs = 0;
    const cycles = 2_000;
    for (let cycle = 0; cycle < cycles; cycle += 1) {
      parent.reproductiveCycleIndex = cycle;
      const first = internals.createJuvenileAnimalState(parent, 0);
      const second = internals.createJuvenileAnimalState(parent, 1);
      females += Number(first.sex === "female") + Number(second.sex === "female");
      sameSexSiblingPairs += Number(first.sex === second.sex);
    }

    expect(females / (cycles * 2)).toBeGreaterThan(0.48);
    expect(females / (cycles * 2)).toBeLessThan(0.52);
    expect(sameSexSiblingPairs / cycles).toBeGreaterThan(0.47);
    expect(sameSexSiblingPairs / cycles).toBeLessThan(0.53);
  });

  it("does not grant age-based catch-up growth when a juvenile falls behind", () => {
    const world = new SimulationWorld("laboratory");
    placeShrimp(world, { x: 600, y: 610 });
    const parent = world.exportSaveData().animals[0]!;
    const internals = world as unknown as {
      createJuvenileAnimalState(
        animal: typeof parent,
        birthIndex: number,
      ): typeof parent;
      shrimpJuvenileGrowthAllowance(
        animal: typeof parent,
        deltaSeconds: number,
        temperatureFactor: number,
      ): number;
    };
    const juvenile = internals.createJuvenileAnimalState(parent, 0);
    juvenile.sex = "male";
    juvenile.ovarianClutchSize = undefined;
    const birth = juvenile.structuralBiomass;
    const mature = SHRIMP_ECOLOGY_RULES.maturationStructuralBiomass;
    const target = juvenile.maturationTargetSeconds!;

    juvenile.ageSeconds = target * 0.5;
    juvenile.structuralBiomass = birth + (mature - birth) * 0.5;
    const onSchedule = internals.shrimpJuvenileGrowthAllowance(juvenile, 1, 1);

    juvenile.ageSeconds = target;
    juvenile.structuralBiomass = birth;
    const delayed = internals.shrimpJuvenileGrowthAllowance(juvenile, 1, 1);

    expect(delayed).toBeCloseTo(onSchedule, 12);
    expect(juvenile.structuralBiomass).toBe(birth);
  });

  it("does not kill a viable juvenile merely for missing an age schedule", () => {
    const world = new SimulationWorld("laboratory");
    placeShrimp(world, { x: 600, y: 610 });
    const internals = world as unknown as {
      animals: ReturnType<SimulationWorld["exportSaveData"]>["animals"];
      createJuvenileAnimalState(
        animal: ReturnType<SimulationWorld["exportSaveData"]>["animals"][number],
        birthIndex: number,
      ): ReturnType<SimulationWorld["exportSaveData"]>["animals"][number];
      stepAnimalEcology(deltaSeconds: number): void;
    };
    const juvenile = internals.createJuvenileAnimalState(internals.animals[0], 0);
    juvenile.sex = "male";
    juvenile.ovarianClutchSize = undefined;
    juvenile.ageSeconds = 1_500;
    juvenile.lifespanSeconds = 10_000;
    juvenile.storedBiomass = juvenile.structuralBiomass *
      WATER_CYCLE_RULES.shrimp.adultReserveBiomass /
      WATER_CYCLE_RULES.shrimp.adultStructuralBiomass;
    internals.animals.splice(0, internals.animals.length, juvenile);

    internals.stepAnimalEcology(1);

    expect(internals.animals.some((animal) => animal.id === juvenile.id)).toBe(true);
    expect(juvenile.lifeStage).toBe("juvenile");
    expect(juvenile.structuralBiomass).toBeGreaterThan(0);
  });

  it("keeps body length continuous when the stage label changes", () => {
    const world = new SimulationWorld("laboratory");
    placeShrimp(world, { x: 600, y: 610 });
    const internals = world as unknown as {
      animals: ReturnType<SimulationWorld["exportSaveData"]>["animals"];
      createJuvenileAnimalState(
        animal: ReturnType<SimulationWorld["exportSaveData"]>["animals"][number],
        birthIndex: number,
      ): ReturnType<SimulationWorld["exportSaveData"]>["animals"][number];
      stepAnimalEcology(deltaSeconds: number): void;
    };
    const juvenile = internals.createJuvenileAnimalState(internals.animals[0], 0);
    juvenile.sex = "male";
    juvenile.structuralBiomass =
      SHRIMP_ECOLOGY_RULES.maturationStructuralBiomass - 0.001;
    juvenile.peakStructuralBiomass = juvenile.structuralBiomass;
    juvenile.storedBiomass = juvenile.structuralBiomass *
      WATER_CYCLE_RULES.shrimp.adultReserveBiomass /
      WATER_CYCLE_RULES.shrimp.adultStructuralBiomass;
    internals.animals.splice(0, internals.animals.length, juvenile);

    internals.stepAnimalEcology(0.1);
    const beforeMaturity = juvenile.bodyLength;
    expect(juvenile.lifeStage).toBe("juvenile");

    juvenile.structuralBiomass =
      SHRIMP_ECOLOGY_RULES.maturationStructuralBiomass;
    juvenile.peakStructuralBiomass = juvenile.structuralBiomass;
    internals.stepAnimalEcology(0.1);

    expect(juvenile.lifeStage).toBe("adult");
    expect(juvenile.bodyLength).toBeGreaterThanOrEqual(beforeMaturity);
    expect(juvenile.bodyLength - beforeMaturity).toBeLessThan(1);
  });

  it("declines post-maturity growth continuously as adult structure fills", () => {
    const world = new SimulationWorld("laboratory");
    placeShrimp(world, { x: 600, y: 610 });
    const adult = world.exportSaveData().animals[0]!;
    const internals = world as unknown as {
      shrimpAdultGrowthAllowance(
        animal: typeof adult,
        deltaSeconds: number,
        temperatureFactor: number,
      ): number;
    };
    adult.lifeStage = "adult";
    adult.health = 1;
    adult.structuralBiomass =
      SHRIMP_ECOLOGY_RULES.maturationStructuralBiomass;
    const atMaturity = internals.shrimpAdultGrowthAllowance(adult, 1, 1);

    adult.structuralBiomass = 0.5;
    const atHalfSize = internals.shrimpAdultGrowthAllowance(adult, 1, 1);

    adult.structuralBiomass =
      WATER_CYCLE_RULES.shrimp.adultStructuralBiomass;
    const atMaximum = internals.shrimpAdultGrowthAllowance(adult, 1, 1);

    expect(atMaturity).toBeCloseTo(
      SHRIMP_ECOLOGY_RULES.adultSomaticGrowthPerSecond,
      12,
    );
    expect(atHalfSize).toBeGreaterThan(0);
    expect(atHalfSize).toBeLessThan(atMaturity);
    expect(atMaximum).toBe(0);
  });

  it("does not advance ovarian state without conserved egg matter", () => {
    const world = new SimulationWorld("laboratory");
    placeShrimp(world, { x: 600, y: 610 });
    const parent = world.exportSaveData().animals[0]!;
    const internals = world as unknown as {
      createJuvenileAnimalState(
        animal: typeof parent,
        birthIndex: number,
      ): typeof parent;
      applyShrimpDebProduction(
        animal: typeof parent,
        temperatureFactor: number,
        deltaSeconds: number,
      ): void;
    };
    const female = Array.from(
      { length: 16 },
      (_, index) => internals.createJuvenileAnimalState(parent, index),
    ).find((animal) => animal.sex === "female");
    expect(female).toBeDefined();
    if (!female) return;

    female.structuralBiomass =
      WATER_CYCLE_RULES.shrimp.juvenileBirthBiomass +
      (
        SHRIMP_ECOLOGY_RULES.maturationStructuralBiomass -
        WATER_CYCLE_RULES.shrimp.juvenileBirthBiomass
      ) * SHRIMP_ECOLOGY_RULES.ovarianDevelopmentOnsetFraction;
    female.peakStructuralBiomass = female.structuralBiomass;
    female.storedBiomass = 0;
    female.reproductiveBiomass = 0;
    female.ovarianProgress = 0;
    female.recentIntake = 0;
    const matterBefore = female.structuralBiomass +
      female.storedBiomass + female.reproductiveBiomass;

    internals.applyShrimpDebProduction(female, 1, 1);

    const matterAfter = female.structuralBiomass +
      female.storedBiomass + female.reproductiveBiomass;
    expect(female.lifeStage).toBe("juvenile");
    expect(female.reproductiveBiomass).toBe(0);
    expect(female.ovarianProgress).toBe(0);
    expect(matterAfter).toBeCloseTo(matterBefore, 12);
  });

  it("provisions conserved egg matter once late-juvenile ovarian development begins", () => {
    const world = new SimulationWorld("laboratory");
    placeShrimp(world, { x: 600, y: 610 });
    const parent = world.exportSaveData().animals[0]!;
    const internals = world as unknown as {
      createJuvenileAnimalState(
        animal: typeof parent,
        birthIndex: number,
      ): typeof parent;
      shrimpReserveCapacity(animal: typeof parent): number;
      shrimpBroodBiomass(animal: typeof parent): number;
      applyShrimpDebProduction(
        animal: typeof parent,
        temperatureFactor: number,
        deltaSeconds: number,
      ): void;
    };
    const female = Array.from(
      { length: 16 },
      (_, index) => internals.createJuvenileAnimalState(parent, index),
    ).find((animal) => animal.sex === "female");
    expect(female).toBeDefined();
    if (!female) return;

    const birthStructure = WATER_CYCLE_RULES.shrimp.juvenileBirthBiomass /
      (
        1 + WATER_CYCLE_RULES.shrimp.adultReserveBiomass /
          WATER_CYCLE_RULES.shrimp.adultStructuralBiomass
      );
    female.structuralBiomass = birthStructure +
      (
        SHRIMP_ECOLOGY_RULES.maturationStructuralBiomass - birthStructure
      ) * (SHRIMP_ECOLOGY_RULES.ovarianDevelopmentOnsetFraction + 0.05);
    female.peakStructuralBiomass = female.structuralBiomass;
    female.storedBiomass = internals.shrimpReserveCapacity(female);
    female.reproductiveBiomass = 0;
    female.ovarianProgress = 0.5;
    female.recentIntake = 0.1;
    female.health = 1;
    const structureBefore = female.structuralBiomass;
    const reserveBefore = female.storedBiomass;

    internals.applyShrimpDebProduction(female, 1, 10);

    const structuralGain = female.structuralBiomass - structureBefore;
    const reproductiveGain = female.reproductiveBiomass;
    const reserveSpent = reserveBefore - female.storedBiomass;
    expect(female.lifeStage).toBe("juvenile");
    expect(structuralGain).toBeGreaterThan(0);
    expect(reproductiveGain).toBeGreaterThan(0);
    expect(female.ovarianProgress).toBeCloseTo(
      reproductiveGain / internals.shrimpBroodBiomass(female),
      12,
    );
    expect(structuralGain + reproductiveGain).toBeCloseTo(reserveSpent, 12);
  });

  it("derives ovarian progress from conserved matter in each active compartment", () => {
    const world = new SimulationWorld("laboratory");
    placeShrimp(world, { x: 600, y: 610 });
    const female = world.exportSaveData().animals[0]!;
    const internals = world as unknown as {
      shrimpBroodBiomass(animal: typeof female): number;
      shrimpOvarianMatterTarget(animal: typeof female): number;
      synchroniseShrimpOvarianState(animal: typeof female): void;
    };
    female.sex = "female";
    female.lifeStage = "adult";
    female.ovarianClutchSize = SHRIMP_ECOLOGY_RULES.minimumClutchSize;
    female.gestationRemaining = null;
    const broodBiomass = internals.shrimpBroodBiomass(female);
    female.reproductiveBiomass = broodBiomass * 0.25;
    internals.synchroniseShrimpOvarianState(female);

    expect(female.ovarianProgress).toBeCloseTo(0.25, 12);
    expect(internals.shrimpOvarianMatterTarget(female))
      .toBeCloseTo(broodBiomass, 12);

    female.gestationRemaining = 100;
    female.reproductiveBiomass = broodBiomass * 1.25;
    internals.synchroniseShrimpOvarianState(female);
    expect(female.ovarianProgress).toBeCloseTo(0.25, 12);
    expect(internals.shrimpOvarianMatterTarget(female))
      .toBeCloseTo(broodBiomass * 2, 12);
  });

  it("separates food-funded somatic maturity from first-clutch readiness", () => {
    const world = new SimulationWorld("laboratory");
    placeShrimp(world, { x: 600, y: 610 });
    const save = world.exportSaveData();
    const parent = save.animals[0]!;
    const internals = world as unknown as {
      createJuvenileAnimalState(
        animal: typeof parent,
        birthIndex: number,
      ): typeof parent;
      stepAnimalEcology(deltaSeconds: number): void;
    };
    const female = Array.from(
      { length: 16 },
      (_, index) => internals.createJuvenileAnimalState(parent, index),
    ).find((animal) => animal.sex === "female");
    expect(female).toBeDefined();
    if (!female) return;

    const matureStructure =
      SHRIMP_ECOLOGY_RULES.maturationStructuralBiomass;
    female.ageSeconds = female.maturationTargetSeconds!;
    female.structuralBiomass = matureStructure;
    female.peakStructuralBiomass = matureStructure;
    // Stay below the ordinary size-scaled reserve capacity so this fixture
    // isolates the stage transition rather than the separate overflow path.
    female.storedBiomass =
      WATER_CYCLE_RULES.shrimp.adultReserveBiomass *
      matureStructure /
      WATER_CYCLE_RULES.shrimp.adultStructuralBiomass *
      0.6;
    female.reproductiveBiomass = 0;
    female.ovarianProgress = 0;
    female.growthProgress = 1;
    female.recentIntake = 1;
    save.animals = [female];
    world.loadSaveData(save);
    const before = world.exportSaveData().animals[0]!;
    const matterBefore = before.structuralBiomass + before.storedBiomass +
      (before.reproductiveBiomass ?? 0);

    internals.stepAnimalEcology(0);

    const after = world.exportSaveData().animals[0]!;
    expect(after.lifeStage).toBe("adult");
    expect(after.structuralBiomass).toBeCloseTo(matureStructure, 12);
    expect(after.reproductiveBiomass).toBeCloseTo(0, 12);
    expect(
      after.structuralBiomass + after.storedBiomass +
        (after.reproductiveBiomass ?? 0),
    ).toBeCloseTo(matterBefore, 12);

    // Becoming somatically adult must not make the female reproductively
    // ready. Her ovary continues from the conserved state after transition.
    expect(after.ovarianProgress).toBe(0);
    expect(after.gestationRemaining).toBeNull();
  });

  it("lets a juvenile in a food-rich tank mature near its individual schedule", () => {
    const world = new SimulationWorld("laboratory");
    (world as unknown as { biogeochemistry: BiogeochemistryLedger }).biogeochemistry =
      new BiogeochemistryLedger();
    placeShrimp(world, { x: 600, y: 610 });
    const save = world.exportSaveData();
    const parent = save.animals[0]!;
    const juvenile = (world as unknown as {
      createJuvenileAnimalState(
        animal: typeof parent,
        birthIndex: number,
      ): typeof parent;
    }).createJuvenileAnimalState(parent, 0);
    const foodCell = world.snapshot().cells
      .filter((cell) => cell.surfaceKind === "substrate")
      .reduce((nearest, cell) =>
      Math.abs(cell.x - 600) < Math.abs(nearest.x - 600) ? cell : nearest
      );
    juvenile.position = { x: foodCell.x, y: foodCell.y };
    juvenile.behavior = "exploring";
    juvenile.behaviorTimer = 0;
    juvenile.nextTargetEvaluation = 0;
    juvenile.targetCellId = foodCell.id;
    save.animals = [juvenile];
    for (const cell of save.substrateCells) {
      cell.biomass.nitzschia = 0.5;
      cell.biomass.oedogonium = 0.5;
    }
    save.savedPhase = "paused";
    save.elapsedSeconds = 0;
    world.loadSaveData(save);
    // Loading reconstructs the scenario ledger. Restore the intended
    // chemistry-free lifecycle fixture after the load so this test measures
    // food-funded growth rather than escape from the deliberately enormous
    // all-substrate algae stock used above.
    (world as unknown as { biogeochemistry: BiogeochemistryLedger }).biogeochemistry =
      new BiogeochemistryLedger();
    world.handle({ type: "start" });
    world.handle({ type: "set-speed", speed: 64 });

    const target = juvenile.maturationTargetSeconds!;
    let maturedAt = Number.POSITIVE_INFINITY;
    while (world.snapshot().elapsedSeconds < target * 1.35) {
      const snapshot = advanceOneTick(world);
      const current = snapshot.animals.find((animal) => animal.id === juvenile.id);
      if (current?.lifeStage === "adult") {
        maturedAt = current.ageSeconds;
        break;
      }
    }

    expect(maturedAt).toBeLessThanOrEqual(target * 1.25);
  }, LIFECYCLE_TEST_TIMEOUT_MS);

  it("draws offspring sex independently instead of repairing each brood", () => {
    const world = new SimulationWorld("laboratory");
    placeShrimp(world, { x: 600, y: 610 });
    const parent = world.exportSaveData().animals.find(
      (animal) => animal.speciesId === SHRIMP,
    );
    expect(parent).toBeDefined();
    if (!parent) return;

    const createJuvenile = (
      world as unknown as {
        createJuvenileAnimalState(
          animal: NonNullable<typeof parent>,
          birthIndex: number,
        ): NonNullable<typeof parent>;
      }
    ).createJuvenileAnimalState.bind(world);
    let femaleCount = 0;
    let mixedBroods = 0;
    let singleSexBroods = 0;
    const broodCount = 500;
    const clutchSize = SHRIMP_ECOLOGY_RULES.minimumClutchSize;

    for (let cycle = 0; cycle < broodCount; cycle += 1) {
      parent.reproductiveCycleIndex = cycle;
      const sexes = Array.from(
        { length: clutchSize },
        (_, clutchIndex) => createJuvenile(parent, clutchIndex).sex,
      );
      femaleCount += sexes.filter((sex) => sex === "female").length;
      if (new Set(sexes).size === 1) singleSexBroods += 1;
      else mixedBroods += 1;
    }

    const femaleRatio = femaleCount / (broodCount * clutchSize);
    expect(femaleRatio).toBeGreaterThan(0.45);
    expect(femaleRatio).toBeLessThan(0.55);
    // Both outcomes must occur. Requiring a mixed brood every time would be
    // the exact hidden sex rescue this test is meant to prevent.
    expect(mixedBroods).toBeGreaterThan(0);
    expect(singleSexBroods).toBeGreaterThan(0);
  });

  it("varies fresh-tank offspring draws but preserves them through save and load", () => {
    const sexSequence = (world: SimulationWorld): string => {
      placeShrimp(world, { x: 600, y: 610 });
      const parent = world.exportSaveData().animals.find(
        (animal) => animal.speciesId === SHRIMP,
      );
      if (!parent) throw new Error("seed fixture needs a shrimp parent");
      const createJuvenile = (
        world as unknown as {
          createJuvenileAnimalState(
            animal: NonNullable<typeof parent>,
            birthIndex: number,
          ): NonNullable<typeof parent>;
        }
      ).createJuvenileAnimalState.bind(world);
      return Array.from({ length: 32 }, (_, index) => {
        parent.reproductiveCycleIndex = Math.floor(index / 2);
        return createJuvenile(parent, index % 2).sex === "female" ? "F" : "M";
      }).join("");
    };

    const first = new SimulationWorld("laboratory", undefined, 0x12345678);
    const repeated = new SimulationWorld("laboratory", undefined, 0x12345678);
    const other = new SimulationWorld("laboratory", undefined, 0x87654321);
    const firstSequence = sexSequence(first);

    expect(sexSequence(repeated)).toBe(firstSequence);
    expect(sexSequence(other)).not.toBe(firstSequence);
    expect(first.exportSaveData().runSeed).toBe(0x12345678);

    const restored = new SimulationWorld("laboratory");
    restored.loadSaveData(first.exportSaveData());
    expect(restored.exportSaveData().runSeed).toBe(0x12345678);
  });

  it("keeps newly supplied adults young even after many animal IDs have been issued", () => {
    const world = new SimulationWorld("laboratory");

    // Repeated cancelled placements reproduce a long-running/edit-heavy tank:
    // IDs continue to advance even though no shrimp remains in the water.
    for (let index = 0; index < 500; index += 1) {
      world.handle({ type: "pick-animal", speciesId: SHRIMP, point: { x: 600, y: 400 } });
      world.handle({ type: "cancel-held" });
    }

    placeShrimp(world, { x: 600, y: 610 });
    const introduced = world.snapshot().animals.at(-1);

    expect(introduced).toBeDefined();
    expect(introduced?.id).toBe("animal-501");
    expect(introduced?.ageSeconds).toBeGreaterThanOrEqual(MIN_SUPPLIED_ADULT_AGE_SECONDS);
    expect(introduced?.ageSeconds).toBeLessThanOrEqual(MAX_SUPPLIED_ADULT_AGE_SECONDS);
    expect(introduced?.bodyLength).toBeLessThan(36);
    expect(introduced?.structuralBiomass).toBeGreaterThanOrEqual(
      SHRIMP_ECOLOGY_RULES.suppliedFemaleStructuralBiomassMinimum,
    );
    expect(introduced?.structuralBiomass).toBeLessThanOrEqual(
      SHRIMP_ECOLOGY_RULES.suppliedFemaleStructuralBiomassMaximum,
    );
    expect(introduced?.structuralBiomass).toBeGreaterThan(
      SHRIMP_ECOLOGY_RULES.maturationStructuralBiomass,
    );
    expect(introduced?.structuralBiomass).toBeLessThanOrEqual(0.125);

    world.handle({
      type: "pick-animal",
      speciesId: SHRIMP,
      sex: "male",
      point: { x: 640, y: 610 },
    });
    world.handle({ type: "drop-held", point: { x: 640, y: 610 } });
    const introducedMale = world.snapshot().animals.at(-1);
    expect(introducedMale?.sex).toBe("male");
    expect(introducedMale?.structuralBiomass).toBeGreaterThanOrEqual(
      SHRIMP_ECOLOGY_RULES.suppliedMaleStructuralBiomassMinimum,
    );
    expect(introducedMale?.structuralBiomass).toBeLessThanOrEqual(
      SHRIMP_ECOLOGY_RULES.suppliedMaleStructuralBiomassMaximum,
    );
    expect((introduced?.lifespanSeconds ?? 0) - (introduced?.ageSeconds ?? 0))
      .toBeGreaterThanOrEqual(
        MIN_LIFESPAN_SECONDS - MAX_SUPPLIED_ADULT_AGE_SECONDS,
      );

    world.handle({ type: "start" });
    world.tick(0.1);
    expect(world.snapshot().animals.some((animal) => animal.id === "animal-501")).toBe(true);
    expect(world.snapshot().animalPopulationEventTotals.deathsByCause["old-age"]).toBe(0);
  });

  it("does not add a second lifespan when a juvenile matures late", () => {
    const world = new SimulationWorld("laboratory");
    placeShrimp(world, { x: 600, y: 610 });
    const save = world.exportSaveData();
    const shrimp = save.animals[0]!;
    shrimp.origin = "born";
    shrimp.lifeStage = "juvenile";
    shrimp.sex = "male";
    shrimp.ovarianClutchSize = undefined;
    shrimp.ageSeconds = SHRIMP_ECOLOGY_RULES.maturationMaximumSeconds;
    shrimp.maturationTargetSeconds =
      SHRIMP_ECOLOGY_RULES.maturationMaximumSeconds;
    shrimp.structuralBiomass =
      SHRIMP_ECOLOGY_RULES.maturationStructuralBiomass;
    shrimp.peakStructuralBiomass = shrimp.structuralBiomass;
    shrimp.storedBiomass = 0.03;
    shrimp.growthProgress = 1;
    shrimp.lifespanSeconds = 2_400;
    world.loadSaveData(save);

    (world as unknown as {
      stepAnimalEcology(deltaSeconds: number): void;
    }).stepAnimalEcology(1);

    const matured = world.snapshot().animals[0]!;
    expect(matured.lifeStage).toBe("adult");
    expect(matured.lifespanSeconds).toBe(2_400);
    expect(matured.lifespanSeconds).toBeLessThanOrEqual(45 * 60);
  });

  it("shows a juvenile meal in condition while allocating only surplus to growth", () => {
    const world = new SimulationWorld("laboratory");
    const foodCell = world.snapshot().cells
      .filter((cell) => cell.surfaceKind === "substrate")
      .sort((left, right) =>
        Math.abs(left.x - 600) - Math.abs(right.x - 600))[0]!;
    placeSeed(world, "nitzschia", foodCell);
    placeShrimp(world, foodCell);

    const save = world.exportSaveData();
    const shrimp = save.animals[0]!;
    shrimp.origin = "born";
    shrimp.lifeStage = "juvenile";
    shrimp.ageSeconds = 120;
    shrimp.maturationTargetSeconds =
      SHRIMP_ECOLOGY_RULES.maturationMinimumSeconds;
    shrimp.structuralBiomass =
      WATER_CYCLE_RULES.shrimp.juvenileBirthBiomass;
    shrimp.peakStructuralBiomass = shrimp.structuralBiomass;
    shrimp.storedBiomass = 0;
    shrimp.growthProgress = 0;
    shrimp.energy = 0.28;
    shrimp.position = { x: foodCell.x, y: foodCell.y - 4 };
    shrimp.behavior = "grazing";
    shrimp.targetCellId = foodCell.id;
    shrimp.behaviorTimer = 60;
    world.loadSaveData(save);

    const before = world.exportSaveData().animals[0]!;
    for (let second = 0; second < 30; second += 1) {
      (world as unknown as {
        stepAnimalEcology(deltaSeconds: number): void;
      }).stepAnimalEcology(1);
    }
    const after = world.exportSaveData().animals[0]!;

    expect(after.consumedBiomass).toBeGreaterThan(before.consumedBiomass);
    expect(after.energy).toBeGreaterThan(before.energy);
    // The meal is visible in the reserve-led condition meter while material
    // above the size-scaled protected floor can fund real structure in the
    // same interval. It is not parked in a large, invisible juvenile store.
    expect(after.storedBiomass).toBeGreaterThan(0);
    expect(after.structuralBiomass).toBeGreaterThan(before.structuralBiomass);
    for (let second = 0; second < 120; second += 1) {
      (world as unknown as {
        stepAnimalEcology(deltaSeconds: number): void;
      }).stepAnimalEcology(1);
    }
    expect(world.exportSaveData().animals[0]!.structuralBiomass)
      .toBeGreaterThan(before.structuralBiomass);
  });

  it("reaches and grazes food on a substrate cell at the tank edge", () => {
    const world = new SimulationWorld("laboratory");
    const edgeCell = world
      .snapshot()
      .cells
      .filter((cell) => cell.surfaceKind === "substrate")
      .sort((left, right) => left.x - right.x)[0];
    expect(edgeCell).toBeDefined();
    if (!edgeCell) throw new Error("laboratory substrate must contain an edge cell");

    // The cell centre lies outside the legal bounds for an animal's body
    // centre. Movement and feeding still need to agree on the reachable
    // contact point; otherwise the shrimp stops a few pixels short forever.
    placeSeed(world, "nitzschia", edgeCell);
    placeShrimp(world, edgeCell);
    const shrimpId = world.snapshot().animals[0].id;
    world.handle({ type: "start" });
    world.handle({ type: "set-speed", speed: 16 });

    let shrimp = world.snapshot().animals.find((animal) => animal.id === shrimpId);
    while (
      world.snapshot().elapsedSeconds < 30 &&
      (shrimp?.consumedBiomass ?? 0) <= 0
    ) {
      shrimp = advanceOneTick(world).animals.find((animal) => animal.id === shrimpId);
    }

    expect(shrimp).toBeDefined();
    expect(shrimp?.consumedBiomass ?? 0).toBeGreaterThan(0);
    expect(shrimp?.secondsSinceFood ?? Number.POSITIVE_INFINITY).toBeLessThan(10);
  });

  it("lets a well-fed shrimp die of old age instead of living forever", () => {
    const { world, initial } = configureFoodRichLaboratory([
      { x: 600, y: 610 },
    ]);
    const original = initial.animals[0];
    const lifespan = lifespanOf(original);
    let lastLivingAge = original.ageSeconds;
    let lastLivingEnergy = original.energy;
    let oldAgeCarcass: WorldSnapshot["carcasses"][number] | undefined;

    while (world.snapshot().elapsedSeconds < MAX_TEST_TIME_SECONDS) {
      const snapshot = advanceOneTick(world);
      const living = snapshot.animals.find((animal) => animal.id === original.id);
      if (living) {
        lastLivingAge = living.ageSeconds;
        lastLivingEnergy = living.energy;
      }
      oldAgeCarcass = snapshot.carcasses.find(
        (carcass) =>
          carcass.sourceAnimalId === original.id &&
          (carcass.cause as string) === "old-age",
      );
      if (oldAgeCarcass) break;
    }

    expect(oldAgeCarcass).toBeDefined();
    expect(world.snapshot().animals.some((animal) => animal.id === original.id)).toBe(false);
    // A 64× real-frame tick advances 6.4 simulated seconds, so the last living
    // snapshot can precede the exact death deadline by one such integration.
    expect(lastLivingAge).toBeGreaterThanOrEqual(lifespan - 7);
    expect(lastLivingEnergy).toBeGreaterThan(0);
    expect(oldAgeCarcass?.cause as string).toBe("old-age");

    const deathRecord = world.snapshot().animalPopulationEvents.find(
      (event) => event.animalId === original.id && event.kind === "death",
    );
    expect(deathRecord?.cause).toBe("old-age");
    expect(deathRecord?.ageSeconds).toBeGreaterThanOrEqual(lifespan - 2);
    expect(world.snapshot().animalPopulationEventTotals.deathsByCause["old-age"]).toBe(1);

    // The visual carcass is temporary, but its diagnostic record must survive.
    for (let elapsed = 0; elapsed < 56; elapsed += 0.1) advanceOneTick(world);
    const afterDecomposition = world.snapshot();
    expect(afterDecomposition.carcasses.some(
      (carcass) => carcass.sourceAnimalId === original.id,
    )).toBe(false);
    expect(afterDecomposition.animalPopulationEvents.some(
      (event) => event.animalId === original.id && event.kind === "death",
    )).toBe(true);
  }, LIFECYCLE_TEST_TIMEOUT_MS);

  it("records introductions and laboratory removals as population changes", () => {
    const world = new SimulationWorld("laboratory");
    placeShrimp(world, { x: 600, y: 610 });
    const animalId = world.snapshot().animals[0].id;

    expect(world.snapshot().animalPopulationEvents).toHaveLength(0);
    world.handle({ type: "start" });
    expect(world.snapshot().animalPopulationEventTotals.introduced).toBe(1);
    expect(world.snapshot().animalPopulationEvents.at(-1)?.kind).toBe("introduced");

    world.handle({ type: "pause" });
    world.handle({ type: "retrieve-animal", id: animalId });
    const snapshot = world.snapshot();
    expect(snapshot.animalPopulationEventTotals.removed).toBe(1);
    expect(snapshot.animalPopulationEvents.at(-1)?.kind).toBe("removed");
    expect(snapshot.animalPopulation[SHRIMP].total).toBe(0);
  });

  it("produces offspring and leaves a later generation after founders begin dying of old age", () => {
    const { world, initial } = configureFoodRichLaboratory([
      { x: 565, y: 610 },
      { x: 595, y: 610 },
      { x: 765, y: 610 },
      { x: 795, y: 610 },
    ]);
    const founderIds = new Set(initial.animals.map((animal) => animal.id));
    const oldAgeFounderIds = new Set<string>();
    const bornIds = new Set<string>();
    let turnoverSnapshot: WorldSnapshot | null = null;

    while (world.snapshot().elapsedSeconds < MAX_TEST_TIME_SECONDS) {
      const snapshot = advanceOneTick(world);
      for (const animal of snapshot.animals) {
        if (!founderIds.has(animal.id)) bornIds.add(animal.id);
      }
      for (const carcass of snapshot.carcasses) {
        if (
          founderIds.has(carcass.sourceAnimalId) &&
          (carcass.cause as string) === "old-age"
        ) {
          oldAgeFounderIds.add(carcass.sourceAnimalId);
        }
      }
      if (
        oldAgeFounderIds.size > 0 &&
        snapshot.animals.some((animal) => bornIds.has(animal.id))
      ) {
        turnoverSnapshot = snapshot;
        break;
      }
    }

    expect(bornIds.size).toBeGreaterThan(0);
    expect(oldAgeFounderIds.size).toBeGreaterThan(0);
    expect(turnoverSnapshot).not.toBeNull();
    expect(
      turnoverSnapshot?.animals.some((animal) => !founderIds.has(animal.id)),
    ).toBe(true);
  }, LIFECYCLE_TEST_TIMEOUT_MS);
});
