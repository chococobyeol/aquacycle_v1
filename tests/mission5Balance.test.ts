import { describe, expect, it } from 'vitest';
import { SimulationWorld } from '../src/simulation/SimulationWorld';
import { BiogeochemistryLedger } from '../src/simulation/biogeochemistry';
import { CLOSED_MATERIAL_RELATIVE_TOLERANCE } from '../src/simulation/stoichiometry';
import {
  GROUND_Y,
  WATER_TOP,
  type AnimalSex,
  type MicrobeGuildId,
  type SpeciesId,
  type SurfaceCellSnapshot,
  type Vec2,
} from '../src/simulation/types';

const placeSeed = (world: SimulationWorld, speciesId: SpeciesId, point: Vec2): void => {
  world.handle({ type: 'pick-seed', speciesId, point });
  world.handle({ type: 'drop-held', point });
};

const placeShrimp = (
  world: SimulationWorld,
  point: Vec2,
  sex?: AnimalSex,
): void => {
  world.handle({ type: 'pick-animal', speciesId: 'cherry-shrimp', sex, point });
  world.handle({ type: 'drop-held', point });
};

const placeBiofilm = (
  world: SimulationWorld,
  guildId: MicrobeGuildId,
  point: Vec2,
): void => {
  world.handle({ type: 'pick-biofilm', guildId, point });
  world.handle({ type: 'drop-held', point });
};

const advanceTo = (world: SimulationWorld, targetSeconds: number): ReturnType<SimulationWorld['snapshot']> => {
  world.handle({ type: 'set-speed', speed: 64 });
  let snapshot = world.snapshot();
  let guard = 0;
  while (snapshot.elapsedSeconds < targetSeconds && guard < 5_000) {
    world.tick(0.1);
    snapshot = world.snapshot();
    guard += 1;
  }
  expect(guard).toBeLessThan(5_000);
  return snapshot;
};

const nearestUnusedCell = (
  cells: SurfaceCellSnapshot[],
  targetX: number,
  targetLight: number,
  used: Set<string>,
): SurfaceCellSnapshot => {
  const available = cells.filter((candidate) => !used.has(candidate.id));
  const nearestXDistance = Math.min(
    ...available.map((candidate) => Math.abs(candidate.x - targetX)),
  );
  const cell = available
    .filter((candidate) =>
      Math.abs(candidate.x - targetX) <= Math.max(70, nearestXDistance + 50),
    )
    .sort((left, right) => {
      const leftScore = Math.abs(left.x - targetX) / 12 + Math.abs(left.light - targetLight);
      const rightScore = Math.abs(right.x - targetX) / 12 + Math.abs(right.light - targetLight);
      return leftScore - rightScore;
    })[0];
  if (!cell) throw new Error('mission 5 fixture needs another substrate cell');
  used.add(cell.id);
  return cell;
};

const populateTank = (
  world: SimulationWorld,
  shrimpCount = 4,
  stockShrimp = true,
): Vec2[] => {
  const substrate = world.snapshot().cells.filter((cell) => cell.surfaceKind === 'substrate');
  const used = new Set<string>();
  const targetXs = [180, 260, 340, 420, 500, 580, 660, 740];
  const foodPoints: Vec2[] = [];
  for (const targetX of targetXs) {
    const nitzschiaCell = nearestUnusedCell(substrate, targetX, 38, used);
    const oedogoniumCell = nearestUnusedCell(substrate, targetX + 24, 68, used);
    placeSeed(world, 'nitzschia', nitzschiaCell);
    placeSeed(world, 'oedogonium', oedogoniumCell);
    foodPoints.push({
      x: (nitzschiaCell.x + oedogoniumCell.x) / 2,
      y: Math.min(610, (nitzschiaCell.y + oedogoniumCell.y) / 2 - 10),
    });
  }
  if (stockShrimp) {
    const pairPoints = [foodPoints[2]!, foodPoints[5]!];
    const placements = pairPoints.flatMap((point) => [
      { point: { x: point.x - 4, y: point.y }, sex: 'female' as const },
      { point: { x: point.x + 4, y: point.y }, sex: 'male' as const },
    ]);
    for (const placement of placements.slice(0, shrimpCount)) {
      placeShrimp(world, placement.point, placement.sex);
    }
  }
  return foodPoints;
};

const valueAtCell = (
  snapshot: ReturnType<SimulationWorld['snapshot']>,
  cell: SurfaceCellSnapshot,
  key: 'organicMatter' | 'toxicWaste' | 'oxygen',
): number => {
  const field = snapshot.biogeochemistry.water;
  const column = Math.max(0, Math.min(
    field.columns - 1,
    Math.floor((cell.x / 1200) * field.columns),
  ));
  const row = Math.max(0, Math.min(
    field.rows - 1,
    Math.floor(((cell.y - WATER_TOP) / (GROUND_Y - WATER_TOP)) * field.rows),
  ));
  return field[key][row * field.columns + column] ?? 0;
};

const inoculateBestSurfaces = (
  world: SimulationWorld,
  guildId: MicrobeGuildId,
  count: number,
): void => {
  const snapshot = world.snapshot();
  const foodKey = guildId === 'decomposer' ? 'organicMatter' : 'toxicWaste';
  const candidates = [...snapshot.cells].sort((left, right) => {
    const leftScore = valueAtCell(snapshot, left, foodKey) *
      valueAtCell(snapshot, left, 'oxygen');
    const rightScore = valueAtCell(snapshot, right, foodKey) *
      valueAtCell(snapshot, right, 'oxygen');
    return rightScore - leftScore;
  });
  const chosen: SurfaceCellSnapshot[] = [];
  for (const candidate of candidates) {
    if (chosen.some((cell) => Math.hypot(cell.x - candidate.x, cell.y - candidate.y) < 24)) continue;
    chosen.push(candidate);
    if (chosen.length >= count) break;
  }
  for (const cell of chosen) placeBiofilm(world, guildId, cell);
};

describe('mission 5 microbial cycle', () => {
  it('stocks the exact selected shrimp sex and enforces separate 2+2 limits', () => {
    const world = new SimulationWorld('mission-5');
    expect(world.snapshot().remainingAnimalSexes['cherry-shrimp']).toEqual({
      female: 2,
      male: 2,
    });

    placeShrimp(world, { x: 420, y: 520 }, 'female');
    placeShrimp(world, { x: 500, y: 520 }, 'female');
    expect(world.snapshot().animals.map((animal) => animal.sex)).toEqual([
      'female',
      'female',
    ]);
    expect(world.snapshot().remainingAnimalSexes['cherry-shrimp']).toEqual({
      female: 0,
      male: 2,
    });

    world.handle({
      type: 'pick-animal',
      speciesId: 'cherry-shrimp',
      sex: 'female',
      point: { x: 580, y: 520 },
    });
    expect(world.snapshot().holding).toBeNull();

    placeShrimp(world, { x: 660, y: 520 }, 'male');
    placeShrimp(world, { x: 740, y: 520 }, 'male');
    expect(world.snapshot().animalPopulation['cherry-shrimp']).toMatchObject({
      adultFemales: 2,
      adultMales: 2,
      total: 4,
    });
    expect(world.snapshot().remainingAnimals['cherry-shrimp']).toBe(0);
  });

  it('does not erase local ammonium merely by inoculating algae', () => {
    const world = new SimulationWorld('mission-5');
    const cell = [...world.snapshot().cells]
      .filter((candidate) => candidate.surfaceKind === 'substrate')
      .sort((left, right) => right.light - left.light)[0]!;
    const before = valueAtCell(world.snapshot(), cell, 'toxicWaste');

    placeSeed(world, 'oedogonium', cell);
    const afterInoculation = valueAtCell(world.snapshot(), cell, 'toxicWaste');

    expect(afterInoculation).toBeCloseTo(before, 6);

    world.handle({ type: 'start' });
    for (let step = 0; step < 10; step += 1) world.tick(0.1);
    const afterOneSecond = valueAtCell(world.snapshot(), cell, 'toxicWaste');
    expect(afterOneSecond).toBeGreaterThan(0);
    expect(afterOneSecond).toBeLessThanOrEqual(before);
  });

  it('keeps structures locked while allowing paused biological stocking', () => {
    const world = new SimulationWorld('mission-5');
    world.handle({ type: 'start' });
    world.handle({ type: 'pick-biofilm', guildId: 'decomposer', point: { x: 600, y: 630 } });
    expect(world.snapshot().holding).toBeNull();

    world.handle({ type: 'pause' });
    world.handle({ type: 'pick-structure', definitionId: 'flat-stone', point: { x: 600, y: 400 } });
    expect(world.snapshot().holding).toBeNull();
    world.handle({ type: 'pick-seed', speciesId: 'oedogonium', point: { x: 600, y: 630 } });
    expect(world.snapshot().holding).toMatchObject({
      kind: 'seed',
      speciesId: 'oedogonium',
    });
    world.handle({ type: 'cancel-held' });
    world.handle({
      type: 'pick-animal',
      speciesId: 'cherry-shrimp',
      point: { x: 600, y: 560 },
    });
    expect(world.snapshot().holding).toMatchObject({
      kind: 'animal',
      animalSpeciesId: 'cherry-shrimp',
    });
    world.handle({ type: 'cancel-held' });

    const point = world.snapshot().cells.find((cell) => cell.surfaceKind === 'substrate')!;
    world.handle({ type: 'pick-biofilm', guildId: 'decomposer', point });
    expect(world.snapshot().holding).toMatchObject({
      kind: 'biofilm',
      microbeGuildId: 'decomposer',
    });
    world.handle({ type: 'resume' });
    expect(world.snapshot().phase).toBe('paused');
    world.handle({ type: 'drop-held', point });
    expect(world.snapshot().holding).toBeNull();
    expect(world.snapshot().cells.reduce((sum, cell) => sum + cell.biofilm.decomposer, 0))
      .toBeGreaterThan(0);
    world.handle({ type: 'resume' });
    expect(world.snapshot().phase).toBe('running');
  });

  it('makes both films decline when they are inoculated into the initial clean water', () => {
    const world = new SimulationWorld('mission-5');
    const point = world.snapshot().cells.find((cell) => cell.surfaceKind === 'substrate')!;
    placeBiofilm(world, 'decomposer', point);
    placeBiofilm(world, 'nitrifier', point);
    const initial = world.snapshot().biogeochemistry.biofilmTotals;
    world.handle({ type: 'start' });
    const later = advanceTo(world, 120);

    expect(later.biogeochemistry.biofilmTotals.decomposer).toBeLessThan(initial.decomposer);
    expect(later.biogeochemistry.biofilmTotals.nitrifier).toBeLessThan(initial.nitrifier);
  });

  it('scores the third tank-born generation instead of a short survival timer', () => {
    const world = new SimulationWorld('mission-5');
    populateTank(world);
    world.handle({ type: 'start' });
    const snapshot = advanceTo(world, 10);

    expect(snapshot.missionProgress).toMatchObject({
      unit: 'generation-count',
      current: 0,
      target: 20,
      holdTarget: 0,
    });
    expect(snapshot.missionProgress?.holdCurrent).toBe(0);
  });

  it('limits each microbial inoculum to four placements', () => {
    const world = new SimulationWorld('mission-5');
    const cells = world.snapshot().cells;
    for (let index = 0; index < 4; index += 1) {
      placeBiofilm(world, 'decomposer', cells[index]!);
    }

    expect(world.snapshot().remainingMicrobes.decomposer).toBe(0);
    world.handle({ type: 'pick-biofilm', guildId: 'decomposer', point: cells[20]! });
    expect(world.snapshot().holding).toBeNull();
  });

  it('lets unfed mission 5 shrimp exhaust their own matter and die', () => {
    const world = new SimulationWorld('mission-5');
    for (const x of [290, 430, 770, 910]) {
      placeShrimp(world, { x, y: 600 });
    }
    world.handle({ type: 'start' });
    const final = advanceTo(world, 3_200);

    expect(final.biogeochemistry.biofilmTotals.decomposer).toBe(0);
    expect(final.biogeochemistry.biofilmTotals.nitrifier).toBe(0);
    expect(final.totalBiomass.oedogonium + final.totalBiomass.nitzschia).toBe(0);
    expect(final.animalPopulation['cherry-shrimp'].total).toBe(0);
    expect(final.animalPopulationEventTotals.deathsByCause.starvation)
      .toBeGreaterThan(0);
  }, 60_000);

  it('preserves the local water reading that caused a toxicity death', () => {
    const world = new SimulationWorld('mission-5');
    placeShrimp(world, { x: 600, y: 600 });
    const ledger = (world as unknown as { biogeochemistry: BiogeochemistryLedger })
      .biogeochemistry as unknown as { toxicWaste: Float32Array };
    ledger.toxicWaste.fill(24);
    world.handle({ type: 'start' });
    const snapshot = advanceTo(world, 45);
    const carcass = snapshot.carcasses.find((candidate) => candidate.cause === 'toxicity');

    expect(carcass).toBeDefined();
    expect(carcass?.waterAtDeath?.toxicWaste).toBeGreaterThanOrEqual(6);
    expect(carcass?.waterAtDeath?.oxygen).toBeGreaterThan(0);
  });

  it('keeps a timed two-film ecosystem safe, closed and dynamically responsive', () => {
    const treated = new SimulationWorld('mission-5');
    const foodPoints = populateTank(treated, 4, false);
    treated.handle({ type: 'start' });
    advanceTo(treated, 90);
    treated.handle({ type: 'pause' });
    inoculateBestSurfaces(treated, 'decomposer', 4);
    treated.handle({ type: 'resume' });
    advanceTo(treated, 190);
    treated.handle({ type: 'pause' });
    inoculateBestSurfaces(treated, 'nitrifier', 4);
    treated.handle({ type: 'resume' });
    advanceTo(treated, 600);
    treated.handle({ type: 'pause' });
    const releasePoints = [foodPoints[2]!, foodPoints[2]!, foodPoints[5]!, foodPoints[5]!];
    for (let index = 0; index < releasePoints.length; index += 1) {
      const point = releasePoints[index]!;
      placeShrimp(
        treated,
        { x: point.x + (index % 2 === 0 ? -4 : 4), y: point.y },
        index % 2 === 0 ? 'female' : 'male',
      );
    }
    treated.handle({ type: 'resume' });
    const samples = [700, 800, 900, 1_000, 1_100, 1_200, 1_300, 1_400, 1_500, 1_600]
      .map((time) => advanceTo(treated, time));
    const treatedFinal = advanceTo(treated, 2_200);
    const range = (values: number[]): number => Math.max(...values) - Math.min(...values);
    const organics = samples.map((sample) => sample.biogeochemistry.average.organicMatter);
    const toxic = samples.map((sample) => sample.biogeochemistry.average.toxicWaste);
    const decomposers = samples.map((sample) => sample.biogeochemistry.biofilmTotals.decomposer);
    const nitrifiers = samples.map((sample) => sample.biogeochemistry.biofilmTotals.nitrifier);
    const relativeRange = (values: number[]): number =>
      range(values) /
      Math.max(1e-9, values.reduce((sum, value) => sum + value, 0) / values.length);

    expect(treatedFinal.animalPopulation['cherry-shrimp'].total).toBeGreaterThan(0);
    expect(treatedFinal.biogeochemistry.biofilmTotals.decomposer).toBeGreaterThan(0);
    expect(treatedFinal.biogeochemistry.biofilmTotals.nitrifier).toBeGreaterThan(0);
    expect(Math.max(...toxic)).toBeLessThan(6);
    expect(Math.min(...samples.map((sample) => sample.biogeochemistry.average.oxygen)))
      .toBeGreaterThan(30);
    expect(Math.max(...organics)).toBeLessThan(15);
    expect(relativeRange(decomposers)).toBeGreaterThan(0.05);
    expect(relativeRange(nitrifiers)).toBeGreaterThan(0.05);
    // A short window can sit on one side of a bounded slow organic orbit.
    // Require active change here; the 32,000-second equilibrium test separately
    // verifies a complete rise-and-fall cycle and late boundedness.
    expect(range(organics)).toBeGreaterThan(0.02);
    // Shared turbulent dispersion can place this short window on one side of
    // the ammonium orbit too. Require active processing here; the long-run
    // equilibrium contract verifies the later reversal.
    expect(range(toxic)).toBeGreaterThan(0.01);
    expect(Math.abs(treatedFinal.biogeochemistry.materialBalance.nitrogenDriftRatio))
      .toBeLessThan(CLOSED_MATERIAL_RELATIVE_TOLERANCE);
    expect(Math.abs(treatedFinal.biogeochemistry.materialBalance.carbonDriftRatio))
      .toBeLessThan(CLOSED_MATERIAL_RELATIVE_TOLERANCE);
  }, 30_000);

  it('lets a distributed established film process the local waste of four adults', () => {
    const world = new SimulationWorld('mission-5');
    const foodPoints = populateTank(world, 4, false);
    world.handle({ type: 'start' });
    advanceTo(world, 60);
    world.handle({ type: 'pause' });
    inoculateBestSurfaces(world, 'decomposer', 4);
    world.handle({ type: 'resume' });
    advanceTo(world, 120);
    world.handle({ type: 'pause' });
    inoculateBestSurfaces(world, 'nitrifier', 4);
    world.handle({ type: 'resume' });
    advanceTo(world, 600);
    world.handle({ type: 'pause' });
    const releasePoints = [foodPoints[2]!, foodPoints[2]!, foodPoints[5]!, foodPoints[5]!];
    for (let index = 0; index < releasePoints.length; index += 1) {
      const point = releasePoints[index]!;
      placeShrimp(
        world,
        { x: point.x + (index % 2 === 0 ? -4 : 4), y: point.y },
        index % 2 === 0 ? 'female' : 'male',
      );
    }
    world.handle({ type: 'resume' });
    const established = advanceTo(world, 1_200);

    expect(established.animalPopulation['cherry-shrimp'].total).toBeGreaterThan(0);
    expect(established.biogeochemistry.biofilmTotals.decomposer).toBeGreaterThan(0);
    expect(established.biogeochemistry.biofilmTotals.nitrifier).toBeGreaterThan(0);
    expect(Math.max(...established.biogeochemistry.water.toxicWaste)).toBeLessThan(24);
  }, 30_000);

});
