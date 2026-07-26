import { describe, expect, it } from 'vitest';
import { SimulationWorld } from '../src/simulation/SimulationWorld';
import type {
  ScenarioId,
  SpeciesId,
  StructureDefinitionId,
  SurfaceCellSnapshot,
  Vec2,
} from '../src/simulation/types';

const LONG_RUN_SECONDS = 1_800;

const placeStructure = (
  world: SimulationWorld,
  definitionId: StructureDefinitionId,
  point: Vec2,
): void => {
  world.handle({ type: 'pick-structure', definitionId, point });
  world.handle({ type: 'drop-held', point });
  for (let index = 0; index < 900; index += 1) world.tick(1 / 60);
};

const placeSeed = (
  world: SimulationWorld,
  speciesId: SpeciesId,
  point: Vec2,
): void => {
  world.handle({ type: 'pick-seed', speciesId, point });
  world.handle({ type: 'drop-held', point });
};

const closestLight = (
  cells: SurfaceCellSnapshot[],
  target: number,
): SurfaceCellSnapshot => {
  const cell = [...cells].sort(
    (left, right) =>
      Math.abs(left.light - target) - Math.abs(right.light - target),
  )[0];
  if (!cell) throw new Error('producer long-run fixture needs a surface cell');
  return cell;
};

const runLong = (
  scenarioId: ScenarioId,
  speciesId: 'oedogonium' | 'nitzschia',
): {
  samples: ReturnType<SimulationWorld['snapshot']>[];
  initialBiomass: number;
} => {
  const world = new SimulationWorld(scenarioId);
  if (scenarioId === 'mission-1') {
    placeStructure(world, 'flat-stone', { x: 600, y: 390 });
    const face = closestLight(
      world.snapshot().cells.filter(
        (cell) => cell.surfaceKind === 'structure-face',
      ),
      68,
    );
    placeSeed(world, speciesId, face);
  } else {
    const targetLight = speciesId === 'nitzschia' ? 38 : 68;
    const substrate = world.snapshot().cells.filter(
      (cell) => cell.surfaceKind === 'substrate',
    );
    const first = closestLight(substrate, targetLight);
    placeSeed(world, speciesId, first);
    const second = [...substrate]
      .filter(
        (cell) =>
          cell.id !== first.id &&
          Math.abs(cell.x - first.x) > 140,
      )
      .sort(
        (left, right) =>
          Math.abs(left.light - targetLight) -
          Math.abs(right.light - targetLight),
      )[0];
    if (second) placeSeed(world, speciesId, second);
  }

  const initial = world.snapshot();
  world.handle({ type: 'start' });
  world.handle({ type: 'set-speed', speed: 64 });
  const started = world.snapshot();
  expect(
    started.phase,
    `failed to start ${scenarioId}: ${started.message}`,
  ).toBe('running');
  const samples: ReturnType<SimulationWorld['snapshot']>[] = [];
  let nextSample = 120;
  const clock = world as unknown as { elapsedSeconds: number };
  let guard = 0;
  while (clock.elapsedSeconds < LONG_RUN_SECONDS && guard < 1_000) {
    world.tick(0.1);
    if (clock.elapsedSeconds >= nextSample) {
      const snapshot = world.snapshot();
      samples.push(snapshot);
      nextSample += 120;
    }
    guard += 1;
  }
  expect(guard).toBeLessThan(1_000);
  return {
    samples,
    initialBiomass: initial.totalBiomass[speciesId],
  };
};

describe('missions 1-3 producer long-run ecology', () => {
  it.each([
    ['mission-1', 'oedogonium'],
    ['mission-2', 'nitzschia'],
    ['mission-3', 'oedogonium'],
  ] as const)(
    'keeps %s producer matter finite and established beyond its mission clock',
    (scenarioId, speciesId) => {
      const { samples, initialBiomass } = runLong(
        scenarioId,
        speciesId,
      );
      const biomass = samples.map(
        (sample) => sample.totalBiomass[speciesId],
      );

      // Mission success/failure is intentionally ignored. These producer-only
      // stages verify that the ecological state itself remains valid long
      // after their UI timers have expired.
      expect(samples.at(-1)?.elapsedSeconds ?? 0)
        .toBeGreaterThanOrEqual(LONG_RUN_SECONDS);
      expect(biomass.every((value) =>
        Number.isFinite(value) && value >= 0,
      )).toBe(true);
      expect(Math.min(...biomass.slice(-5))).toBeGreaterThan(0);
      expect(Math.max(...biomass)).toBeGreaterThan(initialBiomass);
      for (const sample of samples) {
        expect(sample.cells.every((cell) =>
          Number.isFinite(cell.biomass.oedogonium) &&
          Number.isFinite(cell.biomass.nitzschia) &&
          cell.biomass.oedogonium >= 0 &&
          cell.biomass.nitzschia >= 0,
        )).toBe(true);
      }
    },
    30_000,
  );
});
