import { readFileSync } from 'node:fs';
import { SimulationWorld } from '../src/simulation/SimulationWorld';
import { vallisneriaLeaves } from '../src/simulation/vallisneriaGeometry';
import type { SimulationSaveData } from '../src/simulation/types';

const world = new SimulationWorld('mission-8');
const inputPath = process.argv
  .find((value) => value.startsWith('--input='))
  ?.split('=')[1];
const readFromStdin = process.argv.includes('--stdin');
const durationArgument = Number(
  process.argv.find((value) => value.startsWith('--duration='))?.split('=')[1],
);
const duration = Number.isFinite(durationArgument) && durationArgument > 0
  ? durationArgument
  : 12_000;
const sampleIntervalArgument = Number(
  process.argv.find((value) => value.startsWith('--sample='))?.split('=')[1],
);
const sampleInterval = Number.isFinite(sampleIntervalArgument) && sampleIntervalArgument > 0
  ? sampleIntervalArgument
  : 600;
const streamSamples = process.argv.includes('--stream');
if (inputPath || readFromStdin) {
  world.loadSaveData(
    JSON.parse(readFileSync(readFromStdin ? 0 : inputPath!, 'utf8')) as SimulationSaveData,
  );
  world.handle({ type: 'resume' });
} else {
  const initial = world.snapshot();
  const substrate = initial.cells.filter(
    (cell) => cell.surfaceKind === 'substrate' && cell.x >= initial.tank.width * 0.68,
  );
  const used = new Set<string>();
  for (let index = 0; index < 6; index += 1) {
    const targetX = initial.tank.width * (0.71 + index * 0.045);
    const cell = substrate
      .filter((candidate) => !used.has(candidate.id))
      .sort((left, right) => Math.abs(left.x - targetX) - Math.abs(right.x - targetX))[0];
    if (!cell) throw new Error('나사말 진단용 바닥 셀이 부족합니다.');
    used.add(cell.id);
    world.handle({ type: 'pick-seed', speciesId: 'vallisneria', point: cell });
    world.handle({ type: 'drop-held', point: cell });
  }
  world.handle({ type: 'start' });
}
world.handle({ type: 'set-speed', speed: 64 });

const internals = world as unknown as {
  ricefishShelterAt(point: { x: number; y: number }): number;
};
const samples = [];
const startingElapsed = world.snapshot().elapsedSeconds;
for (let offset = 0; offset <= duration; offset += sampleInterval) {
  const target = startingElapsed + offset;
  while (world.snapshot().elapsedSeconds + 1e-9 < target) world.tick(0.1);
  const snapshot = world.snapshot();
  let maximumLeafHeight = 0;
  let refugeHeightPlants = 0;
  let adultHeightPlants = 0;
  for (const plant of snapshot.plants) {
    const cell = snapshot.cells.find((candidate) => candidate.id === plant.cellId);
    if (!cell) continue;
    const leaves = vallisneriaLeaves(cell.index, plant, plant.structuralScale);
    const height = Math.max(0, ...leaves.map((leaf) => leaf.root.y - leaf.tip.y));
    maximumLeafHeight = Math.max(maximumLeafHeight, height);
    if (height >= 180) refugeHeightPlants += 1;
    if (height >= 260) adultHeightPlants += 1;
  }
  let maximumShelter = 0;
  let shelteredGridPoints = 0;
  for (let y = snapshot.tank.waterTop + 30; y < snapshot.tank.groundY; y += 24) {
    for (let x = snapshot.tank.width * 0.65; x < snapshot.tank.width - 20; x += 24) {
      const shelter = internals.ricefishShelterAt({ x, y });
      maximumShelter = Math.max(maximumShelter, shelter);
      if (shelter >= 0.2) shelteredGridPoints += 1;
    }
  }
  const sample = {
    elapsed: Math.round(snapshot.elapsedSeconds),
    offset: Math.round(snapshot.elapsedSeconds - startingElapsed),
    plants: snapshot.plants.length,
    supplied: snapshot.plants.filter((plant) => plant.origin === 'supplied').length,
    runners: snapshot.plants.filter((plant) => plant.origin === 'runner').length,
    maximumStructuralScale: Number(Math.max(
      0,
      ...snapshot.plants.map((plant) => plant.structuralScale),
    ).toFixed(3)),
    maximumLeafHeight: Math.round(maximumLeafHeight),
    refugeHeightPlants,
    adultHeightPlants,
    maximumShelter: Number(maximumShelter.toFixed(3)),
    shelteredGridPoints,
    biomass: Number(snapshot.totalBiomass.vallisneria.toFixed(3)),
    runnerBirths: snapshot.plants.reduce(
      (total, plant) => total + plant.reproductionCount,
      0,
    ),
    runnerStates: Object.fromEntries(
      [...new Set(snapshot.plants.map((plant) => plant.runnerState))]
        .sort()
        .map((state) => [
          state,
          snapshot.plants.filter((plant) => plant.runnerState === state).length,
        ]),
    ),
    meanHealth: Number((
      snapshot.plants.reduce((total, plant) => total + plant.health, 0) /
        Math.max(1, snapshot.plants.length)
    ).toFixed(3)),
    meanRunnerReserve: Number((
      snapshot.plants.reduce(
        (total, plant) => total + plant.runnerReserveBiomass,
        0,
      ) / Math.max(1, snapshot.plants.length)
    ).toFixed(4)),
  };
  samples.push(sample);
  if (streamSamples) console.log(JSON.stringify(sample));
}

if (!streamSamples) console.log(JSON.stringify(samples, null, 2));
