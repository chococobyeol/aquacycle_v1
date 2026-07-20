import {
  GROUND_Y,
  TANK_WIDTH,
  WATER_TOP,
  type BiogeochemistrySnapshot,
  type SpeciesBiomass,
  type Vec2,
} from './types';

const COLUMNS = 36;
const ROWS = 20;

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

/**
 * Records where material enters and leaves the living systems without yet
 * feeding those values back into health or growth. The spatial channels are
 * deliberately present now so oxygen diffusion, bacteria and toxicity can be
 * connected later without changing algae or animal life-cycle code.
 */
export class BiogeochemistryLedger {
  public readonly effectsEnabled = false as const;

  private readonly oxygenSourceFlux = new Float32Array(COLUMNS * ROWS);
  private readonly oxygenDemandFlux = new Float32Array(COLUMNS * ROWS);
  private readonly dissolvedWasteFlux = new Float32Array(COLUMNS * ROWS);
  private readonly detritus = new Float32Array(COLUMNS * ROWS);

  private cumulativeOxygenProduction = 0;
  private cumulativeOxygenDemand = 0;
  private cumulativeDissolvedWaste = 0;

  public beginStep(): void {
    this.oxygenSourceFlux.fill(0);
    this.oxygenDemandFlux.fill(0);
    this.dissolvedWasteFlux.fill(0);
  }

  public recordAlgae(
    point: Vec2,
    biomass: SpeciesBiomass,
    light: number,
    deltaSeconds: number,
  ): void {
    const total = biomass.oedogonium + biomass.nitzschia;
    if (total <= 0 || deltaSeconds <= 0) return;
    const index = this.indexAt(point);
    const lightFactor = clamp(light / 100, 0, 1);
    const oxygenProduction = total * lightFactor * 0.018 * deltaSeconds;
    const oxygenDemand = total * 0.0012 * deltaSeconds;
    this.oxygenSourceFlux[index] += oxygenProduction;
    this.oxygenDemandFlux[index] += oxygenDemand;
    this.cumulativeOxygenProduction += oxygenProduction;
    this.cumulativeOxygenDemand += oxygenDemand;
  }

  public recordAnimalMetabolism(
    point: Vec2,
    bodyScale: number,
    consumedBiomass: number,
    deltaSeconds: number,
  ): void {
    if (deltaSeconds <= 0) return;
    const index = this.indexAt(point);
    const oxygenDemand = Math.max(0, bodyScale) * 0.003 * deltaSeconds;
    const dissolvedWaste = Math.max(0, consumedBiomass) * 0.32;
    this.oxygenDemandFlux[index] += oxygenDemand;
    this.dissolvedWasteFlux[index] += dissolvedWaste;
    this.cumulativeOxygenDemand += oxygenDemand;
    this.cumulativeDissolvedWaste += dissolvedWaste;
  }

  public recordDeath(point: Vec2, bodyMass: number): void {
    this.detritus[this.indexAt(point)] += Math.max(0, bodyMass);
  }

  public snapshot(): BiogeochemistrySnapshot {
    let detritusMass = 0;
    for (const amount of this.detritus) detritusMass += amount;
    return {
      effectsEnabled: this.effectsEnabled,
      potentialOxygenProduction: this.cumulativeOxygenProduction,
      potentialOxygenDemand: this.cumulativeOxygenDemand,
      dissolvedWasteProduced: this.cumulativeDissolvedWaste,
      detritusMass,
    };
  }

  public cellAt(point: Vec2): {
    oxygenSourceFlux: number;
    oxygenDemandFlux: number;
    dissolvedWasteFlux: number;
    detritusMass: number;
  } {
    const index = this.indexAt(point);
    return {
      oxygenSourceFlux: this.oxygenSourceFlux[index],
      oxygenDemandFlux: this.oxygenDemandFlux[index],
      dissolvedWasteFlux: this.dissolvedWasteFlux[index],
      detritusMass: this.detritus[index],
    };
  }

  private indexAt(point: Vec2): number {
    const column = clamp(Math.floor((point.x / TANK_WIDTH) * COLUMNS), 0, COLUMNS - 1);
    const row = clamp(
      Math.floor(((point.y - WATER_TOP) / (GROUND_Y - WATER_TOP)) * ROWS),
      0,
      ROWS - 1,
    );
    return row * COLUMNS + column;
  }
}
