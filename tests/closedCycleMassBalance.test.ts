import { describe, expect, it } from 'vitest';
import {
  BiogeochemistryLedger,
  type BiofilmReactionSite,
} from '../src/simulation/biogeochemistry';
import { WATER_CYCLE_RULES } from '../src/simulation/config';
import {
  CLOSED_MATERIAL_RELATIVE_TOLERANCE,
  oxygenEquivalentInventory,
} from '../src/simulation/stoichiometry';

const totals = (
  ledger: BiogeochemistryLedger,
  sites: BiofilmReactionSite[],
): { nitrogen: number; carbon: number; oxygenEquivalent: number } => {
  const state = ledger.materialState();
  const film = sites.reduce(
    (sum, site) => sum + site.biofilm.decomposer + site.biofilm.nitrifier,
    0,
  );
  const organicBiomass = state.organicMatter + state.detritus + film;
  const organicCarbon = organicBiomass * WATER_CYCLE_RULES.biomassCarbon;
  return {
    nitrogen: state.toxicWaste + state.nutrients +
      organicBiomass * WATER_CYCLE_RULES.biomassNitrogen,
    carbon: state.dissolvedInorganicCarbon + state.headspaceCarbonDioxide +
      organicCarbon,
    oxygenEquivalent: oxygenEquivalentInventory({
      totalOxygen: state.dissolvedOxygen + state.headspaceOxygen,
      organicCarbon,
      nitrateNitrogen: state.nutrients,
    }),
  };
};

describe('closed material ledger', () => {
  it('scales finite starting C/N reservoirs without scaling oxygen', () => {
    const initial = {
      organicMatter: 9,
      toxicWaste: 2.5,
      nutrients: 18,
      oxygen: 68,
    };
    const baseline = new BiogeochemistryLedger({ effectsEnabled: true, initial });
    const reduced = new BiogeochemistryLedger({
      effectsEnabled: true,
      initial,
      initialMaterialScale: 0.64,
    });
    const baselineState = baseline.materialState();
    const reducedState = reduced.materialState();

    expect(reducedState.organicMatter).toBeCloseTo(baselineState.organicMatter * 0.64);
    expect(reducedState.toxicWaste).toBeCloseTo(baselineState.toxicWaste * 0.64);
    expect(reducedState.nutrients).toBeCloseTo(baselineState.nutrients * 0.64);
    expect(reducedState.dissolvedInorganicCarbon)
      .toBeCloseTo(baselineState.dissolvedInorganicCarbon * 0.64);
    expect(reducedState.headspaceCarbonDioxide)
      .toBeCloseTo(baselineState.headspaceCarbonDioxide * 0.64);
    expect(reducedState.dissolvedOxygen).toBeCloseTo(baselineState.dissolvedOxygen);
    expect(reducedState.headspaceOxygen).toBeCloseTo(baselineState.headspaceOxygen);
  });

  it('can author the former 80-percent recipe as direct starting values', () => {
    const scaled = new BiogeochemistryLedger({
      effectsEnabled: true,
      initial: {
        organicMatter: 1.5,
        toxicWaste: 0.8,
        nutrients: 6,
        oxygen: 80,
      },
      initialMaterialScale: 0.8,
    }).materialState();
    const direct = new BiogeochemistryLedger({
      effectsEnabled: true,
      initial: {
        organicMatter: 1.2,
        toxicWaste: 0.64,
        nutrients: 4.8,
        oxygen: 80,
      },
      initialDissolvedInorganicCarbon: 46.4,
      initialHeadspaceCarbonDioxide: 17.6,
    }).materialState();

    expect(direct.organicMatter).toBeCloseTo(scaled.organicMatter, 12);
    expect(direct.toxicWaste).toBeCloseTo(scaled.toxicWaste, 12);
    expect(direct.nutrients).toBeCloseTo(scaled.nutrients, 12);
    expect(direct.dissolvedInorganicCarbon)
      .toBeCloseTo(scaled.dissolvedInorganicCarbon, 12);
    expect(direct.headspaceCarbonDioxide)
      .toBeCloseTo(scaled.headspaceCarbonDioxide, 12);
    expect(direct.dissolvedOxygen).toBeCloseTo(scaled.dissolvedOxygen, 12);
    expect(direct.headspaceOxygen).toBeCloseTo(scaled.headspaceOxygen, 12);
  });

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
      .toBeLessThan(CLOSED_MATERIAL_RELATIVE_TOLERANCE);
    expect(Math.abs((final.carbon - initial.carbon) / initial.carbon))
      .toBeLessThan(CLOSED_MATERIAL_RELATIVE_TOLERANCE);
    expect(Math.abs(
      (final.oxygenEquivalent - initial.oxygenEquivalent) /
      initial.oxygenEquivalent,
    )).toBeLessThan(CLOSED_MATERIAL_RELATIVE_TOLERANCE);
    expect(ledger.materialState().dissolvedInorganicCarbon).toBeGreaterThanOrEqual(0);
    expect(ledger.materialState().headspaceCarbonDioxide).toBeGreaterThanOrEqual(0);
    expect(ledger.materialState().headspaceOxygen).toBeGreaterThanOrEqual(0);
  });
});
