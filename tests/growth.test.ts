import { describe, expect, it } from 'vitest';
import {
  growthTrend,
  habitatSuitability,
  netGrowthPotential,
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
});
