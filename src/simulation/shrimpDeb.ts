export interface ShrimpDebProductionInput {
  reserveBiomass: number;
  reserveCapacity: number;
  maximumMobilization: number;
  somaticDemand: number;
  maturityOrReproductionDemand: number;
  kappaSomatic: number;
  reserveResponseExponent: number;
}

export interface ShrimpDebProductionAllocation {
  reserveDensity: number;
  mobilizedBiomass: number;
  somaticBiomass: number;
  maturityOrReproductionBiomass: number;
  reserveSpent: number;
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

/**
 * Allocate production from one conserved reserve after somatic maintenance.
 *
 * This is a deliberately small DEB core. Assimilation has already entered
 * `reserveBiomass`, and maintenance has already had first claim on it. The
 * remaining mobilizable reserve is split by one fixed kappa rule between the
 * soma and maturity/reproduction. A branch that has no current demand leaves
 * its unused matter in reserve; it is never copied into the other branch.
 */
export const allocateShrimpDebProduction = (
  input: ShrimpDebProductionInput,
): ShrimpDebProductionAllocation => {
  const reserve = Math.max(0, input.reserveBiomass);
  const reserveCapacity = Math.max(1e-12, input.reserveCapacity);
  const reserveDensity = clamp01(reserve / reserveCapacity);
  const kappa = clamp01(input.kappaSomatic);
  const densityResponse = Math.pow(
    reserveDensity,
    Math.max(0, input.reserveResponseExponent),
  );
  const mobilizedBiomass = Math.min(
    reserve,
    Math.max(0, input.maximumMobilization) * densityResponse,
  );
  const somaticBiomass = Math.min(
    Math.max(0, input.somaticDemand),
    mobilizedBiomass * kappa,
  );
  const maturityOrReproductionBiomass = Math.min(
    Math.max(0, input.maturityOrReproductionDemand),
    mobilizedBiomass * (1 - kappa),
  );
  const reserveSpent = Math.min(
    reserve,
    somaticBiomass + maturityOrReproductionBiomass,
  );
  return {
    reserveDensity,
    mobilizedBiomass,
    somaticBiomass,
    maturityOrReproductionBiomass,
    reserveSpent,
  };
};
