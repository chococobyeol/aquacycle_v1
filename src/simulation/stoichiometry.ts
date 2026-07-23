import { WATER_CYCLE_RULES } from './config';

// A closed material ledger should drift only at floating-point rounding scale.
// This one-part-in-ten-billion release limit leaves several orders of
// cross-platform margin above the current ~1e-14 results while still catching
// any ecologically meaningful leak immediately.
export const CLOSED_MATERIAL_RELATIVE_TOLERANCE = 1e-10;

export interface NitrifierStoichiometry {
  processedNitrogen: number;
  retainedNitrogen: number;
  nitrateProduced: number;
  growthBiomass: number;
  fixedCarbon: number;
  oxygenDemand: number;
}

export interface OxygenEquivalentInventory {
  totalOxygen: number;
  organicCarbon: number;
  nitrateNitrogen: number;
}

const nonNegative = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, value) : 0;

/**
 * Oxygen released by oxygenic producer growth.
 *
 * Carbon fixation and nitrate reduction are two electron sinks. Ammonium is
 * already at the organic-nitrogen oxidation state, so only nitrate-derived
 * nitrogen receives the additional nitrogen redox credit.
 */
export const producerOxygenProduction = (
  fixedCarbon: number,
  nitrateNitrogen: number,
): number =>
  nonNegative(fixedCarbon) * WATER_CYCLE_RULES.oxygenPerOrganicCarbon +
  nonNegative(nitrateNitrogen) * WATER_CYCLE_RULES.oxygenPerNitrifiedNitrogen;

/** Oxygen consumed only when organic carbon is actually mineralised. */
export const organicCarbonOxygenDemand = (mineralizedCarbon: number): number =>
  nonNegative(mineralizedCarbon) * WATER_CYCLE_RULES.oxygenPerOrganicCarbon;

/**
 * Balances autotrophic nitrifier growth, nitrate production and oxygen.
 *
 * Processed ammonium retained in new film is not nitrate. Fixed microbial
 * carbon stores reducing equivalents supplied by ammonium oxidation, so its
 * carbon oxygen-equivalent is subtracted from the gross nitrification demand.
 */
export const nitrifierStoichiometry = (
  processedNitrogen: number,
  requestedGrowthBiomass: number,
): NitrifierStoichiometry => {
  const processed = nonNegative(processedNitrogen);
  const maximumGrowth = processed / WATER_CYCLE_RULES.biomassNitrogen;
  const growthBiomass = Math.min(
    nonNegative(requestedGrowthBiomass),
    maximumGrowth,
  );
  const retainedNitrogen = growthBiomass * WATER_CYCLE_RULES.biomassNitrogen;
  const nitrateProduced = Math.max(0, processed - retainedNitrogen);
  const fixedCarbon = growthBiomass * WATER_CYCLE_RULES.biomassCarbon;
  const grossNitrificationDemand =
    nitrateProduced * WATER_CYCLE_RULES.oxygenPerNitrifiedNitrogen;
  const carbonReductionCredit =
    fixedCarbon * WATER_CYCLE_RULES.oxygenPerOrganicCarbon;

  return {
    processedNitrogen: processed,
    retainedNitrogen,
    nitrateProduced,
    growthBiomass,
    fixedCarbon,
    oxygenDemand: Math.max(0, grossNitrificationDemand - carbonReductionCredit),
  };
};

/**
 * Conserved redox inventory for the compressed closed-water model.
 *
 * E = O2 - qC*Corganic + qN*Nnitrate
 *
 * Headspace and dissolved oxygen must both be included. Carbon fixation,
 * aerobic mineralisation, nitrification and nitrate assimilation each leave
 * this value unchanged when their reaction columns are balanced.
 */
export const oxygenEquivalentInventory = ({
  totalOxygen,
  organicCarbon,
  nitrateNitrogen,
}: OxygenEquivalentInventory): number =>
  totalOxygen -
  WATER_CYCLE_RULES.oxygenPerOrganicCarbon * organicCarbon +
  WATER_CYCLE_RULES.oxygenPerNitrifiedNitrogen * nitrateNitrogen;
