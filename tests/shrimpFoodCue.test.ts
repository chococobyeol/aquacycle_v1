import { describe, expect, it } from 'vitest';
import {
  BiogeochemistryLedger,
  type BiofilmReactionSite,
  type ShrimpFoodCueSite,
  type ShrimpMateCueSite,
} from '../src/simulation/biogeochemistry';
import { SimulationWorld } from '../src/simulation/SimulationWorld';
import type { Vec2 } from '../src/simulation/types';

const sourcePoint = { x: 600, y: 560 };
const sourceSite = (): BiofilmReactionSite => ({
  point: sourcePoint,
  biofilm: { decomposer: 0, nitrifier: 0 },
});
const foodCueSite = (): ShrimpFoodCueSite => ({
  point: sourcePoint,
  strength: 0.6,
});

describe('shrimp dissolved local cues', () => {
  it('forms a local diffusing field even before full water chemistry is enabled', () => {
    const ledger = new BiogeochemistryLedger({ effectsEnabled: false });
    for (let second = 0; second < 60; second += 1) {
      ledger.advance(1, [sourceSite()], [], [foodCueSite()]);
    }

    const atSource = ledger.shrimpFoodCueAt(sourcePoint);
    const nearby = ledger.shrimpFoodCueAt({ x: 670, y: 560 });
    const farAway = ledger.shrimpFoodCueAt({ x: 80, y: 180 });
    expect(atSource).toBeGreaterThan(0.05);
    expect(nearby).toBeGreaterThan(0);
    expect(atSource).toBeGreaterThan(nearby);
    expect(nearby).toBeGreaterThan(farAway);
  });

  it('decays after an edible surface stops emitting', () => {
    const ledger = new BiogeochemistryLedger({ effectsEnabled: false });
    for (let second = 0; second < 60; second += 1) {
      ledger.advance(1, [sourceSite()], [], [foodCueSite()]);
    }
    const before = ledger.shrimpFoodCueAt(sourcePoint);

    for (let second = 0; second < 180; second += 1) {
      ledger.advance(1, []);
    }

    expect(ledger.shrimpFoodCueAt(sourcePoint)).toBeLessThan(before * 0.25);
  });

  it('does not alter the closed material ledger', () => {
    const withCue = new BiogeochemistryLedger({ effectsEnabled: false });
    const withoutCue = new BiogeochemistryLedger({ effectsEnabled: false });
    const mateCue: ShrimpMateCueSite = {
      point: { x: 720, y: 560 },
      strength: 1,
    };
    for (let second = 0; second < 90; second += 1) {
      withCue.advance(1, [sourceSite()], [mateCue], [foodCueSite()]);
      withoutCue.advance(1, []);
    }

    expect(withCue.materialState()).toEqual(withoutCue.materialState());
    expect(withCue.shrimpFoodCueAt(sourcePoint)).toBeGreaterThan(0);
    expect(withCue.shrimpMateCueAt(mateCue.point)).toBeGreaterThan(0);
  });

  it('guides a shrimp up a locally sampled plume without selecting its source', () => {
    const world = new SimulationWorld('mission-4');
    world.handle({
      type: 'pick-animal',
      speciesId: 'cherry-shrimp',
      point: { x: 650, y: 560 },
    });
    world.handle({ type: 'drop-held', point: { x: 650, y: 560 } });
    const internals = world as unknown as {
      animals: Array<{ position: Vec2 }>;
      biogeochemistry: BiogeochemistryLedger;
      shrimpFoodCueDirection(animal: { position: Vec2 }): Vec2 | null;
    };
    const source: BiofilmReactionSite = {
      point: { x: 760, y: 560 },
      biofilm: { decomposer: 0, nitrifier: 0 },
    };
    const foodCue: ShrimpFoodCueSite = {
      point: source.point,
      strength: 0.8,
    };
    for (let second = 0; second < 60; second += 1) {
      internals.biogeochemistry.advance(1, [source], [], [foodCue]);
    }

    const direction = internals.shrimpFoodCueDirection(internals.animals[0]!);
    expect(direction).not.toBeNull();
    expect(direction!.x).toBeGreaterThan(0.7);
  });

  it('forms a shorter-lived local cue around a receptive female', () => {
    const ledger = new BiogeochemistryLedger({ effectsEnabled: false });
    const mateCue: ShrimpMateCueSite = {
      point: { x: 760, y: 560 },
      strength: 1,
    };
    for (let second = 0; second < 45; second += 1) {
      ledger.advance(1, [], [mateCue]);
    }

    const atSource = ledger.shrimpMateCueAt(mateCue.point);
    const nearby = ledger.shrimpMateCueAt({ x: 700, y: 560 });
    expect(atSource).toBeGreaterThan(nearby);
    expect(nearby).toBeGreaterThan(0);

    for (let second = 0; second < 60; second += 1) {
      ledger.advance(1, []);
    }
    expect(ledger.shrimpMateCueAt(mateCue.point)).toBeLessThan(atSource * 0.25);
  });

  it('guides only a ready adult male up a locally sampled mate plume', () => {
    const world = new SimulationWorld('mission-4');
    world.handle({
      type: 'pick-animal',
      speciesId: 'cherry-shrimp',
      point: { x: 650, y: 560 },
    });
    world.handle({ type: 'drop-held', point: { x: 650, y: 560 } });
    const internals = world as unknown as {
      animals: Array<{
        speciesId: string;
        lifeStage: string;
        sex: string;
        energy: number;
        reproductionCooldown: number;
        position: Vec2;
      }>;
      biogeochemistry: BiogeochemistryLedger;
      shrimpMateCueDirection(animal: unknown): Vec2 | null;
    };
    const male = internals.animals[0]!;
    male.lifeStage = 'adult';
    male.sex = 'male';
    male.energy = 1;
    male.reproductionCooldown = 0;
    const mateCue: ShrimpMateCueSite = {
      point: { x: 760, y: 560 },
      strength: 1,
    };
    for (let second = 0; second < 45; second += 1) {
      internals.biogeochemistry.advance(1, [], [mateCue]);
    }

    const direction = internals.shrimpMateCueDirection(male);
    expect(direction).not.toBeNull();
    expect(direction!.x).toBeGreaterThan(0.7);

    male.sex = 'female';
    expect(internals.shrimpMateCueDirection(male)).toBeNull();
  });

  it('round-trips both cues while remaining compatible with older saves', () => {
    const ledger = new BiogeochemistryLedger({ effectsEnabled: false });
    const mateCue: ShrimpMateCueSite = {
      point: { x: 720, y: 560 },
      strength: 1,
    };
    for (let second = 0; second < 30; second += 1) {
      ledger.advance(1, [sourceSite()], [mateCue], [foodCueSite()]);
    }
    const state = ledger.exportSaveState();
    const restored = new BiogeochemistryLedger({ effectsEnabled: false });
    restored.restoreSaveState(state);
    expect(restored.shrimpFoodCueAt(sourcePoint))
      .toBeCloseTo(ledger.shrimpFoodCueAt(sourcePoint), 10);
    expect(restored.shrimpMateCueAt(mateCue.point))
      .toBeCloseTo(ledger.shrimpMateCueAt(mateCue.point), 10);

    delete state.shrimpFoodCue;
    delete state.shrimpMateCue;
    const restoredLegacy = new BiogeochemistryLedger({ effectsEnabled: false });
    restoredLegacy.restoreSaveState(state);
    expect(restoredLegacy.shrimpFoodCueAt(sourcePoint)).toBe(0);
    expect(restoredLegacy.shrimpMateCueAt(mateCue.point)).toBe(0);
  });
});
