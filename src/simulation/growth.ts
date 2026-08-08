import {
  ALGAE_RENDER_TRACE_BIOMASS,
  ECOLOGY_PROCESS_RATE_SCALE,
  SPECIES,
} from './config';
import type { GrowthTrend, SpeciesBiomass, SpeciesId } from './types';
import { thetaTemperatureFactor } from './temperatureResponse';

export const clamp01 = (value: number): number =>
  Math.max(0, Math.min(1, value));

/**
 * Resolve the finite abundance represented by one attached-film sample.
 * Declining biomass below the smallest rendered propagule is less than one
 * represented colony and becomes a real local extinction. A propagule that
 * is increasing through that same range remains available to establish.
 */
export const resolvedSurfaceFilmBiomass = (
  previous: number,
  next: number,
): number =>
  next < ALGAE_RENDER_TRACE_BIOMASS && next < previous
    ? 0
    : Math.max(0, next);

// Both attached algae use one global calibration in every mission and the
// laboratory. Their measured relative growth is faster than shrimp tissue
// turnover on the compressed clock, so all film fluxes (gross production,
// respiration, stress and routine turnover) receive the same additional 2x;
// this is neither a mission exception nor protected food production.
export const SURFACE_ALGAE_PROCESS_RATE_SCALE =
  ECOLOGY_PROCESS_RATE_SCALE * 2;

// Vallisneria's ramet life is compressed against the same gameplay generation
// scale as shrimp. Leaving only its age clock compressed would make a runner
// reach senescence before paying for its visible leaves. Scale all rooted-plant
// fluxes together (gross production, respiration, stress and turnover), so the
// faster birth-to-death clock does not create oxygen-only production or a
// mission-specific survival gift.
export const VALLISNERIA_LIFE_CYCLE_RATE_SCALE = 96;

export const producerProcessRateScale = (speciesId: SpeciesId): number =>
  speciesId === 'vallisneria'
    ? VALLISNERIA_LIFE_CYCLE_RATE_SCALE
    : SURFACE_ALGAE_PROCESS_RATE_SCALE;

/** Routine tissue turnover follows the same calibrated clock as physiology. */
export const producerNaturalTurnoverRateScale = (
  speciesId: SpeciesId,
): number => producerProcessRateScale(speciesId);

// Low-profile diatoms occupy the understory of a mixed periphyton film while
// filamentous green algae form an overstory. Beer-Lambert attenuation creates
// the missing density feedback: a sparse Oedogonium film barely changes the
// light, while a dense canopy creates the partial-shade niche where Nitzschia
// can outgrow it. This changes neither biomass nor carrying capacity and does
// not reserve a protected amount for either species.
// Cell biomass is a surface-cover fraction, not a water-column concentration.
// At the old 0.95 coefficient a representative 0.20 Oedogonium cover passed
// 83% of incident light, so even an obviously green filament mat did not
// create the low-light niche this interaction was meant to model. An optical
// depth of 4 makes moderate cover transmit about 45% while a packed mat still
// becomes too dark for the understory. The resulting response is hump-shaped,
// not a protected Nitzschia floor: sparse filaments barely help, intermediate
// cover creates shade, and dense cover can suppress both layers beneath it.
const FILAMENTOUS_OVERSTORY_OPTICAL_DEPTH = 4;
export const attachedAlgaeEffectiveLight = (
  speciesId: SpeciesId,
  incidentLight: number,
  oedogoniumBiomass: number,
): number => speciesId === 'nitzschia'
  ? Math.max(0, incidentLight) * Math.exp(
    -FILAMENTOUS_OVERSTORY_OPTICAL_DEPTH * clamp01(oedogoniumBiomass),
  )
  : Math.max(0, incidentLight);

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
