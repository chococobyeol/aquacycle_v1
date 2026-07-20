import { describe, expect, it } from 'vitest';
import { GROUND_Y, TANK_HEIGHT, TANK_WIDTH } from '../src/simulation/types';
import {
  CAMERA_SCENE_HEIGHT,
  CAMERA_SCENE_WIDTH,
  TANK_VISUAL_WATER_TOP,
} from '../src/renderer/tank/tankVisualGeometry';
import {
  canPanTankCamera,
  clampTankInteractionPoint,
  containTankScale,
  coverTankScale,
  fitTankZoom,
  isScreenDrag,
  isTankInteractionPoint,
  shouldStartCameraPan,
  TANK_INTERACTION_LEFT,
  TANK_INTERACTION_RIGHT,
} from '../src/renderer/tank/cameraInteraction';

describe('aquarium camera interactions', () => {
  it('uses a cover scale so the aquarium always fills a wide or tall viewport', () => {
    const wideScale = coverTankScale(1600, 720);
    expect(CAMERA_SCENE_WIDTH * wideScale).toBeGreaterThanOrEqual(1600);
    expect(CAMERA_SCENE_HEIGHT * wideScale).toBeGreaterThanOrEqual(720);

    const tallScale = coverTankScale(1200, 900);
    expect(CAMERA_SCENE_WIDTH * tallScale).toBeGreaterThanOrEqual(1200);
    expect(CAMERA_SCENE_HEIGHT * tallScale).toBeGreaterThanOrEqual(900);
    expect(canPanTankCamera(1600, 720, 1)).toBe(true);
    expect(canPanTankCamera(CAMERA_SCENE_WIDTH, CAMERA_SCENE_HEIGHT, 1)).toBe(false);
  });

  it('uses a dynamic fit zoom that reveals all four tank edges', () => {
    const cases = [
      { width: 1920, height: 1080 },
      { width: 1200, height: 900 },
      { width: 1600, height: 720 },
    ];

    for (const viewport of cases) {
      const fitZoom = fitTankZoom(viewport.width, viewport.height);
      const fittedScale = coverTankScale(viewport.width, viewport.height) * fitZoom;
      expect(fitZoom).toBeGreaterThan(0);
      expect(fitZoom).toBeLessThanOrEqual(1);
      expect(CAMERA_SCENE_WIDTH * fittedScale).toBeLessThanOrEqual(viewport.width + 0.001);
      expect(CAMERA_SCENE_HEIGHT * fittedScale).toBeLessThanOrEqual(viewport.height + 0.001);
      expect(fittedScale).toBeCloseTo(containTankScale(viewport.width, viewport.height));
      expect(canPanTankCamera(viewport.width, viewport.height, fitZoom)).toBe(false);
    }

    expect(fitTankZoom(1920, 1080)).toBeCloseTo((1080 / CAMERA_SCENE_HEIGHT) / (1920 / CAMERA_SCENE_WIDTH));
    expect(fitTankZoom(CAMERA_SCENE_WIDTH, CAMERA_SCENE_HEIGHT)).toBe(1);
  });

  it('guards invalid viewport sizes when deriving the fit zoom', () => {
    expect(fitTankZoom(0, 0)).toBe(1);
    expect(fitTankZoom(Number.NaN, 720)).toBe(1);
  });

  it('does not turn clicks outside the water and substrate area into edge clicks', () => {
    expect(isTankInteractionPoint({ x: 200, y: TANK_VISUAL_WATER_TOP - 1 })).toBe(false);
    expect(isTankInteractionPoint({ x: TANK_INTERACTION_LEFT - 1, y: 200 })).toBe(false);
    expect(isTankInteractionPoint({ x: TANK_INTERACTION_RIGHT + 1, y: 200 })).toBe(false);
    expect(isTankInteractionPoint({ x: 200, y: GROUND_Y + 1 })).toBe(false);
    expect(isTankInteractionPoint({ x: 200, y: TANK_VISUAL_WATER_TOP })).toBe(true);
    expect(isTankInteractionPoint({ x: TANK_INTERACTION_LEFT, y: 200 })).toBe(true);
    expect(isTankInteractionPoint({ x: TANK_INTERACTION_RIGHT, y: 200 })).toBe(true);
  });

  it('clamps only an active drag endpoint back into the selectable tank area', () => {
    expect(clampTankInteractionPoint({ x: -20, y: GROUND_Y + 40 })).toEqual({
      x: TANK_INTERACTION_LEFT,
      y: GROUND_Y,
    });
    expect(clampTankInteractionPoint({ x: TANK_WIDTH + 20, y: 200 })).toEqual({
      x: TANK_INTERACTION_RIGHT,
      y: 200,
    });
    expect(clampTankInteractionPoint({ x: 200, y: 0 })).toEqual({
      x: 200,
      y: TANK_VISUAL_WATER_TOP,
    });
  });

  it('uses a screen-pixel drag threshold independent of camera zoom', () => {
    expect(isScreenDrag({ x: 100, y: 100 }, { x: 107, y: 100 })).toBe(false);
    expect(isScreenDrag({ x: 100, y: 100 }, { x: 108, y: 100 })).toBe(true);
  });

  it('reserves middle drag for temporary camera panning without enabling pan mode', () => {
    expect(shouldStartCameraPan(1, false, true)).toBe(true);
    expect(shouldStartCameraPan(0, true, true)).toBe(true);
    expect(shouldStartCameraPan(0, false, true)).toBe(false);
    expect(shouldStartCameraPan(1, false, false)).toBe(false);
    expect(shouldStartCameraPan(2, true, true)).toBe(false);
  });
});
