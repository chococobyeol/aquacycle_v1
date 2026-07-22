import { SPECIES } from './config';
import type { GrowthTrend, SpeciesBiomass, SpeciesId } from './types';
import { thetaTemperatureFactor } from './temperatureResponse';

export const clamp01 = (value: number): number =>
  Math.max(0, Math.min(1, value));

const referenceNetLightRate = (speciesId: SpeciesId, light: number): number => {
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
  return lightRate;
};

export interface AlgaePhysiologyRates {
  grossPhotosynthesis: number;
  respiration: number;
  lightStressTurnover: number;
  netGrowth: number;
}

/**
 * Separates the former net light curve into observable gross photosynthesis,
 * continuous respiration and non-respiratory light/temperature stress. At the
 * 24°C reference the resulting net rate is exactly the established light
 * curve, preserving the earlier mission balance while making night oxygen
 * demand explicit and mass-conserving.
 */
export const algaePhysiology = (
  speciesId: SpeciesId,
  light: number,
  temperature = 24,
): AlgaePhysiologyRates => {
  const definition = SPECIES[speciesId];
  const referenceNet = referenceNetLightRate(speciesId, light);
  const referenceRespiration = definition.respirationRateAtReference;
  const referenceGross = Math.max(0, referenceNet + referenceRespiration);
  const referenceStress = Math.max(0, -(referenceNet + referenceRespiration));
  const suitability = temperatureSuitability(speciesId, temperature);
  const respiration = referenceRespiration * thetaTemperatureFactor(
    temperature,
    24,
    definition.respirationTheta,
    0.42,
    2.1,
  );
  const grossPhotosynthesis = referenceGross * suitability;
  const temperatureStress = (1 - suitability) * 0.012;
  // The response depends on local irradiance, not on whether darkness came
  // from the clock, a structure, or a switched-off lamp. Any future
  // photoacclimation must be driven by stored light history, never scenario ID.
  const lightStressTurnover = referenceStress + temperatureStress;
  return {
    grossPhotosynthesis,
    respiration,
    lightStressTurnover,
    netGrowth: grossPhotosynthesis - respiration - lightStressTurnover,
  };
};

export const netGrowthPotential = (
  speciesId: SpeciesId,
  light: number,
  temperature = 24,
): number => {
  return algaePhysiology(speciesId, light, temperature).netGrowth;
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
  if (potential < -0.0015) return 'declining';
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
  vallisneria: 0,
});

export const occupied = (biomass: SpeciesBiomass): boolean =>
  biomass.oedogonium + biomass.nitzschia + biomass.vallisneria >= 0.08;
