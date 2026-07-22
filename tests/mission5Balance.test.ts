import { describe, expect, it } from 'vitest';
import { SimulationWorld } from '../src/simulation/SimulationWorld';
import { BiogeochemistryLedger } from '../src/simulation/biogeochemistry';
import {
  GROUND_Y,
  WATER_TOP,
  type MicrobeGuildId,
  type SpeciesId,
  type SurfaceCellSnapshot,
  type Vec2,
} from '../src/simulation/types';

const placeSeed = (world: SimulationWorld, speciesId: SpeciesId, point: Vec2): void => {
  world.handle({ type: 'pick-seed', speciesId, point });
  world.handle({ type: 'drop-held', point });
};

const placeShrimp = (world: SimulationWorld, point: Vec2): void => {
  world.handle({ type: 'pick-animal', speciesId: 'cherry-shrimp', point });
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
  const cell = cells
    .filter((candidate) => !used.has(candidate.id))
    .sort((left, right) => {
      const leftScore = Math.abs(left.x - targetX) / 35 + Math.abs(left.light - targetLight);
      const rightScore = Math.abs(right.x - targetX) / 35 + Math.abs(right.light - targetLight);
      return leftScore - rightScore;
    })[0];
  if (!cell) throw new Error('mission 5 fixture needs another substrate cell');
  used.add(cell.id);
  return cell;
};

const populateTank = (world: SimulationWorld, shrimpCount = 4): void => {
  const substrate = world.snapshot().cells.filter((cell) => cell.surfaceKind === 'substrate');
  const used = new Set<string>();
  const targetXs = shrimpCount <= 4
    ? [260, 470, 730, 940]
    : Array.from({ length: shrimpCount }, (_, index) =>
      110 + (index / Math.max(1, shrimpCount - 1)) * 980);
  for (const targetX of targetXs) {
    placeSeed(world, 'nitzschia', nearestUnusedCell(substrate, targetX, 38, used));
    placeSeed(world, 'oedogonium', nearestUnusedCell(substrate, targetX + 24, 68, used));
  }
  const shrimpPoints = shrimpCount <= 4
    ? [290, 430, 770, 910]
    : targetXs;
  for (const x of shrimpPoints) placeShrimp(world, { x, y: 600 });
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

  it('keeps ordinary layout editing locked while allowing paused biofilm inoculation', () => {
    const world = new SimulationWorld('mission-5');
    world.handle({ type: 'start' });
    world.handle({ type: 'pick-biofilm', guildId: 'decomposer', point: { x: 600, y: 630 } });
    expect(world.snapshot().holding).toBeNull();

    world.handle({ type: 'pause' });
    world.handle({ type: 'pick-structure', definitionId: 'flat-stone', point: { x: 600, y: 400 } });
    expect(world.snapshot().holding).toBeNull();
    world.handle({ type: 'pick-seed', speciesId: 'oedogonium', point: { x: 600, y: 630 } });
    expect(world.snapshot().holding).toBeNull();

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

  it('scores only continuous shrimp-population survival, not a water-value range', () => {
    const world = new SimulationWorld('mission-5');
    populateTank(world);
    world.handle({ type: 'start' });
    const snapshot = advanceTo(world, 10);

    expect(snapshot.missionProgress).toMatchObject({
      unit: 'population-count',
      current: snapshot.animalPopulation['cherry-shrimp'].total,
      target: 1,
      holdTarget: 1_500,
    });
    expect(snapshot.missionProgress?.holdCurrent).toBeGreaterThan(0);
  });

  it('cannot sustain an untreated colony from its finite starting nutrients', () => {
    const world = new SimulationWorld('mission-5');
    populateTank(world);
    world.handle({ type: 'start' });
    const final = advanceTo(world, 1_800);

    expect(final.biogeochemistry.biofilmTotals.decomposer).toBe(0);
    expect(final.biogeochemistry.biofilmTotals.nitrifier).toBe(0);
    expect(final.animalPopulation['cherry-shrimp'].total).toBe(0);
    expect(final.missionProgress?.holdCurrent).toBeLessThan(1_500);
    expect(final.outcome).toBe('failure');
  }, 45_000);

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
    populateTank(treated);
    treated.handle({ type: 'start' });
    advanceTo(treated, 90);
    treated.handle({ type: 'pause' });
    inoculateBestSurfaces(treated, 'decomposer', 10);
    treated.handle({ type: 'resume' });
    advanceTo(treated, 190);
    treated.handle({ type: 'pause' });
    inoculateBestSurfaces(treated, 'nitrifier', 10);
    treated.handle({ type: 'resume' });
    const samples = [280, 370, 460, 550, 640, 730, 820, 910, 1_000, 1_090, 1_180]
      .map((time) => advanceTo(treated, time));
    const treatedFinal = advanceTo(treated, 1_600);
    const range = (values: number[]): number => Math.max(...values) - Math.min(...values);
    const hasRiseAndFall = (values: number[], epsilon: number): boolean => {
      const differences = values.slice(1).map((value, index) => value - values[index]);
      return differences.some((value) => value > epsilon) &&
        differences.some((value) => value < -epsilon);
    };
    const organics = samples.map((sample) => sample.biogeochemistry.average.organicMatter);
    const toxic = samples.map((sample) => sample.biogeochemistry.average.toxicWaste);
    const decomposers = samples.map((sample) => sample.biogeochemistry.biofilmTotals.decomposer);
    const nitrifiers = samples.map((sample) => sample.biogeochemistry.biofilmTotals.nitrifier);

    expect(treatedFinal.outcome).toBe('success');
    expect(treatedFinal.animalPopulation['cherry-shrimp'].total).toBeGreaterThan(0);
    expect(treatedFinal.biogeochemistry.biofilmTotals.decomposer).toBeGreaterThan(0);
    expect(treatedFinal.biogeochemistry.biofilmTotals.nitrifier).toBeGreaterThan(0);
    expect(Math.max(...toxic)).toBeLessThan(6);
    expect(Math.min(...samples.map((sample) => sample.biogeochemistry.average.oxygen)))
      .toBeGreaterThan(30);
    expect(Math.max(...organics)).toBeLessThan(15);
    expect(range(decomposers)).toBeGreaterThan(0.5);
    expect(range(nitrifiers)).toBeGreaterThan(0.1);
    expect(hasRiseAndFall(organics, 0.02)).toBe(true);
    // Shared turbulent dispersion smooths the former sharp local ammonium
    // swing, but the tank must still show both production and consumption.
    expect(hasRiseAndFall(toxic, 0.01)).toBe(true);
    expect(Math.abs(treatedFinal.biogeochemistry.materialBalance.nitrogenDriftRatio))
      .toBeLessThan(0.0001);
    expect(Math.abs(treatedFinal.biogeochemistry.materialBalance.carbonDriftRatio))
      .toBeLessThan(0.0001);
  }, 30_000);

  it('lets a distributed established film process the local waste of ten adults', () => {
    const world = new SimulationWorld('mission-5');
    populateTank(world, 10);
    world.handle({ type: 'start' });
    advanceTo(world, 60);
    world.handle({ type: 'pause' });
    inoculateBestSurfaces(world, 'decomposer', 14);
    world.handle({ type: 'resume' });
    advanceTo(world, 120);
    world.handle({ type: 'pause' });
    inoculateBestSurfaces(world, 'nitrifier', 16);
    world.handle({ type: 'resume' });
    const established = advanceTo(world, 600);

    expect(established.animalPopulation['cherry-shrimp'].total).toBeGreaterThan(0);
    expect(established.biogeochemistry.biofilmTotals.decomposer).toBeGreaterThan(0);
    expect(established.biogeochemistry.biofilmTotals.nitrifier).toBeGreaterThan(0);
    expect(Math.max(...established.biogeochemistry.water.toxicWaste)).toBeLessThan(24);
  }, 30_000);

});
