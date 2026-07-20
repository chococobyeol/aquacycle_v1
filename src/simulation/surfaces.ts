import type { StructureDefinition } from './config';
import { GROUND_Y, TANK_WIDTH, type Vec2 } from './types';

export interface LocalSurfaceCell {
  x: number;
  y: number;
  row: number;
  column: number;
  cellSize: number;
  neighborIndices: number[];
}

export const pointInPolygon = (point: Vec2, polygon: Vec2[]): boolean => {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const a = polygon[index];
    const b = polygon[previous];
    const crosses =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y || Number.EPSILON) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
};

const attachGridNeighbors = (cells: LocalSurfaceCell[]): LocalSurfaceCell[] => {
  const byGrid = new Map(cells.map((cell, index) => [`${cell.column}:${cell.row}`, index]));
  return cells.map((cell) => {
    const neighborIndices: number[] = [];
    for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
      for (let columnOffset = -1; columnOffset <= 1; columnOffset += 1) {
        if (rowOffset === 0 && columnOffset === 0) continue;
        const neighbor = byGrid.get(`${cell.column + columnOffset}:${cell.row + rowOffset}`);
        if (neighbor !== undefined) neighborIndices.push(neighbor);
      }
    }
    return { ...cell, neighborIndices };
  });
};

export const sampleEcologyFace = (
  definition: StructureDefinition,
): LocalSurfaceCell[] => {
  const polygon = definition.ecologyPolygon;
  const minX = Math.min(...polygon.map((point) => point.x));
  const maxX = Math.max(...polygon.map((point) => point.x));
  const minY = Math.min(...polygon.map((point) => point.y));
  const maxY = Math.max(...polygon.map((point) => point.y));
  const step = definition.ecologyCellSize;
  const cells: LocalSurfaceCell[] = [];
  const columns = Math.ceil((maxX - minX) / step);
  const rows = Math.ceil((maxY - minY) / step);

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const point = {
        x: minX + (column + 0.5) * step,
        y: minY + (row + 0.5) * step,
      };
      if (!pointInPolygon(point, polygon)) continue;
      cells.push({ ...point, row, column, cellSize: step, neighborIndices: [] });
    }
  }
  return attachGridNeighbors(cells);
};

export const sampleSubstrate = (cellSize = 10, rowCount = 3): LocalSurfaceCell[] => {
  const cells: LocalSurfaceCell[] = [];
  const columns = Math.floor(TANK_WIDTH / cellSize);
  for (let row = 0; row < rowCount; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      cells.push({
        x: (column + 0.5) * cellSize,
        y: GROUND_Y - (row + 0.5) * cellSize,
        row,
        column,
        cellSize,
        neighborIndices: [],
      });
    }
  }
  return attachGridNeighbors(cells);
};

export const transformLocalPoint = (
  local: Vec2,
  position: Vec2,
  angle: number,
): Vec2 => {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return {
    x: position.x + local.x * cosine - local.y * sine,
    y: position.y + local.x * sine + local.y * cosine,
  };
};

export const inverseTransformPoint = (
  world: Vec2,
  position: Vec2,
  angle: number,
): Vec2 => {
  const cosine = Math.cos(-angle);
  const sine = Math.sin(-angle);
  const x = world.x - position.x;
  const y = world.y - position.y;
  return {
    x: x * cosine - y * sine,
    y: x * sine + y * cosine,
  };
};
