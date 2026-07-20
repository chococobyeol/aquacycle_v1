import { GROUND_Y, type Vec2 } from '../../simulation/types';
import {
  CAMERA_SCENE_HEIGHT,
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

export const canPanTankCamera = (
  viewportWidth: number,
  viewportHeight: number,
  zoom: number,
): boolean => {
  const scale = coverTankScale(viewportWidth, viewportHeight) * zoom;
  if (!Number.isFinite(scale) || scale <= 0) return false;
  return viewportWidth / scale < CAMERA_SCENE_WIDTH - 0.5 ||
    viewportHeight / scale < CAMERA_SCENE_HEIGHT - 0.5;
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
