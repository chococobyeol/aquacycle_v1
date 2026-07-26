import { SimulationWorld } from '../src/simulation/SimulationWorld';
import { PLANKTON_ECOLOGY_RULES } from '../src/simulation/config';

type MutableDaphniaRules = {
  maximumFiltrationPerBiomassSecond: number;
  filtrationMassExponent: number;
  phytoplanktonResponseExponent: number;
  reproductionAllocationPerSecondIndividual: number;
  broodCooldownSeconds: number;
};

const rules =
  PLANKTON_ECOLOGY_RULES.daphnia as unknown as MutableDaphniaRules;
if (process.env.DAPHNIA_DIAG_FILTRATION) {
  rules.maximumFiltrationPerBiomassSecond = Number(
    process.env.DAPHNIA_DIAG_FILTRATION,
  );
}
if (process.env.DAPHNIA_DIAG_MASS_EXPONENT) {
  rules.filtrationMassExponent = Number(
    process.env.DAPHNIA_DIAG_MASS_EXPONENT,
  );
}
if (process.env.DAPHNIA_DIAG_FOOD_EXPONENT) {
  rules.phytoplanktonResponseExponent = Number(
    process.env.DAPHNIA_DIAG_FOOD_EXPONENT,
  );
}
if (process.env.DAPHNIA_DIAG_EGG_ALLOCATION) {
  rules.reproductionAllocationPerSecondIndividual = Number(
    process.env.DAPHNIA_DIAG_EGG_ALLOCATION,
  );
}
if (process.env.DAPHNIA_DIAG_BROOD_COOLDOWN) {
  rules.broodCooldownSeconds = Number(
    process.env.DAPHNIA_DIAG_BROOD_COOLDOWN,
  );
}

const world = new SimulationWorld('mission-7');
const point = { x: 600, y: 330 };
const internals = world as unknown as {
  biogeochemistry: {
    addPlankton(
      point: { x: number; y: number },
      kind: 'phytoplankton',
      biomass: number,
    ): number;
    planktonAt(point: { x: number; y: number }): {
      phytoplankton: number;
    };
  };
};
internals.biogeochemistry.addPlankton(point, 'phytoplankton', 24);
world.handle({ type: 'pick-plankton', planktonKind: 'daphnia', point });
world.handle({ type: 'drop-held', point });

const save = world.exportSaveData();
const juvenile = save.animals.find((animal) => animal.speciesId === 'daphnia');
if (!juvenile) throw new Error('Daphnia inoculation failed.');
juvenile.lifeStage = 'juvenile';
juvenile.origin = 'born';
juvenile.ageSeconds = 0;
juvenile.structuralBiomass =
  PLANKTON_ECOLOGY_RULES.daphnia.juvenileMinimumStructure;
juvenile.storedBiomass =
  PLANKTON_ECOLOGY_RULES.daphnia.juvenileBirthBiomass -
  PLANKTON_ECOLOGY_RULES.daphnia.juvenileMinimumStructure;
juvenile.reproductiveBiomass = 0;
juvenile.growthProgress =
  juvenile.structuralBiomass /
  PLANKTON_ECOLOGY_RULES.daphnia.adultStructuralBiomass;
juvenile.consumedBiomass = 0;
juvenile.generation = 1;
world.loadSaveData(save);
world.handle({ type: 'start' });
world.handle({ type: 'set-speed', speed: 64 });

let snapshot = world.snapshot();
let terminal: 'second-brood' | 'died' | 'timeout' = 'timeout';
let maturationSeconds: number | null = null;
let structuralAtMaturation: number | null = null;
let maximumAdultStructure = 0;
const structuralThresholds = [
  0.2,
  0.25,
  0.3,
  0.35,
  0.4,
  0.45,
  0.55,
  0.65,
  0.75,
  0.867,
];
const structuralThresholdSeconds = new Map<number, number>();
while (snapshot.elapsedSeconds < 1_500) {
  world.tick(0.1);
  snapshot = world.snapshot();
  const animal = world.exportSaveData().animals.find(
    (candidate) => candidate.id === juvenile.id,
  );
  if (!animal) {
    terminal = 'died';
    break;
  }
  const structuralFraction =
    animal.structuralBiomass /
    PLANKTON_ECOLOGY_RULES.daphnia.adultStructuralBiomass;
  for (const threshold of structuralThresholds) {
    if (
      !structuralThresholdSeconds.has(threshold) &&
      structuralFraction >= threshold
    ) {
      structuralThresholdSeconds.set(threshold, snapshot.elapsedSeconds);
    }
  }
  if (animal.lifeStage === 'adult') {
    if (maturationSeconds === null) {
      maturationSeconds = snapshot.animalPopulationEvents.find(
        (event) =>
          event.kind === 'matured' &&
          event.animalId === juvenile.id,
      )?.elapsedSeconds ?? snapshot.elapsedSeconds;
      structuralAtMaturation = animal.structuralBiomass;
    }
    maximumAdultStructure = Math.max(
      maximumAdultStructure,
      animal.structuralBiomass,
    );
  }
  const directBirthTimes = Array.from(new Set(
    snapshot.animalPopulationEvents
      .filter(
        (event) =>
          event.kind === 'birth' &&
          event.parentId === juvenile.id,
      )
      .map((event) => Number(event.elapsedSeconds.toFixed(3))),
  ));
  if (directBirthTimes.length >= 2) {
    terminal = 'second-brood';
    break;
  }
}

const finalAnimal = world.exportSaveData().animals.find(
  (candidate) => candidate.id === juvenile.id,
);
const directBirthTimes = Array.from(new Set(
  snapshot.animalPopulationEvents
    .filter(
      (event) =>
        event.kind === 'birth' &&
        event.parentId === juvenile.id,
    )
    .map((event) => Number(event.elapsedSeconds.toFixed(3))),
));
console.log(JSON.stringify({
  rules: {
    maximumFiltrationPerBiomassSecond:
      PLANKTON_ECOLOGY_RULES.daphnia.maximumFiltrationPerBiomassSecond,
    filtrationMassExponent:
      PLANKTON_ECOLOGY_RULES.daphnia.filtrationMassExponent,
    phytoplanktonResponseExponent:
      PLANKTON_ECOLOGY_RULES.daphnia.phytoplanktonResponseExponent,
    reproductionAllocationPerSecondIndividual:
      PLANKTON_ECOLOGY_RULES.daphnia.reproductionAllocationPerSecondIndividual,
    broodCooldownSeconds:
      PLANKTON_ECOLOGY_RULES.daphnia.broodCooldownSeconds,
  },
  terminal,
  elapsedSeconds: snapshot.elapsedSeconds,
  maturationSeconds,
  structuralAtMaturation,
  maximumAdultStructure,
  firstBirthSeconds: directBirthTimes[0] ?? null,
  secondBirthSeconds: directBirthTimes[1] ?? null,
  firstBroodDelaySeconds:
    maturationSeconds === null || directBirthTimes[0] === undefined
      ? null
      : directBirthTimes[0] - maturationSeconds,
  interbroodSeconds:
    directBirthTimes[0] === undefined || directBirthTimes[1] === undefined
      ? null
      : directBirthTimes[1] - directBirthTimes[0],
  structuralThresholdSeconds: Object.fromEntries(
    structuralThresholds.map((threshold) => [
      threshold,
      structuralThresholdSeconds.get(threshold) ?? null,
    ]),
  ),
  localPhytoplankton:
    internals.biogeochemistry.planktonAt(
      finalAnimal?.position ?? point,
    ).phytoplankton,
  animal: finalAnimal
    ? {
      ageSeconds: finalAnimal.ageSeconds,
      lifespanSeconds: finalAnimal.lifespanSeconds,
      lifeStage: finalAnimal.lifeStage,
      structuralBiomass: finalAnimal.structuralBiomass,
      storedBiomass: finalAnimal.storedBiomass,
      growthProgress: finalAnimal.growthProgress,
      consumedBiomass: finalAnimal.consumedBiomass,
    }
    : null,
}, null, 2));
