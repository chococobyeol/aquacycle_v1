import type {
  AnimalSpeciesId,
  MicrobeGuildId,
  PlanktonKind,
  ScenarioId,
  SpeciesId,
  StructureDefinitionId,
  Vec2,
  WaterQualityValues,
} from './types';
import type { TemperatureResponsePoint } from './temperatureResponse';
import type { DayNightCycleDefinition } from './dayNight';

// This is the lowest biomass that is actually drawn as a colony in the tank.
// Selection and removal use the same value so anything visible can be cleaned.
export const ALGAE_VISIBLE_BIOMASS = 0.001;

/** Starting temperature of a tank whose configured light was already running. */
export const initialWaterTemperatureForLight = (
  lightOutput: number,
): number =>
  22 + 1.2 + (lightOutput / 120) * 1.8;

export interface AnimalDefinition {
  id: AnimalSpeciesId;
  displayName: string;
  scientificName: string;
  description: string;
  diet: string;
  adultLength: string;
  color: number;
  accentColor: string;
  temperature: {
    referenceTemperature: number;
    metabolicTheta: number;
    minimumMetabolicFactor: number;
    maximumMetabolicFactor: number;
    reproductionCurve: TemperatureResponsePoint[];
    healthCurve: TemperatureResponsePoint[];
    maximumThermalDamagePerSecond: number;
    summary: string;
  };
}

export interface PlanktonDefinition {
  id: PlanktonKind;
  displayName: string;
  scientificName: string;
  description: string;
  color: number;
}

export const PLANKTON: Record<PlanktonKind, PlanktonDefinition> = {
  phytoplankton: {
    id: 'phytoplankton',
    displayName: '녹색 식물플랑크톤',
    scientificName: 'Chlorella vulgaris',
    description:
      '물기둥에 떠서 빛과 무기 영양분으로 증식하는 단세포 녹조류입니다. 물벼룩의 주 먹이입니다.',
    color: 0x78a95a,
  },
  daphnia: {
    id: 'daphnia',
    displayName: '큰물벼룩',
    scientificName: 'Daphnia magna',
    description:
      '한 번 방류할 때 성체 한 마리를 놓습니다. 물속을 짧게 뛰듯 헤엄치며 주변 식물플랑크톤을 주로 먹고, 같은 물에 떠 있는 분해균도 낮은 효율의 보조 먹이로 이용합니다.',
    color: 0xc88d7d,
  },
};

export const ANIMALS: Record<AnimalSpeciesId, AnimalDefinition> = {
  'cherry-shrimp': {
    id: 'cherry-shrimp',
    displayName: '체리새우',
    scientificName: 'Neocaridina davidi',
    description: '표면을 돌아다니며 조류와 생물막을 조금씩 뜯어 먹는 담수 새우입니다.',
    diet: '규조류와 어린 조류 군락을 선호하며, 먹이가 부족하면 번식과 성장이 먼저 멈춥니다.',
    adultLength: '성체 약 2~3cm',
    color: 0xcf6f61,
    accentColor: '#cf6f61',
    temperature: {
      referenceTemperature: 24,
      metabolicTheta: 1.07,
      minimumMetabolicFactor: 0.55,
      maximumMetabolicFactor: 1.65,
      reproductionCurve: [
        { temperature: 8, response: 0 },
        { temperature: 16, response: 0.35 },
        { temperature: 20, response: 0.78 },
        { temperature: 24, response: 1 },
        { temperature: 28, response: 1.08 },
        { temperature: 32, response: 0.28 },
        { temperature: 33, response: 0 },
        { temperature: 40, response: 0 },
      ],
      healthCurve: [
        { temperature: 4, response: 0 },
        { temperature: 10, response: 0.35 },
        { temperature: 16, response: 0.85 },
        { temperature: 20, response: 1 },
        { temperature: 28, response: 1 },
        { temperature: 32, response: 0.72 },
        { temperature: 36, response: 0 },
        { temperature: 40, response: 0 },
      ],
      maximumThermalDamagePerSecond: 0.006,
      summary: '20~28°C에서는 생존·번식이 안정적입니다. 낮은 수온은 대사와 발생을 늦추고, 33°C에서는 번식이 멈추며 극단적인 고·저온은 장기 생존을 해칩니다.',
    },
  },
  'japanese-ricefish': {
    id: 'japanese-ricefish',
    displayName: '송사리',
    scientificName: 'Oryzias latipes',
    description:
      '수면 가까운 물속을 헤엄치며 움직이는 작은 먹이를 찾는 토종 소형어입니다. 가는 수초와 실 모양 조류에 알을 붙입니다.',
    diet:
      '어린 체리새우 같은 작은 동물성 먹이를 선호하고, 가까운 미세 조류는 생존을 보조하는 낮은 효율의 먹이로 이용합니다.',
    adultLength: '성체 약 3~4cm',
    color: 0xc6b77e,
    accentColor: '#9a8145',
    temperature: {
      referenceTemperature: 25,
      metabolicTheta: 1.075,
      minimumMetabolicFactor: 0.45,
      maximumMetabolicFactor: 1.8,
      reproductionCurve: [
        { temperature: 8, response: 0 },
        { temperature: 14, response: 0.08 },
        { temperature: 18, response: 0.5 },
        { temperature: 23, response: 0.9 },
        { temperature: 27, response: 1 },
        { temperature: 30, response: 0.65 },
        { temperature: 33, response: 0 },
        { temperature: 38, response: 0 },
      ],
      healthCurve: [
        { temperature: 4, response: 0.05 },
        { temperature: 8, response: 0.45 },
        { temperature: 14, response: 0.86 },
        { temperature: 20, response: 1 },
        { temperature: 28, response: 1 },
        { temperature: 32, response: 0.64 },
        { temperature: 36, response: 0 },
        { temperature: 40, response: 0 },
      ],
      maximumThermalDamagePerSecond: 0.005,
      summary:
        '약 20~28°C에서 활동과 번식이 안정적입니다. 더 낮은 수온에서는 발생과 산란이 느려지고, 장기간의 극단적인 수온은 생존을 해칩니다.',
    },
  },
  daphnia: {
    id: 'daphnia',
    displayName: '큰물벼룩',
    scientificName: 'Daphnia magna',
    description:
      '물기둥을 짧게 뛰듯 헤엄치며 주변의 식물플랑크톤을 여과하는 작은 갑각류입니다.',
    diet:
      '식물플랑크톤이 주식이며, 물속을 떠다니는 분해균은 낮은 효율의 보조 먹이로 이용합니다.',
    adultLength: '성체 약 2~5mm',
    color: 0xc88d7d,
    accentColor: '#c88d7d',
    temperature: {
      referenceTemperature: 22,
      metabolicTheta: 1.07,
      minimumMetabolicFactor: 0.55,
      maximumMetabolicFactor: 1.7,
      reproductionCurve: [
        { temperature: 6, response: 0 },
        { temperature: 12, response: 0.28 },
        { temperature: 18, response: 0.82 },
        { temperature: 22, response: 1 },
        { temperature: 26, response: 0.86 },
        { temperature: 30, response: 0.25 },
        { temperature: 32, response: 0 },
      ],
      healthCurve: [
        { temperature: 3, response: 0 },
        { temperature: 8, response: 0.42 },
        { temperature: 15, response: 0.9 },
        { temperature: 22, response: 1 },
        { temperature: 27, response: 0.9 },
        { temperature: 31, response: 0.35 },
        { temperature: 34, response: 0 },
      ],
      maximumThermalDamagePerSecond: 0.006,
      summary:
        '18~26°C에서 성장과 단위생식이 안정적입니다. 먹이가 충분하면 암컷이 수컷 없이도 새끼를 남깁니다.',
    },
  },
};

/**
 * Player-facing ecology constants. Keeping the numbers used by the simulation
 * and the numbers printed in the guide in one module prevents the handbook
 * from silently drifting away from the actual model.
 */
const OXYGEN_PER_ORGANIC_CARBON = 1.12;
const OXYGEN_PER_NITRIFIED_NITROGEN =
  OXYGEN_PER_ORGANIC_CARBON * (64 / 14) / (32 / 12);

/**
 * One physical Daphnia body budget shared by the water ledger and the
 * individual life-cycle model. A rendered Daphnia is approximately 1/102 of a
 * cherry shrimp in gameplay matter. The former 1/45 scale left only a handful
 * of individuals at an otherwise viable consumer biomass, so ordinary
 * producer-consumer troughs became deterministic demographic extinction.
 * Keep every absolute compartment and transfer rate scaled together; feeding
 * and respiration remain per-biomass rates and no matter is created by the
 * larger rendered population.
 */
export const DAPHNIA_BODY_BUDGET = {
  representativeAdultBiomass: 0.015,
  representativeJuvenileBiomass: 0.005625,
  adultStructuralBiomass: 0.009375,
  juvenileBirthBiomass: 0.00075,
  // Reserve is a short starvation buffer, not a second body hidden beside
  // structure.  The former adult capacity (0.01625) was 87% of structural
  // mass, so a bloom-fed cohort could keep filtering for longer than an
  // entire compressed lifetime after its producer had collapsed.
  suppliedReserveBiomass: 0.0012,
  adultReserveBiomass: 0.0015,
  juvenileReserveBiomass: 0.00075,
  juvenileMinimumStructure: 0.000375,
  // Structural biomass below this point is no longer viable. This is a true
  // survival floor, not the maturation threshold: a newly mature Daphnia is
  // still smaller than a fully grown adult and continues somatic growth.
  adultMinimumStructure: 0.00225,
  maturationStructuralFraction: 0.25,
  reproductiveReserveFloor: 0.00075,
  reproductionAllocationPerSecondIndividual: 0.000007,
  juvenileGrowthPerSecond: 0.00005,
  adultSomaticGrowthPerSecond: 0.00005,
  adultSomaticGrowthAllocationFraction: 0.2,
} as const;

/**
 * Continuous relative feeding capacity for a body of the supplied mass.
 * Keeping this shared prevents either life-cycle implementation from
 * reintroducing a juvenile/adult stage multiplier and a maturation jump.
 */
export const continuousBodyMassFeedingScale = (
  bodyMass: number,
  adultReferenceMass: number,
  massExponent: number,
): number => {
  if (bodyMass <= 0 || adultReferenceMass <= 0) return 0;
  return Math.pow(
    Math.min(1, Math.max(0, bodyMass / adultReferenceMass)),
    massExponent,
  );
};

/**
 * Absolute maintenance demand on one continuous body-mass curve.
 *
 * `adultMassSpecificRate` remains the readable calibration value, but both
 * juveniles and adults use the same M^b relationship. Unlike clearance,
 * maintenance is not capped at the reference mass: carrying reserve and eggs
 * remains metabolically costly.
 */
export const continuousBodyMassMaintenance = (
  bodyMass: number,
  adultReferenceMass: number,
  adultMassSpecificRate: number,
  massExponent: number,
): number => {
  if (
    bodyMass <= 0 ||
    adultReferenceMass <= 0 ||
    adultMassSpecificRate <= 0
  ) {
    return 0;
  }
  return adultReferenceMass * adultMassSpecificRate * Math.pow(
    bodyMass / adultReferenceMass,
    massExponent,
  );
};

export const WATER_CYCLE_RULES = {
  // All living and dead biomass uses one gameplay matter unit with a fixed
  // carbon:nitrogen composition.  This is deliberately simpler than a full
  // C/N/P model, but it lets every transformation close an auditable carbon
  // and nitrogen balance instead of creating water-quality values from time.
  biomassNitrogen: 0.08,
  biomassCarbon: 0.32,
  initialDissolvedInorganicCarbon: 58,
  initialHeadspaceCarbonDioxide: 22,
  initialHeadspaceOxygen: 76,
  carbonHalfSaturation: 8,
  mineralNutrientHalfSaturation: 3.5,
  detritusSolubilizationRate: 0.009,
  closedGasExchangeRate: 0.018,
  // One shared oxygen-equivalent conversion is used in both directions:
  // fixing organic carbon produces it and mineralising that same carbon
  // consumes it. The absolute value sets the game's display-unit scale; it is
  // no longer an empirical margin that differs by process.
  oxygenPerOrganicCarbon: OXYGEN_PER_ORGANIC_CARBON,
  // NH4-N -> NO3-N requires 64/14 g O2 per g N, while CH2O carbon oxidation
  // requires 32/12 g O2 per g C. Deriving this value from the carbon scale
  // keeps carbon and nitrogen redox paths on one auditable unit system.
  oxygenPerNitrifiedNitrogen: OXYGEN_PER_NITRIFIED_NITROGEN,
  algae: {
    // Ammonium is used first, with nitrate/other mineral nutrients filling the
    // remainder.  Uptake is charged only for newly fixed biomass.
    ammoniumPreference: 0.72,
    // Dissolved/suspended organic load makes the water progressively murkier.
    // This Beer-Lambert-like gameplay coefficient leaves clean water almost
    // unchanged but prevents a saturated, undecomposed organic pool from
    // remaining optically harmless to producers.
    organicLightAttenuation: 0.025,
  },
  shrimp: {
    assimilationFraction: 0.30,
    fecesFraction: 0.42,
    respirationFraction: 0.28,
    adultMaintenanceBiomassPerSecond: 0.000055,
    juvenileMaintenanceBiomassPerSecond: 0.000032,
    adultStructuralBiomass: 1,
    juvenileBirthBiomass: 0.16,
    suppliedReserveBiomass: 0.08,
    // Absolute grazing follows continuous body-size allometry instead of a
    // fixed juvenile multiplier and an abrupt jump on maturation.
    feedingMassExponent: 0.75,
    // Adults cannot retain every bite indefinitely. Excess assimilation is
    // returned to detritus, so a well-fed male does not become a permanent
    // carbon/nitrogen sink and an eventual oversized pollution pulse.
    adultReserveBiomass: 0.72,
    juvenileReserveBiomass: 1.05,
  },
  ricefish: {
    // The former 38% retention was combined with a second 20% digestibility
    // multiplier for filamentous periphyton.  A descendant consuming the
    // measured 0.0096 biomass/s therefore retained only 0.00073 biomass/s
    // against roughly 0.0011 biomass/s of realised maintenance: it starved
    // while visibly feeding.  Digestibility remains food-specific below, while
    // this fraction represents the retained share of the digestible ration.
    assimilationFraction: 0.48,
    fecesFraction: 0.32,
    respirationFraction: 0.20,
    adultStructuralBiomass: 1.8,
    juvenileStructuralBiomass: 0.72,
    fryBirthBiomass: 0.18,
    eggBiomass: 0.075,
    suppliedReserveBiomass: 0.65,
    adultReserveBiomass: 1.05,
    juvenileReserveBiomass: 0.72,
    fryReserveBiomass: 0.38,
  },
  daphnia: {
    assimilationFraction: 0.55,
    fecesFraction: 0.34,
    respirationFraction: 0.11,
    adultStructuralBiomass:
      DAPHNIA_BODY_BUDGET.adultStructuralBiomass,
    juvenileBirthBiomass:
      DAPHNIA_BODY_BUDGET.juvenileBirthBiomass,
    suppliedReserveBiomass:
      DAPHNIA_BODY_BUDGET.suppliedReserveBiomass,
    adultReserveBiomass:
      DAPHNIA_BODY_BUDGET.adultReserveBiomass,
    juvenileReserveBiomass:
      DAPHNIA_BODY_BUDGET.juvenileReserveBiomass,
  },
} as const;

/** Molecular and unresolved sub-cell mixing. Directed tank circulation is
 * now supplied by the shared buoyant water-transport grid. */
export const WATER_TRANSPORT_RULES = {
  localDiffusionPerSecond: {
    organicMatter: 0.045,
    toxicWaste: 0.09,
    nutrients: 0.07,
    oxygen: 0.12,
    dissolvedInorganicCarbon: 0.1,
    planktonicDecomposer: 0.065,
    phytoplankton: 0.045,
    daphnia: 0.018,
  },
} as const;

/**
 * Mission-7 pelagic food-web constants. Biomass and time remain compressed
 * gameplay units, but the ordering is ecological: phytoplankton is the
 * high-quality food, bacterioplankton is a low-quality supplement, ingestion
 * saturates, and bacteria alone cannot fund sustained reproduction.
 */
export const PLANKTON_ECOLOGY_RULES = {
  inoculum: {
    phytoplanktonBiomass: 1.1,
    daphniaAdultBiomass:
      DAPHNIA_BODY_BUDGET.adultStructuralBiomass +
      DAPHNIA_BODY_BUDGET.suppliedReserveBiomass,
  },
  phytoplankton: {
    // Small suspended cells turn over faster and retain useful uptake at
    // lower dissolved nutrient/carbon concentrations than the larger attached
    // producers. Exact uptake still withdraws mass from the shared ledger.
    maximumGrowthPerSecond: 0.0095,
    // Suspended cells do not receive a separate logistic carrying capacity.
    // Finite nitrogen/carbon and the Beer-Lambert optical depth below provide
    // the actual density feedback. This coefficient converts the cumulative
    // phytoplankton concentration above a cell into optical depth.
    selfShadingPerColumnConcentration: 0.006,
    respirationPerSecond: 0.0016,
    backgroundMortalityPerSecond: 0.00025,
    darkStressMortalityPerSecond: 0.0011,
    mineralNitrogenHalfSaturation: 1.6,
    carbonHalfSaturation: 2.8,
    lightHalfSaturation: 22,
    photoInhibitionStart: 92,
    settlingPerSecond: 0.0011,
  },
  daphnia: {
    // Both suspended foods use an ordinary type-II saturation curve. Food
    // intake therefore approaches zero continuously with real concentration;
    // neither producer nor decomposer receives an uneatable low-density
    // refuge.
    phytoplanktonHalfSaturation: 4,
    phytoplanktonResponseExponent: 1,
    bacterioplanktonHalfSaturation: 0.6,
    maximumFiltrationPerBiomassSecond: 0.012,
    // Filtration follows one continuous sub-linear body-mass allometry across
    // both life stages. A neonate therefore clears less water in absolute
    // terms than an adult, while retaining the higher mass-specific clearance
    // needed to reach adult structure within the compressed life span. The
    // old fixed ×15 juvenile multiplier made a nearly mature juvenile filter
    // about an order of magnitude more than an adult and then drop abruptly at
    // maturation. An exponent near the measured 0.8 allometry gives a neonate
    // about 10.6% of adult absolute clearance at 5% of adult reference mass,
    // while retaining higher mass-specific clearance during growth.
    filtrationMassExponent: 0.75,
    // Bacteria are captured incidentally but are too poor a ration to sustain
    // an adult by themselves. At saturated bacterioplankton this contribution
    // remains below the phytoplankton-free maintenance requirement.
    maximumBacteriaDietFraction: 0.18,
    // A high-quality algal ration supports rapid juvenile net production.
    // The remainder of ingested material is returned through feces and
    // immediate metabolism by the exact material ledger.
    phytoplanktonAssimilation: 0.55,
    bacterioplanktonAssimilation: 0.03,
    fecesFraction: 0.34,
    // Respiration follows one continuous M^b curve before and after
    // maturation. The old juvenile/adult stage switch cut the same animal's
    // absolute maintenance by roughly 45% when its life-stage label changed.
    // The compressed lifespan must also compress matter turnover.  At the
    // former rate an adult respired only about 13% of representative mass over
    // its whole life and could coast through several producer troughs.
    adultMaintenancePerSecond: 0.0003,
    maintenanceMassExponent: 0.75,
    backgroundMortalityPerSecond: 0.00008,
    starvationMortalityPerSecond: 0.004,
    // Filtering activity follows the same conserved reserve that pays
    // maintenance and reproduction. A depleted animal can still make weak
    // feeding strokes, but it cannot keep clearing the tank at nearly the
    // well-fed rate while waiting to die.
    fullFiltrationEnergy: 0.55,
    minimumStarvedFiltrationFraction: 0.04,
    filtrationConditionExponent: 2,
    oxygenStressStart: 30,
    oxygenMaximumDamagePerSecond: 0.025,
    toxicWasteStressStart: 6,
    toxicWasteFullStress: 24,
    toxicMaximumDamagePerSecond: 0.018,
    healthyWaterRecoveryPerSecond: 0.006,
    // Compressed life history: under a full phytoplankton ration juveniles
    // become reproductive within one mission day/night cycle, and born adults
    // can produce the next cohort before the 30-minute challenge ends.
    // The two rates below belong only to the legacy density-grid fallback.
    // Individual animals mature from conserved structural biomass and fund
    // eggs through `reproductionAllocationPerSecondIndividual`.
    juvenileMaturationPerSecond: 0.0045,
    reproductionAllocationPerSecond: 0.00165,
    minimumFoodQualityForMaturation: 0.22,
    // Below this continuous phytoplankton response adults keep filtering for
    // maintenance but stop provisioning new eggs. This models the observed
    // food dependence of Daphnia clutch formation; it does not make the
    // remaining phytoplankton inaccessible or protect it from grazing.
    minimumFoodQualityForReproduction: 0.5,
    // One rendered Daphnia is much lighter than a cherry shrimp. Keeping the
    // former 0.095-unit adult made the consumer guild only about eleven times
    // lighter than a shrimp and forced a three-animal demographic bottleneck.
    // The complete per-individual body budget is scaled together here; all
    // per-biomass feeding, respiration and stoichiometric rates remain shared.
    representativeAdultBiomass:
      DAPHNIA_BODY_BUDGET.representativeAdultBiomass,
    representativeJuvenileBiomass:
      DAPHNIA_BODY_BUDGET.representativeJuvenileBiomass,
    foundersPerInoculum: 1,
    juvenileBirthBiomass:
      DAPHNIA_BODY_BUDGET.juvenileBirthBiomass,
    adultStructuralBiomass:
      DAPHNIA_BODY_BUDGET.adultStructuralBiomass,
    suppliedAdultReserveBiomass:
      DAPHNIA_BODY_BUDGET.suppliedReserveBiomass,
    juvenileReserveCapacity:
      DAPHNIA_BODY_BUDGET.juvenileReserveBiomass,
    // Somatic growth may use only reserve above this fraction. This must stay
    // above the 18% starvation-stress threshold used by the health model:
    // the former 14% target forced every well-fed growing juvenile to be
    // classified as chronically starving even while it was assimilating food.
    juvenileProtectedReserveFraction: 0.24,
    adultReserveCapacity:
      DAPHNIA_BODY_BUDGET.adultReserveBiomass,
    juvenileMinimumStructure:
      DAPHNIA_BODY_BUDGET.juvenileMinimumStructure,
    adultMinimumStructure:
      DAPHNIA_BODY_BUDGET.adultMinimumStructure,
    maturationStructuralFraction:
      DAPHNIA_BODY_BUDGET.maturationStructuralFraction,
    maturationStructuralBiomass:
      DAPHNIA_BODY_BUDGET.adultStructuralBiomass *
      DAPHNIA_BODY_BUDGET.maturationStructuralFraction,
    maturationSeconds: 240,
    // Juveniles mature after a food-funded size threshold and an individual
    // number of molts. The reference duration only compresses the molt clock;
    // it is no longer a second hard maturity gate shared by a whole cohort.
    maturationInstarsMinimum: 4,
    maturationInstarsMaximum: 6,
    // Daphnia turn over much faster than Neocaridina.  The simulation
    // compresses both life histories, but must preserve that ordering so a
    // population is maintained by successive broods rather than by immortal
    // founders. At 24°C this yields roughly 15–22 simulated minutes, with
    // several food-funded broods rather than one long-lived founder cohort.
    // Keep the same 1,150-second mean while spreading old-age deaths across a
    // wider interval. This represents ordinary individual lifespan variation
    // and prevents a bloom-born cohort from disappearing on one clock edge.
    minimumLifespanSeconds: 750,
    maximumLifespanSeconds: 1_550,
    suppliedAdultAgeMinimumSeconds: 90,
    suppliedAdultAgeMaximumSeconds: 190,
    // At about 20–25°C D. magna commonly releases a clutch with each adult
    // molt. The compressed clock keeps the 4–6 juvenile instars at 240 seconds
    // while an adult instar is shorter, instead of making one adult molt almost
    // as long as the entire juvenile period:
    // maturation is allowed at 25% of final structural mass, just above the
    // adult viability floor. A newly mature
    // female can provision her first brood immediately. Embryos complete
    // development within an ordinary adult molt cycle and are released at the
    // following molt instead of on an independent hatching timer.
    broodDevelopmentSeconds: 110,
    broodCooldownSeconds: 150,
    adultMoltCycleMinimumFactor: 0.82,
    adultMoltCycleMaximumFactor: 1.18,
    minimumBroodSize: 1,
    // One rendered neonate is released per compressed brood. Real D. magna
    // clutches contain more offspring, but the game's visible individual is a
    // scaled demographic unit; keeping the real short clutch interval while
    // scaling clutch count prevents an initial ration pulse from creating a
    // synchronized, resource-exhausting cohort. Its full 0.00075 matter is
    // removed from the mother's phytoplankton-funded egg compartment.
    maximumBroodSize: 1,
    highFoodBroodResponseThreshold: 0.9,
    // Egg provisioning already draws from this tick's real phytoplankton
    // assimilation surplus. Applying a second squared food penalty made
    // healthy adults at moderate food concentrations replace themselves at
    // less than one offspring per lifetime. A linear response preserves the
    // food threshold without double-counting limitation.
    reproductionFoodResponseExponent: 1,
    reproductiveReserveFloor:
      DAPHNIA_BODY_BUDGET.reproductiveReserveFloor,
    reproductionStartEnergy: 0.38,
    reproductionAllocationPerSecondIndividual:
      DAPHNIA_BODY_BUDGET.reproductionAllocationPerSecondIndividual,
    juvenileGrowthPerSecond:
      DAPHNIA_BODY_BUDGET.juvenileGrowthPerSecond,
    adultSomaticGrowthPerSecond:
      DAPHNIA_BODY_BUDGET.adultSomaticGrowthPerSecond,
    adultSomaticGrowthAllocationFraction:
      DAPHNIA_BODY_BUDGET.adultSomaticGrowthAllocationFraction,
    localSensingRadius: 52,
    hungrySensingRadius: 126,
    roamingDirectionSeconds: 7,
    swimmingSpeed: 18,
    currentVelocityScale: 32,
  },
} as const;

/**
 * Functional response and diet partition for one unit of Daphnia filtration
 * capacity. Each suspended resource first produces its own type-II potential;
 * only their sum is capped by the animal's total clearance capacity. This
 * keeps both low-density responses first order instead of accidentally
 * multiplying the bacterial response once for total intake and again for diet
 * share.
 */
export const daphniaSuspendedFoodResponse = (
  phytoplankton: number,
  bacterioplankton: number,
): {
  phytoplanktonPotential: number;
  bacterioplanktonPotential: number;
  combinedResponse: number;
  bacteriaShare: number;
} => {
  const rules = PLANKTON_ECOLOGY_RULES.daphnia;
  const safePhytoplankton = Math.max(0, phytoplankton);
  const safeBacterioplankton = Math.max(0, bacterioplankton);
  const phytoNumerator = Math.pow(
    safePhytoplankton,
    rules.phytoplanktonResponseExponent,
  );
  const phytoplanktonPotential = safePhytoplankton <= 0
    ? 0
    : phytoNumerator / (
      phytoNumerator +
      Math.pow(
        rules.phytoplanktonHalfSaturation,
        rules.phytoplanktonResponseExponent,
      )
    );
  const bacterioplanktonPotential = safeBacterioplankton <= 0
    ? 0
    : (
      safeBacterioplankton /
      (
        rules.bacterioplanktonHalfSaturation +
        safeBacterioplankton
      )
    ) * rules.maximumBacteriaDietFraction;
  const totalPotential =
    phytoplanktonPotential + bacterioplanktonPotential;
  return {
    phytoplanktonPotential,
    bacterioplanktonPotential,
    combinedResponse: Math.min(1, totalPotential),
    bacteriaShare: totalPotential <= 0
      ? 0
      : bacterioplanktonPotential / totalPotential,
  };
};

/**
 * Compressed Monod-style film kinetics.  Heterotrophs respond faster to an
 * organic pulse and also lose active biomass faster when starved.  Nitrifiers
 * grow more slowly, have a lower yield and persist longer at low loading.
 * The rates are deliberately gameplay-compressed, but retain those measured
 * relative behaviours rather than treating both guilds as interchangeable.
 */
export const MICROBE_ECOLOGY_RULES = {
  decomposer: {
    substrate: 'organicMatter',
    halfSaturation: 4,
    oxygenHalfSaturation: 14,
    // biomass-equivalent organic matter consumed per unit film and second
    maximumUptake: 0.11,
    biomassYield: 0.42,
    maintenanceDecayRate: 0.0022,
    starvationDecayRate: 0.013,
    surfaceSpreadRate: 0.025,
    waterborneExportRate: 0.0007,
    suspendedDecayRate: 0.025,
    referenceTemperature: 24,
    temperatureCoefficient: 1.08,
  },
  nitrifier: {
    substrate: 'toxicWaste',
    // Mission 5 operates around 0.5–1.5 displayed ammonium.  The former
    // half-saturation of 5 made that entire band look like near-starvation and
    // forced a film to wait for a large local spike before it could recover.
    // This compressed Monod curve crosses from net loss to net growth at about
    // 0.5–0.8 in oxygenated, partly occupied film.
    halfSaturation: 0.8,
    oxygenHalfSaturation: 24,
    // toxic nitrogen consumed per unit film and second; biomassYield is the
    // fraction of processed nitrogen retained in new film. Lowering Vmax while
    // lowering Ks preserves ordinary 0.5–1.5 processing capacity without
    // turning a rare high-ammonium pulse into an instantaneous sink.
    maximumUptake: 0.008,
    biomassYield: 0.11,
    maintenanceDecayRate: 0.0003,
    starvationDecayRate: 0.0048,
    surfaceSpreadRate: 0.012,
    waterborneExportRate: 0.00035,
    suspendedDecayRate: 0.008,
    referenceTemperature: 24,
    temperatureCoefficient: 1.08,
  },
  // Attachment is a gradual mass-transfer process. The old eight attempts
  // each offering 16% of the entire suspended pool could strip most viable
  // bacterioplankton into biofilm within one simulated second.
  settlementAttemptsPerSecond: 2,
  settlementFractionPerAttempt: 0.02,
  minimumSettlement: 0,
} as const;

export const SHRIMP_ECOLOGY_RULES = {
  // Adult-stage longevity begins when conserved growth reaches maturity.
  // Food-limited juvenile development therefore cannot consume most of a
  // fixed birth-to-death timer before the first ovarian cycle even starts.
  minimumLifespanSeconds: 1_200,
  // A wider individual adult-life range prevents every offspring cohort from
  // reaching senescence together. It is not an immortal low-population
  // exception; juveniles still die from starvation and environmental stress.
  maximumLifespanSeconds: 2_400,
  // Inventory shrimp arrive as young adults. Their supplied-species sequence
  // seeds variation, so unrelated Daphnia births cannot change these traits.
  suppliedAdultMinimumAgeSeconds: 180,
  suppliedAdultMaximumAgeSeconds: 300,
  // Calibrated against the realised grazing duty cycle, not the instantaneous
  // maximum bite. At the former 0.005 baseline, a shrimp consuming the observed
  // 0.013-0.03 biomass/s still lost matter while actively grazing because only
  // 30% is assimilated. That made continuous feeding mathematically incapable
  // of paying maintenance for most movement paths.
  adultBaseMetabolismPerSecond: 0.0018,
  juvenileBaseMetabolismPerSecond: 0.0011,
  restingActivityCostPerSecond: 0.00013,
  grazingActivityCostPerSecond: 0.00038,
  travelingActivityCostPerSecond: 0.0009,
  // A bite that is large enough to fill the physical reserve must also cover
  // ordinary movement/metabolism. The former 0.08 value let well-fed animals
  // reach the reserve cap while their abstract hunger meter still hit zero.
  energyPerConsumedBiomass: 0.18,
  maximumBiteBiomassPerSecond: 0.375,
  oxygenStressStart: 30,
  oxygenMaximumDamagePerSecond: 0.025,
  toxicWasteStressStart: 6,
  toxicWasteFullStress: 24,
  toxicMaximumDamagePerSecond: 0.032,
  healthyWaterRecoveryPerSecond: 0.004,
  // A newly introduced adult that never establishes feeding suffers acute
  // acclimation starvation even while some structural matter remains. Once it
  // has consumed a small real ration, ordinary conserved reserve/body loss
  // governs later fasting; bite rates are unchanged.
  starvationGraceSeconds: 55,
  starvationFullStressSeconds: 90,
  starvationMaximumDamagePerSecond: 0.032,
  starvationAcclimationFoodBiomass: 0.02,
  reproductionEnergy: 0.34,
  maleReproductionEnergy: 0.34,
  gestationEnergy: 0.30,
  // Supplied young-adult females already carry a partly developed ovary, just
  // as supplied ricefish carry pre-allocated egg matter. It is conserved
  // biomass, not a free brood: the remainder still has to come from positive
  // post-maintenance assimilation. Once funded, mating and gestation use that
  // conserved matter without requiring both animals' short feeding windows to
  // overlap.
  suppliedFemaleBroodReserveFraction: 0.75,
  // Maturity is still paid by conserved somatic growth. This range is an
  // individual target, not a random delay applied after the animal is grown.
  // Poor feeding can therefore postpone maturity beyond the target, while
  // animals born together do not all cross one shared 180-second edge.
  maturationMinimumSeconds: 150,
  maturationMaximumSeconds: 240,
  // Ovarian readiness replaces the fixed post-brood countdown. It advances
  // continuously from temperature and individual condition while egg matter
  // is funded independently from conserved somatic reserve.
  ovarianCycleMinimumSeconds: 260,
  ovarianCycleMaximumSeconds: 500,
  ovarianProgressEnergyFloor: 0.30,
  // The nominal ovarian-cycle range is the realised rate for a healthy,
  // feeding adult. The former 1.0-energy denominator made an ordinary
  // 0.45–0.55 adult take three to five times the documented compressed cycle,
  // so a healthy daughter could die of old age before her first clutch.
  ovarianFullSpeedEnergy: 0.50,
  ovarianAllocationPerSecond: 0.0014,
  suppliedOvarianProgressMinimum: 0.18,
  suppliedOvarianProgressMaximum: 0.78,
  newAdultOvarianProgressMaximum: 0.14,
  gestationMinimumSeconds: 68,
  gestationMaximumSeconds: 82,
  // The visual population represents a compressed colony. Three rendered
  // juveniles stand in for a real multi-egg brood, and their full conserved
  // biomass must be funded before mating. Alternating IDs still ensure that a
  // completed brood contains both sexes without a one-offspring demographic
  // dead end or a hidden low-population birth rule.
  minimumClutchSize: 3,
  maximumClutchSize: 3,
} as const;

/**
 * One coherent ricefish rule set is shared by challenge and laboratory
 * scenarios. Durations are gameplay-compressed, while the ordering of egg,
 * fry, juvenile and adult stages and the relative temperature/oxygen effects
 * follow the medaka literature recorded in the mission 7 implementation note.
 */
export const RICEFISH_ECOLOGY_RULES = {
  minimumLifespanSeconds: 2_400,
  maximumLifespanSeconds: 3_300,
  suppliedAdultMinimumAgeSeconds: 620,
  suppliedAdultMaximumAgeSeconds: 900,
  fryStageSeconds: 150,
  maturationSeconds: 480,
  eggIncubationSecondsAt25C: 95,
  carriedEggSeconds: 12,
  // A hatchling retains part of the egg's remaining matter as yolk reserve.
  // The world moves matter from structure to reserve at hatching; it does not
  // mint a separate starter-energy pool.
  hatchYolkReserveFraction: 0.40,
  adultLength: 44,
  juvenileLength: 27,
  fryLength: 10,
  // The consumer budget is calibrated against the 25-minute challenge, not
  // only the first hatch. An unfed fish still declines, but a fish that
  // intermittently captures juvenile shrimp or grazes periphyton can replace
  // maintenance instead of losing most of its structure in five minutes.
  adultBaseMetabolismPerSecond: 0.0013,
  eggBaseMetabolismPerSecond: 0.0001,
  // Structural biomass is the mass proxy. Sub-adult maintenance and activity
  // therefore scale continuously rather than jumping at named life stages.
  metabolicMassExponent: 0.75,
  restingActivityCostPerSecond: 0.0001,
  swimmingActivityCostPerSecond: 0.00038,
  huntingActivityCostPerSecond: 0.00075,
  oxygenStressStart: 36,
  oxygenSevereStress: 18,
  oxygenMaximumDamagePerSecond: 0.022,
  toxicWasteStressStart: 5,
  toxicWasteFullStress: 20,
  toxicMaximumDamagePerSecond: 0.028,
  healthyWaterRecoveryPerSecond: 0.0035,
  forageStartEnergy: 0.5,
  forageStopEnergy: 0.76,
  // Adults route repeated feeding surplus into gonads after maintenance.
  // Requiring a nearly full reserve made the small, spatially foraging
  // population depend on one unusually lucky feeding streak and prevented
  // otherwise healthy daughters from ever producing the next generation.
  // The retained floor still covers ordinary fasting between local encounters.
  // Energy is a composite UI condition score whose denominator changes at
  // maturation. Reproduction is funded by conserved reproductive biomass, so
  // this threshold only rejects a genuinely emaciated adult; it must not
  // require a newly matured fish to be almost full adult size.
  reproductionEnergy: 0.15,
  reproductionReserveFloor: 0.08,
  reproductionAllocationFraction: 0.20,
  matingEnergy: 0.15,
  eggClutchMinimum: 2,
  // A rendered egg/fry represents part of a much larger real clutch. Keeping
  // each simulated spawn to one mixed-sex pair prevents the first two females
  // from turning one feeding pulse into eight full-sized competitors at once.
  eggClutchMaximum: 2,
  // One rendered fish represents a compressed cohort. This leaves replacement
  // slightly above one mixed-sex brood per female, enough to survive ordinary
  // fry loss without recreating real-world daily-clutch exponential growth.
  postSpawnCooldownSeconds: 1_900,
  matingEncounterRadius: 180,
  matingSeconds: 4,
  animalPreyDetectionRadius: 360,
  algaeDetectionRadius: 145,
  fryAlgaeDetectionRadius: 300,
  strikeDistance: 32,
  strikeCooldownSeconds: 2.2,
  juvenileShrimpPreference: 1,
  adultShrimpPreference: 0,
  // Adults can opportunistically take algae/periphyton, but medaka are not
  // modelled as a second shrimp-like surface scraper. Animal prey supplies the
  // efficient feeding pulses; this low-quality ration bridges encounters.
  diatomAssimilationMultiplier: 0.28,
  oedogoniumAssimilationMultiplier: 0.14,
  // In the compressed food web, a visible periphyton patch also represents
  // its attached infusoria and other microscopic food. Larvae can use that
  // fraction more efficiently than adults can digest the algae itself.
  fryDiatomAssimilationMultiplier: 0.9,
  fryOedogoniumAssimilationMultiplier: 0.45,
  fryAlgaeBiteScale: 0.46,
  juvenileDiatomAssimilationMultiplier: 0.65,
  juvenileOedogoniumAssimilationMultiplier: 0.30,
  juvenileAlgaeBiteScale: 0.72,
  juvenileAlgaeDetectionRadius: 300,
  fryBiofilmMicrofaunaMultiplier: 0.65,
  juvenileBiofilmMicrofaunaMultiplier: 0.45,
  adultBiofilmMicrofaunaMultiplier: 0.12,
  adultAlgaeBiteScale: 0.50,
  maximumAlgaeBiteBiomassPerSecond: 0.12,
  // Holling/Monod-like food-density response. A fish on a rich periphyton mat
  // can approach the maximum bite rate, while intake continuously approaches
  // zero with food density. This is not a protected biomass floor.
  periphytonGrazingHalfSaturation: 0.12,
  technicalPopulationLimit: 512,
} as const;

export interface MicrobeDefinition {
  id: MicrobeGuildId;
  displayName: string;
  scientificRole: string;
  color: number;
  accentColor: string;
  description: string;
  foodLabel: string;
  productLabel: string;
  temperatureSummary: string;
}

export const MICROBES: Record<MicrobeGuildId, MicrobeDefinition> = {
  decomposer: {
    id: 'decomposer',
    displayName: '분해균 필름',
    scientificRole: '종속영양 분해자 군집',
    color: 0x8b7657,
    accentColor: '#8b7657',
    description: '표면에 붙어 유기물을 분해합니다. 유기물이 늘면 빠르게 증가하고, 고갈되면 다시 줄어듭니다.',
    foodLabel: '유기물 + 산소',
    productLabel: '암모니아성 노폐물',
    temperatureSummary: '24°C 기준 반응률에 수온 1°C당 1.08의 보정을 적용합니다. 낮은 수온에서는 분해와 증감이 함께 느려집니다.',
  },
  nitrifier: {
    id: 'nitrifier',
    displayName: '질산화균 필름',
    scientificRole: '통합 질산화 군집',
    color: 0x4f827d,
    accentColor: '#4f827d',
    description: '산소를 사용해 암모니아성 노폐물을 영양염으로 바꿉니다. 분해균보다 느리게 늘지만 먹이가 적어도 더 오래 유지됩니다.',
    foodLabel: '암모니아성 노폐물 + 산소',
    productLabel: '영양염',
    temperatureSummary: '24°C 기준 반응률에 수온 1°C당 1.08의 보정을 적용합니다. 먹이와 산소가 같아도 차가운 곳에서는 전환이 느립니다.',
  },
};

export interface LightCurvePoint {
  light: number;
  netRate: number;
}

export interface TemperatureCurvePoint {
  temperature: number;
  suitability: number;
}

export interface SpeciesDefinition {
  id: SpeciesId;
  displayName: string;
  shortName: string;
  scientificName: string;
  color: number;
  accentColor: string;
  description: string;
  realScale: string;
  colonyAppearance: string;
  niche: string;
  lightCurve: LightCurvePoint[];
  temperatureCurve: TemperatureCurvePoint[];
  temperatureSummary: string;
  growthForm: 'surface-film' | 'rooted-macrophyte';
  respirationRateAtReference: number;
  respirationTheta: number;
  dispersalRate: number;
  maximumPositiveRate: number;
}

export const SPECIES: Record<SpeciesId, SpeciesDefinition> = {
  oedogonium: {
    id: 'oedogonium',
    displayName: '붓뚜껑말속',
    shortName: '붓뚜껑말',
    scientificName: 'Oedogonium sp.',
    color: 0x557f4d,
    accentColor: '#557f4d',
    description:
      '표면에 붙어 가느다란 실 모양 군락을 만드는 담수 녹조류입니다. 이 수조 계통은 중간에서 밝은 빛에서 빠르게 퍼집니다.',
    realScale: '실 한 가닥의 굵기는 현미경으로 구분할 정도로 가늘어 육안으로는 군락만 보입니다.',
    colonyAppearance: '육안으로는 밝은 녹색의 얇은 솜털이나 부드러운 막처럼 보입니다.',
    niche: '밝은 돌 앞면에서 빠르게 성장하지만 깊은 그늘에서는 서서히 감소합니다.',
    lightCurve: [
      { light: 0, netRate: -0.004 },
      { light: 15, netRate: -0.002 },
      { light: 28, netRate: 0 },
      { light: 45, netRate: 0.042 },
      { light: 68, netRate: 0.068 },
      { light: 82, netRate: 0.046 },
      { light: 94, netRate: 0.006 },
      { light: 100, netRate: -0.024 },
    ],
    temperatureCurve: [
      { temperature: 8, suitability: 0.12 },
      { temperature: 14, suitability: 0.58 },
      { temperature: 20, suitability: 0.92 },
      { temperature: 24, suitability: 1 },
      { temperature: 30, suitability: 0.72 },
      { temperature: 36, suitability: 0.08 },
    ],
    temperatureSummary: '이 수조 계통은 20~27°C에서 안정적이며 극단적인 저온·고온에서는 성장이 둔화됩니다.',
    growthForm: 'surface-film',
    respirationRateAtReference: 0.004,
    respirationTheta: 1.065,
    dispersalRate: 0.19,
    maximumPositiveRate: 0.068,
  },
  nitzschia: {
    id: 'nitzschia',
    displayName: '음영 적응형 규조류',
    shortName: '규조류',
    scientificName: 'Nitzschia palea',
    color: 0x9a7047,
    accentColor: '#9a7047',
    description:
      '표면 생물막을 이루는 부착성 규조류입니다. 현실의 모든 계통이 같지는 않으며, 게임에서는 낮은 빛에 적응한 수조 계통으로 다룹니다.',
    realScale: '개별 세포는 수십 마이크로미터 규모여서 수조 화면에서는 따로 보이지 않습니다.',
    colonyAppearance: '육안으로는 황갈색 먼지나 아주 얇은 얼룩막처럼 보입니다.',
    niche: '그늘에서 붓뚜껑말보다 유리하며 밝은 곳에서 즉시 죽지는 않지만 경쟁 우위가 줄어듭니다.',
    lightCurve: [
      { light: 0, netRate: -0.0035 },
      { light: 6, netRate: -0.001 },
      { light: 12, netRate: 0.006 },
      { light: 25, netRate: 0.055 },
      { light: 38, netRate: 0.062 },
      { light: 55, netRate: 0.034 },
      { light: 72, netRate: 0.01 },
      { light: 86, netRate: -0.009 },
      { light: 100, netRate: -0.028 },
    ],
    temperatureCurve: [
      { temperature: 8, suitability: 0.18 },
      { temperature: 15, suitability: 0.65 },
      { temperature: 22, suitability: 0.92 },
      { temperature: 28, suitability: 1 },
      { temperature: 34, suitability: 0.58 },
      { temperature: 40, suitability: 0.06 },
    ],
    temperatureSummary: '폭넓은 수온에서 유지되지만 이 게임의 계통은 22~31°C에서 가장 잘 증식합니다.',
    growthForm: 'surface-film',
    respirationRateAtReference: 0.0035,
    respirationTheta: 1.06,
    dispersalRate: 0.21,
    maximumPositiveRate: 0.062,
  },
  vallisneria: {
    id: 'vallisneria',
    displayName: '나사말',
    shortName: '나사말',
    scientificName: 'Vallisneria spiralis',
    color: 0x6f8f51,
    accentColor: '#6f8f51',
    description: '바닥에 뿌리를 내리고 긴 잎을 수면 쪽으로 뻗는 침수성 수초입니다. 잎 전체가 빛을 받아 낮 동안 산소를 만들고 밤에는 호흡합니다.',
    realScale: '잎은 수십 cm까지 자랄 수 있으며, 이 화면에서는 한 포기의 잎 다발로 축약해 표시합니다.',
    colonyAppearance: '바닥의 생장점에서 가늘고 긴 녹색 잎이 물결치며 위로 뻗습니다.',
    niche: '바닥에만 심을 수 있지만 잎이 위쪽의 밝은 물층까지 닿아 낮 동안 안정적인 생산자 역할을 합니다.',
    lightCurve: [
      { light: 0, netRate: -0.002 },
      { light: 10, netRate: -0.001 },
      { light: 18, netRate: 0 },
      { light: 35, netRate: 0.018 },
      { light: 58, netRate: 0.032 },
      { light: 78, netRate: 0.036 },
      { light: 100, netRate: 0.031 },
    ],
    temperatureCurve: [
      { temperature: 8, suitability: 0.18 },
      { temperature: 15, suitability: 0.62 },
      { temperature: 21, suitability: 0.95 },
      { temperature: 25, suitability: 1 },
      { temperature: 30, suitability: 0.72 },
      { temperature: 36, suitability: 0.08 },
    ],
    temperatureSummary: '18~28°C에서 안정적이며, 따뜻할수록 밤 호흡도 함께 빨라집니다.',
    growthForm: 'rooted-macrophyte',
    respirationRateAtReference: 0.002,
    respirationTheta: 1.055,
    dispersalRate: 0,
    maximumPositiveRate: 0.036,
  },
};

export interface StructureDefinition {
  id: StructureDefinitionId;
  label: string;
  assetPath: string;
  width: number;
  height: number;
  material: string;
  collisionPolygon: Vec2[];
  ecologyPolygon: Vec2[];
  ecologyCellSize: number;
  density: number;
  friction: number;
}

export const STRUCTURES: Record<StructureDefinitionId, StructureDefinition> = {
  'flat-stone': {
    id: 'flat-stone',
    label: '넓적한 사암',
    assetPath: './assets/rocks/flat-stone-doodle.svg',
    width: 290,
    height: 85,
    material: '거친 돌 · 부착 가능',
    collisionPolygon: [
      { x: -140, y: 5 }, { x: -127, y: -19 }, { x: -91, y: -34 },
      { x: -28, y: -40 }, { x: 48, y: -38 }, { x: 105, y: -27 },
      { x: 137, y: -7 }, { x: 137, y: 13 }, { x: 113, y: 29 },
      { x: 67, y: 37 }, { x: -3, y: 39 }, { x: -77, y: 34 },
      { x: -124, y: 21 },
    ],
    ecologyPolygon: [
      { x: -130, y: 3 }, { x: -116, y: -16 }, { x: -84, y: -28 },
      { x: -25, y: -34 }, { x: 45, y: -32 }, { x: 98, y: -22 },
      { x: 126, y: -5 }, { x: 125, y: 9 }, { x: 103, y: 23 },
      { x: 62, y: 31 }, { x: -1, y: 33 }, { x: -71, y: 28 },
      { x: -114, y: 17 },
    ],
    ecologyCellSize: 9,
    density: 0.0045,
    friction: 0.88,
  },
  'round-stone': {
    id: 'round-stone',
    label: '둥근 강돌',
    assetPath: './assets/rocks/round-stone-doodle.svg',
    width: 180,
    height: 117,
    material: '매끈한 돌 · 부착 가능',
    collisionPolygon: [
      { x: -85, y: 13 }, { x: -80, y: -19 }, { x: -62, y: -43 },
      { x: -30, y: -56 }, { x: 10, y: -56 }, { x: 49, y: -43 },
      { x: 76, y: -19 }, { x: 86, y: 10 }, { x: 79, y: 34 },
      { x: 53, y: 50 }, { x: 14, y: 57 }, { x: -30, y: 53 },
      { x: -65, y: 40 },
    ],
    ecologyPolygon: [
      { x: -76, y: 10 }, { x: -71, y: -16 }, { x: -55, y: -36 },
      { x: -26, y: -48 }, { x: 10, y: -49 }, { x: 43, y: -37 },
      { x: 67, y: -16 }, { x: 76, y: 9 }, { x: 69, y: 28 },
      { x: 47, y: 42 }, { x: 12, y: 49 }, { x: -26, y: 46 },
      { x: -57, y: 34 },
    ],
    ecologyCellSize: 9,
    density: 0.0048,
    friction: 0.79,
  },
  'tall-stone': {
    id: 'tall-stone',
    label: '세로 판석',
    assetPath: './assets/rocks/tall-stone-doodle.svg',
    width: 118,
    height: 255,
    material: '층리 판석 · 부착 가능',
    collisionPolygon: [
      { x: -50, y: 116 }, { x: -55, y: 71 }, { x: -51, y: 14 },
      { x: -45, y: -50 }, { x: -37, y: -100 }, { x: -20, y: -121 },
      { x: 4, y: -126 }, { x: 25, y: -112 }, { x: 35, y: -70 },
      { x: 34, y: -15 }, { x: 47, y: 29 }, { x: 49, y: 83 },
      { x: 50, y: 119 },
    ],
    ecologyPolygon: [
      { x: -42, y: 108 }, { x: -46, y: 68 }, { x: -43, y: 12 },
      { x: -37, y: -47 }, { x: -30, y: -94 }, { x: -16, y: -113 },
      { x: 3, y: -118 }, { x: 18, y: -106 }, { x: 27, y: -67 },
      { x: 26, y: -13 }, { x: 38, y: 31 }, { x: 40, y: 82 },
      { x: 40, y: 109 },
    ],
    ecologyCellSize: 9,
    density: 0.0052,
    friction: 0.94,
  },
};

export interface ScenarioDefinition {
  id: ScenarioId;
  mode: 'challenge' | 'laboratory';
  title: string;
  subtitle: string;
  instruction: string;
  briefing: {
    question: string;
    goal: string;
    success: string;
    supplied: string;
  };
  timeLimitSeconds: number | null;
  /** Artificial overhead fixture. A zero value removes the fixture. */
  lightOutput: number;
  /** Broad diffuse daylight before the day/night multiplier. */
  naturalLightOutput: number;
  /**
   * Finite producer biomass supported by the simplified nutrient background
   * before the explicit water cycle is unlocked. Null keeps the earlier
   * producer-only missions unrestricted. Water-cycle scenarios use their real
   * local nutrient field instead.
   */
  backgroundProducerCapacity: number | null;
  dayNightCycle: DayNightCycleDefinition | null;
  dayNightCycleInitiallyEnabled: boolean;
  seedBudget: Record<SpeciesId, number | null>;
  animalBudget: Record<AnimalSpeciesId, number | null>;
  planktonBudget: Record<PlanktonKind, number | null>;
  structureBudget: Record<StructureDefinitionId, number | null>;
  requiredStructures: Partial<Record<StructureDefinitionId, number>>;
  allowedSpecies: SpeciesId[];
  requiredSeedSpecies: SpeciesId[];
  allowedAnimals: AnimalSpeciesId[];
  allowedPlankton: PlanktonKind[];
  allowedStructures: StructureDefinitionId[];
  waterCycle: {
    initial: WaterQualityValues;
    microbeBudget: Record<MicrobeGuildId, number | null>;
    allowedMicrobes: MicrobeGuildId[];
  } | null;
  target:
    | {
        type: 'coverage';
        ratio: number;
        holdSeconds: number;
        label: string;
      }
    | {
        type: 'habitat-coverage';
        speciesId: SpeciesId;
        ratio: number;
        minBiomass: number;
        minLight: number;
        maxLight: number;
        holdSeconds: number;
        label: string;
      }
    | {
        type: 'biomass';
        speciesId: SpeciesId;
        amount: number;
        holdSeconds: number;
        label: string;
      }
    | {
        type: 'adult-population';
        speciesId: AnimalSpeciesId;
        count: number;
        holdSeconds: number;
        label: string;
      }
    | {
      type: 'population-survival';
      speciesId: AnimalSpeciesId;
      count: number;
      holdSeconds: number;
      label: string;
    }
    | {
        type: 'born-stage';
        speciesId: AnimalSpeciesId;
        lifeStage: 'fry' | 'juvenile' | 'adult';
        count: number;
        holdSeconds: number;
        label: string;
      }
    | {
        type: 'plankton-generation';
        secondGenerationBirthBiomass: number;
        minimumBornLineageBiomass: number;
        holdSeconds: number;
        label: string;
      }
    | null;
  targetIncludesSubstrate: boolean;
}

export const SCENARIOS: Record<ScenarioId, ScenarioDefinition> = {
  'mission-1': {
    id: 'mission-1',
    mode: 'challenge',
    title: '첫 번째 실험 · 빛을 찾아서',
    subtitle: '붓뚜껑말 정착',
    instruction:
      '넓적한 사암 앞면에서 붓뚜껑말이 덮은 면적을 목표치까지 늘리세요.',
    briefing: {
      question: '붓뚜껑말은 수조의 어느 위치에서 가장 빠르게 정착할까요?',
      goal: '넓적한 사암 앞면의 32%를 붓뚜껑말 군락으로 덮고 3초간 유지하세요.',
      success: '목표 점유율을 3초 동안 유지하면 성공합니다.',
      supplied: '넓적한 사암 1개 · 붓뚜껑말 접종 1회 · 광량 탐침 · 수온계',
    },
    timeLimitSeconds: 140,
    lightOutput: 92,
    naturalLightOutput: 0,
    backgroundProducerCapacity: null,
    seedBudget: { oedogonium: 1, nitzschia: 0, vallisneria: 0 },
    animalBudget: { 'cherry-shrimp': 0, 'japanese-ricefish': 0, daphnia: 0 },
    planktonBudget: { phytoplankton: 0, daphnia: 0 },
    structureBudget: { 'flat-stone': 1, 'round-stone': 0, 'tall-stone': 0 },
    requiredStructures: { 'flat-stone': 1 },
    allowedSpecies: ['oedogonium'],
    requiredSeedSpecies: ['oedogonium'],
    allowedAnimals: [],
    allowedPlankton: [],
    allowedStructures: ['flat-stone'],
    waterCycle: null,
    dayNightCycle: null,
    dayNightCycleInitiallyEnabled: false,
    target: { type: 'coverage', ratio: 0.32, holdSeconds: 3, label: '붓뚜껑말 표면 점유' },
    targetIncludesSubstrate: false,
  },
  'mission-2': {
    id: 'mission-2',
    mode: 'challenge',
    title: '두 번째 실험 · 빛의 틈새',
    subtitle: '규조류 군락량',
    instruction:
      '강한 고정 조명 아래에서 규조류가 자란 양을 220까지 늘리세요.',
    briefing: {
      question: '밝은 수조에서 저광량을 선호하는 규조류의 서식처를 어떻게 만들 수 있을까요?',
      goal: '수조 전체에서 규조류가 자란 양을 220 이상으로 늘리고 4초간 유지하세요.',
      success: '위치나 구조물 개수와 관계없이 수조 안의 규조류를 모두 합산합니다.',
      supplied: '규조류 접종 4회 · 넓적한 사암 3개 · 둥근 강돌 4개 · 세로 판석 3개 · 광량 탐침 · 수온계',
    },
    timeLimitSeconds: 260,
    lightOutput: 104,
    naturalLightOutput: 0,
    backgroundProducerCapacity: null,
    seedBudget: { oedogonium: 0, nitzschia: 4, vallisneria: 0 },
    animalBudget: { 'cherry-shrimp': 0, 'japanese-ricefish': 0, daphnia: 0 },
    planktonBudget: { phytoplankton: 0, daphnia: 0 },
    structureBudget: { 'flat-stone': 3, 'round-stone': 4, 'tall-stone': 3 },
    requiredStructures: {},
    allowedSpecies: ['nitzschia'],
    requiredSeedSpecies: ['nitzschia'],
    allowedAnimals: [],
    allowedPlankton: [],
    allowedStructures: ['flat-stone', 'round-stone', 'tall-stone'],
    waterCycle: null,
    dayNightCycle: null,
    dayNightCycleInitiallyEnabled: false,
    target: {
      type: 'biomass',
      speciesId: 'nitzschia',
      amount: 220,
      holdSeconds: 4,
      label: '규조류가 자란 양',
    },
    targetIncludesSubstrate: true,
  },
  'mission-3': {
    id: 'mission-3',
    mode: 'challenge',
    title: '세 번째 실험 · 닿지 않는 빛',
    subtitle: '제한된 빛의 붓뚜껑말',
    instruction:
      '빛이 약한 수조에서 붓뚜껑말이 자란 양을 목표치까지 늘리세요.',
    briefing: {
      question: '바닥까지 빛이 약한 수조에서 붓뚜껑말을 어떻게 번식시킬 수 있을까요?',
      goal: '수조 전체에서 붓뚜껑말이 자란 양을 145 이상으로 늘리고 5초간 유지하세요.',
      success: '위치나 방법과 관계없이 수조 안의 붓뚜껑말을 모두 합산합니다.',
      supplied: '붓뚜껑말 접종 2회 · 세 종류의 구조물 무제한 · 광량 탐침 · 수온계',
    },
    timeLimitSeconds: 300,
    lightOutput: 52,
    naturalLightOutput: 0,
    backgroundProducerCapacity: null,
    seedBudget: { oedogonium: 2, nitzschia: 0, vallisneria: 0 },
    animalBudget: { 'cherry-shrimp': 0, 'japanese-ricefish': 0, daphnia: 0 },
    planktonBudget: { phytoplankton: 0, daphnia: 0 },
    structureBudget: { 'flat-stone': null, 'round-stone': null, 'tall-stone': null },
    requiredStructures: {},
    allowedSpecies: ['oedogonium'],
    requiredSeedSpecies: ['oedogonium'],
    allowedAnimals: [],
    allowedPlankton: [],
    allowedStructures: ['flat-stone', 'round-stone', 'tall-stone'],
    waterCycle: null,
    dayNightCycle: null,
    dayNightCycleInitiallyEnabled: false,
    target: {
      type: 'biomass',
      speciesId: 'oedogonium',
      amount: 145,
      holdSeconds: 5,
      label: '붓뚜껑말이 자란 양',
    },
    targetIncludesSubstrate: true,
  },
  'mission-4': {
    id: 'mission-4',
    mode: 'challenge',
    title: '네 번째 실험 · 첫 번째 소비자',
    subtitle: '체리새우의 생존',
    instruction: '체리새우 성체 4마리가 살아 있는 상태를 2분 동안 유지하세요.',
    briefing: {
      question: '직접 먹이를 주지 않고 체리새우가 살아갈 수 있는 수조를 만들 수 있을까요?',
      goal: '체리새우 성체 4마리를 연속 2분 동안 유지하세요.',
      success: '성체 수가 4마리 아래로 내려가면 유지 시간이 처음부터 다시 계산됩니다.',
      supplied: '체리새우 성체 4마리 · 두 조류 접종 각 4회 · 세 종류의 구조물 무제한 · 광량 탐침 · 수온계',
    },
    timeLimitSeconds: 300,
    lightOutput: 68,
    naturalLightOutput: 0,
    // The consumer tutorial uses a finite simplified nutrient reserve. This
    // limits total producer matter across every surface, so adding unlimited
    // stones cannot turn the tank into an unlimited food generator. Grazing
    // reopens the spent share, allowing producers to recover instead of being
    // frozen at a hard biomass cap.
    backgroundProducerCapacity: 60,
    seedBudget: { oedogonium: 4, nitzschia: 4, vallisneria: 0 },
    animalBudget: { 'cherry-shrimp': 4, 'japanese-ricefish': 0, daphnia: 0 },
    planktonBudget: { phytoplankton: 0, daphnia: 0 },
    structureBudget: { 'flat-stone': null, 'round-stone': null, 'tall-stone': null },
    requiredStructures: {},
    allowedSpecies: ['oedogonium', 'nitzschia'],
    requiredSeedSpecies: [],
    allowedAnimals: ['cherry-shrimp'],
    allowedPlankton: [],
    allowedStructures: ['flat-stone', 'round-stone', 'tall-stone'],
    waterCycle: null,
    dayNightCycle: null,
    dayNightCycleInitiallyEnabled: false,
    target: {
      type: 'adult-population',
      speciesId: 'cherry-shrimp',
      count: 4,
      holdSeconds: 120,
      label: '체리새우 성체',
    },
    targetIncludesSubstrate: true,
  },
  'mission-5': {
    id: 'mission-5',
    mode: 'challenge',
    title: '다섯 번째 실험 · 보이지 않는 순환',
    subtitle: '체리새우 군집의 장기 생존',
    instruction: '수조의 변화를 관찰하며 체리새우 군집이 끊기지 않도록 오래 유지하세요.',
    briefing: {
      question: '눈에 잘 보이지 않는 분해자들이 수조의 장기 생존을 어떻게 바꿀까요?',
      goal: '체리새우 군집이 한 번도 사라지지 않은 상태로 35분의 시뮬레이션 시간을 유지하세요.',
      success: '수질 수치나 접종 방법은 채점하지 않으며, 살아 있는 체리새우가 계속 존재하면 생존 시간이 누적됩니다.',
      supplied: '체리새우 성체 4마리 · 두 조류 접종 각 4회 · 세 종류의 구조물 무제한 · 두 균 필름 접종 · 수질 탐침',
    },
    timeLimitSeconds: 2_400,
    lightOutput: 88,
    naturalLightOutput: 0,
    backgroundProducerCapacity: null,
    seedBudget: { oedogonium: 4, nitzschia: 4, vallisneria: 0 },
    animalBudget: { 'cherry-shrimp': 4, 'japanese-ricefish': 0, daphnia: 0 },
    planktonBudget: { phytoplankton: 0, daphnia: 0 },
    structureBudget: { 'flat-stone': null, 'round-stone': null, 'tall-stone': null },
    requiredStructures: {},
    allowedSpecies: ['oedogonium', 'nitzschia'],
    requiredSeedSpecies: [],
    allowedAnimals: ['cherry-shrimp'],
    allowedPlankton: [],
    allowedStructures: ['flat-stone', 'round-stone', 'tall-stone'],
    waterCycle: {
      initial: {
        organicMatter: 1.5,
        toxicWaste: 0.8,
        // The starting reserve supports establishment, but cannot carry the
        // full 25-minute challenge without microbial recycling.
        nutrients: 11.8,
        oxygen: 76,
      },
      microbeBudget: { decomposer: null, nitrifier: null },
      allowedMicrobes: ['decomposer', 'nitrifier'],
    },
    dayNightCycle: null,
    dayNightCycleInitiallyEnabled: false,
    target: {
      type: 'population-survival',
      speciesId: 'cherry-shrimp',
      count: 1,
      holdSeconds: 2_100,
      label: '체리새우 군집 생존',
    },
    targetIncludesSubstrate: true,
  },
  'mission-6': {
    id: 'mission-6',
    mode: 'challenge',
    title: '여섯 번째 실험 · 밤을 건너는 수조',
    subtitle: '낮과 밤의 산소 순환',
    instruction: '전등 없이 자연광이 드나드는 수조에서 체리새우 군집이 세 번의 낮과 밤을 건너도록 유지하세요.',
    briefing: {
      question: '생산자도 함께 호흡하는 밤을 수조는 어떻게 견딜 수 있을까요?',
      goal: '체리새우 군집이 한 번도 사라지지 않은 상태로 낮·밤 주기 3회를 연속 유지하세요.',
      success: '특정 생물이나 배치 방법은 채점하지 않으며, 살아 있는 체리새우가 계속 존재하면 시간이 누적됩니다.',
      supplied: '수면 전체의 자연광 · 체리새우 성체 4마리 · 두 조류 접종 각 8회 · 나사말 3포기 · 구조물 무제한 · 두 균 필름 · 수질 탐침',
    },
    timeLimitSeconds: 1_380,
    // Mission 6 is a daylight tank. There is no hidden ceiling fixture;
    // the whole water surface receives broad sky light.
    lightOutput: 0,
    naturalLightOutput: 92,
    backgroundProducerCapacity: null,
    seedBudget: { oedogonium: 8, nitzschia: 8, vallisneria: 3 },
    animalBudget: { 'cherry-shrimp': 4, 'japanese-ricefish': 0, daphnia: 0 },
    planktonBudget: { phytoplankton: 0, daphnia: 0 },
    structureBudget: { 'flat-stone': null, 'round-stone': null, 'tall-stone': null },
    requiredStructures: {},
    allowedSpecies: ['oedogonium', 'nitzschia', 'vallisneria'],
    requiredSeedSpecies: [],
    allowedAnimals: ['cherry-shrimp'],
    allowedPlankton: [],
    allowedStructures: ['flat-stone', 'round-stone', 'tall-stone'],
    waterCycle: {
      initial: {
        organicMatter: 1.5,
        toxicWaste: 0.8,
        nutrients: 16,
        oxygen: 80,
      },
      microbeBudget: { decomposer: null, nitrifier: null },
      allowedMicrobes: ['decomposer', 'nitrifier'],
    },
    dayNightCycle: {
      dawnSeconds: 30,
      daySeconds: 240,
      duskSeconds: 30,
      nightSeconds: 60,
      nightLightMultiplier: 0.045,
      startingOffsetSeconds: 30,
    },
    dayNightCycleInitiallyEnabled: true,
    target: {
      type: 'population-survival',
      speciesId: 'cherry-shrimp',
      count: 1,
      holdSeconds: 1_080,
      label: '낮·밤 3주기 생존',
    },
    targetIncludesSubstrate: true,
  },
  'mission-7': {
    id: 'mission-7',
    mode: 'challenge',
    title: '일곱 번째 실험 · 초록 물결을 따라서',
    subtitle: '떠다니는 먹이망',
    instruction:
      '분해균과 질산화균을 직접 접종해 순환을 만들고, 물기둥의 생산자와 여과섭식자가 세대를 잇도록 하세요.',
    briefing: {
      question: '떠다니는 생산자와 소비자는 어떻게 서로의 수를 바꿀까요?',
      goal: '두 균 기능군을 접종하고, 수조에서 태어난 물벼룩이 성체가 되어 다시 새끼를 남기도록 하세요.',
      success:
        '특정 농도나 접종 위치는 채점하지 않습니다. 두 번째 세대가 태어난 뒤 물벼룩 군집이 낮과 밤을 한 번 더 건너면 성공합니다.',
      supplied:
        '식물플랑크톤 접종 3회 · 큰물벼룩 성체 3마리 · 체리새우 성체 4마리 · 나사말 3포기 · 분해균·질산화균 배양액과 구조물 무제한 · 수질 탐침',
    },
    // The second-generation biomass threshold is reached near the end of the
    // old 1,800-second limit under a healthy, density-regulated food web. Give
    // that lineage one additional day/night cycle to prove persistence rather
    // than accelerating reproduction only for this mission.
    timeLimitSeconds: 2_400,
    lightOutput: 0,
    naturalLightOutput: 105,
    backgroundProducerCapacity: null,
    seedBudget: { oedogonium: 4, nitzschia: 4, vallisneria: 3 },
    animalBudget: { 'cherry-shrimp': 4, 'japanese-ricefish': 0, daphnia: 0 },
    planktonBudget: { phytoplankton: 3, daphnia: 3 },
    structureBudget: { 'flat-stone': null, 'round-stone': null, 'tall-stone': null },
    requiredStructures: {},
    allowedSpecies: ['oedogonium', 'nitzschia', 'vallisneria'],
    requiredSeedSpecies: [],
    allowedAnimals: ['cherry-shrimp'],
    allowedPlankton: ['phytoplankton', 'daphnia'],
    allowedStructures: ['flat-stone', 'round-stone', 'tall-stone'],
    waterCycle: {
      initial: {
        organicMatter: 1.5,
        toxicWaste: 0.8,
        nutrients: 24,
        oxygen: 82,
      },
      microbeBudget: { decomposer: null, nitrifier: null },
      allowedMicrobes: ['decomposer', 'nitrifier'],
    },
    dayNightCycle: {
      dawnSeconds: 30,
      daySeconds: 240,
      duskSeconds: 30,
      nightSeconds: 60,
      nightLightMultiplier: 0.045,
      startingOffsetSeconds: 30,
    },
    dayNightCycleInitiallyEnabled: true,
    target: {
      type: 'plankton-generation',
      // These remain equivalent to roughly 8 second-generation and 20 born
      // animals after the physically smaller per-individual Daphnia budget.
      secondGenerationBirthBiomass:
        DAPHNIA_BODY_BUDGET.juvenileBirthBiomass * (25 / 3),
      minimumBornLineageBiomass:
        DAPHNIA_BODY_BUDGET.juvenileBirthBiomass * 20,
      holdSeconds: 360,
      label: '물벼룩 두 세대 연결',
    },
    targetIncludesSubstrate: true,
  },
  laboratory: {
    id: 'laboratory',
    mode: 'laboratory',
    title: '실험실',
    subtitle: '수중 생태계 자유 실험',
    instruction:
      '돌, 조류, 체리새우, 송사리, 균막과 수질 순환을 자유롭게 시험하세요. 실행한 뒤에는 일시정지해야 배치를 다시 바꿀 수 있습니다.',
    briefing: {
      question: '자유 실험실에서 어떤 수중 환경을 만들고 싶나요?',
      goal: '정해진 성공 조건 없이 구조, 빛, 온도, 군락과 개체군 변화를 관찰합니다.',
      success: '실험실에는 성공·실패 판정이 없습니다.',
      supplied: '모든 구조물 · 두 조류와 나사말 · 체리새우와 송사리 · 두 균 필름 · 수질 탐침 · 전등·자연광·낮밤 조절',
    },
    timeLimitSeconds: null,
    lightOutput: 90,
    naturalLightOutput: 0,
    backgroundProducerCapacity: null,
    seedBudget: { oedogonium: null, nitzschia: null, vallisneria: null },
    animalBudget: { 'cherry-shrimp': null, 'japanese-ricefish': null, daphnia: null },
    planktonBudget: { phytoplankton: null, daphnia: null },
    structureBudget: { 'flat-stone': null, 'round-stone': null, 'tall-stone': null },
    requiredStructures: {},
    allowedSpecies: ['oedogonium', 'nitzschia', 'vallisneria'],
    requiredSeedSpecies: [],
    allowedAnimals: ['cherry-shrimp', 'japanese-ricefish'],
    allowedPlankton: ['phytoplankton', 'daphnia'],
    allowedStructures: ['flat-stone', 'round-stone', 'tall-stone'],
    waterCycle: {
      initial: {
        organicMatter: 3,
        toxicWaste: 1.5,
        nutrients: 50,
        oxygen: 76,
      },
      microbeBudget: { decomposer: null, nitrifier: null },
      allowedMicrobes: ['decomposer', 'nitrifier'],
    },
    dayNightCycle: {
      dawnSeconds: 30,
      daySeconds: 240,
      duskSeconds: 30,
      nightSeconds: 60,
      nightLightMultiplier: 0.045,
      startingOffsetSeconds: 30,
    },
    dayNightCycleInitiallyEnabled: false,
    target: null,
    targetIncludesSubstrate: true,
  },
};
