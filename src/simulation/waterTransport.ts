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
  private readonly temperature = new Float32Array(TRANSPORT_CELL_COUNT);
  private readonly thermalEnergyScratch = new Float64Array(TRANSPORT_CELL_COUNT);
  private readonly advectedHeat = new Float32Array(TRANSPORT_CELL_COUNT);
  private readonly heatCapacity = new Float32Array(TRANSPORT_CELL_COUNT);
  private readonly maximumHeat = new Float32Array(TRANSPORT_CELL_COUNT);
  private readonly conductivity = new Float32Array(TRANSPORT_CELL_COUNT);
  private readonly solidFraction = new Float32Array(TRANSPORT_CELL_COUNT);
  private readonly flowResistance = new Float32Array(TRANSPORT_CELL_COUNT);
  private readonly light = new Float32Array(TRANSPORT_CELL_COUNT);
  private readonly velocityX = new Float32Array(TRANSPORT_CELL_COUNT);
  private readonly velocityY = new Float32Array(TRANSPORT_CELL_COUNT);
  private readonly velocityScratchX = new Float64Array(TRANSPORT_CELL_COUNT);
  private readonly velocityScratchY = new Float64Array(TRANSPORT_CELL_COUNT);
  private readonly pressure = new Float32Array(TRANSPORT_CELL_COUNT);
  private readonly pressureScratch = new Float32Array(TRANSPORT_CELL_COUNT);
  private readonly divergence = new Float32Array(TRANSPORT_CELL_COUNT);
  private readonly faceVelocityX = new Float32Array((TRANSPORT_COLUMNS + 1) * TRANSPORT_ROWS);
  private readonly faceVelocityY = new Float32Array(TRANSPORT_COLUMNS * (TRANSPORT_ROWS + 1));
  private readonly scalarScratch = new Float64Array(TRANSPORT_CELL_COUNT);
  private readonly scalarOutgoing = new Float64Array(TRANSPORT_CELL_COUNT);
  private readonly scalarIncoming = new Float64Array(TRANSPORT_CELL_COUNT);
  private readonly scalarSourceScale = new Float64Array(TRANSPORT_CELL_COUNT);
  private readonly scalarReceiverScale = new Float64Array(TRANSPORT_CELL_COUNT);
  private readonly scalarEdgeX = new Float64Array(TRANSPORT_CELL_COUNT);
  private readonly scalarEdgeY = new Float64Array(TRANSPORT_CELL_COUNT);
  private readonly eddySpeed = new Float32Array(TRANSPORT_CELL_COUNT);
  private readonly eddyRetentionX = new Float32Array(TRANSPORT_CELL_COUNT);
  private readonly eddyRetentionY = new Float32Array(TRANSPORT_CELL_COUNT);
  private readonly eddyPermeabilityX = new Float32Array(TRANSPORT_CELL_COUNT);
  private readonly eddyPermeabilityY = new Float32Array(TRANSPORT_CELL_COUNT);

  private revision = 0;
  private cumulativeExternalHeat = 0;
  private flowAccumulator = 0;
  private heatAdvectionAccumulator = 0;
  private dispersionPreparedRevision = -1;
  private dispersionPreparedSeconds = -1;

  public constructor(initialTemperature = 23.5) {
    this.temperature.fill(finiteTemperature(initialTemperature, 23.5));
    this.heatCapacity.fill(WATER_HEAT_CAPACITY);
    this.maximumHeat.fill(55 * WATER_HEAT_CAPACITY);
    this.conductivity.fill(WATER_CONDUCTIVITY);
  }

  public setEnvironment(light: ArrayLike<number>, obstacles: WaterTransportObstacle[]): void {
    this.copyLightField(light);
    for (let index = 0; index < TRANSPORT_CELL_COUNT; index += 1) {
      this.solidFraction[index] = 0;
    }

    const samplesPerAxis = 3;
    for (let row = 0; row < TRANSPORT_ROWS; row += 1) {
      for (let column = 0; column < TRANSPORT_COLUMNS; column += 1) {
        const index = row * TRANSPORT_COLUMNS + column;
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
    for (let index = 0; index < TRANSPORT_CELL_COUNT; index += 1) {
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

  public sampleVelocityAt(point: Vec2): Vec2 {
    const index = this.indexAt(point);
    return { x: this.velocityX[index], y: this.velocityY[index] };
  }

  public averageTemperature(): number {
    let totalEnergy = 0;
    let totalCapacity = 0;
    for (let index = 0; index < TRANSPORT_CELL_COUNT; index += 1) {
      totalEnergy += this.temperature[index] * this.heatCapacity[index];
      totalCapacity += this.heatCapacity[index];
    }
    return totalCapacity > 0 ? totalEnergy / totalCapacity : mean(this.temperature);
  }

  /** Mean temperature of the water cells touching the closed headspace. */
  public surfaceTemperature(): number {
    let total = 0;
    for (let column = 0; column < TRANSPORT_COLUMNS; column += 1) {
      total += this.temperature[column];
    }
    return total / TRANSPORT_COLUMNS;
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
    if (deltaSeconds <= 0 || field.length !== TRANSPORT_CELL_COUNT) return;
    this.scalarOutgoing.fill(0);
    this.scalarIncoming.fill(0);
    this.scalarEdgeX.fill(0);
    this.scalarEdgeY.fill(0);

    for (let row = 0; row < TRANSPORT_ROWS; row += 1) {
      for (let column = 0; column < TRANSPORT_COLUMNS; column += 1) {
        const index = row * TRANSPORT_COLUMNS + column;
        if (column + 1 < TRANSPORT_COLUMNS) {
          const neighbor = index + 1;
          const velocity = this.faceVelocityX[row * (TRANSPORT_COLUMNS + 1) + column + 1];
          if (Math.abs(velocity) >= 1e-10) {
            const donor = velocity > 0 ? index : neighbor;
            const proposed = Math.min(Math.abs(velocity) * deltaSeconds, 0.45) *
              Math.max(0, field[donor]);
            this.scalarEdgeX[index] = velocity > 0 ? proposed : -proposed;
            this.scalarOutgoing[donor] += proposed;
          }
        }
        if (row + 1 < TRANSPORT_ROWS) {
          const neighbor = index + TRANSPORT_COLUMNS;
          const velocity = this.faceVelocityY[(row + 1) * TRANSPORT_COLUMNS + column];
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

    for (let index = 0; index < TRANSPORT_CELL_COUNT; index += 1) {
      this.scalarSourceScale[index] = this.scalarOutgoing[index] > field[index]
        ? field[index] / this.scalarOutgoing[index]
        : 1;
      this.scalarOutgoing[index] = 0;
      this.scalarIncoming[index] = 0;
    }
    for (let row = 0; row < TRANSPORT_ROWS; row += 1) {
      for (let column = 0; column < TRANSPORT_COLUMNS; column += 1) {
        const index = row * TRANSPORT_COLUMNS + column;
        if (column + 1 < TRANSPORT_COLUMNS) {
          const proposal = this.scalarEdgeX[index];
          if (proposal !== 0) {
            const donor = proposal > 0 ? index : index + 1;
            const receiver = proposal > 0 ? index + 1 : index;
            this.scalarIncoming[receiver] += Math.abs(proposal) * this.scalarSourceScale[donor];
          }
        }
        if (row + 1 < TRANSPORT_ROWS) {
          const proposal = this.scalarEdgeY[index];
          if (proposal !== 0) {
            const donor = proposal > 0 ? index : index + TRANSPORT_COLUMNS;
            const receiver = proposal > 0 ? index + TRANSPORT_COLUMNS : index;
            this.scalarIncoming[receiver] += Math.abs(proposal) * this.scalarSourceScale[donor];
          }
        }
      }
    }

    for (let index = 0; index < TRANSPORT_CELL_COUNT; index += 1) {
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

    for (let row = 0; row < TRANSPORT_ROWS; row += 1) {
      for (let column = 0; column < TRANSPORT_COLUMNS; column += 1) {
        const index = row * TRANSPORT_COLUMNS + column;
        if (column + 1 < TRANSPORT_COLUMNS) {
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
        if (row + 1 < TRANSPORT_ROWS) {
          const proposal = this.scalarEdgeY[index];
          if (proposal !== 0) {
            const donor = proposal > 0 ? index : index + TRANSPORT_COLUMNS;
            const receiver = proposal > 0 ? index + TRANSPORT_COLUMNS : index;
            const actual = Math.abs(proposal) *
              this.scalarSourceScale[donor] * this.scalarReceiverScale[receiver];
            this.scalarScratch[donor] -= actual;
            this.scalarScratch[receiver] += actual;
          }
        }
      }
    }
    for (let index = 0; index < TRANSPORT_CELL_COUNT; index += 1) {
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
    if (deltaSeconds <= 0 || field.length !== TRANSPORT_CELL_COUNT) return;
    this.prepareDispersionEdges(deltaSeconds);
    const fieldRetention = Math.exp(-Math.max(0, fieldMixingPerSecond) * deltaSeconds);
    for (let index = 0; index < TRANSPORT_CELL_COUNT; index += 1) {
      this.scalarScratch[index] = field[index];
    }

    for (let row = 0; row < TRANSPORT_ROWS; row += 1) {
      for (let column = 0; column < TRANSPORT_COLUMNS; column += 1) {
        const index = row * TRANSPORT_COLUMNS + column;
        if (column + 1 < TRANSPORT_COLUMNS) {
          this.dispersePair(
            field,
            index,
            index + 1,
            fieldRetention,
            this.eddyRetentionX[index],
            this.eddyPermeabilityX[index],
          );
        }
        if (row + 1 < TRANSPORT_ROWS) {
          this.dispersePair(
            field,
            index,
            index + TRANSPORT_COLUMNS,
            fieldRetention,
            this.eddyRetentionY[index],
            this.eddyPermeabilityY[index],
          );
        }
      }
    }

    for (let index = 0; index < TRANSPORT_CELL_COUNT; index += 1) {
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
    for (let index = 0; index < TRANSPORT_CELL_COUNT; index += 1) {
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
    if (!state || state.temperature.length !== TRANSPORT_CELL_COUNT) {
      this.temperature.fill(finiteTemperature(fallbackTemperature, 23.5));
      this.velocityX.fill(0);
      this.velocityY.fill(0);
      this.cumulativeExternalHeat = 0;
      this.revision += 1;
      return;
    }
    for (let index = 0; index < TRANSPORT_CELL_COUNT; index += 1) {
      this.temperature[index] = finiteTemperature(state.temperature[index], fallbackTemperature);
      this.velocityX[index] = Number.isFinite(state.velocityX[index]) ? state.velocityX[index] : 0;
      this.velocityY[index] = Number.isFinite(state.velocityY[index]) ? state.velocityY[index] : 0;
    }
    this.cumulativeExternalHeat = Number.isFinite(state.cumulativeExternalHeat)
      ? state.cumulativeExternalHeat
      : 0;
    this.revision = Math.max(this.revision + 1, Math.floor(state.revision || 0));
  }

  public snapshot(): WaterTransportSnapshot {
    let minimumTemperature = Number.POSITIVE_INFINITY;
    let maximumTemperature = Number.NEGATIVE_INFINITY;
    let maximumSpeed = 0;
    for (let index = 0; index < TRANSPORT_CELL_COUNT; index += 1) {
      minimumTemperature = Math.min(minimumTemperature, this.temperature[index]);
      maximumTemperature = Math.max(maximumTemperature, this.temperature[index]);
      maximumSpeed = Math.max(
        maximumSpeed,
        Math.hypot(this.velocityX[index], this.velocityY[index]),
      );
    }
    return {
      columns: TRANSPORT_COLUMNS,
      rows: TRANSPORT_ROWS,
      temperature: Array.from(this.temperature),
      velocityX: Array.from(this.velocityX),
      velocityY: Array.from(this.velocityY),
      solidFraction: Array.from(this.solidFraction),
      flowResistance: Array.from(this.flowResistance),
      averageTemperature: this.averageTemperature(),
      minimumTemperature,
      maximumTemperature,
      maximumSpeed,
      cumulativeExternalHeat: this.cumulativeExternalHeat,
      revision: this.revision,
    };
  }

  private advanceHeatSubstep(deltaSeconds: number, ambientTemperature: number): void {
    for (let index = 0; index < TRANSPORT_CELL_COUNT; index += 1) {
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
    for (let row = 0; row < TRANSPORT_ROWS; row += 1) {
      for (let column = 0; column < TRANSPORT_COLUMNS; column += 1) {
        const index = row * TRANSPORT_COLUMNS + column;
        if (column + 1 < TRANSPORT_COLUMNS) this.conductPair(index, index + 1, deltaSeconds);
        if (row + 1 < TRANSPORT_ROWS) this.conductPair(
          index,
          index + TRANSPORT_COLUMNS,
          deltaSeconds,
        );
      }
    }

    // Only these boundary terms exchange heat with the room/substrate. They
    // are booked separately so internal conduction can be tested in isolation.
    for (let row = 0; row < TRANSPORT_ROWS; row += 1) {
      for (let column = 0; column < TRANSPORT_COLUMNS; column += 1) {
        const index = row * TRANSPORT_COLUMNS + column;
        let boundaryRate = 0;
        if (row === 0) boundaryRate += SURFACE_HEAT_EXCHANGE_PER_SECOND;
        if (column === 0 || column === TRANSPORT_COLUMNS - 1) {
          boundaryRate += GLASS_HEAT_EXCHANGE_PER_SECOND;
        }
        if (row === TRANSPORT_ROWS - 1) boundaryRate += SUBSTRATE_HEAT_EXCHANGE_PER_SECOND;
        if (boundaryRate <= 0) continue;
        const exchange = (ambientTemperature - this.temperature[index]) *
          this.heatCapacity[index] * (1 - Math.exp(-boundaryRate * deltaSeconds));
        this.thermalEnergyScratch[index] += exchange;
        this.cumulativeExternalHeat += exchange;
      }
    }

    for (let index = 0; index < TRANSPORT_CELL_COUNT; index += 1) {
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
    for (let index = 0; index < TRANSPORT_CELL_COUNT; index += 1) {
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
    for (let index = 0; index < TRANSPORT_CELL_COUNT; index += 1) {
      this.velocityScratchX[index] = this.velocityX[index];
      this.velocityScratchY[index] = this.velocityY[index];
    }
    for (let row = 0; row < TRANSPORT_ROWS; row += 1) {
      for (let column = 0; column < TRANSPORT_COLUMNS; column += 1) {
        const index = row * TRANSPORT_COLUMNS + column;
        if (column + 1 < TRANSPORT_COLUMNS) {
          this.exchangeVelocity(index, index + 1, response);
        }
        if (row + 1 < TRANSPORT_ROWS) {
          this.exchangeVelocity(index, index + TRANSPORT_COLUMNS, response);
        }
      }
    }
    for (let index = 0; index < TRANSPORT_CELL_COUNT; index += 1) {
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
    for (let row = 0; row < TRANSPORT_ROWS; row += 1) {
      for (let faceColumn = 1; faceColumn < TRANSPORT_COLUMNS; faceColumn += 1) {
        const left = row * TRANSPORT_COLUMNS + faceColumn - 1;
        const right = left + 1;
        const permeability = 1 - Math.max(
          this.flowResistance[left],
          this.flowResistance[right],
        );
        this.faceVelocityX[row * (TRANSPORT_COLUMNS + 1) + faceColumn] = clamp(
          0.5 * (this.velocityX[left] + this.velocityX[right]) * permeability,
          -MAX_CELL_SPEED,
          MAX_CELL_SPEED,
        );
      }
    }
    for (let faceRow = 1; faceRow < TRANSPORT_ROWS; faceRow += 1) {
      for (let column = 0; column < TRANSPORT_COLUMNS; column += 1) {
        const up = (faceRow - 1) * TRANSPORT_COLUMNS + column;
        const down = up + TRANSPORT_COLUMNS;
        const permeability = 1 - Math.max(
          this.flowResistance[up],
          this.flowResistance[down],
        );
        this.faceVelocityY[faceRow * TRANSPORT_COLUMNS + column] = clamp(
          0.5 * (this.velocityY[up] + this.velocityY[down]) * permeability,
          -MAX_CELL_SPEED,
          MAX_CELL_SPEED,
        );
      }
    }

    for (let row = 0; row < TRANSPORT_ROWS; row += 1) {
      for (let column = 0; column < TRANSPORT_COLUMNS; column += 1) {
        const index = row * TRANSPORT_COLUMNS + column;
        const left = this.faceVelocityX[row * (TRANSPORT_COLUMNS + 1) + column];
        const right = this.faceVelocityX[row * (TRANSPORT_COLUMNS + 1) + column + 1];
        const up = this.faceVelocityY[row * TRANSPORT_COLUMNS + column];
        const down = this.faceVelocityY[(row + 1) * TRANSPORT_COLUMNS + column];
        this.divergence[index] = right - left + down - up;
        this.pressure[index] = 0;
      }
    }

    for (let iteration = 0; iteration < PRESSURE_ITERATIONS; iteration += 1) {
      for (let row = 0; row < TRANSPORT_ROWS; row += 1) {
        for (let column = 0; column < TRANSPORT_COLUMNS; column += 1) {
          const index = row * TRANSPORT_COLUMNS + column;
          const left = column > 0 ? this.pressure[index - 1] : this.pressure[index];
          const right = column + 1 < TRANSPORT_COLUMNS
            ? this.pressure[index + 1]
            : this.pressure[index];
          const up = row > 0 ? this.pressure[index - TRANSPORT_COLUMNS] : this.pressure[index];
          const down = row + 1 < TRANSPORT_ROWS
            ? this.pressure[index + TRANSPORT_COLUMNS]
            : this.pressure[index];
          let neighborSum = 0;
          let neighborCount = 0;
          if (column > 0) { neighborSum += left; neighborCount += 1; }
          if (column + 1 < TRANSPORT_COLUMNS) { neighborSum += right; neighborCount += 1; }
          if (row > 0) { neighborSum += up; neighborCount += 1; }
          if (row + 1 < TRANSPORT_ROWS) { neighborSum += down; neighborCount += 1; }
          this.pressureScratch[index] = neighborCount > 0
            ? (neighborSum - this.divergence[index]) / neighborCount
            : 0;
        }
      }
      this.pressure.set(this.pressureScratch);
    }

    for (let row = 0; row < TRANSPORT_ROWS; row += 1) {
      for (let faceColumn = 1; faceColumn < TRANSPORT_COLUMNS; faceColumn += 1) {
        const leftCell = row * TRANSPORT_COLUMNS + faceColumn - 1;
        const rightCell = leftCell + 1;
        const faceIndex = row * (TRANSPORT_COLUMNS + 1) + faceColumn;
        this.faceVelocityX[faceIndex] = clamp(
          this.faceVelocityX[faceIndex] -
            (this.pressure[rightCell] - this.pressure[leftCell]),
          -MAX_CELL_SPEED,
          MAX_CELL_SPEED,
        );
      }
    }
    for (let faceRow = 1; faceRow < TRANSPORT_ROWS; faceRow += 1) {
      for (let column = 0; column < TRANSPORT_COLUMNS; column += 1) {
        const upCell = (faceRow - 1) * TRANSPORT_COLUMNS + column;
        const downCell = upCell + TRANSPORT_COLUMNS;
        const faceIndex = faceRow * TRANSPORT_COLUMNS + column;
        this.faceVelocityY[faceIndex] = clamp(
          this.faceVelocityY[faceIndex] -
            (this.pressure[downCell] - this.pressure[upCell]),
          -MAX_CELL_SPEED,
          MAX_CELL_SPEED,
        );
      }
    }

    for (let row = 0; row < TRANSPORT_ROWS; row += 1) {
      for (let column = 0; column < TRANSPORT_COLUMNS; column += 1) {
        const index = row * TRANSPORT_COLUMNS + column;
        const leftFace = this.faceVelocityX[row * (TRANSPORT_COLUMNS + 1) + column];
        const rightFace = this.faceVelocityX[row * (TRANSPORT_COLUMNS + 1) + column + 1];
        const upFace = this.faceVelocityY[row * TRANSPORT_COLUMNS + column];
        const downFace = this.faceVelocityY[(row + 1) * TRANSPORT_COLUMNS + column];
        this.velocityX[index] = 0.5 * (leftFace + rightFace);
        this.velocityY[index] = 0.5 * (upFace + downFace);
      }
    }
  }

  private advectWaterHeat(deltaSeconds: number, fallbackTemperature: number): void {
    for (let index = 0; index < TRANSPORT_CELL_COUNT; index += 1) {
      this.advectedHeat[index] = this.temperature[index] * this.heatCapacity[index];
    }
    this.advectConservativeField(this.advectedHeat, deltaSeconds, this.maximumHeat);
    for (let index = 0; index < TRANSPORT_CELL_COUNT; index += 1) {
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

    for (let index = 0; index < TRANSPORT_CELL_COUNT; index += 1) {
      this.eddySpeed[index] = Math.hypot(this.velocityX[index], this.velocityY[index]);
      this.eddyRetentionX[index] = 1;
      this.eddyRetentionY[index] = 1;
      this.eddyPermeabilityX[index] = 0;
      this.eddyPermeabilityY[index] = 0;
    }
    for (let row = 0; row < TRANSPORT_ROWS; row += 1) {
      for (let column = 0; column < TRANSPORT_COLUMNS; column += 1) {
        const index = row * TRANSPORT_COLUMNS + column;
        if (column + 1 < TRANSPORT_COLUMNS) {
          this.prepareDispersionPair(
            index,
            index + 1,
            deltaSeconds,
            this.eddyRetentionX,
            this.eddyPermeabilityX,
          );
        }
        if (row + 1 < TRANSPORT_ROWS) {
          this.prepareDispersionPair(
            index,
            index + TRANSPORT_COLUMNS,
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
      Math.floor((point.x / TANK_WIDTH) * TRANSPORT_COLUMNS),
      0,
      TRANSPORT_COLUMNS - 1,
    );
    const row = clamp(
      Math.floor(((point.y - WATER_TOP) / (GROUND_Y - WATER_TOP)) * TRANSPORT_ROWS),
      0,
      TRANSPORT_ROWS - 1,
    );
    return row * TRANSPORT_COLUMNS + column;
  }

  private worldPointAt(column: number, row: number): Vec2 {
    return {
      x: (column / TRANSPORT_COLUMNS) * TANK_WIDTH,
      y: WATER_TOP + (row / TRANSPORT_ROWS) * (GROUND_Y - WATER_TOP),
    };
  }
}
