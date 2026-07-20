import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SimulationWorld } from '../src/simulation/SimulationWorld';
import type { SpeciesId, SurfaceCellSnapshot, Vec2 } from '../src/simulation/types';

type WorldSnapshot = ReturnType<SimulationWorld['snapshot']>;

const LONG_RUN_SECONDS = 1_800;
const REAL_FRAME_SECONDS = 0.1;
const MAX_STABLE_ARRAY_ENTRY_DRIFT = 32;

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
  if (!cell) throw new Error('mission 4 long-run fixture needs another substrate cell');
  used.add(cell.id);
  return cell;
};

const populateMissionFour = (world: SimulationWorld): void => {
  const substrate = world
    .snapshot()
    .cells
    .filter((cell) => cell.surfaceKind === 'substrate');
  const used = new Set<string>();

  for (const targetX of [260, 470, 730, 940]) {
    placeSeed(world, 'nitzschia', nearestUnusedCell(substrate, targetX, 38, used));
    placeSeed(world, 'oedogonium', nearestUnusedCell(substrate, targetX + 24, 68, used));
  }
  for (const point of [
    { x: 290, y: 600 },
    { x: 430, y: 600 },
    { x: 770, y: 600 },
    { x: 910, y: 600 },
  ]) {
    placeShrimp(world, point);
  }
};

/**
 * Counts every entry in every array reachable from a worker snapshot. Unlike a
 * wall-clock budget, this stays deterministic on slow CI machines. It catches
 * the usual long-session regression: accidentally attaching an ever-growing
 * timeline, event log, or prior-snapshot list to each new snapshot.
 */
const recursiveArrayEntryCount = (value: unknown): number => {
  if (Array.isArray(value)) {
    return value.length + value.reduce(
      (total, entry) => total + recursiveArrayEntryCount(entry),
      0,
    );
  }
  if (value && typeof value === 'object') {
    return Object.values(value).reduce(
      (total, entry) => total + recursiveArrayEntryCount(entry),
      0,
    );
  }
  return 0;
};

/** Live animals and short-lived carcasses are legitimate dynamic state. Remove
 * only those two top-level collections before checking that the rest of the
 * snapshot stays bounded; a newly attached history or message backlog is still
 * included in this count. */
const stableSnapshotArrayEntryCount = (snapshot: WorldSnapshot): number => {
  const { animals: _animals, carcasses: _carcasses, ...stableSnapshot } = snapshot;
  return recursiveArrayEntryCount(stableSnapshot);
};

/** Guards direct persistent collections on the world while excluding the same
 * two ecological populations. This deliberately ignores Matter's nested
 * fixed-size caches, while still catching a newly introduced `history = []` or
 * snapshot backlog. */
const stableWorldArrayEntryCount = (world: SimulationWorld): number =>
  Object.entries(world as unknown as Record<string, unknown>).reduce<number>(
    (total, [key, value]) => total + (
      key !== 'animals' && key !== 'carcasses' && Array.isArray(value)
        ? value.length
        : 0
    ),
    0,
  );

const assertBoundedMissionFourSnapshot = (
  snapshot: WorldSnapshot,
  baselineArrayEntries: number,
): void => {
  expect(stableSnapshotArrayEntryCount(snapshot)).toBeLessThanOrEqual(
    baselineArrayEntries + MAX_STABLE_ARRAY_ENTRY_DRIFT,
  );
  expect(snapshot.cells.length).toBeGreaterThan(0);
  expect(snapshot.lightField.values).toHaveLength(
    snapshot.lightField.columns * snapshot.lightField.rows,
  );
  // Inoculation markers are intentionally hidden once simulation starts; they
  // must never reappear as an accumulating event history.
  expect(snapshot.seeds.length).toBeLessThanOrEqual(8);

  // Population size is an ecological result, not a performance-test cap.
  // Individual payloads must nevertheless remain flat, IDs must stay unique,
  // and expired carcasses must not turn into a hidden death history.
  expect(new Set(snapshot.animals.map((animal) => animal.id)).size).toBe(snapshot.animals.length);
  expect(new Set(snapshot.carcasses.map((carcass) => carcass.id)).size).toBe(snapshot.carcasses.length);
  for (const animal of snapshot.animals) expect(recursiveArrayEntryCount(animal)).toBe(0);
  for (const carcass of snapshot.carcasses) {
    expect(recursiveArrayEntryCount(carcass)).toBe(0);
    expect(carcass.ageSeconds).toBeLessThan(carcass.lifetimeSeconds);
  }
};

describe('mission 4 long-run performance contract', () => {
  it('runs 30 simulated minutes at 64x without accumulating snapshot state', () => {
    const world = new SimulationWorld('mission-4');
    populateMissionFour(world);
    world.handle({ type: 'start' });
    world.handle({ type: 'set-speed', speed: 64 });

    const baseline = world.snapshot();
    expect(baseline.speed).toBe(64);
    const baselineArrayEntries = stableSnapshotArrayEntryCount(baseline);
    const baselineWorldArrayEntries = stableWorldArrayEntryCount(world);
    let snapshot = baseline;
    let realFrames = 0;
    let publishedSnapshots = 0;

    while (snapshot.elapsedSeconds < LONG_RUN_SECONDS) {
      const shouldPublish = world.tick(REAL_FRAME_SECONDS);
      realFrames += 1;
      if (!shouldPublish) continue;

      snapshot = world.snapshot();
      publishedSnapshots += 1;
      assertBoundedMissionFourSnapshot(snapshot, baselineArrayEntries);
      expect(stableWorldArrayEntryCount(world)).toBeLessThanOrEqual(
        baselineWorldArrayEntries + MAX_STABLE_ARRAY_ENTRY_DRIFT,
      );
    }

    // This is a deterministic work-unit budget, not an elapsed-time assertion:
    // 64x must not silently fall back to the old 16x ceiling or stop advancing.
    const expectedFrames = Math.ceil(
      LONG_RUN_SECONDS / (64 * REAL_FRAME_SECONDS),
    );
    expect(realFrames).toBeGreaterThanOrEqual(expectedFrames);
    expect(realFrames).toBeLessThanOrEqual(expectedFrames + 2);
    expect(publishedSnapshots).toBeGreaterThan(100);
    expect(publishedSnapshots).toBeLessThanOrEqual(realFrames);
    expect(snapshot.elapsedSeconds).toBeGreaterThanOrEqual(LONG_RUN_SECONDS);
    assertBoundedMissionFourSnapshot(snapshot, baselineArrayEntries);
  }, 30_000);

  it('keeps the renderer ecology trace explicitly bounded', () => {
    const screenPath = fileURLToPath(
      new URL('../src/renderer/ui/SimulationScreen.tsx', import.meta.url),
    );
    const source = readFileSync(screenPath, 'utf8');
    const boundedUpdate = source.match(
      /setEcologyHistory\(\(current\)\s*=>\s*\[\.\.\.current,\s*point\]\.slice\(-([1-9]\d*)\)\)/,
    );

    expect(boundedUpdate).not.toBeNull();
    expect(Number(boundedUpdate?.[1])).toBeLessThanOrEqual(240);
  });
});
