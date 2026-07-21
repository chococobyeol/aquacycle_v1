import { describe, expect, it } from 'vitest';
import {
  BiogeochemistryLedger,
  type BiofilmReactionSite,
} from '../src/simulation/biogeochemistry';
import { WATER_CYCLE_RULES } from '../src/simulation/config';

const totals = (
  ledger: BiogeochemistryLedger,
  sites: BiofilmReactionSite[],
): { nitrogen: number; carbon: number } => {
  const state = ledger.materialState();
  const film = sites.reduce(
    (sum, site) => sum + site.biofilm.decomposer + site.biofilm.nitrifier,
    0,
  );
  const organicBiomass = state.organicMatter + state.detritus + film;
  return {
    nitrogen: state.toxicWaste + state.nutrients +
      organicBiomass * WATER_CYCLE_RULES.biomassNitrogen,
    carbon: state.dissolvedInorganicCarbon + state.headspaceCarbonDioxide +
      organicBiomass * WATER_CYCLE_RULES.biomassCarbon,
  };
};

describe('closed material ledger', () => {
  it('conserves finite carbon and nitrogen through reaction, decay and transport', () => {
    const ledger = new BiogeochemistryLedger({
      effectsEnabled: true,
      initial: { organicMatter: 9, toxicWaste: 2.5, nutrients: 18, oxygen: 68 },
    });
    const sites = Array.from({ length: 18 }, (_, index): BiofilmReactionSite => ({
      point: { x: 80 + (index % 9) * 130, y: 540 + Math.floor(index / 9) * 80 },
      biofilm: {
        decomposer: 0.08 + (index % 3) * 0.02,
        nitrifier: 0.05 + (index % 2) * 0.02,
      },
    }));
    const initial = totals(ledger, sites);

    for (let second = 0; second < 3_600; second += 1) {
      ledger.advance(1, sites);
    }

    const final = totals(ledger, sites);
    expect(Math.abs((final.nitrogen - initial.nitrogen) / initial.nitrogen))
      .toBeLessThan(0.00002);
    expect(Math.abs((final.carbon - initial.carbon) / initial.carbon))
      .toBeLessThan(0.00002);
    expect(ledger.materialState().dissolvedInorganicCarbon).toBeGreaterThanOrEqual(0);
    expect(ledger.materialState().headspaceCarbonDioxide).toBeGreaterThanOrEqual(0);
    expect(ledger.materialState().headspaceOxygen).toBeGreaterThanOrEqual(0);
  });
});
