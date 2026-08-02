import Matter from 'matter-js';
import { describe, expect, it, vi } from 'vitest';
import { SimulationWorld } from '../src/simulation/SimulationWorld';
import { FIXED_LAMP_X } from '../src/simulation/lightGeometry';
import { WATER_TOP, type StructureDefinitionId, type Vec2 } from '../src/simulation/types';

const REFLECTED_TEST_LIMIT = 6;

const settle = (world: SimulationWorld, ticks = 900): void => {
  for (let index = 0; index < ticks; index += 1) world.tick(1 / 60);
};

const placeStructure = (
  world: SimulationWorld,
  definitionId: StructureDefinitionId,
  point: Vec2,
): void => {
  world.handle({ type: 'pointer-move', point });
  world.handle({ type: 'pick-structure', definitionId });
  world.handle({ type: 'pointer-move', point });
  world.handle({ type: 'drop-held', point });
  settle(world);
};

const lightAt = (world: SimulationWorld, point: Vec2): number => {
  world.handle({ type: 'probe', point });
  return world.snapshot().probe!.light;
};

describe('aquarium light field', () => {
  it('keeps the upper water corners softly lit under the broad ceiling lamp', () => {
    const world = new SimulationWorld('laboratory');
    const left = lightAt(world, { x: 18, y: WATER_TOP + 24 });
    const center = lightAt(world, { x: FIXED_LAMP_X, y: WATER_TOP + 24 });
    const right = lightAt(world, { x: 1182, y: WATER_TOP + 24 });
    const elevatedLeft = lightAt(world, { x: 18, y: WATER_TOP + 150 });
    const elevatedRight = lightAt(world, { x: 1182, y: WATER_TOP + 150 });

    expect(left).toBeGreaterThan(3);
    expect(right).toBeGreaterThan(3);
    expect(elevatedLeft).toBeGreaterThan(5);
    expect(elevatedRight).toBeGreaterThan(5);
    expect(center).toBeGreaterThan(left);
    expect(left).toBeGreaterThan(right);
  });

  it('adds only a small local reflected-light contribution near an illuminated stone', () => {
    const empty = new SimulationWorld('laboratory');
    const withStone = new SimulationWorld('laboratory');
    placeStructure(withStone, 'tall-stone', { x: 408, y: 250 });
    const stone = withStone.snapshot().structures[0];
    const facingSamples = [
      { x: stone.x - 85, y: stone.y - 150 },
      { x: stone.x + 85, y: stone.y - 150 },
    ];
    const reflectedGains = facingSamples.map((point) =>
      lightAt(withStone, point) - lightAt(empty, point));

    expect(stone.isSleeping).toBe(true);
    for (const gain of reflectedGains) {
      expect(gain).toBeGreaterThan(1);
      expect(gain).toBeLessThanOrEqual(REFLECTED_TEST_LIMIT);
    }
  });

  it('rebuilds only quantized daylight paths as the sun crosses mission 6', () => {
    const world = new SimulationWorld('mission-6');
    placeStructure(world, 'tall-stone', { x: 408, y: 280 });
    const internals = world as unknown as {
      lightTransportCache: Map<string, unknown>;
      directDaylightCoefficientCache: Map<number, Map<string, number>>;
    };
    const staticTransportCache = internals.lightTransportCache;
    const cachedEntry = staticTransportCache.entries().next().value as
      | [string, unknown]
      | undefined;
    expect(cachedEntry).toBeTruthy();
    world.handle({ type: 'start' });
    world.handle({ type: 'set-speed', speed: 64 });
    const initialRevision = world.snapshot().lightField.revision;
    const ray = vi.spyOn(Matter.Query, 'ray');

    // Starting offset places the tank at daybreak. Forty 100 ms worker-sized
    // ticks at x64 cross the day -> dusk boundary and most of dusk.
    for (let index = 0; index < 40; index += 1) world.tick(0.1);

    const snapshot = world.snapshot();
    expect(snapshot.dayNight?.phase).toBe('dusk');
    expect(snapshot.lightField.revision).toBeGreaterThan(initialRevision);
    expect(snapshot.lightField.revision - initialRevision).toBeLessThan(36);
    expect(ray).toHaveBeenCalled();
    expect(internals.lightTransportCache).toBe(staticTransportCache);
    expect(staticTransportCache.get(cachedEntry![0])).toBe(cachedEntry![1]);

    // Finish one 360-second light cycle so every above-horizon 2-degree
    // direction has been visited, then cross the same directions again.
    // The repeated day may refresh one reflected-light sample per structure,
    // but must not recast the full water/surface shadow field.
    for (let index = 40; index < 58; index += 1) world.tick(0.1);
    const firstCycleRaycasts = ray.mock.calls.length;
    ray.mockClear();
    for (let index = 0; index < 58; index += 1) world.tick(0.1);
    const repeatedCycleRaycasts = ray.mock.calls.length;

    expect(internals.directDaylightCoefficientCache.size).toBeLessThanOrEqual(47);
    expect(repeatedCycleRaycasts).toBeLessThan(firstCycleRaycasts * 0.1);
    ray.mockRestore();
  }, 8_000);

  it('reuses an unchanged Vallisneria canopy throughout accelerated dawn and dusk', () => {
    const world = new SimulationWorld('mission-6');
    const substrate = world.snapshot().cells
      .filter((cell) => cell.surfaceKind === 'substrate');
    const plantCell = substrate.find((cell) => cell.x > 560) ?? substrate[0];
    world.handle({ type: 'pick-seed', speciesId: 'vallisneria', point: plantCell });
    world.handle({ type: 'drop-held', point: plantCell });

    const internals = world as unknown as {
      rebuildVallisneriaCanopyOptics(): void;
      computeCanopyTransmissionAt(point: Vec2, excludedPlantId?: string): number;
      stepVallisneriaLifecycle(deltaSeconds: number): void;
    };
    // Isolate a pure source-intensity transition. Structural growth has its own
    // quantized invalidation path and is allowed to rebuild the canopy.
    internals.stepVallisneriaLifecycle = () => undefined;
    const rebuild = vi.spyOn(internals, 'rebuildVallisneriaCanopyOptics');
    const transmission = vi.spyOn(internals, 'computeCanopyTransmissionAt');
    const initialRevision = world.snapshot().lightField.revision;

    world.handle({ type: 'start' });
    world.handle({ type: 'set-speed', speed: 64 });
    for (let index = 0; index < 90; index += 1) world.tick(0.1);

    const snapshot = world.snapshot();
    expect(snapshot.lightField.revision - initialRevision).toBeGreaterThan(25);
    expect(rebuild).not.toHaveBeenCalled();
    expect(transmission).not.toHaveBeenCalled();
    rebuild.mockRestore();
    transmission.mockRestore();
  }, 15_000);

  it('changes source intensity without rebuilding a settled laboratory light path', () => {
    const world = new SimulationWorld('laboratory');
    placeStructure(world, 'tall-stone', { x: 408, y: 280 });
    const baseline = world.snapshot().lightField.values;
    const ray = vi.spyOn(Matter.Query, 'ray');

    world.handle({ type: 'set-natural-light-output', output: 92 });
    const daylight = world.snapshot().lightField.values;
    world.handle({ type: 'set-natural-light-output', output: 0 });
    const restored = world.snapshot().lightField.values;

    expect(daylight.some((value, index) => value > baseline[index] + 1)).toBe(true);
    expect(restored).toEqual(baseline);
    expect(ray).not.toHaveBeenCalled();
    ray.mockRestore();
  });

  it('casts angled long-tank daylight as parallel rays instead of a widening fan', () => {
    const world = new SimulationWorld('mission-8');
    type LightInternals = {
      buildLightEmitters(): Array<{
        id: 'ceiling-lamp' | 'daylight';
        geometry: 'area-source' | 'parallel-rays';
      }>;
      emitterLightCoefficientAt(
        emitter: unknown,
        point: Vec2,
        occluders: Matter.Body[],
      ): number;
    };
    const internals = world as unknown as LightInternals;
    const daylight = internals.buildLightEmitters()
      .find((emitter) => emitter.id === 'daylight');
    expect(daylight?.geometry).toBe('parallel-rays');

    const ray = vi.spyOn(Matter.Query, 'ray');
    const leftPoint = { x: 180, y: WATER_TOP + 420 };
    const rightPoint = { x: 2_180, y: WATER_TOP + 420 };
    const leftCoefficient = internals.emitterLightCoefficientAt(
      daylight!,
      leftPoint,
      [],
    );
    const rightCoefficient = internals.emitterLightCoefficientAt(
      daylight!,
      rightPoint,
      [],
    );

    expect(leftCoefficient).toBeCloseTo(rightCoefficient, 10);
    expect(ray).toHaveBeenCalledTimes(2);
    const leftSource = ray.mock.calls[0][1];
    const leftDestination = ray.mock.calls[0][2];
    const rightSource = ray.mock.calls[1][1];
    const rightDestination = ray.mock.calls[1][2];
    expect(leftSource.x - leftDestination.x).toBeCloseTo(
      rightSource.x - rightDestination.x,
      10,
    );
    expect(Math.abs(leftSource.x - leftDestination.x)).toBeGreaterThan(10);
    ray.mockRestore();
  });
});
