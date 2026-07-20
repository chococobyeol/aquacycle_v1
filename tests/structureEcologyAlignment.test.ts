import { describe, expect, it } from 'vitest';
import { SimulationWorld } from '../src/simulation/SimulationWorld';
import { STRUCTURES } from '../src/simulation/config';
import {
  structureAuthoredPointToWorld,
  structureAuthoredPolygonToWorld,
} from '../src/simulation/structureGeometry';
import { sampleEcologyFace } from '../src/simulation/surfaces';

const settle = (world: SimulationWorld, ticks = 900): void => {
  for (let index = 0; index < ticks; index += 1) world.tick(1 / 60);
};

describe('structure ecology alignment', () => {
  it('transforms ecology cells from the same recentered origin as the visible stone', () => {
    const world = new SimulationWorld('laboratory');
    const placement = { x: 610, y: 260 };
    world.handle({ type: 'pick-structure', definitionId: 'tall-stone', point: placement });
    world.handle({ type: 'rotate-held', radians: Math.PI / 9 });
    world.handle({ type: 'drop-held', point: placement });
    settle(world);

    const snapshot = world.snapshot();
    const structure = snapshot.structures[0];
    const definition = STRUCTURES[structure.definitionId];
    const authoredCells = sampleEcologyFace(definition);
    const structureCells = snapshot.cells.filter((cell) => cell.ownerId === structure.id);

    expect(structureCells).toHaveLength(authoredCells.length);
    for (const cell of structureCells) {
      const expected = structureAuthoredPointToWorld(
        authoredCells[cell.index],
        definition.collisionPolygon,
        structure,
        structure.angle,
      );
      expect(cell.x, `${cell.id} x`).toBeCloseTo(expected.x, 6);
      expect(cell.y, `${cell.id} y`).toBeCloseTo(expected.y, 6);
    }
  });

  it('uses those aligned cell positions for inoculation and colony selection', () => {
    const world = new SimulationWorld('laboratory');
    const placement = { x: 610, y: 260 };
    world.handle({ type: 'pick-structure', definitionId: 'tall-stone', point: placement });
    world.handle({ type: 'drop-held', point: placement });
    settle(world);

    const placed = world.snapshot();
    const structure = placed.structures[0];
    const targetCell = placed.cells
      .filter((cell) => cell.ownerId === structure.id)
      .sort((a, b) => a.y - b.y)[0];

    world.handle({ type: 'pick-seed', speciesId: 'oedogonium', point: targetCell });
    const held = world.snapshot().holding;
    expect(held?.valid).toBe(true);
    expect(held?.x).toBeCloseTo(targetCell.x, 6);
    expect(held?.y).toBeCloseTo(targetCell.y, 6);

    world.handle({ type: 'drop-held', point: targetCell });
    const seeded = world.snapshot();
    expect(seeded.seeds[0].cellId).toBe(targetCell.id);
    expect(seeded.seeds[0].x).toBeCloseTo(targetCell.x, 6);
    expect(seeded.seeds[0].y).toBeCloseTo(targetCell.y, 6);

    world.handle({ type: 'select-at', point: targetCell, filter: 'organism' });
    const selection = world.snapshot().selection;
    expect(selection?.kind).toBe('colony');
    expect(selection?.cellId).toBe(targetCell.id);
    expect(selection?.x).toBeCloseTo(targetCell.x, 6);
    expect(selection?.y).toBeCloseTo(targetCell.y, 6);
  });

  it('applies the same offset to the renderer ecology-mask polygon', () => {
    const definition = STRUCTURES['tall-stone'];
    const bodyPosition = { x: 420, y: 315 };
    const bodyAngle = -Math.PI / 7;
    const worldPolygon = structureAuthoredPolygonToWorld(
      definition.ecologyPolygon,
      definition.collisionPolygon,
      bodyPosition,
      bodyAngle,
    );

    expect(worldPolygon).toHaveLength(definition.ecologyPolygon.length);
    worldPolygon.forEach((point, index) => {
      const expected = structureAuthoredPointToWorld(
        definition.ecologyPolygon[index],
        definition.collisionPolygon,
        bodyPosition,
        bodyAngle,
      );
      expect(point.x).toBeCloseTo(expected.x, 8);
      expect(point.y).toBeCloseTo(expected.y, 8);
    });
  });
});
