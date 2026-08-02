import { describe, expect, it } from 'vitest';
import { SCENARIOS } from '../src/simulation/config';
import { SimulationWorld } from '../src/simulation/SimulationWorld';
import { CLOSED_MATERIAL_RELATIVE_TOLERANCE } from '../src/simulation/stoichiometry';

describe('mission 8 scenario', () => {
  it('opens as a long-tank playable scenario without inventing a completion target', () => {
    const scenario = SCENARIOS['mission-8'];
    const snapshot = new SimulationWorld('mission-8').snapshot();

    expect(scenario.tankType).toBe('long');
    expect(scenario.target).toBeNull();
    expect(scenario.timeLimitSeconds).toBeNull();
    expect(snapshot.tank.id).toBe('long');
    expect(snapshot.tank.width).toBe(2_400);
    expect(snapshot.biogeochemistry.water.columns).toBe(72);
    expect(snapshot.remainingAnimals['japanese-ricefish']).toBe(2);
    expect(snapshot.remainingAnimals['cherry-shrimp']).toBe(8);
    expect(snapshot.remainingSeeds.oedogonium).toBe(8);
    expect(snapshot.remainingSeeds.nitzschia).toBe(8);
    expect(snapshot.remainingSeeds.vallisneria).toBe(6);
    expect(snapshot.remainingPlankton.phytoplankton).toBe(6);
    expect(snapshot.remainingPlankton.daphnia).toBe(6);
    expect(snapshot.remainingStructures['small-flat-stone']).toBeNull();
    expect(snapshot.remainingStructures['small-wedge-stone']).toBeNull();

    const saved = new SimulationWorld('mission-8').exportSaveData();
    const restored = new SimulationWorld();
    restored.loadSaveData(saved);
    expect(restored.snapshot().scenarioId).toBe('mission-8');
    expect(restored.snapshot().tank.id).toBe('long');
  });

  it('lets a held-back ricefish join after the Daphnia establishment phase', () => {
    const world = new SimulationWorld('mission-8');
    world.handle({ type: 'start' });
    expect(world.snapshot()).toMatchObject({
      phase: 'running',
      remainingAnimals: { 'japanese-ricefish': 2 },
    });

    world.handle({ type: 'pause' });
    const releasePoint = { x: 1_200, y: 320 };
    world.handle({
      type: 'pick-animal',
      speciesId: 'japanese-ricefish',
      point: releasePoint,
    });
    expect(world.snapshot().holding).toMatchObject({
      kind: 'animal',
      source: 'inventory',
      animalSpeciesId: 'japanese-ricefish',
    });

    world.handle({ type: 'drop-held', point: releasePoint });
    const released = world.snapshot();
    expect(released.holding).toBeNull();
    expect(released.remainingAnimals['japanese-ricefish']).toBe(1);
    expect(released.animalPopulation['japanese-ricefish'].total).toBe(1);
    expect(released.animalPopulationEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'introduced',
          speciesId: 'japanese-ricefish',
          elapsedSeconds: released.elapsedSeconds,
        }),
      ]),
    );

    const balance = released.biogeochemistry.materialBalance;
    expect(Math.abs(balance.nitrogenDriftRatio))
      .toBeLessThan(CLOSED_MATERIAL_RELATIVE_TOLERANCE);
    expect(Math.abs(balance.carbonDriftRatio))
      .toBeLessThan(CLOSED_MATERIAL_RELATIVE_TOLERANCE);
    expect(Math.abs(balance.oxygenEquivalentDriftRatio))
      .toBeLessThan(CLOSED_MATERIAL_RELATIVE_TOLERANCE);

    world.handle({ type: 'resume' });
    expect(world.snapshot().phase).toBe('running');
  });

  it('continues the supplied ricefish sex sequence after death and save-load', () => {
    const world = new SimulationWorld('mission-8');
    world.handle({ type: 'start' });
    world.handle({ type: 'pause' });
    const firstReleasePoint = { x: 900, y: 320 };
    world.handle({
      type: 'pick-animal',
      speciesId: 'japanese-ricefish',
      point: firstReleasePoint,
    });
    world.handle({ type: 'drop-held', point: firstReleasePoint });

    const firstRicefish = world.snapshot().animals.find(
      (animal) => animal.speciesId === 'japanese-ricefish',
    );
    expect(firstRicefish?.sex).toBe('female');

    const saved = world.exportSaveData();
    expect(saved.animalInventoryUsed['japanese-ricefish']).toBe(1);
    // Reproduce a thaw after the first supplied fish has died and its body is
    // no longer present, while its consumed inventory slot remains recorded.
    saved.animals = saved.animals.filter(
      (animal) => animal.speciesId !== 'japanese-ricefish',
    );

    const restored = new SimulationWorld();
    restored.loadSaveData(saved);
    expect(restored.snapshot().phase).toBe('paused');
    expect(restored.snapshot().remainingAnimals['japanese-ricefish']).toBe(1);

    const secondReleasePoint = { x: 1_500, y: 320 };
    restored.handle({
      type: 'pick-animal',
      speciesId: 'japanese-ricefish',
      point: secondReleasePoint,
    });
    restored.handle({ type: 'drop-held', point: secondReleasePoint });

    const secondRicefish = restored.snapshot().animals.find(
      (animal) => animal.speciesId === 'japanese-ricefish',
    );
    expect(secondRicefish?.sex).toBe('male');
  });

  it('keeps paused animal placement locked in earlier challenge missions', () => {
    const world = new SimulationWorld('mission-7');
    world.handle({ type: 'start' });
    world.handle({ type: 'pause' });

    world.handle({
      type: 'pick-animal',
      speciesId: 'cherry-shrimp',
      point: { x: 600, y: 320 },
    });

    const snapshot = world.snapshot();
    expect(snapshot.phase).toBe('paused');
    expect(snapshot.holding).toBeNull();
    expect(snapshot.animals).toHaveLength(0);
    expect(snapshot.remainingAnimals['cherry-shrimp']).toBe(4);
  });

  it('keeps structures, attached producers and plankton locked during staged release', () => {
    const world = new SimulationWorld('mission-8');
    world.handle({ type: 'start' });
    world.handle({ type: 'pause' });
    const point = { x: 1_200, y: 320 };

    world.handle({
      type: 'pick-structure',
      definitionId: 'small-flat-stone',
      point,
    });
    expect(world.snapshot().holding).toBeNull();

    world.handle({ type: 'pick-seed', speciesId: 'oedogonium', point });
    expect(world.snapshot().holding).toBeNull();

    world.handle({
      type: 'pick-plankton',
      planktonKind: 'phytoplankton',
      point,
    });
    const snapshot = world.snapshot();
    expect(snapshot.holding).toBeNull();
    expect(snapshot.remainingStructures['small-flat-stone']).toBeNull();
    expect(snapshot.remainingSeeds.oedogonium).toBe(8);
    expect(snapshot.remainingPlankton.phytoplankton).toBe(6);
  });
});
