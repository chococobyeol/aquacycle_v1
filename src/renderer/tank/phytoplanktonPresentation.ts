import {
  GROUND_Y,
  TANK_WIDTH,
  WATER_TOP,
  type Vec2,
} from '../../simulation/types';

export interface PhytoplanktonHazeMark extends Vec2 {
  radiusX: number;
  radiusY: number;
  alpha: number;
}

export interface PhytoplanktonSpeckMark extends Vec2 {
  radius: number;
  alpha: number;
  color: number;
}

export interface PhytoplanktonVisualPlan {
  haze: PhytoplanktonHazeMark[];
  specks: PhytoplanktonSpeckMark[];
}

const PARTICLE_CANDIDATES = 560;
const HAZE_CANDIDATES = 96;
const DISPLAY_CONCENTRATION = 8;

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(maximum, value));

const hash01 = (value: number): number => {
  const sine = Math.sin(value * 91.733) * 43758.5453;
  return sine - Math.floor(sine);
};

/**
 * The chemistry field stores cell averages. Rendering samples that field as a
 * continuous surface so neither particles nor haze inherit the 36×20 grid.
 */
export const samplePhytoplanktonConcentration = (
  values: readonly number[],
  columns: number,
  rows: number,
  point: Vec2,
): number => {
  if (columns <= 0 || rows <= 0 || values.length === 0) return 0;
  const waterHeight = GROUND_Y - WATER_TOP;
  const gridX = clamp(
    point.x / TANK_WIDTH * columns - 0.5,
    0,
    columns - 1,
  );
  const gridY = clamp(
    (point.y - WATER_TOP) / waterHeight * rows - 0.5,
    0,
    rows - 1,
  );
  const left = Math.floor(gridX);
  const top = Math.floor(gridY);
  const right = Math.min(columns - 1, left + 1);
  const bottom = Math.min(rows - 1, top + 1);
  const horizontal = gridX - left;
  const vertical = gridY - top;
  const valueAt = (column: number, row: number): number =>
    Math.max(0, values[row * columns + column] ?? 0);
  const upper = valueAt(left, top) * (1 - horizontal) +
    valueAt(right, top) * horizontal;
  const lower = valueAt(left, bottom) * (1 - horizontal) +
    valueAt(right, bottom) * horizontal;
  return upper * (1 - vertical) + lower * vertical;
};

const candidatePoint = (index: number, offset: number): Vec2 => ({
  x: hash01(index * 2.173 + offset) * TANK_WIDTH,
  y: WATER_TOP +
    hash01(index * 3.719 + offset * 1.37) * (GROUND_Y - WATER_TOP),
});

export const createPhytoplanktonVisualPlan = (
  values: readonly number[],
  columns: number,
  rows: number,
): PhytoplanktonVisualPlan => {
  if (columns <= 0 || rows <= 0 || values.length === 0) {
    return { haze: [], specks: [] };
  }

  const haze: PhytoplanktonHazeMark[] = [];
  for (let index = 0; index < HAZE_CANDIDATES; index += 1) {
    const point = candidatePoint(index, 17.3);
    const concentration = samplePhytoplanktonConcentration(
      values,
      columns,
      rows,
      point,
    );
    if (concentration < 0.04) continue;
    const strength = clamp(concentration / DISPLAY_CONCENTRATION, 0, 1);
    haze.push({
      ...point,
      radiusX: 32 + hash01(index * 5.13 + 41) * 54,
      radiusY: 20 + hash01(index * 7.91 + 53) * 38,
      alpha: 0.0015 + strength * 0.0045,
    });
  }

  const specks: PhytoplanktonSpeckMark[] = [];
  for (let index = 0; index < PARTICLE_CANDIDATES; index += 1) {
    const point = candidatePoint(index, 83.7);
    const concentration = samplePhytoplanktonConcentration(
      values,
      columns,
      rows,
      point,
    );
    if (concentration < 0.04) continue;
    const strength = clamp(concentration / DISPLAY_CONCENTRATION, 0, 1);
    const presence = 0.015 + Math.sqrt(strength) * 0.55;
    if (hash01(index * 11.17 + 97) > presence) continue;
    specks.push({
      ...point,
      radius: 0.26 + hash01(index * 13.31 + 109) * 0.28 + strength * 0.08,
      alpha: 0.07 + strength * 0.15 +
        hash01(index * 17.73 + 127) * 0.04,
      color: hash01(index * 19.37 + 139) < 0.55
        ? 0x779b4d
        : 0x6f9654,
    });
  }

  return { haze, specks };
};
