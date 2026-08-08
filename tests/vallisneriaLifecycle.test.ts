import { describe, expect, it } from 'vitest';
import { SimulationWorld } from '../src/simulation/SimulationWorld';
import { CLOSED_MATERIAL_RELATIVE_TOLERANCE } from '../src/simulation/stoichiometry';
import {
  STRUCTURE_SUPPORT_Y,
  type SpeciesId,
  type StructureDefinitionId,
  type Vec2,
} from '../src/simulation/types';
import {
  compareVallisneriaDepth,
  vallisneriaCanopyBounds,
  vallisneriaHitDistance,
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
  const elapsedSeconds = (): number =>
    (world as unknown as { elapsedSeconds: number }).elapsedSeconds;
  while (elapsedSeconds() < targetSeconds && guard < 5_000) {
    world.tick(0.1);
    guard += 1;
  }
  expect(guard).toBeLessThan(5_000);
};

const findLeafPointInsideStructure = (
  world: SimulationWorld,
  plant: ReturnType<SimulationWorld['snapshot']>['plants'][number],
  cellIndex: number,
  structureId: string,
): Vec2 | null => {
  const leaves = vallisneriaLeaves(cellIndex, plant, plant.structuralScale);
  for (const leaf of leaves) {
    for (let sample = 2; sample <= 18; sample += 1) {
      const point = vallisneriaLeafPoint(leaf, sample / 20);
      world.handle({ type: 'select-at', point, filter: 'structure' });
      if (world.snapshot().selection?.structureId === structureId) return point;
    }
  }
  return null;
};

describe('Vallisneria ramet life cycle', () => {
  it('keeps young rosettes compact while allowing healthy adults to fill the water column', () => {
    expect(vallisneriaLeafHeightScale(0.18)).toBeCloseTo(0.18, 8);
    expect(vallisneriaLeafHeightScale(0.45)).toBeCloseTo(0.45, 8);
    expect(vallisneriaLeafHeightScale(0.55)).toBeGreaterThan(0.7);
    expect(vallisneriaLeafHeightScale(0.8)).toBeGreaterThan(1.6);
    expect(vallisneriaLeafHeightScale(1)).toBeCloseTo(2.82, 8);

    const root = { x: 600, y: 634 };
    const youngLeaves = vallisneriaLeaves(8, root, 0.35);
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

  it('does not treat front/back projection overlap as occupied runner space', () => {
    const world = new SimulationWorld('mission-6', undefined, 41);
    type RunnerDestinationInternals = {
      substrateCells: Array<{
        id: string;
        x: number;
        y: number;
        row: number;
        column: number;
        biomass: { vallisneria: number };
      }>;
      seedPlacements: Array<{
        id: string;
        speciesId: SpeciesId;
        cellId: string;
      }>;
      runnerDestination(parent: unknown): { id: string } | null;
    };
    const internals = world as unknown as RunnerDestinationInternals;
    const parentCell = internals.substrateCells.find((cell) =>
      cell.row === 1 && cell.column === 40
    )!;
    const frontCell = internals.substrateCells.find((cell) =>
      cell.row === 0 && cell.column === 48
    )!;
    const rearTarget = internals.substrateCells.find((cell) =>
      cell.row === 2 && cell.column === 48
    )!;

    placeSeed(world, 'vallisneria', parentCell);
    placeSeed(world, 'vallisneria', frontCell);
    const parent = internals.seedPlacements.find((placement) =>
      placement.cellId === parentCell.id
    )!;

    // Leave exactly one physically distinct runner tip available. Its side
    // view is within 28 px of the foreground ramet, but it occupies another
    // x/depth ground cell and therefore must remain a valid destination.
    for (const cell of internals.substrateCells) {
      if (
        cell.id !== parentCell.id &&
        cell.id !== frontCell.id &&
        cell.id !== rearTarget.id
      ) {
        cell.biomass.vallisneria = 1;
      }
    }

    expect(internals.runnerDestination(parent)?.id).toBe(rearTarget.id);
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

  it('includes a ramet own leaf shade in its canopy physiology', () => {
    const world = new SimulationWorld('mission-6');
    const substrate = world.snapshot().cells
      .filter((cell) => cell.surfaceKind === 'substrate');
    const target = substrate[Math.floor(substrate.length / 2)];
    placeSeed(world, 'vallisneria', target);

    type LightInternals = {
      cellById(id: string): unknown;
      vallisneriaCanopyLight(cell: unknown): number;
      vallisneriaCanopySamplePoints(cell: unknown): number;
      vallisneriaCanopyPointsScratch: Vec2[];
      sampleLightField(point: Vec2): number;
      lightAt(point: Vec2, excludedBodyId?: number, cache?: boolean): number;
    };
    const internals = world as unknown as LightInternals;
    const plant = world.snapshot().plants[0];
    const cell = internals.cellById(plant.cellId);
    const sampleCount = internals.vallisneriaCanopySamplePoints(cell);
    const points = internals.vallisneriaCanopyPointsScratch.slice(
      0,
      sampleCount,
    );
    const sharedCanopyLight = points.reduce(
      (sum, point) => sum + internals.sampleLightField(point),
      0,
    ) / sampleCount;
    const lightWithoutAnyCanopy = points.reduce(
      (sum, point) => sum + internals.lightAt(point, undefined, true),
      0,
    ) / sampleCount;

    expect(internals.vallisneriaCanopyLight(cell))
      .toBeCloseTo(sharedCanopyLight, 8);
    expect(sharedCanopyLight).toBeLessThan(lightWithoutAnyCanopy);
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
    expect(selection?.x).toBeCloseTo(leafPoint.x, 6);
    expect(selection?.y).toBeCloseTo(leafPoint.y, 6);

    // Repeated snapshots used to move the marker to the root.
    const refreshedSelection = world.snapshot().selection;
    expect(refreshedSelection?.x).toBeCloseTo(leafPoint.x, 6);
    expect(refreshedSelection?.y).toBeCloseTo(leafPoint.y, 6);
  });

  it('lets a visible stone receive clicks through empty gaps in a plant canopy', () => {
    const world = new SimulationWorld('laboratory');
    const substrate = world.snapshot().cells.filter((cell) => cell.surfaceKind === 'substrate');
    const target = substrate[Math.floor(substrate.length / 2)];
    placeSeed(world, 'vallisneria', target);
    placeStructure(world, 'flat-stone', { x: target.x, y: 300 });

    const snapshot = world.snapshot();
    const planted = snapshot.plants[0];
    const cell = snapshot.cells.find((candidate) => candidate.id === planted.cellId)!;
    const structure = snapshot.structures[0];
    const root = { x: planted.x, y: planted.y };
    const canopy = vallisneriaCanopyBounds(cell.index, root, planted.structuralScale);
    let stoneGap: Vec2 | null = null;

    for (let y = canopy.minY; y <= canopy.maxY && !stoneGap; y += 4) {
      for (let x = canopy.minX; x <= canopy.maxX; x += 4) {
        if (vallisneriaHitDistance({ x, y }, cell.index, root, planted.structuralScale) <= 10) {
          continue;
        }
        world.handle({ type: 'select-at', point: { x, y }, filter: 'structure' });
        if (world.snapshot().selection?.structureId === structure.id) {
          stoneGap = { x, y };
          break;
        }
      }
    }

    expect(stoneGap).not.toBeNull();
    if (!stoneGap) throw new Error('fixture needs a visible stone gap between leaves');
    world.handle({ type: 'select-at', point: stoneGap, filter: 'all' });
    expect(world.snapshot().selection).toMatchObject({
      kind: 'structure',
      structureId: structure.id,
    });
  });

  it('lets a stone occlude a back-layer Vallisneria leaf during hit testing', () => {
    const world = new SimulationWorld('mission-6');
    placeSeed(world, 'vallisneria', {
      x: 600,
      y: STRUCTURE_SUPPORT_Y - 10,
    });
    placeStructure(world, 'flat-stone', { x: 600, y: 300 });

    const snapshot = world.snapshot();
    const plant = snapshot.plants[0];
    const cell = snapshot.cells.find((candidate) => candidate.id === plant.cellId)!;
    const structure = snapshot.structures[0];
    expect(vallisneriaRenderDepth(plant)).toBe('back');
    const overlap = findLeafPointInsideStructure(world, plant, cell.index, structure.id);

    expect(overlap).not.toBeNull();
    if (!overlap) throw new Error('fixture needs a back leaf crossing the stone');
    world.handle({ type: 'select-at', point: overlap, filter: 'all' });
    expect(world.snapshot().selection).toMatchObject({
      kind: 'structure',
      structureId: structure.id,
    });
  });

  it('selects an actually painted front leaf over a stone and keeps the marker at the click', () => {
    const world = new SimulationWorld('mission-6');
    placeSeed(world, 'vallisneria', {
      x: 600,
      y: STRUCTURE_SUPPORT_Y + 8,
    });
    placeStructure(world, 'flat-stone', { x: 600, y: 300 });

    const snapshot = world.snapshot();
    const plant = snapshot.plants[0];
    const cell = snapshot.cells.find((candidate) => candidate.id === plant.cellId)!;
    const structure = snapshot.structures[0];
    expect(vallisneriaRenderDepth(plant)).toBe('front');
    const overlap = findLeafPointInsideStructure(world, plant, cell.index, structure.id);

    expect(overlap).not.toBeNull();
    if (!overlap) throw new Error('fixture needs a front leaf crossing the stone');
    world.handle({ type: 'select-at', point: overlap, filter: 'all' });
    expect(world.snapshot().selection).toMatchObject({
      kind: 'colony',
      plantId: plant.id,
      x: overlap.x,
      y: overlap.y,
    });
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
    // The shared B ledger stores nutrient/metabolic-equivalent matter, not
    // literal macrophyte dry mass. Leaf geometry carries the much larger,
    // carbon-rich visible structure without charging it the C:N ratio of a
    // shrimp or active algal cell.
    expect(before.totalBiomass.vallisneria).toBeCloseTo(0.132, 6);
    const adultEquivalentBiomass = before.totalBiomass.vallisneria / 0.24;
    expect(before.plants[0].lifespanSeconds).toBeGreaterThanOrEqual(3_600);
    expect(before.plants[0].lifespanSeconds).toBeLessThanOrEqual(6_000);
    world.handle({ type: 'start' });
    // The rooted stock must build its first runner from realised production,
    // while still doing so during ordinary play rather than dozens of cycles.
    advanceTo(world, 1_800);
    const after = world.snapshot();
    expect(
      after.plants.length,
      JSON.stringify({
        totalBiomass: after.totalBiomass.vallisneria,
        plants: after.plants,
      }),
    ).toBeGreaterThan(1);
    const runners = after.plants.filter((plant) => plant.origin === 'runner');
    expect(runners.length).toBeGreaterThan(0);
    expect(
      runners.some((plant) =>
        plant.ageSeconds >= 270 &&
        plant.structuralScale >= 0.2 &&
        plant.health >= 0.42
      ),
      JSON.stringify(runners),
    ).toBe(true);
    expect(after.plants.every((plant) =>
      after.cells.find((cell) => cell.id === plant.cellId)?.surfaceKind === 'substrate'
    )).toBe(true);
    expect(after.plants.filter((plant) => plant.origin === 'runner').some((plant) => {
      const cell = after.cells.find((candidate) => candidate.id === plant.cellId)!;
      return Math.abs(plant.x - cell.x) > 0.01 || Math.abs(plant.y - cell.y) > 0.01;
    })).toBe(true);
    const supplied = after.plants.find((plant) => plant.origin === 'supplied')!;
    const suppliedCell = after.cells.find((cell) => cell.id === supplied.cellId)!;
    // Runner funding is an explicit subset of total ramet mass. Subtracting
    // it must still leave living crown/root/leaf matter in the parent; the
    // daughter may not be paid by cannibalising the whole rosette.
    expect(
      suppliedCell.biomass.vallisneria - supplied.runnerReserveBiomass,
    ).toBeGreaterThanOrEqual(adultEquivalentBiomass * 0.02 * 0.985);
    // A daughter is not independent merely because its small crown survives.
    // While its parent is alive, severance must wait until the runner has both
    // a substantial reserve and leaves tall enough to leave the bottom layer.
    for (const runner of runners) {
      if (runner.connectedToParent || !after.plants.some(
        (plant) => plant.id === runner.parentId,
      )) continue;
      const runnerCell = after.cells.find((cell) => cell.id === runner.cellId)!;
      expect(runner.structuralScale).toBeGreaterThanOrEqual(0.68);
      const independentCohortBiomass = adultEquivalentBiomass * (
        0.02 + (0.68 - 0.16) / (1 - 0.16) * 0.32
      );
      expect(runnerCell.biomass.vallisneria).toBeGreaterThanOrEqual(
        independentCohortBiomass * 0.985,
      );
    }
    // Runner-born daughters are ecology, not extra use of the supplied stock.
    expect(after.remainingSeeds.vallisneria).toBe(2);
    expect(Math.abs(after.biogeochemistry.materialBalance.nitrogenDriftRatio))
      .toBeLessThan(CLOSED_MATERIAL_RELATIVE_TOLERANCE);
    expect(Math.abs(after.biogeochemistry.materialBalance.carbonDriftRatio))
      .toBeLessThan(CLOSED_MATERIAL_RELATIVE_TOLERANCE);
  }, 90_000);

  it('shows natural ramet death and clonal replacement within ordinary mission time', async () => {
    const world = new SimulationWorld('mission-6');
    const substrate = world.snapshot().cells.filter(
      (cell) => cell.surfaceKind === 'substrate',
    );
    placeSeed(world, 'vallisneria', substrate[Math.floor(substrate.length / 2)]);
    const founderId = world.snapshot().plants[0].id;

    world.handle({ type: 'start' });
    const samples: Array<{
      elapsedSeconds: number;
      biomass: number;
      plants: ReturnType<SimulationWorld['snapshot']>['plants'];
    }> = [];
    let tallestRunnerScale = 0;
    let tallestRunnerLeafHeight = 0;
    let maximumRunnerBiomass = 0;
    // Follow several complete compressed ramet lives so a later-lived
    // daughter has time to mature and start the next clonal generation after
    // the founder disappears.
    for (let elapsedSeconds = 600; elapsedSeconds <= 12_000; elapsedSeconds += 600) {
      advanceTo(world, elapsedSeconds);
      // The deterministic 12,000-second run is deliberately CPU-heavy. Yield
      // at coarse biological samples so Vitest can service its worker RPC
      // without changing any simulation step or timestamp.
      await new Promise<void>((resolve) => setImmediate(resolve));
      const sample = world.snapshot();
      samples.push({
        elapsedSeconds: sample.elapsedSeconds,
        biomass: sample.totalBiomass.vallisneria,
        plants: sample.plants,
      });
      for (const plant of sample.plants) {
        if (plant.origin !== 'runner') continue;
        const cell = sample.cells.find(
          (candidate) => candidate.id === plant.cellId,
        )!;
        maximumRunnerBiomass = Math.max(
          maximumRunnerBiomass,
          cell.biomass.vallisneria,
        );
        const leaves = vallisneriaLeaves(cell.index, plant, plant.structuralScale);
        tallestRunnerScale = Math.max(tallestRunnerScale, plant.structuralScale);
        tallestRunnerLeafHeight = Math.max(
          tallestRunnerLeafHeight,
          ...leaves.map((leaf) => leaf.root.y - leaf.tip.y),
        );
      }
    }
    const after = world.snapshot();

    expect(after.plants.some((plant) => plant.id === founderId)).toBe(false);
    expect(after.plants.length, JSON.stringify(samples)).toBeGreaterThan(0);
    expect(after.plants.every((plant) => plant.origin === 'runner')).toBe(true);
    expect(
      after.totalBiomass.vallisneria,
      JSON.stringify(samples.slice(-8)),
    ).toBeGreaterThan(0.2);
    // This must be a runner descendant rather than the already-large supplied
    // founder: the clonal generation has to paint an unmistakable juvenile →
    // adult transition before it can reproduce and senesce.
    expect(tallestRunnerScale).toBeGreaterThan(0.9);
    // A later generation must grow well beyond the corrected 0.132-B young
    // supplied rosette. Do not retain the former 0.2475-B founder-only packet
    // as a hidden definition of adulthood after removing that stock advantage.
    expect(maximumRunnerBiomass).toBeGreaterThanOrEqual(0.20);
    expect(
      tallestRunnerLeafHeight,
      JSON.stringify({ tallestRunnerScale, tallestRunnerLeafHeight }),
    ).toBeGreaterThan(480);
    expect(samples.some((sample) => sample.plants.some(
      (plant) => plant.origin === 'runner' && plant.reproductionCount > 0,
    )), JSON.stringify(samples.slice(-8))).toBe(true);
    expect(Math.abs(after.biogeochemistry.materialBalance.nitrogenDriftRatio))
      .toBeLessThan(CLOSED_MATERIAL_RELATIVE_TOLERANCE);
    expect(Math.abs(after.biogeochemistry.materialBalance.carbonDriftRatio))
      .toBeLessThan(CLOSED_MATERIAL_RELATIVE_TOLERANCE);
  }, 120_000);

  it('photosynthesizes and respires at actual painted leaf positions', () => {
    const world = new SimulationWorld('mission-6');
    const substrate = world.snapshot().cells.filter((cell) => cell.surfaceKind === 'substrate');
    placeSeed(world, 'vallisneria', substrate[Math.floor(substrate.length / 2)]);
    const planted = world.snapshot().plants[0];
    const productionPoints: Vec2[] = [];
    const respirationPoints: Vec2[] = [];
    const internals = world as unknown as {
      biogeochemistry: {
        commitAlgaeProduction(
          point: Vec2,
          requestedBiomass: number,
          oxygenReleasePoint?: Vec2,
        ): number;
        commitAlgaeRespiration(point: Vec2, requestedBiomass: number): number;
        commitRootedPlantRespiration(
          point: Vec2,
          requestedBiomass: number,
          rootPoint: Vec2,
        ): number;
      };
    };
    const originalProduction = internals.biogeochemistry.commitAlgaeProduction
      .bind(internals.biogeochemistry);
    const originalRespiration = internals.biogeochemistry.commitRootedPlantRespiration
      .bind(internals.biogeochemistry);
    internals.biogeochemistry.commitAlgaeProduction = (
      point,
      requestedBiomass,
      oxygenReleasePoint = point,
    ) => {
      productionPoints.push({ ...oxygenReleasePoint });
      return originalProduction(point, requestedBiomass, oxygenReleasePoint);
    };
    internals.biogeochemistry.commitRootedPlantRespiration = (
      point,
      requestedBiomass,
      rootPoint,
    ) => {
      respirationPoints.push({ ...point });
      return originalRespiration(point, requestedBiomass, rootPoint);
    };

    world.handle({ type: 'start' });
    advanceTo(world, 12);

    expect(productionPoints.length).toBeGreaterThan(8);
    expect(respirationPoints.length).toBeGreaterThan(8);
    expect(productionPoints.some((point) => point.y < planted.y - 25)).toBe(true);
    expect(respirationPoints.some((point) => point.y < planted.y - 25)).toBe(true);
    expect(new Set(productionPoints.map((point) => point.y.toFixed(1))).size)
      .toBeGreaterThan(3);
    expect(new Set(respirationPoints.map((point) => point.y.toFixed(1))).size)
      .toBeGreaterThan(3);
  }, 20_000);

  it('integrates ray-cast light across leaves exposed past a stone edge', () => {
    const world = new SimulationWorld('mission-6');
    for (const point of [
      { x: 250, y: 300 },
      { x: 600, y: 300 },
      { x: 950, y: 300 },
    ]) {
      placeStructure(world, 'tall-stone', point);
    }
    placeStructure(world, 'flat-stone', { x: 250, y: 260 });

    const structures = world.snapshot().structures;
    for (const structure of structures) {
      const faces = world.snapshot().cells
        .filter((cell) =>
          cell.ownerId === structure.id &&
          cell.targetEligible
        )
        .sort((left, right) => left.y - right.y || left.x - right.x);
      placeSeed(world, 'oedogonium', faces[Math.floor(faces.length * 0.25)]);
      placeSeed(world, 'nitzschia', faces[Math.floor(faces.length * 0.65)]);
    }

    const substrate = world.snapshot().cells
      .filter((cell) => cell.surfaceKind === 'substrate')
      .sort((left, right) => left.x - right.x);
    // Put each root just outside the corresponding stone silhouette so part of
    // the painted canopy overlaps its vertical shadow and part remains exposed.
    // A root directly below the stone is intentionally not expected to thrive.
    for (const targetX of [405, 665, 1_015]) {
      const target = substrate.reduce((nearest, candidate) =>
        Math.abs(candidate.x - targetX) < Math.abs(nearest.x - targetX)
          ? candidate
          : nearest
      );
      placeSeed(
        world,
        'vallisneria',
        target,
      );
    }

    const initialVallisneria = world.snapshot().totalBiomass.vallisneria;
    world.handle({ type: 'start' });
    advanceTo(world, 660);
    const after = world.snapshot();

    expect(after.plants.filter((plant) => plant.origin === 'supplied')).toHaveLength(3);
    expect(after.totalBiomass.vallisneria).toBeGreaterThan(
      initialVallisneria * 1.2,
    );
    expect(after.plants.every((plant) => plant.health > 0.25)).toBe(true);
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
    expect(Math.abs(afterNight.structuralScale - beforeNight.structuralScale)).toBeLessThan(0.09);
  }, 20_000);

  it('never retracts attained leaves when night respiration or runner funding lowers reserve', () => {
    const world = new SimulationWorld('mission-6');
    const substrate = world.snapshot().cells.filter((cell) => cell.surfaceKind === 'substrate');
    placeSeed(world, 'vallisneria', substrate[Math.floor(substrate.length / 2)]);
    const founderId = world.snapshot().plants[0].id;
    world.handle({ type: 'start' });

    let previousScale = world.snapshot().plants[0].structuralScale;
    let previousBiomass = world.snapshot().totalBiomass.vallisneria;
    let reserveFell = false;
    for (let elapsedSeconds = 30; elapsedSeconds <= 1_800; elapsedSeconds += 30) {
      advanceTo(world, elapsedSeconds);
      const sample = world.snapshot();
      const founder = sample.plants.find((plant) => plant.id === founderId)!;
      expect(founder.lifeStage).not.toBe('senescent');
      expect(founder.structuralScale + 1e-9).toBeGreaterThanOrEqual(previousScale);
      reserveFell ||= sample.totalBiomass.vallisneria < previousBiomass - 1e-5;
      previousScale = founder.structuralScale;
      previousBiomass = sample.totalBiomass.vallisneria;
    }

    const after = world.snapshot();
    expect(after.plants.find((plant) => plant.id === founderId)!.reproductionCount)
      .toBeGreaterThan(0);
    expect(reserveFell).toBe(true);
  }, 40_000);

  it('sheds whole outer leaves without rescaling the retained blades', () => {
    const root = { x: 600, y: 634 };
    const full = vallisneriaLeaves(8, root, 0.82, 1);
    const thinned = vallisneriaLeaves(8, root, 0.82, 0.5);

    expect(thinned.length).toBeLessThan(full.length);
    expect(thinned.length).toBeGreaterThan(0);
    for (const retained of thinned) {
      expect(full.some((leaf) =>
        leaf.root.x === retained.root.x &&
        leaf.tip.x === retained.tip.x &&
        leaf.tip.y === retained.tip.y
      )).toBe(true);
    }
  });

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
    expect(Math.abs(after.biogeochemistry.materialBalance.nitrogenDriftRatio))
      .toBeLessThan(CLOSED_MATERIAL_RELATIVE_TOLERANCE);
    expect(Math.abs(after.biogeochemistry.materialBalance.carbonDriftRatio))
      .toBeLessThan(CLOSED_MATERIAL_RELATIVE_TOLERANCE);
  });

  it('preserves age, lifespan, leaf structure, internal nitrogen and runner allocation in frozen aquariums', () => {
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
    expect(after.nitrogenReserve).toBeCloseTo(before.nitrogenReserve, 6);
    expect(after.runnerReserveBiomass).toBeCloseTo(
      before.runnerReserveBiomass,
      6,
    );
    expect(after.runnerProgress).toBeCloseTo(before.runnerProgress, 6);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    expect(restored.snapshot().phase).toBe('paused');
  }, 20_000);
});
