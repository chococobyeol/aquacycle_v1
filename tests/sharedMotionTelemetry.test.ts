import { describe, expect, it } from 'vitest';
import {
  createSharedMotionChannel,
  SharedMotionReader,
  SharedMotionWriter,
} from '../src/simulation/sharedMotionTelemetry';
import type { WorkerMotionMessage } from '../src/simulation/types';

const motionMessage = (sequence: number, x: number): WorkerMotionMessage => ({
  type: 'motion',
  sequence,
  sampledAtMs: sequence * 33,
  structures: [{
    id: 'structure-7',
    definitionId: 'flat-stone',
    label: '돌',
    assetPath: '/stone.svg',
    x: x + 10,
    y: 500,
    angle: 0.25,
    width: 100,
    height: 40,
    isSleeping: false,
    locked: false,
    isHeld: false,
    placementValid: true,
  }],
  animals: [{
    id: 'animal-23',
    speciesId: 'cherry-shrimp',
    x,
    y: 420,
    vx: 2,
    vy: -1,
    facing: -1,
    poseAngle: 0.12,
    bodyLength: 36,
    lifeStage: 'adult',
    sex: 'female',
    ageSeconds: 80,
    lifespanSeconds: 1_200,
    energy: 72,
    health: 0.9,
    behavior: 'traveling',
    reproductiveState: 'ready',
    recentIntake: 0.4,
    consumedBiomass: 14,
  }],
  holding: null,
  probe: null,
});

describe('shared binary motion telemetry', () => {
  it('round-trips autonomous structure and animal motion without JSON', () => {
    const channel = createSharedMotionChannel();
    const writer = new SharedMotionWriter(channel);
    const reader = new SharedMotionReader(channel);

    expect(writer.publish(motionMessage(1, 120))).toBe(true);
    const first = reader.readLatest();
    expect(first?.sequence).toBe(1);
    expect(first?.structures[0]).toMatchObject({ id: 'structure-7', x: 130, y: 500 });
    expect(first?.animals[0]).toMatchObject({
      id: 'animal-23',
      x: 120,
      facing: -1,
      behavior: 'traveling',
      reproductiveState: 'ready',
    });
  });

  it('alternates two retained object graphs while coalescing old generations', () => {
    const channel = createSharedMotionChannel();
    const writer = new SharedMotionWriter(channel);
    const reader = new SharedMotionReader(channel);

    writer.publish(motionMessage(1, 100));
    const first = reader.readLatest()!;
    writer.publish(motionMessage(2, 200));
    const second = reader.readLatest()!;
    writer.publish(motionMessage(3, 300));
    const third = reader.readLatest()!;

    expect(first).not.toBe(second);
    expect(third).toBe(first);
    expect(third.animals[0].x).toBe(300);
    expect(second.animals[0].x).toBe(200);
    expect(reader.readLatest()).toBeNull();
  });
});
