import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { userAgent: 'vitest' },
  });
});

import { SimulationWorld } from '../src/simulation/SimulationWorld';

describe('animal ecology allocation reuse', () => {
  it('keeps the owned population array while all species advance at 64x', () => {
    const world = new SimulationWorld('laboratory');
    const point = { x: 600, y: 300 };
    world.handle({
      type: 'pick-animal',
      speciesId: 'cherry-shrimp',
      point,
    });
    world.handle({ type: 'drop-held', point });
    world.handle({
      type: 'pick-animal',
      speciesId: 'japanese-ricefish',
      point,
    });
    world.handle({ type: 'drop-held', point });
    world.handle({
      type: 'pick-plankton',
      planktonKind: 'daphnia',
      point,
    });
    world.handle({ type: 'drop-held', point });

    const internals = world as unknown as {
      animals: unknown[];
      ecologySpeciesAnimalsScratch: unknown[];
      ecologyLivingAnimalsScratch: unknown[];
      ecologyNewbornAnimalsScratch: unknown[];
      ecologyEatenAnimalIdsScratch: Set<string>;
    };
    const ownedPopulation = internals.animals;

    world.handle({ type: 'start' });
    world.handle({ type: 'set-speed', speed: 64 });
    for (let tick = 0; tick < 80; tick += 1) {
      world.tick(0.1);
      expect(internals.animals).toBe(ownedPopulation);
    }

    expect(world.snapshot().elapsedSeconds).toBeGreaterThan(400);
    expect(internals.ecologySpeciesAnimalsScratch).toHaveLength(0);
    expect(internals.ecologyLivingAnimalsScratch).toHaveLength(0);
    expect(internals.ecologyNewbornAnimalsScratch).toHaveLength(0);
    expect(internals.ecologyEatenAnimalIdsScratch.size).toBe(0);
  });
});
