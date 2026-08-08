import { describe, expect, it } from 'vitest';
import {
  attachedAlgaeEffectiveLight,
  growthTrend,
  habitatSuitability,
  netGrowthPotential,
  producerNaturalTurnoverRateScale,
  producerProcessRateScale,
  resolvedSurfaceFilmBiomass,
  stepLocalGrowth,
} from '../src/simulation/growth';

describe('species light response', () => {
  it('gives the producer species different useful light niches', () => {
    expect(netGrowthPotential('oedogonium', 68)).toBeGreaterThan(netGrowthPotential('oedogonium', 25));
    expect(netGrowthPotential('nitzschia', 25)).toBeGreaterThan(netGrowthPotential('nitzschia', 82));
    expect(growthTrend('oedogonium', 68)).toBe('growing');
    expect(growthTrend('oedogonium', 10)).toBe('declining');
    expect(growthTrend('nitzschia', 25)).toBe('growing');
  });

  it('creates a diatom understory niche only beneath a dense filamentous film', () => {
    expect(attachedAlgaeEffectiveLight('nitzschia', 100, 0)).toBe(100);
    expect(attachedAlgaeEffectiveLight('nitzschia', 100, 0.2)).toBeGreaterThan(38);
    expect(attachedAlgaeEffectiveLight('nitzschia', 100, 0.2)).toBeLessThan(50);
    expect(attachedAlgaeEffectiveLight('nitzschia', 100, 0.5)).toBeLessThan(20);
    expect(attachedAlgaeEffectiveLight('nitzschia', 100, 1)).toBeLessThan(3);
    expect(attachedAlgaeEffectiveLight('oedogonium', 100, 1)).toBe(100);
  });

  it('keeps routine tissue turnover on each producer physiology clock', () => {
    expect(producerProcessRateScale('vallisneria'))
      .toBeGreaterThan(producerProcessRateScale('oedogonium'));
    expect(producerNaturalTurnoverRateScale('vallisneria'))
      .toBe(producerProcessRateScale('vallisneria'));
    expect(producerNaturalTurnoverRateScale('oedogonium'))
      .toBe(producerProcessRateScale('oedogonium'));
  });

  it('keeps Vallisneria low-light tolerant and saturating at bright light', () => {
    expect(netGrowthPotential('vallisneria', 0)).toBeLessThan(0);
    // This submerged macrophyte can just cover respiration under weak light;
    // darkness, not an arbitrary low-light cutoff, remains a real loss.
    expect(netGrowthPotential('vallisneria', 6)).toBeGreaterThan(0);
    expect(netGrowthPotential('vallisneria', 24)).toBeGreaterThan(0);
    expect(netGrowthPotential('vallisneria', 78))
      .toBeGreaterThanOrEqual(netGrowthPotential('vallisneria', 100));
  });

  it('uses the same potential to grow or visibly decline', () => {
    const growing = stepLocalGrowth({
      speciesId: 'oedogonium',
      current: 0.4,
      totalBiomass: 0.4,
      light: 68,
      deltaSeconds: 2,
    });
    const declining = stepLocalGrowth({
      speciesId: 'oedogonium',
      current: 0.4,
      totalBiomass: 0.4,
      light: 8,
      deltaSeconds: 2,
    });
    expect(growing).toBeGreaterThan(0.4);
    expect(declining).toBeLessThan(0.4);
    expect(habitatSuitability('oedogonium', 8)).toBe(0);
  });

  it('never exceeds the shared local carrying capacity', () => {
    const capped = stepLocalGrowth({
      speciesId: 'nitzschia',
      current: 0.99,
      totalBiomass: 0.99,
      light: 38,
      deltaSeconds: 60,
    });
    expect(capped).toBeLessThanOrEqual(1);
  });

  it('lets a declining sub-propagule film go extinct without killing new growth', () => {
    expect(resolvedSurfaceFilmBiomass(0.00006, 0.00004)).toBe(0);
    expect(resolvedSurfaceFilmBiomass(0.00003, 0.00004)).toBe(0.00004);
    expect(resolvedSurfaceFilmBiomass(0.01, 0.009)).toBe(0.009);
  });
});
