import {
  ALGAE_RENDER_TRACE_BIOMASS,
} from '../../simulation/config';

export { ALGAE_RENDER_TRACE_BIOMASS } from '../../simulation/config';

export const ALGAE_DENSITY_FIELD_SCALE = 1 / 3;
export const ALGAE_DENSITY_SATURATION_BIOMASS = 0.72;
export interface AlgaeDensitySample {
  x: number;
  y: number;
  cellSize: number;
  biomass: number;
}

export interface AlgaeDensityRaster {
  pixels: Uint8Array;
  density: Float32Array;
  scratch: Float32Array;
  width: number;
  height: number;
  worldWidth: number;
  worldHeight: number;
}

export interface AlgaeDensityColor {
  red: number;
  green: number;
  blue: number;
}

/**
 * Keep a genuinely thin, real film readable without flattening every
 * established colony into the same opaque colour. The former logarithmic
 * curve plus the final alpha clamp reached visual saturation around ordinary
 * mid-density biomass. Shrimp could remove a large fraction of a cell while
 * the rendered film did not change at all.
 *
 * A visible floor reveals only cells that contain real biomass; the remaining
 * range is linear so a proportional grazing loss remains visible. The floor
 * is intentionally strong enough to keep the colony footprint readable under
 * its sparse filament marks at the fitted mission camera scale.
 */
export const algaeContinuousDensity = (biomass: number): number => {
  if (!Number.isFinite(biomass) || biomass <= ALGAE_RENDER_TRACE_BIOMASS) return 0;
  const normalized = Math.max(0, Math.min(
    1,
    (biomass - ALGAE_RENDER_TRACE_BIOMASS) /
      (ALGAE_DENSITY_SATURATION_BIOMASS - ALGAE_RENDER_TRACE_BIOMASS),
  ));
  // Render only the standing biomass. A small perceptual lift keeps a real
  // starter film readable, while the sub-linear response leaves a nearly
  // depleted cell genuinely faint instead of pinning every non-zero amount to
  // the old 34% opacity floor. No separate grazing mark is involved.
  return 0.20 + 0.80 * Math.pow(normalized, 0.65);
};

/**
 * Keep a sparse real film readable, then deepen the colour as biomass builds.
 * The density-sensitive gain creates more separation than one constant alpha:
 * a starter patch changes only slightly while a mature film can become clearly
 * darker. This shared curve applies equally to green Oedogonium and brown
 * Nitzschia washes; species styling is applied by the Pixi layer afterwards.
 */
export const algaeDensityOpacity = (density: number): number => {
  const clampedDensity = Math.max(0, Math.min(1, density));
  return Math.min(
    0.96,
    clampedDensity * (0.84 + clampedDensity * 0.22),
  );
};

const gaussianBlur = (
  density: Float32Array,
  scratch: Float32Array,
  width: number,
  height: number,
): void => {
  // Fixed buffers reproduce the old density-canvas blur without allocating a
  // new browser backing store on every visual refresh.
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.max(0, x - 2);
      const x1 = Math.max(0, x - 1);
      const x3 = Math.min(width - 1, x + 1);
      const x4 = Math.min(width - 1, x + 2);
      scratch[row + x] = (
        density[row + x0] +
        density[row + x1] * 4 +
        density[row + x] * 6 +
        density[row + x3] * 4 +
        density[row + x4]
      ) / 16;
    }
  }

  for (let y = 0; y < height; y += 1) {
    const y0 = Math.max(0, y - 2) * width;
    const y1 = Math.max(0, y - 1) * width;
    const y2 = y * width;
    const y3 = Math.min(height - 1, y + 1) * width;
    const y4 = Math.min(height - 1, y + 2) * width;
    for (let x = 0; x < width; x += 1) {
      density[y2 + x] = (
        scratch[y0 + x] +
        scratch[y1 + x] * 4 +
        scratch[y2 + x] * 6 +
        scratch[y3 + x] * 4 +
        scratch[y4 + x]
      ) / 16;
    }
  }
};

export const writeAlgaeDensityPixels = (
  raster: AlgaeDensityRaster,
  samples: readonly AlgaeDensitySample[],
  color: AlgaeDensityColor,
): void => {
  const {
    pixels,
    density,
    scratch,
    width,
    height,
    worldWidth,
    worldHeight,
  } = raster;
  density.fill(0);
  scratch.fill(0);

  const scaleX = width / Math.max(1, worldWidth);
  const scaleY = height / Math.max(1, worldHeight);
  for (const sample of samples) {
    const strength = algaeContinuousDensity(sample.biomass);
    if (strength <= 0) continue;

    const centerX = sample.x * scaleX;
    const centerY = sample.y * scaleY;
    // A sparse film covers real surface area before it becomes dense. Amount
    // is communicated primarily with opacity rather than a shrinking cell dot.
    const radiusX = Math.max(2.2, sample.cellSize * scaleX * 1.22);
    const radiusY = Math.max(2.2, sample.cellSize * scaleY * 1.22);
    const sigmaX = radiusX * 0.52;
    const sigmaY = radiusY * 0.52;
    const minX = Math.max(0, Math.floor(centerX - radiusX * 1.35));
    const maxX = Math.min(width - 1, Math.ceil(centerX + radiusX * 1.35));
    const minY = Math.max(0, Math.floor(centerY - radiusY * 1.35));
    const maxY = Math.min(height - 1, Math.ceil(centerY + radiusY * 1.35));

    for (let y = minY; y <= maxY; y += 1) {
      const dy = (y + 0.5 - centerY) / sigmaY;
      const row = y * width;
      for (let x = minX; x <= maxX; x += 1) {
        const dx = (x + 0.5 - centerX) / sigmaX;
        const distanceSquared = dx * dx + dy * dy;
        if (distanceSquared > 7.3) continue;
        // Surface cells are adjacent samples of one film, not independent
        // translucent paint stamps. Adding their overlapping kernels made a
        // normal colony saturate simply because it occupied neighboring cells,
        // hiding the exact cell that a shrimp had thinned. The strongest local
        // sample keeps the field continuous without double-counting overlap.
        density[row + x] = Math.max(
          density[row + x],
          strength * Math.exp(-distanceSquared * 0.5),
        );
      }
    }
  }

  gaussianBlur(density, scratch, width, height);

  const red = Math.max(0, Math.min(255, Math.round(color.red)));
  const green = Math.max(0, Math.min(255, Math.round(color.green)));
  const blue = Math.max(0, Math.min(255, Math.round(color.blue)));
  for (let index = 0; index < density.length; index += 1) {
    // Preserve the remaining biomass contrast all the way to a mature film.
    // The species sprite applies its own final opacity, so this buffer does not
    // need an early nonlinear cap.
    const opacity = algaeDensityOpacity(density[index]);
    const pixelOffset = index * 4;
    pixels[pixelOffset] = red;
    pixels[pixelOffset + 1] = green;
    pixels[pixelOffset + 2] = blue;
    pixels[pixelOffset + 3] = Math.round(opacity * 255);
  }
};
