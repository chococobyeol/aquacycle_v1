import { describe, expect, it } from 'vitest';
import { WATER_CYCLE_RULES } from '../src/simulation/config';
import {
  nitrifierStoichiometry,
  organicCarbonOxygenDemand,
  producerOxygenProduction,
} from '../src/simulation/stoichiometry';

const redoxDelta = (
  oxygenDelta: number,
  organicCarbonDelta: number,
  nitrateNitrogenDelta: number,
): number =>
  oxygenDelta -
  WATER_CYCLE_RULES.oxygenPerOrganicCarbon * organicCarbonDelta +
  WATER_CYCLE_RULES.oxygenPerNitrifiedNitrogen * nitrateNitrogenDelta;

describe('stoichiometric reaction columns', () => {
  it('closes carbon fixation from ammonium and nitrate on the same redox ledger', () => {
    const fixedCarbon = WATER_CYCLE_RULES.biomassCarbon;
    const nitrateNitrogen = WATER_CYCLE_RULES.biomassNitrogen * 0.65;
    const produced = producerOxygenProduction(fixedCarbon, nitrateNitrogen);

    expect(redoxDelta(produced, fixedCarbon, -nitrateNitrogen))
      .toBeCloseTo(0, 12);
  });

  it('makes aerobic mineralisation the exact reverse of carbon fixation', () => {
    const mineralizedCarbon = WATER_CYCLE_RULES.biomassCarbon * 0.58;
    const demand = organicCarbonOxygenDemand(mineralizedCarbon);

    expect(redoxDelta(-demand, -mineralizedCarbon, 0))
      .toBeCloseTo(0, 12);
  });

  it('charges nitrifiers only for oxidised nitrogen after retained biomass', () => {
    const reaction = nitrifierStoichiometry(0.08, 0.11);

    expect(reaction.retainedNitrogen + reaction.nitrateProduced)
      .toBeCloseTo(reaction.processedNitrogen, 12);
    expect(redoxDelta(
      -reaction.oxygenDemand,
      reaction.fixedCarbon,
      reaction.nitrateProduced,
    )).toBeCloseTo(0, 12);
  });

  it('returns a complete nitrate-assisted producer/mineraliser/nitrifier loop to zero', () => {
    const producerBiomass = 1;
    const carbon = producerBiomass * WATER_CYCLE_RULES.biomassCarbon;
    const nitrogen = producerBiomass * WATER_CYCLE_RULES.biomassNitrogen;
    const producerOxygen = producerOxygenProduction(carbon, nitrogen);
    const respirationDemand = organicCarbonOxygenDemand(carbon);
    const nitrification = nitrifierStoichiometry(nitrogen, 0);

    const fullLoopDelta =
      redoxDelta(producerOxygen, carbon, -nitrogen) +
      redoxDelta(-respirationDemand, -carbon, 0) +
      redoxDelta(
        -nitrification.oxygenDemand,
        0,
        nitrification.nitrateProduced,
      );
    expect(fullLoopDelta).toBeCloseTo(0, 12);
  });
});
