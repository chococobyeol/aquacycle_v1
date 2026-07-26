import { describe, expect, it } from 'vitest';
import {
  BiogeochemistryLedger,
  WATER_COLUMNS,
  WATER_ROWS,
} from '../src/simulation/biogeochemistry';
import { GROUND_Y, TANK_WIDTH, WATER_TOP } from '../src/simulation/types';

const centre = { x: TANK_WIDTH / 2, y: (WATER_TOP + GROUND_Y) / 2 };

const makeLedger = (
  lightLevel: number,
  nutrients = 28,
): BiogeochemistryLedger => {
  const ledger = new BiogeochemistryLedger({
    effectsEnabled: true,
    initial: {
      organicMatter: 1.5,
      toxicWaste: nutrients > 0 ? 0.8 : 0,
      nutrients,
      oxygen: 82,
    },
    initialTemperature: 23.5,
  });
  ledger.setTransportLight(
    Array.from({ length: WATER_COLUMNS * WATER_ROWS }, () => lightLevel),
  );
  return ledger;
};

const advance = (ledger: BiogeochemistryLedger, seconds: number): void => {
  for (let second = 0; second < seconds; second += 1) {
    ledger.beginStep(1);
    ledger.advanceTemperature(1, 22);
    ledger.advance(1, []);
  }
};

const biomassMeanRow = (values: readonly number[]): number => {
  let weighted = 0;
  let total = 0;
  for (let index = 0; index < values.length; index += 1) {
    const value = Math.max(0, values[index] ?? 0);
    weighted += Math.floor(index / WATER_COLUMNS) * value;
    total += value;
  }
  return total > 0 ? weighted / total : 0;
};

describe('phytoplankton life cycle', () => {
  it('grows in usable light and declines through respiration and mortality in darkness', () => {
    const bright = makeLedger(72);
    const dark = makeLedger(0);
    bright.addPlankton(centre, 'phytoplankton', 1.1);
    dark.addPlankton(centre, 'phytoplankton', 1.1);

    advance(bright, 300);
    advance(dark, 300);

    expect(bright.planktonState().phytoplanktonBiomass).toBeGreaterThan(1.1);
    expect(dark.planktonState().phytoplanktonBiomass).toBeLessThan(1.1);
    expect(bright.planktonState().fluxes.phytoplanktonGrowthPerSecond)
      .toBeGreaterThan(0);
    expect(dark.planktonState().fluxes.phytoplanktonGrowthPerSecond)
      .toBeLessThan(1e-8);
  });

  it('requires mineral nitrogen instead of creating biomass from light alone', () => {
    const replete = makeLedger(72, 28);
    const starved = makeLedger(72, 0);
    replete.addPlankton(centre, 'phytoplankton', 1.1);
    starved.addPlankton(centre, 'phytoplankton', 1.1);

    advance(replete, 240);
    advance(starved, 240);

    expect(replete.planktonState().phytoplanktonBiomass)
      .toBeGreaterThan(starved.planktonState().phytoplanktonBiomass);
    expect(starved.planktonState().phytoplanktonBiomass).toBeLessThan(1.1);
  });

  it('moves suspended biomass downward by settling rather than leaving it fixed', () => {
    const ledger = makeLedger(72);
    ledger.addPlankton(
      { x: TANK_WIDTH / 2, y: WATER_TOP + 8 },
      'phytoplankton',
      1.1,
    );
    const initialRow = biomassMeanRow(ledger.snapshot().water.phytoplankton);

    advance(ledger, 180);

    const currentRow = biomassMeanRow(ledger.snapshot().water.phytoplankton);
    expect(currentRow).toBeGreaterThan(initialRow + 0.25);
  });
});
