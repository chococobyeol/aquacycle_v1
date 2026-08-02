import { SimulationWorld } from '../src/simulation/SimulationWorld';
import type {
  MicrobeGuildId,
  ScenarioId,
  SpeciesId,
  StructureDefinitionId,
  SurfaceCellSnapshot,
  Vec2,
} from '../src/simulation/types';

type Snapshot = ReturnType<SimulationWorld['snapshot']>;

const SAMPLE_SECONDS = 300;
const PRODUCER_RUN_SECONDS = 7_200;
const FOOD_WEB_RUN_SECONDS = 10_800;
const verbose = process.argv.includes('--verbose');
const requestedScenario = process.argv
  .find((argument) => argument.startsWith('--scenario='))
  ?.slice('--scenario='.length) as ScenarioId | undefined;
const requestedDuration = Number(
  process.argv
    .find((argument) => argument.startsWith('--duration='))
    ?.slice('--duration='.length),
);
const requestedShrimpCountArgument = process.argv
  .find((argument) => argument.startsWith('--shrimp-count='))
  ?.slice('--shrimp-count='.length);
const requestedShrimpCount = requestedShrimpCountArgument === undefined
  ? 4
  : Math.max(0, Math.floor(Number(requestedShrimpCountArgument)));
const sterileShrimp = process.argv.includes('--sterile-shrimp');
const durationOr = (fallback: number): number =>
  Number.isFinite(requestedDuration) && requestedDuration > 0
    ? requestedDuration
    : fallback;

const placeStructure = (
  world: SimulationWorld,
  definitionId: StructureDefinitionId,
  point: Vec2,
): void => {
  world.handle({ type: 'pick-structure', definitionId, point });
  world.handle({ type: 'drop-held', point });
  for (let frame = 0; frame < 720; frame += 1) world.tick(1 / 60);
};

const placeSeed = (
  world: SimulationWorld,
  speciesId: SpeciesId,
  point: Vec2,
): void => {
  world.handle({ type: 'pick-seed', speciesId, point });
  world.handle({ type: 'drop-held', point });
};

const placeShrimp = (world: SimulationWorld, point: Vec2): void => {
  world.handle({ type: 'pick-animal', speciesId: 'cherry-shrimp', point });
  world.handle({ type: 'drop-held', point });
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
    .sort((left, right) => (
      Math.abs(left.x - targetX) / 25 + Math.abs(left.light - targetLight)
    ) - (
      Math.abs(right.x - targetX) / 25 + Math.abs(right.light - targetLight)
    ))[0];
  if (!cell) throw new Error('mission 1-5 ecology fixture needs another surface cell');
  used.add(cell.id);
  return cell;
};

const seedProducerMission = (
  world: SimulationWorld,
  scenarioId: 'mission-1' | 'mission-2' | 'mission-3',
): void => {
  const speciesId = scenarioId === 'mission-2' ? 'nitzschia' : 'oedogonium';
  if (scenarioId === 'mission-1') {
    placeStructure(world, 'flat-stone', { x: 600, y: 390 });
    const faces = world.snapshot().cells.filter(
      (cell) => cell.surfaceKind === 'structure-face',
    );
    const used = new Set<string>();
    placeSeed(
      world,
      speciesId,
      nearestUnusedCell(faces, 600, speciesId === 'nitzschia' ? 38 : 68, used),
    );
    return;
  }
  const substrate = world.snapshot().cells.filter(
    (cell) => cell.surfaceKind === 'substrate',
  );
  const used = new Set<string>();
  for (const x of [390, 810]) {
    placeSeed(
      world,
      speciesId,
      nearestUnusedCell(
        substrate,
        x,
        speciesId === 'nitzschia' ? 38 : 68,
        used,
      ),
    );
  }
};

const seedShrimpMission = (world: SimulationWorld, closedCycle: boolean): void => {
  placeStructure(world, 'flat-stone', { x: 480, y: 420 });
  placeStructure(world, 'tall-stone', { x: 860, y: 320 });
  const cells = world.snapshot().cells;
  const used = new Set<string>();
  for (const x of [260, 470, 730, 940]) {
    placeSeed(world, 'nitzschia', nearestUnusedCell(cells, x, 38, used));
    placeSeed(world, 'oedogonium', nearestUnusedCell(cells, x + 24, 68, used));
  }
  const shrimpReleasePoints = [290, 430, 770, 910];
  for (
    let index = 0;
    index < Math.min(requestedShrimpCount, shrimpReleasePoints.length);
    index += 1
  ) {
    const x = shrimpReleasePoints[index % shrimpReleasePoints.length] +
      Math.floor(index / shrimpReleasePoints.length) * 12;
    placeShrimp(world, { x, y: 600 });
  }
  if (
    requestedShrimpCount > shrimpReleasePoints.length ||
    (sterileShrimp && requestedShrimpCount > 0)
  ) {
    const save = world.exportSaveData();
    const templates = [...save.animals];
    for (
      let index = save.animals.length;
      index < requestedShrimpCount;
      index += 1
    ) {
      const template = templates[index % templates.length];
      save.animals.push({
        ...template,
        id: `diagnostic-shrimp-${index + 1}`,
        position: {
          x: shrimpReleasePoints[index % shrimpReleasePoints.length] +
            Math.floor(index / shrimpReleasePoints.length) * 12,
          y: 600,
        },
        randomSeed: template.randomSeed + index * 0.017,
      });
    }
    for (const animal of save.animals) {
      if (sterileShrimp && animal.speciesId === 'cherry-shrimp') {
        animal.sex = 'male';
      }
    }
    world.loadSaveData(save);
  }
  if (!closedCycle) return;
  const filmCells = cells.filter(
    (cell) => cell.surfaceKind === 'substrate',
  );
  for (let index = 0; index < 8; index += 1) {
    placeFilm(world, 'decomposer', filmCells[index * 2]);
    placeFilm(world, 'nitrifier', filmCells[index * 2 + 1]);
  }
};

const run = (
  scenarioId: ScenarioId,
  durationSeconds: number,
  populate: (world: SimulationWorld) => void,
): {
  world: SimulationWorld;
  samples: Snapshot[];
  shrimpMatterTrace: {
    time: number;
    meanStored: number;
    maximumReproductive: number;
    maximumOvarianProgress: number;
    gestating: number;
  }[];
} => {
  const world = new SimulationWorld(scenarioId);
  populate(world);
  world.handle({ type: 'start' });
  world.handle({ type: 'set-speed', speed: 64 });
  const samples: Snapshot[] = [world.snapshot()];
  const shrimpMatterTrace: {
    time: number;
    meanStored: number;
    maximumReproductive: number;
    maximumOvarianProgress: number;
    gestating: number;
  }[] = [];
  const recordShrimpMatter = (): void => {
    const shrimp = world.exportSaveData().animals.filter(
      (animal) => animal.speciesId === 'cherry-shrimp',
    );
    shrimpMatterTrace.push({
      time: samples.at(-1)!.elapsedSeconds,
      meanStored: shrimp.length === 0
        ? 0
        : shrimp.reduce((sum, animal) => sum + animal.storedBiomass, 0) /
          shrimp.length,
      maximumReproductive: Math.max(
        0,
        ...shrimp.map((animal) => animal.reproductiveBiomass),
      ),
      maximumOvarianProgress: Math.max(
        0,
        ...shrimp.map((animal) => animal.ovarianProgress ?? 0),
      ),
      gestating: shrimp.filter(
        (animal) => animal.gestationRemaining !== null,
      ).length,
    });
  };
  recordShrimpMatter();
  let nextSample = SAMPLE_SECONDS;
  while (samples.at(-1)!.elapsedSeconds < durationSeconds) {
    const shouldPublish = world.tick(0.1);
    // Match the Electron worker: a full state is materialised whenever the
    // world's publication cadence requests one. A verification path that
    // snapshots only at coarse report samples can otherwise hide accidental
    // read-side effects.
    if (shouldPublish) world.snapshot();
    const elapsedSeconds = (
      world as unknown as { elapsedSeconds: number }
    ).elapsedSeconds;
    if (elapsedSeconds < nextSample) continue;
    samples.push(world.snapshot());
    recordShrimpMatter();
    nextSample += SAMPLE_SECONDS;
  }
  return { world, samples, shrimpMatterTrace };
};

const range = (values: number[]): { minimum: number; maximum: number } => ({
  minimum: Math.min(...values),
  maximum: Math.max(...values),
});

const logSlopePerHour = (samples: { time: number; value: number }[]): number => {
  const valid = samples.filter((sample) => sample.value > 0);
  if (valid.length < 2) return Number.NEGATIVE_INFINITY;
  const meanTime = valid.reduce((sum, sample) => sum + sample.time, 0) /
    valid.length;
  const meanLog = valid.reduce(
    (sum, sample) => sum + Math.log(sample.value),
    0,
  ) / valid.length;
  let numerator = 0;
  let denominator = 0;
  for (const sample of valid) {
    const centeredTime = sample.time - meanTime;
    numerator += centeredTime * (Math.log(sample.value) - meanLog);
    denominator += centeredTime * centeredTime;
  }
  return denominator <= 0 ? 0 : numerator / denominator * 3_600;
};

const reports: unknown[] = [];

for (const scenarioId of ['mission-1', 'mission-2', 'mission-3'] as const) {
  if (requestedScenario && requestedScenario !== scenarioId) continue;
  const speciesId = scenarioId === 'mission-2' ? 'nitzschia' : 'oedogonium';
  const { samples } = run(
    scenarioId,
    durationOr(PRODUCER_RUN_SECONDS),
    (world) => seedProducerMission(world, scenarioId),
  );
  const biomass = samples.map((sample) => sample.totalBiomass[speciesId]);
  const tail = samples.slice(-Math.max(4, Math.floor(samples.length / 3)));
  reports.push({
    scenarioId,
    speciesId,
    initialBiomass: biomass[0],
    finalBiomass: biomass.at(-1),
    range: range(biomass),
    tailLogSlopePerHour: logSlopePerHour(tail.map((sample) => ({
      time: sample.elapsedSeconds,
      value: sample.totalBiomass[speciesId],
    }))),
  });
}

for (const scenarioId of ['mission-4', 'mission-5'] as const) {
  if (requestedScenario && requestedScenario !== scenarioId) continue;
  const { world, samples, shrimpMatterTrace } = run(
    scenarioId,
    durationOr(FOOD_WEB_RUN_SECONDS),
    (target) => seedShrimpMission(target, scenarioId === 'mission-5'),
  );
  const tail = samples.slice(-Math.max(6, Math.floor(samples.length / 3)));
  const populations = samples.map(
    (sample) => sample.animalPopulation['cherry-shrimp'].total,
  );
  const producerBiomass = samples.map(
    (sample) =>
      sample.totalBiomass.oedogonium + sample.totalBiomass.nitzschia,
  );
  const final = samples.at(-1)!;
  const livingShrimp = world.exportSaveData().animals.filter(
    (animal) => animal.speciesId === 'cherry-shrimp',
  );
  const events = final.animalPopulationEvents.filter(
    (event) => event.speciesId === 'cherry-shrimp',
  );
  const bornShrimp = livingShrimp.filter((animal) => animal.origin === 'born');
  const bornStructures = bornShrimp.map(
    (animal) => animal.structuralBiomass,
  );
  const finalCellsById = new Map(
    final.cells.map((cell) => [cell.id, cell] as const),
  );
  const cellFood = final.cells.map(
    (cell) =>
      cell.biomass.nitzschia +
      cell.biomass.oedogonium +
      cell.biofilm.decomposer +
      cell.biofilm.nitrifier,
  );
  const targetFood = bornShrimp.map((animal) => {
    const cell = animal.targetCellId
      ? finalCellsById.get(animal.targetCellId)
      : undefined;
    return cell
      ? cell.biomass.nitzschia +
          cell.biomass.oedogonium +
          cell.biofilm.decomposer +
          cell.biofilm.nitrifier
      : 0;
  });
  const deathCauses: Record<string, number> = {};
  for (const event of events) {
    if (event.kind !== 'death') continue;
    const cause = event.cause ?? 'unknown';
    deathCauses[cause] = (deathCauses[cause] ?? 0) + 1;
  }
  reports.push({
    scenarioId,
    fixture: {
      shrimpCount: requestedShrimpCount,
      reproductionEnabled: !sterileShrimp,
    },
    population: {
      final: populations.at(-1),
      range: range(populations),
      tailRange: range(tail.map(
        (sample) => sample.animalPopulation['cherry-shrimp'].total,
      )),
      tailLogSlopePerHour: logSlopePerHour(tail.map((sample) => ({
        time: sample.elapsedSeconds,
        value: sample.animalPopulation['cherry-shrimp'].total,
      }))),
      births: final.animalPopulationEventTotals.births,
      maturations: final.animalPopulationEventTotals.maturations,
      deaths: deathCauses,
      livingBorn: livingShrimp.filter((animal) => animal.origin === 'born').length,
      adultFemales: final.animalPopulation['cherry-shrimp'].adultFemales,
      adultMales: final.animalPopulation['cherry-shrimp'].adultMales,
      meanEnergy: livingShrimp.length === 0
        ? 0
        : livingShrimp.reduce((sum, animal) => sum + animal.energy, 0) /
          livingShrimp.length,
      meanConsumedBiomass: livingShrimp.length === 0
        ? 0
        : livingShrimp.reduce(
          (sum, animal) => sum + animal.consumedBiomass,
          0,
        ) / livingShrimp.length,
      bornStructure: bornStructures.length === 0
        ? null
        : {
          minimum: Math.min(...bornStructures),
          mean: bornStructures.reduce((sum, value) => sum + value, 0) /
            bornStructures.length,
          maximum: Math.max(...bornStructures),
        },
      maturationTimes: events
        .filter((event) => event.kind === 'matured')
        .map((event) => event.elapsedSeconds),
      foodField: {
        maximumCellFood: Math.max(0, ...cellFood),
        cellsAbove002: cellFood.filter((value) => value >= 0.02).length,
        cellsAbove005: cellFood.filter((value) => value >= 0.05).length,
        juvenileTargetFood: targetFood.length === 0
          ? null
          : {
            minimum: Math.min(...targetFood),
            mean: targetFood.reduce((sum, value) => sum + value, 0) /
              targetFood.length,
            maximum: Math.max(...targetFood),
          },
      },
      ...(verbose
        ? {
          individuals: livingShrimp.map((animal) => ({
            id: animal.id,
            generation: animal.generation ?? 0,
            stage: animal.lifeStage,
            sex: animal.sex,
            age: animal.ageSeconds,
            lifespan: animal.lifespanSeconds,
            energy: animal.energy,
            structure: animal.structuralBiomass,
            growth: animal.growthProgress,
            consumed: animal.consumedBiomass,
            stored: animal.storedBiomass,
            reproductive: animal.reproductiveBiomass,
            ovarianProgress: animal.ovarianProgress ?? 0,
            gestationRemaining: animal.gestationRemaining,
            reproductionCooldown: animal.reproductionCooldown,
            x: animal.position.x,
            y: animal.position.y,
          })),
          feedingTrace: samples.map((sample) => {
            const shrimp = sample.animals.filter(
              (animal) => animal.speciesId === 'cherry-shrimp',
            );
            return {
              time: sample.elapsedSeconds,
              count: shrimp.length,
              meanEnergy: shrimp.length === 0
                ? 0
                : shrimp.reduce((sum, animal) => sum + animal.energy, 0) /
                  shrimp.length,
              meanConsumed: shrimp.length === 0
                ? 0
                : shrimp.reduce(
                  (sum, animal) => sum + animal.consumedBiomass,
                  0,
                ) / shrimp.length,
              maximumConsumed: Math.max(
                0,
                ...shrimp.map((animal) => animal.consumedBiomass),
              ),
              maximumFoodGap: Math.max(
                0,
                ...shrimp.map((animal) => animal.secondsSinceFood),
              ),
            };
          }),
          lineageTrace: samples.map((sample) => {
            const shrimp = sample.animals.filter(
              (animal) => animal.speciesId === 'cherry-shrimp',
            );
            return {
              time: sample.elapsedSeconds,
              total: shrimp.length,
              juveniles: shrimp.filter(
                (animal) => animal.lifeStage === 'juvenile',
              ).length,
              adultFemales: shrimp.filter(
                (animal) =>
                  animal.lifeStage === 'adult' &&
                  animal.sex === 'female',
              ).length,
              adultMales: shrimp.filter(
                (animal) =>
                  animal.lifeStage === 'adult' &&
                  animal.sex === 'male',
              ).length,
              maximumGeneration: Math.max(
                0,
                ...shrimp.map((animal) => animal.generation ?? 0),
              ),
              juvenileStates: shrimp
                .filter((animal) => animal.lifeStage === 'juvenile')
                .map((animal) => ({
                  id: animal.id,
                  generation: animal.generation ?? 0,
                  age: animal.ageSeconds,
                  lifespan: animal.lifespanSeconds,
                  x: animal.x,
                  y: animal.y,
                  behavior: animal.behavior,
                  recentFood: animal.recentFood,
                  secondsSinceFood: animal.secondsSinceFood,
                  structure: animal.structuralBiomass,
                  growth: animal.growthProgress,
                  energy: animal.energy,
                  consumed: animal.consumedBiomass,
                  stored: animal.storedBiomass,
                })),
              adultStates: shrimp
                .filter((animal) => animal.lifeStage === 'adult')
                .map((animal) => ({
                  id: animal.id,
                  generation: animal.generation ?? 0,
                  sex: animal.sex,
                  age: animal.ageSeconds,
                  lifespan: animal.lifespanSeconds,
                  x: animal.x,
                  y: animal.y,
                  behavior: animal.behavior,
                  recentFood: animal.recentFood,
                  secondsSinceFood: animal.secondsSinceFood,
                  energy: animal.energy,
                  consumed: animal.consumedBiomass,
                  stored: animal.storedBiomass,
                  reproductive: animal.reproductiveBiomass,
                  ovarianProgress: animal.ovarianProgress ?? 0,
                  gestationRemaining: animal.gestationRemaining,
                })),
            };
          }),
          events: events.map((event) => ({
            time: event.elapsedSeconds,
            kind: event.kind,
            id: event.animalId,
            parentId: event.parentId,
            generation: event.generation ?? 0,
            stage: event.lifeStage,
            sex: event.sex,
            cause: event.cause,
          })),
          matterTrace: shrimpMatterTrace,
          producerTrace: samples.map((sample) => ({
            time: sample.elapsedSeconds,
            oedogonium: sample.totalBiomass.oedogonium,
            nitzschia: sample.totalBiomass.nitzschia,
            total:
              sample.totalBiomass.oedogonium +
              sample.totalBiomass.nitzschia,
          })),
        }
        : {}),
    },
    producers: {
      initial: producerBiomass[0],
      final: producerBiomass.at(-1),
      range: range(producerBiomass),
      consumedByShrimp: final.totalAlgaeConsumed,
      // final = initial + producer net production - grazing. Rearranging
      // isolates photosynthetic growth minus producer respiration/natural
      // loss without changing either side of the model for the diagnostic.
      netProductionBeforeGrazing:
        producerBiomass.at(-1)! - producerBiomass[0] +
        final.totalAlgaeConsumed,
      netProductionPerMinuteBeforeGrazing: (
        producerBiomass.at(-1)! - producerBiomass[0] +
        final.totalAlgaeConsumed
      ) / Math.max(1, final.elapsedSeconds / 60),
      tailLogSlopePerHour: logSlopePerHour(tail.map((sample) => ({
        time: sample.elapsedSeconds,
        value: sample.totalBiomass.oedogonium +
          sample.totalBiomass.nitzschia,
      }))),
    },
    water: {
      oxygen: range(samples.map(
        (sample) => sample.biogeochemistry.average.oxygen,
      )),
      toxicWaste: range(samples.map(
        (sample) => sample.biogeochemistry.average.toxicWaste,
      )),
      decomposerFinal: final.biogeochemistry.biofilmTotals.decomposer,
      nitrifierFinal: final.biogeochemistry.biofilmTotals.nitrifier,
      nitrogenDrift: final.biogeochemistry.materialBalance.nitrogenDriftRatio,
      carbonDrift: final.biogeochemistry.materialBalance.carbonDriftRatio,
    },
  });
}

console.log(JSON.stringify(reports, null, 2));
