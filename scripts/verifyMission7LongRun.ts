import { SimulationWorld } from '../src/simulation/SimulationWorld';
import {
  continuousBodyMassFeedingScale,
  continuousBodyMassMaintenance,
  daphniaSuspendedFoodResponse,
  PLANKTON_ECOLOGY_RULES,
  SHRIMP_ECOLOGY_RULES,
  WATER_CYCLE_RULES,
} from '../src/simulation/config';
import { CLOSED_MATERIAL_RELATIVE_TOLERANCE } from '../src/simulation/stoichiometry';
import {
  MISSION7_LONG_RUN_ACCEPTANCE,
  acuteWaterDeathCount,
  analyzeRecoveryOscillation,
  summarizePopulationEvents,
} from './mission7LongRunAcceptance';
import {
  VallisneriaLineageTracker,
  applyMission7AcceptanceFixture,
  type Mission7AcceptanceScenarioId,
} from './mission7AcceptanceMatrix';
import type {
  AnimalPopulationEventSnapshot,
} from '../src/simulation/types';

const DURATION_SECONDS = Number(
  process.env.MISSION7_VERIFY_DURATION_SECONDS ??
    MISSION7_LONG_RUN_ACCEPTANCE.durationSeconds,
);
const TAIL_START_SECONDS = MISSION7_LONG_RUN_ACCEPTANCE.tailStartSeconds;
const SAMPLE_SECONDS = MISSION7_LONG_RUN_ACCEPTANCE.sampleSeconds;

type MutableDaphniaRules = {
  phytoplanktonHalfSaturation: number;
  phytoplanktonResponseExponent: number;
  minimumFoodQualityForReproduction: number;
  highFoodBroodResponseThreshold: number;
  maximumFiltrationPerBiomassSecond: number;
  filtrationMassExponent: number;
  reproductionAllocationPerSecondIndividual: number;
  reproductionFoodResponseExponent: number;
  broodDevelopmentSeconds: number;
  broodCooldownSeconds: number;
  minimumBroodSize: number;
  maximumBroodSize: number;
  minimumLifespanSeconds: number;
  maximumLifespanSeconds: number;
};

// Optional overrides make calibration sweeps use the exact same full-stock
// fixture as the acceptance gate. The normal package command supplies none,
// so it always verifies the committed rule set.
const mutableDaphniaRules =
  PLANKTON_ECOLOGY_RULES.daphnia as unknown as MutableDaphniaRules;
if (process.env.MISSION7_VERIFY_PHYTO_HALF_SATURATION) {
  mutableDaphniaRules.phytoplanktonHalfSaturation = Number(
    process.env.MISSION7_VERIFY_PHYTO_HALF_SATURATION,
  );
}
if (process.env.MISSION7_VERIFY_PHYTO_RESPONSE_EXPONENT) {
  mutableDaphniaRules.phytoplanktonResponseExponent = Number(
    process.env.MISSION7_VERIFY_PHYTO_RESPONSE_EXPONENT,
  );
}
if (process.env.MISSION7_VERIFY_REPRODUCTION_FOOD) {
  mutableDaphniaRules.minimumFoodQualityForReproduction = Number(
    process.env.MISSION7_VERIFY_REPRODUCTION_FOOD,
  );
}
if (process.env.MISSION7_VERIFY_HIGH_FOOD_BROOD) {
  mutableDaphniaRules.highFoodBroodResponseThreshold = Number(
    process.env.MISSION7_VERIFY_HIGH_FOOD_BROOD,
  );
}
if (process.env.MISSION7_VERIFY_DAPHNIA_FILTRATION) {
  mutableDaphniaRules.maximumFiltrationPerBiomassSecond = Number(
    process.env.MISSION7_VERIFY_DAPHNIA_FILTRATION,
  );
}
if (process.env.MISSION7_VERIFY_FILTRATION_EXPONENT) {
  mutableDaphniaRules.filtrationMassExponent = Number(
    process.env.MISSION7_VERIFY_FILTRATION_EXPONENT,
  );
}
if (process.env.MISSION7_VERIFY_EGG_ALLOCATION) {
  mutableDaphniaRules.reproductionAllocationPerSecondIndividual = Number(
    process.env.MISSION7_VERIFY_EGG_ALLOCATION,
  );
}
if (process.env.MISSION7_VERIFY_REPRODUCTION_RESPONSE_EXPONENT) {
  mutableDaphniaRules.reproductionFoodResponseExponent = Number(
    process.env.MISSION7_VERIFY_REPRODUCTION_RESPONSE_EXPONENT,
  );
}
if (process.env.MISSION7_VERIFY_BROOD_COOLDOWN) {
  mutableDaphniaRules.broodCooldownSeconds = Number(
    process.env.MISSION7_VERIFY_BROOD_COOLDOWN,
  );
}
if (process.env.MISSION7_VERIFY_BROOD_DEVELOPMENT) {
  mutableDaphniaRules.broodDevelopmentSeconds = Number(
    process.env.MISSION7_VERIFY_BROOD_DEVELOPMENT,
  );
}
if (process.env.MISSION7_VERIFY_MIN_BROOD) {
  mutableDaphniaRules.minimumBroodSize = Number(
    process.env.MISSION7_VERIFY_MIN_BROOD,
  );
}
if (process.env.MISSION7_VERIFY_MAX_BROOD) {
  mutableDaphniaRules.maximumBroodSize = Number(
    process.env.MISSION7_VERIFY_MAX_BROOD,
  );
}
if (process.env.MISSION7_VERIFY_LIFESPAN_MIN) {
  mutableDaphniaRules.minimumLifespanSeconds = Number(
    process.env.MISSION7_VERIFY_LIFESPAN_MIN,
  );
}
if (process.env.MISSION7_VERIFY_LIFESPAN_MAX) {
  mutableDaphniaRules.maximumLifespanSeconds = Number(
    process.env.MISSION7_VERIFY_LIFESPAN_MAX,
  );
}

const scenarioArgument = process.argv.find((argument) =>
  argument.startsWith('--scenario='),
);
const scenarioId = (
  scenarioArgument?.slice('--scenario='.length) ??
  'full-stock-stress'
) as Mission7AcceptanceScenarioId;
if (
  scenarioId !== 'starter-only-minimal' &&
  scenarioId !== 'full-stock-stress'
) {
  throw new Error(`Unknown Mission 7 acceptance scenario: ${scenarioId}`);
}
const world = new SimulationWorld('mission-7');
const fixture = applyMission7AcceptanceFixture(world, scenarioId);

world.handle({ type: 'start' });
world.handle({ type: 'set-speed', speed: 64 });

interface LongRunSample {
  time: number;
  daphnia: number;
  daphniaAdults: number;
  daphniaJuveniles: number;
  daphniaFounders: number;
  daphniaDescendants: number;
  daphniaMaximumGeneration: number;
  daphniaAdultMeanEnergy: number;
  daphniaAdultMinimumEnergy: number;
  daphniaAdultMeanStoredBiomass: number;
  daphniaAdultMeanReproductiveBiomass: number;
  daphniaAdultMeanCooldownSeconds: number;
  daphniaAdultGestating: number;
  daphniaAdultMeanRemainingLifeSeconds: number;
  daphniaAdultMeanLocalPhytoplankton: number;
  daphniaAdultMeanLocalBacterioplankton: number;
  daphniaAdultMeanPhytoplanktonResponse: number;
  daphniaAdultMeanPotentialReproductiveSurplusPerSecond: number;
  daphniaAdultFundedBroods: number;
  daphniaAdultCooldownReady: number;
  daphniaJuvenileMeanGrowthProgress: number;
  daphniaJuvenileMeanAgeSeconds: number;
  daphniaJuvenileMeanRemainingLifeSeconds: number;
  daphniaAdultEquivalentMatter: number;
  phytoplankton: number;
  shrimp: number;
  shrimpAdults: number;
  shrimpJuveniles: number;
  shrimpFemales: number;
  shrimpMales: number;
  shrimpAdultFemales: number;
  shrimpAdultMales: number;
  shrimpBornDescendants: number;
  shrimpFemaleMeanOvarianProgress: number;
  shrimpFemaleMeanReproductiveBiomass: number;
  shrimpReadyFemales: number;
  shrimpGestatingFemales: number;
  shrimpClosestAdultPairDistance: number | null;
  runners: number;
  vallisneriaBiomass: number;
  oxygen: number;
  toxicWaste: number;
  organicMatter: number;
  nutrients: number;
  dissolvedInorganicCarbon: number;
  decomposer: number;
  nitrifier: number;
  nitrogenDriftRatio: number;
  carbonDriftRatio: number;
  oxygenEquivalentDriftRatio: number;
}

const samples: LongRunSample[] = [];
const worldInternals = world as unknown as {
  animals: Array<{
    id: string;
    speciesId: string;
    position: Vec2;
    energy: number;
    health: number;
    behavior: string;
    targetCellId: string | null;
    storedBiomass: number;
    structuralBiomass: number;
    consumedBiomass: number;
    secondsSinceFood: number;
  }>;
  allCells(): Array<{
    id: string;
  }>;
  cellById(id: string): {
    id: string;
  } | undefined;
  edibleBiomass(cell: {
    id: string;
  }): number;
  shrimpSurfaceContactPoint(cell: {
    id: string;
  }): Vec2;
  biogeochemistry: {
    planktonAt(point: Vec2): {
      phytoplankton: number;
      planktonicDecomposer: number;
    };
  };
};
const observedAnimalEvents: AnimalPopulationEventSnapshot[] = [];
const bornShrimpIds = new Set<string>();
const lastShrimpForagingState = new Map<string, {
  time: number;
  behavior: string;
  targetCellId: string | null;
  targetFood: number;
  targetDistance: number | null;
  nearestFoodDistance: number | null;
  nearestFoodBiomass: number;
  storedBiomass: number;
  structuralBiomass: number;
  consumedBiomass: number;
  secondsSinceFood: number;
  health: number;
}>();
const captureShrimpForagingState = (time: number): void => {
  const edibleCells = worldInternals.allCells()
    .map((cell) => ({
      cell,
      food: worldInternals.edibleBiomass(cell),
      point: worldInternals.shrimpSurfaceContactPoint(cell),
    }))
    .filter(({ food }) => food > 0);
  for (const animal of worldInternals.animals) {
    if (animal.speciesId !== 'cherry-shrimp') continue;
    const target = animal.targetCellId
      ? worldInternals.cellById(animal.targetCellId)
      : undefined;
    const targetPoint = target
      ? worldInternals.shrimpSurfaceContactPoint(target)
      : null;
    const nearest = edibleCells.reduce<{
      distance: number;
      food: number;
    } | null>((best, candidate) => {
      const distance = Math.hypot(
        candidate.point.x - animal.position.x,
        candidate.point.y - animal.position.y,
      );
      return !best || distance < best.distance
        ? { distance, food: candidate.food }
        : best;
    }, null);
    lastShrimpForagingState.set(animal.id, {
      time,
      behavior: animal.behavior,
      targetCellId: animal.targetCellId,
      targetFood: target ? worldInternals.edibleBiomass(target) : 0,
      targetDistance: targetPoint
        ? Math.hypot(
          targetPoint.x - animal.position.x,
          targetPoint.y - animal.position.y,
        )
        : null,
      nearestFoodDistance: nearest?.distance ?? null,
      nearestFoodBiomass: nearest?.food ?? 0,
      storedBiomass: animal.storedBiomass,
      structuralBiomass: animal.structuralBiomass,
      consumedBiomass: animal.consumedBiomass,
      secondsSinceFood: animal.secondsSinceFood,
      health: animal.health,
    });
  }
};
let lastObservedEventSequence = 0;
const captureAnimalEvents = (
  events: AnimalPopulationEventSnapshot[],
): void => {
  for (const event of events) {
    if (event.sequence <= lastObservedEventSequence) continue;
    observedAnimalEvents.push(event);
    if (
      event.speciesId === 'cherry-shrimp' &&
      event.kind === 'birth'
    ) {
      bornShrimpIds.add(event.animalId);
    }
    lastObservedEventSequence = event.sequence;
  }
};
let nextSample = 0;
let snapshot = world.snapshot();
const vallisneriaLineage = new VallisneriaLineageTracker();
vallisneriaLineage.observe(snapshot.plants);
captureAnimalEvents(snapshot.animalPopulationEvents);
while (snapshot.elapsedSeconds < DURATION_SECONDS) {
  captureShrimpForagingState(snapshot.elapsedSeconds);
  world.tick(0.1);
  snapshot = world.snapshot();
  vallisneriaLineage.observe(snapshot.plants);
  captureAnimalEvents(snapshot.animalPopulationEvents);
  if (snapshot.elapsedSeconds + 1e-6 < nextSample) continue;
  const livingDaphnia = snapshot.animals.filter(
    (animal) => animal.speciesId === 'daphnia',
  );
  const livingShrimp = snapshot.animals.filter(
    (animal) => animal.speciesId === 'cherry-shrimp',
  );
  const savedAnimals = world.exportSaveData().animals;
  const savedDaphnia = savedAnimals.filter(
    (animal) => animal.speciesId === 'daphnia',
  );
  const savedShrimpAdults = savedAnimals.filter(
    (animal) =>
      animal.speciesId === 'cherry-shrimp' &&
      animal.lifeStage === 'adult',
  );
  const savedShrimpFemales = savedShrimpAdults.filter(
    (animal) => animal.sex === 'female',
  );
  const savedShrimpMales = savedShrimpAdults.filter(
    (animal) => animal.sex === 'male',
  );
  const savedDaphniaAdults = savedDaphnia.filter(
    (animal) => animal.lifeStage === 'adult',
  );
  const savedDaphniaJuveniles = savedDaphnia.filter(
    (animal) => animal.lifeStage === 'juvenile',
  );
  const mean = (values: number[]): number =>
    values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : 0;
  const daphniaAdultFeedingState = savedDaphniaAdults.map((animal) => {
    const local = worldInternals.biogeochemistry.planktonAt(animal.position);
    const rules = PLANKTON_ECOLOGY_RULES.daphnia;
    const {
      phytoplanktonPotential: phytoResponse,
      combinedResponse,
      bacteriaShare,
    } = daphniaSuspendedFoodResponse(
      local.phytoplankton,
      local.planktonicDecomposer,
    );
    const bodyMass = Math.max(
      0,
      animal.structuralBiomass +
        animal.storedBiomass +
        (animal.reproductiveBiomass ?? 0),
    );
    const filtrationBodyMass = bodyMass <= 0
      ? 0
      : rules.representativeAdultBiomass *
        continuousBodyMassFeedingScale(
          bodyMass,
          rules.representativeAdultBiomass,
          rules.filtrationMassExponent,
        );
    const requestedPerSecond =
      filtrationBodyMass *
      rules.maximumFiltrationPerBiomassSecond *
      combinedResponse;
    const phytoAssimilation =
      requestedPerSecond *
      (1 - bacteriaShare) *
      rules.phytoplanktonAssimilation;
    const bacteriaAssimilation =
      requestedPerSecond *
      bacteriaShare *
      rules.bacterioplanktonAssimilation;
    const maintenance = continuousBodyMassMaintenance(
      bodyMass,
      rules.representativeAdultBiomass,
      rules.adultMaintenancePerSecond,
      rules.maintenanceMassExponent,
    );
    return {
      localPhytoplankton: local.phytoplankton,
      localBacterioplankton: local.planktonicDecomposer,
      phytoResponse,
      potentialReproductiveSurplus: Math.max(
        0,
        phytoAssimilation -
          Math.max(0, maintenance - bacteriaAssimilation),
      ),
    };
  });
  const daphniaRules = PLANKTON_ECOLOGY_RULES.daphnia;
  const daphniaAdultReferenceMatter =
    daphniaRules.adultStructuralBiomass +
    daphniaRules.suppliedAdultReserveBiomass;
  const daphniaAdultEquivalentMatter = savedDaphnia.reduce(
    (total, animal) =>
      total + (
        animal.structuralBiomass +
        animal.storedBiomass +
        (animal.reproductiveBiomass ?? 0)
      ) / daphniaAdultReferenceMatter,
    0,
  );
  samples.push({
    time: snapshot.elapsedSeconds,
    daphnia: snapshot.biogeochemistry.plankton.approximateDaphniaCount,
    daphniaAdults: snapshot.animalPopulation.daphnia.adults,
    daphniaJuveniles: snapshot.animalPopulation.daphnia.juveniles,
    daphniaFounders: livingDaphnia.filter(
      (animal) =>
        (animal.generation ?? 0) === 0,
    ).length,
    daphniaDescendants: livingDaphnia.filter(
      (animal) =>
        (animal.generation ?? 0) >= 1,
    ).length,
    daphniaMaximumGeneration: Math.max(
      0,
      ...livingDaphnia.map((animal) => animal.generation ?? 0),
    ),
    daphniaAdultMeanEnergy: mean(
      savedDaphniaAdults.map((animal) => animal.energy),
    ),
    daphniaAdultMinimumEnergy: savedDaphniaAdults.length
      ? Math.min(...savedDaphniaAdults.map((animal) => animal.energy))
      : 0,
    daphniaAdultMeanStoredBiomass: mean(
      savedDaphniaAdults.map((animal) => animal.storedBiomass),
    ),
    daphniaAdultMeanReproductiveBiomass: mean(
      savedDaphniaAdults.map((animal) => animal.reproductiveBiomass ?? 0),
    ),
    daphniaAdultMeanCooldownSeconds: mean(
      savedDaphniaAdults.map((animal) => animal.reproductionCooldown),
    ),
    daphniaAdultGestating: savedDaphniaAdults.filter(
      (animal) => animal.gestationRemaining !== null,
    ).length,
    daphniaAdultMeanRemainingLifeSeconds: mean(
      savedDaphniaAdults.map(
        (animal) => animal.lifespanSeconds - animal.ageSeconds,
      ),
    ),
    daphniaAdultMeanLocalPhytoplankton: mean(
      daphniaAdultFeedingState.map((state) => state.localPhytoplankton),
    ),
    daphniaAdultMeanLocalBacterioplankton: mean(
      daphniaAdultFeedingState.map(
        (state) => state.localBacterioplankton,
      ),
    ),
    daphniaAdultMeanPhytoplanktonResponse: mean(
      daphniaAdultFeedingState.map((state) => state.phytoResponse),
    ),
    daphniaAdultMeanPotentialReproductiveSurplusPerSecond: mean(
      daphniaAdultFeedingState.map(
        (state) => state.potentialReproductiveSurplus,
      ),
    ),
    daphniaAdultFundedBroods: savedDaphniaAdults.filter(
      (animal) =>
        (animal.reproductiveBiomass ?? 0) + 1e-9 >=
        PLANKTON_ECOLOGY_RULES.daphnia.minimumBroodSize *
          PLANKTON_ECOLOGY_RULES.daphnia.juvenileBirthBiomass,
    ).length,
    daphniaAdultCooldownReady: savedDaphniaAdults.filter(
      (animal) => animal.reproductionCooldown <= 0,
    ).length,
    daphniaJuvenileMeanGrowthProgress: mean(
      savedDaphniaJuveniles.map((animal) => animal.growthProgress),
    ),
    daphniaJuvenileMeanAgeSeconds: mean(
      savedDaphniaJuveniles.map((animal) => animal.ageSeconds),
    ),
    daphniaJuvenileMeanRemainingLifeSeconds: mean(
      savedDaphniaJuveniles.map(
        (animal) => animal.lifespanSeconds - animal.ageSeconds,
      ),
    ),
    daphniaAdultEquivalentMatter,
    phytoplankton:
      snapshot.biogeochemistry.plankton.phytoplanktonBiomass,
    shrimp: snapshot.animalPopulation['cherry-shrimp'].total,
    shrimpAdults: snapshot.animalPopulation['cherry-shrimp'].adults,
    shrimpJuveniles: snapshot.animalPopulation['cherry-shrimp'].juveniles,
    shrimpFemales: livingShrimp.filter(
      (animal) => animal.sex === 'female',
    ).length,
    shrimpMales: livingShrimp.filter(
      (animal) => animal.sex === 'male',
    ).length,
    shrimpAdultFemales:
      snapshot.animalPopulation['cherry-shrimp'].adultFemales,
    shrimpAdultMales: snapshot.animalPopulation['cherry-shrimp'].adultMales,
    shrimpBornDescendants: livingShrimp.filter(
      (animal) => bornShrimpIds.has(animal.id),
    ).length,
    shrimpFemaleMeanOvarianProgress: mean(
      savedShrimpFemales.map((animal) => animal.ovarianProgress ?? 0),
    ),
    shrimpFemaleMeanReproductiveBiomass: mean(
      savedShrimpFemales.map(
        (animal) => animal.reproductiveBiomass ?? 0,
      ),
    ),
    shrimpReadyFemales: savedShrimpFemales.filter(
      (animal) =>
        (animal.ovarianProgress ?? 0) >= 1 &&
        (animal.reproductiveBiomass ?? 0) >=
          WATER_CYCLE_RULES.shrimp.juvenileBirthBiomass *
            SHRIMP_ECOLOGY_RULES.minimumClutchSize,
    ).length,
    shrimpGestatingFemales: savedShrimpFemales.filter(
      (animal) => animal.gestationRemaining !== null,
    ).length,
    shrimpClosestAdultPairDistance:
      savedShrimpFemales.length && savedShrimpMales.length
        ? Math.min(
          ...savedShrimpFemales.flatMap((female) =>
            savedShrimpMales.map((male) =>
              Math.hypot(
                female.position.x - male.position.x,
                female.position.y - male.position.y,
              ),
            ),
          ),
        )
        : null,
    runners: snapshot.plants.filter((plant) => plant.origin === 'runner').length,
    vallisneriaBiomass: snapshot.totalBiomass.vallisneria,
    oxygen: snapshot.biogeochemistry.average.oxygen,
    toxicWaste: snapshot.biogeochemistry.average.toxicWaste,
    organicMatter: snapshot.biogeochemistry.average.organicMatter,
    nutrients: snapshot.biogeochemistry.average.nutrients,
    dissolvedInorganicCarbon:
      snapshot.biogeochemistry.carbonCycle.dissolvedInorganicCarbon,
    decomposer: snapshot.biogeochemistry.biofilmTotals.decomposer,
    nitrifier: snapshot.biogeochemistry.biofilmTotals.nitrifier,
    nitrogenDriftRatio:
      snapshot.biogeochemistry.materialBalance.nitrogenDriftRatio,
    carbonDriftRatio:
      snapshot.biogeochemistry.materialBalance.carbonDriftRatio,
    oxygenEquivalentDriftRatio:
      snapshot.biogeochemistry.materialBalance.oxygenEquivalentDriftRatio,
  });
  nextSample += SAMPLE_SECONDS;
}

const tail = samples.filter((sample) => sample.time >= TAIL_START_SECONDS);
const daphniaSave = world.exportSaveData().animals.filter(
  (animal) => animal.speciesId === 'daphnia',
);
const finalDescendants = daphniaSave.filter(
  (animal) => (animal.generation ?? 0) >= 1,
);
const finalFounders = daphniaSave.filter(
  (animal) => (animal.generation ?? 0) === 0,
);
const daphniaTail = tail.map((sample) => sample.daphnia);
const phytoplanktonTail = tail.map((sample) => sample.phytoplankton);
const phytoplanktonOscillation = analyzeRecoveryOscillation(
  phytoplanktonTail,
  MISSION7_LONG_RUN_ACCEPTANCE.phytoplankton.meaningfulStep,
  MISSION7_LONG_RUN_ACCEPTANCE.phytoplankton.minimumRecovery,
);
const balance = snapshot.biogeochemistry.materialBalance;
const tailAnimalEvents = observedAnimalEvents.filter(
  (event) => event.elapsedSeconds >= TAIL_START_SECONDS,
);
const allDaphniaEvents = summarizePopulationEvents(
  observedAnimalEvents,
  'daphnia',
);
const tailDaphniaEvents = summarizePopulationEvents(
  tailAnimalEvents,
  'daphnia',
);
const allShrimpEvents = summarizePopulationEvents(
  observedAnimalEvents,
  'cherry-shrimp',
);
const tailShrimpEvents = summarizePopulationEvents(
  tailAnimalEvents,
  'cherry-shrimp',
);
const firstDaphniaExtinction = samples.find((sample) => sample.daphnia === 0);
const firstShrimpExtinction = samples.find((sample) => sample.shrimp === 0);

interface Check {
  label: string;
  passed: boolean;
  detail: string;
}
const checks: Check[] = [];
const check = (label: string, passed: boolean, detail: string): void => {
  checks.push({ label, passed, detail });
};
const range = (values: number[]): [number, number] => [
  Math.min(...values),
  Math.max(...values),
];
const mean = (values: number[]): number =>
  values.reduce((total, value) => total + value, 0) /
  Math.max(1, values.length);
const [daphniaMinimum, daphniaMaximum] = range(daphniaTail);
const daphniaMean = mean(daphniaTail);
const {
  minimum: phytoplanktonMinimum,
  maximum: phytoplanktonMaximum,
} = phytoplanktonOscillation;
const [shrimpMinimum] = range(tail.map((sample) => sample.shrimp));
const [oxygenMinimum] = range(tail.map((sample) => sample.oxygen));
const [, toxicWasteMaximum] = range(
  tail.map((sample) => sample.toxicWaste),
);
const [, organicMatterMaximum] = range(
  tail.map((sample) => sample.organicMatter),
);
const [runnerMinimum] = range(tail.map((sample) => sample.runners));
const [decomposerMinimum] = range(tail.map((sample) => sample.decomposer));
const [nitrifierMinimum] = range(tail.map((sample) => sample.nitrifier));
const maximumNitrogenDrift = Math.max(
  ...samples.map((sample) => Math.abs(sample.nitrogenDriftRatio)),
);
const maximumCarbonDrift = Math.max(
  ...samples.map((sample) => Math.abs(sample.carbonDriftRatio)),
);
const maximumOxygenEquivalentDrift = Math.max(
  ...samples.map((sample) => Math.abs(sample.oxygenEquivalentDriftRatio)),
);
const allWaterValuesFiniteAndNonNegative = samples.every((sample) =>
  [
    sample.oxygen,
    sample.toxicWaste,
    sample.organicMatter,
    sample.nutrients,
    sample.dissolvedInorganicCarbon,
  ].every((value) => Number.isFinite(value) && value >= 0),
);
const finalShrimp = snapshot.animals.filter(
  (animal) => animal.speciesId === 'cherry-shrimp',
);
const vallisneriaMaximumLivingGeneration =
  vallisneriaLineage.maximumLivingGeneration(snapshot.plants);
const finalBornShrimp = finalShrimp.filter(
  (animal) => bornShrimpIds.has(animal.id),
);
check(
  '10,800초 장기 검증 구간 완료',
  snapshot.elapsedSeconds >= DURATION_SECONDS &&
    tail.length >=
      Math.floor(
        (DURATION_SECONDS - TAIL_START_SECONDS) / SAMPLE_SECONDS,
      ),
  `elapsed=${snapshot.elapsedSeconds.toFixed(1)}, tailSamples=${tail.length}`,
);
check(
  '후반 물벼룩 세대 절멸 없음',
  daphniaMinimum >=
      MISSION7_LONG_RUN_ACCEPTANCE.daphnia.minimumCount &&
    daphniaMean >=
      MISSION7_LONG_RUN_ACCEPTANCE.daphnia.minimumMeanCount &&
    snapshot.biogeochemistry.plankton.approximateDaphniaCount >=
      MISSION7_LONG_RUN_ACCEPTANCE.daphnia.minimumFinalCount &&
    daphniaMaximum <=
      MISSION7_LONG_RUN_ACCEPTANCE.daphnia.maximumCount,
  `min=${daphniaMinimum}, mean=${daphniaMean.toFixed(2)}, ` +
    `final=${snapshot.biogeochemistry.plankton.approximateDaphniaCount}, ` +
    `max=${daphniaMaximum}`,
);
check(
  '후반 물벼룩 출생·성숙 계속',
  tailDaphniaEvents.births >=
      MISSION7_LONG_RUN_ACCEPTANCE.daphnia.minimumTailBirths &&
    tailDaphniaEvents.maturations >=
      MISSION7_LONG_RUN_ACCEPTANCE.daphnia.minimumTailMaturations,
  `births=${tailDaphniaEvents.births}, ` +
    `maturations=${tailDaphniaEvents.maturations}`,
);
check(
  '창시자 교체와 후속 세대 유지',
  finalFounders.length === 0 &&
    finalDescendants.length >=
      MISSION7_LONG_RUN_ACCEPTANCE.daphnia.minimumFinalDescendants &&
    finalDescendants.some(
      (animal) =>
        (animal.generation ?? 0) >=
          MISSION7_LONG_RUN_ACCEPTANCE.daphnia.minimumLivingGeneration,
    ),
  `founders=${finalFounders.length}, descendants=${finalDescendants.length}, ` +
    `maxGeneration=${Math.max(0, ...daphniaSave.map((animal) => animal.generation ?? 0))}`,
);
check(
  '후반 물벼룩 사망 원인',
  tailDaphniaEvents.deathsByCause['old-age'] > 0 &&
    acuteWaterDeathCount(tailDaphniaEvents) === 0 &&
    tailDaphniaEvents.deathsByCause.predation === 0 &&
    tailDaphniaEvents.deathsByCause.starvation <=
      tailDaphniaEvents.deathsByCause['old-age'],
  `oldAge=${tailDaphniaEvents.deathsByCause['old-age']}, ` +
    `starvation=${tailDaphniaEvents.deathsByCause.starvation}, ` +
    `waterStress=${acuteWaterDeathCount(tailDaphniaEvents)}, ` +
    `predation=${tailDaphniaEvents.deathsByCause.predation}`,
);
check(
  '식물플랑크톤 고갈 뒤 회복',
  phytoplanktonMinimum >=
      MISSION7_LONG_RUN_ACCEPTANCE.phytoplankton.minimumBiomass &&
    phytoplanktonOscillation.span >=
      MISSION7_LONG_RUN_ACCEPTANCE.phytoplankton.minimumSpan &&
    phytoplanktonOscillation.hasDepletionAndRecovery &&
    phytoplanktonOscillation.directionChanges >= 1,
  `min=${phytoplanktonMinimum.toFixed(3)}, ` +
    `max=${phytoplanktonMaximum.toFixed(3)}, ` +
    `span=${phytoplanktonOscillation.span.toFixed(3)}, ` +
    `decline=${phytoplanktonOscillation.largestDeclineBeforeTrough.toFixed(3)}, ` +
    `recovery=${phytoplanktonOscillation.largestRecoveryAfterTrough.toFixed(3)}, ` +
    `turns=${phytoplanktonOscillation.directionChanges}`,
);
check(
  '나사말 러너 세대 유지',
  snapshot.plants.filter((plant) => plant.origin === 'supplied').length === 0 &&
    runnerMinimum >=
      MISSION7_LONG_RUN_ACCEPTANCE.vallisneria.minimumTailRunners &&
    snapshot.plants.filter((plant) => plant.origin === 'runner').length >=
      MISSION7_LONG_RUN_ACCEPTANCE.vallisneria.minimumFinalRunners &&
    snapshot.totalBiomass.vallisneria >
      MISSION7_LONG_RUN_ACCEPTANCE.vallisneria.minimumFinalBiomass &&
    vallisneriaMaximumLivingGeneration >= 2,
  `supplied=${snapshot.plants.filter((plant) => plant.origin === 'supplied').length}, ` +
    `tailRunnerMin=${runnerMinimum}, ` +
    `runners=${snapshot.plants.filter((plant) => plant.origin === 'runner').length}, ` +
    `maxGeneration=${vallisneriaMaximumLivingGeneration}, ` +
    `biomass=${snapshot.totalBiomass.vallisneria.toFixed(3)}`,
);
check(
  '체리새우 후반 세대교체',
  shrimpMinimum >= MISSION7_LONG_RUN_ACCEPTANCE.shrimp.minimumCount &&
    tailShrimpEvents.births >=
      MISSION7_LONG_RUN_ACCEPTANCE.shrimp.minimumTailBirths &&
    tailShrimpEvents.maturations >=
      MISSION7_LONG_RUN_ACCEPTANCE.shrimp.minimumTailMaturations &&
    finalBornShrimp.length >= 2,
  `tailMin=${shrimpMinimum}, births=${tailShrimpEvents.births}, ` +
    `maturations=${tailShrimpEvents.maturations}, ` +
    `finalBorn=${finalBornShrimp.length}`,
);
check(
  '체리새우 암수 계통 유지',
  finalShrimp.some((animal) => animal.sex === 'female') &&
    finalShrimp.some((animal) => animal.sex === 'male') &&
    snapshot.animalPopulation['cherry-shrimp'].adults > 0,
  `livingFemales=${finalShrimp.filter((animal) => animal.sex === 'female').length}, ` +
    `livingMales=${finalShrimp.filter((animal) => animal.sex === 'male').length}, ` +
    `adultFemales=${snapshot.animalPopulation['cherry-shrimp'].adultFemales}, ` +
    `adultMales=${snapshot.animalPopulation['cherry-shrimp'].adultMales}`,
);
check(
  '체리새우 후반 사망 원인',
  tailShrimpEvents.deathsByCause['old-age'] > 0 &&
    acuteWaterDeathCount(tailShrimpEvents) === 0 &&
    tailShrimpEvents.deathsByCause.predation === 0 &&
    tailShrimpEvents.deathsByCause.starvation <=
      tailShrimpEvents.deathsByCause['old-age'],
  `oldAge=${tailShrimpEvents.deathsByCause['old-age']}, ` +
    `starvation=${tailShrimpEvents.deathsByCause.starvation}, ` +
    `waterStress=${acuteWaterDeathCount(tailShrimpEvents)}, ` +
    `predation=${tailShrimpEvents.deathsByCause.predation}`,
);
check(
  '두 부착 균 군집 후반 유지',
  decomposerMinimum > 0 && nitrifierMinimum > 0,
  `decomposerMin=${decomposerMinimum.toFixed(3)}, ` +
    `nitrifierMin=${nitrifierMinimum.toFixed(3)}, ` +
    `decomposerFinal=${snapshot.biogeochemistry.biofilmTotals.decomposer.toFixed(3)}, ` +
    `nitrifierFinal=${snapshot.biogeochemistry.biofilmTotals.nitrifier.toFixed(3)}`,
);
check(
  '장기 수질 안전',
  allWaterValuesFiniteAndNonNegative &&
    oxygenMinimum >
      MISSION7_LONG_RUN_ACCEPTANCE.water.minimumOxygen &&
    toxicWasteMaximum <
      MISSION7_LONG_RUN_ACCEPTANCE.water.maximumToxicWaste &&
    organicMatterMaximum <
      MISSION7_LONG_RUN_ACCEPTANCE.water.maximumOrganicMatter,
  `oxygenMin=${oxygenMinimum.toFixed(3)}, ` +
    `toxicMax=${toxicWasteMaximum.toFixed(3)}, ` +
    `organicMax=${organicMatterMaximum.toFixed(3)}, ` +
    `finiteNonNegative=${allWaterValuesFiniteAndNonNegative}`,
);
check(
  '전 구간 닫힌 물질 장부',
  maximumNitrogenDrift <
      CLOSED_MATERIAL_RELATIVE_TOLERANCE &&
    maximumCarbonDrift <
      CLOSED_MATERIAL_RELATIVE_TOLERANCE &&
    maximumOxygenEquivalentDrift <
      CLOSED_MATERIAL_RELATIVE_TOLERANCE,
  `maxN=${maximumNitrogenDrift.toExponential(3)}, ` +
    `maxC=${maximumCarbonDrift.toExponential(3)}, ` +
    `maxO=${maximumOxygenEquivalentDrift.toExponential(3)}, ` +
    `finalN=${balance.nitrogenDriftRatio.toExponential(3)}, ` +
    `finalC=${balance.carbonDriftRatio.toExponential(3)}, ` +
    `finalO=${balance.oxygenEquivalentDriftRatio.toExponential(3)}`,
);

const compactCensusSeconds = Number(
  process.env.MISSION7_VERIFY_CENSUS_SECONDS ?? 600,
);
const compactCensus = samples.filter(
  (sample) =>
    Math.abs(
      sample.time / compactCensusSeconds -
        Math.round(sample.time / compactCensusSeconds),
    ) < 0.02 ||
    sample === samples.at(-1),
).map((sample) => ({
  time: sample.time,
  daphnia: sample.daphnia,
  daphniaAdults: sample.daphniaAdults,
  daphniaJuveniles: sample.daphniaJuveniles,
  daphniaAdultMeanEnergy: sample.daphniaAdultMeanEnergy,
  daphniaAdultMinimumEnergy: sample.daphniaAdultMinimumEnergy,
  daphniaAdultMeanLocalPhytoplankton:
    sample.daphniaAdultMeanLocalPhytoplankton,
  daphniaAdultMeanPhytoplanktonResponse:
    sample.daphniaAdultMeanPhytoplanktonResponse,
  daphniaAdultFundedBroods: sample.daphniaAdultFundedBroods,
  daphniaAdultCooldownReady: sample.daphniaAdultCooldownReady,
  phytoplankton: sample.phytoplankton,
  shrimp: sample.shrimp,
  shrimpAdults: sample.shrimpAdults,
  shrimpJuveniles: sample.shrimpJuveniles,
  shrimpFemales: sample.shrimpFemales,
  shrimpMales: sample.shrimpMales,
  shrimpAdultFemales: sample.shrimpAdultFemales,
  shrimpAdultMales: sample.shrimpAdultMales,
  shrimpFemaleMeanOvarianProgress:
    sample.shrimpFemaleMeanOvarianProgress,
  shrimpFemaleMeanReproductiveBiomass:
    sample.shrimpFemaleMeanReproductiveBiomass,
  shrimpReadyFemales: sample.shrimpReadyFemales,
  shrimpGestatingFemales: sample.shrimpGestatingFemales,
  shrimpClosestAdultPairDistance:
    sample.shrimpClosestAdultPairDistance,
  decomposer: sample.decomposer,
  nitrifier: sample.nitrifier,
  oxygen: sample.oxygen,
  toxicWaste: sample.toxicWaste,
}));
const compactDaphniaStressDeaths = observedAnimalEvents
  .filter(
    (event) =>
      event.speciesId === 'daphnia' &&
      event.kind === 'death' &&
      event.cause !== 'old-age',
  )
  .filter((event, _index, events) =>
    process.env.MISSION7_VERIFY_DEATH_DETAIL === '1' ||
    event.cause !== 'starvation' ||
    events.filter(
      (candidate) =>
        candidate.cause === 'starvation' &&
        candidate.sequence <= event.sequence,
    ).length <= 3
  )
  .map((event) => ({
    time: event.elapsedSeconds,
    stage: event.lifeStage,
    cause: event.cause,
    age: event.ageSeconds,
    energy: event.energy,
    x: event.x,
    y: event.y,
    oxygen: event.water?.oxygen ?? null,
    toxicWaste: event.water?.toxicWaste ?? null,
    temperature: event.temperature,
  }));

if (process.env.MISSION7_VERIFY_COMPACT === '1') {
  console.log(JSON.stringify({
    scenario: scenarioId,
    duration: snapshot.elapsedSeconds,
    tail: {
      daphniaMinimum,
      daphniaMean,
      daphniaMaximum,
      phytoplanktonMinimum,
      phytoplanktonMaximum,
      shrimpMinimum,
      oxygenMinimum,
      toxicWasteMaximum,
    },
    final: {
      daphnia: snapshot.biogeochemistry.plankton.approximateDaphniaCount,
      phytoplankton:
        snapshot.biogeochemistry.plankton.phytoplanktonBiomass,
      shrimp: snapshot.animalPopulation['cherry-shrimp'].total,
      shrimpFemales:
        finalShrimp.filter((animal) => animal.sex === 'female').length,
      shrimpMales:
        finalShrimp.filter((animal) => animal.sex === 'male').length,
      shrimpAdultFemales:
        snapshot.animalPopulation['cherry-shrimp'].adultFemales,
      shrimpAdultMales:
        snapshot.animalPopulation['cherry-shrimp'].adultMales,
      oedogonium: snapshot.totalBiomass.oedogonium,
      nitzschia: snapshot.totalBiomass.nitzschia,
      decomposer: snapshot.biogeochemistry.biofilmTotals.decomposer,
      nitrifier: snapshot.biogeochemistry.biofilmTotals.nitrifier,
    },
    extinction: {
      daphniaAtSeconds: firstDaphniaExtinction?.time ?? null,
      shrimpAtSeconds: firstShrimpExtinction?.time ?? null,
    },
    events: {
      daphnia: allDaphniaEvents,
      shrimp: allShrimpEvents,
      daphniaStressDeaths: compactDaphniaStressDeaths,
      shrimpLifecycle: process.env.MISSION7_VERIFY_SHRIMP_LIFECYCLE === '1'
        ? observedAnimalEvents
          .filter(
            (event) =>
              event.speciesId === 'cherry-shrimp' &&
              (
                event.kind === 'birth' ||
                event.kind === 'matured' ||
                event.kind === 'death'
              ),
          )
          .map((event) => ({
            time: event.elapsedSeconds,
            kind: event.kind,
            id: event.animalId,
            parentId: event.parentId,
            stage: event.lifeStage,
            sex: event.sex,
            cause: event.cause,
            age: event.ageSeconds,
            energy: event.energy,
          }))
        : undefined,
      shrimpDeaths: observedAnimalEvents
        .filter(
          (event) =>
            event.speciesId === 'cherry-shrimp' &&
            event.kind === 'death' &&
            (
              process.env.MISSION7_VERIFY_DEATH_DETAIL === '1' ||
              event.cause !== 'old-age'
            ),
        )
        .map((event) => ({
          time: event.elapsedSeconds,
          id: event.animalId,
          stage: event.lifeStage,
          sex: event.sex,
          cause: event.cause,
          age: event.ageSeconds,
          energy: event.energy,
          x: event.x,
          y: event.y,
          foraging: lastShrimpForagingState.get(event.animalId) ?? null,
        })),
    },
    census: compactCensus,
    failedChecks: checks.filter((item) => !item.passed),
    maximumMaterialDrift: {
      nitrogen: maximumNitrogenDrift,
      carbon: maximumCarbonDrift,
      oxygenEquivalent: maximumOxygenEquivalentDrift,
    },
  }, null, 2));
} else console.log(JSON.stringify({
  acceptanceScenario: {
    id: scenarioId,
    label: fixture.label,
    ricefishPredationLoad: fixture.ricefishPredationLoad,
  },
  duration: snapshot.elapsedSeconds,
  daphniaRules: {
    adultMatter:
      PLANKTON_ECOLOGY_RULES.daphnia.adultStructuralBiomass +
      PLANKTON_ECOLOGY_RULES.daphnia.suppliedAdultReserveBiomass,
    juvenileBirthMatter:
      PLANKTON_ECOLOGY_RULES.daphnia.juvenileBirthBiomass,
    filtrationPerBiomassSecond:
      PLANKTON_ECOLOGY_RULES.daphnia.maximumFiltrationPerBiomassSecond,
    filtrationMassExponent:
      PLANKTON_ECOLOGY_RULES.daphnia.filtrationMassExponent,
    phytoplanktonHalfSaturation:
      PLANKTON_ECOLOGY_RULES.daphnia.phytoplanktonHalfSaturation,
    phytoplanktonResponseExponent:
      PLANKTON_ECOLOGY_RULES.daphnia.phytoplanktonResponseExponent,
    minimumFoodQualityForReproduction:
      PLANKTON_ECOLOGY_RULES.daphnia.minimumFoodQualityForReproduction,
    highFoodBroodResponseThreshold:
      PLANKTON_ECOLOGY_RULES.daphnia.highFoodBroodResponseThreshold,
    lifespanSeconds: [
      PLANKTON_ECOLOGY_RULES.daphnia.minimumLifespanSeconds,
      PLANKTON_ECOLOGY_RULES.daphnia.maximumLifespanSeconds,
    ],
    maturationSeconds:
      PLANKTON_ECOLOGY_RULES.daphnia.maturationSeconds,
    broodCooldownSeconds:
      PLANKTON_ECOLOGY_RULES.daphnia.broodCooldownSeconds,
    reproductionAllocationPerSecondIndividual:
      PLANKTON_ECOLOGY_RULES.daphnia.reproductionAllocationPerSecondIndividual,
    broodSize: [
      PLANKTON_ECOLOGY_RULES.daphnia.minimumBroodSize,
      PLANKTON_ECOLOGY_RULES.daphnia.maximumBroodSize,
    ],
  },
  tail: {
    daphniaMinimum,
    daphniaMean,
    daphniaMaximum,
    phytoplanktonMinimum,
    phytoplanktonMaximum,
    phytoplanktonOscillation,
    shrimpMinimum,
    runnerMinimum,
    decomposerMinimum,
    nitrifierMinimum,
    oxygenMinimum,
    toxicWasteMaximum,
    organicMatterMaximum,
  },
  final: {
    daphnia: snapshot.biogeochemistry.plankton.approximateDaphniaCount,
    finalFounders: finalFounders.length,
    finalDescendants: finalDescendants.length,
    maximumGeneration: Math.max(
      0,
      ...daphniaSave.map((animal) => animal.generation ?? 0),
    ),
    phytoplankton:
      snapshot.biogeochemistry.plankton.phytoplanktonBiomass,
    shrimp: snapshot.animalPopulation['cherry-shrimp'].total,
    shrimpFemales:
      finalShrimp.filter((animal) => animal.sex === 'female').length,
    shrimpMales:
      finalShrimp.filter((animal) => animal.sex === 'male').length,
    shrimpAdultFemales:
      snapshot.animalPopulation['cherry-shrimp'].adultFemales,
    shrimpAdultMales:
      snapshot.animalPopulation['cherry-shrimp'].adultMales,
    shrimpBornDescendants: finalBornShrimp.length,
    suppliedVallisneria:
      snapshot.plants.filter((plant) => plant.origin === 'supplied').length,
    runnerVallisneria:
      snapshot.plants.filter((plant) => plant.origin === 'runner').length,
    vallisneriaMaximumLivingGeneration,
    vallisneriaBiomass: snapshot.totalBiomass.vallisneria,
    decomposer: snapshot.biogeochemistry.biofilmTotals.decomposer,
    nitrifier: snapshot.biogeochemistry.biofilmTotals.nitrifier,
  },
  extinction: {
    daphniaAtSeconds: firstDaphniaExtinction?.time ?? null,
    shrimpAtSeconds: firstShrimpExtinction?.time ?? null,
  },
  animalEvents: {
    all: {
      daphnia: allDaphniaEvents,
      shrimp: allShrimpEvents,
    },
    tailAfter3600Seconds: {
      daphnia: tailDaphniaEvents,
      shrimp: tailShrimpEvents,
    },
  },
  maximumMaterialDrift: {
    nitrogen: maximumNitrogenDrift,
    carbon: maximumCarbonDrift,
    oxygenEquivalent: maximumOxygenEquivalentDrift,
    tolerance: CLOSED_MATERIAL_RELATIVE_TOLERANCE,
  },
  censusEvery1200Seconds: samples.filter(
    (sample) =>
      Math.abs(sample.time / 1_200 - Math.round(sample.time / 1_200)) <
        0.02 ||
      sample === samples.at(-1),
  ),
  checks,
}, null, 2));

if (checks.some((item) => !item.passed)) process.exitCode = 1;
