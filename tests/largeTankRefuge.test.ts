import { describe, expect, it } from 'vitest';
import { BiogeochemistryLedger } from '../src/simulation/biogeochemistry';
import { SimulationWorld } from '../src/simulation/SimulationWorld';
import type { AnimalSpeciesId, Vec2 } from '../src/simulation/types';

const placeStructure = (
  world: SimulationWorld,
  definitionId: 'small-flat-stone',
  point: Vec2,
): void => {
  world.handle({ type: 'pick-structure', definitionId, point });
  world.handle({ type: 'drop-held', point });
};

const placeAnimal = (
  world: SimulationWorld,
  speciesId: AnimalSpeciesId,
  point: Vec2,
): void => {
  world.handle({ type: 'pick-animal', speciesId, point });
  world.handle({ type: 'drop-held', point });
};

describe('large tank and body-clearance refuge', () => {
  it('doubles horizontal water cells and substrate without changing concentration', () => {
    const standard = new SimulationWorld('laboratory', 'standard').snapshot();
    const long = new SimulationWorld('laboratory', 'long');
    const snapshot = long.snapshot();

    expect(snapshot.tank.width).toBe(2_400);
    expect(snapshot.tank.height).toBe(720);
    expect(snapshot.biogeochemistry.water.columns).toBe(72);
    expect(snapshot.biogeochemistry.water.rows).toBe(20);
    expect(
      snapshot.cells.filter((cell) => cell.surfaceKind === 'substrate'),
    ).toHaveLength(
      standard.cells.filter((cell) => cell.surfaceKind === 'substrate').length * 2,
    );
    expect(snapshot.biogeochemistry.average).toEqual(
      standard.biogeochemistry.average,
    );
    expect(
      snapshot.biogeochemistry.water.oxygen.reduce(
        (total, value) => total + value,
        0,
      ),
    ).toBeCloseTo(
      standard.biogeochemistry.water.oxygen.reduce(
        (total, value) => total + value,
        0,
      ) * 2,
      8,
    );

    const saved = long.exportSaveData();
    expect(saved.tankType).toBe('long');
    const restored = new SimulationWorld('laboratory');
    restored.loadSaveData(saved);
    expect(restored.snapshot().tank.id).toBe('long');
    expect(restored.snapshot().biogeochemistry.water.columns).toBe(72);
  });

  it('keeps small rocks out of missions 1-7 and exposes them in the laboratory', () => {
    const mission = new SimulationWorld('mission-7').snapshot();
    const laboratory = new SimulationWorld('laboratory').snapshot();

    expect(mission.remainingStructures['small-flat-stone']).toBe(0);
    expect(mission.remainingStructures['small-wedge-stone']).toBe(0);
    expect(laboratory.remainingStructures['small-flat-stone']).toBeNull();
    expect(laboratory.remainingStructures['small-wedge-stone']).toBeNull();
  });

  it('derives a visible gap once and lets only a fitting, eligible prey seek it', () => {
    const world = new SimulationWorld('laboratory');
    placeStructure(world, 'small-flat-stone', { x: 500, y: 560 });
    placeStructure(world, 'small-flat-stone', { x: 609, y: 560 });
    for (let index = 0; index < 800; index += 1) world.tick(1 / 60);
    const smallStoneCells = world.snapshot().cells.filter(
      (cell) => cell.surfaceKind === 'structure-face',
    );
    expect(smallStoneCells.length).toBeGreaterThan(0);
    expect(smallStoneCells.some((cell) => cell.targetEligible)).toBe(true);
    placeAnimal(world, 'cherry-shrimp', { x: 554, y: 575 });
    placeAnimal(world, 'japanese-ricefish', { x: 554, y: 515 });

    const internals = world as unknown as {
      animals: Array<{
        id: string;
        speciesId: AnimalSpeciesId;
        lifeStage: 'egg' | 'fry' | 'juvenile' | 'adult';
        bodyLength: number;
        growthProgress: number;
        position: Vec2;
        velocity: Vec2;
        behavior: string;
        behaviorTimer: number;
        targetAnimalId: string | null;
      }>;
      refugeGaps: Array<{ point: Vec2; clearance: number }>;
      rebuildRefugeGaps(): void;
      directPredatorForShrimp(shrimp: unknown): unknown;
      relativeRefugeFor(prey: unknown, predator: unknown): unknown;
      ricefishRelativeRefugeAt(prey: unknown, predator: unknown): unknown;
      stepAnimalMotion(deltaSeconds: number): void;
      stepRicefishEcology(deltaSeconds: number): void;
    };
    const shrimp = internals.animals.find(
      (animal) => animal.speciesId === 'cherry-shrimp',
    )!;
    const fish = internals.animals.find(
      (animal) => animal.speciesId === 'japanese-ricefish',
    )!;
    shrimp.lifeStage = 'juvenile';
    shrimp.bodyLength = 18;
    shrimp.growthProgress = 0;
    shrimp.position = { x: 554, y: 575 };
    shrimp.velocity = { x: 0, y: 0 };
    fish.position = { x: 554, y: 515 };
    fish.velocity = { x: 0, y: 40 };

    internals.rebuildRefugeGaps();
    expect(internals.refugeGaps).toHaveLength(1);
    expect(internals.refugeGaps[0].clearance).toBeGreaterThan(8);
    expect(internals.refugeGaps[0].clearance).toBeLessThan(12);
    expect(internals.directPredatorForShrimp(shrimp)).toBe(fish);
    expect(internals.relativeRefugeFor(shrimp, fish)).not.toBeNull();

    const beforeY = shrimp.position.y;
    internals.stepAnimalMotion(0.1);
    expect(shrimp.position.y).toBeGreaterThan(beforeY);
    expect(shrimp.behavior).toBe('traveling');

    const gapPoint = internals.refugeGaps[0].point;
    shrimp.position = { ...gapPoint };
    fish.position = { x: gapPoint.x, y: gapPoint.y - 5 };
    fish.velocity = { x: 0, y: 0 };
    expect(internals.ricefishRelativeRefugeAt(shrimp, fish)).not.toBeNull();

    world.handle({ type: 'set-spatial-debug', enabled: true });
    const debugSnapshot = world.snapshot();
    expect(debugSnapshot.spatialDebug.enabled).toBe(true);
    expect(debugSnapshot.spatialDebug.gaps).toHaveLength(1);
    expect(debugSnapshot.spatialDebug.agents).toHaveLength(2);
    expect(debugSnapshot.spatialDebug.gaps[0].first).not.toEqual(
      debugSnapshot.spatialDebug.gaps[0].second,
    );

    for (let attempt = 0; attempt < 200; attempt += 1) {
      fish.behavior = 'hunting';
      fish.behaviorTimer = 0;
      fish.targetAnimalId = shrimp.id;
      internals.stepRicefishEcology(0.1);
    }
    expect(internals.animals.some((animal) => animal.id === shrimp.id)).toBe(true);

    shrimp.lifeStage = 'adult';
    shrimp.bodyLength = 36;
    expect(internals.directPredatorForShrimp(shrimp)).toBeNull();

    world.handle({ type: 'set-spatial-debug', enabled: false });
    expect(world.snapshot().spatialDebug.gaps).toHaveLength(0);
  });

  it('keeps predator risk in one decaying, non-material water field', () => {
    const ledger = new BiogeochemistryLedger({
      effectsEnabled: false,
      columns: 72,
      rows: 20,
      tankWidth: 2_400,
    });
    const source = { point: { x: 1_200, y: 320 }, strength: 0.2 };
    ledger.advance(1, [], [], [], [source]);
    const initial = ledger.predatorDangerCueAt(source.point);
    expect(initial).toBeGreaterThan(0);
    ledger.emitPredatorDangerPulse(source.point, 1);
    expect(ledger.predatorDangerCueAt(source.point)).toBe(1);
    for (let index = 0; index < 120; index += 1) {
      ledger.advance(1, [], [], [], []);
    }
    expect(ledger.predatorDangerCueAt(source.point)).toBeLessThan(0.01);
  });

  it('keeps long-tank behavioral fields bounded during a 64x run', () => {
    const world = new SimulationWorld('laboratory', 'long');
    placeStructure(world, 'small-flat-stone', { x: 1_120, y: 560 });
    placeStructure(world, 'small-flat-stone', { x: 1_229, y: 560 });
    for (let index = 0; index < 800; index += 1) world.tick(1 / 60);
    placeAnimal(world, 'cherry-shrimp', { x: 1_174, y: 575 });
    placeAnimal(world, 'japanese-ricefish', { x: 1_174, y: 510 });
    world.handle({ type: 'start' });
    world.handle({ type: 'set-speed', speed: 64 });

    while (world.snapshot().elapsedSeconds < 600) world.tick(0.1);

    const snapshot = world.snapshot();
    const saved = world.exportSaveData();
    const internals = world as unknown as {
      refugeGaps: unknown[];
      ricefishMotionBucketsScratch: unknown[][];
      shrimpMotionBucketsScratch: unknown[][];
    };
    expect(snapshot.elapsedSeconds).toBeGreaterThanOrEqual(600);
    expect(snapshot.biogeochemistry.water.oxygen).toHaveLength(72 * 20);
    expect(snapshot.biogeochemistry.water.phytoplankton).toHaveLength(72 * 20);
    expect(snapshot.biogeochemistry.transport.temperature).toHaveLength(72 * 20);
    expect(saved.biogeochemistry.predatorDangerCue).toHaveLength(72 * 20);
    expect(internals.refugeGaps.length).toBeLessThanOrEqual(1);
    expect(
      internals.ricefishMotionBucketsScratch.reduce(
        (count, entries) => count + entries.length,
        0,
      ),
    ).toBeLessThanOrEqual(snapshot.animals.length);
    expect(
      internals.shrimpMotionBucketsScratch.reduce(
        (count, entries) => count + entries.length,
        0,
      ),
    ).toBeLessThanOrEqual(snapshot.animals.length);
  }, 10_000);
});
