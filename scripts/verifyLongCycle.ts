import { SimulationWorld } from '../src/simulation/SimulationWorld';
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
  if (!cell) throw new Error('장기 검증용 빈 바닥 셀이 부족합니다.');
  used.add(cell.id);
  return cell;
};

const mean = (values: number[]): number =>
  values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);

const world = new SimulationWorld('mission-6');
const substrate = world.snapshot().cells.filter((cell) => cell.surfaceKind === 'substrate');
const used = new Set<string>();
for (const x of [100, 240, 380, 520, 680, 820, 960, 1_100]) {
  placeSeed(world, 'nitzschia', nearest(substrate, x, used));
  placeSeed(world, 'oedogonium', nearest(substrate, x + 28, used));
}
for (const x of [340, 600, 860]) {
  placeSeed(world, 'vallisneria', nearest(substrate, x, used));
}

world.handle({ type: 'start' });
world.handle({ type: 'set-speed', speed: 64 });
let decomposerPlaced = false;
let nitrifierPlaced = false;
let nextCycleSample = 360;
let minimumOxygen = Number.POSITIVE_INFINITY;
let maximumOrganicMatter = 0;
let snapshot = world.snapshot();
const cycleSamples: ReturnType<SimulationWorld['snapshot']>[] = [];

while (snapshot.elapsedSeconds < 18_000) {
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

const final = cycleSamples.at(-1);
if (!final) throw new Error('장기 검증 표본이 생성되지 않았습니다.');
const previousWindow = cycleSamples.slice(-10, -5);
const finalWindow = cycleSamples.slice(-5);
const averageOf = (
  samples: typeof cycleSamples,
  selector: (sample: (typeof cycleSamples)[number]) => number,
): number => mean(samples.map(selector));
const result = {
  simulatedSeconds: final.elapsedSeconds,
  cycles: cycleSamples.length,
  minimumOxygen,
  maximumOrganicMatter,
  lateOxygenWindowDifference: Math.abs(
    averageOf(finalWindow, (sample) => sample.biogeochemistry.average.oxygen) -
    averageOf(previousWindow, (sample) => sample.biogeochemistry.average.oxygen),
  ),
  lateOrganicWindowDifference: Math.abs(
    averageOf(finalWindow, (sample) => sample.biogeochemistry.average.organicMatter) -
    averageOf(previousWindow, (sample) => sample.biogeochemistry.average.organicMatter),
  ),
  nitrogenDriftRatio: final.biogeochemistry.materialBalance.nitrogenDriftRatio,
  carbonDriftRatio: final.biogeochemistry.materialBalance.carbonDriftRatio,
  oxygenEquivalentDriftRatio:
    final.biogeochemistry.materialBalance.oxygenEquivalentDriftRatio,
};

const checks: Array<[string, boolean]> = [
  ['50주기 완료', result.cycles >= 50],
  ['최저 평균 산소 > 18', result.minimumOxygen > 18],
  ['최대 평균 유기물 < 18', result.maximumOrganicMatter < 18],
  ['후반 산소 창 차이 < 6', result.lateOxygenWindowDifference < 6],
  ['후반 유기물 창 차이 < 1.5', result.lateOrganicWindowDifference < 1.5],
  ['질소 상대 오차 < 0.01%', Math.abs(result.nitrogenDriftRatio) < 0.0001],
  ['탄소 상대 오차 < 0.01%', Math.abs(result.carbonDriftRatio) < 0.0001],
  [
    '산소 등가 상대 오차 < 0.01%',
    Math.abs(result.oxygenEquivalentDriftRatio) < 0.0001,
  ],
];

console.log(JSON.stringify({ result, checks }, null, 2));
const failed = checks.filter(([, passed]) => !passed);
if (failed.length) {
  throw new Error(`장기 순환 검증 실패: ${failed.map(([label]) => label).join(', ')}`);
}
