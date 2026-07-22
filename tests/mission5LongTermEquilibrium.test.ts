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
  let snapshot = world.snapshot();

  while (snapshot.elapsedSeconds < 7_200) {
    if (!didDecomposer && snapshot.elapsedSeconds >= 90) {
      world.handle({ type: 'pause' });
      inoculate(world, 'decomposer', 10);
      world.handle({ type: 'resume' });
      didDecomposer = true;
    }
    if (!didNitrifier && snapshot.elapsedSeconds >= 190) {
      world.handle({ type: 'pause' });
      inoculate(world, 'nitrifier', 10);
      world.handle({ type: 'resume' });
      didNitrifier = true;
    }

    world.tick(0.1);
    snapshot = world.snapshot();
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
  const chemistry = samples.map((sample) => ({
    time: sample.elapsedSeconds,
    organic: sample.biogeochemistry.average.organicMatter,
    nutrients: sample.biogeochemistry.average.nutrients,
    inorganicCarbon: sample.biogeochemistry.carbonCycle.dissolvedInorganicCarbon,
  }));
  const hasRiseAndFall = (
    key: 'organic' | 'nutrients' | 'inorganicCarbon',
    epsilon = 0.01,
  ): boolean => {
    const values = chemistry.map((sample) => sample[key]);
    const differences = values.slice(1).map((value, index) => value - values[index]);
    return differences.some((difference) => difference > epsilon) &&
      differences.some((difference) => difference < -epsilon);
  };
  const tailStart = chemistry[Math.max(0, chemistry.length - 31)];
  const finalChemistry = chemistry.at(-1)!;

  expect(final.outcome).toBe('success');
  expect(final.animalPopulation['cherry-shrimp'].total).toBeGreaterThan(0);
  expect(Math.max(...population) - Math.min(...population)).toBeGreaterThanOrEqual(3);
  // Cooler, spatially transported water softens the old globally mixed
  // algae swing, but the producer population must still visibly respond.
  expect(Math.max(...algae) - Math.min(...algae)).toBeGreaterThan(15);
  expect(Math.min(...samples.map((sample) => sample.biogeochemistry.average.oxygen)))
    .toBeGreaterThan(30);
  expect(Math.max(...samples.map((sample) => sample.biogeochemistry.average.toxicWaste)))
    .toBeLessThan(6);
  expect(final.biogeochemistry.biofilmTotals.decomposer).toBeGreaterThan(0);
  expect(final.biogeochemistry.biofilmTotals.nitrifier).toBeGreaterThan(0);
  expect(finalChemistry.organic).toBeLessThan(5);
  expect(Math.abs(finalChemistry.organic - tailStart.organic)).toBeLessThan(0.6);
  expect(Math.abs(finalChemistry.nutrients - tailStart.nutrients)).toBeLessThan(2);
  expect(Math.abs(finalChemistry.inorganicCarbon - tailStart.inorganicCarbon)).toBeLessThan(3);
  // The mission now starts with a deliberately finite nutrient reserve so an
  // untreated tank cannot coast through the objective. A treated tank should
  // recycle enough to remain near/above the 3.5 half-saturation point rather
  // than preserving the former oversized starting reservoir.
  expect(finalChemistry.nutrients).toBeGreaterThan(3.5);
  expect(finalChemistry.inorganicCarbon).toBeGreaterThan(12);
  expect(hasRiseAndFall('organic')).toBe(true);
  expect(hasRiseAndFall('nutrients')).toBe(true);
  expect(hasRiseAndFall('inorganicCarbon')).toBe(true);
  expect(final.biogeochemistry.transport.averageTemperature).toBeGreaterThan(21.5);
  expect(final.biogeochemistry.transport.averageTemperature).toBeLessThan(27);
  expect(final.biogeochemistry.transport.maximumTemperature).toBeLessThan(31);
  expect(deathCauses.has('hypoxia')).toBe(false);
  expect(deathCauses.has('toxicity')).toBe(false);
  expect(Math.abs(final.biogeochemistry.materialBalance.nitrogenDriftRatio))
    .toBeLessThan(0.0001);
  expect(Math.abs(final.biogeochemistry.materialBalance.carbonDriftRatio))
    .toBeLessThan(0.0001);
}, 90_000);
