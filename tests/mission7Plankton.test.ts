import { describe, expect, it } from 'vitest';
import { SimulationWorld } from '../src/simulation/SimulationWorld';
import { CLOSED_MATERIAL_RELATIVE_TOLERANCE } from '../src/simulation/stoichiometry';
import type {
  AnimalSpeciesId,
  PlanktonKind,
  SpeciesId,
  SurfaceCellSnapshot,
  Vec2,
} from '../src/simulation/types';

const placePlankton = (
  world: SimulationWorld,
  planktonKind: PlanktonKind,
  point: Vec2,
): void => {
  world.handle({ type: 'pick-plankton', planktonKind, point });
  world.handle({ type: 'drop-held', point });
};

const placeSeed = (
  world: SimulationWorld,
  speciesId: SpeciesId,
  cell: SurfaceCellSnapshot,
): void => {
  world.handle({ type: 'pick-seed', speciesId, point: cell });
  world.handle({ type: 'drop-held', point: cell });
};

const placeAnimal = (
  world: SimulationWorld,
  speciesId: AnimalSpeciesId,
  point: Vec2,
): void => {
  world.handle({ type: 'pick-animal', speciesId, point });
  world.handle({ type: 'drop-held', point });
};

const inoculateMicrobes = (world: SimulationWorld): void => {
  for (const [guildId, x] of [
    ['decomposer', 360],
    ['decomposer', 540],
    ['nitrifier', 720],
    ['nitrifier', 900],
  ] as const) {
    const point = { x, y: 630 };
    world.handle({ type: 'pick-biofilm', guildId, point });
    world.handle({ type: 'drop-held', point });
  }
};

const placeEverySuppliedOrganism = (
  world: SimulationWorld,
  includeAdditionalMicrobes: boolean,
): void => {
  for (let index = 0; index < 3; index += 1) {
    placePlankton(world, 'phytoplankton', { x: 600, y: 320 });
    placePlankton(world, 'daphnia', { x: 600, y: 320 });
  }

  const substrate = world.snapshot().cells
    .filter((cell) => cell.surfaceKind === 'substrate')
    .sort((left, right) => left.x - right.x);
  const atFraction = (fraction: number): SurfaceCellSnapshot =>
    substrate[Math.min(
      substrate.length - 1,
      Math.max(0, Math.round((substrate.length - 1) * fraction)),
    )];
  const placements: Array<[SpeciesId, number]> = [
    ['oedogonium', 0.08],
    ['nitzschia', 0.16],
    ['vallisneria', 0.24],
    ['oedogonium', 0.32],
    ['nitzschia', 0.4],
    ['vallisneria', 0.48],
    ['oedogonium', 0.56],
    ['nitzschia', 0.64],
    ['vallisneria', 0.72],
    ['oedogonium', 0.8],
    ['nitzschia', 0.88],
  ];
  for (const [speciesId, fraction] of placements) {
    placeSeed(world, speciesId, atFraction(fraction));
  }
  for (const x of [300, 480, 720, 900]) {
    placeAnimal(world, 'cherry-shrimp', { x, y: 610 });
  }
  if (includeAdditionalMicrobes) inoculateMicrobes(world);
};

describe('mission 7 plankton challenge', () => {
  it('can connect two Daphnia generations with the supplied inocula', () => {
    const world = new SimulationWorld('mission-7');
    placePlankton(world, 'phytoplankton', { x: 420, y: 260 });
    placePlankton(world, 'phytoplankton', { x: 600, y: 360 });
    placePlankton(world, 'phytoplankton', { x: 780, y: 260 });
    for (const point of [
      { x: 510, y: 300 },
      { x: 600, y: 360 },
      { x: 690, y: 300 },
    ]) {
      placePlankton(world, 'daphnia', point);
    }
    inoculateMicrobes(world);
    world.handle({ type: 'start' });
    world.handle({ type: 'set-speed', speed: 64 });

    let snapshot = world.snapshot();
    let guard = 0;
    while (snapshot.elapsedSeconds < 2_400 && guard < 400) {
      world.tick(0.1);
      snapshot = world.snapshot();
      guard += 1;
    }

    const plankton = snapshot.biogeochemistry.plankton;
    const balance = snapshot.biogeochemistry.materialBalance;
    const bornLineage = world.exportSaveData().animals.filter((animal) =>
      animal.speciesId === 'daphnia' && (animal.generation ?? 0) >= 1);
    const bornLineageBiomass = bornLineage.reduce(
      (total, animal) =>
        total +
        animal.structuralBiomass +
        animal.storedBiomass +
        (animal.reproductiveBiomass ?? 0),
      0,
    );
    expect(guard).toBeLessThan(400);
    // The mission score and its biomass threshold are UI pacing. Ecological
    // evidence is an actual generation-2 descendant funded by the food web.
    expect(plankton.cumulativeEvents.secondGenerationBirths).toBeGreaterThan(0);
    expect(bornLineage.some((animal) => (animal.generation ?? 0) >= 2)).toBe(true);
    expect(bornLineageBiomass).toBeGreaterThan(0);
    expect(plankton.daphniaJuvenileBiomass + plankton.daphniaAdultBiomass)
      .toBeGreaterThan(0);
    expect(Math.abs(balance.nitrogenDriftRatio))
      .toBeLessThan(CLOSED_MATERIAL_RELATIVE_TOLERANCE);
    expect(Math.abs(balance.carbonDriftRatio))
      .toBeLessThan(CLOSED_MATERIAL_RELATIVE_TOLERANCE);
    expect(Math.abs(balance.oxygenEquivalentDriftRatio))
      .toBeLessThan(CLOSED_MATERIAL_RELATIVE_TOLERANCE);
  }, 45_000);

  it('does not collapse when every supplied producer and consumer is placed', async () => {
    const world = new SimulationWorld('mission-7');
    placeEverySuppliedOrganism(world, true);
    world.handle({ type: 'start' });
    world.handle({ type: 'set-speed', speed: 64 });

    let snapshot = world.snapshot();
    let guard = 0;
    let maximumDaphniaCount = 0;
    let minimumPhytoplanktonBiomass = Number.POSITIVE_INFINITY;
    // This is the short public-command smoke fixture. Founder turnover and the
    // complete 7,200-second food web are enforced by
    // verifyMission7LongRun.ts without duplicating that expensive run here.
    while (snapshot.elapsedSeconds < 1_800 && guard < 350) {
      world.tick(0.1);
      snapshot = world.snapshot();
      guard += 1;
      maximumDaphniaCount = Math.max(
        maximumDaphniaCount,
        snapshot.biogeochemistry.plankton.approximateDaphniaCount,
      );
      minimumPhytoplanktonBiomass = Math.min(
        minimumPhytoplanktonBiomass,
        snapshot.biogeochemistry.plankton.phytoplanktonBiomass,
      );
      if (guard % 64 === 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }

    const plankton = snapshot.biogeochemistry.plankton;
    expect(guard).toBeLessThan(350);
    expect(plankton.phytoplanktonBiomass).toBeGreaterThan(0.5);
    expect(plankton.approximateDaphniaCount).toBeGreaterThan(0);
    expect(maximumDaphniaCount).toBeLessThan(1_000);
    expect(minimumPhytoplanktonBiomass).toBeGreaterThan(0.5);
    expect(plankton.cumulativeEvents.births).toBeGreaterThan(0);
    expect(snapshot.animalPopulation['cherry-shrimp'].total).toBeGreaterThan(0);
    expect(snapshot.biogeochemistry.biofilmTotals.decomposer).toBeGreaterThan(0);
    expect(snapshot.biogeochemistry.biofilmTotals.nitrifier).toBeGreaterThan(0);
    expect(snapshot.totalBiomass.vallisneria).toBeGreaterThan(0.5);
  }, 90_000);

  it('requires explicit cycling inoculation instead of hidden resident films', async () => {
    const world = new SimulationWorld('mission-7');
    placeEverySuppliedOrganism(world, true);
    world.handle({ type: 'start' });
    world.handle({ type: 'set-speed', speed: 64 });

    let snapshot = world.snapshot();
    let guard = 0;
    while (snapshot.elapsedSeconds < 4_200 && guard < 700) {
      world.tick(0.1);
      snapshot = world.snapshot();
      guard += 1;
      if (guard % 64 === 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }

    expect(guard).toBeLessThan(700);
    expect(world.exportSaveData().microbeInventoryUsed).toEqual({
      decomposer: 2,
      nitrifier: 2,
    });
    expect(snapshot.biogeochemistry.biofilmTotals.decomposer).toBeGreaterThan(0);
    expect(snapshot.biogeochemistry.biofilmTotals.nitrifier).toBeGreaterThan(0);
    expect(snapshot.biogeochemistry.average.organicMatter).toBeLessThan(18);
    expect(snapshot.plants.filter((plant) => plant.origin === 'runner').length)
      .toBeGreaterThanOrEqual(3);
    expect(snapshot.totalBiomass.vallisneria).toBeGreaterThan(0.5);
  }, 180_000);
});
