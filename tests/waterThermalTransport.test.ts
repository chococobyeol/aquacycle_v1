import { describe, expect, it } from 'vitest';
import {
  TRANSPORT_CELL_COUNT,
  TRANSPORT_COLUMNS,
  TRANSPORT_ROWS,
  WaterTransportGrid,
} from '../src/simulation/waterTransport';
import { SimulationWorld } from '../src/simulation/SimulationWorld';

const zeros = (): number[] => Array.from({ length: TRANSPORT_CELL_COUNT }, () => 0);

describe('spatial water temperature', () => {
  it('keeps a uniform unlit tank at ambient temperature', () => {
    const grid = new WaterTransportGrid(22);
    grid.setEnvironment(zeros(), []);

    for (let second = 0; second < 600; second += 1) grid.advanceHeat(1, 22);

    const snapshot = grid.snapshot();
    expect(snapshot.temperature.every((temperature) => Math.abs(temperature - 22) < 1e-6))
      .toBe(true);
    expect(snapshot.minimumTemperature).toBeCloseTo(22, 6);
    expect(snapshot.maximumTemperature).toBeCloseTo(22, 6);
    expect(snapshot.maximumSpeed).toBeLessThan(1e-8);
  });

  it('turns a warm lower pocket into an upward buoyant circulation', () => {
    const grid = new WaterTransportGrid(22);
    grid.setEnvironment(zeros(), []);
    const warmRow = TRANSPORT_ROWS - 4;
    const warmColumn = Math.floor(TRANSPORT_COLUMNS / 2);
    const warmIndex = warmRow * TRANSPORT_COLUMNS + warmColumn;
    const state = grid.exportSaveState();
    state.temperature[warmIndex] = 29;
    grid.restoreSaveState(state, 22);

    for (let step = 0; step < 40; step += 1) grid.advanceHeat(0.25, 22);

    const snapshot = grid.snapshot();
    expect(snapshot.maximumSpeed).toBeGreaterThan(0.005);
    expect(snapshot.velocityY[warmIndex]).toBeLessThan(0);
    expect(snapshot.temperature[warmIndex - TRANSPORT_COLUMNS]).toBeGreaterThan(22);
  });

  it('moves a dissolved pulse with the same buoyant flux without changing its total', () => {
    const grid = new WaterTransportGrid(22);
    grid.setEnvironment(zeros(), []);
    const warmRow = TRANSPORT_ROWS - 4;
    const warmColumn = Math.floor(TRANSPORT_COLUMNS / 2);
    const warmIndex = warmRow * TRANSPORT_COLUMNS + warmColumn;
    const state = grid.exportSaveState();
    state.temperature[warmIndex] = 29;
    grid.restoreSaveState(state, 22);
    const tracer = new Float32Array(TRANSPORT_CELL_COUNT);
    tracer[warmIndex] = 60;
    const totalBefore = tracer.reduce((sum, value) => sum + value, 0);

    for (let step = 0; step < 80; step += 1) {
      grid.advanceHeat(0.25, 22);
      grid.advectConservativeField(tracer, 0.25);
    }

    const totalAfter = tracer.reduce((sum, value) => sum + value, 0);
    expect(totalAfter).toBeCloseTo(totalBefore, 4);
    expect(tracer[warmIndex]).toBeLessThan(60);
    expect(tracer[warmIndex - TRANSPORT_COLUMNS]).toBeGreaterThan(0);
    expect(Array.from(tracer).every((value) => value >= 0 && value <= 100)).toBe(true);
  });

  it('keeps a conservative unresolved mixing floor when mean flow is zero', () => {
    const grid = new WaterTransportGrid(22);
    grid.setEnvironment(zeros(), []);
    const tracer = new Float32Array(TRANSPORT_CELL_COUNT);
    const center = Math.floor(TRANSPORT_ROWS / 2) * TRANSPORT_COLUMNS +
      Math.floor(TRANSPORT_COLUMNS / 2);
    tracer[center] = 72;
    const totalBefore = tracer.reduce((sum, value) => sum + value, 0);

    for (let second = 0; second < 120; second += 1) {
      grid.disperseConservativeField(tracer, 1, 0.045);
    }

    const totalAfter = tracer.reduce((sum, value) => sum + value, 0);
    const occupiedCells = Array.from(tracer).filter((value) => value > 0.001).length;
    expect(totalAfter).toBeCloseTo(totalBefore, 4);
    expect(tracer[center]).toBeLessThan(2);
    expect(occupiedCells).toBeGreaterThan(80);
  });

  it('books light and boundary heat while internal conduction stays conservative', () => {
    const grid = new WaterTransportGrid(22);
    const light = zeros();
    const heatedIndex = (TRANSPORT_ROWS - 3) * TRANSPORT_COLUMNS +
      Math.floor(TRANSPORT_COLUMNS / 2);
    light[heatedIndex] = 100;
    grid.setEnvironment(light, []);
    const energyBefore = grid.totalThermalEnergy();

    for (let second = 0; second < 240; second += 1) grid.advanceHeat(1, 22);

    const snapshot = grid.snapshot();
    const energyDelta = grid.totalThermalEnergy() - energyBefore;
    expect(Math.abs(energyDelta - snapshot.cumulativeExternalHeat) / energyBefore)
      .toBeLessThan(0.0001);
    expect(snapshot.temperature[heatedIndex]).toBeGreaterThan(22.02);
    expect(snapshot.temperature[heatedIndex - 1]).toBeGreaterThan(22);
    expect(snapshot.temperature[0]).toBeLessThan(snapshot.temperature[heatedIndex]);
  });

  it('projects a visible stone polygon to partial solid and resistance cells', () => {
    const grid = new WaterTransportGrid(23);
    grid.setEnvironment(zeros(), [{
      polygon: [
        { x: 420, y: 320 },
        { x: 780, y: 320 },
        { x: 780, y: 500 },
        { x: 420, y: 500 },
      ],
    }]);

    const snapshot = grid.snapshot();
    const occupied = snapshot.solidFraction.filter((value) => value > 0);
    expect(occupied.length).toBeGreaterThan(0);
    expect(Math.max(...occupied)).toBeLessThan(0.9);
    expect(Math.max(...snapshot.flowResistance)).toBeGreaterThan(0.5);
    expect(snapshot.solidFraction[0]).toBe(0);
  });

  it('turns the real lamp field into a bounded, observable temperature gradient', () => {
    const world = new SimulationWorld('laboratory');
    world.handle({ type: 'start' });
    world.handle({ type: 'set-speed', speed: 64 });
    while (world.snapshot().elapsedSeconds < 1_800) world.tick(0.1);

    const transport = world.snapshot().biogeochemistry.transport;
    expect(transport.temperature).toHaveLength(TRANSPORT_CELL_COUNT);
    expect(transport.maximumTemperature - transport.minimumTemperature).toBeGreaterThan(0.08);
    expect(transport.averageTemperature).toBeGreaterThan(21.5);
    expect(transport.averageTemperature).toBeLessThan(27);
    expect(transport.maximumTemperature).toBeLessThan(31);
    expect(transport.maximumSpeed).toBeLessThan(0.12);
  });
});
