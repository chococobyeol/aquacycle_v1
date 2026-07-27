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
  MICROBE_ECOLOGY_RULES,
  PLANKTON_ECOLOGY_RULES,
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

export interface ShrimpFoodCueSite {
  point: Vec2;
  /** Non-material dissolved cue emitted by edible surface biomass. */
  strength: number;
}

export interface ShrimpMateCueSite {
  point: Vec2;
  strength: number;
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

  private readonly detritus = new Float64Array(CELL_COUNT);
  // Chemistry uses Float64 because these are conserved ledgers, not render
  // buffers. Float32 rounding was small per step but accumulated measurably
  // across tens of thousands of closed day/night reaction steps.
  private readonly organicMatter = new Float64Array(CELL_COUNT);
  private readonly toxicWaste = new Float64Array(CELL_COUNT);
  private readonly nutrients = new Float64Array(CELL_COUNT);
  private readonly oxygen = new Float64Array(CELL_COUNT);
  private readonly dissolvedInorganicCarbon = new Float64Array(CELL_COUNT);
  private readonly planktonicDecomposer = new Float64Array(CELL_COUNT);
  private readonly phytoplankton = new Float64Array(CELL_COUNT);
  private readonly daphniaJuveniles = new Float64Array(CELL_COUNT);
  private readonly daphniaFounderAdults = new Float64Array(CELL_COUNT);
  private readonly daphniaBornAdults = new Float64Array(CELL_COUNT);
  private readonly planktonLight = new Float64Array(CELL_COUNT);
  private readonly shrimpFoodCue = new Float64Array(CELL_COUNT);
  private readonly shrimpFoodCueSources = new Float64Array(CELL_COUNT);
  private readonly shrimpMateCue = new Float64Array(CELL_COUNT);
  private readonly shrimpMateCueSources = new Float64Array(CELL_COUNT);
  /**
   * These fields are workspaces, not ecological state.
   *
   * A 64x aquarium executes several reaction steps per worker turn. Allocating
   * another dozen 720-element typed arrays for every one of those steps made
   * Chromium's renderer process retain thousands of V8 backing-store regions
   * on macOS even after garbage collection. Keep one fixed set of buffers and
   * overwrite it before each reaction instead.
   */
  private readonly phytoplanktonDownwardScratch = new Float64Array(CELL_COUNT);
  private readonly phytoplanktonOpticalDepthScratch = new Float64Array(CELL_COUNT);
  private readonly initialOrganicMatterScratch = new Float64Array(CELL_COUNT);
  private readonly initialToxicWasteScratch = new Float64Array(CELL_COUNT);
  private readonly initialNutrientsScratch = new Float64Array(CELL_COUNT);
  private readonly initialOxygenScratch = new Float64Array(CELL_COUNT);
  private readonly initialCarbonScratch = new Float64Array(CELL_COUNT);
  private readonly organicWithdrawalScratch = new Float64Array(CELL_COUNT);
  private readonly toxicWasteWithdrawalScratch = new Float64Array(CELL_COUNT);
  private readonly oxygenWithdrawalScratch = new Float64Array(CELL_COUNT);
  private readonly carbonWithdrawalScratch = new Float64Array(CELL_COUNT);
  private readonly toxicWasteProductsScratch = new Float64Array(CELL_COUNT);
  private readonly nutrientProductsScratch = new Float64Array(CELL_COUNT);
  private readonly carbonProductsScratch = new Float64Array(CELL_COUNT);
  private readonly waterCellPoints = Array.from(
    { length: CELL_COUNT },
    (_, index): Vec2 => {
      const row = Math.floor(index / WATER_COLUMNS);
      const column = index % WATER_COLUMNS;
      return {
        x: (column + 0.5) / WATER_COLUMNS * TANK_WIDTH,
        y: WATER_TOP + (row + 0.5) / WATER_ROWS * (GROUND_Y - WATER_TOP),
      };
    },
  );
  private readonly reactionNeighborhoods = Array.from(
    { length: CELL_COUNT },
    (_, index): number[] => {
      const centerRow = Math.floor(index / WATER_COLUMNS);
      const centerColumn = index % WATER_COLUMNS;
      const indices: number[] = [];
      for (
        let row = Math.max(0, centerRow - LOCAL_REACTION_RADIUS);
        row <= Math.min(WATER_ROWS - 1, centerRow + LOCAL_REACTION_RADIUS);
        row += 1
      ) {
        for (
          let column = Math.max(0, centerColumn - LOCAL_REACTION_RADIUS);
          column <= Math.min(WATER_COLUMNS - 1, centerColumn + LOCAL_REACTION_RADIUS);
          column += 1
        ) {
          indices.push(row * WATER_COLUMNS + column);
        }
      }
      return indices;
    },
  );
  private readonly topSurfaceIndices = Array.from(
    { length: WATER_COLUMNS },
    (_, column) => column,
  );
  private readonly allWaterIndices = Array.from(
    { length: CELL_COUNT },
    (_, index) => index,
  );
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
  private shrimpFoodCueActive = false;
  private shrimpMateCueActive = false;
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
    initialTemperature?: number;
  }) {
    this.effectsEnabled = options?.effectsEnabled ?? false;
    this.transport = new WaterTransportGrid(options?.initialTemperature ?? 23.5);
    const initial = { ...DEFAULT_WATER, ...options?.initial };
    this.organicMatter.fill(finiteConcentration(initial.organicMatter));
    this.toxicWaste.fill(finiteConcentration(initial.toxicWaste));
    this.nutrients.fill(finiteConcentration(initial.nutrients));
    this.oxygen.fill(finiteConcentration(initial.oxygen));
    this.dissolvedInorganicCarbon.fill(WATER_CYCLE_RULES.initialDissolvedInorganicCarbon);
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

  public velocityAt(point: Vec2): Vec2 {
    return this.transport.sampleVelocityAt(point);
  }

  /** Local, non-material food odour available to shrimp chemosensation. */
  public shrimpFoodCueAt(point: Vec2): number {
    return this.shrimpFoodCue[this.indexAt(point)];
  }

  /** Short-range, non-material cue released by a receptive shrimp female. */
  public shrimpMateCueAt(point: Vec2): number {
    return this.shrimpMateCue[this.indexAt(point)];
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
    const quality = this.sampleAt(point);
    const mineralNitrogen = quality.toxicWaste + quality.nutrients;
    const carbon = this.dissolvedInorganicCarbon[this.indexAt(point)];
    const waterClarity = Math.exp(
      -WATER_CYCLE_RULES.algae.organicLightAttenuation * quality.organicMatter,
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
  public commitAlgaeProduction(point: Vec2, requestedBiomass: number): number {
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
    const dissolved = this.addMassAround(this.oxygen, index, oxygenProduced);
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
   * Partitions eaten algae into animal reserve, fecal detritus and respiration.
   * The assimilated share is returned so SimulationWorld can store it on the
   * individual animal and later transfer it into growth, offspring or a corpse.
   */
  public recordAnimalFeeding(
    point: Vec2,
    consumedBiomass: number,
    consumer: 'shrimp' | 'ricefish' = 'shrimp',
  ): number {
    const consumed = Math.max(0, consumedBiomass);
    if (consumed <= 0) return 0;
    const partition = WATER_CYCLE_RULES[consumer];
    if (!this.effectsEnabled) {
      const feces = consumed * partition.fecesFraction;
      const respired = consumed * partition.respirationFraction;
      const assimilated = consumed * partition.assimilationFraction;
      this.detritus[this.indexAt(point)] += feces;
      this.cumulativeOxygenDemand += organicCarbonOxygenDemand(
        respired * WATER_CYCLE_RULES.biomassCarbon,
      );
      this.cumulativeDissolvedWaste += respired * WATER_CYCLE_RULES.biomassNitrogen;
      // Earlier missions do not apply water-quality effects, but the animal's
      // internal budget must still use the same assimilation fraction. Returning
      // the whole bite here used to create reserve mass and made the tutorial
      // shrimp obey a different feeding model from the closed-cycle missions.
      return assimilated;
    }
    const index = this.indexAt(point);
    const assimilated = consumed * partition.assimilationFraction;
    const feces = consumed * partition.fecesFraction;
    const respired = consumed - assimilated - feces;
    this.detritus[index] += feces;
    const actuallyRespired = this.releaseRespiredBiomass(index, respired);
    // Under oxygen limitation this share was not mineralised. Keeping it as
    // detritus closes the material and redox ledgers instead of deleting it.
    this.detritus[index] += Math.max(0, respired - actuallyRespired);
    return assimilated;
  }

  /**
   * Returns assimilation that does not fit in an animal's finite reserve to
   * the detritus pool. This is still conserved material: decomposers can use
   * it and the resulting nitrogen/carbon re-enter the water cycle.
   */
  public recordAnimalAssimilationOverflow(point: Vec2, biomass: number): void {
    if (!this.effectsEnabled || biomass <= 0) return;
    this.detritus[this.indexAt(point)] += biomass;
  }

  /** Converts a real loss from animal reserve/body into CO2 and ammonium. */
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
      WATER_CYCLE_RULES.shrimp.adultMaintenanceBiomassPerSecond * deltaSeconds;
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
    const feces = consumed * WATER_CYCLE_RULES.daphnia.fecesFraction;
    const respirationRequest = Math.max(0, consumed - assimilated - feces);
    const index = this.indexAt(point);
    this.detritus[index] += feces;
    if (!this.effectsEnabled) {
      this.stepDaphniaAssimilation += assimilated;
      this.stepDaphniaRespiration += respirationRequest;
      return assimilated;
    }
    const respired = this.releaseRespiredBiomass(index, respirationRequest);
    this.detritus[index] += Math.max(0, respirationRequest - respired);
    this.stepDaphniaAssimilation += assimilated;
    this.stepDaphniaRespiration += respired;
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

  public planktonAt(point: Vec2): {
    phytoplankton: number;
    planktonicDecomposer: number;
    daphniaJuveniles: number;
    daphniaAdults: number;
  } {
    const index = this.indexAt(point);
    return {
      phytoplankton: this.phytoplankton[index],
      planktonicDecomposer: this.planktonicDecomposer[index],
      daphniaJuveniles: this.daphniaJuveniles[index],
      daphniaAdults: this.daphniaFounderAdults[index] + this.daphniaBornAdults[index],
    };
  }

  public advance(
    deltaSeconds: number,
    sites: BiofilmReactionSite[],
    shrimpMateCueSites: ShrimpMateCueSite[] = [],
    shrimpFoodCueSites: ShrimpFoodCueSite[] = [],
  ): void {
    if (deltaSeconds <= 0) return;
    const dt = Math.max(0, deltaSeconds);
    this.advanceShrimpFoodCue(dt, shrimpFoodCueSites);
    this.advanceShrimpMateCue(dt, shrimpMateCueSites);
    if (!this.effectsEnabled) return;
    const solubilization = 1 - Math.exp(-WATER_CYCLE_RULES.detritusSolubilizationRate * dt);
    for (let index = 0; index < CELL_COUNT; index += 1) {
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
      for (const field of [
        this.daphniaJuveniles,
        this.daphniaFounderAdults,
        this.daphniaBornAdults,
      ]) {
        this.transport.disperseConservativeField(
          field,
          dt,
          WATER_TRANSPORT_RULES.localDiffusionPerSecond.daphnia,
        );
      }
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

    this.biofilmTotals = sites.reduce<BiofilmBiomass>((total, site) => ({
      decomposer: total.decomposer + site.biofilm.decomposer,
      nitrifier: total.nitrifier + site.biofilm.nitrifier,
    }), emptyBiofilm());
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
    for (let index = 0; index < CELL_COUNT; index += 1) {
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
    for (let index = 0; index < CELL_COUNT; index += 1) {
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
    for (let index = 0; index < CELL_COUNT; index += 1) {
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
    for (let index = 0; index < CELL_COUNT; index += 1) {
      const retained = this.shrimpMateCue[index] * retention;
      const value = retained >= SHRIMP_MATE_CUE_MINIMUM ? retained : 0;
      this.shrimpMateCue[index] = value;
      active ||= value > 0;
    }
    this.shrimpMateCueActive = active;
    if (!active) this.shrimpMateCueAdvectionAccumulator = 0;
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
    if (state.dissolvedInorganicCarbonField?.length === CELL_COUNT) {
      restoreField(this.dissolvedInorganicCarbon, state.dissolvedInorganicCarbonField);
    } else {
      this.dissolvedInorganicCarbon.fill(
        finiteConcentration(state.dissolvedInorganicCarbon),
      );
    }
    if (state.planktonicDecomposer?.length === CELL_COUNT) {
      restoreField(this.planktonicDecomposer, state.planktonicDecomposer);
    }
    if (state.phytoplankton?.length === CELL_COUNT) {
      restoreField(this.phytoplankton, state.phytoplankton);
    }
    if (state.daphniaJuveniles?.length === CELL_COUNT) {
      restoreField(this.daphniaJuveniles, state.daphniaJuveniles);
    }
    if (state.daphniaFounderAdults?.length === CELL_COUNT) {
      restoreField(this.daphniaFounderAdults, state.daphniaFounderAdults);
    }
    if (state.daphniaBornAdults?.length === CELL_COUNT) {
      restoreField(this.daphniaBornAdults, state.daphniaBornAdults);
    }
    if (state.shrimpFoodCue?.length === CELL_COUNT) {
      restoreField(this.shrimpFoodCue, state.shrimpFoodCue);
      for (let index = 0; index < CELL_COUNT; index += 1) {
        this.shrimpFoodCue[index] = Math.min(1, this.shrimpFoodCue[index]);
      }
    } else {
      this.shrimpFoodCue.fill(0);
    }
    this.shrimpFoodCueActive = this.shrimpFoodCue.some((value) => value > 0);
    if (state.shrimpMateCue?.length === CELL_COUNT) {
      restoreField(this.shrimpMateCue, state.shrimpMateCue);
      for (let index = 0; index < CELL_COUNT; index += 1) {
        this.shrimpMateCue[index] = Math.min(1, this.shrimpMateCue[index]);
      }
    } else {
      this.shrimpMateCue.fill(0);
    }
    this.shrimpMateCueActive = this.shrimpMateCue.some((value) => value > 0);
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
    water.columns = this.effectsEnabled ? WATER_COLUMNS : 0;
    water.rows = this.effectsEnabled ? WATER_ROWS : 0;
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
      water.daphniaAdults ??= new Array<number>(CELL_COUNT);
      for (let index = 0; index < CELL_COUNT; index += 1) {
        water.daphniaAdults[index] =
          this.daphniaFounderAdults[index] + this.daphniaBornAdults[index];
      }
      water.daphniaAdults.length = CELL_COUNT;
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
    for (let index = 0; index < CELL_COUNT; index += 1) {
      const biomass = this.planktonicDecomposer[index] / CELL_COUNT;
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
      const availableFood = this.organicMatter[index] / CELL_COUNT;
      const retainedFraction = kinetics.biomassYield * 0.72;
      const oxygenPerFood = organicCarbonOxygenDemand(
        (1 - retainedFraction) * WATER_CYCLE_RULES.biomassCarbon,
      );
      const availableOxygen = this.oxygen[index] / CELL_COUNT;
      const consumed = Math.min(
        requested,
        availableFood,
        availableOxygen / Math.max(1e-9, oxygenPerFood),
      );
      if (consumed > 0) {
        this.organicMatter[index] = finiteConcentration(
          this.organicMatter[index] - consumed * CELL_COUNT,
        );
        const growth = consumed * retainedFraction;
        const mineralized = consumed - growth;
        this.planktonicDecomposer[index] = finiteBiomassConcentration(
          this.planktonicDecomposer[index] + growth * CELL_COUNT,
        );
        const oxygenDemand = organicCarbonOxygenDemand(
          mineralized * WATER_CYCLE_RULES.biomassCarbon,
        );
        this.oxygen[index] = finiteConcentration(
          this.oxygen[index] - oxygenDemand * CELL_COUNT,
        );
        this.toxicWaste[index] = finiteConcentration(
          this.toxicWaste[index] +
          mineralized * WATER_CYCLE_RULES.biomassNitrogen * CELL_COUNT,
        );
        this.dissolvedInorganicCarbon[index] = finiteConcentration(
          this.dissolvedInorganicCarbon[index] +
          mineralized * WATER_CYCLE_RULES.biomassCarbon * CELL_COUNT,
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
      const currentMass = this.planktonicDecomposer[index] / CELL_COUNT;
      const death = currentMass * (1 - Math.exp(-decayRate * deltaSeconds));
      if (death > 0) {
        this.planktonicDecomposer[index] = finiteBiomassConcentration(
          this.planktonicDecomposer[index] - death * CELL_COUNT,
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
    for (let column = 0; column < WATER_COLUMNS; column += 1) {
      let cumulativeConcentration = 0;
      for (let row = 0; row < WATER_ROWS; row += 1) {
        const index = row * WATER_COLUMNS + column;
        const localConcentration = Math.max(0, this.phytoplankton[index]);
        opticalDepth[index] = (
          cumulativeConcentration + localConcentration * 0.5
        ) * rules.selfShadingPerColumnConcentration;
        cumulativeConcentration += localConcentration;
      }
    }
    for (let index = 0; index < CELL_COUNT; index += 1) {
      const biomass = this.phytoplankton[index] / CELL_COUNT;
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
      const quality = this.sampleAt(point);
      const mineralNitrogen = quality.toxicWaste + quality.nutrients;
      const carbon = this.dissolvedInorganicCarbon[index];
      const waterClarity = Math.exp(
        -WATER_CYCLE_RULES.algae.organicLightAttenuation *
          quality.organicMatter,
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
          this.phytoplankton[index] + growth * CELL_COUNT,
        );
        this.stepPhytoplanktonGrowth += growth;
      }

      const afterGrowth = this.phytoplankton[index] / CELL_COUNT;
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
          this.phytoplankton[index] - respired * CELL_COUNT,
        );
        this.stepPhytoplanktonRespiration += respired;
      }

      const remaining = this.phytoplankton[index] / CELL_COUNT;
      const darkness = 1 - lightLimited;
      const mortalityRate = rules.backgroundMortalityPerSecond +
        rules.darkStressMortalityPerSecond * darkness * darkness;
      const mortality = remaining * (1 - Math.exp(-mortalityRate * deltaSeconds));
      if (mortality > 0) {
        this.phytoplankton[index] = finiteBiomassConcentration(
          this.phytoplankton[index] - mortality * CELL_COUNT,
        );
        this.detritus[index] += mortality;
        this.stepPhytoplanktonMortality += mortality;
      }

      const settleConcentration = this.phytoplankton[index] * settlingFraction;
      if (settleConcentration <= 0) continue;
      this.phytoplankton[index] -= settleConcentration;
      const row = Math.floor(index / WATER_COLUMNS);
      if (row >= WATER_ROWS - 1) {
        this.detritus[index] += settleConcentration / CELL_COUNT;
      } else {
        downward[index + WATER_COLUMNS] += settleConcentration;
      }
    }
    for (let index = 0; index < CELL_COUNT; index += 1) {
      if (downward[index] <= 0) continue;
      this.phytoplankton[index] = finiteBiomassConcentration(
        this.phytoplankton[index] + downward[index],
      );
    }
  }

  private applyDaphniaReactions(deltaSeconds: number): void {
    const rules = PLANKTON_ECOLOGY_RULES.daphnia;
    for (let index = 0; index < CELL_COUNT; index += 1) {
      const juvenileMass = this.daphniaJuveniles[index] / CELL_COUNT;
      const founderMass = this.daphniaFounderAdults[index] / CELL_COUNT;
      const bornAdultMass = this.daphniaBornAdults[index] / CELL_COUNT;
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

      const phytoAvailable = this.phytoplankton[index] / CELL_COUNT;
      const bacteriaAvailable = this.planktonicDecomposer[index] / CELL_COUNT;
      const {
        combinedResponse,
        bacteriaShare,
      } = daphniaSuspendedFoodResponse(
        this.phytoplankton[index],
        this.planktonicDecomposer[index],
      );
      const requestedFood = totalMass * rules.maximumFiltrationPerBiomassSecond *
        combinedResponse * deltaSeconds;
      const phytoRequested = requestedFood * (1 - bacteriaShare);
      const bacteriaRequested = requestedFood - phytoRequested;
      const phytoConsumed = Math.min(phytoAvailable, phytoRequested);
      const bacteriaConsumed = Math.min(bacteriaAvailable, bacteriaRequested);
      this.phytoplankton[index] = finiteConcentration(
        this.phytoplankton[index] - phytoConsumed * CELL_COUNT,
      );
      this.planktonicDecomposer[index] = finiteConcentration(
        this.planktonicDecomposer[index] - bacteriaConsumed * CELL_COUNT,
      );
      this.cumulativeFilteredPhytoplankton += phytoConsumed;
      this.cumulativeFilteredPlanktonicDecomposer += bacteriaConsumed;

      const assimilated = phytoConsumed * rules.phytoplanktonAssimilation +
        bacteriaConsumed * rules.bacterioplanktonAssimilation;
      const consumed = phytoConsumed + bacteriaConsumed;
      const feces = consumed * rules.fecesFraction;
      const respirationRequest = Math.max(0, consumed - assimilated - feces);
      this.detritus[index] += feces;
      const respiredFood = this.releaseRespiredBiomass(index, respirationRequest);
      this.detritus[index] += Math.max(0, respirationRequest - respiredFood);
      this.stepDaphniaAssimilation += assimilated;
      this.stepDaphniaRespiration += respiredFood;

      if (assimilated > 0) {
        const juvenileShare = totalMass > 0 ? juvenileMass / totalMass : 0;
        const juvenileGain = assimilated * juvenileShare;
        const adultGain = assimilated - juvenileGain;
        this.daphniaJuveniles[index] = finiteConcentration(
          this.daphniaJuveniles[index] + juvenileGain * CELL_COUNT,
        );
        if (adultMass > 0) {
          this.daphniaFounderAdults[index] = finiteConcentration(
            this.daphniaFounderAdults[index] +
            adultGain * founderMass / adultMass * CELL_COUNT,
          );
          this.daphniaBornAdults[index] = finiteConcentration(
            this.daphniaBornAdults[index] +
            adultGain * bornAdultMass / adultMass * CELL_COUNT,
          );
        } else {
          this.daphniaJuveniles[index] = finiteConcentration(
            this.daphniaJuveniles[index] + adultGain * CELL_COUNT,
          );
        }
      }

      const temperature = this.temperatureAt(this.pointAtIndex(index));
      const metabolicFactor = thetaTemperatureFactor(temperature, 22, 1.07, 0.5, 1.7);
      const maintenanceByField: Array<[Float64Array, number]> = [
        [
          this.daphniaJuveniles,
          continuousBodyMassMaintenance(
            rules.representativeJuvenileBiomass,
            rules.representativeAdultBiomass,
            rules.adultMaintenancePerSecond,
            rules.maintenanceMassExponent,
          ) / rules.representativeJuvenileBiomass,
        ],
        [this.daphniaFounderAdults, rules.adultMaintenancePerSecond],
        [this.daphniaBornAdults, rules.adultMaintenancePerSecond],
      ];
      for (const [field, rate] of maintenanceByField) {
        const available = field[index] / CELL_COUNT;
        const requested = Math.min(
          available,
          available * rate * metabolicFactor * deltaSeconds,
        );
        const respired = this.releaseRespiredBiomass(index, requested);
        field[index] = finiteConcentration(field[index] - respired * CELL_COUNT);
        this.stepDaphniaRespiration += respired;
      }

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

      const currentJuveniles = this.daphniaJuveniles[index] / CELL_COUNT;
      if (
        currentJuveniles > 0 &&
        foodQuality >= rules.minimumFoodQualityForMaturation
      ) {
        const maturation = currentJuveniles *
          (1 - Math.exp(
            -rules.juvenileMaturationPerSecond * foodQuality * deltaSeconds,
          ));
        this.daphniaJuveniles[index] -= maturation * CELL_COUNT;
        this.daphniaBornAdults[index] = finiteConcentration(
          this.daphniaBornAdults[index] + maturation * CELL_COUNT,
        );
        this.cumulativeDaphniaMaturations += maturation;
      }

      if (foodQuality >= rules.minimumFoodQualityForReproduction) {
        for (const [adultField, secondGeneration] of [
          [this.daphniaFounderAdults, false],
          [this.daphniaBornAdults, true],
        ] as const) {
          const currentAdults = adultField[index] / CELL_COUNT;
          const birth = currentAdults *
            (1 - Math.exp(
              -rules.reproductionAllocationPerSecond * foodQuality * deltaSeconds,
            ));
          if (birth <= 0) continue;
          adultField[index] -= birth * CELL_COUNT;
          this.daphniaJuveniles[index] = finiteConcentration(
            this.daphniaJuveniles[index] + birth * CELL_COUNT,
          );
          this.cumulativeDaphniaBirths += birth;
          if (secondGeneration) this.cumulativeSecondGenerationBirths += birth;
        }
      }

      const quality = this.sampleAt(this.pointAtIndex(index));
      const oxygenStress = clamp(
        (rules.oxygenStressStart - quality.oxygen) / rules.oxygenStressStart,
        0,
        1,
      );
      const toxicityStress = clamp(
        (quality.toxicWaste - rules.toxicWasteStressStart) /
          Math.max(1, 24 - rules.toxicWasteStressStart),
        0,
        1,
      );
      const starvation = clamp(1 - foodQuality / 0.32, 0, 1);
      const mortalityRate = rules.backgroundMortalityPerSecond +
        rules.starvationMortalityPerSecond * starvation * starvation +
        0.008 * oxygenStress * oxygenStress +
        0.006 * toxicityStress * toxicityStress;
      for (const field of [
        this.daphniaJuveniles,
        this.daphniaFounderAdults,
        this.daphniaBornAdults,
      ]) {
        const available = field[index] / CELL_COUNT;
        const death = available * (1 - Math.exp(-mortalityRate * deltaSeconds));
        if (death <= 0) continue;
        field[index] = finiteConcentration(field[index] - death * CELL_COUNT);
        this.detritus[index] += death;
        this.stepDaphniaMortality += death;
        this.cumulativeDaphniaDeaths += death;
      }
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
    initialOrganicMatter.set(this.organicMatter);
    initialToxicWaste.set(this.toxicWaste);
    initialNutrients.set(this.nutrients);
    initialOxygen.set(this.oxygen);
    initialCarbon.set(this.dissolvedInorganicCarbon);
    organicWithdrawal.set(initialOrganicMatter);
    toxicWasteWithdrawal.set(initialToxicWaste);
    oxygenWithdrawal.set(initialOxygen);
    carbonWithdrawal.set(initialCarbon);
    toxicWasteProducts.set(initialToxicWaste);
    nutrientProducts.set(initialNutrients);
    carbonProducts.set(initialCarbon);
    // The caller supplies a reusable scratch array, so sorting that array in
    // place preserves deterministic reaction ordering without allocating
    // another full list every simulated second.
    const orderedSites = sites.sort((left, right) =>
      left.point.y - right.point.y ||
      left.point.x - right.point.x ||
      left.biofilm.decomposer - right.biofilm.decomposer ||
      left.biofilm.nitrifier - right.biofilm.nitrifier);

    for (const site of orderedSites) {
      site.biofilm.decomposer = clamp(site.biofilm.decomposer, 0, 1);
      site.biofilm.nitrifier = clamp(site.biofilm.nitrifier, 0, 1);
      const index = this.indexAt(site.point);

      for (const guildId of ['decomposer', 'nitrifier'] as const) {
        const biomass = site.biofilm[guildId];
        if (biomass <= 0) continue;
        const kinetics = MICROBE_ECOLOGY_RULES[guildId];
        const quality: WaterQualityValues = {
          organicMatter: initialOrganicMatter[index],
          toxicWaste: initialToxicWaste[index],
          nutrients: initialNutrients[index],
          oxygen: initialOxygen[index],
        };
        const activity = saturation(quality[kinetics.substrate], kinetics.halfSaturation) *
          saturation(quality.oxygen, kinetics.oxygenHalfSaturation);
        const temperatureFactor = thetaTemperatureFactor(
          this.temperatureAt(site.point),
          kinetics.referenceTemperature,
          kinetics.temperatureCoefficient,
        );
        const occupied = site.biofilm.decomposer + site.biofilm.nitrifier;
        const freeSurface = clamp(1 - occupied, 0, 1);
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
          const reactionAt = (processedNitrogen: number) => {
            const potentialGrowth =
              processedNitrogen * retainedNitrogenFraction /
              WATER_CYCLE_RULES.biomassNitrogen;
            const carbonLimitedGrowth = Math.min(
              potentialGrowth,
              availableCarbon / WATER_CYCLE_RULES.biomassCarbon,
            );
            return nitrifierStoichiometry(processedNitrogen, carbonLimitedGrowth);
          };
          const feasible = (processedNitrogen: number): boolean => {
            const reaction = reactionAt(processedNitrogen);
            return reaction.oxygenDemand <= oxygenAvailable + 1e-12 &&
              reaction.nitrateProduced <= productCapacity + 1e-12;
          };
          if (!feasible(actual)) {
            let low = 0;
            let high = actual;
            for (let iteration = 0; iteration < 32; iteration += 1) {
              const middle = (low + high) / 2;
              if (feasible(middle)) low = middle;
              else high = middle;
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
          const reaction = nitrifierStoichiometry(consumed, carbonLimitedGrowth);
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

  private releaseRespiredBiomass(index: number, biomass: number): number {
    if (biomass <= 0) return 0;
    const oxygenPerBiomass = organicCarbonOxygenDemand(
      WATER_CYCLE_RULES.biomassCarbon,
    );
    const oxygenAvailable = this.massAround(this.oxygen, index);
    const carbonCapacity = this.capacityAroundOrTank(
      this.dissolvedInorganicCarbon,
      index,
      biomass * WATER_CYCLE_RULES.biomassCarbon,
    );
    const nitrogenCapacity = this.capacityAroundOrTank(
      this.toxicWaste,
      index,
      biomass * WATER_CYCLE_RULES.biomassNitrogen,
    );
    const actual = Math.min(
      biomass,
      oxygenPerBiomass > 0 ? oxygenAvailable / oxygenPerBiomass : biomass,
      carbonCapacity / WATER_CYCLE_RULES.biomassCarbon,
      nitrogenCapacity / WATER_CYCLE_RULES.biomassNitrogen,
    );
    if (actual <= 0) return 0;
    const carbon = actual * WATER_CYCLE_RULES.biomassCarbon;
    const nitrogen = actual * WATER_CYCLE_RULES.biomassNitrogen;
    const oxygenDemand = organicCarbonOxygenDemand(carbon);
    this.addMassAround(this.dissolvedInorganicCarbon, index, carbon);
    this.addMassAround(this.toxicWaste, index, nitrogen);
    const removedOxygen = this.removeMassAround(this.oxygen, index, oxygenDemand);
    this.cumulativeOxygenDemand += removedOxygen;
    this.cumulativeDissolvedWaste += nitrogen;
    return actual;
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
    for (const value of field) total += value;
    return total / CELL_COUNT;
  }

  private copyPlanktonLight(light: ArrayLike<number>): void {
    for (let index = 0; index < CELL_COUNT; index += 1) {
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
    const centerRow = Math.floor(index / WATER_COLUMNS);
    const centerColumn = index % WATER_COLUMNS;
    const indices: number[] = [];
    for (let row = Math.max(0, centerRow - radius); row <= Math.min(WATER_ROWS - 1, centerRow + radius); row += 1) {
      for (let column = Math.max(0, centerColumn - radius); column <= Math.min(WATER_COLUMNS - 1, centerColumn + radius); column += 1) {
        indices.push(row * WATER_COLUMNS + column);
      }
    }
    return indices;
  }

  private topRowIndices(): number[] {
    return this.topSurfaceIndices;
  }

  private massAround(field: Float32Array | Float64Array, index: number): number {
    return this.indicesAround(index).reduce((sum, candidate) => sum + field[candidate], 0) /
      CELL_COUNT;
  }

  private capacityAround(field: Float32Array | Float64Array, index: number): number {
    return this.indicesAround(index).reduce(
      (sum, candidate) => sum + Math.max(0, MAX_CONCENTRATION - field[candidate]),
      0,
    ) / CELL_COUNT;
  }

  private fieldCapacity(field: Float32Array | Float64Array): number {
    let capacity = 0;
    for (const value of field) capacity += Math.max(0, MAX_CONCENTRATION - value);
    return capacity / CELL_COUNT;
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
    const available = indices.reduce((sum, index) => sum + field[index], 0) / CELL_COUNT;
    const actual = Math.min(requested, available);
    if (actual <= 0 || available <= 0) return 0;
    const ratio = actual / available;
    for (const index of indices) field[index] = finiteConcentration(field[index] * (1 - ratio));
    return actual;
  }

  private addMassToIndices(
    field: Float32Array | Float64Array,
    indices: number[],
    requested: number,
  ): number {
    if (requested <= 0 || !indices.length) return 0;
    const capacity = indices.reduce(
      (sum, index) => sum + Math.max(0, MAX_CONCENTRATION - field[index]),
      0,
    ) / CELL_COUNT;
    const actual = Math.min(requested, capacity);
    if (actual <= 0 || capacity <= 0) return 0;
    const ratio = actual / capacity;
    for (const index of indices) {
      const free = Math.max(0, MAX_CONCENTRATION - field[index]);
      field[index] = finiteConcentration(field[index] + free * ratio);
    }
    return actual;
  }

  private indexAt(point: Vec2): number {
    const column = clamp(Math.floor((point.x / TANK_WIDTH) * WATER_COLUMNS), 0, WATER_COLUMNS - 1);
    const row = clamp(
      Math.floor(((point.y - WATER_TOP) / (GROUND_Y - WATER_TOP)) * WATER_ROWS),
      0,
      WATER_ROWS - 1,
    );
    return row * WATER_COLUMNS + column;
  }
}
