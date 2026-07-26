import { SimulationWorld } from '../src/simulation/SimulationWorld';
import {
  PLANKTON_ECOLOGY_RULES,
  RICEFISH_ECOLOGY_RULES,
  WATER_CYCLE_RULES,
} from '../src/simulation/config';
import type {
  PlanktonKind,
  ScenarioId,
  SimulationSaveData,
  Vec2,
} from '../src/simulation/types';
import type { BiogeochemistryLedger } from '../src/simulation/biogeochemistry';

type InternalAnimal = SimulationSaveData['animals'][number];

interface CapacityWorldInternals {
  animals: InternalAnimal[];
  biogeochemistry: BiogeochemistryLedger;
  animalPopulationEventTotals: {
    births: number;
    deaths: number;
  };
  stepDaphniaMotion(animal: InternalAnimal, deltaSeconds: number): void;
  stepDaphniaEcology(deltaSeconds: number): void;
  killAnimal(animal: InternalAnimal, cause: 'predation'): void;
  syncDaphniaIndividuals(): void;
}

const daphniaRules = PLANKTON_ECOLOGY_RULES.daphnia as unknown as {
  broodCooldownSeconds: number;
  minimumBroodSize: number;
  maximumBroodSize: number;
  minimumFoodQualityForReproduction: number;
  minimumLifespanSeconds: number;
  maximumLifespanSeconds: number;
  bacterioplanktonHalfSaturation: number;
  maximumBacteriaDietFraction: number;
  bacterioplanktonAssimilation: number;
  phytoplanktonHalfSaturation: number;
  highFoodBroodResponseThreshold: number;
};
const phytoplanktonRules =
  PLANKTON_ECOLOGY_RULES.phytoplankton as unknown as {
    maximumGrowthPerSecond: number;
  };
if (process.env.DAPHNIA_CAPACITY_BROOD_COOLDOWN) {
  daphniaRules.broodCooldownSeconds = Math.max(
    30,
    Number(process.env.DAPHNIA_CAPACITY_BROOD_COOLDOWN),
  );
}
if (process.env.DAPHNIA_CAPACITY_MAX_BROOD) {
  daphniaRules.maximumBroodSize = Math.max(
    daphniaRules.minimumBroodSize,
    Math.floor(Number(process.env.DAPHNIA_CAPACITY_MAX_BROOD)),
  );
}
if (process.env.DAPHNIA_CAPACITY_REPRODUCTION_FOOD) {
  daphniaRules.minimumFoodQualityForReproduction = Math.max(
    0.01,
    Number(process.env.DAPHNIA_CAPACITY_REPRODUCTION_FOOD),
  );
}
if (process.env.DAPHNIA_CAPACITY_LIFESPAN_MIN) {
  daphniaRules.minimumLifespanSeconds = Math.max(
    300,
    Number(process.env.DAPHNIA_CAPACITY_LIFESPAN_MIN),
  );
}
if (process.env.DAPHNIA_CAPACITY_LIFESPAN_MAX) {
  daphniaRules.maximumLifespanSeconds = Math.max(
    daphniaRules.minimumLifespanSeconds,
    Number(process.env.DAPHNIA_CAPACITY_LIFESPAN_MAX),
  );
}
if (process.env.DAPHNIA_CAPACITY_PHYTO_GROWTH) {
  phytoplanktonRules.maximumGrowthPerSecond = Math.max(
    0.001,
    Number(process.env.DAPHNIA_CAPACITY_PHYTO_GROWTH),
  );
}
if (process.env.DAPHNIA_CAPACITY_BACTERIA_HALF_SAT) {
  daphniaRules.bacterioplanktonHalfSaturation = Math.max(
    0.05,
    Number(process.env.DAPHNIA_CAPACITY_BACTERIA_HALF_SAT),
  );
}
if (process.env.DAPHNIA_CAPACITY_BACTERIA_DIET) {
  daphniaRules.maximumBacteriaDietFraction = Math.max(
    0,
    Number(process.env.DAPHNIA_CAPACITY_BACTERIA_DIET),
  );
}
if (process.env.DAPHNIA_CAPACITY_BACTERIA_ASSIMILATION) {
  daphniaRules.bacterioplanktonAssimilation = Math.max(
    0,
    Number(process.env.DAPHNIA_CAPACITY_BACTERIA_ASSIMILATION),
  );
}
if (process.env.DAPHNIA_CAPACITY_PHYTO_HALF_SAT) {
  daphniaRules.phytoplanktonHalfSaturation = Math.max(
    0.1,
    Number(process.env.DAPHNIA_CAPACITY_PHYTO_HALF_SAT),
  );
}
if (process.env.DAPHNIA_CAPACITY_HIGH_FOOD_BROOD) {
  daphniaRules.highFoodBroodResponseThreshold = Math.max(
    0,
    Math.min(1, Number(process.env.DAPHNIA_CAPACITY_HIGH_FOOD_BROOD)),
  );
}

const placePlankton = (
  world: SimulationWorld,
  planktonKind: PlanktonKind,
  point: Vec2,
): void => {
  world.handle({ type: 'pick-plankton', planktonKind, point });
  world.handle({ type: 'drop-held', point });
};

const durationSeconds = Math.max(
  600,
  Number(process.env.DAPHNIA_CAPACITY_SECONDS ?? 4_800),
);
const stepSeconds = 0.5;
const sampleSeconds = 60;
const phytoplanktonInocula = Math.max(
  1,
  Math.floor(Number(process.env.DAPHNIA_CAPACITY_PHYTO ?? 3)),
);
const founders = Math.max(
  1,
  Math.floor(Number(process.env.DAPHNIA_CAPACITY_FOUNDERS ?? 3)),
);
const planktonicDecomposer = Math.max(
  0,
  Number(process.env.DAPHNIA_CAPACITY_DECOMPOSER ?? 0.8),
);
const harvestIntervalSeconds = Math.max(
  0,
  Number(process.env.DAPHNIA_CAPACITY_HARVEST_INTERVAL ?? 0),
);
const harvestStartSeconds = Math.max(
  0,
  Number(process.env.DAPHNIA_CAPACITY_HARVEST_START ?? 2_400),
);

const scenarioId = (
  process.env.DAPHNIA_CAPACITY_SCENARIO === 'laboratory'
    ? 'laboratory'
    : 'mission-7'
) satisfies ScenarioId;
const world = new SimulationWorld(scenarioId);
for (let index = 0; index < phytoplanktonInocula; index += 1) {
  placePlankton(world, 'phytoplankton', {
    x: 360 + index * 240,
    y: 250 + (index % 2) * 160,
  });
}
for (let index = 0; index < founders; index += 1) {
  placePlankton(world, 'daphnia', {
    x: 440 + index * 160,
    y: 300 + (index % 2) * 100,
  });
}

const internals = world as unknown as CapacityWorldInternals;
if (planktonicDecomposer > 0) {
  internals.biogeochemistry.addPlanktonicDecomposer(
    { x: 600, y: 400 },
    planktonicDecomposer,
  );
}
const waterCellCount = 36 * 20;
const daylight = Array.from({ length: waterCellCount }, () => 72);
const night = Array.from({ length: waterCellCount }, () => 4);
const samples: Array<{
  time: number;
  count: number;
  births: number;
  deaths: number;
  harvested: number;
  phytoplankton: number;
  adultBiomass: number;
  juvenileBiomass: number;
}> = [];

let nextSample = 0;
let nextHarvest = harvestStartSeconds;
let harvested = 0;
for (let time = 0; time <= durationSeconds + 1e-9; time += stepSeconds) {
  const cycle = time % 360;
  internals.biogeochemistry.setTransportLight(
    cycle >= 300 ? night : daylight,
  );
  internals.biogeochemistry.beginStep(stepSeconds);
  internals.biogeochemistry.advanceTemperature(stepSeconds, 22);
  for (const animal of internals.animals) {
    if (animal.speciesId !== 'daphnia') continue;
    internals.stepDaphniaMotion(animal, stepSeconds);
  }
  internals.stepDaphniaEcology(stepSeconds);
  internals.biogeochemistry.advance(stepSeconds, []);
  if (
    harvestIntervalSeconds > 0 &&
    time + 1e-9 >= nextHarvest
  ) {
    const prey = internals.animals
      .filter((animal) => animal.speciesId === 'daphnia')
      .sort((left, right) => {
        if (left.lifeStage !== right.lifeStage) {
          return left.lifeStage === 'adult' ? -1 : 1;
        }
        return right.ageSeconds - left.ageSeconds;
      })[0];
    if (prey) {
      internals.killAnimal(prey, 'predation');
      internals.animals = internals.animals.filter(
        (animal) => animal.id !== prey.id,
      );
      internals.syncDaphniaIndividuals();
      harvested += 1;
    }
    nextHarvest += harvestIntervalSeconds;
  }

  if (time + 1e-9 < nextSample) continue;
  const plankton = internals.biogeochemistry.planktonState();
  samples.push({
    time,
    count: plankton.approximateDaphniaCount,
    births: internals.animalPopulationEventTotals.births,
    deaths: internals.animalPopulationEventTotals.deaths,
    harvested,
    phytoplankton: plankton.phytoplanktonBiomass,
    adultBiomass: plankton.daphniaAdultBiomass,
    juvenileBiomass: plankton.daphniaJuvenileBiomass,
  });
  nextSample += sampleSeconds;
}

const final = samples.at(-1)!;
const assessmentWindowSeconds = Math.min(1_200, durationSeconds / 2);
const windowStart = samples.find(
  (sample) => sample.time >= durationSeconds - assessmentWindowSeconds,
) ?? samples[0]!;
const producedIndividuals = final.births - windowStart.births;
const harvestedInWindow = final.harvested - windowStart.harvested;
const naturalDeaths = final.deaths - windowStart.deaths - harvestedInWindow;
const grossBirthsPerSecond = producedIndividuals / assessmentWindowSeconds;
const naturalDeathsPerSecond = naturalDeaths / assessmentWindowSeconds;
const minimumReserve = Math.min(
  ...samples
    .filter((sample) => sample.time >= durationSeconds - assessmentWindowSeconds)
    .map((sample) => sample.count),
);

const adultFishMaintenancePerSecond =
  RICEFISH_ECOLOGY_RULES.adultBaseMetabolismPerSecond +
  RICEFISH_ECOLOGY_RULES.swimmingActivityCostPerSecond;
const retainedAdultDaphnia = (
  PLANKTON_ECOLOGY_RULES.daphnia.adultStructuralBiomass +
  PLANKTON_ECOLOGY_RULES.daphnia.reproductiveReserveFloor
) * WATER_CYCLE_RULES.ricefish.assimilationFraction;
const maintenancePreyPerSecond = adultFishMaintenancePerSecond /
  Math.max(1e-9, retainedAdultDaphnia);
const replacementMarginPerSecond = Math.max(
  0,
  grossBirthsPerSecond - naturalDeathsPerSecond,
);

console.log(JSON.stringify({
  setup: {
    durationSeconds,
    phytoplanktonInocula,
    founders,
    broodCooldownSeconds:
      PLANKTON_ECOLOGY_RULES.daphnia.broodCooldownSeconds,
    broodSize: [
      PLANKTON_ECOLOGY_RULES.daphnia.minimumBroodSize,
      PLANKTON_ECOLOGY_RULES.daphnia.maximumBroodSize,
    ],
  },
  final,
  lastWindow: {
    seconds: assessmentWindowSeconds,
    minimumReserve,
    producedIndividuals,
    naturalDeaths,
    harvested: harvestedInWindow,
    grossBirthsPerSecond,
    naturalDeathsPerSecond,
    replacementMarginPerSecond,
  },
  oneAdultRicefishLowerBound: {
    maintenanceBiomassPerSecond: adultFishMaintenancePerSecond,
    retainedBiomassPerAdultDaphnia: retainedAdultDaphnia,
    maintenancePreyPerSecond,
    maintenancePreyPerMinute: maintenancePreyPerSecond * 60,
    note:
      '활동·성장·번식과 치어 손실을 제외한 최소 유지량이므로 실제 요구량은 더 큽니다.',
  },
  supportsOneAdultFishFromNetSurplus:
    replacementMarginPerSecond >= maintenancePreyPerSecond &&
    minimumReserve >= 8,
  samples,
}, null, 2));
