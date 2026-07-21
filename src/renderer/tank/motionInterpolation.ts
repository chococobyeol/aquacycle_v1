import type {
  HoldingSnapshot,
  ProbeSnapshot,
  SimulationSnapshot,
  StructureSnapshot,
  AnimalSnapshot,
} from '../../simulation/types';
import type { SimulationMotionFrames } from '../hooks/useSimulation';

const MIN_SAMPLE_DURATION_MS = 16;
const MAX_SAMPLE_DURATION_MS = 67;

export interface InterpolatedMotionState {
  sequence: number;
  interpolated: boolean;
  structures: StructureSnapshot[];
  animals: AnimalSnapshot[];
  holding: HoldingSnapshot | null;
  probe: ProbeSnapshot | null;
}

export const reconcileStructureMotionWithSnapshot = (
  snapshotStructures: StructureSnapshot[],
  motionStructures: StructureSnapshot[],
  holding: HoldingSnapshot | null = null,
): StructureSnapshot[] => {
  const movingStructures = new Map(
    motionStructures.map((structure) => [structure.id, structure]),
  );
  return snapshotStructures.map((structure) => {
    const moving = movingStructures.get(structure.id);
    const isActivelyHeld = Boolean(
      moving?.isHeld &&
      holding?.kind === 'structure' &&
      holding.structureId === structure.id,
    );
    // A settled stone is normally sleeping just before the player picks it up.
    // Matter keeps that flag on the static held body, but held motion is still
    // authoritative. The lightweight holding update can also arrive one React
    // render before the full structure snapshot flips `isHeld`, so the holding
    // identity—not the older structure flag—decides that transition frame.
    if (
      !moving ||
      structure.locked ||
      (moving.isHeld && !isActivelyHeld) ||
      (!moving.isHeld && structure.isHeld) ||
      (structure.isSleeping && !isActivelyHeld)
    ) {
      return structure;
    }
    return {
      ...structure,
      x: moving.x,
      y: moving.y,
      angle: moving.angle,
      isHeld: moving.isHeld,
      placementValid: moving.placementValid,
    };
  });
};

const holdingIdentity = (holding: HoldingSnapshot | null): string | null => {
  if (!holding) return null;
  switch (holding.kind) {
    case 'structure': return `${holding.source}:${holding.kind}:${holding.structureId}`;
    case 'animal': return `${holding.source}:${holding.kind}:${holding.animalId}`;
    case 'seed': return `${holding.source}:${holding.kind}:${holding.speciesId}`;
    case 'biofilm': return `${holding.source}:${holding.kind}:${holding.microbeGuildId}`;
  }
};

/**
 * A full snapshot owns topology and settled/held state. Motion packets are
 * deliberately lighter and can become the final packet when the last moving
 * object stops. Reconcile by snapshot IDs so that a dead animal cannot remain
 * visible and a just-settled structure cannot be redrawn from a stale packet.
 */
export const reconcileMotionWithSnapshot = (
  snapshot: SimulationSnapshot,
  motion: InterpolatedMotionState | null,
): Pick<InterpolatedMotionState, 'structures' | 'animals' | 'holding' | 'probe'> => {
  if (!motion) {
    return {
      structures: snapshot.structures,
      animals: snapshot.animals,
      holding: snapshot.holding,
      probe: snapshot.probe,
    };
  }

  const motionAnimals = new Map(motion.animals.map((animal) => [animal.id, animal]));
  const structures = reconcileStructureMotionWithSnapshot(
    snapshot.structures,
    motion.structures,
    snapshot.holding,
  );
  const animals = snapshot.animals.map((animal) => motionAnimals.get(animal.id) ?? animal);
  const holding = holdingIdentity(snapshot.holding) === holdingIdentity(motion.holding)
    ? motion.holding
    : snapshot.holding;

  return {
    structures,
    animals,
    holding,
    probe: snapshot.probe && motion.probe ? motion.probe : snapshot.probe,
  };
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const lerp = (from: number, to: number, ratio: number): number =>
  from + (to - from) * ratio;

const lerpAngle = (from: number, to: number, ratio: number): number => {
  const turn = Math.PI * 2;
  const delta = ((to - from + Math.PI * 3) % turn) - Math.PI;
  return from + delta * ratio;
};

const matchingHolding = (
  previous: HoldingSnapshot | null,
  current: HoldingSnapshot | null,
): boolean => {
  if (!previous || !current || previous.kind !== current.kind || previous.source !== current.source) {
    return false;
  }
  switch (current.kind) {
    case 'structure': return previous.structureId === current.structureId;
    case 'animal': return previous.animalId === current.animalId;
    case 'seed': return previous.speciesId === current.speciesId;
    case 'biofilm': return previous.microbeGuildId === current.microbeGuildId;
  }
};

const interpolateAnimal = (
  previous: AnimalSnapshot,
  current: AnimalSnapshot,
  ratio: number,
): AnimalSnapshot => ({
  ...current,
  x: lerp(previous.x, current.x, ratio),
  y: lerp(previous.y, current.y, ratio),
  vx: lerp(previous.vx, current.vx, ratio),
  vy: lerp(previous.vy, current.vy, ratio),
  poseAngle: lerpAngle(previous.poseAngle, current.poseAngle, ratio),
  bodyLength: lerp(previous.bodyLength, current.bodyLength, ratio),
  ageSeconds: lerp(previous.ageSeconds, current.ageSeconds, ratio),
  energy: lerp(previous.energy, current.energy, ratio),
  health: lerp(previous.health, current.health, ratio),
  recentIntake: lerp(previous.recentIntake, current.recentIntake, ratio),
  consumedBiomass: lerp(previous.consumedBiomass, current.consumedBiomass, ratio),
});

const interpolateStructure = (
  previous: StructureSnapshot,
  current: StructureSnapshot,
  ratio: number,
): StructureSnapshot => ({
  ...current,
  x: lerp(previous.x, current.x, ratio),
  y: lerp(previous.y, current.y, ratio),
  angle: lerpAngle(previous.angle, current.angle, ratio),
});

/**
 * Renders one worker sample behind and fills that 30 Hz interval at display
 * refresh rate. A missing sample or sequence gap deliberately rebases to the
 * authoritative current frame instead of replaying stale fast-forward motion.
 */
export const interpolateMotionFrames = (
  frames: SimulationMotionFrames,
  nowMs: number,
): InterpolatedMotionState | null => {
  const current = frames.current;
  if (!current) return null;
  const previous = frames.previous;
  if (!previous || current.sequence !== previous.sequence + 1) {
    return {
      sequence: current.sequence,
      interpolated: false,
      structures: current.structures,
      animals: current.animals,
      holding: current.holding,
      probe: current.probe,
    };
  }

  const sampledDuration = current.sampledAtMs - previous.sampledAtMs;
  const receivedDuration = current.receivedAtMs - previous.receivedAtMs;
  const rawDuration = Number.isFinite(sampledDuration) && sampledDuration > 0
    ? sampledDuration
    : receivedDuration;
  const durationMs = Math.max(
    MIN_SAMPLE_DURATION_MS,
    Math.min(MAX_SAMPLE_DURATION_MS, rawDuration),
  );
  const ratio = clamp01((nowMs - current.receivedAtMs) / durationMs);
  const previousAnimals = new Map(previous.animals.map((animal) => [animal.id, animal]));
  const previousStructures = new Map(
    previous.structures.map((structure) => [structure.id, structure]),
  );

  const holding = matchingHolding(previous.holding, current.holding)
    ? {
      ...current.holding!,
      x: lerp(previous.holding!.x, current.holding!.x, ratio),
      y: lerp(previous.holding!.y, current.holding!.y, ratio),
    }
    : current.holding;
  const probe = previous.probe && current.probe
    ? {
      ...current.probe,
      x: lerp(previous.probe.x, current.probe.x, ratio),
      y: lerp(previous.probe.y, current.probe.y, ratio),
      light: lerp(previous.probe.light, current.probe.light, ratio),
      temperature: lerp(previous.probe.temperature, current.probe.temperature, ratio),
    }
    : current.probe;

  return {
    sequence: current.sequence,
    interpolated: true,
    structures: current.structures.map((structure) => {
      const before = previousStructures.get(structure.id);
      return before && before.isHeld === structure.isHeld
        ? interpolateStructure(before, structure, ratio)
        : structure;
    }),
    animals: current.animals.map((animal) => {
      const before = previousAnimals.get(animal.id);
      return before ? interpolateAnimal(before, animal, ratio) : animal;
    }),
    holding,
    probe,
  };
};
