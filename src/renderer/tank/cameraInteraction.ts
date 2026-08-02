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
  createTankVisualGeometry,
  type TankVisualGeometry,
} from './tankVisualGeometry';

const DEFAULT_GEOMETRY = createTankVisualGeometry();

export const TANK_INTERACTION_LEFT = TANK_GLASS_LEFT + TANK_FRAME_STROKE_WIDTH / 2;
export const TANK_INTERACTION_RIGHT = TANK_GLASS_RIGHT - TANK_FRAME_STROKE_WIDTH / 2;

// A game camera should cover its viewport. Using `min` here would letterbox the
// 5:3 aquarium and leave the page background visible around a magnified scene.
export const coverTankScale = (
  viewportWidth: number,
  viewportHeight: number,
  geometry: TankVisualGeometry = DEFAULT_GEOMETRY,
): number =>
  Math.max(viewportWidth / geometry.sceneWidth, viewportHeight / geometry.sceneHeight);

export const containTankScale = (
  viewportWidth: number,
  viewportHeight: number,
  geometry: TankVisualGeometry = DEFAULT_GEOMETRY,
): number =>
  Math.min(viewportWidth / geometry.sceneWidth, viewportHeight / geometry.sceneHeight);

// Camera percentages are expressed relative to the full-bleed cover view.
// This dynamic lower bound is the one zoom at which all four tank edges fit.
export const fitTankZoom = (
  viewportWidth: number,
  viewportHeight: number,
  geometry: TankVisualGeometry = DEFAULT_GEOMETRY,
): number => {
  const coverScale = coverTankScale(viewportWidth, viewportHeight, geometry);
  const containScale = containTankScale(viewportWidth, viewportHeight, geometry);
  if (!Number.isFinite(coverScale) || !Number.isFinite(containScale) ||
    coverScale <= 0 || containScale <= 0) return 1;
  return Math.min(1, containScale / coverScale);
};

/**
 * The fit view shows every tank edge, but floating notes still cover part of
 * that image. Manual zoom-out therefore gets a second, lower bound so the
 * player can leave a readable gutter for observation/inventory panels.
 */
export const minimumTankZoom = (
  viewportWidth: number,
  viewportHeight: number,
  geometry: TankVisualGeometry = DEFAULT_GEOMETRY,
): number => {
  const fit = fitTankZoom(viewportWidth, viewportHeight, geometry);
  return Math.min(fit, Math.max(0.5, fit * 0.72));
};

const WHEEL_LINE_HEIGHT_PIXELS = 16;
const WHEEL_MAX_PIXELS_PER_EVENT = 100;
const WHEEL_ZOOM_SENSITIVITY = 0.0012;

/**
 * Chromium can report a single physical wheel gesture as pixels, lines, or a
 * whole page. Feeding a page-sized delta directly into an exponential zoom
 * made one notch jump from an overview to almost maximum zoom. Convert the
 * three delta modes to pixels and cap only the per-event impulse; a trackpad's
 * sequence of small events remains smooth.
 */
export const wheelZoomTarget = (
  currentZoom: number,
  deltaY: number,
  deltaMode: number,
  viewportHeight: number,
): number => {
  const pixelDelta = deltaMode === 1
    ? deltaY * WHEEL_LINE_HEIGHT_PIXELS
    : deltaMode === 2
      ? deltaY * Math.max(1, viewportHeight)
      : deltaY;
  const boundedDelta = Math.max(
    -WHEEL_MAX_PIXELS_PER_EVENT,
    Math.min(WHEEL_MAX_PIXELS_PER_EVENT, pixelDelta),
  );
  return currentZoom * Math.exp(-boundedDelta * WHEEL_ZOOM_SENSITIVITY);
};

export interface StoredCameraTransform {
  zoom: number;
  scale: number;
  offsetX: number;
  offsetY: number;
  viewportWidth: number;
  viewportHeight: number;
}

export interface RestoredCameraState {
  zoom: number;
  centerX: number;
  centerY: number;
}

/** A newly opened mission shows the complete tank inside the viewport. */
export const freshTankCameraState = (
  viewportWidth: number,
  viewportHeight: number,
  geometry: TankVisualGeometry = DEFAULT_GEOMETRY,
): RestoredCameraState => ({
  zoom: fitTankZoom(viewportWidth, viewportHeight, geometry),
  centerX: geometry.sceneCenterX,
  centerY: geometry.sceneCenterY,
});

export const cameraStateFromStoredTransform = (
  transform: StoredCameraTransform | null | undefined,
): RestoredCameraState | null => {
  if (
    !transform ||
    !Number.isFinite(transform.zoom) ||
    !Number.isFinite(transform.scale) ||
    !Number.isFinite(transform.offsetX) ||
    !Number.isFinite(transform.offsetY) ||
    !Number.isFinite(transform.viewportWidth) ||
    !Number.isFinite(transform.viewportHeight) ||
    transform.zoom <= 0 ||
    transform.scale <= 0 ||
    transform.viewportWidth <= 0 ||
    transform.viewportHeight <= 0
  ) return null;

  return {
    zoom: transform.zoom,
    centerX:
      (transform.viewportWidth / 2 - transform.offsetX) / transform.scale,
    centerY:
      (transform.viewportHeight / 2 - transform.offsetY) / transform.scale,
  };
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
  geometry: TankVisualGeometry = DEFAULT_GEOMETRY,
): TankCameraCenterBounds => {
  const scale = coverTankScale(viewportWidth, viewportHeight, geometry) * zoom;
  if (!Number.isFinite(scale) || scale <= 0) {
    const centerX = geometry.sceneCenterX;
    const centerY = geometry.sceneCenterY;
    return { minX: centerX, maxX: centerX, minY: centerY, maxY: centerY };
  }
  const visibleWidth = viewportWidth / scale;
  const visibleHeight = viewportHeight / scale;
  const halfWidth = visibleWidth / 2;
  const halfHeight = visibleHeight / 2;
  const sceneCenterX = geometry.sceneCenterX;
  const sceneCenterY = geometry.sceneCenterY;
  const baseMinX = halfWidth >= geometry.sceneWidth / 2
    ? sceneCenterX
    : geometry.sceneLeft + halfWidth;
  const baseMaxX = halfWidth >= geometry.sceneWidth / 2
    ? sceneCenterX
    : geometry.sceneRight - halfWidth;
  const baseMinY = halfHeight >= geometry.sceneHeight / 2
    ? sceneCenterY
    : geometry.sceneTop + halfHeight;
  const baseMaxY = halfHeight >= geometry.sceneHeight / 2
    ? sceneCenterY
    : geometry.sceneBottom - halfHeight;
  const overscrollX = Math.min(geometry.sceneWidth * 0.36, visibleWidth * 0.36);
  const overscrollY = Math.min(geometry.sceneHeight * 0.32, visibleHeight * 0.32);
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
  geometry: TankVisualGeometry = DEFAULT_GEOMETRY,
): boolean => {
  const bounds = tankCameraCenterBounds(viewportWidth, viewportHeight, zoom, geometry);
  return bounds.maxX - bounds.minX > 0.5 || bounds.maxY - bounds.minY > 0.5;
};

export const shouldStartCameraPan = (
  button: number,
  persistentPanMode: boolean,
  canPan: boolean,
): boolean => canPan && (button === 1 || (button === 0 && persistentPanMode));

export const isTankInteractionPoint = (
  point: Vec2,
  geometry: TankVisualGeometry = DEFAULT_GEOMETRY,
): boolean =>
  point.x >= geometry.glassLeft + TANK_FRAME_STROKE_WIDTH / 2 &&
  point.x <= geometry.glassRight - TANK_FRAME_STROKE_WIDTH / 2 &&
  point.y >= geometry.waterTop && point.y <= geometry.groundY;

export const clampTankInteractionPoint = (
  point: Vec2,
  geometry: TankVisualGeometry = DEFAULT_GEOMETRY,
): Vec2 => ({
  x: Math.max(
    geometry.glassLeft + TANK_FRAME_STROKE_WIDTH / 2,
    Math.min(geometry.glassRight - TANK_FRAME_STROKE_WIDTH / 2, point.x),
  ),
  y: Math.max(geometry.waterTop, Math.min(geometry.groundY, point.y)),
});

export const isScreenDrag = (
  start: Vec2,
  end: Vec2,
  thresholdPixels = 8,
): boolean => Math.hypot(end.x - start.x, end.y - start.y) >= thresholdPixels;
