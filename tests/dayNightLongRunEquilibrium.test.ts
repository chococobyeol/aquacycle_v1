import { expect, it } from 'vitest';
import { SimulationWorld } from '../src/simulation/SimulationWorld';
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

it('keeps producers, microbes, Vallisneria and shrimp renewing through ten day/night cycles', () => {
  const world = new SimulationWorld('mission-6');
  const substrate = world.snapshot().cells.filter((cell) => cell.surfaceKind === 'substrate');
  const used = new Set<string>();
  const foodPoints: SurfaceCellSnapshot[] = [];
  for (const x of [100, 240, 380, 520, 680, 820, 960, 1_100]) {
    const foodPoint = nearest(substrate, x, used);
    placeSeed(world, 'nitzschia', foodPoint);
    foodPoints.push(foodPoint);
    placeSeed(world, 'oedogonium', nearest(substrate, x + 28, used));
  }
  for (const x of [340, 600, 860]) {
    placeSeed(world, 'vallisneria', nearest(substrate, x, used));
  }
  for (const point of [
    foodPoints[1],
    foodPoints[2],
    foodPoints[5],
    foodPoints[6],
  ]) {
    if (point) placeShrimp(world, point);
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
  const tailSamples = cycleSamples.filter(
    (sample) => sample.elapsedSeconds >= 1_800,
  );
  const tailShrimpEvents = final.animalPopulationEvents.filter(
    (event) =>
      event.speciesId === 'cherry-shrimp' &&
      event.elapsedSeconds >= 1_800,
  );
  const finalShrimp = world.exportSaveData().animals.filter(
    (animal) => animal.speciesId === 'cherry-shrimp',
  );

  expect(minimumOxygen).toBeGreaterThan(18);
  expect(maximumOrganicMatter).toBeLessThan(18);
  expect(Math.min(...tailSamples.map((sample) =>
    sample.animalPopulation['cherry-shrimp'].total,
  ))).toBeGreaterThan(0);
  expect(tailShrimpEvents.some((event) => event.kind === 'birth')).toBe(true);
  expect(tailShrimpEvents.some((event) => event.kind === 'matured')).toBe(true);
  expect(finalShrimp.some((animal) => animal.origin === 'born')).toBe(true);
  expect(final.plants.some((plant) => plant.origin === 'runner')).toBe(true);
  expect(final.totalBiomass.vallisneria).toBeGreaterThan(0);
  expect(final.biogeochemistry.biofilmTotals.decomposer).toBeGreaterThan(0);
  expect(final.biogeochemistry.biofilmTotals.nitrifier).toBeGreaterThan(0);
  expect(Math.max(...tailSamples.map(
    (sample) => sample.biogeochemistry.average.toxicWaste,
  ))).toBeLessThan(6);
  expect(Math.abs(final.biogeochemistry.materialBalance.nitrogenDriftRatio))
    .toBeLessThan(CLOSED_MATERIAL_RELATIVE_TOLERANCE);
  expect(Math.abs(final.biogeochemistry.materialBalance.carbonDriftRatio))
    .toBeLessThan(CLOSED_MATERIAL_RELATIVE_TOLERANCE);
  expect(Math.abs(final.biogeochemistry.materialBalance.oxygenEquivalentDriftRatio))
    .toBeLessThan(CLOSED_MATERIAL_RELATIVE_TOLERANCE);
}, 300_000);
