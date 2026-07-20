import { describe, expect, it } from "vitest";
import { SCENARIOS } from "../src/simulation/config";
import {
  SHRIMP_TECHNICAL_POPULATION_LIMIT,
  SimulationWorld,
} from "../src/simulation/SimulationWorld";
import type {
  AnimalSpeciesId,
  SpeciesId,
  SurfaceCellSnapshot,
  Vec2,
} from "../src/simulation/types";

const SHRIMP: AnimalSpeciesId = "cherry-shrimp";

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

const advanceTo = (
  world: SimulationWorld,
  targetSeconds: number,
): ReturnType<SimulationWorld["snapshot"]> => {
  world.handle({ type: "set-speed", speed: 16 });
  let snapshot = world.snapshot();
  let guard = 0;
  while (snapshot.elapsedSeconds < targetSeconds && guard < 2_000) {
    world.tick(0.1);
    snapshot = world.snapshot();
    guard += 1;
  }
  expect(guard).toBeLessThan(2_000);
  return snapshot;
};

const nearestSuitableCell = (
  cells: SurfaceCellSnapshot[],
  targetX: number,
  targetLight: number,
  excluded: Set<string>,
): SurfaceCellSnapshot => {
  const candidate = cells
    .filter((cell) => !excluded.has(cell.id))
    .sort((a, b) => {
      const scoreA =
        Math.abs(a.x - targetX) / 35 + Math.abs(a.light - targetLight);
      const scoreB =
        Math.abs(b.x - targetX) / 35 + Math.abs(b.light - targetLight);
      return scoreA - scoreB;
    })[0];
  if (!candidate)
    throw new Error("mission 4 needs a substrate inoculation cell");
  excluded.add(candidate.id);
  return candidate;
};

interface ViableLayout {
  seedPoints: Array<{ speciesId: SpeciesId; point: Vec2 }>;
  shrimpPoints: Vec2[];
}

const viableLayout = (world: SimulationWorld): ViableLayout => {
  const substrate = world
    .snapshot()
    .cells.filter((cell) => cell.surfaceKind === "substrate");
  const used = new Set<string>();
  const seedPoints: ViableLayout["seedPoints"] = [];
  const clusterCenters = [330, 870];

  for (const center of clusterCenters) {
    for (const offset of [-70, 70]) {
      const diatom = nearestSuitableCell(substrate, center + offset, 38, used);
      seedPoints.push({ speciesId: "nitzschia", point: diatom });
      const filament = nearestSuitableCell(
        substrate,
        center + offset + 25,
        68,
        used,
      );
      seedPoints.push({ speciesId: "oedogonium", point: filament });
    }
  }

  return {
    seedPoints,
    // IDs alternate female/male, so each nearby pair can mate without forcing
    // every animal onto the same grazing cell.
    shrimpPoints: [
      { x: 315, y: 600 },
      { x: 350, y: 600 },
      { x: 855, y: 600 },
      { x: 890, y: 600 },
    ],
  };
};

const applyLayout = (
  world: SimulationWorld,
  layout: ViableLayout,
  includeShrimp: boolean,
): void => {
  for (const seed of layout.seedPoints)
    placeSeed(world, seed.speciesId, seed.point);
  if (includeShrimp) {
    for (const point of layout.shrimpPoints) placeShrimp(world, point);
  }
};

describe("mission 4 consumer balance", () => {
  it("publishes a settled setup after placing an animal in a tank without structures", () => {
    const world = new SimulationWorld("mission-4");
    const point = { x: 420, y: 600 };

    world.handle({ type: "pick-animal", speciesId: SHRIMP, point });
    world.snapshot();
    world.tick(0.1);
    expect(world.snapshot().allSettled).toBe(false);

    world.handle({ type: "drop-held", point });
    world.snapshot();
    expect(world.tick(0.1)).toBe(true);
    expect(world.snapshot().allSettled).toBe(true);
  });

  it("does not create a carcass when a live shrimp is moved or returned to inventory", () => {
    const world = new SimulationWorld("mission-4");
    const point = { x: 420, y: 600 };
    placeShrimp(world, point);

    world.handle({ type: "pick-at", point });
    expect(world.snapshot().animals).toHaveLength(0);
    expect(world.snapshot().carcasses).toHaveLength(0);

    world.handle({ type: "retrieve-held" });
    expect(world.snapshot().animals).toHaveLength(0);
    expect(world.snapshot().carcasses).toHaveLength(0);
    expect(world.snapshot().biogeochemistry.detritusMass).toBe(0);
  });

  it("starts without forcing structures, algae, or animals to be installed", () => {
    const world = new SimulationWorld("mission-4");
    const initial = world.snapshot();

    expect(initial.structures).toHaveLength(0);
    expect(initial.seeds).toHaveLength(0);
    expect(initial.animals).toHaveLength(0);
    world.handle({ type: "start" });

    expect(world.snapshot().phase).toBe("running");
  });

  it("cannot pass on adult reserves without algae and records respiration and carcasses", () => {
    const world = new SimulationWorld("mission-4");
    for (const point of [
      { x: 285, y: 600 },
      { x: 495, y: 600 },
      { x: 705, y: 600 },
      { x: 915, y: 600 },
    ])
      placeShrimp(world, point);

    const placed = world.snapshot();
    expect(placed.animalPopulation[SHRIMP].adults).toBe(4);
    expect(placed.totalBiomass.oedogonium + placed.totalBiomass.nitzschia).toBe(
      0,
    );
    world.handle({ type: "start" });

    // Leave a full fixed-step margin before the 120-second hold boundary; the
    // high-speed test driver can advance by more than one simulated second per
    // outer tick.
    const beforeRequiredHold = advanceTo(world, 110);
    expect(beforeRequiredHold.elapsedSeconds).toBeLessThan(120);
    expect(beforeRequiredHold.animalPopulation[SHRIMP].adults).toBeLessThan(4);
    expect(beforeRequiredHold.animalPopulation[SHRIMP].juveniles).toBe(0);
    expect(beforeRequiredHold.totalAlgaeConsumed).toBe(0);
    expect(beforeRequiredHold.outcome).toBe("pending");
    expect(
      beforeRequiredHold.biogeochemistry.potentialOxygenDemand,
    ).toBeGreaterThan(0);
    expect(beforeRequiredHold.biogeochemistry.detritusMass).toBeGreaterThan(0);
    expect(beforeRequiredHold.carcasses.length).toBeGreaterThan(0);
    for (const carcass of beforeRequiredHold.carcasses) {
      expect(carcass.id).toBe(`carcass:${carcass.sourceAnimalId}`);
      expect(carcass.speciesId).toBe(SHRIMP);
      expect(carcass.cause).toBe("starvation");
      expect(carcass.bodyLength).toBeGreaterThan(0);
      expect(carcass.ageSeconds).toBeGreaterThanOrEqual(0);
      expect(carcass.lifetimeSeconds).toBe(55);
      expect(carcass.progress).toBeCloseTo(
        carcass.ageSeconds / carcass.lifetimeSeconds,
        6,
      );
    }

    const failed = advanceTo(world, 300);
    expect(failed.outcome).toBe("failure");
    expect(failed.animalPopulation[SHRIMP].juveniles).toBe(0);
    expect(failed.animalPopulation[SHRIMP].total).toBeLessThanOrEqual(4);
    expect(failed.totalAlgaeConsumed).toBe(0);
    expect(failed.missionProgress?.holdCurrent).toBe(0);
    expect(failed.biogeochemistry.effectsEnabled).toBe(false);
    expect(failed.carcasses).toHaveLength(0);
  });

  it("records death mass once while its visual carcass expires independently", () => {
    const world = new SimulationWorld("mission-4");
    placeShrimp(world, { x: 420, y: 600 });
    world.handle({ type: "start" });

    let snapshot = world.snapshot();
    while (!snapshot.carcasses.length && snapshot.elapsedSeconds < 140) {
      world.tick(0.1);
      snapshot = world.snapshot();
    }

    expect(snapshot.animals).toHaveLength(0);
    expect(snapshot.carcasses).toHaveLength(1);
    expect(snapshot.carcasses[0].cause).toBe("starvation");
    expect(snapshot.biogeochemistry.detritusMass).toBeCloseTo(1, 6);
    world.handle({
      type: "select-at",
      point: { x: snapshot.carcasses[0].x, y: snapshot.carcasses[0].y },
      filter: "organism",
    });
    expect(world.snapshot().selection).toMatchObject({
      kind: "carcass",
      carcassId: snapshot.carcasses[0].id,
    });
    const deathTime = snapshot.elapsedSeconds;
    const deathMass = snapshot.biogeochemistry.detritusMass;

    const stillVisible = advanceTo(world, deathTime + 40);
    expect(stillVisible.carcasses).toHaveLength(1);
    expect(stillVisible.carcasses[0].progress).toBeGreaterThan(0.7);
    expect(stillVisible.biogeochemistry.detritusMass).toBeCloseTo(deathMass, 6);

    const expired = advanceTo(world, deathTime + 56);
    expect(expired.carcasses).toHaveLength(0);
    expect(expired.biogeochemistry.detritusMass).toBeCloseTo(deathMass, 6);

    world.handle({ type: "reset" });
    expect(world.snapshot().carcasses).toHaveLength(0);
    expect(world.snapshot().biogeochemistry.detritusMass).toBe(0);
  });

  it("lets a distributed, growing algae layout sustain four adults while recording grazing waste", () => {
    const fedWorld = new SimulationWorld("mission-4");
    const controlWorld = new SimulationWorld("mission-4");
    const layout = viableLayout(fedWorld);
    applyLayout(fedWorld, layout, true);
    applyLayout(controlWorld, layout, false);

    fedWorld.handle({ type: "start" });
    controlWorld.handle({ type: "start" });
    const fedAt60 = advanceTo(fedWorld, 60);
    const controlAt60 = advanceTo(controlWorld, 60);
    const fedBiomass =
      fedAt60.totalBiomass.oedogonium + fedAt60.totalBiomass.nitzschia;
    const controlBiomass =
      controlAt60.totalBiomass.oedogonium + controlAt60.totalBiomass.nitzschia;

    expect(fedAt60.animalPopulation[SHRIMP].adults).toBe(4);
    expect(fedAt60.biogeochemistry.dissolvedWasteProduced).toBeGreaterThan(0);
    expect(fedAt60.animals.some((animal) => animal.recentIntake > 0)).toBe(
      true,
    );
    expect(fedAt60.totalAlgaeConsumed).toBeGreaterThan(0);
    expect(
      fedAt60.animals.reduce((sum, animal) => sum + animal.consumedBiomass, 0),
    ).toBeCloseTo(fedAt60.totalAlgaeConsumed, 5);
    expect(fedBiomass).toBeLessThan(controlBiomass);
    const controlCells = new Map(controlAt60.cells.map((cell) => [cell.id, cell]));
    expect(fedAt60.cells.some((cell) => {
      const control = controlCells.get(cell.id);
      if (!control) return false;
      const fedAmount = cell.biomass.oedogonium + cell.biomass.nitzschia;
      const controlAmount = control.biomass.oedogonium + control.biomass.nitzschia;
      return controlAmount - fedAmount > 0.01;
    })).toBe(true);

    const succeeded = advanceTo(fedWorld, 125);
    expect(succeeded.outcome).toBe("success");
    expect(succeeded.outcomeAtSeconds).toBeGreaterThanOrEqual(120);
    expect(succeeded.outcomeAtSeconds).toBeLessThanOrEqual(125);
    expect(succeeded.animalPopulation[SHRIMP].adults).toBeGreaterThanOrEqual(4);
    expect(succeeded.missionProgress?.unit).toBe("adult-count");
    expect(succeeded.missionProgress?.current).toBeGreaterThanOrEqual(4);
    expect(succeeded.biogeochemistry.potentialOxygenDemand).toBeGreaterThan(0);
    expect(succeeded.biogeochemistry.dissolvedWasteProduced).toBeGreaterThan(0);
  });

  it("lets real food support juveniles and growth beyond the former eight-shrimp cap", () => {
    const world = new SimulationWorld("mission-4");
    const layout = viableLayout(world);
    applyLayout(world, layout, true);
    world.handle({ type: "start" });

    const at300 = advanceTo(world, 300);
    expect(at300.animalPopulation[SHRIMP].juveniles).toBeGreaterThan(0);
    expect(at300.animalPopulation[SHRIMP].total).toBeGreaterThan(
      at300.animalPopulation[SHRIMP].adults,
    );
    expect(at300.animalPopulation[SHRIMP].total).toBeGreaterThan(4);
    expect(at300.missionProgress?.current).toBe(
      at300.animalPopulation[SHRIMP].adults,
    );
    expect(at300.missionProgress?.current).not.toBe(
      at300.animalPopulation[SHRIMP].total,
    );
    expect(SCENARIOS["mission-4"].target?.type).toBe("adult-population");

    const consumedAt300 = at300.totalAlgaeConsumed;
    const at600 = advanceTo(world, 600);
    expect(at600.animalPopulation[SHRIMP].total).toBeGreaterThan(8);
    expect(at600.animalPopulation[SHRIMP].total).toBeLessThan(
      SHRIMP_TECHNICAL_POPULATION_LIMIT,
    );
    expect(at600.totalAlgaeConsumed).toBeGreaterThan(consumedAt300);
  });

  it("alternates between grazing and free movement instead of staying glued to algae", () => {
    const world = new SimulationWorld("mission-4");
    const layout = viableLayout(world);
    applyLayout(world, layout, true);
    const initial = world.snapshot();
    const initialPositions = new Map(
      initial.animals.map((animal) => [
        animal.id,
        { x: animal.x, y: animal.y },
      ]),
    );
    world.handle({ type: "start" });
    world.handle({ type: "set-speed", speed: 16 });

    let grazingObservations = 0;
    let freeMovementObservations = 0;
    let totalObservations = 0;
    const maximumDisplacement = new Map(
      initial.animals.map((animal) => [animal.id, 0]),
    );

    while (world.snapshot().elapsedSeconds < 120) {
      world.tick(0.1);
      const snapshot = world.snapshot();
      for (const animal of snapshot.animals) {
        const origin = initialPositions.get(animal.id);
        if (!origin) continue;
        totalObservations += 1;
        if (animal.behavior === "grazing") grazingObservations += 1;
        if (
          animal.behavior === "exploring" ||
          animal.behavior === "traveling"
        ) {
          freeMovementObservations += 1;
        }
        maximumDisplacement.set(
          animal.id,
          Math.max(
            maximumDisplacement.get(animal.id) ?? 0,
            Math.hypot(animal.x - origin.x, animal.y - origin.y),
          ),
        );
      }
    }

    expect(grazingObservations).toBeGreaterThan(0);
    expect(freeMovementObservations / totalObservations).toBeGreaterThan(0.15);
    expect(
      [...maximumDisplacement.values()].filter((distance) => distance > 60),
    ).toHaveLength(4);
  });

  it("leaves a grazed patch for a visible roaming interval before seeking food again", () => {
    const world = new SimulationWorld("mission-4");
    const layout = viableLayout(world);
    applyLayout(world, layout, false);
    placeShrimp(world, layout.shrimpPoints[0]);
    world.handle({ type: "start" });
    world.handle({ type: "set-speed", speed: 4 });

    let previousBehavior = world.snapshot().animals[0]?.behavior;
    let departure: {
      id: string;
      x: number;
      y: number;
      elapsedSeconds: number;
      consumedBiomass: number;
    } | null = null;

    while (world.snapshot().elapsedSeconds < 160 && !departure) {
      world.tick(0.05);
      const snapshot = world.snapshot();
      const animal = snapshot.animals[0];
      if (!animal) break;
      if (previousBehavior === "grazing" && animal.behavior !== "grazing") {
        expect(animal.behavior).toBe("exploring");
        departure = {
          id: animal.id,
          x: animal.x,
          y: animal.y,
          elapsedSeconds: snapshot.elapsedSeconds,
          consumedBiomass: animal.consumedBiomass,
        };
        break;
      }
      previousBehavior = animal.behavior;
    }

    expect(departure).not.toBeNull();
    if (!departure) throw new Error("shrimp never completed a grazing bout");

    let maximumDepartureDistance = 0;
    while (world.snapshot().elapsedSeconds < departure.elapsedSeconds + 2) {
      world.tick(0.05);
      const animal = world.snapshot().animals.find(({ id }) => id === departure.id);
      expect(animal).toBeDefined();
      if (!animal) break;
      expect(animal.behavior).not.toBe("grazing");
      maximumDepartureDistance = Math.max(
        maximumDepartureDistance,
        Math.hypot(animal.x - departure.x, animal.y - departure.y),
      );
    }

    expect(maximumDepartureDistance).toBeGreaterThan(24);

    const consumedAtDeparture = departure.consumedBiomass;
    const resumed = advanceTo(world, departure.elapsedSeconds + 45);
    const survivingShrimp = resumed.animals.find(({ id }) => id === departure.id);
    expect(survivingShrimp).toBeDefined();
    expect(survivingShrimp?.consumedBiomass ?? 0).toBeGreaterThan(consumedAtDeparture);
  });
});
