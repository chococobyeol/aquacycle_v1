import type {
  AnimalBehavior,
  AnimalLifeStage,
  AnimalReproductiveState,
  AnimalSex,
  AnimalSnapshot,
  StructureSnapshot,
  WorkerMotionMessage,
} from './types';

const CONTROL_GENERATION = 0;
const CONTROL_STRUCTURE_COUNT = 1;
const CONTROL_ANIMAL_COUNT = 2;
const CONTROL_MESSAGE_SEQUENCE = 3;
const CONTROL_WORDS = 4;

const HEADER_SAMPLED_AT_MS = 0;
const HEADER_WORDS = 1;
const STRUCTURE_WORDS = 7;
const ANIMAL_WORDS = 18;

export const SHARED_MOTION_MAX_STRUCTURES = 4_096;
export const SHARED_MOTION_MAX_ANIMALS = 2_048;

const LIFE_STAGES: readonly AnimalLifeStage[] = ['juvenile', 'adult'];
const SEXES: readonly AnimalSex[] = ['female', 'male'];
const BEHAVIORS: readonly AnimalBehavior[] = [
  'held',
  'exploring',
  'traveling',
  'grazing',
  'resting',
  'starving',
];
const REPRODUCTIVE_STATES: readonly AnimalReproductiveState[] = ['none', 'ready', 'berried'];

const numericId = (id: string): number => {
  const separator = id.lastIndexOf('-');
  const value = Number.parseInt(separator >= 0 ? id.slice(separator + 1) : id, 10);
  return Number.isFinite(value) ? value : 0;
};

const enumIndex = <T extends string>(values: readonly T[], value: T): number => {
  const index = values.indexOf(value);
  return index >= 0 ? index : 0;
};

export interface SharedMotionChannel {
  control: SharedArrayBuffer;
  payload: SharedArrayBuffer;
}

export const createSharedMotionChannel = (): SharedMotionChannel => ({
  control: new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * CONTROL_WORDS),
  payload: new SharedArrayBuffer(Float64Array.BYTES_PER_ELEMENT * (
    HEADER_WORDS +
    SHARED_MOTION_MAX_STRUCTURES * STRUCTURE_WORDS +
    SHARED_MOTION_MAX_ANIMALS * ANIMAL_WORDS
  )),
});

export class SharedMotionWriter {
  private readonly control: Int32Array;
  private readonly payload: Float64Array;

  public constructor(channel: SharedMotionChannel) {
    this.control = new Int32Array(channel.control);
    this.payload = new Float64Array(channel.payload);
  }

  public publish(message: WorkerMotionMessage): boolean {
    if (
      message.structures.length > SHARED_MOTION_MAX_STRUCTURES ||
      message.animals.length > SHARED_MOTION_MAX_ANIMALS
    ) return false;

    Atomics.add(this.control, CONTROL_GENERATION, 1);
    this.payload[HEADER_SAMPLED_AT_MS] = message.sampledAtMs;

    let offset = HEADER_WORDS;
    for (const structure of message.structures) {
      this.payload[offset] = numericId(structure.id);
      this.payload[offset + 1] = structure.x;
      this.payload[offset + 2] = structure.y;
      this.payload[offset + 3] = structure.angle;
      this.payload[offset + 4] = structure.isSleeping ? 1 : 0;
      this.payload[offset + 5] = structure.isHeld ? 1 : 0;
      this.payload[offset + 6] = structure.placementValid ? 1 : 0;
      offset += STRUCTURE_WORDS;
    }

    offset = HEADER_WORDS + SHARED_MOTION_MAX_STRUCTURES * STRUCTURE_WORDS;
    for (const animal of message.animals) {
      this.payload[offset] = numericId(animal.id);
      this.payload[offset + 1] = animal.x;
      this.payload[offset + 2] = animal.y;
      this.payload[offset + 3] = animal.vx;
      this.payload[offset + 4] = animal.vy;
      this.payload[offset + 5] = animal.facing;
      this.payload[offset + 6] = animal.poseAngle;
      this.payload[offset + 7] = animal.bodyLength;
      this.payload[offset + 8] = enumIndex(LIFE_STAGES, animal.lifeStage);
      this.payload[offset + 9] = enumIndex(SEXES, animal.sex);
      this.payload[offset + 10] = animal.ageSeconds;
      this.payload[offset + 11] = animal.lifespanSeconds;
      this.payload[offset + 12] = animal.energy;
      this.payload[offset + 13] = animal.health;
      this.payload[offset + 14] = enumIndex(BEHAVIORS, animal.behavior);
      this.payload[offset + 15] = enumIndex(REPRODUCTIVE_STATES, animal.reproductiveState);
      this.payload[offset + 16] = animal.recentIntake;
      this.payload[offset + 17] = animal.consumedBiomass;
      offset += ANIMAL_WORDS;
    }

    Atomics.store(this.control, CONTROL_STRUCTURE_COUNT, message.structures.length);
    Atomics.store(this.control, CONTROL_ANIMAL_COUNT, message.animals.length);
    Atomics.store(this.control, CONTROL_MESSAGE_SEQUENCE, message.sequence);
    Atomics.add(this.control, CONTROL_GENERATION, 1);
    return true;
  }
}

const emptyStructure = (): StructureSnapshot => ({
  id: '',
  definitionId: 'flat-stone',
  label: '',
  assetPath: '',
  x: 0,
  y: 0,
  angle: 0,
  width: 0,
  height: 0,
  isSleeping: false,
  locked: false,
  isHeld: false,
  placementValid: true,
});

const emptyAnimal = (): AnimalSnapshot => ({
  id: '',
  speciesId: 'cherry-shrimp',
  x: 0,
  y: 0,
  vx: 0,
  vy: 0,
  facing: 1,
  poseAngle: 0,
  bodyLength: 0,
  lifeStage: 'adult',
  sex: 'female',
  ageSeconds: 0,
  lifespanSeconds: 0,
  energy: 0,
  health: 0,
  behavior: 'resting',
  reproductiveState: 'none',
  recentIntake: 0,
  consumedBiomass: 0,
  temperature: 24,
  metabolicTemperatureFactor: 1,
  reproductionTemperatureFactor: 1,
  thermalHealthSuitability: 1,
});

const emptyMessage = (): WorkerMotionMessage => ({
  type: 'motion',
  sequence: 0,
  sampledAtMs: 0,
  structures: [],
  animals: [],
  holding: null,
  probe: null,
});

/**
 * Reads into two alternating object graphs. The motion store retains exactly
 * the previous and current graph, so neither high-frequency JSON parsing nor
 * per-frame arrays are needed while animals move.
 */
export class SharedMotionReader {
  private readonly control: Int32Array;
  private readonly payload: Float64Array;
  private readonly messages = [emptyMessage(), emptyMessage()] as const;
  private readonly structureNumericIds = [
    new Int32Array(SHARED_MOTION_MAX_STRUCTURES),
    new Int32Array(SHARED_MOTION_MAX_STRUCTURES),
  ] as const;
  private readonly animalNumericIds = [
    new Int32Array(SHARED_MOTION_MAX_ANIMALS),
    new Int32Array(SHARED_MOTION_MAX_ANIMALS),
  ] as const;
  private nextMessageIndex = 0;
  private lastGeneration = 0;

  public constructor(channel: SharedMotionChannel) {
    this.control = new Int32Array(channel.control);
    this.payload = new Float64Array(channel.payload);
  }

  public readLatest(): WorkerMotionMessage | null {
    const generationBefore = Atomics.load(this.control, CONTROL_GENERATION);
    if (generationBefore === this.lastGeneration || generationBefore % 2 !== 0) return null;
    const structureCount = Atomics.load(this.control, CONTROL_STRUCTURE_COUNT);
    const animalCount = Atomics.load(this.control, CONTROL_ANIMAL_COUNT);
    if (
      structureCount < 0 || structureCount > SHARED_MOTION_MAX_STRUCTURES ||
      animalCount < 0 || animalCount > SHARED_MOTION_MAX_ANIMALS
    ) return null;

    const target = this.messages[this.nextMessageIndex];
    const structureIds = this.structureNumericIds[this.nextMessageIndex];
    const animalIds = this.animalNumericIds[this.nextMessageIndex];
    target.sequence = Atomics.load(this.control, CONTROL_MESSAGE_SEQUENCE);
    target.sampledAtMs = this.payload[HEADER_SAMPLED_AT_MS];
    target.holding = null;
    target.probe = null;

    let offset = HEADER_WORDS;
    for (let index = 0; index < structureCount; index += 1) {
      const structure = target.structures[index] ?? emptyStructure();
      const id = Math.trunc(this.payload[offset]);
      if (structureIds[index] !== id || !structure.id) {
        structureIds[index] = id;
        structure.id = `structure-${id}`;
      }
      structure.x = this.payload[offset + 1];
      structure.y = this.payload[offset + 2];
      structure.angle = this.payload[offset + 3];
      structure.isSleeping = this.payload[offset + 4] !== 0;
      structure.isHeld = this.payload[offset + 5] !== 0;
      structure.placementValid = this.payload[offset + 6] !== 0;
      target.structures[index] = structure;
      offset += STRUCTURE_WORDS;
    }
    target.structures.length = structureCount;

    offset = HEADER_WORDS + SHARED_MOTION_MAX_STRUCTURES * STRUCTURE_WORDS;
    for (let index = 0; index < animalCount; index += 1) {
      const animal = target.animals[index] ?? emptyAnimal();
      const id = Math.trunc(this.payload[offset]);
      if (animalIds[index] !== id || !animal.id) {
        animalIds[index] = id;
        animal.id = `animal-${id}`;
      }
      animal.x = this.payload[offset + 1];
      animal.y = this.payload[offset + 2];
      animal.vx = this.payload[offset + 3];
      animal.vy = this.payload[offset + 4];
      animal.facing = this.payload[offset + 5] < 0 ? -1 : 1;
      animal.poseAngle = this.payload[offset + 6];
      animal.bodyLength = this.payload[offset + 7];
      animal.lifeStage = LIFE_STAGES[Math.trunc(this.payload[offset + 8])] ?? 'adult';
      animal.sex = SEXES[Math.trunc(this.payload[offset + 9])] ?? 'female';
      animal.ageSeconds = this.payload[offset + 10];
      animal.lifespanSeconds = this.payload[offset + 11];
      animal.energy = this.payload[offset + 12];
      animal.health = this.payload[offset + 13];
      animal.behavior = BEHAVIORS[Math.trunc(this.payload[offset + 14])] ?? 'resting';
      animal.reproductiveState = REPRODUCTIVE_STATES[
        Math.trunc(this.payload[offset + 15])
      ] ?? 'none';
      animal.recentIntake = this.payload[offset + 16];
      animal.consumedBiomass = this.payload[offset + 17];
      target.animals[index] = animal;
      offset += ANIMAL_WORDS;
    }
    target.animals.length = animalCount;

    const generationAfter = Atomics.load(this.control, CONTROL_GENERATION);
    if (generationBefore !== generationAfter || generationAfter % 2 !== 0) return null;
    this.lastGeneration = generationAfter;
    this.nextMessageIndex = this.nextMessageIndex === 0 ? 1 : 0;
    return target;
  }
}
