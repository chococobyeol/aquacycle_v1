import { describe, expect, it } from 'vitest';
import { SimulationWorld } from '../src/simulation/SimulationWorld';
import { SURFACE_ALGAE_INOCULUM_BIOMASS } from '../src/simulation/config';
import { CLOSED_MATERIAL_RELATIVE_TOLERANCE } from '../src/simulation/stoichiometry';
import type {
  MicrobeGuildId,
  SpeciesId,
  StructureDefinitionId,
  SurfaceCellSnapshot,
  Vec2,
} from '../src/simulation/types';

const placeSeed = (world: SimulationWorld, speciesId: SpeciesId, point: Vec2): void => {
  world.handle({ type: 'pick-seed', speciesId, point });
  world.handle({ type: 'drop-held', point });
};

const placeShrimp = (world: SimulationWorld, point: Vec2): void => {
  world.handle({ type: 'pick-animal', speciesId: 'cherry-shrimp', point });
  world.handle({ type: 'drop-held', point });
};

const placeStructure = (
  world: SimulationWorld,
  definitionId: StructureDefinitionId,
  point: Vec2,
): void => {
  world.handle({ type: 'pick-structure', definitionId, point });
  world.handle({ type: 'drop-held', point });
  for (let frame = 0; frame < 720; frame += 1) world.tick(1 / 60);
};

const placeFilm = (
  world: SimulationWorld,
  guildId: MicrobeGuildId,
  point: Vec2,
): void => {
  world.handle({ type: 'pick-biofilm', guildId, point });
  world.handle({ type: 'drop-held', point });
};

const nearestUnusedCell = (
  cells: SurfaceCellSnapshot[],
  targetX: number,
  targetLight: number,
  used: Set<string>,
): SurfaceCellSnapshot => {
  const cell = cells
    .filter((candidate) => !used.has(candidate.id))
    .sort((left, right) =>
      Math.abs(left.x - targetX) / 25 + Math.abs(left.light - targetLight) -
      (Math.abs(right.x - targetX) / 25 + Math.abs(right.light - targetLight)))[0];
  if (!cell) throw new Error('long-run fixture needs another substrate cell');
  used.add(cell.id);
  return cell;
};

const populate = (world: SimulationWorld): void => {
  placeStructure(world, 'flat-stone', { x: 480, y: 420 });
  placeStructure(world, 'tall-stone', { x: 860, y: 320 });
  const substrate = world.snapshot().cells;
  const used = new Set<string>();
  for (const x of [180, 300, 420, 540, 700, 820, 940, 1_060]) {
    placeSeed(world, 'nitzschia', nearestUnusedCell(substrate, x, 38, used));
    placeSeed(world, 'oedogonium', nearestUnusedCell(substrate, x + 24, 68, used));
  }
};

const releaseShrimp = (world: SimulationWorld): void => {
  for (const x of [290, 430, 770, 910]) placeShrimp(world, { x, y: 600 });
};

const inoculate = (
  world: SimulationWorld,
  guildId: MicrobeGuildId,
  count: number,
): void => {
  const cells = world.snapshot().cells;
  const offset = guildId === 'decomposer' ? 0 : 1;
  for (let index = 0; index < count; index += 1) {
    placeFilm(world, guildId, cells[index * 2 + offset]!);
  }
};

describe.sequential('mission 5 closed long-term ecology', () => {
  let world: SimulationWorld;
  let didDecomposer = false;
  let didNitrifier = false;
  let nextSample = 300;
  const samples: ReturnType<SimulationWorld['snapshot']>[] = [];
  let snapshot: ReturnType<SimulationWorld['snapshot']>;

  const advanceTo = (targetSeconds: number): void => {
    while (snapshot.elapsedSeconds < targetSeconds) {
      if (!didDecomposer && snapshot.elapsedSeconds >= 1_800) {
        world.handle({ type: 'pause' });
        inoculate(world, 'decomposer', 4);
        world.handle({ type: 'resume' });
        didDecomposer = true;
      }
      if (!didNitrifier && snapshot.elapsedSeconds >= 3_600) {
        world.handle({ type: 'pause' });
        inoculate(world, 'nitrifier', 4);
        releaseShrimp(world);
        world.handle({ type: 'resume' });
        didNitrifier = true;
      }

      world.tick(0.1);
      snapshot = world.snapshot();
      if (snapshot.elapsedSeconds >= nextSample) {
        samples.push(snapshot);
        nextSample += 300;
      }
    }
  };

  it('establishes the producer bed and releases the founder shrimp once', () => {
    // This suite checks the ecological feedback loop, not whether one tiny
    // lineage happens to draw a single-sex generation. Gameplay keeps that
    // legitimate demographic failure; the deterministic ecology baseline
    // uses an explicit non-terminating reference seed.
    world = new SimulationWorld('mission-5', undefined, 1);
    populate(world);
    world.handle({ type: 'start' });
    world.handle({ type: 'set-speed', speed: 64 });
    snapshot = world.snapshot();
    advanceTo(8_000);

    expect(snapshot.animalPopulation['cherry-shrimp'].total)
      .toBeGreaterThan(0);
    expect(snapshot.remainingSeeds).toMatchObject({
      nitzschia: 0,
      oedogonium: 0,
    });
  }, 90_000);

  it('establishes a third-generation colony without adding food mid-run', () => {
    advanceTo(11_000);

    const final = samples.at(-1)!;
    const finalShrimp = world.exportSaveData().animals.filter(
      (animal) => animal.speciesId === 'cherry-shrimp',
    );
    expect(final.outcome).toBe('success');
    expect(final.animalPopulation['cherry-shrimp'].total)
      .toBeGreaterThanOrEqual(18);
    expect(finalShrimp.every((animal) => animal.origin === 'born')).toBe(true);
    expect(finalShrimp.some((animal) => (animal.generation ?? 0) >= 3)).toBe(true);
    const establishedAlgae = samples
      .filter((sample) => sample.elapsedSeconds >= 8_000)
      .map((sample) =>
        sample.totalBiomass.oedogonium + sample.totalBiomass.nitzschia);
    const initialAlgaeInoculum = 8 * 2 * SURFACE_ALGAE_INOCULUM_BIOMASS;
    // A fixed final threshold can land on either side of a healthy
    // consumer-resource orbit. Require a producer bed well above inoculum and
    // real movement here; the 40,000-second verifier checks the later
    // fall-and-rebound sequence and bounded population minimum.
    expect(Math.min(...establishedAlgae)).toBeGreaterThan(initialAlgaeInoculum * 4);
    expect(Math.max(...establishedAlgae) - Math.min(...establishedAlgae))
      .toBeGreaterThan(2);
    expect(final.biogeochemistry.biofilmTotals.decomposer).toBeGreaterThan(0);
    expect(final.biogeochemistry.biofilmTotals.nitrifier).toBeGreaterThan(0);
    expect(Math.min(...samples.map((sample) =>
      sample.biogeochemistry.average.oxygen,
    ))).toBeGreaterThan(30);
    expect(Math.max(...samples.map((sample) =>
      sample.biogeochemistry.average.toxicWaste,
    ))).toBeLessThan(6);
    expect(Math.abs(final.biogeochemistry.materialBalance.nitrogenDriftRatio))
      .toBeLessThan(CLOSED_MATERIAL_RELATIVE_TOLERANCE);
    expect(Math.abs(final.biogeochemistry.materialBalance.carbonDriftRatio))
      .toBeLessThan(CLOSED_MATERIAL_RELATIVE_TOLERANCE);
    expect(Math.abs(final.biogeochemistry.materialBalance.oxygenEquivalentDriftRatio))
      .toBeLessThan(CLOSED_MATERIAL_RELATIVE_TOLERANCE);
    // The separate 40,000-second verifier covers the producer plateau and
    // second nutrient rebound without holding a Vitest worker past its RPC limit.
  }, 90_000);
});
