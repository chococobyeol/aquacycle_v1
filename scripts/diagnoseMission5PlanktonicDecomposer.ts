import { SimulationWorld } from '../src/simulation/SimulationWorld';
import type {
  MicrobeGuildId,
  SpeciesId,
  SurfaceCellSnapshot,
  Vec2,
} from '../src/simulation/types';

const placeSeed = (
  world: SimulationWorld,
  speciesId: SpeciesId,
  point: Vec2,
): void => {
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
  if (!cell) throw new Error('diagnostic needs another substrate cell');
  used.add(cell.id);
  return cell;
};

const world = new SimulationWorld('mission-5');
const durationSeconds = Number(process.env.DURATION_SECONDS ?? 7_200);
const skipMicrobes = process.env.NO_MICROBES === '1';
const sampleIntervalSeconds = Number(process.env.SAMPLE_INTERVAL_SECONDS ?? 600);
const substrate = world.snapshot().cells.filter((cell) => cell.surfaceKind === 'substrate');
const used = new Set<string>();
for (const x of [260, 470, 730, 940]) {
  placeSeed(world, 'nitzschia', nearestUnusedCell(substrate, x, 38, used));
  placeSeed(world, 'oedogonium', nearestUnusedCell(substrate, x + 24, 68, used));
}
for (const x of [290, 430, 770, 910]) placeShrimp(world, { x, y: 600 });

world.handle({ type: 'start' });
world.handle({ type: 'set-speed', speed: 64 });
let decomposerPlaced = false;
let nitrifierPlaced = false;
let nextSample = 0;
const seenCarcasses = new Set<string>();
const deathCauses: Record<string, number> = {};
while (world.snapshot().elapsedSeconds < durationSeconds) {
  const before = world.snapshot();
  if (!skipMicrobes && !decomposerPlaced && before.elapsedSeconds >= 90) {
    world.handle({ type: 'pause' });
    for (const cell of substrate.slice(0, 10)) placeFilm(world, 'decomposer', cell);
    world.handle({ type: 'resume' });
    decomposerPlaced = true;
  }
  if (!skipMicrobes && !nitrifierPlaced && before.elapsedSeconds >= 190) {
    world.handle({ type: 'pause' });
    for (const cell of substrate.slice(0, 10)) placeFilm(world, 'nitrifier', cell);
    world.handle({ type: 'resume' });
    nitrifierPlaced = true;
  }
  world.tick(0.1);
  const snapshot = world.snapshot();
  for (const carcass of snapshot.carcasses) {
    if (seenCarcasses.has(carcass.id)) continue;
    seenCarcasses.add(carcass.id);
    deathCauses[carcass.cause] = (deathCauses[carcass.cause] ?? 0) + 1;
  }
  if (snapshot.elapsedSeconds < nextSample) continue;
  nextSample += sampleIntervalSeconds;
  console.log(JSON.stringify({
    time: Math.round(snapshot.elapsedSeconds),
    shrimp: snapshot.animalPopulation['cherry-shrimp'].total,
    algae: Number((
      snapshot.totalBiomass.oedogonium + snapshot.totalBiomass.nitzschia
    ).toFixed(2)),
    organic: Number(snapshot.biogeochemistry.average.organicMatter.toFixed(3)),
    detritus: Number(snapshot.biogeochemistry.detritusMass.toFixed(3)),
    ammonia: Number(snapshot.biogeochemistry.average.toxicWaste.toFixed(3)),
    nutrients: Number(snapshot.biogeochemistry.average.nutrients.toFixed(3)),
    oxygen: Number(snapshot.biogeochemistry.average.oxygen.toFixed(3)),
    inorganicCarbon: Number(
      snapshot.biogeochemistry.carbonCycle.dissolvedInorganicCarbon.toFixed(3),
    ),
    attachedDecomposer: Number(
      snapshot.biogeochemistry.biofilmTotals.decomposer.toFixed(3),
    ),
    attachedNitrifier: Number(
      snapshot.biogeochemistry.biofilmTotals.nitrifier.toFixed(3),
    ),
    planktonicDecomposer: Number(
      snapshot.biogeochemistry.plankton.planktonicDecomposerBiomass.toFixed(3),
    ),
    deathCauses,
    births: snapshot.animalPopulationEventTotals.births,
    deaths: snapshot.animalPopulationEventTotals.deaths,
  }));
}
