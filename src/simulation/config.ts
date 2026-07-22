import type {
  AnimalSpeciesId,
  MicrobeGuildId,
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

/** Starting temperature of a tank whose fixed lamp was already running. */
export const initialWaterTemperatureForLight = (lightOutput: number): number =>
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
};

/**
 * Player-facing ecology constants. Keeping the numbers used by the simulation
 * and the numbers printed in the guide in one module prevents the handbook
 * from silently drifting away from the actual model.
 */
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
  // Includes the oxygen margin needed to close the compressed decomposition,
  // animal respiration and nitrification loop. At 0.92 each complete matter
  // cycle lost oxygen; 1.12 balances multi-generation four-hour runs while a
  // consumer-heavy or poorly lit tank can still become hypoxic.
  oxygenPerFixedCarbon: 1.12,
  algae: {
    // Ammonium is used first, with nitrate/other mineral nutrients filling the
    // remainder.  Uptake is charged only for newly fixed biomass.
    ammoniumPreference: 0.72,
  },
  shrimp: {
    assimilationFraction: 0.30,
    fecesFraction: 0.42,
    respirationFraction: 0.28,
    adultMaintenanceBiomassPerSecond: 0.000055,
    juvenileMaintenanceBiomassPerSecond: 0.000032,
    oxygenPerRespiredCarbon: 0.86,
    adultStructuralBiomass: 1,
    juvenileBirthBiomass: 0.16,
    suppliedReserveBiomass: 0.08,
    juvenileBodyScale: 0.58,
    // Adults cannot retain every bite indefinitely. Excess assimilation is
    // returned to detritus, so a well-fed male does not become a permanent
    // carbon/nitrogen sink and an eventual oversized pollution pulse.
    adultReserveBiomass: 0.72,
    juvenileReserveBiomass: 1.05,
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
  },
} as const;

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
    oxygenPerSubstrate: 0.21,
    surfaceSpreadRate: 0.025,
    waterborneExportRate: 0.0007,
    suspendedDecayRate: 0.025,
    referenceTemperature: 24,
    temperatureCoefficient: 1.08,
  },
  nitrifier: {
    substrate: 'toxicWaste',
    halfSaturation: 5,
    oxygenHalfSaturation: 24,
    // toxic nitrogen consumed per unit film and second; biomassYield is the
    // fraction of processed nitrogen retained in new film.
    maximumUptake: 0.027,
    biomassYield: 0.11,
    maintenanceDecayRate: 0.0012,
    starvationDecayRate: 0.0035,
    oxygenPerSubstrate: 0.72,
    surfaceSpreadRate: 0.012,
    waterborneExportRate: 0.00035,
    suspendedDecayRate: 0.008,
    referenceTemperature: 24,
    temperatureCoefficient: 1.08,
  },
  settlementAttemptsPerSecond: 8,
  settlementFractionPerAttempt: 0.16,
  minimumSettlement: 0.00035,
} as const;

export const SHRIMP_ECOLOGY_RULES = {
  minimumLifespanSeconds: 900,
  maximumLifespanSeconds: 1350,
  // Inventory shrimp arrive as young adults. The individual ID may seed the
  // variation, but its magnitude must never make later introductions older.
  suppliedAdultMinimumAgeSeconds: 180,
  suppliedAdultMaximumAgeSeconds: 300,
  adultBaseMetabolismPerSecond: 0.005,
  juvenileBaseMetabolismPerSecond: 0.003,
  restingActivityCostPerSecond: 0.0002,
  grazingActivityCostPerSecond: 0.0008,
  travelingActivityCostPerSecond: 0.0018,
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
  reproductionEnergy: 0.34,
  maleReproductionEnergy: 0.34,
  gestationEnergy: 0.30,
  matingRecentFeedingSeconds: 12,
  gestationRecentFeedingSeconds: 24,
  maturationSeconds: 180,
  // Supplied adults are not a synchronized laboratory cohort. Spreading their
  // first reproductive opportunity prevents every female from brooding at
  // once while leaving later reproduction governed by food and life history.
  suppliedAdultReproductionCooldownMin: 100,
  suppliedAdultReproductionCooldownMax: 400,
  // The visual population represents a compressed colony. Every completed
  // brood therefore contains at least one individual of each sex (IDs are
  // assigned alternately), avoiding a one-offspring demographic dead end.
  minimumClutchSize: 2,
  maximumClutchSize: 3,
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
  dayNightCycle: DayNightCycleDefinition | null;
  dayNightCycleInitiallyEnabled: boolean;
  seedBudget: Record<SpeciesId, number | null>;
  animalBudget: Record<AnimalSpeciesId, number | null>;
  structureBudget: Record<StructureDefinitionId, number | null>;
  requiredStructures: Partial<Record<StructureDefinitionId, number>>;
  allowedSpecies: SpeciesId[];
  requiredSeedSpecies: SpeciesId[];
  allowedAnimals: AnimalSpeciesId[];
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
    seedBudget: { oedogonium: 1, nitzschia: 0, vallisneria: 0 },
    animalBudget: { 'cherry-shrimp': 0 },
    structureBudget: { 'flat-stone': 1, 'round-stone': 0, 'tall-stone': 0 },
    requiredStructures: { 'flat-stone': 1 },
    allowedSpecies: ['oedogonium'],
    requiredSeedSpecies: ['oedogonium'],
    allowedAnimals: [],
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
    seedBudget: { oedogonium: 0, nitzschia: 4, vallisneria: 0 },
    animalBudget: { 'cherry-shrimp': 0 },
    structureBudget: { 'flat-stone': 3, 'round-stone': 4, 'tall-stone': 3 },
    requiredStructures: {},
    allowedSpecies: ['nitzschia'],
    requiredSeedSpecies: ['nitzschia'],
    allowedAnimals: [],
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
    seedBudget: { oedogonium: 2, nitzschia: 0, vallisneria: 0 },
    animalBudget: { 'cherry-shrimp': 0 },
    structureBudget: { 'flat-stone': null, 'round-stone': null, 'tall-stone': null },
    requiredStructures: {},
    allowedSpecies: ['oedogonium'],
    requiredSeedSpecies: ['oedogonium'],
    allowedAnimals: [],
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
    seedBudget: { oedogonium: 4, nitzschia: 4, vallisneria: 0 },
    animalBudget: { 'cherry-shrimp': 4 },
    structureBudget: { 'flat-stone': null, 'round-stone': null, 'tall-stone': null },
    requiredStructures: {},
    allowedSpecies: ['oedogonium', 'nitzschia'],
    requiredSeedSpecies: [],
    allowedAnimals: ['cherry-shrimp'],
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
      goal: '체리새우 군집이 한 번도 사라지지 않은 상태로 25분의 시뮬레이션 시간을 유지하세요.',
      success: '수질 수치나 접종 방법은 채점하지 않으며, 살아 있는 체리새우가 계속 존재하면 생존 시간이 누적됩니다.',
      supplied: '체리새우 성체 4마리 · 두 조류 접종 각 4회 · 세 종류의 구조물 무제한 · 두 균 필름 접종 · 수질 탐침',
    },
    timeLimitSeconds: 1_800,
    lightOutput: 88,
    naturalLightOutput: 0,
    seedBudget: { oedogonium: 4, nitzschia: 4, vallisneria: 0 },
    animalBudget: { 'cherry-shrimp': 4 },
    structureBudget: { 'flat-stone': null, 'round-stone': null, 'tall-stone': null },
    requiredStructures: {},
    allowedSpecies: ['oedogonium', 'nitzschia'],
    requiredSeedSpecies: [],
    allowedAnimals: ['cherry-shrimp'],
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
      holdSeconds: 1_500,
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
    seedBudget: { oedogonium: 8, nitzschia: 8, vallisneria: 3 },
    animalBudget: { 'cherry-shrimp': 4 },
    structureBudget: { 'flat-stone': null, 'round-stone': null, 'tall-stone': null },
    requiredStructures: {},
    allowedSpecies: ['oedogonium', 'nitzschia', 'vallisneria'],
    requiredSeedSpecies: [],
    allowedAnimals: ['cherry-shrimp'],
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
  laboratory: {
    id: 'laboratory',
    mode: 'laboratory',
    title: '실험실',
    subtitle: '수중 생태계 자유 실험',
    instruction:
      '돌, 조류, 체리새우, 균막과 수질 순환을 자유롭게 시험하세요. 실행한 뒤에는 일시정지해야 배치를 다시 바꿀 수 있습니다.',
    briefing: {
      question: '자유 실험실에서 어떤 수중 환경을 만들고 싶나요?',
      goal: '정해진 성공 조건 없이 구조, 빛, 온도, 군락과 개체군 변화를 관찰합니다.',
      success: '실험실에는 성공·실패 판정이 없습니다.',
      supplied: '모든 구조물 · 두 조류와 나사말 · 체리새우 · 두 균 필름 · 수질 탐침 · 전등·자연광·낮밤 조절',
    },
    timeLimitSeconds: null,
    lightOutput: 90,
    naturalLightOutput: 0,
    seedBudget: { oedogonium: null, nitzschia: null, vallisneria: null },
    animalBudget: { 'cherry-shrimp': null },
    structureBudget: { 'flat-stone': null, 'round-stone': null, 'tall-stone': null },
    requiredStructures: {},
    allowedSpecies: ['oedogonium', 'nitzschia', 'vallisneria'],
    requiredSeedSpecies: [],
    allowedAnimals: ['cherry-shrimp'],
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
