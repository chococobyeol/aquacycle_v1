import Matter from 'matter-js';
import type { Vec2 } from './types';

const { Vertices } = Matter;

const authoredOffsetCache = new WeakMap<ReadonlyArray<Vec2>, Readonly<Vec2>>();

/**
 * Converts the authored SVG/polygon origin to Matter's body-local origin.
 *
 * `Bodies.fromVertices` recentres a hull on its area centroid. Structure art,
 * collision polygons, and ecology polygons are all authored in the original
 * design-space coordinates, so every authored point needs this same inverse
 * centroid offset before it is transformed by the Matter body.
 */
export const structureVisualOffset = (
  collisionPolygon: ReadonlyArray<Vec2>,
): Readonly<Vec2> => {
  const cached = authoredOffsetCache.get(collisionPolygon);
  if (cached) return cached;

  const hull = Vertices.hull(
    collisionPolygon.map((point) => ({ ...point })) as Matter.Vertex[],
  );
  const centre = Vertices.centre(hull);
  const offset = Object.freeze({ x: -centre.x, y: -centre.y });
  authoredOffsetCache.set(collisionPolygon, offset);
  return offset;
};

export const structureAuthoredPointToWorld = (
  authoredPoint: Vec2,
  collisionPolygon: ReadonlyArray<Vec2>,
  bodyPosition: Vec2,
  bodyAngle: number,
  reuse?: Vec2,
): Vec2 => {
  const offset = structureVisualOffset(collisionPolygon);
  const localX = authoredPoint.x + offset.x;
  const localY = authoredPoint.y + offset.y;
  const cosine = Math.cos(bodyAngle);
  const sine = Math.sin(bodyAngle);
  const point = reuse ?? { x: 0, y: 0 };
  point.x = bodyPosition.x + localX * cosine - localY * sine;
  point.y = bodyPosition.y + localX * sine + localY * cosine;
  return point;
};

export const structureAuthoredPolygonToWorld = (
  authoredPolygon: ReadonlyArray<Vec2>,
  collisionPolygon: ReadonlyArray<Vec2>,
  bodyPosition: Vec2,
  bodyAngle: number,
): Vec2[] => authoredPolygon.map((point) =>
  structureAuthoredPointToWorld(point, collisionPolygon, bodyPosition, bodyAngle));
