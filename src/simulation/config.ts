import type {
  AnimalSex,
  AnimalSpeciesId,
  MicrobeGuildId,
  PlanktonKind,
  ScenarioId,
  SpeciesId,
  StructureDefinitionId,
  TankTypeId,
  Vec2,
  WaterQualityValues,
} from './types';
import type { TemperatureResponsePoint } from './temperatureResponse';
import type { DayNightCycleDefinition } from './dayNight';

// This is the lowest biomass that is actually drawn as a colony in the tank.
// Selection and removal use the same value so anything visible can be cleaned.
export const ALGAE_VISIBLE_BIOMASS = 0.001;
// A smaller, real propagule trace is rendered so the player can see the
// advancing footprint before it becomes an ecologically established patch.
// Mission coverage and rendering share this threshold.
export const ALGAE_RENDER_TRACE_BIOMASS = ALGAE_VISIBLE_BIOMASS * 0.05;
/** One surface-algae placement always supplies the same real biomass. */
export const SURFACE_ALGAE_INOCULUM_BIOMASS = 0.12;

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
      '큰물벼룩을 주 먹이로 포식하고, 몸집에 맞는 어린 체리새우를 보조 먹이로 삼습니다. 조류와 생물막은 직접 먹지 않습니다.',
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
 * Shared acceleration of measured ecological fluxes.
 *
 * The authored producer curves were converted at 0.03 real hour per game
 * second, then surface algae alone received a 5x process multiplier. Shrimp
 * ingestion and respiration remained on the unscaled clock, so a counted
 * juvenile needed a separate 32x feeding exception to keep up with the
 * already-accelerated producer world. Apply the same clock to producer and
 * shrimp matter fluxes instead. Life-stage durations can remain separately
 * compressed, but one species must not experience a different ecological
 * second from another.
 */
export const ECOLOGY_PROCESS_RATE_SCALE = 5;

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
  // Surface algae must remain responsive to the 0.5-3 concentration band
  // produced by ordinary closed-tank remineralisation. The former K=3.5 let
  // mineral nitrogen accumulate while the producer bed recovered only after
  // the adult shrimp cohort had disappeared. K=1 changes low-concentration
  // affinity, not the finite N/C ledger or the maximum light-limited rate.
  mineralNutrientHalfSaturation: 1,
  detritusSolubilizationRate: 0.009,
  closedGasExchangeRate: 0.018,
  // One shared oxygen-equivalent conversion is used in both directions:
  // fixing organic carbon produces it and mineralising that same carbon
  // consumes it. The absolute value sets the game's display-unit scale; it is
  // no longer an empirical margin that differs by process.
  oxygenPerOrganicCarbon: OXYGEN_PER_ORGANIC_CARBON,
  // The closed B ledger currently treats respired reserve as carbohydrate
  // equivalent (RQ = CO2/O2 = 1). Keeping the quotient explicit makes animal
  // DIC production derive from measured oxygen demand instead of silently
  // assuming that every removed B has already specified the CO2 flux.
  animalRespiratoryQuotient: 1,
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
    // Ingested matter is split once between retained food and faeces.
    // Respiration is paid continuously from retained body matter below; an
    // additional fixed "respired at the bite" share counted metabolism twice.
    assimilationFraction: 0.58,
    fecesFraction: 0.42,
    adultStructuralBiomass: 1,
    // Every hatchling object is one individual shrimp. Its complete initial
    // body matter enters this compartment once, and that same individual must
    // assimilate the difference on its way to the conserved maturation mass.
    juvenileBirthBiomass: 0.0175,
    // A newly stocked adult arrives with a modest gut/lipid buffer, not enough
    // stored matter to hide a producer collapse for most of a generation.
    suppliedReserveBiomass: 0.015,
    // Absolute grazing follows continuous body-size allometry instead of a
    // fixed juvenile multiplier and an abrupt jump on maturation.
    feedingMassExponent: 0.75,
    // Holling-II half-saturation of one contacted surface patch. This changes
    // how quickly intake falls as a film thins, but never makes a positive
    // biomass remainder inedible or protects it from exact depletion.
    grazingHalfSaturationBiomass: 0.07,
    // Adults cannot retain every bite indefinitely. Excess assimilation is
    // returned to detritus, so a well-fed male does not become a permanent
    // carbon/nitrogen sink and an eventual oversized pollution pulse.
    // Six percent of achieved adult structure is a short feeding buffer. This
    // value is the full 1-B adult reference; tank-born adults use the same 6%
    // ratio at their achieved size. The former combination of a size-scaled
    // condition display and this unscaled physical ceiling let a newly mature
    // 0.20-B shrimp hide 0.06 B above its displayed 100% condition and coast
    // through a producer decline for most of its remaining lifetime.
    adultReserveBiomass: 0.06,
  },
  ricefish: {
    // Captured animal matter is split once between retained matter and faeces.
    // Oxygen-consuming respiration is paid continuously from retained
    // reserve/body matter; charging a fixed share again at capture would count
    // the same maintenance twice.
    assimilationFraction: 0.60,
    fecesFraction: 0.40,
    // Rendered length is intentionally independent from these compressed
    // matter units. Keeping the complete fish budget commensurate with the
    // visible Daphnia cohort lets two supplied predators coexist with a
    // six-founder culture after that culture has established.
    adultStructuralBiomass: 0.12,
    // Sexual maturity precedes maximum adult somatic mass. These compressed
    // early-stage compartments remain fully food-funded, but do not require
    // the whole established Daphnia cohort before first maturation.
    // Sexual maturity is earlier than maximum adult size. At 0.025 one
    // sibling from the conserved two-egg cohort commonly died of old age just
    // short of maturity after both had eaten; 0.020 keeps maturation fully
    // food-funded while allowing the mixed-sex pair to reach adulthood.
    juvenileStructuralBiomass: 0.020,
    // One rendered egg represents several real medaka eggs, but the complete
    // two-token clutch must still be a plausible fraction of a newly mature
    // female. The 10 px fry versus 27 px juvenile length ratio implies about
    // 0.001 of matter at equal density ((10 / 27)^3 * 0.020). Funding each egg
    // with 0.00125 leaves that amount after nominal incubation, so the pair
    // costs 12.5% of the maturity compartment instead of the former 100%.
    fryBirthBiomass: 0.001,
    eggBiomass: 0.00125,
    // The former compartments represented several hours of compressed
    // fasting and let a predator outlive its prey recovery window by multiple
    // complete simulated lifetimes. Retained meal matter is still conserved,
    // but these capacities now represent a short feeding buffer comparable to
    // the compressed starvation windows of Daphnia and shrimp.
    suppliedReserveBiomass: 0.008,
    adultReserveBiomass: 0.012,
    juvenileReserveBiomass: 0.0042,
    fryReserveBiomass: 0.00125,
  },
  daphnia: {
    // Phytoplankton and bacterioplankton have different assimilation
    // efficiencies, so the actual unassimilated remainder is egested in the
    // feeding ledger. There is no additional bite-time respiration; ongoing
    // allometric maintenance supplies the oxygen demand.
    assimilationFraction: 0.55,
    fecesFraction: 0.45,
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
    // Current assimilated phytoplankton surplus already caps every transfer
    // to eggs below. Keep this ambient-quality signal as a gradual modifier,
    // not a second high-ration cliff: in a mature closed tank, a moderate
    // suspended-food concentration must still permit slow replacement.
    minimumFoodQualityForReproduction: 0.35,
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
    highFoodBroodResponseThreshold: 0.70,
    // Egg provisioning is already capped by this tick's real phytoplankton
    // assimilation surplus, maternal reserve and protected soma. Applying an
    // additional ambient-concentration multiplier counted the same food
    // limitation twice and stopped replacement while mothers were still
    // earning a positive algal surplus. Zero explicitly disables only that
    // duplicate modifier; it does not bypass any conserved-matter cap.
    reproductionFoodResponseExponent: 0,
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
    // Fish kairomones are already represented by the bounded local predator
    // cue field used for escape. D. magna exposed to fish cues can mature
    // earlier at a smaller size and divert a larger share of net production
    // toward reproduction. These limits change allocation and timing only:
    // every offspring still has to be funded by actually assimilated food.
    predatorCueLifeHistorySaturation: 0.06,
    predatorCueMaturationInstarReduction: 1,
    // Four percent is the largest reduction that still reaches the physical
    // adult survival floor. Earlier values let a cue-exposed juvenile acquire
    // the adult label with less structure than an adult can maintain.
    predatorCueMaturationStructureReductionFraction: 0.04,
    // A local fish cue makes an otherwise viable mother commit reserve above
    // her protected floor to eggs sooner. This changes allocation only: the
    // same phytoplankton-funded reserve and neonate matter costs still apply.
    predatorCueReproductionStartEnergy: 0.26,
    // Actual assimilated phytoplankton surplus already caps every transfer to
    // eggs. Under a fish cue, soften the second ambient-concentration gate so
    // moderate but profitable patches do not force allocation to exactly zero.
    predatorCueMinimumFoodQualityForReproduction: 0.20,
    predatorCueHighFoodBroodResponseThreshold: 0.55,
    predatorCueAdultSomaticGrowthAllocationFraction: 0.08,
    predatorCueReproductionAllocationMultiplier: 1.40,
    // A strongly exposed, well-fed mother may release two rendered neonates
    // instead of one, but only after both complete offspring masses have been
    // accumulated in her conserved reproductive compartment.
    predatorCueMaximumBroodSize: 2,
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
export interface DaphniaSuspendedFoodResponse {
  phytoplanktonPotential: number;
  bacterioplanktonPotential: number;
  combinedResponse: number;
  bacteriaShare: number;
}

/**
 * Optional ambient-food modifier for egg provisioning.
 *
 * An exponent of zero deliberately disables this second concentration gate.
 * Egg matter is still limited in `SimulationWorld` by the mother's condition,
 * protected reserve and the phytoplankton biomass actually assimilated during
 * the current step. Keeping the zero case explicit avoids relying on
 * `Math.pow(0, 0)` and makes it clear that no food or matter is created here.
 */
export const daphniaReproductionFoodFactor = (
  phytoplanktonResponse: number,
  minimumResponse: number,
  highResponse: number,
  responseExponent: number,
): number => {
  if (responseExponent <= 0) return 1;
  const normalized = Math.min(
    1,
    Math.max(
      0,
      (phytoplanktonResponse - minimumResponse) /
        Math.max(1e-6, highResponse - minimumResponse),
    ),
  );
  return Math.pow(normalized, responseExponent);
};

export const daphniaSuspendedFoodResponse = (
  phytoplankton: number,
  bacterioplankton: number,
  reuse?: DaphniaSuspendedFoodResponse,
): DaphniaSuspendedFoodResponse => {
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
  const response = reuse ?? {
    phytoplanktonPotential: 0,
    bacterioplanktonPotential: 0,
    combinedResponse: 0,
    bacteriaShare: 0,
  };
  response.phytoplanktonPotential = phytoplanktonPotential;
  response.bacterioplanktonPotential = bacterioplanktonPotential;
  response.combinedResponse = Math.min(1, totalPotential);
  response.bacteriaShare = totalPotential <= 0
    ? 0
    : bacterioplanktonPotential / totalPotential;
  return response;
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
    // Heterotrophic biofilm remains the fast microbial guild, but its former
    // 4.4% net growth per game second represented roughly 35 doublings/day on
    // the shared ecology clock. This rate corresponds to a fast, substrate-
    // rich heterotrophic community without making an organic pulse fill every
    // surface almost instantly.
    maximumUptake: 0.02,
    biomassYield: 0.42,
    maintenanceDecayRate: 0.0002,
    starvationDecayRate: 0.0016,
    surfaceSpreadRate: 0.0035,
    waterborneExportRate: 0.00012,
    suspendedDecayRate: 0.0035,
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
    maximumUptake: 0.002,
    // Aquarium nitrifiers have low biomass yield: most ammonia oxidation
    // supports maintenance rather than producing an equal-sized film pulse.
    // Keeping yield below the heterotroph's also preserves their much slower
    // establishment despite a still-useful ammonia processing capacity.
    biomassYield: 0.035,
    maintenanceDecayRate: 0.00006,
    // Nitrifiers are slow growers but a mature attached community also
    // persists through low loading. With 0.0005, the configured Monod curve
    // still had negative net growth around 0.5-0.8 ammonium and lost about
    // 98% of the inoculum before animal waste arrived. This value makes the
    // documented crossover real while all removal still pays the full oxygen
    // and stoichiometric material cost in BiogeochemistryLedger.
    starvationDecayRate: 0.0002,
    surfaceSpreadRate: 0.00045,
    // At 0.00004, even a lossless 0.4-B source could export at most 0.0095 B
    // over 600 simulated seconds, making the intended >0.01-B colonisation of
    // disconnected wetted surfaces mathematically impossible before decay or
    // failed retention were considered. Keep nitrifier export slower than the
    // decomposer's 0.00012 while allowing a viable minority to disperse.
    waterborneExportRate: 0.00007,
    suspendedDecayRate: 0.0007,
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
  // This is one birth-to-death deadline, not a fresh adult-stage allowance.
  // The former model added another 20-40 minutes when a food-limited juvenile
  // finally matured, so an animal that should have lived about 40 gameplay
  // minutes could suddenly display 70-90 minutes. Food changes growth and
  // condition; merely reaching maturity later must never manufacture lifespan.
  // Keep the same 2,400-second mean while representing real individual
  // survival variation. The former narrow 2,100-2,700 window made whole
  // hatch cohorts senesce together and left repeated gaps with almost no
  // adults even when the displayed population was above twenty.
  minimumLifespanSeconds: 1_800,
  maximumLifespanSeconds: 3_000,
  // Inventory shrimp arrive as young adults. Their supplied-species sequence
  // seeds variation, so unrelated Daphnia births cannot change these traits.
  suppliedAdultMinimumAgeSeconds: 180,
  suppliedAdultMaximumAgeSeconds: 300,
  // One measured allometric maintenance curve spans juveniles and adults.
  // The reference value is the ordinary grazing metabolism of a supplied
  // 1.08-B adult on the shared 0.03-real-hour/game-second ecology clock.
  adultRoutineMaintenanceBiomassPerSecond:
    0.000060 * ECOLOGY_PROCESS_RATE_SCALE,
  metabolicMassExponent: 0.898,
  restingActivityMultiplier: 0.75,
  grazingActivityMultiplier: 1,
  // A weak shrimp still makes slow food-search movements. Charging that state
  // at the resting multiplier made severe nutritional depletion reduce its
  // matter loss exactly when the shortage should become visible. Keep the
  // added search cost reflects that weak movement is still active foraging.
  starvingActivityMultiplier: 1.3,
  travelingActivityMultiplier: 1.5,
  // Adult N. davidi consumed about 51% of its dry body mass per real day in a
  // leaf-litter/biofilm feeding trial. On the shared ecology clock that is
  // about 0.00069 B/s for a 1.08-B adult. The type-II response realizes that
  // rate on an ordinary 0.2-0.4-B patch; this higher asymptote is reached only
  // on a dense surface and still falls continuously toward zero with food.
  maximumBiteBiomassPerSecond:
    0.00155 * ECOLOGY_PROCESS_RATE_SCALE,
  // A rendered shrimp is one tracked shrimp at every life stage. Juvenile
  // feeding therefore stays on the same continuous body-mass allometry as an
  // adult. Developmental time compression must not make one counted juvenile
  // remove several adults' worth of producer biomass.
  oxygenStressStart: 30,
  oxygenMaximumDamagePerSecond: 0.025,
  toxicWasteStressStart: 6,
  toxicWasteFullStress: 24,
  toxicMaximumDamagePerSecond: 0.032,
  healthyWaterRecoveryPerSecond: 0.004,
  // Reproduction reads the conserved reserve compartment directly. The UI
  // energy score also contains a contribution from intact structure, which
  // made an almost empty female look fit enough to keep maturing ovaries after
  // producer biomass had already turned downward. These fractions are of the
  // individual's size-scaled reserve capacity, never of population or tank
  // food. Ovarian development below has the stricter feeding gate. Once a
  // clutch is already fully provisioned, mating itself remains possible at a
  // lower reserve; otherwise maternal matter already committed to eggs would
  // be stranded merely because the female paid that cost. Male courtship has
  // the same low somatic gate because it allocates no egg matter.
  reproductionReserveFraction: 0.18,
  maleReproductionReserveFraction: 0.15,
  // Supplied young-adult females can arrive part-way through an ovarian cycle.
  // Their conserved egg matter is derived from that individual progress in
  // `createAdultAnimalState`; there is no separate fixed preload shared by
  // every female.
  // Maturity is still paid by conserved somatic growth. A well-fed juvenile
  // reaches it in about 12-20 gameplay minutes; sparse food postpones it.
  // This leaves a real adult feeding and reproduction phase without resetting
  // or extending the birth-to-death deadline.
  // Individual targets distribute a cohort without granting growth from age.
  maturationMinimumSeconds: 720,
  maturationMaximumSeconds: 1_200,
  // Sexual maturity precedes maximum adult size. Requiring 0.30 of the
  // supplied adult structure made a food-rich tank-born cohort spend
  // 1,900-2,200 seconds as juveniles even though its individual developmental
  // target was 720-1,200 seconds. Females then reached adulthood only a few
  // hundred seconds before their unchanged birth-to-death deadline and could
  // not complete one food-funded brood. At 0.20 B they still have to acquire
  // and conserve more than ten times their 0.0175-B birth structure, while
  // ordinary post-maturity feeding continues somatic growth toward 1.0 B.
  maturationStructuralBiomass: 0.20,
  // Shrimp keep adding conserved somatic matter after sexual maturity. This
  // lets food availability affect adult size and therefore fecundity instead
  // of freezing every tank-born female at the minimum mature size.
  adultSomaticGrowthPerSecond: 0.00035,
  // Ovarian readiness replaces the fixed post-brood countdown. It advances
  // continuously from temperature and individual condition while egg matter
  // is funded independently from conserved somatic reserve.
  // Females can spawn repeatedly, and ovarian rematuration may overlap the
  // carried-egg interval. On the compressed birth-to-death clock this range
  // permits several genuinely food-funded cycles without guaranteeing one:
  // realised intake and condition still slow or stop progress continuously.
  ovarianCycleMinimumSeconds: 180,
  ovarianCycleMaximumSeconds: 320,
  ovarianProgressReserveFloor: 0.40,
  // The nominal ovarian-cycle range is the realised rate for a healthy,
  // feeding adult. A newly mature tank-born female has a smaller structural
  // target than an inventory adult, and conserved egg allocation continually
  // draws down her short-term store. Requiring 0.50 reserve condition made
  // ovaries advance for 3,000+ seconds even while she was feeding and had
  // fully funded eggs. The reproductive matter gate remains separate below;
  // this condition range therefore controls development speed without
  // creating a clutch.
  // Full ovarian development belongs to a genuinely replenished somatic
  // reserve. Between 40% and 80% it slows continuously, so local grazing
  // competition reduces births before a producer crash; below the floor it
  // pauses without consulting remote food or the current population count.
  ovarianFullSpeedReserveFraction: 0.80,
  // Somatic reserve and egg matter recover concurrently. This is only the
  // physiological ceiling. The required recent ration is calculated from the
  // individual's allometric maintenance plus this real egg-matter transfer,
  // divided by assimilation over the eight-second intake window. Condition
  // and a lower realised ration reduce the rate continuously, and transferred
  // matter still comes from conserved somatic reserve above the protected
  // survival floor.
  ovarianAllocationPerSecond: 0.00016,
  suppliedOvarianProgressMinimum: 0.02,
  suppliedOvarianProgressMaximum: 0.20,
  newAdultOvarianProgressMaximum: 0.25,
  gestationMinimumSeconds: 68,
  gestationMaximumSeconds: 82,
  // One modelled brood hatches together. Every resulting object is one actual
  // tracked offspring and every body is paid from conserved maternal matter.
  // Their sexes are independent draws; a rare single-sex lineage is allowed
  // to fail rather than being repaired from the current population. Larger
  // females can fund a third offspring, retaining a size-fecundity relation
  // without a population-count rule.
  minimumClutchSize: 2,
  maximumClutchSize: 3,
} as const;

/**
 * One coherent ricefish rule set is shared by challenge and laboratory
 * scenarios. Durations are gameplay-compressed, while the ordering of egg,
 * fry, juvenile and adult stages and the relative temperature/oxygen effects
 * follow the medaka literature recorded in the mission 8 design note.
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
  // Medaka finish absorbing the visible yolk over roughly the first three
  // post-hatch days, but begin taking exogenous food during that overlap. The
  // compressed fry stage represents that mixed endogenous/exogenous interval.
  yolkAbsorptionSeconds: 150,
  exogenousFeedingOnsetFraction: 0.30,
  adultLength: 44,
  juvenileLength: 27,
  fryLength: 10,
  // Calibrated as one complete adult energy budget, rather than choosing
  // maintenance and locomotion independently. In the immortal,
  // non-reproductive one-fish fixture an adult assimilated 0.141 matter from
  // 71 Daphnia over 7,200 seconds, while the former rates respired 0.161 and
  // forced it to catabolise 0.012 of its own structure despite 400+ available
  // prey. These rates target roughly 0.12 respiration over the same realised
  // behaviour mix: enough for an unfed fish to decline, while an ordinarily
  // feeding adult has a small reserve instead of requiring excess predation.
  adultBaseMetabolismPerSecond: 0.0000115,
  // Keep the same 14.25% nominal incubation loss after scaling an egg from
  // 0.010 to 0.00125 matter units (0.000001875 * 95 seconds).
  eggBaseMetabolismPerSecond: 0.000001875,
  // Structural biomass is the mass proxy. The same allometric equation applies
  // before and after maturity, so smaller fish retain their naturally higher
  // mass-specific demand instead of receiving a stage-name discount.
  metabolicMassExponent: 0.75,
  restingActivityCostPerSecond: 0.0000026,
  swimmingActivityCostPerSecond: 0.0000050,
  huntingActivityCostPerSecond: 0.0000110,
  // Sustained pursuit adds real locomotor respiration instead of merely
  // changing the animation speed. A finite effort budget then makes a fish
  // abandon an unprofitable long chase and recover at cruise speed.
  longPursuitActivityCostPerSecond: 0.0000049,
  maximumContinuousPursuitEffort: 8,
  pursuitEffortRecoveryPerSecond: 2.4,
  pursuitRecoverySeconds: 2.2,
  maximumSomaticGrowthPerSecond: 0.00035,
  oxygenStressStart: 36,
  oxygenSevereStress: 18,
  oxygenMaximumDamagePerSecond: 0.022,
  toxicWasteStressStart: 5,
  toxicWasteFullStress: 20,
  toxicMaximumDamagePerSecond: 0.028,
  healthyWaterRecoveryPerSecond: 0.0035,
  // Starvation is a condition process, not an extra omniscient population
  // rule. A fish first spends its own reserve, then loses health according to
  // its feeding gap and loss from its own previously achieved body mass.
  starvationReserveStressStartFraction: 0.18,
  // Normal medaka feeding is discontinuous and the authored gut signal takes
  // roughly 1-3 minutes to clear after a suitably sized zooplankton meal.
  // Health damage must not begin before that ordinary handling interval has
  // elapsed; a genuinely unfed fish has already exhausted this window by the
  // time its short-term reserve runs out.
  starvationFeedingGapGraceSeconds: 90,
  starvationFeedingGapFullSeconds: 240,
  starvationStructuralStressStartFraction: 0.82,
  starvationMinimumStructuralFraction: 0.55,
  starvationMaximumDamagePerSecond: 0.012,
  // Gut fullness normally imposes a handling interval, but a severely
  // depleted growing fish must resume feeding before that non-material signal
  // can strand it beside abundant edible prey.
  starvationEmergencyForageEnergy: 0.20,
  // Begin searching before the reserve crosses the starvation-stress boundary.
  // The former 0.30 threshold made a fish remain in ordinary exploration
  // until only about 3% of its reserve remained, even with visible prey all
  // around it. Hysteresis still stops repeated immediate reacquisition.
  forageStartEnergy: 0.42,
  forageStopEnergy: 0.56,
  // Fry and juveniles keep a real short-term reserve before routing surplus
  // matter into growth. Without this floor their reserve was permanently
  // zero, so even a well-fed sub-adult could never satisfy the foraging
  // hysteresis and kept hunting until the prey guild disappeared.
  subadultGrowthReserveFraction: 0.24,
  // Adults route repeated feeding surplus into gonads after maintenance.
  // Requiring a nearly full reserve made the small, spatially foraging
  // population depend on one unusually lucky feeding streak and prevented
  // otherwise healthy daughters from ever producing the next generation.
  // The retained floor still covers ordinary fasting between local encounters.
  // Energy is a composite UI condition score whose denominator changes at
  // maturation. Reproductive matter alone is not enough: an adult female must
  // also have restored her own short-term condition before spawning. Keep this
  // above the 0.42 forage-start threshold so a food-stressed female feeds
  // instead of turning an already accumulated clutch into a doomed cohort.
  // The supplied mission adult starts at 0.48, so this does not require a fish
  // to reach maximum size or an unusually full reserve before first spawning.
  reproductionEnergy: 0.48,
  // Maximum-size-adult fasting buffer. The world scales this by the same
  // structural-mass allometry as maintenance for smaller newly mature fish.
  // About 130 seconds of resting maintenance is retained at every body size.
  // The former 0.008 buffer protected roughly six minutes of maintenance:
  // repeated small prey meals refilled that compartment but could not finish
  // even one four-token clutch before an otherwise feeding adult died of old
  // age. This lower floor changes allocation only. It neither creates matter
  // nor shortens the gut handling interval, so predators do not receive extra
  // prey encounters solely because their lineage is small.
  reproductionReserveFloor: 0.0021,
  // Optional maximum-adult somatic growth keeps a longer reserve buffer than
  // ovarian allocation. At maximum adult size, 0.0048 is 40% of reserve
  // capacity; together with achieved structure this leaves condition at
  // 0.568, just above the 0.56 foraging-stop threshold. Unlike the ovarian
  // floor, this value encodes a condition threshold rather than a fixed number
  // of resting seconds, so it remains unchanged when metabolism is calibrated.
  adultSomaticGrowthReserveFloor: 0.0048,
  // Sexual maturity precedes maximum size, but post-maturity somatic growth
  // decelerates continuously. A squared remaining-growth fraction gives
  // relative rate ceilings of 1.00, 0.64, 0.25 and 0.04 at 0%, 20%, 50% and
  // 80% progress through the adult size interval. This is a rate ceiling,
  // not a loss of matter or a fixed fraction removed from each meal.
  adultSomaticGrowthTaperExponent: 2,
  // Fraction of eligible adult-female reserve allocated over one simulated
  // second. The world converts this to a delta-time-equivalent fraction.
  reproductionAllocationFraction: 0.20,
  // A male below the ordinary forage threshold searches for food instead of
  // spending its remaining condition on courtship. Female readiness uses the
  // stricter reproductionEnergy threshold above.
  matingEnergy: 0.42,
  eggClutchMinimum: 4,
  // A rendered egg/fry represents part of a much larger real clutch. Four
  // food-funded cohort tokens compress the real daily 8–48-egg output while
  // retaining one demographic spare for each sex. Three tokens still made
  // one ordinary juvenile failure remove the only member of one sex and end
  // the lineage in a prey-rich tank.
  eggClutchMaximum: 4,
  // Medaka can spawn on successive days in suitable light and food. Gameplay
  // compresses one real clutch into four visible cohort tokens, but a healthy
  // female must still be able to produce several cohorts in one adult life.
  // Egg matter, body reserve and mate/attachment access remain the ecological
  // gates; this interval is only the minimum ovarian cadence.
  postSpawnCooldownSeconds: 600,
  // Males can follow a receptive female before she accepts a particular
  // suitor. Actual wrapping/spawning requires the smaller contact radius.
  matingEncounterRadius: 140,
  matingContactRadius: 58,
  // Simulation time is compressed, but the sequence remains long enough to
  // show approach, positioning, quick-circle and close contact.
  matingSeconds: 6,
  animalPreyDetectionRadius: 360,
  // Larval medaka still hunt moving prey visually, but a strictly
  // length-proportional radius left each rendered fry inspecting only about
  // 5% of an adult's search area. That mapping is too sparse for the
  // compressed Daphnia cohort used by this simulation. Keep a smaller larval
  // visual patch while giving it enough independent prey encounters to bridge
  // the food-funded growth stage. Angle, distance falloff, light, occlusion
  // and canopy shelter still decide whether a candidate is actually seen.
  fryPreyDetectionRadiusFraction: 0.38,
  // These speeds also define how quickly a fish can leave one searched
  // neighbourhood and obtain an independent view of another. Keeping that
  // geometry in the ecology rules prevents repeated dice rolls over the same
  // nearly stationary rare prey every rendered second.
  cruiseSpeed: 54,
  preyPursuitSpeed: 126,
  // Medaka keep prey in a lateral monocular field and finish the approach with
  // a short side-swing strike. This is a momentary attempted-capture velocity,
  // not a second sustained pursuit speed.
  strikeBurstSpeed: 164,
  strikeDistance: 32,
  // This is the brief recovery between two visible lunges, not a new visual
  // search. Multi-second lockout made prey bounce around the mouth while an
  // otherwise hungry fish was artificially unable to bite.
  strikeCooldownSeconds: 0.55,
  // `recentIntake` is only a non-material handling signal. One rendered prey
  // may represent much more conserved biomass than one literal stomachful, so
  // every capture is capped at this capacity instead of overfilling the signal
  // by 10-60 times. Real reserve/energy still determines physiological hunger.
  gutCapacityStructuralFraction: 0.06,
  gutEvacuationSeconds: 120,
  // Fry and juveniles feed in repeated small bouts during the yolk overlap and
  // have higher mass-specific turnover than adults. One rendered prey is a
  // compressed feeding encounter, so its non-material handling signal clears
  // quickly while the captured matter itself remains fully conserved.
  subadultGutEvacuationSeconds: 12,
  foragingResumeAppetite: 0.62,
  // A fry can take small Daphnia regardless of whether an early molt has
  // already changed the prey's stage label. The limit stays continuous in
  // conserved structure and excludes genuinely larger adults.
  fryMaximumDaphniaStructuralBiomass:
    DAPHNIA_BODY_BUDGET.adultStructuralBiomass *
    DAPHNIA_BODY_BUDGET.maturationStructuralFraction * 1.15,
  juvenileShrimpPreference: 1,
  adultShrimpPreference: 0,
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
  temperatureStressTurnoverRate: number;
  naturalTurnoverPerSecond: number;
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
      { light: 0, netRate: -0.0000302 },
      { light: 15, netRate: -0.0000151 },
      { light: 28, netRate: 0 },
      { light: 45, netRate: 0.0003172 },
      { light: 68, netRate: 0.0005136 },
      { light: 82, netRate: 0.0003474 },
      { light: 94, netRate: 0.0000453 },
      { light: 100, netRate: -0.0001813 },
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
    respirationRateAtReference: 0.0000302,
    respirationTheta: 1.065,
    temperatureStressTurnoverRate: 0.00012,
    naturalTurnoverPerSecond: 0.0000136,
    dispersalRate: 0.00018,
    maximumPositiveRate: 0.0005136,
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
      { light: 0, netRate: -0.0000436 },
      { light: 6, netRate: -0.0000125 },
      { light: 12, netRate: 0.0000748 },
      { light: 25, netRate: 0.0006852 },
      { light: 38, netRate: 0.0007724 },
      { light: 55, netRate: 0.0004236 },
      { light: 72, netRate: 0.0001246 },
      { light: 86, netRate: -0.0001121 },
      { light: 100, netRate: -0.0003488 },
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
    respirationRateAtReference: 0.0000436,
    respirationTheta: 1.06,
    temperatureStressTurnoverRate: 0.00012,
    naturalTurnoverPerSecond: 0.0000224,
    dispersalRate: 0.00024,
    maximumPositiveRate: 0.0007724,
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
      // Vallisneria is a low-light-adapted submerged macrophyte. Keep its
      // compensation point below the attached algae niches, then saturate
      // rather than continuing to accelerate in the brightest water.
      { light: 6, netRate: -0.0008 },
      { light: 10, netRate: 0 },
      { light: 24, netRate: 0.012 },
      { light: 42, netRate: 0.023 },
      { light: 58, netRate: 0.03 },
      { light: 78, netRate: 0.032 },
      { light: 100, netRate: 0.03 },
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
    temperatureStressTurnoverRate: 0.012,
    naturalTurnoverPerSecond: 0.00018,
    dispersalRate: 0,
    maximumPositiveRate: 0.032,
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
  'small-flat-stone': {
    id: 'small-flat-stone',
    label: '작은 납작돌',
    assetPath: './assets/rocks/small-flat-stone-doodle.svg',
    width: 104,
    height: 47,
    material: '작은 거친 돌 · 부착 가능',
    collisionPolygon: [
      { x: -49, y: 6 }, { x: -43, y: -8 }, { x: -27, y: -18 },
      { x: -4, y: -21 }, { x: 25, y: -17 }, { x: 45, y: -7 },
      { x: 50, y: 7 }, { x: 39, y: 17 }, { x: 12, y: 22 },
      { x: -20, y: 21 }, { x: -43, y: 15 },
    ],
    ecologyPolygon: [
      { x: -43, y: 4 }, { x: -37, y: -6 }, { x: -24, y: -14 },
      { x: -3, y: -17 }, { x: 22, y: -13 }, { x: 38, y: -5 },
      { x: 43, y: 5 }, { x: 34, y: 13 }, { x: 10, y: 18 },
      { x: -18, y: 17 }, { x: -37, y: 12 },
    ],
    ecologyCellSize: 8,
    density: 0.0046,
    friction: 0.9,
  },
  'small-wedge-stone': {
    id: 'small-wedge-stone',
    label: '작은 쐐기돌',
    assetPath: './assets/rocks/small-wedge-stone-doodle.svg',
    width: 112,
    height: 64,
    material: '작은 층리 돌 · 부착 가능',
    collisionPolygon: [
      { x: -52, y: 24 }, { x: -48, y: 5 }, { x: -33, y: -15 },
      { x: -7, y: -29 }, { x: 18, y: -23 }, { x: 42, y: -8 },
      { x: 53, y: 11 }, { x: 49, y: 25 }, { x: 15, y: 30 },
      { x: -23, y: 30 },
    ],
    ecologyPolygon: [
      { x: -45, y: 19 }, { x: -41, y: 5 }, { x: -28, y: -11 },
      { x: -6, y: -23 }, { x: 16, y: -18 }, { x: 36, y: -6 },
      { x: 45, y: 10 }, { x: 41, y: 20 }, { x: 13, y: 25 },
      { x: -20, y: 25 },
    ],
    ecologyCellSize: 8,
    density: 0.0049,
    friction: 0.93,
  },
};

export interface ScenarioDefinition {
  id: ScenarioId;
  mode: 'challenge' | 'laboratory';
  /** Missions may pin a tank; the laboratory remains user-selectable. */
  tankType?: TankTypeId;
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
  /** Optional sex-specific stocking limits. Their sum must fit animalBudget. */
  animalSexBudget?: Partial<
    Record<AnimalSpeciesId, Partial<Record<AnimalSex, number | null>>>
  >;
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
    /**
     * Multiplies the tank's finite starting carbon and nitrogen reservoirs
     * without changing oxygen, organism physiology, or biological rates.
     */
    initialMaterialScale?: number;
    microbeBudget: Record<MicrobeGuildId, number | null>;
    allowedMicrobes: MicrobeGuildId[];
  } | null;
  target:
    | {
        type: 'coverage';
        speciesId: SpeciesId;
        minBiomass: number;
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
        type: 'animal-generation';
        speciesId: AnimalSpeciesId;
        /** Supplied founders are generation 0, so 2 means their grandchildren. */
        minimumGeneration: number;
        generationCount: number;
        minimumPopulation: number;
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
    timeLimitSeconds: 360,
    lightOutput: 92,
    naturalLightOutput: 0,
    backgroundProducerCapacity: null,
    seedBudget: { oedogonium: 1, nitzschia: 0, vallisneria: 0 },
    animalBudget: { 'cherry-shrimp': 0, 'japanese-ricefish': 0, daphnia: 0 },
    planktonBudget: { phytoplankton: 0, daphnia: 0 },
    structureBudget: { 'flat-stone': 1, 'round-stone': 0, 'tall-stone': 0, 'small-flat-stone': 0, 'small-wedge-stone': 0 },
    requiredStructures: { 'flat-stone': 1 },
    allowedSpecies: ['oedogonium'],
    requiredSeedSpecies: ['oedogonium'],
    allowedAnimals: [],
    allowedPlankton: [],
    allowedStructures: ['flat-stone'],
    waterCycle: null,
    dayNightCycle: null,
    dayNightCycleInitiallyEnabled: false,
    target: {
      type: 'coverage',
      speciesId: 'oedogonium',
      minBiomass: ALGAE_RENDER_TRACE_BIOMASS,
      ratio: 0.32,
      holdSeconds: 3,
      label: '붓뚜껑말 표면 점유',
    },
    targetIncludesSubstrate: false,
  },
  'mission-2': {
    id: 'mission-2',
    mode: 'challenge',
    title: '두 번째 실험 · 빛의 틈새',
    subtitle: '규조류 군락량',
    instruction:
      '강한 고정 조명 아래에서 규조류 실제 생물량을 0.53까지 늘리세요.',
    briefing: {
      question: '밝은 수조에서 저광량을 선호하는 규조류의 서식처를 어떻게 만들 수 있을까요?',
      goal: '수조 전체에서 규조류 실제 생물량을 0.53 이상으로 늘리고 4초간 유지하세요.',
      success: '위치나 구조물 개수와 관계없이 수조 안의 규조류를 모두 합산합니다.',
      supplied: '규조류 접종 4회 · 넓적한 사암 3개 · 둥근 강돌 4개 · 세로 판석 3개 · 광량 탐침 · 수온계',
    },
    timeLimitSeconds: 360,
    lightOutput: 104,
    naturalLightOutput: 0,
    backgroundProducerCapacity: null,
    seedBudget: { oedogonium: 0, nitzschia: 4, vallisneria: 0 },
    animalBudget: { 'cherry-shrimp': 0, 'japanese-ricefish': 0, daphnia: 0 },
    planktonBudget: { phytoplankton: 0, daphnia: 0 },
    structureBudget: { 'flat-stone': 3, 'round-stone': 4, 'tall-stone': 3, 'small-flat-stone': 0, 'small-wedge-stone': 0 },
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
      amount: 0.53,
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
      goal: '수조 전체에서 붓뚜껑말 실제 생물량을 0.267 이상으로 늘리고 5초간 유지하세요.',
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
    structureBudget: { 'flat-stone': null, 'round-stone': null, 'tall-stone': null, 'small-flat-stone': 0, 'small-wedge-stone': 0 },
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
      amount: 0.267,
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
    structureBudget: { 'flat-stone': null, 'round-stone': null, 'tall-stone': null, 'small-flat-stone': 0, 'small-wedge-stone': 0 },
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
    subtitle: '체리새우 세대의 장기 순환',
    instruction: '처음 접종한 조류와 균이 스스로 순환하도록 안정시킨 뒤 체리새우를 방류해 20마리 이상의 다세대 군집을 만드세요.',
    briefing: {
      question: '눈에 잘 보이지 않는 분해자들이 수조의 장기 생존을 어떻게 바꿀까요?',
      goal: '외부 방류 0세대 이후 세대교체를 거쳐, 3세대 이상 체리새우 20마리가 함께 살아 있는 군집을 만드세요.',
      success: '처음 접종한 조류가 번식해 먹이를 계속 생산해야 하며, 성공 뒤에도 새우와 조류가 함께 증감해야 합니다.',
      supplied: '체리새우 성체 암컷 2마리·수컷 2마리 · 두 조류 접종 각 8회 · 세 종류의 구조물 무제한 · 분해균·질산화균 각 4회 · 수질 탐침',
    },
    timeLimitSeconds: null,
    lightOutput: 88,
    naturalLightOutput: 0,
    backgroundProducerCapacity: null,
    seedBudget: { oedogonium: 8, nitzschia: 8, vallisneria: 0 },
    animalBudget: { 'cherry-shrimp': 4, 'japanese-ricefish': 0, daphnia: 0 },
    animalSexBudget: {
      'cherry-shrimp': { female: 2, male: 2 },
    },
    planktonBudget: { phytoplankton: 0, daphnia: 0 },
    structureBudget: { 'flat-stone': null, 'round-stone': null, 'tall-stone': null, 'small-flat-stone': 0, 'small-wedge-stone': 0 },
    requiredStructures: {},
    allowedSpecies: ['oedogonium', 'nitzschia'],
    requiredSeedSpecies: [],
    allowedAnimals: ['cherry-shrimp'],
    allowedPlankton: [],
    allowedStructures: ['flat-stone', 'round-stone', 'tall-stone'],
    waterCycle: {
      // Keep the same biological rates but give this closed tank less finite
      // C/N matter, lowering the population that its biofilm can support.
      initialMaterialScale: 0.64,
      initial: {
        organicMatter: 1.5,
        toxicWaste: 0.8,
        // The starting reserve supports establishment, but cannot carry the
        // full challenge without microbial recycling.
        nutrients: 6,
        oxygen: 76,
      },
      microbeBudget: { decomposer: 4, nitrifier: 4 },
      allowedMicrobes: ['decomposer', 'nitrifier'],
    },
    dayNightCycle: null,
    dayNightCycleInitiallyEnabled: false,
    target: {
      type: 'animal-generation',
      speciesId: 'cherry-shrimp',
      minimumGeneration: 3,
      generationCount: 20,
      minimumPopulation: 20,
      holdSeconds: 0,
      label: '3세대 이상 체리새우 군집',
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
    structureBudget: { 'flat-stone': null, 'round-stone': null, 'tall-stone': null, 'small-flat-stone': 0, 'small-wedge-stone': 0 },
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
    structureBudget: { 'flat-stone': null, 'round-stone': null, 'tall-stone': null, 'small-flat-stone': 0, 'small-wedge-stone': 0 },
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
  'mission-8': {
    id: 'mission-8',
    mode: 'challenge',
    tankType: 'long',
    title: '여덟 번째 실험 · 긴 수조의 송사리',
    subtitle: '포식자와 피난 공간',
    instruction:
      '먼저 식물플랑크톤과 큰물벼룩을 넣어 먹이망을 키우세요. 물벼룩이 여러 세대로 충분히 늘면 일시정지해 송사리를 방류하고 포식과 회피를 관찰하세요.',
    briefing: {
      question: '포식자가 들어온 먹이망에서 공간 구조는 피식자의 생존을 어떻게 바꿀까요?',
      goal: '물벼룩 군집을 먼저 늘린 뒤 일시정지 상태에서 송사리를 방류하세요. 작은 돌과 기존 돌로 몸집에 따른 틈을 만들고 세 종의 접근과 회피를 관찰하세요.',
      success:
        '미션 8의 완료 조건은 아직 확정하지 않았습니다. 현재 구현에서는 성공·실패 판정 없이 큰 수조 생태와 피난 구조를 검증합니다.',
      supplied:
        '긴 수조 · 식물플랑크톤 6회 · 큰물벼룩 6마리 · 체리새우 8마리 · 나중에 방류할 송사리 2마리 · 나사말 6포기 · 부착조류 각 8회 · 모든 돌과 두 균 필름 · 수질 탐침',
    },
    timeLimitSeconds: null,
    lightOutput: 0,
    naturalLightOutput: 105,
    backgroundProducerCapacity: null,
    seedBudget: { oedogonium: 8, nitzschia: 8, vallisneria: 6 },
    animalBudget: {
      'cherry-shrimp': 8,
      'japanese-ricefish': 2,
      daphnia: 0,
    },
    planktonBudget: { phytoplankton: 6, daphnia: 6 },
    structureBudget: {
      'flat-stone': null,
      'round-stone': null,
      'tall-stone': null,
      'small-flat-stone': null,
      'small-wedge-stone': null,
    },
    requiredStructures: {},
    allowedSpecies: ['oedogonium', 'nitzschia', 'vallisneria'],
    requiredSeedSpecies: [],
    allowedAnimals: ['cherry-shrimp', 'japanese-ricefish'],
    allowedPlankton: ['phytoplankton', 'daphnia'],
    allowedStructures: [
      'flat-stone',
      'round-stone',
      'tall-stone',
      'small-flat-stone',
      'small-wedge-stone',
    ],
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
    // The user explicitly left mission 8's completion condition undecided.
    // Keep the scenario playable without inventing a provisional score.
    target: null,
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
    structureBudget: { 'flat-stone': null, 'round-stone': null, 'tall-stone': null, 'small-flat-stone': null, 'small-wedge-stone': null },
    requiredStructures: {},
    allowedSpecies: ['oedogonium', 'nitzschia', 'vallisneria'],
    requiredSeedSpecies: [],
    allowedAnimals: ['cherry-shrimp', 'japanese-ricefish'],
    allowedPlankton: ['phytoplankton', 'daphnia'],
    allowedStructures: ['flat-stone', 'round-stone', 'tall-stone', 'small-flat-stone', 'small-wedge-stone'],
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
