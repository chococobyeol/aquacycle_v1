import { SimulationWorld } from '../src/simulation/SimulationWorld';
import {
  MICROBE_ECOLOGY_RULES,
  SCENARIOS,
  SHRIMP_ECOLOGY_RULES,
  SURFACE_ALGAE_INOCULUM_BIOMASS,
  WATER_CYCLE_RULES,
} from '../src/simulation/config';
import type {
  AnimalSnapshot,
  MicrobeGuildId,
  SpeciesId,
  StructureDefinitionId,
  SurfaceCellSnapshot,
  Vec2,
} from '../src/simulation/types';

const releaseAt = Number(
  process.argv.find((argument) => argument.startsWith('--release-at='))
    ?.slice('--release-at='.length) ?? 600,
);
const duration = Number(
  process.argv.find((argument) => argument.startsWith('--duration='))
    ?.slice('--duration='.length) ?? 3_600,
);
const shrimpCount = Number(
  process.argv.find((argument) => argument.startsWith('--shrimp-count='))
    ?.slice('--shrimp-count='.length) ?? 4,
);
const seedPairs = Number(
  process.argv.find((argument) => argument.startsWith('--seed-pairs='))
    ?.slice('--seed-pairs='.length) ?? 8,
);
const microbeDoses = Number(
  process.argv.find((argument) => argument.startsWith('--microbe-doses='))
    ?.slice('--microbe-doses='.length) ?? 4,
);
const decomposerDoses = Number(
  process.argv.find((argument) => argument.startsWith('--decomposer-doses='))
    ?.slice('--decomposer-doses='.length) ?? microbeDoses,
);
const nitrifierDoses = Number(
  process.argv.find((argument) => argument.startsWith('--nitrifier-doses='))
    ?.slice('--nitrifier-doses='.length) ?? microbeDoses,
);
const verifyMode = process.argv.includes('--verify');
const verifySimultaneousMode = process.argv.includes('--verify-simultaneous');
const verifyWithoutMicrobesMode = process.argv.includes('--verify-without-microbes');
const compactMode = process.argv.includes('--compact');
const summaryMode = process.argv.includes('--summary');
const progressMode = process.argv.includes('--progress');
const sampleEvery = Number(
  process.argv.find((argument) => argument.startsWith('--sample-every='))
    ?.slice('--sample-every='.length) ?? 300,
);
const runSeed = Number(
  process.argv.find((argument) => argument.startsWith('--run-seed='))
    ?.slice('--run-seed='.length) ?? 0,
);
const nutrientHalfSaturationOverride = Number(
  process.argv.find((argument) =>
    argument.startsWith('--nutrient-half-saturation='),
  )?.slice('--nutrient-half-saturation='.length) ?? Number.NaN,
);
const resourceScale = Number(
  process.argv.find((argument) => argument.startsWith('--resource-scale='))
    ?.slice('--resource-scale='.length) ?? 1,
);
const initialNutrientsOverride = Number(
  process.argv.find((argument) => argument.startsWith('--initial-nutrients='))
    ?.slice('--initial-nutrients='.length) ?? Number.NaN,
);
const shrimpFeedingMassExponentOverride = Number(
  process.argv.find((argument) =>
    argument.startsWith('--shrimp-feeding-mass-exponent='),
  )?.slice('--shrimp-feeding-mass-exponent='.length) ?? Number.NaN,
);
const shrimpMetabolicMassExponentOverride = Number(
  process.argv.find((argument) =>
    argument.startsWith('--shrimp-metabolic-mass-exponent='),
  )?.slice('--shrimp-metabolic-mass-exponent='.length) ?? Number.NaN,
);
const shrimpReproductivePaceScale = Number(
  process.argv.find((argument) =>
    argument.startsWith('--shrimp-reproductive-pace-scale='),
  )?.slice('--shrimp-reproductive-pace-scale='.length) ?? 1,
);
const shrimpMaturationPaceScale = Number(
  process.argv.find((argument) =>
    argument.startsWith('--shrimp-maturation-pace-scale='),
  )?.slice('--shrimp-maturation-pace-scale='.length) ?? 1,
);
const shrimpGrazingHalfSaturationOverride = Number(
  process.argv.find((argument) =>
    argument.startsWith('--shrimp-grazing-half-saturation='),
  )?.slice('--shrimp-grazing-half-saturation='.length) ?? Number.NaN,
);
const nitrifierSurfaceSpreadOverride = Number(
  process.argv.find((argument) =>
    argument.startsWith('--nitrifier-surface-spread='),
  )?.slice('--nitrifier-surface-spread='.length) ?? Number.NaN,
);
const nitrifierStarvationDecayOverride = Number(
  process.argv.find((argument) =>
    argument.startsWith('--nitrifier-starvation-decay='),
  )?.slice('--nitrifier-starvation-decay='.length) ?? Number.NaN,
);

if (Number.isFinite(nutrientHalfSaturationOverride)) {
  // Diagnostic-only parameter sweep. The production implementation still
  // reads the ordinary shared rule unless this explicit CLI flag is present.
  (WATER_CYCLE_RULES as unknown as { mineralNutrientHalfSaturation: number })
    .mineralNutrientHalfSaturation = nutrientHalfSaturationOverride;
}
if (Number.isFinite(nitrifierSurfaceSpreadOverride)) {
  if (nitrifierSurfaceSpreadOverride < 0) {
    throw new Error('--nitrifier-surface-spread must be at least 0');
  }
  // Diagnostic-only sweep. This lets us separate mass-conserving movement
  // across an attached surface from growth/decay changes.
  (MICROBE_ECOLOGY_RULES.nitrifier as unknown as {
    surfaceSpreadRate: number;
  }).surfaceSpreadRate = nitrifierSurfaceSpreadOverride;
}
if (Number.isFinite(nitrifierStarvationDecayOverride)) {
  if (nitrifierStarvationDecayOverride < 0) {
    throw new Error('--nitrifier-starvation-decay must be at least 0');
  }
  (MICROBE_ECOLOGY_RULES.nitrifier as unknown as {
    starvationDecayRate: number;
  }).starvationDecayRate = nitrifierStarvationDecayOverride;
}

if (!Number.isFinite(resourceScale) || resourceScale <= 0 || resourceScale > 1) {
  throw new Error('--resource-scale must be greater than 0 and at most 1');
}
if (resourceScale !== 1) {
  // Diagnostic-only additional whole-ledger sweep. Compose with the
  // scenario's ordinary scale so every finite starting C/N reservoir changes
  // together while oxygen and all biological rates remain untouched.
  const waterCycle = SCENARIOS['mission-5'].waterCycle!;
  waterCycle.initialMaterialScale =
    (waterCycle.initialMaterialScale ?? 1) * resourceScale;
}
if (Number.isFinite(initialNutrientsOverride)) {
  if (initialNutrientsOverride < 0) {
    throw new Error('--initial-nutrients must be at least 0');
  }
  SCENARIOS['mission-5'].waterCycle!.initial.nutrients =
    initialNutrientsOverride;
}
if (Number.isFinite(shrimpFeedingMassExponentOverride)) {
  if (
    shrimpFeedingMassExponentOverride <= 0 ||
    shrimpFeedingMassExponentOverride > 1
  ) {
    throw new Error(
      '--shrimp-feeding-mass-exponent must be greater than 0 and at most 1',
    );
  }
  // Diagnostic-only sweep of the continuous body-mass intake curve. This
  // does not introduce a juvenile stage multiplier or a population cap.
  (WATER_CYCLE_RULES.shrimp as unknown as { feedingMassExponent: number })
    .feedingMassExponent = shrimpFeedingMassExponentOverride;
}
if (Number.isFinite(shrimpMetabolicMassExponentOverride)) {
  if (
    shrimpMetabolicMassExponentOverride <= 0 ||
    shrimpMetabolicMassExponentOverride > 1
  ) {
    throw new Error(
      '--shrimp-metabolic-mass-exponent must be greater than 0 and at most 1',
    );
  }
  // Diagnostic-only sweep of the continuous body-mass maintenance curve.
  // A supplied 1-B adult is unchanged; only the relative cost across body
  // sizes changes, with no life-stage or population-count branch.
  (SHRIMP_ECOLOGY_RULES as unknown as { metabolicMassExponent: number })
    .metabolicMassExponent = shrimpMetabolicMassExponentOverride;
}
if (
  !Number.isFinite(shrimpReproductivePaceScale) ||
  shrimpReproductivePaceScale <= 0
) {
  throw new Error('--shrimp-reproductive-pace-scale must be greater than 0');
}
if (
  !Number.isFinite(shrimpMaturationPaceScale) ||
  shrimpMaturationPaceScale <= 0
) {
  throw new Error('--shrimp-maturation-pace-scale must be greater than 0');
}
if (shrimpMaturationPaceScale !== 1) {
  const mutableShrimpRules = SHRIMP_ECOLOGY_RULES as unknown as {
    maturationMinimumSeconds: number;
    maturationMaximumSeconds: number;
  };
  mutableShrimpRules.maturationMinimumSeconds *= shrimpMaturationPaceScale;
  mutableShrimpRules.maturationMaximumSeconds *= shrimpMaturationPaceScale;
}
if (shrimpReproductivePaceScale !== 1) {
  // Diagnostic-only sweep of one coherent reproductive time scale. The
  // conserved matter cost and clutch size do not change: ovarian readiness
  // takes proportionally longer and the same brood matter is transferred at
  // the matching slower rate. This separates damping of the consumer pulse
  // from carrying matter, population count, sex, and mission-specific rules.
  const mutableShrimpRules = SHRIMP_ECOLOGY_RULES as unknown as {
    ovarianCycleMinimumSeconds: number;
    ovarianCycleMaximumSeconds: number;
    ovarianAllocationPerSecond: number;
  };
  mutableShrimpRules.ovarianCycleMinimumSeconds *=
    shrimpReproductivePaceScale;
  mutableShrimpRules.ovarianCycleMaximumSeconds *=
    shrimpReproductivePaceScale;
  mutableShrimpRules.ovarianAllocationPerSecond /=
    shrimpReproductivePaceScale;
}
if (Number.isFinite(shrimpGrazingHalfSaturationOverride)) {
  if (shrimpGrazingHalfSaturationOverride <= 0) {
    throw new Error('--shrimp-grazing-half-saturation must be greater than 0');
  }
  // Diagnostic-only functional-response sweep. Positive food remains fully
  // edible and exact depletion remains possible; only the continuous intake
  // response to a thinning contacted film changes.
  (WATER_CYCLE_RULES.shrimp as unknown as {
    grazingHalfSaturationBiomass: number;
  }).grazingHalfSaturationBiomass = shrimpGrazingHalfSaturationOverride;
}

interface Mission5DiagnosticSample {
  time: number;
  outcome: string;
  population: number;
  generations: Record<string, number>;
  shrimp?: Array<{
    id: string;
    generation: number;
    stage: string;
    sex: string;
    age: number;
    lifespan: number;
    energy: number;
    foodGap: number;
    recentIntake: number;
    structure: number;
    store: number;
    reproductive: number;
    ovarian: number;
    clutch: number | null;
    mating: number;
    gestation: number | null;
    [key: string]: unknown;
  }>;
  algae: number;
  water: {
    ammonium: number;
    nutrients: number;
    organicMatter: number;
    oxygen: number;
    dissolvedInorganicCarbon: number;
  };
  decomposer: number;
  nitrifier: number;
  nitrifierSurface: {
    occupiedCells: number;
    establishedCells: number;
    maximumCellBiomass: number;
  };
  [key: string]: unknown;
}

const world = new SimulationWorld('mission-5', undefined, runSeed);
interface DiagnosticWorldInternals {
  allCells(): Array<{ biofilm: { nitrifier: number } }>;
  suspendedBiofilm: { nitrifier: number };
  stepAnimalEcology(deltaSeconds: number): void;
  stepBiofilmDispersal(deltaSeconds: number): void;
  resolveBiogeochemistry(deltaSeconds: number): void;
}
const diagnosticWorld = world as unknown as DiagnosticWorldInternals;
const nitrifierFluxTotals = {
  grazed: 0,
  dispersalMortality: 0,
  reactionNet: 0,
};
const totalNitrifierMass = (): number =>
  diagnosticWorld.allCells().reduce(
    (sum, cell) => sum + cell.biofilm.nitrifier,
    diagnosticWorld.suspendedBiofilm.nitrifier,
  );
const originalStepAnimalEcology =
  diagnosticWorld.stepAnimalEcology.bind(diagnosticWorld);
diagnosticWorld.stepAnimalEcology = (deltaSeconds) => {
  const before = totalNitrifierMass();
  originalStepAnimalEcology(deltaSeconds);
  nitrifierFluxTotals.grazed += Math.max(0, before - totalNitrifierMass());
};
const originalStepBiofilmDispersal =
  diagnosticWorld.stepBiofilmDispersal.bind(diagnosticWorld);
diagnosticWorld.stepBiofilmDispersal = (deltaSeconds) => {
  const before = totalNitrifierMass();
  originalStepBiofilmDispersal(deltaSeconds);
  nitrifierFluxTotals.dispersalMortality += Math.max(
    0,
    before - totalNitrifierMass(),
  );
};
const originalResolveBiogeochemistry =
  diagnosticWorld.resolveBiogeochemistry.bind(diagnosticWorld);
diagnosticWorld.resolveBiogeochemistry = (deltaSeconds) => {
  const before = totalNitrifierMass();
  originalResolveBiogeochemistry(deltaSeconds);
  nitrifierFluxTotals.reactionNet += totalNitrifierMass() - before;
};
const shrimpMatterFluxTotals = {
  consumed: 0,
  assimilated: 0,
  assimilationOverflow: 0,
  respired: 0,
};
const diagnosticLedger = (world as unknown as {
  biogeochemistry: {
    recordAnimalFeeding(
      point: Vec2,
      consumedBiomass: number,
      consumer?: 'shrimp' | 'ricefish',
      foodQuality?: number,
    ): number;
    recordAnimalAssimilationOverflow(point: Vec2, biomass: number): void;
    recordAnimalRespiration(point: Vec2, biomass: number): number;
  };
}).biogeochemistry;
const originalRecordAnimalFeeding =
  diagnosticLedger.recordAnimalFeeding.bind(diagnosticLedger);
diagnosticLedger.recordAnimalFeeding = (
  point,
  consumedBiomass,
  consumer = 'shrimp',
  foodQuality = 1,
) => {
  const assimilated = originalRecordAnimalFeeding(
    point,
    consumedBiomass,
    consumer,
    foodQuality,
  );
  if (consumer === 'shrimp') {
    shrimpMatterFluxTotals.consumed += consumedBiomass;
    shrimpMatterFluxTotals.assimilated += assimilated;
  }
  return assimilated;
};
const originalRecordAnimalAssimilationOverflow =
  diagnosticLedger.recordAnimalAssimilationOverflow.bind(diagnosticLedger);
diagnosticLedger.recordAnimalAssimilationOverflow = (point, biomass) => {
  shrimpMatterFluxTotals.assimilationOverflow += Math.max(0, biomass);
  originalRecordAnimalAssimilationOverflow(point, biomass);
};
const originalRecordAnimalRespiration =
  diagnosticLedger.recordAnimalRespiration.bind(diagnosticLedger);
diagnosticLedger.recordAnimalRespiration = (point, biomass) => {
  const respired = originalRecordAnimalRespiration(point, biomass);
  shrimpMatterFluxTotals.respired += respired;
  return respired;
};

const placeStructure = (definitionId: StructureDefinitionId, point: Vec2): void => {
  world.handle({ type: 'pick-structure', definitionId, point });
  world.handle({ type: 'drop-held', point });
  for (let frame = 0; frame < 720; frame += 1) world.tick(1 / 60);
};

const placeSeed = (speciesId: SpeciesId, point: Vec2): void => {
  world.handle({ type: 'pick-seed', speciesId, point });
  world.handle({ type: 'drop-held', point });
};

const placeFilm = (guildId: MicrobeGuildId, point: Vec2): void => {
  world.handle({ type: 'pick-biofilm', guildId, point });
  world.handle({ type: 'drop-held', point });
};

const nearestUnusedCell = (
  cells: SurfaceCellSnapshot[],
  targetX: number,
  targetLight: number,
  used: Set<string>,
): SurfaceCellSnapshot => {
  const available = cells.filter((candidate) => !used.has(candidate.id));
  const nearestXDistance = Math.min(
    ...available.map((candidate) => Math.abs(candidate.x - targetX)),
  );
  // Light suitability matters, but it must not pull every dose onto one
  // distant stone. First select surfaces in the intended horizontal patch,
  // then choose the best light inside that locally reachable band.
  const local = available.filter(
    (candidate) =>
      Math.abs(candidate.x - targetX) <= Math.max(70, nearestXDistance + 50),
  );
  const cell = local
    .sort((left, right) => (
      Math.abs(left.x - targetX) / 12 + Math.abs(left.light - targetLight)
    ) - (
      Math.abs(right.x - targetX) / 12 + Math.abs(right.light - targetLight)
    ))[0];
  if (!cell) throw new Error('mission 5 diagnostic needs another surface cell');
  used.add(cell.id);
  return cell;
};

const livingGenerationCounts = (animals: AnimalSnapshot[]): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const animal of animals) {
    if (animal.speciesId !== 'cherry-shrimp') continue;
    const generation = String(animal.generation ?? 0);
    counts[generation] = (counts[generation] ?? 0) + 1;
  }
  return counts;
};

placeStructure('flat-stone', { x: 480, y: 420 });
placeStructure('tall-stone', { x: 860, y: 320 });
const cells = world.snapshot().cells;
const used = new Set<string>();
const initialSeedPlacements: Array<{
  speciesId: SpeciesId;
  cellId: string;
  x: number;
  y: number;
  light: number;
  surfaceKind: string;
}> = [];
const initialNitzschiaCells: SurfaceCellSnapshot[] = [];
const initialOedogoniumCells: SurfaceCellSnapshot[] = [];
// Keep all eight pairs inside the illuminated working bed. Spreading doses
// uniformly across the full tank width placed the final pair at 11–14% light,
// where neither authored strain can establish, so the diagnostic silently
// tested six useful pairs plus two dying decorations. These points remain
// spatially separated while staying within the lamp-supported habitat.
const seedXs = [180, 260, 340, 420, 500, 580, 660, 740].slice(0, seedPairs);
for (const x of seedXs) {
  const nitzschiaCell = nearestUnusedCell(cells, x, 38, used);
  const oedogoniumCell = nearestUnusedCell(cells, x + 24, 68, used);
  placeSeed('nitzschia', nitzschiaCell);
  placeSeed('oedogonium', oedogoniumCell);
  initialNitzschiaCells.push(nitzschiaCell);
  initialOedogoniumCells.push(oedogoniumCell);
  initialSeedPlacements.push(
    {
      speciesId: 'nitzschia',
      cellId: nitzschiaCell.id,
      x: nitzschiaCell.x,
      y: nitzschiaCell.y,
      light: nitzschiaCell.light,
      surfaceKind: nitzschiaCell.surfaceKind,
    },
    {
      speciesId: 'oedogonium',
      cellId: oedogoniumCell.id,
      x: oedogoniumCell.x,
      y: oedogoniumCell.y,
      light: oedogoniumCell.light,
      surfaceKind: oedogoniumCell.surfaceKind,
    },
  );
}
const releasePairIndexes = initialNitzschiaCells.length >= 6
  ? [
    Math.floor(initialNitzschiaCells.length / 3),
    Math.floor(initialNitzschiaCells.length * 2 / 3),
  ]
  : [0, Math.max(0, initialNitzschiaCells.length - 1)];
const shrimpReleasePlacements = releasePairIndexes.flatMap((cellIndex) => {
  const femaleCell = initialNitzschiaCells[cellIndex]!;
  const maleCell = initialOedogoniumCells[cellIndex]!;
  const pairPoint = {
    x: (femaleCell.x + maleCell.x) / 2,
    y: Math.min(610, (femaleCell.y + maleCell.y) / 2 - 10),
  };
  return [
    {
      sex: 'female' as const,
      point: { x: pairPoint.x - 4, y: pairPoint.y },
    },
    {
      sex: 'male' as const,
      point: { x: pairPoint.x + 4, y: pairPoint.y },
    },
  ];
}).slice(0, shrimpCount);

world.handle({ type: 'start' });
world.handle({ type: 'set-speed', speed: 64 });

let decomposerAdded = false;
let released = false;
let nextSample = 0;
const samples: Mission5DiagnosticSample[] = [];
let snapshot = world.snapshot();
// At 64x, one accepted 0.1-real-second tick advances 6.4 simulated seconds.
// Snapshot construction copies the complete surface/water grids and every
// animal, so rebuilding it after every tick made long ecological diagnostics
// spend most of their time serializing state that was never sampled. Keep an
// estimated clock between the exact 300-second checkpoints. Do not round this
// clock back to the integer ecology time exposed by snapshots: its fractional
// remainder is the world's growth accumulator and is needed to hit the same
// checkpoints as the per-tick diagnostic.
const simulatedSecondsPerTick = 0.1 * 64;
let estimatedElapsedSeconds = snapshot.elapsedSeconds;

while (snapshot.elapsedSeconds < duration) {
  if (!decomposerAdded && snapshot.elapsedSeconds >= releaseAt / 2) {
    world.handle({ type: 'pause' });
    const surfaces = world.snapshot().cells;
    for (let index = 0; index < decomposerDoses; index += 1) {
      placeFilm('decomposer', surfaces[index * 2]!);
    }
    world.handle({ type: 'resume' });
    decomposerAdded = true;
  }
  if (!released && snapshot.elapsedSeconds >= releaseAt) {
    world.handle({ type: 'pause' });
    const surfaces = world.snapshot().cells;
    for (let index = 0; index < nitrifierDoses; index += 1) {
      placeFilm('nitrifier', surfaces[index * 2 + 1]!);
    }
    for (const placement of shrimpReleasePlacements) {
      world.handle({
        type: 'pick-animal',
        speciesId: 'cherry-shrimp',
        sex: placement.sex,
        point: placement.point,
      });
      world.handle({ type: 'drop-held', point: placement.point });
    }
    world.handle({ type: 'resume' });
    released = true;
  }

  const nextCheckpoint = Math.min(
    decomposerAdded ? Number.POSITIVE_INFINITY : releaseAt / 2,
    released ? Number.POSITIVE_INFINITY : releaseAt,
    nextSample,
    duration,
  );
  do {
    world.tick(0.1);
    estimatedElapsedSeconds += simulatedSecondsPerTick;
  } while (
    estimatedElapsedSeconds + 1e-9 < nextCheckpoint &&
    estimatedElapsedSeconds + 1e-9 < duration
  );
  snapshot = world.snapshot();
  if (snapshot.elapsedSeconds >= nextSample) {
    const savedShrimp = world.exportSaveData().animals.filter(
      (animal) => animal.speciesId === 'cherry-shrimp',
    );
    const attachedAlgaeByCell = snapshot.cells.map(
      (cell) => cell.biomass.oedogonium + cell.biomass.nitzschia,
    );
    const occupiedAlgaeCells = attachedAlgaeByCell.filter((amount) => amount > 0.001);
    const sampledCellById = new Map(snapshot.cells.map((cell) => [cell.id, cell]));
    const sample: Mission5DiagnosticSample = {
      time: Math.round(snapshot.elapsedSeconds),
      outcome: snapshot.outcome,
      population: snapshot.animalPopulation['cherry-shrimp'].total,
      generations: livingGenerationCounts(snapshot.animals),
      sexes: savedShrimp.reduce<Record<string, number>>((counts, animal) => {
        const key = `${animal.generation ?? 0}:${animal.sex}`;
        counts[key] = (counts[key] ?? 0) + 1;
        return counts;
      }, {}),
      algae: snapshot.totalBiomass.oedogonium + snapshot.totalBiomass.nitzschia,
      algaeSurface: {
        cells: snapshot.cells.length,
        occupied: occupiedAlgaeCells.length,
        grazeable: attachedAlgaeByCell.filter((amount) => amount >= 0.04).length,
        dense: attachedAlgaeByCell.filter((amount) => amount >= 0.2).length,
        meanOccupied: occupiedAlgaeCells.reduce((sum, amount) => sum + amount, 0) /
          Math.max(1, occupiedAlgaeCells.length),
        maximum: Math.max(0, ...attachedAlgaeByCell),
      },
      algaeConsumed: snapshot.totalAlgaeConsumed,
      algaeFlux: {
        gross: snapshot.biogeochemistry.algaeFluxes.grossProductionBiomassPerSecond,
        respiration: snapshot.biogeochemistry.algaeFluxes.respirationBiomassPerSecond,
        turnover: snapshot.biogeochemistry.algaeFluxes.stressTurnoverBiomassPerSecond,
        net: snapshot.biogeochemistry.algaeFluxes.grossProductionBiomassPerSecond -
          snapshot.biogeochemistry.algaeFluxes.respirationBiomassPerSecond -
          snapshot.biogeochemistry.algaeFluxes.stressTurnoverBiomassPerSecond,
      },
      water: {
        ammonium: snapshot.biogeochemistry.average.toxicWaste,
        nutrients: snapshot.biogeochemistry.average.nutrients,
        organicMatter: snapshot.biogeochemistry.average.organicMatter,
        oxygen: snapshot.biogeochemistry.average.oxygen,
        dissolvedInorganicCarbon:
          snapshot.biogeochemistry.carbonCycle.dissolvedInorganicCarbon,
      },
      shrimpBiomass: savedShrimp.reduce(
        (sum, animal) => sum + animal.structuralBiomass +
          animal.storedBiomass + (animal.reproductiveBiomass ?? 0),
        0,
      ),
      shrimp: savedShrimp.map((animal) => {
        const targetCell = animal.targetCellId
          ? sampledCellById.get(animal.targetCellId)
          : undefined;
        return ({
        id: animal.id,
        generation: animal.generation ?? 0,
        stage: animal.lifeStage,
        sex: animal.sex,
        age: Math.round(animal.ageSeconds),
        lifespan: Math.round(animal.lifespanSeconds),
        position: animal.position,
        behavior: animal.behavior,
        targetCellId: animal.targetCellId,
        targetFood: targetCell
          ? {
            nitzschia: targetCell.biomass.nitzschia,
            oedogonium: targetCell.biomass.oedogonium,
            decomposer: targetCell.biofilm.decomposer,
            nitrifier: targetCell.biofilm.nitrifier,
          }
          : null,
        energy: animal.energy,
        foodGap: animal.secondsSinceFood,
        consumed: animal.consumedBiomass,
        recentIntake: animal.recentIntake,
        structure: animal.structuralBiomass,
        store: animal.storedBiomass,
        maturationTarget: animal.maturationTargetSeconds ?? null,
        reproductive: animal.reproductiveBiomass ?? 0,
        ovarian: animal.ovarianProgress ?? 0,
        clutch: animal.ovarianClutchSize ?? null,
        mating: animal.matingAccumulator,
        gestation: animal.gestationRemaining,
      });
      }),
      decomposer: snapshot.biogeochemistry.biofilmTotals.decomposer,
      nitrifier: snapshot.biogeochemistry.biofilmTotals.nitrifier,
      nitrifierSurface: snapshot.cells.reduce(
        (distribution, cell) => {
          const biomass = cell.biofilm.nitrifier;
          if (biomass > 1e-6) distribution.occupiedCells += 1;
          if (biomass >= 0.01) distribution.establishedCells += 1;
          distribution.maximumCellBiomass = Math.max(
            distribution.maximumCellBiomass,
            biomass,
          );
          return distribution;
        },
        { occupiedCells: 0, establishedCells: 0, maximumCellBiomass: 0 },
      ),
      populationEvents: {
        births: snapshot.animalPopulationEventTotals.births,
        maturations: snapshot.animalPopulationEventTotals.maturations,
        deaths: snapshot.animalPopulationEventTotals.deaths,
        deathsByCause: {
          ...snapshot.animalPopulationEventTotals.deathsByCause,
        },
      },
      shrimpMatterFluxTotals: { ...shrimpMatterFluxTotals },
      progress: snapshot.missionProgress,
    };
    samples.push(sample);
    if (progressMode) {
      const shrimp = sample.shrimp ?? [];
      const adults = shrimp.filter((animal) => animal.stage === 'adult');
      console.error(JSON.stringify({
        time: sample.time,
        population: sample.population,
        generations: sample.generations,
        sexes: sample.sexes,
        adults: adults.length,
        juveniles: shrimp.length - adults.length,
        meanEnergy: shrimp.reduce(
          (sum, animal) => sum + animal.energy,
          0,
        ) / Math.max(1, shrimp.length),
        meanStore: shrimp.reduce(
          (sum, animal) => sum + animal.store,
          0,
        ) / Math.max(1, shrimp.length),
        meanRecentIntake: shrimp.reduce(
          (sum, animal) => sum + animal.recentIntake,
          0,
        ) / Math.max(1, shrimp.length),
        meanAdultEnergy: adults.reduce(
          (sum, animal) => sum + animal.energy,
          0,
        ) / Math.max(1, adults.length),
        meanAdultStore: adults.reduce(
          (sum, animal) => sum + animal.store,
          0,
        ) / Math.max(1, adults.length),
        meanAdultRecentIntake: adults.reduce(
          (sum, animal) => sum + animal.recentIntake,
          0,
        ) / Math.max(1, adults.length),
        ovarianReadyFemales: adults.filter(
          (animal) => animal.sex === 'female' && animal.ovarian >= 0.99,
        ).length,
        gestatingFemales: adults.filter(
          (animal) => animal.sex === 'female' && animal.gestation !== null,
        ).length,
        populationEvents: sample.populationEvents,
        lowCondition: shrimp.filter((animal) => animal.energy < 0.32).length,
        grazing: shrimp.filter((animal) => animal.behavior === 'grazing').length,
        algae: sample.algae,
        ammonium: sample.water.ammonium,
        nutrients: sample.water.nutrients,
        organicMatter: sample.water.organicMatter,
        decomposer: sample.decomposer,
        nitrifier: sample.nitrifier,
        nitrifierSurface: sample.nitrifierSurface,
      }));
    }
    nextSample += sampleEvery;
  }
}

const events = snapshot.animalPopulationEvents.filter(
  (event) => event.speciesId === 'cherry-shrimp',
);
const result = {
  releaseAt,
  runSeed,
  duration,
  shrimpCount,
  seedPairs,
  microbeDoses,
  decomposerDoses,
  nitrifierDoses,
  nitrifierSurfaceSpread: MICROBE_ECOLOGY_RULES.nitrifier.surfaceSpreadRate,
  nitrifierStarvationDecay:
    MICROBE_ECOLOGY_RULES.nitrifier.starvationDecayRate,
  nitrifierFluxTotals,
  initialSeedPlacements,
  shrimpReleasePlacements,
  nutrientHalfSaturation:
    WATER_CYCLE_RULES.mineralNutrientHalfSaturation,
  resourceScale,
  effectiveInitialMaterialScale:
    SCENARIOS['mission-5'].waterCycle!.initialMaterialScale ?? 1,
  initialNutrients: SCENARIOS['mission-5'].waterCycle!.initial.nutrients,
  shrimpFeedingMassExponent: WATER_CYCLE_RULES.shrimp.feedingMassExponent,
  shrimpMetabolicMassExponent: SHRIMP_ECOLOGY_RULES.metabolicMassExponent,
  shrimpReproductivePaceScale,
  shrimpMaturationPaceScale,
  shrimpGrazingHalfSaturation:
    WATER_CYCLE_RULES.shrimp.grazingHalfSaturationBiomass,
  final: samples.at(-1),
  living: snapshot.animals
    .filter((animal) => animal.speciesId === 'cherry-shrimp')
    .map((animal) => ({
      id: animal.id,
      generation: animal.generation ?? 0,
      stage: animal.lifeStage,
      sex: animal.sex,
      age: animal.ageSeconds,
      lifespan: animal.lifespanSeconds,
      energy: animal.energy,
      growth: animal.growthProgress,
      foodGap: animal.secondsSinceFood,
      reproductiveState: animal.reproductiveState,
    })),
  births: events
    .filter((event) => event.kind === 'birth')
    .map((event) => ({
      time: Math.round(event.elapsedSeconds),
      generation: event.generation ?? 0,
      sex: event.sex,
      parentId: event.parentId,
    })),
  maturations: events
    .filter((event) => event.kind === 'matured')
    .map((event) => ({
      animalId: event.animalId,
      time: Math.round(event.elapsedSeconds),
      age: Math.round(event.ageSeconds),
      generation: event.generation ?? 0,
      sex: event.sex,
    })),
  deaths: events
    .filter((event) => event.kind === 'death')
    .map((event) => ({
      animalId: event.animalId,
      time: Math.round(event.elapsedSeconds),
      generation: event.generation ?? 0,
      sex: event.sex,
      stage: event.lifeStage,
      age: Math.round(event.ageSeconds),
      cause: event.cause,
    })),
  samples,
};

const populationComposition = (sample: Mission5DiagnosticSample | undefined) => {
  if (!sample) return null;
  const shrimp = sample.shrimp ?? [];
  const adults = shrimp.filter((animal) => animal.stage === 'adult');
  const juveniles = shrimp.filter((animal) => animal.stage === 'juvenile');
  return {
    time: sample.time,
    population: sample.population,
    adults: adults.length,
    juveniles: juveniles.length,
    generations: sample.generations,
    structuralBiomass: shrimp.reduce(
      (sum, animal) => sum + animal.structure,
      0,
    ),
    storedBiomass: shrimp.reduce((sum, animal) => sum + animal.store, 0),
    reproductiveBiomass: shrimp.reduce(
      (sum, animal) => sum + animal.reproductive,
      0,
    ),
    meanStructuralBiomass: shrimp.reduce(
      (sum, animal) => sum + animal.structure,
      0,
    ) / Math.max(1, shrimp.length),
    algae: sample.algae,
    algaeFlux: sample.algaeFlux,
    populationEvents: sample.populationEvents,
  };
};

const peakPopulationSample = samples.reduce<Mission5DiagnosticSample | undefined>(
  (peak, sample) => !peak || sample.population > peak.population ? sample : peak,
  undefined,
);
const establishedSamples = samples.filter(
  (sample) => sample.time >= releaseAt + 2_400,
);
const establishedTroughSample =
  establishedSamples.reduce<Mission5DiagnosticSample | undefined>(
    (trough, sample) =>
      !trough || sample.population < trough.population ? sample : trough,
    undefined,
  );
const postPeakSamples = peakPopulationSample
  ? samples.filter((sample) => sample.time >= peakPopulationSample.time)
  : [];
const postPeakTroughSample =
  postPeakSamples.reduce<Mission5DiagnosticSample | undefined>(
    (trough, sample) =>
      !trough || sample.population < trough.population ? sample : trough,
    undefined,
  );
const lateSamples = samples.filter(
  (sample) => sample.time >= Math.max(12_000, releaseAt + 6_000),
);

if (verifySimultaneousMode) {
  const final = samples.at(-1);
  const established = samples.filter((sample) => sample.time >= 6_000);
  const late = samples.filter((sample) => sample.time >= 12_000);
  const failures: string[] = [];
  const requireCondition = (condition: boolean, message: string): void => {
    if (!condition) failures.push(message);
  };
  const hasRiseAndFall = (series: number[], epsilon: number): boolean => {
    const changes = series.slice(1).map((value, index) => value - series[index]);
    return changes.some((change) => change > epsilon) &&
      changes.some((change) => change < -epsilon);
  };

  requireCondition(duration >= 24_000, 'simultaneous verification requires 24,000 seconds');
  requireCondition(releaseAt === 0, 'all organisms and inocula must be placed at time zero');
  requireCondition(seedPairs === 8, 'verification requires all eight initial algae pairs');
  requireCondition(microbeDoses === 4, 'verification requires four doses per microbe guild');
  requireCondition(shrimpCount === 4, 'verification requires the four founder shrimp');
  requireCondition(Boolean(final), 'simultaneous verification produced no samples');
  if (final && established.length && late.length) {
    const lateAlgae = late.map((sample) => sample.algae);
    const lateAlgaeMinimum = Math.min(...lateAlgae);
    const lateAlgaeMinimumIndex = lateAlgae.indexOf(lateAlgaeMinimum);
    const lateAlgaeRebound =
      Math.max(...lateAlgae.slice(lateAlgaeMinimumIndex)) - lateAlgaeMinimum;
    const initialAlgaeInoculum =
      seedPairs * 2 * SURFACE_ALGAE_INOCULUM_BIOMASS;
    const establishedPopulation = established.map((sample) => sample.population);
    const establishedPopulationMinimum = Math.min(...establishedPopulation);
    const establishedPopulationMaximum = Math.max(...establishedPopulation);
    const maximumLivingGeneration = Math.max(
      0,
      ...Object.keys(final.generations).map(Number),
    );
    requireCondition(final.outcome === 'success', 'simultaneous stocking never reached success');
    requireCondition(final.population >= 20, `final population ${final.population} < 20`);
    requireCondition(
      establishedPopulationMinimum >= 20,
      `simultaneously stocked colony fell to ${establishedPopulationMinimum} ` +
        'after establishment',
    );
    requireCondition(
      establishedPopulationMaximum <= 160,
      `simultaneously stocked colony reached ${establishedPopulationMaximum} ` +
        '(> 160)',
    );
    requireCondition(maximumLivingGeneration >= 10, 'fewer than ten born generations survived');
    requireCondition(
      lateAlgaeMinimum > initialAlgaeInoculum * 4,
      'late producer biomass approached its inoculum scale',
    );
    requireCondition(
      hasRiseAndFall(lateAlgae, 0.05),
      'late producer biomass did not fall and rebound',
    );
    // A settled producer-consumer orbit may fluctuate narrowly around its
    // equilibrium instead of repeating the large establishment boom. Require
    // a resolved reversal above sampling noise, not an artificial 20% crash
    // and rebound. Persistence scale is checked independently above.
    requireCondition(
      lateAlgaeRebound > Math.max(0.5, lateAlgaeMinimum * 0.01),
      'late producer minimum was not followed by a resolved rebound',
    );
    requireCondition(
      Math.max(...samples.map((sample) => sample.water.ammonium)) <
        SHRIMP_ECOLOGY_RULES.toxicWasteStressStart,
      'ammonium entered the shrimp toxicity range',
    );
    requireCondition(
      Math.min(...samples.map((sample) => sample.water.oxygen)) > 30,
      'oxygen entered the shrimp stress range',
    );
    requireCondition(final.decomposer > 0, 'decomposer went extinct');
    requireCondition(final.nitrifier > 0, 'nitrifier went extinct');
  }

  if (failures.length) {
    throw new Error(
      `Mission 5 simultaneous-stock verification failed:\n- ${failures.join('\n- ')}`,
    );
  }
  console.log(JSON.stringify({
    status: 'passed',
    duration,
    final: final && {
      time: final.time,
      outcome: final.outcome,
      population: final.population,
      generations: final.generations,
      algae: final.algae,
      water: final.water,
      decomposer: final.decomposer,
      nitrifier: final.nitrifier,
    },
    establishedPopulationRange: {
      minimum: Math.min(...established.map((sample) => sample.population)),
      maximum: Math.max(...established.map((sample) => sample.population)),
    },
    lateAlgaeRange: {
      minimum: Math.min(...late.map((sample) => sample.algae)),
      maximum: Math.max(...late.map((sample) => sample.algae)),
    },
    lateAlgaeReboundFromMinimum:
      Math.max(
        ...late.slice(
          late.findIndex((sample) =>
            sample.algae === Math.min(...late.map((candidate) => candidate.algae)),
          ),
        ).map((sample) => sample.algae),
      ) - Math.min(...late.map((sample) => sample.algae)),
  }, null, 2));
} else if (verifyWithoutMicrobesMode) {
  const final = samples.at(-1);
  const failures: string[] = [];
  const requireCondition = (condition: boolean, message: string): void => {
    if (!condition) failures.push(message);
  };
  const peakPopulation = Math.max(0, ...samples.map((sample) => sample.population));
  const maximumLivingGeneration = Math.max(
    0,
    ...samples.flatMap((sample) => Object.keys(sample.generations).map(Number)),
  );
  const peakOrganicMatter = Math.max(
    0,
    ...samples.map((sample) => sample.water.organicMatter),
  );
  const algaeAfterRelease = samples
    .filter((sample) => sample.time >= releaseAt)
    .map((sample) => sample.algae);
  const peakAlgaeAfterRelease = Math.max(0, ...algaeAfterRelease);
  const minimumAlgaeAfterRelease = Math.min(...algaeAfterRelease);
  const algaeMinimumIndex = algaeAfterRelease.indexOf(minimumAlgaeAfterRelease);
  const algaeRecoveryAfterMinimum = Math.max(
    0,
    ...algaeAfterRelease.slice(algaeMinimumIndex),
  ) - minimumAlgaeAfterRelease;
  const populationEventTotals = snapshot.animalPopulationEventTotals;
  const deathCounts = populationEventTotals.deathsByCause;

  requireCondition(duration >= 12_000, 'negative control requires at least 12,000 seconds');
  requireCondition(seedPairs === 8, 'negative control requires all eight algae pairs');
  requireCondition(microbeDoses === 0, 'negative control must not inoculate microbes');
  requireCondition(shrimpCount === 4, 'negative control requires the four founder shrimp');
  requireCondition(Boolean(final), 'negative control produced no samples');
  if (final) {
    requireCondition(peakPopulation >= 20, 'shrimp never formed an initial fed colony');
    requireCondition(result.births.length > 0, 'shrimp produced no offspring before collapse');
    requireCondition(final.population === 0, 'microbe-free colony did not go extinct');
    requireCondition(
      populationEventTotals.deaths ===
        populationEventTotals.introduced + populationEventTotals.births,
      'living and dead shrimp no longer balance in the extinct control',
    );
    requireCondition(final.decomposer === 0, 'decomposer appeared without inoculation');
    requireCondition(final.nitrifier === 0, 'nitrifier appeared without inoculation');
    requireCondition(peakOrganicMatter > 30, 'unrecycled organic matter did not accumulate');
    // Removing both microbial guilds must break consumer renewal and retain
    // organic waste, but it must not require algae to remain extinct after
    // the consumers disappear. With grazing gone, surviving producers may
    // recover; under persistent unrecycled turbidity they may remain low.
    // Judge the real decline, not one biologically arbitrary final endpoint.
    requireCondition(
      peakAlgaeAfterRelease > 1 &&
        peakAlgaeAfterRelease - minimumAlgaeAfterRelease > 2,
      'producer bed did not respond to the unrecycled consumer pulse',
    );
  }

  if (failures.length) {
    throw new Error(
      `Mission 5 microbe-free verification failed:\n- ${failures.join('\n- ')}`,
    );
  }
  console.log(JSON.stringify({
    status: 'passed',
    duration,
    final: final && {
      time: final.time,
      outcome: final.outcome,
      population: final.population,
      algae: final.algae,
      organicMatter: final.water.organicMatter,
      ammonium: final.water.ammonium,
    },
    peakPopulation,
    maximumLivingGeneration,
    births: populationEventTotals.births,
    extinctionAt: result.deaths.at(-1)?.time ?? null,
    deathCounts,
    peakOrganicMatter,
    peakAlgaeAfterRelease,
    minimumAlgaeAfterRelease,
    algaeRecoveryAfterMinimum,
    finalAlgaeFractionOfPeak: final
      ? final.algae / Math.max(1e-12, peakAlgaeAfterRelease)
      : null,
  }, null, 2));
} else if (verifyMode) {
  const established = samples.filter((sample) => sample.time >= 14_400);
  const late = samples.filter((sample) => sample.time >= 24_000);
  const final = samples.at(-1);
  const failures: string[] = [];
  const values = (
    source: Mission5DiagnosticSample[],
    read: (sample: Mission5DiagnosticSample) => number,
  ): number[] => source.map(read);
  const hasRiseAndFall = (series: number[], epsilon: number): boolean => {
    const changes = series.slice(1).map((value, index) => value - series[index]);
    return changes.some((change) => change > epsilon) &&
      changes.some((change) => change < -epsilon);
  };
  const requireCondition = (condition: boolean, message: string): void => {
    if (!condition) failures.push(message);
  };

  requireCondition(duration >= 40_000, 'verification requires at least 40,000 seconds');
  requireCondition(seedPairs === 8, 'verification requires all eight initial algae pairs');
  requireCondition(microbeDoses === 4, 'verification requires four doses per microbe guild');
  requireCondition(shrimpCount === 4, 'verification requires the four supplied founder shrimp');
  requireCondition(Boolean(final), 'verification produced no samples');
  if (final && established.length && late.length) {
    const population = values(established, (sample) => sample.population);
    const latePopulation = values(late, (sample) => sample.population);
    const lateAlgae = values(late, (sample) => sample.algae);
    const lateAmmonium = values(late, (sample) => sample.water.ammonium);
    const lateNutrients = values(late, (sample) => sample.water.nutrients);
    const lateDecomposer = values(late, (sample) => sample.decomposer);
    const lateNitrifier = values(late, (sample) => sample.nitrifier);
    const maximumLivingGeneration = Math.max(
      0,
      ...Object.keys(final.generations).map(Number),
    );

    requireCondition(final.outcome === 'success', 'mission never reached success');
    // A single final sample can land at the bottom of a healthy delayed
    // consumer-resource orbit. Require persistence here; the established
    // minimum and late rebound checks below judge the scale and trend.
    requireCondition(final.population > 0, 'shrimp went extinct');
    const establishedPopulationMinimum = Math.min(...population);
    const lateAlgaeMinimum = Math.min(...lateAlgae);
    const lateAlgaeMinimumIndex = lateAlgae.indexOf(lateAlgaeMinimum);
    const lateAlgaeRebound =
      Math.max(...lateAlgae.slice(lateAlgaeMinimumIndex)) - lateAlgaeMinimum;
    // Dissolved mineral nutrient is a small, fast-turnover pool once most N
    // sits in producers and consumers. Judge its direction changes relative
    // to its own late scale; the former fixed 0.01 threshold was larger than
    // the entire healthy late dissolved pool.
    const lateNutrientMovementEpsilon = Math.max(
      1e-7,
      Math.max(...lateNutrients) * 0.01,
    );
    const initialAlgaeInoculum =
      seedPairs * 2 * SURFACE_ALGAE_INOCULUM_BIOMASS;
    requireCondition(
      establishedPopulationMinimum >= 18,
      `established population fell to ${establishedPopulationMinimum} (< 18)`,
    );
    requireCondition(
      Math.max(...population) <= 160,
      `established population exceeded the readable long-run range ` +
        `(${Math.max(...population)} > 160)`,
    );
    requireCondition(Math.max(...latePopulation) >= 30, 'late population never rebounded above 30');
    requireCondition(maximumLivingGeneration >= 15, 'fewer than fifteen generations survived');
    requireCondition(
      lateAlgaeMinimum > initialAlgaeInoculum * 4,
      `producer biomass fell to ${lateAlgaeMinimum.toFixed(3)} B ` +
        `(<= four initial inocula, ${(initialAlgaeInoculum * 4).toFixed(3)} B)`,
    );
    requireCondition(
      lateAlgaeRebound > Math.max(2, lateAlgaeMinimum * 0.05),
      `producer did not recover materially after its late minimum ` +
        `(rebound ${lateAlgaeRebound.toFixed(3)} B)`,
    );
    requireCondition(
      Math.max(...lateAlgae) - Math.min(...lateAlgae) > 2 &&
        hasRiseAndFall(lateAlgae, 0.05),
      'late producer biomass did not fall and rebound',
    );
    requireCondition(
      hasRiseAndFall(lateAmmonium, 0.01),
      'late ammonium did not fall and rebound',
    );
    requireCondition(
      hasRiseAndFall(lateNutrients, lateNutrientMovementEpsilon),
      `late nutrients did not fall and rebound relative to their pool ` +
        `(epsilon ${lateNutrientMovementEpsilon.toExponential(2)})`,
    );
    requireCondition(Math.min(...lateNitrifier) > 0, 'nitrifier went extinct');
    requireCondition(
      Math.max(...lateAmmonium) < SHRIMP_ECOLOGY_RULES.toxicWasteStressStart,
      'late ammonium entered the shrimp toxicity range',
    );
    requireCondition(Math.min(...lateDecomposer) > 0, 'decomposer went extinct');
    requireCondition(
      Math.max(...lateDecomposer) - Math.min(...lateDecomposer) > 0.5 &&
        hasRiseAndFall(lateDecomposer, 0.02),
      'decomposer biomass did not respond dynamically to organic loading',
    );
    requireCondition(
      Math.min(...values(samples, (sample) => sample.water.oxygen)) > 30,
      'oxygen entered the shrimp stress range',
    );
  }

  if (failures.length) {
    throw new Error(`Mission 5 long-run verification failed:\n- ${failures.join('\n- ')}`);
  }
  console.log(JSON.stringify({
    status: 'passed',
    duration,
    final: final && {
      time: final.time,
      outcome: final.outcome,
      population: final.population,
      generations: final.generations,
      algae: final.algae,
      water: final.water,
      decomposer: final.decomposer,
      nitrifier: final.nitrifier,
    },
    establishedPopulationRange: {
      minimum: Math.min(...established.map((sample) => sample.population)),
      maximum: Math.max(...established.map((sample) => sample.population)),
    },
    lateAlgaeRange: {
      minimum: Math.min(...late.map((sample) => sample.algae)),
      maximum: Math.max(...late.map((sample) => sample.algae)),
    },
    lateDecomposerRange: {
      minimum: Math.min(...late.map((sample) => sample.decomposer)),
      maximum: Math.max(...late.map((sample) => sample.decomposer)),
    },
    lateNitrifierRange: {
      minimum: Math.min(...late.map((sample) => sample.nitrifier)),
      maximum: Math.max(...late.map((sample) => sample.nitrifier)),
    },
  }, null, 2));
} else {
  console.log(JSON.stringify(
    compactMode
      ? {
        releaseAt,
        runSeed,
        duration,
        shrimpCount,
        seedPairs,
        decomposerDoses,
        nitrifierDoses,
        nitrifierSurfaceSpread:
          MICROBE_ECOLOGY_RULES.nitrifier.surfaceSpreadRate,
        nitrifierStarvationDecay:
          MICROBE_ECOLOGY_RULES.nitrifier.starvationDecayRate,
        nitrifierFluxTotals,
        nutrientHalfSaturation:
          WATER_CYCLE_RULES.mineralNutrientHalfSaturation,
        resourceScale,
        effectiveInitialMaterialScale:
          SCENARIOS['mission-5'].waterCycle!.initialMaterialScale ?? 1,
        initialNutrients: SCENARIOS['mission-5'].waterCycle!.initial.nutrients,
        shrimpFeedingMassExponent:
          WATER_CYCLE_RULES.shrimp.feedingMassExponent,
        shrimpMetabolicMassExponent:
          SHRIMP_ECOLOGY_RULES.metabolicMassExponent,
        shrimpReproductivePaceScale,
        shrimpMaturationPaceScale,
        shrimpGrazingHalfSaturation:
          WATER_CYCLE_RULES.shrimp.grazingHalfSaturationBiomass,
        shrimpMatterFluxTotals: {
          ...shrimpMatterFluxTotals,
          overflowFractionOfAssimilation:
            shrimpMatterFluxTotals.assimilationOverflow /
              Math.max(1e-12, shrimpMatterFluxTotals.assimilated),
          retainedAfterOverflow:
            shrimpMatterFluxTotals.assimilated -
              shrimpMatterFluxTotals.assimilationOverflow,
        },
        populationRange: {
          minimum: Math.min(...result.samples.map((sample) => sample.population)),
          maximum: Math.max(...result.samples.map((sample) => sample.population)),
        },
        establishedPopulationRange: {
          minimum: Math.min(...result.samples
            .filter((sample) => sample.time >= releaseAt + 2_400)
            .map((sample) => sample.population)),
          maximum: Math.max(...result.samples
            .filter((sample) => sample.time >= releaseAt + 2_400)
            .map((sample) => sample.population)),
        },
        algaeRange: {
          minimum: Math.min(...result.samples.map((sample) => sample.algae)),
          maximum: Math.max(...result.samples.map((sample) => sample.algae)),
        },
        populationPeak: populationComposition(peakPopulationSample),
        establishedPopulationTrough:
          populationComposition(establishedTroughSample),
        postPeakPopulationRange: postPeakSamples.length
          ? {
            minimum: Math.min(...postPeakSamples.map((sample) => sample.population)),
            maximum: Math.max(...postPeakSamples.map((sample) => sample.population)),
          }
          : null,
        postPeakPopulationTrough:
          populationComposition(postPeakTroughSample),
        latePopulationRange: lateSamples.length
          ? {
            minimum: Math.min(...lateSamples.map((sample) => sample.population)),
            maximum: Math.max(...lateSamples.map((sample) => sample.population)),
          }
          : null,
        final: result.final && (summaryMode
          ? {
            time: result.final.time,
            outcome: result.final.outcome,
            population: result.final.population,
            generations: result.final.generations,
            sexes: result.final.sexes,
            algae: result.final.algae,
            water: result.final.water,
            decomposer: result.final.decomposer,
            nitrifier: result.final.nitrifier,
            nitrifierSurface: result.final.nitrifierSurface,
          }
          : { ...result.final, shrimp: undefined }),
        events: {
          births: result.births.length,
          maturations: result.maturations.length,
          deaths: result.deaths.length,
          birthsByGenerationSex: result.births.reduce<Record<string, number>>(
            (counts, event) => {
              const key = `${event.generation}:${event.sex}`;
              counts[key] = (counts[key] ?? 0) + 1;
              return counts;
            },
            {},
          ),
          maturationsByGenerationSex: result.maturations.reduce<Record<string, number>>(
            (counts, event) => {
              const key = `${event.generation}:${event.sex}`;
              counts[key] = (counts[key] ?? 0) + 1;
              return counts;
            },
            {},
          ),
          maturationAgeByGenerationSex: Object.fromEntries(
            Object.entries(
              result.maturations.reduce<Record<string, number[]>>((ages, event) => {
                const key = `${event.generation}:${event.sex}`;
                (ages[key] ??= []).push(event.age);
                return ages;
              }, {}),
            ).map(([key, ages]) => [
              key,
              {
                minimum: Math.min(...ages),
                mean: ages.reduce((sum, age) => sum + age, 0) / ages.length,
                maximum: Math.max(...ages),
              },
            ]),
          ),
          firstBroodDelayAfterMaturation: (() => {
            const maturationByAnimal = new Map(
              result.maturations.map((event) => [event.animalId, event]),
            );
            const firstBirthByParent = new Map<string, number>();
            for (const event of result.births) {
              if (!event.parentId || firstBirthByParent.has(event.parentId)) continue;
              firstBirthByParent.set(event.parentId, event.time);
            }
            const delays = Array.from(firstBirthByParent, ([parentId, time]) => {
              const matured = maturationByAnimal.get(parentId);
              return matured ? time - matured.time : null;
            }).filter((delay): delay is number => delay !== null);
            return delays.length
              ? {
                count: delays.length,
                minimum: Math.min(...delays),
                mean: delays.reduce((sum, delay) => sum + delay, 0) / delays.length,
                maximum: Math.max(...delays),
              }
              : null;
          })(),
          femaleReproductionByGeneration: (() => {
            const firstBirthByParent = new Map<string, number>();
            for (const event of result.births) {
              if (!event.parentId || firstBirthByParent.has(event.parentId)) continue;
              firstBirthByParent.set(event.parentId, event.time);
            }
            const deathByAnimal = new Map(
              result.deaths.map((event) => [event.animalId, event]),
            );
            const groups = result.maturations
              .filter((event) => event.sex === 'female')
              .reduce<Record<string, typeof result.maturations>>((byGeneration, event) => {
                (byGeneration[String(event.generation)] ??= []).push(event);
                return byGeneration;
              }, {});
            return Object.fromEntries(Object.entries(groups).map(([generation, females]) => {
              const parents = females.filter((event) => firstBirthByParent.has(event.animalId));
              const broodCounts = females.map((female) => new Set(
                result.births
                  .filter((birth) => birth.parentId === female.animalId)
                  .map((birth) => birth.time),
              ).size);
              const postMaturityLifetimes = females.flatMap((event) => {
                const death = deathByAnimal.get(event.animalId);
                return death ? [death.time - event.time] : [];
              });
              return [generation, {
                matured: females.length,
                becameParent: parents.length,
                noRecordedBrood: females.length - parents.length,
                broodCount: {
                  total: broodCounts.reduce((sum, count) => sum + count, 0),
                  mean: broodCounts.reduce((sum, count) => sum + count, 0) /
                    Math.max(1, broodCounts.length),
                  maximum: Math.max(0, ...broodCounts),
                },
                postMaturityLifetime: postMaturityLifetimes.length
                  ? {
                    minimum: Math.min(...postMaturityLifetimes),
                    mean: postMaturityLifetimes.reduce((sum, age) => sum + age, 0) /
                      postMaturityLifetimes.length,
                    maximum: Math.max(...postMaturityLifetimes),
                  }
                  : null,
              }];
            }));
          })(),
          femaleEndStateBottlenecks: (() => {
            const maturedFemales = result.maturations.filter(
              (event) => event.sex === 'female',
            );
            return maturedFemales.reduce<Record<string, number>>((counts, female) => {
              let lastState: NonNullable<Mission5DiagnosticSample['shrimp']>[number] |
                undefined;
              for (const sample of result.samples) {
                const state = sample.shrimp?.find((animal) => animal.id === female.animalId);
                if (state) lastState = state;
              }
              if (!lastState) return counts;
              const broodMatter = (lastState.clutch ?? 2) *
                WATER_CYCLE_RULES.shrimp.juvenileBirthBiomass;
              let blocker = 'mate-encounter';
              if (lastState.ovarian < 0.99) blocker = 'ovarian-readiness';
              else if (lastState.reproductive + 1e-9 < broodMatter) {
                blocker = 'egg-matter';
              } else if (lastState.gestation !== null) blocker = 'gestation';
              const key = `${female.generation}:${blocker}`;
              counts[key] = (counts[key] ?? 0) + 1;
              return counts;
            }, {});
          })(),
          deathsByGenerationSexCause: result.deaths.reduce<Record<string, number>>(
            (counts, event) => {
              const key = `${event.generation}:${event.sex}:${event.cause}`;
              counts[key] = (counts[key] ?? 0) + 1;
              return counts;
            },
            {},
          ),
          deathsByCause: result.deaths.reduce<Record<string, number>>((counts, event) => {
            counts[event.cause] = (counts[event.cause] ?? 0) + 1;
            return counts;
          }, {}),
        },
        trace: summaryMode ? undefined : result.samples.map((sample) => ({
          time: sample.time,
          population: sample.population,
          generations: sample.generations,
          sexes: sample.sexes,
          adults: (sample.shrimp ?? []).filter(
            (animal) => animal.stage === 'adult',
          ).length,
          meanEnergy: (sample.shrimp ?? []).reduce(
            (sum, animal) => sum + animal.energy,
            0,
          ) / Math.max(1, sample.population),
          meanRecentIntake: (sample.shrimp ?? []).reduce(
            (sum, animal) => sum + animal.recentIntake,
            0,
          ) / Math.max(1, sample.population),
          lowCondition: (sample.shrimp ?? []).filter(
            (animal) => animal.energy < 0.32,
          ).length,
          ovarianReadyFemales: (sample.shrimp ?? []).filter(
            (animal) =>
              animal.stage === 'adult' &&
              animal.sex === 'female' &&
              animal.ovarian >= 0.99,
          ).length,
          gestatingFemales: (sample.shrimp ?? []).filter(
            (animal) =>
              animal.stage === 'adult' &&
              animal.sex === 'female' &&
              animal.gestation !== null,
          ).length,
          algae: sample.algae,
          algaeConsumed: sample.algaeConsumed,
          ammonium: sample.water.ammonium,
          organicMatter: sample.water.organicMatter,
          decomposer: sample.decomposer,
          nitrifier: sample.nitrifier,
        })),
      }
      : result,
    null,
    2,
  ));
}
