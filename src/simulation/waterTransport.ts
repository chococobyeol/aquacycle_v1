import {
  GROUND_Y,
  TANK_WIDTH,
  WATER_TOP,
  type Vec2,
  type WaterTransportSaveState,
  type WaterTransportSnapshot,
} from './types';
import { pointInPolygon } from './surfaces';

export const TRANSPORT_COLUMNS = 36;
export const TRANSPORT_ROWS = 20;
export const TRANSPORT_CELL_COUNT = TRANSPORT_COLUMNS * TRANSPORT_ROWS;

const MAX_THERMAL_SUBSTEPS = 4;
const MAX_THERMAL_STEP_SECONDS = 0.25;
const WATER_HEAT_CAPACITY = 1;
const STONE_HEAT_CAPACITY = 2.8;
const WATER_CONDUCTIVITY = 0.034;
const STONE_CONDUCTIVITY = 0.082;
// The lamp's visible 0–100 output is not a wattage scale.  At full output the
// whole tank should settle only a few degrees above the room, not cook the
// cells directly below the fixture within minutes.
const LIGHT_HEAT_PER_SECOND_AT_FULL = 0.0045;
const WATER_LIGHT_ABSORPTION = 0.62;
const STONE_LIGHT_ABSORPTION = 1.45;
const SURFACE_HEAT_EXCHANGE_PER_SECOND = 0.009;
const GLASS_HEAT_EXCHANGE_PER_SECOND = 0.0045;
const SUBSTRATE_HEAT_EXCHANGE_PER_SECOND = 0.0014;
// Velocities are expressed in grid cells per simulated second.  Aquarium
// convection belongs on a minutes-long circulation time, so keep the
// Boussinesq response deliberately gentle.
const BUOYANCY_ACCELERATION = 0.0032;
const VELOCITY_DAMPING_PER_SECOND = 0.12;
const VELOCITY_VISCOSITY_PER_SECOND = 0.055;
const PRESSURE_ITERATIONS = 14;
const MAX_CELL_SPEED = 0.08;
const FLOW_SOLVE_INTERVAL_SECONDS = 0.5;
// Sub-grid motion does not disappear when the cell-averaged velocity is zero:
// small thermal plumes, animal motion and boundary shear still disperse a
// dissolved tracer.  This floor replaces the old whole-tank averaging with a
// local, mass-conserving eddy diffusivity.
const BACKGROUND_EDDY_MIXING_PER_SECOND = 0.72;
const FLOW_EDDY_MIXING_FACTOR = 6;
const THERMAL_EDDY_MIXING_FACTOR = 0.16;
const MAX_EDDY_MIXING_PER_SECOND = 2;

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const finiteTemperature = (value: number, fallback: number): number =>
  Number.isFinite(value) ? clamp(value, -5, 55) : fallback;

const mean = (values: ArrayLike<number>): number => {
  let total = 0;
  for (let index = 0; index < values.length; index += 1) total += values[index];
  return values.length ? total / values.length : 0;
};

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

export interface WaterTransportObstacle {
  polygon: Vec2[];
  /**
   * A 2-D stone still represents water that can pass in front of or behind it.
   * Coverage therefore affects heat capacity and drag without becoming a
   * perfectly sealed CFD wall.
   */
  solidity?: number;
}

/**
 * Low-resolution shared water grid for the spatial heat ledger, obstacle
 * material map, buoyant velocity/pressure solve and conservative tracer
 * transport. Temperature and chemistry therefore cannot silently acquire
 * different geometry or unrelated circulation paths.
 */
export class WaterTransportGrid {
  private readonly columns: number;
  private readonly rows: number;
  private readonly cellCount: number;
  private readonly tankWidth: number;
  private readonly waterTop: number;
  private readonly groundY: number;
  private readonly temperature: Float32Array;
  private readonly thermalEnergyScratch: Float64Array;
  private readonly advectedHeat: Float32Array;
  private readonly heatCapacity: Float32Array;
  private readonly maximumHeat: Float32Array;
  private readonly conductivity: Float32Array;
  private readonly solidFraction: Float32Array;
  private readonly flowResistance: Float32Array;
  private readonly light: Float32Array;
  private readonly velocityX: Float32Array;
  private readonly velocityY: Float32Array;
  private readonly velocityScratchX: Float64Array;
  private readonly velocityScratchY: Float64Array;
  private readonly pressure: Float32Array;
  private readonly pressureScratch: Float32Array;
  private readonly divergence: Float32Array;
  private readonly faceVelocityX: Float32Array;
  private readonly faceVelocityY: Float32Array;
  private readonly scalarScratch: Float64Array;
  private readonly scalarOutgoing: Float64Array;
  private readonly scalarIncoming: Float64Array;
  private readonly scalarSourceScale: Float64Array;
  private readonly scalarReceiverScale: Float64Array;
  private readonly scalarEdgeX: Float64Array;
  private readonly scalarEdgeY: Float64Array;
  private readonly eddySpeed: Float32Array;
  private readonly eddyRetentionX: Float32Array;
  private readonly eddyRetentionY: Float32Array;
  private readonly eddyPermeabilityX: Float32Array;
  private readonly eddyPermeabilityY: Float32Array;

  private revision = 0;
  private cumulativeExternalHeat = 0;
  private flowAccumulator = 0;
  private heatAdvectionAccumulator = 0;
  private dispersionPreparedRevision = -1;
  private dispersionPreparedSeconds = -1;

  public constructor(
    initialTemperature = 23.5,
    geometry?: {
      columns?: number;
      rows?: number;
      tankWidth?: number;
      waterTop?: number;
      groundY?: number;
    },
  ) {
    this.columns = Math.max(1, Math.floor(geometry?.columns ?? TRANSPORT_COLUMNS));
    this.rows = Math.max(1, Math.floor(geometry?.rows ?? TRANSPORT_ROWS));
    this.cellCount = this.columns * this.rows;
    this.tankWidth = Math.max(1, geometry?.tankWidth ?? TANK_WIDTH);
    this.waterTop = geometry?.waterTop ?? WATER_TOP;
    this.groundY = geometry?.groundY ?? GROUND_Y;
    this.temperature = new Float32Array(this.cellCount);
    this.thermalEnergyScratch = new Float64Array(this.cellCount);
    this.advectedHeat = new Float32Array(this.cellCount);
    this.heatCapacity = new Float32Array(this.cellCount);
    this.maximumHeat = new Float32Array(this.cellCount);
    this.conductivity = new Float32Array(this.cellCount);
    this.solidFraction = new Float32Array(this.cellCount);
    this.flowResistance = new Float32Array(this.cellCount);
    this.light = new Float32Array(this.cellCount);
    this.velocityX = new Float32Array(this.cellCount);
    this.velocityY = new Float32Array(this.cellCount);
    this.velocityScratchX = new Float64Array(this.cellCount);
    this.velocityScratchY = new Float64Array(this.cellCount);
    this.pressure = new Float32Array(this.cellCount);
    this.pressureScratch = new Float32Array(this.cellCount);
    this.divergence = new Float32Array(this.cellCount);
    this.faceVelocityX = new Float32Array((this.columns + 1) * this.rows);
    this.faceVelocityY = new Float32Array(this.columns * (this.rows + 1));
    this.scalarScratch = new Float64Array(this.cellCount);
    this.scalarOutgoing = new Float64Array(this.cellCount);
    this.scalarIncoming = new Float64Array(this.cellCount);
    this.scalarSourceScale = new Float64Array(this.cellCount);
    this.scalarReceiverScale = new Float64Array(this.cellCount);
    this.scalarEdgeX = new Float64Array(this.cellCount);
    this.scalarEdgeY = new Float64Array(this.cellCount);
    this.eddySpeed = new Float32Array(this.cellCount);
    this.eddyRetentionX = new Float32Array(this.cellCount);
    this.eddyRetentionY = new Float32Array(this.cellCount);
    this.eddyPermeabilityX = new Float32Array(this.cellCount);
    this.eddyPermeabilityY = new Float32Array(this.cellCount);
    this.temperature.fill(finiteTemperature(initialTemperature, 23.5));
    this.heatCapacity.fill(WATER_HEAT_CAPACITY);
    this.maximumHeat.fill(55 * WATER_HEAT_CAPACITY);
    this.conductivity.fill(WATER_CONDUCTIVITY);
  }

  public setEnvironment(light: ArrayLike<number>, obstacles: WaterTransportObstacle[]): void {
    this.copyLightField(light);
    for (let index = 0; index < this.cellCount; index += 1) {
      this.solidFraction[index] = 0;
    }

    const samplesPerAxis = 3;
    for (let row = 0; row < this.rows; row += 1) {
      for (let column = 0; column < this.columns; column += 1) {
        const index = row * this.columns + column;
        let coveredSamples = 0;
        let weightedSolidity = 0;
        for (let sampleY = 0; sampleY < samplesPerAxis; sampleY += 1) {
          for (let sampleX = 0; sampleX < samplesPerAxis; sampleX += 1) {
            const point = this.worldPointAt(
              column + (sampleX + 0.5) / samplesPerAxis,
              row + (sampleY + 0.5) / samplesPerAxis,
            );
            for (const obstacle of obstacles) {
              if (!pointInPolygon(point, obstacle.polygon)) continue;
              coveredSamples += 1;
              weightedSolidity += clamp(obstacle.solidity ?? 0.82, 0, 0.92);
              break;
            }
          }
        }
        const coverage = coveredSamples / (samplesPerAxis * samplesPerAxis);
        const materialFraction = coveredSamples > 0
          ? coverage * (weightedSolidity / coveredSamples)
          : 0;
        this.solidFraction[index] = clamp(materialFraction, 0, 0.88);
        const solid = this.solidFraction[index];
        this.flowResistance[index] = clamp(solid * 0.94, 0, 0.88);
        this.heatCapacity[index] = WATER_HEAT_CAPACITY * (1 - solid) +
          STONE_HEAT_CAPACITY * solid;
        this.maximumHeat[index] = 55 * this.heatCapacity[index];
        this.conductivity[index] = WATER_CONDUCTIVITY * (1 - solid) +
          STONE_CONDUCTIVITY * solid;
      }
    }
    this.revision += 1;
  }

  /**
   * Updates radiative heating without rebuilding obstacle coverage, heat
   * capacity, conductivity, and flow resistance. Day/night changes only the
   * source intensity; the transport geometry remains identical until a
   * structure moves.
   */
  public setLightField(light: ArrayLike<number>): void {
    this.copyLightField(light);
    this.revision += 1;
  }

  private copyLightField(light: ArrayLike<number>): void {
    for (let index = 0; index < this.cellCount; index += 1) {
      this.light[index] = clamp(Number(light[index]) || 0, 0, 100);
    }
  }

  public advanceHeat(deltaSeconds: number, ambientTemperature = 22): void {
    if (deltaSeconds <= 0) return;
    const substeps = clamp(
      Math.ceil(deltaSeconds / MAX_THERMAL_STEP_SECONDS),
      1,
      MAX_THERMAL_SUBSTEPS,
    );
    const stepSeconds = deltaSeconds / substeps;
    for (let step = 0; step < substeps; step += 1) {
      this.advanceHeatSubstep(stepSeconds, ambientTemperature);
    }
    this.revision += 1;
  }

  public sampleTemperatureAt(point: Vec2): number {
    return this.temperature[this.indexAt(point)];
  }

  public sampleVelocityAt(point: Vec2, reuse?: Vec2): Vec2 {
    const index = this.indexAt(point);
    const velocity = reuse ?? { x: 0, y: 0 };
    velocity.x = this.velocityX[index];
    velocity.y = this.velocityY[index];
    return velocity;
  }

  public averageTemperature(): number {
    let totalEnergy = 0;
    let totalCapacity = 0;
    for (let index = 0; index < this.cellCount; index += 1) {
      totalEnergy += this.temperature[index] * this.heatCapacity[index];
      totalCapacity += this.heatCapacity[index];
    }
    return totalCapacity > 0 ? totalEnergy / totalCapacity : mean(this.temperature);
  }

  /** Mean temperature of the water cells touching the closed headspace. */
  public surfaceTemperature(): number {
    let total = 0;
    for (let column = 0; column < this.columns; column += 1) {
      total += this.temperature[column];
    }
    return total / this.columns;
  }

  /**
   * Moves a dissolved concentration with the already projected water flux.
   * Every internal edge is evaluated once, then donor and receiver limiters
   * are applied to the same signed transfer. The operation therefore stays
   * non-negative, bounded, and conservative instead of interpolating a new
   * field that can silently lose material.
   */
  public advectConservativeField(
    field: Float32Array | Float64Array,
    deltaSeconds: number,
    maximum: number | ArrayLike<number> = 100,
  ): void {
    if (deltaSeconds <= 0 || field.length !== this.cellCount) return;
    this.scalarOutgoing.fill(0);
    this.scalarIncoming.fill(0);
    this.scalarEdgeX.fill(0);
    this.scalarEdgeY.fill(0);

    for (let row = 0; row < this.rows; row += 1) {
      for (let column = 0; column < this.columns; column += 1) {
        const index = row * this.columns + column;
        if (column + 1 < this.columns) {
          const neighbor = index + 1;
          const velocity = this.faceVelocityX[row * (this.columns + 1) + column + 1];
          if (Math.abs(velocity) >= 1e-10) {
            const donor = velocity > 0 ? index : neighbor;
            const proposed = Math.min(Math.abs(velocity) * deltaSeconds, 0.45) *
              Math.max(0, field[donor]);
            this.scalarEdgeX[index] = velocity > 0 ? proposed : -proposed;
            this.scalarOutgoing[donor] += proposed;
          }
        }
        if (row + 1 < this.rows) {
          const neighbor = index + this.columns;
          const velocity = this.faceVelocityY[(row + 1) * this.columns + column];
          if (Math.abs(velocity) >= 1e-10) {
            const donor = velocity > 0 ? index : neighbor;
            const proposed = Math.min(Math.abs(velocity) * deltaSeconds, 0.45) *
              Math.max(0, field[donor]);
            this.scalarEdgeY[index] = velocity > 0 ? proposed : -proposed;
            this.scalarOutgoing[donor] += proposed;
          }
        }
      }
    }

    for (let index = 0; index < this.cellCount; index += 1) {
      this.scalarSourceScale[index] = this.scalarOutgoing[index] > field[index]
        ? field[index] / this.scalarOutgoing[index]
        : 1;
      this.scalarOutgoing[index] = 0;
      this.scalarIncoming[index] = 0;
    }
    for (let row = 0; row < this.rows; row += 1) {
      for (let column = 0; column < this.columns; column += 1) {
        const index = row * this.columns + column;
        if (column + 1 < this.columns) {
          const proposal = this.scalarEdgeX[index];
          if (proposal !== 0) {
            const donor = proposal > 0 ? index : index + 1;
            const receiver = proposal > 0 ? index + 1 : index;
            this.scalarIncoming[receiver] += Math.abs(proposal) * this.scalarSourceScale[donor];
          }
        }
        if (row + 1 < this.rows) {
          const proposal = this.scalarEdgeY[index];
          if (proposal !== 0) {
            const donor = proposal > 0 ? index : index + this.columns;
            const receiver = proposal > 0 ? index + this.columns : index;
            this.scalarIncoming[receiver] += Math.abs(proposal) * this.scalarSourceScale[donor];
          }
        }
      }
    }

    for (let index = 0; index < this.cellCount; index += 1) {
      const localMaximum = typeof maximum === 'number' ? maximum : maximum[index];
      // Do not count simultaneous outgoing flux as receiver capacity here.
      // Some of that outgoing proposal may itself be rejected by its
      // destination; using it optimistically can overfill this cell and make
      // the final clamp destroy mass. The pre-step free capacity is a stricter
      // but conservative monotone limiter.
      const receiverCapacity = Math.max(0, localMaximum - field[index]);
      this.scalarReceiverScale[index] = this.scalarIncoming[index] > receiverCapacity
        ? receiverCapacity / this.scalarIncoming[index]
        : 1;
      this.scalarScratch[index] = field[index];
    }

    for (let row = 0; row < this.rows; row += 1) {
      for (let column = 0; column < this.columns; column += 1) {
        const index = row * this.columns + column;
        if (column + 1 < this.columns) {
          const proposal = this.scalarEdgeX[index];
          if (proposal !== 0) {
            const donor = proposal > 0 ? index : index + 1;
            const receiver = proposal > 0 ? index + 1 : index;
            const actual = Math.abs(proposal) *
              this.scalarSourceScale[donor] * this.scalarReceiverScale[receiver];
            this.scalarScratch[donor] -= actual;
            this.scalarScratch[receiver] += actual;
          }
        }
        if (row + 1 < this.rows) {
          const proposal = this.scalarEdgeY[index];
          if (proposal !== 0) {
            const donor = proposal > 0 ? index : index + this.columns;
            const receiver = proposal > 0 ? index + this.columns : index;
            const actual = Math.abs(proposal) *
              this.scalarSourceScale[donor] * this.scalarReceiverScale[receiver];
            this.scalarScratch[donor] -= actual;
            this.scalarScratch[receiver] += actual;
          }
        }
      }
    }
    for (let index = 0; index < this.cellCount; index += 1) {
      const localMaximum = typeof maximum === 'number' ? maximum : maximum[index];
      field[index] = Number.isFinite(this.scalarScratch[index])
        ? clamp(this.scalarScratch[index], 0, localMaximum)
        : 0;
    }
  }

  /**
   * Locally disperses a dissolved field with a conservative edge exchange.
   * The field-specific rate represents molecular/sub-cell diffusion; a shared
   * eddy term is then added from the same temperature and velocity grid used
   * for advection.  A non-zero background is intentional: zero mean flow in a
   * coarse cell is not zero unresolved water motion in a real aquarium.
   */
  public disperseConservativeField(
    field: Float32Array | Float64Array,
    deltaSeconds: number,
    fieldMixingPerSecond: number,
  ): void {
    if (deltaSeconds <= 0 || field.length !== this.cellCount) return;
    this.prepareDispersionEdges(deltaSeconds);
    const fieldRetention = Math.exp(-Math.max(0, fieldMixingPerSecond) * deltaSeconds);
    for (let index = 0; index < this.cellCount; index += 1) {
      this.scalarScratch[index] = field[index];
    }

    for (let row = 0; row < this.rows; row += 1) {
      for (let column = 0; column < this.columns; column += 1) {
        const index = row * this.columns + column;
        if (column + 1 < this.columns) {
          this.dispersePair(
            field,
            index,
            index + 1,
            fieldRetention,
            this.eddyRetentionX[index],
            this.eddyPermeabilityX[index],
          );
        }
        if (row + 1 < this.rows) {
          this.dispersePair(
            field,
            index,
            index + this.columns,
            fieldRetention,
            this.eddyRetentionY[index],
            this.eddyPermeabilityY[index],
          );
        }
      }
    }

    for (let index = 0; index < this.cellCount; index += 1) {
      // Pair responses are capped at one quarter, so four lower-valued
      // neighbours cannot withdraw more than the source held at step start.
      this.scalarScratch[index] = Math.max(0, this.scalarScratch[index]);
      field[index] = Number.isFinite(this.scalarScratch[index])
        ? this.scalarScratch[index]
        : 0;
    }
  }

  public totalThermalEnergy(): number {
    let total = 0;
    for (let index = 0; index < this.cellCount; index += 1) {
      total += this.temperature[index] * this.heatCapacity[index];
    }
    return total;
  }

  public exportSaveState(): WaterTransportSaveState {
    return {
      temperature: Array.from(this.temperature),
      velocityX: Array.from(this.velocityX),
      velocityY: Array.from(this.velocityY),
      cumulativeExternalHeat: this.cumulativeExternalHeat,
      revision: this.revision,
    };
  }

  public restoreSaveState(state: WaterTransportSaveState | undefined, fallbackTemperature: number): void {
    if (!state || state.temperature.length !== this.cellCount) {
      this.temperature.fill(finiteTemperature(fallbackTemperature, 23.5));
      this.velocityX.fill(0);
      this.velocityY.fill(0);
      this.cumulativeExternalHeat = 0;
      this.revision += 1;
      return;
    }
    for (let index = 0; index < this.cellCount; index += 1) {
      this.temperature[index] = finiteTemperature(state.temperature[index], fallbackTemperature);
      this.velocityX[index] = Number.isFinite(state.velocityX[index]) ? state.velocityX[index] : 0;
      this.velocityY[index] = Number.isFinite(state.velocityY[index]) ? state.velocityY[index] : 0;
    }
    this.cumulativeExternalHeat = Number.isFinite(state.cumulativeExternalHeat)
      ? state.cumulativeExternalHeat
      : 0;
    this.revision = Math.max(this.revision + 1, Math.floor(state.revision || 0));
  }

  public snapshot(reuse?: WaterTransportSnapshot): WaterTransportSnapshot {
    let minimumTemperature = Number.POSITIVE_INFINITY;
    let maximumTemperature = Number.NEGATIVE_INFINITY;
    let maximumSpeed = 0;
    for (let index = 0; index < this.cellCount; index += 1) {
      minimumTemperature = Math.min(minimumTemperature, this.temperature[index]);
      maximumTemperature = Math.max(maximumTemperature, this.temperature[index]);
      const velocityX = this.velocityX[index];
      const velocityY = this.velocityY[index];
      maximumSpeed = Math.max(
        maximumSpeed,
        Math.sqrt(velocityX * velocityX + velocityY * velocityY),
      );
    }
    const snapshot = reuse ?? {} as WaterTransportSnapshot;
    snapshot.columns = this.columns;
    snapshot.rows = this.rows;
    snapshot.temperature = copyNumericArray(this.temperature, snapshot.temperature);
    snapshot.velocityX = copyNumericArray(this.velocityX, snapshot.velocityX);
    snapshot.velocityY = copyNumericArray(this.velocityY, snapshot.velocityY);
    snapshot.solidFraction = copyNumericArray(
      this.solidFraction,
      snapshot.solidFraction,
    );
    snapshot.flowResistance = copyNumericArray(
      this.flowResistance,
      snapshot.flowResistance,
    );
    snapshot.averageTemperature = this.averageTemperature();
    snapshot.minimumTemperature = minimumTemperature;
    snapshot.maximumTemperature = maximumTemperature;
    snapshot.maximumSpeed = maximumSpeed;
    snapshot.cumulativeExternalHeat = this.cumulativeExternalHeat;
    snapshot.revision = this.revision;
    return snapshot;
  }

  private advanceHeatSubstep(deltaSeconds: number, ambientTemperature: number): void {
    for (let index = 0; index < this.cellCount; index += 1) {
      this.thermalEnergyScratch[index] = this.temperature[index] * this.heatCapacity[index];
      const solid = this.solidFraction[index];
      const absorption = WATER_LIGHT_ABSORPTION * (1 - solid) +
        STONE_LIGHT_ABSORPTION * solid;
      const lightHeat = (this.light[index] / 100) * LIGHT_HEAT_PER_SECOND_AT_FULL *
        absorption * deltaSeconds;
      this.thermalEnergyScratch[index] += lightHeat;
      this.cumulativeExternalHeat += lightHeat;
    }

    // Symmetric pair fluxes conserve energy exactly before Float32 storage.
    for (let row = 0; row < this.rows; row += 1) {
      for (let column = 0; column < this.columns; column += 1) {
        const index = row * this.columns + column;
        if (column + 1 < this.columns) this.conductPair(index, index + 1, deltaSeconds);
        if (row + 1 < this.rows) this.conductPair(
          index,
          index + this.columns,
          deltaSeconds,
        );
      }
    }

    // Only these boundary terms exchange heat with the room/substrate. They
    // are booked separately so internal conduction can be tested in isolation.
    for (let row = 0; row < this.rows; row += 1) {
      for (let column = 0; column < this.columns; column += 1) {
        const index = row * this.columns + column;
        let boundaryRate = 0;
        if (row === 0) boundaryRate += SURFACE_HEAT_EXCHANGE_PER_SECOND;
        if (column === 0 || column === this.columns - 1) {
          boundaryRate += GLASS_HEAT_EXCHANGE_PER_SECOND;
        }
        if (row === this.rows - 1) boundaryRate += SUBSTRATE_HEAT_EXCHANGE_PER_SECOND;
        if (boundaryRate <= 0) continue;
        const exchange = (ambientTemperature - this.temperature[index]) *
          this.heatCapacity[index] * (1 - Math.exp(-boundaryRate * deltaSeconds));
        this.thermalEnergyScratch[index] += exchange;
        this.cumulativeExternalHeat += exchange;
      }
    }

    for (let index = 0; index < this.cellCount; index += 1) {
      this.temperature[index] = finiteTemperature(
        this.thermalEnergyScratch[index] / this.heatCapacity[index],
        ambientTemperature,
      );
    }

    this.flowAccumulator += deltaSeconds;
    this.heatAdvectionAccumulator += deltaSeconds;
    if (this.flowAccumulator + 1e-9 >= FLOW_SOLVE_INTERVAL_SECONDS) {
      this.advanceVelocity(this.flowAccumulator);
      this.flowAccumulator = 0;
      this.advectWaterHeat(this.heatAdvectionAccumulator, ambientTemperature);
      this.heatAdvectionAccumulator = 0;
    }
  }

  private advanceVelocity(deltaSeconds: number): void {
    const referenceTemperature = this.averageTemperature();
    const damping = Math.exp(-VELOCITY_DAMPING_PER_SECOND * deltaSeconds);
    for (let index = 0; index < this.cellCount; index += 1) {
      const resistance = this.flowResistance[index];
      const localDamping = damping * Math.exp(-resistance * 5.2 * deltaSeconds);
      this.velocityX[index] *= localDamping;
      this.velocityY[index] = (
        this.velocityY[index] -
        (this.temperature[index] - referenceTemperature) *
          BUOYANCY_ACCELERATION * deltaSeconds
      ) * localDamping;
    }

    this.diffuseVelocity(deltaSeconds);
    this.projectVelocity();
  }

  private diffuseVelocity(deltaSeconds: number): void {
    const response = (1 - Math.exp(-VELOCITY_VISCOSITY_PER_SECOND * deltaSeconds)) / 4;
    for (let index = 0; index < this.cellCount; index += 1) {
      this.velocityScratchX[index] = this.velocityX[index];
      this.velocityScratchY[index] = this.velocityY[index];
    }
    for (let row = 0; row < this.rows; row += 1) {
      for (let column = 0; column < this.columns; column += 1) {
        const index = row * this.columns + column;
        if (column + 1 < this.columns) {
          this.exchangeVelocity(index, index + 1, response);
        }
        if (row + 1 < this.rows) {
          this.exchangeVelocity(index, index + this.columns, response);
        }
      }
    }
    for (let index = 0; index < this.cellCount; index += 1) {
      this.velocityX[index] = this.velocityScratchX[index];
      this.velocityY[index] = this.velocityScratchY[index];
    }
  }

  private exchangeVelocity(first: number, second: number, response: number): void {
    const permeability = 1 - Math.max(this.flowResistance[first], this.flowResistance[second]);
    const transferX = (this.velocityX[second] - this.velocityX[first]) * response * permeability;
    const transferY = (this.velocityY[second] - this.velocityY[first]) * response * permeability;
    this.velocityScratchX[first] += transferX;
    this.velocityScratchX[second] -= transferX;
    this.velocityScratchY[first] += transferY;
    this.velocityScratchY[second] -= transferY;
  }

  private projectVelocity(): void {
    this.faceVelocityX.fill(0);
    this.faceVelocityY.fill(0);
    for (let row = 0; row < this.rows; row += 1) {
      for (let faceColumn = 1; faceColumn < this.columns; faceColumn += 1) {
        const left = row * this.columns + faceColumn - 1;
        const right = left + 1;
        const permeability = 1 - Math.max(
          this.flowResistance[left],
          this.flowResistance[right],
        );
        this.faceVelocityX[row * (this.columns + 1) + faceColumn] = clamp(
          0.5 * (this.velocityX[left] + this.velocityX[right]) * permeability,
          -MAX_CELL_SPEED,
          MAX_CELL_SPEED,
        );
      }
    }
    for (let faceRow = 1; faceRow < this.rows; faceRow += 1) {
      for (let column = 0; column < this.columns; column += 1) {
        const up = (faceRow - 1) * this.columns + column;
        const down = up + this.columns;
        const permeability = 1 - Math.max(
          this.flowResistance[up],
          this.flowResistance[down],
        );
        this.faceVelocityY[faceRow * this.columns + column] = clamp(
          0.5 * (this.velocityY[up] + this.velocityY[down]) * permeability,
          -MAX_CELL_SPEED,
          MAX_CELL_SPEED,
        );
      }
    }

    for (let row = 0; row < this.rows; row += 1) {
      for (let column = 0; column < this.columns; column += 1) {
        const index = row * this.columns + column;
        const left = this.faceVelocityX[row * (this.columns + 1) + column];
        const right = this.faceVelocityX[row * (this.columns + 1) + column + 1];
        const up = this.faceVelocityY[row * this.columns + column];
        const down = this.faceVelocityY[(row + 1) * this.columns + column];
        this.divergence[index] = right - left + down - up;
        this.pressure[index] = 0;
      }
    }

    for (let iteration = 0; iteration < PRESSURE_ITERATIONS; iteration += 1) {
      for (let row = 0; row < this.rows; row += 1) {
        for (let column = 0; column < this.columns; column += 1) {
          const index = row * this.columns + column;
          const left = column > 0 ? this.pressure[index - 1] : this.pressure[index];
          const right = column + 1 < this.columns
            ? this.pressure[index + 1]
            : this.pressure[index];
          const up = row > 0 ? this.pressure[index - this.columns] : this.pressure[index];
          const down = row + 1 < this.rows
            ? this.pressure[index + this.columns]
            : this.pressure[index];
          let neighborSum = 0;
          let neighborCount = 0;
          if (column > 0) { neighborSum += left; neighborCount += 1; }
          if (column + 1 < this.columns) { neighborSum += right; neighborCount += 1; }
          if (row > 0) { neighborSum += up; neighborCount += 1; }
          if (row + 1 < this.rows) { neighborSum += down; neighborCount += 1; }
          this.pressureScratch[index] = neighborCount > 0
            ? (neighborSum - this.divergence[index]) / neighborCount
            : 0;
        }
      }
      // A direct TypedArray#set inside the 120 Hz worker showed up as one of
      // the largest transient V8 allocation sites on Electron/macOS. Reusing
      // the existing arrays with scalar copies keeps the pressure solve inside
      // one fixed backing store.
      for (let index = 0; index < this.cellCount; index += 1) {
        this.pressure[index] = this.pressureScratch[index];
      }
    }

    for (let row = 0; row < this.rows; row += 1) {
      for (let faceColumn = 1; faceColumn < this.columns; faceColumn += 1) {
        const leftCell = row * this.columns + faceColumn - 1;
        const rightCell = leftCell + 1;
        const faceIndex = row * (this.columns + 1) + faceColumn;
        this.faceVelocityX[faceIndex] = clamp(
          this.faceVelocityX[faceIndex] -
            (this.pressure[rightCell] - this.pressure[leftCell]),
          -MAX_CELL_SPEED,
          MAX_CELL_SPEED,
        );
      }
    }
    for (let faceRow = 1; faceRow < this.rows; faceRow += 1) {
      for (let column = 0; column < this.columns; column += 1) {
        const upCell = (faceRow - 1) * this.columns + column;
        const downCell = upCell + this.columns;
        const faceIndex = faceRow * this.columns + column;
        this.faceVelocityY[faceIndex] = clamp(
          this.faceVelocityY[faceIndex] -
            (this.pressure[downCell] - this.pressure[upCell]),
          -MAX_CELL_SPEED,
          MAX_CELL_SPEED,
        );
      }
    }

    for (let row = 0; row < this.rows; row += 1) {
      for (let column = 0; column < this.columns; column += 1) {
        const index = row * this.columns + column;
        const leftFace = this.faceVelocityX[row * (this.columns + 1) + column];
        const rightFace = this.faceVelocityX[row * (this.columns + 1) + column + 1];
        const upFace = this.faceVelocityY[row * this.columns + column];
        const downFace = this.faceVelocityY[(row + 1) * this.columns + column];
        this.velocityX[index] = 0.5 * (leftFace + rightFace);
        this.velocityY[index] = 0.5 * (upFace + downFace);
      }
    }
  }

  private advectWaterHeat(deltaSeconds: number, fallbackTemperature: number): void {
    for (let index = 0; index < this.cellCount; index += 1) {
      this.advectedHeat[index] = this.temperature[index] * this.heatCapacity[index];
    }
    this.advectConservativeField(this.advectedHeat, deltaSeconds, this.maximumHeat);
    for (let index = 0; index < this.cellCount; index += 1) {
      this.temperature[index] = finiteTemperature(
        this.advectedHeat[index] / this.heatCapacity[index],
        fallbackTemperature,
      );
    }
  }


  private conductPair(first: number, second: number, deltaSeconds: number): void {
    const effectiveConductivity = 2 * this.conductivity[first] * this.conductivity[second] /
      Math.max(1e-9, this.conductivity[first] + this.conductivity[second]);
    const transfer = (this.temperature[second] - this.temperature[first]) *
      effectiveConductivity * deltaSeconds;
    this.thermalEnergyScratch[first] += transfer;
    this.thermalEnergyScratch[second] -= transfer;
  }

  private dispersePair(
    field: Float32Array | Float64Array,
    first: number,
    second: number,
    fieldRetention: number,
    eddyRetention: number,
    permeability: number,
  ): void {
    const response = (1 - fieldRetention * eddyRetention) / 4 * permeability;
    const transfer = (field[second] - field[first]) * response;
    this.scalarScratch[first] += transfer;
    this.scalarScratch[second] -= transfer;
  }

  private prepareDispersionEdges(deltaSeconds: number): void {
    if (
      this.dispersionPreparedRevision === this.revision &&
      Math.abs(this.dispersionPreparedSeconds - deltaSeconds) < 1e-10
    ) return;

    for (let index = 0; index < this.cellCount; index += 1) {
      const velocityX = this.velocityX[index];
      const velocityY = this.velocityY[index];
      this.eddySpeed[index] = Math.sqrt(
        velocityX * velocityX + velocityY * velocityY,
      );
      this.eddyRetentionX[index] = 1;
      this.eddyRetentionY[index] = 1;
      this.eddyPermeabilityX[index] = 0;
      this.eddyPermeabilityY[index] = 0;
    }
    for (let row = 0; row < this.rows; row += 1) {
      for (let column = 0; column < this.columns; column += 1) {
        const index = row * this.columns + column;
        if (column + 1 < this.columns) {
          this.prepareDispersionPair(
            index,
            index + 1,
            deltaSeconds,
            this.eddyRetentionX,
            this.eddyPermeabilityX,
          );
        }
        if (row + 1 < this.rows) {
          this.prepareDispersionPair(
            index,
            index + this.columns,
            deltaSeconds,
            this.eddyRetentionY,
            this.eddyPermeabilityY,
          );
        }
      }
    }
    this.dispersionPreparedRevision = this.revision;
    this.dispersionPreparedSeconds = deltaSeconds;
  }

  private prepareDispersionPair(
    first: number,
    second: number,
    deltaSeconds: number,
    retention: Float32Array,
    permeability: Float32Array,
  ): void {
    const flowMixing = 0.5 * (this.eddySpeed[first] + this.eddySpeed[second]) *
      FLOW_EDDY_MIXING_FACTOR;
    const thermalMixing = Math.abs(this.temperature[first] - this.temperature[second]) *
      THERMAL_EDDY_MIXING_FACTOR;
    const eddyMixing = clamp(
      BACKGROUND_EDDY_MIXING_PER_SECOND + flowMixing + thermalMixing,
      BACKGROUND_EDDY_MIXING_PER_SECOND,
      MAX_EDDY_MIXING_PER_SECOND,
    );
    retention[first] = Math.exp(-eddyMixing * deltaSeconds);
    permeability[first] = 1 - Math.max(
      this.flowResistance[first],
      this.flowResistance[second],
    ) * 0.68;
  }

  private indexAt(point: Vec2): number {
    const column = clamp(
      Math.floor((point.x / this.tankWidth) * this.columns),
      0,
      this.columns - 1,
    );
    const row = clamp(
      Math.floor(((point.y - this.waterTop) / (this.groundY - this.waterTop)) * this.rows),
      0,
      this.rows - 1,
    );
    return row * this.columns + column;
  }

  private worldPointAt(column: number, row: number): Vec2 {
    return {
      x: (column / this.columns) * this.tankWidth,
      y: this.waterTop + (row / this.rows) * (this.groundY - this.waterTop),
    };
  }
}
