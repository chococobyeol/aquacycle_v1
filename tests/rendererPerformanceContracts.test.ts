import { describe, expect, it } from 'vitest';
import { SimulationWorld } from '../src/simulation/SimulationWorld';
import type { AnimalSnapshot, Vec2 } from '../src/simulation/types';

const SHRIMP_COUNTS = [4, 13, 64] as const;

const placeShrimp = (world: SimulationWorld, point: Vec2): void => {
  world.handle({
    type: 'pick-animal',
    speciesId: 'cherry-shrimp',
    point,
  });
  world.handle({ type: 'drop-held', point });
};

const populateShrimp = (world: SimulationWorld, count: number): void => {
  for (let index = 0; index < count; index += 1) {
    placeShrimp(world, {
      x: 150 + (index % 8) * 128,
      y: 130 + Math.floor(index / 8) * 64,
    });
  }
};

const expectCompleteMotionPose = (animal: AnimalSnapshot): void => {
  expect(animal.id).not.toBe('');
  expect(animal.speciesId).toBe('cherry-shrimp');
  for (const value of [
    animal.x,
    animal.y,
    animal.vx,
    animal.vy,
    animal.poseAngle,
    animal.bodyLength,
    animal.health,
  ]) {
    expect(Number.isFinite(value)).toBe(true);
  }
  expect(animal.facing === -1 || animal.facing === 1).toBe(true);
};

describe('renderer performance contracts', () => {
  it.each(SHRIMP_COUNTS)(
    'keeps an individual full motion pose for every one of %i shrimp',
    (count) => {
      const world = new SimulationWorld('laboratory');
      populateShrimp(world, count);
      world.handle({ type: 'start' });

      // Advance at the ordinary 1x rate. Rendering optimizations must not
      // aggregate or discard individual poses at these interactive counts;
      // the renderer can therefore keep using the same articulated rig.
      for (let frame = 0; frame < 12; frame += 1) world.tick(1 / 60);

      const motion = world.motionSnapshot();
      expect(motion.animals).toHaveLength(count);
      expect(new Set(motion.animals.map((animal) => animal.id)).size).toBe(count);
      for (const animal of motion.animals) expectCompleteMotionPose(animal);
    },
  );

  it('keeps long fast-forward motion snapshots ordered, flat, and complete after returning to 1x', () => {
    const world = new SimulationWorld('laboratory');
    populateShrimp(world, 13);
    // This is a transport/rendering contract, not a starvation test. Keep the
    // fixture population fixed so a legitimate ecological death cannot look
    // like a dropped motion packet.
    const internals = world as unknown as {
      stepAnimalEcology(deltaSeconds: number): void;
    };
    internals.stepAnimalEcology = () => undefined;
    world.handle({ type: 'start' });
    world.handle({ type: 'set-speed', speed: 64 });

    const expectedIds = world.motionSnapshot().animals.map((animal) => animal.id);
    let priorElapsed = world.snapshot().elapsedSeconds;
    for (let frame = 0; frame < 160; frame += 1) {
      world.tick(0.1);
      if (frame % 8 !== 0) continue;
      const snapshot = world.snapshot();
      expect(snapshot.elapsedSeconds).toBeGreaterThanOrEqual(priorElapsed);
      priorElapsed = snapshot.elapsedSeconds;
      const motion = world.motionSnapshot();
      expect(motion.animals.map((animal) => animal.id)).toEqual(expectedIds);
      for (const animal of motion.animals) expectCompleteMotionPose(animal);
    }

    world.handle({ type: 'set-speed', speed: 1 });
    for (let frame = 0; frame < 120; frame += 1) {
      world.tick(1 / 60);
      const motion = world.motionSnapshot();
      expect(motion.animals.map((animal) => animal.id)).toEqual(expectedIds);
      for (const animal of motion.animals) expectCompleteMotionPose(animal);
    }
  }, 15_000);

});
