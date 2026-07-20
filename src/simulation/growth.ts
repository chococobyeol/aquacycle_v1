import { SPECIES } from './config';
import type { GrowthTrend, SpeciesBiomass, SpeciesId } from './types';

export const clamp01 = (value: number): number =>
  Math.max(0, Math.min(1, value));

export const netGrowthPotential = (
  speciesId: SpeciesId,
  light: number,
  temperature = 24,
): number => {
  const curve = SPECIES[speciesId].lightCurve;
  let lightRate = 0;
  if (light <= curve[0].light) lightRate = curve[0].netRate;
  else if (light >= curve.at(-1)!.light) lightRate = curve.at(-1)!.netRate;
  for (let index = 0; index < curve.length - 1; index += 1) {
    const start = curve[index];
    const end = curve[index + 1];
    if (light > end.light) continue;
    const ratio = (light - start.light) / (end.light - start.light);
    lightRate = start.netRate + (end.netRate - start.netRate) * ratio;
    break;
  }
  const temperatureFactor = temperatureSuitability(speciesId, temperature);
  return lightRate >= 0
    ? lightRate * temperatureFactor
    : lightRate - (1 - temperatureFactor) * 0.012;
};

export const temperatureSuitability = (
  speciesId: SpeciesId,
  temperature: number,
): number => {
  const curve = SPECIES[speciesId].temperatureCurve;
  if (temperature <= curve[0].temperature) return curve[0].suitability;
  if (temperature >= curve.at(-1)!.temperature) return curve.at(-1)!.suitability;
  for (let index = 0; index < curve.length - 1; index += 1) {
    const start = curve[index];
    const end = curve[index + 1];
    if (temperature > end.temperature) continue;
    const ratio = (temperature - start.temperature) / (end.temperature - start.temperature);
    return start.suitability + (end.suitability - start.suitability) * ratio;
  }
  return 0;
};

export const growthTrend = (
  speciesId: SpeciesId,
  light: number,
  temperature = 24,
): GrowthTrend => {
  const potential = netGrowthPotential(speciesId, light, temperature);
  if (potential > 0.004) return 'growing';
  if (potential < -0.004) return 'declining';
  return 'stable';
};

export const habitatSuitability = (
  speciesId: SpeciesId,
  light: number,
  temperature = 24,
): number => {
  const potential = netGrowthPotential(speciesId, light, temperature);
  return clamp01(potential / SPECIES[speciesId].maximumPositiveRate);
};

export interface LocalGrowthInput {
  speciesId: SpeciesId;
  current: number;
  totalBiomass: number;
  light: number;
  temperature?: number;
  deltaSeconds: number;
}

export const stepLocalGrowth = ({
  speciesId,
  current,
  totalBiomass,
  light,
  temperature = 24,
  deltaSeconds,
}: LocalGrowthInput): number => {
  if (current <= 0) return 0;
  const potential = netGrowthPotential(speciesId, light, temperature);
  const freeCapacity = clamp01(1 - totalBiomass);
  const capacityFactor = potential > 0 ? freeCapacity : 1;
  return clamp01(current + current * potential * capacityFactor * deltaSeconds);
};

export const emptyBiomass = (): SpeciesBiomass => ({
  oedogonium: 0,
  nitzschia: 0,
});

export const occupied = (biomass: SpeciesBiomass): boolean =>
  biomass.oedogonium + biomass.nitzschia >= 0.08;
