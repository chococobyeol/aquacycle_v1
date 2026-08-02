import { describe, expect, it } from 'vitest';
import {
  RICEFISH_BITE_DURATION_SECONDS,
  RICEFISH_SWIM_RATE_MULTIPLIER,
  ricefishConsumedFood,
  ricefishMouthGape,
  ricefishSwimPose,
} from '../src/renderer/tank/ricefishAnimation';
import { SimulationWorld } from '../src/simulation/SimulationWorld';
import type { AnimalSpeciesId, Vec2 } from '../src/simulation/types';

interface MotionAnimal {
  speciesId: AnimalSpeciesId;
  position: Vec2;
  velocity: Vec2;
  facing: -1 | 1;
}

const placeRicefish = (world: SimulationWorld, point: Vec2): MotionAnimal => {
  world.handle({ type: 'pick-animal', speciesId: 'japanese-ricefish', point });
  world.handle({ type: 'drop-held', point });
  const animals = (world as unknown as { animals: MotionAnimal[] }).animals;
  return animals.find((animal) =>
    animal.speciesId === 'japanese-ricefish')!;
};

describe('ricefish motion', () => {
  it('sends a growing body wave toward the caudal fin', () => {
    const poses = Array.from({ length: 120 }, (_, index) =>
      ricefishSwimPose(index / 120 * Math.PI * 2, 0.08));
    const maximumBodySkew = Math.max(
      ...poses.map((pose) => Math.abs(pose.bodySkewY)),
    );
    const maximumTailSkew = Math.max(
      ...poses.map((pose) => Math.abs(pose.tailSkewY)),
    );

    expect(maximumBodySkew).toBeGreaterThan(0.012);
    expect(maximumTailSkew).toBeGreaterThan(0.2);
    expect(maximumTailSkew).toBeGreaterThan(maximumBodySkew * 4);
    const maximumPectoralRotation = Math.max(
      ...poses.map((pose) => Math.abs(pose.pectoralRotation)),
    );
    const maximumDorsalRotation = Math.max(
      ...poses.map((pose) => Math.abs(pose.dorsalRotation)),
    );
    const maximumAnalRotation = Math.max(
      ...poses.map((pose) => Math.abs(pose.analRotation)),
    );
    expect(maximumPectoralRotation).toBeGreaterThan(0.02);
    expect(maximumPectoralRotation).toBeLessThan(0.04);
    expect(maximumDorsalRotation).toBeGreaterThan(0.01);
    expect(maximumDorsalRotation).toBeLessThan(0.02);
    expect(maximumAnalRotation).toBeGreaterThan(0.015);
    expect(maximumAnalRotation).toBeLessThan(0.025);
  });

  it('uses a continuous, quick medaka tail beat without simulation-speed scaling', () => {
    const travelingHertz =
      7.4 * RICEFISH_SWIM_RATE_MULTIPLIER / (Math.PI * 2);
    const exploringHertz =
      5.2 * RICEFISH_SWIM_RATE_MULTIPLIER / (Math.PI * 2);

    expect(travelingHertz).toBeGreaterThan(3.9);
    expect(travelingHertz).toBeLessThan(4.1);
    expect(exploringHertz).toBeGreaterThan(2.7);
    expect(exploringHertz).toBeLessThan(2.9);
  });

  it('opens rapidly and closes within one short feeding strike', () => {
    expect(ricefishConsumedFood(0.4, 0.4)).toBe(false);
    expect(ricefishConsumedFood(0.4, 0.40001)).toBe(true);
    expect(RICEFISH_BITE_DURATION_SECONDS).toBeGreaterThanOrEqual(0.15);
    expect(RICEFISH_BITE_DURATION_SECONDS).toBeLessThanOrEqual(0.2);

    expect(ricefishMouthGape(1)).toBe(0);
    expect(ricefishMouthGape(0.75)).toBeCloseTo(1, 5);
    expect(ricefishMouthGape(0.35)).toBeGreaterThan(0.5);
    expect(ricefishMouthGape(0)).toBe(0);
  });

  it('keeps a resting fish moving gently instead of freezing or thrashing', () => {
    const cruising = ricefishSwimPose(Math.PI / 2, 0.08);
    const resting = ricefishSwimPose(Math.PI / 2, 0.018);

    expect(Math.abs(resting.tailSkewY)).toBeGreaterThan(0.02);
    expect(Math.abs(resting.tailSkewY)).toBeLessThan(
      Math.abs(cruising.tailSkewY) * 0.35,
    );
  });

  it('cruises through a long tank instead of turning in place', () => {
    const world = new SimulationWorld('mission-8');
    const fish = placeRicefish(world, { x: 1_200, y: 330 });
    world.handle({ type: 'start' });

    let pathLength = 0;
    let facingChanges = 0;
    let previous = { ...fish.position };
    let previousFacing = fish.facing;
    let minimumX = fish.position.x;
    let maximumX = fish.position.x;
    for (let step = 0; step < 60 * 20; step += 1) {
      world.tick(1 / 60);
      pathLength += Math.hypot(
        fish.position.x - previous.x,
        fish.position.y - previous.y,
      );
      if (fish.facing !== previousFacing) facingChanges += 1;
      previous = { ...fish.position };
      previousFacing = fish.facing;
      minimumX = Math.min(minimumX, fish.position.x);
      maximumX = Math.max(maximumX, fish.position.x);
    }

    expect(pathLength).toBeGreaterThan(500);
    expect(facingChanges).toBeLessThanOrEqual(4);
    expect(maximumX - minimumX).toBeGreaterThan(220);
  });
});
