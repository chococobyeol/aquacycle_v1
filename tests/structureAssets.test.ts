import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STRUCTURES } from '../src/simulation/config';
import { structureVisualOffset } from '../src/simulation/structureGeometry';

const numbersIn = (value: string): number[] =>
  [...value.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));

describe('structure artwork', () => {
  it('uses the collision polygon itself as every visible stone outline', () => {
    for (const definition of Object.values(STRUCTURES)) {
      const assetFile = resolve(
        process.cwd(),
        'src/renderer/public',
        definition.assetPath.replace(/^\.\//, ''),
      );
      const svg = readFileSync(assetFile, 'utf8');
      const viewBox = svg.match(/viewBox="([^"]+)"/)?.[1];
      const outline = svg.match(/<path id="stone" d="([^"]+)"/)?.[1];

      expect(viewBox, `${definition.id} viewBox`).toBe(`0 0 ${definition.width} ${definition.height}`);
      expect(outline, `${definition.id} outline`).toBeDefined();

      const visiblePoints = numbersIn(outline ?? '');
      const collisionPoints = definition.collisionPolygon.flatMap((point) => [
        point.x + definition.width / 2,
        point.y + definition.height / 2,
      ]);
      expect(visiblePoints, `${definition.id} visible boundary`).toEqual(collisionPoints);
    }
  });

  it('offsets every authored stone to Matter’s recentered collision hull', () => {
    const expectedOffsets = {
      'flat-stone': { x: -0.114340, y: -0.004550 },
      'round-stone': { x: 0.363195, y: -1.300715 },
      'tall-stone': { x: 2.733856, y: -8.984561 },
    };

    for (const definition of Object.values(STRUCTURES)) {
      const offset = structureVisualOffset(definition.collisionPolygon);
      expect(offset.x, `${definition.id} x offset`).toBeCloseTo(
        expectedOffsets[definition.id].x,
        5,
      );
      expect(offset.y, `${definition.id} y offset`).toBeCloseTo(
        expectedOffsets[definition.id].y,
        5,
      );
    }
  });
});
