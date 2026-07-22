import { describe, expect, it } from 'vitest';
import { SimulationWorld } from '../src/simulation/SimulationWorld';
import type { SpeciesId, Vec2 } from '../src/simulation/types';

const placeSeed = (
  world: SimulationWorld,
  speciesId: SpeciesId,
  point: Vec2,
): void => {
  world.handle({ type: 'pick-seed', speciesId, point });
  world.handle({ type: 'drop-held', point });
};

const advanceTo = (world: SimulationWorld, targetSeconds: number): void => {
  world.handle({ type: 'set-speed', speed: 64 });
  let guard = 0;
  while (world.snapshot().elapsedSeconds < targetSeconds && guard < 5_000) {
    world.tick(0.1);
    guard += 1;
  }
  expect(guard).toBeLessThan(5_000);
};

describe('Vallisneria ramet life cycle', () => {
  it('grows from an established juvenile and reproduces by biomass-conserving runners', () => {
    const world = new SimulationWorld('mission-6');
    const substrate = world.snapshot().cells.filter((cell) => cell.surfaceKind === 'substrate');
    placeSeed(world, 'vallisneria', substrate[Math.floor(substrate.length / 2)]);
    const before = world.snapshot();
    expect(before.plants).toHaveLength(1);
    expect(before.plants[0].lifeStage).toBe('juvenile');
    expect(before.remainingSeeds.vallisneria).toBe(2);

    world.handle({ type: 'start' });
    advanceTo(world, 1_200);
    const after = world.snapshot();
    expect(after.plants.length).toBeGreaterThan(1);
    expect(after.plants.some((plant) => plant.origin === 'runner')).toBe(true);
    expect(after.plants.every((plant) =>
      after.cells.find((cell) => cell.id === plant.cellId)?.surfaceKind === 'substrate'
    )).toBe(true);
    // Runner-born daughters are ecology, not extra use of the supplied stock.
    expect(after.remainingSeeds.vallisneria).toBe(2);
    expect(Math.abs(after.biogeochemistry.materialBalance.nitrogenDriftRatio)).toBeLessThan(0.0001);
    expect(Math.abs(after.biogeochemistry.materialBalance.carbonDriftRatio)).toBeLessThan(0.0001);
  }, 60_000);

  it('keeps structural leaves stable through one night while reserve biomass breathes', () => {
    const world = new SimulationWorld('mission-6');
    const substrate = world.snapshot().cells.filter((cell) => cell.surfaceKind === 'substrate');
    placeSeed(world, 'vallisneria', substrate[Math.floor(substrate.length / 2)]);
    world.handle({ type: 'start' });
    advanceTo(world, 250);
    const beforeNight = world.snapshot().plants[0];
    advanceTo(world, 330);
    const afterNight = world.snapshot().plants.find((plant) => plant.id === beforeNight.id)!;
    expect(afterNight).toBeTruthy();
    expect(Math.abs(afterNight.structuralScale - beforeNight.structuralScale)).toBeLessThan(0.08);
  }, 20_000);

  it('dies at the end of its lifespan and returns its remaining mass to the closed cycle', () => {
    const world = new SimulationWorld('mission-6');
    const substrate = world.snapshot().cells.filter((cell) => cell.surfaceKind === 'substrate');
    placeSeed(world, 'vallisneria', substrate[Math.floor(substrate.length / 2)]);
    world.handle({ type: 'start' });
    const internals = world as unknown as {
      seedPlacements: Array<{
        id: string;
        plant?: { ageSeconds: number; lifespanSeconds: number };
      }>;
    };
    const plant = internals.seedPlacements[0].plant!;
    plant.ageSeconds = plant.lifespanSeconds - 0.1;
    // Worker ticks are intentionally clamped to 0.1 real seconds.
    for (let index = 0; index < 3; index += 1) world.tick(0.1);

    const after = world.snapshot();
    expect(after.plants).toHaveLength(0);
    expect(after.totalBiomass.vallisneria).toBe(0);
    expect(Math.abs(after.biogeochemistry.materialBalance.nitrogenDriftRatio)).toBeLessThan(0.0001);
    expect(Math.abs(after.biogeochemistry.materialBalance.carbonDriftRatio)).toBeLessThan(0.0001);
  });

  it('preserves age, lifespan, leaf structure and runner progress in frozen aquariums', () => {
    const world = new SimulationWorld('mission-6');
    const substrate = world.snapshot().cells.filter((cell) => cell.surfaceKind === 'substrate');
    placeSeed(world, 'vallisneria', substrate[Math.floor(substrate.length / 2)]);
    world.handle({ type: 'start' });
    advanceTo(world, 420);
    const before = world.snapshot().plants[0];
    const restored = new SimulationWorld('mission-1');
    restored.loadSaveData(world.exportSaveData());
    const after = restored.snapshot().plants.find((plant) => plant.id === before.id)!;

    expect(after.ageSeconds).toBeCloseTo(before.ageSeconds, 6);
    expect(after.lifespanSeconds).toBeCloseTo(before.lifespanSeconds, 6);
    expect(after.structuralScale).toBeCloseTo(before.structuralScale, 6);
    expect(after.runnerProgress).toBeCloseTo(before.runnerProgress, 6);
    expect(restored.snapshot().phase).toBe('paused');
  }, 20_000);
});
