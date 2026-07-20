import 'pixi.js/unsafe-eval';
import {
  Application,
  Container,
  Graphics,
  GraphicsContext,
  Sprite,
  Texture,
  Ticker,
} from 'pixi.js';
import { useEffect, useRef, useState } from 'react';
import {
  ALGAE_VISIBLE_BIOMASS,
  SCENARIOS,
  SPECIES,
  STRUCTURES,
} from '../../simulation/config';
import type { SimulationMotionSource } from '../hooks/useSimulation';
import {
  GROUND_Y,
  TANK_HEIGHT,
  TANK_WIDTH,
  WATER_TOP,
  type AnimalCarcassSnapshot,
  type AnimalSnapshot,
  type InteractionTool,
  type SelectionFilter,
  type SimulationCommand,
  type SimulationSnapshot,
  type StructureSnapshot,
  type SurfaceCellSnapshot,
  type Vec2,
} from '../../simulation/types';
import {
  structureAuthoredPolygonToWorld,
  structureVisualOffset,
} from '../../simulation/structureGeometry';
import {
  canPanTankCamera,
  clampTankInteractionPoint,
  coverTankScale,
  fitTankZoom,
  isScreenDrag,
  isTankInteractionPoint,
  shouldStartCameraPan,
} from './cameraInteraction';
import {
  CAMERA_SCENE_BOTTOM,
  CAMERA_SCENE_CENTER_X,
  CAMERA_SCENE_CENTER_Y,
  CAMERA_SCENE_HEIGHT,
  CAMERA_SCENE_LEFT,
  CAMERA_SCENE_RIGHT,
  CAMERA_SCENE_TOP,
  CAMERA_SCENE_WIDTH,
  LAMP_CABLE_TOP,
  LAMP_FIXTURE_HEIGHT,
  LAMP_FIXTURE_LEFT,
  LAMP_FIXTURE_TOP,
  LAMP_FIXTURE_WIDTH,
  LAMP_GLOW_HEIGHT,
  LAMP_GLOW_LEFT,
  LAMP_GLOW_TOP,
  LAMP_GLOW_WIDTH,
  TANK_GLASS_BOTTOM,
  TANK_GLASS_LEFT,
  TANK_GLASS_RIGHT,
  TANK_GLASS_TOP,
  TANK_VISUAL_WATER_TOP,
} from './tankVisualGeometry';
import {
  interpolateMotionFrames,
  reconcileMotionWithSnapshot,
  reconcileStructureMotionWithSnapshot,
} from './motionInterpolation';

interface AquariumCanvasProps {
  snapshot: SimulationSnapshot;
  motionSource: SimulationMotionSource;
  activeTool: InteractionTool;
  selectionFilter: SelectionFilter;
  send: (command: SimulationCommand) => void;
  editable: boolean;
  hasPendingInventory: boolean;
  onConsumePendingInventory: (point: Vec2) => void;
  onPendingInventoryReady: () => void;
  onToolComplete: () => void;
  onCameraChange?: (transform: AquariumCameraTransform) => void;
  cameraResetToken?: number;
  showGoalGuide?: boolean;
}

export interface AquariumCameraTransform {
  zoom: number;
  scale: number;
  offsetX: number;
  offsetY: number;
  viewportWidth: number;
  viewportHeight: number;
}

interface CameraState {
  zoom: number;
  centerX: number;
  centerY: number;
}

const CAMERA_COVER_ZOOM = 1;
const CAMERA_MAX_ZOOM = 4;
const CAMERA_BUTTON_STEP = 1.28;
const CAMERA_EPSILON = 0.001;
const ALGAE_RASTER_FAST_REFRESH_MS = 250;
const ALGAE_RASTER_HIGH_SPEED_REFRESH_MS = 500;
const ALGAE_VISUAL_LEVEL_COUNT = 24;
export const ALGAE_PARTICLE_JITTER_SPAN = 0.35;
export const ALGAE_DENSITY_FIELD_SCALE = 1 / 3;

/**
 * Biomass is deliberately quantized before it reaches Pixi. Ecology snapshots
 * contain tiny floating-point changes on nearly every tick; most of those are
 * too small to alter a ten-pixel colony on screen. Keeping them in the same
 * visual bucket lets a settled tank reuse its existing density texture.
 */
export const algaeVisualLevel = (amount: number): number => {
  if (!Number.isFinite(amount) || amount <= ALGAE_VISIBLE_BIOMASS) return 0;
  const visible = Math.sqrt(Math.max(0, Math.min(1, amount)));
  return Math.max(1, Math.min(
    ALGAE_VISUAL_LEVEL_COUNT,
    Math.round(visible * ALGAE_VISUAL_LEVEL_COUNT),
  ));
};

export const algaeParticleRadiusRatio = (visualLevel: number): number => {
  const visible = Math.max(0, Math.min(1, visualLevel / ALGAE_VISUAL_LEVEL_COUNT));
  return 0.69 + visible * 0.46;
};

export const algaeParticleAlpha = (visualLevel: number): number => {
  const visible = Math.max(0, Math.min(1, visualLevel / ALGAE_VISUAL_LEVEL_COUNT));
  return 0.22 + visible * 0.78;
};

export const isInventoryHandoffCaughtUp = (
  holding: SimulationSnapshot['holding'],
  latestPointer: Vec2 | null,
  elapsedMs: number,
  hasSettledMotionPair = false,
  tolerance = 6,
): boolean => {
  if (!holding || holding.source !== 'inventory' || !latestPointer || elapsedMs < 48) return false;
  return Math.hypot(holding.x - latestPointer.x, holding.y - latestPointer.y) <= tolerance ||
    hasSettledMotionPair;
};

export const isSecondaryPointerGesture = (
  button: number,
  ctrlKey: boolean,
): boolean => button === 2 || (button === 0 && ctrlKey);

const algaeKeyNumber = (value: number): number => Math.round(value * 1000) / 1000;

export const algaeCellVisualKey = (cell: SurfaceCellSnapshot): string => [
  cell.id,
  cell.surfaceKind,
  algaeKeyNumber(cell.x),
  algaeKeyNumber(cell.y),
  algaeKeyNumber(cell.cellSize),
  algaeVisualLevel(cell.biomass.nitzschia),
  algaeVisualLevel(cell.biomass.oedogonium),
].join(':');

export const algaeRasterRefreshIntervalMs = (
  speed: SimulationSnapshot['speed'],
): number => speed >= 16
  ? ALGAE_RASTER_HIGH_SPEED_REFRESH_MS
  : ALGAE_RASTER_FAST_REFRESH_MS;

export const shouldRefreshAlgaeRasterNow = ({
  phase,
  speed,
  editable,
  nowMs,
  lastRefreshAtMs,
}: {
  phase: SimulationSnapshot['phase'];
  speed: SimulationSnapshot['speed'];
  editable: boolean;
  nowMs: number;
  lastRefreshAtMs: number;
}): boolean => phase !== 'running' || editable ||
  nowMs - lastRefreshAtMs >= algaeRasterRefreshIntervalMs(speed);

const defaultCamera = (): CameraState => ({
  zoom: CAMERA_COVER_ZOOM,
  centerX: CAMERA_SCENE_CENTER_X,
  centerY: CAMERA_SCENE_CENTER_Y,
});

const clampCamera = (camera: CameraState, width: number, height: number): CameraState => {
  const zoom = Math.max(fitTankZoom(width, height), Math.min(CAMERA_MAX_ZOOM, camera.zoom));
  const scale = coverTankScale(width, height) * zoom;
  if (!Number.isFinite(scale) || scale <= 0) return { ...defaultCamera(), zoom };
  const halfWidth = width / scale / 2;
  const halfHeight = height / scale / 2;
  const centerX = halfWidth >= CAMERA_SCENE_WIDTH / 2
    ? CAMERA_SCENE_CENTER_X
    : Math.max(
      CAMERA_SCENE_LEFT + halfWidth,
      Math.min(CAMERA_SCENE_RIGHT - halfWidth, camera.centerX),
    );
  const centerY = halfHeight >= CAMERA_SCENE_HEIGHT / 2
    ? CAMERA_SCENE_CENTER_Y
    : Math.max(
      CAMERA_SCENE_TOP + halfHeight,
      Math.min(CAMERA_SCENE_BOTTOM - halfHeight, camera.centerY),
    );
  return { zoom, centerX, centerY };
};

interface StructureDisplay {
  container: Container;
  sprite: Sprite | null;
  fallback: Graphics;
  outline: Graphics;
  outlineKey: string;
}

interface AnimalRenderTarget {
  x: number;
  y: number;
  facing: -1 | 1;
  poseAngle: number;
  bodyLength: number;
  behavior: AnimalSnapshot['behavior'];
  health: number;
  selected: boolean;
  held: boolean;
  placementValid: boolean;
  reproductiveState: AnimalSnapshot['reproductiveState'];
  interpolatedPosition: boolean;
}

interface AnimalMotionProfile {
  rate: number;
  bend: number;
  bob: number;
  head: number;
  legs: number;
}

interface AnimalDisplay {
  container: Container;
  selection: Graphics;
  placement: Graphics;
  art: Container;
  head: Container;
  abdomen: Container[];
  tail: Container;
  legs: Container;
  antennae: Container;
  eggs: Graphics;
  grazingFeedback: Container;
  grazingMouth: Graphics;
  grazingFlecks: Graphics[];
  target: AnimalRenderTarget;
  renderX: number;
  renderY: number;
  renderFacing: number;
  renderPoseAngle: number;
  renderBodyLength: number;
  renderMotion: AnimalMotionProfile;
  grazingWeight: number;
  phase: number;
  phaseOffset: number;
}

interface AnimalCarcassDisplay {
  container: Container;
  art: Container;
  head: Container;
  abdomen: Container[];
  tail: Container;
  legs: Container;
  antennae: Container;
  target: AnimalCarcassSnapshot;
  renderX: number;
  renderY: number;
  renderFacing: number;
  renderBodyLength: number;
  phaseOffset: number;
}

interface AquariumLayers {
  lamp: Graphics;
  base: Graphics;
  light: Sprite;
  substrateAlgae: Container;
  foreground: Graphics;
  structures: Container;
  algae: Container;
  animals: Container;
  goalGuide: Graphics;
  seeds: Graphics;
  interaction: Graphics;
  measurements: Graphics;
  probe: Graphics;
  selection: Graphics;
  drag: Graphics;
  frame: Graphics;
}

interface RasterSurface {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  texture: Texture;
}

const rasterSurfaces = new WeakMap<Sprite, RasterSurface>();

const getRasterSurface = (layer: Sprite, width: number, height: number): RasterSurface | null => {
  const existing = rasterSurfaces.get(layer);
  if (existing && existing.canvas.width === width && existing.canvas.height === height &&
    !existing.texture.destroyed && !existing.texture.source.destroyed) {
    return existing;
  }
  if (existing && !existing.texture.destroyed) existing.texture.destroy(true);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const texture = Texture.from(canvas);
  texture.source.scaleMode = 'linear';
  const surface = { canvas, context, texture };
  rasterSurfaces.set(layer, surface);
  layer.texture = texture;
  return surface;
};

const releaseRasterSurface = (layer: Sprite): void => {
  const surface = rasterSurfaces.get(layer);
  if (surface && !surface.texture.destroyed) surface.texture.destroy(true);
  rasterSurfaces.delete(layer);
};

const rasterizeStructureTexture = async (
  assetPath: string,
  width: number,
  height: number,
): Promise<Texture> => {
  // Chromium renders the authored SVG reliably as an <img>, while Pixi's SVG
  // asset path can intermittently resolve to an empty GPU texture. Rasterize it
  // ourselves once so resize/full-screen changes only scale a stable canvas texture.
  const image = new Image();
  image.decoding = 'async';
  image.src = assetPath;
  await image.decode();

  const rasterScale = 3;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * rasterScale);
  canvas.height = Math.round(height * rasterScale);
  const context = canvas.getContext('2d');
  if (!context) throw new Error(`Could not rasterize structure asset: ${assetPath}`);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const texture = Texture.from(canvas);
  texture.source.scaleMode = 'linear';
  return texture;
};

const hash01 = (value: number): number => {
  const sine = Math.sin(value * 91.733) * 43758.5453;
  return sine - Math.floor(sine);
};

const mixColor = (from: number, to: number, ratio: number): number => {
  const t = Math.max(0, Math.min(1, ratio));
  const fr = (from >> 16) & 0xff;
  const fg = (from >> 8) & 0xff;
  const fb = from & 0xff;
  const tr = (to >> 16) & 0xff;
  const tg = (to >> 8) & 0xff;
  const tb = to & 0xff;
  return (
    (Math.round(fr + (tr - fr) * t) << 16) |
    (Math.round(fg + (tg - fg) * t) << 8) |
    Math.round(fb + (tb - fb) * t)
  );
};

const drawTank = (layer: Graphics): void => {
  layer.clear();
  // The glass headspace is genuinely inside the tank. Water begins only at
  // WATER_TOP, so neither the external lamp nor this air band can look wet.
  layer.rect(0, 0, TANK_WIDTH, WATER_TOP).fill({ color: 0xbfcac3, alpha: 1 });
  const bands = TANK_HEIGHT - WATER_TOP;
  for (let index = 0; index < bands; index += 1) {
    const ratio = index / Math.max(1, bands - 1);
    layer
      .rect(0, WATER_TOP + index, TANK_WIDTH, 2)
      .fill({ color: mixColor(0x5b9ca3, 0x356b78, ratio), alpha: 1 });
  }
  layer
    .rect(0, GROUND_Y - 30, TANK_WIDTH, TANK_HEIGHT - GROUND_Y + 30)
    .fill({ color: 0x95785a, alpha: 0.86 });
  for (let index = 0; index < 80; index += 1) {
    const x = (index * 89 + 17) % TANK_WIDTH;
    const y = GROUND_Y - 21 + ((index * 37) % 82);
    const radius = 2 + ((index * 13) % 6);
    layer.circle(x, y, radius).fill({
      color: index % 2 ? 0xc8aa7b : 0x725b45,
      alpha: 0.42,
    });
  }
};

const drawSubstrateRidge = (layer: Graphics): void => {
  layer.clear();
  layer
    .moveTo(-40, TANK_VISUAL_WATER_TOP + 2)
    .bezierCurveTo(
      250,
      TANK_VISUAL_WATER_TOP - 2,
      560,
      TANK_VISUAL_WATER_TOP + 5,
      840,
      TANK_VISUAL_WATER_TOP + 1,
    )
    .bezierCurveTo(
      1030,
      TANK_VISUAL_WATER_TOP - 3,
      1130,
      TANK_VISUAL_WATER_TOP + 3,
      TANK_WIDTH + 40,
      TANK_VISUAL_WATER_TOP,
    )
    .stroke({ color: 0x315f67, width: 6, alpha: 0.72 });
  layer
    .moveTo(-40, TANK_VISUAL_WATER_TOP)
    .bezierCurveTo(
      250,
      TANK_VISUAL_WATER_TOP - 4,
      560,
      TANK_VISUAL_WATER_TOP + 3,
      840,
      TANK_VISUAL_WATER_TOP - 1,
    )
    .bezierCurveTo(
      1030,
      TANK_VISUAL_WATER_TOP - 5,
      1130,
      TANK_VISUAL_WATER_TOP + 1,
      TANK_WIDTH + 40,
      TANK_VISUAL_WATER_TOP - 2,
    )
    .stroke({ color: 0xd9eee7, width: 2.5, alpha: 0.92 });
  layer
    .moveTo(0, GROUND_Y - 28)
    .bezierCurveTo(260, GROUND_Y - 36, 520, GROUND_Y - 19, 770, GROUND_Y - 30)
    .bezierCurveTo(940, GROUND_Y - 39, 1080, GROUND_Y - 23, TANK_WIDTH, GROUND_Y - 31)
    .stroke({ color: 0xe2cda0, width: 8, alpha: 0.42 })
    .stroke({ color: 0x493d32, width: 4, alpha: 0.82 });
};

const drawTankFrame = (layer: Graphics): void => {
  layer.clear();
  const glassWidth = TANK_GLASS_RIGHT - TANK_GLASS_LEFT;
  const glassHeight = TANK_GLASS_BOTTOM - TANK_GLASS_TOP;
  layer
    .roundRect(
      TANK_GLASS_LEFT + 1,
      TANK_GLASS_TOP + 2,
      glassWidth - 2,
      glassHeight - 3,
      13,
    )
    .stroke({ color: 0x1e2c2b, width: 16, alpha: 0.2 });
  layer
    .roundRect(TANK_GLASS_LEFT, TANK_GLASS_TOP, glassWidth, glassHeight, 12)
    .stroke({ color: 0x3b4c4c, width: 10, alpha: 1 });
  layer
    .roundRect(
      TANK_GLASS_LEFT + 7,
      TANK_GLASS_TOP + 7,
      glassWidth - 14,
      glassHeight - 14,
      8,
    )
    .stroke({ color: 0x91aaa4, width: 2, alpha: 0.34 });
};

const drawLampRig = (layer: Graphics): void => {
  layer.clear();
  // The rig is a sibling of the tank, not a child of its glass or water mask.
  layer
    .moveTo(LAMP_FIXTURE_LEFT + 20, LAMP_CABLE_TOP)
    .lineTo(LAMP_FIXTURE_LEFT + 20, LAMP_FIXTURE_TOP)
    .moveTo(LAMP_FIXTURE_LEFT + LAMP_FIXTURE_WIDTH - 20, LAMP_CABLE_TOP)
    .lineTo(LAMP_FIXTURE_LEFT + LAMP_FIXTURE_WIDTH - 20, LAMP_FIXTURE_TOP)
    .stroke({ color: 0x59605a, width: 3, alpha: 0.7 });
  layer
    .roundRect(
      LAMP_FIXTURE_LEFT,
      LAMP_FIXTURE_TOP,
      LAMP_FIXTURE_WIDTH,
      LAMP_FIXTURE_HEIGHT,
      8,
    )
    .fill({ color: 0xe8c267, alpha: 1 })
    .stroke({ color: 0x303c3a, width: 4, alpha: 1 });
  layer
    .roundRect(
      LAMP_GLOW_LEFT,
      LAMP_GLOW_TOP,
      LAMP_GLOW_WIDTH,
      LAMP_GLOW_HEIGHT,
      3,
    )
    .fill({ color: 0xf3d77d, alpha: 0.6 });
};

const drawLightField = (
  layer: Sprite,
  snapshot: SimulationSnapshot,
  showMeasurement: boolean,
): void => {
  const { columns, rows, values } = snapshot.lightField;
  const surface = getRasterSurface(layer, columns, rows);
  if (!surface) return;
  const { context, texture } = surface;
  const pixels = context.createImageData(columns, rows);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const value = values[row * columns + column] ?? 0;
      const normalized = Math.max(0, Math.min(1, value / 100));
      const darkness = 1 - normalized;
      const color = mixColor(0x183d55, 0xe9c66d, normalized);
      const finalColor = showMeasurement ? color : 0x163d50;
      const alpha = showMeasurement ? 0.1 + darkness * 0.3 : 0.02 + darkness * 0.19;
      const offset = (row * columns + column) * 4;
      pixels.data[offset] = (finalColor >> 16) & 0xff;
      pixels.data[offset + 1] = (finalColor >> 8) & 0xff;
      pixels.data[offset + 2] = finalColor & 0xff;
      pixels.data[offset + 3] = Math.round(alpha * 255);
    }
  }
  context.putImageData(pixels, 0, 0);
  texture.source.update();
  layer.position.set(0, WATER_TOP);
  layer.setSize(TANK_WIDTH, GROUND_Y - WATER_TOP);
};

const polygonPoints = (points: Vec2[]): number[] =>
  points.flatMap((point) => [point.x, point.y]);

const usableStructureTexture = (textures: Map<string, Texture>, path: string): Texture | undefined => {
  const texture = textures.get(path);
  return texture && !texture.destroyed && !texture.source.destroyed ? texture : undefined;
};

const createStructureDisplay = (
  structure: StructureSnapshot,
  textures: Map<string, Texture>,
): StructureDisplay => {
  const definition = STRUCTURES[structure.definitionId];
  const container = new Container();
  let sprite: Sprite | null = null;
  const texture = usableStructureTexture(textures, structure.assetPath);
  const visualOffset = structureVisualOffset(definition.collisionPolygon);

  // Keep a complete vector stone underneath the texture at all times. Even if a
  // graphics driver loses or rejects the texture, the object can never collapse
  // into a selection outline with an invisible body.
  const fallback = new Graphics()
    .poly(polygonPoints(definition.collisionPolygon))
    .fill({ color: 0xb7aa8c, alpha: 1 })
    .poly(polygonPoints(definition.ecologyPolygon))
    .fill({ color: 0xd8cca9, alpha: 0.34 })
    .poly(polygonPoints(definition.collisionPolygon))
    .stroke({ color: 0x303c3a, width: 4, join: 'round' });
  fallback.position.set(visualOffset.x, visualOffset.y);
  container.addChild(fallback);

  if (texture) {
    sprite = new Sprite(texture);
    sprite.anchor.set(0.5);
    // Structure art uses the same design-space rectangle as its collision polygon.
    // Setting both dimensions prevents transparent canvas padding or source aspect
    // ratio from silently changing the visible boundary relative to physics.
    sprite.setSize(structure.width, structure.height);
    sprite.position.set(visualOffset.x, visualOffset.y);
    container.addChild(sprite);
  }

  const outline = new Graphics();
  outline.position.set(visualOffset.x, visualOffset.y);
  container.addChild(outline);
  return { container, sprite, fallback, outline, outlineKey: '' };
};

const updateStructureDisplay = (
  display: StructureDisplay,
  structure: StructureSnapshot,
  selected: boolean,
): void => {
  const definition = STRUCTURES[structure.definitionId];
  display.container.position.set(structure.x, structure.y);
  display.container.rotation = structure.angle;
  if (display.sprite) {
    display.sprite.tint = structure.placementValid ? 0xffffff : 0xcf6f68;
    display.sprite.alpha = structure.isHeld ? 0.93 : 1;
  }
  display.fallback.tint = structure.placementValid ? 0xffffff : 0xcf6f68;
  display.fallback.alpha = structure.isHeld ? 0.93 : 1;
  const outlineKey = `${structure.isHeld}:${selected}:${structure.placementValid}`;
  if (display.outlineKey !== outlineKey) {
    display.outlineKey = outlineKey;
    display.outline.clear();
    if (structure.isHeld || selected) {
      display.outline
        .poly(polygonPoints(definition.collisionPolygon))
        .stroke({
          color: structure.isHeld
            ? structure.placementValid ? 0xf0c85e : 0xd7605b
            : 0xf7e7a7,
          width: structure.isHeld ? 7 : 4,
          alpha: structure.isHeld ? 0.95 : 0.78,
        });
    }
  }
};

const applyStructureMotion = (
  displays: Map<string, StructureDisplay>,
  structures: StructureSnapshot[],
): void => {
  for (const structure of structures) {
    const display = displays.get(structure.id);
    if (!display) continue;
    display.container.position.set(structure.x, structure.y);
    display.container.rotation = structure.angle;
  }
};

const syncStructures = (
  layer: Container,
  snapshot: SimulationSnapshot,
  textures: Map<string, Texture>,
  displays: Map<string, StructureDisplay>,
  structures: StructureSnapshot[] = snapshot.structures,
  suppressInventoryHolding = false,
): void => {
  const currentIds = new Set(structures.map((structure) => structure.id));
  for (const [id, display] of displays) {
    if (currentIds.has(id)) continue;
    layer.removeChild(display.container);
    display.container.destroy({ children: true });
    displays.delete(id);
  }
  for (const structure of structures) {
    let display = displays.get(structure.id);
    const texture = usableStructureTexture(textures, structure.assetPath);
    const spriteInvalid = Boolean(display?.sprite) &&
      (display!.sprite!.destroyed ||
        display!.sprite!.texture.destroyed ||
        display!.sprite!.texture.source.destroyed);
    const textureBecameAvailable = Boolean(display && !display.sprite && texture);
    if (display && (spriteInvalid || textureBecameAvailable)) {
      layer.removeChild(display.container);
      display.container.destroy({ children: true });
      displays.delete(structure.id);
      display = undefined;
    }
    if (!display) {
      display = createStructureDisplay(structure, textures);
      displays.set(structure.id, display);
      layer.addChild(display.container);
    }
    updateStructureDisplay(
      display,
      structure,
      snapshot.selection?.kind === 'structure' && snapshot.selection.structureId === structure.id,
    );
    display.container.visible = !(
      suppressInventoryHolding &&
      structure.isHeld
    );
  }
};

const SHRIMP_DRAW_LENGTH = 48;
const SHRIMP_ADULT_LENGTH = 36;
const SHRIMP_ABDOMEN_X = [-4, -10, -16, -21];

const animalHash = (id: string): number => {
  let value = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    value ^= id.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return (value >>> 0) / 0xffffffff;
};

const drawShrimpHead = (): Container => {
  const group = new Container();
  const body = new Graphics()
    .moveTo(-5, 4)
    .bezierCurveTo(-3, -5.8, 4, -9, 11, -7)
    .bezierCurveTo(15, -5.8, 17, -3, 19, -1.6)
    .lineTo(14, -0.8)
    .bezierCurveTo(13, 4.8, 7, 7, 0, 6.2)
    .bezierCurveTo(-2, 5.9, -4, 5.2, -5, 4)
    .closePath()
    .fill({ color: 0xd66f61, alpha: 0.74 })
    .stroke({ color: 0x303c3a, width: 2.1, alpha: 0.94, join: 'round' });
  const wash = new Graphics()
    .moveTo(-1, -4.8)
    .bezierCurveTo(4, -7.1, 10, -5.4, 12.8, -2.8)
    .stroke({ color: 0xf6c1a8, width: 2.1, alpha: 0.62, cap: 'round' })
    .moveTo(0, 3.1)
    .bezierCurveTo(4, 4.6, 8, 3.9, 10.8, 1.7)
    .stroke({ color: 0x8f413d, width: 1.15, alpha: 0.56, cap: 'round' });
  const eye = new Graphics()
    .circle(10.2, -4.5, 2.25)
    .fill({ color: 0xf6efd5, alpha: 0.96 })
    .stroke({ color: 0x303c3a, width: 1.25, alpha: 1 })
    .circle(10.7, -4.6, 1.05)
    .fill({ color: 0x25302e, alpha: 1 });
  group.addChild(body, wash, eye);
  return group;
};

const drawShrimpAbdomenSegment = (index: number): Container => {
  const group = new Container();
  const width = 11 - index * 1.1;
  const height = 12.2 - index * 1.15;
  const body = new Graphics()
    .ellipse(0, 0, width / 2, height / 2)
    .fill({
      color: index % 2 === 0 ? 0xd56a5e : 0xcb6258,
      alpha: 0.68 - index * 0.035,
    })
    .stroke({ color: 0x303c3a, width: 1.65, alpha: 0.82 });
  const highlight = new Graphics()
    .moveTo(-width * 0.25, -height * 0.28)
    .quadraticCurveTo(0, -height * 0.46, width * 0.27, -height * 0.2)
    .stroke({ color: 0xf5bea6, width: 1.45, alpha: 0.55, cap: 'round' });
  group.addChild(body, highlight);
  return group;
};

const drawShrimpTail = (): Container => {
  const group = new Container();
  const fan = new Graphics()
    .poly([0, -2, -10, -9, -12, -2, -7, 1])
    .fill({ color: 0xd16b5e, alpha: 0.63 })
    .stroke({ color: 0x303c3a, width: 1.7, alpha: 0.88, join: 'round' })
    .poly([-1, 1, -11, 2, -9, 10, 0, 4])
    .fill({ color: 0xc75f56, alpha: 0.59 })
    .stroke({ color: 0x303c3a, width: 1.7, alpha: 0.88, join: 'round' })
    .moveTo(-1, 0)
    .lineTo(-12, 0)
    .stroke({ color: 0xf2b59d, width: 1.25, alpha: 0.52, cap: 'round' });
  group.addChild(fan);
  return group;
};

const drawShrimpLegs = (): Container => {
  const group = new Container();
  const legs = new Graphics();
  for (let index = 0; index < 5; index += 1) {
    const x = 5 - index * 4.2;
    const reach = 7.2 + (index % 2) * 1.8;
    legs
      .moveTo(x, 3.2)
      .quadraticCurveTo(x + 1.4, 6.5, x + 3.4, reach)
      .stroke({ color: 0x7e403c, width: 1.25, alpha: 0.8, cap: 'round' });
  }
  group.addChild(legs);
  return group;
};

const drawShrimpAntennae = (): Container => {
  const group = new Container();
  const antennae = new Graphics()
    .moveTo(12.5, -4)
    .bezierCurveTo(21, -9, 27, -10, 35, -7)
    .stroke({ color: 0x493b37, width: 1.25, alpha: 0.82, cap: 'round' })
    .moveTo(13.2, -2.1)
    .bezierCurveTo(22, -3, 28, 0, 34, 4)
    .stroke({ color: 0x493b37, width: 1.05, alpha: 0.72, cap: 'round' });
  group.addChild(antennae);
  return group;
};

const drawShrimpGrazingFeedback = (): {
  group: Container;
  mouth: Graphics;
  flecks: Graphics[];
} => {
  const group = new Container();
  const mouth = new Graphics()
    .moveTo(16.7, -0.8)
    .quadraticCurveTo(19.4, 0.5, 21.5, -0.3)
    .stroke({ color: 0x4b3c35, width: 1.2, alpha: 0.9, cap: 'round' })
    .moveTo(17.2, 1)
    .quadraticCurveTo(19.5, 2.2, 21.2, 1.2)
    .stroke({ color: 0x70483e, width: 0.95, alpha: 0.78, cap: 'round' });
  const fleckColors = [0x668663, 0x8a9a62, 0x9a744c];
  const flecks = fleckColors.map((color, index) => new Graphics()
    .moveTo(-1.1, 0.4)
    .quadraticCurveTo(0, -1.2 - index * 0.12, 1.2, -0.15)
    .stroke({ color: 0x35443a, width: 0.65, alpha: 0.78, cap: 'round' })
    .circle(0.3, 0, 1.05 - index * 0.12)
    .fill({ color, alpha: 0.92 }));
  group.addChild(mouth, ...flecks);
  group.visible = false;
  return { group, mouth, flecks };
};

const createAnimalDisplay = (id: string, target: AnimalRenderTarget): AnimalDisplay => {
  const container = new Container();
  const selection = new Graphics()
    .ellipse(0, 0, 26, 12)
    .stroke({ color: 0xf8edc7, width: 6.5, alpha: 0.7 })
    .stroke({ color: 0xc86459, width: 2.2, alpha: 0.94 });
  const placement = new Graphics()
    .ellipse(0, 0, 29, 14)
    .stroke({ color: 0xffffff, width: 3.2, alpha: 0.9 });
  const art = new Container();
  const head = drawShrimpHead();
  const abdomen = SHRIMP_ABDOMEN_X.map((_, index) => drawShrimpAbdomenSegment(index));
  const tail = drawShrimpTail();
  const legs = drawShrimpLegs();
  const antennae = drawShrimpAntennae();
  const eggs = new Graphics();
  const grazing = drawShrimpGrazingFeedback();
  for (let index = 0; index < 5; index += 1) {
    eggs.circle(-3 - index * 3.2, 5.3 + (index % 2) * 1.1, 1.5)
      .fill({ color: 0xe8b35c, alpha: 0.9 })
      .stroke({ color: 0x6f4d32, width: 0.65, alpha: 0.72 });
  }

  tail.position.set(-21, 0);
  abdomen.forEach((segment, index) => segment.position.set(SHRIMP_ABDOMEN_X[index], 0));
  art.addChild(antennae, legs, tail, ...[...abdomen].reverse(), head, eggs, grazing.group);
  container.addChild(selection, placement, art);
  const phaseOffset = animalHash(id) * Math.PI * 2;
  return {
    container,
    selection,
    placement,
    art,
    head,
    abdomen,
    tail,
    legs,
    antennae,
    eggs,
    grazingFeedback: grazing.group,
    grazingMouth: grazing.mouth,
    grazingFlecks: grazing.flecks,
    target,
    renderX: target.x,
    renderY: target.y,
    renderFacing: target.facing,
    renderPoseAngle: target.poseAngle,
    renderBodyLength: target.bodyLength,
    renderMotion: { ...animalMotion(target.behavior) },
    grazingWeight: target.behavior === 'grazing' ? 1 : 0,
    phase: 0,
    phaseOffset,
  };
};

const createAnimalCarcassDisplay = (
  target: AnimalCarcassSnapshot,
): AnimalCarcassDisplay => {
  const container = new Container();
  const art = new Container();
  const head = drawShrimpHead();
  const abdomen = SHRIMP_ABDOMEN_X.map((_, index) => drawShrimpAbdomenSegment(index));
  const tail = drawShrimpTail();
  const legs = drawShrimpLegs();
  const antennae = drawShrimpAntennae();

  // Cover the bright living eye with a small, quiet closed-eye mark. The pale
  // patch also keeps the state legible after the whole rig is desaturated.
  const closedEye = new Graphics()
    .circle(10.2, -4.5, 2.8)
    .fill({ color: 0xd7cfb7, alpha: 0.98 })
    .stroke({ color: 0x4d5550, width: 1.15, alpha: 0.92 })
    .moveTo(8.5, -5.8)
    .lineTo(11.9, -3.2)
    .moveTo(11.8, -5.9)
    .lineTo(8.6, -3.2)
    .stroke({ color: 0x4d5550, width: 1.05, alpha: 0.9, cap: 'round' });
  head.addChild(closedEye);

  art.addChild(antennae, legs, tail, ...[...abdomen].reverse(), head);
  // Multiplying the existing coral palette by this neutral sage gives the
  // familiar opaque, faded appearance of a dead cherry shrimp without gore.
  art.tint = 0xc3c3ad;
  container.addChild(art);
  return {
    container,
    art,
    head,
    abdomen,
    tail,
    legs,
    antennae,
    target,
    renderX: target.x,
    renderY: target.y,
    renderFacing: target.facing,
    renderBodyLength: target.bodyLength,
    phaseOffset: animalHash(target.id) * Math.PI * 2,
  };
};

const syncAnimalCarcasses = (
  layer: Container,
  snapshot: SimulationSnapshot,
  displays: Map<string, AnimalCarcassDisplay>,
): void => {
  const carcasses = snapshot.carcasses;
  const currentIds = new Set(carcasses.map((carcass) => carcass.id));
  for (const [id, display] of displays) {
    if (currentIds.has(id)) continue;
    layer.removeChild(display.container);
    display.container.destroy({ children: true });
    displays.delete(id);
  }
  for (const carcass of carcasses) {
    let display = displays.get(carcass.id);
    if (!display) {
      display = createAnimalCarcassDisplay(carcass);
      displays.set(carcass.id, display);
      layer.addChild(display.container);
    }
    display.target = carcass;
  }
};

const animalTarget = (
  animal: AnimalSnapshot,
  selected: boolean,
  interpolatedPosition: boolean,
): AnimalRenderTarget => ({
  x: animal.x,
  y: animal.y,
  facing: animal.facing,
  poseAngle: animal.poseAngle,
  bodyLength: animal.bodyLength,
  behavior: animal.behavior,
  health: animal.health,
  selected,
  held: false,
  placementValid: true,
  reproductiveState: animal.reproductiveState,
  interpolatedPosition,
});

const syncAnimals = (
  layer: Container,
  snapshot: SimulationSnapshot,
  displays: Map<string, AnimalDisplay>,
  animals: AnimalSnapshot[] = snapshot.animals,
  holding: SimulationSnapshot['holding'] = snapshot.holding,
  interpolatedPosition = false,
  removeMissing = true,
  suppressInventoryHolding = false,
): void => {
  const held = holding?.kind === 'animal' ? holding : null;
  const heldId = held?.animalId ?? null;
  const currentIds = new Set(animals.map((animal) => animal.id));
  if (heldId) currentIds.add(heldId);

  if (removeMissing) {
    for (const [id, display] of displays) {
      if (currentIds.has(id)) continue;
      layer.removeChild(display.container);
      display.container.destroy({ children: true });
      displays.delete(id);
    }
  }

  const selectedIds = new Set<string>();
  if (snapshot.selection?.kind === 'animal' && snapshot.selection.animalId) {
    selectedIds.add(snapshot.selection.animalId);
  } else if (snapshot.selection?.kind === 'region') {
    for (const id of snapshot.selection.animalIds ?? []) selectedIds.add(id);
  }

  for (const animal of animals) {
    const target = animalTarget(animal, selectedIds.has(animal.id), interpolatedPosition);
    let display = displays.get(animal.id);
    if (!display) {
      display = createAnimalDisplay(animal.id, target);
      displays.set(animal.id, display);
      layer.addChild(display.container);
    }
    display.target = target;
    display.container.visible = true;
  }

  if (held && heldId) {
    let display = displays.get(heldId);
    const previous = display?.target;
    const target: AnimalRenderTarget = {
      x: held.x,
      y: held.y,
      facing: previous?.facing ?? 1,
      poseAngle: 0,
      bodyLength: previous?.bodyLength ?? SHRIMP_ADULT_LENGTH,
      behavior: 'held',
      health: previous?.health ?? 1,
      selected: false,
      held: true,
      placementValid: held.valid,
      reproductiveState: previous?.reproductiveState ?? 'none',
      interpolatedPosition,
    };
    if (!display) {
      display = createAnimalDisplay(heldId, target);
      displays.set(heldId, display);
      layer.addChild(display.container);
    }
    display.target = target;
    display.container.visible = !(suppressInventoryHolding && held.source === 'inventory');
  }
};

const applyAnimalMotion = (
  displays: Map<string, AnimalDisplay>,
  animals: AnimalSnapshot[],
  holding: SimulationSnapshot['holding'],
  interpolatedPosition: boolean,
): void => {
  for (const animal of animals) {
    const display = displays.get(animal.id);
    if (!display) continue;
    Object.assign(display.target, {
      x: animal.x,
      y: animal.y,
      facing: animal.facing,
      poseAngle: animal.poseAngle,
      bodyLength: animal.bodyLength,
      behavior: animal.behavior,
      health: animal.health,
      held: false,
      placementValid: true,
      reproductiveState: animal.reproductiveState,
      interpolatedPosition,
    });
  }

  const held = holding?.kind === 'animal' ? holding : null;
  if (!held?.animalId) return;
  const display = displays.get(held.animalId);
  if (!display) return;
  Object.assign(display.target, {
    x: held.x,
    y: held.y,
    held: true,
    placementValid: held.valid,
    behavior: 'held' as const,
    interpolatedPosition,
  });
};

function animalMotion(behavior: AnimalSnapshot['behavior']): AnimalMotionProfile {
  switch (behavior) {
    case 'traveling': return { rate: 7.4, bend: 0.08, bob: 0.7, head: 0.025, legs: 0.1 };
    case 'exploring': return { rate: 5.2, bend: 0.055, bob: 0.46, head: 0.04, legs: 0.075 };
    case 'grazing': return { rate: 8.2, bend: 0.022, bob: 0.12, head: 0.075, legs: 0.115 };
    case 'resting': return { rate: 1.6, bend: 0.018, bob: 0.12, head: 0.018, legs: 0.018 };
    case 'starving': return { rate: 1.05, bend: 0.012, bob: 0.08, head: 0.012, legs: 0.01 };
    case 'held': return { rate: 2.3, bend: 0.026, bob: 0.28, head: 0.025, legs: 0.03 };
  }
}

const animateAnimals = (
  displays: Map<string, AnimalDisplay>,
  snapshot: SimulationSnapshot,
  deltaSeconds: number,
): void => {
  const delta = Math.max(0, Math.min(0.05, deltaSeconds));
  for (const display of displays.values()) {
    const { target } = display;
    const positionRate = target.held ? 34 : 22;
    const positionEase = 1 - Math.exp(-delta * positionRate);
    const poseEase = 1 - Math.exp(-delta * 15);
    const turnEase = 1 - Math.exp(-delta * 10);
    if (target.interpolatedPosition) {
      // The worker samples were already interpolated on their timestamp axis.
      // Chasing that point again would recreate the lag that becomes a visible
      // catch-up jump after fast-forward.
      display.renderX = target.x;
      display.renderY = target.y;
    } else {
      display.renderX += (target.x - display.renderX) * positionEase;
      display.renderY += (target.y - display.renderY) * positionEase;
    }
    display.renderPoseAngle += (target.poseAngle - display.renderPoseAngle) * poseEase;
    display.renderFacing += (target.facing - display.renderFacing) * turnEase;
    display.renderBodyLength += (target.bodyLength - display.renderBodyLength) * poseEase;

    const movingPose = snapshot.phase === 'running' || target.held;
    const desiredMotion = animalMotion(target.behavior);
    const behaviorEase = 1 - Math.exp(-delta * 8);
    display.renderMotion.rate += (desiredMotion.rate - display.renderMotion.rate) * behaviorEase;
    display.renderMotion.bend += (desiredMotion.bend - display.renderMotion.bend) * behaviorEase;
    display.renderMotion.bob += (desiredMotion.bob - display.renderMotion.bob) * behaviorEase;
    display.renderMotion.head += (desiredMotion.head - display.renderMotion.head) * behaviorEase;
    display.renderMotion.legs += (desiredMotion.legs - display.renderMotion.legs) * behaviorEase;
    const motion = display.renderMotion;
    if (movingPose) {
      const visualSpeed = target.held ? 1 : Math.min(2.15, 0.7 + Math.sqrt(snapshot.speed) * 0.3);
      display.phase += delta * motion.rate * visualSpeed;
    }
    const phase = display.phase + display.phaseOffset;
    const facingSign = display.renderFacing < 0 ? -1 : 1;
    const artScale = Math.max(0.18, display.renderBodyLength / SHRIMP_DRAW_LENGTH);
    const bob = Math.sin(phase * 0.72) * motion.bob;

    display.container.position.set(display.renderX, display.renderY);
    display.container.zIndex = display.renderY;
    display.art.position.set(0, bob);
    display.art.rotation = display.renderPoseAngle * facingSign;
    display.art.scale.set(display.renderFacing * artScale, artScale);
    display.art.alpha = target.held
      ? 0.58
      : Math.max(0.56, 0.74 + target.health * 0.26);

    const selectionScale = Math.max(0.58, display.renderBodyLength / SHRIMP_ADULT_LENGTH);
    display.selection.visible = target.selected && !target.held;
    display.selection.rotation = display.renderPoseAngle * facingSign;
    display.selection.scale.set(selectionScale);
    display.placement.visible = target.held;
    display.placement.rotation = display.renderPoseAngle * facingSign;
    display.placement.scale.set(selectionScale);
    display.placement.tint = target.placementValid ? 0xf0c85e : 0xd7605b;
    display.eggs.visible = target.reproductiveState === 'berried';

    const grazingTarget = target.behavior === 'grazing' && !target.held ? 1 : 0;
    display.grazingWeight += (grazingTarget - display.grazingWeight) * behaviorEase;
    const showsGrazing = display.grazingWeight > 0.01;
    display.grazingFeedback.visible = showsGrazing;
    display.grazingFeedback.alpha = display.grazingWeight;
    if (showsGrazing) {
      const tug = Math.max(0, Math.sin(phase * 2.35)) * display.grazingWeight;
      display.head.position.set(tug * 0.75, tug * 0.08);
      display.grazingMouth.scale.set(0.92 + tug * 0.13, 0.76 + tug * 0.32);
      display.grazingMouth.alpha = 0.72 + Math.min(1, tug) * 0.28;
      display.grazingFlecks.forEach((fleck, index) => {
        const progress = (phase * 0.36 + index / display.grazingFlecks.length) % 1;
        const inward = 1 - progress;
        fleck.position.set(
          21.5 + inward * (5.2 + index * 1.3),
          Math.sin(phase * 1.1 + index * 2.15) * (1.3 + inward * 1.9),
        );
        const fleckScale = 0.55 + inward * 0.48;
        fleck.scale.set(fleckScale);
        fleck.alpha = Math.sin(progress * Math.PI) * 0.88;
        fleck.rotation = phase * 0.18 * (index % 2 === 0 ? 1 : -1);
      });
    } else {
      display.head.position.set(0, 0);
    }

    display.abdomen.forEach((segment, index) => {
      const tailRatio = (index + 1) / display.abdomen.length;
      const wave = Math.sin(phase - index * 0.62);
      segment.position.set(SHRIMP_ABDOMEN_X[index], wave * motion.bend * 9 * tailRatio);
      segment.rotation = wave * motion.bend * tailRatio;
    });
    display.tail.position.set(-21, Math.sin(phase - 2.65) * motion.bend * 10);
    display.tail.rotation = Math.sin(phase - 2.7) * motion.bend * 1.45;
    display.head.rotation = Math.sin(phase * 0.58 + 0.4) * motion.head;
    display.legs.rotation = Math.sin(phase * 1.85) * motion.legs;
    display.antennae.rotation = Math.sin(phase * 0.43 + 1.1) * motion.head * 1.25;
  }
};

const animateAnimalCarcasses = (
  displays: Map<string, AnimalCarcassDisplay>,
  deltaSeconds: number,
): void => {
  const delta = Math.max(0, Math.min(0.05, deltaSeconds));
  for (const display of displays.values()) {
    const { target } = display;
    const positionEase = 1 - Math.exp(-delta * 10);
    const scaleEase = 1 - Math.exp(-delta * 12);
    display.renderX += (target.x - display.renderX) * positionEase;
    display.renderY += (target.y - display.renderY) * positionEase;
    display.renderFacing += (target.facing - display.renderFacing) * scaleEase;
    display.renderBodyLength += (target.bodyLength - display.renderBodyLength) * scaleEase;

    const age = Math.max(0, target.ageSeconds);
    const lifetime = Math.max(0.001, target.lifetimeSeconds);
    const lifeProgress = Math.min(1, age / lifetime);
    const settle = 1 - Math.exp(-age * 1.35);
    const availableDrop = Math.max(0, GROUND_Y - 8 - target.y);
    const drop = Math.min(8, availableDrop) * settle;
    const lastMoments = Math.max(0, (lifeProgress - 0.72) / 0.28);
    const fade = 1 - lastMoments * lastMoments * (3 - 2 * lastMoments);
    const artScale = Math.max(0.18, display.renderBodyLength / SHRIMP_DRAW_LENGTH);
    const facingSign = display.renderFacing < 0 ? -1 : 1;
    const settlingRock = Math.sin(age * 2.2 + display.phaseOffset) * 0.045 * Math.exp(-age * 0.75);

    display.container.position.set(display.renderX, display.renderY + drop);
    display.container.zIndex = display.renderY + drop - 0.5;
    display.art.scale.set(facingSign * artScale, artScale * 0.9);
    display.art.rotation = facingSign * 0.24 + settlingRock;
    display.art.alpha = Math.max(0, fade) * 0.86;

    // A fixed comma-shaped curl reads as limp and settled, and deliberately
    // avoids the rhythmic joint movement used by living shrimp.
    display.head.position.set(1.5, -1.5);
    display.head.rotation = -0.12;
    display.abdomen.forEach((segment, index) => {
      const ratio = (index + 1) / display.abdomen.length;
      segment.position.set(
        SHRIMP_ABDOMEN_X[index] + ratio * 1.5,
        ratio * ratio * 12,
      );
      segment.rotation = -0.12 - ratio * 0.72;
    });
    display.tail.position.set(-17.5, 15);
    display.tail.rotation = -1.05;
    display.legs.position.set(0, 1.8);
    display.legs.rotation = -0.16;
    display.legs.alpha = 0.46;
    display.antennae.rotation = 0.2;
    display.antennae.alpha = 0.56;
  }
};

const structureAlgaeGeometryKey = (snapshot: SimulationSnapshot): string =>
  snapshot.structures.map((structure) => [
    structure.id,
    algaeKeyNumber(structure.x),
    algaeKeyNumber(structure.y),
    algaeKeyNumber(structure.angle),
  ].join(':')).join('|');

type AlgaeSpeciesId = 'oedogonium' | 'nitzschia';

interface AlgaeDensitySurface {
  surfaceKind: SurfaceCellSnapshot['surfaceKind'];
  scratchCanvas: HTMLCanvasElement;
  scratchContext: CanvasRenderingContext2D;
  speciesLayers: Record<AlgaeSpeciesId, AlgaeSpeciesDensityLayer>;
  brushes: Record<AlgaeSpeciesId, HTMLCanvasElement>;
  fieldDirty: boolean;
  lastFieldRenderAtMs: number;
  mask: Graphics;
  maskKey: string;
  cells: Map<string, string>;
  colonization: Record<AlgaeSpeciesId, Map<string, AlgaeColonizationState>>;
}

interface AlgaeSpeciesDensityLayer {
  container: Container;
  densityCanvas: HTMLCanvasElement;
  densityContext: CanvasRenderingContext2D;
  densityTexture: Texture;
  densitySprite: Sprite;
  detailMaskSprite: Sprite;
  detailGraphics: Graphics;
  detailContext: GraphicsContext;
  detailGeometryKey: string;
}

export interface AlgaeColonizationState {
  active: boolean;
  generation: number;
}

const algaeDensitySurfaces = new WeakMap<Container, AlgaeDensitySurface>();

export const ALGAE_OEDOGONIUM_DETAILS_PER_ACTIVE_CELL = 4;
export const ALGAE_NITZSCHIA_DETAILS_PER_ACTIVE_CELL = 5;
export const NITZSCHIA_VISUAL_STYLE = {
  brush: { red: 176, green: 126, blue: 58, alpha: 0.58 },
  substrateAlpha: 0.72,
  structureAlpha: 0.58,
  speck: {
    radiusMin: 0.42,
    radiusSpan: 0.38,
    aspectMin: 0.72,
    aspectSpan: 0.22,
    color: 0x6f4a2b,
    alpha: 0.46,
  },
} as const;

export const algaeColonizationDetailSeed = (
  cellId: string,
  speciesId: AlgaeSpeciesId,
  generation: number,
  pass: number,
  index: number,
): number => stringHash(
  `${cellId}:${speciesId}:${Math.max(1, Math.floor(generation))}:${pass}:${index}`,
);

const algaeDetailPosition = (
  cell: SurfaceCellSnapshot,
  surfaceAngle: number,
  seed: number,
): Vec2 => {
  // Detail points deliberately spill across neighboring ecology cells. The
  // soft density mask clips them back to the actual colony, while the overlap
  // prevents one evenly centred mark per cell from revealing the grid.
  const spread = cell.cellSize * 1.05;
  const localX = (hash01(seed * 43 + 17) - 0.5) * spread * 2;
  const localY = (hash01(seed * 71 + 29) - 0.5) * spread * 2;
  const cosine = Math.cos(surfaceAngle);
  const sine = Math.sin(surfaceAngle);
  return {
    x: cell.x + localX * cosine - localY * sine,
    y: cell.y + localX * sine + localY * cosine,
  };
};

const appendOedogoniumFilament = (
  context: GraphicsContext,
  cell: SurfaceCellSnapshot,
  surfaceAngle: number,
  generation: number,
  pass: number,
  index: number,
): void => {
  const seed = algaeColonizationDetailSeed(
    cell.id,
    'oedogonium',
    generation,
    pass,
    index,
  );
  const position = algaeDetailPosition(cell, surfaceAngle, seed);
  const angle = surfaceAngle + hash01(seed * 97 + 41) * Math.PI * 2;
  const length = 6 + hash01(seed * 59 + 13) * 6.5;
  const shape = hash01(seed * 83 + 23);
  const curveSign = hash01(seed * 107 + 37) < 0.5 ? -1 : 1;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const normalX = -sine;
  const normalY = cosine;

  if (shape < 0.55) {
    // A small open C reads as a loose filament instead of a solid worm.
    const bend = length * 0.38 * curveSign;
    context
      .moveTo(
        position.x - cosine * length * 0.45,
        position.y - sine * length * 0.45,
      )
      .bezierCurveTo(
        position.x - cosine * length * 0.12 + normalX * bend,
        position.y - sine * length * 0.12 + normalY * bend,
        position.x + cosine * length * 0.12 + normalX * bend,
        position.y + sine * length * 0.12 + normalY * bend,
        position.x + cosine * length * 0.45,
        position.y + sine * length * 0.45,
      );
    return;
  }

  if (shape < 0.85) {
    // A shallow S adds variation without making a dense tangled scribble.
    const bend = length * 0.3 * curveSign;
    context
      .moveTo(
        position.x - cosine * length * 0.45,
        position.y - sine * length * 0.45,
      )
      .bezierCurveTo(
        position.x - cosine * length * 0.15 + normalX * bend,
        position.y - sine * length * 0.15 + normalY * bend,
        position.x + cosine * length * 0.15 - normalX * bend,
        position.y + sine * length * 0.15 - normalY * bend,
        position.x + cosine * length * 0.45,
        position.y + sine * length * 0.45,
      );
    return;
  }

  // A narrow hairpin recalls the hooked strands in the earlier doodle art.
  context
    .moveTo(
      position.x - cosine * length * 0.4 - normalX * length * 0.11,
      position.y - sine * length * 0.4 - normalY * length * 0.11,
    )
    .bezierCurveTo(
      position.x + cosine * length * 0.48 - normalX * length * 0.11,
      position.y + sine * length * 0.48 - normalY * length * 0.11,
      position.x + cosine * length * 0.48 + normalX * length * 0.11,
      position.y + sine * length * 0.48 + normalY * length * 0.11,
      position.x - cosine * length * 0.4 + normalX * length * 0.11,
      position.y - sine * length * 0.4 + normalY * length * 0.11,
    );
};

const appendNitzschiaSpeck = (
  context: GraphicsContext,
  cell: SurfaceCellSnapshot,
  surfaceAngle: number,
  generation: number,
  pass: number,
  index: number,
): void => {
  const seed = algaeColonizationDetailSeed(
    cell.id,
    'nitzschia',
    generation,
    pass,
    index,
  );
  const position = algaeDetailPosition(cell, surfaceAngle, seed);
  const angle = surfaceAngle + hash01(seed * 101 + 43) * Math.PI * 2;
  const tangentX = Math.cos(angle);
  const tangentY = Math.sin(angle);
  const normalX = -tangentY;
  const normalY = tangentX;
  // Keep the cells as tiny dust-like flecks, but large enough to survive the
  // default 84% tank zoom.  The previous sub-pixel, narrow ovals disappeared
  // completely after texture scaling even over a mature colony.
  const radius = NITZSCHIA_VISUAL_STYLE.speck.radiusMin +
    hash01(seed * 61 + 11) * NITZSCHIA_VISUAL_STYLE.speck.radiusSpan;
  const aspect = NITZSCHIA_VISUAL_STYLE.speck.aspectMin +
    hash01(seed * 89 + 17) * NITZSCHIA_VISUAL_STYLE.speck.aspectSpan;
  const pointCount = 6;

  for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
    const theta = pointIndex / pointCount * Math.PI * 2;
    const wobble = 0.84 + hash01(seed + pointIndex * 53 + 131) * 0.28;
    const localX = Math.cos(theta) * radius * wobble;
    const localY = Math.sin(theta) * radius * aspect * wobble;
    const x = position.x + tangentX * localX + normalX * localY;
    const y = position.y + tangentY * localX + normalY * localY;
    if (pointIndex === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.closePath();
};

const styleAlgaeDetailContext = (context: GraphicsContext): void => {
  // Detail geometry is compact but still static between colonization changes.
  // The direct path lets Pixi retain it without rebuilding a sprite batch.
  context.batchMode = 'no-batch';
};

const createAlgaeBrushCanvas = (speciesId: AlgaeSpeciesId): HTMLCanvasElement => {
  const size = 64;
  const center = size / 2;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) return canvas;

  context.save();
  context.filter = 'blur(4px)';
  const nitzschiaBrush = NITZSCHIA_VISUAL_STYLE.brush;
  context.fillStyle = speciesId === 'oedogonium'
    ? 'rgba(84, 132, 73, 0.52)'
    : `rgba(${nitzschiaBrush.red}, ${nitzschiaBrush.green}, ${nitzschiaBrush.blue}, ${nitzschiaBrush.alpha})`;
  // One broad translucent membrane reproduces the connected wash of the old
  // shared raster. Four overlapping circles made an almost opaque center but
  // a much smaller footprint, so a colony looked like separated dark dots.
  const membranePoints = Array.from({ length: 18 }, (_, index) => {
    const angle = (index / 18) * Math.PI * 2;
    const radius = 24 + hash01(index * 29 + (speciesId === 'oedogonium' ? 5 : 41)) * 3;
    return {
      x: center + Math.cos(angle) * radius,
      y: center + Math.sin(angle) * radius,
    };
  });
  const first = membranePoints[0];
  const last = membranePoints.at(-1)!;
  context.beginPath();
  context.moveTo((last.x + first.x) / 2, (last.y + first.y) / 2);
  membranePoints.forEach((point, index) => {
    const next = membranePoints[(index + 1) % membranePoints.length];
    context.quadraticCurveTo(point.x, point.y, (point.x + next.x) / 2, (point.y + next.y) / 2);
  });
  context.closePath();
  context.fill();
  context.restore();

  return canvas;
};

const createAlgaeParticleLayer = (
  surfaceKind: SurfaceCellSnapshot['surfaceKind'],
): Container => {
  const root = new Container();
  const content = new Container();
  const mask = new Graphics();
  const width = Math.round(TANK_WIDTH * ALGAE_DENSITY_FIELD_SCALE);
  const height = Math.round(TANK_HEIGHT * ALGAE_DENSITY_FIELD_SCALE);
  const scratchCanvas = document.createElement('canvas');
  scratchCanvas.width = width;
  scratchCanvas.height = height;
  const scratchContext = scratchCanvas.getContext('2d');
  if (!scratchContext) return root;
  scratchContext.imageSmoothingEnabled = true;
  scratchContext.imageSmoothingQuality = 'high';
  const brushes = {
    nitzschia: createAlgaeBrushCanvas('nitzschia'),
    oedogonium: createAlgaeBrushCanvas('oedogonium'),
  };

  const createSpeciesLayer = (speciesId: AlgaeSpeciesId): AlgaeSpeciesDensityLayer => {
    const container = new Container();
    container.visible = false;
    const densityCanvas = document.createElement('canvas');
    densityCanvas.width = width;
    densityCanvas.height = height;
    const densityContext = densityCanvas.getContext('2d');
    if (!densityContext) {
      throw new Error(`Unable to create ${speciesId} algae density canvas`);
    }
    densityContext.imageSmoothingEnabled = true;
    densityContext.imageSmoothingQuality = 'high';
    const densityTexture = Texture.from(densityCanvas);
    densityTexture.source.scaleMode = 'linear';
    const densitySprite = new Sprite(densityTexture);
    densitySprite.width = TANK_WIDTH;
    densitySprite.height = TANK_HEIGHT;
    // Keep the density texture opaque enough to mask crisp details, while the
    // visible wash itself stays as light as the earlier hand-drawn colonies.
    densitySprite.alpha = speciesId === 'oedogonium'
      ? 0.86
      : surfaceKind === 'substrate'
        ? NITZSCHIA_VISUAL_STYLE.substrateAlpha
        : NITZSCHIA_VISUAL_STYLE.structureAlpha;

    // Density and biological detail deliberately use different renderers.
    // The small dynamic bitmap produces a soft, grid-free colony boundary;
    // the lifecycle-aware vector drawing stays crisp when the player zooms.
    const detailGraphics = new Graphics();
    const detailContext = detailGraphics.context;
    styleAlgaeDetailContext(detailContext);
    const detailMaskSprite = new Sprite(densityTexture);
    detailMaskSprite.width = TANK_WIDTH;
    detailMaskSprite.height = TANK_HEIGHT;
    detailGraphics.setMask({
      mask: detailMaskSprite,
      channel: 'alpha',
      inverse: false,
    });
    container.addChild(densitySprite, detailGraphics, detailMaskSprite);
    content.addChild(container);
    return {
      container,
      densityCanvas,
      densityContext,
      densityTexture,
      densitySprite,
      detailMaskSprite,
      detailGraphics,
      detailContext,
      detailGeometryKey: '',
    };
  };

  // Brown diatoms sit below the greener filamentous algae when both compete
  // for the same visible patch, matching the old compositing order.
  const speciesLayers = {
    nitzschia: createSpeciesLayer('nitzschia'),
    oedogonium: createSpeciesLayer('oedogonium'),
  };
  content.mask = mask;
  root.addChild(content, mask);
  algaeDensitySurfaces.set(root, {
    surfaceKind,
    scratchCanvas,
    scratchContext,
    speciesLayers,
    brushes,
    fieldDirty: true,
    lastFieldRenderAtMs: Number.NEGATIVE_INFINITY,
    mask,
    maskKey: '',
    cells: new Map<string, string>(),
    colonization: {
      nitzschia: new Map<string, AlgaeColonizationState>(),
      oedogonium: new Map<string, AlgaeColonizationState>(),
    },
  });
  return root;
};

const releaseAlgaeParticleLayer = (layer: Container): void => {
  const surface = algaeDensitySurfaces.get(layer);
  if (!surface) return;
  surface.cells.clear();
  for (const speciesId of ['nitzschia', 'oedogonium'] as const) {
    surface.colonization[speciesId].clear();
    const texture = surface.speciesLayers[speciesId].densityTexture;
    if (!texture.destroyed) texture.destroy(true);
  }
  algaeDensitySurfaces.delete(layer);
};

const stringHash = (value: string): number => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const updateAlgaeMask = (
  surface: AlgaeDensitySurface,
  snapshot: SimulationSnapshot,
): void => {
  const maskKey = surface.surfaceKind === 'substrate'
    ? 'substrate'
    : structureAlgaeGeometryKey(snapshot);
  if (surface.maskKey === maskKey) return;
  surface.maskKey = maskKey;
  surface.mask.clear();
  if (surface.surfaceKind === 'substrate') {
    surface.mask.rect(0, GROUND_Y - 36, TANK_WIDTH, 45).fill({ color: 0xffffff });
    return;
  }
  for (const structure of snapshot.structures) {
    const definition = STRUCTURES[structure.definitionId];
    const polygon = structureAuthoredPolygonToWorld(
      definition.ecologyPolygon,
      definition.collisionPolygon,
      structure,
      structure.angle,
    );
    surface.mask.poly(polygonPoints(polygon)).fill({ color: 0xffffff });
  }
};

const drawAlgaeCellBrush = (
  context: CanvasRenderingContext2D,
  brush: HTMLCanvasElement,
  cell: SurfaceCellSnapshot,
  speciesId: AlgaeSpeciesId,
  visualLevel: number,
  surfaceAngle: number,
): void => {
  const speciesOffset = speciesId === 'oedogonium' ? 97 : 13;
  const cellSeed = stringHash(cell.id);
  const localJitterX = (hash01(cellSeed + speciesOffset) - 0.5) *
    cell.cellSize * ALGAE_PARTICLE_JITTER_SPAN;
  const localJitterY = (hash01(cellSeed + speciesOffset + 11) - 0.5) *
    cell.cellSize * ALGAE_PARTICLE_JITTER_SPAN;
  const cosine = Math.cos(surfaceAngle);
  const sine = Math.sin(surfaceAngle);
  const jitterX = localJitterX * cosine - localJitterY * sine;
  const jitterY = localJitterX * sine + localJitterY * cosine;
  const radius = cell.cellSize * algaeParticleRadiusRatio(visualLevel) *
    ALGAE_DENSITY_FIELD_SCALE;
  const scaleX = radius / 27 * (0.94 + hash01(cellSeed + speciesOffset + 23) * 0.12);
  const scaleY = radius / 27 * (0.94 + hash01(cellSeed + speciesOffset + 41) * 0.12);

  context.save();
  context.globalAlpha = algaeParticleAlpha(visualLevel);
  context.translate(
    (cell.x + jitterX) * ALGAE_DENSITY_FIELD_SCALE,
    (cell.y + jitterY) * ALGAE_DENSITY_FIELD_SCALE,
  );
  context.rotate(
    surfaceAngle + hash01(cellSeed + speciesOffset + 59) * Math.PI * 2,
  );
  context.scale(scaleX, scaleY);
  context.drawImage(brush, -brush.width / 2, -brush.height / 2);
  context.restore();
};

export const ALGAE_DENSITY_BLUR_PIXELS = 0.8;

export const advanceAlgaeColonizationState = (
  previous: Readonly<AlgaeColonizationState> | undefined,
  active: boolean,
): AlgaeColonizationState => {
  if (!previous) return { active, generation: active ? 1 : 0 };
  if (previous.active === active) return previous;
  return {
    active,
    generation: active ? previous.generation + 1 : previous.generation,
  };
};

const updateAlgaeColonizationState = (
  surface: AlgaeDensitySurface,
  cellId: string,
  speciesId: AlgaeSpeciesId,
  active: boolean,
): boolean => {
  const states = surface.colonization[speciesId];
  const previous = states.get(cellId);
  const next = advanceAlgaeColonizationState(previous, active);
  if (next === previous) return false;
  states.set(cellId, next);
  return previous !== undefined || active;
};

const algaeDetailGeometryKey = (
  cells: SurfaceCellSnapshot[],
  speciesId: AlgaeSpeciesId,
  surface: AlgaeDensitySurface,
  structureAngles: Map<string, number>,
): string => cells.map((cell) => {
  const generation = surface.colonization[speciesId].get(cell.id)?.generation ?? 1;
  const surfaceAngle = cell.surfaceKind === 'structure-face'
    ? structureAngles.get(cell.ownerId) ?? 0
    : 0;
  return [
    cell.id,
    generation,
    algaeKeyNumber(cell.x),
    algaeKeyNumber(cell.y),
    algaeKeyNumber(cell.cellSize),
    algaeKeyNumber(surfaceAngle),
  ].join(':');
}).join('|');

const rebuildAlgaeDetailGeometry = (
  surface: AlgaeDensitySurface,
  speciesId: AlgaeSpeciesId,
  cells: SurfaceCellSnapshot[],
  structureAngles: Map<string, number>,
): void => {
  const layer = surface.speciesLayers[speciesId];
  const geometryKey = algaeDetailGeometryKey(
    cells,
    speciesId,
    surface,
    structureAngles,
  );
  if (layer.detailGeometryKey === geometryKey) return;
  layer.detailGeometryKey = geometryKey;
  const context = layer.detailContext;
  context.clear();
  styleAlgaeDetailContext(context);

  if (speciesId === 'oedogonium') {
    for (const cell of cells) {
      const generation = surface.colonization.oedogonium.get(cell.id)?.generation ?? 1;
      const surfaceAngle = cell.surfaceKind === 'structure-face'
        ? structureAngles.get(cell.ownerId) ?? 0
        : 0;
      for (
        let index = 0;
        index < ALGAE_OEDOGONIUM_DETAILS_PER_ACTIVE_CELL;
        index += 1
      ) {
        appendOedogoniumFilament(
          context,
          cell,
          surfaceAngle,
          generation,
          0,
          index,
        );
      }
    }
    context.stroke({
      color: 0x355f3b,
      alpha: 0.4,
      width: 0.52,
      cap: 'round',
      join: 'round',
    });
    return;
  }

  for (const cell of cells) {
    const generation = surface.colonization.nitzschia.get(cell.id)?.generation ?? 1;
    const surfaceAngle = cell.surfaceKind === 'structure-face'
      ? structureAngles.get(cell.ownerId) ?? 0
      : 0;
    for (
      let index = 0;
      index < ALGAE_NITZSCHIA_DETAILS_PER_ACTIVE_CELL;
      index += 1
    ) {
      appendNitzschiaSpeck(
        context,
        cell,
        surfaceAngle,
        generation,
        0,
        index,
      );
    }
  }
  context.fill({
    color: NITZSCHIA_VISUAL_STYLE.speck.color,
    alpha: NITZSCHIA_VISUAL_STYLE.speck.alpha,
  });
};

const drawAlgaeDensityField = (
  surface: AlgaeDensitySurface,
  snapshot: SimulationSnapshot,
): void => {
  const { scratchContext } = surface;
  const structureAngles = new Map(
    snapshot.structures.map((structure) => [structure.id, structure.angle]),
  );

  const speciesOrder: AlgaeSpeciesId[] = ['nitzschia', 'oedogonium'];
  for (const speciesId of speciesOrder) {
    const detailCells: SurfaceCellSnapshot[] = [];
    scratchContext.setTransform(1, 0, 0, 1, 0, 0);
    scratchContext.globalAlpha = 1;
    scratchContext.globalCompositeOperation = 'source-over';
    scratchContext.filter = 'none';
    scratchContext.clearRect(
      0,
      0,
      surface.scratchCanvas.width,
      surface.scratchCanvas.height,
    );
    for (const cell of snapshot.cells) {
      if (cell.surfaceKind !== surface.surfaceKind) continue;
      const level = algaeVisualLevel(cell.biomass[speciesId]);
      if (level === 0) continue;
      detailCells.push(cell);
      drawAlgaeCellBrush(
        scratchContext,
        surface.brushes[speciesId],
        cell,
        speciesId,
        level,
        cell.surfaceKind === 'structure-face'
          ? structureAngles.get(cell.ownerId) ?? 0
          : 0,
      );
    }

    const speciesLayer = surface.speciesLayers[speciesId];
    const { densityContext } = speciesLayer;
    densityContext.setTransform(1, 0, 0, 1, 0, 0);
    densityContext.globalAlpha = 1;
    densityContext.globalCompositeOperation = 'source-over';
    densityContext.filter = 'none';
    densityContext.clearRect(
      0,
      0,
      speciesLayer.densityCanvas.width,
      speciesLayer.densityCanvas.height,
    );
    densityContext.save();
    densityContext.filter = `blur(${ALGAE_DENSITY_BLUR_PIXELS}px)`;
    densityContext.drawImage(surface.scratchCanvas, 0, 0);
    densityContext.restore();
    speciesLayer.densityTexture.source.update();
    rebuildAlgaeDetailGeometry(
      surface,
      speciesId,
      detailCells,
      structureAngles,
    );
  }
};

const flushAlgaeDensityField = (
  surface: AlgaeDensitySurface,
  snapshot: SimulationSnapshot,
  editable: boolean,
  force: boolean,
  nowMs: number,
): void => {
  if (!surface.fieldDirty && !force) return;
  if (!force && !shouldRefreshAlgaeRasterNow({
    phase: snapshot.phase,
    speed: snapshot.speed,
    editable,
    nowMs,
    lastRefreshAtMs: surface.lastFieldRenderAtMs,
  })) return;

  drawAlgaeDensityField(surface, snapshot);
  surface.fieldDirty = false;
  surface.lastFieldRenderAtMs = nowMs;
};

const syncAlgaeParticles = (
  layer: Container,
  snapshot: SimulationSnapshot,
  editable: boolean,
  force = false,
  nowMs = performance.now(),
): void => {
  const surface = algaeDensitySurfaces.get(layer);
  if (!surface) return;
  updateAlgaeMask(surface, snapshot);

  const activeCellIds = new Set<string>();
  const visibleSpecies: Record<AlgaeSpeciesId, boolean> = {
    nitzschia: false,
    oedogonium: false,
  };
  let visualChanged = false;
  let detailLifecycleChanged = false;
  for (const cell of snapshot.cells) {
    if (cell.surfaceKind !== surface.surfaceKind) continue;
    activeCellIds.add(cell.id);
    const nitzschiaLevel = algaeVisualLevel(cell.biomass.nitzschia);
    const oedogoniumLevel = algaeVisualLevel(cell.biomass.oedogonium);
    detailLifecycleChanged = updateAlgaeColonizationState(
      surface,
      cell.id,
      'nitzschia',
      nitzschiaLevel > 0,
    ) || detailLifecycleChanged;
    detailLifecycleChanged = updateAlgaeColonizationState(
      surface,
      cell.id,
      'oedogonium',
      oedogoniumLevel > 0,
    ) || detailLifecycleChanged;
    if (nitzschiaLevel > 0) visibleSpecies.nitzschia = true;
    if (oedogoniumLevel > 0) visibleSpecies.oedogonium = true;
    const previousKey = surface.cells.get(cell.id);

    if (nitzschiaLevel === 0 && oedogoniumLevel === 0) {
      if (surface.cells.delete(cell.id)) visualChanged = true;
      continue;
    }

    const visualKey = algaeCellVisualKey(cell);
    if (previousKey === visualKey) continue;
    surface.cells.set(cell.id, visualKey);
    visualChanged = true;
  }

  for (const cellId of surface.cells.keys()) {
    if (activeCellIds.has(cellId)) continue;
    surface.cells.delete(cellId);
    visualChanged = true;
  }

  for (const speciesId of ['nitzschia', 'oedogonium'] as const) {
    for (const [cellId, state] of surface.colonization[speciesId]) {
      if (activeCellIds.has(cellId) || !state.active) continue;
      surface.colonization[speciesId].set(cellId, {
        active: false,
        generation: state.generation,
      });
      detailLifecycleChanged = true;
    }
  }

  if (visualChanged || detailLifecycleChanged) surface.fieldDirty = true;
  flushAlgaeDensityField(surface, snapshot, editable, force, nowMs);
  for (const speciesId of ['nitzschia', 'oedogonium'] as const) {
    surface.speciesLayers[speciesId].container.visible = visibleSpecies[speciesId];
  }
  layer.visible = visibleSpecies.nitzschia || visibleSpecies.oedogonium;
};

const drawGoalGuide = (
  layer: Graphics,
  snapshot: SimulationSnapshot,
  visible: boolean,
): void => {
  layer.clear();
  if (!visible) return;
  const target = SCENARIOS[snapshot.scenarioId].target;
  if (!target || target.type !== 'habitat-coverage') return;

  const countedCells = snapshot.cells.filter((cell) => {
    if (!cell.targetEligible) return false;
    return cell.light >= target.minLight &&
      cell.light <= target.maxLight &&
      cell.biomass[target.speciesId] >= target.minBiomass;
  });
  const markerLimit = 28;
  const markerCells = countedCells.length <= markerLimit
    ? countedCells
    : Array.from({ length: markerLimit }, (_, index) =>
      countedCells[Math.floor(((index + 0.5) * countedCells.length) / markerLimit)],
    );

  for (const cell of markerCells) {
    const size = Math.max(5, Math.min(7, cell.cellSize * 0.66));
    layer
      .roundRect(cell.x - size / 2, cell.y - size / 2, size, size, 1.8)
      .fill({ color: 0x77a76f, alpha: 0.72 })
      .stroke({ color: 0xf8efc9, width: 1.5, alpha: 0.94 });
  }
};

const drawSeeds = (layer: Graphics, snapshot: SimulationSnapshot): void => {
  layer.clear();
  for (const seed of snapshot.seeds) {
    const color = SPECIES[seed.speciesId].color;
    layer
      .circle(seed.x, seed.y, 7)
      .fill({ color: 0xf6efd5, alpha: 0.82 })
      .stroke({ color: 0x34433f, width: 2.2, alpha: 0.9 });
    layer.circle(seed.x, seed.y, 3.2).fill({ color, alpha: 0.95 });
  }
};

const drawInteraction = (
  layer: Graphics,
  snapshot: SimulationSnapshot,
  suppressInventoryHolding = false,
): void => {
  layer.clear();
  const held = snapshot.holding;
  if (!held || held.kind !== 'seed' || !held.speciesId ||
    (suppressInventoryHolding && held.source === 'inventory')) return;
  const color = held.valid ? SPECIES[held.speciesId].color : 0xcf5f5a;
  layer
    .circle(held.x, held.y, 11)
    .fill({ color: 0xf9f2d9, alpha: 0.7 })
    .stroke({ color, width: 4, alpha: 0.95 });
  layer.circle(held.x, held.y, 4).fill({ color, alpha: 0.95 });
};

const drawProbe = (
  layer: Graphics,
  snapshot: SimulationSnapshot,
  activeTool: InteractionTool,
): void => {
  layer.clear();
  if (!snapshot.probe) return;
  const { x, y, light } = snapshot.probe;
  const isTemperature = activeTool === 'temperature-probe';
  const color = isTemperature
    ? 0xc86958
    : mixColor(0x315d78, 0xe3ba56, light / 100);
  layer
    .circle(x, y, 14)
    .fill({ color: 0xf8f2dc, alpha: 0.64 })
    .stroke({ color, width: 3, alpha: 0.82 });
  if (isTemperature) {
    layer.roundRect(x - 2.5, y - 8, 5, 13, 2).stroke({ color, width: 2.4 });
    layer.circle(x, y + 6, 4.2).fill({ color, alpha: 1 });
  } else {
    layer.circle(x, y, 4.5).fill({ color, alpha: 1 });
    for (let index = 0; index < 8; index += 1) {
      const angle = (Math.PI * 2 * index) / 8;
      layer.moveTo(x + Math.cos(angle) * 8, y + Math.sin(angle) * 8)
        .lineTo(x + Math.cos(angle) * 11, y + Math.sin(angle) * 11)
        .stroke({ color, width: 1.8 });
    }
  }
};

const DIGIT_SEGMENTS: Record<string, number[]> = {
  '0': [0, 1, 2, 3, 4, 5],
  '1': [1, 2],
  '2': [0, 1, 6, 4, 3],
  '3': [0, 1, 6, 2, 3],
  '4': [5, 6, 1, 2],
  '5': [0, 5, 6, 2, 3],
  '6': [0, 5, 6, 4, 2, 3],
  '7': [0, 1, 2],
  '8': [0, 1, 2, 3, 4, 5, 6],
  '9': [0, 1, 2, 3, 5, 6],
};

const drawMeasurementNumber = (layer: Graphics, x: number, y: number, index: number): void => {
  const label = String(index + 1);
  const badgeX = x > TANK_WIDTH - 30 ? x - 15 : x + 15;
  const badgeY = y < WATER_TOP + 30 ? y + 15 : y - 15;
  const digitWidth = 4;
  const gap = 2;
  const totalWidth = label.length * digitWidth + (label.length - 1) * gap;

  layer.circle(badgeX, badgeY, label.length > 1 ? 9 : 8)
    .fill({ color: 0x35423f, alpha: 0.94 })
    .stroke({ color: 0xf8f2dc, width: 2, alpha: 0.98 });

  const segmentLines = [
    [0, 0, 4, 0], [4, 0, 4, 4], [4, 4, 4, 8],
    [0, 8, 4, 8], [0, 4, 0, 8], [0, 0, 0, 4], [0, 4, 4, 4],
  ];
  const startX = badgeX - totalWidth / 2;
  for (let digitIndex = 0; digitIndex < label.length; digitIndex += 1) {
    const originX = startX + digitIndex * (digitWidth + gap);
    for (const segment of DIGIT_SEGMENTS[label[digitIndex]] ?? []) {
      const [x1, y1, x2, y2] = segmentLines[segment];
      layer.moveTo(originX + x1, badgeY - 4 + y1)
        .lineTo(originX + x2, badgeY - 4 + y2)
        .stroke({ color: 0xf8f2dc, width: 1.45, cap: 'round' });
    }
  }
};

const drawMeasurements = (layer: Graphics, snapshot: SimulationSnapshot): void => {
  layer.clear();
  for (const [index, measurement] of snapshot.measurements.entries()) {
    const selected = snapshot.selection?.kind === 'measurement' &&
      snapshot.selection.measurementId === measurement.id;
    const color = measurement.kind === 'light'
      ? mixColor(0x315d78, 0xe3ba56, measurement.light / 100)
      : 0xc86958;
    if (selected) {
      layer.circle(measurement.x, measurement.y, 20)
        .stroke({ color: 0xf8e8aa, width: 7, alpha: 0.76 });
    }
    layer
      .circle(measurement.x, measurement.y, 12)
      .fill({ color: 0xf8f2dc, alpha: 0.94 })
      .stroke({ color: 0x35423f, width: 3 });
    if (measurement.kind === 'light') {
      layer.circle(measurement.x, measurement.y, 5).fill({ color, alpha: 1 });
      for (let index = 0; index < 8; index += 1) {
        const angle = (Math.PI * 2 * index) / 8;
        layer.moveTo(
          measurement.x + Math.cos(angle) * 14,
          measurement.y + Math.sin(angle) * 14,
        ).lineTo(
          measurement.x + Math.cos(angle) * 18,
          measurement.y + Math.sin(angle) * 18,
        ).stroke({ color, width: 2 });
      }
    } else {
      layer.roundRect(measurement.x - 2.5, measurement.y - 8, 5, 13, 2)
        .stroke({ color, width: 2 });
      layer.circle(measurement.x, measurement.y + 6, 4).fill({ color, alpha: 1 });
    }
    drawMeasurementNumber(layer, measurement.x, measurement.y, index);
  }
};

const drawSelection = (layer: Graphics, snapshot: SimulationSnapshot): void => {
  layer.clear();
  const selection = snapshot.selection;
  if (!selection) return;
  if (selection.kind === 'region' && selection.bounds) {
    const { minX, minY, maxX, maxY } = selection.bounds;
    layer.rect(minX, minY, maxX - minX, maxY - minY)
      .fill({ color: 0xd9efe3, alpha: 0.08 })
      .stroke({ color: 0xf7e7a7, width: 4, alpha: 0.92 });
    return;
  }
  if (selection.kind === 'colony') {
    const color = selection.speciesId ? SPECIES[selection.speciesId].color : 0xf4d27a;
    layer
      .circle(selection.x, selection.y, 13)
      .stroke({ color: 0xf7edc9, width: 7, alpha: 0.72 })
      .stroke({ color, width: 3, alpha: 0.95 });
    return;
  }
  if (selection.kind === 'carcass') {
    const carcass = snapshot.carcasses.find((candidate) => candidate.id === selection.carcassId);
    const selectionScale = Math.max(0.58, (carcass?.bodyLength ?? SHRIMP_ADULT_LENGTH) / SHRIMP_ADULT_LENGTH);
    layer
      .ellipse(selection.x, selection.y + 6, 29 * selectionScale, 15 * selectionScale)
      .stroke({ color: 0xf7edc9, width: 6, alpha: 0.65 })
      .stroke({ color: 0x8c7770, width: 2.2, alpha: 0.92 });
  }
};

const drawDragSelection = (layer: Graphics, from: Vec2 | null, to: Vec2 | null): void => {
  layer.clear();
  if (!from || !to) return;
  const minX = Math.min(from.x, to.x);
  const minY = Math.min(from.y, to.y);
  layer.rect(minX, minY, Math.abs(to.x - from.x), Math.abs(to.y - from.y))
    .fill({ color: 0xd9efe3, alpha: 0.1 })
    .stroke({ color: 0xf8e4a2, width: 3, alpha: 0.88 });
};

export function AquariumCanvas({
  snapshot,
  motionSource,
  activeTool,
  selectionFilter,
  send,
  editable,
  hasPendingInventory,
  onConsumePendingInventory,
  onPendingInventoryReady,
  onToolComplete,
  onCameraChange,
  cameraResetToken = 0,
  showGoalGuide = false,
}: AquariumCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const snapshotRef = useRef(snapshot);
  const motionSourceRef = useRef(motionSource);
  const lastMotionSequenceRef = useRef<number | null>(null);
  const rebasedMotionSequenceRef = useRef<number | null>(null);
  const activeToolRef = useRef(activeTool);
  const layersRef = useRef<AquariumLayers | null>(null);
  const texturesRef = useRef(new Map<string, Texture>());
  const structureDisplaysRef = useRef(new Map<string, StructureDisplay>());
  const animalDisplaysRef = useRef(new Map<string, AnimalDisplay>());
  const animalCarcassDisplaysRef = useRef(new Map<string, AnimalCarcassDisplay>());
  const effectGenerationRef = useRef(0);
  const lastLightDrawRef = useRef('');
  const lastAlgaeRevisionRef = useRef(-1);
  const lastAlgaeStructureGeometryRef = useRef('');
  const lastSeedsRevisionRef = useRef(-1);
  const pendingConsumedRef = useRef(false);
  const pendingHandoffStartedAtRef = useRef<number | null>(null);
  const pendingHandoffNotifiedRef = useRef(false);
  const latestPointerWorldRef = useRef<Vec2 | null>(null);
  const secondaryPointerCancelAtRef = useRef<number | null>(null);
  const hasPendingInventoryRef = useRef(hasPendingInventory);
  const onPendingInventoryReadyRef = useRef(onPendingInventoryReady);
  const dragStartRef = useRef<Vec2 | null>(null);
  const dragStartClientRef = useRef<Vec2 | null>(null);
  const dragCurrentRef = useRef<Vec2 | null>(null);
  const dragPointerRef = useRef<number | null>(null);
  const cameraRef = useRef<CameraState>(defaultCamera());
  const cameraViewportRef = useRef({ width: 0, height: 0 });
  const applyCameraRef = useRef<() => void>(() => undefined);
  const onCameraChangeRef = useRef(onCameraChange);
  const showGoalGuideRef = useRef(showGoalGuide);
  const panPointerRef = useRef<number | null>(null);
  const panLastPointRef = useRef<Vec2 | null>(null);
  const [cameraZoom, setCameraZoom] = useState(CAMERA_COVER_ZOOM);
  const [cameraMinimumZoom, setCameraMinimumZoom] = useState(CAMERA_COVER_ZOOM);
  const [cameraCanPan, setCameraCanPan] = useState(false);
  const [cameraIsFit, setCameraIsFit] = useState(false);
  const [panMode, setPanMode] = useState(false);
  const [isPanning, setIsPanning] = useState(false);

  snapshotRef.current = snapshot;
  motionSourceRef.current = motionSource;
  activeToolRef.current = activeTool;
  onCameraChangeRef.current = onCameraChange;
  hasPendingInventoryRef.current = hasPendingInventory;
  onPendingInventoryReadyRef.current = onPendingInventoryReady;
  showGoalGuideRef.current = showGoalGuide;

  const sampleMotion = (nowMs: number) => {
    const frames = motionSourceRef.current.getFrames();
    const sequence = frames.current?.sequence ?? null;
    if (sequence === null) {
      lastMotionSequenceRef.current = null;
      rebasedMotionSequenceRef.current = null;
      return null;
    }
    if (sequence !== lastMotionSequenceRef.current) {
      const lastSequence = lastMotionSequenceRef.current;
      rebasedMotionSequenceRef.current = lastSequence !== null && sequence !== lastSequence + 1
        ? sequence
        : null;
      lastMotionSequenceRef.current = sequence;
    }
    return interpolateMotionFrames(
      rebasedMotionSequenceRef.current === sequence
        ? { previous: null, current: frames.current }
        : frames,
      nowMs,
    );
  };

  const isPendingInventoryHandoff = (): boolean =>
    hasPendingInventoryRef.current && pendingConsumedRef.current;

  const tryCompletePendingInventoryHandoff = (
    holding: SimulationSnapshot['holding'],
    nowMs: number,
  ): void => {
    if (!isPendingInventoryHandoff() || pendingHandoffNotifiedRef.current) return;
    const startedAt = pendingHandoffStartedAtRef.current;
    const motionFrames = motionSourceRef.current.getFrames();
    const hasSettledMotionPair = motionFrames.previous?.holding?.source === 'inventory' &&
      motionFrames.current?.holding?.source === 'inventory';
    if (startedAt === null || !isInventoryHandoffCaughtUp(
      holding,
      latestPointerWorldRef.current,
      nowMs - startedAt,
      hasSettledMotionPair,
    )) return;
    pendingHandoffNotifiedRef.current = true;
    onPendingInventoryReadyRef.current();
  };

  useEffect(() => {
    if (hasPendingInventory) {
      pendingConsumedRef.current = false;
      pendingHandoffStartedAtRef.current = null;
      pendingHandoffNotifiedRef.current = false;
    }
  }, [hasPendingInventory]);

  useEffect(() => {
    if (!hasPendingInventory && !snapshot.holding) return;
    panPointerRef.current = null;
    panLastPointRef.current = null;
    setPanMode(false);
    setIsPanning(false);
  }, [hasPendingInventory, snapshot.holding]);

  useEffect(() => {
    const host = hostRef.current;
    const nextCamera = host?.clientWidth && host.clientHeight
      ? {
        zoom: fitTankZoom(host.clientWidth, host.clientHeight),
        centerX: CAMERA_SCENE_CENTER_X,
        centerY: CAMERA_SCENE_CENTER_Y,
      }
      : defaultCamera();
    cameraRef.current = nextCamera;
    setCameraZoom(nextCamera.zoom);
    setPanMode(false);
    setIsPanning(false);
    panPointerRef.current = null;
    panLastPointRef.current = null;
    applyCameraRef.current();
  }, [cameraResetToken]);

  useEffect(() => {
    if (!cameraCanPan) setPanMode(false);
  }, [cameraCanPan]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const generation = ++effectGenerationRef.current;
    let disposed = false;
    let appDestroyed = false;
    let ownedLayers: AquariumLayers | null = null;
    const app = new Application();
    const ownedTextures = new Map<string, Texture>();
    const ownedDisplays = new Map<string, StructureDisplay>();
    const ownedAnimalDisplays = new Map<string, AnimalDisplay>();
    const ownedAnimalCarcassDisplays = new Map<string, AnimalCarcassDisplay>();
    let animalTicker: ((ticker: Ticker) => void) | null = null;
    let syncedMotionSequence: number | null = null;
    texturesRef.current = ownedTextures;
    structureDisplaysRef.current = ownedDisplays;
    animalDisplaysRef.current = ownedAnimalDisplays;
    animalCarcassDisplaysRef.current = ownedAnimalCarcassDisplays;
    lastLightDrawRef.current = '';
    lastAlgaeRevisionRef.current = -1;
    lastAlgaeStructureGeometryRef.current = '';
    lastSeedsRevisionRef.current = -1;

    const isCurrentGeneration = (): boolean =>
      !disposed && effectGenerationRef.current === generation;

    const destroyOwnedTextures = (): void => {
      for (const texture of ownedTextures.values()) {
        if (!texture.destroyed) texture.destroy(true);
      }
      ownedTextures.clear();
    };

    const releaseOwnedRasterSurfaces = (): void => {
      if (!ownedLayers) return;
      releaseRasterSurface(ownedLayers.light);
      releaseAlgaeParticleLayer(ownedLayers.substrateAlgae);
      releaseAlgaeParticleLayer(ownedLayers.algae);
    };

    const destroyOwnedApp = (): void => {
      if (appDestroyed || !app.renderer) return;
      appDestroyed = true;
      // `true` here releases Pixi's global GPU resource registry. That can
      // invalidate textures owned by a newer React effect generation.
      app.destroy(
        { removeView: true, releaseGlobalResources: false },
        { children: true },
      );
    };

    const applyViewport = (resizeRenderer = true): void => {
      if (disposed || !app.renderer || !host.clientWidth || !host.clientHeight) return;
      if (resizeRenderer) app.renderer.resize(host.clientWidth, host.clientHeight);
      const width = host.clientWidth;
      const height = host.clientHeight;
      const previousViewport = cameraViewportRef.current;
      const wasFit = previousViewport.width > 0 && previousViewport.height > 0 &&
        Math.abs(cameraRef.current.zoom - fitTankZoom(
          previousViewport.width,
          previousViewport.height,
        )) < CAMERA_EPSILON &&
        Math.abs(cameraRef.current.centerX - CAMERA_SCENE_CENTER_X) < 0.5 &&
        Math.abs(cameraRef.current.centerY - CAMERA_SCENE_CENTER_Y) < 0.5;
      const minimumZoom = fitTankZoom(width, height);
      const requestedCamera = resizeRenderer && wasFit
        ? {
          zoom: minimumZoom,
          centerX: CAMERA_SCENE_CENTER_X,
          centerY: CAMERA_SCENE_CENTER_Y,
        }
        : cameraRef.current;
      const camera = clampCamera(requestedCamera, width, height);
      cameraViewportRef.current = { width, height };
      cameraRef.current = camera;
      const scale = coverTankScale(width, height) * camera.zoom;
      setCameraZoom(camera.zoom);
      setCameraMinimumZoom(minimumZoom);
      setCameraCanPan(canPanTankCamera(width, height, camera.zoom));
      setCameraIsFit(
        Math.abs(camera.zoom - minimumZoom) < CAMERA_EPSILON &&
        Math.abs(camera.centerX - CAMERA_SCENE_CENTER_X) < 0.5 &&
        Math.abs(camera.centerY - CAMERA_SCENE_CENTER_Y) < 0.5,
      );
      app.stage.scale.set(scale);
      app.stage.position.set(
        width / 2 - camera.centerX * scale,
        height / 2 - camera.centerY * scale,
      );
      onCameraChangeRef.current?.({
        zoom: camera.zoom,
        scale,
        offsetX: app.stage.position.x,
        offsetY: app.stage.position.y,
        viewportWidth: width,
        viewportHeight: height,
      });
    };
    const applyOwnedCamera = (): void => applyViewport(false);
    applyCameraRef.current = applyOwnedCamera;
    const observer = new ResizeObserver(() => applyViewport(true));

    void app.init({
      width: host.clientWidth,
      height: host.clientHeight,
      antialias: true,
      backgroundAlpha: 0,
      resolution: Math.min(window.devicePixelRatio, 2),
      autoDensity: true,
    }).then(async () => {
      if (!isCurrentGeneration()) {
        destroyOwnedApp();
        return;
      }
      appRef.current = app;
      host.appendChild(app.canvas);
      app.canvas.setAttribute('aria-label', '수조 시뮬레이션 화면');
      const layers: AquariumLayers = {
        lamp: new Graphics(),
        base: new Graphics(),
        light: new Sprite(Texture.EMPTY),
        substrateAlgae: createAlgaeParticleLayer('substrate'),
        foreground: new Graphics(),
        structures: new Container(),
        algae: createAlgaeParticleLayer('structure-face'),
        animals: new Container(),
        goalGuide: new Graphics(),
        seeds: new Graphics(),
        interaction: new Graphics(),
        measurements: new Graphics(),
        probe: new Graphics(),
        selection: new Graphics(),
        drag: new Graphics(),
        frame: new Graphics(),
      };
      ownedLayers = layers;
      layersRef.current = layers;
      layers.animals.sortableChildren = true;
      const scene = new Container();
      const sceneMask = new Graphics()
        .roundRect(
          TANK_GLASS_LEFT,
          TANK_GLASS_TOP,
          TANK_GLASS_RIGHT - TANK_GLASS_LEFT,
          TANK_GLASS_BOTTOM - TANK_GLASS_TOP,
          12,
        )
        .fill({ color: 0xffffff, alpha: 1 });
      scene.addChild(
        layers.base,
        layers.light,
        layers.substrateAlgae,
        layers.foreground,
        layers.structures,
        layers.algae,
        layers.animals,
        layers.goalGuide,
        layers.seeds,
        layers.interaction,
        layers.measurements,
        layers.probe,
        layers.selection,
        layers.drag,
      );
      scene.mask = sceneMask;
      app.stage.addChild(layers.lamp, scene, sceneMask, layers.frame);
      drawLampRig(layers.lamp);
      drawTank(layers.base);
      drawSubstrateRidge(layers.foreground);
      drawTankFrame(layers.frame);
      applyViewport();
      observer.observe(host);

      // `layersRef` changes outside React state, so the normal drawing effect may
      // already have run and returned while Pixi was still initializing. Paint a
      // complete latest frame here; otherwise a paused setup screen can keep a
      // newly-created layer generation blank until another simulation update.
      const initialSnapshot = snapshotRef.current;
      const initialMotion = sampleMotion(performance.now());
      const initialRenderState = reconcileMotionWithSnapshot(initialSnapshot, initialMotion);
      const initialShowsLight = activeToolRef.current === 'light-probe';
      drawLightField(layers.light, initialSnapshot, initialShowsLight);
      syncStructures(
        layers.structures,
        initialSnapshot,
        ownedTextures,
        ownedDisplays,
        initialRenderState.structures,
        isPendingInventoryHandoff(),
      );
      syncAlgaeParticles(
        layers.substrateAlgae,
        initialSnapshot,
        true,
        true,
      );
      syncAlgaeParticles(
        layers.algae,
        initialSnapshot,
        true,
        true,
      );
      syncAnimals(
        layers.animals,
        initialSnapshot,
        ownedAnimalDisplays,
        initialRenderState.animals,
        initialRenderState.holding,
        initialMotion?.interpolated ?? false,
        true,
        isPendingInventoryHandoff(),
      );
      syncedMotionSequence = initialMotion?.sequence ?? null;
      syncAnimalCarcasses(layers.animals, initialSnapshot, ownedAnimalCarcassDisplays);
      drawGoalGuide(layers.goalGuide, initialSnapshot, showGoalGuideRef.current);
      drawSeeds(layers.seeds, initialSnapshot);
      drawInteraction(layers.interaction, initialSnapshot, isPendingInventoryHandoff());
      drawMeasurements(layers.measurements, initialSnapshot);
      drawProbe(layers.probe, initialSnapshot, activeToolRef.current);
      drawSelection(layers.selection, initialSnapshot);
      lastLightDrawRef.current = `${initialSnapshot.lightField.revision}:${initialShowsLight}`;
      lastAlgaeRevisionRef.current = initialSnapshot.revision;
      lastAlgaeStructureGeometryRef.current = structureAlgaeGeometryKey(initialSnapshot);
      lastSeedsRevisionRef.current = initialSnapshot.revision;
      animalTicker = (ticker: Ticker): void => {
        if (!isCurrentGeneration()) return;
        const currentSnapshot = snapshotRef.current;
        const nowMs = performance.now();
        const motion = sampleMotion(nowMs);
        if (motion) {
          const reconciledStructures = reconcileStructureMotionWithSnapshot(
            currentSnapshot.structures,
            motion.structures,
          );
          if (motion.sequence !== syncedMotionSequence) {
            syncStructures(
              layers.structures,
              currentSnapshot,
              ownedTextures,
              ownedDisplays,
              reconciledStructures,
              isPendingInventoryHandoff(),
            );
            syncAnimals(
              layers.animals,
              currentSnapshot,
              ownedAnimalDisplays,
              motion.animals,
              motion.holding,
              motion.interpolated,
              false,
              isPendingInventoryHandoff(),
            );
            syncedMotionSequence = motion.sequence;
          } else {
            applyStructureMotion(ownedDisplays, reconciledStructures);
            applyAnimalMotion(
              ownedAnimalDisplays,
              motion.animals,
              motion.holding,
              motion.interpolated,
            );
          }
          tryCompletePendingInventoryHandoff(motion.holding, nowMs);
        } else {
          tryCompletePendingInventoryHandoff(currentSnapshot.holding, nowMs);
        }
        animateAnimals(ownedAnimalDisplays, currentSnapshot, ticker.deltaMS / 1000);
        animateAnimalCarcasses(ownedAnimalCarcassDisplays, ticker.deltaMS / 1000);
      };
      app.ticker.add(animalTicker);

      await Promise.all(Object.values(STRUCTURES).map(async (definition) => {
        try {
          const texture = await rasterizeStructureTexture(
            definition.assetPath,
            definition.width,
            definition.height,
          );
          ownedTextures.set(definition.assetPath, texture);
        } catch {
          // The authored silhouette fallback remains aligned with physics.
        }
      }));
      if (!isCurrentGeneration() || layersRef.current !== layers) {
        destroyOwnedTextures();
        destroyOwnedApp();
        return;
      }
      for (const display of ownedDisplays.values()) {
        display.container.destroy({ children: true });
      }
      ownedDisplays.clear();
      layers.structures.removeChildren();
      const latestMotion = sampleMotion(performance.now());
      syncStructures(
        layers.structures,
        snapshotRef.current,
        ownedTextures,
        ownedDisplays,
        latestMotion?.structures,
        isPendingInventoryHandoff(),
      );
    }).catch(() => {
      destroyOwnedTextures();
      releaseOwnedRasterSurfaces();
      destroyOwnedApp();
    });

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        pendingConsumedRef.current = false;
        send({ type: 'cancel-held' });
        if (hasPendingInventoryRef.current) onPendingInventoryReadyRef.current();
        onToolComplete();
      }
      if (snapshotRef.current.holding?.kind === 'structure' && (event.key === 'q' || event.key === 'Q')) {
        send({ type: 'rotate-held', radians: -Math.PI / 36 });
      }
      if (snapshotRef.current.holding?.kind === 'structure' && (event.key === 'e' || event.key === 'E')) {
        send({ type: 'rotate-held', radians: Math.PI / 36 });
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      disposed = true;
      if (effectGenerationRef.current === generation) effectGenerationRef.current += 1;
      observer.disconnect();
      window.removeEventListener('keydown', handleKeyDown);
      if (applyCameraRef.current === applyOwnedCamera) {
        applyCameraRef.current = () => undefined;
      }
      if (structureDisplaysRef.current === ownedDisplays) {
        structureDisplaysRef.current = new Map<string, StructureDisplay>();
      }
      if (animalTicker) app.ticker.remove(animalTicker);
      if (animalDisplaysRef.current === ownedAnimalDisplays) {
        animalDisplaysRef.current = new Map<string, AnimalDisplay>();
      }
      if (animalCarcassDisplaysRef.current === ownedAnimalCarcassDisplays) {
        animalCarcassDisplaysRef.current = new Map<string, AnimalCarcassDisplay>();
      }
      ownedDisplays.clear();
      ownedAnimalDisplays.clear();
      ownedAnimalCarcassDisplays.clear();
      if (layersRef.current === ownedLayers) layersRef.current = null;
      if (appRef.current === app) appRef.current = null;
      if (texturesRef.current === ownedTextures) {
        texturesRef.current = new Map<string, Texture>();
      }
      releaseOwnedRasterSurfaces();
      destroyOwnedApp();
      destroyOwnedTextures();
    };
  }, [onToolComplete, send]);

  useEffect(() => {
    const layers = layersRef.current;
    if (!layers) return;
    const motion = sampleMotion(performance.now());
    const renderState = reconcileMotionWithSnapshot(snapshot, motion);
    const lightKey = `${snapshot.lightField.revision}:${activeTool === 'light-probe'}`;
    if (lastLightDrawRef.current !== lightKey) {
      drawLightField(layers.light, snapshot, activeTool === 'light-probe');
      lastLightDrawRef.current = lightKey;
    }
    syncStructures(
      layers.structures,
      snapshot,
      texturesRef.current,
      structureDisplaysRef.current,
      renderState.structures,
      isPendingInventoryHandoff(),
    );
    syncAnimals(
      layers.animals,
      snapshot,
      animalDisplaysRef.current,
      renderState.animals,
      renderState.holding,
      motion?.interpolated ?? false,
      true,
      isPendingInventoryHandoff(),
    );
    syncAnimalCarcasses(layers.animals, snapshot, animalCarcassDisplaysRef.current);
    const structureGeometryKey = structureAlgaeGeometryKey(snapshot);
    const algaeRevisionChanged = lastAlgaeRevisionRef.current !== snapshot.revision;
    const structureGeometryChanged =
      lastAlgaeStructureGeometryRef.current !== structureGeometryKey;
    if (algaeRevisionChanged || structureGeometryChanged) {
      const nowMs = performance.now();
      if (algaeRevisionChanged) {
        syncAlgaeParticles(
          layers.substrateAlgae,
          snapshot,
          editable,
          false,
          nowMs,
        );
      }
      syncAlgaeParticles(
        layers.algae,
        snapshot,
        editable,
        false,
        nowMs,
      );
      lastAlgaeRevisionRef.current = snapshot.revision;
      lastAlgaeStructureGeometryRef.current = structureGeometryKey;
    }
    if (lastSeedsRevisionRef.current !== snapshot.revision) {
      drawSeeds(layers.seeds, snapshot);
      lastSeedsRevisionRef.current = snapshot.revision;
    }
    drawGoalGuide(layers.goalGuide, snapshot, showGoalGuide);
    drawInteraction(layers.interaction, snapshot, isPendingInventoryHandoff());
    drawMeasurements(layers.measurements, snapshot);
    drawProbe(layers.probe, snapshot, activeTool);
    drawSelection(layers.selection, snapshot);
    tryCompletePendingInventoryHandoff(renderState.holding, performance.now());
  }, [activeTool, editable, hasPendingInventory, showGoalGuide, snapshot]);

  const clientToViewportPoint = (clientX: number, clientY: number): Vec2 => {
    const host = hostRef.current;
    if (!host) return { x: 0, y: 0 };
    const rect = host.getBoundingClientRect();
    return {
      x: (clientX - rect.left) * (host.clientWidth / Math.max(1, rect.width)),
      y: (clientY - rect.top) * (host.clientHeight / Math.max(1, rect.height)),
    };
  };

  const clientToWorldPoint = (clientX: number, clientY: number): Vec2 => {
    const host = hostRef.current;
    if (!host) return { x: TANK_WIDTH / 2, y: TANK_HEIGHT / 2 };
    const viewportPoint = clientToViewportPoint(clientX, clientY);
    const app = appRef.current;
    const scale = app?.stage.scale.x ||
      coverTankScale(host.clientWidth, host.clientHeight) * cameraRef.current.zoom;
    const offsetX = app?.stage.position.x ??
      host.clientWidth / 2 - cameraRef.current.centerX * scale;
    const offsetY = app?.stage.position.y ??
      host.clientHeight / 2 - cameraRef.current.centerY * scale;
    return {
      x: (viewportPoint.x - offsetX) / scale,
      y: (viewportPoint.y - offsetY) / scale,
    };
  };

  const toWorldPoint = (event: React.PointerEvent<HTMLDivElement>): Vec2 =>
    clientToWorldPoint(event.clientX, event.clientY);

  const commitCamera = (nextCamera: CameraState): void => {
    const host = hostRef.current;
    cameraRef.current = host
      ? clampCamera(nextCamera, host.clientWidth, host.clientHeight)
      : nextCamera;
    setCameraZoom(cameraRef.current.zoom);
    applyCameraRef.current();
  };

  const zoomAtClientPoint = (targetZoom: number, clientX: number, clientY: number): void => {
    const host = hostRef.current;
    if (!host?.clientWidth || !host.clientHeight) return;
    const zoom = Math.max(
      fitTankZoom(host.clientWidth, host.clientHeight),
      Math.min(CAMERA_MAX_ZOOM, targetZoom),
    );
    const viewportPoint = clientToViewportPoint(clientX, clientY);
    const worldPoint = clientToWorldPoint(clientX, clientY);
    const scale = coverTankScale(host.clientWidth, host.clientHeight) * zoom;
    commitCamera({
      zoom,
      centerX: worldPoint.x - (viewportPoint.x - host.clientWidth / 2) / scale,
      centerY: worldPoint.y - (viewportPoint.y - host.clientHeight / 2) / scale,
    });
  };

  const zoomAtViewportCenter = (targetZoom: number): void => {
    const host = hostRef.current;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    zoomAtClientPoint(targetZoom, rect.left + rect.width / 2, rect.top + rect.height / 2);
  };

  const fitCamera = (): void => {
    const host = hostRef.current;
    if (!host?.clientWidth || !host.clientHeight) return;
    setPanMode(false);
    commitCamera({
      zoom: fitTankZoom(host.clientWidth, host.clientHeight),
      centerX: CAMERA_SCENE_CENTER_X,
      centerY: CAMERA_SCENE_CENTER_Y,
    });
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const point = toWorldPoint(event);
    latestPointerWorldRef.current = isTankInteractionPoint(point)
      ? point
      : clampTankInteractionPoint(point);
    if (panPointerRef.current === event.pointerId && panLastPointRef.current) {
      const host = hostRef.current;
      if (!host) return;
      const previous = panLastPointRef.current;
      const rect = host.getBoundingClientRect();
      const deltaX = (event.clientX - previous.x) * (host.clientWidth / Math.max(1, rect.width));
      const deltaY = (event.clientY - previous.y) * (host.clientHeight / Math.max(1, rect.height));
      const scale = coverTankScale(host.clientWidth, host.clientHeight) * cameraRef.current.zoom;
      panLastPointRef.current = { x: event.clientX, y: event.clientY };
      commitCamera({
        ...cameraRef.current,
        centerX: cameraRef.current.centerX - deltaX / scale,
        centerY: cameraRef.current.centerY - deltaY / scale,
      });
      return;
    }
    const interactive = isTankInteractionPoint(point);
    if (hasPendingInventory && !pendingConsumedRef.current) {
      if (!interactive) return;
      pendingConsumedRef.current = true;
      pendingHandoffStartedAtRef.current = performance.now();
      onConsumePendingInventory(point);
      return;
    }
    if (hasPendingInventory && pendingConsumedRef.current) {
      send({ type: 'pointer-move', point: interactive ? point : clampTankInteractionPoint(point) });
      return;
    }
    if (dragPointerRef.current === event.pointerId && dragStartRef.current) {
      const boundedPoint = clampTankInteractionPoint(point);
      dragCurrentRef.current = boundedPoint;
      if (layersRef.current) drawDragSelection(layersRef.current.drag, dragStartRef.current, boundedPoint);
      return;
    }
    if (!interactive) {
      if (snapshot.holding && editable) {
        send({ type: 'pointer-move', point: clampTankInteractionPoint(point) });
        return;
      }
      if (activeTool === 'light-probe' || activeTool === 'temperature-probe') {
        if (snapshot.probe) send({ type: 'clear-probe' });
      }
      return;
    }
    if (snapshot.holding && editable) send({ type: 'pointer-move', point });
    else if (activeTool === 'light-probe' || activeTool === 'temperature-probe') {
      send({ type: 'probe', point });
    }
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    const host = hostRef.current;
    const canPan = Boolean(host && canPanTankCamera(
      host.clientWidth,
      host.clientHeight,
      cameraRef.current.zoom,
    ));
    if (event.button === 1) {
      event.preventDefault();
      if (shouldStartCameraPan(event.button, panMode, canPan)) {
        panPointerRef.current = event.pointerId;
        panLastPointRef.current = { x: event.clientX, y: event.clientY };
        setIsPanning(true);
        event.currentTarget.setPointerCapture(event.pointerId);
      }
      // A middle click is reserved for the camera even when the current fit
      // view has nowhere to pan. It must never fall through to placement.
      return;
    }
    const point = toWorldPoint(event);
    latestPointerWorldRef.current = isTankInteractionPoint(point)
      ? point
      : clampTankInteractionPoint(point);
    if (isSecondaryPointerGesture(event.button, event.ctrlKey)) {
      event.preventDefault();
      secondaryPointerCancelAtRef.current = performance.now();
      pendingConsumedRef.current = false;
      send({ type: 'cancel-held' });
      if (hasPendingInventory) onPendingInventoryReady();
      onToolComplete();
      return;
    }
    if (shouldStartCameraPan(event.button, panMode, canPan)) {
      panPointerRef.current = event.pointerId;
      panLastPointRef.current = { x: event.clientX, y: event.clientY };
      setIsPanning(true);
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (!isTankInteractionPoint(point)) return;
    if (hasPendingInventory || (pendingConsumedRef.current && !snapshot.holding)) {
      if (!pendingConsumedRef.current) {
        pendingConsumedRef.current = true;
        pendingHandoffStartedAtRef.current = performance.now();
        onConsumePendingInventory(point);
      }
      // The worker handles commands in FIFO order. Sending the drop directly
      // after the inventory pick makes this first tank click the placement
      // click too, even when no pointermove occurred or the pick snapshot has
      // not made the round trip back from the worker yet.
      send({ type: 'drop-held', point });
      pendingConsumedRef.current = false;
      onPendingInventoryReady();
      onToolComplete();
      return;
    }
    if (snapshot.holding) {
      send({ type: 'drop-held', point });
      pendingConsumedRef.current = false;
      if (snapshot.holding.valid) onToolComplete();
      return;
    }
    if (activeTool === 'light-probe' || activeTool === 'temperature-probe') {
      send({
        type: 'place-measurement',
        kind: activeTool === 'light-probe' ? 'light' : 'temperature',
        point,
      });
      onToolComplete();
      return;
    }
    if (activeTool === 'move' && editable) send({ type: 'pick-at', point });
    else if (selectionFilter === 'organism' || selectionFilter === 'all') {
      dragStartRef.current = point;
      dragStartClientRef.current = { x: event.clientX, y: event.clientY };
      dragCurrentRef.current = point;
      dragPointerRef.current = event.pointerId;
      event.currentTarget.setPointerCapture(event.pointerId);
    } else send({ type: 'select-at', point, filter: selectionFilter });
  };

  const finishDragSelection = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (panPointerRef.current === event.pointerId) {
      panPointerRef.current = null;
      panLastPointRef.current = null;
      setIsPanning(false);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      return;
    }
    if (dragPointerRef.current !== event.pointerId || !dragStartRef.current) return;
    const from = dragStartRef.current;
    const to = clampTankInteractionPoint(toWorldPoint(event));
    const clientStart = dragStartClientRef.current ?? { x: event.clientX, y: event.clientY };
    if (isScreenDrag(clientStart, { x: event.clientX, y: event.clientY })) {
      send({ type: 'select-region', from, to, filter: 'organism' });
    }
    else send({ type: 'select-at', point: to, filter: selectionFilter === 'all' ? 'all' : 'organism' });
    dragStartRef.current = null;
    dragStartClientRef.current = null;
    dragCurrentRef.current = null;
    dragPointerRef.current = null;
    if (layersRef.current) drawDragSelection(layersRef.current.drag, null, null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const cancelPointerInteraction = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (panPointerRef.current === event.pointerId) {
      panPointerRef.current = null;
      panLastPointRef.current = null;
      setIsPanning(false);
    }
    if (dragPointerRef.current === event.pointerId) {
      dragStartRef.current = null;
      dragStartClientRef.current = null;
      dragCurrentRef.current = null;
      dragPointerRef.current = null;
      if (layersRef.current) drawDragSelection(layersRef.current.drag, null, null);
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div
      ref={hostRef}
      className={`aquarium-canvas tool-${activeTool} ${snapshot.holding ? 'is-holding' : ''} ${panMode ? 'camera-pan-active' : ''} ${isPanning ? 'camera-is-panning' : ''} ${cameraZoom > CAMERA_COVER_ZOOM + CAMERA_EPSILON ? 'camera-is-zoomed' : ''}`}
      onPointerMove={handlePointerMove}
      onPointerDown={handlePointerDown}
      onPointerUp={finishDragSelection}
      onPointerCancel={cancelPointerInteraction}
      onLostPointerCapture={cancelPointerInteraction}
      onAuxClick={(event) => {
        if (event.button === 1) event.preventDefault();
      }}
      onPointerLeave={() => {
        if ((activeTool === 'light-probe' || activeTool === 'temperature-probe') && !dragStartRef.current) {
          if (snapshot.probe) send({ type: 'clear-probe' });
        }
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        const secondaryCancelAt = secondaryPointerCancelAtRef.current;
        secondaryPointerCancelAtRef.current = null;
        if (secondaryCancelAt !== null && performance.now() - secondaryCancelAt < 750) return;
        pendingConsumedRef.current = false;
        send({ type: 'cancel-held' });
        if (hasPendingInventory) onPendingInventoryReady();
        onToolComplete();
      }}
      onWheel={(event) => {
        if (editable && snapshot.holding?.kind === 'structure') {
          event.preventDefault();
          send({ type: 'rotate-held', radians: Math.sign(event.deltaY) * (Math.PI / 36) });
          return;
        }
        if (event.deltaY === 0) return;
        event.preventDefault();
        zoomAtClientPoint(
          cameraRef.current.zoom * Math.exp(-event.deltaY * 0.0015),
          event.clientX,
          event.clientY,
        );
      }}
    >
      <div
        className="aquarium-camera-controls"
        role="group"
        aria-label="수조 화면 조작"
        onPointerDown={(event) => event.stopPropagation()}
        onPointerUp={(event) => event.stopPropagation()}
        onWheel={(event) => event.stopPropagation()}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <button
          type="button"
          className="aquarium-camera-button aquarium-camera-pan"
          aria-label={panMode ? '화면 이동 모드 끄기' : '화면 이동 모드 켜기'}
          aria-pressed={panMode}
          title={panMode ? '화면 이동 모드 끄기' : '화면 이동'}
          disabled={!cameraCanPan || Boolean(snapshot.holding || hasPendingInventory)}
          onClick={() => setPanMode((enabled) => !enabled)}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M8.5 14V7.2a1.5 1.5 0 0 1 3 0V11M11.5 11V5.6a1.5 1.5 0 0 1 3 0V11M14.5 11V7a1.5 1.5 0 0 1 3 0v4M17.5 11V9.2a1.5 1.5 0 0 1 3 0v4.5c0 4.3-2.7 7.3-7.1 7.3H12c-2.1 0-3.6-.8-4.8-2.4L4 14.4a1.7 1.7 0 0 1 2.6-2.1L8.5 14" />
          </svg>
        </button>
        <button
          type="button"
          className="aquarium-camera-button aquarium-camera-zoom-out"
          aria-label="수조 축소"
          title="축소"
          disabled={cameraZoom <= cameraMinimumZoom + CAMERA_EPSILON}
          onClick={() => {
            const steppedZoom = cameraRef.current.zoom / CAMERA_BUTTON_STEP;
            zoomAtViewportCenter(
              cameraRef.current.zoom > CAMERA_COVER_ZOOM && steppedZoom < CAMERA_COVER_ZOOM
                ? CAMERA_COVER_ZOOM
                : steppedZoom,
            );
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M7 12h10" /></svg>
        </button>
        <output className="aquarium-camera-zoom-label" aria-live="polite">
          {Math.round(cameraZoom * 100)}%
        </output>
        <button
          type="button"
          className="aquarium-camera-button aquarium-camera-zoom-in"
          aria-label="수조 확대"
          title="확대"
          disabled={cameraZoom >= CAMERA_MAX_ZOOM}
          onClick={() => zoomAtViewportCenter(
            cameraRef.current.zoom < CAMERA_COVER_ZOOM - CAMERA_EPSILON
              ? CAMERA_COVER_ZOOM
              : cameraRef.current.zoom * CAMERA_BUTTON_STEP,
          )}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 7v10M7 12h10" /></svg>
        </button>
        <button
          type="button"
          className="aquarium-camera-button aquarium-camera-reset"
          aria-label="수조 전체 보기"
          title="수조 전체 보기"
          disabled={cameraIsFit}
          onClick={fitCamera}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 5H5v4M15 5h4v4M9 19H5v-4M15 19h4v-4" />
          </svg>
        </button>
      </div>
    </div>
  );
}
