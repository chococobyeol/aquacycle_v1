import { expect, it } from 'vitest';
import { SimulationWorld } from '../src/simulation/SimulationWorld';
import type {
  AnimalCarcassSnapshot,
  MicrobeGuildId,
  SpeciesId,
  SurfaceCellSnapshot,
  Vec2,
} from '../src/simulation/types';

const placeSeed = (world: SimulationWorld, speciesId: SpeciesId, point: Vec2): void => {
  world.handle({ type: 'pick-seed', speciesId, point });
  world.handle({ type: 'drop-held', point });
};

const placeShrimp = (world: SimulationWorld, point: Vec2): void => {
  world.handle({ type: 'pick-animal', speciesId: 'cherry-shrimp', point });
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

const nearestUnusedCell = (
  cells: SurfaceCellSnapshot[],
  targetX: number,
  targetLight: number,
  used: Set<string>,
): SurfaceCellSnapshot => {
  const cell = cells
    .filter((candidate) => !used.has(candidate.id))
    .sort((left, right) =>
      Math.abs(left.x - targetX) / 35 + Math.abs(left.light - targetLight) -
      (Math.abs(right.x - targetX) / 35 + Math.abs(right.light - targetLight)))[0];
  if (!cell) throw new Error('long-run fixture needs another substrate cell');
  used.add(cell.id);
  return cell;
};

const populate = (world: SimulationWorld): void => {
  const substrate = world.snapshot().cells.filter((cell) => cell.surfaceKind === 'substrate');
  const used = new Set<string>();
  for (const x of [260, 470, 730, 940]) {
    placeSeed(world, 'nitzschia', nearestUnusedCell(substrate, x, 38, used));
    placeSeed(world, 'oedogonium', nearestUnusedCell(substrate, x + 24, 68, used));
  }
  for (const x of [290, 430, 770, 910]) placeShrimp(world, { x, y: 600 });
};

const inoculate = (
  world: SimulationWorld,
  guildId: MicrobeGuildId,
  count: number,
): void => {
  const cells = world.snapshot().cells
    .filter((candidate) => candidate.surfaceKind === 'substrate')
    .slice(0, count);
  for (const cell of cells) placeFilm(world, guildId, cell);
};

it('keeps a closed mission-5 ecosystem alive through several shrimp generations', () => {
  const world = new SimulationWorld('mission-5');
  populate(world);
  world.handle({ type: 'start' });
  world.handle({ type: 'set-speed', speed: 64 });

  let didDecomposer = false;
  let didNitrifier = false;
  let nextSample = 120;
  const samples: ReturnType<SimulationWorld['snapshot']>[] = [];
  const seenCarcasses = new Set<string>();
  const deathCauses = new Set<AnimalCarcassSnapshot['cause']>();

  while (world.snapshot().elapsedSeconds < 7_200) {
    const before = world.snapshot();
    if (!didDecomposer && before.elapsedSeconds >= 90) {
      world.handle({ type: 'pause' });
      inoculate(world, 'decomposer', 10);
      world.handle({ type: 'resume' });
      didDecomposer = true;
    }
    if (!didNitrifier && before.elapsedSeconds >= 190) {
      world.handle({ type: 'pause' });
      inoculate(world, 'nitrifier', 10);
      world.handle({ type: 'resume' });
      didNitrifier = true;
    }

    world.tick(0.1);
    const snapshot = world.snapshot();
    for (const carcass of snapshot.carcasses) {
      if (seenCarcasses.has(carcass.id)) continue;
      seenCarcasses.add(carcass.id);
      deathCauses.add(carcass.cause);
    }
    if (snapshot.elapsedSeconds >= nextSample) {
      samples.push(snapshot);
      nextSample += 120;
    }
  }

  const final = samples.at(-1)!;
  const population = samples.map((sample) =>
    sample.animalPopulation['cherry-shrimp'].total);
  const algae = samples.map((sample) =>
    sample.totalBiomass.oedogonium + sample.totalBiomass.nitzschia);

  expect(final.outcome).toBe('success');
  expect(final.animalPopulation['cherry-shrimp'].total).toBeGreaterThan(0);
  expect(Math.max(...population) - Math.min(...population)).toBeGreaterThanOrEqual(3);
  expect(Math.max(...algae) - Math.min(...algae)).toBeGreaterThan(20);
  expect(Math.min(...samples.map((sample) => sample.biogeochemistry.average.oxygen)))
    .toBeGreaterThan(30);
  expect(Math.max(...samples.map((sample) => sample.biogeochemistry.average.toxicWaste)))
    .toBeLessThan(6);
  expect(final.biogeochemistry.biofilmTotals.decomposer).toBeGreaterThan(0);
  expect(final.biogeochemistry.biofilmTotals.nitrifier).toBeGreaterThan(0);
  expect(deathCauses.has('hypoxia')).toBe(false);
  expect(deathCauses.has('toxicity')).toBe(false);
  expect(Math.abs(final.biogeochemistry.materialBalance.nitrogenDriftRatio))
    .toBeLessThan(0.0001);
  expect(Math.abs(final.biogeochemistry.materialBalance.carbonDriftRatio))
    .toBeLessThan(0.0001);
}, 90_000);
