import { describe, expect, it } from 'vitest';
import { SCENARIOS } from '../src/simulation/config';
import { SimulationWorld } from '../src/simulation/SimulationWorld';
import type { SpeciesId, StructureDefinitionId, Vec2 } from '../src/simulation/types';

const settle = (world: SimulationWorld, ticks = 600): void => {
  for (let index = 0; index < ticks; index += 1) world.tick(1 / 60);
};

const placeStructure = (
  world: SimulationWorld,
  definitionId: StructureDefinitionId,
  point: Vec2,
): void => {
  world.handle({ type: 'pointer-move', point });
  world.handle({ type: 'pick-structure', definitionId });
  world.handle({ type: 'pointer-move', point });
  world.handle({ type: 'drop-held', point });
};

const placeSeed = (
  world: SimulationWorld,
  speciesId: SpeciesId,
  point: Vec2,
): void => {
  world.handle({ type: 'pointer-move', point });
  world.handle({ type: 'pick-seed', speciesId });
  world.handle({ type: 'pointer-move', point });
  world.handle({ type: 'drop-held', point });
};

describe('V2 mission simulation world', () => {
  it('accepts an inventory pick and drop at the first tank point without a prior pointer move', () => {
    const world = new SimulationWorld('mission-1');
    const point = { x: 410, y: 280 };

    world.handle({ type: 'pick-structure', definitionId: 'flat-stone', point });
    expect(world.snapshot().holding?.kind).toBe('structure');
    world.handle({ type: 'drop-held', point });

    const placed = world.snapshot();
    expect(placed.holding).toBeNull();
    expect(placed.structures).toHaveLength(1);
    expect(placed.structures[0].x).toBeCloseTo(point.x, 0);
  });

  it('uses click-to-hold placement, natural settling, and locks challenge editing after start', () => {
    const world = new SimulationWorld('mission-1');
    placeStructure(world, 'flat-stone', { x: 410, y: 280 });
    expect(world.snapshot().holding).toBeNull();
    settle(world);
    const settled = world.snapshot();
    expect(settled.allSettled).toBe(true);
    expect(settled.structures).toHaveLength(1);
    expect(settled.cells.filter((cell) => cell.ownerId === settled.structures[0].id).length).toBeGreaterThan(150);

    const brightest = settled.cells
      .filter((cell) => cell.ownerId === settled.structures[0].id)
      .sort((a, b) => b.light - a.light)[0];
    placeSeed(world, 'oedogonium', brightest);
    expect(world.snapshot().remainingSeeds.oedogonium).toBe(0);

    world.handle({ type: 'start' });
    const running = world.snapshot();
    expect(running.phase).toBe('running');
    expect(running.seeds).toHaveLength(0);
    const original = running.structures[0];
    world.handle({ type: 'pick-at', point: { x: original.x, y: original.y } });
    expect(world.snapshot().holding).toBeNull();
  });

  it('never silently relocates an already used seed', () => {
    const world = new SimulationWorld('mission-1');
    placeStructure(world, 'flat-stone', { x: 410, y: 280 });
    settle(world);
    const first = world.snapshot().cells.find((cell) => cell.surfaceKind === 'structure-face')!;
    placeSeed(world, 'oedogonium', first);
    const before = world.snapshot().seeds[0];
    world.handle({ type: 'pick-seed', speciesId: 'oedogonium' });
    const after = world.snapshot();
    expect(after.holding).toBeNull();
    expect(after.seeds[0].cellId).toBe(before.cellId);
  });

  it('allows paused editing in the laboratory', () => {
    const world = new SimulationWorld('laboratory');
    world.handle({ type: 'start' });
    world.handle({ type: 'pause' });
    placeStructure(world, 'tall-stone', { x: 620, y: 250 });
    expect(world.snapshot().structures).toHaveLength(1);
    settle(world);
    expect(world.snapshot().allSettled).toBe(true);
  });

  it('makes light vary by horizontal placement and occlusion, not only depth', () => {
    const world = new SimulationWorld('mission-2');
    placeStructure(world, 'flat-stone', { x: 405, y: 280 });
    placeStructure(world, 'round-stone', { x: 900, y: 280 });
    placeStructure(world, 'tall-stone', { x: 620, y: 220 });
    settle(world, 900);
    const snapshot = world.snapshot();
    const byOwner = snapshot.structures.map((structure) => ({
      structure,
      average: snapshot.cells
        .filter((cell) => cell.ownerId === structure.id)
        .reduce((sum, cell, _, cells) => sum + cell.light / cells.length, 0),
    }));
    const flat = byOwner.find((entry) => entry.structure.definitionId === 'flat-stone')!;
    const round = byOwner.find((entry) => entry.structure.definitionId === 'round-stone')!;
    expect(flat.average).toBeGreaterThan(round.average + 5);
    const darkestSurfaceCell = Math.min(...snapshot.cells.map((cell) => cell.light));
    expect(darkestSurfaceCell).toBeLessThan(5);
  });

  it('keeps the first challenge reachable with a suitable light placement', () => {
    const world = new SimulationWorld('mission-1');
    placeStructure(world, 'flat-stone', { x: 405, y: 260 });
    settle(world);
    const snapshot = world.snapshot();
    const ownerId = snapshot.structures[0].id;
    const brightest = snapshot.cells
      .filter((cell) => cell.ownerId === ownerId)
      .sort((a, b) => b.light - a.light)[0];
    placeSeed(world, 'oedogonium', brightest);
    world.handle({ type: 'start' });
    world.handle({ type: 'set-speed', speed: 8 });
    for (let index = 0; index < 1400 && world.snapshot().outcome === 'pending'; index += 1) {
      world.tick(1 / 60);
    }
    const succeeded = world.snapshot();
    expect(succeeded.outcome).toBe('success');
    const elapsedAtSuccess = succeeded.elapsedSeconds;
    for (let index = 0; index < 120; index += 1) world.tick(1 / 60);
    const continued = world.snapshot();
    expect(continued.phase).toBe('running');
    expect(continued.elapsedSeconds).toBeGreaterThan(elapsedAtSuccess);
  }, 30_000);

  it('makes mission 2 a diatom-only challenge scored only in the suitable shade band', () => {
    const world = new SimulationWorld('mission-2');
    expect(world.snapshot().remainingSeeds.oedogonium).toBe(0);
    world.handle({ type: 'pick-seed', speciesId: 'oedogonium', point: { x: 400, y: 300 } });
    expect(world.snapshot().holding).toBeNull();

    placeStructure(world, 'flat-stone', { x: 390, y: 250 });
    placeStructure(world, 'tall-stone', { x: 620, y: 210 });
    placeStructure(world, 'round-stone', { x: 875, y: 270 });
    settle(world, 900);
    const snapshot = world.snapshot();
    const suitableShade = snapshot.cells
      .filter((cell) => cell.targetEligible && cell.light >= 12 && cell.light <= 58)
      .sort((a, b) => a.x - b.x);
    expect(suitableShade.length).toBeGreaterThan(80);
    for (const ratio of [0.05, 0.35, 0.65, 0.95]) {
      placeSeed(world, 'nitzschia', suitableShade[Math.floor(suitableShade.length * ratio)]);
    }
    world.handle({ type: 'start' });
    world.handle({ type: 'set-speed', speed: 8 });
    for (let index = 0; index < 2200 && world.snapshot().outcome === 'pending'; index += 1) {
      world.tick(1 / 60);
    }
    const finalSnapshot = world.snapshot();
    expect(finalSnapshot.outcome).toBe('success');
    expect(finalSnapshot.missionProgress?.unit).toBe('habitat-coverage');
    expect(finalSnapshot.totalBiomass.oedogonium).toBe(0);
  }, 30_000);

  it('starts mission 2 without requiring every supplied structure type', () => {
    const world = new SimulationWorld('mission-2');
    placeStructure(world, 'flat-stone', { x: 390, y: 250 });
    settle(world);
    const cell = world.snapshot().cells.find((candidate) => candidate.targetEligible);
    expect(cell).toBeDefined();
    placeSeed(world, 'nitzschia', cell!);
    world.handle({ type: 'start' });
    expect(world.snapshot().phase).toBe('running');
  });

  it('does not start a surface-scored mission from a substrate-only inoculation', () => {
    const world = new SimulationWorld('mission-2');
    const substrate = world.snapshot().cells.find((cell) => cell.surfaceKind === 'substrate')!;
    placeSeed(world, 'nitzschia', substrate);
    world.handle({ type: 'start' });
    expect(world.snapshot().phase).toBe('setup');
    expect(world.snapshot().message).toContain('구조물 표면');

    placeStructure(world, 'flat-stone', { x: 390, y: 250 });
    settle(world);
    world.handle({ type: 'start' });
    expect(world.snapshot().phase).toBe('setup');
    expect(world.snapshot().message).toContain('구조물 앞면');

    const structureCell = world.snapshot().cells.find((cell) => cell.targetEligible)!;
    placeSeed(world, 'nitzschia', structureCell);
    world.handle({ type: 'start' });
    expect(world.snapshot().phase).toBe('running');
  });

  it('rejects duplicate inoculation without consuming another seed', () => {
    const world = new SimulationWorld('mission-2');
    placeStructure(world, 'flat-stone', { x: 390, y: 250 });
    settle(world);
    const cell = world.snapshot().cells.find((candidate) => candidate.targetEligible)!;
    placeSeed(world, 'nitzschia', cell);
    const before = world.snapshot();
    const biomassBefore = before.cells.find((candidate) => candidate.id === cell.id)!.biomass.nitzschia;

    world.handle({ type: 'pointer-move', point: cell });
    world.handle({ type: 'pick-seed', speciesId: 'nitzschia' });
    world.handle({ type: 'pointer-move', point: cell });
    world.handle({ type: 'drop-held', point: cell });
    const rejected = world.snapshot();
    expect(rejected.seeds).toHaveLength(1);
    expect(rejected.holding?.kind).toBe('seed');
    expect(rejected.holding?.valid).toBe(false);
    expect(rejected.message).toContain('이미 접종');
    expect(rejected.cells.find((candidate) => candidate.id === cell.id)!.biomass.nitzschia).toBe(biomassBefore);

    world.handle({ type: 'cancel-held' });
    expect(world.snapshot().remainingSeeds.nitzschia).toBe(3);
  });

  it('makes mission 3 start empty and lets one viable layout reach the whole-tank biomass goal', () => {
    const world = new SimulationWorld('mission-3');
    const target = SCENARIOS['mission-3'].target;
    expect(target?.type).toBe('biomass');
    if (target?.type !== 'biomass') throw new Error('unexpected mission target');
    const initial = world.snapshot();
    expect(initial.structures).toHaveLength(0);
    expect(initial.seeds).toHaveLength(0);
    expect(initial.remainingStructures['flat-stone']).toBeNull();
    expect(initial.remainingStructures['round-stone']).toBeNull();
    expect(initial.remainingStructures['tall-stone']).toBeNull();

    placeStructure(world, 'tall-stone', { x: 408, y: 250 });
    settle(world, 900);
    placeStructure(world, 'flat-stone', { x: 408, y: 300 });
    settle(world, 900);
    const settled = world.snapshot();
    expect(settled.allSettled).toBe(true);
    // This is one convenient solution used by the regression test, not part of
    // mission scoring: the target itself has no position or light-band fields.
    const inoculationOptions = settled.cells
      .filter((cell) => cell.surfaceKind === 'structure-face')
      .sort((a, b) => b.light - a.light);
    expect(inoculationOptions.length).toBeGreaterThan(0);
    placeSeed(world, 'oedogonium', inoculationOptions[0]);
    world.handle({ type: 'start' });
    world.handle({ type: 'set-speed', speed: 8 });
    for (let index = 0; index < 2600 && world.snapshot().outcome === 'pending'; index += 1) {
      world.tick(1 / 60);
    }
    const final = world.snapshot();
    expect(final.outcome).toBe('success');
    expect(final.missionProgress?.unit).toBe('biomass');
    expect(final.missionProgress!.current).toBeCloseTo(final.totalBiomass.oedogonium, 8);
    expect(final.missionProgress!.current).toBeGreaterThanOrEqual(target.amount);
  }, 30_000);

  it('supports live probe previews and multiple installed measurement points', () => {
    const world = new SimulationWorld('laboratory');
    world.handle({ type: 'probe', point: { x: 330, y: 280 } });
    expect(world.snapshot().probe?.x).toBe(330);

    world.handle({ type: 'place-measurement', kind: 'light', point: { x: 330, y: 280 } });
    let snapshot = world.snapshot();
    expect(snapshot.probe).toBeNull();
    expect(snapshot.measurements).toHaveLength(1);
    expect(snapshot.selection?.kind).toBe('measurement');

    world.handle({ type: 'place-measurement', kind: 'temperature', point: { x: 840, y: 500 } });
    snapshot = world.snapshot();
    expect(snapshot.measurements).toHaveLength(2);
    expect(snapshot.measurements[1].temperature).toBeGreaterThan(20);

    world.handle({ type: 'select-at', point: { x: 330, y: 280 }, filter: 'measurement' });
    expect(world.snapshot().selection?.measurementId).toBe(snapshot.measurements[0].id);
    world.handle({ type: 'remove-measurement', id: snapshot.measurements[0].id });
    expect(world.snapshot().measurements).toHaveLength(1);
  });

  it('filters point selection by tab and aggregates only organisms inside a dragged region', () => {
    const world = new SimulationWorld('laboratory');
    placeStructure(world, 'flat-stone', { x: 405, y: 260 });
    settle(world);
    const structure = world.snapshot().structures[0];
    const surface = world.snapshot().cells
      .filter((cell) => cell.ownerId === structure.id)
      .sort((a, b) => a.x - b.x);
    const left = surface[Math.floor(surface.length * 0.2)];
    const right = surface[Math.floor(surface.length * 0.8)];
    placeSeed(world, 'oedogonium', left);
    placeSeed(world, 'nitzschia', right);

    world.handle({ type: 'select-at', point: left, filter: 'organism' });
    expect(world.snapshot().selection?.speciesIds).toEqual(['oedogonium']);
    world.handle({ type: 'select-at', point: { x: structure.x, y: structure.y }, filter: 'structure' });
    expect(world.snapshot().selection?.kind).toBe('structure');

    world.handle({
      type: 'select-region',
      from: { x: Math.min(left.x, right.x) - 12, y: Math.min(left.y, right.y) - 12 },
      to: { x: Math.max(left.x, right.x) + 12, y: Math.max(left.y, right.y) + 12 },
      filter: 'organism',
    });
    const regionSelection = world.snapshot().selection;
    expect(regionSelection?.kind).toBe('region');
    expect(regionSelection?.speciesIds).toEqual(expect.arrayContaining(['oedogonium', 'nitzschia']));
  });

  it('keeps simulating after a challenge times out', () => {
    const world = new SimulationWorld('mission-1');
    placeStructure(world, 'flat-stone', { x: 1030, y: 260 });
    settle(world);
    const snapshot = world.snapshot();
    const ownerId = snapshot.structures[0].id;
    const darkest = snapshot.cells
      .filter((cell) => cell.ownerId === ownerId)
      .sort((a, b) => a.light - b.light)[0];
    placeSeed(world, 'oedogonium', darkest);
    world.handle({ type: 'start' });
    world.handle({ type: 'set-speed', speed: 8 });
    for (let index = 0; index < 1800 && world.snapshot().outcome === 'pending'; index += 1) {
      world.tick(1 / 60);
    }
    const failed = world.snapshot();
    expect(failed.outcome).toBe('failure');
    const elapsedAtFailure = failed.elapsedSeconds;
    for (let index = 0; index < 120; index += 1) world.tick(1 / 60);
    expect(world.snapshot().phase).toBe('running');
    expect(world.snapshot().elapsedSeconds).toBeGreaterThan(elapsedAtFailure);
  }, 30_000);

  it('lets the better-adapted species gradually replace a resident colony', () => {
    const world = new SimulationWorld('laboratory');
    placeStructure(world, 'flat-stone', { x: 405, y: 260 });
    settle(world);
    const surface = world.snapshot().cells
      .filter((cell) => cell.surfaceKind === 'structure-face')
      .sort((a, b) => Math.abs(a.light - 68) - Math.abs(b.light - 68))[0];
    placeSeed(world, 'nitzschia', surface);
    world.handle({ type: 'start' });
    world.handle({ type: 'set-speed', speed: 8 });
    for (let index = 0; index < 1000; index += 1) world.tick(1 / 60);
    world.handle({ type: 'pause' });
    const beforeCell = world.snapshot().cells.find((cell) => cell.id === surface.id)!;
    placeSeed(world, 'oedogonium', beforeCell);
    const nitzschiaBefore = world.snapshot().cells.find((cell) => cell.id === surface.id)!.biomass.nitzschia;
    world.handle({ type: 'resume' });
    for (let index = 0; index < 1400; index += 1) world.tick(1 / 60);
    const after = world.snapshot().cells.find((cell) => cell.id === surface.id)!;
    expect(after.biomass.oedogonium).toBeGreaterThan(after.biomass.nitzschia);
    expect(after.biomass.nitzschia).toBeLessThan(nitzschiaBefore);
  }, 30_000);
});
