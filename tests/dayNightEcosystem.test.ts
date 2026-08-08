import { describe, expect, it } from 'vitest';
import { SimulationWorld } from '../src/simulation/SimulationWorld';
import {
  DAYLIGHT_DAY_EDGE_ANGLE_RADIANS,
  DAYLIGHT_HORIZON_ANGLE_RADIANS,
  daylightAngleRadians,
  dayNightCycleDuration,
  dayNightStateAt,
} from '../src/simulation/dayNight';
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
    expect(dayNightStateAt(120, cycle).phase).toBe('dusk');
    expect(dayNightStateAt(150, cycle).phase).toBe('night');
    expect(dayNightStateAt(330, cycle).phase).toBe('dawn');
    expect(dayNightStateAt(duration, cycle).phase).toBe('day');
    expect(dayNightStateAt(240, cycle).lightMultiplier).toBeCloseTo(0.000001, 8);
  });

  it('gives mission 6 one continuous sunrise-to-sunset irradiance arc', () => {
    const cycle = SCENARIOS['mission-6'].dayNightCycle!;
    const morning = dayNightStateAt(0, cycle);
    const noon = dayNightStateAt(60, cycle);
    const evening = dayNightStateAt(120, cycle);

    expect(cycle.lightProfile).toBe('solar-arc');
    expect(cycle.solarArcExponent).toBe(1);
    expect(morning.phase).toBe('day');
    expect(noon.phase).toBe('day');
    expect(evening.phase).toBe('dusk');
    expect(noon.lightMultiplier).toBeCloseTo(1, 8);
    expect(morning.lightMultiplier).toBeLessThan(noon.lightMultiplier);
    expect(evening.lightMultiplier).toBeCloseTo(morning.lightMultiplier, 8);
  });

  it('batches actual in-tank producer measurements at high fast-forward speed', () => {
    const world = new SimulationWorld('mission-6');
    const substrate = world.snapshot().cells.filter(
      (cell) => cell.surfaceKind === 'substrate',
    );
    placeSeed(world, 'nitzschia', substrate[Math.floor(substrate.length / 2)]);
    world.handle({ type: 'start' });
    const after = advanceTo(world, 220);
    const points = after.producerFluxHistory;

    expect(points.length).toBeGreaterThan(70);
    expect(Math.max(...points.slice(1).map(
      (point, index) => point.elapsedSeconds - points[index].elapsedSeconds,
    ))).toBeLessThanOrEqual(2.01);
    const lit = points.filter((point) =>
      point.elapsedSeconds >= 50 && point.elapsedSeconds <= 70
    );
    const dark = points.filter((point) => point.elapsedSeconds >= 170);
    expect(Math.max(...lit.map((point) => point.effectiveLight))).toBeGreaterThan(20);
    // The ecology field retains a sub-compensation scattered-light floor; the
    // graph must report that measured remainder rather than replacing it with
    // the day/night source multiplier's near-zero value.
    expect(Math.max(...dark.map((point) => point.effectiveLight))).toBeLessThan(1.2);
    expect(Math.max(...lit.map((point) => point.grossPhotosynthesis))).toBeGreaterThan(0);
    expect(Math.max(...dark.map((point) => point.grossPhotosynthesis)))
      .toBeLessThan(0.00001);
    expect(Math.min(...dark.map((point) => point.producerRespiration))).toBeGreaterThan(0);
  });

  it('keeps the solar orbit moving in one direction through the night', () => {
    const cycle = SCENARIOS['mission-6'].dayNightCycle!;
    const morning = daylightAngleRadians(dayNightStateAt(0, cycle));
    const noon = daylightAngleRadians(dayNightStateAt(60, cycle));
    const evening = daylightAngleRadians(dayNightStateAt(120, cycle));
    const duskEnd = daylightAngleRadians(dayNightStateAt(150, cycle));
    const midnight = daylightAngleRadians(dayNightStateAt(240, cycle));
    const nightEnd = daylightAngleRadians(dayNightStateAt(329.999, cycle));
    const nextDawn = daylightAngleRadians(dayNightStateAt(330, cycle));

    expect(morning).toBeCloseTo(DAYLIGHT_DAY_EDGE_ANGLE_RADIANS, 10);
    expect(noon).toBeCloseTo(0, 10);
    expect(evening).toBeCloseTo(-DAYLIGHT_DAY_EDGE_ANGLE_RADIANS, 10);
    expect(duskEnd).toBeCloseTo(-DAYLIGHT_HORIZON_ANGLE_RADIANS, 10);
    expect(midnight).toBeCloseTo(-Math.PI, 10);
    expect(nightEnd).toBeLessThan(midnight);
    expect(Math.cos(nightEnd)).toBeCloseTo(Math.cos(nextDawn), 3);
    expect(Math.sin(nightEnd)).toBeCloseTo(Math.sin(nextDawn), 3);
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
    const world = new SimulationWorld('mission-6');
    expect(scenario.lightOutput).toBe(0);
    expect(scenario.naturalLightOutput).toBeGreaterThan(0);
    world.handle({ type: 'start' });
    const snapshot = advanceTo(world, 60);

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

    const day = advanceTo(world, 60);
    const night = advanceTo(world, 240);
    expect(day.dayNight?.phase).toBe('day');
    // The fixed simulation step may sample a fraction of a second past solar
    // noon, so assert the near-peak interval rather than exact floating-point
    // equality at one instant.
    expect(day.dayNight?.effectiveNaturalLightOutput).toBeGreaterThan(79.7);
    expect(day.dayNight?.effectiveLightOutput).toBeGreaterThan(139.7);
    expect(night.dayNight?.phase).toBe('night');
    expect(night.dayNight?.effectiveNaturalLightOutput).toBeCloseTo(0.00008, 6);
    expect(night.dayNight?.effectiveLightOutput).toBeCloseTo(60.00008, 6);
    expect(night.lightOutput).toBe(60);
  }, 20_000);

  it('separates the night sky remainder from shadow-casting direct sunlight', () => {
    const world = new SimulationWorld('mission-6');
    type LightInternals = {
      elapsedSeconds: number;
      updateDayNightLighting(): void;
      effectiveNaturalLightOutput(): number;
      directNaturalLightOutput(): number;
      diffuseNaturalLightOutput(): number;
    };
    const internals = world as unknown as LightInternals;
    const initial = world.snapshot();
    const naturalOutput = initial.naturalLightOutput;
    const nightMultiplier =
      SCENARIOS['mission-6'].dayNightCycle!.nightLightMultiplier;

    expect(internals.directNaturalLightOutput()).toBeCloseTo(
      naturalOutput * (
        (initial.dayNight?.lightMultiplier ?? 1) - nightMultiplier
      ),
      8,
    );
    expect(internals.diffuseNaturalLightOutput()).toBeCloseTo(
      naturalOutput * nightMultiplier,
      8,
    );

    internals.elapsedSeconds = 240;
    internals.updateDayNightLighting();
    expect(internals.directNaturalLightOutput()).toBe(0);
    expect(internals.diffuseNaturalLightOutput()).toBeCloseTo(
      naturalOutput * nightMultiplier,
      8,
    );
    expect(internals.effectiveNaturalLightOutput()).toBeCloseTo(
      internals.diffuseNaturalLightOutput(),
      8,
    );
  });

  it('changes the actual tank light and reverses producer oxygen flux at night', () => {
    const world = new SimulationWorld('mission-6');
    const substrate = world.snapshot().cells.filter((cell) => cell.surfaceKind === 'substrate');
    placeSeed(world, 'vallisneria', substrate.find((cell) => cell.x > 560) ?? substrate[0]);
    placeSeed(world, 'oedogonium', substrate.find((cell) => cell.x > 430) ?? substrate[1]);
    world.handle({ type: 'start' });

    const day = advanceTo(world, 60);
    const night = advanceTo(world, 240);
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

  it('requires an established multigeneration colony instead of one survivor', () => {
    const scenario = SCENARIOS['mission-6'];
    expect(scenario.timeLimitSeconds).toBeNull();
    expect(scenario.seedBudget.vallisneria).toBe(3);
    expect(scenario.animalSexBudget?.['cherry-shrimp'])
      .toEqual({ female: 2, male: 2 });
    expect(scenario.waterCycle?.microbeBudget)
      .toEqual({ decomposer: 4, nitrifier: 4 });
    expect(scenario.target).toMatchObject({
      type: 'animal-generation',
      minimumGeneration: 3,
      generationCount: 8,
      minimumPopulation: 15,
      holdSeconds: 1_080,
    });

    const world = new SimulationWorld('mission-6');
    const substrate = world.snapshot().cells.filter((cell) => cell.surfaceKind === 'substrate');
    const first = substrate[0]!;
    const second = substrate[1]!;
    placeSeed(world, 'nitzschia', first);
    world.handle({ type: 'start' });
    advanceTo(world, 90);
    world.handle({ type: 'pause' });
    // Mission 6 permits ecological staging after observation has begun: the
    // player may wait for the film to establish before releasing founders.
    placeSeed(world, 'oedogonium', second);
    placeFilm(world, 'decomposer', first);
    placeShrimp(world, first);
    const paused = world.snapshot();
    expect(paused.remainingSeeds.oedogonium).toBe(4);
    expect(paused.remainingMicrobes.decomposer).toBe(3);
    expect(paused.remainingAnimals['cherry-shrimp']).toBe(3);
    world.handle({ type: 'resume' });
    const afterThreeCycles = advanceTo(world, 1_090);
    expect(afterThreeCycles.outcome).toBe('pending');
    expect(afterThreeCycles.missionProgress?.holdTarget).toBe(1_080);
  }, 40_000);
});
