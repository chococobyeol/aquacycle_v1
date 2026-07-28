import {
  GROUND_Y,
  TANK_WIDTH,
  WATER_TOP,
  type Vec2,
} from '../../simulation/types';

export interface PhytoplanktonSpeckMark extends Vec2 {
  radius: number;
  alpha: number;
  color: number;
}

export interface PhytoplanktonVisualPlan {
  specks: PhytoplanktonSpeckMark[];
}

const PARTICLE_CANDIDATES = 560;
const DISPLAY_CONCENTRATION = 8;
export const PHYTOPLANKTON_BLOOM_COLOR = 0x67ad4c;

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

/**
 * A single cell is microscopic and should not become a visible "organism".
 * Dense populations instead tint the water as one continuous concentration
 * field. The renderer linearly interpolates these per-cell alpha values.
 */
export const phytoplanktonBloomAlpha = (concentration: number): number => {
  if (!Number.isFinite(concentration) || concentration < 0.04) return 0;
  const strength = clamp(concentration / DISPLAY_CONCENTRATION, 0, 1);
  return Math.pow(strength, 0.72) * 0.22;
};

export const smoothPhytoplanktonConcentration = (
  values: readonly number[],
  columns: number,
  rows: number,
  horizontal: Float64Array,
  output: Float64Array,
): void => {
  const valueAt = (column: number, row: number): number =>
    Math.max(0, values[row * columns + column] ?? 0);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const left = Math.max(0, column - 1);
      const right = Math.min(columns - 1, column + 1);
      horizontal[row * columns + column] = (
        valueAt(left, row) +
        valueAt(column, row) * 2 +
        valueAt(right, row)
      ) / 4;
    }
  }
  for (let row = 0; row < rows; row += 1) {
    const top = Math.max(0, row - 1);
    const bottom = Math.min(rows - 1, row + 1);
    for (let column = 0; column < columns; column += 1) {
      output[row * columns + column] = (
        horizontal[top * columns + column] +
        horizontal[row * columns + column] * 2 +
        horizontal[bottom * columns + column]
      ) / 4;
    }
  }
};

export const writePhytoplanktonBloomPixels = (
  values: ArrayLike<number>,
  pixels: Uint8Array,
): boolean => {
  const cellCount = Math.floor(pixels.length / 4);
  let visible = false;
  for (let index = 0; index < cellCount; index += 1) {
    const alpha = phytoplanktonBloomAlpha(values[index] ?? 0);
    const offset = index * 4;
    pixels[offset] = (PHYTOPLANKTON_BLOOM_COLOR >> 16) & 0xff;
    pixels[offset + 1] = (PHYTOPLANKTON_BLOOM_COLOR >> 8) & 0xff;
    pixels[offset + 2] = PHYTOPLANKTON_BLOOM_COLOR & 0xff;
    pixels[offset + 3] = Math.round(alpha * 255);
    if (alpha > 0) visible = true;
  }
  return visible;
};

export const createPhytoplanktonVisualPlan = (
  values: readonly number[],
  columns: number,
  rows: number,
): PhytoplanktonVisualPlan => {
  if (columns <= 0 || rows <= 0 || values.length === 0) {
    return { specks: [] };
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

  return { specks };
};
