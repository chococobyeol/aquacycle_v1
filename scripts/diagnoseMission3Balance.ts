import { SimulationWorld } from '../src/simulation/SimulationWorld';
import type {
  StructureDefinitionId,
  SurfaceCellSnapshot,
  Vec2,
} from '../src/simulation/types';

const settle = (world: SimulationWorld): void => {
  for (let index = 0; index < 900; index += 1) world.tick(1 / 60);
};

const placeStructure = (
  world: SimulationWorld,
  definitionId: StructureDefinitionId,
  point: Vec2,
): void => {
  world.handle({ type: 'pick-structure', definitionId, point });
  world.handle({ type: 'drop-held', point });
  settle(world);
};

const placeSeed = (
  world: SimulationWorld,
  cell: SurfaceCellSnapshot,
): void => {
  world.handle({ type: 'pick-seed', speciesId: 'oedogonium', point: cell });
  world.handle({ type: 'drop-held', point: cell });
};

const separated = (
  cells: SurfaceCellSnapshot[],
  count: number,
  score: (cell: SurfaceCellSnapshot) => number,
): SurfaceCellSnapshot[] => {
  const selected: SurfaceCellSnapshot[] = [];
  for (const candidate of [...cells].sort((left, right) => score(right) - score(left))) {
    if (selected.some((cell) => Math.hypot(
      cell.x - candidate.x,
      cell.y - candidate.y,
    ) <= 70)) continue;
    selected.push(candidate);
    if (selected.length === count) break;
  }
  return selected;
};

const run = (
  label: string,
  arrange: (world: SimulationWorld) => SurfaceCellSnapshot[],
): unknown => {
  const world = new SimulationWorld('mission-3');
  const seeded = arrange(world);
  for (const cell of seeded) placeSeed(world, cell);
  const initial = world.snapshot();
  world.handle({ type: 'start' });
  world.handle({ type: 'set-speed', speed: 64 });
  while (world.snapshot().elapsedSeconds < 300) world.tick(0.1);
  const final = world.snapshot();
  return {
    label,
    seededLight: seeded.map((cell) => Number(cell.light.toFixed(2))),
    initialBiomass: initial.totalBiomass.oedogonium,
    finalBiomass: final.totalBiomass.oedogonium,
    gain: final.totalBiomass.oedogonium - initial.totalBiomass.oedogonium,
    outcome: final.outcome,
  };
};

const reports = [
  run('substrate-two-brightest', (world) => separated(
    world.snapshot().cells.filter((cell) => cell.surfaceKind === 'substrate'),
    2,
    (cell) => cell.light,
  )),
  run('flat-stone-two-near-68', (world) => {
    placeStructure(world, 'flat-stone', { x: 408, y: 250 });
    return separated(
      world.snapshot().cells.filter((cell) => cell.surfaceKind === 'structure-face'),
      2,
      (cell) => -Math.abs(cell.light - 68),
    );
  }),
  run('tall-stone-two-brightest', (world) => {
    placeStructure(world, 'tall-stone', { x: 408, y: 250 });
    return separated(
      world.snapshot().cells.filter((cell) => cell.surfaceKind === 'structure-face'),
      2,
      (cell) => cell.light,
    );
  }),
  run('raised-stack-one-near-68', (world) => {
    placeStructure(world, 'tall-stone', { x: 408, y: 250 });
    placeStructure(world, 'flat-stone', { x: 408, y: 300 });
    return separated(
      world.snapshot().cells.filter((cell) => cell.surfaceKind === 'structure-face'),
      1,
      (cell) => -Math.abs(cell.light - 68),
    );
  }),
  run('raised-stack-two-brightest', (world) => {
    placeStructure(world, 'tall-stone', { x: 408, y: 250 });
    placeStructure(world, 'flat-stone', { x: 408, y: 300 });
    return separated(
      world.snapshot().cells.filter((cell) => cell.surfaceKind === 'structure-face'),
      2,
      (cell) => cell.light,
    );
  }),
];

console.log(JSON.stringify(reports, null, 2));
