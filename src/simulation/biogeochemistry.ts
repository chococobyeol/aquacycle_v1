import {
  GROUND_Y,
  TANK_WIDTH,
  WATER_TOP,
  type BiofilmBiomass,
  type BiogeochemistrySaveState,
  type BiogeochemistrySnapshot,
  type MicrobeGuildId,
  type PlanktonKind,
  type PlanktonSnapshot,
  type SpeciesBiomass,
  type Vec2,
  type WaterQualityValues,
} from './types';
import {
  continuousBodyMassMaintenance,
  daphniaSuspendedFoodResponse,
  type DaphniaSuspendedFoodResponse,
  MICROBE_ECOLOGY_RULES,
  PLANKTON_ECOLOGY_RULES,
  SHRIMP_ECOLOGY_RULES,
  WATER_CYCLE_RULES,
  WATER_TRANSPORT_RULES,
} from './config';
import {
  WaterTransportGrid,
  type WaterTransportObstacle,
} from './waterTransport';
import {
  closedOxygenWaterEquilibrium,
  freshwaterOxygenSolubilityMgL,
  relativeOxygenSolubility,
} from './gasExchange';
import { thetaTemperatureFactor } from './temperatureResponse';
import {
  nitrifierStoichiometry,
  organicCarbonOxygenDemand,
  producerOxygenProduction,
  type NitrifierStoichiometry,
} from './stoichiometry';

export const WATER_COLUMNS = 36;
export const WATER_ROWS = 20;
const CELL_COUNT = WATER_COLUMNS * WATER_ROWS;
const MAX_CONCENTRATION = 100;
const LOCAL_REACTION_RADIUS = 2;
const SHRIMP_FOOD_CUE_MIXING_PER_SECOND = 0.08;
const SHRIMP_FOOD_CUE_SOURCE_HALF_SATURATION = 0.08;
const SHRIMP_FOOD_CUE_SOURCE_RESPONSE_PER_SECOND = 0.9;
const SHRIMP_FOOD_CUE_HALF_LIFE_SECONDS = 45;
const SHRIMP_FOOD_CUE_MINIMUM = 1e-9;
const SHRIMP_MATE_CUE_MIXING_PER_SECOND = 0.04;
const SHRIMP_MATE_CUE_SOURCE_RESPONSE_PER_SECOND = 1.4;
const SHRIMP_MATE_CUE_HALF_LIFE_SECONDS = 18;
const SHRIMP_MATE_CUE_MINIMUM = 1e-9;
const PREDATOR_DANGER_CUE_MIXING_PER_SECOND = 0.11;
const PREDATOR_DANGER_CUE_SOURCE_RESPONSE_PER_SECOND = 1.8;
const PREDATOR_DANGER_CUE_HALF_LIFE_SECONDS = 14;
const PREDATOR_DANGER_CUE_MINIMUM = 1e-8;

export const emptyBiofilm = (): BiofilmBiomass => ({ decomposer: 0, nitrifier: 0 });

const copyNumericArray = (
  source: ArrayLike<number>,
  target: number[] | undefined,
): number[] => {
  const values = target ?? new Array<number>(source.length);
  for (let index = 0; index < source.length; index += 1) {
    values[index] = source[index];
  }
  values.length = source.length;
  return values;
};

export interface BiofilmReactionSite {
  point: Vec2;
  biofilm: BiofilmBiomass;
}

const compareBiofilmReactionSites = (
  left: BiofilmReactionSite,
  right: BiofilmReactionSite,
): number =>
  left.point.y - right.point.y ||
  left.point.x - right.point.x ||
  left.biofilm.decomposer - right.biofilm.decomposer ||
  left.biofilm.nitrifier - right.biofilm.nitrifier;

export interface ShrimpFoodCueSite {
  point: Vec2;
  /** Non-material dissolved cue emitted by edible surface biomass. */
  strength: number;
}

export interface ShrimpMateCueSite {
  point: Vec2;
  strength: number;
}

export interface PredatorDangerCueSite {
  point: Vec2;
  strength: number;
}

export interface PlanktonSample {
  phytoplankton: number;
  planktonicDecomposer: number;
  daphniaJuveniles: number;
  daphniaAdults: number;
}

export interface ClosedMaterialState {
  organicMatter: number;
  toxicWaste: number;
  nutrients: number;
  dissolvedOxygen: number;
  detritus: number;
  dissolvedInorganicCarbon: number;
  headspaceCarbonDioxide: number;
  headspaceOxygen: number;
  planktonicDecomposer: number;
  phytoplankton: number;
  daphnia: number;
}

const DEFAULT_WATER: WaterQualityValues = {
  organicMatter: 0,
  toxicWaste: 0,
  nutrients: 45,
  oxygen: 76,
};

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const saturation = (value: number, halfSaturation: number): number =>
  value <= 0 ? 0 : value / (halfSaturation + value);

const finiteConcentration = (value: number): number =>
  Number.isFinite(value) ? clamp(value, 0, MAX_CONCENTRATION) : 0;

// Living suspended biomass is constrained by finite C/N and light, not by the
// 0–100 display scale used for dissolved water-quality values. Capping it after
// resources had already been withdrawn silently destroyed conserved matter.
const finiteBiomassConcentration = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, value) : 0;

/**
 * Spatial water chemistry plus two finite, well-mixed headspace reservoirs.
 * A water field's material amount is its tank-wide mean, so local additions
 * and removals use CELL_COUNT as the exact concentration/mass conversion.
 * Diffusion and bulk mixing only redistribute that amount.
 */
export class BiogeochemistryLedger {
  public readonly effectsEnabled: boolean;

  private readonly columns: number;
  private readonly rows: number;
  private readonly cellCount: number;
  private readonly tankWidth: number;
  private readonly waterTop: number;
  private readonly groundY: number;
  private readonly detritus: Float64Array;
  // Chemistry uses Float64 because these are conserved ledgers, not render
  // buffers. Float32 rounding was small per step but accumulated measurably
  // across tens of thousands of closed day/night reaction steps.
  private readonly organicMatter: Float64Array;
  private readonly toxicWaste: Float64Array;
  private readonly nutrients: Float64Array;
  private readonly oxygen: Float64Array;
  private readonly dissolvedInorganicCarbon: Float64Array;
  private readonly planktonicDecomposer: Float64Array;
  private readonly phytoplankton: Float64Array;
  private readonly daphniaJuveniles: Float64Array;
  private readonly daphniaFounderAdults: Float64Array;
  private readonly daphniaBornAdults: Float64Array;
  private readonly planktonLight: Float64Array;
  private readonly shrimpFoodCue: Float64Array;
  private readonly shrimpFoodCueSources: Float64Array;
  private readonly shrimpMateCue: Float64Array;
  private readonly shrimpMateCueSources: Float64Array;
  private readonly predatorDangerCue: Float64Array;
  private readonly predatorDangerCueSources: Float64Array;
  /**
   * These fields are workspaces, not ecological state.
   *
   * A 64x aquarium executes several reaction steps per worker turn. Allocating
   * another dozen 720-element typed arrays for every one of those steps made
   * Chromium's renderer process retain thousands of V8 backing-store regions
   * on macOS even after garbage collection. Keep one fixed set of buffers and
   * overwrite it before each reaction instead.
   */
  private readonly phytoplanktonDownwardScratch: Float64Array;
  private readonly phytoplanktonOpticalDepthScratch: Float64Array;
  private readonly initialOrganicMatterScratch: Float64Array;
  private readonly initialToxicWasteScratch: Float64Array;
  private readonly initialNutrientsScratch: Float64Array;
  private readonly initialOxygenScratch: Float64Array;
  private readonly initialCarbonScratch: Float64Array;
  private readonly organicWithdrawalScratch: Float64Array;
  private readonly toxicWasteWithdrawalScratch: Float64Array;
  private readonly oxygenWithdrawalScratch: Float64Array;
  private readonly carbonWithdrawalScratch: Float64Array;
  private readonly toxicWasteProductsScratch: Float64Array;
  private readonly nutrientProductsScratch: Float64Array;
  private readonly carbonProductsScratch: Float64Array;
  private readonly nitrifierReactionScratch: NitrifierStoichiometry = {
    processedNitrogen: 0,
    retainedNitrogen: 0,
    nitrateProduced: 0,
    growthBiomass: 0,
    fixedCarbon: 0,
    oxygenDemand: 0,
  };
  private readonly daphniaFoodResponseScratch: DaphniaSuspendedFoodResponse = {
    phytoplanktonPotential: 0,
    bacterioplanktonPotential: 0,
    combinedResponse: 0,
    bacteriaShare: 0,
  };
  private readonly waterCellPoints: Vec2[];
  private readonly reactionNeighborhoods: number[][];
  private readonly topSurfaceIndices: number[];
  private readonly allWaterIndices: number[];
  private readonly transport: WaterTransportGrid;

  private headspaceCarbonDioxide: number = WATER_CYCLE_RULES.initialHeadspaceCarbonDioxide;
  private headspaceOxygen: number = WATER_CYCLE_RULES.initialHeadspaceOxygen;
  private cumulativeOxygenProduction = 0;
  private cumulativeOxygenDemand = 0;
  private cumulativeDissolvedWaste = 0;
  private stepDurationSeconds = 1;
  private stepGrossAlgaeProduction = 0;
  private stepAlgaeRespiration = 0;
  private stepAlgaeTurnover = 0;
  private stepAlgaeOxygenProduction = 0;
  private stepAlgaeOxygenDemand = 0;
  private fieldRevision = 0;
  private dissolvedAdvectionAccumulator = 0;
  private shrimpFoodCueAdvectionAccumulator = 0;
  private shrimpMateCueAdvectionAccumulator = 0;
  private predatorDangerCueAdvectionAccumulator = 0;
  private shrimpFoodCueActive = false;
  private shrimpMateCueActive = false;
  private predatorDangerCueActive = false;
  private biofilmTotals = emptyBiofilm();
  private cumulativeFilteredPhytoplankton = 0;
  private cumulativeFilteredPlanktonicDecomposer = 0;
  private cumulativeDaphniaBirths = 0;
  private cumulativeDaphniaMaturations = 0;
  private cumulativeSecondGenerationBirths = 0;
  private cumulativeDaphniaDeaths = 0;
  private stepPhytoplanktonGrowth = 0;
  private stepPhytoplanktonRespiration = 0;
  private stepPhytoplanktonMortality = 0;
  private stepDaphniaAssimilation = 0;
  private stepDaphniaRespiration = 0;
  private stepDaphniaMortality = 0;
  /**
   * Legacy saves represented Daphnia as three concentration fields. New
   * simulations keep their conserved body mass exclusively on AnimalState.
   * These fields then become a read-only spatial mirror for the observation
   * map, and must never be counted in the closed material ledger.
   */
  private individualDaphniaManaged = false;
  private daphniaIndividualCount = 0;
  private daphniaIndividualJuvenileBiomass = 0;
  private daphniaIndividualFounderBiomass = 0;
  private daphniaIndividualBornAdultBiomass = 0;

  public constructor(options?: {
    effectsEnabled?: boolean;
    initial?: Partial<WaterQualityValues>;
    /** Scale finite initial C/N reservoirs while leaving oxygen unchanged. */
    initialMaterialScale?: number;
    initialTemperature?: number;
    columns?: number;
    rows?: number;
    tankWidth?: number;
    waterTop?: number;
    groundY?: number;
  }) {
    this.effectsEnabled = options?.effectsEnabled ?? false;
    this.columns = Math.max(1, Math.floor(options?.columns ?? WATER_COLUMNS));
    this.rows = Math.max(1, Math.floor(options?.rows ?? WATER_ROWS));
    this.cellCount = this.columns * this.rows;
    this.tankWidth = Math.max(1, options?.tankWidth ?? TANK_WIDTH);
    this.waterTop = options?.waterTop ?? WATER_TOP;
    this.groundY = options?.groundY ?? GROUND_Y;
    this.detritus = new Float64Array(this.cellCount);
    this.organicMatter = new Float64Array(this.cellCount);
    this.toxicWaste = new Float64Array(this.cellCount);
    this.nutrients = new Float64Array(this.cellCount);
    this.oxygen = new Float64Array(this.cellCount);
    this.dissolvedInorganicCarbon = new Float64Array(this.cellCount);
    this.planktonicDecomposer = new Float64Array(this.cellCount);
    this.phytoplankton = new Float64Array(this.cellCount);
    this.daphniaJuveniles = new Float64Array(this.cellCount);
    this.daphniaFounderAdults = new Float64Array(this.cellCount);
    this.daphniaBornAdults = new Float64Array(this.cellCount);
    this.planktonLight = new Float64Array(this.cellCount);
    this.shrimpFoodCue = new Float64Array(this.cellCount);
    this.shrimpFoodCueSources = new Float64Array(this.cellCount);
    this.shrimpMateCue = new Float64Array(this.cellCount);
    this.shrimpMateCueSources = new Float64Array(this.cellCount);
    this.predatorDangerCue = new Float64Array(this.cellCount);
    this.predatorDangerCueSources = new Float64Array(this.cellCount);
    this.phytoplanktonDownwardScratch = new Float64Array(this.cellCount);
    this.phytoplanktonOpticalDepthScratch = new Float64Array(this.cellCount);
    this.initialOrganicMatterScratch = new Float64Array(this.cellCount);
    this.initialToxicWasteScratch = new Float64Array(this.cellCount);
    this.initialNutrientsScratch = new Float64Array(this.cellCount);
    this.initialOxygenScratch = new Float64Array(this.cellCount);
    this.initialCarbonScratch = new Float64Array(this.cellCount);
    this.organicWithdrawalScratch = new Float64Array(this.cellCount);
    this.toxicWasteWithdrawalScratch = new Float64Array(this.cellCount);
    this.oxygenWithdrawalScratch = new Float64Array(this.cellCount);
    this.carbonWithdrawalScratch = new Float64Array(this.cellCount);
    this.toxicWasteProductsScratch = new Float64Array(this.cellCount);
    this.nutrientProductsScratch = new Float64Array(this.cellCount);
    this.carbonProductsScratch = new Float64Array(this.cellCount);
    this.waterCellPoints = Array.from(
      { length: this.cellCount },
      (_, index): Vec2 => {
        const row = Math.floor(index / this.columns);
        const column = index % this.columns;
        return {
          x: (column + 0.5) / this.columns * this.tankWidth,
          y: this.waterTop +
            (row + 0.5) / this.rows * (this.groundY - this.waterTop),
        };
      },
    );
    this.reactionNeighborhoods = Array.from(
      { length: this.cellCount },
      (_, index): number[] => {
        const centerRow = Math.floor(index / this.columns);
        const centerColumn = index % this.columns;
        const indices: number[] = [];
        for (
          let row = Math.max(0, centerRow - LOCAL_REACTION_RADIUS);
          row <= Math.min(this.rows - 1, centerRow + LOCAL_REACTION_RADIUS);
          row += 1
        ) {
          for (
            let column = Math.max(0, centerColumn - LOCAL_REACTION_RADIUS);
            column <= Math.min(this.columns - 1, centerColumn + LOCAL_REACTION_RADIUS);
            column += 1
          ) {
            indices.push(row * this.columns + column);
          }
        }
        return indices;
      },
    );
    this.topSurfaceIndices = Array.from(
      { length: this.columns },
      (_, column) => column,
    );
    this.allWaterIndices = Array.from(
      { length: this.cellCount },
      (_, index) => index,
    );
    this.transport = new WaterTransportGrid(
      options?.initialTemperature ?? 23.5,
      {
        columns: this.columns,
        rows: this.rows,
        tankWidth: this.tankWidth,
        waterTop: this.waterTop,
        groundY: this.groundY,
      },
    );
    const initial = { ...DEFAULT_WATER, ...options?.initial };
    const requestedMaterialScale = options?.initialMaterialScale ?? 1;
    const initialMaterialScale = Number.isFinite(requestedMaterialScale)
      ? Math.max(0, requestedMaterialScale)
      : 1;
    this.organicMatter.fill(finiteConcentration(
      initial.organicMatter * initialMaterialScale,
    ));
    this.toxicWaste.fill(finiteConcentration(
      initial.toxicWaste * initialMaterialScale,
    ));
    this.nutrients.fill(finiteConcentration(
      initial.nutrients * initialMaterialScale,
    ));
    this.oxygen.fill(finiteConcentration(initial.oxygen));
    this.dissolvedInorganicCarbon.fill(
      WATER_CYCLE_RULES.initialDissolvedInorganicCarbon * initialMaterialScale,
    );
    this.headspaceCarbonDioxide =
      WATER_CYCLE_RULES.initialHeadspaceCarbonDioxide * initialMaterialScale;
    this.headspaceOxygen = finiteConcentration(initial.oxygen);
  }

  public setTransportEnvironment(
    light: ArrayLike<number>,
    obstacles: WaterTransportObstacle[],
  ): void {
    this.transport.setEnvironment(light, obstacles);
    this.copyPlanktonLight(light);
  }

  public setTransportLight(light: ArrayLike<number>): void {
    this.transport.setLightField(light);
    this.copyPlanktonLight(light);
  }

  public advanceTemperature(deltaSeconds: number, ambientTemperature = 22): void {
    this.transport.advanceHeat(deltaSeconds, ambientTemperature);
  }

  public temperatureAt(point: Vec2): number {
    return this.transport.sampleTemperatureAt(point);
  }

  public velocityAt(point: Vec2, reuse?: Vec2): Vec2 {
    return this.transport.sampleVelocityAt(point, reuse);
  }

  /** Local, non-material food odour available to shrimp chemosensation. */
  public shrimpFoodCueAt(point: Vec2): number {
    return this.shrimpFoodCue[this.indexAt(point)];
  }

  /** Short-range, non-material cue released by a receptive shrimp female. */
  public shrimpMateCueAt(point: Vec2): number {
    return this.shrimpMateCue[this.indexAt(point)];
  }

  /** Coarse non-material risk information; never an exact predator position. */
  public predatorDangerCueAt(point: Vec2): number {
    return this.predatorDangerCue[this.indexAt(point)];
  }

  /** Adds an attack pulse to the same bounded field used by background risk. */
  public emitPredatorDangerPulse(point: Vec2, strength = 1): void {
    const index = this.indexAt(point);
    this.predatorDangerCue[index] = Math.max(
      this.predatorDangerCue[index],
      clamp(strength, 0, 1),
    );
    this.predatorDangerCueActive = true;
  }

  public averageTemperature(): number {
    return this.transport.averageTemperature();
  }

  public surfaceTemperature(): number {
    return this.transport.surfaceTemperature();
  }

  /** Resets short-window flux meters without affecting cumulative ledgers. */
  public beginStep(deltaSeconds = 1): void {
    this.stepDurationSeconds = Math.max(1e-6, deltaSeconds);
    this.stepGrossAlgaeProduction = 0;
    this.stepAlgaeRespiration = 0;
    this.stepAlgaeTurnover = 0;
    this.stepAlgaeOxygenProduction = 0;
    this.stepAlgaeOxygenDemand = 0;
    this.stepPhytoplanktonGrowth = 0;
    this.stepPhytoplanktonRespiration = 0;
    this.stepPhytoplanktonMortality = 0;
    this.stepDaphniaAssimilation = 0;
    this.stepDaphniaRespiration = 0;
    this.stepDaphniaMortality = 0;
  }

  /**
   * Smooth resource response used before requesting new algal biomass. The
   * exact nitrogen and carbon withdrawal happens in commitAlgaeProduction.
   */
  public algaeResourceFactor(point: Vec2): number {
    if (!this.effectsEnabled) return 1;
    const index = this.indexAt(point);
    const mineralNitrogen = this.toxicWaste[index] + this.nutrients[index];
    const carbon = this.dissolvedInorganicCarbon[index];
    const waterClarity = Math.exp(
      -WATER_CYCLE_RULES.algae.organicLightAttenuation *
        this.organicMatter[index],
    );
    return Math.min(
      saturation(
        mineralNitrogen,
        WATER_CYCLE_RULES.mineralNutrientHalfSaturation,
      ),
      saturation(carbon, WATER_CYCLE_RULES.carbonHalfSaturation),
    ) *
      waterClarity;
  }

  /**
   * Converts finite mineral nitrogen and inorganic carbon into algal biomass.
   * Ammonium is preferred, then nitrate/other mineral nutrients. The returned
   * amount is the only biomass the caller may add.
   */
  public commitAlgaeProduction(
    point: Vec2,
    requestedBiomass: number,
    oxygenReleasePoint: Vec2 = point,
  ): number {
    const requested = Math.max(0, requestedBiomass);
    if (requested <= 0) return requested;
    if (!this.effectsEnabled) {
      this.stepGrossAlgaeProduction += requested;
      return requested;
    }
    const index = this.indexAt(point);
    const nitrogenPerBiomass = WATER_CYCLE_RULES.biomassNitrogen;
    const carbonPerBiomass = WATER_CYCLE_RULES.biomassCarbon;
    const availableAmmonium = this.massAround(this.toxicWaste, index);
    const availableNutrients = this.massAround(this.nutrients, index);
    const nitrogenLimit = (availableAmmonium + availableNutrients) / nitrogenPerBiomass;
    const availableCarbon = this.massAround(this.dissolvedInorganicCarbon, index);
    const carbonLimit = availableCarbon / carbonPerBiomass;
    const actual = Math.min(requested, nitrogenLimit, carbonLimit);
    if (actual <= 0) return 0;

    const nitrogenNeed = actual * nitrogenPerBiomass;
    const preferredAmmonium = Math.min(
      availableAmmonium,
      nitrogenNeed * WATER_CYCLE_RULES.algae.ammoniumPreference,
    );
    let removedAmmonium = this.removeMassAround(this.toxicWaste, index, preferredAmmonium);
    let removedNutrients = this.removeMassAround(
      this.nutrients,
      index,
      nitrogenNeed - removedAmmonium,
    );
    if (removedAmmonium + removedNutrients < nitrogenNeed) {
      removedAmmonium += this.removeMassAround(
        this.toxicWaste,
        index,
        nitrogenNeed - removedAmmonium - removedNutrients,
      );
    }
    const paidNitrogen = removedAmmonium + removedNutrients;
    const paidBiomass = Math.min(actual, paidNitrogen / nitrogenPerBiomass);
    const fixedCarbon = paidBiomass * carbonPerBiomass;
    this.removeMassAround(this.dissolvedInorganicCarbon, index, fixedCarbon);
    const oxygenProduced = producerOxygenProduction(fixedCarbon, removedNutrients);
    // Rooted plants can acquire carbon and mineral nutrients at a different
    // part of the plant from the illuminated leaf tissue that releases O2.
    // Surface films keep the default same-point behavior.
    const oxygenReleaseIndex = this.indexAt(oxygenReleasePoint);
    const dissolved = this.addMassAround(
      this.oxygen,
      oxygenReleaseIndex,
      oxygenProduced,
    );
    this.headspaceOxygen += oxygenProduced - dissolved;
    this.cumulativeOxygenProduction += oxygenProduced;
    this.stepGrossAlgaeProduction += paidBiomass;
    this.stepAlgaeOxygenProduction += oxygenProduced;
    return paidBiomass;
  }

  /**
   * Aerobically returns living producer biomass to dissolved inorganic carbon
   * and ammonium. If local and tank oxygen are exhausted, only the supported
   * fraction respires; the caller leaves the remainder as detritus.
   */
  public commitAlgaeRespiration(point: Vec2, requestedBiomass: number): number {
    const requested = Math.max(0, requestedBiomass);
    if (requested <= 0) return 0;
    if (!this.effectsEnabled) {
      this.stepAlgaeRespiration += requested;
      return requested;
    }
    const index = this.indexAt(point);
    const oxygenPerBiomass = organicCarbonOxygenDemand(
      WATER_CYCLE_RULES.biomassCarbon,
    );
    const availableOxygen = this.massAround(this.oxygen, index);
    const carbonCapacity = this.capacityAroundOrTank(
      this.dissolvedInorganicCarbon,
      index,
      requested * WATER_CYCLE_RULES.biomassCarbon,
    );
    const nitrogenCapacity = this.capacityAroundOrTank(
      this.toxicWaste,
      index,
      requested * WATER_CYCLE_RULES.biomassNitrogen,
    );
    const supported = Math.min(
      requested,
      availableOxygen / Math.max(1e-9, oxygenPerBiomass),
      carbonCapacity / WATER_CYCLE_RULES.biomassCarbon,
      nitrogenCapacity / WATER_CYCLE_RULES.biomassNitrogen,
    );
    const removedOxygen = this.removeMassAround(
      this.oxygen,
      index,
      supported * oxygenPerBiomass,
    );
    const actual = oxygenPerBiomass > 0
      ? Math.min(supported, removedOxygen / oxygenPerBiomass)
      : supported;
    if (actual <= 0) return 0;
    const carbon = actual * WATER_CYCLE_RULES.biomassCarbon;
    const nitrogen = actual * WATER_CYCLE_RULES.biomassNitrogen;
    this.addMassAround(this.dissolvedInorganicCarbon, index, carbon);
    this.addMassAround(this.toxicWaste, index, nitrogen);
    this.cumulativeOxygenDemand += removedOxygen;
    this.cumulativeDissolvedWaste += nitrogen;
    this.stepAlgaeRespiration += actual;
    this.stepAlgaeOxygenDemand += removedOxygen;
    return actual;
  }

  public recordAlgaeTurnover(point: Vec2, biomass: number): void {
    if (biomass <= 0) return;
    this.stepAlgaeTurnover += biomass;
    if (this.effectsEnabled) this.detritus[this.indexAt(point)] += biomass;
  }

  /** Compatibility hook for pre-cycle missions; new production books itself. */
  public recordAlgae(
    _point: Vec2,
    _biomass: SpeciesBiomass,
    _light: number,
    _deltaSeconds: number,
  ): void {}

  /**
   * Partitions eaten food into animal reserve and fecal detritus. The
   * assimilated share is returned so SimulationWorld can store it on the
   * individual and later pay growth, offspring and continuous respiration.
   */
  public recordAnimalFeeding(
    point: Vec2,
    consumedBiomass: number,
    consumer: 'shrimp' | 'ricefish' = 'shrimp',
    foodQuality = 1,
  ): number {
    const consumed = Math.max(0, consumedBiomass);
    if (consumed <= 0) return 0;
    const partition = WATER_CYCLE_RULES[consumer];
    // `consumedBiomass` is the conserved material physically removed from the
    // food compartment. Food quality only changes how much of that material
    // reaches animal reserve; the rest remains fecal detritus in the tank.
    // This prevents a gram of low-quality bacterial film from funding the
    // same growth and eggs as a gram of diatom while keeping the matter ledger
    // exactly closed.
    const assimilated = consumed * partition.assimilationFraction *
      clamp(foodQuality, 0, 1);
    // Feeding has exactly two destinations. Using the actual remainder keeps
    // the ledger closed even if a displayed percentage is rounded.
    const feces = Math.max(0, consumed - assimilated);
    if (!this.effectsEnabled) {
      this.detritus[this.indexAt(point)] += feces;
      // Earlier missions do not apply water-quality effects, but the animal's
      // internal budget must still use the same assimilation fraction. Returning
      // the whole bite here used to create reserve mass and made the tutorial
      // shrimp obey a different feeding model from the closed-cycle missions.
      return assimilated;
    }
    const index = this.indexAt(point);
    this.detritus[index] += feces;
    return assimilated;
  }

  /**
   * Returns assimilation that does not fit in an animal's finite reserve to
   * the detritus pool. This is still conserved material: decomposers can use
   * it and the resulting nitrogen/carbon re-enter the water cycle.
   */
  public recordAnimalAssimilationOverflow(point: Vec2, biomass: number): void {
    if (biomass <= 0) return;
    this.detritus[this.indexAt(point)] += biomass;
  }

  /**
   * Pays continuous animal respiration from reserve/body matter.
   *
   * Oxygen is the limiting measured flux. DIC is derived from the oxygen
   * actually withdrawn and the configured respiratory quotient. Nitrogen
   * release remains the fixed-composition B-ledger simplification documented
   * in 09_BIOMASS_AND_METABOLISM.md; it is not a claim that carbon respiration
   * and nitrogen excretion are physiologically coupled.
   */
  public recordAnimalRespiration(point: Vec2, metabolizedBiomass: number): number {
    if (metabolizedBiomass <= 0) return 0;
    if (!this.effectsEnabled) {
      this.cumulativeOxygenDemand += organicCarbonOxygenDemand(
        metabolizedBiomass * WATER_CYCLE_RULES.biomassCarbon,
      );
      this.cumulativeDissolvedWaste += metabolizedBiomass * WATER_CYCLE_RULES.biomassNitrogen;
      return metabolizedBiomass;
    }
    return this.releaseRespiredBiomass(this.indexAt(point), metabolizedBiomass);
  }

  /**
   * Legacy test/diagnostic entry point. Consumed biomass is an explicit input
   * pulse; normal world simulation uses recordAnimalFeeding and draws ongoing
   * respiration from each animal's stored/structural biomass.
   */
  public recordAnimalMetabolism(
    point: Vec2,
    bodyScale: number,
    consumedBiomass: number,
    deltaSeconds: number,
  ): void {
    if (deltaSeconds <= 0) return;
    this.recordAnimalFeeding(point, consumedBiomass);
    const maintenance = Math.max(0, bodyScale) *
      SHRIMP_ECOLOGY_RULES.adultRoutineMaintenanceBiomassPerSecond *
      deltaSeconds;
    this.recordAnimalRespiration(point, maintenance);
  }

  public recordDeath(point: Vec2, bodyMass: number): void {
    if (bodyMass <= 0) return;
    this.detritus[this.indexAt(point)] += bodyMass;
  }

  public recordSuspendedBiomassDeath(point: Vec2, biomass: number): void {
    this.recordDeath(point, biomass);
  }

  public addPlankton(point: Vec2, kind: PlanktonKind, biomass: number): number {
    if (!this.effectsEnabled || biomass <= 0) return 0;
    const field = kind === 'phytoplankton'
      ? this.phytoplankton
      : this.daphniaFounderAdults;
    return this.addMassAround(field, this.indexAt(point), biomass);
  }

  public consumeDaphniaFood(
    point: Vec2,
    requestedPhytoplankton: number,
    requestedPlanktonicDecomposer: number,
  ): { phytoplankton: number; planktonicDecomposer: number } {
    if (!this.effectsEnabled) {
      return {
        phytoplankton: Math.max(0, requestedPhytoplankton),
        planktonicDecomposer: Math.max(0, requestedPlanktonicDecomposer),
      };
    }
    const index = this.indexAt(point);
    const phytoplankton = this.removeMassAround(
      this.phytoplankton,
      index,
      Math.max(0, requestedPhytoplankton),
    );
    const planktonicDecomposer = this.removeMassAround(
      this.planktonicDecomposer,
      index,
      Math.max(0, requestedPlanktonicDecomposer),
    );
    this.cumulativeFilteredPhytoplankton += phytoplankton;
    this.cumulativeFilteredPlanktonicDecomposer += planktonicDecomposer;
    return { phytoplankton, planktonicDecomposer };
  }

  public recordDaphniaFeeding(
    point: Vec2,
    consumedPhytoplankton: number,
    consumedPlanktonicDecomposer: number,
  ): number {
    const phyto = Math.max(0, consumedPhytoplankton);
    const bacteria = Math.max(0, consumedPlanktonicDecomposer);
    const consumed = phyto + bacteria;
    if (consumed <= 0) return 0;
    const rules = PLANKTON_ECOLOGY_RULES.daphnia;
    const assimilated = phyto * rules.phytoplanktonAssimilation +
      bacteria * rules.bacterioplanktonAssimilation;
    // Food-specific digestibility determines the unassimilated remainder.
    // Do not turn a fixed part of the same bite into respiration: ongoing
    // allometric maintenance already withdraws real reserve/body matter.
    const feces = Math.max(0, consumed - assimilated);
    const index = this.indexAt(point);
    this.detritus[index] += feces;
    if (!this.effectsEnabled) {
      this.stepDaphniaAssimilation += assimilated;
      return assimilated;
    }
    this.stepDaphniaAssimilation += assimilated;
    return assimilated;
  }

  public recordDaphniaRespiration(point: Vec2, biomass: number): number {
    const requested = Math.max(0, biomass);
    if (requested <= 0) return 0;
    const respired = this.recordAnimalRespiration(point, requested);
    this.stepDaphniaRespiration += respired;
    return respired;
  }

  public recordDaphniaBirth(
    secondGeneration: boolean,
    birthBiomass: number =
      PLANKTON_ECOLOGY_RULES.daphnia.juvenileBirthBiomass,
  ): void {
    // These counters are displayed and scored as biomass. The former
    // individual path added `1` per neonate while the density path added a
    // biomass amount, so a single tracked birth exceeded mission 7's 0.05
    // target twentyfold. Keep both simulation paths in the same unit.
    const amount = Math.max(0, birthBiomass);
    this.cumulativeDaphniaBirths += amount;
    if (secondGeneration) this.cumulativeSecondGenerationBirths += amount;
  }

  public recordDaphniaMaturation(): void {
    this.cumulativeDaphniaMaturations += 1;
  }

  public recordDaphniaDeath(point: Vec2, biomass: number): void {
    const deadBiomass = Math.max(0, biomass);
    if (deadBiomass <= 0) return;
    this.recordDeath(point, deadBiomass);
    this.cumulativeDaphniaDeaths += 1;
    this.stepDaphniaMortality += deadBiomass;
  }

  public setDaphniaIndividuals(
    individuals: ArrayLike<{
      position: Vec2;
      lifeStage: string;
      structuralBiomass: number;
      storedBiomass: number;
      reproductiveBiomass: number;
      generation?: number;
    }>,
  ): void {
    this.individualDaphniaManaged = true;
    this.daphniaIndividualCount = individuals.length;
    this.daphniaIndividualJuvenileBiomass = 0;
    this.daphniaIndividualFounderBiomass = 0;
    this.daphniaIndividualBornAdultBiomass = 0;
    this.daphniaJuveniles.fill(0);
    this.daphniaFounderAdults.fill(0);
    this.daphniaBornAdults.fill(0);
    for (let item = 0; item < individuals.length; item += 1) {
      const individual = individuals[item];
      const biomass = Math.max(
        0,
        individual.structuralBiomass +
          individual.storedBiomass +
          individual.reproductiveBiomass,
      );
      if (biomass <= 0) continue;
      if (individual.lifeStage === 'juvenile') {
        this.daphniaIndividualJuvenileBiomass += biomass;
      } else if ((individual.generation ?? 0) > 0) {
        this.daphniaIndividualBornAdultBiomass += biomass;
      } else {
        this.daphniaIndividualFounderBiomass += biomass;
      }
    }
    this.fieldRevision += 1;
  }

  public addPlanktonicDecomposer(point: Vec2, biomass: number): number {
    if (!this.effectsEnabled || biomass <= 0) return 0;
    return this.addMassAround(this.planktonicDecomposer, this.indexAt(point), biomass);
  }

  public removePlanktonicDecomposer(point: Vec2, biomass: number): number {
    return this.removeMassAround(
      this.planktonicDecomposer,
      this.indexAt(point),
      biomass,
    );
  }

  public planktonicDecomposerMass(): number {
    return this.fieldMass(this.planktonicDecomposer);
  }

  public planktonAt(point: Vec2, reuse?: PlanktonSample): PlanktonSample {
    const index = this.indexAt(point);
    const sample = reuse ?? {
      phytoplankton: 0,
      planktonicDecomposer: 0,
      daphniaJuveniles: 0,
      daphniaAdults: 0,
    };
    sample.phytoplankton = this.phytoplankton[index];
    sample.planktonicDecomposer = this.planktonicDecomposer[index];
    sample.daphniaJuveniles = this.daphniaJuveniles[index];
    sample.daphniaAdults =
      this.daphniaFounderAdults[index] + this.daphniaBornAdults[index];
    return sample;
  }

  public advance(
    deltaSeconds: number,
    sites: BiofilmReactionSite[],
    shrimpMateCueSites: ShrimpMateCueSite[] = [],
    shrimpFoodCueSites: ShrimpFoodCueSite[] = [],
    predatorDangerCueSites: PredatorDangerCueSite[] = [],
  ): void {
    if (deltaSeconds <= 0) return;
    const dt = Math.max(0, deltaSeconds);
    this.advanceShrimpFoodCue(dt, shrimpFoodCueSites);
    this.advanceShrimpMateCue(dt, shrimpMateCueSites);
    this.advancePredatorDangerCue(dt, predatorDangerCueSites);
    if (!this.effectsEnabled) return;
    const solubilization = 1 - Math.exp(-WATER_CYCLE_RULES.detritusSolubilizationRate * dt);
    for (let index = 0; index < this.cellCount; index += 1) {
      const requested = this.detritus[index] * solubilization;
      if (requested <= 0) continue;
      const dissolved = this.addMassAround(this.organicMatter, index, requested);
      this.detritus[index] = Math.max(0, this.detritus[index] - dissolved);
    }

    this.applyBiofilmReactions(dt, sites);
    this.applyPlanktonicDecomposerReactions(dt);
    this.applyPhytoplanktonReactions(dt);
    if (!this.individualDaphniaManaged) this.applyDaphniaReactions(dt);
    this.transport.disperseConservativeField(
      this.organicMatter,
      dt,
      WATER_TRANSPORT_RULES.localDiffusionPerSecond.organicMatter,
    );
    this.transport.disperseConservativeField(
      this.toxicWaste,
      dt,
      WATER_TRANSPORT_RULES.localDiffusionPerSecond.toxicWaste,
    );
    this.transport.disperseConservativeField(
      this.nutrients,
      dt,
      WATER_TRANSPORT_RULES.localDiffusionPerSecond.nutrients,
    );
    this.transport.disperseConservativeField(
      this.oxygen,
      dt,
      WATER_TRANSPORT_RULES.localDiffusionPerSecond.oxygen,
    );
    this.transport.disperseConservativeField(
      this.dissolvedInorganicCarbon,
      dt,
      WATER_TRANSPORT_RULES.localDiffusionPerSecond.dissolvedInorganicCarbon,
    );
    this.transport.disperseConservativeField(
      this.planktonicDecomposer,
      dt,
      WATER_TRANSPORT_RULES.localDiffusionPerSecond.planktonicDecomposer,
    );
    this.transport.disperseConservativeField(
      this.phytoplankton,
      dt,
      WATER_TRANSPORT_RULES.localDiffusionPerSecond.phytoplankton,
    );
    if (!this.individualDaphniaManaged) {
      this.transport.disperseConservativeField(
        this.daphniaJuveniles,
        dt,
        WATER_TRANSPORT_RULES.localDiffusionPerSecond.daphnia,
      );
      this.transport.disperseConservativeField(
        this.daphniaFounderAdults,
        dt,
        WATER_TRANSPORT_RULES.localDiffusionPerSecond.daphnia,
      );
      this.transport.disperseConservativeField(
        this.daphniaBornAdults,
        dt,
        WATER_TRANSPORT_RULES.localDiffusionPerSecond.daphnia,
      );
    }
    this.dissolvedAdvectionAccumulator += dt;
    if (this.dissolvedAdvectionAccumulator + 1e-9 >= 1) {
      const transportSeconds = this.dissolvedAdvectionAccumulator;
      this.transport.advectConservativeField(this.organicMatter, transportSeconds);
      this.transport.advectConservativeField(this.toxicWaste, transportSeconds);
      this.transport.advectConservativeField(this.nutrients, transportSeconds);
      this.transport.advectConservativeField(this.oxygen, transportSeconds);
      this.transport.advectConservativeField(this.dissolvedInorganicCarbon, transportSeconds);
      this.transport.advectConservativeField(this.planktonicDecomposer, transportSeconds);
      this.transport.advectConservativeField(this.phytoplankton, transportSeconds);
      if (!this.individualDaphniaManaged) {
        this.transport.advectConservativeField(this.daphniaJuveniles, transportSeconds);
        this.transport.advectConservativeField(this.daphniaFounderAdults, transportSeconds);
        this.transport.advectConservativeField(this.daphniaBornAdults, transportSeconds);
      }
      this.dissolvedAdvectionAccumulator = 0;
    }
    this.exchangeClosedHeadspace(dt);

    let decomposerTotal = 0;
    let nitrifierTotal = 0;
    for (let siteIndex = 0; siteIndex < sites.length; siteIndex += 1) {
      decomposerTotal += sites[siteIndex].biofilm.decomposer;
      nitrifierTotal += sites[siteIndex].biofilm.nitrifier;
    }
    this.biofilmTotals.decomposer = decomposerTotal;
    this.biofilmTotals.nitrifier = nitrifierTotal;
    this.fieldRevision += 1;
  }

  private advanceShrimpFoodCue(
    deltaSeconds: number,
    sites: ShrimpFoodCueSite[],
  ): void {
    if (!sites.length && !this.shrimpFoodCueActive) return;

    this.shrimpFoodCueSources.fill(0);
    for (const site of sites) {
      const strength = Math.max(0, site.strength);
      if (strength <= 0) continue;
      // A trace biofilm should not create nearly the same navigational signal
      // as a viable colony merely because many trace cells exist. A type-III
      // source response also represents sensory detection against background
      // odour while remaining continuous at zero.
      const strengthSquared = strength * strength;
      const halfSaturationSquared =
        SHRIMP_FOOD_CUE_SOURCE_HALF_SATURATION *
        SHRIMP_FOOD_CUE_SOURCE_HALF_SATURATION;
      const normalized =
        strengthSquared / (halfSaturationSquared + strengthSquared);
      this.shrimpFoodCueSources[this.indexAt(site.point)] += normalized;
    }

    const sourceResponse =
      1 - Math.exp(-SHRIMP_FOOD_CUE_SOURCE_RESPONSE_PER_SECOND * deltaSeconds);
    for (let index = 0; index < this.cellCount; index += 1) {
      const source = this.shrimpFoodCueSources[index];
      if (source <= 0) continue;
      const localTarget = 1 - Math.exp(-source);
      if (localTarget > this.shrimpFoodCue[index]) {
        this.shrimpFoodCue[index] +=
          (localTarget - this.shrimpFoodCue[index]) * sourceResponse;
      }
    }

    this.transport.disperseConservativeField(
      this.shrimpFoodCue,
      deltaSeconds,
      SHRIMP_FOOD_CUE_MIXING_PER_SECOND,
    );
    this.shrimpFoodCueAdvectionAccumulator += deltaSeconds;
    if (this.shrimpFoodCueAdvectionAccumulator + 1e-9 >= 1) {
      this.transport.advectConservativeField(
        this.shrimpFoodCue,
        this.shrimpFoodCueAdvectionAccumulator,
        1,
      );
      this.shrimpFoodCueAdvectionAccumulator = 0;
    }

    const retention = Math.exp(
      -Math.LN2 * deltaSeconds / SHRIMP_FOOD_CUE_HALF_LIFE_SECONDS,
    );
    let active = false;
    for (let index = 0; index < this.cellCount; index += 1) {
      const retained = this.shrimpFoodCue[index] * retention;
      const value = retained >= SHRIMP_FOOD_CUE_MINIMUM ? retained : 0;
      this.shrimpFoodCue[index] = value;
      active ||= value > 0;
    }
    this.shrimpFoodCueActive = active;
    if (!active) this.shrimpFoodCueAdvectionAccumulator = 0;
  }

  private advanceShrimpMateCue(
    deltaSeconds: number,
    sites: ShrimpMateCueSite[],
  ): void {
    if (!sites.length && !this.shrimpMateCueActive) return;

    this.shrimpMateCueSources.fill(0);
    for (const site of sites) {
      const strength = clamp(site.strength, 0, 1);
      if (strength <= 0) continue;
      this.shrimpMateCueSources[this.indexAt(site.point)] += strength;
    }

    const sourceResponse =
      1 - Math.exp(-SHRIMP_MATE_CUE_SOURCE_RESPONSE_PER_SECOND * deltaSeconds);
    for (let index = 0; index < this.cellCount; index += 1) {
      const source = this.shrimpMateCueSources[index];
      if (source <= 0) continue;
      const localTarget = 1 - Math.exp(-source);
      if (localTarget > this.shrimpMateCue[index]) {
        this.shrimpMateCue[index] +=
          (localTarget - this.shrimpMateCue[index]) * sourceResponse;
      }
    }

    this.transport.disperseConservativeField(
      this.shrimpMateCue,
      deltaSeconds,
      SHRIMP_MATE_CUE_MIXING_PER_SECOND,
    );
    this.shrimpMateCueAdvectionAccumulator += deltaSeconds;
    if (this.shrimpMateCueAdvectionAccumulator + 1e-9 >= 1) {
      this.transport.advectConservativeField(
        this.shrimpMateCue,
        this.shrimpMateCueAdvectionAccumulator,
        1,
      );
      this.shrimpMateCueAdvectionAccumulator = 0;
    }

    const retention = Math.exp(
      -Math.LN2 * deltaSeconds / SHRIMP_MATE_CUE_HALF_LIFE_SECONDS,
    );
    let active = false;
    for (let index = 0; index < this.cellCount; index += 1) {
      const retained = this.shrimpMateCue[index] * retention;
      const value = retained >= SHRIMP_MATE_CUE_MINIMUM ? retained : 0;
      this.shrimpMateCue[index] = value;
      active ||= value > 0;
    }
    this.shrimpMateCueActive = active;
    if (!active) this.shrimpMateCueAdvectionAccumulator = 0;
  }

  private advancePredatorDangerCue(
    deltaSeconds: number,
    sites: PredatorDangerCueSite[],
  ): void {
    if (!sites.length && !this.predatorDangerCueActive) return;

    this.predatorDangerCueSources.fill(0);
    for (const site of sites) {
      const strength = clamp(site.strength, 0, 1);
      if (strength <= 0) continue;
      this.predatorDangerCueSources[this.indexAt(site.point)] += strength;
    }
    const sourceResponse =
      1 - Math.exp(-PREDATOR_DANGER_CUE_SOURCE_RESPONSE_PER_SECOND * deltaSeconds);
    for (let index = 0; index < this.cellCount; index += 1) {
      const source = this.predatorDangerCueSources[index];
      if (source <= 0) continue;
      const localTarget = 1 - Math.exp(-source);
      if (localTarget > this.predatorDangerCue[index]) {
        this.predatorDangerCue[index] +=
          (localTarget - this.predatorDangerCue[index]) * sourceResponse;
      }
    }
    this.transport.disperseConservativeField(
      this.predatorDangerCue,
      deltaSeconds,
      PREDATOR_DANGER_CUE_MIXING_PER_SECOND,
    );
    this.predatorDangerCueAdvectionAccumulator += deltaSeconds;
    if (this.predatorDangerCueAdvectionAccumulator + 1e-9 >= 1) {
      this.transport.advectConservativeField(
        this.predatorDangerCue,
        this.predatorDangerCueAdvectionAccumulator,
        1,
      );
      this.predatorDangerCueAdvectionAccumulator = 0;
    }
    const retention = Math.exp(
      -Math.LN2 * deltaSeconds / PREDATOR_DANGER_CUE_HALF_LIFE_SECONDS,
    );
    let active = false;
    for (let index = 0; index < this.cellCount; index += 1) {
      const retained = this.predatorDangerCue[index] * retention;
      const value = retained >= PREDATOR_DANGER_CUE_MINIMUM ? retained : 0;
      this.predatorDangerCue[index] = value;
      active ||= value > 0;
    }
    this.predatorDangerCueActive = active;
    if (!active) this.predatorDangerCueAdvectionAccumulator = 0;
  }

  public sampleAt(point: Vec2): WaterQualityValues {
    const index = this.indexAt(point);
    return {
      organicMatter: this.organicMatter[index],
      toxicWaste: this.toxicWaste[index],
      nutrients: this.nutrients[index],
      oxygen: this.oxygen[index],
    };
  }

  public oxygenAt(point: Vec2): number {
    return this.oxygen[this.indexAt(point)];
  }

  public toxicWasteAt(point: Vec2): number {
    return this.toxicWaste[this.indexAt(point)];
  }

  public microbeNetGrowthAt(
    guildId: MicrobeGuildId,
    point: Vec2,
    occupiedFraction = 0,
  ): number {
    if (!this.effectsEnabled) return 0;
    const quality = this.sampleAt(point);
    const kinetics = MICROBE_ECOLOGY_RULES[guildId];
    const food = quality[kinetics.substrate];
    const activity = saturation(food, kinetics.halfSaturation) *
      saturation(quality.oxygen, kinetics.oxygenHalfSaturation);
    const temperatureFactor = thetaTemperatureFactor(
      this.temperatureAt(point),
      kinetics.referenceTemperature,
      kinetics.temperatureCoefficient,
    );
    const freeSurface = clamp(1 - occupiedFraction, 0, 1);
    const uptake = kinetics.maximumUptake * activity;
    const growth = guildId === 'decomposer'
      ? uptake * kinetics.biomassYield * freeSurface
      : uptake * kinetics.biomassYield / WATER_CYCLE_RULES.biomassNitrogen * freeSurface;
    const decay = kinetics.maintenanceDecayRate +
      kinetics.starvationDecayRate * (1 - activity);
    return (growth - decay) * temperatureFactor;
  }

  public materialState(): ClosedMaterialState {
    return {
      organicMatter: this.fieldMass(this.organicMatter),
      toxicWaste: this.fieldMass(this.toxicWaste),
      nutrients: this.fieldMass(this.nutrients),
      dissolvedOxygen: this.fieldMass(this.oxygen),
      detritus: this.detritus.reduce((sum, value) => sum + value, 0),
      dissolvedInorganicCarbon: this.fieldMass(this.dissolvedInorganicCarbon),
      headspaceCarbonDioxide: this.headspaceCarbonDioxide,
      headspaceOxygen: this.headspaceOxygen,
      planktonicDecomposer: this.fieldMass(this.planktonicDecomposer),
      phytoplankton: this.fieldMass(this.phytoplankton),
      daphnia: this.individualDaphniaManaged
        ? 0
        : this.fieldMass(this.daphniaJuveniles) +
          this.fieldMass(this.daphniaFounderAdults) +
          this.fieldMass(this.daphniaBornAdults),
    };
  }

  public exportSaveState(): BiogeochemistrySaveState {
    return {
      detritus: Array.from(this.detritus),
      organicMatter: Array.from(this.organicMatter),
      toxicWaste: Array.from(this.toxicWaste),
      nutrients: Array.from(this.nutrients),
      oxygen: Array.from(this.oxygen),
      dissolvedInorganicCarbon: this.fieldMass(this.dissolvedInorganicCarbon),
      dissolvedInorganicCarbonField: Array.from(this.dissolvedInorganicCarbon),
      planktonicDecomposer: Array.from(this.planktonicDecomposer),
      phytoplankton: Array.from(this.phytoplankton),
      daphniaJuveniles: Array.from(this.daphniaJuveniles),
      daphniaFounderAdults: Array.from(this.daphniaFounderAdults),
      daphniaBornAdults: Array.from(this.daphniaBornAdults),
      shrimpFoodCue: Array.from(this.shrimpFoodCue),
      shrimpMateCue: Array.from(this.shrimpMateCue),
      predatorDangerCue: Array.from(this.predatorDangerCue),
      planktonCounters: {
        births: this.cumulativeDaphniaBirths,
        maturations: this.cumulativeDaphniaMaturations,
        secondGenerationBirths: this.cumulativeSecondGenerationBirths,
        deaths: this.cumulativeDaphniaDeaths,
        filteredPhytoplankton: this.cumulativeFilteredPhytoplankton,
        filteredPlanktonicDecomposer: this.cumulativeFilteredPlanktonicDecomposer,
      },
      headspaceCarbonDioxide: this.headspaceCarbonDioxide,
      headspaceOxygen: this.headspaceOxygen,
      cumulativeOxygenProduction: this.cumulativeOxygenProduction,
      cumulativeOxygenDemand: this.cumulativeOxygenDemand,
      cumulativeDissolvedWaste: this.cumulativeDissolvedWaste,
      fieldRevision: this.fieldRevision,
      transport: this.transport.exportSaveState(),
    };
  }

  public restoreSaveState(state: BiogeochemistrySaveState, fallbackTemperature = 23.5): void {
    const restoreField = (target: Float32Array | Float64Array, source: number[]): void => {
      for (let index = 0; index < target.length; index += 1) {
        const value = source[index];
        target[index] = Number.isFinite(value) ? Math.max(0, value) : 0;
      }
    };
    restoreField(this.detritus, state.detritus);
    restoreField(this.organicMatter, state.organicMatter);
    restoreField(this.toxicWaste, state.toxicWaste);
    restoreField(this.nutrients, state.nutrients);
    restoreField(this.oxygen, state.oxygen);
    if (state.dissolvedInorganicCarbonField?.length === this.cellCount) {
      restoreField(this.dissolvedInorganicCarbon, state.dissolvedInorganicCarbonField);
    } else {
      this.dissolvedInorganicCarbon.fill(
        finiteConcentration(state.dissolvedInorganicCarbon),
      );
    }
    if (state.planktonicDecomposer?.length === this.cellCount) {
      restoreField(this.planktonicDecomposer, state.planktonicDecomposer);
    }
    if (state.phytoplankton?.length === this.cellCount) {
      restoreField(this.phytoplankton, state.phytoplankton);
    }
    if (state.daphniaJuveniles?.length === this.cellCount) {
      restoreField(this.daphniaJuveniles, state.daphniaJuveniles);
    }
    if (state.daphniaFounderAdults?.length === this.cellCount) {
      restoreField(this.daphniaFounderAdults, state.daphniaFounderAdults);
    }
    if (state.daphniaBornAdults?.length === this.cellCount) {
      restoreField(this.daphniaBornAdults, state.daphniaBornAdults);
    }
    if (state.shrimpFoodCue?.length === this.cellCount) {
      restoreField(this.shrimpFoodCue, state.shrimpFoodCue);
      for (let index = 0; index < this.cellCount; index += 1) {
        this.shrimpFoodCue[index] = Math.min(1, this.shrimpFoodCue[index]);
      }
    } else {
      this.shrimpFoodCue.fill(0);
    }
    this.shrimpFoodCueActive = this.shrimpFoodCue.some((value) => value > 0);
    if (state.shrimpMateCue?.length === this.cellCount) {
      restoreField(this.shrimpMateCue, state.shrimpMateCue);
      for (let index = 0; index < this.cellCount; index += 1) {
        this.shrimpMateCue[index] = Math.min(1, this.shrimpMateCue[index]);
      }
    } else {
      this.shrimpMateCue.fill(0);
    }
    this.shrimpMateCueActive = this.shrimpMateCue.some((value) => value > 0);
    if (state.predatorDangerCue?.length === this.cellCount) {
      restoreField(this.predatorDangerCue, state.predatorDangerCue);
      for (let index = 0; index < this.cellCount; index += 1) {
        this.predatorDangerCue[index] = Math.min(
          1,
          this.predatorDangerCue[index],
        );
      }
    } else {
      this.predatorDangerCue.fill(0);
    }
    this.predatorDangerCueActive =
      this.predatorDangerCue.some((value) => value > 0);
    this.cumulativeDaphniaBirths = Math.max(0, state.planktonCounters?.births ?? 0);
    this.cumulativeDaphniaMaturations = Math.max(
      0,
      state.planktonCounters?.maturations ?? 0,
    );
    this.cumulativeSecondGenerationBirths = Math.max(
      0,
      state.planktonCounters?.secondGenerationBirths ?? 0,
    );
    this.cumulativeDaphniaDeaths = Math.max(0, state.planktonCounters?.deaths ?? 0);
    this.cumulativeFilteredPhytoplankton = Math.max(
      0,
      state.planktonCounters?.filteredPhytoplankton ?? 0,
    );
    this.cumulativeFilteredPlanktonicDecomposer = Math.max(
      0,
      state.planktonCounters?.filteredPlanktonicDecomposer ?? 0,
    );
    this.headspaceCarbonDioxide = Math.max(0, state.headspaceCarbonDioxide);
    this.headspaceOxygen = Math.max(0, state.headspaceOxygen);
    this.cumulativeOxygenProduction = Math.max(0, state.cumulativeOxygenProduction);
    this.cumulativeOxygenDemand = Math.max(0, state.cumulativeOxygenDemand);
    this.cumulativeDissolvedWaste = Math.max(0, state.cumulativeDissolvedWaste);
    this.fieldRevision = Math.max(0, Math.floor(state.fieldRevision));
    this.dissolvedAdvectionAccumulator = 0;
    this.shrimpFoodCueAdvectionAccumulator = 0;
    this.shrimpMateCueAdvectionAccumulator = 0;
    this.predatorDangerCueAdvectionAccumulator = 0;
    this.individualDaphniaManaged = false;
    this.daphniaIndividualCount = 0;
    this.daphniaIndividualJuvenileBiomass = 0;
    this.daphniaIndividualFounderBiomass = 0;
    this.daphniaIndividualBornAdultBiomass = 0;
    this.transport.restoreSaveState(state.transport, fallbackTemperature);
  }

  public snapshot(reuse?: BiogeochemistrySnapshot): BiogeochemistrySnapshot {
    const material = this.materialState();
    const filmBiomass = this.biofilmTotals.decomposer + this.biofilmTotals.nitrifier;
    const planktonBiomass = material.planktonicDecomposer +
      material.phytoplankton + material.daphnia;
    const biologicalMatter = material.organicMatter + material.detritus +
      filmBiomass + planktonBiomass;
    const totalNitrogen = material.toxicWaste + material.nutrients +
      biologicalMatter * WATER_CYCLE_RULES.biomassNitrogen;
    const totalCarbon = material.dissolvedInorganicCarbon + material.headspaceCarbonDioxide +
      biologicalMatter * WATER_CYCLE_RULES.biomassCarbon;
    const snapshot = reuse ?? {} as BiogeochemistrySnapshot;
    snapshot.effectsEnabled = this.effectsEnabled;
    snapshot.potentialOxygenProduction = this.cumulativeOxygenProduction;
    snapshot.potentialOxygenDemand = this.cumulativeOxygenDemand;
    snapshot.dissolvedWasteProduced = this.cumulativeDissolvedWaste;
    snapshot.detritusMass = material.detritus;

    const water = snapshot.water ?? {} as BiogeochemistrySnapshot['water'];
    water.columns = this.effectsEnabled ? this.columns : 0;
    water.rows = this.effectsEnabled ? this.rows : 0;
    if (this.effectsEnabled) {
      water.organicMatter = copyNumericArray(this.organicMatter, water.organicMatter);
      water.toxicWaste = copyNumericArray(this.toxicWaste, water.toxicWaste);
      water.nutrients = copyNumericArray(this.nutrients, water.nutrients);
      water.oxygen = copyNumericArray(this.oxygen, water.oxygen);
      water.dissolvedInorganicCarbon = copyNumericArray(
        this.dissolvedInorganicCarbon,
        water.dissolvedInorganicCarbon,
      );
      water.planktonicDecomposer = copyNumericArray(
        this.planktonicDecomposer,
        water.planktonicDecomposer,
      );
      water.phytoplankton = copyNumericArray(
        this.phytoplankton,
        water.phytoplankton,
      );
      water.daphniaJuveniles = copyNumericArray(
        this.daphniaJuveniles,
        water.daphniaJuveniles,
      );
      water.daphniaAdults ??= new Array<number>(this.cellCount);
      for (let index = 0; index < this.cellCount; index += 1) {
        water.daphniaAdults[index] =
          this.daphniaFounderAdults[index] + this.daphniaBornAdults[index];
      }
      water.daphniaAdults.length = this.cellCount;
    } else {
      water.organicMatter ??= [];
      water.toxicWaste ??= [];
      water.nutrients ??= [];
      water.oxygen ??= [];
      water.dissolvedInorganicCarbon ??= [];
      water.planktonicDecomposer ??= [];
      water.phytoplankton ??= [];
      water.daphniaJuveniles ??= [];
      water.daphniaAdults ??= [];
      water.organicMatter.length = 0;
      water.toxicWaste.length = 0;
      water.nutrients.length = 0;
      water.oxygen.length = 0;
      water.dissolvedInorganicCarbon.length = 0;
      water.planktonicDecomposer.length = 0;
      water.phytoplankton.length = 0;
      water.daphniaJuveniles.length = 0;
      water.daphniaAdults.length = 0;
    }
    water.revision = this.fieldRevision;
    snapshot.water = water;

    snapshot.transport = this.transport.snapshot(snapshot.transport);
    snapshot.average ??= {} as WaterQualityValues;
    snapshot.average.organicMatter = material.organicMatter;
    snapshot.average.toxicWaste = material.toxicWaste;
    snapshot.average.nutrients = material.nutrients;
    snapshot.average.oxygen = material.dissolvedOxygen;
    snapshot.biofilmTotals ??= emptyBiofilm();
    snapshot.biofilmTotals.decomposer = this.biofilmTotals.decomposer;
    snapshot.biofilmTotals.nitrifier = this.biofilmTotals.nitrifier;
    snapshot.plankton = this.planktonSnapshot(snapshot.plankton);

    snapshot.algaeFluxes ??= {} as BiogeochemistrySnapshot['algaeFluxes'];
    snapshot.algaeFluxes.grossProductionBiomassPerSecond =
      this.stepGrossAlgaeProduction / this.stepDurationSeconds;
    snapshot.algaeFluxes.respirationBiomassPerSecond =
      this.stepAlgaeRespiration / this.stepDurationSeconds;
    snapshot.algaeFluxes.stressTurnoverBiomassPerSecond =
      this.stepAlgaeTurnover / this.stepDurationSeconds;
    snapshot.algaeFluxes.oxygenProducedPerSecond =
      this.stepAlgaeOxygenProduction / this.stepDurationSeconds;
    snapshot.algaeFluxes.oxygenConsumedPerSecond =
      this.stepAlgaeOxygenDemand / this.stepDurationSeconds;

    snapshot.carbonCycle ??= {} as BiogeochemistrySnapshot['carbonCycle'];
    snapshot.carbonCycle.dissolvedInorganicCarbon =
      material.dissolvedInorganicCarbon;
    snapshot.carbonCycle.headspaceCarbonDioxide = material.headspaceCarbonDioxide;
    snapshot.carbonCycle.headspaceOxygen = material.headspaceOxygen;

    snapshot.gasExchange ??= {} as BiogeochemistrySnapshot['gasExchange'];
    Object.assign(snapshot.gasExchange, this.gasExchangeState(material));

    snapshot.materialBalance ??= {} as BiogeochemistrySnapshot['materialBalance'];
    snapshot.materialBalance.totalNitrogen = totalNitrogen;
    snapshot.materialBalance.totalCarbon = totalCarbon;
    snapshot.materialBalance.oxygenEquivalent = 0;
    snapshot.materialBalance.referenceNitrogen = null;
    snapshot.materialBalance.referenceCarbon = null;
    snapshot.materialBalance.referenceOxygenEquivalent = null;
    snapshot.materialBalance.nitrogenDriftRatio = 0;
    snapshot.materialBalance.carbonDriftRatio = 0;
    snapshot.materialBalance.oxygenEquivalentDriftRatio = 0;
    return snapshot;
  }

  planktonState(): PlanktonSnapshot {
    return this.planktonSnapshot();
  }

  private planktonSnapshot(reuse?: PlanktonSnapshot): PlanktonSnapshot {
    const juvenile = this.individualDaphniaManaged
      ? this.daphniaIndividualJuvenileBiomass
      : this.fieldMass(this.daphniaJuveniles);
    const founderAdults = this.individualDaphniaManaged
      ? this.daphniaIndividualFounderBiomass
      : this.fieldMass(this.daphniaFounderAdults);
    const bornAdults = this.individualDaphniaManaged
      ? this.daphniaIndividualBornAdultBiomass
      : this.fieldMass(this.daphniaBornAdults);
    const adults = founderAdults + bornAdults;
    const approximateDaphniaCount = this.individualDaphniaManaged
      ? this.daphniaIndividualCount
      : Math.max(
        0,
        Math.round(
          juvenile / PLANKTON_ECOLOGY_RULES.daphnia.representativeJuvenileBiomass +
          adults / PLANKTON_ECOLOGY_RULES.daphnia.representativeAdultBiomass,
        ),
      );
    const snapshot = reuse ?? {} as PlanktonSnapshot;
    snapshot.phytoplanktonBiomass = this.fieldMass(this.phytoplankton);
    snapshot.planktonicDecomposerBiomass = this.fieldMass(this.planktonicDecomposer);
    snapshot.daphniaJuvenileBiomass = juvenile;
    snapshot.daphniaAdultBiomass = adults;
    snapshot.daphniaFounderAdultBiomass = founderAdults;
    snapshot.daphniaBornAdultBiomass = bornAdults;
    snapshot.approximateDaphniaCount = approximateDaphniaCount;
    snapshot.cumulativeFiltration ??= {} as PlanktonSnapshot['cumulativeFiltration'];
    snapshot.cumulativeFiltration.phytoplankton =
      this.cumulativeFilteredPhytoplankton;
    snapshot.cumulativeFiltration.planktonicDecomposer =
      this.cumulativeFilteredPlanktonicDecomposer;
    snapshot.cumulativeEvents ??= {} as PlanktonSnapshot['cumulativeEvents'];
    snapshot.cumulativeEvents.births = this.cumulativeDaphniaBirths;
    snapshot.cumulativeEvents.maturations = this.cumulativeDaphniaMaturations;
    snapshot.cumulativeEvents.secondGenerationBirths =
      this.cumulativeSecondGenerationBirths;
    snapshot.cumulativeEvents.deaths = this.cumulativeDaphniaDeaths;
    snapshot.fluxes ??= {} as PlanktonSnapshot['fluxes'];
    snapshot.fluxes.phytoplanktonGrowthPerSecond =
      this.stepPhytoplanktonGrowth / this.stepDurationSeconds;
    snapshot.fluxes.phytoplanktonRespirationPerSecond =
      this.stepPhytoplanktonRespiration / this.stepDurationSeconds;
    snapshot.fluxes.phytoplanktonMortalityPerSecond =
      this.stepPhytoplanktonMortality / this.stepDurationSeconds;
    snapshot.fluxes.daphniaFoodAssimilatedPerSecond =
      this.stepDaphniaAssimilation / this.stepDurationSeconds;
    snapshot.fluxes.daphniaRespirationPerSecond =
      this.stepDaphniaRespiration / this.stepDurationSeconds;
    snapshot.fluxes.daphniaMortalityPerSecond =
      this.stepDaphniaMortality / this.stepDurationSeconds;
    return snapshot;
  }

  private applyPlanktonicDecomposerReactions(deltaSeconds: number): void {
    const kinetics = MICROBE_ECOLOGY_RULES.decomposer;
    for (let index = 0; index < this.cellCount; index += 1) {
      const biomass = this.planktonicDecomposer[index] / this.cellCount;
      if (biomass <= 0) continue;
      if (biomass <= 1e-12) {
        // Values below the numerical reaction scale must not become an
        // immortal, uneatable refuge. Snap the field to zero and move every
        // remaining unit into detritus so the closed material ledger is exact.
        this.planktonicDecomposer[index] = 0;
        this.detritus[index] += biomass;
        continue;
      }
      const substrate = this.organicMatter[index];
      const localOxygen = this.oxygen[index];
      const activity = saturation(substrate, kinetics.halfSaturation) *
        saturation(localOxygen, kinetics.oxygenHalfSaturation);
      const temperatureFactor = thetaTemperatureFactor(
        this.temperatureAt(this.pointAtIndex(index)),
        kinetics.referenceTemperature,
        kinetics.temperatureCoefficient,
      );
      const requested = biomass * kinetics.maximumUptake * 0.78 *
        activity * temperatureFactor * deltaSeconds;
      const availableFood = this.organicMatter[index] / this.cellCount;
      const retainedFraction = kinetics.biomassYield * 0.72;
      const oxygenPerFood = organicCarbonOxygenDemand(
        (1 - retainedFraction) * WATER_CYCLE_RULES.biomassCarbon,
      );
      const availableOxygen = this.oxygen[index] / this.cellCount;
      const consumed = Math.min(
        requested,
        availableFood,
        availableOxygen / Math.max(1e-9, oxygenPerFood),
      );
      if (consumed > 0) {
        this.organicMatter[index] = finiteConcentration(
          this.organicMatter[index] - consumed * this.cellCount,
        );
        const growth = consumed * retainedFraction;
        const mineralized = consumed - growth;
        this.planktonicDecomposer[index] = finiteBiomassConcentration(
          this.planktonicDecomposer[index] + growth * this.cellCount,
        );
        const oxygenDemand = organicCarbonOxygenDemand(
          mineralized * WATER_CYCLE_RULES.biomassCarbon,
        );
        this.oxygen[index] = finiteConcentration(
          this.oxygen[index] - oxygenDemand * this.cellCount,
        );
        this.toxicWaste[index] = finiteConcentration(
          this.toxicWaste[index] +
          mineralized * WATER_CYCLE_RULES.biomassNitrogen * this.cellCount,
        );
        this.dissolvedInorganicCarbon[index] = finiteConcentration(
          this.dissolvedInorganicCarbon[index] +
          mineralized * WATER_CYCLE_RULES.biomassCarbon * this.cellCount,
        );
        this.cumulativeOxygenDemand += oxygenDemand;
        this.cumulativeDissolvedWaste +=
          mineralized * WATER_CYCLE_RULES.biomassNitrogen;
      }

      const realized = requested > 0 ? clamp(consumed / requested, 0, 1) : 0;
      const decayRate = (
        kinetics.maintenanceDecayRate * 0.75 +
        kinetics.starvationDecayRate * 0.6 * (1 - realized)
      ) * temperatureFactor;
      const currentMass = this.planktonicDecomposer[index] / this.cellCount;
      const death = currentMass * (1 - Math.exp(-decayRate * deltaSeconds));
      if (death > 0) {
        this.planktonicDecomposer[index] = finiteBiomassConcentration(
          this.planktonicDecomposer[index] - death * this.cellCount,
        );
        this.detritus[index] += death;
      }
    }
  }

  private applyPhytoplanktonReactions(deltaSeconds: number): void {
    const rules = PLANKTON_ECOLOGY_RULES.phytoplankton;
    const settlingFraction = 1 - Math.exp(-rules.settlingPerSecond * deltaSeconds);
    const downward = this.phytoplanktonDownwardScratch;
    downward.fill(0);
    // Use the pre-reaction water column for optical depth so the result is
    // independent of loop order. Biomass in and above a cell attenuates light
    // continuously; no biomass amount is made inaccessible to grazers.
    const opticalDepth = this.phytoplanktonOpticalDepthScratch;
    opticalDepth.fill(0);
    for (let column = 0; column < this.columns; column += 1) {
      let cumulativeConcentration = 0;
      for (let row = 0; row < this.rows; row += 1) {
        const index = row * this.columns + column;
        const localConcentration = Math.max(0, this.phytoplankton[index]);
        opticalDepth[index] = (
          cumulativeConcentration + localConcentration * 0.5
        ) * rules.selfShadingPerColumnConcentration;
        cumulativeConcentration += localConcentration;
      }
    }
    for (let index = 0; index < this.cellCount; index += 1) {
      const biomass = this.phytoplankton[index] / this.cellCount;
      if (biomass <= 0) continue;
      if (biomass <= 1e-12) {
        // Do not freeze a trace producer population below the numerical
        // reaction scale. Its full conserved mass becomes detritus.
        this.phytoplankton[index] = 0;
        this.detritus[index] += biomass;
        this.stepPhytoplanktonMortality += biomass;
        continue;
      }
      const light = this.planktonLight[index] * Math.exp(-opticalDepth[index]);
      const lightLimited = saturation(light, rules.lightHalfSaturation);
      const photoInhibition = light <= rules.photoInhibitionStart
        ? 1
        : clamp(
          1 - (light - rules.photoInhibitionStart) /
            Math.max(1, 120 - rules.photoInhibitionStart) * 0.48,
          0.52,
          1,
        );
      const point = this.pointAtIndex(index);
      const mineralNitrogen =
        this.toxicWaste[index] + this.nutrients[index];
      const carbon = this.dissolvedInorganicCarbon[index];
      const waterClarity = Math.exp(
        -WATER_CYCLE_RULES.algae.organicLightAttenuation *
          this.organicMatter[index],
      );
      const resource = Math.min(
        saturation(mineralNitrogen, rules.mineralNitrogenHalfSaturation),
        saturation(carbon, rules.carbonHalfSaturation),
      ) * waterClarity;
      const temperature = this.temperatureAt(this.pointAtIndex(index));
      const temperatureFactor = clamp(1 - Math.abs(temperature - 24) / 20, 0.12, 1);
      const requestedGrowth = biomass * rules.maximumGrowthPerSecond *
        lightLimited * photoInhibition * resource * temperatureFactor *
        deltaSeconds;
      const growth = this.commitAlgaeProduction(
        point,
        requestedGrowth,
      );
      if (growth > 0) {
        this.phytoplankton[index] = finiteBiomassConcentration(
          this.phytoplankton[index] + growth * this.cellCount,
        );
        this.stepPhytoplanktonGrowth += growth;
      }

      const afterGrowth = this.phytoplankton[index] / this.cellCount;
      const respirationRequest = Math.min(
        afterGrowth,
        afterGrowth * rules.respirationPerSecond *
          thetaTemperatureFactor(temperature, 24, 1.06, 0.45, 1.8) *
          deltaSeconds,
      );
      const respired = this.commitAlgaeRespiration(
        point,
        respirationRequest,
      );
      if (respired > 0) {
        this.phytoplankton[index] = finiteBiomassConcentration(
          this.phytoplankton[index] - respired * this.cellCount,
        );
        this.stepPhytoplanktonRespiration += respired;
      }

      const remaining = this.phytoplankton[index] / this.cellCount;
      const darkness = 1 - lightLimited;
      const mortalityRate = rules.backgroundMortalityPerSecond +
        rules.darkStressMortalityPerSecond * darkness * darkness;
      const mortality = remaining * (1 - Math.exp(-mortalityRate * deltaSeconds));
      if (mortality > 0) {
        this.phytoplankton[index] = finiteBiomassConcentration(
          this.phytoplankton[index] - mortality * this.cellCount,
        );
        this.detritus[index] += mortality;
        this.stepPhytoplanktonMortality += mortality;
      }

      const settleConcentration = this.phytoplankton[index] * settlingFraction;
      if (settleConcentration <= 0) continue;
      this.phytoplankton[index] -= settleConcentration;
      const row = Math.floor(index / this.columns);
      if (row >= this.rows - 1) {
        this.detritus[index] += settleConcentration / this.cellCount;
      } else {
        downward[index + this.columns] += settleConcentration;
      }
    }
    for (let index = 0; index < this.cellCount; index += 1) {
      if (downward[index] <= 0) continue;
      this.phytoplankton[index] = finiteBiomassConcentration(
        this.phytoplankton[index] + downward[index],
      );
    }
  }

  private maintainDaphniaField(
    field: Float64Array,
    index: number,
    rate: number,
    metabolicFactor: number,
    deltaSeconds: number,
  ): void {
    const available = field[index] / this.cellCount;
    const requested = Math.min(
      available,
      available * rate * metabolicFactor * deltaSeconds,
    );
    const respired = this.releaseRespiredBiomass(index, requested);
    field[index] = finiteConcentration(field[index] - respired * this.cellCount);
    this.stepDaphniaRespiration += respired;
  }

  private reproduceDaphniaField(
    field: Float64Array,
    index: number,
    foodQuality: number,
    deltaSeconds: number,
    secondGeneration: boolean,
  ): void {
    const rules = PLANKTON_ECOLOGY_RULES.daphnia;
    const currentAdults = field[index] / this.cellCount;
    const birth = currentAdults *
      (1 - Math.exp(
        -rules.reproductionAllocationPerSecond * foodQuality * deltaSeconds,
      ));
    if (birth <= 0) return;
    field[index] -= birth * this.cellCount;
    this.daphniaJuveniles[index] = finiteConcentration(
      this.daphniaJuveniles[index] + birth * this.cellCount,
    );
    this.cumulativeDaphniaBirths += birth;
    if (secondGeneration) this.cumulativeSecondGenerationBirths += birth;
  }

  private applyDaphniaFieldMortality(
    field: Float64Array,
    index: number,
    mortalityRate: number,
    deltaSeconds: number,
  ): void {
    const available = field[index] / this.cellCount;
    const death = available * (1 - Math.exp(-mortalityRate * deltaSeconds));
    if (death <= 0) return;
    field[index] = finiteConcentration(field[index] - death * this.cellCount);
    this.detritus[index] += death;
    this.stepDaphniaMortality += death;
    this.cumulativeDaphniaDeaths += death;
  }

  private applyDaphniaReactions(deltaSeconds: number): void {
    const rules = PLANKTON_ECOLOGY_RULES.daphnia;
    const juvenileMaintenanceRate = continuousBodyMassMaintenance(
      rules.representativeJuvenileBiomass,
      rules.representativeAdultBiomass,
      rules.adultMaintenancePerSecond,
      rules.maintenanceMassExponent,
    ) / rules.representativeJuvenileBiomass;
    for (let index = 0; index < this.cellCount; index += 1) {
      const juvenileMass = this.daphniaJuveniles[index] / this.cellCount;
      const founderMass = this.daphniaFounderAdults[index] / this.cellCount;
      const bornAdultMass = this.daphniaBornAdults[index] / this.cellCount;
      const adultMass = founderMass + bornAdultMass;
      const totalMass = juvenileMass + adultMass;
      if (totalMass <= 0) continue;
      if (totalMass <= 1e-12) {
        // Legacy density-grid saves use these fields. Clear sub-resolution
        // remnants into detritus instead of leaving an immortal trace.
        this.daphniaJuveniles[index] = 0;
        this.daphniaFounderAdults[index] = 0;
        this.daphniaBornAdults[index] = 0;
        this.detritus[index] += totalMass;
        continue;
      }

      const phytoAvailable = this.phytoplankton[index] / this.cellCount;
      const bacteriaAvailable = this.planktonicDecomposer[index] / this.cellCount;
      const foodResponse = daphniaSuspendedFoodResponse(
        this.phytoplankton[index],
        this.planktonicDecomposer[index],
        this.daphniaFoodResponseScratch,
      );
      const requestedFood = totalMass * rules.maximumFiltrationPerBiomassSecond *
        foodResponse.combinedResponse * deltaSeconds;
      const phytoRequested = requestedFood * (1 - foodResponse.bacteriaShare);
      const bacteriaRequested = requestedFood - phytoRequested;
      const phytoConsumed = Math.min(phytoAvailable, phytoRequested);
      const bacteriaConsumed = Math.min(bacteriaAvailable, bacteriaRequested);
      this.phytoplankton[index] = finiteConcentration(
        this.phytoplankton[index] - phytoConsumed * this.cellCount,
      );
      this.planktonicDecomposer[index] = finiteConcentration(
        this.planktonicDecomposer[index] - bacteriaConsumed * this.cellCount,
      );
      this.cumulativeFilteredPhytoplankton += phytoConsumed;
      this.cumulativeFilteredPlanktonicDecomposer += bacteriaConsumed;

      const assimilated = phytoConsumed * rules.phytoplanktonAssimilation +
        bacteriaConsumed * rules.bacterioplanktonAssimilation;
      const consumed = phytoConsumed + bacteriaConsumed;
      const feces = Math.max(0, consumed - assimilated);
      this.detritus[index] += feces;
      this.stepDaphniaAssimilation += assimilated;

      if (assimilated > 0) {
        const juvenileShare = totalMass > 0 ? juvenileMass / totalMass : 0;
        const juvenileGain = assimilated * juvenileShare;
        const adultGain = assimilated - juvenileGain;
        this.daphniaJuveniles[index] = finiteConcentration(
          this.daphniaJuveniles[index] + juvenileGain * this.cellCount,
        );
        if (adultMass > 0) {
          this.daphniaFounderAdults[index] = finiteConcentration(
            this.daphniaFounderAdults[index] +
            adultGain * founderMass / adultMass * this.cellCount,
          );
          this.daphniaBornAdults[index] = finiteConcentration(
            this.daphniaBornAdults[index] +
            adultGain * bornAdultMass / adultMass * this.cellCount,
          );
        } else {
          this.daphniaJuveniles[index] = finiteConcentration(
            this.daphniaJuveniles[index] + adultGain * this.cellCount,
          );
        }
      }

      const temperature = this.temperatureAt(this.pointAtIndex(index));
      const metabolicFactor = thetaTemperatureFactor(temperature, 22, 1.07, 0.5, 1.7);
      this.maintainDaphniaField(
        this.daphniaJuveniles,
        index,
        juvenileMaintenanceRate,
        metabolicFactor,
        deltaSeconds,
      );
      this.maintainDaphniaField(
        this.daphniaFounderAdults,
        index,
        rules.adultMaintenancePerSecond,
        metabolicFactor,
        deltaSeconds,
      );
      this.maintainDaphniaField(
        this.daphniaBornAdults,
        index,
        rules.adultMaintenancePerSecond,
        metabolicFactor,
        deltaSeconds,
      );

      const fullRation = totalMass * rules.maximumFiltrationPerBiomassSecond *
        deltaSeconds;
      const ration = fullRation > 0 ? clamp(consumed / fullRation, 0, 1) : 0;
      const foodQuality = consumed > 0
        ? clamp(
          (phytoConsumed + bacteriaConsumed * rules.bacterioplanktonAssimilation /
            rules.phytoplanktonAssimilation) / consumed,
          0,
          1,
        ) * ration
        : 0;

      const currentJuveniles = this.daphniaJuveniles[index] / this.cellCount;
      if (
        currentJuveniles > 0 &&
        foodQuality >= rules.minimumFoodQualityForMaturation
      ) {
        const maturation = currentJuveniles *
          (1 - Math.exp(
            -rules.juvenileMaturationPerSecond * foodQuality * deltaSeconds,
          ));
        this.daphniaJuveniles[index] -= maturation * this.cellCount;
        this.daphniaBornAdults[index] = finiteConcentration(
          this.daphniaBornAdults[index] + maturation * this.cellCount,
        );
        this.cumulativeDaphniaMaturations += maturation;
      }

      if (foodQuality >= rules.minimumFoodQualityForReproduction) {
        this.reproduceDaphniaField(
          this.daphniaFounderAdults,
          index,
          foodQuality,
          deltaSeconds,
          false,
        );
        this.reproduceDaphniaField(
          this.daphniaBornAdults,
          index,
          foodQuality,
          deltaSeconds,
          true,
        );
      }

      const oxygenStress = clamp(
        (rules.oxygenStressStart - this.oxygen[index]) /
          rules.oxygenStressStart,
        0,
        1,
      );
      const toxicityStress = clamp(
        (this.toxicWaste[index] - rules.toxicWasteStressStart) /
          Math.max(1, 24 - rules.toxicWasteStressStart),
        0,
        1,
      );
      const starvation = clamp(1 - foodQuality / 0.32, 0, 1);
      const mortalityRate = rules.backgroundMortalityPerSecond +
        rules.starvationMortalityPerSecond * starvation * starvation +
        0.008 * oxygenStress * oxygenStress +
        0.006 * toxicityStress * toxicityStress;
      this.applyDaphniaFieldMortality(
        this.daphniaJuveniles,
        index,
        mortalityRate,
        deltaSeconds,
      );
      this.applyDaphniaFieldMortality(
        this.daphniaFounderAdults,
        index,
        mortalityRate,
        deltaSeconds,
      );
      this.applyDaphniaFieldMortality(
        this.daphniaBornAdults,
        index,
        mortalityRate,
        deltaSeconds,
      );
    }
  }

  private applyBiofilmReactions(deltaSeconds: number, sites: BiofilmReactionSite[]): void {
    // Explicit two-stage reaction step:
    // 1. every guild reads the same pre-reaction concentrations;
    // 2. withdrawals and product capacities are allocated from separate
    //    budgets, so a product made earlier in this loop cannot be eaten in
    //    the same Euler step.
    //
    // Stable spatial ordering makes competition deterministic without making
    // results depend on the caller's surface-cell array order.
    const initialOrganicMatter = this.initialOrganicMatterScratch;
    const initialToxicWaste = this.initialToxicWasteScratch;
    const initialNutrients = this.initialNutrientsScratch;
    const initialOxygen = this.initialOxygenScratch;
    const initialCarbon = this.initialCarbonScratch;
    const organicWithdrawal = this.organicWithdrawalScratch;
    const toxicWasteWithdrawal = this.toxicWasteWithdrawalScratch;
    const oxygenWithdrawal = this.oxygenWithdrawalScratch;
    const carbonWithdrawal = this.carbonWithdrawalScratch;
    const toxicWasteProducts = this.toxicWasteProductsScratch;
    const nutrientProducts = this.nutrientProductsScratch;
    const carbonProducts = this.carbonProductsScratch;
    // Keep all reaction budgets in their existing backing stores. Repeated
    // TypedArray#set calls dominated the worker's transient allocation profile
    // under Electron even though the arrays themselves were long-lived.
    for (let index = 0; index < this.cellCount; index += 1) {
      const organic = this.organicMatter[index];
      const toxicWaste = this.toxicWaste[index];
      const nutrient = this.nutrients[index];
      const oxygen = this.oxygen[index];
      const carbon = this.dissolvedInorganicCarbon[index];
      initialOrganicMatter[index] = organic;
      initialToxicWaste[index] = toxicWaste;
      initialNutrients[index] = nutrient;
      initialOxygen[index] = oxygen;
      initialCarbon[index] = carbon;
      organicWithdrawal[index] = organic;
      toxicWasteWithdrawal[index] = toxicWaste;
      oxygenWithdrawal[index] = oxygen;
      carbonWithdrawal[index] = carbon;
      toxicWasteProducts[index] = toxicWaste;
      nutrientProducts[index] = nutrient;
      carbonProducts[index] = carbon;
    }
    // The caller supplies a reusable scratch array, so sorting that array in
    // place preserves deterministic reaction ordering without allocating
    // another full list every simulated second.
    let sitesAlreadyOrdered = true;
    for (let index = 1; index < sites.length; index += 1) {
      if (
        compareBiofilmReactionSites(sites[index - 1], sites[index]) <= 0
      ) continue;
      sitesAlreadyOrdered = false;
      break;
    }
    const orderedSites = sitesAlreadyOrdered
      ? sites
      : sites.sort(compareBiofilmReactionSites);

    for (const site of orderedSites) {
      const initialDecomposer = clamp(site.biofilm.decomposer, 0, 1);
      const initialNitrifier = clamp(site.biofilm.nitrifier, 0, 1);
      site.biofilm.decomposer = initialDecomposer;
      site.biofilm.nitrifier = initialNitrifier;
      // Both guilds occupy the same physical film at the beginning of this
      // reaction step. Reading occupancy again after the decomposer update
      // gave the first guild a permanent code-order advantage: nitrifiers saw
      // less free surface simply because they were evaluated second. Growth
      // and crowding must therefore use one shared pre-reaction occupancy;
      // any overshoot is resolved proportionally after both updates below.
      const occupied = initialDecomposer + initialNitrifier;
      const freeSurface = clamp(1 - occupied, 0, 1);
      const index = this.indexAt(site.point);

      for (let guildIndex = 0; guildIndex < 2; guildIndex += 1) {
        const guildId: MicrobeGuildId = guildIndex === 0
          ? 'decomposer'
          : 'nitrifier';
        const biomass = guildId === 'decomposer'
          ? initialDecomposer
          : initialNitrifier;
        if (biomass <= 0) continue;
        const kinetics = MICROBE_ECOLOGY_RULES[guildId];
        const substrate = guildId === 'decomposer'
          ? initialOrganicMatter[index]
          : initialToxicWaste[index];
        const activity = saturation(substrate, kinetics.halfSaturation) *
          saturation(initialOxygen[index], kinetics.oxygenHalfSaturation);
        const temperatureFactor = thetaTemperatureFactor(
          this.temperatureAt(site.point),
          kinetics.referenceTemperature,
          kinetics.temperatureCoefficient,
        );
        const requested = biomass * kinetics.maximumUptake * activity *
          temperatureFactor * deltaSeconds;
        const foodField = guildId === 'decomposer' ? this.organicMatter : this.toxicWaste;
        const foodWithdrawal = guildId === 'decomposer'
          ? organicWithdrawal
          : toxicWasteWithdrawal;
        const foodAvailable = this.massAround(foodWithdrawal, index);
        const oxygenAvailable = this.massAround(oxygenWithdrawal, index);
        let actual = Math.min(requested, foodAvailable);

        if (guildId === 'decomposer') {
          const retainedFraction = kinetics.biomassYield * freeSurface;
          const mineralizedFraction = Math.max(0, 1 - retainedFraction);
          const oxygenPerSubstrate = organicCarbonOxygenDemand(
            mineralizedFraction * WATER_CYCLE_RULES.biomassCarbon,
          );
          const productPerSubstrate = (1 - retainedFraction) *
            WATER_CYCLE_RULES.biomassNitrogen;
          const productCapacity = this.capacityAround(toxicWasteProducts, index);
          const carbonProductCapacity = this.capacityAround(
            carbonProducts,
            index,
          );
          const carbonPerSubstrate = mineralizedFraction *
            WATER_CYCLE_RULES.biomassCarbon;
          actual = Math.min(
            actual,
            oxygenAvailable / Math.max(1e-9, oxygenPerSubstrate),
            productCapacity / Math.max(1e-9, productPerSubstrate),
            carbonProductCapacity / Math.max(1e-9, carbonPerSubstrate),
          );
        } else {
          const retainedNitrogenFraction = kinetics.biomassYield * freeSurface;
          const productCapacity = this.capacityAround(nutrientProducts, index);
          const availableCarbon = this.massAround(carbonWithdrawal, index);
          let reaction = this.nitrifierReaction(
            actual,
            retainedNitrogenFraction,
            availableCarbon,
          );
          if (
            reaction.oxygenDemand > oxygenAvailable + 1e-12 ||
            reaction.nitrateProduced > productCapacity + 1e-12
          ) {
            let low = 0;
            let high = actual;
            for (let iteration = 0; iteration < 32; iteration += 1) {
              const middle = (low + high) / 2;
              reaction = this.nitrifierReaction(
                middle,
                retainedNitrogenFraction,
                availableCarbon,
              );
              if (
                reaction.oxygenDemand <= oxygenAvailable + 1e-12 &&
                reaction.nitrateProduced <= productCapacity + 1e-12
              ) {
                low = middle;
              } else {
                high = middle;
              }
            }
            actual = low;
          }
        }

        const consumed = this.removeMassAround(foodWithdrawal, index, actual);
        this.removeMassAround(foodField, index, consumed);

        let growth = 0;
        let oxygenDemand = 0;
        if (guildId === 'decomposer') {
          growth = consumed * kinetics.biomassYield * freeSurface;
          const mineralized = Math.max(0, consumed - growth);
          oxygenDemand = organicCarbonOxygenDemand(
            mineralized * WATER_CYCLE_RULES.biomassCarbon,
          );
          const releasedNitrogen = mineralized * WATER_CYCLE_RULES.biomassNitrogen;
          const releasedCarbon = mineralized * WATER_CYCLE_RULES.biomassCarbon;
          this.addMassAround(
            toxicWasteProducts,
            index,
            releasedNitrogen,
          );
          this.addMassAround(
            this.toxicWaste,
            index,
            releasedNitrogen,
          );
          this.addMassAround(
            carbonProducts,
            index,
            releasedCarbon,
          );
          this.addMassAround(
            this.dissolvedInorganicCarbon,
            index,
            releasedCarbon,
          );
          this.cumulativeDissolvedWaste += releasedNitrogen;
        } else {
          const retainedNitrogen = consumed * kinetics.biomassYield * freeSurface;
          const potentialGrowth = retainedNitrogen / WATER_CYCLE_RULES.biomassNitrogen;
          const availableCarbon = this.massAround(this.dissolvedInorganicCarbon, index);
          const carbonLimitedGrowth = Math.min(
            potentialGrowth,
            availableCarbon / WATER_CYCLE_RULES.biomassCarbon,
          );
          const reaction = nitrifierStoichiometry(
            consumed,
            carbonLimitedGrowth,
            this.nitrifierReactionScratch,
          );
          growth = reaction.growthBiomass;
          oxygenDemand = reaction.oxygenDemand;
          this.removeMassAround(
            carbonWithdrawal,
            index,
            reaction.fixedCarbon,
          );
          this.removeMassAround(
            this.dissolvedInorganicCarbon,
            index,
            reaction.fixedCarbon,
          );
          this.addMassAround(
            nutrientProducts,
            index,
            reaction.nitrateProduced,
          );
          this.addMassAround(
            this.nutrients,
            index,
            reaction.nitrateProduced,
          );
        }
        this.removeMassAround(oxygenWithdrawal, index, oxygenDemand);
        const removedOxygen = this.removeMassAround(this.oxygen, index, oxygenDemand);
        this.cumulativeOxygenDemand += removedOxygen;

        const realizedActivity = requested > 0
          ? activity * clamp(consumed / requested, 0, 1)
          : 0;
        const decayRate = (
          kinetics.maintenanceDecayRate +
          kinetics.starvationDecayRate * (1 - realizedActivity)
        ) * temperatureFactor;
        const decay = biomass * (1 - Math.exp(-decayRate * deltaSeconds));
        const crowded = clamp((occupied - 0.88) / 0.12, 0, 1);
        const slough = Math.max(0, biomass + growth - decay) *
          (1 - Math.exp(-0.006 * crowded * crowded * deltaSeconds));
        site.biofilm[guildId] = Math.max(0, biomass + growth - decay - slough);
        this.detritus[index] += decay + slough;
      }

      const total = site.biofilm.decomposer + site.biofilm.nitrifier;
      if (total > 1) {
        const excess = total - 1;
        site.biofilm.decomposer /= total;
        site.biofilm.nitrifier /= total;
        this.detritus[index] += excess;
      }
    }
  }

  private nitrifierReaction(
    processedNitrogen: number,
    retainedNitrogenFraction: number,
    availableCarbon: number,
  ): NitrifierStoichiometry {
    const potentialGrowth =
      processedNitrogen * retainedNitrogenFraction /
      WATER_CYCLE_RULES.biomassNitrogen;
    const carbonLimitedGrowth = Math.min(
      potentialGrowth,
      availableCarbon / WATER_CYCLE_RULES.biomassCarbon,
    );
    return nitrifierStoichiometry(
      processedNitrogen,
      carbonLimitedGrowth,
      this.nitrifierReactionScratch,
    );
  }

  private releaseRespiredBiomass(index: number, biomass: number): number {
    if (biomass <= 0) return 0;
    const oxygenPerBiomass = organicCarbonOxygenDemand(
      WATER_CYCLE_RULES.biomassCarbon,
    );
    const carbonPerOxygen =
      WATER_CYCLE_RULES.animalRespiratoryQuotient /
      WATER_CYCLE_RULES.oxygenPerOrganicCarbon;
    const carbonPerBiomass = oxygenPerBiomass * carbonPerOxygen;
    const oxygenAvailable = this.massAround(this.oxygen, index);
    const carbonCapacity = this.capacityAroundOrTank(
      this.dissolvedInorganicCarbon,
      index,
      biomass * carbonPerBiomass,
    );
    const nitrogenCapacity = this.capacityAroundOrTank(
      this.toxicWaste,
      index,
      biomass * WATER_CYCLE_RULES.biomassNitrogen,
    );
    const actual = Math.min(
      biomass,
      oxygenPerBiomass > 0 ? oxygenAvailable / oxygenPerBiomass : biomass,
      carbonPerBiomass > 0 ? carbonCapacity / carbonPerBiomass : biomass,
      nitrogenCapacity / WATER_CYCLE_RULES.biomassNitrogen,
    );
    if (actual <= 0) return 0;

    // Withdraw oxygen first. Products are based on the oxygen that was
    // actually removed, so a locally oxygen-limited animal cannot emit the
    // full requested CO2 pulse.
    const requestedOxygen = actual * oxygenPerBiomass;
    const removedOxygen = this.removeMassAround(
      this.oxygen,
      index,
      requestedOxygen,
    );
    const oxygenSupportedBiomass = oxygenPerBiomass > 0
      ? Math.min(actual, removedOxygen / oxygenPerBiomass)
      : actual;
    if (oxygenSupportedBiomass <= 0) return 0;
    const carbon = removedOxygen * carbonPerOxygen;
    // TODO: Split nitrogen excretion from carbon respiration once animals
    // carry explicit C and N compartments. Until then this release is required
    // to close the fixed-composition B nitrogen ledger.
    const nitrogen =
      oxygenSupportedBiomass * WATER_CYCLE_RULES.biomassNitrogen;
    this.addMassAround(this.dissolvedInorganicCarbon, index, carbon);
    this.addMassAround(this.toxicWaste, index, nitrogen);
    this.cumulativeOxygenDemand += removedOxygen;
    this.cumulativeDissolvedWaste += nitrogen;
    return oxygenSupportedBiomass;
  }

  private exchangeClosedHeadspace(deltaSeconds: number): void {
    const response = 1 - Math.exp(-WATER_CYCLE_RULES.closedGasExchangeRate * deltaSeconds);
    const waterOxygen = this.fieldMass(this.oxygen);
    const oxygenEquilibrium = closedOxygenWaterEquilibrium(
      waterOxygen + this.headspaceOxygen,
      this.surfaceTemperature(),
    );
    const oxygenTransfer = (oxygenEquilibrium - waterOxygen) * response;
    if (oxygenTransfer > 0) {
      const dissolved = this.addMassToIndices(
        this.oxygen,
        this.topRowIndices(),
        Math.min(oxygenTransfer, this.headspaceOxygen),
      );
      this.headspaceOxygen -= dissolved;
    } else if (oxygenTransfer < 0) {
      const released = this.removeMassFromIndices(
        this.oxygen,
        this.topRowIndices(),
        -oxygenTransfer,
      );
      this.headspaceOxygen += released;
    }

    const waterCarbon = this.fieldMass(this.dissolvedInorganicCarbon);
    const carbonEquilibrium = (waterCarbon + this.headspaceCarbonDioxide) / 2;
    const carbonTransfer = (carbonEquilibrium - waterCarbon) * response * 0.45;
    if (carbonTransfer > 0) {
      const moved = this.addMassToIndices(
        this.dissolvedInorganicCarbon,
        this.topRowIndices(),
        Math.min(carbonTransfer, this.headspaceCarbonDioxide),
      );
      this.headspaceCarbonDioxide -= moved;
    } else {
      const moved = this.removeMassFromIndices(
        this.dissolvedInorganicCarbon,
        this.topRowIndices(),
        -carbonTransfer,
      );
      this.headspaceCarbonDioxide += moved;
    }
  }

  private gasExchangeState(material = this.materialState()): BiogeochemistrySnapshot['gasExchange'] {
    const surfaceTemperature = this.surfaceTemperature();
    return {
      surfaceTemperature,
      oxygenSolubilityMgL: freshwaterOxygenSolubilityMgL(surfaceTemperature),
      oxygenSolubilityRatio: relativeOxygenSolubility(surfaceTemperature),
      oxygenWaterEquilibrium: closedOxygenWaterEquilibrium(
        material.dissolvedOxygen + material.headspaceOxygen,
        surfaceTemperature,
      ),
    };
  }

  private fieldMass(field: Float32Array | Float64Array): number {
    let total = 0;
    for (let index = 0; index < field.length; index += 1) {
      total += field[index];
    }
    return total / this.cellCount;
  }

  private copyPlanktonLight(light: ArrayLike<number>): void {
    for (let index = 0; index < this.cellCount; index += 1) {
      const value = Number(light[index] ?? 0);
      this.planktonLight[index] = Number.isFinite(value)
        ? clamp(value, 0, 120)
        : 0;
    }
  }

  private pointAtIndex(index: number): Vec2 {
    return this.waterCellPoints[index];
  }

  private indicesAround(index: number, radius = LOCAL_REACTION_RADIUS): number[] {
    if (radius === LOCAL_REACTION_RADIUS) return this.reactionNeighborhoods[index];
    const centerRow = Math.floor(index / this.columns);
    const centerColumn = index % this.columns;
    const indices: number[] = [];
    for (let row = Math.max(0, centerRow - radius); row <= Math.min(this.rows - 1, centerRow + radius); row += 1) {
      for (let column = Math.max(0, centerColumn - radius); column <= Math.min(this.columns - 1, centerColumn + radius); column += 1) {
        indices.push(row * this.columns + column);
      }
    }
    return indices;
  }

  private topRowIndices(): number[] {
    return this.topSurfaceIndices;
  }

  private massAround(field: Float32Array | Float64Array, index: number): number {
    const indices = this.indicesAround(index);
    let total = 0;
    for (let offset = 0; offset < indices.length; offset += 1) {
      total += field[indices[offset]];
    }
    return total / this.cellCount;
  }

  private capacityAround(field: Float32Array | Float64Array, index: number): number {
    const indices = this.indicesAround(index);
    let capacity = 0;
    for (let offset = 0; offset < indices.length; offset += 1) {
      capacity += Math.max(
        0,
        MAX_CONCENTRATION - field[indices[offset]],
      );
    }
    return capacity / this.cellCount;
  }

  private fieldCapacity(field: Float32Array | Float64Array): number {
    let capacity = 0;
    for (let index = 0; index < field.length; index += 1) {
      capacity += Math.max(0, MAX_CONCENTRATION - field[index]);
    }
    return capacity / this.cellCount;
  }

  /**
   * Reaction products normally fit in the local stencil. Only scan the whole
   * tank when that stencil is genuinely saturated and addMassAround would
   * need its tank-wide overflow path. This keeps exact product accounting
   * without turning every organism's respiration into a full-grid reduction.
   */
  private capacityAroundOrTank(
    field: Float32Array | Float64Array,
    index: number,
    required: number,
  ): number {
    const localCapacity = this.capacityAround(field, index);
    return localCapacity >= required
      ? localCapacity
      : this.fieldCapacity(field);
  }

  private removeMassAround(
    field: Float32Array | Float64Array,
    index: number,
    requested: number,
  ): number {
    return this.removeMassFromIndices(field, this.indicesAround(index), requested);
  }

  private addMassAround(
    field: Float32Array | Float64Array,
    index: number,
    requested: number,
  ): number {
    const local = this.indicesAround(index);
    const locallyAdded = this.addMassToIndices(field, local, requested);
    if (locallyAdded >= requested - 1e-12) return locallyAdded;
    return locallyAdded + this.addMassToIndices(
      field,
      this.allWaterIndices,
      requested - locallyAdded,
    );
  }

  private removeMassFromIndices(
    field: Float32Array | Float64Array,
    indices: number[],
    requested: number,
  ): number {
    if (requested <= 0 || !indices.length) return 0;
    let availableConcentration = 0;
    for (let offset = 0; offset < indices.length; offset += 1) {
      availableConcentration += field[indices[offset]];
    }
    const available = availableConcentration / this.cellCount;
    const actual = Math.min(requested, available);
    if (actual <= 0 || available <= 0) return 0;
    const ratio = actual / available;
    for (let offset = 0; offset < indices.length; offset += 1) {
      const index = indices[offset];
      field[index] = finiteConcentration(field[index] * (1 - ratio));
    }
    return actual;
  }

  private addMassToIndices(
    field: Float32Array | Float64Array,
    indices: number[],
    requested: number,
  ): number {
    if (requested <= 0 || !indices.length) return 0;
    let availableCapacity = 0;
    for (let offset = 0; offset < indices.length; offset += 1) {
      availableCapacity += Math.max(
        0,
        MAX_CONCENTRATION - field[indices[offset]],
      );
    }
    const capacity = availableCapacity / this.cellCount;
    const actual = Math.min(requested, capacity);
    if (actual <= 0 || capacity <= 0) return 0;
    const ratio = actual / capacity;
    for (let offset = 0; offset < indices.length; offset += 1) {
      const index = indices[offset];
      const free = Math.max(0, MAX_CONCENTRATION - field[index]);
      field[index] = finiteConcentration(field[index] + free * ratio);
    }
    return actual;
  }

  private indexAt(point: Vec2): number {
    const column = clamp(Math.floor((point.x / this.tankWidth) * this.columns), 0, this.columns - 1);
    const row = clamp(
      Math.floor(((point.y - this.waterTop) / (this.groundY - this.waterTop)) * this.rows),
      0,
      this.rows - 1,
    );
    return row * this.columns + column;
  }
}
