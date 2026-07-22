import {
  GROUND_Y,
  TANK_WIDTH,
  WATER_TOP,
  type BiofilmBiomass,
  type BiogeochemistrySaveState,
  type BiogeochemistrySnapshot,
  type MicrobeGuildId,
  type SpeciesBiomass,
  type Vec2,
  type WaterQualityValues,
} from './types';
import {
  MICROBE_ECOLOGY_RULES,
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

export const WATER_COLUMNS = 36;
export const WATER_ROWS = 20;
const CELL_COUNT = WATER_COLUMNS * WATER_ROWS;
const MAX_CONCENTRATION = 100;
const LOCAL_REACTION_RADIUS = 2;

export const emptyBiofilm = (): BiofilmBiomass => ({ decomposer: 0, nitrifier: 0 });

export interface BiofilmReactionSite {
  point: Vec2;
  biofilm: BiofilmBiomass;
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

/**
 * Spatial water chemistry plus two finite, well-mixed headspace reservoirs.
 * A water field's material amount is its tank-wide mean, so local additions
 * and removals use CELL_COUNT as the exact concentration/mass conversion.
 * Diffusion and bulk mixing only redistribute that amount.
 */
export class BiogeochemistryLedger {
  public readonly effectsEnabled: boolean;

  private readonly detritus = new Float64Array(CELL_COUNT);
  private readonly organicMatter = new Float32Array(CELL_COUNT);
  private readonly toxicWaste = new Float32Array(CELL_COUNT);
  private readonly nutrients = new Float32Array(CELL_COUNT);
  private readonly oxygen = new Float32Array(CELL_COUNT);
  private readonly dissolvedInorganicCarbon = new Float32Array(CELL_COUNT);
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
  private biofilmTotals = emptyBiofilm();

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
    return saturation(mineralNitrogen, WATER_CYCLE_RULES.mineralNutrientHalfSaturation) *
      saturation(carbon, WATER_CYCLE_RULES.carbonHalfSaturation);
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
    const oxygenProduced = fixedCarbon * WATER_CYCLE_RULES.oxygenPerFixedCarbon;
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
    const oxygenPerBiomass = WATER_CYCLE_RULES.biomassCarbon *
      WATER_CYCLE_RULES.oxygenPerFixedCarbon;
    const removedOxygen = this.removeMassAround(
      this.oxygen,
      index,
      requested * oxygenPerBiomass,
    );
    const actual = oxygenPerBiomass > 0
      ? Math.min(requested, removedOxygen / oxygenPerBiomass)
      : requested;
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
  public recordAnimalFeeding(point: Vec2, consumedBiomass: number): number {
    const consumed = Math.max(0, consumedBiomass);
    if (consumed <= 0) return 0;
    if (!this.effectsEnabled) {
      const feces = consumed * WATER_CYCLE_RULES.shrimp.fecesFraction;
      const respired = consumed * WATER_CYCLE_RULES.shrimp.respirationFraction;
      this.detritus[this.indexAt(point)] += feces;
      this.cumulativeOxygenDemand += respired * WATER_CYCLE_RULES.biomassCarbon *
        WATER_CYCLE_RULES.shrimp.oxygenPerRespiredCarbon;
      this.cumulativeDissolvedWaste += respired * WATER_CYCLE_RULES.biomassNitrogen;
      // Earlier missions deliberately do not enforce the closed material
      // ledger. Preserve their established food/energy balance while still
      // publishing the potential downstream fluxes for diagnostics.
      return consumed;
    }
    const index = this.indexAt(point);
    const assimilated = consumed * WATER_CYCLE_RULES.shrimp.assimilationFraction;
    const feces = consumed * WATER_CYCLE_RULES.shrimp.fecesFraction;
    const respired = consumed - assimilated - feces;
    this.detritus[index] += feces;
    this.releaseRespiredBiomass(index, respired);
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
  public recordAnimalRespiration(point: Vec2, metabolizedBiomass: number): void {
    if (metabolizedBiomass <= 0) return;
    if (!this.effectsEnabled) {
      this.cumulativeOxygenDemand += metabolizedBiomass * WATER_CYCLE_RULES.biomassCarbon *
        WATER_CYCLE_RULES.shrimp.oxygenPerRespiredCarbon;
      this.cumulativeDissolvedWaste += metabolizedBiomass * WATER_CYCLE_RULES.biomassNitrogen;
      return;
    }
    this.releaseRespiredBiomass(this.indexAt(point), metabolizedBiomass);
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

  public advance(deltaSeconds: number, sites: BiofilmReactionSite[]): void {
    if (!this.effectsEnabled || deltaSeconds <= 0) return;
    const dt = Math.max(0, deltaSeconds);
    const solubilization = 1 - Math.exp(-WATER_CYCLE_RULES.detritusSolubilizationRate * dt);
    for (let index = 0; index < CELL_COUNT; index += 1) {
      const requested = this.detritus[index] * solubilization;
      if (requested <= 0) continue;
      const dissolved = this.addMassAround(this.organicMatter, index, requested);
      this.detritus[index] = Math.max(0, this.detritus[index] - dissolved);
    }

    this.applyBiofilmReactions(dt, sites);
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
    this.dissolvedAdvectionAccumulator += dt;
    if (this.dissolvedAdvectionAccumulator + 1e-9 >= 1) {
      const transportSeconds = this.dissolvedAdvectionAccumulator;
      this.transport.advectConservativeField(this.organicMatter, transportSeconds);
      this.transport.advectConservativeField(this.toxicWaste, transportSeconds);
      this.transport.advectConservativeField(this.nutrients, transportSeconds);
      this.transport.advectConservativeField(this.oxygen, transportSeconds);
      this.transport.advectConservativeField(this.dissolvedInorganicCarbon, transportSeconds);
      this.dissolvedAdvectionAccumulator = 0;
    }
    this.exchangeClosedHeadspace(dt);

    this.biofilmTotals = sites.reduce<BiofilmBiomass>((total, site) => ({
      decomposer: total.decomposer + site.biofilm.decomposer,
      nitrifier: total.nitrifier + site.biofilm.nitrifier,
    }), emptyBiofilm());
    this.fieldRevision += 1;
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
    this.headspaceCarbonDioxide = Math.max(0, state.headspaceCarbonDioxide);
    this.headspaceOxygen = Math.max(0, state.headspaceOxygen);
    this.cumulativeOxygenProduction = Math.max(0, state.cumulativeOxygenProduction);
    this.cumulativeOxygenDemand = Math.max(0, state.cumulativeOxygenDemand);
    this.cumulativeDissolvedWaste = Math.max(0, state.cumulativeDissolvedWaste);
    this.fieldRevision = Math.max(0, Math.floor(state.fieldRevision));
    this.dissolvedAdvectionAccumulator = 0;
    this.transport.restoreSaveState(state.transport, fallbackTemperature);
  }

  public snapshot(): BiogeochemistrySnapshot {
    const material = this.materialState();
    const average: WaterQualityValues = {
      organicMatter: material.organicMatter,
      toxicWaste: material.toxicWaste,
      nutrients: material.nutrients,
      oxygen: material.dissolvedOxygen,
    };
    const filmBiomass = this.biofilmTotals.decomposer + this.biofilmTotals.nitrifier;
    const biologicalMatter = material.organicMatter + material.detritus + filmBiomass;
    const totalNitrogen = material.toxicWaste + material.nutrients +
      biologicalMatter * WATER_CYCLE_RULES.biomassNitrogen;
    const totalCarbon = material.dissolvedInorganicCarbon + material.headspaceCarbonDioxide +
      biologicalMatter * WATER_CYCLE_RULES.biomassCarbon;
    return {
      effectsEnabled: this.effectsEnabled,
      potentialOxygenProduction: this.cumulativeOxygenProduction,
      potentialOxygenDemand: this.cumulativeOxygenDemand,
      dissolvedWasteProduced: this.cumulativeDissolvedWaste,
      detritusMass: material.detritus,
      water: this.effectsEnabled
        ? {
          columns: WATER_COLUMNS,
          rows: WATER_ROWS,
          organicMatter: Array.from(this.organicMatter),
          toxicWaste: Array.from(this.toxicWaste),
          nutrients: Array.from(this.nutrients),
          oxygen: Array.from(this.oxygen),
          dissolvedInorganicCarbon: Array.from(this.dissolvedInorganicCarbon),
          revision: this.fieldRevision,
        }
        : {
          columns: 0,
          rows: 0,
          organicMatter: [],
          toxicWaste: [],
          nutrients: [],
          oxygen: [],
          dissolvedInorganicCarbon: [],
          revision: this.fieldRevision,
        },
      transport: this.transport.snapshot(),
      average,
      biofilmTotals: { ...this.biofilmTotals },
      algaeFluxes: {
        grossProductionBiomassPerSecond: this.stepGrossAlgaeProduction / this.stepDurationSeconds,
        respirationBiomassPerSecond: this.stepAlgaeRespiration / this.stepDurationSeconds,
        stressTurnoverBiomassPerSecond: this.stepAlgaeTurnover / this.stepDurationSeconds,
        oxygenProducedPerSecond: this.stepAlgaeOxygenProduction / this.stepDurationSeconds,
        oxygenConsumedPerSecond: this.stepAlgaeOxygenDemand / this.stepDurationSeconds,
      },
      carbonCycle: {
        dissolvedInorganicCarbon: material.dissolvedInorganicCarbon,
        headspaceCarbonDioxide: material.headspaceCarbonDioxide,
        headspaceOxygen: material.headspaceOxygen,
      },
      gasExchange: this.gasExchangeState(material),
      materialBalance: {
        totalNitrogen,
        totalCarbon,
        referenceNitrogen: null,
        referenceCarbon: null,
        nitrogenDriftRatio: 0,
        carbonDriftRatio: 0,
      },
    };
  }

  private applyBiofilmReactions(deltaSeconds: number, sites: BiofilmReactionSite[]): void {
    for (const site of sites) {
      site.biofilm.decomposer = clamp(site.biofilm.decomposer, 0, 1);
      site.biofilm.nitrifier = clamp(site.biofilm.nitrifier, 0, 1);
      const index = this.indexAt(site.point);

      for (const guildId of ['decomposer', 'nitrifier'] as const) {
        const biomass = site.biofilm[guildId];
        if (biomass <= 0) continue;
        const kinetics = MICROBE_ECOLOGY_RULES[guildId];
        const quality = this.sampleAt(site.point);
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
        const foodAvailable = this.massAround(foodField, index);
        const oxygenAvailable = this.massAround(this.oxygen, index);
        let actual = Math.min(
          requested,
          foodAvailable,
          oxygenAvailable / Math.max(1e-9, kinetics.oxygenPerSubstrate),
        );

        if (guildId === 'decomposer') {
          const retainedFraction = kinetics.biomassYield * freeSurface;
          const productPerSubstrate = (1 - retainedFraction) *
            WATER_CYCLE_RULES.biomassNitrogen;
          const productCapacity = this.capacityAround(this.toxicWaste, index);
          actual = Math.min(actual, productCapacity / Math.max(1e-9, productPerSubstrate));
        } else {
          const retainedNitrogenFraction = kinetics.biomassYield * freeSurface;
          const productCapacity = this.capacityAround(this.nutrients, index);
          actual = Math.min(
            actual,
            productCapacity / Math.max(1e-9, 1 - retainedNitrogenFraction),
          );
        }

        const consumed = this.removeMassAround(foodField, index, actual);
        const oxygenDemand = consumed * kinetics.oxygenPerSubstrate;
        this.removeMassAround(this.oxygen, index, oxygenDemand);
        this.cumulativeOxygenDemand += oxygenDemand;

        let growth = 0;
        if (guildId === 'decomposer') {
          growth = consumed * kinetics.biomassYield * freeSurface;
          const mineralized = Math.max(0, consumed - growth);
          this.addMassAround(
            this.toxicWaste,
            index,
            mineralized * WATER_CYCLE_RULES.biomassNitrogen,
          );
          this.addMassAround(
            this.dissolvedInorganicCarbon,
            index,
            mineralized * WATER_CYCLE_RULES.biomassCarbon,
          );
          this.cumulativeDissolvedWaste += mineralized * WATER_CYCLE_RULES.biomassNitrogen;
        } else {
          const retainedNitrogen = consumed * kinetics.biomassYield * freeSurface;
          const potentialGrowth = retainedNitrogen / WATER_CYCLE_RULES.biomassNitrogen;
          const availableCarbon = this.massAround(this.dissolvedInorganicCarbon, index);
          const carbonLimitedGrowth = Math.min(
            potentialGrowth,
            availableCarbon / WATER_CYCLE_RULES.biomassCarbon,
          );
          growth = carbonLimitedGrowth;
          const actualRetainedNitrogen = growth * WATER_CYCLE_RULES.biomassNitrogen;
          this.removeMassAround(
            this.dissolvedInorganicCarbon,
            index,
            growth * WATER_CYCLE_RULES.biomassCarbon,
          );
          this.addMassAround(
            this.nutrients,
            index,
            Math.max(0, consumed - actualRetainedNitrogen),
          );
        }

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

  private releaseRespiredBiomass(index: number, biomass: number): void {
    if (biomass <= 0) return;
    const carbon = biomass * WATER_CYCLE_RULES.biomassCarbon;
    const nitrogen = biomass * WATER_CYCLE_RULES.biomassNitrogen;
    const oxygenDemand = carbon * WATER_CYCLE_RULES.shrimp.oxygenPerRespiredCarbon;
    this.addMassAround(this.dissolvedInorganicCarbon, index, carbon);
    this.addMassAround(this.toxicWaste, index, nitrogen);
    this.removeMassAround(this.oxygen, index, oxygenDemand);
    this.cumulativeOxygenDemand += oxygenDemand;
    this.cumulativeDissolvedWaste += nitrogen;
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

  private fieldMass(field: Float32Array): number {
    let total = 0;
    for (const value of field) total += value;
    return total / CELL_COUNT;
  }

  private indicesAround(index: number, radius = LOCAL_REACTION_RADIUS): number[] {
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
    return Array.from({ length: WATER_COLUMNS }, (_, column) => column);
  }

  private massAround(field: Float32Array, index: number): number {
    return this.indicesAround(index).reduce((sum, candidate) => sum + field[candidate], 0) /
      CELL_COUNT;
  }

  private capacityAround(field: Float32Array, index: number): number {
    return this.indicesAround(index).reduce(
      (sum, candidate) => sum + Math.max(0, MAX_CONCENTRATION - field[candidate]),
      0,
    ) / CELL_COUNT;
  }

  private removeMassAround(field: Float32Array, index: number, requested: number): number {
    return this.removeMassFromIndices(field, this.indicesAround(index), requested);
  }

  private addMassAround(field: Float32Array, index: number, requested: number): number {
    const local = this.indicesAround(index);
    const locallyAdded = this.addMassToIndices(field, local, requested);
    if (locallyAdded >= requested - 1e-12) return locallyAdded;
    const all = Array.from({ length: CELL_COUNT }, (_, candidate) => candidate);
    return locallyAdded + this.addMassToIndices(field, all, requested - locallyAdded);
  }

  private removeMassFromIndices(field: Float32Array, indices: number[], requested: number): number {
    if (requested <= 0 || !indices.length) return 0;
    const available = indices.reduce((sum, index) => sum + field[index], 0) / CELL_COUNT;
    const actual = Math.min(requested, available);
    if (actual <= 0 || available <= 0) return 0;
    const ratio = actual / available;
    for (const index of indices) field[index] = finiteConcentration(field[index] * (1 - ratio));
    return actual;
  }

  private addMassToIndices(field: Float32Array, indices: number[], requested: number): number {
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
