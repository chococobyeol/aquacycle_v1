import { describe, expect, it } from "vitest";
import { SimulationWorld } from "../src/simulation/SimulationWorld";
import { BiogeochemistryLedger } from "../src/simulation/biogeochemistry";
import type {
  AnimalSpeciesId,
  SpeciesId,
  Vec2,
} from "../src/simulation/types";

const SHRIMP: AnimalSpeciesId = "cherry-shrimp";
const MIN_LIFESPAN_SECONDS = 900;
const MAX_LIFESPAN_SECONDS = 1_350;
const MIN_SUPPLIED_ADULT_AGE_SECONDS = 180;
const MAX_SUPPLIED_ADULT_AGE_SECONDS = 300;
const MAX_TEST_TIME_SECONDS = 1_450;
// The lifecycle simulation intentionally advances more than a thousand
// in-world seconds. On slower Macs or while other long-run suites execute in
// parallel it can exceed 15 seconds without indicating a simulation failure.
const LIFECYCLE_TEST_TIMEOUT_MS = 30_000;

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
  world.handle({ type: "set-speed", speed: 16 });
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
  it("assigns each supplied shrimp an individual compressed lifespan", () => {
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
    for (const lifespan of lifespans) {
      expect(lifespan).toBeGreaterThanOrEqual(MIN_LIFESPAN_SECONDS);
      expect(lifespan).toBeLessThanOrEqual(MAX_LIFESPAN_SECONDS);
    }
    expect(new Set(lifespans).size).toBeGreaterThan(1);
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
    expect((introduced?.lifespanSeconds ?? 0) - (introduced?.ageSeconds ?? 0)).toBeGreaterThanOrEqual(
      MIN_LIFESPAN_SECONDS - MAX_SUPPLIED_ADULT_AGE_SECONDS,
    );

    world.handle({ type: "start" });
    world.tick(0.1);
    expect(world.snapshot().animals.some((animal) => animal.id === "animal-501")).toBe(true);
    expect(world.snapshot().animalPopulationEventTotals.deathsByCause["old-age"]).toBe(0);
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
    expect(lastLivingAge).toBeGreaterThanOrEqual(lifespan - 2);
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
