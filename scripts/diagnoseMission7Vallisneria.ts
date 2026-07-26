import { SimulationWorld } from '../src/simulation/SimulationWorld';
import type {
  AnimalSpeciesId,
  PlanktonKind,
  SpeciesId,
  SurfaceCellSnapshot,
  Vec2,
} from '../src/simulation/types';

const placePlankton = (
  world: SimulationWorld,
  planktonKind: PlanktonKind,
  point: Vec2,
): void => {
  world.handle({ type: 'pick-plankton', planktonKind, point });
  world.handle({ type: 'drop-held', point });
};

const placeSeed = (
  world: SimulationWorld,
  speciesId: SpeciesId,
  cell: SurfaceCellSnapshot,
): void => {
  world.handle({ type: 'pick-seed', speciesId, point: cell });
  world.handle({ type: 'drop-held', point: cell });
};

const placeAnimal = (
  world: SimulationWorld,
  speciesId: AnimalSpeciesId,
  point: Vec2,
): void => {
  world.handle({ type: 'pick-animal', speciesId, point });
  world.handle({ type: 'drop-held', point });
};

const world = new SimulationWorld('mission-7');
const initialBiofilm = {
  ...world.snapshot().biogeochemistry.biofilmTotals,
};
for (let index = 0; index < 3; index += 1) {
  placePlankton(world, 'phytoplankton', { x: 420 + index * 180, y: 260 + index % 2 * 100 });
  placePlankton(world, 'daphnia', { x: 510 + index * 90, y: 300 + index % 2 * 80 });
}

const substrate = world.snapshot().cells
  .filter((cell) => cell.surfaceKind === 'substrate')
  .sort((left, right) => left.x - right.x);
const atFraction = (fraction: number): SurfaceCellSnapshot =>
  substrate[Math.min(
    substrate.length - 1,
    Math.max(0, Math.round((substrate.length - 1) * fraction)),
  )];
for (const [speciesId, fraction] of [
  ['oedogonium', 0.08],
  ['nitzschia', 0.16],
  ['vallisneria', 0.24],
  ['oedogonium', 0.32],
  ['nitzschia', 0.4],
  ['vallisneria', 0.48],
  ['oedogonium', 0.56],
  ['nitzschia', 0.64],
  ['vallisneria', 0.72],
  ['oedogonium', 0.8],
  ['nitzschia', 0.88],
] as Array<[SpeciesId, number]>) {
  placeSeed(world, speciesId, atFraction(fraction));
}
for (const x of [300, 480, 720, 900]) {
  placeAnimal(world, 'cherry-shrimp', { x, y: 610 });
}
const includeMicrobes =
  process.env.MICROBES !== '0' && !process.argv.includes('--no-microbes');
const additionalInoculations = {
  decomposer: 0,
  nitrifier: 0,
};
if (includeMicrobes) {
  for (const [guildId, x] of [
    ['decomposer', 360],
    ['decomposer', 540],
    ['nitrifier', 720],
    ['nitrifier', 900],
  ] as const) {
    const point = { x, y: 630 };
    world.handle({ type: 'pick-biofilm', guildId, point });
    world.handle({ type: 'drop-held', point });
    additionalInoculations[guildId] += 1;
  }
}
const setupBiofilm = {
  ...world.snapshot().biogeochemistry.biofilmTotals,
};

world.handle({ type: 'start' });
world.handle({ type: 'set-speed', speed: 64 });

const duration = Math.max(600, Number(process.env.DURATION_SECONDS ?? 4_200));
let nextSample = 0;
let snapshot = world.snapshot();
let previousIds = new Set(snapshot.plants.map((plant) => plant.id));
const samples: Array<Record<string, unknown>> = [];
const disappearances: Array<Record<string, unknown>> = [];
for (let guard = 0; snapshot.elapsedSeconds < duration && guard < 10_000; guard += 1) {
  const before = new Map(snapshot.plants.map((plant) => [plant.id, plant]));
  const beforeCells = new Map(snapshot.cells.map((cell) => [cell.id, cell]));
  const beforeLife = new Map(
    world.exportSaveData().seedPlacements.flatMap((placement) =>
      placement.plant ? [[placement.id, placement.plant] as const] : []
    ),
  );
  world.tick(0.1);
  snapshot = world.snapshot();
  const currentIds = new Set(snapshot.plants.map((plant) => plant.id));
  for (const id of previousIds) {
    if (currentIds.has(id)) continue;
    const plant = before.get(id);
    const life = beforeLife.get(id);
    const cell = plant ? beforeCells.get(plant.cellId) : undefined;
    const cause = plant && life
      ? plant.ageSeconds >= plant.lifespanSeconds - 7
        ? 'old-age'
        : life.stressSeconds >= 143 || (cell?.biomass.vallisneria ?? 0) < 0.055
          ? 'reserve-collapse'
          : 'unknown'
      : 'unknown';
    disappearances.push({
      time: Math.round(snapshot.elapsedSeconds),
      id,
      cause,
      origin: plant?.origin,
      age: plant ? Number(plant.ageSeconds.toFixed(1)) : null,
      lifespan: plant ? Number(plant.lifespanSeconds.toFixed(1)) : null,
      health: plant ? Number(plant.health.toFixed(3)) : null,
      scale: plant ? Number(plant.structuralScale.toFixed(3)) : null,
      runnerProgress: plant ? Number(plant.runnerProgress.toFixed(3)) : null,
      stressSeconds: life ? Number(life.stressSeconds.toFixed(1)) : null,
      cellBiomassBefore: cell
        ? Number(cell.biomass.vallisneria.toFixed(4))
        : null,
    });
  }
  previousIds = currentIds;

  if (snapshot.elapsedSeconds + 1e-6 < nextSample) continue;
  const plantCells = snapshot.plants.map((plant) =>
    snapshot.cells.find((cell) => cell.id === plant.cellId)
  ).filter(Boolean);
  samples.push({
    time: Math.round(snapshot.elapsedSeconds),
    plants: snapshot.plants.length,
    supplied: snapshot.plants.filter((plant) => plant.origin === 'supplied').length,
    runners: snapshot.plants.filter((plant) => plant.origin === 'runner').length,
    vallisneria: Number(snapshot.totalBiomass.vallisneria.toFixed(4)),
    minimumPlantBiomass: plantCells.length
      ? Number(Math.min(...plantCells.map((cell) => cell!.biomass.vallisneria)).toFixed(4))
      : 0,
    maximumPlantBiomass: plantCells.length
      ? Number(Math.max(...plantCells.map((cell) => cell!.biomass.vallisneria)).toFixed(4))
      : 0,
    minimumHealth: snapshot.plants.length
      ? Number(Math.min(...snapshot.plants.map((plant) => plant.health)).toFixed(3))
      : 0,
    maximumRunnerProgress: snapshot.plants.length
      ? Number(Math.max(...snapshot.plants.map((plant) => plant.runnerProgress)).toFixed(3))
      : 0,
    averageLight: Number(
      (plantCells.reduce((sum, cell) => sum + (cell?.light ?? 0), 0) /
        Math.max(1, plantCells.length)).toFixed(2),
    ),
    nutrients: Number(snapshot.biogeochemistry.average.nutrients.toFixed(3)),
    toxicWaste: Number(snapshot.biogeochemistry.average.toxicWaste.toFixed(3)),
    organicMatter: Number(snapshot.biogeochemistry.average.organicMatter.toFixed(3)),
    inorganicCarbon: Number(
      snapshot.biogeochemistry.carbonCycle.dissolvedInorganicCarbon.toFixed(3),
    ),
    headspaceCarbon: Number(
      snapshot.biogeochemistry.carbonCycle.headspaceCarbonDioxide.toFixed(3),
    ),
    oxygen: Number(snapshot.biogeochemistry.average.oxygen.toFixed(3)),
    phytoplankton: Number(
      snapshot.biogeochemistry.plankton.phytoplanktonBiomass.toFixed(3),
    ),
    daphnia: snapshot.biogeochemistry.plankton.approximateDaphniaCount,
  });
  nextSample += 300;
}

console.log(JSON.stringify({
  elapsed: snapshot.elapsedSeconds,
  outcome: snapshot.outcome,
  initialBiofilm,
  additionalInoculations,
  setupBiofilm,
  finalBiofilm: snapshot.biogeochemistry.biofilmTotals,
  finalPopulation: snapshot.animalPopulation,
  finalPlankton: snapshot.biogeochemistry.plankton,
  materialBalance: snapshot.biogeochemistry.materialBalance,
  finalPlants: snapshot.plants,
  disappearanceCauses: disappearances.reduce<Record<string, number>>(
    (totals, disappearance) => {
      const cause = String(disappearance.cause ?? 'unknown');
      totals[cause] = (totals[cause] ?? 0) + 1;
      return totals;
    },
    {},
  ),
  disappearances,
  samples,
}, null, 2));
