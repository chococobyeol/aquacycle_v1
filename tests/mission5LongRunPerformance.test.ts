import { describe, expect, it } from 'vitest';
import { SimulationWorld } from '../src/simulation/SimulationWorld';
import type { MicrobeGuildId, SurfaceCellSnapshot } from '../src/simulation/types';

const LONG_RUN_SECONDS = 1_800;
const REAL_FRAME_SECONDS = 0.1;

const arrayEntryCount = (value: unknown): number => {
  if (Array.isArray(value)) {
    return value.length + value.reduce(
      (total, entry) => total + arrayEntryCount(entry),
      0,
    );
  }
  if (value && typeof value === 'object') {
    return Object.values(value).reduce(
      (total, entry) => total + arrayEntryCount(entry),
      0,
    );
  }
  return 0;
};

const placeBiofilm = (
  world: SimulationWorld,
  guildId: MicrobeGuildId,
  point: SurfaceCellSnapshot,
): void => {
  world.handle({ type: 'pick-biofilm', guildId, point });
  world.handle({ type: 'drop-held', point });
};

describe('mission 5 long-run performance contract', () => {
  it('keeps the four water fields and microbial state bounded for 30 minutes at 64x', () => {
    const world = new SimulationWorld('mission-5');
    const substrate = world.snapshot().cells.filter(
      (cell) => cell.surfaceKind === 'substrate',
    );
    placeBiofilm(world, 'decomposer', substrate[80]!);
    placeBiofilm(world, 'nitrifier', substrate[220]!);
    world.handle({ type: 'start' });
    world.handle({ type: 'set-speed', speed: 64 });

    const baseline = world.snapshot();
    const baselineEntries = arrayEntryCount(baseline);
    const expectedWaterCells = baseline.biogeochemistry.water.columns *
      baseline.biogeochemistry.water.rows;
    let snapshot = baseline;
    let frames = 0;

    while (snapshot.elapsedSeconds < LONG_RUN_SECONDS) {
      world.tick(REAL_FRAME_SECONDS);
      snapshot = world.snapshot();
      frames += 1;

      expect(arrayEntryCount(snapshot)).toBeLessThanOrEqual(baselineEntries + 32);
      for (const values of [
        snapshot.biogeochemistry.water.organicMatter,
        snapshot.biogeochemistry.water.toxicWaste,
        snapshot.biogeochemistry.water.nutrients,
        snapshot.biogeochemistry.water.oxygen,
      ]) {
        expect(values).toHaveLength(expectedWaterCells);
        expect(values.every(
          (value) => Number.isFinite(value) && value >= 0 && value <= 100,
        )).toBe(true);
      }
      for (const cell of snapshot.cells) {
        expect(Number.isFinite(cell.biofilm.decomposer)).toBe(true);
        expect(Number.isFinite(cell.biofilm.nitrifier)).toBe(true);
        expect(cell.biofilm.decomposer).toBeGreaterThanOrEqual(0);
        expect(cell.biofilm.nitrifier).toBeGreaterThanOrEqual(0);
        expect(cell.biofilm.decomposer + cell.biofilm.nitrifier)
          .toBeLessThanOrEqual(1.000001);
      }
    }

    const expectedFrames = Math.ceil(
      LONG_RUN_SECONDS / (64 * REAL_FRAME_SECONDS),
    );
    expect(frames).toBeGreaterThanOrEqual(expectedFrames);
    expect(frames).toBeLessThanOrEqual(expectedFrames + 2);
    expect(snapshot.elapsedSeconds).toBeGreaterThanOrEqual(LONG_RUN_SECONDS);
  }, 30_000);
});
