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

const phytoplanktonCount = Math.max(
  1,
  Math.min(3, Math.floor(Number(process.env.MISSION7_PHYTOPLANKTON ?? 3))),
);
const daphniaCount = Math.max(
  1,
  Math.min(3, Math.floor(Number(process.env.MISSION7_DAPHNIA ?? 1))),
);
const duration = Math.max(
  60,
  Math.floor(Number(process.env.MISSION7_DURATION_SECONDS ?? 1_800)),
);
const clustered = process.env.MISSION7_CLUSTERED === '1';
const fullStock = process.env.MISSION7_FULL_STOCK === '1';

const phytoplanktonWeightedAverage = (
  snapshot: ReturnType<SimulationWorld['snapshot']>,
  values: readonly number[],
): number => {
  const weights = snapshot.biogeochemistry.water.phytoplankton;
  let weighted = 0;
  let totalWeight = 0;
  for (let index = 0; index < weights.length; index += 1) {
    const weight = Math.max(0, weights[index] ?? 0);
    weighted += weight * Math.max(0, values[index] ?? 0);
    totalWeight += weight;
  }
  return totalWeight > 1e-12 ? weighted / totalWeight : 0;
};

const world = new SimulationWorld('mission-7');
for (let index = 0; index < phytoplanktonCount; index += 1) {
  placePlankton(world, 'phytoplankton', {
    x: clustered ? 600 : 420 + index * 180,
    y: clustered ? 320 : 260 + (index % 2) * 100,
  });
}
for (let index = 0; index < daphniaCount; index += 1) {
  placePlankton(world, 'daphnia', {
    x: clustered ? 600 : 510 + index * 180,
    y: clustered ? 320 : 300 + (index % 2) * 80,
  });
}

const placeSeed = (
  speciesId: SpeciesId,
  cell: SurfaceCellSnapshot,
): void => {
  world.handle({ type: 'pick-seed', speciesId, point: cell });
  world.handle({ type: 'drop-held', point: cell });
};

const placeAnimal = (speciesId: AnimalSpeciesId, point: Vec2): void => {
  world.handle({ type: 'pick-animal', speciesId, point });
  world.handle({ type: 'drop-held', point });
};

if (fullStock) {
  const substrate = world.snapshot().cells
    .filter((cell) => cell.surfaceKind === 'substrate')
    .sort((left, right) => left.x - right.x);
  const atFraction = (fraction: number): SurfaceCellSnapshot =>
    substrate[Math.min(
      substrate.length - 1,
      Math.max(0, Math.round((substrate.length - 1) * fraction)),
    )];
  const placements: Array<[SpeciesId, number]> = [
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
  ];
  for (const [speciesId, fraction] of placements) {
    placeSeed(speciesId, atFraction(fraction));
  }
  for (const x of [300, 480, 720, 900]) {
    placeAnimal('cherry-shrimp', { x, y: 610 });
  }
}
for (const [guildId, x] of [
  ['decomposer', 360],
  ['decomposer', 540],
  ['nitrifier', 720],
  ['nitrifier', 900],
] as const) {
  const point = { x, y: 630 };
  world.handle({ type: 'pick-biofilm', guildId, point });
  world.handle({ type: 'drop-held', point });
}

world.handle({ type: 'start' });
world.handle({ type: 'set-speed', speed: 64 });

let nextSample = 0;
let guard = 0;
let snapshot = world.snapshot();
const samples: Array<Record<string, number | string>> = [];
while (snapshot.elapsedSeconds < duration && guard < 5_000) {
  world.tick(0.1);
  snapshot = world.snapshot();
  guard += 1;
  if (snapshot.elapsedSeconds + 1e-6 < nextSample) continue;
  samples.push({
    time: Math.round(snapshot.elapsedSeconds),
    phytoplankton: Number(
      snapshot.biogeochemistry.plankton.phytoplanktonBiomass.toFixed(3),
    ),
    daphnia: snapshot.biogeochemistry.plankton.approximateDaphniaCount,
    juvenileBiomass: Number(
      snapshot.biogeochemistry.plankton.daphniaJuvenileBiomass.toFixed(3),
    ),
    adultBiomass: Number(
      snapshot.biogeochemistry.plankton.daphniaAdultBiomass.toFixed(3),
    ),
    secondGeneration: Number(
      snapshot.biogeochemistry.plankton.cumulativeEvents
        .secondGenerationBirths.toFixed(3),
    ),
    phytoNutrients: Number(phytoplanktonWeightedAverage(
      snapshot,
      snapshot.biogeochemistry.water.nutrients,
    ).toFixed(3)),
    phytoAmmonia: Number(phytoplanktonWeightedAverage(
      snapshot,
      snapshot.biogeochemistry.water.toxicWaste,
    ).toFixed(3)),
    phytoCarbon: Number(phytoplanktonWeightedAverage(
      snapshot,
      snapshot.biogeochemistry.water.dissolvedInorganicCarbon,
    ).toFixed(3)),
    phytoOrganicMatter: Number(phytoplanktonWeightedAverage(
      snapshot,
      snapshot.biogeochemistry.water.organicMatter,
    ).toFixed(3)),
    phytoGrowth: Number(
      snapshot.biogeochemistry.plankton.fluxes
        .phytoplanktonGrowthPerSecond.toFixed(6),
    ),
    phytoLoss: Number((
      snapshot.biogeochemistry.plankton.fluxes
        .phytoplanktonRespirationPerSecond +
      snapshot.biogeochemistry.plankton.fluxes
        .phytoplanktonMortalityPerSecond
    ).toFixed(6)),
    oxygen: Number(snapshot.biogeochemistry.average.oxygen.toFixed(2)),
    outcome: snapshot.outcome,
  });
  nextSample += 120;
}

const daphniaDeaths = snapshot.animalPopulationEvents
  .filter((event) => event.speciesId === 'daphnia' && event.kind === 'death')
  .reduce<Record<string, number>>((counts, event) => {
    const cause = event.cause ?? 'unknown';
    counts[cause] = (counts[cause] ?? 0) + 1;
    return counts;
  }, {});

console.log(JSON.stringify({
  inoculation: { phytoplanktonCount, daphniaCount, clustered, fullStock },
  duration: snapshot.elapsedSeconds,
  outcome: snapshot.outcome,
  progress: snapshot.progress,
  plankton: snapshot.biogeochemistry.plankton,
  materialBalance: snapshot.biogeochemistry.materialBalance,
  daphniaIndividuals: world.exportSaveData().animals
    .filter((animal) => animal.speciesId === 'daphnia')
    .map((animal) => ({
      id: animal.id,
      generation: animal.generation ?? 0,
      stage: animal.lifeStage,
      age: Number(animal.ageSeconds.toFixed(1)),
      structure: Number(animal.structuralBiomass.toFixed(4)),
      reserve: Number(animal.storedBiomass.toFixed(4)),
      reproductive: Number(animal.reproductiveBiomass.toFixed(4)),
      cooldown: Number(animal.reproductionCooldown.toFixed(1)),
      gestation: animal.gestationRemaining === null
        ? null
        : Number(animal.gestationRemaining.toFixed(1)),
      energy: Number(animal.energy.toFixed(3)),
      health: Number(animal.health.toFixed(3)),
    })),
  daphniaDeaths,
  samples,
}, null, 2));
