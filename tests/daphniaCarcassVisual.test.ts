import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { userAgent: 'vitest' },
  });
});

import {
  animalCarcassVisualPoint,
  animalVisualHitRadii,
  daphniaVisualScale,
  shrimpVisualScale,
} from '../src/simulation/animalPresentation';
import { SimulationWorld } from '../src/simulation/SimulationWorld';
import { GROUND_Y } from '../src/simulation/types';

describe('Daphnia carcass visual continuity', () => {
  it('starts at the death position and sinks at a bounded linear speed', () => {
    const pointAt = (ageSeconds: number) => animalCarcassVisualPoint({
      speciesId: 'daphnia',
      x: 600,
      y: 100,
      ageSeconds,
    });
    expect(pointAt(0)).toEqual({ x: 600, y: 100 });
    expect(pointAt(0.6)).toEqual({ x: 600, y: 100 });
    expect(pointAt(6.4).y - 100).toBeLessThan(4);
    expect(pointAt(20).y - 100).toBeCloseTo(10.67, 2);
  });

  it('never moves past the tank bottom', () => {
    expect(animalCarcassVisualPoint({
      speciesId: 'daphnia',
      x: 600,
      y: 628,
      ageSeconds: 1_000,
    }).y).toBe(GROUND_Y - 8);
    expect(animalCarcassVisualPoint({
      speciesId: 'daphnia',
      x: 600,
      y: 640,
      ageSeconds: 1_000,
    }).y).toBe(640);
  });

  it('keeps Daphnia visibly smaller than an adult shrimp', () => {
    expect(daphniaVisualScale(9)).toBeCloseTo(0.36);
    expect(daphniaVisualScale(9)).toBeLessThan(0.4);
    expect(shrimpVisualScale(36)).toBeCloseTo(0.54545, 4);
    expect(shrimpVisualScale(14)).toBeGreaterThan(0.2);
  });

  it('keeps picking within the narrow visible silhouettes', () => {
    const daphniaRadii = animalVisualHitRadii('daphnia', 9);
    expect(daphniaRadii.x).toBeCloseTo(5.58);
    expect(daphniaRadii.y).toBeCloseTo(4.95);
    const shrimpRadii = animalVisualHitRadii('cherry-shrimp', 36);
    expect(shrimpRadii.x).toBeCloseTo(16.56);
    expect(shrimpRadii.y).toBeCloseTo(7.2);
  });

  it('does not select empty water above a visually small shrimp', () => {
    const world = new SimulationWorld('laboratory');
    const point = { x: 600, y: 300 };
    world.handle({ type: 'pick-animal', speciesId: 'cherry-shrimp', point });
    world.handle({ type: 'drop-held', point });
    const shrimp = world.snapshot().animals[0];

    world.handle({
      type: 'select-at',
      point: { x: shrimp.x, y: shrimp.y - 10 },
      filter: 'organism',
    });
    expect(world.snapshot().selection?.kind).not.toBe('animal');

    world.handle({ type: 'select-at', point: shrimp, filter: 'organism' });
    expect(world.snapshot().selection).toMatchObject({
      kind: 'animal',
      animalId: shrimp.id,
    });
  });

  it('selects an older carcass where its sunken body is actually drawn', () => {
    const world = new SimulationWorld('mission-7');
    const save = world.exportSaveData();
    save.carcasses.push({
      id: 'carcass:old-daphnia',
      sourceAnimalId: 'old-daphnia',
      speciesId: 'daphnia',
      position: { x: 600, y: 300 },
      facing: 1,
      poseAngle: 0,
      bodyLength: 9,
      lifeStage: 'adult',
      cause: 'old-age',
      waterAtDeath: null,
      temperatureAtDeath: 24,
      ageSeconds: 40,
    });
    world.loadSaveData(save);
    const savedCarcass = save.carcasses[0];
    const visualPoint = animalCarcassVisualPoint({
      speciesId: savedCarcass.speciesId,
      x: savedCarcass.position.x,
      y: savedCarcass.position.y,
      ageSeconds: savedCarcass.ageSeconds,
    });

    world.handle({
      type: 'select-at',
      point: visualPoint,
      filter: 'organism',
    });

    expect(world.snapshot().selection).toMatchObject({
      kind: 'carcass',
      carcassId: 'carcass:old-daphnia',
      x: visualPoint.x,
      y: visualPoint.y,
    });
  });
});
