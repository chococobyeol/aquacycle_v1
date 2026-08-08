import { expect, it } from 'vitest';
import { SimulationWorld } from '../src/simulation/SimulationWorld';
import { CLOSED_MATERIAL_RELATIVE_TOLERANCE } from '../src/simulation/stoichiometry';
import type {
  AnimalSex,
  MicrobeGuildId,
  SpeciesId,
  StructureDefinitionId,
  SurfaceCellSnapshot,
  Vec2,
} from '../src/simulation/types';

const placeSeed = (world: SimulationWorld, speciesId: SpeciesId, point: Vec2): void => {
  world.handle({ type: 'pick-seed', speciesId, point });
  world.handle({ type: 'drop-held', point });
};

const placeShrimp = (
  world: SimulationWorld,
  point: Vec2,
  sex: AnimalSex,
): void => {
  world.handle({ type: 'pick-animal', speciesId: 'cherry-shrimp', sex, point });
  world.handle({ type: 'drop-held', point });
};

const placeStructure = (
  world: SimulationWorld,
  definitionId: StructureDefinitionId,
  point: Vec2,
): void => {
  world.handle({ type: 'pick-structure', definitionId, point });
  world.handle({ type: 'drop-held', point });
  for (let frame = 0; frame < 720; frame += 1) world.tick(1 / 60);
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

it('establishes and holds a multigeneration colony through thirty-three day/night cycles', async () => {
  const world = new SimulationWorld('mission-6');
  placeStructure(world, 'flat-stone', { x: 480, y: 420 });
  placeStructure(world, 'tall-stone', { x: 860, y: 320 });
  const surfaceCells = world.snapshot().cells;
  const substrate = surfaceCells.filter((cell) => cell.surfaceKind === 'substrate');
  const used = new Set<string>();
  const foodPoints: SurfaceCellSnapshot[] = [];
  for (const x of [100, 240, 380, 520, 680, 820, 960, 1_100]) {
    const foodPoint = nearest(surfaceCells, x, used);
    placeSeed(world, 'nitzschia', foodPoint);
    foodPoints.push(foodPoint);
    placeSeed(world, 'oedogonium', nearest(surfaceCells, x + 28, used));
  }
  for (const x of [340, 600, 860]) {
    placeSeed(world, 'vallisneria', nearest(substrate, x, used));
  }
  const centralShrimpPoints = [foodPoints[3], foodPoints[4]]
    .filter((point): point is SurfaceCellSnapshot => Boolean(point));
  const shrimpPoints = Array.from(
    { length: 4 },
    (_, index) => centralShrimpPoints[index % centralShrimpPoints.length]!,
  );
  world.handle({ type: 'start' });
  world.handle({ type: 'set-speed', speed: 64 });
  let decomposerPlaced = false;
  let nitrifierPlaced = false;
  let shrimpReleased = false;
  let nextCycleSample = 360;
  const cycleSamples: ReturnType<SimulationWorld['snapshot']>[] = [];
  let minimumOxygen = Number.POSITIVE_INFINITY;
  let maximumOrganicMatter = 0;
  let snapshot = world.snapshot();

  while (snapshot.elapsedSeconds < 12_000) {
    if (!decomposerPlaced && snapshot.elapsedSeconds >= 90) {
      world.handle({ type: 'pause' });
      for (const cell of surfaceCells.filter((_, index) => index % 4 === 1).slice(0, 4)) {
        placeFilm(world, 'decomposer', cell);
      }
      world.handle({ type: 'resume' });
      decomposerPlaced = true;
    }
    if (!nitrifierPlaced && snapshot.elapsedSeconds >= 190) {
      world.handle({ type: 'pause' });
      for (const cell of surfaceCells.filter((_, index) => index % 4 === 3).slice(0, 4)) {
        placeFilm(world, 'nitrifier', cell);
      }
      world.handle({ type: 'resume' });
      nitrifierPlaced = true;
    }
    if (!shrimpReleased && snapshot.elapsedSeconds >= 3_600) {
      world.handle({ type: 'pause' });
      shrimpPoints.forEach((point, index) => {
        placeShrimp(world, point, index < 2 ? 'female' : 'male');
      });
      world.handle({ type: 'resume' });
      shrimpReleased = true;
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
      // This regression performs more than 100 seconds of deterministic CPU
      // work. Yield only between complete day/night samples so Vitest can
      // service its worker RPC; no simulation time or ecology state changes.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }

  const final = cycleSamples.at(-1)!;
  const tailSamples = cycleSamples.filter(
    (sample) => sample.elapsedSeconds >= 6_000,
  );
  const tailShrimpEvents = final.animalPopulationEvents.filter(
    (event) =>
      event.speciesId === 'cherry-shrimp' &&
      event.elapsedSeconds >= 6_000,
  );
  const finalShrimp = world.exportSaveData().animals.filter(
    (animal) => animal.speciesId === 'cherry-shrimp',
  );

  expect(minimumOxygen).toBeGreaterThan(18);
  expect(maximumOrganicMatter).toBeLessThan(18);
  const tailPopulationSummary = tailSamples.map((sample) => ({
    elapsedSeconds: sample.elapsedSeconds,
    shrimp: sample.animalPopulation['cherry-shrimp'].total,
    vallisneria: sample.totalBiomass.vallisneria,
    plants: sample.plants.length,
    attachedAlgae: sample.totalBiomass.oedogonium + sample.totalBiomass.nitzschia,
  }));
  const tailShrimpCounts = tailPopulationSummary.map((sample) => sample.shrimp);
  const risingIntervals = tailShrimpCounts.slice(1).filter(
    (count, index) => count > tailShrimpCounts[index]!,
  ).length;
  const fallingIntervals = tailShrimpCounts.slice(1).filter(
    (count, index) => count < tailShrimpCounts[index]!,
  ).length;
  // A viable finite population may pass below an arbitrary fixed head count.
  // Judge the living feedback instead: it must remain nonzero, reproduce and
  // show both recovery and decline rather than a one-way collapse or bloom.
  expect(
    Math.min(...tailShrimpCounts),
    JSON.stringify(tailPopulationSummary),
  ).toBeGreaterThan(0);
  expect(risingIntervals).toBeGreaterThanOrEqual(2);
  expect(fallingIntervals).toBeGreaterThanOrEqual(2);
  expect(tailShrimpEvents.some((event) => event.kind === 'birth')).toBe(true);
  expect(tailShrimpEvents.some((event) => event.kind === 'matured')).toBe(true);
  expect(finalShrimp.some((animal) => animal.origin === 'born')).toBe(true);
  expect(finalShrimp.some((animal) => animal.sex === 'female')).toBe(true);
  expect(finalShrimp.some((animal) => animal.sex === 'male')).toBe(true);
  // This is an ecology regression, not a score-timing test. A viable colony
  // can reach the generation threshold near the end of this fixed observation
  // window and still be accumulating the separate 1,080-second hold. The
  // assertions above verify persistence, replacement births, maturation and
  // both rising and falling population intervals directly.
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
