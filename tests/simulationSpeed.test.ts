import { describe, expect, it } from 'vitest';
import { SimulationWorld } from '../src/simulation/SimulationWorld';
import {
  MAX_SIMULATION_SPEED,
  SIMULATION_SPEED_OPTIONS,
  normalizeSimulationSpeed,
} from '../src/simulation/speed';

describe('simulation speed', () => {
  it('offers powers of two through 64x', () => {
    expect(SIMULATION_SPEED_OPTIONS).toEqual([1, 2, 4, 8, 16, 32, 64]);
    expect(MAX_SIMULATION_SPEED).toBe(64);
  });

  it('advances ecology time at 64x', () => {
    const world = new SimulationWorld('laboratory');
    world.handle({ type: 'start' });
    world.handle({ type: 'set-speed', speed: 64 });

    for (let tick = 0; tick < 10; tick += 1) world.tick(0.1);

    expect(world.snapshot().speed).toBe(64);
    expect(world.snapshot().elapsedSeconds).toBe(64);
  });

  it('bounds fast-forward catch-up work without dropping simulated time', () => {
    const world = new SimulationWorld('laboratory');
    const internals = world as unknown as {
      stepGrowth(deltaSeconds: number): void;
      stepAnimalMotion(deltaSeconds: number): void;
    };
    const originalGrowth = internals.stepGrowth.bind(world);
    const originalAnimalMotion = internals.stepAnimalMotion.bind(world);
    const growthSteps: number[] = [];
    const animalMotionSteps: number[] = [];
    internals.stepGrowth = (deltaSeconds) => {
      growthSteps.push(deltaSeconds);
      originalGrowth(deltaSeconds);
    };
    internals.stepAnimalMotion = (deltaSeconds) => {
      animalMotionSteps.push(deltaSeconds);
      originalAnimalMotion(deltaSeconds);
    };

    world.handle({ type: 'start' });
    world.handle({ type: 'set-speed', speed: 64 });
    for (let frame = 0; frame < 10; frame += 1) {
      const growthBefore = growthSteps.length;
      const motionBefore = animalMotionSteps.length;
      world.tick(0.1);
      expect(growthSteps.length - growthBefore).toBeLessThanOrEqual(7);
      expect(animalMotionSteps.length - motionBefore).toBeLessThanOrEqual(65);
    }

    expect(world.snapshot().elapsedSeconds).toBe(64);
    expect(growthSteps).toHaveLength(64);
    expect(growthSteps.every((step) => step === 1)).toBe(true);
    expect(animalMotionSteps).toHaveLength(640);
    expect(animalMotionSteps.every((step) => step === 0.1)).toBe(true);
  });

  it('preserves the fine ecology and motion steps through 16x', () => {
    const world = new SimulationWorld('laboratory');
    const internals = world as unknown as {
      stepGrowth(deltaSeconds: number): void;
      stepAnimalMotion(deltaSeconds: number): void;
    };
    const growthSteps: number[] = [];
    const animalMotionSteps: number[] = [];
    const originalGrowth = internals.stepGrowth.bind(world);
    const originalAnimalMotion = internals.stepAnimalMotion.bind(world);
    internals.stepGrowth = (deltaSeconds) => {
      growthSteps.push(deltaSeconds);
      originalGrowth(deltaSeconds);
    };
    internals.stepAnimalMotion = (deltaSeconds) => {
      animalMotionSteps.push(deltaSeconds);
      originalAnimalMotion(deltaSeconds);
    };

    world.handle({ type: 'start' });
    world.handle({ type: 'set-speed', speed: 16 });
    for (let frame = 0; frame < 10; frame += 1) world.tick(0.1);

    expect(world.snapshot().elapsedSeconds).toBe(16);
    expect(growthSteps).toHaveLength(64);
    expect(growthSteps.every((step) => step === 0.25)).toBe(true);
    expect(animalMotionSteps).toHaveLength(480);
    expect(animalMotionSteps.every((step) => step === 1 / 30)).toBe(true);
  });

  it('interleaves motion and ecology chronologically during 64x fast-forward', () => {
    const world = new SimulationWorld('laboratory');
    const internals = world as unknown as {
      stepGrowth(deltaSeconds: number): void;
      stepAnimalMotion(deltaSeconds: number): void;
    };
    const events: Array<'motion' | 'growth'> = [];
    internals.stepAnimalMotion = () => events.push('motion');
    internals.stepGrowth = () => events.push('growth');

    world.handle({ type: 'start' });
    world.handle({ type: 'set-speed', speed: 64 });
    world.tick(0.1);

    expect(events.filter((event) => event === 'motion')).toHaveLength(64);
    expect(events.filter((event) => event === 'growth')).toHaveLength(6);
    let motionsSinceGrowth = 0;
    let growthEvents = 0;
    for (const event of events) {
      if (event === 'motion') {
        motionsSinceGrowth += 1;
        continue;
      }
      growthEvents += 1;
      expect(motionsSinceGrowth).toBe(10);
      motionsSinceGrowth = 0;
    }
    expect(growthEvents).toBe(6);
    expect(motionsSinceGrowth).toBe(4);
  });

  it('preserves every unprocessed simulation second after 64x to 1x', () => {
    const world = new SimulationWorld('laboratory');
    const internals = world as unknown as {
      stepGrowth(deltaSeconds: number): void;
      stepAnimalMotion(deltaSeconds: number): void;
    };
    const originalGrowth = internals.stepGrowth.bind(world);
    const originalAnimalMotion = internals.stepAnimalMotion.bind(world);
    const growthSteps: number[] = [];
    const animalMotionSteps: number[] = [];
    internals.stepGrowth = (deltaSeconds) => {
      growthSteps.push(deltaSeconds);
      originalGrowth(deltaSeconds);
    };
    internals.stepAnimalMotion = (deltaSeconds) => {
      animalMotionSteps.push(deltaSeconds);
      originalAnimalMotion(deltaSeconds);
    };

    world.handle({ type: 'start' });
    world.handle({ type: 'set-speed', speed: 64 });
    // Leaves 0.85 unprocessed ecology seconds after the first coarse step.
    world.tick(1.85 / 64);
    expect(world.snapshot().elapsedSeconds).toBe(1);

    growthSteps.length = 0;
    animalMotionSteps.length = 0;
    world.handle({ type: 'set-speed', speed: 1 });
    expect(world.snapshot().elapsedSeconds).toBe(1);

    // Adding the remaining 0.15 seconds must account for the complete two
    // simulated seconds supplied so far. Rescaling the remainder as a phase
    // would discard 0.6375 seconds and leave elapsed time at only 1.25.
    world.tick(0.1);
    world.tick(0.05);
    expect(growthSteps).toEqual([0.25, 0.25, 0.25, 0.25]);
    expect(animalMotionSteps.length).toBeGreaterThan(0);
    expect(world.snapshot().elapsedSeconds).toBe(2);
  });

  it('does not create simulation time when crossing from fine to fast-forward steps', () => {
    const world = new SimulationWorld('laboratory');

    world.handle({ type: 'start' });
    // Accumulate 0.2125 real simulation seconds without executing a growth step.
    world.tick(0.1);
    world.tick(0.1);
    world.tick(0.0125);
    expect(world.snapshot().elapsedSeconds).toBe(0);

    world.handle({ type: 'set-speed', speed: 64 });
    expect(world.snapshot().elapsedSeconds).toBe(0);
    // Only another 0.7875 seconds should complete the one-second coarse step.
    world.tick(0.7875 / 64);

    expect(world.snapshot().elapsedSeconds).toBe(1);

    // A phase-rescaled accumulator would retain 0.6375 fabricated seconds and
    // trigger a second ecology step here. Absolute seconds must not.
    world.tick(0.3625 / 64);
    expect(world.snapshot().elapsedSeconds).toBe(1);
  });

  it('normalizes unexpected worker-boundary values to a picker option', () => {
    expect(normalizeSimulationSpeed(Number.NaN)).toBe(1);
    expect(normalizeSimulationSpeed(-100)).toBe(1);
    expect(normalizeSimulationSpeed(15)).toBe(16);
    expect(normalizeSimulationSpeed(48)).toBe(32);
    expect(normalizeSimulationSpeed(999)).toBe(64);
  });
});
