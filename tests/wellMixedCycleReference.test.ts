import { describe, expect, it } from 'vitest';
import {
  BiogeochemistryLedger,
  WATER_COLUMNS,
  WATER_ROWS,
  type BiofilmReactionSite,
} from '../src/simulation/biogeochemistry';
import { GROUND_Y, TANK_WIDTH, WATER_TOP } from '../src/simulation/types';

const uniformSites = (): BiofilmReactionSite[] =>
  Array.from({ length: WATER_COLUMNS * WATER_ROWS }, (_, index) => {
    const column = index % WATER_COLUMNS;
    const row = Math.floor(index / WATER_COLUMNS);
    return {
      point: {
        x: ((column + 0.5) / WATER_COLUMNS) * TANK_WIDTH,
        y: WATER_TOP + ((row + 0.5) / WATER_ROWS) * (GROUND_Y - WATER_TOP),
      },
      // The total film amount is comparable to a distributed mission-5 tank;
      // only its position is homogenised to isolate reaction kinetics from
      // transport quality.
      biofilm: { decomposer: 0.02, nitrifier: 0.003 },
    };
  });

describe('well-mixed microbial-cycle reference', () => {
  it('returns a uniform organic pulse to inorganic carbon and mineral nutrients', () => {
    const ledger = new BiogeochemistryLedger({
      effectsEnabled: true,
      initial: { organicMatter: 12, toxicWaste: 1, nutrients: 30, oxygen: 76 },
    });
    const sites = uniformSites();
    const initial = ledger.materialState();

    for (let second = 0; second < 1_800; second += 1) ledger.advance(1, sites);

    const final = ledger.materialState();
    expect(final.organicMatter).toBeLessThan(initial.organicMatter * 0.4);
    expect(final.dissolvedInorganicCarbon + final.headspaceCarbonDioxide).toBeGreaterThan(
      initial.dissolvedInorganicCarbon + initial.headspaceCarbonDioxide,
    );
    expect(final.nutrients + final.toxicWaste).toBeGreaterThan(
      initial.nutrients + initial.toxicWaste,
    );
  });
});
