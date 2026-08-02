import { describe, expect, it } from 'vitest';
import { GROUND_Y, TANK_HEIGHT, TANK_WIDTH } from '../src/simulation/types';
import {
  CAMERA_SCENE_CENTER_X,
  CAMERA_SCENE_CENTER_Y,
  CAMERA_SCENE_HEIGHT,
  CAMERA_SCENE_WIDTH,
  TANK_VISUAL_WATER_TOP,
} from '../src/renderer/tank/tankVisualGeometry';
import {
  canPanTankCamera,
  cameraStateFromStoredTransform,
  clampTankInteractionPoint,
  containTankScale,
  coverTankScale,
  fitTankZoom,
  freshTankCameraState,
  minimumTankZoom,
  isScreenDrag,
  isTankInteractionPoint,
  shouldStartCameraPan,
  tankCameraCenterBounds,
  TANK_INTERACTION_LEFT,
  TANK_INTERACTION_RIGHT,
  wheelZoomTarget,
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
    expect(canPanTankCamera(CAMERA_SCENE_WIDTH, CAMERA_SCENE_HEIGHT, 1)).toBe(true);
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
      // Even the fit view can be shifted away from floating HUD panels.
      expect(canPanTankCamera(viewport.width, viewport.height, fitZoom)).toBe(true);
    }

    expect(fitTankZoom(1920, 1080)).toBeCloseTo((1080 / CAMERA_SCENE_HEIGHT) / (1920 / CAMERA_SCENE_WIDTH));
    expect(fitTankZoom(CAMERA_SCENE_WIDTH, CAMERA_SCENE_HEIGHT)).toBe(1);
  });

  it('opens a fresh mission with the complete tank fitted to the viewport', () => {
    const width = 1920;
    const height = 1080;
    const camera = freshTankCameraState(width, height);

    expect(camera.zoom).toBe(fitTankZoom(width, height));
    expect(camera.zoom).toBeLessThan(1);
    expect(camera.centerX).toBe(CAMERA_SCENE_CENTER_X);
    expect(camera.centerY).toBe(CAMERA_SCENE_CENTER_Y);
  });

  it('guards invalid viewport sizes when deriving the fit zoom', () => {
    expect(fitTankZoom(0, 0)).toBe(1);
    expect(fitTankZoom(Number.NaN, 720)).toBe(1);
  });

  it('allows a smaller panel-safe overview below the full-tank fit view', () => {
    const fit = fitTankZoom(1920, 1080);
    const minimum = minimumTankZoom(1920, 1080);
    expect(minimum).toBeLessThan(fit);
    expect(minimum).toBeCloseTo(fit * 0.72);
    expect(minimum).toBeGreaterThanOrEqual(0.5);
  });

  it('allows controlled overscroll at fit zoom so every tank edge can clear a HUD panel', () => {
    const width = 1600;
    const height = 900;
    const zoom = fitTankZoom(width, height);
    const bounds = tankCameraCenterBounds(width, height, zoom);

    expect(bounds.minX).toBeLessThan(CAMERA_SCENE_CENTER_X);
    expect(bounds.maxX).toBeGreaterThan(CAMERA_SCENE_CENTER_X);
    expect(bounds.minY).toBeLessThan(CAMERA_SCENE_CENTER_Y);
    expect(bounds.maxY).toBeGreaterThan(CAMERA_SCENE_CENTER_Y);
    // The permitted horizontal shift is large enough to clear a typical
    // right-side observation panel, but remains bounded.
    expect(bounds.maxX - CAMERA_SCENE_CENTER_X).toBeGreaterThan(350);
    expect(bounds.maxX - CAMERA_SCENE_CENTER_X).toBeLessThan(500);
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

  it('keeps one wheel event from jumping across most of the zoom range', () => {
    expect(wheelZoomTarget(0.87, -800, 0, 720)).toBeCloseTo(
      0.87 * Math.exp(0.12),
    );
    expect(wheelZoomTarget(1, 3, 1, 720)).toBeCloseTo(
      Math.exp(-48 * 0.0012),
    );
    expect(wheelZoomTarget(1, -1, 2, 720)).toBeCloseTo(
      Math.exp(0.12),
    );
  });

  it('restores the exact zoom and world center from a staged renderer transform', () => {
    const restored = cameraStateFromStoredTransform({
      zoom: 1.75,
      scale: 2.4,
      offsetX: -820,
      offsetY: -390,
      viewportWidth: 1200,
      viewportHeight: 720,
    });

    expect(restored).toEqual({
      zoom: 1.75,
      centerX: (600 + 820) / 2.4,
      centerY: (360 + 390) / 2.4,
    });
    expect(cameraStateFromStoredTransform({
      zoom: 1,
      scale: 0,
      offsetX: 0,
      offsetY: 0,
      viewportWidth: 1200,
      viewportHeight: 720,
    })).toBeNull();
  });
});
