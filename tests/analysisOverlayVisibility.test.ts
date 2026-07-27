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
});
