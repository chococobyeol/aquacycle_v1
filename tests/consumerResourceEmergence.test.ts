import { describe, expect, it } from 'vitest';
import {
  SHRIMP_TECHNICAL_POPULATION_LIMIT,
  SimulationWorld,
} from '../src/simulation/SimulationWorld';
import {
  initialWaterTemperatureForLight,
  SCENARIOS,
  SPECIES,
} from '../src/simulation/config';
import {
  algaePhysiology,
  producerProcessRateScale,
} from '../src/simulation/growth';
import type {
  AnimalSpeciesId,
  SpeciesBiomass,
  SpeciesId,
  SurfaceCellSnapshot,
  Vec2,
} from '../src/simulation/types';

const SHRIMP: AnimalSpeciesId = 'cherry-shrimp';

interface DebugSurfaceCell {
  id: string;
  surfaceKind: string;
  light: number;
  biomass: SpeciesBiomass;
}

interface DebugAnimal {
  id: string;
  behavior: string;
  targetCellId: string | null;
}

interface DebugWorld {
  allCells(): DebugSurfaceCell[];
  stepGrowth(deltaSeconds: number): void;
  scenario: { allowedSpecies: SpeciesId[] };
  biogeochemistry: {
    algaeLightTransmissionAt(point: Vec2): number;
    algaeResourceFactor(point: Vec2): number;
    commitAlgaeProduction(point: Vec2, requestedBiomass: number): number;
    commitAlgaeRespiration(point: Vec2, requestedBiomass: number): number;
    recordAlgaeTurnover(point: Vec2, biomass: number): void;
  };
  animals: DebugAnimal[];
  seedPlacements: Array<{ cellId: string }>;
  snapshotDirty: boolean;
}

const debugWorld = (world: SimulationWorld): DebugWorld =>
  world as unknown as DebugWorld;

const placeSeed = (
  world: SimulationWorld,
  speciesId: SpeciesId,
  point: Vec2,
): void => {
  world.handle({ type: 'pick-seed', speciesId, point });
  world.handle({ type: 'drop-held', point });
};

const placeShrimp = (world: SimulationWorld, point: Vec2): void => {
  world.handle({ type: 'pick-animal', speciesId: SHRIMP, point });
  world.handle({ type: 'drop-held', point });
};

const advanceTo = (
  world: SimulationWorld,
  targetSeconds: number,
  speed: 16 | 64 = 64,
): ReturnType<SimulationWorld['snapshot']> => {
  world.handle({ type: 'set-speed', speed });
  let snapshot = world.snapshot();
  let guard = 0;
  while (snapshot.elapsedSeconds < targetSeconds && guard < 20_000) {
    world.tick(0.1);
    snapshot = world.snapshot();
    guard += 1;
  }
  expect(guard).toBeLessThan(20_000);
  return snapshot;
};

const totalAlgae = (snapshot: ReturnType<SimulationWorld['snapshot']>): number =>
  snapshot.totalBiomass.oedogonium + snapshot.totalBiomass.nitzschia;

const nearestSuitableCell = (
  cells: SurfaceCellSnapshot[],
  targetX: number,
  targetLight: number,
  used: Set<string>,
): SurfaceCellSnapshot => {
  const cell = cells
    .filter((candidate) => !used.has(candidate.id))
    .sort((left, right) => {
      const leftScore = Math.abs(left.x - targetX) / 35 + Math.abs(left.light - targetLight);
      const rightScore = Math.abs(right.x - targetX) / 35 + Math.abs(right.light - targetLight);
      return leftScore - rightScore;
    })[0];
  if (!cell) throw new Error('consumer-resource fixture needs another substrate cell');
  used.add(cell.id);
  return cell;
};

const seedDistributedAlgae = (world: SimulationWorld): Vec2[] => {
  const substrate = world.snapshot().cells.filter((cell) => cell.surfaceKind === 'substrate');
  const used = new Set<string>();
  const foodPoints: Vec2[] = [];
  for (const targetX of [260, 470, 730, 940]) {
    const nitzschia = nearestSuitableCell(substrate, targetX, 38, used);
    placeSeed(world, 'nitzschia', nitzschia);
    placeSeed(world, 'oedogonium', nearestSuitableCell(substrate, targetX + 24, 68, used));
    foodPoints.push(nitzschia);
  }
  return foodPoints;
};

const placeFourShrimp = (
  world: SimulationWorld,
  points: Vec2[] = [
    { x: 290, y: 600 },
    { x: 430, y: 600 },
    { x: 770, y: 600 },
    { x: 910, y: 600 },
  ],
): void => {
  for (const point of points.slice(0, 4)) placeShrimp(world, point);
};

describe('consumer-resource emergence', () => {
  const isolatedProducerRun = (
    resourceFactor: number,
    lightTransmission: number,
    respirationFraction = 1,
  ): { biomass: number; turnover: number } => {
    const world = new SimulationWorld('mission-5');
    const internals = debugWorld(world);
    const cells = internals.allCells();
    for (const cell of cells) {
      cell.light = 68;
      cell.biomass = { oedogonium: 0, nitzschia: 0, vallisneria: 0 };
    }
    cells[Math.floor(cells.length / 2)]!.biomass.oedogonium = 0.4;
    internals.biogeochemistry.algaeResourceFactor = () => resourceFactor;
    internals.biogeochemistry.algaeLightTransmissionAt = () => lightTransmission;
    internals.biogeochemistry.commitAlgaeProduction = (
      _point,
      requestedBiomass,
    ) => requestedBiomass;
    internals.biogeochemistry.commitAlgaeRespiration = (
      _point,
      requestedBiomass,
    ) => requestedBiomass * respirationFraction;
    let turnover = 0;
    internals.biogeochemistry.recordAlgaeTurnover = (_point, biomass) => {
      turnover += biomass;
    };

    internals.stepGrowth(60);
    return {
      biomass: cells.reduce(
        (sum, cell) => sum + cell.biomass.oedogonium,
        0,
      ),
      turnover,
    };
  };

  it('makes nutrient and carbon limitation reduce standing algae instead of only pausing growth', () => {
    const supplied = isolatedProducerRun(1, 1);
    const depleted = isolatedProducerRun(0, 1);

    expect(supplied.biomass).toBeGreaterThan(0.4);
    expect(depleted.biomass).toBeLessThan(0.4);
    expect(depleted.turnover).toBeGreaterThan(0);
  });

  it('lets turbidity push an otherwise bright attached film below compensation', () => {
    const clear = isolatedProducerRun(1, 1);
    const turbid = isolatedProducerRun(1, 0.05);

    expect(clear.biomass).toBeGreaterThan(0.4);
    expect(turbid.biomass).toBeLessThan(0.4);
    expect(turbid.biomass).toBeLessThan(clear.biomass);
    expect(turbid.turnover).toBeGreaterThan(0);
  });

  it('turns oxygen-unfunded maintenance into tissue loss and detrital turnover', () => {
    const oxygenated = isolatedProducerRun(0, 0, 1);
    const anoxic = isolatedProducerRun(0, 0, 0);

    expect(anoxic.biomass).toBeCloseTo(oxygenated.biomass, 10);
    expect(anoxic.turnover).toBeGreaterThan(oxygenated.turnover);
  });

  it('shares finite producer resources independently of species iteration order', () => {
    const run = (allowedSpecies: SpeciesId[]) => {
      const world = new SimulationWorld('mission-5');
      const internals = debugWorld(world);
      internals.scenario = { ...internals.scenario, allowedSpecies };
      const cells = internals.allCells();
      for (const cell of cells) {
        cell.light = 45;
        cell.biomass = { oedogonium: 0, nitzschia: 0, vallisneria: 0 };
      }
      const source = cells[Math.floor(cells.length / 2)]!;
      source.biomass.oedogonium = 0.2;
      source.biomass.nitzschia = 0.2;
      let availableProduction = 0.0001;
      internals.biogeochemistry.commitAlgaeProduction = (
        _point,
        requestedBiomass,
      ) => {
        const committed = Math.min(availableProduction, requestedBiomass);
        availableProduction -= committed;
        return committed;
      };

      internals.stepGrowth(1);
      return cells.reduce(
        (totals, cell) => ({
          oedogonium: totals.oedogonium + cell.biomass.oedogonium,
          nitzschia: totals.nitzschia + cell.biomass.nitzschia,
        }),
        { oedogonium: 0, nitzschia: 0 },
      );
    };

    const forward = run(['oedogonium', 'nitzschia']);
    const reverse = run(['nitzschia', 'oedogonium']);

    expect(reverse.oedogonium).toBeCloseTo(forward.oedogonium, 10);
    expect(reverse.nitzschia).toBeCloseTo(forward.nitzschia, 10);
  });

  it('moves propagules without creating algae mass during dispersal', () => {
    const world = new SimulationWorld('mission-1');
    const internals = debugWorld(world);
    const cells = internals.allCells();
    for (const cell of cells) {
      cell.light = 45;
      cell.biomass = { oedogonium: 0, nitzschia: 0, vallisneria: 0 };
    }
    const source = cells[Math.floor(cells.length / 2)];
    const initialBiomass = 0.28;
    source.biomass.oedogonium = initialBiomass;
    internals.biogeochemistry.algaeResourceFactor = () => 1;
    internals.biogeochemistry.algaeLightTransmissionAt = () => 1;
    internals.biogeochemistry.commitAlgaeProduction = (
      _point,
      requestedBiomass,
    ) => requestedBiomass;
    internals.biogeochemistry.commitAlgaeRespiration = (
      _point,
      requestedBiomass,
    ) => requestedBiomass;

    internals.stepGrowth(1);

    const temperature = initialWaterTemperatureForLight(SCENARIOS['mission-1'].lightOutput);
    const rates = algaePhysiology('oedogonium', 45, temperature);
    const backgroundCapacity = SCENARIOS['mission-1'].backgroundProducerCapacity;
    const backgroundNutrientFactor = backgroundCapacity === null
      ? 1
      : 1 - initialBiomass / backgroundCapacity;
    const resourceAdjustedGross =
      rates.grossPhotosynthesis * backgroundNutrientFactor;
    const resourceAdjustedNet = resourceAdjustedGross - rates.respiration -
      rates.lightStressTurnover;
    const freeCapacity = 1 - initialBiomass;
    const densityAdjustedGross = resourceAdjustedNet > 0
      ? rates.respiration + rates.lightStressTurnover +
        resourceAdjustedNet * freeCapacity
      : resourceAdjustedGross;
    const expectedBiomass = initialBiomass +
      initialBiomass * densityAdjustedGross -
      initialBiomass * rates.respiration -
      initialBiomass * rates.lightStressTurnover -
      initialBiomass * SPECIES.oedogonium.naturalTurnoverPerSecond *
        producerProcessRateScale('oedogonium');
    const actualBiomass = cells.reduce(
      (sum, cell) => sum + cell.biomass.oedogonium,
      0,
    );

    expect(actualBiomass).toBeCloseTo(expectedBiomass, 8);
    expect(cells.some((cell) => cell.id !== source.id && cell.biomass.oedogonium > 0)).toBe(true);
  });

  it('creates a local and tank-wide algae deficit when shrimp graze a player-seeded tank', () => {
    const control = new SimulationWorld('mission-4');
    const grazed = new SimulationWorld('mission-4');
    seedDistributedAlgae(control);
    const foodPoints = seedDistributedAlgae(grazed);
    placeFourShrimp(grazed, foodPoints);
    control.handle({ type: 'start' });
    grazed.handle({ type: 'start' });

    const controlAt60 = advanceTo(control, 60);
    const grazedAt60 = advanceTo(grazed, 60);
    const controlAlgae = totalAlgae(controlAt60);
    const grazedAlgae = totalAlgae(grazedAt60);
    const algaeDeficit = controlAlgae - grazedAlgae;

    expect(grazedAt60.totalAlgaeConsumed).toBeGreaterThan(0);
    expect(algaeDeficit).toBeGreaterThan(0);
    const controlCells = new Map(controlAt60.cells.map((cell) => [cell.id, cell]));
    expect(grazedAt60.cells.some((cell) => {
      const controlCell = controlCells.get(cell.id);
      if (!controlCell) return false;
      const controlAmount =
        controlCell.biomass.oedogonium + controlCell.biomass.nitzschia;
      const grazedAmount = cell.biomass.oedogonium + cell.biomass.nitzschia;
      return controlAmount - grazedAmount > 0.01;
    })).toBe(true);
    expect(
      grazedAt60.animals.reduce(
        (sum, animal) => sum + animal.consumedBiomass,
        0,
      ),
    ).toBeCloseTo(grazedAt60.totalAlgaeConsumed, 5);
  }, 30_000);

  it('lets food established through normal inoculation fund real offspring', () => {
    const world = new SimulationWorld('laboratory');
    const foodPoints = seedDistributedAlgae(world);
    world.handle({ type: 'start' });
    world.handle({ type: 'set-speed', speed: 64 });

    // Inoculation is a starter culture, not four adults' initial ration. Let
    // the ordinary light/resource model establish the film before stocking.
    let snapshot = advanceTo(world, 600);
    world.handle({ type: 'pause' });
    placeFourShrimp(world, foodPoints);
    world.handle({ type: 'resume' });

    let maximumPopulation = 4;
    snapshot = world.snapshot();
    while (snapshot.elapsedSeconds < 2_400) {
      world.tick(0.1);
      snapshot = world.snapshot();
      maximumPopulation = Math.max(maximumPopulation, snapshot.animalPopulation[SHRIMP].total);
    }

    expect(SHRIMP_TECHNICAL_POPULATION_LIMIT).toBeGreaterThanOrEqual(1_000);
    expect(snapshot.animalPopulationEventTotals.births).toBeGreaterThan(0);
    expect(maximumPopulation).toBeGreaterThan(4);
    expect(snapshot.totalAlgaeConsumed).toBeGreaterThan(0);
  }, 30_000);

  it('grazes the spread colony rather than repeatedly returning only to inoculation cells', () => {
    const world = new SimulationWorld('laboratory');
    seedDistributedAlgae(world);
    const inoculationCellIds = new Set(
      debugWorld(world).seedPlacements.map((seed) => seed.cellId),
    );
    world.handle({ type: 'start' });
    advanceTo(world, 300);
    world.handle({ type: 'pause' });
    placeFourShrimp(world);
    world.handle({ type: 'resume' });
    world.handle({ type: 'set-speed', speed: 16 });

    const grazingObservations = new Map<string, number>();
    const endTime = world.snapshot().elapsedSeconds + 180;
    while (world.snapshot().elapsedSeconds < endTime) {
      world.tick(0.05);
      for (const animal of debugWorld(world).animals) {
        if (animal.behavior !== 'grazing' || !animal.targetCellId) continue;
        grazingObservations.set(
          animal.targetCellId,
          (grazingObservations.get(animal.targetCellId) ?? 0) + 1,
        );
      }
    }

    const totalObservations = [...grazingObservations.values()]
      .reduce((sum, count) => sum + count, 0);
    const inoculationObservations = [...grazingObservations]
      .filter(([cellId]) => inoculationCellIds.has(cellId))
      .reduce((sum, [, count]) => sum + count, 0);
    // The inoculation cells still contain most of the real food after only
    // 300 seconds, so they should remain preferred. The behavioural contract
    // is that the thin, real spread is also edible and receives a meaningful
    // share of grazing instead of being a render-only effect. Requiring 20%
    // encoded the old trace cascade; at least 10% still demonstrates repeated
    // grazing away from the supplied cells without demanding tank-wide
    // dilution of the starter colonies.
    expect(totalObservations).toBeGreaterThanOrEqual(45);
    expect(grazingObservations.size).toBeGreaterThan(8);
    expect(inoculationObservations / totalObservations).toBeLessThan(0.9);
  }, 30_000);

  it('makes a player-grown food web outperform an otherwise identical empty tank', () => {
    const fed = new SimulationWorld('mission-4');
    const empty = new SimulationWorld('mission-4');
    const foodPoints = seedDistributedAlgae(fed);
    placeFourShrimp(fed, foodPoints);
    placeFourShrimp(empty, foodPoints);
    fed.handle({ type: 'start' });
    empty.handle({ type: 'start' });

    const fedAt110 = advanceTo(fed, 110);
    const emptyAt110 = advanceTo(empty, 110);

    expect(fedAt110.totalAlgaeConsumed).toBeGreaterThan(0);
    expect(emptyAt110.totalAlgaeConsumed).toBe(0);
    expect(fedAt110.animalPopulation[SHRIMP].total).toBeGreaterThan(
      emptyAt110.animalPopulation[SHRIMP].total,
    );
    expect(fedAt110.animals.some((animal) => animal.recentIntake > 0)).toBe(true);
  }, 30_000);
});
