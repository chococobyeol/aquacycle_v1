import { describe, expect, it } from 'vitest';
import { SimulationWorld } from '../src/simulation/SimulationWorld';
import { FIXED_LAMP_X } from '../src/simulation/lightGeometry';
import { WATER_TOP, type StructureDefinitionId, type Vec2 } from '../src/simulation/types';

const REFLECTED_TEST_LIMIT = 6;

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

const lightAt = (world: SimulationWorld, point: Vec2): number => {
  world.handle({ type: 'probe', point });
  return world.snapshot().probe!.light;
};

describe('aquarium light field', () => {
  it('keeps the upper water corners softly lit under the broad ceiling lamp', () => {
    const world = new SimulationWorld('laboratory');
    const left = lightAt(world, { x: 18, y: WATER_TOP + 24 });
    const center = lightAt(world, { x: FIXED_LAMP_X, y: WATER_TOP + 24 });
    const right = lightAt(world, { x: 1182, y: WATER_TOP + 24 });
    const elevatedLeft = lightAt(world, { x: 18, y: WATER_TOP + 150 });
    const elevatedRight = lightAt(world, { x: 1182, y: WATER_TOP + 150 });

    expect(left).toBeGreaterThan(3);
    expect(right).toBeGreaterThan(3);
    expect(elevatedLeft).toBeGreaterThan(5);
    expect(elevatedRight).toBeGreaterThan(5);
    expect(center).toBeGreaterThan(left);
    expect(left).toBeGreaterThan(right);
  });

  it('adds only a small local reflected-light contribution near an illuminated stone', () => {
    const empty = new SimulationWorld('laboratory');
    const withStone = new SimulationWorld('laboratory');
    placeStructure(withStone, 'tall-stone', { x: 408, y: 250 });
    const stone = withStone.snapshot().structures[0];
    const facingSamples = [
      { x: stone.x - 85, y: stone.y - 150 },
      { x: stone.x + 85, y: stone.y - 150 },
    ];
    const reflectedGains = facingSamples.map((point) =>
      lightAt(withStone, point) - lightAt(empty, point));

    expect(stone.isSleeping).toBe(true);
    for (const gain of reflectedGains) {
      expect(gain).toBeGreaterThan(1);
      expect(gain).toBeLessThanOrEqual(REFLECTED_TEST_LIMIT);
    }
  });
});
