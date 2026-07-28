import { describe, expect, it } from 'vitest';
import {
  BiogeochemistryLedger,
  WATER_COLUMNS,
  WATER_ROWS,
} from '../src/simulation/biogeochemistry';
import {
  daphniaSuspendedFoodResponse,
  PLANKTON_ECOLOGY_RULES,
  WATER_CYCLE_RULES,
} from '../src/simulation/config';
import {
  CLOSED_MATERIAL_RELATIVE_TOLERANCE,
  oxygenEquivalentInventory,
} from '../src/simulation/stoichiometry';
import { GROUND_Y, TANK_WIDTH, WATER_TOP } from '../src/simulation/types';

const centre = { x: TANK_WIDTH / 2, y: (WATER_TOP + GROUND_Y) / 2 };
const light = Array.from({ length: WATER_COLUMNS * WATER_ROWS }, () => 72);

const makeLedger = (): BiogeochemistryLedger => {
  const ledger = new BiogeochemistryLedger({
    effectsEnabled: true,
    initial: {
      organicMatter: 6,
      toxicWaste: 0.8,
      nutrients: 28,
      oxygen: 82,
    },
    initialTemperature: 23.5,
  });
  ledger.setTransportLight(light);
  return ledger;
};

const advance = (ledger: BiogeochemistryLedger, seconds: number): void => {
  for (let second = 0; second < seconds; second += 1) {
    ledger.beginStep(1);
    ledger.advanceTemperature(1, 22);
    ledger.advance(1, []);
  }
};

const materialTotals = (ledger: BiogeochemistryLedger) => {
  const state = ledger.materialState();
  const livingAndDetritalBiomass = state.organicMatter + state.detritus +
    state.planktonicDecomposer + state.phytoplankton + state.daphnia;
  const organicCarbon = livingAndDetritalBiomass * WATER_CYCLE_RULES.biomassCarbon;
  return {
    nitrogen: state.toxicWaste + state.nutrients +
      livingAndDetritalBiomass * WATER_CYCLE_RULES.biomassNitrogen,
    carbon: state.dissolvedInorganicCarbon + state.headspaceCarbonDioxide +
      organicCarbon,
    oxygenEquivalent: oxygenEquivalentInventory({
      totalOxygen: state.dissolvedOxygen + state.headspaceOxygen,
      organicCarbon,
      nitrateNitrogen: state.nutrients,
    }),
  };
};

describe('plankton food web', () => {
  it('can reuse its high-frequency suspended-food response record', () => {
    const reuse = {
      phytoplanktonPotential: 0,
      bacterioplanktonPotential: 0,
      combinedResponse: 0,
      bacteriaShare: 0,
    };

    expect(daphniaSuspendedFoodResponse(12, 4, reuse)).toBe(reuse);
    expect(reuse.combinedResponse).toBeGreaterThan(0);
    expect(daphniaSuspendedFoodResponse(0, 0, reuse)).toBe(reuse);
    expect(reuse).toEqual({
      phytoplanktonPotential: 0,
      bacterioplanktonPotential: 0,
      combinedResponse: 0,
      bacteriaShare: 0,
    });
  });

  it('keeps both suspended-food requests first order at low density', () => {
    const componentRequests = (
      phytoplankton: number,
      bacterioplankton: number,
    ) => {
      const response = daphniaSuspendedFoodResponse(
        phytoplankton,
        bacterioplankton,
      );
      return {
        phytoplankton:
          response.combinedResponse * (1 - response.bacteriaShare),
        bacterioplankton:
          response.combinedResponse * response.bacteriaShare,
      };
    };
    const phytoLow = componentRequests(0.0001, 0).phytoplankton;
    const phytoDouble = componentRequests(0.0002, 0).phytoplankton;
    const bacteriaLow = componentRequests(0, 0.0001).bacterioplankton;
    const bacteriaDouble = componentRequests(0, 0.0002).bacterioplankton;

    expect(phytoDouble / phytoLow).toBeGreaterThan(1.99);
    expect(phytoDouble / phytoLow).toBeLessThan(2.01);
    expect(bacteriaDouble / bacteriaLow).toBeGreaterThan(1.99);
    expect(bacteriaDouble / bacteriaLow).toBeLessThan(2.01);
  });

  it('records tracked Daphnia births in biomass, not mixed count units', () => {
    const ledger = makeLedger();
    const birthBiomass = PLANKTON_ECOLOGY_RULES.daphnia.juvenileBirthBiomass;

    ledger.recordDaphniaBirth(false, birthBiomass);
    ledger.recordDaphniaBirth(true, birthBiomass);

    const events = ledger.planktonState().cumulativeEvents;
    expect(events.births).toBeCloseTo(birthBiomass * 2, 12);
    expect(events.secondGenerationBirths).toBeCloseTo(birthBiomass, 12);
  });

  it('allows suspended decomposers to react to dissolved organic matter', () => {
    const ledger = makeLedger();
    ledger.addPlanktonicDecomposer(centre, 1.2);
    const initial = ledger.planktonState();

    advance(ledger, 300);

    const current = ledger.planktonState();
    expect(current.planktonicDecomposerBiomass)
      .toBeGreaterThan(initial.planktonicDecomposerBiomass);
    expect(ledger.materialState().organicMatter).toBeLessThan(6);
  });

  it('treats suspended bacteria as supplementary, not complete, Daphnia food', () => {
    const ledger = makeLedger();
    ledger.addPlanktonicDecomposer(centre, 2.4);
    ledger.addPlankton(centre, 'daphnia', 0.72);

    advance(ledger, 600);

    const plankton = ledger.planktonState();
    expect(plankton.cumulativeFiltration.planktonicDecomposer).toBeGreaterThan(0);
    expect(plankton.cumulativeEvents.secondGenerationBirths).toBeLessThan(0.001);
  });

  it('cycles producer and suspended decomposer mass without leaking material', () => {
    const ledger = makeLedger();
    ledger.addPlankton(centre, 'phytoplankton', 2.2);
    ledger.addPlanktonicDecomposer(centre, 1.2);
    const initial = materialTotals(ledger);

    advance(ledger, 1_800);

    const plankton = ledger.planktonState();
    const current = materialTotals(ledger);
    expect(plankton.phytoplanktonBiomass).toBeGreaterThan(0.5);
    expect(plankton.planktonicDecomposerBiomass).toBeGreaterThan(0.05);
    expect(Math.abs((current.nitrogen - initial.nitrogen) / initial.nitrogen))
      .toBeLessThan(CLOSED_MATERIAL_RELATIVE_TOLERANCE);
    expect(Math.abs((current.carbon - initial.carbon) / initial.carbon))
      .toBeLessThan(CLOSED_MATERIAL_RELATIVE_TOLERANCE);
    expect(Math.abs(
      (current.oxygenEquivalent - initial.oxygenEquivalent) /
      initial.oxygenEquivalent,
    )).toBeLessThan(CLOSED_MATERIAL_RELATIVE_TOLERANCE);
  }, 15_000);

  it('returns sub-resolution suspended biomass to detritus instead of freezing it', () => {
    const ledger = makeLedger();
    const fields = ledger as unknown as {
      phytoplankton: Float64Array;
      planktonicDecomposer: Float64Array;
      detritus: Float64Array;
    };
    const traceMass = 5e-13;
    fields.phytoplankton[0] = traceMass * fields.phytoplankton.length;
    fields.planktonicDecomposer[0] =
      traceMass * fields.planktonicDecomposer.length;
    const materialBefore = materialTotals(ledger);

    ledger.beginStep(1);
    ledger.advanceTemperature(1, 22);
    ledger.advance(1, []);

    const materialAfter = materialTotals(ledger);
    expect(fields.phytoplankton[0]).toBe(0);
    expect(fields.planktonicDecomposer[0]).toBe(0);
    expect(fields.detritus[0]).toBeCloseTo(traceMass * 2, 18);
    expect(Math.abs(
      (materialAfter.nitrogen - materialBefore.nitrogen) /
      materialBefore.nitrogen,
    )).toBeLessThan(CLOSED_MATERIAL_RELATIVE_TOLERANCE);
    expect(Math.abs(
      (materialAfter.carbon - materialBefore.carbon) /
      materialBefore.carbon,
    )).toBeLessThan(CLOSED_MATERIAL_RELATIVE_TOLERANCE);
    expect(Math.abs(
      (materialAfter.oxygenEquivalent - materialBefore.oxygenEquivalent) /
      materialBefore.oxygenEquivalent,
    )).toBeLessThan(CLOSED_MATERIAL_RELATIVE_TOLERANCE);
  });

});
