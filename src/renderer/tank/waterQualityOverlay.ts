import type {
  MicrobeGuildId,
  SimulationSnapshot,
  WaterQualityVariable,
} from '../../simulation/types';

export type PelagicLayer =
  | 'planktonicDecomposer'
  | 'phytoplankton';
export type WaterQualityLayer =
  | WaterQualityVariable
  | MicrobeGuildId
  | PelagicLayer
  | 'temperature'
  | 'flow';

export interface PelagicRenderPlan {
  /** The only pelagic field rendered as a continuous colour wash. */
  primary: PelagicLayer | null;
  /** Additional pelagic fields rendered as isolines/sparse point markers. */
  secondary: readonly PelagicLayer[];
}

/**
 * A stack of translucent pelagic heat maps quickly turns into an unreadable
 * blended "cloud". Keep the user's activation order, use the first pelagic
 * field as the continuous field, and reserve isolines for every later one.
 */
export const pelagicRenderPlan = (
  selectedLayers: readonly WaterQualityLayer[],
): PelagicRenderPlan => {
  const ordered: PelagicLayer[] = [];
  const seen = new Set<PelagicLayer>();
  for (const layer of selectedLayers) {
    if (
      (layer !== 'planktonicDecomposer' && layer !== 'phytoplankton') ||
      seen.has(layer)
    ) continue;
    seen.add(layer);
    ordered.push(layer);
  }
  return {
    primary: ordered[0] ?? null,
    secondary: ordered.slice(1),
  };
};

export const PELAGIC_VISUAL_MAX: Record<PelagicLayer, number> = {
  planktonicDecomposer: 8,
  phytoplankton: 12,
};

/**
 * Pelagic fields use an ecological absolute scale. Recomputing the scale from
 * the current maximum made a bloom look unchanged after every cell lost half
 * of its biomass, which hid the consumer's effect from the player.
 */
export const pelagicVisualMaximum = (
  layer: PelagicLayer,
  _values: readonly number[],
): number => PELAGIC_VISUAL_MAX[layer];

export const normalizePelagicForDisplay = (
  value: number,
  displayMaximum: number,
): number => Math.max(
  0,
  Math.min(1, (Number.isFinite(value) ? value : 0) / Math.max(1e-6, displayMaximum)),
);

export const pelagicOverlayAlpha = (normalized: number): number => {
  const safe = Math.max(0, Math.min(1, Number.isFinite(normalized) ? normalized : 0));
  return safe <= 0 ? 0 : 0.08 + Math.sqrt(safe) * 0.54;
};

/** Temporary analysis pair shown while choosing a microbial inoculation site. */
export const biofilmPlacementLayers = (
  guildId: MicrobeGuildId,
): WaterQualityLayer[] => guildId === 'decomposer'
  ? ['organicMatter', 'decomposer']
  : ['toxicWaste', 'nitrifier'];

/**
 * Dissolved channels do not share one useful ecological scale. In particular,
 * organic matter and toxic waste already matter well below 100.
 */
export const WATER_QUALITY_VISUAL_MAX: Record<WaterQualityVariable, number> = {
  organicMatter: 24,
  toxicWaste: 24,
  nutrients: 100,
  oxygen: 100,
};

const WATER_QUALITY_ADAPTIVE_MIN_SPAN: Record<WaterQualityVariable, number> = {
  organicMatter: 0.2,
  toxicWaste: 0.2,
  nutrients: 0.75,
  oxygen: 0.75,
};

export interface WaterQualityVisualRange {
  minimum: number;
  maximum: number;
  adaptive: boolean;
}

/**
 * The numerical simulation remains absolute, but a heat map must reveal where
 * the current tank differs. When a meaningful spatial range exists, use that
 * local range for colour contrast; a nearly uniform field falls back to the
 * fixed ecological 0..max scale so floating-point noise is not exaggerated.
 */
export const waterQualityVisualRange = (
  layer: WaterQualityVariable,
  values: readonly number[],
): WaterQualityVisualRange => {
  if (!values.length) return { minimum: 0, maximum: WATER_QUALITY_VISUAL_MAX[layer], adaptive: false };
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (const raw of values) {
    const value = Number.isFinite(raw) ? raw : 0;
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }
  const adaptive = maximum - minimum >= WATER_QUALITY_ADAPTIVE_MIN_SPAN[layer];
  return adaptive
    ? { minimum, maximum, adaptive: true }
    : { minimum: 0, maximum: WATER_QUALITY_VISUAL_MAX[layer], adaptive: false };
};

export const normalizeWaterQualityValue = (
  layer: WaterQualityVariable,
  value: number,
): number => Math.max(0, Math.min(1, value / WATER_QUALITY_VISUAL_MAX[layer]));

export const normalizeWaterQualityForDisplay = (
  layer: WaterQualityVariable,
  value: number,
  range: WaterQualityVisualRange,
): number => {
  if (!range.adaptive) return normalizeWaterQualityValue(layer, value);
  const span = Math.max(Number.EPSILON, range.maximum - range.minimum);
  return Math.max(0, Math.min(1, (value - range.minimum) / span));
};

/** Analysis mode is intentionally legible, while remaining translucent. */
export const waterQualityOverlayAlpha = (
  layer: WaterQualityVariable,
  value: number,
  displayNormalized = normalizeWaterQualityValue(layer, value),
): number => {
  return layer === 'oxygen'
    ? 0.38 + displayNormalized * 0.28
    : 0.34 + displayNormalized * 0.36;
};

export interface AnalysisLayerStatistics {
  minimum: number;
  average: number;
  maximum: number;
  total: number;
  sampleCount: number;
}

export const analysisLayerStatistics = (
  snapshot: SimulationSnapshot,
  layer: WaterQualityLayer,
): AnalysisLayerStatistics => {
  const values = layer === 'decomposer' || layer === 'nitrifier'
    ? snapshot.cells.map((cell) => cell.biofilm[layer] * 100)
    : layer === 'planktonicDecomposer'
      ? snapshot.biogeochemistry.water.planktonicDecomposer
      : layer === 'phytoplankton'
        ? snapshot.biogeochemistry.water.phytoplankton
    : layer === 'temperature'
      ? snapshot.biogeochemistry.transport.temperature
      : layer === 'flow'
        ? snapshot.biogeochemistry.transport.velocityX.map((x, index) =>
          Math.hypot(x, snapshot.biogeochemistry.transport.velocityY[index] ?? 0))
        : snapshot.biogeochemistry.water[layer];

  if (values.length === 0) {
    return { minimum: 0, average: 0, maximum: 0, total: 0, sampleCount: 0 };
  }

  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  let total = 0;
  for (const value of values) {
    const safeValue = Number.isFinite(value) ? value : 0;
    minimum = Math.min(minimum, safeValue);
    maximum = Math.max(maximum, safeValue);
    total += safeValue;
  }
  return {
    minimum,
    average: total / values.length,
    maximum,
    total,
    sampleCount: values.length,
  };
};
