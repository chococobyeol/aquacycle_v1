import { expect, it } from 'vitest';
import { SimulationWorld } from '../src/simulation/SimulationWorld';
import type {
  MicrobeGuildId,
  SpeciesId,
  SurfaceCellSnapshot,
  Vec2,
} from '../src/simulation/types';

const placeSeed = (world: SimulationWorld, speciesId: SpeciesId, point: Vec2): void => {
  world.handle({ type: 'pick-seed', speciesId, point });
  world.handle({ type: 'drop-held', point });
};

const placeFilm = (
  world: SimulationWorld,
  guildId: MicrobeGuildId,
  point: Vec2,
): void => {
  world.handle({ type: 'pick-biofilm', guildId, point });
  world.handle({ type: 'drop-held', point });
};

const nearest = (
  cells: SurfaceCellSnapshot[],
  x: number,
  used: Set<string>,
): SurfaceCellSnapshot => {
  const cell = cells
    .filter((candidate) => !used.has(candidate.id))
    .sort((left, right) => Math.abs(left.x - x) - Math.abs(right.x - x))[0];
  if (!cell) throw new Error('long day/night fixture needs another substrate cell');
  used.add(cell.id);
  return cell;
};

const mean = (values: number[]): number =>
  values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);

it('approaches a bounded producer-microbial orbit through ten closed day/night cycles', () => {
  const world = new SimulationWorld('mission-6');
  const substrate = world.snapshot().cells.filter((cell) => cell.surfaceKind === 'substrate');
  const used = new Set<string>();
  for (const x of [100, 240, 380, 520, 680, 820, 960, 1_100]) {
    placeSeed(world, 'nitzschia', nearest(substrate, x, used));
    placeSeed(world, 'oedogonium', nearest(substrate, x + 28, used));
  }
  for (const x of [340, 600, 860]) {
    placeSeed(world, 'vallisneria', nearest(substrate, x, used));
  }
  world.handle({ type: 'start' });
  world.handle({ type: 'set-speed', speed: 64 });
  let decomposerPlaced = false;
  let nitrifierPlaced = false;
  let nextCycleSample = 360;
  const cycleSamples: ReturnType<SimulationWorld['snapshot']>[] = [];
  let minimumOxygen = Number.POSITIVE_INFINITY;
  let maximumOrganicMatter = 0;
  let snapshot = world.snapshot();

  while (snapshot.elapsedSeconds < 3_600) {
    if (!decomposerPlaced && snapshot.elapsedSeconds >= 90) {
      world.handle({ type: 'pause' });
      for (const cell of substrate.filter((_, index) => index % 4 === 1).slice(0, 10)) {
        placeFilm(world, 'decomposer', cell);
      }
      world.handle({ type: 'resume' });
      decomposerPlaced = true;
    }
    if (!nitrifierPlaced && snapshot.elapsedSeconds >= 190) {
      world.handle({ type: 'pause' });
      for (const cell of substrate.filter((_, index) => index % 4 === 3).slice(0, 10)) {
        placeFilm(world, 'nitrifier', cell);
      }
      world.handle({ type: 'resume' });
      nitrifierPlaced = true;
    }

    world.tick(0.1);
    snapshot = world.snapshot();
    minimumOxygen = Math.min(minimumOxygen, snapshot.biogeochemistry.average.oxygen);
    maximumOrganicMatter = Math.max(
      maximumOrganicMatter,
      snapshot.biogeochemistry.average.organicMatter,
    );
    if (snapshot.elapsedSeconds >= nextCycleSample) {
      cycleSamples.push(snapshot);
      nextCycleSample += 360;
    }
  }

  const final = cycleSamples.at(-1)!;
  const previousWindow = cycleSamples.slice(-10, -5);
  const finalWindow = cycleSamples.slice(-5);
  const averageOf = (
    samples: typeof cycleSamples,
    selector: (sample: (typeof cycleSamples)[number]) => number,
  ) => mean(samples.map(selector));

  expect(minimumOxygen).toBeGreaterThan(18);
  expect(maximumOrganicMatter).toBeLessThan(18);
  expect(Math.abs(
    averageOf(finalWindow, (sample) => sample.biogeochemistry.average.oxygen) -
    averageOf(previousWindow, (sample) => sample.biogeochemistry.average.oxygen),
  )).toBeLessThan(6);
  expect(Math.abs(
    averageOf(finalWindow, (sample) => sample.biogeochemistry.average.organicMatter) -
    averageOf(previousWindow, (sample) => sample.biogeochemistry.average.organicMatter),
  )).toBeLessThan(1.5);
  expect(Math.abs(final.biogeochemistry.materialBalance.nitrogenDriftRatio))
    .toBeLessThan(0.0001);
  expect(Math.abs(final.biogeochemistry.materialBalance.carbonDriftRatio))
    .toBeLessThan(0.0001);
  expect(Math.abs(final.biogeochemistry.materialBalance.oxygenEquivalentDriftRatio))
    .toBeLessThan(0.0001);
}, 300_000);
