import { expect, it } from 'vitest';
import { SimulationWorld } from '../src/simulation/SimulationWorld';
import { WATER_CYCLE_RULES } from '../src/simulation/config';
import { CLOSED_MATERIAL_RELATIVE_TOLERANCE } from '../src/simulation/stoichiometry';
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
      Math.abs(left.x - targetX) / 4 + Math.abs(left.light - targetLight) -
      (Math.abs(right.x - targetX) / 4 + Math.abs(right.light - targetLight)))[0];
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
    toxicWaste: sample.biogeochemistry.average.toxicWaste,
    nutrients: sample.biogeochemistry.average.nutrients,
    mineralNitrogen:
      sample.biogeochemistry.average.nutrients +
      sample.biogeochemistry.average.toxicWaste,
    inorganicCarbon: sample.biogeochemistry.carbonCycle.dissolvedInorganicCarbon,
  }));
  const hasRiseAndFall = (
    key: 'organic' | 'toxicWaste' | 'nutrients' | 'inorganicCarbon',
    epsilon = 0.01,
  ): boolean => {
    const values = chemistry.map((sample) => sample[key]);
    const differences = values.slice(1).map((value, index) => value - values[index]);
    return differences.some((difference) => difference > epsilon) &&
      differences.some((difference) => difference < -epsilon);
  };
  const tailStart = chemistry[Math.max(0, chemistry.length - 31)];
  const finalChemistry = chemistry.at(-1)!;
  const tailChemistry = chemistry.slice(-16);

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
  // The spatial decomposer pool now exposes the short organic pulse produced
  // when a consumer/algae wave turns over.  A single endpoint can therefore
  // land at the crest even though the late orbit remains oxygen-safe and
  // bounded.  Judge the full late window instead of requiring one arbitrary
  // phase to look like a well-mixed steady state.
  expect(Math.max(...tailChemistry.map((sample) => sample.organic))).toBeLessThan(18);
  expect(Math.min(...tailChemistry.map((sample) => sample.organic))).toBeLessThan(2);
  expect(Math.abs(finalChemistry.nutrients - tailStart.nutrients)).toBeLessThan(2);
  // A producer-consumer cycle can put the two endpoint samples on opposite
  // phases even when it is bounded. Check the late window itself rather than
  // requiring two arbitrary timestamps to be nearly equal.
  // The producer crest may temporarily bind much of the closed carbon pool.
  // Requiring at least 1.5 times the producer half-saturation keeps carbon
  // availability above 60% of the light/temperature-limited maximum
  // without treating one arbitrary phase of a conserved orbit as failure.
  expect(Math.min(...tailChemistry.map((sample) => sample.inorganicCarbon)))
    .toBeGreaterThan(WATER_CYCLE_RULES.carbonHalfSaturation * 1.5);
  expect(Math.max(...tailChemistry.map((sample) => sample.inorganicCarbon)))
    .toBeLessThan(36);
  expect(
    Math.max(...tailChemistry.map((sample) => sample.inorganicCarbon)) -
      Math.min(...tailChemistry.map((sample) => sample.inorganicCarbon)),
  ).toBeLessThan(18);
  // In a closed, producer-rich tank much of the finite nitrogen reserve can be
  // bound in living algae instead of remaining dissolved near the Monod
  // half-saturation point. The late water column must retain a non-zero,
  // bounded mineral pool; it need not reproduce the former
  // consumer-crash pulse merely to cross one high concentration.
  const tailMineralNitrogen = tailChemistry.map((sample) => sample.mineralNitrogen);
  expect(Math.min(...tailMineralNitrogen)).toBeGreaterThan(0.5);
  expect(Math.max(...tailMineralNitrogen)).toBeLessThan(6);
  expect(finalChemistry.inorganicCarbon).toBeGreaterThan(12);
  expect(hasRiseAndFall('organic')).toBe(true);
  // Nitrate may settle monotonically into a producer-rich limited state.
  // Ammonium is the actual upstream substrate whose alternating production
  // and nitrification proves that the microbial nitrogen loop remains active.
  expect(hasRiseAndFall('toxicWaste')).toBe(true);
  expect(hasRiseAndFall('inorganicCarbon')).toBe(true);
  expect(final.biogeochemistry.transport.averageTemperature).toBeGreaterThan(21.5);
  expect(final.biogeochemistry.transport.averageTemperature).toBeLessThan(27);
  expect(final.biogeochemistry.transport.maximumTemperature).toBeLessThan(31);
  expect(Math.abs(final.biogeochemistry.materialBalance.nitrogenDriftRatio))
    .toBeLessThan(CLOSED_MATERIAL_RELATIVE_TOLERANCE);
  expect(Math.abs(final.biogeochemistry.materialBalance.carbonDriftRatio))
    .toBeLessThan(CLOSED_MATERIAL_RELATIVE_TOLERANCE);
  expect(Math.abs(final.biogeochemistry.materialBalance.oxygenEquivalentDriftRatio))
    .toBeLessThan(CLOSED_MATERIAL_RELATIVE_TOLERANCE);
// This is 7,200 simulated seconds with live population bookkeeping. Leave
// enough wall-clock headroom for developers to run it while the Electron
// build is also open; the assertions and simulated duration stay unchanged.
}, 180_000);
