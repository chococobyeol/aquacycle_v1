import { GROUND_Y, type Vec2 } from '../../simulation/types';
import {
  CAMERA_SCENE_BOTTOM,
  CAMERA_SCENE_HEIGHT,
  CAMERA_SCENE_LEFT,
  CAMERA_SCENE_RIGHT,
  CAMERA_SCENE_TOP,
  CAMERA_SCENE_WIDTH,
  TANK_FRAME_STROKE_WIDTH,
  TANK_GLASS_LEFT,
  TANK_GLASS_RIGHT,
  TANK_VISUAL_WATER_TOP,
} from './tankVisualGeometry';

export const TANK_INTERACTION_LEFT = TANK_GLASS_LEFT + TANK_FRAME_STROKE_WIDTH / 2;
export const TANK_INTERACTION_RIGHT = TANK_GLASS_RIGHT - TANK_FRAME_STROKE_WIDTH / 2;

// A game camera should cover its viewport. Using `min` here would letterbox the
// 5:3 aquarium and leave the page background visible around a magnified scene.
export const coverTankScale = (viewportWidth: number, viewportHeight: number): number =>
  Math.max(viewportWidth / CAMERA_SCENE_WIDTH, viewportHeight / CAMERA_SCENE_HEIGHT);

export const containTankScale = (viewportWidth: number, viewportHeight: number): number =>
  Math.min(viewportWidth / CAMERA_SCENE_WIDTH, viewportHeight / CAMERA_SCENE_HEIGHT);

// Camera percentages are expressed relative to the full-bleed cover view.
// This dynamic lower bound is the one zoom at which all four tank edges fit.
export const fitTankZoom = (viewportWidth: number, viewportHeight: number): number => {
  const coverScale = coverTankScale(viewportWidth, viewportHeight);
  const containScale = containTankScale(viewportWidth, viewportHeight);
  if (!Number.isFinite(coverScale) || !Number.isFinite(containScale) ||
    coverScale <= 0 || containScale <= 0) return 1;
  return Math.min(1, containScale / coverScale);
};

export interface TankCameraCenterBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * HUD panels float over the aquarium rather than resizing it. A controlled
 * overscroll therefore lets the player pull a covered tank edge into the
 * remaining clear viewport. At least roughly two thirds of the viewport stays
 * on the scene, so the aquarium cannot be lost entirely off-screen.
 */
export const tankCameraCenterBounds = (
  viewportWidth: number,
  viewportHeight: number,
  zoom: number,
): TankCameraCenterBounds => {
  const scale = coverTankScale(viewportWidth, viewportHeight) * zoom;
  if (!Number.isFinite(scale) || scale <= 0) {
    const centerX = (CAMERA_SCENE_LEFT + CAMERA_SCENE_RIGHT) / 2;
    const centerY = (CAMERA_SCENE_TOP + CAMERA_SCENE_BOTTOM) / 2;
    return { minX: centerX, maxX: centerX, minY: centerY, maxY: centerY };
  }
  const visibleWidth = viewportWidth / scale;
  const visibleHeight = viewportHeight / scale;
  const halfWidth = visibleWidth / 2;
  const halfHeight = visibleHeight / 2;
  const sceneCenterX = (CAMERA_SCENE_LEFT + CAMERA_SCENE_RIGHT) / 2;
  const sceneCenterY = (CAMERA_SCENE_TOP + CAMERA_SCENE_BOTTOM) / 2;
  const baseMinX = halfWidth >= CAMERA_SCENE_WIDTH / 2
    ? sceneCenterX
    : CAMERA_SCENE_LEFT + halfWidth;
  const baseMaxX = halfWidth >= CAMERA_SCENE_WIDTH / 2
    ? sceneCenterX
    : CAMERA_SCENE_RIGHT - halfWidth;
  const baseMinY = halfHeight >= CAMERA_SCENE_HEIGHT / 2
    ? sceneCenterY
    : CAMERA_SCENE_TOP + halfHeight;
  const baseMaxY = halfHeight >= CAMERA_SCENE_HEIGHT / 2
    ? sceneCenterY
    : CAMERA_SCENE_BOTTOM - halfHeight;
  const overscrollX = Math.min(CAMERA_SCENE_WIDTH * 0.36, visibleWidth * 0.36);
  const overscrollY = Math.min(CAMERA_SCENE_HEIGHT * 0.32, visibleHeight * 0.32);
  return {
    minX: baseMinX - overscrollX,
    maxX: baseMaxX + overscrollX,
    minY: baseMinY - overscrollY,
    maxY: baseMaxY + overscrollY,
  };
};

export const canPanTankCamera = (
  viewportWidth: number,
  viewportHeight: number,
  zoom: number,
): boolean => {
  const bounds = tankCameraCenterBounds(viewportWidth, viewportHeight, zoom);
  return bounds.maxX - bounds.minX > 0.5 || bounds.maxY - bounds.minY > 0.5;
};

export const shouldStartCameraPan = (
  button: number,
  persistentPanMode: boolean,
  canPan: boolean,
): boolean => canPan && (button === 1 || (button === 0 && persistentPanMode));

export const isTankInteractionPoint = (point: Vec2): boolean =>
  point.x >= TANK_INTERACTION_LEFT && point.x <= TANK_INTERACTION_RIGHT &&
  point.y >= TANK_VISUAL_WATER_TOP && point.y <= GROUND_Y;

export const clampTankInteractionPoint = (point: Vec2): Vec2 => ({
  x: Math.max(TANK_INTERACTION_LEFT, Math.min(TANK_INTERACTION_RIGHT, point.x)),
  y: Math.max(TANK_VISUAL_WATER_TOP, Math.min(GROUND_Y, point.y)),
});

export const isScreenDrag = (
  start: Vec2,
  end: Vec2,
  thresholdPixels = 8,
): boolean => Math.hypot(end.x - start.x, end.y - start.y) >= thresholdPixels;
