import { ECOLOGY_PROCESS_RATE_SCALE, SPECIES } from './config';
import type { GrowthTrend, SpeciesBiomass, SpeciesId } from './types';
import { thetaTemperatureFactor } from './temperatureResponse';

export const clamp01 = (value: number): number =>
  Math.max(0, Math.min(1, value));

// The shared surface-film calibration is set by the standing producer mass
// required to replace grazing in the shrimp-scale tank. Both attached algae
// use the same multiplier in every mission and the laboratory; this is not a
// mission-specific food bonus. Respiration, stress and turnover use the same
// clock so increasing net production cannot create a free oxygen-only path.
// Individual ration limits reproduction, but the producer bed must still be
// able to establish while the four supplied shrimp graze from the beginning.
// The former 2x clock produced less new algae than those founders removed and
// could only pass a staged fixture that withheld shrimp for an hour. 5x keeps
// the documented species curves and all missions on one shared clock while
// matching the compressed juvenile growth demand; respiration, stress and
// turnover remain on the same scale.
export const SURFACE_ALGAE_PROCESS_RATE_SCALE = ECOLOGY_PROCESS_RATE_SCALE;

export const producerProcessRateScale = (speciesId: SpeciesId): number =>
  speciesId === 'vallisneria' ? 1 : SURFACE_ALGAE_PROCESS_RATE_SCALE;

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

export const ALGAE_PHYSIOLOGY_VALUE_COUNT = 4;
export const ALGAE_PHYSIOLOGY_GROSS = 0;
export const ALGAE_PHYSIOLOGY_RESPIRATION = 1;
export const ALGAE_PHYSIOLOGY_STRESS = 2;
export const ALGAE_PHYSIOLOGY_NET = 3;

/**
 * Allocation-free form used by the one-second ecology hot loop. Reassigning
 * several numeric properties on a shared object still creates boxed heap
 * numbers in Chromium's worker isolate; a fixed numeric buffer avoids that
 * sustained young-generation churn.
 */
export const writeAlgaePhysiologyRates = (
  speciesId: SpeciesId,
  light: number,
  temperature: number,
  target: Float64Array,
  offset = 0,
): number => {
  const definition = SPECIES[speciesId];
  const processScale = producerProcessRateScale(speciesId);
  const referenceNet = referenceNetLightRate(speciesId, light) * processScale;
  const referenceRespiration =
    definition.respirationRateAtReference * processScale;
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
  const lightStressTurnover = referenceStress +
    (1 - suitability) * definition.temperatureStressTurnoverRate *
      processScale;
  const netGrowth = grossPhotosynthesis - respiration - lightStressTurnover;
  target[offset + ALGAE_PHYSIOLOGY_GROSS] = grossPhotosynthesis;
  target[offset + ALGAE_PHYSIOLOGY_RESPIRATION] = respiration;
  target[offset + ALGAE_PHYSIOLOGY_STRESS] = lightStressTurnover;
  target[offset + ALGAE_PHYSIOLOGY_NET] = netGrowth;
  return netGrowth;
};

const algaePhysiologyCompatibilityScratch = new Float64Array(
  ALGAE_PHYSIOLOGY_VALUE_COUNT,
);

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
  reuse?: AlgaePhysiologyRates,
): AlgaePhysiologyRates => {
  writeAlgaePhysiologyRates(
    speciesId,
    light,
    temperature,
    algaePhysiologyCompatibilityScratch,
  );
  // The response depends on local irradiance, not on whether darkness came
  // from the clock, a structure, or a switched-off lamp. Any future
  // photoacclimation must be driven by stored light history, never scenario ID.
  const rates = reuse ?? {
    grossPhotosynthesis: 0,
    respiration: 0,
    lightStressTurnover: 0,
    netGrowth: 0,
  };
  rates.grossPhotosynthesis =
    algaePhysiologyCompatibilityScratch[ALGAE_PHYSIOLOGY_GROSS];
  rates.respiration =
    algaePhysiologyCompatibilityScratch[ALGAE_PHYSIOLOGY_RESPIRATION];
  rates.lightStressTurnover =
    algaePhysiologyCompatibilityScratch[ALGAE_PHYSIOLOGY_STRESS];
  rates.netGrowth = algaePhysiologyCompatibilityScratch[ALGAE_PHYSIOLOGY_NET];
  return rates;
};

export const netGrowthPotential = (
  speciesId: SpeciesId,
  light: number,
  temperature = 24,
): number => {
  writeAlgaePhysiologyRates(
    speciesId,
    light,
    temperature,
    algaePhysiologyCompatibilityScratch,
  );
  return algaePhysiologyCompatibilityScratch[ALGAE_PHYSIOLOGY_NET];
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
  const referenceRate = SPECIES[speciesId].maximumPositiveRate *
    producerProcessRateScale(speciesId);
  if (potential > referenceRate * 0.06) return 'growing';
  if (potential < -referenceRate * 0.025) return 'declining';
  return 'stable';
};

export const habitatSuitability = (
  speciesId: SpeciesId,
  light: number,
  temperature = 24,
): number => {
  const potential = netGrowthPotential(speciesId, light, temperature);
  return clamp01(
    potential /
      (
        SPECIES[speciesId].maximumPositiveRate *
        producerProcessRateScale(speciesId)
      ),
  );
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
