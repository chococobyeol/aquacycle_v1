import { describe, expect, it } from 'vitest';
import type { SimulationMotionFrame } from '../src/renderer/hooks/useSimulation';
import {
  interpolateMotionFrames,
  reconcileMotionWithSnapshot,
} from '../src/renderer/tank/motionInterpolation';
import type {
  AnimalSnapshot,
  SimulationSnapshot,
  StructureSnapshot,
} from '../src/simulation/types';

const animal = (id: string, x: number, y: number): AnimalSnapshot => ({
  id,
  speciesId: 'cherry-shrimp',
  x,
  y,
  vx: 3,
  vy: -1,
  facing: 1,
  poseAngle: 0.1,
  bodyLength: 36,
  lifeStage: 'adult',
  sex: 'female',
  ageSeconds: 300,
  lifespanSeconds: 1_100,
  energy: 0.7,
  health: 1,
  behavior: 'traveling',
  reproductiveState: 'none',
  recentIntake: 0.1,
  consumedBiomass: 4,
});

const structure = (x: number, angle: number): StructureSnapshot => ({
  id: 'stone-1',
  definitionId: 'flat-stone',
  label: '넓적한 사암',
  assetPath: '/stone.svg',
  x,
  y: 500,
  angle,
  width: 180,
  height: 74,
  isSleeping: false,
  locked: false,
  isHeld: false,
  placementValid: true,
});

const frame = (
  sequence: number,
  sampledAtMs: number,
  receivedAtMs: number,
  animals: AnimalSnapshot[],
  structures: StructureSnapshot[] = [],
): SimulationMotionFrame => ({
  sequence,
  sampledAtMs,
  receivedAtMs,
  animals,
  structures,
  holding: null,
  probe: null,
});

describe('Pixi motion interpolation', () => {
  it('fills one 30 Hz worker interval linearly without changing the rig state', () => {
    const beforeAnimal = animal('shrimp-1', 100, 200);
    const afterAnimal = {
      ...animal('shrimp-1', 130, 218),
      poseAngle: 0.3,
      bodyLength: 38,
      health: 0.8,
      behavior: 'grazing' as const,
    };
    const previous = frame(8, 1_000, 2_000, [beforeAnimal], [structure(200, 0)]);
    const current = frame(9, 1_033.333, 2_034, [afterAnimal], [structure(230, 0.2)]);

    const atStart = interpolateMotionFrames({ previous, current }, 2_034);
    expect(atStart?.interpolated).toBe(true);
    expect(atStart?.animals[0].x).toBeCloseTo(100, 4);

    const halfway = interpolateMotionFrames({ previous, current }, 2_050.6665);
    expect(halfway?.animals[0].x).toBeCloseTo(115, 1);
    expect(halfway?.animals[0].y).toBeCloseTo(209, 1);
    expect(halfway?.animals[0].bodyLength).toBeCloseTo(37, 1);
    expect(halfway?.animals[0].behavior).toBe('grazing');
    expect(halfway?.structures[0].x).toBeCloseTo(215, 1);

    const complete = interpolateMotionFrames({ previous, current }, 2_100);
    expect(complete?.animals[0].x).toBe(130);
    expect(complete?.structures[0].x).toBe(230);
  });

  it('rebases instead of replaying stale motion after a sequence gap', () => {
    const previous = frame(20, 5_000, 8_000, [animal('shrimp-1', 40, 50)]);
    const current = frame(22, 5_033, 8_034, [animal('shrimp-1', 440, 350)]);
    const sampled = interpolateMotionFrames({ previous, current }, 8_034);

    expect(sampled?.interpolated).toBe(false);
    expect(sampled?.animals[0].x).toBe(440);
    expect(sampled?.animals[0].y).toBe(350);
  });

  it('starts a newly born animal at its authoritative current pose', () => {
    const previous = frame(3, 100, 200, [animal('parent', 10, 20)]);
    const current = frame(4, 133, 233, [
      animal('parent', 20, 30),
      animal('juvenile', 24, 34),
    ]);
    const sampled = interpolateMotionFrames({ previous, current }, 249.5);

    expect(sampled?.animals).toHaveLength(2);
    expect(sampled?.animals[1].id).toBe('juvenile');
    expect(sampled?.animals[1].x).toBe(24);
    expect(sampled?.animals[1].bodyLength).toBe(36);
  });

  it('uses full-snapshot topology when the final motion packet becomes stale', () => {
    const settled = {
      ...structure(260, 0.4),
      isSleeping: true,
    };
    const snapshot = {
      structures: [settled],
      animals: [],
      holding: null,
      probe: null,
    } as unknown as SimulationSnapshot;
    const staleMotion = {
      sequence: 12,
      interpolated: true,
      structures: [structure(210, 0.1)],
      animals: [animal('dead-shrimp', 420, 500)],
      holding: null,
      probe: null,
    };

    const reconciled = reconcileMotionWithSnapshot(snapshot, staleMotion);

    expect(reconciled.animals).toEqual([]);
    expect(reconciled.structures[0].x).toBe(260);
    expect(reconciled.structures[0].angle).toBe(0.4);
    expect(reconciled.structures[0].isSleeping).toBe(true);
  });
});
