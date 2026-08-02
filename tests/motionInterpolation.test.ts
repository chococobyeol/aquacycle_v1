import { describe, expect, it } from 'vitest';
import type { SimulationMotionFrame } from '../src/renderer/hooks/useSimulation';
import {
  createReusableMotionInterpolator,
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
  secondsSinceFood: 3,
  temperature: 24,
  metabolicTemperatureFactor: 1,
  reproductionTemperatureFactor: 1,
  thermalHealthSuitability: 1,
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

const syntheticAnimals = (
  count: number,
  xOffset: number,
): AnimalSnapshot[] => Array.from({ length: count }, (_, index) => ({
  ...animal(`synthetic-${index}`, xOffset + index, 100 + (index % 37)),
  speciesId: index % 3 === 0
    ? 'daphnia'
    : index % 3 === 1
      ? 'cherry-shrimp'
      : 'japanese-ricefish',
}));

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

  it('uses timestamps to smooth a coalesced sequence gap when topology is unchanged', () => {
    const previous = frame(20, 5_000, 8_000, [animal('shrimp-1', 40, 50)]);
    const current = frame(22, 5_033, 8_034, [animal('shrimp-1', 440, 350)]);
    const sampled = interpolateMotionFrames({ previous, current }, 8_034);

    expect(sampled?.interpolated).toBe(true);
    expect(sampled?.animals[0].x).toBe(40);
    expect(sampled?.animals[0].y).toBe(50);
  });

  it('rebases across a sequence gap when animal topology changed', () => {
    const previous = frame(20, 5_000, 8_000, [animal('shrimp-1', 40, 50)]);
    const current = frame(22, 5_066, 8_067, [
      animal('shrimp-1', 80, 90),
      animal('new-shrimp', 100, 110),
    ]);
    const sampled = interpolateMotionFrames({ previous, current }, 8_067);

    expect(sampled?.interpolated).toBe(false);
    expect(sampled?.animals).toHaveLength(2);
    expect(sampled?.animals[0].x).toBe(80);
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

  it('lets a picked sleeping structure follow held motion', () => {
    const pickedSnapshot = {
      ...structure(260, 0.1),
      isSleeping: true,
      // A lightweight holding packet can reach React before the full structure
      // snapshot has switched this older flag to true.
      isHeld: false,
    };
    const pointerMotion = {
      ...structure(540, -0.35),
      isSleeping: true,
      isHeld: true,
    };
    const snapshot = {
      structures: [pickedSnapshot],
      animals: [],
      holding: {
        kind: 'structure',
        source: 'existing',
        valid: true,
        x: 260,
        y: 500,
        structureId: pickedSnapshot.id,
        structureDefinitionId: pickedSnapshot.definitionId,
      },
      probe: null,
    } as unknown as SimulationSnapshot;
    const motion = {
      sequence: 15,
      interpolated: false,
      structures: [pointerMotion],
      animals: [],
      holding: {
        ...snapshot.holding!,
        x: 540,
        y: 500,
      },
      probe: null,
    };

    const reconciled = reconcileMotionWithSnapshot(snapshot, motion);

    expect(reconciled.structures[0].x).toBe(540);
    expect(reconciled.structures[0].angle).toBe(-0.35);
    expect(reconciled.structures[0].isHeld).toBe(true);
  });

  it('keeps the dropped snapshot pose when a stale held motion frame remains', () => {
    const dropped = {
      ...structure(520, 0.35),
      isHeld: false,
      isSleeping: false,
    };
    const staleHeld = {
      ...structure(110, -0.2),
      isHeld: true,
    };
    const snapshot = {
      structures: [dropped],
      animals: [],
      holding: null,
      probe: null,
    } as unknown as SimulationSnapshot;
    const staleMotion = {
      sequence: 31,
      interpolated: false,
      structures: [staleHeld],
      animals: [],
      holding: null,
      probe: null,
    };

    const reconciled = reconcileMotionWithSnapshot(snapshot, staleMotion);

    expect(reconciled.structures[0].x).toBe(520);
    expect(reconciled.structures[0].angle).toBe(0.35);
    expect(reconciled.structures[0].isHeld).toBe(false);
  });

  it('does not interpolate across the held-to-dropped boundary', () => {
    const previous = frame(40, 1_000, 2_000, [], [{
      ...structure(110, -0.2),
      isHeld: true,
    }]);
    const current = frame(41, 1_033, 2_033, [], [{
      ...structure(520, 0.35),
      isHeld: false,
    }]);

    const sampled = interpolateMotionFrames({ previous, current }, 2_033);

    expect(sampled?.structures[0].x).toBe(520);
    expect(sampled?.structures[0].angle).toBe(0.35);
    expect(sampled?.structures[0].isHeld).toBe(false);
  });

  it('interpolates a 768-animal index-aligned topology in both samplers', () => {
    const previous = frame(70, 10_000, 20_000, syntheticAnimals(768, 0));
    const current = frame(71, 10_040, 20_040, syntheticAnimals(768, 400));
    const frames = { previous, current };

    const sampled = interpolateMotionFrames(frames, 20_060);
    const reusableSampled = createReusableMotionInterpolator().sample(frames, 20_060);

    for (const result of [sampled, reusableSampled]) {
      expect(result?.interpolated).toBe(true);
      expect(result?.animals).toHaveLength(768);
      expect(result?.animals[0].x).toBeCloseTo(200, 6);
      expect(result?.animals[383].x).toBeCloseTo(583, 6);
      expect(result?.animals[767].x).toBeCloseTo(967, 6);
    }
  });

  it('rebases a 600-animal frame when entity order changes', () => {
    const before = syntheticAnimals(600, 0);
    const reordered = syntheticAnimals(600, 300);
    [reordered[298], reordered[299]] = [reordered[299], reordered[298]];
    const previous = frame(80, 30_000, 40_000, before);
    const current = frame(81, 30_040, 40_040, reordered);
    const frames = { previous, current };

    const sampled = interpolateMotionFrames(frames, 40_060);
    const reusableSampled = createReusableMotionInterpolator().sample(frames, 40_060);

    expect(sampled?.interpolated).toBe(false);
    expect(sampled?.animals).toBe(reordered);
    expect(reusableSampled?.interpolated).toBe(false);
    expect(reusableSampled?.animals).toBe(reordered);
  });

  it('rebases a 600-animal frame when an ID or species changes at an index', () => {
    const previous = frame(90, 50_000, 60_000, syntheticAnimals(600, 0));
    const changedId = syntheticAnimals(600, 300);
    changedId[412] = { ...changedId[412], id: 'replacement-412' };
    const changedSpecies = syntheticAnimals(600, 300);
    changedSpecies[412] = { ...changedSpecies[412], speciesId: 'daphnia' };

    for (const currentAnimals of [changedId, changedSpecies]) {
      const current = frame(91, 50_040, 60_040, currentAnimals);
      const sampled = interpolateMotionFrames({ previous, current }, 60_060);

      expect(sampled?.interpolated).toBe(false);
      expect(sampled?.animals).toBe(currentAnimals);
    }
  });
});
