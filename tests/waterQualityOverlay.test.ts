import { describe, expect, it } from 'vitest';
import type { SimulationSnapshot } from '../src/simulation/types';
import {
  analysisLayerStatistics,
  normalizeWaterQualityForDisplay,
  normalizeWaterQualityValue,
  waterQualityOverlayAlpha,
  waterQualityVisualRange,
} from '../src/renderer/tank/waterQualityOverlay';

const overlaySnapshot = {
  cells: [
    { biofilm: { decomposer: 0, nitrifier: 0.1 } },
    { biofilm: { decomposer: 0.18, nitrifier: 0.3 } },
  ],
  biogeochemistry: {
    water: {
      organicMatter: [1, 3, 8],
      toxicWaste: [0.2, 0.8, 2],
      nutrients: [20, 40, 60],
      oxygen: [30, 60, 90],
    },
  },
} as SimulationSnapshot;

describe('water-quality analysis overlay', () => {
  it('uses the lower ecological scale for organic matter and toxic waste', () => {
    expect(normalizeWaterQualityValue('organicMatter', 12)).toBeCloseTo(0.5);
    expect(normalizeWaterQualityValue('toxicWaste', 24)).toBe(1);
    expect(normalizeWaterQualityValue('oxygen', 50)).toBeCloseTo(0.5);
  });

  it('keeps even low dissolved values visibly overlaid in analysis mode', () => {
    expect(waterQualityOverlayAlpha('organicMatter', 1.5)).toBeGreaterThan(0.22);
    expect(waterQualityOverlayAlpha('toxicWaste', 0.8)).toBeGreaterThan(0.22);
    expect(waterQualityOverlayAlpha('oxygen', 76)).toBeGreaterThan(0.45);
  });

  it('uses the current cell range when a real spatial gradient exists', () => {
    const values = [76, 79, 88, 94];
    const range = waterQualityVisualRange('oxygen', values);
    expect(range.adaptive).toBe(true);
    expect(normalizeWaterQualityForDisplay('oxygen', 76, range)).toBe(0);
    expect(normalizeWaterQualityForDisplay('oxygen', 94, range)).toBe(1);
  });

  it('does not amplify tiny floating-point noise into a false hotspot', () => {
    const range = waterQualityVisualRange('toxicWaste', [1.5, 1.55, 1.58]);
    expect(range.adaptive).toBe(false);
    expect(normalizeWaterQualityForDisplay('toxicWaste', 1.5, range))
      .toBeCloseTo(normalizeWaterQualityValue('toxicWaste', 1.5));
  });

  it('reports local field ranges for the compact map legend', () => {
    expect(analysisLayerStatistics(overlaySnapshot, 'organicMatter')).toEqual({
      minimum: 1,
      average: 4,
      maximum: 8,
      total: 12,
      sampleCount: 3,
    });
  });

  it('reports surface film cover as percentages', () => {
    const stats = analysisLayerStatistics(overlaySnapshot, 'decomposer');
    expect(stats.minimum).toBe(0);
    expect(stats.average).toBeCloseTo(9);
    expect(stats.maximum).toBeCloseTo(18);
  });
});
