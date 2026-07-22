import { describe, expect, it } from 'vitest';
import {
  BiogeochemistryLedger,
  WATER_COLUMNS,
  WATER_ROWS,
} from '../src/simulation/biogeochemistry';

const CELL_COUNT = WATER_COLUMNS * WATER_ROWS;

const mean = (values: ArrayLike<number>): number => {
  let total = 0;
  for (let index = 0; index < values.length; index += 1) total += values[index];
  return total / values.length;
};

describe('legacy water transport regression', () => {
  it('leaves uniform closed water fields unchanged', () => {
    const ledger = new BiogeochemistryLedger({
      effectsEnabled: true,
      initial: { organicMatter: 4, toxicWaste: 2, nutrients: 37, oxygen: 71 },
    });

    for (let second = 0; second < 300; second += 1) ledger.advance(1, []);

    const water = ledger.snapshot().water;
    expect(water.organicMatter.every((value) => Math.abs(value - 4) < 1e-6)).toBe(true);
    expect(water.toxicWaste.every((value) => Math.abs(value - 2) < 1e-6)).toBe(true);
    expect(water.nutrients.every((value) => Math.abs(value - 37) < 1e-6)).toBe(true);
    expect(water.oxygen.every((value) => Number.isFinite(value) && value >= 0)).toBe(true);
  });

  it('redistributes a local pulse without changing its tank-wide amount', () => {
    const ledger = new BiogeochemistryLedger({
      effectsEnabled: true,
      initial: { organicMatter: 0, toxicWaste: 0, nutrients: 30, oxygen: 76 },
    });
    const internal = ledger as unknown as { organicMatter: Float32Array };
    const center = Math.floor(WATER_ROWS / 2) * WATER_COLUMNS + Math.floor(WATER_COLUMNS / 2);
    internal.organicMatter[center] = 72;
    const amountBefore = mean(internal.organicMatter);

    for (let second = 0; second < 60; second += 1) ledger.advance(1, []);

    const values = ledger.snapshot().water.organicMatter;
    expect(values).toHaveLength(CELL_COUNT);
    expect(mean(values)).toBeCloseTo(amountBefore, 6);
    expect(values[center]).toBeLessThan(72);
    expect(values.some((value, index) => index !== center && value > 0)).toBe(true);
  });
});
