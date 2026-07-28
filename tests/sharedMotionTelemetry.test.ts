import { describe, expect, it, vi } from 'vitest';
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
  snapshotRevision: sequence + 100,
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
    secondsSinceFood: 3.5,
    temperature: 24,
    metabolicTemperatureFactor: 1,
    reproductionTemperatureFactor: 1,
    thermalHealthSuitability: 1,
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
    expect(first?.snapshotRevision).toBe(101);
    expect(first?.structures[0]).toMatchObject({ id: 'structure-7', x: 130, y: 500 });
    expect(first?.animals[0]).toMatchObject({
      id: 'animal-23',
      x: 120,
      facing: -1,
      behavior: 'traveling',
      reproductiveState: 'ready',
      secondsSinceFood: 3.5,
    });
  });

  it('keeps a third staging graph behind the two retained interpolation frames', () => {
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
    expect(third).not.toBe(first);
    expect(third).not.toBe(second);
    expect(first.animals[0].x).toBe(100);
    expect(third.animals[0].x).toBe(300);
    expect(second.animals[0].x).toBe(200);

    writer.publish(motionMessage(4, 400));
    const fourth = reader.readLatest()!;
    expect(fourth).toBe(first);
    expect(fourth.animals[0].x).toBe(400);
    expect(second.animals[0].x).toBe(200);
    expect(third.animals[0].x).toBe(300);
    expect(reader.readLatest()).toBeNull();
  });

  it('does not corrupt either retained frame when publication races a read', () => {
    const channel = createSharedMotionChannel();
    const writer = new SharedMotionWriter(channel);
    const reader = new SharedMotionReader(channel);

    writer.publish(motionMessage(1, 100));
    const first = reader.readLatest()!;
    writer.publish(motionMessage(2, 200));
    const second = reader.readLatest()!;
    writer.publish(motionMessage(3, 300));

    const originalLoad = Atomics.load.bind(Atomics);
    let generationLoads = 0;
    const loadSpy = vi.spyOn(Atomics, 'load').mockImplementation(
      ((array: Int32Array, index: number): number => {
        if (index === 0) {
          generationLoads += 1;
          if (generationLoads === 2) {
            writer.publish(motionMessage(4, 400));
          }
        }
        return originalLoad(array, index);
      }) as typeof Atomics.load,
    );

    expect(reader.readLatest()).toBeNull();
    loadSpy.mockRestore();
    expect(first.animals[0].x).toBe(100);
    expect(second.animals[0].x).toBe(200);

    const latest = reader.readLatest()!;
    expect(latest.sequence).toBe(4);
    expect(latest.animals[0].x).toBe(400);
  });

  it('preserves ricefish species, life stage, behavior, and reproductive state', () => {
    const channel = createSharedMotionChannel();
    const writer = new SharedMotionWriter(channel);
    const reader = new SharedMotionReader(channel);
    const message = motionMessage(4, 240);
    message.animals[0] = {
      ...message.animals[0],
      speciesId: 'japanese-ricefish',
      lifeStage: 'fry',
      behavior: 'hunting',
      reproductiveState: 'carrying-eggs',
    };

    expect(writer.publish(message)).toBe(true);
    expect(reader.readLatest()?.animals[0]).toMatchObject({
      speciesId: 'japanese-ricefish',
      lifeStage: 'fry',
      behavior: 'hunting',
      reproductiveState: 'carrying-eggs',
    });

    message.sequence = 5;
    message.animals[0] = {
      ...message.animals[0],
      lifeStage: 'egg',
      behavior: 'incubating',
      reproductiveState: 'incubating',
    };
    expect(writer.publish(message)).toBe(true);
    expect(reader.readLatest()?.animals[0]).toMatchObject({
      speciesId: 'japanese-ricefish',
      lifeStage: 'egg',
      behavior: 'incubating',
      reproductiveState: 'incubating',
    });
  });

  it('preserves Daphnia species instead of falling back to cherry shrimp', () => {
    const channel = createSharedMotionChannel();
    const writer = new SharedMotionWriter(channel);
    const reader = new SharedMotionReader(channel);
    const message = motionMessage(6, 320);
    message.animals[0] = {
      ...message.animals[0],
      speciesId: 'daphnia',
      bodyLength: 9,
      behavior: 'grazing',
    };

    expect(writer.publish(message)).toBe(true);
    expect(reader.readLatest()?.animals[0]).toMatchObject({
      speciesId: 'daphnia',
      bodyLength: 9,
      behavior: 'grazing',
    });
  });
});
