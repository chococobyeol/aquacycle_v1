import { performance } from 'node:perf_hooks';
import { SimulationWorld } from '../src/simulation/SimulationWorld';
import type { SurfaceCellSnapshot, Vec2 } from '../src/simulation/types';

const PLANT_COUNT = 82;
const SHRIMP_COUNT = 13;
const SAMPLE_COUNT = 360;
const WORKER_QUANTUM_SECONDS = 1 / 120;

const percentile = (values: number[], ratio: number): number => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] ?? 0;
};

const statistics = (values: number[]) => ({
  meanMs: values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length),
  p95Ms: percentile(values, 0.95),
  maxMs: Math.max(0, ...values),
});

const placeSeed = (
  world: SimulationWorld,
  cell: SurfaceCellSnapshot,
): void => {
  const point: Vec2 = { x: cell.x, y: cell.y };
  world.handle({ type: 'pick-seed', speciesId: 'vallisneria', point });
  world.handle({ type: 'drop-held', point });
};

const preparedWorld = (): SimulationWorld => {
  const world = new SimulationWorld('laboratory');
  world.handle({ type: 'set-light-output', output: 0 });
  world.handle({ type: 'set-natural-light-output', output: 92 });
  world.handle({ type: 'set-day-night-enabled', enabled: true });
  const substrate = world.snapshot().cells.filter(
    (cell) => cell.surfaceKind === 'substrate',
  );
  const stride = Math.max(1, Math.floor(substrate.length / PLANT_COUNT));
  for (const cell of substrate.filter((_, index) => index % stride === 0).slice(0, PLANT_COUNT)) {
    placeSeed(world, cell);
  }
  for (let index = 0; index < SHRIMP_COUNT; index += 1) {
    const point = {
      x: 180 + (index % 7) * 135,
      y: 500 + Math.floor(index / 7) * 42,
    };
    world.handle({ type: 'pick-animal', speciesId: 'cherry-shrimp', point });
    world.handle({ type: 'drop-held', point });
  }
  // Keep the visual-motion population fixed while profiling worker cadence;
  // ecological deaths would otherwise turn this into a balance fixture.
  (world as unknown as {
    stepAnimalEcology(deltaSeconds: number): void;
  }).stepAnimalEcology = () => undefined;
  world.handle({ type: 'start' });
  world.handle({ type: 'set-speed', speed: 64 });
  return world;
};

const world = preparedWorld();
for (let index = 0; index < 60; index += 1) world.tick(WORKER_QUANTUM_SECONDS);

const tickTimes: number[] = [];
for (let index = 0; index < SAMPLE_COUNT; index += 1) {
  const startedAt = performance.now();
  world.tick(WORKER_QUANTUM_SECONDS);
  tickTimes.push(performance.now() - startedAt);
}

const snapshotStartedAt = performance.now();
const snapshot = world.snapshot();
const snapshotMs = performance.now() - snapshotStartedAt;
const stringifyStartedAt = performance.now();
const serialized = JSON.stringify({ type: 'snapshot', snapshot });
const stringifyMs = performance.now() - stringifyStartedAt;
const parseStartedAt = performance.now();
JSON.parse(serialized);
const parseMs = performance.now() - parseStartedAt;

console.log(JSON.stringify({
  fixture: {
    plants: snapshot.plants.length,
    shrimp: snapshot.animals.length,
    cells: snapshot.cells.length,
    waterCells:
      snapshot.biogeochemistry.water.columns * snapshot.biogeochemistry.water.rows,
  },
  tick: statistics(tickTimes),
  snapshotMs,
  serializedBytes: Buffer.byteLength(serialized),
  stringifyMs,
  parseMs,
}, null, 2));
