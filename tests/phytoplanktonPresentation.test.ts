import { describe, expect, it } from 'vitest';
import {
  createPhytoplanktonVisualPlan,
  samplePhytoplanktonConcentration,
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
});
