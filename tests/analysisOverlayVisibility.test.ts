import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { userAgent: 'vitest' },
  });
});

import type { Sprite } from 'pixi.js';
import {
  analysisOverlayKey,
  drawAnalysisOverlay,
} from '../src/renderer/tank/AquariumCanvas';
import type { SimulationSnapshot } from '../src/simulation/types';

describe('analysis overlay visibility', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses one stable key without reading ecology state while the map is hidden', () => {
    const unreadableSnapshot = new Proxy({}, {
      get: () => {
        throw new Error('hidden analysis must not inspect a snapshot');
      },
    }) as SimulationSnapshot;

    expect(analysisOverlayKey(unreadableSnapshot, [])).toBe('hidden');
  });

  it('invalidates selected overlays on each ecology revision', () => {
    const snapshot = {
      revision: 3,
      biogeochemistry: {
        biofilmTotals: { decomposer: 1.234, nitrifier: 2.345 },
        water: { revision: 7 },
        transport: { revision: 11 },
      },
    } as unknown as SimulationSnapshot;
    const baseline = analysisOverlayKey(snapshot, ['decomposer']);

    snapshot.revision += 1;

    expect(baseline).not.toBe('hidden');
    expect(analysisOverlayKey(snapshot, ['decomposer'])).not.toBe(baseline);
  });

  it('hides and returns before creating or updating a raster surface', () => {
    const layer = { visible: true } as Sprite;
    const unreadableSnapshot = new Proxy({}, {
      get: () => {
        throw new Error('hidden analysis must not inspect a snapshot');
      },
    }) as SimulationSnapshot;
    const createElement = vi.fn(() => {
      throw new Error('hidden analysis must not create a canvas');
    });
    vi.stubGlobal('document', { createElement });

    drawAnalysisOverlay(layer, unreadableSnapshot, []);

    expect(layer.visible).toBe(false);
    expect(createElement).not.toHaveBeenCalled();
  });

  it('uses a tiny stable texture and retained geometry without full-tank canvas generations', () => {
    const canvasSource = readFileSync(
      new URL('../src/renderer/tank/AquariumCanvas.tsx', import.meta.url),
      'utf8',
    );
    const analysisSurfaceBlock = canvasSource.slice(
      canvasSource.indexOf('interface AnalysisSurface'),
      canvasSource.indexOf('const rasterizeStructureTexture'),
    );
    const analysisDrawBlock = canvasSource.slice(
      canvasSource.indexOf('export const drawAnalysisOverlay'),
      canvasSource.indexOf('const polygonPoints'),
    );

    expect(analysisSurfaceBlock).toContain('new BufferImageSource');
    expect(analysisSurfaceBlock).toContain('new Uint8Array(columns * rows * 4)');
    expect(analysisSurfaceBlock).toContain('surface.details');
    expect(analysisSurfaceBlock).not.toContain("document.createElement('canvas')");
    expect(analysisDrawBlock).toContain('ensureAnalysisPrimary(surface');
    expect(analysisDrawBlock).toContain('surface.details.clear()');
    expect(analysisDrawBlock).not.toContain('getRasterSurface');
    expect(analysisDrawBlock).not.toContain('getImageData');
    expect(analysisDrawBlock).not.toContain('texture.source.update()');
  });
});
