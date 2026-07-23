import { describe, expect, it } from 'vitest';
import { SimulationWorld } from '../src/simulation/SimulationWorld';
import {
  STRUCTURE_SUPPORT_Y,
  type SpeciesId,
  type StructureDefinitionId,
  type Vec2,
} from '../src/simulation/types';
import {
  compareVallisneriaDepth,
  vallisneriaLeafHeightScale,
  vallisneriaLeafPoint,
  vallisneriaLeaves,
  vallisneriaRenderDepth,
} from '../src/simulation/vallisneriaGeometry';
import { STRUCTURES } from '../src/simulation/config';
import { structureAuthoredPolygonToWorld } from '../src/simulation/structureGeometry';

const placeSeed = (
  world: SimulationWorld,
  speciesId: SpeciesId,
  point: Vec2,
): void => {
  world.handle({ type: 'pick-seed', speciesId, point });
  world.handle({ type: 'drop-held', point });
};

const placeStructure = (
  world: SimulationWorld,
  definitionId: StructureDefinitionId,
  point: Vec2,
): void => {
  world.handle({ type: 'pick-structure', definitionId, point });
  world.handle({ type: 'drop-held', point });
  for (let index = 0; index < 600; index += 1) world.tick(1 / 60);
};

const advanceTo = (world: SimulationWorld, targetSeconds: number): void => {
  world.handle({ type: 'set-speed', speed: 64 });
  let guard = 0;
  while (world.snapshot().elapsedSeconds < targetSeconds && guard < 5_000) {
    world.tick(0.1);
    guard += 1;
  }
  expect(guard).toBeLessThan(5_000);
};

describe('Vallisneria ramet life cycle', () => {
  it('keeps young rosettes compact while allowing healthy adults to fill the water column', () => {
    expect(vallisneriaLeafHeightScale(0.18)).toBeCloseTo(0.18, 8);
    expect(vallisneriaLeafHeightScale(0.55)).toBeCloseTo(0.55, 8);
    expect(vallisneriaLeafHeightScale(0.8)).toBeGreaterThan(1.6);
    expect(vallisneriaLeafHeightScale(1)).toBeCloseTo(2.55, 8);

    const root = { x: 600, y: 634 };
    const youngLeaves = vallisneriaLeaves(8, root, 0.55);
    const adultLeaves = vallisneriaLeaves(8, root, 1);
    const youngTop = Math.min(...youngLeaves.map((leaf) => leaf.tip.y));
    const adultTop = Math.min(...adultLeaves.map((leaf) => leaf.tip.y));
    expect(root.y - adultTop).toBeGreaterThan((root.y - youngTop) * 4);
  });

  it('uses one shared point for the painted root and depth placement', () => {
    const anchor = { x: 500, y: STRUCTURE_SUPPORT_Y - 4 };
    expect(vallisneriaLeaves(2, anchor, 0.72).every(
      (leaf) => leaf.root.y === anchor.y,
    )).toBe(true);

    const anchors = [
      { index: 3, x: 600, y: STRUCTURE_SUPPORT_Y + 7 },
      { index: 1, x: 400, y: STRUCTURE_SUPPORT_Y - 10 },
      { index: 2, x: 500, y: STRUCTURE_SUPPORT_Y },
    ].sort(compareVallisneriaDepth);

    expect(anchors.map(vallisneriaRenderDepth)).toEqual(['back', 'back', 'front']);
  });

  it('settles a stone drawing with its physical lowest line on the same depth baseline', () => {
    const world = new SimulationWorld('mission-6');
    placeStructure(world, 'tall-stone', { x: 600, y: 300 });
    const stone = world.snapshot().structures[0];
    const definition = STRUCTURES[stone.definitionId];
    const polygon = structureAuthoredPolygonToWorld(
      definition.collisionPolygon,
      definition.collisionPolygon,
      stone,
      stone.angle,
    );
    const visibleBottom = Math.max(...polygon.map((point) => point.y));

    expect(Math.abs(visibleBottom - STRUCTURE_SUPPORT_Y)).toBeLessThan(0.1);
  });

  it('keeps a manually planted root at its continuous click position', () => {
    const world = new SimulationWorld('mission-6');
    const target = world.snapshot().cells.find((cell) =>
      cell.surfaceKind === 'substrate' && cell.y > STRUCTURE_SUPPORT_Y + 4
    )!;
    const point = { x: target.x + 2.75, y: target.y - 1.35 };

    placeSeed(world, 'vallisneria', point);
    const plant = world.snapshot().plants[0];

    expect(plant.x).toBeCloseTo(point.x, 6);
    expect(plant.y).toBeCloseTo(point.y, 6);
    expect(vallisneriaRenderDepth(plant)).toBe('front');
    expect(plant.x).not.toBe(target.x);
    expect(plant.y).not.toBe(target.y);
  });

  it('keeps the held plant attached to the pointer until it reaches the substrate', () => {
    const world = new SimulationWorld('mission-6');
    const waterPoint = { x: 470.25, y: 280.75 };

    world.handle({ type: 'pick-seed', speciesId: 'vallisneria', point: waterPoint });
    expect(world.snapshot().holding).toMatchObject({
      kind: 'seed',
      valid: false,
      x: waterPoint.x,
      y: waterPoint.y,
    });

    const movedPoint = { x: 725.5, y: 360.25 };
    world.handle({ type: 'pointer-move', point: movedPoint });
    expect(world.snapshot().holding).toMatchObject({
      kind: 'seed',
      valid: false,
      x: movedPoint.x,
      y: movedPoint.y,
    });
  });

  it('allows a substrate ramet behind an overlapping rock silhouette', () => {
    const world = new SimulationWorld('mission-6');
    placeStructure(world, 'tall-stone', { x: 600, y: 300 });
    const rearPoint = { x: 600, y: STRUCTURE_SUPPORT_Y - 12 };

    placeSeed(world, 'vallisneria', rearPoint);

    const snapshot = world.snapshot();
    expect(snapshot.plants).toHaveLength(1);
    const plant = snapshot.plants[0];
    expect(vallisneriaRenderDepth(plant)).toBe('back');
  });

  it('casts translucent canopy shade without acting like an opaque rock', () => {
    const world = new SimulationWorld('mission-6');
    const substrate = world.snapshot().cells.filter((cell) => cell.surfaceKind === 'substrate');
    const target = substrate[Math.floor(substrate.length / 2)];
    const unshaded = target.light;

    placeSeed(world, 'vallisneria', target);
    const shadedCell = world.snapshot().cells.find((cell) => cell.id === target.id)!;

    expect(shadedCell.light).toBeLessThan(unshaded * 0.98);
    expect(shadedCell.light).toBeGreaterThan(unshaded * 0.45);
  });

  it('selects the visible leaves and exposes the exact ramet instead of requiring a root click', () => {
    const world = new SimulationWorld('mission-6');
    const substrate = world.snapshot().cells.filter((cell) => cell.surfaceKind === 'substrate');
    const target = substrate[Math.floor(substrate.length / 2)];
    placeSeed(world, 'vallisneria', target);
    const planted = world.snapshot().plants[0];
    const cell = world.snapshot().cells.find((candidate) => candidate.id === planted.cellId)!;
    const leaves = vallisneriaLeaves(cell.index, planted, planted.structuralScale);
    const leafPoint = vallisneriaLeafPoint(leaves[Math.floor(leaves.length / 2)], 0.55);

    world.handle({ type: 'select-at', point: leafPoint, filter: 'organism' });
    const selection = world.snapshot().selection;

    expect(selection?.kind).toBe('colony');
    expect(selection?.speciesId).toBe('vallisneria');
    expect(selection?.plantId).toBe(planted.id);
    expect(selection?.cellId).toBe(planted.cellId);
  });

  it('updates a selected plant surface to the diatom colony that replaces a dead ramet', () => {
    const world = new SimulationWorld('mission-6');
    const substrate = world.snapshot().cells.filter((cell) => cell.surfaceKind === 'substrate');
    const target = substrate[Math.floor(substrate.length / 2)];
    placeSeed(world, 'vallisneria', target);
    const planted = world.snapshot().plants[0];
    const cell = world.snapshot().cells.find((candidate) => candidate.id === planted.cellId)!;
    const leaves = vallisneriaLeaves(cell.index, planted, planted.structuralScale);
    const leafPoint = vallisneriaLeafPoint(leaves[Math.floor(leaves.length / 2)], 0.55);
    world.handle({ type: 'select-at', point: leafPoint, filter: 'organism' });

    const internals = world as unknown as {
      substrateCells: Array<{
        id: string;
        biomass: { oedogonium: number; nitzschia: number; vallisneria: number };
      }>;
      seedPlacements: Array<{
        id: string;
        plant?: { ageSeconds: number; lifespanSeconds: number };
      }>;
    };
    const selectedCell = internals.substrateCells.find((candidate) => candidate.id === planted.cellId)!;
    selectedCell.biomass.nitzschia = 0.28;
    const plant = internals.seedPlacements.find((placement) => placement.id === planted.id)!.plant!;
    plant.ageSeconds = plant.lifespanSeconds - 0.1;

    world.handle({ type: 'start' });
    for (let index = 0; index < 3; index += 1) world.tick(0.1);
    const selection = world.snapshot().selection;

    expect(world.snapshot().plants).toHaveLength(0);
    expect(selection?.kind).toBe('colony');
    expect(selection?.plantId).toBeUndefined();
    expect(selection?.speciesId).toBe('nitzschia');
    expect(selection?.speciesIds).toEqual(['nitzschia']);
    expect(selection?.ownerLabel).toBe(`${target.ownerLabel} 표면`);
  });

  it('includes a ramet when a dragged observation region intersects its leaves', () => {
    const world = new SimulationWorld('mission-6');
    const substrate = world.snapshot().cells.filter((cell) => cell.surfaceKind === 'substrate');
    const target = substrate[Math.floor(substrate.length / 2)];
    placeSeed(world, 'vallisneria', target);
    const planted = world.snapshot().plants[0];
    const cell = world.snapshot().cells.find((candidate) => candidate.id === planted.cellId)!;
    const leaves = vallisneriaLeaves(cell.index, planted, planted.structuralScale);
    const leafPoint = vallisneriaLeafPoint(leaves[Math.floor(leaves.length / 2)], 0.55);

    world.handle({
      type: 'select-region',
      from: { x: leafPoint.x - 5, y: leafPoint.y - 5 },
      to: { x: leafPoint.x + 5, y: leafPoint.y + 5 },
      filter: 'organism',
    });

    expect(world.snapshot().selection?.kind).toBe('region');
    expect(world.snapshot().selection?.cellIds).toContain(planted.cellId);
  });

  it('grows from an established juvenile and reproduces by biomass-conserving runners', () => {
    const world = new SimulationWorld('mission-6');
    const substrate = world.snapshot().cells.filter((cell) => cell.surfaceKind === 'substrate');
    placeSeed(world, 'vallisneria', substrate[Math.floor(substrate.length / 2)]);
    const before = world.snapshot();
    expect(before.plants).toHaveLength(1);
    expect(before.plants[0].lifeStage).toBe('juvenile');
    expect(before.remainingSeeds.vallisneria).toBe(2);

    world.handle({ type: 'start' });
    advanceTo(world, 1_200);
    const after = world.snapshot();
    expect(after.plants.length).toBeGreaterThan(1);
    expect(after.plants.some((plant) => plant.origin === 'runner')).toBe(true);
    expect(after.plants.every((plant) =>
      after.cells.find((cell) => cell.id === plant.cellId)?.surfaceKind === 'substrate'
    )).toBe(true);
    expect(after.plants.filter((plant) => plant.origin === 'runner').some((plant) => {
      const cell = after.cells.find((candidate) => candidate.id === plant.cellId)!;
      return Math.abs(plant.x - cell.x) > 0.01 || Math.abs(plant.y - cell.y) > 0.01;
    })).toBe(true);
    // Runner-born daughters are ecology, not extra use of the supplied stock.
    expect(after.remainingSeeds.vallisneria).toBe(2);
    expect(Math.abs(after.biogeochemistry.materialBalance.nitrogenDriftRatio)).toBeLessThan(0.0001);
    expect(Math.abs(after.biogeochemistry.materialBalance.carbonDriftRatio)).toBeLessThan(0.0001);
  }, 60_000);

  it('keeps structural leaves stable through one night while reserve biomass breathes', () => {
    const world = new SimulationWorld('mission-6');
    const substrate = world.snapshot().cells.filter((cell) => cell.surfaceKind === 'substrate');
    placeSeed(world, 'vallisneria', substrate[Math.floor(substrate.length / 2)]);
    world.handle({ type: 'start' });
    advanceTo(world, 250);
    const beforeNight = world.snapshot().plants[0];
    advanceTo(world, 330);
    const afterNight = world.snapshot().plants.find((plant) => plant.id === beforeNight.id)!;
    expect(afterNight).toBeTruthy();
    expect(Math.abs(afterNight.structuralScale - beforeNight.structuralScale)).toBeLessThan(0.08);
  }, 20_000);

  it('dies at the end of its lifespan and returns its remaining mass to the closed cycle', () => {
    const world = new SimulationWorld('mission-6');
    const substrate = world.snapshot().cells.filter((cell) => cell.surfaceKind === 'substrate');
    placeSeed(world, 'vallisneria', substrate[Math.floor(substrate.length / 2)]);
    world.handle({ type: 'start' });
    const internals = world as unknown as {
      seedPlacements: Array<{
        id: string;
        plant?: { ageSeconds: number; lifespanSeconds: number };
      }>;
    };
    const plant = internals.seedPlacements[0].plant!;
    plant.ageSeconds = plant.lifespanSeconds - 0.1;
    // Worker ticks are intentionally clamped to 0.1 real seconds.
    for (let index = 0; index < 3; index += 1) world.tick(0.1);

    const after = world.snapshot();
    expect(after.plants).toHaveLength(0);
    expect(after.totalBiomass.vallisneria).toBe(0);
    expect(Math.abs(after.biogeochemistry.materialBalance.nitrogenDriftRatio)).toBeLessThan(0.0001);
    expect(Math.abs(after.biogeochemistry.materialBalance.carbonDriftRatio)).toBeLessThan(0.0001);
  });

  it('preserves age, lifespan, leaf structure and runner progress in frozen aquariums', () => {
    const world = new SimulationWorld('mission-6');
    const substrate = world.snapshot().cells.filter((cell) => cell.surfaceKind === 'substrate');
    placeSeed(world, 'vallisneria', substrate[Math.floor(substrate.length / 2)]);
    world.handle({ type: 'start' });
    advanceTo(world, 420);
    const before = world.snapshot().plants[0];
    const restored = new SimulationWorld('mission-1');
    restored.loadSaveData(world.exportSaveData());
    const after = restored.snapshot().plants.find((plant) => plant.id === before.id)!;

    expect(after.ageSeconds).toBeCloseTo(before.ageSeconds, 6);
    expect(after.lifespanSeconds).toBeCloseTo(before.lifespanSeconds, 6);
    expect(after.structuralScale).toBeCloseTo(before.structuralScale, 6);
    expect(after.runnerProgress).toBeCloseTo(before.runnerProgress, 6);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    expect(restored.snapshot().phase).toBe('paused');
  }, 20_000);
});
