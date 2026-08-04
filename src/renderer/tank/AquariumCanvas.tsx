import 'pixi.js/unsafe-eval';
import {
  Application,
  BufferImageSource,
  Container,
  Graphics,
  GraphicsContext,
  Sprite,
  Texture,
  Ticker,
  UPDATE_PRIORITY,
} from 'pixi.js';
import { useEffect, useRef, useState } from 'react';
import {
  ALGAE_RENDER_TRACE_BIOMASS,
  ALGAE_VISIBLE_BIOMASS,
  MICROBES,
  SCENARIOS,
  SPECIES,
  STRUCTURES,
} from '../../simulation/config';
import {
  animalCarcassTransitionSettled,
  animalCarcassVisualSnapshotChanged,
  animalCarcassVisualDrop,
  daphniaVisualScale,
  presentedAnimalCarcasses,
  shrimpVisualScale,
  writeAnimalCarcassVisualSnapshot,
  type AnimalCarcassVisualSnapshot,
} from '../../simulation/animalPresentation';
import type {
  SimulationMotionFrame,
  SimulationMotionSource,
} from '../hooks/useSimulation';
import {
  GROUND_Y,
  TANK_HEIGHT,
  TANK_WIDTH,
  WATER_TOP,
  type AnimalCarcassSnapshot,
  type AnimalSnapshot,
  type InteractionTool,
  type MicrobeGuildId,
  type SelectionFilter,
  type SimulationCommand,
  type SimulationSnapshot,
  type StructureSnapshot,
  type SurfaceCellSnapshot,
  type Vec2,
  type WaterQualityVariable,
} from '../../simulation/types';
import {
  structureAuthoredPolygonToWorld,
  structureVisualOffset,
} from '../../simulation/structureGeometry';
import {
  compareVallisneriaDepth,
  vallisneriaLeaves,
  vallisneriaRenderDepth,
  type VallisneriaRenderDepth,
} from '../../simulation/vallisneriaGeometry';
import {
  canPanTankCamera,
  cameraStateFromStoredTransform,
  clampTankInteractionPoint,
  coverTankScale,
  fitTankZoom,
  freshTankCameraState,
  minimumTankZoom,
  isScreenDrag,
  isTankInteractionPoint,
  shouldStartCameraPan,
  tankCameraCenterBounds,
  wheelZoomTarget,
} from './cameraInteraction';
import {
  CAMERA_SCENE_CENTER_X,
  CAMERA_SCENE_CENTER_Y,
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
  createTankVisualGeometry,
  type TankVisualGeometry,
} from './tankVisualGeometry';
import {
  createReusableMotionInterpolator,
  reconcileMotionWithSnapshot,
} from './motionInterpolation';
import { BoundedReusePool } from './boundedReusePool';
import {
  RICEFISH_BITE_DURATION_SECONDS,
  RICEFISH_SWIM_RATE_MULTIPLIER,
  ricefishConsumedFood,
  ricefishMouthGape,
  ricefishSideSwingPose,
  ricefishSwimPose,
} from './ricefishAnimation';
import {
  normalizeWaterQualityForDisplay,
  normalizePelagicForDisplay,
  normalizeWaterQualityValue,
  pelagicOverlayAlpha,
  pelagicRenderPlan,
  pelagicVisualMaximum,
  waterQualityVisualRange,
  waterQualityOverlayAlpha,
  type PelagicLayer,
  type WaterQualityLayer,
} from './waterQualityOverlay';
import {
  createPhytoplanktonVisualPlan,
  smoothPhytoplanktonConcentration,
  writePhytoplanktonBloomPixels,
} from './phytoplanktonPresentation';
interface AquariumCanvasProps {
  snapshot: SimulationSnapshot;
  motionSource: SimulationMotionSource;
  activeTool: InteractionTool;
  selectionFilter: SelectionFilter;
  send: (command: SimulationCommand) => void;
  editable: boolean;
  hasPendingInventory: boolean;
  pendingInventoryKey: string | null;
  onConsumePendingInventory: (point: Vec2) => void;
  onPendingInventoryReady: () => void;
  onToolComplete: (completedTool: InteractionTool) => void;
  onClearSelection: () => void;
  onCameraChange?: (transform: AquariumCameraTransform) => void;
  initialCameraTransform?: AquariumCameraTransform | null;
  cameraResetToken?: number;
  showGoalGuide?: boolean;
  waterQualityLayers: readonly WaterQualityLayer[];
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
export const ALGAE_VISUAL_LEVEL_COUNT = 24;
export const ALGAE_VISUAL_SATURATION_BIOMASS = 1;
export const ALGAE_PARTICLE_JITTER_SPAN = 0.35;
export const ALGAE_PARTICLE_ALPHA_FLOOR = 0.58;
export type AlgaeSpeciesId = 'oedogonium' | 'nitzschia';

export const algaeVisualRatio = (amount: number): number => {
  if (!Number.isFinite(amount) || amount <= ALGAE_RENDER_TRACE_BIOMASS) return 0;
  // The ecological rewrite lowered standing biomass per surface sample by
  // roughly two orders of magnitude. Preserve the packaged renderer and lift
  // only its perceptual response so a real, spread-out film does not collapse
  // into the palest visual bucket. A cube-root still reveals real trace biomass
  // while leaving more distance between a grazed film and a dense colony than
  // the former fourth-root response.
  return Math.cbrt(Math.max(0, Math.min(1, amount)));
};

/** Quantize only the detail geometry; the soft wash keeps the continuous ratio. */
export const algaeVisualLevel = (amount: number): number => {
  const visible = algaeVisualRatio(amount);
  if (visible <= 0) return 0;
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
  return ALGAE_PARTICLE_ALPHA_FLOOR +
    visible * (1 - ALGAE_PARTICLE_ALPHA_FLOOR);
};

export const surfaceAlgaeSpeciesShare = (
  biomass: SurfaceCellSnapshot['biomass'],
  speciesId: AlgaeSpeciesId,
): number => {
  const oedogonium = Number.isFinite(biomass.oedogonium)
    ? Math.max(0, biomass.oedogonium)
    : 0;
  const nitzschia = Number.isFinite(biomass.nitzschia)
    ? Math.max(0, biomass.nitzschia)
    : 0;
  const total = oedogonium + nitzschia;
  return total > 0
    ? (speciesId === 'oedogonium' ? oedogonium : nitzschia) / total
    : 0;
};

export const algaeSpeciesWashAlpha = (
  cell: SurfaceCellSnapshot,
  speciesId: AlgaeSpeciesId,
): number => {
  const visualRatio = algaeVisualRatio(cell.biomass[speciesId]);
  if (visualRatio <= 0) return 0;
  return algaeParticleAlpha(visualRatio * ALGAE_VISUAL_LEVEL_COUNT) *
    surfaceAlgaeSpeciesShare(cell.biomass, speciesId);
};

export const algaeDetailCount = (
  maximumCount: number,
  visualLevel: number,
): number => {
  if (maximumCount <= 0 || visualLevel <= 0) return 0;
  const visible = Math.max(
    0,
    Math.min(1, visualLevel / ALGAE_VISUAL_LEVEL_COUNT),
  );
  return Math.max(1, Math.round(maximumCount * (0.2 + visible * 0.8)));
};

/**
 * Use the restrained identity-strand count from the July packaged renderer.
 * Trace cells receive only one mark, while the soft wash carries their mass.
 */
export const oedogoniumFilamentCount = (
  _cellId: string,
  visualLevel: number,
  _biomass?: number,
  speciesShare = 1,
): number => Math.round(
  algaeDetailCount(
    ALGAE_OEDOGONIUM_DETAILS_PER_ACTIVE_CELL,
    visualLevel,
  ) * Math.max(0, Math.min(1, speciesShare)),
);

export const shouldTriggerShrimpGrazingPulse = (
  previousSequence: number | null,
  nextSequence: number,
  previousConsumedBiomass: number,
  nextConsumedBiomass: number,
): boolean => previousSequence !== null &&
  nextSequence > previousSequence &&
  Number.isFinite(previousConsumedBiomass) &&
  Number.isFinite(nextConsumedBiomass) &&
  nextConsumedBiomass > previousConsumedBiomass + 1e-9;

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

const isProbeInteractionTool = (tool: InteractionTool): boolean =>
  tool === 'light-probe' || tool === 'temperature-probe' || tool === 'water-quality-probe';

const algaeKeyNumber = (value: number): number => Math.round(value * 1000) / 1000;

const algaeFineVisualAmount = (value: number): number => Math.round(
  Math.min(
    ALGAE_VISUAL_SATURATION_BIOMASS,
    Math.max(0, value),
  ) * 500,
);

export const algaeCellVisualKey = (cell: SurfaceCellSnapshot): string => [
  cell.id,
  cell.surfaceKind,
  algaeKeyNumber(cell.x),
  algaeKeyNumber(cell.y),
  algaeKeyNumber(cell.cellSize),
  // The immutable brush sprites are cheap and bounded, so retain real grazing changes
  // instead of waiting for a coarse 1/24 visual-level boundary. A 0.002
  // biomass bucket is below one ordinary multi-second bite but avoids
  // rebuilding for floating-point noise. Values above visual saturation are
  // intentionally equivalent.
  algaeFineVisualAmount(cell.biomass.nitzschia),
  algaeFineVisualAmount(cell.biomass.oedogonium),
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

const defaultCamera = (
  geometry: TankVisualGeometry = createTankVisualGeometry(),
): CameraState => ({
  zoom: CAMERA_COVER_ZOOM,
  centerX: geometry.sceneCenterX,
  centerY: geometry.sceneCenterY,
});

const clampCamera = (
  camera: CameraState,
  width: number,
  height: number,
  geometry: TankVisualGeometry = createTankVisualGeometry(),
): CameraState => {
  const zoom = Math.max(
    minimumTankZoom(width, height, geometry),
    Math.min(CAMERA_MAX_ZOOM, camera.zoom),
  );
  const scale = coverTankScale(width, height, geometry) * zoom;
  if (!Number.isFinite(scale) || scale <= 0) {
    return { ...defaultCamera(geometry), zoom };
  }
  const bounds = tankCameraCenterBounds(width, height, zoom, geometry);
  const centerX = Math.max(bounds.minX, Math.min(bounds.maxX, camera.centerX));
  const centerY = Math.max(bounds.minY, Math.min(bounds.maxY, camera.centerY));
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
  speciesId: AnimalSnapshot['speciesId'];
  lifeStage: AnimalSnapshot['lifeStage'];
  sex: AnimalSnapshot['sex'];
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
  consumedBiomass: number;
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
  speciesId: AnimalSnapshot['speciesId'];
  lifeStage: AnimalSnapshot['lifeStage'];
  container: Container;
  selection: Graphics;
  placement: Graphics;
  art: Container;
  head: Container;
  abdomen: Container[];
  tail: Container;
  legs: Container;
  antennae: Container;
  pectoral?: Container;
  dorsalFin?: Container;
  analFin?: Container;
  pelvicFin?: Container;
  closedMouth?: Graphics;
  feedingMouth?: Container;
  feedingJaw?: Container;
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
  swimPhase: number;
  feedingPulse: number;
  lastFeedingMotionSequence: number | null;
  lastFeedingConsumedBiomass: number | null;
  phaseOffset: number;
}

/**
 * Bite telemetry is evaluated from authoritative worker samples, not from the
 * values interpolated between them. This makes one cumulative intake increase
 * produce one pulse even though the same sample is painted across several
 * animation frames. A missing or rewound sequence is a baseline (new display,
 * reset, or load), never a bite.
 */
export const shouldTriggerRicefishBitePulse = (
  previousSequence: number | null,
  nextSequence: number,
  previousConsumedBiomass: number,
  nextConsumedBiomass: number,
): boolean => previousSequence !== null &&
  nextSequence > previousSequence &&
  ricefishConsumedFood(previousConsumedBiomass, nextConsumedBiomass);

interface AnimalCarcassDisplay {
  speciesId: AnimalCarcassSnapshot['speciesId'];
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
  lastVisualSnapshot: AnimalCarcassVisualSnapshot;
  /**
   * Full corpse pose work is needed only while handing off a just-dead living
   * rig or when a one-second ecology snapshot advances sinking/fading.
   */
  animationSettled: boolean;
}

type AnimalDisplayPool = BoundedReusePool<string, AnimalDisplay>;
type AnimalCarcassDisplayPool = BoundedReusePool<string, AnimalCarcassDisplay>;

const ANIMAL_DISPLAY_POOL_LIMIT_PER_KEY = 64;
const ANIMAL_CARCASS_POOL_LIMIT_PER_KEY = 32;
const animalDisplayPoolKey = (
  speciesId: AnimalSnapshot['speciesId'],
  lifeStage: AnimalSnapshot['lifeStage'],
  sex: AnimalSnapshot['sex'] = 'female',
): string => speciesId === 'japanese-ricefish'
  ? `${speciesId}:${lifeStage}:${sex}`
  : `${speciesId}:body`;

const animalCarcassDisplayPoolKey = (
  speciesId: AnimalCarcassSnapshot['speciesId'],
): string => speciesId;

interface AquariumLayers {
  lamp: Graphics;
  base: Graphics;
  light: Sprite;
  plankton: Container;
  substrateAlgae: Container;
  foreground: Graphics;
  structures: Container;
  algae: Container;
  analysis: Container;
  animals: Container;
  plantsBack: Graphics;
  plantsFront: Graphics;
  nightTint: Graphics;
  spatialDebug: Graphics;
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
  pixels: Uint8Array;
  source: BufferImageSource;
  texture: Texture;
}

const rasterSurfaces = new WeakMap<Sprite, RasterSurface>();

interface PhytoplanktonSurface {
  hazeSprite: Sprite;
  hazePixels: Uint8Array;
  hazeSource: BufferImageSource | null;
  hazeTexture: Texture | null;
  hazeColumns: number;
  hazeRows: number;
  hazeHorizontal: Float64Array;
  hazeSmoothed: Float64Array;
  speckTexture: Texture;
  speckSprites: Sprite[];
}

const phytoplanktonSurfaces = new WeakMap<Container, PhytoplanktonSurface>();

const createPhytoplanktonMarkTexture = (
  size: number,
  soft: boolean,
): Texture => {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (context) {
    const center = size / 2;
    if (soft) {
      const gradient = context.createRadialGradient(
        center,
        center,
        0,
        center,
        center,
        center,
      );
      gradient.addColorStop(0, 'rgba(255, 255, 255, 0.72)');
      gradient.addColorStop(0.62, 'rgba(255, 255, 255, 0.28)');
      gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
      context.fillStyle = gradient;
    } else {
      context.fillStyle = '#ffffff';
    }
    context.beginPath();
    context.arc(center, center, center - 0.5, 0, Math.PI * 2);
    context.fill();
  }
  const texture = Texture.from(canvas);
  texture.source.scaleMode = 'linear';
  return texture;
};

const createPhytoplanktonLayer = (): Container => {
  const layer = new Container();
  const hazeSprite = new Sprite(Texture.EMPTY);
  layer.addChild(hazeSprite);
  phytoplanktonSurfaces.set(layer, {
    hazeSprite,
    hazePixels: new Uint8Array(0),
    hazeSource: null,
    hazeTexture: null,
    hazeColumns: 0,
    hazeRows: 0,
    hazeHorizontal: new Float64Array(0),
    hazeSmoothed: new Float64Array(0),
    speckTexture: createPhytoplanktonMarkTexture(8, false),
    speckSprites: [],
  });
  return layer;
};

const ensurePhytoplanktonHazeSurface = (
  surface: PhytoplanktonSurface,
  columns: number,
  rows: number,
  snapshot: SimulationSnapshot,
): void => {
  if (
    surface.hazeColumns === columns &&
    surface.hazeRows === rows &&
    surface.hazeSource &&
    !surface.hazeSource.destroyed
  ) return;

  if (surface.hazeTexture && !surface.hazeTexture.destroyed) {
    surface.hazeTexture.destroy(true);
  }
  surface.hazeColumns = columns;
  surface.hazeRows = rows;
  surface.hazePixels = new Uint8Array(columns * rows * 4);
  surface.hazeHorizontal = new Float64Array(columns * rows);
  surface.hazeSmoothed = new Float64Array(columns * rows);
  surface.hazeSource = new BufferImageSource({
    resource: surface.hazePixels,
    width: columns,
    height: rows,
    format: 'rgba8unorm',
    alphaMode: 'premultiply-alpha-on-upload',
    autoGarbageCollect: false,
  });
  surface.hazeSource.scaleMode = 'linear';
  surface.hazeTexture = new Texture({ source: surface.hazeSource });
  surface.hazeSprite.texture = surface.hazeTexture;
  surface.hazeSprite.position.set(0, snapshot.tank.waterTop);
  surface.hazeSprite.setSize(
    snapshot.tank.width,
    snapshot.tank.groundY - snapshot.tank.waterTop,
  );
};

const releasePhytoplanktonLayer = (layer: Container): void => {
  const surface = phytoplanktonSurfaces.get(layer);
  if (!surface) return;
  const sprites = layer.removeChildren();
  for (const sprite of sprites) {
    sprite.destroy();
  }
  if (surface.hazeTexture && !surface.hazeTexture.destroyed) {
    surface.hazeTexture.destroy(true);
  }
  if (!surface.speckTexture.destroyed) surface.speckTexture.destroy(true);
  surface.hazePixels = new Uint8Array(0);
  surface.hazeHorizontal = new Float64Array(0);
  surface.hazeSmoothed = new Float64Array(0);
  surface.hazeSource = null;
  surface.speckSprites.length = 0;
  phytoplanktonSurfaces.delete(layer);
};

const reusableImageData = new WeakMap<CanvasRenderingContext2D, ImageData>();

const getReusableImageData = (
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
): ImageData => {
  const existing = reusableImageData.get(context);
  if (existing && existing.width === width && existing.height === height) return existing;
  const pixels = context.createImageData(width, height);
  reusableImageData.set(context, pixels);
  return pixels;
};

const getRasterSurface = (layer: Sprite, width: number, height: number): RasterSurface | null => {
  const existing = rasterSurfaces.get(layer);
  if (existing && existing.canvas.width === width && existing.canvas.height === height &&
    !existing.texture.destroyed && !existing.source.destroyed) {
    return existing;
  }
  if (existing && !existing.texture.destroyed) existing.texture.destroy(true);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  const pixels = new Uint8Array(width * height * 4);
  const source = new BufferImageSource({
    resource: pixels,
    width,
    height,
    format: 'rgba8unorm',
    alphaMode: 'premultiply-alpha-on-upload',
    autoGarbageCollect: false,
  });
  source.scaleMode = 'linear';
  const texture = new Texture({ source });
  const surface = { canvas, context, pixels, source, texture };
  rasterSurfaces.set(layer, surface);
  layer.texture = texture;
  return surface;
};

/**
 * Uploads through Pixi's typed-buffer path, which uses texSubImage2D for an
 * existing WebGL texture. Uploading the HTML canvas itself made Chromium keep
 * one native backing-store generation per ecology snapshot on macOS.
 */
const uploadRasterSurface = (surface: RasterSurface): void => {
  const { canvas, context, pixels, source } = surface;
  const frame = context.getImageData(0, 0, canvas.width, canvas.height);
  pixels.set(frame.data);
  source.update();
};

const releaseRasterSurface = (layer: Sprite): void => {
  const surface = rasterSurfaces.get(layer);
  if (surface && !surface.texture.destroyed) surface.texture.destroy(true);
  rasterSurfaces.delete(layer);
};

interface AnalysisSurface {
  primary: Sprite;
  details: Graphics;
  pixels: Uint8Array;
  source: BufferImageSource | null;
  texture: Texture | null;
  columns: number;
  rows: number;
}

const analysisSurfaces = new WeakMap<Container, AnalysisSurface>();

const createAnalysisLayer = (): Container => {
  const layer = new Container();
  const primary = new Sprite(Texture.EMPTY);
  const details = new Graphics();
  layer.addChild(primary, details);
  analysisSurfaces.set(layer, {
    primary,
    details,
    pixels: new Uint8Array(0),
    source: null,
    texture: null,
    columns: 0,
    rows: 0,
  });
  return layer;
};

const ensureAnalysisPrimary = (
  surface: AnalysisSurface,
  columns: number,
  rows: number,
  snapshot: SimulationSnapshot,
): void => {
  if (
    surface.columns === columns &&
    surface.rows === rows &&
    surface.source &&
    !surface.source.destroyed
  ) return;

  if (surface.texture && !surface.texture.destroyed) {
    surface.texture.destroy(true);
  }
  surface.columns = columns;
  surface.rows = rows;
  surface.pixels = new Uint8Array(columns * rows * 4);
  surface.source = new BufferImageSource({
    resource: surface.pixels,
    width: columns,
    height: rows,
    format: 'rgba8unorm',
    alphaMode: 'premultiply-alpha-on-upload',
    autoGarbageCollect: false,
  });
  surface.source.scaleMode = 'linear';
  surface.texture = new Texture({ source: surface.source });
  surface.primary.texture = surface.texture;
  surface.primary.position.set(0, 0);
  surface.primary.setSize(
    snapshot.tank.width,
    snapshot.tank.groundY - snapshot.tank.waterTop,
  );
};

const writeAnalysisPixel = (
  surface: AnalysisSurface,
  index: number,
  color: number,
  alpha: number,
): void => {
  const offset = index * 4;
  surface.pixels[offset] = (color >> 16) & 0xff;
  surface.pixels[offset + 1] = (color >> 8) & 0xff;
  surface.pixels[offset + 2] = color & 0xff;
  surface.pixels[offset + 3] = Math.round(Math.max(0, Math.min(1, alpha)) * 255);
};

const publishAnalysisPrimary = (surface: AnalysisSurface): void => {
  surface.source?.update();
  surface.primary.visible = true;
};

const releaseAnalysisLayer = (layer: Container): void => {
  const surface = analysisSurfaces.get(layer);
  if (!surface) return;
  if (surface.texture && !surface.texture.destroyed) {
    surface.texture.destroy(true);
  }
  surface.primary.destroy();
  surface.details.destroy({ context: true });
  layer.removeChildren();
  analysisSurfaces.delete(layer);
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

const drawTank = (layer: Graphics, snapshot: SimulationSnapshot): void => {
  const { width, height, waterTop, groundY } = snapshot.tank;
  layer.clear();
  // The glass headspace is genuinely inside the tank. Water begins only at
  // WATER_TOP, so neither the external lamp nor this air band can look wet.
  layer.rect(0, 0, width, waterTop).fill({ color: 0xbfcac3, alpha: 1 });
  const bands = height - waterTop;
  for (let index = 0; index < bands; index += 1) {
    const ratio = index / Math.max(1, bands - 1);
    layer
      .rect(0, waterTop + index, width, 2)
      .fill({ color: mixColor(0x5b9ca3, 0x356b78, ratio), alpha: 1 });
  }
  layer
    .rect(0, groundY - 30, width, height - groundY + 30)
    .fill({ color: 0x95785a, alpha: 0.86 });
  for (let index = 0; index < 80; index += 1) {
    const x = (index * 89 + 17) % width;
    const y = groundY - 21 + ((index * 37) % 82);
    const radius = 2 + ((index * 13) % 6);
    layer.circle(x, y, radius).fill({
      color: index % 2 ? 0xc8aa7b : 0x725b45,
      alpha: 0.42,
    });
  }
};

const drawSubstrateRidge = (layer: Graphics, snapshot: SimulationSnapshot): void => {
  const { width, waterTop, groundY } = snapshot.tank;
  const segmentScale = width / TANK_WIDTH;
  layer.clear();
  layer
    .moveTo(-40, waterTop + 2)
    .bezierCurveTo(
      250 * segmentScale,
      waterTop - 2,
      560 * segmentScale,
      waterTop + 5,
      840 * segmentScale,
      waterTop + 1,
    )
    .bezierCurveTo(
      1030 * segmentScale,
      waterTop - 3,
      1130 * segmentScale,
      waterTop + 3,
      width + 40,
      waterTop,
    )
    .stroke({ color: 0x315f67, width: 6, alpha: 0.72 });
  layer
    .moveTo(-40, waterTop)
    .bezierCurveTo(
      250 * segmentScale,
      waterTop - 4,
      560 * segmentScale,
      waterTop + 3,
      840 * segmentScale,
      waterTop - 1,
    )
    .bezierCurveTo(
      1030 * segmentScale,
      waterTop - 5,
      1130 * segmentScale,
      waterTop + 1,
      width + 40,
      waterTop - 2,
    )
    .stroke({ color: 0xd9eee7, width: 2.5, alpha: 0.92 });
  layer
    .moveTo(0, groundY - 28)
    .bezierCurveTo(
      260 * segmentScale,
      groundY - 36,
      520 * segmentScale,
      groundY - 19,
      770 * segmentScale,
      groundY - 30,
    )
    .bezierCurveTo(
      940 * segmentScale,
      groundY - 39,
      1080 * segmentScale,
      groundY - 23,
      width,
      groundY - 31,
    )
    .stroke({ color: 0xe2cda0, width: 8, alpha: 0.42 })
    .stroke({ color: 0x493d32, width: 4, alpha: 0.82 });
};

const drawTankFrame = (layer: Graphics, geometry: TankVisualGeometry): void => {
  layer.clear();
  const glassWidth = geometry.glassRight - geometry.glassLeft;
  const glassHeight = geometry.glassBottom - geometry.glassTop;
  layer
    .roundRect(
      geometry.glassLeft + 1,
      geometry.glassTop + 2,
      glassWidth - 2,
      glassHeight - 3,
      13,
    )
    .stroke({ color: 0x1e2c2b, width: 16, alpha: 0.2 });
  layer
    .roundRect(geometry.glassLeft, geometry.glassTop, glassWidth, glassHeight, 12)
    .stroke({ color: 0x3b4c4c, width: 10, alpha: 1 });
  layer
    .roundRect(
      geometry.glassLeft + 7,
      geometry.glassTop + 7,
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
  const { context } = surface;
  const pixels = getReusableImageData(context, columns, rows);
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
  uploadRasterSurface(surface);
  layer.position.set(0, snapshot.tank.waterTop);
  layer.setSize(
    snapshot.tank.width,
    snapshot.tank.groundY - snapshot.tank.waterTop,
  );
};

const WATER_QUALITY_PALETTES: Record<WaterQualityVariable, {
  low: number;
  high: number;
}> = {
  organicMatter: { low: 0xf1e2b4, high: 0x6b341d },
  toxicWaste: { low: 0xd4e2dc, high: 0xd53b4f },
  nutrients: { low: 0xead58d, high: 0x348c50 },
  oxygen: { low: 0x3f6173, high: 0x55cad5 },
};

const isMicrobeLayer = (
  layer: WaterQualityLayer | null,
): layer is MicrobeGuildId => layer === 'decomposer' || layer === 'nitrifier';

const isPelagicLayer = (layer: WaterQualityLayer): layer is PelagicLayer =>
  layer === 'planktonicDecomposer' || layer === 'phytoplankton';
const PELAGIC_PALETTES: Record<PelagicLayer, { low: number; high: number; contour: number }> = {
  planktonicDecomposer: { low: 0xe2d8bd, high: 0x9b7449, contour: 0x8a633f },
  phytoplankton: { low: 0xdce9c4, high: 0x4c8a4f, contour: 0x3f7f48 },
};

const pelagicValues = (
  snapshot: SimulationSnapshot,
  layer: PelagicLayer,
): readonly number[] => layer === 'planktonicDecomposer'
  ? snapshot.biogeochemistry.water.planktonicDecomposer
  : snapshot.biogeochemistry.water.phytoplankton;

const SECONDARY_WATER_COLORS: Record<WaterQualityVariable, number> = {
  organicMatter: 0x6f4c2f,
  toxicWaste: 0xc64358,
  nutrients: 0x5c914c,
  oxygen: 0x49a9c1,
};

const WATER_QUALITY_DRAW_ORDER: readonly WaterQualityVariable[] = [
  'organicMatter',
  'toxicWaste',
  'nutrients',
  'oxygen',
];

const isDissolvedLayer = (layer: WaterQualityLayer): layer is WaterQualityVariable =>
  WATER_QUALITY_DRAW_ORDER.includes(layer as WaterQualityVariable);

export const analysisOverlayKey = (
  snapshot: SimulationSnapshot,
  selectedLayers: readonly WaterQualityLayer[],
): string => {
  if (selectedLayers.length === 0) return 'hidden';
  const needsDissolvedGrid = selectedLayers.some(isDissolvedLayer);
  const needsPelagicGrid = selectedLayers.some(isPelagicLayer);
  const needsTransportGrid = selectedLayers.includes('temperature') ||
    selectedLayers.includes('flow');
  return [
    snapshot.revision,
    needsDissolvedGrid || needsPelagicGrid
      ? snapshot.biogeochemistry.water.revision
      : 'water-idle',
    needsTransportGrid ? snapshot.biogeochemistry.transport.revision : 'transport-idle',
    selectedLayers.join(',') || 'none',
  ].join(':');
};

interface ContourPoint {
  x: number;
  y: number;
}

const contourCrossing = (
  first: ContourPoint,
  second: ContourPoint,
  firstValue: number,
  secondValue: number,
  threshold: number,
): ContourPoint | null => {
  if ((firstValue < threshold) === (secondValue < threshold)) return null;
  const difference = secondValue - firstValue;
  const ratio = Math.abs(difference) < 0.000001
    ? 0.5
    : Math.max(0, Math.min(1, (threshold - firstValue) / difference));
  return {
    x: first.x + (second.x - first.x) * ratio,
    y: first.y + (second.y - first.y) * ratio,
  };
};

/**
 * When several dissolved fields are selected, every field is drawn as the
 * same kind of contour line. This makes the result independent of click order
 * and avoids implying that a hatch direction is a biological property.
 */
const drawWaterQualityContours = (
  layer: Graphics,
  snapshot: SimulationSnapshot,
  selectedLayer: WaterQualityVariable,
  width: number,
  height: number,
): void => {
  const water = snapshot.biogeochemistry.water;
  if (water.columns < 2 || water.rows < 2) return;
  const values = water[selectedLayer];
  const visualRange = waterQualityVisualRange(selectedLayer, values);
  const normalizedValues = values.map((value) =>
    normalizeWaterQualityForDisplay(selectedLayer, value, visualRange));
  const pointAt = (column: number, row: number): ContourPoint => ({
    x: ((column + 0.5) / water.columns) * width,
    y: ((row + 0.5) / water.rows) * height,
  });
  const valueAt = (column: number, row: number): number =>
    normalizedValues[row * water.columns + column] ?? 0;
  const drawSegment = (first: ContourPoint, second: ContourPoint): void => {
    layer.moveTo(first.x, first.y);
    layer.lineTo(second.x, second.y);
  };

  for (const [thresholdIndex, threshold] of [0.28, 0.52, 0.76].entries()) {
    for (let row = 0; row < water.rows - 1; row += 1) {
      for (let column = 0; column < water.columns - 1; column += 1) {
        const points = [
          pointAt(column, row),
          pointAt(column + 1, row),
          pointAt(column + 1, row + 1),
          pointAt(column, row + 1),
        ];
        const samples = [
          valueAt(column, row),
          valueAt(column + 1, row),
          valueAt(column + 1, row + 1),
          valueAt(column, row + 1),
        ];
        const crossings = [
          contourCrossing(points[0], points[1], samples[0], samples[1], threshold),
          contourCrossing(points[1], points[2], samples[1], samples[2], threshold),
          contourCrossing(points[2], points[3], samples[2], samples[3], threshold),
          contourCrossing(points[3], points[0], samples[3], samples[0], threshold),
        ].filter((point): point is ContourPoint => Boolean(point));
        if (crossings.length === 2) {
          drawSegment(crossings[0], crossings[1]);
        } else if (crossings.length === 4) {
          // Saddle cells are split consistently from their centre value, so
          // contours never depend on iteration or selection order.
          const centre = samples.reduce((sum, value) => sum + value, 0) / 4;
          if (centre >= threshold) {
            drawSegment(crossings[0], crossings[3]);
            drawSegment(crossings[1], crossings[2]);
          } else {
            drawSegment(crossings[0], crossings[1]);
            drawSegment(crossings[2], crossings[3]);
          }
        }
      }
    }
    layer.stroke({
      color: SECONDARY_WATER_COLORS[selectedLayer],
      width: 2.3,
      alpha: 0.48 + thresholdIndex * 0.12,
      cap: 'round',
      join: 'round',
    });
  }
};

/**
 * Additional pelagic fields use isolines rather than another translucent
 * colour wash. Hollow peak markers keep a spatially uniform bloom legible
 * (where marching-squares would otherwise have no boundary) without turning
 * every occupied cell into a cloud of particles.
 */
const drawPelagicContours = (
  layer: Graphics,
  snapshot: SimulationSnapshot,
  selectedLayer: PelagicLayer,
  width: number,
  height: number,
): void => {
  const water = snapshot.biogeochemistry.water;
  if (water.columns < 2 || water.rows < 2) return;
  const values = pelagicValues(snapshot, selectedLayer);
  const displayMaximum = pelagicVisualMaximum(selectedLayer, values);
  const normalizedValues = values.map((value) =>
    normalizePelagicForDisplay(value, displayMaximum));
  const pointAt = (column: number, row: number): ContourPoint => ({
    x: ((column + 0.5) / water.columns) * width,
    y: ((row + 0.5) / water.rows) * height,
  });
  const valueAt = (column: number, row: number): number =>
    normalizedValues[row * water.columns + column] ?? 0;
  const drawSegment = (first: ContourPoint, second: ContourPoint): void => {
    layer.moveTo(first.x, first.y);
    layer.lineTo(second.x, second.y);
  };

  for (const [thresholdIndex, threshold] of [0.3, 0.58, 0.84].entries()) {
    for (let row = 0; row < water.rows - 1; row += 1) {
      for (let column = 0; column < water.columns - 1; column += 1) {
        const points = [
          pointAt(column, row),
          pointAt(column + 1, row),
          pointAt(column + 1, row + 1),
          pointAt(column, row + 1),
        ];
        const samples = [
          valueAt(column, row),
          valueAt(column + 1, row),
          valueAt(column + 1, row + 1),
          valueAt(column, row + 1),
        ];
        const crossings = [
          contourCrossing(points[0], points[1], samples[0], samples[1], threshold),
          contourCrossing(points[1], points[2], samples[1], samples[2], threshold),
          contourCrossing(points[2], points[3], samples[2], samples[3], threshold),
          contourCrossing(points[3], points[0], samples[3], samples[0], threshold),
        ].filter((point): point is ContourPoint => Boolean(point));
        if (crossings.length === 2) {
          drawSegment(crossings[0], crossings[1]);
        } else if (crossings.length === 4) {
          const centre = samples.reduce((sum, value) => sum + value, 0) / 4;
          if (centre >= threshold) {
            drawSegment(crossings[0], crossings[3]);
            drawSegment(crossings[1], crossings[2]);
          } else {
            drawSegment(crossings[0], crossings[1]);
            drawSegment(crossings[2], crossings[3]);
          }
        }
      }
    }
    layer.stroke({
      color: PELAGIC_PALETTES[selectedLayer].contour,
      width: 2.7,
      alpha: 0.58 + thresholdIndex * 0.12,
      cap: 'round',
      join: 'round',
    });
  }

  const peakCandidates: Array<{ column: number; row: number; value: number }> = [];
  for (let row = 1; row < water.rows - 1; row += 1) {
    for (let column = 1; column < water.columns - 1; column += 1) {
      const value = valueAt(column, row);
      if (value < 0.24) continue;
      let localMaximum = true;
      let hasMeaningfullyLowerNeighbour = false;
      for (let rowOffset = -1; rowOffset <= 1 && localMaximum; rowOffset += 1) {
        for (let columnOffset = -1; columnOffset <= 1; columnOffset += 1) {
          if (rowOffset === 0 && columnOffset === 0) continue;
          const neighbour = valueAt(
            column + columnOffset,
            row + rowOffset,
          );
          if (neighbour > value + 0.008) {
            localMaximum = false;
            break;
          }
          if (neighbour < value - 0.035) {
            hasMeaningfullyLowerNeighbour = true;
          }
        }
      }
      // A flat, well-mixed field has no spatial hotspot. Treating every cell
      // on a plateau as a local maximum produced a regular field of hollow
      // dots—the same visual clutter the contour mode is meant to remove.
      if (localMaximum && hasMeaningfullyLowerNeighbour) {
        peakCandidates.push({ column, row, value });
      }
    }
  }
  peakCandidates.sort((first, second) => second.value - first.value);
  const peaks: typeof peakCandidates = [];
  for (const candidate of peakCandidates) {
    if (peaks.length >= 18) break;
    if (peaks.some((peak) =>
      Math.hypot(peak.column - candidate.column, peak.row - candidate.row) < 3.5)) continue;
    peaks.push(candidate);
  }
  for (const peak of peaks) {
    const point = pointAt(peak.column, peak.row);
    layer.circle(point.x, point.y, 2.8 + peak.value * 2.2).stroke({
      color: PELAGIC_PALETTES[selectedLayer].contour,
      width: 2.3,
      alpha: 0.82,
    });
  }
};

const drawTemperatureContours = (
  layer: Graphics,
  snapshot: SimulationSnapshot,
  width: number,
  height: number,
): void => {
  const transport = snapshot.biogeochemistry.transport;
  if (transport.columns < 2 || transport.rows < 2) return;
  const span = Math.max(0.001, transport.maximumTemperature - transport.minimumTemperature);
  const normalized = transport.temperature.map((value) =>
    Math.max(0, Math.min(1, (value - transport.minimumTemperature) / span)));
  const pointAt = (column: number, row: number): ContourPoint => ({
    x: ((column + 0.5) / transport.columns) * width,
    y: ((row + 0.5) / transport.rows) * height,
  });
  const valueAt = (column: number, row: number): number =>
    normalized[row * transport.columns + column] ?? 0;

  for (const [thresholdIndex, threshold] of [0.3, 0.55, 0.8].entries()) {
    for (let row = 0; row < transport.rows - 1; row += 1) {
      for (let column = 0; column < transport.columns - 1; column += 1) {
        const points = [
          pointAt(column, row),
          pointAt(column + 1, row),
          pointAt(column + 1, row + 1),
          pointAt(column, row + 1),
        ];
        const samples = [
          valueAt(column, row),
          valueAt(column + 1, row),
          valueAt(column + 1, row + 1),
          valueAt(column, row + 1),
        ];
        const crossings = [
          contourCrossing(points[0], points[1], samples[0], samples[1], threshold),
          contourCrossing(points[1], points[2], samples[1], samples[2], threshold),
          contourCrossing(points[2], points[3], samples[2], samples[3], threshold),
          contourCrossing(points[3], points[0], samples[3], samples[0], threshold),
        ].filter((point): point is ContourPoint => Boolean(point));
        if (crossings.length === 2) {
          layer.moveTo(crossings[0].x, crossings[0].y);
          layer.lineTo(crossings[1].x, crossings[1].y);
        } else if (crossings.length === 4) {
          layer.moveTo(crossings[0].x, crossings[0].y);
          layer.lineTo(crossings[1].x, crossings[1].y);
          layer.moveTo(crossings[2].x, crossings[2].y);
          layer.lineTo(crossings[3].x, crossings[3].y);
        }
      }
    }
    layer.stroke({
      color: 0xd47c4d,
      width: 2.5,
      alpha: 0.52 + thresholdIndex * 0.13,
      cap: 'round',
    });
  }
};

const drawFlowArrows = (
  layer: Graphics,
  snapshot: SimulationSnapshot,
  width: number,
  height: number,
): void => {
  const transport = snapshot.biogeochemistry.transport;
  const maximumSpeed = Math.max(0.0001, transport.maximumSpeed);
  // A 36×20 arrow at every other cell overwhelms the hand-drawn tank.  The
  // coarser visual sampling leaves the underlying temperature and organisms
  // readable while still exposing the circulation topology.
  for (let row = 1; row < transport.rows - 1; row += 3) {
    for (let column = 1; column < transport.columns - 1; column += 3) {
      const index = row * transport.columns + column;
      const velocityX = transport.velocityX[index] ?? 0;
      const velocityY = transport.velocityY[index] ?? 0;
      const speed = Math.hypot(velocityX, velocityY);
      if (speed < maximumSpeed * 0.045 || speed < 0.0002) continue;
      const normalized = Math.min(1, speed / maximumSpeed);
      const length = 5.6 + normalized * 15;
      const directionX = velocityX / speed;
      const directionY = velocityY / speed;
      const centerX = ((column + 0.5) / transport.columns) * width;
      const centerY = ((row + 0.5) / transport.rows) * height;
      const endX = centerX + directionX * length;
      const endY = centerY + directionY * length;
      layer
        .moveTo(
          centerX - directionX * length * 0.34,
          centerY - directionY * length * 0.34,
        )
        .lineTo(endX, endY)
        .stroke({ color: 0xd8f0e3, width: 2.4, alpha: 0.76, cap: 'round' });
      const sideX = -directionY;
      const sideY = directionX;
      layer.poly([
        endX,
        endY,
        endX - directionX * 5.6 + sideX * 3.6,
        endY - directionY * 5.6 + sideY * 3.6,
        endX - directionX * 5.6 - sideX * 3.6,
        endY - directionY * 5.6 - sideY * 3.6,
      ]).fill({ color: 0xd8f0e3, alpha: 0.76 });
    }
  }
};

const drawBiofilmStain = (
  layer: Graphics,
  cell: SurfaceCellSnapshot,
  guildId: MicrobeGuildId,
  biomass: number,
  selected: boolean,
  waterTop = WATER_TOP,
): void => {
  if (!Number.isFinite(biomass) || biomass < 0.001) return;
  // Observation mode must reveal a sparse film without making 1% coverage
  // look like a solid carpet.  A gentler power curve keeps low values visible
  // while preserving a truthful difference between 1%, 10% and 100%.
  const amount = Math.pow(Math.max(0, Math.min(1, biomass)), 0.68);
  const seed = stringHash(`${cell.id}:${guildId}`);
  const centerX = cell.x;
  // Substrate cells sit exactly on the sediment boundary. Pull the stain a
  // little into the water so a newly inoculated film is not clipped or lost
  // among the gravel dots.
  const surfaceLift = cell.surfaceKind === 'substrate' ? cell.cellSize * 0.22 : 0;
  const centerY = cell.y - waterTop - surfaceLift;
  const radius = cell.cellSize * (0.34 + amount * 0.52) * (selected ? 1.28 : 1);
  const color = selected
    ? guildId === 'decomposer' ? 0xc98246 : 0x49a49c
    : MICROBES[guildId].color;

  // Several overlapping, seeded washes read as a continuous natural stain.
  // Their centres deliberately cross cell boundaries so the ecology grid is
  // never exposed, while their very low idle opacity keeps biofilm subtle.
  const washCount = selected ? 5 : 4;
  for (let index = 0; index < washCount; index += 1) {
    const offsetX = (hash01(seed + index * 47 + 11) - 0.5) * cell.cellSize * 0.86;
    const offsetY = (hash01(seed + index * 61 + 23) - 0.5) * cell.cellSize * 0.72;
    const radiusX = radius * (0.58 + hash01(seed + index * 73 + 31) * 0.48);
    const radiusY = radius * (0.42 + hash01(seed + index * 89 + 43) * 0.44);
    const alpha = selected
      ? 0.08 + amount * 0.72
      : 0.006 + amount * 0.017;
    layer.ellipse(
      centerX + offsetX,
      centerY + offsetY,
      Math.max(1, radiusX),
      Math.max(0.8, radiusY),
    ).fill({ color, alpha });
  }
};

/**
 * Draws the selected 36 x 20 dissolved field through one tiny typed texture
 * and uses retained Pixi geometry for contours, flow, and attached films.
 * No full-tank canvas or ImageData generation is created while the simulation
 * runs, so Chromium cannot retain one native raster backing store per sample.
 */
export const drawAnalysisOverlay = (
  layer: Container,
  snapshot: SimulationSnapshot,
  selectedLayers: readonly WaterQualityLayer[],
): void => {
  if (selectedLayers.length === 0) {
    layer.visible = false;
    return;
  }
  const surface = analysisSurfaces.get(layer);
  if (!surface) return;
  const width = snapshot.tank.width;
  const height = snapshot.tank.groundY - snapshot.tank.waterTop;
  surface.primary.visible = false;
  surface.details.clear();

  const selectedWaterLayerSet = new Set(selectedLayers.filter(isDissolvedLayer));
  const selectedWaterLayers = WATER_QUALITY_DRAW_ORDER.filter((layerId) =>
    selectedWaterLayerSet.has(layerId));
  const temperatureSelected = selectedLayers.includes('temperature');
  const pelagicPlan = pelagicRenderPlan(selectedLayers);
  const selectedPelagicLayerCount = (pelagicPlan.primary ? 1 : 0) +
    pelagicPlan.secondary.length;
  const scalarLayerCount = selectedWaterLayers.length +
    selectedPelagicLayerCount +
    (temperatureSelected ? 1 : 0);
  const primaryWaterLayer = scalarLayerCount === 1 && selectedWaterLayers.length === 1
    ? selectedWaterLayers[0]
    : null;
  const primaryPelagicLayer = pelagicPlan.primary;
  const flowSelected = selectedLayers.includes('flow');
  if (primaryWaterLayer) {
    const water = snapshot.biogeochemistry.water;
    ensureAnalysisPrimary(surface, water.columns, water.rows, snapshot);
    const values = water[primaryWaterLayer];
    const palette = WATER_QUALITY_PALETTES[primaryWaterLayer];
    const visualRange = waterQualityVisualRange(primaryWaterLayer, values);
    for (let index = 0; index < water.columns * water.rows; index += 1) {
      const value = values[index] ?? 0;
      const normalized = normalizeWaterQualityForDisplay(
        primaryWaterLayer,
        value,
        visualRange,
      );
      const color = primaryWaterLayer === 'oxygen' && value < 30
        ? mixColor(0xc54b50, palette.low, value / 30)
        : mixColor(palette.low, palette.high, normalized);
      writeAnalysisPixel(
        surface,
        index,
        color,
        waterQualityOverlayAlpha(primaryWaterLayer, value, normalized),
      );
    }
    publishAnalysisPrimary(surface);
  }

  if (primaryPelagicLayer) {
    const water = snapshot.biogeochemistry.water;
    ensureAnalysisPrimary(surface, water.columns, water.rows, snapshot);
    const values = pelagicValues(snapshot, primaryPelagicLayer);
    const palette = PELAGIC_PALETTES[primaryPelagicLayer];
    const displayMaximum = pelagicVisualMaximum(primaryPelagicLayer, values);
    for (let index = 0; index < water.columns * water.rows; index += 1) {
      const value = Math.max(0, values[index] ?? 0);
      const normalized = normalizePelagicForDisplay(value, displayMaximum);
      writeAnalysisPixel(
        surface,
        index,
        mixColor(palette.low, palette.high, normalized),
        pelagicOverlayAlpha(normalized),
      );
    }
    publishAnalysisPrimary(surface);
  }

  if (scalarLayerCount === 1 && temperatureSelected) {
    const transport = snapshot.biogeochemistry.transport;
    ensureAnalysisPrimary(surface, transport.columns, transport.rows, snapshot);
    const span = Math.max(0.08, transport.maximumTemperature - transport.minimumTemperature);
    for (let index = 0; index < transport.columns * transport.rows; index += 1) {
      const value = transport.temperature[index] ?? transport.averageTemperature;
      const normalized = Math.max(
        0,
        Math.min(1, (value - transport.minimumTemperature) / span),
      );
      writeAnalysisPixel(
        surface,
        index,
        mixColor(0x416f84, 0xd88852, normalized),
        0.4 + normalized * 0.24,
      );
    }
    publishAnalysisPrimary(surface);
  }

  for (const contourLayer of scalarLayerCount > 1 ? selectedWaterLayers : []) {
    drawWaterQualityContours(
      surface.details,
      snapshot,
      contourLayer,
      width,
      height,
    );
  }
  for (const contourLayer of pelagicPlan.secondary) {
    drawPelagicContours(
      surface.details,
      snapshot,
      contourLayer,
      width,
      height,
    );
  }
  if (scalarLayerCount > 1 && temperatureSelected) {
    drawTemperatureContours(surface.details, snapshot, width, height);
  }
  if (flowSelected) drawFlowArrows(surface.details, snapshot, width, height);

  const selectedGuilds = new Set(selectedLayers.filter(isMicrobeLayer));
  let hasVisibleBiofilm = false;
  for (const cell of snapshot.cells) {
    if (
      cell.y < snapshot.tank.waterTop - cell.cellSize ||
      cell.y > snapshot.tank.groundY + cell.cellSize
    ) continue;
    for (const guildId of ['decomposer', 'nitrifier'] as const) {
      const biomass = cell.biofilm[guildId];
      if (biomass >= 0.001) hasVisibleBiofilm = true;
      drawBiofilmStain(
        surface.details,
        cell,
        guildId,
        biomass,
        selectedGuilds.has(guildId),
        snapshot.tank.waterTop,
      );
    }
  }

  layer.position.set(0, snapshot.tank.waterTop);
  layer.visible = selectedLayers.length > 0 || hasVisibleBiofilm;
};

const polygonPoints = (points: Vec2[]): number[] =>
  points.flatMap((point) => [point.x, point.y]);

/**
 * Pixi only destroys an owned GraphicsContext by default when destroy() is
 * called without an options object. Passing `{ children: true }` down a
 * display tree therefore destroys each Graphics wrapper but retains its
 * vector instructions and renderer GPU data. Animals and carcasses turn over
 * thousands of times in a long run, so those retained contexts eventually
 * exhaust the Electron renderer heap.
 */
export const destroyDisplayTree = (container: Container): void => {
  container.destroy({ children: true, context: true });
};

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

  // Keep a filled vector stone underneath the texture at all times. The vector
  // outline is needed only when no usable texture was loaded; drawing it below
  // a healthy SVG doubles the visible outside half of the normal stone edge.
  const fallback = new Graphics()
    .poly(polygonPoints(definition.collisionPolygon))
    .fill({ color: 0xb7aa8c, alpha: 1 })
    .poly(polygonPoints(definition.ecologyPolygon))
    .fill({ color: 0xd8cca9, alpha: 0.34 });
  if (!texture) {
    fallback
      .poly(polygonPoints(definition.collisionPolygon))
      .stroke({ color: 0x303c3a, width: 2.6, join: 'round' });
  }
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
  snapshotStructures: readonly StructureSnapshot[],
  structures: StructureSnapshot[],
  holding: SimulationSnapshot['holding'],
): void => {
  for (const structure of structures) {
    const display = displays.get(structure.id);
    if (!display) continue;
    let authoritative: StructureSnapshot | undefined;
    for (const candidate of snapshotStructures) {
      if (candidate.id === structure.id) {
        authoritative = candidate;
        break;
      }
    }
    const activelyHeld = Boolean(
      structure.isHeld &&
      holding?.kind === 'structure' &&
      holding.structureId === structure.id,
    );
    if (
      !authoritative ||
      authoritative.locked ||
      (structure.isHeld && !activelyHeld) ||
      (!structure.isHeld && authoritative.isHeld) ||
      (authoritative.isSleeping && !activelyHeld)
    ) continue;
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
    destroyDisplayTree(display.container);
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
      destroyDisplayTree(display.container);
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

const SHRIMP_ADULT_LENGTH = 36;
const SHRIMP_ABDOMEN_X = [-4, -10, -16, -21];
// The complete traced silhouette runs from x=-46 to x=39. Scale against the
// complete fish, not only the body, so a 44 px adult remains 44 px nose-to-tail.
const RICEFISH_DRAW_LENGTH = 85;
const RICEFISH_ADULT_LENGTH = 44;
const RICEFISH_BODY_PIVOT_X = 24;
const RICEFISH_CAUDAL_BASE_X = -29;
const RICEFISH_CAUDAL_BASE_Y = -0.85;
// Match the existing shrimp rig: a clean charcoal contour, muted translucent
// body colour, and warm fins. The supplied medaka vector is used for anatomy
// and proportions only, not as rendered artwork.
const RICEFISH_OUTLINE = 0x303c3a;
const RICEFISH_DETAIL = 0x59615d;
const RICEFISH_BODY_TOP = 0xaeb8b4;
const RICEFISH_BODY_BELLY = 0xe1e1d9;
const RICEFISH_FIN = 0xe8d7aa;
const RICEFISH_FIN_RAY = 0xb8a478;

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
  // A fixed five-mark pool is large enough to read at fit zoom and remains
  // allocation-free during long runs. Visibility is driven by real cumulative
  // intake below, not merely by the shrimp's intended behavior.
  const fleckColors = [0x668663, 0x8a9a62, 0x9a744c, 0x547b55, 0xb08a58];
  const flecks = fleckColors.map((color, index) => new Graphics()
    .moveTo(-1.35, 0.45)
    .quadraticCurveTo(0, -1.35 - (index % 3) * 0.12, 1.45, -0.15)
    .stroke({ color: 0x35443a, width: 0.72, alpha: 0.82, cap: 'round' })
    .circle(0.3, 0, 1.12 - (index % 3) * 0.1)
    .fill({ color, alpha: 0.94 }));
  group.addChild(mouth, ...flecks);
  group.visible = false;
  return { group, mouth, flecks };
};

const emptyAnimalPart = (): Container => new Container();

interface RicefishVisualProfile {
  eyeRadius: number;
  finScale: number;
}

interface RicefishBodyArt {
  container: Container;
  pectoral: Container;
  closedMouth: Graphics;
  feedingMouth: Container;
  feedingJaw: Container;
}

const ricefishVisualProfile = (
  lifeStage: AnimalSnapshot['lifeStage'],
  sex: AnimalSnapshot['sex'],
): RicefishVisualProfile => {
  if (lifeStage === 'fry') {
    return {
      eyeRadius: 3.15,
      finScale: 0.56,
    };
  }
  if (lifeStage === 'juvenile') {
    return {
      eyeRadius: 3,
      finScale: 0.78,
    };
  }
  return {
    eyeRadius: 3.2,
    finScale: 1,
  };
};

const drawRicefishBody = (
  lifeStage: AnimalSnapshot['lifeStage'],
  sex: AnimalSnapshot['sex'],
): RicefishBodyArt => {
  const profile = ricefishVisualProfile(lifeStage, sex);
  const group = new Container();
  const depthScale = lifeStage === 'fry'
    ? 0.8
    : lifeStage === 'juvenile'
      ? 0.9
      : sex === 'male'
        ? 1.02
        : 1.05;
  const y = (value: number): number => value * depthScale;
  const traceBody = (graphics: Graphics): Graphics => graphics
    // Fresh trace of the supplied medaka reference. The canonical artwork
    // faces right; the render container mirrors this complete drawing when
    // the animal swims left.
    .moveTo(-29, y(-3.2))
    .bezierCurveTo(-22, y(-4), -14, y(-5.1), -6, y(-6.25))
    .bezierCurveTo(2, y(-7.15), 10, y(-7.5), 16.3, y(-7.2))
    .bezierCurveTo(25.3, y(-6.5), 33, y(-4.45), 38, y(-2.25))
    .bezierCurveTo(39.7, y(-1.45), 40.2, y(-0.45), 39.2, y(0.55))
    .bezierCurveTo(36, y(4.2), 28.3, y(7.8), 20, y(10.2))
    .bezierCurveTo(14, y(11.45), 8, y(11.35), 3, y(9.2))
    .bezierCurveTo(-5, y(6.3), -14, y(3.8), -22, y(3.1))
    .bezierCurveTo(-26.2, y(3), -29.4, y(1.65), -29, y(-3.2));
  const body = traceBody(new Graphics())
    .closePath()
    .fill({ color: RICEFISH_BODY_TOP, alpha: lifeStage === 'fry' ? 0.55 : 0.9 });
  const bodyOutline = traceBody(new Graphics())
    .closePath()
    .stroke({ color: RICEFISH_OUTLINE, width: 1.85, alpha: 0.96, join: 'round' });
  const belly = new Graphics()
    .moveTo(-28.8, y(-0.35))
    .bezierCurveTo(-17, y(-0.2), -4, y(1.4), 7, y(1.7))
    .bezierCurveTo(18, y(1.35), 30, y(0.15), 39, y(-0.25))
    .bezierCurveTo(36, y(4.15), 28.3, y(7.8), 20, y(10.2))
    .bezierCurveTo(14, y(11.45), 8, y(11.35), 3, y(9.2))
    .bezierCurveTo(-5, y(6.3), -14, y(3.8), -22, y(3.1))
    .bezierCurveTo(-26.2, y(3), -29.4, y(1.65), -28.8, y(-0.35))
    .closePath()
    .fill({ color: RICEFISH_BODY_BELLY, alpha: lifeStage === 'fry' ? 0.3 : 0.88 });
  const cheek = new Graphics()
    .ellipse(21.2, y(2.15), 3.5, y(2.35))
    .fill({ color: 0xd98072, alpha: lifeStage === 'fry' ? 0.04 : 0.13 });
  const gill = new Graphics()
    .moveTo(18.8, y(-2.35))
    .bezierCurveTo(16.2, y(-0.5), 16.2, y(1.9), 18.2, y(3.5))
    .bezierCurveTo(18.9, y(4.1), 18.2, y(4.9), 16.4, y(5.65))
    .stroke({ color: RICEFISH_DETAIL, width: 1.35, alpha: 0.92, cap: 'round' });
  const eye = new Graphics()
    .circle(28.9, y(-1.35), profile.eyeRadius)
    .fill({ color: 0xfffcf2, alpha: 1 })
    .stroke({ color: RICEFISH_OUTLINE, width: 1.35, alpha: 1 })
    .circle(28.9, y(-1.35), profile.eyeRadius * 0.56)
    .fill({ color: RICEFISH_OUTLINE, alpha: 1 })
    .circle(29.45, y(-1.9), profile.eyeRadius * 0.15)
    .fill({ color: 0xfffcf2, alpha: 0.98 });
  const pectoralFin = new Graphics()
    // The root beside the gill is the pointed end. Its free trailing edge is
    // broad and rounded in the reference; treating that edge as a pointed tip
    // made the entire fin read as if it faced forward.
    .moveTo(18.5, y(-0.35))
    .bezierCurveTo(13.2, y(-2.65), 7.1, y(-2.9), 3.2, y(-1.5))
    .bezierCurveTo(1.6, y(-0.8), 1.7, y(0.55), 2.7, y(1.55))
    .bezierCurveTo(5.8, y(4.5), 11.3, y(4.5), 15.4, y(2.8))
    .bezierCurveTo(17.3, y(1.7), 18.2, y(0.5), 18.5, y(-0.35))
    .closePath()
    .fill({ color: RICEFISH_FIN, alpha: lifeStage === 'fry' ? 0.2 : 0.78 })
    .moveTo(18.5, y(-0.35))
    .bezierCurveTo(13.2, y(-2.65), 7.1, y(-2.9), 3.2, y(-1.5))
    .bezierCurveTo(1.6, y(-0.8), 1.7, y(0.55), 2.7, y(1.55))
    .bezierCurveTo(5.8, y(4.5), 11.3, y(4.5), 15.4, y(2.8))
    .bezierCurveTo(17.3, y(1.7), 18.2, y(0.5), 18.5, y(-0.35))
    .closePath()
    .stroke({ color: RICEFISH_OUTLINE, width: 1.35, alpha: 0.94, join: 'round' });
  const pectoralRays = new Graphics()
    .moveTo(16.9, y(0.05))
    .lineTo(3.8, y(-0.65))
    .moveTo(16.5, y(0.75))
    .lineTo(3.9, y(0.5))
    .moveTo(15.8, y(1.45))
    .lineTo(5.1, y(1.75))
    .stroke({ color: RICEFISH_FIN_RAY, width: 0.65, alpha: 0.82 });
  const pectoral = new Container();
  const pectoralRootY = y(-0.35);
  pectoral.pivot.set(18.5, pectoralRootY);
  pectoral.position.set(18.5, pectoralRootY);
  pectoral.addChild(pectoralFin, pectoralRays);
  const closedMouth = new Graphics()
    .moveTo(38.8, y(-0.45))
    .quadraticCurveTo(37.2, y(-0.75), 35.9, y(-0.15))
    .stroke({ color: RICEFISH_DETAIL, width: 1, alpha: 0.9, cap: 'round' });
  const mouthHingeX = 35.8;
  const mouthHingeY = y(-0.1);
  const mouthCavity = new Graphics()
    .moveTo(mouthHingeX, y(-0.18))
    .quadraticCurveTo(37.5, y(-0.62), 39.15, y(-0.34))
    .quadraticCurveTo(39.55, y(0.18), 38.95, y(0.72))
    .quadraticCurveTo(37.45, y(0.62), mouthHingeX, y(-0.18))
    .closePath()
    .fill({ color: 0x182321, alpha: 0.98 })
    .stroke({ color: RICEFISH_OUTLINE, width: 0.85, alpha: 1, join: 'round' });
  const lowerLip = new Graphics()
    .moveTo(mouthHingeX, mouthHingeY)
    .quadraticCurveTo(37.4, y(0.2), 39.05, y(0.62))
    .stroke({ color: RICEFISH_DETAIL, width: 1, alpha: 0.94, cap: 'round' });
  const feedingMouth = new Container();
  feedingMouth.alpha = 0;
  feedingMouth.addChild(mouthCavity);
  const feedingJaw = new Container();
  feedingJaw.pivot.set(mouthHingeX, mouthHingeY);
  feedingJaw.position.set(mouthHingeX, mouthHingeY);
  feedingJaw.alpha = 0;
  feedingJaw.addChild(lowerLip);
  group.addChild(
    body,
    belly,
    cheek,
    pectoral,
    gill,
    eye,
    bodyOutline,
    closedMouth,
    feedingMouth,
    feedingJaw,
  );
  return {
    container: group,
    pectoral,
    closedMouth,
    feedingMouth,
    feedingJaw,
  };
};

const drawRicefishTail = (
  lifeStage: AnimalSnapshot['lifeStage'],
): Container => {
  const profile = ricefishVisualProfile(lifeStage, 'female');
  const extent = lifeStage === 'fry' ? 13 : 17;
  const height = (lifeStage === 'fry' ? 6.7 : 8.8) * profile.finScale;
  const rootTop = lifeStage === 'fry' ? 1.45 : 1.9;
  const rootBottom = lifeStage === 'fry' ? 1.5 : 1.95;
  const joinTop = lifeStage === 'fry'
    ? 1.7
    : lifeStage === 'juvenile'
      ? 2.05
      : 2.3;
  const joinBottom = lifeStage === 'fry'
    ? 2.15
    : lifeStage === 'juvenile'
      ? 2.3
      : 2.45;
  const group = new Container();
  const traceTail = (graphics: Graphics): Graphics => graphics
    .moveTo(3, -rootTop)
    // The forward root is hidden inside the body. The outer edge crosses the
    // body exactly at the caudal-peduncle end instead of peeking above it as
    // a false extra dorsal lobe.
    .bezierCurveTo(2, -rootTop - 0.2, 0.7, -joinTop + 0.15, 0, -joinTop)
    .bezierCurveTo(-4.5, -5.5, -9, -height * 0.92, -14.5, -height)
    .bezierCurveTo(-extent, -height * 1.02, -extent - 0.8, -height * 0.78, -extent - 0.2, -height * 0.55)
    .bezierCurveTo(-16.4, -3.1, -15.7, -1.2, -16.1, 0.8)
    .bezierCurveTo(-16.7, 3.6, -16.1, height * 0.78, -14.3, height * 0.86)
    .bezierCurveTo(-8.2, height * 0.84, -2.2, joinBottom + 0.4, -0.4, joinBottom)
    .bezierCurveTo(0.8, rootBottom + 0.4, 2.1, rootBottom, 3, rootBottom);
  const tail = traceTail(new Graphics())
    .quadraticCurveTo(0.2, -0.55, 3, -rootTop)
    .closePath()
    .fill({ color: RICEFISH_FIN, alpha: lifeStage === 'fry' ? 0.28 : 0.8 });
  const tailOutline = traceTail(new Graphics())
    .stroke({ color: RICEFISH_OUTLINE, width: 1.7, alpha: 0.96, join: 'round' });
  const rays = new Graphics()
    .moveTo(0.4, -rootTop * 0.8)
    .lineTo(-extent + 1.8, -height * 0.78)
    .moveTo(0, -rootTop * 0.42)
    .lineTo(-extent + 1.2, -height * 0.4)
    .moveTo(-0.4, -0.45)
    .lineTo(-extent + 1.2, -0.45)
    .moveTo(0, rootBottom * 0.42)
    .lineTo(-extent + 1.5, height * 0.38)
    .moveTo(0.4, rootBottom * 0.78)
    .lineTo(-extent + 2, height * 0.72)
    .stroke({ color: RICEFISH_FIN_RAY, width: 0.65, alpha: 0.8 });
  group.addChild(tail, rays, tailOutline);
  return group;
};

const drawRicefishFins = (
  lifeStage: AnimalSnapshot['lifeStage'],
  sex: AnimalSnapshot['sex'],
): {
  container: Container;
  dorsal: Container;
  anal: Container;
  pelvic: Container;
} => {
  const profile = ricefishVisualProfile(lifeStage, sex);
  const fin = profile.finScale;
  const sy = (value: number): number => value * fin;
  const group = new Container();
  const adultMale = lifeStage === 'adult' && sex === 'male';

  // Fin fills overlap the body, but the visible outline deliberately stops at
  // each root. Closing and stroking the hidden root used to leave a second
  // brown edge peeking out beside the body contour, which made the fin look
  // detached even though the fill overlapped.
  const traceDorsalOuter = (graphics: Graphics): Graphics => adultMale
    ? graphics
      // Male: one tall lobe followed by the diagnostic deep notch and short
      // rear lobe. Coordinates are mirrored from the supplied upper fish.
      // Both roots extend inside the body. The opaque body and its final
      // outline cover this hidden overlap, so no water-coloured seam can
      // appear between the two independently antialiased shapes.
      .moveTo(-11.5, sy(-3.7))
      .bezierCurveTo(-15.2, sy(-9.9), -18.7, sy(-12.8), -21.1, sy(-12.9))
      .bezierCurveTo(-23.1, sy(-13), -24, sy(-11.6), -23.5, sy(-10.1))
      // Keep the contour progressing tailward through the notch. The former
      // backward hook crossed the two lobes in projection and made them read
      // as separate fins stacked on top of one another.
      .bezierCurveTo(-23.2, sy(-9), -23.25, sy(-7.9), -23.6, sy(-7.2))
      .bezierCurveTo(-24.2, sy(-7.45), -25.2, sy(-9.25), -26.1, sy(-9.2))
      // The short rear lobe stays headward of the caudal peduncle instead of
      // intruding into the tail fan.
      .bezierCurveTo(-26.9, sy(-8.8), -27.2, sy(-4.3), -27.1, sy(-2.35))
    : graphics
      // Female: one broad rounded fin, with the longer base visible in the
      // supplied anatomical reference.
      .moveTo(-24.1, sy(-2.4))
      .bezierCurveTo(-24.1, sy(-9.1), -23.1, sy(-12.4), -21, sy(-12.9))
      .bezierCurveTo(-17.9, sy(-12.6), -12.3, sy(-8.6), -9.5, sy(-3.8));

  const closeDorsalRoot = (graphics: Graphics): Graphics => adultMale
    ? graphics.bezierCurveTo(-20.3, sy(-2.8), -15.6, sy(-3.45), -11.5, sy(-3.7))
    : graphics.bezierCurveTo(-14.8, sy(-3), -20, sy(-2.5), -24.1, sy(-2.4));

  const traceAnalOuter = (graphics: Graphics): Graphics => adultMale
    ? graphics
      // Male: a long fin for the sex cue, but not the oversized hanging
      // rectangle produced by the former 15.6-deep outline.
      .moveTo(-21.5, sy(1.7))
      .bezierCurveTo(-22.1, sy(4.8), -22.4, sy(6.5), -22, sy(7.2))
      .bezierCurveTo(-17.5, sy(8.6), -11.4, sy(11.7), -5.8, sy(13))
      .bezierCurveTo(-3.7, sy(12.7), -1.8, sy(9.4), -1.1, sy(6.9))
    : graphics
      // Female: a much shallower rear fin; the previous version incorrectly
      // reused the male depth and read as a hanging semicircle.
      .moveTo(-22.5, sy(1.3))
      .bezierCurveTo(-22.8, sy(4.2), -22.4, sy(5.5), -20.4, sy(6.3))
      .lineTo(-7, sy(10.3))
      .bezierCurveTo(-5.2, sy(10.4), -3.7, sy(8), -3.3, sy(5.5));

  const closeAnalRoot = (graphics: Graphics): Graphics => adultMale
    ? graphics.bezierCurveTo(-5, sy(5.6), -13, sy(2.5), -21.5, sy(1.7))
    : graphics.bezierCurveTo(-8, sy(3.8), -16.2, sy(1.5), -22.5, sy(1.3));

  const tracePelvic = (graphics: Graphics): Graphics => graphics
    .moveTo(8.8, sy(7.1))
    .bezierCurveTo(7.2, sy(10.5), 3.8, sy(14.6), 0.8, sy(14.9))
    .bezierCurveTo(-0.2, sy(12.1), 1.2, sy(8.8), 4.1, sy(7.3));

  const fillAlpha = lifeStage === 'fry' ? 0.28 : 0.8;
  const dorsalFill = closeDorsalRoot(traceDorsalOuter(new Graphics()))
    .closePath()
    .fill({ color: RICEFISH_FIN, alpha: fillAlpha });
  const analFill = closeAnalRoot(traceAnalOuter(new Graphics()))
    .closePath()
    .fill({ color: RICEFISH_FIN, alpha: fillAlpha });
  const pelvicFill = tracePelvic(new Graphics())
    .closePath()
    .fill({ color: RICEFISH_FIN, alpha: fillAlpha });
  const dorsalOutline = traceDorsalOuter(new Graphics())
    .stroke({ color: RICEFISH_OUTLINE, width: 1.6, alpha: 0.96, join: 'round' });
  const analOutline = traceAnalOuter(new Graphics())
    .stroke({ color: RICEFISH_OUTLINE, width: 1.6, alpha: 0.96, join: 'round' });
  const pelvicOutline = tracePelvic(new Graphics())
    .stroke({ color: RICEFISH_OUTLINE, width: 1.6, alpha: 0.96, join: 'round' });

  const dorsalRays = new Graphics();
  const analRays = new Graphics();
  if (adultMale) {
    dorsalRays
      // Begin inside the body. Because the body is painted after the fins,
      // each visible ray now emerges exactly from the dorsal contour.
      .moveTo(-14.6, sy(-3.6))
      .lineTo(-20.3, sy(-10.6))
      .moveTo(-18.3, sy(-3.2))
      .lineTo(-21.7, sy(-8.6))
      .moveTo(-24, sy(-2.6))
      .lineTo(-25.5, sy(-7.75));
    analRays
      // These roots also start beneath the body fill. The old rays began in
      // open fin membrane and left the conspicuous empty strip at the root.
      .moveTo(-2.5, sy(6.9))
      .lineTo(-6.2, sy(12))
      .moveTo(-5.9, sy(5.8))
      .lineTo(-9.8, sy(11.2))
      .moveTo(-9.5, sy(4.8))
      .lineTo(-13.4, sy(10.1))
      .moveTo(-13.1, sy(4))
      .lineTo(-16.8, sy(8.8))
      .moveTo(-16.9, sy(3.3))
      .lineTo(-20.2, sy(7.4));
  } else {
    dorsalRays
      .moveTo(-16.6, sy(-6.8))
      .lineTo(-22, sy(-11.45))
      .moveTo(-14.1, sy(-7.4))
      .lineTo(-18.8, sy(-11.1))
      .moveTo(-19.6, sy(-6.2))
      .lineTo(-22.7, sy(-9.3));
    analRays
      .moveTo(-18.7, sy(3.1))
      .lineTo(-20.4, sy(5))
      .moveTo(-15.2, sy(3.4))
      .lineTo(-17.6, sy(5.9))
      .moveTo(-12.1, sy(3.75))
      .lineTo(-14.7, sy(6.7))
      .moveTo(-8.8, sy(4.4))
      .lineTo(-11.4, sy(7.25))
      .moveTo(-5.5, sy(5.2))
      .lineTo(-8.3, sy(8));
  }
  const rayStroke = { color: RICEFISH_FIN_RAY, width: 0.72, alpha: 0.78 };
  dorsalRays.stroke(rayStroke);
  analRays.stroke(rayStroke);
  const pelvicRays = new Graphics()
    .moveTo(7.2, sy(8.1))
    .lineTo(2.1, sy(13.5))
    .moveTo(5.2, sy(8.3))
    .lineTo(1.2, sy(12.2))
    .stroke(rayStroke);
  const dorsal = new Container();
  const anal = new Container();
  const pelvic = new Container();
  dorsal.addChild(dorsalFill, dorsalRays, dorsalOutline);
  anal.addChild(analFill, analRays, analOutline);
  pelvic.addChild(pelvicFill, pelvicRays, pelvicOutline);

  // Each fin has its own root pivot. At zero rotation these transforms are
  // identity; small rotations flex the membrane while the long hidden base
  // stays covered by the body that is drawn afterward.
  const dorsalRootX = adultMale ? -18.5 : -15.5;
  const dorsalRootY = sy(adultMale ? -3.35 : -3.15);
  dorsal.pivot.set(dorsalRootX, dorsalRootY);
  dorsal.position.set(dorsalRootX, dorsalRootY);
  const analRootX = adultMale ? -11.5 : -13;
  const analRootY = sy(adultMale ? 3.25 : 2.8);
  anal.pivot.set(analRootX, analRootY);
  anal.position.set(analRootX, analRootY);
  const pelvicRootX = 4.5;
  const pelvicRootY = sy(7.25);
  pelvic.pivot.set(pelvicRootX, pelvicRootY);
  pelvic.position.set(pelvicRootX, pelvicRootY);

  group.addChild(dorsal, anal, pelvic);
  return { container: group, dorsal, anal, pelvic };
};

const createRicefishDisplay = (
  id: string,
  target: AnimalRenderTarget,
): AnimalDisplay => {
  const container = new Container();
  const selection = new Graphics()
    .ellipse(0, 0, target.lifeStage === 'egg' ? 9 : 36, target.lifeStage === 'egg' ? 9 : 12.5)
    .stroke({ color: 0xf8edc7, width: 5.5, alpha: 0.7 })
    .stroke({ color: 0xa88b48, width: 2, alpha: 0.94 });
  const placement = new Graphics()
    .ellipse(0, 0, 37, 13.5)
    .stroke({ color: 0xffffff, width: 3, alpha: 0.9 });
  const art = new Container();
  const head = new Container();
  const tail = new Container();
  const fins = new Container();
  let pectoral: Container | undefined;
  let dorsalFin: Container | undefined;
  let analFin: Container | undefined;
  let pelvicFin: Container | undefined;
  let closedMouth: Graphics | undefined;
  let feedingMouth: Container | undefined;
  let feedingJaw: Container | undefined;
  if (target.lifeStage === 'egg') {
    const egg = new Graphics()
      .circle(0, 0, 5.2)
      .fill({ color: 0xf0e7b8, alpha: 0.5 })
      .stroke({ color: 0x8d845d, width: 1.2, alpha: 0.9 })
      .circle(0.9, 0.4, 2)
      .fill({ color: 0x8d8a64, alpha: 0.72 })
      .circle(1.8, -0.2, 0.55)
      .fill({ color: 0x26312f, alpha: 0.9 });
    head.addChild(egg);
  } else {
    const bodyArt = drawRicefishBody(target.lifeStage, target.sex);
    const finArt = drawRicefishFins(target.lifeStage, target.sex);
    pectoral = bodyArt.pectoral;
    closedMouth = bodyArt.closedMouth;
    feedingMouth = bodyArt.feedingMouth;
    feedingJaw = bodyArt.feedingJaw;
    dorsalFin = finArt.dorsal;
    analFin = finArt.anal;
    pelvicFin = finArt.pelvic;
    tail.addChild(drawRicefishTail(target.lifeStage));
    fins.addChild(finArt.container);
    // The tail, attached fins, and body share a flexible body rig. Keeping the
    // tail inside this hierarchy lets its root inherit the body's gentle bend
    // while its own skew grows toward the caudal edge without opening a seam.
    head.addChild(tail, fins, bodyArt.container);
    head.pivot.set(RICEFISH_BODY_PIVOT_X, 0);
    head.position.set(RICEFISH_BODY_PIVOT_X, 0);
    tail.position.set(RICEFISH_CAUDAL_BASE_X, RICEFISH_CAUDAL_BASE_Y);
  }
  art.addChild(head);
  container.addChild(selection, placement, art);
  const empty = emptyAnimalPart();
  const eggs = new Graphics();
  const feedback = emptyAnimalPart();
  return {
    speciesId: 'japanese-ricefish',
    lifeStage: target.lifeStage,
    container,
    selection,
    placement,
    art,
    head,
    abdomen: [],
    tail,
    legs: fins,
    antennae: empty,
    pectoral,
    dorsalFin,
    analFin,
    pelvicFin,
    closedMouth,
    feedingMouth,
    feedingJaw,
    eggs,
    grazingFeedback: feedback,
    grazingMouth: new Graphics(),
    grazingFlecks: [],
    target,
    renderX: target.x,
    renderY: target.y,
    renderFacing: target.facing,
    renderPoseAngle: target.poseAngle,
    renderBodyLength: target.bodyLength,
    renderMotion: { ...ANIMAL_MOTION_PROFILES[target.behavior] },
    grazingWeight: 0,
    phase: 0,
    swimPhase: 0,
    feedingPulse: 0,
    lastFeedingMotionSequence: null,
    lastFeedingConsumedBiomass: null,
    phaseOffset: animalHash(id) * Math.PI * 2,
  };
};

const createDaphniaDisplay = (
  id: string,
  target: AnimalRenderTarget,
): AnimalDisplay => {
  const container = new Container();
  const selection = new Graphics()
    .ellipse(0, 0, 11, 13)
    .stroke({ color: 0xf8edc7, width: 3.5, alpha: 0.72 })
    .stroke({ color: 0xb76e68, width: 1.4, alpha: 0.95 });
  const placement = new Graphics()
    .ellipse(0, 0, 12, 14)
    .stroke({ color: 0xffffff, width: 2.2, alpha: 0.92 });
  const art = new Container();
  const head = new Container();
  const shell = new Graphics()
    .moveTo(3.8, -7.5)
    .bezierCurveTo(-2.7, -9.6, -8.8, -5.2, -8.4, 1.8)
    .bezierCurveTo(-8, 7.1, -2.8, 9.2, 2.1, 6.1)
    .bezierCurveTo(6, 3.6, 7.2, -2.7, 3.8, -7.5)
    .closePath()
    .fill({ color: 0xe7b7ad, alpha: 0.48 })
    .stroke({ color: 0x594c49, width: 1.15, alpha: 0.94, join: 'round' });
  const inner = new Graphics()
    .moveTo(-3.4, -4.8)
    .bezierCurveTo(-5.8, -0.8, -5.1, 4.4, -1.1, 5.7)
    .bezierCurveTo(1.6, 3.5, 2.8, -0.5, 1.1, -4.6)
    .stroke({ color: 0x9d6f67, width: 1.4, alpha: 0.48, cap: 'round' });
  const eye = new Graphics()
    .circle(3.3, -4.6, 1.75)
    .fill({ color: 0x303a38, alpha: 0.98 })
    .circle(3.8, -5.1, 0.45)
    .fill({ color: 0xf7e8c5, alpha: 0.9 });
  head.addChild(shell, inner, eye);
  const antennae = new Container();
  antennae.addChild(new Graphics()
    .moveTo(4.8, -5.3)
    .bezierCurveTo(9, -9.4, 12.2, -10, 15.5, -8.1)
    .moveTo(5.1, -4.6)
    .bezierCurveTo(10, -5.8, 13, -4.2, 15.2, -1.7)
    .stroke({ color: 0x514744, width: 0.8, alpha: 0.82, cap: 'round' }));
  const legs = new Container();
  legs.addChild(new Graphics()
    .moveTo(2, 0.2).quadraticCurveTo(7.1, 1.2, 8.1, 4.5)
    .moveTo(1.2, 1.8).quadraticCurveTo(5.3, 4.2, 5, 7.2)
    .moveTo(0.1, 3).quadraticCurveTo(2.7, 6.2, 1.4, 8.1)
    .stroke({ color: 0x725a55, width: 0.65, alpha: 0.67, cap: 'round' }));
  const tail = new Container();
  tail.addChild(new Graphics()
    .moveTo(-2.2, 6.3)
    .quadraticCurveTo(-5.2, 10.2, -7.2, 12.7)
    .stroke({ color: 0x514744, width: 0.85, alpha: 0.82, cap: 'round' }));
  const eggs = new Graphics();
  for (const [x, y] of [[-2.6, -2.2], [-3.3, 0], [-2.2, 2.1]] as const) {
    eggs.circle(x, y, 1.35)
      .fill({ color: 0xd98f72, alpha: 0.83 })
      .stroke({ color: 0x76524c, width: 0.45, alpha: 0.7 });
  }
  const empty = emptyAnimalPart();
  art.addChild(tail, antennae, legs, head, eggs);
  container.addChild(selection, placement, art);
  return {
    speciesId: 'daphnia',
    lifeStage: target.lifeStage,
    container,
    selection,
    placement,
    art,
    head,
    abdomen: [],
    tail,
    legs,
    antennae,
    eggs,
    grazingFeedback: empty,
    grazingMouth: new Graphics(),
    grazingFlecks: [],
    target,
    renderX: target.x,
    renderY: target.y,
    renderFacing: target.facing,
    renderPoseAngle: target.poseAngle,
    renderBodyLength: target.bodyLength,
    renderMotion: { ...ANIMAL_MOTION_PROFILES[target.behavior] },
    grazingWeight: 0,
    phase: 0,
    swimPhase: 0,
    feedingPulse: 0,
    lastFeedingMotionSequence: null,
    lastFeedingConsumedBiomass: null,
    phaseOffset: animalHash(id) * Math.PI * 2,
  };
};

const createAnimalDisplay = (
  id: string,
  target: AnimalRenderTarget,
): AnimalDisplay => {
  if (target.speciesId === 'japanese-ricefish') {
    return createRicefishDisplay(id, target);
  }
  if (target.speciesId === 'daphnia') {
    return createDaphniaDisplay(id, target);
  }
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
    speciesId: 'cherry-shrimp',
    lifeStage: target.lifeStage,
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
    renderMotion: { ...ANIMAL_MOTION_PROFILES[target.behavior] },
    grazingWeight: target.behavior === 'grazing' ? 1 : 0,
    phase: 0,
    swimPhase: 0,
    feedingPulse: 0,
    lastFeedingMotionSequence: null,
    lastFeedingConsumedBiomass: null,
    phaseOffset,
  };
};

const resetAnimalDisplay = (
  display: AnimalDisplay,
  id: string,
  target: AnimalRenderTarget,
): void => {
  display.lifeStage = target.lifeStage;
  display.target = target;
  display.renderX = target.x;
  display.renderY = target.y;
  display.renderFacing = target.facing;
  display.renderPoseAngle = target.poseAngle;
  display.renderBodyLength = target.bodyLength;
  Object.assign(display.renderMotion, ANIMAL_MOTION_PROFILES[target.behavior]);
  display.grazingWeight = target.behavior === 'grazing' ? 1 : 0;
  display.phase = 0;
  display.swimPhase = 0;
  display.feedingPulse = 0;
  display.lastFeedingMotionSequence = null;
  display.lastFeedingConsumedBiomass = null;
  display.phaseOffset = animalHash(id) * Math.PI * 2;
  display.container.position.set(target.x, target.y);
  display.container.visible = true;
  display.selection.visible = false;
  display.placement.visible = false;
  display.art.position.set(0, 0);
  display.art.pivot.set(0, 0);
  display.art.rotation = 0;
  display.art.skew.set(0, 0);
  display.art.scale.set(1);
  display.art.alpha = 1;
  display.art.tint = 0xffffff;
  const hasRicefishBody =
    display.speciesId === 'japanese-ricefish' && display.lifeStage !== 'egg';
  display.head.pivot.set(hasRicefishBody ? RICEFISH_BODY_PIVOT_X : 0, 0);
  display.head.position.set(hasRicefishBody ? RICEFISH_BODY_PIVOT_X : 0, 0);
  display.head.rotation = 0;
  display.head.skew.set(0, 0);
  display.head.scale.set(1);
  display.tail.position.set(
    display.speciesId === 'cherry-shrimp'
      ? -21
      : hasRicefishBody
        ? RICEFISH_CAUDAL_BASE_X
        : 0,
    hasRicefishBody ? RICEFISH_CAUDAL_BASE_Y : 0,
  );
  display.tail.pivot.set(0, 0);
  display.tail.rotation = 0;
  display.tail.skew.set(0, 0);
  display.tail.scale.set(1);
  display.legs.position.set(0, 0);
  display.legs.pivot.set(0, 0);
  display.legs.rotation = 0;
  display.legs.skew.set(0, 0);
  display.legs.scale.set(1);
  display.legs.alpha = 1;
  display.antennae.position.set(0, 0);
  display.antennae.pivot.set(0, 0);
  display.antennae.rotation = 0;
  display.antennae.skew.set(0, 0);
  display.antennae.scale.set(1);
  if (display.pectoral) {
    display.pectoral.rotation = 0;
    display.pectoral.skew.set(0, 0);
    display.pectoral.scale.set(1);
  }
  if (display.closedMouth) display.closedMouth.alpha = 1;
  if (display.feedingMouth) {
    display.feedingMouth.alpha = 0;
    display.feedingMouth.scale.set(1);
  }
  if (display.feedingJaw) {
    display.feedingJaw.alpha = 0;
    display.feedingJaw.rotation = 0;
    display.feedingJaw.scale.set(1);
  }
  for (const medianFin of [
    display.dorsalFin,
    display.analFin,
    display.pelvicFin,
  ]) {
    if (!medianFin) continue;
    medianFin.rotation = 0;
    medianFin.skew.set(0, 0);
    medianFin.scale.set(1);
  }
  display.eggs.visible = false;
  display.grazingFeedback.visible = false;
};

const acquireAnimalDisplay = (
  pool: AnimalDisplayPool | undefined,
  id: string,
  target: AnimalRenderTarget,
): AnimalDisplay => {
  const display = pool?.take(
    animalDisplayPoolKey(target.speciesId, target.lifeStage, target.sex),
  );
  if (!display) return createAnimalDisplay(id, target);
  resetAnimalDisplay(display, id, target);
  return display;
};

const releaseAnimalDisplay = (
  layer: Container,
  pool: AnimalDisplayPool | undefined,
  display: AnimalDisplay,
): void => {
  layer.removeChild(display.container);
  display.container.visible = false;
  if (pool?.release(
    animalDisplayPoolKey(
      display.speciesId,
      display.lifeStage,
      display.target.sex,
    ),
    display,
  )) return;
  destroyDisplayTree(display.container);
};

const createAnimalCarcassDisplay = (
  target: AnimalCarcassSnapshot,
): AnimalCarcassDisplay => {
  if (target.speciesId === 'daphnia') {
    const living = createDaphniaDisplay(target.id, {
      speciesId: 'daphnia',
      lifeStage: target.lifeStage,
      sex: 'female',
      x: target.x,
      y: target.y,
      facing: target.facing,
      poseAngle: target.poseAngle,
      bodyLength: target.bodyLength,
      behavior: 'resting',
      health: 0,
      selected: false,
      held: false,
      placementValid: true,
      reproductiveState: 'none',
      consumedBiomass: 0,
      interpolatedPosition: false,
    });
    living.selection.visible = false;
    living.placement.visible = false;
    living.eggs.visible = false;
    living.art.tint = 0xb9b8a9;
    return {
      speciesId: target.speciesId,
      container: living.container,
      art: living.art,
      head: living.head,
      abdomen: living.abdomen,
      tail: living.tail,
      legs: living.legs,
      antennae: living.antennae,
      target,
      renderX: target.x,
      renderY: target.y,
      renderFacing: target.facing,
      renderBodyLength: target.bodyLength,
      phaseOffset: animalHash(target.id) * Math.PI * 2,
      lastVisualSnapshot: writeAnimalCarcassVisualSnapshot(target),
      animationSettled: false,
    };
  }
  if (target.speciesId === 'japanese-ricefish') {
    const container = new Container();
    const art = new Container();
    const bodyArt = drawRicefishBody(target.lifeStage, 'female');
    const head = bodyArt.container;
    const tail = drawRicefishTail(target.lifeStage);
    const fins = drawRicefishFins(target.lifeStage, 'female').container;
    const empty = emptyAnimalPart();
    tail.position.set(RICEFISH_CAUDAL_BASE_X, RICEFISH_CAUDAL_BASE_Y);
    art.addChild(tail, fins, head);
    art.tint = 0xbcbba8;
    container.addChild(art);
    return {
      speciesId: target.speciesId,
      container,
      art,
      head,
      abdomen: [],
      tail,
      legs: fins,
      antennae: empty,
      target,
      renderX: target.x,
      renderY: target.y,
      renderFacing: target.facing,
      renderBodyLength: target.bodyLength,
      phaseOffset: animalHash(target.id) * Math.PI * 2,
      lastVisualSnapshot: writeAnimalCarcassVisualSnapshot(target),
      animationSettled: false,
    };
  }
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
    speciesId: target.speciesId,
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
    lastVisualSnapshot: writeAnimalCarcassVisualSnapshot(target),
    animationSettled: false,
  };
};

const resetAnimalCarcassDisplay = (
  display: AnimalCarcassDisplay,
  target: AnimalCarcassSnapshot,
): void => {
  display.target = target;
  display.renderX = target.x;
  display.renderY = target.y;
  display.renderFacing = target.facing;
  display.renderBodyLength = target.bodyLength;
  display.phaseOffset = animalHash(target.id) * Math.PI * 2;
  writeAnimalCarcassVisualSnapshot(target, display.lastVisualSnapshot);
  display.animationSettled = false;
  display.container.position.set(target.x, target.y);
  display.container.visible = true;
  display.art.position.set(0, 0);
  display.art.alpha = 0.86;
  display.head.position.set(0, 0);
  display.head.rotation = 0;
  display.tail.rotation = 0;
  display.legs.position.set(0, 0);
  display.legs.rotation = 0;
  display.legs.alpha = 1;
  display.antennae.position.set(0, 0);
  display.antennae.rotation = 0;
};

const acquireAnimalCarcassDisplay = (
  pool: AnimalCarcassDisplayPool | undefined,
  target: AnimalCarcassSnapshot,
): AnimalCarcassDisplay => {
  const display = pool?.take(animalCarcassDisplayPoolKey(target.speciesId));
  if (!display) return createAnimalCarcassDisplay(target);
  resetAnimalCarcassDisplay(display, target);
  return display;
};

const releaseAnimalCarcassDisplay = (
  layer: Container,
  pool: AnimalCarcassDisplayPool | undefined,
  display: AnimalCarcassDisplay,
): void => {
  layer.removeChild(display.container);
  display.container.visible = false;
  if (pool?.release(animalCarcassDisplayPoolKey(display.speciesId), display)) return;
  destroyDisplayTree(display.container);
};

export const visibleAnimalCarcasses = (
  snapshot: Pick<SimulationSnapshot, 'carcasses' | 'selection'>,
): AnimalCarcassSnapshot[] =>
  presentedAnimalCarcasses(
    snapshot.carcasses,
    snapshot.selection?.kind === 'carcass'
      ? snapshot.selection.carcassId
      : null,
  );

const syncAnimalCarcasses = (
  layer: Container,
  snapshot: SimulationSnapshot,
  displays: Map<string, AnimalCarcassDisplay>,
  livingDisplays?: Map<string, AnimalDisplay>,
  pool?: AnimalCarcassDisplayPool,
): void => {
  const carcasses = visibleAnimalCarcasses(snapshot);
  const currentIds = new Set(carcasses.map((carcass) => carcass.id));
  for (const [id, display] of displays) {
    if (currentIds.has(id)) continue;
    releaseAnimalCarcassDisplay(layer, pool, display);
    displays.delete(id);
  }
  for (const carcass of carcasses) {
    let display = displays.get(carcass.id);
    if (!display) {
      display = acquireAnimalCarcassDisplay(pool, carcass);
      const living = livingDisplays?.get(carcass.sourceAnimalId);
      if (living) {
        // A full ecology snapshot can replace a living, interpolated animal
        // with a carcass between two motion samples. Start the carcass at the
        // exact rendered pose the player just saw, then ease toward the
        // authoritative death coordinate.
        display.renderX = living.renderX;
        display.renderY = living.renderY;
        display.renderFacing = living.renderFacing < 0 ? -1 : 1;
        display.renderBodyLength = living.renderBodyLength;
        display.container.position.set(living.renderX, living.renderY);
      } else {
        display.container.position.set(carcass.x, carcass.y);
      }
      displays.set(carcass.id, display);
      layer.addChild(display.container);
    }
    const visualSnapshotChanged = animalCarcassVisualSnapshotChanged(
      display.lastVisualSnapshot,
      carcass,
    );
    display.target = carcass;
    if (visualSnapshotChanged) {
      // Holding/probe overlays can replace the React snapshot shell at 30 Hz
      // without advancing carcass state. Wake only for an actual ecology pose
      // or age change; decoder object identity is intentionally reusable.
      writeAnimalCarcassVisualSnapshot(carcass, display.lastVisualSnapshot);
      display.animationSettled = false;
    }
  }
};

export const daphniaCarcassSinkingOffset = (
  ageSeconds: number,
  availableDrop: number,
): number => animalCarcassVisualDrop('daphnia', ageSeconds, availableDrop);

const animalTarget = (
  animal: AnimalSnapshot,
  selected: boolean,
  interpolatedPosition: boolean,
  reuse?: AnimalRenderTarget,
): AnimalRenderTarget => {
  const target = reuse ?? {
    speciesId: animal.speciesId,
    lifeStage: animal.lifeStage,
    sex: animal.sex,
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
    consumedBiomass: animal.consumedBiomass,
    interpolatedPosition,
  };
  target.speciesId = animal.speciesId;
  target.lifeStage = animal.lifeStage;
  target.sex = animal.sex;
  target.x = animal.x;
  target.y = animal.y;
  target.facing = animal.facing;
  target.poseAngle = animal.poseAngle;
  target.bodyLength = animal.bodyLength;
  target.behavior = animal.behavior;
  target.health = animal.health;
  target.selected = selected;
  target.held = false;
  target.placementValid = true;
  target.reproductiveState = animal.reproductiveState;
  target.consumedBiomass = animal.consumedBiomass;
  target.interpolatedPosition = interpolatedPosition;
  return target;
};

const syncAnimals = (
  layer: Container,
  snapshot: SimulationSnapshot,
  displays: Map<string, AnimalDisplay>,
  animals: AnimalSnapshot[] = snapshot.animals,
  holding: SimulationSnapshot['holding'] = snapshot.holding,
  interpolatedPosition = false,
  removeMissing = true,
  suppressInventoryHolding = false,
  pool?: AnimalDisplayPool,
): void => {
  const held = holding?.kind === 'animal' ? holding : null;
  const heldId = held?.animalId ?? null;
  const currentIds = new Set(animals.map((animal) => animal.id));
  if (heldId) currentIds.add(heldId);

  if (removeMissing) {
    for (const [id, display] of displays) {
      if (currentIds.has(id)) continue;
      releaseAnimalDisplay(layer, pool, display);
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
    let display = displays.get(animal.id);
    if (
      display &&
      (
        display.speciesId !== animal.speciesId ||
        (
          animal.speciesId === 'japanese-ricefish' &&
          (
            display.lifeStage !== animal.lifeStage ||
            display.target.sex !== animal.sex
          )
        ) ||
        (
          animal.speciesId !== 'japanese-ricefish' &&
          (display.lifeStage === 'egg') !== (animal.lifeStage === 'egg')
        )
      )
    ) {
      releaseAnimalDisplay(layer, pool, display);
      displays.delete(animal.id);
      display = undefined;
    }
    const target = animalTarget(
      animal,
      selectedIds.has(animal.id),
      interpolatedPosition,
      display?.target,
    );
    if (!display) {
      display = acquireAnimalDisplay(pool, animal.id, target);
      displays.set(animal.id, display);
      layer.addChild(display.container);
    }
    display.target = target;
    display.lifeStage = animal.lifeStage;
    display.container.visible = true;
  }

  if (held && heldId) {
    let display = displays.get(heldId);
    const previous = display?.target;
    const target: AnimalRenderTarget = {
      speciesId: held.animalSpeciesId ?? previous?.speciesId ?? 'cherry-shrimp',
      lifeStage: previous?.lifeStage ?? 'adult',
      sex: previous?.sex ?? 'female',
      x: held.x,
      y: held.y,
      facing: previous?.facing ?? 1,
      poseAngle: 0,
      bodyLength: previous?.bodyLength ?? (
        held.animalSpeciesId === 'japanese-ricefish'
          ? RICEFISH_ADULT_LENGTH
          : held.animalSpeciesId === 'daphnia'
            ? 9
          : SHRIMP_ADULT_LENGTH
      ),
      behavior: 'held',
      health: previous?.health ?? 1,
      selected: false,
      held: true,
      placementValid: held.valid,
      reproductiveState: previous?.reproductiveState ?? 'none',
      consumedBiomass: previous?.consumedBiomass ?? 0,
      interpolatedPosition,
    };
    if (!display) {
      display = acquireAnimalDisplay(pool, heldId, target);
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
  latestMotionFrame: SimulationMotionFrame | null = null,
): void => {
  if (latestMotionFrame) {
    for (const animal of latestMotionFrame.animals) {
      const display = displays.get(animal.id);
      if (!display) continue;
      const previousConsumedBiomass =
        display.lastFeedingConsumedBiomass ?? animal.consumedBiomass;
      const consumedFood = animal.speciesId === 'japanese-ricefish'
        ? shouldTriggerRicefishBitePulse(
          display.lastFeedingMotionSequence,
          latestMotionFrame.sequence,
          previousConsumedBiomass,
          animal.consumedBiomass,
        )
        : animal.speciesId === 'cherry-shrimp'
          ? shouldTriggerShrimpGrazingPulse(
            display.lastFeedingMotionSequence,
            latestMotionFrame.sequence,
            previousConsumedBiomass,
            animal.consumedBiomass,
          )
          : false;
      if (consumedFood) {
        display.feedingPulse = 1;
      }
      display.lastFeedingMotionSequence = latestMotionFrame.sequence;
      display.lastFeedingConsumedBiomass = animal.consumedBiomass;
      display.target.consumedBiomass = animal.consumedBiomass;
    }
  }

  for (const animal of animals) {
    const display = displays.get(animal.id);
    if (!display) continue;
    const target = display.target;
    target.speciesId = animal.speciesId;
    target.lifeStage = animal.lifeStage;
    target.sex = animal.sex;
    target.x = animal.x;
    target.y = animal.y;
    target.facing = animal.facing;
    target.poseAngle = animal.poseAngle;
    target.bodyLength = animal.bodyLength;
    target.behavior = animal.behavior;
    target.health = animal.health;
    target.held = false;
    target.placementValid = true;
    target.reproductiveState = animal.reproductiveState;
    if (animal.speciesId !== 'japanese-ricefish' || !latestMotionFrame) {
      target.consumedBiomass = animal.consumedBiomass;
    }
    target.interpolatedPosition = interpolatedPosition;
  }

  const held = holding?.kind === 'animal' ? holding : null;
  if (!held?.animalId) return;
  const display = displays.get(held.animalId);
  if (!display) return;
  display.target.x = held.x;
  display.target.y = held.y;
  display.target.held = true;
  display.target.placementValid = held.valid;
  display.target.behavior = 'held';
  display.target.interpolatedPosition = interpolatedPosition;
};

const ANIMAL_MOTION_PROFILES: Record<AnimalSnapshot['behavior'], AnimalMotionProfile> = {
  traveling: { rate: 7.4, bend: 0.08, bob: 0.7, head: 0.025, legs: 0.1 },
  exploring: { rate: 5.2, bend: 0.055, bob: 0.46, head: 0.04, legs: 0.075 },
  grazing: { rate: 8.2, bend: 0.022, bob: 0.12, head: 0.075, legs: 0.115 },
  resting: { rate: 1.6, bend: 0.018, bob: 0.12, head: 0.018, legs: 0.018 },
  starving: { rate: 1.05, bend: 0.012, bob: 0.08, head: 0.012, legs: 0.01 },
  held: { rate: 2.3, bend: 0.026, bob: 0.28, head: 0.025, legs: 0.03 },
  hunting: { rate: 9.4, bend: 0.105, bob: 0.25, head: 0.02, legs: 0.02 },
  courting: { rate: 6.8, bend: 0.07, bob: 0.35, head: 0.025, legs: 0.02 },
  'carrying-eggs': { rate: 4.4, bend: 0.04, bob: 0.25, head: 0.02, legs: 0.02 },
  incubating: { rate: 0, bend: 0, bob: 0, head: 0, legs: 0 },
};

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
    const desiredMotion = ANIMAL_MOTION_PROFILES[target.behavior];
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
      if (
        display.speciesId === 'japanese-ricefish' &&
        display.lifeStage !== 'egg'
      ) {
        // Medaka are continuous undulatory swimmers. Keep their tail clock
        // independent of simulation fast-forward and of the slower generic
        // phase used for bobbing and other species' appendages.
        display.swimPhase +=
          delta * motion.rate * RICEFISH_SWIM_RATE_MULTIPLIER;
      }
    }
    const phase = display.phase + display.phaseOffset;
    const facingSign = display.renderFacing < 0 ? -1 : 1;
    const artScale = shrimpVisualScale(display.renderBodyLength);
    const bob = Math.sin(phase * 0.72) * motion.bob;

    display.container.position.set(display.renderX, display.renderY);
    display.container.zIndex = display.renderY;
    display.art.position.set(0, bob);
    display.art.rotation = display.renderPoseAngle * facingSign;
    display.art.scale.set(display.renderFacing * artScale, artScale);
    display.art.alpha = target.held
      ? 0.58
      : Math.max(0.56, 0.74 + target.health * 0.26);

    if (display.speciesId === 'japanese-ricefish') {
      const isEgg = display.lifeStage === 'egg';
      const fishScale = isEgg
        ? 1
        : Math.max(0.2, display.renderBodyLength / RICEFISH_DRAW_LENGTH);
      // Flip on a stable sign. Interpolating scale through zero made a fish
      // briefly collapse or disappear every time it changed direction.
      display.art.scale.set(isEgg ? 1 : facingSign * fishScale, fishScale);
      display.art.rotation = isEgg
        ? 0
        : display.renderPoseAngle * facingSign;
      display.art.position.set(0, isEgg ? Math.sin(phase * 0.45) * 0.25 : bob * 0.72);
      display.selection.visible = target.selected && !target.held;
      display.selection.rotation = isEgg ? 0 : display.renderPoseAngle * facingSign;
      display.selection.scale.set(isEgg ? 0.8 : Math.max(0.62, fishScale * 1.08));
      display.placement.visible = target.held;
      display.placement.rotation = isEgg ? 0 : display.renderPoseAngle * facingSign;
      display.placement.scale.set(isEgg ? 0.75 : Math.max(0.62, fishScale * 1.08));
      display.placement.tint = target.placementValid ? 0xf0c85e : 0xd7605b;
      if (!isEgg) {
        const mouthGape = ricefishMouthGape(display.feedingPulse);
        const strikeSide = Math.sin(display.phaseOffset * 1.73) < 0 ? -1 : 1;
        const strikePose = ricefishSideSwingPose(
          display.feedingPulse,
          strikeSide,
        );
        display.art.rotation += strikePose.bodyRotation * facingSign;
        if (display.closedMouth) {
          display.closedMouth.alpha = 1 - mouthGape * 0.96;
        }
        if (display.feedingMouth) {
          display.feedingMouth.alpha = mouthGape;
          display.feedingMouth.scale.set(1);
        }
        if (display.feedingJaw) {
          display.feedingJaw.alpha = mouthGape;
          display.feedingJaw.rotation = mouthGape * 0.1;
        }
        display.feedingPulse = Math.max(
          0,
          display.feedingPulse -
            delta / RICEFISH_BITE_DURATION_SECONDS,
        );
        const swimPhase = display.swimPhase + display.phaseOffset;
        const swimPose = ricefishSwimPose(swimPhase, motion.bend);
        display.head.rotation = 0;
        display.head.skew.set(
          0,
          swimPose.bodySkewY + strikePose.bodySkewY,
        );
        display.tail.position.set(
          RICEFISH_CAUDAL_BASE_X,
          RICEFISH_CAUDAL_BASE_Y,
        );
        display.tail.rotation = 0;
        display.tail.skew.set(
          0,
          swimPose.tailSkewY + strikePose.tailSkewY,
        );
        display.tail.scale.set(1);
        // Dorsal, anal, and pelvic fins keep their actual shape. They inherit
        // only the rear body's tiny flex and never stretch independently.
        display.legs.rotation = 0;
        display.legs.skew.set(0, 0);
        display.legs.scale.set(1);
        if (display.pectoral) {
          display.pectoral.rotation = swimPose.pectoralRotation;
          display.pectoral.scale.set(1);
        }
        // Ordinary swimming produces only a small shape-preserving flex.
        // During courtship the male actively spreads both median fins to wrap
        // the female, represented here by a modest extra root rotation.
        const courtshipSpread = target.behavior === 'courting' ? 0.035 : 0;
        if (display.dorsalFin) {
          display.dorsalFin.rotation =
            swimPose.dorsalRotation + courtshipSpread;
          display.dorsalFin.scale.set(1);
        }
        if (display.analFin) {
          display.analFin.rotation =
            swimPose.analRotation + courtshipSpread;
          display.analFin.scale.set(1);
        }
        if (display.pelvicFin) {
          display.pelvicFin.rotation = swimPose.analRotation * 0.35;
          display.pelvicFin.scale.set(1);
        }
      } else {
        const developmentPulse = 0.98 + Math.sin(phase * 0.28) * 0.025;
        display.head.scale.set(developmentPulse);
      }
      continue;
    }

    if (display.speciesId === 'daphnia') {
      const daphniaScale = daphniaVisualScale(display.renderBodyLength);
      const hopPulse = Math.max(0, Math.sin(phase));
      display.art.scale.set(
        display.renderFacing * daphniaScale,
        daphniaScale * (0.98 + hopPulse * 0.035),
      );
      display.art.rotation = display.renderPoseAngle * facingSign;
      display.art.position.set(0, bob * 0.48 - hopPulse * 0.45);
      display.selection.visible = target.selected && !target.held;
      display.selection.rotation = display.art.rotation;
      display.selection.scale.set(daphniaScale);
      display.placement.visible = target.held;
      display.placement.rotation = display.art.rotation;
      display.placement.scale.set(daphniaScale);
      display.placement.tint = target.placementValid ? 0xf0c85e : 0xd7605b;
      display.eggs.visible = target.reproductiveState === 'carrying-eggs';
      display.antennae.rotation = Math.sin(phase * 0.72 + 0.5) * 0.12 -
        hopPulse * 0.08;
      display.legs.rotation = Math.sin(phase * 1.35) * 0.08;
      display.tail.rotation = Math.sin(phase * 0.63) * 0.045;
      continue;
    }

    const selectionScale = shrimpVisualScale(display.renderBodyLength) * 1.08;
    display.selection.visible = target.selected && !target.held;
    display.selection.rotation = display.renderPoseAngle * facingSign;
    display.selection.scale.set(selectionScale);
    display.placement.visible = target.held;
    display.placement.rotation = display.renderPoseAngle * facingSign;
    display.placement.scale.set(selectionScale);
    display.placement.tint = target.placementValid ? 0xf0c85e : 0xd7605b;
    display.eggs.visible = target.reproductiveState === 'berried';

    const actualIntakePulse = Math.max(0, Math.min(1, display.feedingPulse));
    const grazingTarget = target.behavior === 'grazing' && !target.held ? 1 : 0;
    display.grazingWeight += (grazingTarget - display.grazingWeight) * behaviorEase;
    const showsGrazing = display.grazingWeight > 0.01 || actualIntakePulse > 0.01;
    display.grazingFeedback.visible = showsGrazing;
    display.grazingFeedback.alpha = Math.max(
      display.grazingWeight * 0.72,
      actualIntakePulse,
    );
    if (showsGrazing) {
      const tug = Math.max(0, Math.sin(phase * 2.35)) *
        Math.max(display.grazingWeight * 0.72, actualIntakePulse);
      display.head.position.set(tug * 0.9, tug * 0.1);
      display.grazingMouth.scale.set(0.9 + tug * 0.18, 0.72 + tug * 0.42);
      display.grazingMouth.alpha = 0.68 + Math.min(1, tug) * 0.32;
      for (let index = 0; index < display.grazingFlecks.length; index += 1) {
        const fleck = display.grazingFlecks[index];
        const progress = (phase * 0.36 + index / display.grazingFlecks.length) % 1;
        const inward = 1 - progress;
        fleck.position.set(
          21.5 + inward * (6 + index * 1.1),
          Math.sin(phase * 1.1 + index * 2.15) * (1.6 + inward * 2.2),
        );
        const fleckScale = (0.58 + inward * 0.55) *
          (0.78 + actualIntakePulse * 0.38);
        fleck.scale.set(fleckScale);
        fleck.alpha = Math.sin(progress * Math.PI) *
          actualIntakePulse * 0.96;
        fleck.rotation = phase * 0.18 * (index % 2 === 0 ? 1 : -1);
      }
    } else {
      display.head.position.set(0, 0);
    }
    display.feedingPulse = Math.max(0, display.feedingPulse - delta / 0.32);

    for (let index = 0; index < display.abdomen.length; index += 1) {
      const segment = display.abdomen[index];
      const tailRatio = (index + 1) / display.abdomen.length;
      const wave = Math.sin(phase - index * 0.62);
      segment.position.set(SHRIMP_ABDOMEN_X[index], wave * motion.bend * 9 * tailRatio);
      segment.rotation = wave * motion.bend * tailRatio;
    }
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
  groundY = GROUND_Y,
): void => {
  const delta = Math.max(0, Math.min(0.05, deltaSeconds));
  for (const display of displays.values()) {
    if (display.animationSettled) continue;
    const { target } = display;
    const positionEase = 1 - Math.exp(-delta * 10);
    const scaleEase = 1 - Math.exp(-delta * 12);
    display.renderX += (target.x - display.renderX) * positionEase;
    display.renderY += (target.y - display.renderY) * positionEase;
    display.renderFacing += (target.facing - display.renderFacing) * scaleEase;
    display.renderBodyLength += (target.bodyLength - display.renderBodyLength) * scaleEase;
    const transitionSettled = animalCarcassTransitionSettled(
      target,
      display.renderX,
      display.renderY,
      display.renderFacing,
      display.renderBodyLength,
    );
    if (transitionSettled) {
      display.renderX = target.x;
      display.renderY = target.y;
      display.renderFacing = target.facing;
      display.renderBodyLength = target.bodyLength;
    }

    const age = Math.max(0, target.ageSeconds);
    const lifetime = Math.max(0.001, target.lifetimeSeconds);
    const lifeProgress = Math.min(1, age / lifetime);
    const settle = 1 - Math.exp(-age * 1.35);
    const availableDrop = Math.max(0, groundY - 8 - target.y);
    const drop = display.speciesId === 'daphnia'
      ? daphniaCarcassSinkingOffset(age, availableDrop)
      : Math.min(8, availableDrop) * settle;
    const lastMoments = Math.max(0, (lifeProgress - 0.72) / 0.28);
    const fade = 1 - lastMoments * lastMoments * (3 - 2 * lastMoments);
    const artScale = shrimpVisualScale(display.renderBodyLength);
    const facingSign = display.renderFacing < 0 ? -1 : 1;

    display.container.position.set(display.renderX, display.renderY + drop);
    display.container.zIndex = display.renderY + drop - 0.5;
    display.art.scale.set(facingSign * artScale, artScale * 0.9);
    // A carcass may sink, but it must not keep playing a periodic living pose.
    // At 64x the old age-based sine was sampled in large jumps and read as a
    // dead animal vibrating forever when the renderer became busy.
    display.art.rotation = facingSign * 0.24;
    display.art.alpha = Math.max(0, fade) * 0.86;

    if (display.speciesId === 'japanese-ricefish') {
      const fishScale = Math.max(0.2, display.renderBodyLength / RICEFISH_DRAW_LENGTH);
      display.art.scale.set(facingSign * fishScale, fishScale * 0.92);
      display.art.rotation = facingSign * (0.42 + settle * 0.42);
      display.tail.rotation = 0;
      display.legs.alpha = 0.48;
      display.animationSettled = transitionSettled;
      continue;
    }

    if (display.speciesId === 'daphnia') {
      const daphniaScale = daphniaVisualScale(display.renderBodyLength);
      display.art.scale.set(facingSign * daphniaScale, daphniaScale * 0.92);
      display.art.rotation = facingSign * 0.46;
      display.antennae.rotation = 0.18;
      display.legs.rotation = -0.2;
      display.tail.rotation = 0.12;
      display.legs.alpha = 0.42;
      display.animationSettled = transitionSettled;
      continue;
    }

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
    display.animationSettled = transitionSettled;
  }
};

const structureAlgaeGeometryKey = (snapshot: SimulationSnapshot): string =>
  snapshot.structures.map((structure) => [
    structure.id,
    algaeKeyNumber(structure.x),
    algaeKeyNumber(structure.y),
    algaeKeyNumber(structure.angle),
  ].join(':')).join('|');

interface AlgaeDensitySurface {
  surfaceKind: SurfaceCellSnapshot['surfaceKind'];
  speciesLayers: Record<AlgaeSpeciesId, AlgaeSpeciesDensityLayer>;
  fieldDirty: Record<AlgaeSpeciesId, boolean>;
  lastFieldRenderAtMs: Record<AlgaeSpeciesId, number>;
  mask: Graphics;
  maskKey: string;
  cells: Record<AlgaeSpeciesId, Map<string, string>>;
  colonization: Record<AlgaeSpeciesId, Map<string, AlgaeColonizationState>>;
}

interface AlgaeSpeciesDensityLayer {
  container: Container;
  densityMarks: Container;
  brushTexture: Texture;
  brushSprites: Map<string, Sprite>;
  detailGraphics: Graphics;
  detailContext: GraphicsContext;
  detailGeometryKey: string;
}

export interface AlgaeColonizationState {
  active: boolean;
  generation: number;
}

const algaeDensitySurfaces = new WeakMap<Container, AlgaeDensitySurface>();

// Keep the July packaged build's restrained hand-drawn texture. The soft wash
// carries biomass; the strokes and grains only identify the two algae types.
export const ALGAE_OEDOGONIUM_DETAILS_PER_ACTIVE_CELL = 4;
export const OEDOGONIUM_DENSITY_ALPHA = 0.86;
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

export const nitzschiaSpeckCount = (
  visualLevel: number,
  _biomass?: number,
  speciesShare = 1,
): number => Math.round(
  algaeDetailCount(
    ALGAE_NITZSCHIA_DETAILS_PER_ACTIVE_CELL,
    visualLevel,
  ) * Math.max(0, Math.min(1, speciesShare)),
);

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
  // Nitzschia reads as short golden-brown needle/lozenge cells, not round
  // sub-pixel dust. The major axis remains visible at fit zoom while the thin
  // minor axis keeps a mature film from looking like large pebbles.
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

export const ALGAE_BRUSH_TEXTURE_SIZE = 96;
export const ALGAE_BRUSH_MEMBRANE_RADIUS = 27;
export const ALGAE_BRUSH_SOFT_EDGE_PIXELS = 10;
export const ALGAE_PACKAGED_WASH_DARKEN_GAIN = 1.8;

const createAlgaeBrushCanvas = (speciesId: AlgaeSpeciesId): HTMLCanvasElement => {
  const size = ALGAE_BRUSH_TEXTURE_SIZE;
  const center = size / 2;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) return canvas;

  context.save();
  context.filter = `blur(${ALGAE_BRUSH_SOFT_EDGE_PIXELS}px)`;
  const nitzschiaBrush = NITZSCHIA_VISUAL_STYLE.brush;
  const baseAlpha = speciesId === 'oedogonium' ? 0.52 : nitzschiaBrush.alpha;
  const alpha = Math.min(1, baseAlpha * ALGAE_PACKAGED_WASH_DARKEN_GAIN);
  context.fillStyle = speciesId === 'oedogonium'
    ? `rgba(84, 132, 73, ${alpha})`
    : `rgba(${nitzschiaBrush.red}, ${nitzschiaBrush.green}, ${nitzschiaBrush.blue}, ${alpha})`;
  const membranePoints = Array.from({ length: 18 }, (_, index) => {
    const angle = (index / 18) * Math.PI * 2;
    const radius = ALGAE_BRUSH_MEMBRANE_RADIUS - 3 +
      hash01(index * 29 + (speciesId === 'oedogonium' ? 5 : 41)) * 3;
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

  const createSpeciesLayer = (speciesId: AlgaeSpeciesId): AlgaeSpeciesDensityLayer => {
    const container = new Container();
    container.visible = false;
    const brushTexture = Texture.from(createAlgaeBrushCanvas(speciesId));
    brushTexture.source.scaleMode = 'linear';
    const densityMarks = new Container();
    densityMarks.alpha = speciesId === 'oedogonium'
      ? OEDOGONIUM_DENSITY_ALPHA
      : surfaceKind === 'substrate'
        ? NITZSCHIA_VISUAL_STYLE.substrateAlpha
        : NITZSCHIA_VISUAL_STYLE.structureAlpha;

    const detailGraphics = new Graphics();
    const detailContext = detailGraphics.context;
    styleAlgaeDetailContext(detailContext);
    // Do not clip these strokes with a Sprite alpha mask. Pixi pools the
    // MaskFilter globally; after an application/resource teardown that pool can
    // hand a destroyed shader bind group to a later frame. The resulting
    // AlphaMaskPipe exception aborts Pixi's ticker before the tank frame and
    // held-object preview are drawn. Details are already generated only for
    // biologically active cells, so drawing them directly preserves the colony
    // shape without the fragile GPU filter path.
    container.addChild(densityMarks, detailGraphics);
    content.addChild(container);
    return {
      container,
      densityMarks,
      brushTexture,
      brushSprites: new Map<string, Sprite>(),
      detailGraphics,
      detailContext,
      detailGeometryKey: '',
    };
  };

  // Match the packaged build: the brown film sits beneath green filaments.
  const speciesLayers = {
    nitzschia: createSpeciesLayer('nitzschia'),
    oedogonium: createSpeciesLayer('oedogonium'),
  };
  content.mask = mask;
  root.addChild(content, mask);
  algaeDensitySurfaces.set(root, {
    surfaceKind,
    speciesLayers,
    fieldDirty: { nitzschia: true, oedogonium: true },
    lastFieldRenderAtMs: {
      nitzschia: Number.NEGATIVE_INFINITY,
      oedogonium: Number.NEGATIVE_INFINITY,
    },
    mask,
    maskKey: '',
    cells: {
      nitzschia: new Map<string, string>(),
      oedogonium: new Map<string, string>(),
    },
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
  for (const speciesId of ['nitzschia', 'oedogonium'] as const) {
    surface.cells[speciesId].clear();
    surface.colonization[speciesId].clear();
    const speciesLayer = surface.speciesLayers[speciesId];
    const sprites = speciesLayer.densityMarks.removeChildren();
    for (const sprite of sprites) {
      sprite.destroy();
    }
    speciesLayer.brushSprites.clear();
    if (!speciesLayer.brushTexture.destroyed) {
      speciesLayer.brushTexture.destroy(true);
    }
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
    surface.mask
      .rect(0, snapshot.tank.groundY - 36, snapshot.tank.width, 45)
      .fill({ color: 0xffffff });
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

const syncAlgaeCellBrushSprite = (
  layer: AlgaeSpeciesDensityLayer,
  cell: SurfaceCellSnapshot,
  speciesId: AlgaeSpeciesId,
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
  // Geometry details remain quantized, but the standing wash follows the
  // actual remaining biomass continuously. A shrimp bite therefore thins only
  // the grazed cell even when it stays inside one 24-step detail bucket.
  const continuousVisualLevel = algaeVisualRatio(
    cell.biomass[speciesId],
  ) * ALGAE_VISUAL_LEVEL_COUNT;
  const radius = cell.cellSize * algaeParticleRadiusRatio(continuousVisualLevel);
  const scaleX = radius / ALGAE_BRUSH_MEMBRANE_RADIUS *
    (0.94 + hash01(cellSeed + speciesOffset + 23) * 0.12);
  const scaleY = radius / ALGAE_BRUSH_MEMBRANE_RADIUS *
    (0.94 + hash01(cellSeed + speciesOffset + 41) * 0.12);

  let sprite = layer.brushSprites.get(cell.id);
  if (!sprite) {
    sprite = new Sprite(layer.brushTexture);
    sprite.anchor.set(0.5);
    layer.brushSprites.set(cell.id, sprite);
    layer.densityMarks.addChild(sprite);
  }
  sprite.position.set(cell.x + jitterX, cell.y + jitterY);
  sprite.rotation = surfaceAngle +
    hash01(cellSeed + speciesOffset + 59) * Math.PI * 2;
  sprite.scale.set(scaleX, scaleY);
  sprite.alpha = algaeSpeciesWashAlpha(cell, speciesId);
  sprite.visible = true;
};

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
  const biomass = cell.biomass[speciesId];
  const visualLevel = algaeVisualLevel(biomass);
  const detailCount = speciesId === 'oedogonium'
    ? oedogoniumFilamentCount(
        cell.id,
        visualLevel,
        biomass,
        surfaceAlgaeSpeciesShare(cell.biomass, speciesId),
      )
    : nitzschiaSpeckCount(
        visualLevel,
        biomass,
        surfaceAlgaeSpeciesShare(cell.biomass, speciesId),
      );
  return [
    cell.id,
    generation,
    detailCount,
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
      const detailCount = oedogoniumFilamentCount(
        cell.id,
        algaeVisualLevel(cell.biomass.oedogonium),
        cell.biomass.oedogonium,
        surfaceAlgaeSpeciesShare(cell.biomass, 'oedogonium'),
      );
      const surfaceAngle = cell.surfaceKind === 'structure-face'
        ? structureAngles.get(cell.ownerId) ?? 0
        : 0;
      for (
        let index = 0;
        index < detailCount;
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
    const detailCount = nitzschiaSpeckCount(
      algaeVisualLevel(cell.biomass.nitzschia),
      cell.biomass.nitzschia,
      surfaceAlgaeSpeciesShare(cell.biomass, 'nitzschia'),
    );
    const surfaceAngle = cell.surfaceKind === 'structure-face'
      ? structureAngles.get(cell.ownerId) ?? 0
      : 0;
    for (
      let index = 0;
      index < detailCount;
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
  speciesId: AlgaeSpeciesId,
): void => {
  const structureAngles = new Map(
    snapshot.structures.map((structure) => [structure.id, structure.angle]),
  );
  const surfaceCellIds = new Set<string>();
  for (const cell of snapshot.cells) {
    if (cell.surfaceKind === surface.surfaceKind) surfaceCellIds.add(cell.id);
  }
  const speciesCells: SurfaceCellSnapshot[] = [];
  const speciesLayer = surface.speciesLayers[speciesId];
  for (const sprite of speciesLayer.brushSprites.values()) {
    sprite.visible = false;
  }
  for (const cell of snapshot.cells) {
    if (cell.surfaceKind !== surface.surfaceKind) continue;
    const level = algaeVisualLevel(cell.biomass[speciesId]);
    if (level === 0) continue;
    speciesCells.push(cell);
    syncAlgaeCellBrushSprite(
      speciesLayer,
      cell,
      speciesId,
      cell.surfaceKind === 'structure-face'
        ? structureAngles.get(cell.ownerId) ?? 0
        : 0,
    );
  }

  for (const [cellId, sprite] of speciesLayer.brushSprites) {
    if (surfaceCellIds.has(cellId)) continue;
    speciesLayer.brushSprites.delete(cellId);
    speciesLayer.densityMarks.removeChild(sprite);
    sprite.destroy();
  }
  rebuildAlgaeDetailGeometry(
    surface,
    speciesId,
    speciesCells,
    structureAngles,
  );
};

const flushAlgaeDensityField = (
  surface: AlgaeDensitySurface,
  snapshot: SimulationSnapshot,
  editable: boolean,
  force: boolean,
  nowMs: number,
): void => {
  for (const speciesId of ['nitzschia', 'oedogonium'] as const) {
    if (!surface.fieldDirty[speciesId] && !force) continue;
    if (!force && !shouldRefreshAlgaeRasterNow({
      phase: snapshot.phase,
      speed: snapshot.speed,
      editable,
      nowMs,
      lastRefreshAtMs: surface.lastFieldRenderAtMs[speciesId],
    })) continue;

    drawAlgaeDensityField(surface, snapshot, speciesId);
    surface.fieldDirty[speciesId] = false;
    surface.lastFieldRenderAtMs[speciesId] = nowMs;
  }
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
  for (const cell of snapshot.cells) {
    if (cell.surfaceKind !== surface.surfaceKind) continue;
    activeCellIds.add(cell.id);
    for (const speciesId of ['nitzschia', 'oedogonium'] as const) {
      const level = algaeVisualLevel(cell.biomass[speciesId]);
      if (updateAlgaeColonizationState(
        surface,
        cell.id,
        speciesId,
        level > 0,
      )) surface.fieldDirty[speciesId] = true;
      if (level > 0) visibleSpecies[speciesId] = true;
      const cells = surface.cells[speciesId];
      if (level === 0) {
        if (cells.delete(cell.id)) surface.fieldDirty[speciesId] = true;
        continue;
      }
      const visualKey = algaeCellVisualKey(cell);
      if (cells.get(cell.id) === visualKey) continue;
      cells.set(cell.id, visualKey);
      surface.fieldDirty[speciesId] = true;
    }
  }

  for (const speciesId of ['nitzschia', 'oedogonium'] as const) {
    for (const cellId of surface.cells[speciesId].keys()) {
      if (activeCellIds.has(cellId)) continue;
      surface.cells[speciesId].delete(cellId);
      surface.fieldDirty[speciesId] = true;
    }
  }

  for (const speciesId of ['nitzschia', 'oedogonium'] as const) {
    for (const [cellId, state] of surface.colonization[speciesId]) {
      if (activeCellIds.has(cellId) || !state.active) continue;
      surface.colonization[speciesId].set(cellId, {
        active: false,
        generation: state.generation,
      });
      surface.fieldDirty[speciesId] = true;
    }
  }

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

const drawVallisneriaPlant = (
  layer: Graphics,
  cellIndex: number,
  root: Vec2,
  structuralScale: number,
  health: number,
  senescent: boolean,
  opacity = 1,
): void => {
  const healthAlpha = (0.48 + health * 0.46) * opacity;
  const healthyPalette = [0x557f47, 0x6f9651, 0x80a65d];
  const oldPalette = [0x7f7441, 0x9a8750, 0xa89159];
  const leaves = vallisneriaLeaves(cellIndex, root, structuralScale);
  for (let index = 0; index < leaves.length; index += 1) {
    const leaf = leaves[index];
    const ribbonWidth = leaf.ribbonWidth;
    const baseHalf = ribbonWidth * 0.36;
    const midHalf = ribbonWidth / 2;
    const tipHalf = ribbonWidth * 0.16;
    layer
      .moveTo(leaf.root.x - baseHalf, leaf.root.y)
      .bezierCurveTo(
        leaf.controlA.x - midHalf * 0.78,
        leaf.controlA.y,
        leaf.controlB.x - midHalf,
        leaf.controlB.y,
        leaf.tip.x - tipHalf,
        leaf.tip.y + 2,
      )
      .quadraticCurveTo(leaf.tip.x, leaf.tip.y - 2, leaf.tip.x + tipHalf, leaf.tip.y + 2)
      .bezierCurveTo(
        leaf.controlB.x + midHalf,
        leaf.controlB.y,
        leaf.controlA.x + midHalf * 0.78,
        leaf.controlA.y,
        leaf.root.x + baseHalf,
        leaf.root.y,
      )
      .closePath()
      .fill({
        color: (senescent ? oldPalette : healthyPalette)[index % 3],
        alpha: healthAlpha * (0.84 + (index % 4) * 0.045),
      })
      .stroke({ color: 0x354b3b, width: 1.05, alpha: 0.72 * opacity, join: 'round' });
    layer
      .moveTo(leaf.root.x - baseHalf * 0.25, leaf.root.y - 3)
      .bezierCurveTo(
        leaf.controlA.x - midHalf * 0.2,
        leaf.controlA.y,
        leaf.controlB.x - midHalf * 0.2,
        leaf.controlB.y,
        leaf.tip.x - tipHalf * 0.3,
        leaf.tip.y + 2,
      )
      .stroke({ color: 0xd2d793, width: 0.75, alpha: 0.24 * opacity, cap: 'round' });
  }
};

const drawAquaticPlants = (
  layer: Graphics,
  snapshot: SimulationSnapshot,
  depth: VallisneriaRenderDepth,
): void => {
  layer.clear();
  const plantsByCell = new Map(snapshot.plants.map((plant) => [plant.cellId, plant]));
  const visiblePlants = snapshot.cells.flatMap((cell) => {
    const plant = plantsByCell.get(cell.id);
    const visibleThreshold = plant ? 0.004 : ALGAE_VISIBLE_BIOMASS;
    const root = plant ?? cell;
    if (
      cell.surfaceKind !== 'substrate' ||
      cell.biomass.vallisneria <= visibleThreshold ||
      vallisneriaRenderDepth(root) !== depth
    ) return [];
    return [{ cell, plant }];
  }).sort((a, b) => {
    const left = a.plant ?? a.cell;
    const right = b.plant ?? b.cell;
    return compareVallisneriaDepth(
      { index: a.cell.index, x: left.x, y: left.y },
      { index: b.cell.index, x: right.x, y: right.y },
    );
  });

  for (const { cell, plant } of visiblePlants) {
    const biomass = cell.biomass.vallisneria;
    // Reserve biomass drives metabolism, while structuralScale changes slowly
    // over a life stage. This keeps leaves stable through a single night but
    // makes runner daughters small and old plants visibly thin and yellow.
    const structuralScale = plant?.structuralScale ?? 0.72;
    const root = plant ?? cell;
    // A juvenile rosette should read as a few narrow strap leaves, not a
    // radial tentacle cluster. Maturity adds leaves and height while keeping
    // every blade anchored to the same compact crown.
    const health = plant?.health ?? Math.min(1, biomass / 0.28);
    const senescent = plant?.lifeStage === 'senescent';
    drawVallisneriaPlant(
      layer,
      cell.index,
      root,
      structuralScale,
      health,
      senescent,
    );
  }

};

const vallisneriaVisualKey = (snapshot: SimulationSnapshot): string => {
  const plants = snapshot.plants.map((plant) => [
    plant.id,
    plant.cellId,
    plant.x.toFixed(2),
    plant.y.toFixed(2),
    Math.round(plant.structuralScale / 0.015),
    Math.round(plant.health / 0.04),
    plant.lifeStage,
  ].join(':'));
  const occupiedCells = snapshot.cells.flatMap((cell) =>
    cell.surfaceKind === 'substrate' && cell.biomass.vallisneria > 0.004
      ? [`${cell.id}:${Math.round(cell.biomass.vallisneria / 0.025)}`]
      : []
  );
  return `${plants.join('|')}#${occupiedCells.join('|')}`;
};

const drawDayNightTint = (layer: Graphics, snapshot: SimulationSnapshot): void => {
  layer.clear();
  if (!snapshot.dayNight) return;
  const fullLight = snapshot.lightOutput + snapshot.naturalLightOutput;
  const currentLight = snapshot.dayNight.effectiveLightOutput;
  const darkness = fullLight > 0
    ? Math.max(0, Math.min(1, 1 - currentLight / fullLight))
    : 0;
  if (darkness <= 0.01) return;
  layer
    .rect(
      0,
      snapshot.tank.waterTop,
      snapshot.tank.width,
      snapshot.tank.groundY - snapshot.tank.waterTop,
    )
    .fill({ color: 0x173349, alpha: darkness * 0.34 });
};

const drawPhytoplankton = (layer: Container, snapshot: SimulationSnapshot): void => {
  const water = snapshot.biogeochemistry.water;
  const surface = phytoplanktonSurfaces.get(layer);
  if (!surface || !water.columns || !water.rows) {
    layer.visible = false;
    return;
  }
  ensurePhytoplanktonHazeSurface(surface, water.columns, water.rows, snapshot);
  smoothPhytoplanktonConcentration(
    water.phytoplankton,
    water.columns,
    water.rows,
    surface.hazeHorizontal,
    surface.hazeSmoothed,
  );
  const hazeVisible = writePhytoplanktonBloomPixels(
    surface.hazeSmoothed,
    surface.hazePixels,
  );
  surface.hazeSource?.update();
  surface.hazeSprite.visible = hazeVisible;

  const plan = createPhytoplanktonVisualPlan(
    water.phytoplankton,
    water.columns,
    water.rows,
  );

  for (let index = 0; index < plan.specks.length; index += 1) {
    const mark = plan.specks[index];
    const sprite = surface.speckSprites[index] ?? new Sprite(surface.speckTexture);
    if (!surface.speckSprites[index]) {
      sprite.anchor.set(0.5);
      surface.speckSprites[index] = sprite;
      layer.addChild(sprite);
    }
    sprite.position.set(mark.x, mark.y);
    sprite.width = mark.radius * 2;
    sprite.height = mark.radius * 2;
    sprite.alpha = mark.alpha;
    sprite.tint = mark.color;
    sprite.visible = true;
  }
  for (let index = plan.specks.length; index < surface.speckSprites.length; index += 1) {
    surface.speckSprites[index].visible = false;
  }

  layer.visible = hazeVisible || plan.specks.length > 0;
};

const drawInteraction = (
  layer: Graphics,
  snapshot: SimulationSnapshot,
  suppressInventoryHolding = false,
): void => {
  layer.clear();
  const held = snapshot.holding;
  if (!held || (suppressInventoryHolding && held.source === 'inventory')) return;
  if (held.kind === 'seed' && held.speciesId) {
    const color = held.valid ? SPECIES[held.speciesId].color : 0xcf5f5a;
    if (held.speciesId === 'vallisneria') {
      drawVallisneriaPlant(
        layer,
        997,
        { x: held.x, y: held.y },
        0.62,
        1,
        false,
        held.valid ? 0.82 : 0.58,
      );
    }
    layer
      .circle(held.x, held.y, 11)
      .fill({ color: 0xf9f2d9, alpha: 0.7 })
      .stroke({ color, width: 4, alpha: 0.95 });
    layer.circle(held.x, held.y, 4).fill({ color, alpha: 0.95 });
    return;
  }
  if (held.kind === 'plankton' && held.planktonKind) {
    const color = held.valid
      ? held.planktonKind === 'phytoplankton' ? 0x78a95a : 0xc88d7d
      : 0xcf5f5a;
    layer.circle(held.x, held.y, held.planktonKind === 'daphnia' ? 18 : 14)
      .fill({ color: 0xf9f2d9, alpha: 0.62 })
      .stroke({ color, width: 3, alpha: 0.94 });
    if (held.planktonKind === 'daphnia') {
      layer.ellipse(held.x, held.y, 6.5, 9.5)
        .fill({ color, alpha: 0.56 })
        .stroke({ color: 0x765f58, width: 1.4 });
      layer.circle(held.x + 2, held.y - 3, 1.2).fill({ color: 0x35423f });
    } else {
      for (let index = 0; index < 7; index += 1) {
        const angle = index / 7 * Math.PI * 2;
        layer.circle(
          held.x + Math.cos(angle) * (index % 2 ? 7 : 4),
          held.y + Math.sin(angle) * (index % 2 ? 6 : 4),
          1.8,
        ).fill({ color, alpha: 0.82 });
      }
    }
    return;
  }
  if (held.kind !== 'biofilm' || !held.microbeGuildId) return;

  const color = held.valid ? MICROBES[held.microbeGuildId].color : 0xcf5f5a;
  layer.circle(held.x, held.y, 15)
    .fill({ color: 0xf9f2d9, alpha: 0.5 })
    .stroke({ color, width: 3, alpha: 0.92 });
  for (let index = 0; index < 6; index += 1) {
    const angle = index / 6 * Math.PI * 2 + 0.25;
    const distance = index % 2 === 0 ? 5.2 : 7.5;
    const radius = index % 3 === 0 ? 3.5 : 2.6;
    layer.circle(
      held.x + Math.cos(angle) * distance,
      held.y + Math.sin(angle) * distance * 0.72,
      radius,
    ).fill({ color, alpha: 0.82 });
  }
};

const drawProbe = (
  layer: Graphics,
  snapshot: SimulationSnapshot,
  activeTool: InteractionTool,
  selectedLayer: WaterQualityLayer | null,
): void => {
  layer.clear();
  if (!snapshot.probe) return;
  const { x, y, light } = snapshot.probe;
  const isTemperature = activeTool === 'temperature-probe';
  const isWaterQuality = activeTool === 'water-quality-probe';
  const waterValue = selectedLayer && isDissolvedLayer(selectedLayer)
    ? snapshot.probe.water[selectedLayer]
    : 0;
  const color = isTemperature
    ? 0xc86958
    : isWaterQuality
      ? selectedLayer
        ? isMicrobeLayer(selectedLayer)
          ? MICROBES[selectedLayer].color
          : isPelagicLayer(selectedLayer)
            ? PELAGIC_PALETTES[selectedLayer].high
          : selectedLayer === 'temperature'
            ? 0xd47c4d
            : selectedLayer === 'flow'
              ? 0x58a697
              : mixColor(
                WATER_QUALITY_PALETTES[selectedLayer].low,
                WATER_QUALITY_PALETTES[selectedLayer].high,
                normalizeWaterQualityValue(selectedLayer, waterValue),
              )
        : 0x5c8179
      : mixColor(0x315d78, 0xe3ba56, light / 100);
  layer
    .circle(x, y, 14)
    .fill({ color: 0xf8f2dc, alpha: 0.64 })
    .stroke({ color, width: 3, alpha: 0.82 });
  if (isTemperature) {
    layer.roundRect(x - 2.5, y - 8, 5, 13, 2).stroke({ color, width: 2.4 });
    layer.circle(x, y + 6, 4.2).fill({ color, alpha: 1 });
  } else if (isWaterQuality) {
    const colors = [0x8a5836, 0xc14f5f, 0x6d9f5b, 0x65b9c7];
    for (let index = 0; index < colors.length; index += 1) {
      const angle = Math.PI / 4 + index * Math.PI / 2;
      layer.circle(
        x + Math.cos(angle) * 5,
        y + Math.sin(angle) * 5,
        2.7,
      ).fill({ color: colors[index], alpha: 1 });
    }
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

const drawMeasurementNumber = (
  layer: Graphics,
  x: number,
  y: number,
  index: number,
  tankWidth = TANK_WIDTH,
  waterTop = WATER_TOP,
): void => {
  const label = String(index + 1);
  const badgeX = x > tankWidth - 30 ? x - 15 : x + 15;
  const badgeY = y < waterTop + 30 ? y + 15 : y - 15;
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
      : measurement.kind === 'temperature'
        ? 0xc86958
        : 0x5c8179;
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
    } else if (measurement.kind === 'temperature') {
      layer.roundRect(measurement.x - 2.5, measurement.y - 8, 5, 13, 2)
        .stroke({ color, width: 2 });
      layer.circle(measurement.x, measurement.y + 6, 4).fill({ color, alpha: 1 });
    } else {
      const colors = [0x8a5836, 0xc14f5f, 0x6d9f5b, 0x65b9c7];
      for (let dotIndex = 0; dotIndex < colors.length; dotIndex += 1) {
        const angle = Math.PI / 4 + dotIndex * Math.PI / 2;
        layer.circle(
          measurement.x + Math.cos(angle) * 4.5,
          measurement.y + Math.sin(angle) * 4.5,
          2.5,
        ).fill({ color: colors[dotIndex], alpha: 1 });
      }
    }
    drawMeasurementNumber(
      layer,
      measurement.x,
      measurement.y,
      index,
      snapshot.tank.width,
      snapshot.tank.waterTop,
    );
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
    if (carcass?.speciesId === 'daphnia') {
      const scale = daphniaVisualScale(carcass.bodyLength);
      layer
        .ellipse(
          selection.x,
          selection.y,
          Math.max(5.5, 11 * scale + 1),
          Math.max(5.5, 13 * scale + 1),
        )
        .stroke({ color: 0xf7edc9, width: 4, alpha: 0.68 })
        .stroke({ color: 0x8c7770, width: 1.8, alpha: 0.94 });
      return;
    }
    const selectionScale = carcass?.speciesId === 'cherry-shrimp'
      ? shrimpVisualScale(carcass.bodyLength) * 1.08
      : Math.max(
        0.58,
        (carcass?.bodyLength ?? SHRIMP_ADULT_LENGTH) / SHRIMP_ADULT_LENGTH,
      );
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

const drawSpatialDebug = (
  layer: Graphics,
  snapshot: SimulationSnapshot,
): void => {
  layer.clear();
  if (!snapshot.spatialDebug.enabled) return;

  for (const structure of snapshot.structures) {
    const definition = STRUCTURES[structure.definitionId];
    const polygon = structureAuthoredPolygonToWorld(
      definition.collisionPolygon,
      definition.collisionPolygon,
      { x: structure.x, y: structure.y },
      structure.angle,
    );
    if (!polygon.length) continue;
    layer.moveTo(polygon[0].x, polygon[0].y);
    for (let index = 1; index < polygon.length; index += 1) {
      layer.lineTo(polygon[index].x, polygon[index].y);
    }
    layer
      .closePath()
      .stroke({ color: 0xe061ad, width: 2.2, alpha: 0.92, join: 'round' });
  }

  for (const cell of snapshot.cells) {
    if (cell.surfaceKind !== 'structure-face') continue;
    layer
      .circle(cell.x, cell.y, 1.8)
      .fill({ color: 0x5bdb91, alpha: 0.9 })
      .circle(cell.x, cell.y, Math.max(3, cell.cellSize * 0.42))
      .stroke({ color: 0x5bdb91, width: 0.65, alpha: 0.35 });
  }

  for (const gap of snapshot.spatialDebug.gaps) {
    layer
      .moveTo(gap.first.x, gap.first.y)
      .lineTo(gap.second.x, gap.second.y)
      .stroke({ color: 0xffd55f, width: 3, alpha: 0.95, cap: 'round' })
      .circle(gap.first.x, gap.first.y, 3.2)
      .fill({ color: 0xffd55f, alpha: 0.95 })
      .circle(gap.second.x, gap.second.y, 3.2)
      .fill({ color: 0xffd55f, alpha: 0.95 })
      .circle(gap.x, gap.y, Math.max(4, gap.usableClearance / 2))
      .stroke({ color: 0xffed9e, width: 1.4, alpha: 0.9 })
      .moveTo(gap.x - 5, gap.y)
      .lineTo(gap.x + 5, gap.y)
      .moveTo(gap.x, gap.y - 5)
      .lineTo(gap.x, gap.y + 5)
      .stroke({ color: 0xffed9e, width: 1.1, alpha: 0.82 });
  }

  for (const agent of snapshot.spatialDebug.agents) {
    const color = agent.speciesId === 'japanese-ricefish'
      ? 0x66b9e0
      : agent.speciesId === 'cherry-shrimp'
        ? 0x79d5cf
        : 0xa1d6e8;
    const radius = Math.max(2, agent.bodyThickness / 2);
    layer
      .circle(agent.x, agent.y, radius)
      .fill({ color, alpha: 0.12 })
      .stroke({ color, width: 1.6, alpha: 0.96 })
      .moveTo(agent.x - radius, agent.y)
      .lineTo(agent.x + radius, agent.y)
      .stroke({ color, width: 0.8, alpha: 0.78 });
  }
};

export function AquariumCanvas({
  snapshot,
  motionSource,
  activeTool,
  selectionFilter,
  send,
  editable,
  hasPendingInventory,
  pendingInventoryKey,
  onConsumePendingInventory,
  onPendingInventoryReady,
  onToolComplete,
  onClearSelection,
  onCameraChange,
  initialCameraTransform = null,
  cameraResetToken = 0,
  showGoalGuide = false,
  waterQualityLayers,
}: AquariumCanvasProps) {
  const tankGeometry = createTankVisualGeometry(snapshot.tank);
  const hostRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const snapshotRef = useRef(snapshot);
  const motionSourceRef = useRef(motionSource);
  const motionInterpolatorRef = useRef<ReturnType<typeof createReusableMotionInterpolator> | null>(null);
  motionInterpolatorRef.current ??= createReusableMotionInterpolator();
  const activeToolRef = useRef(activeTool);
  const editableRef = useRef(editable);
  const layersRef = useRef<AquariumLayers | null>(null);
  const texturesRef = useRef(new Map<string, Texture>());
  const structureDisplaysRef = useRef(new Map<string, StructureDisplay>());
  const animalDisplaysRef = useRef(new Map<string, AnimalDisplay>());
  const animalCarcassDisplaysRef = useRef(new Map<string, AnimalCarcassDisplay>());
  const animalDisplayPoolRef = useRef<AnimalDisplayPool | null>(null);
  const animalCarcassDisplayPoolRef = useRef<AnimalCarcassDisplayPool | null>(null);
  const effectGenerationRef = useRef(0);
  const lastLightDrawRef = useRef('');
  const lastAnalysisDrawRef = useRef('');
  const lastAlgaeRevisionRef = useRef(-1);
  const lastAlgaeStructureGeometryRef = useRef('');
  const lastPlantsDrawRef = useRef('');
  const lastSeedsDrawRef = useRef('');
  const lastSpatialDebugDrawRef = useRef('');
  const lastGoalGuideDrawRef = useRef('');
  const lastInteractionDrawRef = useRef('');
  const lastMeasurementsDrawRef = useRef('');
  const lastProbeDrawRef = useRef('');
  const lastSelectionDrawRef = useRef('');
  const pendingConsumedRef = useRef(false);
  const pendingHandoffStartedAtRef = useRef<number | null>(null);
  const pendingHandoffNotifiedRef = useRef(false);
  const pendingHandoffFinalizeRafRef = useRef<number | null>(null);
  const pendingDropAckRevisionRef = useRef<number | null>(null);
  const pendingInventoryKeyRef = useRef<string | null>(null);
  const latestPointerWorldRef = useRef<Vec2 | null>(null);
  const secondaryPointerCancelAtRef = useRef<number | null>(null);
  const hasPendingInventoryRef = useRef(hasPendingInventory);
  const onPendingInventoryReadyRef = useRef(onPendingInventoryReady);
  const dragStartRef = useRef<Vec2 | null>(null);
  const dragStartClientRef = useRef<Vec2 | null>(null);
  const dragCurrentRef = useRef<Vec2 | null>(null);
  const dragPointerRef = useRef<number | null>(null);
  const initialCameraStateRef = useRef<CameraState | null>(
    cameraStateFromStoredTransform(initialCameraTransform),
  );
  // A fresh mission must be fitted using the first real viewport dimensions.
  // React can run the reset effect while a newly mounted host still measures
  // zero; keeping this intent until Pixi applies its first viewport prevents
  // that transient measurement from falling back to the cropped cover view.
  const fitFreshCameraOnNextViewportRef = useRef(
    initialCameraStateRef.current === null,
  );
  const cameraRef = useRef<CameraState>(
    initialCameraStateRef.current ?? defaultCamera(tankGeometry),
  );
  const cameraViewportRef = useRef({ width: 0, height: 0 });
  const applyCameraRef = useRef<() => void>(() => undefined);
  const onCameraChangeRef = useRef(onCameraChange);
  const showGoalGuideRef = useRef(showGoalGuide);
  const waterQualityLayersRef = useRef(waterQualityLayers);
  const panPointerRef = useRef<number | null>(null);
  const panLastPointRef = useRef<Vec2 | null>(null);
  const [cameraZoom, setCameraZoom] = useState(CAMERA_COVER_ZOOM);
  const [cameraMinimumZoom, setCameraMinimumZoom] = useState(CAMERA_COVER_ZOOM);
  const [cameraCanPan, setCameraCanPan] = useState(false);
  const [cameraIsFit, setCameraIsFit] = useState(false);
  const [panMode, setPanMode] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [rendererRecoveryToken, setRendererRecoveryToken] = useState(0);

  snapshotRef.current = snapshot;
  motionSourceRef.current = motionSource;
  activeToolRef.current = activeTool;
  editableRef.current = editable;
  onCameraChangeRef.current = onCameraChange;
  hasPendingInventoryRef.current = hasPendingInventory;
  onPendingInventoryReadyRef.current = onPendingInventoryReady;
  showGoalGuideRef.current = showGoalGuide;
  waterQualityLayersRef.current = waterQualityLayers;

  // A new inventory request must reset the handoff state before browser
  // pointer events can fire. A passive effect leaves a race where the first
  // movement may be interpreted as belonging to the previous item.
  if (pendingInventoryKeyRef.current !== pendingInventoryKey) {
    pendingInventoryKeyRef.current = pendingInventoryKey;
    pendingConsumedRef.current = false;
    pendingHandoffStartedAtRef.current = null;
    pendingHandoffNotifiedRef.current = false;
    pendingDropAckRevisionRef.current = null;
  }

  const sampleMotion = (nowMs: number) => {
    const frames = motionSourceRef.current.getFrames();
    return motionInterpolatorRef.current!.sample(frames, nowMs);
  };

  const isPendingInventoryHandoff = (): boolean =>
    hasPendingInventoryRef.current &&
    pendingConsumedRef.current &&
    !pendingHandoffNotifiedRef.current;

  const finishPendingInventoryAfterPaint = (): void => {
    if (pendingHandoffFinalizeRafRef.current !== null) return;
    const requestKey = pendingInventoryKeyRef.current;
    // Pixi renders on requestAnimationFrame too. Waiting across two frames
    // guarantees that the visible Pixi preview has reached the canvas before
    // React removes the DOM cursor preview.
    pendingHandoffFinalizeRafRef.current = requestAnimationFrame(() => {
      pendingHandoffFinalizeRafRef.current = requestAnimationFrame(() => {
        pendingHandoffFinalizeRafRef.current = null;
        if (
          pendingHandoffNotifiedRef.current &&
          pendingInventoryKeyRef.current === requestKey
        ) onPendingInventoryReadyRef.current();
      });
    });
  };

  const revealPendingInventoryPreview = (
    holding: SimulationSnapshot['holding'],
  ): boolean => {
    const layers = layersRef.current;
    if (!layers || !holding || holding.source !== 'inventory') return false;
    if (
      holding.kind === 'seed' ||
      holding.kind === 'biofilm' ||
      holding.kind === 'plankton'
    ) {
      drawInteraction(layers.interaction, { ...snapshotRef.current, holding }, false);
      return true;
    }
    if (holding.kind === 'structure' && holding.structureId) {
      const display = structureDisplaysRef.current.get(holding.structureId);
      if (!display) return false;
      display.container.visible = true;
      return true;
    }
    if (holding.kind === 'animal' && holding.animalId) {
      const display = animalDisplaysRef.current.get(holding.animalId);
      if (!display) return false;
      display.container.visible = true;
      return true;
    }
    return false;
  };

  const tryCompletePendingInventoryHandoff = (
    holding: SimulationSnapshot['holding'],
    nowMs: number,
  ): void => {
    if (!isPendingInventoryHandoff()) return;
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
    // Make the Pixi preview visible first. The DOM cursor ghost may overlap it
    // for one frame, but the player must never see an empty handoff frame.
    if (!revealPendingInventoryPreview(holding)) return;
    pendingHandoffNotifiedRef.current = true;
    finishPendingInventoryAfterPaint();
  };

  const tryCompletePendingDrop = (nextSnapshot: SimulationSnapshot): boolean => {
    const expectedRevision = pendingDropAckRevisionRef.current;
    if (expectedRevision === null || nextSnapshot.revision < expectedRevision) return false;
    pendingDropAckRevisionRef.current = null;
    if (nextSnapshot.holding) {
      // The attempted surface was invalid. Hand the still-held item to Pixi,
      // but keep the DOM preview until Pixi has actually painted it.
      pendingConsumedRef.current = true;
      pendingHandoffStartedAtRef.current = performance.now() - 48;
      tryCompletePendingInventoryHandoff(nextSnapshot.holding, performance.now());
      return true;
    }
    // A null holding state at the acknowledgement revision means the object is
    // now present in the authoritative placed-object snapshot.
    pendingHandoffNotifiedRef.current = true;
    finishPendingInventoryAfterPaint();
    return true;
  };

  useEffect(() => () => {
    if (pendingHandoffFinalizeRafRef.current !== null) {
      cancelAnimationFrame(pendingHandoffFinalizeRafRef.current);
      pendingHandoffFinalizeRafRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!hasPendingInventory && !snapshot.holding) return;
    panPointerRef.current = null;
    panLastPointRef.current = null;
    setPanMode(false);
    setIsPanning(false);
  }, [hasPendingInventory, snapshot.holding]);

  useEffect(() => {
    const host = hostRef.current;
    const restoredCamera = initialCameraStateRef.current;
    initialCameraStateRef.current = null;
    fitFreshCameraOnNextViewportRef.current = restoredCamera === null;
    const nextCamera = restoredCamera
      ? host?.clientWidth && host.clientHeight
        ? clampCamera(
          restoredCamera,
          host.clientWidth,
          host.clientHeight,
          tankGeometry,
        )
        : restoredCamera
      : host?.clientWidth && host.clientHeight
        ? freshTankCameraState(
          host.clientWidth,
          host.clientHeight,
          tankGeometry,
        )
        : defaultCamera(tankGeometry);
    cameraRef.current = nextCamera;
    setCameraZoom(nextCamera.zoom);
    setPanMode(false);
    setIsPanning(false);
    panPointerRef.current = null;
    panLastPointRef.current = null;
    applyCameraRef.current();
  }, [cameraResetToken, snapshot.tank.id]);

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
    let rendererCanvas: HTMLCanvasElement | null = null;
    let rendererRecoveryRequested = false;
    let rendererRecoveryFrame: number | null = null;
    let releaseGlobalResourcesOnDestroy = false;
    let pixiContextRestoredListener: EventListener | null = null;
    let removeRenderingVisibilityListener: (() => void) | undefined;
    const app = new Application();
    const ownedTextures = new Map<string, Texture>();
    const ownedDisplays = new Map<string, StructureDisplay>();
    const ownedAnimalDisplays = new Map<string, AnimalDisplay>();
    const ownedAnimalCarcassDisplays = new Map<string, AnimalCarcassDisplay>();
    const ownedAnimalDisplayPool = new BoundedReusePool<string, AnimalDisplay>(
      ANIMAL_DISPLAY_POOL_LIMIT_PER_KEY,
    );
    const ownedAnimalCarcassDisplayPool =
      new BoundedReusePool<string, AnimalCarcassDisplay>(
        ANIMAL_CARCASS_POOL_LIMIT_PER_KEY,
      );
    let animalTicker: ((ticker: Ticker) => void) | null = null;
    let renderTicker: (() => void) | null = null;
    texturesRef.current = ownedTextures;
    structureDisplaysRef.current = ownedDisplays;
    animalDisplaysRef.current = ownedAnimalDisplays;
    animalCarcassDisplaysRef.current = ownedAnimalCarcassDisplays;
    animalDisplayPoolRef.current = ownedAnimalDisplayPool;
    animalCarcassDisplayPoolRef.current = ownedAnimalCarcassDisplayPool;
    lastLightDrawRef.current = '';
    lastAnalysisDrawRef.current = '';
    lastAlgaeRevisionRef.current = -1;
    lastAlgaeStructureGeometryRef.current = '';
    lastSeedsDrawRef.current = '';
    lastGoalGuideDrawRef.current = '';
    lastInteractionDrawRef.current = '';
    lastMeasurementsDrawRef.current = '';
    lastProbeDrawRef.current = '';
    lastSelectionDrawRef.current = '';

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
      releasePhytoplanktonLayer(ownedLayers.plankton);
      releaseAnalysisLayer(ownedLayers.analysis);
      releaseAlgaeParticleLayer(ownedLayers.substrateAlgae);
      releaseAlgaeParticleLayer(ownedLayers.algae);
    };

    const destroyOwnedApp = (): void => {
      if (appDestroyed || !app.renderer) return;
      appDestroyed = true;
      // `true` here releases Pixi's global GPU resource registry. That can
      // invalidate textures owned by a newer React effect generation.
      app.destroy(
        { removeView: true, releaseGlobalResources: releaseGlobalResourcesOnDestroy },
        { children: true, context: true },
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
          tankGeometry,
        )) < CAMERA_EPSILON &&
        Math.abs(cameraRef.current.centerX - tankGeometry.sceneCenterX) < 0.5 &&
        Math.abs(cameraRef.current.centerY - tankGeometry.sceneCenterY) < 0.5;
      const fittedZoom = fitTankZoom(width, height, tankGeometry);
      const minimumZoom = minimumTankZoom(width, height, tankGeometry);
      const requestedCamera = fitFreshCameraOnNextViewportRef.current ||
        (resizeRenderer && wasFit)
        ? {
          zoom: fittedZoom,
          centerX: tankGeometry.sceneCenterX,
          centerY: tankGeometry.sceneCenterY,
        }
        : cameraRef.current;
      fitFreshCameraOnNextViewportRef.current = false;
      const camera = clampCamera(requestedCamera, width, height, tankGeometry);
      cameraViewportRef.current = { width, height };
      cameraRef.current = camera;
      const scale = coverTankScale(width, height, tankGeometry) * camera.zoom;
      setCameraZoom(camera.zoom);
      setCameraMinimumZoom(minimumZoom);
      setCameraCanPan(canPanTankCamera(width, height, camera.zoom, tankGeometry));
      setCameraIsFit(
        Math.abs(camera.zoom - fittedZoom) < CAMERA_EPSILON &&
        Math.abs(camera.centerX - tankGeometry.sceneCenterX) < 0.5 &&
        Math.abs(camera.centerY - tankGeometry.sceneCenterY) < 0.5,
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
      preference: 'webgl',
      antialias: true,
      backgroundAlpha: 0,
      resolution: Math.min(window.devicePixelRatio, 2),
      autoDensity: true,
      autoStart: false,
    }).then(async () => {
      if (!isCurrentGeneration()) {
        destroyOwnedApp();
        return;
      }
      appRef.current = app;
      host.appendChild(app.canvas);
      rendererCanvas = app.canvas;
      pixiContextRestoredListener = (
        app.renderer as typeof app.renderer & {
          context?: { handleContextRestored?: EventListener };
        }
      ).context?.handleContextRestored ?? null;
      rendererCanvas.addEventListener('webglcontextlost', handleWebGlContextLost);
      rendererCanvas.addEventListener('webglcontextrestored', handleWebGlContextRestored);
      app.canvas.setAttribute('aria-label', '수조 시뮬레이션 화면');
      const layers: AquariumLayers = {
        lamp: new Graphics(),
        base: new Graphics(),
        light: new Sprite(Texture.EMPTY),
        plankton: createPhytoplanktonLayer(),
        substrateAlgae: createAlgaeParticleLayer('substrate'),
        foreground: new Graphics(),
        structures: new Container(),
        algae: createAlgaeParticleLayer('structure-face'),
        analysis: createAnalysisLayer(),
        animals: new Container(),
        plantsBack: new Graphics(),
        plantsFront: new Graphics(),
        nightTint: new Graphics(),
        spatialDebug: new Graphics(),
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
          tankGeometry.glassLeft,
          tankGeometry.glassTop,
          tankGeometry.glassRight - tankGeometry.glassLeft,
          tankGeometry.glassBottom - tankGeometry.glassTop,
          12,
        )
        .fill({ color: 0xffffff, alpha: 1 });
      scene.addChild(
        layers.base,
        layers.light,
        layers.plankton,
        layers.substrateAlgae,
        layers.foreground,
        layers.plantsBack,
        layers.structures,
        layers.algae,
        layers.plantsFront,
        layers.analysis,
        layers.animals,
        layers.nightTint,
        layers.spatialDebug,
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
      drawTank(layers.base, snapshotRef.current);
      drawSubstrateRidge(layers.foreground, snapshotRef.current);
      drawTankFrame(layers.frame, tankGeometry);
      applyViewport();
      observer.observe(host);

      // `layersRef` changes outside React state, so the normal drawing effect may
      // already have run and returned while Pixi was still initializing. Paint a
      // complete latest frame here; otherwise a paused setup screen can keep a
      // newly-created layer generation blank until another simulation update.
      const initialSnapshot = snapshotRef.current;
      layers.lamp.visible = initialSnapshot.lightOutput > 0.5;
      layers.lamp.alpha = 0.35 + 0.65 * Math.sqrt(initialSnapshot.lightOutput / 120);
      const initialMotion = sampleMotion(performance.now());
      const initialRenderState = reconcileMotionWithSnapshot(initialSnapshot, initialMotion);
      const initialShowsLight = activeToolRef.current === 'light-probe';
      drawLightField(layers.light, initialSnapshot, initialShowsLight);
      drawPhytoplankton(layers.plankton, initialSnapshot);
      drawAnalysisOverlay(layers.analysis, initialSnapshot, waterQualityLayersRef.current);
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
        ownedAnimalDisplayPool,
      );
      syncAnimalCarcasses(
        layers.animals,
        initialSnapshot,
        ownedAnimalCarcassDisplays,
        ownedAnimalDisplays,
        ownedAnimalCarcassDisplayPool,
      );
      drawAquaticPlants(layers.plantsBack, initialSnapshot, 'back');
      drawAquaticPlants(layers.plantsFront, initialSnapshot, 'front');
      lastPlantsDrawRef.current = vallisneriaVisualKey(initialSnapshot);
      drawDayNightTint(layers.nightTint, initialSnapshot);
      drawSpatialDebug(layers.spatialDebug, initialSnapshot);
      drawGoalGuide(layers.goalGuide, initialSnapshot, showGoalGuideRef.current);
      drawSeeds(layers.seeds, initialSnapshot);
      drawInteraction(layers.interaction, initialSnapshot, isPendingInventoryHandoff());
      drawMeasurements(layers.measurements, initialSnapshot);
      drawProbe(
        layers.probe,
        initialSnapshot,
        activeToolRef.current,
        waterQualityLayersRef.current[0] ?? null,
      );
      drawSelection(layers.selection, initialSnapshot);
      lastLightDrawRef.current = `${initialSnapshot.lightField.revision}:${initialShowsLight}`;
      lastAnalysisDrawRef.current = analysisOverlayKey(
        initialSnapshot,
        waterQualityLayersRef.current,
      );
      lastAlgaeRevisionRef.current = initialSnapshot.revision;
      lastAlgaeStructureGeometryRef.current = structureAlgaeGeometryKey(initialSnapshot);
      lastSeedsDrawRef.current = JSON.stringify(initialSnapshot.seeds);
      lastGoalGuideDrawRef.current = showGoalGuideRef.current
        ? `visible:${initialSnapshot.revision}`
        : 'hidden';
      lastInteractionDrawRef.current = `${hasPendingInventoryRef.current}:${JSON.stringify(initialSnapshot.holding)}`;
      lastMeasurementsDrawRef.current = JSON.stringify(initialSnapshot.measurements);
      lastProbeDrawRef.current = `${activeToolRef.current}:${waterQualityLayersRef.current[0] ?? ''}:${JSON.stringify(initialSnapshot.probe)}`;
      lastSelectionDrawRef.current = JSON.stringify(initialSnapshot.selection);
      animalTicker = (ticker: Ticker): void => {
        if (!isCurrentGeneration()) return;
        const currentSnapshot = snapshotRef.current;
        const nowMs = performance.now();
        const motionFrames = motionSourceRef.current.getFrames();
        const motion = motionInterpolatorRef.current!.sample(motionFrames, nowMs);
        if (motion) {
          applyStructureMotion(
            ownedDisplays,
            currentSnapshot.structures,
            motion.structures,
            currentSnapshot.holding,
          );
          applyAnimalMotion(
            ownedAnimalDisplays,
            motion.animals,
            motion.holding,
            motion.interpolated,
            motionFrames.current,
          );
        }
        animateAnimals(ownedAnimalDisplays, currentSnapshot, ticker.deltaMS / 1000);
        animateAnimalCarcasses(
          ownedAnimalCarcassDisplays,
          ticker.deltaMS / 1000,
          snapshotRef.current.tank.groundY,
        );
      };
      app.ticker.add(animalTicker);
      // Ticker schedules the next RAF only after every listener returns. An
      // uncaught renderer exception therefore freezes the last partial frame
      // forever. Replace Pixi's raw render listener with a guarded equivalent
      // so a renderer/resource fault requests a complete rebuild instead.
      app.ticker.remove(app.render, app);
      renderTicker = (): void => {
        if (!isCurrentGeneration()) return;
        try {
          app.render();
        } catch (error) {
          console.error('[AquaCycle] Pixi render failed; rebuilding renderer.', error);
          app.stop();
          requestFullRendererRecovery();
        }
      };
      app.ticker.add(renderTicker, undefined, UPDATE_PRIORITY.LOW);
      app.start();
      removeRenderingVisibilityListener =
        window.aquacycleDesktop?.onRenderingVisibilityChange?.((visible) => {
          if (!isCurrentGeneration()) return;
          if (!visible) {
            app.stop();
            return;
          }
          app.start();
          requestAnimationFrame(() => {
            if (!isCurrentGeneration()) return;
            applyViewport(true);
            try {
              app.render();
            } catch (error) {
              console.error(
                '[AquaCycle] Pixi resume paint failed; rebuilding renderer.',
                error,
              );
              app.stop();
              requestFullRendererRecovery();
            }
          });
        });

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
        destroyDisplayTree(display.container);
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

    function requestFullRendererRecovery(): void {
      if (!isCurrentGeneration() || rendererRecoveryRequested) return;
      rendererRecoveryRequested = true;
      // This generation owns invalid renderer resources, either after a lost
      // context or after a Pixi render-pipeline exception. They must not remain
      // in Pixi's global caches when the replacement application is created.
      releaseGlobalResourcesOnDestroy = true;
      // Chromium's restored event means the GPU context is usable again, but
      // Pixi's retained masks, Graphics and canvas-backed textures still point
      // at resources from the lost context. Wait until the restored frame has
      // completed, then replace the whole WebGL application and rebuild every
      // layer from the authoritative simulation snapshot.
      rendererRecoveryFrame = requestAnimationFrame(() => {
        rendererRecoveryFrame = requestAnimationFrame(() => {
          rendererRecoveryFrame = null;
          if (isCurrentGeneration()) {
            setRendererRecoveryToken((token) => token + 1);
          }
        });
      });
    }

    function handleWebGlContextLost(event: Event): void {
      // preventDefault opts in to Chromium's context restoration. Do not create
      // the replacement renderer here: the GPU context is still lost at this
      // point, and doing so is what produced the intermittent half-blank scene.
      event.preventDefault();
      app.stop();
      // Pixi normally rebuilds its retained WebGL resources in place on the
      // restored event. Alpha-mask bind groups are the resource that remained
      // stale in this scene, so prevent that partial rebuild and let our full
      // application replacement be the only restoration path.
      if (rendererCanvas && pixiContextRestoredListener) {
        rendererCanvas.removeEventListener(
          'webglcontextrestored',
          pixiContextRestoredListener,
        );
      }
    }

    function handleWebGlContextRestored(): void {
      requestFullRendererRecovery();
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        pendingConsumedRef.current = false;
        send({ type: 'cancel-held' });
        onClearSelection();
        if (hasPendingInventoryRef.current) onPendingInventoryReadyRef.current();
        onToolComplete(
          snapshotRef.current.holding || hasPendingInventoryRef.current
            ? 'move'
            : activeToolRef.current,
        );
      }
      if (snapshotRef.current.holding?.kind === 'structure' && (event.key === 'q' || event.key === 'Q')) {
        send({ type: 'rotate-held', radians: -Math.PI / 36 });
      }
      if (snapshotRef.current.holding?.kind === 'structure' && (event.key === 'e' || event.key === 'E')) {
        send({ type: 'rotate-held', radians: Math.PI / 36 });
      }
      if (
        editableRef.current &&
        activeToolRef.current === 'move' &&
        (event.key === 'Delete' || event.key === 'Backspace')
      ) {
        const current = snapshotRef.current;
        if (current.holding?.kind === 'structure' && current.holding.source === 'existing') {
          event.preventDefault();
          send({ type: 'remove-held-structure' });
          return;
        }
        if (current.selection?.kind === 'structure' && current.selection.structureId) {
          event.preventDefault();
          send({ type: 'retrieve-structure', id: current.selection.structureId });
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      disposed = true;
      if (effectGenerationRef.current === generation) effectGenerationRef.current += 1;
      observer.disconnect();
      window.removeEventListener('keydown', handleKeyDown);
      removeRenderingVisibilityListener?.();
      rendererCanvas?.removeEventListener('webglcontextlost', handleWebGlContextLost);
      rendererCanvas?.removeEventListener('webglcontextrestored', handleWebGlContextRestored);
      if (rendererRecoveryFrame !== null) cancelAnimationFrame(rendererRecoveryFrame);
      if (applyCameraRef.current === applyOwnedCamera) {
        applyCameraRef.current = () => undefined;
      }
      if (structureDisplaysRef.current === ownedDisplays) {
        structureDisplaysRef.current = new Map<string, StructureDisplay>();
      }
      if (animalTicker) app.ticker.remove(animalTicker);
      if (renderTicker) app.ticker.remove(renderTicker);
      if (animalDisplaysRef.current === ownedAnimalDisplays) {
        animalDisplaysRef.current = new Map<string, AnimalDisplay>();
      }
      if (animalCarcassDisplaysRef.current === ownedAnimalCarcassDisplays) {
        animalCarcassDisplaysRef.current = new Map<string, AnimalCarcassDisplay>();
      }
      if (animalDisplayPoolRef.current === ownedAnimalDisplayPool) {
        animalDisplayPoolRef.current = null;
      }
      if (animalCarcassDisplayPoolRef.current === ownedAnimalCarcassDisplayPool) {
        animalCarcassDisplayPoolRef.current = null;
      }
      ownedDisplays.clear();
      ownedAnimalDisplays.clear();
      ownedAnimalCarcassDisplays.clear();
      ownedAnimalDisplayPool.drain((display) => destroyDisplayTree(display.container));
      ownedAnimalCarcassDisplayPool.drain((display) =>
        destroyDisplayTree(display.container));
      if (layersRef.current === ownedLayers) layersRef.current = null;
      if (appRef.current === app) appRef.current = null;
      if (texturesRef.current === ownedTextures) {
        texturesRef.current = new Map<string, Texture>();
      }
      releaseOwnedRasterSurfaces();
      destroyOwnedApp();
      destroyOwnedTextures();
    };
  // The original context-recovery contract remains
  // [onClearSelection, onToolComplete, rendererRecoveryToken, send];
  // changing tank geometry is one additional reason to rebuild every layer.
  }, [
    onClearSelection,
    onToolComplete,
    rendererRecoveryToken,
    send,
    snapshot.tank.id,
  ]);

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
    drawPhytoplankton(layers.plankton, snapshot);
    const analysisKey = analysisOverlayKey(snapshot, waterQualityLayers);
    if (lastAnalysisDrawRef.current !== analysisKey) {
      drawAnalysisOverlay(layers.analysis, snapshot, waterQualityLayers);
      lastAnalysisDrawRef.current = analysisKey;
    }
    syncStructures(
      layers.structures,
      snapshot,
      texturesRef.current,
      structureDisplaysRef.current,
      renderState.structures,
      isPendingInventoryHandoff(),
    );
    // Create a new carcass while the last living display still exists so the
    // rendered pose can be handed off without a one-frame teleport.
    syncAnimalCarcasses(
      layers.animals,
      snapshot,
      animalCarcassDisplaysRef.current,
      animalDisplaysRef.current,
      animalCarcassDisplayPoolRef.current ?? undefined,
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
      animalDisplayPoolRef.current ?? undefined,
    );
    const plantsKey = vallisneriaVisualKey(snapshot);
    if (lastPlantsDrawRef.current !== plantsKey) {
      drawAquaticPlants(layers.plantsBack, snapshot, 'back');
      drawAquaticPlants(layers.plantsFront, snapshot, 'front');
      lastPlantsDrawRef.current = plantsKey;
    }
    drawDayNightTint(layers.nightTint, snapshot);
    const spatialDebugKey = snapshot.spatialDebug.enabled
      ? `visible:${snapshot.revision}`
      : 'hidden';
    if (lastSpatialDebugDrawRef.current !== spatialDebugKey) {
      drawSpatialDebug(layers.spatialDebug, snapshot);
      lastSpatialDebugDrawRef.current = spatialDebugKey;
    }
    layers.lamp.visible = snapshot.lightOutput > 0.5;
    layers.lamp.alpha = 0.35 + 0.65 * Math.sqrt(snapshot.lightOutput / 120);
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
    const seedsKey = JSON.stringify(snapshot.seeds);
    if (lastSeedsDrawRef.current !== seedsKey) {
      drawSeeds(layers.seeds, snapshot);
      lastSeedsDrawRef.current = seedsKey;
    }
    const goalGuideKey = showGoalGuide ? `visible:${snapshot.revision}` : 'hidden';
    if (lastGoalGuideDrawRef.current !== goalGuideKey) {
      drawGoalGuide(layers.goalGuide, snapshot, showGoalGuide);
      lastGoalGuideDrawRef.current = goalGuideKey;
    }
    const interactionKey = `${hasPendingInventory}:${JSON.stringify(snapshot.holding)}`;
    if (lastInteractionDrawRef.current !== interactionKey) {
      drawInteraction(layers.interaction, snapshot, isPendingInventoryHandoff());
      lastInteractionDrawRef.current = interactionKey;
    }
    const measurementsKey = JSON.stringify(snapshot.measurements);
    if (lastMeasurementsDrawRef.current !== measurementsKey) {
      drawMeasurements(layers.measurements, snapshot);
      lastMeasurementsDrawRef.current = measurementsKey;
    }
    const probeKey = `${activeTool}:${waterQualityLayers[0] ?? ''}:${JSON.stringify(snapshot.probe)}`;
    if (lastProbeDrawRef.current !== probeKey) {
      drawProbe(layers.probe, snapshot, activeTool, waterQualityLayers[0] ?? null);
      lastProbeDrawRef.current = probeKey;
    }
    const selectionKey = JSON.stringify(snapshot.selection);
    if (lastSelectionDrawRef.current !== selectionKey) {
      drawSelection(layers.selection, snapshot);
      lastSelectionDrawRef.current = selectionKey;
    }
    tryCompletePendingDrop(snapshot);
    tryCompletePendingInventoryHandoff(snapshot.holding, performance.now());
  }, [activeTool, editable, hasPendingInventory, showGoalGuide, snapshot, waterQualityLayers]);

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
    if (!host) {
      return {
        x: snapshot.tank.width / 2,
        y: snapshot.tank.height / 2,
      };
    }
    const viewportPoint = clientToViewportPoint(clientX, clientY);
    const app = appRef.current;
    const scale = app?.stage.scale.x ||
      coverTankScale(host.clientWidth, host.clientHeight, tankGeometry) *
        cameraRef.current.zoom;
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
      ? clampCamera(nextCamera, host.clientWidth, host.clientHeight, tankGeometry)
      : nextCamera;
    setCameraZoom(cameraRef.current.zoom);
    applyCameraRef.current();
  };

  const zoomAtClientPoint = (targetZoom: number, clientX: number, clientY: number): void => {
    const host = hostRef.current;
    if (!host?.clientWidth || !host.clientHeight) return;
    const zoom = Math.max(
      minimumTankZoom(host.clientWidth, host.clientHeight, tankGeometry),
      Math.min(CAMERA_MAX_ZOOM, targetZoom),
    );
    const viewportPoint = clientToViewportPoint(clientX, clientY);
    const worldPoint = clientToWorldPoint(clientX, clientY);
    const scale = coverTankScale(
      host.clientWidth,
      host.clientHeight,
      tankGeometry,
    ) * zoom;
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
      zoom: fitTankZoom(host.clientWidth, host.clientHeight, tankGeometry),
      centerX: tankGeometry.sceneCenterX,
      centerY: tankGeometry.sceneCenterY,
    });
  };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const handleWheel = (event: WheelEvent): void => {
      const target = event.target;
      if (target instanceof Element && target.closest('.aquarium-camera-controls')) return;
      const holding = snapshotRef.current.holding;
      if (editable && holding?.kind === 'structure') {
        if (event.deltaY === 0) return;
        event.preventDefault();
        send({ type: 'rotate-held', radians: Math.sign(event.deltaY) * (Math.PI / 36) });
        return;
      }
      if (event.deltaY === 0) return;
      event.preventDefault();
      zoomAtClientPoint(
        wheelZoomTarget(
          cameraRef.current.zoom,
          event.deltaY,
          event.deltaMode,
          host.clientHeight,
        ),
        event.clientX,
        event.clientY,
      );
    };
    // React delegates wheel events through a passive listener in Chromium, so
    // calling preventDefault from onWheel only floods DevTools with warnings.
    // A native non-passive listener keeps rotation/zoom deterministic.
    host.addEventListener('wheel', handleWheel, { passive: false });
    return () => host.removeEventListener('wheel', handleWheel);
  }, [editable, send, snapshot.tank.id]);

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const point = toWorldPoint(event);
    latestPointerWorldRef.current = isTankInteractionPoint(point, tankGeometry)
      ? point
      : clampTankInteractionPoint(point, tankGeometry);
    if (pendingDropAckRevisionRef.current !== null) return;
    if (panPointerRef.current === event.pointerId && panLastPointRef.current) {
      const host = hostRef.current;
      if (!host) return;
      const previous = panLastPointRef.current;
      const rect = host.getBoundingClientRect();
      const deltaX = (event.clientX - previous.x) * (host.clientWidth / Math.max(1, rect.width));
      const deltaY = (event.clientY - previous.y) * (host.clientHeight / Math.max(1, rect.height));
      const scale = coverTankScale(
        host.clientWidth,
        host.clientHeight,
        tankGeometry,
      ) * cameraRef.current.zoom;
      panLastPointRef.current = { x: event.clientX, y: event.clientY };
      commitCamera({
        ...cameraRef.current,
        centerX: cameraRef.current.centerX - deltaX / scale,
        centerY: cameraRef.current.centerY - deltaY / scale,
      });
      return;
    }
    const interactive = isTankInteractionPoint(point, tankGeometry);
    if (hasPendingInventory && !pendingConsumedRef.current) {
      if (!interactive) return;
      pendingConsumedRef.current = true;
      pendingHandoffStartedAtRef.current = performance.now();
      onConsumePendingInventory(point);
      return;
    }
    if (hasPendingInventory && pendingConsumedRef.current) {
      send({
        type: 'pointer-move',
        point: interactive ? point : clampTankInteractionPoint(point, tankGeometry),
      });
      return;
    }
    if (dragPointerRef.current === event.pointerId && dragStartRef.current) {
      const boundedPoint = clampTankInteractionPoint(point, tankGeometry);
      dragCurrentRef.current = boundedPoint;
      if (layersRef.current) drawDragSelection(layersRef.current.drag, dragStartRef.current, boundedPoint);
      return;
    }
    if (!interactive) {
      if (snapshot.holding && editable) {
        send({
          type: 'pointer-move',
          point: clampTankInteractionPoint(point, tankGeometry),
        });
        return;
      }
      if (isProbeInteractionTool(activeTool)) {
        if (snapshot.probe) send({ type: 'clear-probe' });
      }
      return;
    }
    if (snapshot.holding && editable) send({ type: 'pointer-move', point });
    else if (isProbeInteractionTool(activeTool)) {
      send({ type: 'probe', point });
    }
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (pendingDropAckRevisionRef.current !== null) {
      event.preventDefault();
      return;
    }
    const host = hostRef.current;
    const canPan = Boolean(host && canPanTankCamera(
      host.clientWidth,
      host.clientHeight,
      cameraRef.current.zoom,
      tankGeometry,
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
    latestPointerWorldRef.current = isTankInteractionPoint(point, tankGeometry)
      ? point
      : clampTankInteractionPoint(point, tankGeometry);
    if (isSecondaryPointerGesture(event.button, event.ctrlKey)) {
      event.preventDefault();
      secondaryPointerCancelAtRef.current = performance.now();
      pendingConsumedRef.current = false;
      send({ type: 'cancel-held' });
      if (hasPendingInventory) onPendingInventoryReady();
      onToolComplete(snapshot.holding || hasPendingInventory ? 'move' : activeTool);
      return;
    }
    if (shouldStartCameraPan(event.button, panMode, canPan)) {
      panPointerRef.current = event.pointerId;
      panLastPointRef.current = { x: event.clientX, y: event.clientY };
      setIsPanning(true);
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (!isTankInteractionPoint(point, tankGeometry)) return;
    if (hasPendingInventory || (pendingConsumedRef.current && !snapshot.holding)) {
      const hadAuthoritativeHolding = Boolean(snapshot.holding);
      if (!pendingConsumedRef.current) {
        pendingConsumedRef.current = true;
        pendingHandoffStartedAtRef.current = performance.now();
        onConsumePendingInventory(point);
      }
      // The worker handles commands in FIFO order. Sending the drop directly
      // after the inventory pick makes this first tank click the placement
      // click too, even when no pointermove occurred or the pick snapshot has
      // not made the round trip back from the worker yet.
      if (pendingHandoffFinalizeRafRef.current !== null) {
        cancelAnimationFrame(pendingHandoffFinalizeRafRef.current);
        pendingHandoffFinalizeRafRef.current = null;
      }
      pendingHandoffNotifiedRef.current = false;
      pendingDropAckRevisionRef.current = snapshot.revision + (hadAuthoritativeHolding ? 1 : 2);
      send({ type: 'drop-held', point });
      pendingConsumedRef.current = false;
      onToolComplete('move');
      return;
    }
    if (snapshot.holding) {
      send({ type: 'drop-held', point });
      pendingConsumedRef.current = false;
      if (snapshot.holding.valid) onToolComplete('move');
      return;
    }
    if (isProbeInteractionTool(activeTool)) {
      send({
        type: 'place-measurement',
        kind: activeTool === 'light-probe'
          ? 'light'
          : activeTool === 'temperature-probe'
            ? 'temperature'
            : 'water-quality',
        point,
      });
      onToolComplete(activeTool);
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
    const to = clampTankInteractionPoint(toWorldPoint(event), tankGeometry);
    const clientStart = dragStartClientRef.current ?? { x: event.clientX, y: event.clientY };
    if (isScreenDrag(clientStart, { x: event.clientX, y: event.clientY })) {
      send({ type: 'select-region', from, to, filter: selectionFilter });
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
        if (isProbeInteractionTool(activeTool) && !dragStartRef.current) {
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
        onToolComplete(snapshot.holding || hasPendingInventory ? 'move' : activeTool);
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
