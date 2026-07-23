import type { Vec2 } from './types';

export interface VallisneriaLeafGeometry {
  root: Vec2;
  controlA: Vec2;
  controlB: Vec2;
  tip: Vec2;
  ribbonWidth: number;
}

export interface VallisneriaCanopyBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const cubicPoint = (
  start: Vec2,
  controlA: Vec2,
  controlB: Vec2,
  end: Vec2,
  t: number,
): Vec2 => {
  const inverse = 1 - t;
  const inverseSquared = inverse * inverse;
  const tSquared = t * t;
  return {
    x: inverseSquared * inverse * start.x +
      3 * inverseSquared * t * controlA.x +
      3 * inverse * tSquared * controlB.x +
      tSquared * t * end.x,
    y: inverseSquared * inverse * start.y +
      3 * inverseSquared * t * controlA.y +
      3 * inverse * tSquared * controlB.y +
      tSquared * t * end.y,
  };
};

export const vallisneriaLeaves = (
  cellIndex: number,
  anchor: Vec2,
  structuralScale: number,
): VallisneriaLeafGeometry[] => {
  const plantHash = (cellIndex * 0.61803398875) % 1;
  const baseHeight = (184 + plantHash * 34) * structuralScale;
  const leafCount = Math.max(3, Math.round(2 + structuralScale * 6));
  return Array.from({ length: leafCount }, (_, index) => {
    const ratio = leafCount <= 1 ? 0.5 : index / (leafCount - 1);
    const side = ratio * 2 - 1;
    const phase = cellIndex * 0.73 + index * 1.37;
    const leafHeight = baseHeight *
      (0.78 + (1 - Math.abs(side)) * 0.18) *
      (0.94 + Math.sin(phase) * 0.06);
    const rootX = anchor.x + side * (3 + structuralScale * 4);
    const lean = side * (10 + structuralScale * 24 + Math.abs(side) * 9) +
      Math.sin(phase * 1.7) * (3 + structuralScale * 5);
    const tipX = rootX + lean;
    const ribbonWidth = 4.6 + structuralScale * 2.5 + (index % 3) * 0.35;
    const swayA = Math.sin(phase * 1.11) * (3 + structuralScale * 6);
    const swayB = Math.cos(phase * 0.83) * (4 + structuralScale * 8);
    return {
      root: { x: rootX, y: anchor.y + 8 },
      controlA: {
        x: rootX + lean * 0.18 + swayA,
        y: anchor.y - leafHeight * 0.3,
      },
      controlB: {
        x: rootX + lean * 0.7 + swayB,
        y: anchor.y - leafHeight * 0.72,
      },
      tip: { x: tipX, y: anchor.y - leafHeight },
      ribbonWidth,
    };
  });
};

export const vallisneriaLeafPoint = (
  leaf: VallisneriaLeafGeometry,
  t: number,
): Vec2 => cubicPoint(leaf.root, leaf.controlA, leaf.controlB, leaf.tip, t);

export const vallisneriaCanopyBounds = (
  cellIndex: number,
  anchor: Vec2,
  structuralScale: number,
): VallisneriaCanopyBounds => {
  const leaves = vallisneriaLeaves(cellIndex, anchor, structuralScale);
  let minX = anchor.x;
  let minY = anchor.y;
  let maxX = anchor.x;
  let maxY = anchor.y + 8;
  for (const leaf of leaves) {
    for (let sample = 0; sample <= 12; sample += 1) {
      const point = vallisneriaLeafPoint(leaf, sample / 12);
      const margin = leaf.ribbonWidth / 2 + 5;
      minX = Math.min(minX, point.x - margin);
      minY = Math.min(minY, point.y - margin);
      maxX = Math.max(maxX, point.x + margin);
      maxY = Math.max(maxY, point.y + margin);
    }
  }
  return { minX, minY, maxX, maxY };
};

const distanceToSegment = (point: Vec2, start: Vec2, end: Vec2): number => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 1e-8) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(0, Math.min(1,
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared,
  ));
  return Math.hypot(point.x - (start.x + dx * t), point.y - (start.y + dy * t));
};

/** Hit testing follows the visible leaf ribbons rather than the invisible root cell. */
export const vallisneriaHitDistance = (
  point: Vec2,
  cellIndex: number,
  anchor: Vec2,
  structuralScale: number,
): number => {
  let nearest = Number.POSITIVE_INFINITY;
  for (const leaf of vallisneriaLeaves(cellIndex, anchor, structuralScale)) {
    let previous = leaf.root;
    for (let sample = 1; sample <= 14; sample += 1) {
      const current = vallisneriaLeafPoint(leaf, sample / 14);
      nearest = Math.min(
        nearest,
        Math.max(0, distanceToSegment(point, previous, current) - leaf.ribbonWidth / 2),
      );
      previous = current;
    }
  }
  return nearest;
};

