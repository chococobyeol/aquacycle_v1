import { describe, expect, it } from 'vitest';
import {
  SHRIMP_TECHNICAL_POPULATION_LIMIT,
  SimulationWorld,
} from '../src/simulation/SimulationWorld';
import { SCENARIOS } from '../src/simulation/config';
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

const seedDistributedAlgae = (world: SimulationWorld): void => {
  const substrate = world.snapshot().cells.filter((cell) => cell.surfaceKind === 'substrate');
  const used = new Set<string>();
  for (const targetX of [260, 470, 730, 940]) {
    placeSeed(world, 'nitzschia', nearestSuitableCell(substrate, targetX, 38, used));
    placeSeed(world, 'oedogonium', nearestSuitableCell(substrate, targetX + 24, 68, used));
  }
};

const placeFourShrimp = (world: SimulationWorld): void => {
  for (const point of [
    { x: 290, y: 600 },
    { x: 430, y: 600 },
    { x: 770, y: 600 },
    { x: 910, y: 600 },
  ]) placeShrimp(world, point);
};

const fillProductiveHabitat = (world: SimulationWorld, amount = 0.72): void => {
  const internals = debugWorld(world);
  for (const cell of internals.allCells()) {
    const oedogoniumRate = netGrowthPotential('oedogonium', cell.light, 24);
    const nitzschiaRate = netGrowthPotential('nitzschia', cell.light, 24);
    cell.biomass = oedogoniumRate >= nitzschiaRate
      ? { oedogonium: amount, nitzschia: 0 }
      : { oedogonium: 0, nitzschia: amount };
  }
  internals.snapshotDirty = true;
};

describe('consumer-resource emergence', () => {
  it('moves propagules without creating algae mass during dispersal', () => {
    const world = new SimulationWorld('mission-1');
    const internals = debugWorld(world);
    const cells = internals.allCells();
    for (const cell of cells) {
      cell.light = 45;
      cell.biomass = { oedogonium: 0, nitzschia: 0 };
    }
    const source = cells[Math.floor(cells.length / 2)];
    const initialBiomass = 0.28;
    source.biomass.oedogonium = initialBiomass;

    internals.stepGrowth(1);

    const temperature = 22 + SCENARIOS['mission-1'].lightOutput * 0.018;
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

  it('creates a material algae deficit when shrimp graze a growing tank', () => {
    const control = new SimulationWorld('mission-4');
    const grazed = new SimulationWorld('mission-4');
    seedDistributedAlgae(control);
    seedDistributedAlgae(grazed);
    placeFourShrimp(grazed);
    control.handle({ type: 'start' });
    grazed.handle({ type: 'start' });

    const controlAt600 = advanceTo(control, 600);
    const grazedAt600 = advanceTo(grazed, 600);
    const controlAlgae = totalAlgae(controlAt600);
    const grazedAlgae = totalAlgae(grazedAt600);
    const algaeDeficit = controlAlgae - grazedAlgae;

    expect(grazedAt600.totalAlgaeConsumed).toBeGreaterThan(0);
    // A one-cell or floating-point difference would not be visible to a player.
    // Four consumers must remove a material share of the standing crop.
    expect(algaeDeficit).toBeGreaterThan(controlAlgae * 0.08);
    expect(grazedAt600.totalAlgaeConsumed).toBeGreaterThan(algaeDeficit);
  }, 30_000);

  it('lets abundant food drive reproduction beyond the removed twelve-shrimp ceiling', () => {
    const world = new SimulationWorld('mission-4');
    fillProductiveHabitat(world);
    placeFourShrimp(world);
    world.handle({ type: 'start' });
    world.handle({ type: 'set-speed', speed: 64 });

    let maximumPopulation = 4;
    let snapshot = world.snapshot();
    const initialAlgae = totalAlgae(snapshot);
    while (snapshot.elapsedSeconds < 800) {
      world.tick(0.1);
      snapshot = world.snapshot();
      maximumPopulation = Math.max(maximumPopulation, snapshot.animalPopulation[SHRIMP].total);
    }

    expect(SHRIMP_TECHNICAL_POPULATION_LIMIT).toBeGreaterThanOrEqual(1_000);
    // The removed ecological formula hard-stopped this fixture at twelve even
    // with food everywhere. Reproduction must now cross that former ceiling.
    expect(maximumPopulation).toBeGreaterThan(12);
    expect(snapshot.totalAlgaeConsumed).toBeGreaterThan(initialAlgae);
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

  it('turns higher primary productivity into a stronger consumer outcome', () => {
    const low = new SimulationWorld('laboratory');
    const productive = new SimulationWorld('laboratory');
    low.handle({ type: 'set-light-output', output: 30 });
    productive.handle({ type: 'set-light-output', output: 80 });
    fillProductiveHabitat(low, 0.16);
    fillProductiveHabitat(productive, 0.16);
    placeFourShrimp(low);
    placeFourShrimp(productive);
    low.handle({ type: 'start' });
    productive.handle({ type: 'start' });
    low.handle({ type: 'set-speed', speed: 64 });
    productive.handle({ type: 'set-speed', speed: 64 });

    let lowMaximum = 4;
    let productiveMaximum = 4;
    let lowSnapshot = low.snapshot();
    let productiveSnapshot = productive.snapshot();
    while (lowSnapshot.elapsedSeconds < 900) {
      low.tick(0.1);
      productive.tick(0.1);
      lowSnapshot = low.snapshot();
      productiveSnapshot = productive.snapshot();
      lowMaximum = Math.max(lowMaximum, lowSnapshot.animalPopulation[SHRIMP].total);
      productiveMaximum = Math.max(
        productiveMaximum,
        productiveSnapshot.animalPopulation[SHRIMP].total,
      );
    }

    expect(productiveMaximum).toBeGreaterThan(lowMaximum);
    expect(productiveSnapshot.animalPopulation[SHRIMP].total).toBeGreaterThan(
      lowSnapshot.animalPopulation[SHRIMP].total,
    );
    expect(totalAlgae(productiveSnapshot)).toBeGreaterThan(totalAlgae(lowSnapshot));
    expect(productiveSnapshot.totalAlgaeConsumed).toBeGreaterThan(
      lowSnapshot.totalAlgaeConsumed * 1.25,
    );
  }, 30_000);
});
