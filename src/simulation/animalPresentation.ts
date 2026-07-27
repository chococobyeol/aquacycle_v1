import {
  GROUND_Y,
  type AnimalSpeciesId,
  type Vec2,
} from './types';

/**
 * Daphnia are only a few millimetres long, while an adult cherry shrimp is a
 * few centimetres long. They still need a small legibility exaggeration on a
 * desktop display, but must not read as shrimp-sized animals.
 */
export const daphniaVisualScale = (bodyLength: number): number =>
  Math.min(
    0.4,
    Math.max(
      0.24,
      (Number.isFinite(bodyLength) ? Math.max(0, bodyLength) : 0) / 25,
    ),
  );

/**
 * Dense cherry-shrimp colonies remain individually legible without letting
 * the procedural art cover most of a rock face.
 */
export const shrimpVisualScale = (bodyLength: number): number =>
  Math.max(
    0.14,
    (Number.isFinite(bodyLength) ? Math.max(0, bodyLength) : 0) / 66,
  );

export interface AnimalVisualHitRadii {
  x: number;
  y: number;
}

export const ANIMAL_CARCASS_DISPLAY_LIMITS: Record<AnimalSpeciesId, number> = {
  daphnia: 128,
  'cherry-shrimp': 64,
  'japanese-ricefish': 32,
};

/**
 * Renderer and picking must use the same bounded carcass set. Otherwise a
 * hidden old corpse can be selected in apparently empty water and pop into
 * existence only after the following snapshot.
 */
export const presentedAnimalCarcasses = <
  T extends { id: string; speciesId: AnimalSpeciesId },
>(
  carcasses: readonly T[],
  selectedId: string | null = null,
): T[] => {
  const selected = selectedId
    ? carcasses.find((carcass) => carcass.id === selectedId)
    : undefined;
  const counts: Record<AnimalSpeciesId, number> = {
    daphnia: 0,
    'cherry-shrimp': 0,
    'japanese-ricefish': 0,
  };
  const visible: T[] = [];
  for (let index = carcasses.length - 1; index >= 0; index -= 1) {
    const carcass = carcasses[index];
    if (carcass.id === selectedId) continue;
    if (
      counts[carcass.speciesId] >=
      ANIMAL_CARCASS_DISPLAY_LIMITS[carcass.speciesId]
    ) continue;
    counts[carcass.speciesId] += 1;
    visible.push(carcass);
  }
  if (selected) visible.push(selected);
  visible.reverse();
  return visible;
};

/**
 * Picking follows the visible silhouette closely. In particular, the long
 * horizontal shape of a shrimp must not create a large circular dead zone
 * above and below its body.
 */
export const animalVisualHitRadii = (
  speciesId: AnimalSpeciesId,
  bodyLength: number,
): AnimalVisualHitRadii => {
  const safeLength = Number.isFinite(bodyLength) ? Math.max(0, bodyLength) : 0;
  if (speciesId === 'daphnia') {
    const visibleLength = Math.min(10, safeLength);
    return {
      x: Math.max(4, visibleLength * 0.62),
      y: Math.max(4, visibleLength * 0.55),
    };
  }
  if (speciesId === 'cherry-shrimp') {
    return {
      x: Math.max(6, safeLength * 0.46),
      y: Math.max(3.5, safeLength * 0.2),
    };
  }
  const radius = Math.max(14, safeLength * 0.72);
  return { x: radius, y: radius };
};

export const animalCarcassVisualDrop = (
  speciesId: AnimalSpeciesId,
  ageSeconds: number,
  availableDrop: number,
): number => {
  const safeAge = Math.max(0, ageSeconds);
  const safeDrop = Math.max(0, availableDrop);
  if (speciesId === 'daphnia') {
    return Math.min(safeDrop, Math.max(0, safeAge - 0.6) * 0.55);
  }
  const settle = 1 - Math.exp(-safeAge * 1.35);
  return Math.min(8, safeDrop) * settle;
};

export const animalCarcassVisualPoint = (
  carcass: {
    speciesId: AnimalSpeciesId;
    x: number;
    y: number;
    ageSeconds: number;
  },
  groundY = GROUND_Y,
): Vec2 => ({
  x: carcass.x,
  y: carcass.y + animalCarcassVisualDrop(
    carcass.speciesId,
    carcass.ageSeconds,
    groundY - 8 - carcass.y,
  ),
});
