import { describe, expect, it } from 'vitest';
import { ALGAE_VISIBLE_BIOMASS } from '../src/simulation/config';
import { SimulationWorld } from '../src/simulation/SimulationWorld';
import type { SpeciesId, Vec2 } from '../src/simulation/types';

const settle = (world: SimulationWorld, ticks = 720): void => {
  for (let index = 0; index < ticks; index += 1) world.tick(1 / 60);
};

const seed = (world: SimulationWorld, speciesId: SpeciesId, point: Vec2): void => {
  world.handle({ type: 'pick-seed', speciesId, point });
  world.handle({ type: 'drop-held', point });
};

describe('editable removal tools', () => {
  it('returns a selected structure to inventory and removes its attached colony', () => {
    const world = new SimulationWorld('laboratory');
    const placement = { x: 510, y: 280 };
    world.handle({ type: 'pick-structure', definitionId: 'flat-stone', point: placement });
    world.handle({ type: 'drop-held', point: placement });
    settle(world);

    const placed = world.snapshot();
    const structure = placed.structures[0];
    const surfaceCell = placed.cells.find((cell) => cell.ownerId === structure.id)!;
    seed(world, 'oedogonium', surfaceCell);
    world.handle({ type: 'select-at', point: structure, filter: 'structure' });
    world.handle({ type: 'retrieve-structure', id: structure.id });

    const removed = world.snapshot();
    expect(removed.structures).toHaveLength(0);
    expect(removed.cells.some((cell) => cell.ownerId === structure.id)).toBe(false);
    expect(removed.seeds).toHaveLength(0);
    expect(removed.selection).toBeNull();
  });

  it('returns challenge structures before start but refuses removal after start', () => {
    const challenge = new SimulationWorld('mission-1');
    challenge.handle({ type: 'pick-structure', definitionId: 'flat-stone', point: { x: 510, y: 280 } });
    challenge.handle({ type: 'drop-held', point: { x: 510, y: 280 } });
    settle(challenge);
    const firstChallengeId = challenge.snapshot().structures[0].id;
    challenge.handle({ type: 'retrieve-structure', id: firstChallengeId });
    expect(challenge.snapshot().structures).toHaveLength(0);
    expect(challenge.snapshot().remainingStructures['flat-stone']).toBe(1);

    challenge.handle({ type: 'pick-structure', definitionId: 'flat-stone', point: { x: 510, y: 280 } });
    challenge.handle({ type: 'drop-held', point: { x: 510, y: 280 } });
    settle(challenge);
    const placed = challenge.snapshot();
    const challengeId = placed.structures[0].id;
    const surfaceCell = placed.cells.find((cell) => cell.ownerId === challengeId)!;
    seed(challenge, 'oedogonium', surfaceCell);
    challenge.handle({ type: 'start' });
    challenge.handle({ type: 'pause' });
    challenge.handle({ type: 'retrieve-structure', id: challengeId });
    expect(challenge.snapshot().structures).toHaveLength(1);

    const laboratory = new SimulationWorld('laboratory');
    laboratory.handle({ type: 'pick-structure', definitionId: 'flat-stone', point: { x: 510, y: 280 } });
    laboratory.handle({ type: 'drop-held', point: { x: 510, y: 280 } });
    settle(laboratory);
    const laboratoryId = laboratory.snapshot().structures[0].id;
    laboratory.handle({ type: 'start' });
    laboratory.handle({ type: 'retrieve-structure', id: laboratoryId });
    expect(laboratory.snapshot().structures).toHaveLength(1);
  });

  it('wakes a remaining stack when its supporting stone is removed', () => {
    const world = new SimulationWorld('laboratory');
    world.handle({ type: 'pick-structure', definitionId: 'flat-stone', point: { x: 600, y: 560 } });
    world.handle({ type: 'drop-held', point: { x: 600, y: 560 } });
    settle(world);
    const supportId = world.snapshot().structures[0].id;

    world.handle({ type: 'pick-structure', definitionId: 'flat-stone', point: { x: 600, y: 420 } });
    world.handle({ type: 'drop-held', point: { x: 600, y: 420 } });
    settle(world);
    const beforeRemoval = world.snapshot();
    const upper = beforeRemoval.structures.find((structure) => structure.id !== supportId)!;

    world.handle({ type: 'retrieve-structure', id: supportId });
    expect(world.snapshot().allSettled).toBe(false);
    for (let index = 0; index < 120; index += 1) world.tick(1 / 60);

    const fallen = world.snapshot().structures.find((structure) => structure.id === upper.id)!;
    expect(fallen.y).toBeGreaterThan(upper.y + 10);
  });

  it('removes a selected shrimp while editing but not after a challenge starts', () => {
    const laboratory = new SimulationWorld('laboratory');
    const point = { x: 600, y: 300 };
    laboratory.handle({ type: 'pick-animal', speciesId: 'cherry-shrimp', point });
    laboratory.handle({ type: 'drop-held', point });
    const animalId = laboratory.snapshot().animals[0].id;

    laboratory.handle({ type: 'start' });
    laboratory.handle({ type: 'retrieve-animal', id: animalId });
    expect(laboratory.snapshot().animals).toHaveLength(1);
    laboratory.handle({ type: 'pause' });
    laboratory.handle({ type: 'retrieve-animal', id: animalId });
    expect(laboratory.snapshot().animals).toHaveLength(0);

    const challenge = new SimulationWorld('mission-4');
    challenge.handle({ type: 'pick-animal', speciesId: 'cherry-shrimp', point });
    challenge.handle({ type: 'drop-held', point });
    const challengeAnimalId = challenge.snapshot().animals[0].id;
    challenge.handle({ type: 'retrieve-animal', id: challengeAnimalId });
    expect(challenge.snapshot().animals).toHaveLength(0);
    expect(challenge.snapshot().remainingAnimals['cherry-shrimp']).toBe(4);

    challenge.handle({ type: 'pick-animal', speciesId: 'cherry-shrimp', point });
    challenge.handle({ type: 'drop-held', point });
    const lockedAnimalId = challenge.snapshot().animals[0].id;
    challenge.handle({ type: 'start' });
    challenge.handle({ type: 'pause' });
    challenge.handle({ type: 'retrieve-animal', id: lockedAnimalId });
    expect(challenge.snapshot().animals).toHaveLength(1);
  });

  it('removes only the selected algae species and returns its inoculation marker', () => {
    const world = new SimulationWorld('laboratory');
    const cell = world.snapshot().cells.find((candidate) => candidate.surfaceKind === 'substrate')!;
    seed(world, 'oedogonium', cell);
    seed(world, 'nitzschia', cell);
    world.handle({ type: 'select-at', point: cell, filter: 'organism' });
    world.handle({ type: 'remove-selected-algae', speciesId: 'oedogonium' });

    const cleaned = world.snapshot();
    const cleanedCell = cleaned.cells.find((candidate) => candidate.id === cell.id)!;
    expect(cleanedCell.biomass.oedogonium).toBe(0);
    expect(cleanedCell.biomass.nitzschia).toBeGreaterThan(0);
    expect(cleaned.seeds.map((placement) => placement.speciesId)).toEqual(['nitzschia']);
    expect(cleaned.selection).toBeNull();
  });

  it('lets every visibly rendered trace be selected and cleaned', () => {
    const world = new SimulationWorld('laboratory');
    const cell = world.snapshot().cells.find((candidate) => candidate.surfaceKind === 'substrate')!;
    seed(world, 'oedogonium', cell);
    const internals = world as unknown as {
      substrateCells: Array<{ id: string; biomass: Record<SpeciesId, number> }>;
    };
    internals.substrateCells.find((candidate) => candidate.id === cell.id)!
      .biomass.oedogonium = ALGAE_VISIBLE_BIOMASS * 1.1;

    world.handle({ type: 'select-at', point: cell, filter: 'organism' });
    expect(world.snapshot().selection?.kind).toBe('colony');
    world.handle({ type: 'remove-selected-algae', speciesId: 'oedogonium' });
    expect(world.snapshot().cells.find((candidate) => candidate.id === cell.id)!
      .biomass.oedogonium).toBe(0);
  });

  it('cleans every cell in a dragged laboratory region but is disabled during simulation', () => {
    const world = new SimulationWorld('laboratory');
    const cells = world.snapshot().cells
      .filter((candidate) => candidate.surfaceKind === 'substrate')
      .slice(0, 3);
    for (const cell of cells) {
      seed(world, 'oedogonium', cell);
      seed(world, 'nitzschia', cell);
    }
    world.handle({
      type: 'select-region',
      from: { x: Math.min(...cells.map((cell) => cell.x)) - 1, y: Math.min(...cells.map((cell) => cell.y)) - 1 },
      to: { x: Math.max(...cells.map((cell) => cell.x)) + 1, y: Math.max(...cells.map((cell) => cell.y)) + 1 },
      filter: 'organism',
    });
    world.handle({ type: 'remove-selected-algae', speciesId: 'oedogonium' });
    expect(world.snapshot().cells
      .filter((candidate) => cells.some((cell) => cell.id === candidate.id))
      .every((candidate) => candidate.biomass.oedogonium === 0)).toBe(true);
    expect(world.snapshot().cells
      .filter((candidate) => cells.some((cell) => cell.id === candidate.id))
      .every((candidate) => candidate.biomass.nitzschia > 0)).toBe(true);

    const running = new SimulationWorld('laboratory');
    const runningCell = running.snapshot().cells.find((candidate) => candidate.surfaceKind === 'substrate')!;
    seed(running, 'oedogonium', runningCell);
    running.handle({ type: 'select-at', point: runningCell, filter: 'organism' });
    running.handle({ type: 'start' });
    running.handle({ type: 'remove-selected-algae', speciesId: 'oedogonium' });
    expect(running.snapshot().cells.find((candidate) => candidate.id === runningCell.id)!.biomass.oedogonium)
      .toBeGreaterThan(0);

    const challenge = new SimulationWorld('mission-4');
    const challengeCell = challenge.snapshot().cells.find((candidate) => candidate.surfaceKind === 'substrate')!;
    seed(challenge, 'oedogonium', challengeCell);
    challenge.handle({ type: 'select-at', point: challengeCell, filter: 'organism' });
    challenge.handle({ type: 'remove-selected-algae', speciesId: 'oedogonium' });
    expect(challenge.snapshot().cells.find((candidate) => candidate.id === challengeCell.id)!
      .biomass.oedogonium).toBe(0);
    expect(challenge.snapshot().seeds).toHaveLength(0);
    expect(challenge.snapshot().remainingSeeds.oedogonium).toBe(4);

    seed(challenge, 'oedogonium', challengeCell);
    challenge.handle({ type: 'start' });
    challenge.handle({ type: 'pause' });
    challenge.handle({ type: 'select-at', point: challengeCell, filter: 'organism' });
    challenge.handle({ type: 'remove-selected-algae', speciesId: 'oedogonium' });
    expect(challenge.snapshot().cells.find((candidate) => candidate.id === challengeCell.id)!
      .biomass.oedogonium).toBeGreaterThan(0);
  });
});
