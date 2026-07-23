import { describe, expect, it } from 'vitest';
import {
  SHRIMP_TECHNICAL_POPULATION_LIMIT,
  SimulationWorld,
} from '../src/simulation/SimulationWorld';
import {
  initialWaterTemperatureForLight,
  SCENARIOS,
} from '../src/simulation/config';
import { netGrowthPotential } from '../src/simulation/growth';
import type {
  AnimalSpeciesId,
  SpeciesBiomass,
  SpeciesId,
  SurfaceCellSnapshot,
  Vec2,
} from '../src/simulation/types';

const SHRIMP: AnimalSpeciesId = 'cherry-shrimp';

interface DebugSurfaceCell {
  id: string;
  surfaceKind: string;
  light: number;
  biomass: SpeciesBiomass;
}

interface DebugAnimal {
  id: string;
  behavior: string;
  targetCellId: string | null;
}

interface DebugWorld {
  allCells(): DebugSurfaceCell[];
  stepGrowth(deltaSeconds: number): void;
  animals: DebugAnimal[];
  seedPlacements: Array<{ cellId: string }>;
  snapshotDirty: boolean;
}

const debugWorld = (world: SimulationWorld): DebugWorld =>
  world as unknown as DebugWorld;

const placeSeed = (
  world: SimulationWorld,
  speciesId: SpeciesId,
  point: Vec2,
): void => {
  world.handle({ type: 'pick-seed', speciesId, point });
  world.handle({ type: 'drop-held', point });
};

const placeShrimp = (world: SimulationWorld, point: Vec2): void => {
  world.handle({ type: 'pick-animal', speciesId: SHRIMP, point });
  world.handle({ type: 'drop-held', point });
};

const advanceTo = (
  world: SimulationWorld,
  targetSeconds: number,
  speed: 16 | 64 = 64,
): ReturnType<SimulationWorld['snapshot']> => {
  world.handle({ type: 'set-speed', speed });
  let snapshot = world.snapshot();
  let guard = 0;
  while (snapshot.elapsedSeconds < targetSeconds && guard < 20_000) {
    world.tick(0.1);
    snapshot = world.snapshot();
    guard += 1;
  }
  expect(guard).toBeLessThan(20_000);
  return snapshot;
};

const totalAlgae = (snapshot: ReturnType<SimulationWorld['snapshot']>): number =>
  snapshot.totalBiomass.oedogonium + snapshot.totalBiomass.nitzschia;

const nearestSuitableCell = (
  cells: SurfaceCellSnapshot[],
  targetX: number,
  targetLight: number,
  used: Set<string>,
): SurfaceCellSnapshot => {
  const cell = cells
    .filter((candidate) => !used.has(candidate.id))
    .sort((left, right) => {
      const leftScore = Math.abs(left.x - targetX) / 35 + Math.abs(left.light - targetLight);
      const rightScore = Math.abs(right.x - targetX) / 35 + Math.abs(right.light - targetLight);
      return leftScore - rightScore;
    })[0];
  if (!cell) throw new Error('consumer-resource fixture needs another substrate cell');
  used.add(cell.id);
  return cell;
};

const seedDistributedAlgae = (world: SimulationWorld): Vec2[] => {
  const substrate = world.snapshot().cells.filter((cell) => cell.surfaceKind === 'substrate');
  const used = new Set<string>();
  const foodPoints: Vec2[] = [];
  for (const targetX of [260, 470, 730, 940]) {
    const nitzschia = nearestSuitableCell(substrate, targetX, 38, used);
    placeSeed(world, 'nitzschia', nitzschia);
    placeSeed(world, 'oedogonium', nearestSuitableCell(substrate, targetX + 24, 68, used));
    foodPoints.push(nitzschia);
  }
  return foodPoints;
};

const placeFourShrimp = (
  world: SimulationWorld,
  points: Vec2[] = [
    { x: 290, y: 600 },
    { x: 430, y: 600 },
    { x: 770, y: 600 },
    { x: 910, y: 600 },
  ],
): void => {
  for (const point of points.slice(0, 4)) placeShrimp(world, point);
};

describe('consumer-resource emergence', () => {
  it('moves propagules without creating algae mass during dispersal', () => {
    const world = new SimulationWorld('mission-1');
    const internals = debugWorld(world);
    const cells = internals.allCells();
    for (const cell of cells) {
      cell.light = 45;
      cell.biomass = { oedogonium: 0, nitzschia: 0, vallisneria: 0 };
    }
    const source = cells[Math.floor(cells.length / 2)];
    const initialBiomass = 0.28;
    source.biomass.oedogonium = initialBiomass;

    internals.stepGrowth(1);

    const temperature = initialWaterTemperatureForLight(SCENARIOS['mission-1'].lightOutput);
    const rate = netGrowthPotential('oedogonium', 45, temperature);
    const expectedBiomass = initialBiomass +
      initialBiomass * rate * (1 - initialBiomass) -
      initialBiomass * 0.0018;
    const actualBiomass = cells.reduce(
      (sum, cell) => sum + cell.biomass.oedogonium,
      0,
    );

    expect(actualBiomass).toBeCloseTo(expectedBiomass, 8);
    expect(cells.some((cell) => cell.id !== source.id && cell.biomass.oedogonium > 0)).toBe(true);
  });

  it('creates a local and tank-wide algae deficit when shrimp graze a player-seeded tank', () => {
    const control = new SimulationWorld('mission-4');
    const grazed = new SimulationWorld('mission-4');
    seedDistributedAlgae(control);
    const foodPoints = seedDistributedAlgae(grazed);
    placeFourShrimp(grazed, foodPoints);
    control.handle({ type: 'start' });
    grazed.handle({ type: 'start' });

    const controlAt60 = advanceTo(control, 60);
    const grazedAt60 = advanceTo(grazed, 60);
    const controlAlgae = totalAlgae(controlAt60);
    const grazedAlgae = totalAlgae(grazedAt60);
    const algaeDeficit = controlAlgae - grazedAlgae;

    expect(grazedAt60.totalAlgaeConsumed).toBeGreaterThan(0);
    expect(algaeDeficit).toBeGreaterThan(0);
    const controlCells = new Map(controlAt60.cells.map((cell) => [cell.id, cell]));
    expect(grazedAt60.cells.some((cell) => {
      const controlCell = controlCells.get(cell.id);
      if (!controlCell) return false;
      const controlAmount =
        controlCell.biomass.oedogonium + controlCell.biomass.nitzschia;
      const grazedAmount = cell.biomass.oedogonium + cell.biomass.nitzschia;
      return controlAmount - grazedAmount > 0.01;
    })).toBe(true);
    expect(
      grazedAt60.animals.reduce(
        (sum, animal) => sum + animal.consumedBiomass,
        0,
      ),
    ).toBeCloseTo(grazedAt60.totalAlgaeConsumed, 5);
  }, 30_000);

  it('lets food established through normal inoculation fund real offspring', () => {
    const world = new SimulationWorld('mission-4');
    const foodPoints = seedDistributedAlgae(world);
    placeFourShrimp(world, foodPoints);
    world.handle({ type: 'start' });
    world.handle({ type: 'set-speed', speed: 64 });

    let maximumPopulation = 4;
    let snapshot = world.snapshot();
    while (snapshot.elapsedSeconds < 600) {
      world.tick(0.1);
      snapshot = world.snapshot();
      maximumPopulation = Math.max(maximumPopulation, snapshot.animalPopulation[SHRIMP].total);
    }

    expect(SHRIMP_TECHNICAL_POPULATION_LIMIT).toBeGreaterThanOrEqual(1_000);
    expect(snapshot.animalPopulationEventTotals.births).toBeGreaterThan(0);
    expect(maximumPopulation).toBeGreaterThan(4);
    expect(snapshot.totalAlgaeConsumed).toBeGreaterThan(0);
  }, 30_000);

  it('grazes the spread colony rather than repeatedly returning only to inoculation cells', () => {
    const world = new SimulationWorld('laboratory');
    seedDistributedAlgae(world);
    const inoculationCellIds = new Set(
      debugWorld(world).seedPlacements.map((seed) => seed.cellId),
    );
    world.handle({ type: 'start' });
    advanceTo(world, 300);
    world.handle({ type: 'pause' });
    placeFourShrimp(world);
    world.handle({ type: 'resume' });
    world.handle({ type: 'set-speed', speed: 16 });

    const grazingObservations = new Map<string, number>();
    const endTime = world.snapshot().elapsedSeconds + 180;
    while (world.snapshot().elapsedSeconds < endTime) {
      world.tick(0.05);
      for (const animal of debugWorld(world).animals) {
        if (animal.behavior !== 'grazing' || !animal.targetCellId) continue;
        grazingObservations.set(
          animal.targetCellId,
          (grazingObservations.get(animal.targetCellId) ?? 0) + 1,
        );
      }
    }

    const totalObservations = [...grazingObservations.values()]
      .reduce((sum, count) => sum + count, 0);
    const inoculationObservations = [...grazingObservations]
      .filter(([cellId]) => inoculationCellIds.has(cellId))
      .reduce((sum, [, count]) => sum + count, 0);
    expect(totalObservations).toBeGreaterThan(50);
    expect(grazingObservations.size).toBeGreaterThan(8);
    expect(inoculationObservations / totalObservations).toBeLessThan(0.5);
  }, 30_000);

  it('makes a player-grown food web outperform an otherwise identical empty tank', () => {
    const fed = new SimulationWorld('mission-4');
    const empty = new SimulationWorld('mission-4');
    const foodPoints = seedDistributedAlgae(fed);
    placeFourShrimp(fed, foodPoints);
    placeFourShrimp(empty, foodPoints);
    fed.handle({ type: 'start' });
    empty.handle({ type: 'start' });

    const fedAt110 = advanceTo(fed, 110);
    const emptyAt110 = advanceTo(empty, 110);

    expect(fedAt110.totalAlgaeConsumed).toBeGreaterThan(0);
    expect(emptyAt110.totalAlgaeConsumed).toBe(0);
    expect(fedAt110.animalPopulation[SHRIMP].total).toBeGreaterThan(
      emptyAt110.animalPopulation[SHRIMP].total,
    );
    expect(fedAt110.animals.some((animal) => animal.recentIntake > 0)).toBe(true);
  }, 30_000);
});
