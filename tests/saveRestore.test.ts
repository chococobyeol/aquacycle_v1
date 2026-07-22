import { describe, expect, it } from 'vitest';
import { SimulationWorld } from '../src/simulation/SimulationWorld';

const settle = (world: SimulationWorld): void => {
  for (let index = 0; index < 240 && !world.snapshot().allSettled; index += 1) {
    world.tick(1 / 30);
  }
};

describe('frozen aquarium saves', () => {
  it('restores structures, surface ecology, instruments, time, and water chemistry', () => {
    const world = new SimulationWorld('mission-5');
    world.handle({ type: 'pick-structure', definitionId: 'flat-stone', point: { x: 360, y: 470 } });
    world.handle({ type: 'drop-held', point: { x: 360, y: 470 } });
    settle(world);

    const surface = world.snapshot().cells.find((cell) => cell.surfaceKind === 'substrate')!;
    world.handle({ type: 'pick-seed', speciesId: 'oedogonium', point: surface });
    world.handle({ type: 'drop-held', point: surface });
    world.handle({ type: 'pick-biofilm', guildId: 'decomposer', point: surface });
    world.handle({ type: 'drop-held', point: surface });
    world.handle({ type: 'place-measurement', kind: 'water-quality', point: { x: 520, y: 350 } });
    world.handle({ type: 'start' });
    for (let index = 0; index < 50; index += 1) world.tick(0.1);

    const before = world.snapshot();
    const save = world.exportSaveData();
    const restored = new SimulationWorld('mission-1');
    restored.loadSaveData(save);
    const after = restored.snapshot();

    expect(after.scenarioId).toBe('mission-5');
    expect(after.phase).toBe('paused');
    expect(after.elapsedSeconds).toBeCloseTo(before.elapsedSeconds, 6);
    expect(after.structures.map(({ id, definitionId }) => ({ id, definitionId })))
      .toEqual(before.structures.map(({ id, definitionId }) => ({ id, definitionId })));
    expect(after.measurements).toHaveLength(1);
    expect(after.cells.find((cell) => cell.id === surface.id)?.biomass.oedogonium)
      .toBeCloseTo(before.cells.find((cell) => cell.id === surface.id)!.biomass.oedogonium, 6);
    expect(after.cells.find((cell) => cell.id === surface.id)?.biofilm.decomposer)
      .toBeCloseTo(before.cells.find((cell) => cell.id === surface.id)!.biofilm.decomposer, 6);
    expect(after.biogeochemistry.average.oxygen)
      .toBeCloseTo(before.biogeochemistry.average.oxygen, 5);
    expect(after.biogeochemistry.average.toxicWaste)
      .toBeCloseTo(before.biogeochemistry.average.toxicWaste, 5);
  });

  it('selects structures, measurements, organisms, and microbial films in one region', () => {
    const world = new SimulationWorld('mission-5');
    world.handle({ type: 'pick-structure', definitionId: 'flat-stone', point: { x: 360, y: 470 } });
    world.handle({ type: 'drop-held', point: { x: 360, y: 470 } });
    settle(world);
    const surface = world.snapshot().cells.find((cell) => cell.surfaceKind === 'substrate')!;
    world.handle({ type: 'pick-biofilm', guildId: 'decomposer', point: surface });
    world.handle({ type: 'drop-held', point: surface });
    world.handle({ type: 'place-measurement', kind: 'light', point: { x: 520, y: 350 } });

    world.handle({
      type: 'select-region',
      from: { x: 0, y: 0 },
      to: { x: 1200, y: 720 },
      filter: 'all',
    });
    const selection = world.snapshot().selection;
    expect(selection?.kind).toBe('region');
    expect(selection?.structureIds).toHaveLength(1);
    expect(selection?.measurementIds).toHaveLength(1);
    expect(selection?.cellIds).toContain(surface.id);
    expect(selection?.microbeGuildIds).toContain('decomposer');

    world.handle({ type: 'select-at', point: surface, filter: 'all' });
    expect(world.snapshot().selection).toMatchObject({
      kind: 'colony',
      cellId: surface.id,
      microbeGuildIds: ['decomposer'],
    });
  });
});

