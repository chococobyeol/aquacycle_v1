import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createPhytoplanktonVisualPlan,
  phytoplanktonBloomAlpha,
  samplePhytoplanktonConcentration,
  smoothPhytoplanktonConcentration,
  writePhytoplanktonBloomPixels,
} from '../src/renderer/tank/phytoplanktonPresentation';
import {
  GROUND_Y,
  TANK_WIDTH,
  WATER_TOP,
} from '../src/simulation/types';

describe('phytoplankton presentation', () => {
  it('bilinearly samples the chemistry grid as a continuous field', () => {
    expect(samplePhytoplanktonConcentration(
      [0, 4, 8, 12],
      2,
      2,
      {
        x: TANK_WIDTH / 2,
        y: (WATER_TOP + GROUND_Y) / 2,
      },
    )).toBeCloseTo(6);
  });

  it('uses scattered tank-space marks instead of repeated cell offsets', () => {
    const columns = 36;
    const rows = 20;
    const plan = createPhytoplanktonVisualPlan(
      new Array(columns * rows).fill(8),
      columns,
      rows,
    );
    const cellWidth = TANK_WIDTH / columns;
    const cellHeight = (GROUND_Y - WATER_TOP) / rows;
    const horizontalPhases = new Set(plan.specks.map((speck) =>
      Math.round(((speck.x / cellWidth) % 1) * 20)));
    const verticalPhases = new Set(plan.specks.map((speck) =>
      Math.round((((speck.y - WATER_TOP) / cellHeight) % 1) * 20)));

    expect(plan.specks.length).toBeGreaterThan(150);
    expect(horizontalPhases.size).toBeGreaterThan(15);
    expect(verticalPhases.size).toBeGreaterThan(15);
    expect(plan.specks.every((speck) =>
      speck.x >= 0 &&
      speck.x <= TANK_WIDTH &&
      speck.y >= WATER_TOP &&
      speck.y <= GROUND_Y)).toBe(true);
  });

  it('communicates higher concentration through density', () => {
    const low = createPhytoplanktonVisualPlan(
      new Array(36 * 20).fill(0.2),
      36,
      20,
    );
    const high = createPhytoplanktonVisualPlan(
      new Array(36 * 20).fill(8),
      36,
      20,
    );

    expect(low.specks.length).toBeGreaterThan(0);
    expect(high.specks.length).toBeGreaterThan(low.specks.length * 2);
  });

  it('maps dense blooms to a stronger continuous water tint', () => {
    const lowAlpha = phytoplanktonBloomAlpha(0.2);
    const bloomAlpha = phytoplanktonBloomAlpha(8);
    const bloom = createPhytoplanktonVisualPlan(
      new Array(36 * 20).fill(8),
      36,
      20,
    );

    expect(phytoplanktonBloomAlpha(0.03)).toBe(0);
    expect(bloomAlpha).toBeGreaterThan(0.2);
    expect(bloomAlpha).toBeGreaterThan(lowAlpha * 10);
    expect(Math.max(...bloom.specks.map((speck) => speck.radius)))
      .toBeLessThan(1);
  });

  it('keeps the strongest haze at the concentration peak and only softens nearby cells', () => {
    const columns = 5;
    const rows = 5;
    const values = new Array(columns * rows).fill(0);
    const centre = 2 * columns + 2;
    values[centre] = 16;
    const horizontal = new Float64Array(values.length);
    const smoothed = new Float64Array(values.length);
    const pixels = new Uint8Array(values.length * 4);
    smoothPhytoplanktonConcentration(
      values,
      columns,
      rows,
      horizontal,
      smoothed,
    );

    expect(writePhytoplanktonBloomPixels(smoothed, pixels)).toBe(true);
    expect(pixels[centre * 4 + 3])
      .toBeGreaterThan(pixels[(centre - 1) * 4 + 3]);
    expect(pixels[(centre - 1) * 4 + 3]).toBeGreaterThan(0);
    expect(pixels[0 * 4 + 3]).toBe(0);
    expect(pixels[(values.length - 1) * 4 + 3]).toBe(0);
  });

  it('updates one interpolated grid texture instead of stamping haze sprites', () => {
    const canvasSource = readFileSync(
      new URL('../src/renderer/tank/AquariumCanvas.tsx', import.meta.url),
      'utf8',
    );
    const phytoplanktonBlock = canvasSource.slice(
      canvasSource.indexOf('const drawPhytoplankton'),
      canvasSource.indexOf('const drawInteraction'),
    );

    expect(phytoplanktonBlock).toContain('surface.speckSprites');
    expect(phytoplanktonBlock).toContain('surface.hazePixels');
    expect(phytoplanktonBlock).toContain('surface.hazeSource?.update()');
    expect(phytoplanktonBlock).not.toContain('surface.hazeSprites');
    expect(phytoplanktonBlock).not.toContain('getRasterSurface');
  });
});
