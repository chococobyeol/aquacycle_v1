import { describe, expect, it } from 'vitest';
import type { SimulationSnapshot } from '../src/simulation/types';
import {
  analysisLayerStatistics,
  biofilmPlacementLayers,
  normalizePelagicForDisplay,
  normalizeWaterQualityForDisplay,
  normalizeWaterQualityValue,
  pelagicOverlayAlpha,
  pelagicRenderPlan,
  pelagicVisualMaximum,
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
      planktonicDecomposer: [0.2, 1.5, 3.2],
      phytoplankton: [0.4, 2.5, 9],
    },
    transport: {
      temperature: [22, 23, 25],
      velocityX: [0, 0.3, 0],
      velocityY: [0.4, 0.4, 0],
    },
  },
} as SimulationSnapshot;

describe('water-quality analysis overlay', () => {
  it('pairs each inoculum with its food field and its own film', () => {
    expect(biofilmPlacementLayers('decomposer')).toEqual(['organicMatter', 'decomposer']);
    expect(biofilmPlacementLayers('nitrifier')).toEqual(['toxicWaste', 'nitrifier']);
  });

  it('keeps activation order and assigns only one continuous pelagic map', () => {
    expect(pelagicRenderPlan([
      'decomposer',
      'phytoplankton',
      'planktonicDecomposer',
      'oxygen',
      'flow',
    ])).toEqual({
      primary: 'phytoplankton',
      secondary: ['planktonicDecomposer'],
    });
    expect(pelagicRenderPlan([
      'planktonicDecomposer',
      'phytoplankton',
      'planktonicDecomposer',
    ])).toEqual({
      primary: 'planktonicDecomposer',
      secondary: ['phytoplankton'],
    });
  });

  it('uses a fixed pelagic scale so a real biomass decrease stays visible', () => {
    const emptyishMaximum = pelagicVisualMaximum('phytoplankton', [0, 0.05, 0.2]);
    expect(emptyishMaximum).toBe(12);
    expect(normalizePelagicForDisplay(0.2, emptyishMaximum)).toBeLessThan(0.02);
    const bloomMaximum = pelagicVisualMaximum('phytoplankton', [0, 4, 20]);
    expect(bloomMaximum).toBe(12);
    expect(normalizePelagicForDisplay(20, bloomMaximum)).toBe(1);
    expect(normalizePelagicForDisplay(2, bloomMaximum))
      .toBeCloseTo(normalizePelagicForDisplay(4, bloomMaximum) / 2);
    expect(pelagicOverlayAlpha(0)).toBe(0);
    expect(pelagicOverlayAlpha(0.2)).toBeLessThan(pelagicOverlayAlpha(0.8));
  });

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

  it('reports pelagic layers from their own water-column grids', () => {
    expect(analysisLayerStatistics(overlaySnapshot, 'phytoplankton').average)
      .toBeCloseTo((0.4 + 2.5 + 9) / 3);
    expect(analysisLayerStatistics(overlaySnapshot, 'planktonicDecomposer').maximum)
      .toBeCloseTo(3.2);
  });

  it('reports spatial temperature and water speed for the same legend', () => {
    expect(analysisLayerStatistics(overlaySnapshot, 'temperature').average)
      .toBeCloseTo(70 / 3);
    const flow = analysisLayerStatistics(overlaySnapshot, 'flow');
    expect(flow.minimum).toBe(0);
    expect(flow.maximum).toBeCloseTo(0.5);
  });
});
