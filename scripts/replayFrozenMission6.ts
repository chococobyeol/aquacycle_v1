import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { SimulationWorld } from '../src/simulation/SimulationWorld';
import {
  SCENARIOS,
  SHRIMP_ECOLOGY_RULES,
  SPECIES,
  WATER_CYCLE_RULES,
} from '../src/simulation/config';
import type { AnimalSex, SimulationSaveData } from '../src/simulation/types';

interface FrozenAquariumRecord {
  data: SimulationSaveData;
}

const argument = (name: string, fallback: string): string =>
  process.argv
    .find((value) => value.startsWith(`--${name}=`))
    ?.slice(name.length + 3) ?? fallback;

const numericArgument = (name: string, fallback: number): number => {
  const value = Number(argument(name, String(fallback)));
  return Number.isFinite(value) ? value : fallback;
};

const input = argument('input', '');
const output = argument('output', '');
const outputName = argument('output-name', '미션 6 실제 실패 배치 장기 재검증');
if (!input) throw new Error('--input에 냉동 수조 JSON 경로가 필요합니다.');
const recordIndex = Math.max(0, Math.floor(numericArgument('index', 0)));
const duration = Math.max(1, numericArgument('duration', 6_000));
const sampleEvery = Math.max(1, numericArgument('sample-every', 360));
const summaryOnly = numericArgument('summary-only', 0) > 0;
const progress = numericArgument('progress', 0) > 0;
const stopOnExtinction = numericArgument('stop-on-extinction', 1) > 0;
const resetAnimals = numericArgument('reset-animals', 0) > 0;
const resetChemistry = numericArgument('reset-chemistry', 0) > 0;
const releaseCount = Math.max(0, Math.min(
  4,
  Math.round(numericArgument('release-count', 4)),
));
const spreadRelease = numericArgument('spread-release', 0) > 0;
const releaseX = numericArgument('release-x', Number.NaN);
const nitzschiaHighLightScale = Math.max(
  0,
  numericArgument('nitzschia-high-light-scale', 1),
);
const oedogoniumHighLightScale = Math.max(
  0,
  numericArgument('oedogonium-high-light-scale', 1),
);
const ovarianDevelopmentOnsetFraction = Math.max(
  0,
  Math.min(
    1,
    numericArgument(
      'ovarian-onset',
      SHRIMP_ECOLOGY_RULES.ovarianDevelopmentOnsetFraction,
    ),
  ),
);
(SHRIMP_ECOLOGY_RULES as { ovarianDevelopmentOnsetFraction: number })
  .ovarianDevelopmentOnsetFraction = ovarianDevelopmentOnsetFraction;
const minimumClutchSize = Math.max(
  1,
  Math.round(numericArgument('minimum-clutch', SHRIMP_ECOLOGY_RULES.minimumClutchSize)),
);
const maximumClutchSize = Math.max(
  minimumClutchSize,
  Math.round(numericArgument('maximum-clutch', SHRIMP_ECOLOGY_RULES.maximumClutchSize)),
);
(SHRIMP_ECOLOGY_RULES as { minimumClutchSize: number }).minimumClutchSize =
  minimumClutchSize;
(SHRIMP_ECOLOGY_RULES as { maximumClutchSize: number }).maximumClutchSize =
  maximumClutchSize;
const ovarianCycleMinimumSeconds = Math.max(
  1,
  numericArgument(
    'ovarian-cycle-min',
    SHRIMP_ECOLOGY_RULES.ovarianCycleMinimumSeconds,
  ),
);
const ovarianCycleMaximumSeconds = Math.max(
  ovarianCycleMinimumSeconds,
  numericArgument(
    'ovarian-cycle-max',
    SHRIMP_ECOLOGY_RULES.ovarianCycleMaximumSeconds,
  ),
);
(SHRIMP_ECOLOGY_RULES as { ovarianCycleMinimumSeconds: number })
  .ovarianCycleMinimumSeconds = ovarianCycleMinimumSeconds;
(SHRIMP_ECOLOGY_RULES as { ovarianCycleMaximumSeconds: number })
  .ovarianCycleMaximumSeconds = ovarianCycleMaximumSeconds;
const gestationMinimumSeconds = Math.max(
  1,
  numericArgument(
    'gestation-min',
    SHRIMP_ECOLOGY_RULES.gestationMinimumSeconds,
  ),
);
const gestationMaximumSeconds = Math.max(
  gestationMinimumSeconds,
  numericArgument(
    'gestation-max',
    SHRIMP_ECOLOGY_RULES.gestationMaximumSeconds,
  ),
);
(SHRIMP_ECOLOGY_RULES as { gestationMinimumSeconds: number })
  .gestationMinimumSeconds = gestationMinimumSeconds;
(SHRIMP_ECOLOGY_RULES as { gestationMaximumSeconds: number })
  .gestationMaximumSeconds = gestationMaximumSeconds;
const solarArcExponent = numericArgument(
  'solar-arc-exponent',
  SCENARIOS['mission-6'].dayNightCycle?.solarArcExponent ?? 1,
);
const mission6NaturalLightOutput = Math.max(
  0,
  numericArgument(
    'natural-light-output',
    SCENARIOS['mission-6'].naturalLightOutput,
  ),
);
SCENARIOS['mission-6'].naturalLightOutput = mission6NaturalLightOutput;
const mission6InitialMaterialScale = Math.max(
  0,
  numericArgument(
    'initial-material-scale',
    SCENARIOS['mission-6'].waterCycle?.initialMaterialScale ?? 1,
  ),
);
if (SCENARIOS['mission-6'].waterCycle) {
  SCENARIOS['mission-6'].waterCycle.initialMaterialScale =
    mission6InitialMaterialScale;
}
const mission6InitialNutrients = Math.max(
  0,
  numericArgument(
    'initial-nutrients',
    SCENARIOS['mission-6'].waterCycle?.initial.nutrients ?? 0,
  ),
);
if (SCENARIOS['mission-6'].waterCycle) {
  SCENARIOS['mission-6'].waterCycle.initial.nutrients =
    mission6InitialNutrients;
}
if (nitzschiaHighLightScale !== 1) {
  for (const point of SPECIES.nitzschia.lightCurve) {
    if (point.light >= 72 && point.netRate > 0) {
      point.netRate *= nitzschiaHighLightScale;
    }
  }
}
if (oedogoniumHighLightScale !== 1) {
  for (const point of SPECIES.oedogonium.lightCurve) {
    if (point.light >= 82 && point.netRate > 0) {
      point.netRate *= oedogoniumHighLightScale;
    }
  }
}
const settleBeforeRelease = Math.max(
  0,
  numericArgument('settle-before-release', 0),
);
const maturationStructuralBiomass = numericArgument(
  'maturation-biomass',
  SHRIMP_ECOLOGY_RULES.maturationStructuralBiomass,
);
(SHRIMP_ECOLOGY_RULES as { maturationStructuralBiomass: number })
  .maturationStructuralBiomass = maturationStructuralBiomass;
const maturationMinimumSeconds = Math.max(
  1,
  numericArgument(
    'maturation-min',
    SHRIMP_ECOLOGY_RULES.maturationMinimumSeconds,
  ),
);
const maturationMaximumSeconds = Math.max(
  maturationMinimumSeconds,
  numericArgument(
    'maturation-max',
    SHRIMP_ECOLOGY_RULES.maturationMaximumSeconds,
  ),
);
(SHRIMP_ECOLOGY_RULES as { maturationMinimumSeconds: number })
  .maturationMinimumSeconds = maturationMinimumSeconds;
(SHRIMP_ECOLOGY_RULES as { maturationMaximumSeconds: number })
  .maturationMaximumSeconds = maturationMaximumSeconds;
const records = JSON.parse(readFileSync(input, 'utf8')) as FrozenAquariumRecord[];
const record = records[recordIndex];
if (!record) throw new Error(`냉동 수조 ${recordIndex}번 기록이 없습니다.`);
if (
  record.data.scenarioId !== 'mission-5' &&
  record.data.scenarioId !== 'mission-6'
) {
  throw new Error(`${recordIndex}번 기록은 미션 5/6이 아닙니다.`);
}
if (
  record.data.scenarioId === 'mission-6' &&
  Number.isFinite(solarArcExponent)
) {
  const cycle = SCENARIOS['mission-6'].dayNightCycle;
  if (cycle) cycle.solarArcExponent = Math.max(0.05, solarArcExponent);
}

(WATER_CYCLE_RULES.shrimp as { feedingMassExponent: number })
  .feedingMassExponent = numericArgument(
    'feeding-exponent',
    WATER_CYCLE_RULES.shrimp.feedingMassExponent,
  );
(WATER_CYCLE_RULES.shrimp as { grazingResponseExponent: number })
  .grazingResponseExponent = Math.max(
    0.1,
    numericArgument(
      'grazing-response-exponent',
      WATER_CYCLE_RULES.shrimp.grazingResponseExponent,
    ),
  );

const world = new SimulationWorld(record.data.scenarioId);
const freshScenarioData = resetChemistry ? world.exportSaveData() : null;
const replayData = structuredClone(record.data);
if (freshScenarioData) {
  replayData.biogeochemistry = freshScenarioData.biogeochemistry;
  replayData.materialReference = freshScenarioData.materialReference;
  replayData.suspendedBiofilm = freshScenarioData.suspendedBiofilm;
  replayData.naturalLightOutput = mission6NaturalLightOutput;
}
if (resetAnimals) {
  replayData.animals = [];
  replayData.carcasses = [];
  replayData.animalInventoryUsed['cherry-shrimp'] = 0;
  replayData.animalSexInventoryUsed['cherry-shrimp'] = {
    female: 0,
    male: 0,
  };
  replayData.animalPopulationEvents = [];
  replayData.animalPopulationEventSequence = 0;
  replayData.animalPopulationEventTotals = {
    introduced: 0,
    removed: 0,
    births: 0,
    hatches: 0,
    maturations: 0,
    deaths: 0,
    deathsByCause: {
      starvation: 0,
      'old-age': 0,
      hypoxia: 0,
      toxicity: 0,
      temperature: 0,
      predation: 0,
    },
  };
  replayData.animalCounter = 1;
  replayData.totalAlgaeConsumed = 0;
  replayData.successHoldAccumulator = 0;
  replayData.outcome = 'pending';
  replayData.outcomeAtSeconds = null;
  replayData.savedPhase = 'paused';
}
world.loadSaveData(replayData);
if (settleBeforeRelease > 0) {
  world.handle({ type: 'start' });
  world.handle({ type: 'resume' });
  world.handle({ type: 'set-speed', speed: 64 });
  let settled = 0;
  while (settled < settleBeforeRelease) {
    world.tick(0.1);
    settled += 6.4;
  }
  world.handle({ type: 'pause' });
}
const availableReleaseCells = world.snapshot().cells
  .filter((cell) => cell.surfaceKind === 'structure-face')
  .sort((left, right) => Number.isFinite(releaseX)
    ? Math.abs(left.x - releaseX) - Math.abs(right.x - releaseX)
    : left.x - right.x);
const releaseCells = spreadRelease && releaseCount > 1
  ? Array.from({ length: releaseCount }, (_, index) =>
    availableReleaseCells[Math.round(
      index * (availableReleaseCells.length - 1) / (releaseCount - 1),
    )]
  )
  : availableReleaseCells.slice(0, releaseCount);
if (releaseCells.length < releaseCount || releaseCells.some((cell) => !cell)) {
  throw new Error(`새우 ${releaseCount}마리를 놓을 구조물 표면이 부족합니다.`);
}
const sexes: AnimalSex[] = releaseCount === 0
  ? []
  : releaseCount === 2
    ? ['female', 'male']
    : ['female', 'female', 'male', 'male'].slice(0, releaseCount) as AnimalSex[];
for (let index = 0; index < sexes.length; index += 1) {
  const point = releaseCells[index];
  world.handle({
    type: 'pick-animal',
    speciesId: 'cherry-shrimp',
    sex: sexes[index],
    point,
  });
  world.handle({ type: 'drop-held', point });
}
const releasedAt = world.snapshot().elapsedSeconds;
const releasedPopulation = world.snapshot().animalPopulation['cherry-shrimp'].total;
const sourcePopulation = replayData.animals.filter(
  (animal) => animal.speciesId === 'cherry-shrimp',
).length;
const expectedReleasedPopulation = sourcePopulation + releaseCount;
if (releasedPopulation !== expectedReleasedPopulation) {
  throw new Error(
    `새우 방류 실패: 기존 ${sourcePopulation} + 방류 ${releaseCount}마리 중 ` +
      `${releasedPopulation}마리 존재`,
  );
}
world.handle({ type: 'start' });
world.handle({ type: 'resume' });
world.handle({ type: 'set-speed', speed: 64 });

let nextSample = releasedAt;
let simulatedSinceRelease = 0;
const samples: Array<{
  elapsed: number;
  shrimp: number;
  adults: number;
  juveniles: number;
  adultFemales: number;
  adultMales: number;
  juvenileFemales: number;
  juvenileMales: number;
  readyFemales: number;
  berriedFemales: number;
  averageOvarianProgress: number;
  births: number;
  maturations: number;
  deaths: number;
  generationThreeOrLater: number;
  holdSeconds: number;
  producers: number;
  nitzschia: number;
  oedogonium: number;
  occupiedFoodCells: number;
  grazeableFoodCells: number;
  denseFoodCells: number;
  meanOccupiedFood: number;
  meanJuvenileStructure: number;
  meanJuvenileRecentIntake: number;
  meanAdultStructure: number;
  maximumAdultStructure: number;
  maximumLivingStructure: number;
  oppositeSexAdultDistance: number | null;
  vallisneria: number;
  vallisneriaRamets: number;
  vallisneriaRunnerRamets: number;
  vallisneriaReproductiveRamets: number;
  consumed: number;
}> = [];
while (simulatedSinceRelease < duration) {
  world.tick(0.1);
  simulatedSinceRelease += 6.4;
  if (releasedAt + simulatedSinceRelease + 1e-9 < nextSample) continue;
  const snapshot = world.snapshot();
  const shrimp = snapshot.animals.filter(
    (animal) => animal.speciesId === 'cherry-shrimp',
  );
  const adultFemales = shrimp.filter(
    (animal) => animal.lifeStage === 'adult' && animal.sex === 'female',
  );
  const savedAdultFemales = world.exportSaveData().animals.filter(
    (animal) =>
      animal.speciesId === 'cherry-shrimp' &&
      animal.lifeStage === 'adult' &&
      animal.sex === 'female',
  );
  const savedShrimp = world.exportSaveData().animals.filter(
    (animal) => animal.speciesId === 'cherry-shrimp',
  );
  const savedJuveniles = savedShrimp.filter(
    (animal) => animal.lifeStage === 'juvenile',
  );
  const savedAdults = savedShrimp.filter(
    (animal) => animal.lifeStage === 'adult',
  );
  const adultFemaleStates = savedAdults.filter((animal) => animal.sex === 'female');
  const adultMaleStates = savedAdults.filter((animal) => animal.sex === 'male');
  const oppositeSexAdultDistance = adultFemaleStates.length > 0 && adultMaleStates.length > 0
    ? Math.min(...adultFemaleStates.flatMap((female) =>
      adultMaleStates.map((male) => Math.hypot(
        female.position.x - male.position.x,
        female.position.y - male.position.y,
      )),
    ))
    : null;
  const vallisneriaRamets = snapshot.plants.filter(
    (plant) => plant.speciesId === 'vallisneria',
  );
  const mean = (values: number[]): number => values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
  const edibleByCell = snapshot.cells.map((cell) =>
    cell.biomass.nitzschia + cell.biomass.oedogonium * 0.72 +
    cell.biofilm.decomposer * 0.45 + cell.biofilm.nitrifier * 0.22,
  );
  const occupiedFood = edibleByCell.filter((amount) => amount > 0.001);
  const sample = {
    elapsed: Math.round(snapshot.elapsedSeconds - releasedAt),
    shrimp: snapshot.animalPopulation['cherry-shrimp'].total,
    adults: snapshot.animalPopulation['cherry-shrimp'].adults,
    juveniles: snapshot.animalPopulation['cherry-shrimp'].juveniles,
    adultFemales: snapshot.animalPopulation['cherry-shrimp'].adultFemales,
    adultMales: snapshot.animalPopulation['cherry-shrimp'].adultMales,
    juvenileFemales: snapshot.animalPopulation['cherry-shrimp'].juvenileFemales,
    juvenileMales: snapshot.animalPopulation['cherry-shrimp'].juvenileMales,
    readyFemales: adultFemales.filter(
      (animal) => animal.reproductiveState === 'ready',
    ).length,
    berriedFemales: adultFemales.filter(
      (animal) => animal.reproductiveState === 'berried',
    ).length,
    averageOvarianProgress: Number((savedAdultFemales.reduce(
      (sum, animal) => sum + (animal.ovarianProgress ?? 0),
      0,
    ) / Math.max(1, savedAdultFemales.length)).toFixed(3)),
    births: snapshot.animalPopulationEventTotals.births,
    maturations: snapshot.animalPopulationEventTotals.maturations,
    deaths: snapshot.animalPopulationEventTotals.deaths,
    generationThreeOrLater: snapshot.animals.filter(
      (animal) =>
        animal.speciesId === 'cherry-shrimp' &&
        (animal.generation ?? 0) >= 3,
    ).length,
    holdSeconds: Math.round(snapshot.missionProgress?.holdCurrent ?? 0),
    producers: Number(
      (snapshot.totalBiomass.oedogonium + snapshot.totalBiomass.nitzschia)
        .toFixed(2),
    ),
    nitzschia: Number(snapshot.totalBiomass.nitzschia.toFixed(2)),
    oedogonium: Number(snapshot.totalBiomass.oedogonium.toFixed(2)),
    occupiedFoodCells: occupiedFood.length,
    grazeableFoodCells: edibleByCell.filter((amount) => amount >= 0.04).length,
    denseFoodCells: edibleByCell.filter((amount) => amount >= 0.2).length,
    meanOccupiedFood: Number((occupiedFood.reduce(
      (sum, amount) => sum + amount,
      0,
    ) / Math.max(1, occupiedFood.length)).toFixed(4)),
    meanJuvenileStructure: Number((savedJuveniles.reduce(
      (sum, animal) => sum + animal.structuralBiomass,
      0,
    ) / Math.max(1, savedJuveniles.length)).toFixed(4)),
    meanJuvenileRecentIntake: Number((savedJuveniles.reduce(
      (sum, animal) => sum + animal.recentIntake,
      0,
    ) / Math.max(1, savedJuveniles.length)).toFixed(6)),
    meanAdultStructure: Number(mean(savedAdults.map(
      (animal) => animal.structuralBiomass,
    )).toFixed(4)),
    maximumAdultStructure: Number(Math.max(
      0,
      ...savedAdults.map((animal) => animal.structuralBiomass),
    ).toFixed(4)),
    maximumLivingStructure: Number(Math.max(
      0,
      ...savedShrimp.map((animal) => animal.structuralBiomass),
    ).toFixed(4)),
    oppositeSexAdultDistance: oppositeSexAdultDistance === null
      ? null
      : Math.round(oppositeSexAdultDistance),
    vallisneria: Number(snapshot.totalBiomass.vallisneria.toFixed(3)),
    vallisneriaRamets: vallisneriaRamets.length,
    vallisneriaRunnerRamets: vallisneriaRamets.filter(
      (plant) => plant.origin === 'runner',
    ).length,
    vallisneriaReproductiveRamets: vallisneriaRamets.filter(
      (plant) => plant.reproductionCount > 0,
    ).length,
    meanJuvenileAge: Math.round(mean(savedJuveniles.map(
      (animal) => animal.ageSeconds,
    ))),
    oldestJuvenileAge: Math.round(Math.max(
      0,
      ...savedJuveniles.map((animal) => animal.ageSeconds),
    )),
    meanAdultAge: Math.round(mean(savedAdults.map(
      (animal) => animal.ageSeconds,
    ))),
    meanRemainingAdultLife: Math.round(mean(savedAdults.map(
      (animal) => animal.lifespanSeconds - animal.ageSeconds,
    ))),
    meanJuvenileReserveCondition: Number(mean(savedJuveniles.map(
      (animal) => animal.storedBiomass / Math.max(
        1e-9,
        WATER_CYCLE_RULES.shrimp.adultReserveBiomass *
          Math.max(
            WATER_CYCLE_RULES.shrimp.juvenileBirthBiomass,
            animal.peakStructuralBiomass ?? animal.structuralBiomass,
          ) /
          WATER_CYCLE_RULES.shrimp.adultStructuralBiomass,
      ),
    )).toFixed(3)),
    consumed: Number(snapshot.totalAlgaeConsumed.toFixed(3)),
  };
  samples.push(sample);
  if (progress) console.error(JSON.stringify(sample));
  nextSample += sampleEvery;
  if (stopOnExtinction && sample.shrimp === 0) break;
}

const final = world.snapshot();
const shrimpEvents = final.animalPopulationEvents.filter(
  (event) =>
    event.speciesId === 'cherry-shrimp' &&
    event.elapsedSeconds >= releasedAt,
);
const birthTimes = new Map(
  shrimpEvents
    .filter((event) => event.kind === 'birth')
    .map((event) => [event.animalId, event.elapsedSeconds]),
);
const maturationDelays = shrimpEvents
  .filter((event) => event.kind === 'matured')
  .map((event) => ({
    id: event.animalId,
    delay: Math.round(event.elapsedSeconds - (birthTimes.get(event.animalId) ?? releasedAt)),
  }));
const maturationDelayValues = maturationDelays.map(({ delay }) => delay);
const maturationDelaySummary = maturationDelayValues.length > 0
  ? {
      count: maturationDelayValues.length,
      minimum: Math.min(...maturationDelayValues),
      mean: Math.round(
        maturationDelayValues.reduce((sum, value) => sum + value, 0) /
          maturationDelayValues.length,
      ),
      maximum: Math.max(...maturationDelayValues),
    }
  : { count: 0, minimum: null, mean: null, maximum: null };

if (output) {
  world.handle({ type: 'pause' });
  const savedData = world.exportSaveData();
  savedData.savedPhase = 'paused';
  writeFileSync(output, JSON.stringify([{
    id: randomUUID(),
    name: outputName,
    scenarioId: savedData.scenarioId,
    createdAt: new Date().toISOString(),
    elapsedSeconds: savedData.elapsedSeconds,
    data: savedData,
  }]));
}

console.log(JSON.stringify({
  frozenIndex: recordIndex,
  output: output || null,
  sourceElapsed: releasedAt,
  calibration: {
    nitzschiaHighLightScale,
    oedogoniumHighLightScale,
    ovarianDevelopmentOnsetFraction,
    minimumClutchSize,
    maximumClutchSize,
    maturationStructuralBiomass,
    feedingMassExponent: WATER_CYCLE_RULES.shrimp.feedingMassExponent,
    grazingResponseExponent:
      WATER_CYCLE_RULES.shrimp.grazingResponseExponent,
    maturationSeconds: [
      maturationMinimumSeconds,
      maturationMaximumSeconds,
    ],
    gestationSeconds: [
      gestationMinimumSeconds,
      gestationMaximumSeconds,
    ],
    ovarianCycleSeconds: [
      ovarianCycleMinimumSeconds,
      ovarianCycleMaximumSeconds,
    ],
    naturalLightOutput: mission6NaturalLightOutput,
    initialMaterialScale: mission6InitialMaterialScale,
    initialNutrients: mission6InitialNutrients,
  },
  totals: final.animalPopulationEventTotals,
  outcome: final.outcome,
  missionProgress: final.missionProgress,
  finalPopulation: final.animalPopulation['cherry-shrimp'],
  maturationDelaySummary,
  maturationDelays: summaryOnly ? undefined : maturationDelays,
  samples,
}, null, 2));
