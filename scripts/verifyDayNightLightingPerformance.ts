import { performance } from 'node:perf_hooks';
import { SimulationWorld } from '../src/simulation/SimulationWorld';
import type { Vec2 } from '../src/simulation/types';

const SAMPLES = 36;
const PLANT_COUNT = 18;

interface LightInternals {
  appliedDayNightMultiplier: number;
  lightDirty: boolean;
  canopyLightSignature: string;
  recomputeLight(): void;
}

const preparedWorld = (): { world: SimulationWorld; internals: LightInternals } => {
  const world = new SimulationWorld('laboratory');
  world.handle({ type: 'set-light-output', output: 0 });
  world.handle({ type: 'set-natural-light-output', output: 92 });
  world.handle({ type: 'set-day-night-enabled', enabled: true });
  const substrate = world.snapshot().cells
    .filter((cell) => cell.surfaceKind === 'substrate');
  const stride = Math.max(1, Math.floor(substrate.length / PLANT_COUNT));
  for (const cell of substrate.filter((_, index) => index % stride === 0).slice(0, PLANT_COUNT)) {
    const point: Vec2 = { x: cell.x, y: cell.y };
    world.handle({ type: 'pick-seed', speciesId: 'vallisneria', point });
    world.handle({ type: 'drop-held', point });
  }
  return {
    world,
    internals: world as unknown as LightInternals,
  };
};

const measure = (invalidateCanopy: boolean): number => {
  const { internals } = preparedWorld();
  const startedAt = performance.now();
  for (let index = 0; index < SAMPLES; index += 1) {
    internals.appliedDayNightMultiplier =
      0.045 + (index / (SAMPLES - 1)) * 0.955;
    internals.lightDirty = true;
    if (invalidateCanopy) {
      // Reproduce the former behavior: rebuild leaf optics and recompute every
      // point's Beer-Lambert transmission for every source-intensity step.
      internals.canopyLightSignature = `forced-rebuild:${index}`;
    }
    internals.recomputeLight();
  }
  return performance.now() - startedAt;
};

// Warm the runtime before comparing the two paths.
measure(false);
const cachedMs = measure(false);
const forcedRebuildMs = measure(true);
const speedup = forcedRebuildMs / Math.max(cachedMs, 0.001);

console.log(JSON.stringify({
  samples: SAMPLES,
  cachedMs: Number(cachedMs.toFixed(1)),
  forcedRebuildMs: Number(forcedRebuildMs.toFixed(1)),
  speedup: Number(speedup.toFixed(2)),
}));

if (speedup < 1.5) {
  throw new Error(
    `Expected cached day/night lighting to be at least 1.5x faster; measured ${speedup.toFixed(2)}x.`,
  );
}
