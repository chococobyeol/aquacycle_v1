import { describe, expect, it } from 'vitest';
import { allocateShrimpDebProduction } from '../src/simulation/shrimpDeb';

describe('shrimp simplified DEB allocation', () => {
  it('splits one mobilized reserve without creating or double-spending matter', () => {
    const allocation = allocateShrimpDebProduction({
      reserveBiomass: 0.06,
      reserveCapacity: 0.06,
      maximumMobilization: 0.01,
      somaticDemand: 0.02,
      maturityOrReproductionDemand: 0.02,
      kappaSomatic: 0.8,
      reserveResponseExponent: 1,
    });

    expect(allocation.somaticBiomass).toBeCloseTo(0.008, 12);
    expect(allocation.maturityOrReproductionBiomass).toBeCloseTo(0.002, 12);
    expect(allocation.reserveSpent).toBeCloseTo(0.01, 12);
    expect(
      allocation.somaticBiomass +
        allocation.maturityOrReproductionBiomass,
    ).toBeCloseTo(allocation.reserveSpent, 12);
  });

  it('slows production continuously as reserve density falls', () => {
    const full = allocateShrimpDebProduction({
      reserveBiomass: 0.06,
      reserveCapacity: 0.06,
      maximumMobilization: 0.01,
      somaticDemand: 1,
      maturityOrReproductionDemand: 1,
      kappaSomatic: 0.8,
      reserveResponseExponent: 1,
    });
    const quarter = allocateShrimpDebProduction({
      reserveBiomass: 0.015,
      reserveCapacity: 0.06,
      maximumMobilization: 0.01,
      somaticDemand: 1,
      maturityOrReproductionDemand: 1,
      kappaSomatic: 0.8,
      reserveResponseExponent: 1,
    });

    expect(quarter.reserveDensity).toBeCloseTo(0.25, 12);
    expect(quarter.reserveSpent).toBeCloseTo(full.reserveSpent * 0.25, 12);
  });

  it('does not redirect an unused branch into the other branch', () => {
    const allocation = allocateShrimpDebProduction({
      reserveBiomass: 0.06,
      reserveCapacity: 0.06,
      maximumMobilization: 0.01,
      somaticDemand: 0,
      maturityOrReproductionDemand: 1,
      kappaSomatic: 0.8,
      reserveResponseExponent: 1,
    });

    expect(allocation.somaticBiomass).toBe(0);
    expect(allocation.maturityOrReproductionBiomass).toBeCloseTo(0.002, 12);
    expect(allocation.reserveSpent).toBeCloseTo(0.002, 12);
  });
});
