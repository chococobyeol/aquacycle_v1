import { describe, expect, it } from 'vitest';
import { SimulationWorld } from '../src/simulation/SimulationWorld';
import { dayNightCycleDuration, dayNightStateAt } from '../src/simulation/dayNight';
import { algaePhysiology } from '../src/simulation/growth';
import { SCENARIOS } from '../src/simulation/config';
import { CLOSED_MATERIAL_RELATIVE_TOLERANCE } from '../src/simulation/stoichiometry';
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

  it('uses the same local-darkness response for night and structural shade', () => {
    for (const speciesId of ['oedogonium', 'nitzschia', 'vallisneria'] as const) {
      const dark = algaePhysiology(speciesId, 0, 24);
      const lit = algaePhysiology(speciesId, 70, 24);
      expect(dark.grossPhotosynthesis).toBe(0);
      expect(dark.respiration).toBeGreaterThan(0);
      expect(dark.netGrowth).toBeCloseTo(
        -dark.respiration - dark.lightStressTurnover,
        8,
      );
      expect(lit.grossPhotosynthesis).toBeGreaterThan(lit.respiration);
      expect(lit.netGrowth).toBeGreaterThan(0);
    }
  });

  it('treats mission 6 daylight as a broad source rather than a hidden lamp cone', () => {
    const scenario = SCENARIOS['mission-6'];
    const snapshot = new SimulationWorld('mission-6').snapshot();
    expect(scenario.lightOutput).toBe(0);
    expect(scenario.naturalLightOutput).toBeGreaterThan(0);

    const { columns, values } = snapshot.lightField;
    const row = 4;
    const left = values[row * columns + 2];
    const middle = values[row * columns + Math.floor(columns / 2)];
    const right = values[row * columns + columns - 3];
    expect(Math.min(left, middle, right)).toBeGreaterThan(50);
    expect(Math.max(left, middle, right) - Math.min(left, middle, right)).toBeLessThan(2);
  });

  it('combines laboratory daylight and lamp output while cycling daylight only', () => {
    const world = new SimulationWorld('laboratory');
    expect(world.snapshot().dayNight).toBeNull();
    world.handle({ type: 'set-light-output', output: 60 });
    world.handle({ type: 'set-natural-light-output', output: 80 });
    world.handle({ type: 'set-day-night-enabled', enabled: true });
    world.handle({ type: 'start' });

    const day = advanceTo(world, 120);
    const night = advanceTo(world, 300);
    expect(day.dayNight?.phase).toBe('day');
    expect(day.dayNight?.effectiveNaturalLightOutput).toBeCloseTo(80, 4);
    expect(day.dayNight?.effectiveLightOutput).toBeCloseTo(140, 4);
    expect(night.dayNight?.phase).toBe('night');
    expect(night.dayNight?.effectiveNaturalLightOutput).toBeCloseTo(3.6, 4);
    expect(night.dayNight?.effectiveLightOutput).toBeCloseTo(63.6, 4);
    expect(night.lightOutput).toBe(60);
  }, 20_000);

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
    expect(night.biogeochemistry.algaeFluxes.grossProductionBiomassPerSecond)
      .toBeLessThan(night.biogeochemistry.algaeFluxes.respirationBiomassPerSecond);
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
    const foodPoints: Vec2[] = [];
    // A player-like solution uses a handful of broad daylight positions rather
    // than exhausting every supplied inoculum or targeting hidden cell values.
    for (const x of [180, 450, 750, 1_020]) {
      const nitzschia = nearest(x, used);
      placeSeed(world, 'nitzschia', nitzschia);
      placeSeed(world, 'oedogonium', nearest(x + 28, used));
      foodPoints.push(nitzschia);
    }
    for (const x of [340, 600, 860]) placeSeed(world, 'vallisneria', nearest(x, used));
    // Supplied adults begin hungry. Placing them at the visible food patches is
    // a normal player action and avoids making the fixture depend on a lucky
    // first random walk before the local-search radius reaches food.
    for (const point of foodPoints) placeShrimp(world, point);
    world.handle({ type: 'start' });
    advanceTo(world, 90);
    world.handle({ type: 'pause' });
    for (const cell of substrate.filter((_, index) => index % 8 === 1).slice(0, 3)) {
      placeFilm(world, 'decomposer', cell);
    }
    world.handle({ type: 'resume' });
    advanceTo(world, 190);
    world.handle({ type: 'pause' });
    for (const cell of substrate.filter((_, index) => index % 8 === 4).slice(0, 3)) {
      placeFilm(world, 'nitrifier', cell);
    }
    world.handle({ type: 'resume' });

    const samples = [180, 360, 540, 720, 900, 1_090]
      .map((target) => advanceTo(world, target));
    const final = samples.at(-1)!;
    expect(final.outcome).toBe('success');
    expect(final.animalPopulation['cherry-shrimp'].total).toBeGreaterThan(0);
    expect(Math.min(...samples.map((sample) => sample.biogeochemistry.average.oxygen)))
      .toBeGreaterThan(30);
    expect(Math.abs(final.biogeochemistry.materialBalance.nitrogenDriftRatio))
      .toBeLessThan(CLOSED_MATERIAL_RELATIVE_TOLERANCE);
    expect(Math.abs(final.biogeochemistry.materialBalance.carbonDriftRatio))
      .toBeLessThan(CLOSED_MATERIAL_RELATIVE_TOLERANCE);
    expect(Math.abs(final.biogeochemistry.materialBalance.oxygenEquivalentDriftRatio))
      .toBeLessThan(CLOSED_MATERIAL_RELATIVE_TOLERANCE);
  }, 40_000);
});
