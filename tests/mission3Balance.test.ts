import { describe, expect, it } from 'vitest';
import { SCENARIOS } from '../src/simulation/config';
import { SimulationWorld } from '../src/simulation/SimulationWorld';
import type {
  SpeciesId,
  StructureDefinitionId,
  SurfaceCellSnapshot,
  Vec2,
} from '../src/simulation/types';

const settle = (world: SimulationWorld, ticks = 900): void => {
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
  settle(world);
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

const separatedBrightest = (
  cells: SurfaceCellSnapshot[],
  count: number,
): SurfaceCellSnapshot[] => {
  const selected: SurfaceCellSnapshot[] = [];
  for (const candidate of [...cells].sort((a, b) => b.light - a.light)) {
    const separated = selected.every((cell) =>
      Math.hypot(cell.x - candidate.x, cell.y - candidate.y) > 70,
    );
    if (!separated) continue;
    selected.push(candidate);
    if (selected.length === count) break;
  }
  return selected;
};

const separatedClosest = (
  cells: SurfaceCellSnapshot[],
  light: number,
  count: number,
): SurfaceCellSnapshot[] => {
  const selected: SurfaceCellSnapshot[] = [];
  for (const candidate of [...cells].sort((a, b) =>
    Math.abs(a.light - light) - Math.abs(b.light - light),
  )) {
    const separated = selected.every((cell) =>
      Math.hypot(cell.x - candidate.x, cell.y - candidate.y) > 70,
    );
    if (!separated) continue;
    selected.push(candidate);
    if (selected.length === count) break;
  }
  return selected;
};

const runPastTimeLimit = (world: SimulationWorld): void => {
  world.handle({ type: 'start' });
  world.handle({ type: 'set-speed', speed: 8 });
  for (let index = 0; index < 2300; index += 1) world.tick(1 / 60);
};

describe('mission 3 balance', () => {
  it('scores all Oedogonium biomass directly, without a position or light-band bonus', () => {
    const scenario = SCENARIOS['mission-3'];
    expect(scenario.requiredStructures).toEqual({});
    expect(scenario.lightOutput).toBe(52);
    expect(scenario.targetIncludesSubstrate).toBe(true);
    expect(scenario.target?.type).toBe('biomass');
    const target = scenario.target;
    if (target?.type !== 'biomass') throw new Error('unexpected mission target');
    expect(target).not.toHaveProperty('minLight');
    expect(target).not.toHaveProperty('maxY');

    const world = new SimulationWorld('mission-3');
    const substrate = world.snapshot().cells
      .filter((cell) => cell.surfaceKind === 'substrate')
      .sort((a, b) => a.light - b.light);
    const darkest = substrate[0];
    const brightest = substrate.at(-1)!;
    expect(brightest.light).toBeGreaterThan(darkest.light + 20);
    placeSeed(world, 'oedogonium', darkest);
    placeSeed(world, 'oedogonium', brightest);

    const seeded = world.snapshot();
    expect(seeded.missionProgress?.unit).toBe('biomass');
    expect(seeded.missionProgress?.current).toBeCloseTo(seeded.totalBiomass.oedogonium, 8);
    expect(seeded.missionProgress?.current).toBeCloseTo(0.56, 8);

    world.handle({ type: 'start' });
    world.handle({ type: 'set-speed', speed: 8 });
    for (let index = 0; index < 450; index += 1) world.tick(1 / 60);
    const grown = world.snapshot();
    expect(grown.missionProgress?.current).toBeCloseTo(grown.totalBiomass.oedogonium, 8);
    expect(grown.missionProgress?.ratio).toBeCloseTo(
      grown.totalBiomass.oedogonium / target.amount,
      8,
    );
  }, 30_000);

  it('rejects substrate and single-low-stone shortcuts while allowing a raised solution', () => {
    const target = SCENARIOS['mission-3'].target;
    if (target?.type !== 'biomass') throw new Error('unexpected mission target');

    const waitingWorld = new SimulationWorld('mission-3');
    const substrateSeeds = separatedBrightest(
      waitingWorld.snapshot().cells.filter((cell) => cell.surfaceKind === 'substrate'),
      2,
    );
    expect(substrateSeeds).toHaveLength(2);
    for (const cell of substrateSeeds) placeSeed(waitingWorld, 'oedogonium', cell);
    runPastTimeLimit(waitingWorld);
    const waiting = waitingWorld.snapshot();
    expect(waiting.outcome).toBe('failure');
    expect(waiting.totalBiomass.oedogonium).toBeLessThan(target.amount);
    expect(waiting.missionProgress?.current).toBeCloseTo(waiting.totalBiomass.oedogonium, 8);

    const lowStoneWorld = new SimulationWorld('mission-3');
    placeStructure(lowStoneWorld, 'flat-stone', { x: 408, y: 250 });
    const lowStoneSeeds = separatedClosest(
      lowStoneWorld.snapshot().cells.filter((cell) => cell.surfaceKind === 'structure-face'),
      68,
      2,
    );
    expect(lowStoneSeeds).toHaveLength(2);
    for (const cell of lowStoneSeeds) placeSeed(lowStoneWorld, 'oedogonium', cell);
    runPastTimeLimit(lowStoneWorld);
    const lowStone = lowStoneWorld.snapshot();
    expect(lowStone.outcome).toBe('failure');
    expect(lowStone.totalBiomass.oedogonium).toBeLessThan(target.amount);

    // This stack is one convenient regression fixture, not a hidden scoring
    // rule. Every arrangement is still judged by the same whole-tank biomass.
    const assistedWorld = new SimulationWorld('mission-3');
    placeStructure(assistedWorld, 'tall-stone', { x: 408, y: 250 });
    placeStructure(assistedWorld, 'flat-stone', { x: 408, y: 300 });
    const structureSeed = separatedClosest(
      assistedWorld.snapshot().cells.filter((cell) => cell.surfaceKind === 'structure-face'),
      68,
      1,
    );
    expect(structureSeed).toHaveLength(1);
    placeSeed(assistedWorld, 'oedogonium', structureSeed[0]);
    runPastTimeLimit(assistedWorld);
    const assisted = assistedWorld.snapshot();
    expect(assisted.outcome).toBe('success');
    expect(assisted.totalBiomass.oedogonium).toBeGreaterThanOrEqual(target.amount);
    expect(assisted.missionProgress?.current).toBeCloseTo(assisted.totalBiomass.oedogonium, 8);
  }, 30_000);
});
