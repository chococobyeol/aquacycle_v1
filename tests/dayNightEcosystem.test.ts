import { describe, expect, it } from 'vitest';
import { SimulationWorld } from '../src/simulation/SimulationWorld';
import { dayNightCycleDuration, dayNightStateAt } from '../src/simulation/dayNight';
import { algaePhysiology } from '../src/simulation/growth';
import { SCENARIOS } from '../src/simulation/config';
import type { MicrobeGuildId, SpeciesId, Vec2 } from '../src/simulation/types';

const placeSeed = (world: SimulationWorld, speciesId: SpeciesId, point: Vec2): void => {
  world.handle({ type: 'pick-seed', speciesId, point });
  world.handle({ type: 'drop-held', point });
};

const placeShrimp = (world: SimulationWorld, point: Vec2): void => {
  world.handle({ type: 'pick-animal', speciesId: 'cherry-shrimp', point });
  world.handle({ type: 'drop-held', point });
};

const placeFilm = (world: SimulationWorld, guildId: MicrobeGuildId, point: Vec2): void => {
  world.handle({ type: 'pick-biofilm', guildId, point });
  world.handle({ type: 'drop-held', point });
};

const advanceTo = (world: SimulationWorld, target: number): ReturnType<SimulationWorld['snapshot']> => {
  world.handle({ type: 'set-speed', speed: 64 });
  let snapshot = world.snapshot();
  let guard = 0;
  while (snapshot.elapsedSeconds < target && guard < 4_000) {
    world.tick(0.1);
    snapshot = world.snapshot();
    guard += 1;
  }
  expect(guard).toBeLessThan(4_000);
  return snapshot;
};

describe('day/night producer metabolism', () => {
  it('traverses dawn, day, dusk and night periodically', () => {
    const cycle = SCENARIOS['mission-6'].dayNightCycle!;
    const duration = dayNightCycleDuration(cycle);
    expect(duration).toBe(360);
    expect(dayNightStateAt(0, cycle).phase).toBe('day');
    expect(dayNightStateAt(240, cycle).phase).toBe('dusk');
    expect(dayNightStateAt(270, cycle).phase).toBe('night');
    expect(dayNightStateAt(330, cycle).phase).toBe('dawn');
    expect(dayNightStateAt(duration, cycle).phase).toBe('day');
    expect(dayNightStateAt(300, cycle).lightMultiplier).toBeCloseTo(0.045, 6);
  });

  it('keeps respiration running when gross photosynthesis reaches zero', () => {
    for (const speciesId of ['oedogonium', 'nitzschia', 'vallisneria'] as const) {
      const dark = algaePhysiology(speciesId, 0, 24);
      const lit = algaePhysiology(speciesId, 70, 24);
      expect(dark.grossPhotosynthesis).toBe(0);
      expect(dark.respiration).toBeGreaterThan(0);
      expect(dark.netGrowth).toBeLessThan(0);
      expect(lit.grossPhotosynthesis).toBeGreaterThan(lit.respiration);
      expect(lit.netGrowth).toBeGreaterThan(0);
    }
  });

  it('changes the actual tank light and reverses producer oxygen flux at night', () => {
    const world = new SimulationWorld('mission-6');
    const substrate = world.snapshot().cells.filter((cell) => cell.surfaceKind === 'substrate');
    placeSeed(world, 'vallisneria', substrate.find((cell) => cell.x > 560) ?? substrate[0]);
    placeSeed(world, 'oedogonium', substrate.find((cell) => cell.x > 430) ?? substrate[1]);
    world.handle({ type: 'start' });

    const day = advanceTo(world, 120);
    const night = advanceTo(world, 300);
    expect(day.dayNight?.phase).toBe('day');
    expect(night.dayNight?.phase).toBe('night');
    expect(day.dayNight!.effectiveLightOutput).toBeGreaterThan(
      night.dayNight!.effectiveLightOutput * 10,
    );
    expect(day.biogeochemistry.algaeFluxes.grossProductionBiomassPerSecond)
      .toBeGreaterThan(day.biogeochemistry.algaeFluxes.respirationBiomassPerSecond);
    expect(night.biogeochemistry.algaeFluxes.grossProductionBiomassPerSecond).toBe(0);
    expect(night.biogeochemistry.algaeFluxes.respirationBiomassPerSecond).toBeGreaterThan(0);
  }, 20_000);

  it('offers a solvable three-cycle ecosystem without prescribing the layout', () => {
    const world = new SimulationWorld('mission-6');
    const substrate = world.snapshot().cells.filter((cell) => cell.surfaceKind === 'substrate');
    const nearest = (x: number, used: Set<string>) => {
      const cell = [...substrate]
        .filter((candidate) => !used.has(candidate.id))
        .sort((left, right) => Math.abs(left.x - x) - Math.abs(right.x - x))[0];
      if (!cell) throw new Error('mission 6 fixture needs a free substrate cell');
      used.add(cell.id);
      return cell;
    };
    const used = new Set<string>();
    for (const x of [120, 250, 360, 470, 650, 760, 880, 1_030]) {
      placeSeed(world, 'nitzschia', nearest(x, used));
      placeSeed(world, 'oedogonium', nearest(x + 28, used));
    }
    for (const x of [340, 600, 860]) placeSeed(world, 'vallisneria', nearest(x, used));
    for (const x of [290, 430, 770, 910]) placeShrimp(world, { x, y: 600 });
    world.handle({ type: 'start' });
    advanceTo(world, 90);
    world.handle({ type: 'pause' });
    for (const cell of substrate.slice(0, 10)) placeFilm(world, 'decomposer', cell);
    world.handle({ type: 'resume' });
    advanceTo(world, 190);
    world.handle({ type: 'pause' });
    for (const cell of substrate.slice(4, 16)) placeFilm(world, 'nitrifier', cell);
    world.handle({ type: 'resume' });

    const samples = [180, 360, 540, 720, 900, 1_090]
      .map((target) => advanceTo(world, target));
    const final = samples.at(-1)!;
    expect(final.outcome).toBe('success');
    expect(final.animalPopulation['cherry-shrimp'].total).toBeGreaterThan(0);
    expect(Math.min(...samples.map((sample) => sample.biogeochemistry.average.oxygen)))
      .toBeGreaterThan(30);
    expect(Math.abs(final.biogeochemistry.materialBalance.nitrogenDriftRatio)).toBeLessThan(0.0001);
    expect(Math.abs(final.biogeochemistry.materialBalance.carbonDriftRatio)).toBeLessThan(0.0001);
  }, 40_000);
});
