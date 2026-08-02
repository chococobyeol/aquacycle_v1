import { describe, expect, it, vi } from 'vitest';
import {
  daphniaReproductionFoodFactor,
  PLANKTON_ECOLOGY_RULES,
  RICEFISH_ECOLOGY_RULES,
  SHRIMP_ECOLOGY_RULES,
  WATER_CYCLE_RULES,
} from '../src/simulation/config';
import {
  daphniaDirectPredatorSenseRadius,
  daphniaDirectPredatorSenseRadiusForBodyLength,
  daphniaPredatorEscapeSpeedScaleForBodyLength,
  daphniaDaytimeVisualPredationRisk,
  daphniaLocalRefugeResidency,
  ricefishActivityCostPerSecond,
  ricefishAdultSomaticGrowthRateScale,
  ricefishAdultSomaticGrowthReserveFloor,
  ricefishCanopyDetectionScale,
  ricefishCanopyPursuitScale,
  ricefishCanopyTrackingScale,
  ricefishContactCaptureProbability,
  ricefishDevelopmentForagingUrgency,
  ricefishDaphniaEscapeCaptureFactor,
  ricefishDaphniaSizePreferenceForStructure,
  ricefishDaphniaSizePreferenceForBodyLength,
  ricefishConditionReserveCapacity,
  ricefishEggAttachmentWaterSuitability,
  ricefishEvacuatedRecentIntake,
  ricefishForagingUrgency,
  ricefishForagingAppetite,
  ricefishGutCapacityReferenceBiomass,
  ricefishGutEvacuationSecondsForStructure,
  ricefishLocalPreyDetectionChance,
  ricefishLocalSearchRetrySeconds,
  ricefishLifeStageMetabolismScale,
  ricefishLifespanDeadlineAtMaturity,
  ricefishMaximumDaphniaStructureForBodyLength,
  ricefishMaximumShrimpGrowthProgressForBodyLength,
  ricefishMouthContactRadius,
  ricefishMouthPoint,
  ricefishPatchExitPoint,
  ricefishPreyDetectionRadius,
  ricefishPreyDetectionRadiusForBodyLength,
  ricefishPursuitEffortRate,
  ricefishRecentIntakeAfterCapture,
  ricefishReproductionReserveFloor,
  ricefishRelativeCanopyShelter,
  ricefishSideSwingStrikeVelocity,
  ricefishStarvationActivityScale,
  ricefishSwimmingSpeedScaleForBodyLength,
  ricefishSubadultBodyLengthForStructure,
  ricefishVisualSearchGeometry,
  ricefishYolkGrowthRelease,
  SimulationWorld,
  visualLightExposure,
} from '../src/simulation/SimulationWorld';
import type {
  AnimalLifeStage,
  AnimalSpeciesId,
  PlanktonKind,
  SpeciesId,
  Vec2,
} from '../src/simulation/types';

const RICEFISH: AnimalSpeciesId = 'japanese-ricefish';
const DAPHNIA: AnimalSpeciesId = 'daphnia';
const SHRIMP: AnimalSpeciesId = 'cherry-shrimp';

describe('Daphnia reproductive food response', () => {
  it('can remove the duplicate ambient gate without manufacturing a transfer', () => {
    expect(daphniaReproductionFoodFactor(0, 0.35, 0.7, 0)).toBe(1);
    expect(daphniaReproductionFoodFactor(0.2, 0.35, 0.7, 1)).toBe(0);
    expect(daphniaReproductionFoodFactor(0.525, 0.35, 0.7, 1))
      .toBeCloseTo(0.5);
    expect(daphniaReproductionFoodFactor(0.9, 0.35, 0.7, 1)).toBe(1);
  });
});

describe('ricefish developmental foraging effort', () => {
  it('charges pursuit cost only while an actual prey remains tracked', () => {
    expect(ricefishActivityCostPerSecond('juvenile', 'hunting', false))
      .toBe(RICEFISH_ECOLOGY_RULES.swimmingActivityCostPerSecond);
    expect(ricefishActivityCostPerSecond('juvenile', 'hunting', true))
      .toBe(RICEFISH_ECOLOGY_RULES.huntingActivityCostPerSecond);
    expect(ricefishActivityCostPerSecond('juvenile', 'exploring', true))
      .toBe(RICEFISH_ECOLOGY_RULES.swimmingActivityCostPerSecond);
    expect(ricefishActivityCostPerSecond('egg', 'incubating', true))
      .toBe(RICEFISH_ECOLOGY_RULES.restingActivityCostPerSecond);
    expect(ricefishActivityCostPerSecond('adult', 'resting', true))
      .toBe(RICEFISH_ECOLOGY_RULES.restingActivityCostPerSecond);
  });

  it('charges progressively more for a long, fast retained pursuit', () => {
    const fresh = ricefishActivityCostPerSecond(
      'adult',
      'hunting',
      true,
      0,
      1,
    );
    const prolonged = ricefishActivityCostPerSecond(
      'adult',
      'hunting',
      true,
      RICEFISH_ECOLOGY_RULES.maximumContinuousPursuitEffort,
      1,
    );
    const slowFollow = ricefishActivityCostPerSecond(
      'adult',
      'hunting',
      true,
      0,
      0.25,
    );

    expect(fresh).toBe(RICEFISH_ECOLOGY_RULES.huntingActivityCostPerSecond);
    expect(prolonged).toBeGreaterThan(fresh);
    expect(slowFollow).toBeLessThan(fresh);
    expect(ricefishPursuitEffortRate(1, 0.8, 0.8))
      .toBeGreaterThan(ricefishPursuitEffortRate(0.25, 0, 0));
  });

  it('gives a structurally deficient juvenile more local search effort', () => {
    const target = WATER_CYCLE_RULES.ricefish.juvenileStructuralBiomass;
    const deficient = ricefishDevelopmentForagingUrgency(
      'juvenile',
      target * 0.4,
    );
    const grownSibling = ricefishDevelopmentForagingUrgency(
      'adult',
      target,
    );

    expect(deficient).toBeCloseTo(0.6);
    expect(deficient).toBeGreaterThan(grownSibling);
    expect(ricefishDevelopmentForagingUrgency('juvenile', 0)).toBe(1);
    expect(ricefishDevelopmentForagingUrgency('adult', 0)).toBe(0);
    expect(ricefishDevelopmentForagingUrgency('egg', 0)).toBe(0);
  });

  it('bounds extra detection to one additional local inspection', () => {
    expect(ricefishLocalPreyDetectionChance(0.3, 0)).toBeCloseTo(0.3);
    expect(ricefishLocalPreyDetectionChance(0.3, 1))
      .toBeCloseTo(1 - 0.7 ** 2);
    expect(ricefishLocalPreyDetectionChance(0, 1)).toBe(0);
    expect(ricefishLocalPreyDetectionChance(1, 1)).toBe(1);
    const independentPatchTravel =
      RICEFISH_ECOLOGY_RULES.animalPreyDetectionRadius /
      RICEFISH_ECOLOGY_RULES.cruiseSpeed;
    expect(ricefishLocalSearchRetrySeconds(0))
      .toBeCloseTo(independentPatchTravel);
    expect(ricefishLocalSearchRetrySeconds(1))
      .toBeCloseTo(independentPatchTravel / 2);
  });

  it('increases only local search effort when an adult is hungry', () => {
    expect(ricefishForagingUrgency('adult', 0.12, 1)).toBe(0);
    expect(ricefishForagingUrgency('adult', 0.12, 0.28))
      .toBeGreaterThan(0.7);
    expect(ricefishForagingUrgency('adult', 0.12, 0.1))
      .toBeLessThan(0.5);
    expect(ricefishForagingUrgency('juvenile', 0, 1)).toBe(1);
    expect(ricefishForagingUrgency('juvenile', 0, 0.1)).toBeLessThan(0.5);
    expect(ricefishStarvationActivityScale(0.28)).toBe(1);
    expect(ricefishStarvationActivityScale(0.2)).toBe(1);
    expect(ricefishStarvationActivityScale(0.1)).toBeLessThan(0.75);
    expect(ricefishStarvationActivityScale(0.1)).toBeGreaterThan(0.7);
  });

  it('lets scarcity reduce encounters without making one visible prey harder to recognise', () => {
    const visualEvidence = 0.2;
    const oneVisiblePreyChance =
      ricefishLocalPreyDetectionChance(visualEvidence, 0);
    const anyOfTwoVisiblePreyChance =
      1 - (1 - oneVisiblePreyChance) ** 2;

    expect(oneVisiblePreyChance).toBeCloseTo(visualEvidence);
    expect(anyOfTwoVisiblePreyChance).toBeGreaterThan(oneVisiblePreyChance);
    expect(ricefishLocalPreyDetectionChance(0, 0)).toBe(0);
  });

  it('uses lateral monocular fields and distance decay instead of a frontal radar', () => {
    const predator = { x: 0, y: 0 };
    const velocity = { x: 20, y: 0 };
    const nearFront = ricefishVisualSearchGeometry(
      predator,
      velocity,
      1,
      { x: 40, y: 0 },
      360,
    );
    const nearSide = ricefishVisualSearchGeometry(
      predator,
      velocity,
      1,
      { x: 0, y: 40 },
      360,
    );
    const farFront = ricefishVisualSearchGeometry(
      predator,
      velocity,
      1,
      { x: 320, y: 0 },
      360,
    );
    const exactRear = ricefishVisualSearchGeometry(
      predator,
      velocity,
      1,
      { x: -40, y: 0 },
      360,
    );

    expect(nearSide).toBeGreaterThan(nearFront);
    expect(nearSide).toBeGreaterThan(farFront);
    expect(exactRear).toBeGreaterThan(0);
    expect(exactRear).toBeLessThan(nearFront * 0.2);
    expect(ricefishVisualSearchGeometry(
      predator,
      { x: 0, y: 0 },
      -1,
      { x: -40, y: 0 },
      360,
    )).toBeCloseTo(nearFront);
  });

  it('adds a bounded lateral component to the final capture burst', () => {
    const strike = ricefishSideSwingStrikeVelocity(
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      1,
      { x: 20, y: 0 },
      164,
      1,
    );

    expect(Math.hypot(strike.x, strike.y)).toBeCloseTo(164);
    expect(strike.x).toBeGreaterThan(0);
    expect(strike.y).toBeGreaterThan(0);
    expect(Math.abs(strike.y)).toBeLessThan(Math.abs(strike.x));
  });

  it('places capture contact at the rendered mouth instead of the body centre', () => {
    const position = { x: 760, y: 320 };
    const bodyLength = RICEFISH_ECOLOGY_RULES.adultLength;
    const mouth = ricefishMouthPoint(position, 1, 0, bodyLength);
    const contactRadius = ricefishMouthContactRadius(bodyLength, 8);

    expect(mouth.x).toBeCloseTo(
      position.x + bodyLength * 39 / 85,
      8,
    );
    expect(mouth.y).toBe(position.y);
    expect(Math.hypot(mouth.x - position.x, mouth.y - position.y))
      .toBeGreaterThan(contactRadius * 2);

    const leftUpMouth = ricefishMouthPoint(
      position,
      -1,
      -Math.PI / 8,
      bodyLength,
    );
    expect(leftUpMouth.x).toBeLessThan(position.x);
    expect(leftUpMouth.y).toBeLessThan(position.y);
  });

  it('scales visual patch size with ricefish life stage', () => {
    const adult = ricefishPreyDetectionRadius('adult');
    const juvenile = ricefishPreyDetectionRadius('juvenile');
    const fry = ricefishPreyDetectionRadius('fry');

    expect(adult).toBe(RICEFISH_ECOLOGY_RULES.animalPreyDetectionRadius);
    expect(juvenile).toBeGreaterThan(fry);
    expect(juvenile).toBeLessThan(adult);
    expect(fry).toBeCloseTo(
      adult * RICEFISH_ECOLOGY_RULES.fryPreyDetectionRadiusFraction,
    );
    expect(fry / adult).toBeLessThan(0.5);
    expect(ricefishLocalSearchRetrySeconds(1, fry))
      .toBeLessThan(ricefishLocalSearchRetrySeconds(1, adult));
  });

  it('keeps a stage-scaled Daphnia startle inside that fish visual range', () => {
    for (const lifeStage of ['fry', 'juvenile', 'adult'] as const) {
      expect(daphniaDirectPredatorSenseRadius(lifeStage))
        .toBeLessThan(ricefishPreyDetectionRadius(lifeStage));
    }
    expect(daphniaDirectPredatorSenseRadius('adult')).toBe(150);
    expect(daphniaDirectPredatorSenseRadius('fry')).toBeCloseTo(
      150 *
        RICEFISH_ECOLOGY_RULES.fryLength /
        RICEFISH_ECOLOGY_RULES.adultLength,
    );
    expect(daphniaDirectPredatorSenseRadius('juvenile'))
      .toBeGreaterThan(daphniaDirectPredatorSenseRadius('fry'));
    expect(daphniaDirectPredatorSenseRadius('egg')).toBe(0);
  });

  it('keeps visual range, warning range, speed and prey-size preference continuous at stage boundaries', () => {
    const candidateLength = 8;
    for (const boundary of [
      RICEFISH_ECOLOGY_RULES.fryLength,
      RICEFISH_ECOLOGY_RULES.juvenileLength,
      RICEFISH_ECOLOGY_RULES.adultLength,
    ]) {
      const below = boundary - 1e-6;
      const above = boundary + 1e-6;
      expect(
        ricefishPreyDetectionRadiusForBodyLength(above) -
          ricefishPreyDetectionRadiusForBodyLength(below),
      ).toBeLessThan(0.0001);
      expect(
        daphniaDirectPredatorSenseRadiusForBodyLength(above) -
          daphniaDirectPredatorSenseRadiusForBodyLength(below),
      ).toBeLessThan(0.0001);
      expect(
        ricefishSwimmingSpeedScaleForBodyLength(above) -
          ricefishSwimmingSpeedScaleForBodyLength(below),
      ).toBeLessThan(0.0001);
      expect(Math.abs(
        ricefishDaphniaSizePreferenceForBodyLength(
          above,
          candidateLength,
        ) -
          ricefishDaphniaSizePreferenceForBodyLength(
            below,
            candidateLength,
          ),
      )).toBeLessThan(0.0001);
      expect(Math.abs(
        ricefishMaximumDaphniaStructureForBodyLength(above) -
          ricefishMaximumDaphniaStructureForBodyLength(below),
      )).toBeLessThan(1e-8);
    }

    expect(ricefishPreyDetectionRadiusForBodyLength(
      RICEFISH_ECOLOGY_RULES.juvenileLength,
    )).toBeCloseTo(ricefishPreyDetectionRadius('juvenile'));
    expect(daphniaDirectPredatorSenseRadiusForBodyLength(
      RICEFISH_ECOLOGY_RULES.juvenileLength,
    )).toBeCloseTo(daphniaDirectPredatorSenseRadius('juvenile'));
    expect(ricefishMaximumDaphniaStructureForBodyLength(
      RICEFISH_ECOLOGY_RULES.fryLength,
    )).toBeCloseTo(
      RICEFISH_ECOLOGY_RULES.fryMaximumDaphniaStructuralBiomass,
    );
    expect(ricefishMaximumDaphniaStructureForBodyLength(
      RICEFISH_ECOLOGY_RULES.juvenileLength,
    )).toBeCloseTo(WATER_CYCLE_RULES.daphnia.adultStructuralBiomass);
  });

  it('derives pre-adult length from conserved structure instead of age alone', () => {
    const hatch = WATER_CYCLE_RULES.ricefish.fryBirthBiomass;
    const maturity = WATER_CYCLE_RULES.ricefish.juvenileStructuralBiomass;
    expect(ricefishSubadultBodyLengthForStructure(hatch))
      .toBe(RICEFISH_ECOLOGY_RULES.fryLength);
    expect(ricefishSubadultBodyLengthForStructure(maturity))
      .toBe(RICEFISH_ECOLOGY_RULES.juvenileLength);
    expect(ricefishSubadultBodyLengthForStructure(hatch * 4))
      .toBeCloseTo(RICEFISH_ECOLOGY_RULES.fryLength * Math.cbrt(4));
    expect(ricefishSubadultBodyLengthForStructure(hatch * 1.345))
      .toBeLessThan(12);
  });

  it('uses conserved prey size to favour intermediate Daphnia', () => {
    const fishLength = RICEFISH_ECOLOGY_RULES.juvenileLength;
    const edibleMaximum =
      ricefishMaximumDaphniaStructureForBodyLength(fishLength);
    const neonate = ricefishDaphniaSizePreferenceForStructure(
      fishLength,
      WATER_CYCLE_RULES.daphnia.juvenileBirthBiomass * 0.5,
    );
    const intermediate = ricefishDaphniaSizePreferenceForStructure(
      fishLength,
      edibleMaximum * 0.38,
    );
    const largest = ricefishDaphniaSizePreferenceForStructure(
      fishLength,
      edibleMaximum,
    );

    expect(intermediate).toBeCloseTo(1);
    expect(intermediate).toBeGreaterThan(neonate);
    expect(intermediate).toBeGreaterThan(largest);
    expect(largest).toBeGreaterThan(neonate);
  });

  it('gives small Daphnia a lower absolute escape speed without a stage cliff', () => {
    const newborn = daphniaPredatorEscapeSpeedScaleForBodyLength(4.6);
    const growing = daphniaPredatorEscapeSpeedScaleForBodyLength(6.8);
    const adult = daphniaPredatorEscapeSpeedScaleForBodyLength(9);

    expect(newborn).toBeCloseTo(0.66);
    expect(growing).toBeGreaterThan(newborn);
    expect(growing).toBeLessThan(adult);
    expect(adult).toBe(1);
    expect(
      daphniaPredatorEscapeSpeedScaleForBodyLength(6.8 + 1e-6) -
        daphniaPredatorEscapeSpeedScaleForBodyLength(6.8 - 1e-6),
    ).toBeLessThan(1e-5);
  });

  it('starts the adult longevity budget at actual food-funded maturity', () => {
    const originalDeadline = 2_800;
    expect(ricefishLifespanDeadlineAtMaturity(
      originalDeadline,
      RICEFISH_ECOLOGY_RULES.maturationSeconds,
    )).toBe(originalDeadline);
    expect(ricefishLifespanDeadlineAtMaturity(
      originalDeadline,
      1_200,
    )).toBe(3_520);
  });

  it('keeps one patch exit and requires real travel before another inspection', () => {
    const world = new SimulationWorld('mission-8');
    placeAnimal(world, RICEFISH, { x: 900, y: 320 });
    const internals = internalsOf(world);
    const fish = internals.animals.find(
      (animal) => animal.speciesId === RICEFISH,
    )!;
    fish.energy = RICEFISH_ECOLOGY_RULES.forageStartEnergy;
    fish.nextTargetEvaluation = 0;
    const inspect = vi.spyOn(internals, 'chooseRicefishPrey');

    internals.stepRicefishMotion(fish, 0.1);
    const failedPatch = { ...fish.foragingPatchOrigin! };
    expect(failedPatch).toEqual({ x: 900, y: 320 });
    expect(inspect).toHaveBeenCalledTimes(1);

    const shelterAt = vi.spyOn(internals, 'ricefishShelterAt');
    fish.nextTargetEvaluation = 0;
    internals.stepRicefishMotion(fish, 0.1);
    expect(fish.targetAnimalId).toBeNull();
    expect(fish.nextTargetEvaluation).toBe(0);
    expect(fish.foragingPatchOrigin).toEqual(failedPatch);
    expect(inspect).toHaveBeenCalledTimes(1);
    expect(shelterAt.mock.calls[0]?.[0]).toEqual(failedPatch);

    fish.position.x = failedPatch.x +
      RICEFISH_ECOLOGY_RULES.animalPreyDetectionRadius + 1;
    internals.stepRicefishMotion(fish, 0.1);
    expect(fish.foragingPatchOrigin).not.toEqual(failedPatch);
    expect(fish.nextTargetEvaluation).toBeGreaterThan(0);
  });

  it('can notice prey entering the forward field while crossing a fixed patch', () => {
    const world = new SimulationWorld('mission-8');
    placeAnimal(world, RICEFISH, { x: 900, y: 320 });
    const internals = internalsOf(world);
    const fish = internals.animals.find(
      (animal) => animal.speciesId === RICEFISH,
    )!;
    fish.energy = RICEFISH_ECOLOGY_RULES.forageStartEnergy;
    fish.nextTargetEvaluation = 0;

    internals.stepRicefishMotion(fish, 0.1);
    const fixedPatch = { ...fish.foragingPatchOrigin! };
    placePlankton(world, DAPHNIA, { x: 1_040, y: 320 });
    const daphnia = internals.animals.find(
      (animal) => animal.speciesId === DAPHNIA,
    )!;
    const inspect = vi.spyOn(internals, 'chooseRicefishPrey')
      .mockReturnValue(daphnia);

    fish.position = { x: 980, y: 320 };
    fish.velocity = { x: 20, y: 0 };
    fish.facing = 1;
    fish.nextTargetEvaluation = 0;
    internals.stepRicefishMotion(fish, 0.1);

    expect(inspect).toHaveBeenCalledTimes(1);
    expect(fish.targetAnimalId).toBe(daphnia.id);
    expect(fish.foragingPatchOrigin).toBeNull();
    expect(fish.foragingLastInspectionPosition).toBeNull();
    expect(fixedPatch).toEqual({ x: 900, y: 320 });
  });

  it('restores the in-progress visual transect without granting a fresh roll', () => {
    const world = new SimulationWorld('mission-8');
    placeAnimal(world, RICEFISH, { x: 900, y: 320 });
    const fish = internalsOf(world).animals.find(
      (animal) => animal.speciesId === RICEFISH,
    )!;
    fish.energy = RICEFISH_ECOLOGY_RULES.forageStartEnergy;
    fish.nextTargetEvaluation = 0;
    internalsOf(world).stepRicefishMotion(fish, 0.1);

    const restored = new SimulationWorld('mission-8');
    restored.loadSaveData(world.exportSaveData());
    const restoredFish = internalsOf(restored).animals.find(
      (animal) => animal.speciesId === RICEFISH,
    )!;

    expect(restoredFish.foragingPatchOrigin)
      .toEqual(fish.foragingPatchOrigin);
    expect(restoredFish.foragingLastInspectionPosition)
      .toEqual(fish.foragingLastInspectionPosition);
  });

  it('restores a spent strike recovery and defaults legacy saves to zero', () => {
    const world = new SimulationWorld('mission-8');
    placeAnimal(world, RICEFISH, { x: 900, y: 320 });
    placePlankton(world, DAPHNIA, { x: 910, y: 320 });
    const fish = internalsOf(world).animals.find(
      (animal) => animal.speciesId === RICEFISH,
    )!;
    const prey = internalsOf(world).animals.find(
      (animal) => animal.speciesId === DAPHNIA,
    )!;
    fish.targetAnimalId = prey.id;
    fish.strikeRecoveryUses = 1;

    const currentSave = world.exportSaveData();
    const restored = new SimulationWorld('mission-8');
    restored.loadSaveData(currentSave);
    expect(internalsOf(restored).animals.find(
      (animal) => animal.id === fish.id,
    )?.strikeRecoveryUses).toBe(1);

    const legacySave = world.exportSaveData();
    delete legacySave.animals.find(
      (animal) => animal.id === fish.id,
    )?.strikeRecoveryUses;
    const legacyRestored = new SimulationWorld('mission-8');
    legacyRestored.loadSaveData(legacySave);
    expect(internalsOf(legacyRestored).animals.find(
      (animal) => animal.id === fish.id,
    )?.strikeRecoveryUses).toBe(0);
  });

  it('chooses a reachable independent patch exit beside a tank corner', () => {
    const origin = { x: 2_230, y: 550 };
    const minimumDistance = ricefishPreyDetectionRadius('juvenile') / 2;
    const exit = ricefishPatchExitPoint(
      origin,
      minimumDistance,
      {
        minimumX: 170,
        maximumX: 2_230,
        minimumY: 150,
        maximumY: 550,
      },
      0.418,
    );

    expect(exit.x).toBeGreaterThanOrEqual(170);
    expect(exit.x).toBeLessThanOrEqual(2_230);
    expect(exit.y).toBeGreaterThanOrEqual(150);
    expect(exit.y).toBeLessThanOrEqual(550);
    expect(Math.hypot(exit.x - origin.x, exit.y - origin.y))
      .toBeGreaterThan(minimumDistance);
  });
});

describe('Daphnia escape during a ricefish strike', () => {
  const predator = { x: 0, y: 0 };
  const prey = { x: 20, y: 0 };

  it('does not reward ordinary motion or motion that is not away from the fish', () => {
    expect(
      ricefishDaphniaEscapeCaptureFactor(
        predator,
        prey,
        { x: 58, y: 0 },
        'exploring',
      ),
    ).toBe(1);
    expect(
      ricefishDaphniaEscapeCaptureFactor(
        predator,
        prey,
        { x: -58, y: 0 },
        'traveling',
      ),
    ).toBe(1);
    expect(
      ricefishDaphniaEscapeCaptureFactor(
        predator,
        prey,
        { x: 0, y: 58 },
        'traveling',
      ),
    ).toBe(1);
  });

  it('continuously lowers, but never removes, capture risk during an escape stroke', () => {
    expect(
      ricefishDaphniaEscapeCaptureFactor(
        predator,
        prey,
        { x: 29, y: 0 },
        'traveling',
      ),
    ).toBeCloseTo(0.71, 6);
    expect(
      ricefishDaphniaEscapeCaptureFactor(
        predator,
        prey,
        { x: 58, y: 0 },
        'traveling',
      ),
    ).toBeCloseTo(0.42, 6);
    expect(
      ricefishDaphniaEscapeCaptureFactor(
        predator,
        prey,
        { x: 120, y: 0 },
        'traveling',
      ),
    ).toBeCloseTo(0.42, 6);
  });
});

describe('Daphnia daytime Vallisneria refuge choice', () => {
  it('treats canopy cover as lower visual risk without making a night refuge mandatory', () => {
    const exposed = daphniaDaytimeVisualPredationRisk(0.5, 0, false);
    const sheltered = daphniaDaytimeVisualPredationRisk(0.5, 0.8, false);
    const deeper = daphniaDaytimeVisualPredationRisk(0.5, 0, false, 0.6);

    expect(exposed).toBeCloseTo(0.5);
    expect(sheltered).toBeGreaterThan(0);
    expect(sheltered).toBeLessThan(exposed * 0.1);
    expect(deeper).toBeCloseTo(exposed * 0.6);
    expect(daphniaDaytimeVisualPredationRisk(0.5, 0.8, true)).toBe(0);
    expect(visualLightExposure(0)).toBe(0);
    expect(visualLightExposure(50)).toBe(0.5);
    expect(visualLightExposure(100)).toBe(1);
  });

  it('moves down a local effective-risk gradient toward nearby canopy cover', () => {
    const world = new SimulationWorld('mission-8');
    seededCell(world, 'vallisneria', 1_050);
    placePlankton(world, 'daphnia', { x: 1_050, y: 360 });
    const internals = internalsOf(world);
    const daphnia = internals.animals.find(
      (animal) => animal.speciesId === DAPHNIA,
    )!;
    const snapshot = world.snapshot();
    let best = {
      point: { x: 1_050, y: 360 },
      shelterGain: Number.NEGATIVE_INFINITY,
    };
    for (
      let y = snapshot.tank.waterTop + 40;
      y <= snapshot.tank.groundY - 24;
      y += 18
    ) {
      for (let x = 60; x <= snapshot.tank.width - 60; x += 12) {
        const shelterGain =
          internals.ricefishShelterAt({ x: x + 34, y }) -
          internals.ricefishShelterAt({ x: x - 34, y });
        if (shelterGain > best.shelterGain) {
          best = { point: { x, y }, shelterGain };
        }
      }
    }
    expect(best.shelterGain).toBeGreaterThan(0.05);
    daphnia.position = { ...best.point };
    vi.spyOn(
      internals.biogeochemistry,
      'predatorDangerCueAt',
    ).mockReturnValue(0.1);

    const escape = internals.daphniaPredatorEscape(daphnia);

    expect(escape).not.toBeNull();
    expect(escape!.x).toBeGreaterThan(0.5);
  });

  it('uses the cached light field itself when choosing the daytime migration direction', () => {
    const world = new SimulationWorld('mission-8');
    placePlankton(world, 'daphnia', { x: 840, y: 320 });
    const internals = internalsOf(world);
    const daphnia = internals.animals.find(
      (animal) => animal.speciesId === DAPHNIA,
    )!;
    daphnia.position = { x: 840, y: 320 };
    vi.spyOn(
      internals.biogeochemistry,
      'predatorDangerCueAt',
    ).mockReturnValue(0.1);
    vi.spyOn(internals, 'sampleLightField').mockImplementation(
      (point) => point.y > daphnia.position.y ? 20 : 80,
    );

    const migration = internals.daphniaPredatorEscape(daphnia);

    expect(migration).not.toBeNull();
    expect(Math.abs(migration!.x)).toBeLessThan(0.05);
    expect(migration!.y).toBeGreaterThan(0.95);
  });

  it('retains structural complexity when the ricefish enters dense cover', () => {
    expect(ricefishRelativeCanopyShelter(0.8, 0)).toBeCloseTo(0.8);
    expect(ricefishRelativeCanopyShelter(0.8, 0.3)).toBeCloseTo(0.6587);
    expect(ricefishRelativeCanopyShelter(0.8, 0.8)).toBeCloseTo(0.5632);
    expect(ricefishRelativeCanopyShelter(0.3, 0.8)).toBeCloseTo(0.2112);
  });

  it('reduces local roaming only when daytime fish cue and cover coincide', () => {
    expect(daphniaLocalRefugeResidency(0.1, 0.8, false))
      .toBeGreaterThan(0.7);
    expect(daphniaLocalRefugeResidency(0, 0.8, false)).toBe(0);
    expect(daphniaLocalRefugeResidency(0.1, 0, false)).toBe(0);
    expect(daphniaLocalRefugeResidency(0.1, 0.8, true)).toBe(0);
  });

  it('shortens long-range search and pursuit in canopy without hiding mouth-scale prey', () => {
    expect(ricefishCanopyDetectionScale(0)).toBe(1);
    expect(ricefishCanopyDetectionScale(0.8)).toBeLessThan(0.6);
    expect(ricefishCanopyPursuitScale(0.8, 0.8)).toBeLessThan(0.65);
    expect(ricefishCanopyPursuitScale(0.8, 0))
      .toBeGreaterThan(ricefishCanopyPursuitScale(0.8, 0.8));
    expect(ricefishCanopyTrackingScale(0.6)).toBeLessThan(0.6);
  });

  it('does not charge canopy shelter again after prey reaches the mouth', () => {
    const exposed = ricefishContactCaptureProbability(0.8, 0, 1, 1);
    const sheltered = ricefishContactCaptureProbability(0.8, 0.6, 1, 1);
    const escaping = ricefishContactCaptureProbability(0.8, 0.6, 1, 0.42);

    expect(exposed).toBeGreaterThan(0.8);
    expect(sheltered).toBeCloseTo(exposed);
    expect(escaping).toBeLessThan(sheltered);
  });

  it('still tracks close visible prey while losing a distant target inside dense canopy', () => {
    const world = new SimulationWorld('mission-8');
    placeAnimal(world, RICEFISH, { x: 900, y: 320 });
    placePlankton(world, DAPHNIA, { x: 920, y: 320 });
    const internals = internalsOf(world);
    const fish = internals.animals.find(
      (animal) => animal.speciesId === RICEFISH,
    )!;
    const daphnia = internals.animals.find(
      (animal) => animal.speciesId === DAPHNIA,
    )!;
    vi.spyOn(internals, 'ricefishShelterAt').mockReturnValue(0.8);
    vi.spyOn(internals, 'sampleLightField').mockReturnValue(100);

    expect(internals.ricefishCanTrackPrey(fish, daphnia)).toBe(true);

    daphnia.position.x = fish.position.x + 110;
    expect(internals.ricefishCanTrackPrey(fish, daphnia)).toBe(false);
    expect(
      (fish.position.x - daphnia.position.x) ** 2 +
        (fish.position.y - daphnia.position.y) ** 2,
    ).toBeLessThan(
      ricefishPreyDetectionRadiusForBodyLength(fish.bodyLength) ** 2,
    );
  });

  it('abandons a sustained costly chase and enters a local recovery interval', () => {
    const world = new SimulationWorld('mission-8');
    placeAnimal(world, RICEFISH, { x: 900, y: 320 });
    placePlankton(world, DAPHNIA, { x: 960, y: 320 });
    const internals = internalsOf(world);
    const fish = internals.animals.find(
      (animal) => animal.speciesId === RICEFISH,
    )!;
    const daphnia = internals.animals.find(
      (animal) => animal.speciesId === DAPHNIA,
    )!;
    fish.energy = 0.2;
    fish.behavior = 'hunting';
    fish.targetAnimalId = daphnia.id;
    fish.velocity = { x: RICEFISH_ECOLOGY_RULES.preyPursuitSpeed, y: 0 };
    fish.pursuitEffort = 0;
    vi.spyOn(internals, 'ricefishShelterAt').mockReturnValue(0.8);
    vi.spyOn(internals, 'sampleLightField').mockReturnValue(100);

    for (let step = 0; step < 120 && fish.targetAnimalId; step += 1) {
      internals.stepRicefishEcology(0.1);
    }

    expect(fish.pursuitEffort)
      .toBeGreaterThanOrEqual(
        RICEFISH_ECOLOGY_RULES.maximumContinuousPursuitEffort,
      );
    expect(fish.targetAnimalId).toBeNull();
    expect(fish.nextTargetEvaluation)
      .toBeGreaterThanOrEqual(
        RICEFISH_ECOLOGY_RULES.pursuitRecoverySeconds,
      );
    expect(fish.foragingPatchOrigin).toEqual(fish.position);
  });

  it('ascends under a diffuse cue at night but still flees a closing fish directly', () => {
    const world = new SimulationWorld('mission-8');
    placePlankton(world, 'daphnia', { x: 840, y: 320 });
    const internals = internalsOf(world);
    const daphnia = internals.animals.find(
      (animal) => animal.speciesId === DAPHNIA,
    )!;
    daphnia.position = { x: 840, y: 320 };
    daphnia.velocity = { x: 0, y: 0 };
    internals.elapsedSeconds = 300;
    vi.spyOn(
      internals.biogeochemistry,
      'predatorDangerCueAt',
    ).mockReturnValue(0.1);

    const nightMigration = internals.daphniaPredatorEscape(daphnia);
    expect(nightMigration).not.toBeNull();
    expect(nightMigration!.x).toBe(0);
    expect(nightMigration!.y).toBe(-1);

    placeAnimal(world, RICEFISH, { x: 790, y: 320 });
    const predator = internals.animals.find(
      (animal) => animal.speciesId === RICEFISH,
    )!;
    predator.position = { x: 790, y: 320 };
    predator.velocity = { x: 90, y: 0 };

    const directEscape = internals.daphniaPredatorEscape(daphnia);
    expect(directEscape).not.toBeNull();
    expect(directEscape!.x).toBeGreaterThan(0.9);
  });

  it('uses the local depth gradient without seeking a remote canopy', () => {
    const world = new SimulationWorld('mission-8');
    seededCell(world, 'vallisneria', 1_050);
    placePlankton(world, 'daphnia', { x: 220, y: 320 });
    const internals = internalsOf(world);
    const daphnia = internals.animals.find(
      (animal) => animal.speciesId === DAPHNIA,
    )!;
    daphnia.position = { x: 220, y: 320 };
    const dangerCue = vi.spyOn(
      internals.biogeochemistry,
      'predatorDangerCueAt',
    );

    dangerCue.mockReturnValue(0);
    expect(internals.daphniaPredatorEscape(daphnia)).toBeNull();

    dangerCue.mockReturnValue(0.1);
    const migration = internals.daphniaPredatorEscape(daphnia);
    expect(migration).not.toBeNull();
    expect(Math.abs(migration!.x)).toBeLessThan(0.05);
    expect(migration!.y).toBeGreaterThan(0.95);
  });

  it('uses residual relative canopy cover in the actual prey-shelter path', () => {
    const world = new SimulationWorld('mission-8');
    seededCell(world, 'vallisneria', 1_050);
    placePlankton(world, 'daphnia', { x: 1_050, y: 360 });
    placeAnimal(world, RICEFISH, { x: 240, y: 320 });
    const internals = internalsOf(world);
    const daphnia = internals.animals.find(
      (animal) => animal.speciesId === DAPHNIA,
    )!;
    const fish = internals.animals.find(
      (animal) => animal.speciesId === RICEFISH,
    )!;
    const tank = world.snapshot().tank;
    let mostSheltered = { x: 1_050, y: 360 };
    let maximumShelter = 0;
    for (let y = tank.waterTop + 20; y < tank.groundY; y += 12) {
      for (let x = 900; x < 1_200; x += 8) {
        const shelter = internals.ricefishShelterAt({ x, y });
        if (shelter > maximumShelter) {
          maximumShelter = shelter;
          mostSheltered = { x, y };
        }
      }
    }
    expect(maximumShelter).toBeGreaterThan(0.1);
    daphnia.position = { ...mostSheltered };
    fish.position = { x: 240, y: 320 };
    const predatorOutside = internals.ricefishPreyShelter(daphnia, fish);
    fish.position = { ...mostSheltered };
    const predatorInside = internals.ricefishPreyShelter(daphnia, fish);

    expect(predatorOutside).toBeCloseTo(maximumShelter);
    expect(predatorInside).toBeGreaterThan(0);
    expect(predatorInside).toBeLessThan(predatorOutside);
  });

  it('refreshes shelter buckets after thaw, plant death, and tank reset', () => {
    const world = new SimulationWorld('mission-8');
    const planted = seededCell(world, 'vallisneria', 1_050);
    const internals = internalsOf(world);
    const tank = world.snapshot().tank;
    let shelterPoint = { x: 1_050, y: 360 };
    let shelterBefore = 0;
    for (let y = tank.waterTop + 20; y < tank.groundY; y += 12) {
      for (let x = 900; x < 1_200; x += 8) {
        const shelter = internals.ricefishShelterAt({ x, y });
        if (shelter > shelterBefore) {
          shelterBefore = shelter;
          shelterPoint = { x, y };
        }
      }
    }
    expect(shelterBefore).toBeGreaterThan(0.1);

    const thawed = new SimulationWorld('mission-1');
    thawed.loadSaveData(world.exportSaveData());
    expect(internalsOf(thawed).ricefishShelterAt(shelterPoint))
      .toBeCloseTo(shelterBefore);

    planted.internal.biomass.vallisneria = 0;
    internals.recomputeLight();
    expect(internals.ricefishShelterAt(shelterPoint)).toBe(0);

    world.initialize('laboratory', 'standard');
    expect(internals.ricefishShelterAt(shelterPoint)).toBe(0);
  });
});

describe('ricefish yolk, maintenance, and recent-meal satiation', () => {
  it('uses one mass equation at every mobile life stage', () => {
    expect(ricefishLifeStageMetabolismScale('egg')).toBe(1);
    expect(ricefishLifeStageMetabolismScale('fry')).toBe(1);
    expect(ricefishLifeStageMetabolismScale('juvenile')).toBe(1);
    expect(ricefishLifeStageMetabolismScale('adult')).toBe(1);

    const adultMass = WATER_CYCLE_RULES.ricefish.adultStructuralBiomass;
    const fryMass = WATER_CYCLE_RULES.ricefish.fryBirthBiomass;
    const adultMaintenancePerMass =
      RICEFISH_ECOLOGY_RULES.adultBaseMetabolismPerSecond / adultMass;
    const fryMaintenancePerMass =
      RICEFISH_ECOLOGY_RULES.adultBaseMetabolismPerSecond *
      Math.pow(fryMass / adultMass, RICEFISH_ECOLOGY_RULES.metabolicMassExponent) /
      fryMass;

    expect(fryMaintenancePerMass).toBeGreaterThan(adultMaintenancePerMass);
  });

  it('meters yolk into growth across the absorption interval', () => {
    const yolk = 0.0004;
    const firstSecond = ricefishYolkGrowthRelease(yolk, 1, 1);
    const finalSecond = ricefishYolkGrowthRelease(
      yolk,
      RICEFISH_ECOLOGY_RULES.yolkAbsorptionSeconds - 1,
      1,
    );

    expect(firstSecond).toBeGreaterThan(0);
    expect(firstSecond).toBeLessThan(yolk * 0.02);
    expect(finalSecond).toBe(yolk);
  });

  it('begins external foraging while yolk still supports condition', () => {
    const world = new SimulationWorld('mission-8');
    placeAnimal(world, RICEFISH, { x: 760, y: 320 });
    const internals = internalsOf(world);
    const fish = internals.animals.find(
      (animal) => animal.speciesId === RICEFISH,
    )!;

    fish.lifeStage = 'fry';
    fish.bodyLength = RICEFISH_ECOLOGY_RULES.fryLength;
    fish.ageSeconds =
      RICEFISH_ECOLOGY_RULES.yolkAbsorptionSeconds *
      RICEFISH_ECOLOGY_RULES.exogenousFeedingOnsetFraction + 1;
    fish.structuralBiomass =
      WATER_CYCLE_RULES.ricefish.fryBirthBiomass * 0.8;
    fish.peakStructuralBiomass = fish.structuralBiomass;
    fish.storedBiomass = 0.0003;
    fish.yolkBiomass = 0.0003;
    fish.energy = 1;
    fish.recentIntake = 0;
    fish.behavior = 'exploring';
    fish.targetAnimalId = null;
    fish.nextTargetEvaluation = 0;

    internals.stepRicefishMotion(fish, 0.1);

    expect(fish.behavior).toBe('hunting');
  });

  it('ties juvenile virtual stomach size to achieved body instead of age', () => {
    const currentStructure =
      WATER_CYCLE_RULES.ricefish.fryBirthBiomass * 0.72;
    const achievedStructure =
      WATER_CYCLE_RULES.ricefish.fryBirthBiomass * 3.2;
    const youngJuvenile = ricefishGutCapacityReferenceBiomass(
      'juvenile',
      RICEFISH_ECOLOGY_RULES.fryStageSeconds + 1,
      currentStructure,
      achievedStructure,
    );
    const oldJuvenile = ricefishGutCapacityReferenceBiomass(
      'juvenile',
      RICEFISH_ECOLOGY_RULES.maturationSeconds + 900,
      currentStructure,
      achievedStructure,
    );

    expect(youngJuvenile).toBeCloseTo(achievedStructure);
    expect(oldJuvenile).toBeCloseTo(youngJuvenile);
  });

  it('keeps fry mass-scaled and healthy adult capacity unchanged', () => {
    const fryStructure = WATER_CYCLE_RULES.ricefish.fryBirthBiomass * 0.72;
    const adultStructure = WATER_CYCLE_RULES.ricefish.adultStructuralBiomass;

    expect(
      ricefishGutCapacityReferenceBiomass('fry', 140, fryStructure),
    ).toBeCloseTo(fryStructure);
    expect(
      ricefishGutCapacityReferenceBiomass('adult', 1_000, adultStructure),
    ).toBeCloseTo(adultStructure);
    expect(
      ricefishGutCapacityReferenceBiomass('adult', 1_000, 0.01),
    ).toBeCloseTo(WATER_CYCLE_RULES.ricefish.juvenileStructuralBiomass);
  });

  it('scales stomach appetite with body mass without adding another matter store', () => {
    const structure = WATER_CYCLE_RULES.ricefish.adultStructuralBiomass;
    const capacity =
      structure * RICEFISH_ECOLOGY_RULES.gutCapacityStructuralFraction;

    expect(ricefishForagingAppetite(0, structure)).toBe(1);
    expect(ricefishForagingAppetite(capacity * 0.5, structure))
      .toBeCloseTo(0.5);
    expect(ricefishForagingAppetite(capacity, structure)).toBe(0);
  });

  it('caps one compressed prey token at one stomachful', () => {
    const structure = WATER_CYCLE_RULES.ricefish.fryBirthBiomass;
    const capacity =
      structure * RICEFISH_ECOLOGY_RULES.gutCapacityStructuralFraction;

    expect(ricefishRecentIntakeAfterCapture(
      0,
      capacity * 30,
      structure,
    )).toBeCloseTo(capacity);
    expect(ricefishRecentIntakeAfterCapture(
      capacity * 0.8,
      capacity * 0.5,
      structure,
    )).toBeCloseTo(capacity);
  });

  it('evacuates continuously and independently of ecology step size', () => {
    const initial = 0.01;
    const oneStep = ricefishEvacuatedRecentIntake(
      initial,
      RICEFISH_ECOLOGY_RULES.gutEvacuationSeconds,
    );
    let threeSteps = initial;
    for (let step = 0; step < 3; step += 1) {
      threeSteps = ricefishEvacuatedRecentIntake(
        threeSteps,
        RICEFISH_ECOLOGY_RULES.gutEvacuationSeconds / 3,
      );
    }

    expect(oneStep).toBeCloseTo(initial / Math.E, 12);
    expect(threeSteps).toBeCloseTo(oneStep, 12);
    expect(
      ricefishEvacuatedRecentIntake(
        initial,
        RICEFISH_ECOLOGY_RULES.gutEvacuationSeconds * Math.log(2),
      ),
    ).toBeCloseTo(initial * 0.5, 12);
  });

  it('lets growing ricefish process repeated small prey faster than adults', () => {
    const initial = 0.003;
    const adultRemainder = ricefishEvacuatedRecentIntake(
      initial,
      60,
      RICEFISH_ECOLOGY_RULES.gutEvacuationSeconds,
    );
    const subadultRemainder = ricefishEvacuatedRecentIntake(
      initial,
      60,
      RICEFISH_ECOLOGY_RULES.subadultGutEvacuationSeconds,
    );
    const oneSubadultHandlingInterval = ricefishEvacuatedRecentIntake(
      initial,
      RICEFISH_ECOLOGY_RULES.subadultGutEvacuationSeconds,
      RICEFISH_ECOLOGY_RULES.subadultGutEvacuationSeconds,
    );

    expect(subadultRemainder).toBeLessThan(adultRemainder);
    expect(oneSubadultHandlingInterval).toBeCloseTo(initial / Math.E, 12);
  });

  it('keeps gut handling continuous when a juvenile first matures', () => {
    const maturityStructure =
      WATER_CYCLE_RULES.ricefish.juvenileStructuralBiomass;

    expect(ricefishGutEvacuationSecondsForStructure(
      'juvenile',
      maturityStructure,
    )).toBe(RICEFISH_ECOLOGY_RULES.subadultGutEvacuationSeconds);
    expect(ricefishGutEvacuationSecondsForStructure(
      'adult',
      maturityStructure,
    )).toBe(RICEFISH_ECOLOGY_RULES.subadultGutEvacuationSeconds);
    expect(ricefishGutEvacuationSecondsForStructure(
      'adult',
      WATER_CYCLE_RULES.ricefish.adultStructuralBiomass,
    )).toBe(RICEFISH_ECOLOGY_RULES.gutEvacuationSeconds);
  });

  it('clears a prey target until a recent full meal has evacuated', () => {
    const world = new SimulationWorld('mission-8');
    placeAnimal(world, RICEFISH, { x: 760, y: 320 });
    placePlankton(world, 'daphnia', { x: 790, y: 320 });
    const internals = internalsOf(world);
    const fish = internals.animals.find(
      (animal) => animal.speciesId === RICEFISH,
    )!;
    const daphnia = internals.animals.find(
      (animal) => animal.speciesId === DAPHNIA,
    )!;
    fish.energy = 0.2;
    fish.behavior = 'hunting';
    fish.targetAnimalId = daphnia.id;
    fish.nextTargetEvaluation = 0;
    fish.recentIntake =
      fish.structuralBiomass *
      RICEFISH_ECOLOGY_RULES.gutCapacityStructuralFraction;

    internals.stepRicefishMotion(fish, 0.1);

    expect(fish.targetAnimalId).toBeNull();
    expect(fish.behavior).not.toBe('hunting');

    fish.targetAnimalId = daphnia.id;
    fish.nextTargetEvaluation = 1;
    fish.recentIntake =
      fish.structuralBiomass *
      RICEFISH_ECOLOGY_RULES.gutCapacityStructuralFraction * 0.37;
    internals.stepRicefishMotion(fish, 0.1);

    expect(fish.targetAnimalId).toBe(daphnia.id);
    expect(fish.behavior).toBe('hunting');
  });
});

describe('ricefish reproduction reserve allometry', () => {
  it('protects the same mass-scaled fasting buffer instead of one adult absolute floor', () => {
    const maturityStructure =
      WATER_CYCLE_RULES.ricefish.juvenileStructuralBiomass;
    const maximumAdultStructure =
      WATER_CYCLE_RULES.ricefish.adultStructuralBiomass;
    const maturityFloor =
      ricefishReproductionReserveFloor(maturityStructure);

    expect(maturityFloor).toBeCloseTo(
      RICEFISH_ECOLOGY_RULES.reproductionReserveFloor *
        Math.pow(
          maturityStructure / maximumAdultStructure,
          RICEFISH_ECOLOGY_RULES.metabolicMassExponent,
        ),
      12,
    );
    expect(maturityFloor).toBeGreaterThan(0);
    expect(maturityFloor)
      .toBeLessThan(RICEFISH_ECOLOGY_RULES.reproductionReserveFloor);
    expect(ricefishReproductionReserveFloor(maximumAdultStructure))
      .toBeCloseTo(RICEFISH_ECOLOGY_RULES.reproductionReserveFloor);
    expect(ricefishReproductionReserveFloor(maturityStructure * 0.8))
      .toBeCloseTo(maturityFloor, 12);
  });

  it('keeps condition reserve capacity continuous across named life stages', () => {
    const fryStructure = WATER_CYCLE_RULES.ricefish.fryBirthBiomass;
    const maturityStructure =
      WATER_CYCLE_RULES.ricefish.juvenileStructuralBiomass;

    expect(ricefishConditionReserveCapacity(
      'fry',
      RICEFISH_ECOLOGY_RULES.fryStageSeconds,
      fryStructure,
    )).toBeCloseTo(ricefishConditionReserveCapacity(
      'juvenile',
      RICEFISH_ECOLOGY_RULES.fryStageSeconds,
      fryStructure,
    ), 12);
    expect(ricefishConditionReserveCapacity(
      'juvenile',
      RICEFISH_ECOLOGY_RULES.maturationSeconds,
      maturityStructure,
    )).toBeCloseTo(ricefishConditionReserveCapacity(
      'adult',
      RICEFISH_ECOLOGY_RULES.maturationSeconds,
      maturityStructure,
    ), 12);
  });

  it('does not enlarge a food-limited juvenile condition denominator with age', () => {
    const achievedStructure =
      WATER_CYCLE_RULES.ricefish.fryBirthBiomass * 3.2;
    const earlyCapacity = ricefishConditionReserveCapacity(
      'juvenile',
      RICEFISH_ECOLOGY_RULES.fryStageSeconds + 1,
      achievedStructure,
      achievedStructure,
    );
    const lateCapacity = ricefishConditionReserveCapacity(
      'juvenile',
      RICEFISH_ECOLOGY_RULES.maturationSeconds - 1,
      achievedStructure,
      achievedStructure,
    );

    expect(lateCapacity).toBeCloseTo(earlyCapacity, 12);
  });

  it('uses actual peak body mass when starvation has consumed structure', () => {
    const currentStructure =
      WATER_CYCLE_RULES.ricefish.fryBirthBiomass * 2;
    const achievedStructure = currentStructure * 2;

    expect(ricefishConditionReserveCapacity(
      'juvenile',
      RICEFISH_ECOLOGY_RULES.maturationSeconds,
      currentStructure,
      achievedStructure,
    )).toBeCloseTo(
      ricefishConditionReserveCapacity(
        'juvenile',
        RICEFISH_ECOLOGY_RULES.fryStageSeconds,
        achievedStructure,
        achievedStructure,
      ),
      12,
    );
  });

  it('funds a four-token cohort without consuming too much of the maturity compartment', () => {
    const clutchMatter =
      RICEFISH_ECOLOGY_RULES.eggClutchMinimum *
      WATER_CYCLE_RULES.ricefish.eggBiomass;
    const incubationLoss =
      RICEFISH_ECOLOGY_RULES.eggBaseMetabolismPerSecond *
      RICEFISH_ECOLOGY_RULES.eggIncubationSecondsAt25C;

    expect(clutchMatter).toBeLessThanOrEqual(
      WATER_CYCLE_RULES.ricefish.juvenileStructuralBiomass * 0.25,
    );
    expect(RICEFISH_ECOLOGY_RULES.eggClutchMinimum).toBe(4);
    expect(
      WATER_CYCLE_RULES.ricefish.eggBiomass - incubationLoss,
    ).toBeGreaterThan(WATER_CYCLE_RULES.ricefish.fryBirthBiomass);
    expect(RICEFISH_ECOLOGY_RULES.postSpawnCooldownSeconds)
      .toBeLessThan(RICEFISH_ECOLOGY_RULES.minimumLifespanSeconds);
    expect(
      Math.floor(
        RICEFISH_ECOLOGY_RULES.minimumLifespanSeconds /
          RICEFISH_ECOLOGY_RULES.postSpawnCooldownSeconds,
      ),
    ).toBeGreaterThanOrEqual(3);
  });
});

describe('ricefish egg attachment water safety', () => {
  it('rejects a locally harmful site even when one tank-wide average can look safe', () => {
    expect(ricefishEggAttachmentWaterSuitability(80, 1)).toBeGreaterThan(0);
    expect(
      ricefishEggAttachmentWaterSuitability(
        RICEFISH_ECOLOGY_RULES.oxygenStressStart - 0.01,
        1,
      ),
    ).toBe(0);
    expect(
      ricefishEggAttachmentWaterSuitability(
        80,
        RICEFISH_ECOLOGY_RULES.toxicWasteStressStart + 0.01,
      ),
    ).toBe(0);
  });
});

type InternalAnimal = {
  id: string;
  speciesId: AnimalSpeciesId;
  position: Vec2;
  velocity: Vec2;
  facing: -1 | 1;
  poseAngle: number;
  bodyLength: number;
  lifeStage: AnimalLifeStage;
  sex: 'female' | 'male';
  ageSeconds: number;
  lifespanSeconds: number;
  energy: number;
  health: number;
  structuralBiomass: number;
  peakStructuralBiomass?: number;
  storedBiomass: number;
  yolkBiomass?: number;
  reproductiveBiomass: number;
  recentFood: string | null;
  recentIntake: number;
  consumedBiomass: number;
  secondsSinceFood: number;
  growthProgress: number;
  behavior: string;
  behaviorTimer: number;
  targetAnimalId: string | null;
  strikeRecoveryUses?: number;
  pursuitEffort?: number;
  targetCellId: string | null;
  foragingPatchOrigin?: Vec2 | null;
  foragingLastInspectionPosition?: Vec2 | null;
  nextTargetEvaluation: number;
  reproductionCooldown: number;
  gestationRemaining: number | null;
  gestatingBroodSize?: number | null;
  matingAccumulator: number;
  maturationTargetInstars?: number;
  moltProgress?: number;
  moltCycleSeconds?: number;
  moltCount?: number;
  ovarianProgress?: number;
  randomSeed: number;
};

type InternalCell = {
  id: string;
  biomass: {
    oedogonium: number;
    nitzschia: number;
    vallisneria: number;
  };
  biofilm: {
    decomposer: number;
    nitrifier: number;
  };
};

type WorldInternals = {
  elapsedSeconds: number;
  animals: InternalAnimal[];
  biogeochemistry: {
    addPlankton(
      point: Vec2,
      kind: 'phytoplankton',
      biomass: number,
    ): number;
    emitPredatorDangerPulse(point: Vec2, strength?: number): void;
    predatorDangerCueAt(point: Vec2): number;
    oxygenAt(point: Vec2): number;
    toxicWasteAt(point: Vec2): number;
    commitAlgaeProduction(
      point: Vec2,
      requestedBiomass: number,
      oxygenReleasePoint?: Vec2,
    ): number;
    commitAlgaeRespiration(point: Vec2, requestedBiomass: number): number;
  };
  cellById(id: string): InternalCell | undefined;
  stepAnimalEcology(deltaSeconds: number): void;
  stepDaphniaEcology(deltaSeconds: number): void;
  stepDaphniaMotion(animal: InternalAnimal, deltaSeconds: number): void;
  daphniaPredatorEscape(
    animal: InternalAnimal,
  ): ({
    x: number;
    y: number;
    stress: number;
    response?: 'escape' | 'migration';
  } | null);
  stepRicefishEcology(deltaSeconds: number): void;
  stepRicefishMotion(animal: InternalAnimal, deltaSeconds: number): void;
  stepGrowth(deltaSeconds: number): void;
  recomputeLight(): void;
  sampleLightField(point: Vec2): number;
  ricefishShelterAt(point: Vec2): number;
  ricefishPreyShelter(
    prey: InternalAnimal,
    predator?: InternalAnimal,
  ): number;
  ricefishPreyDetectionRadiusAt(
    predator: InternalAnimal,
    point?: Vec2,
  ): number;
  ricefishCanTrackPrey(
    predator: InternalAnimal,
    prey: InternalAnimal,
    detectionRadius?: number,
  ): boolean;
  ricefishRelativeRefugeAt(
    prey: InternalAnimal,
    predator: InternalAnimal,
  ): { id: string } | null;
  isRicefishAnimalPrey(
    predator: InternalAnimal,
    candidate: InternalAnimal,
  ): boolean;
  chooseRicefishPreySpecies(
    predator: InternalAnimal,
    speciesId: 'daphnia' | 'cherry-shrimp',
    reserved: ReadonlySet<string>,
    foragingUrgency: number,
  ): InternalAnimal | null;
  chooseRicefishPrey(
    predator: InternalAnimal,
    foragingUrgency: number,
  ): InternalAnimal | null;
  chooseRicefishEggAttachmentCell(
    fish: InternalAnimal,
  ): InternalCell | null;
  ricefishEggAttachmentPoint(
    cell: InternalCell,
    fish: InternalAnimal,
  ): Vec2;
  growRicefish(
    animal: InternalAnimal,
    deltaSeconds: number,
    temperatureFactor: number,
  ): void;
  addRicefishReserve(animal: InternalAnimal, biomass: number): number;
  synchroniseRicefishEnergy(animal: InternalAnimal): void;
};

const internalsOf = (world: SimulationWorld): WorldInternals =>
  world as unknown as WorldInternals;

const placeAnimal = (
  world: SimulationWorld,
  speciesId: AnimalSpeciesId,
  point: Vec2,
): void => {
  world.handle({ type: 'pick-animal', speciesId, point });
  world.handle({ type: 'drop-held', point });
};

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
  point: Vec2,
): void => {
  world.handle({ type: 'pick-seed', speciesId, point });
  world.handle({ type: 'drop-held', point });
};

const substrateNearest = (
  world: SimulationWorld,
  x: number,
): ReturnType<SimulationWorld['snapshot']>['cells'][number] => {
  const cell = world.snapshot().cells
    .filter((candidate) => candidate.surfaceKind === 'substrate')
    .sort((left, right) => Math.abs(left.x - x) - Math.abs(right.x - x))[0];
  if (!cell) throw new Error('mission 8 must expose substrate cells');
  return cell;
};

const seededCell = (
  world: SimulationWorld,
  speciesId: SpeciesId = 'nitzschia',
  x = 900,
): {
  snapshot: ReturnType<SimulationWorld['snapshot']>['cells'][number];
  internal: InternalCell;
} => {
  const snapshot = substrateNearest(world, x);
  placeSeed(world, speciesId, snapshot);
  const seed = world.snapshot().seeds.at(-1);
  if (!seed) throw new Error('the placed seed must remain in the tank');
  const internal = internalsOf(world).cellById(seed.cellId);
  if (!internal) throw new Error('the placed seed must resolve to a surface cell');
  return { snapshot, internal };
};

describe('mission 8 food-web behavior', () => {
  it('does not make the same food-limited juvenile weaker merely because it is older', () => {
    const world = new SimulationWorld('mission-8');
    placeAnimal(world, RICEFISH, { x: 760, y: 320 });
    const internals = internalsOf(world);
    const fish = internals.animals.find(
      (animal) => animal.speciesId === RICEFISH,
    )!;
    const achievedStructure =
      WATER_CYCLE_RULES.ricefish.fryBirthBiomass * 3.2;

    fish.lifeStage = 'juvenile';
    fish.structuralBiomass = achievedStructure;
    fish.peakStructuralBiomass = achievedStructure;
    fish.storedBiomass = 0;
    fish.ageSeconds = RICEFISH_ECOLOGY_RULES.fryStageSeconds + 1;
    internals.synchroniseRicefishEnergy(fish);
    const earlyCondition = fish.energy;

    fish.ageSeconds = RICEFISH_ECOLOGY_RULES.maturationSeconds - 1;
    internals.synchroniseRicefishEnergy(fish);

    expect(fish.energy).toBeCloseTo(earlyCondition, 12);
    expect(fish.energy).toBeGreaterThan(
      RICEFISH_ECOLOGY_RULES.starvationEmergencyForageEnergy,
    );
  });

  it('releases Vallisneria photosynthetic oxygen and respiration along its leaves', () => {
    const world = new SimulationWorld('mission-8');
    seededCell(world, 'vallisneria', 1_050);
    const internals = internalsOf(world);
    vi.spyOn(internals, 'sampleLightField').mockReturnValue(100);
    const production = vi.spyOn(
      internals.biogeochemistry,
      'commitAlgaeProduction',
    );
    const respiration = vi.spyOn(
      internals.biogeochemistry,
      'commitAlgaeRespiration',
    );

    internals.stepGrowth(1);

    const releasePoints = production.mock.calls
      .map((call) => call[2])
      .filter((point): point is Vec2 => point !== undefined);
    expect(releasePoints.length).toBeGreaterThan(4);
    expect(new Set(releasePoints.map((point) =>
      `${point.x.toFixed(1)}:${point.y.toFixed(1)}`)).size).toBeGreaterThan(4);
    const respirationPoints = respiration.mock.calls.map((call) => call[0]);
    expect(new Set(respirationPoints.map((point) =>
      `${point.x.toFixed(1)}:${point.y.toFixed(1)}`)).size).toBeGreaterThan(4);
  });

  it('carries eggs onward instead of attaching them inside a harmful local pocket', () => {
    const world = new SimulationWorld('mission-8');
    const attachment = seededCell(world, 'vallisneria', 1_050);
    placeAnimal(world, RICEFISH, {
      x: attachment.snapshot.x,
      y: attachment.snapshot.y - 80,
    });
    const internals = internalsOf(world);
    const fish = internals.animals.find(
      (animal) => animal.speciesId === RICEFISH,
    )!;
    fish.position = {
      x: attachment.snapshot.x,
      y: attachment.snapshot.y - 80,
    };
    vi.spyOn(internals.biogeochemistry, 'oxygenAt').mockReturnValue(80);
    const toxicWaste = vi.spyOn(
      internals.biogeochemistry,
      'toxicWasteAt',
    ).mockReturnValue(12);

    expect(internals.chooseRicefishEggAttachmentCell(fish)).toBeNull();

    toxicWaste.mockReturnValue(1);
    expect(internals.chooseRicefishEggAttachmentCell(fish)).not.toBeNull();
  });

  it('attaches a Vallisneria clutch to a painted leaf instead of its substrate root', () => {
    const world = new SimulationWorld('mission-8');
    const attachment = seededCell(world, 'vallisneria', 1_050);
    placeAnimal(world, RICEFISH, {
      x: attachment.snapshot.x,
      y: attachment.snapshot.y - 80,
    });
    const internals = internalsOf(world);
    const fish = internals.animals.find(
      (animal) => animal.speciesId === RICEFISH,
    )!;

    const point = internals.ricefishEggAttachmentPoint(
      attachment.internal,
      fish,
    );

    expect(point.y).toBeLessThan(attachment.snapshot.y - 20);
    expect(Math.abs(point.x - attachment.snapshot.x)).toBeLessThan(90);
  });

  it('keeps body length continuous when a food-limited fry becomes juvenile', () => {
    const world = new SimulationWorld('mission-8');
    placeAnimal(world, RICEFISH, { x: 760, y: 320 });
    const internals = internalsOf(world);
    const fish = internals.animals.find(
      (animal) => animal.speciesId === RICEFISH,
    )!;

    fish.lifeStage = 'fry';
    fish.ageSeconds = RICEFISH_ECOLOGY_RULES.fryStageSeconds - 0.01;
    fish.structuralBiomass =
      WATER_CYCLE_RULES.ricefish.fryBirthBiomass * 0.72;
    fish.storedBiomass = 0;
    fish.bodyLength = RICEFISH_ECOLOGY_RULES.fryLength;

    internals.growRicefish(fish, 0, 1);
    const beforeTransition = fish.bodyLength;
    expect(fish.lifeStage).toBe('fry');

    fish.ageSeconds = RICEFISH_ECOLOGY_RULES.fryStageSeconds;
    internals.growRicefish(fish, 0, 1);

    expect(fish.lifeStage).toBe('juvenile');
    expect(fish.bodyLength).toBeCloseTo(beforeTransition, 8);
    expect(
      WATER_CYCLE_RULES.ricefish.eggBiomass -
        RICEFISH_ECOLOGY_RULES.eggBaseMetabolismPerSecond *
          RICEFISH_ECOLOGY_RULES.eggIncubationSecondsAt25C,
    ).toBeGreaterThan(
      WATER_CYCLE_RULES.ricefish.fryBirthBiomass * 0.72,
    );
  });

  it('keeps body length continuous when a juvenile reaches adulthood', () => {
    const world = new SimulationWorld('mission-8');
    placeAnimal(world, RICEFISH, { x: 760, y: 320 });
    const internals = internalsOf(world);
    const fish = internals.animals.find(
      (animal) => animal.speciesId === RICEFISH,
    )!;

    fish.lifeStage = 'juvenile';
    fish.ageSeconds = RICEFISH_ECOLOGY_RULES.maturationSeconds - 1;
    fish.structuralBiomass =
      WATER_CYCLE_RULES.ricefish.juvenileStructuralBiomass;
    fish.storedBiomass = 0;
    internals.growRicefish(fish, 0, 1);
    const beforeMaturity = fish.bodyLength;

    fish.ageSeconds = RICEFISH_ECOLOGY_RULES.maturationSeconds;
    internals.growRicefish(fish, 0, 1);

    expect(fish.lifeStage).toBe('adult');
    expect(beforeMaturity).toBe(RICEFISH_ECOLOGY_RULES.juvenileLength);
    expect(fish.bodyLength).toBeCloseTo(beforeMaturity);
  });

  it('preserves matter and the remaining adult span after delayed maturity', () => {
    const world = new SimulationWorld('mission-8');
    placeAnimal(world, RICEFISH, { x: 760, y: 320 });
    const internals = internalsOf(world);
    const fish = internals.animals.find(
      (animal) => animal.speciesId === RICEFISH,
    )!;
    fish.lifeStage = 'juvenile';
    fish.ageSeconds = 1_200;
    fish.lifespanSeconds = 2_800;
    fish.structuralBiomass =
      WATER_CYCLE_RULES.ricefish.juvenileStructuralBiomass;
    fish.storedBiomass = 0.004;
    fish.reproductiveBiomass = 0;
    const matterBefore =
      fish.structuralBiomass +
      fish.storedBiomass +
      fish.reproductiveBiomass;

    internals.growRicefish(fish, 0, 1);

    expect(fish.lifeStage).toBe('adult');
    expect(fish.bodyLength).toBe(RICEFISH_ECOLOGY_RULES.juvenileLength);
    expect(fish.lifespanSeconds).toBe(3_520);
    expect(
      fish.structuralBiomass +
      fish.storedBiomass +
      fish.reproductiveBiomass,
    ).toBeCloseTo(matterBefore, 12);

    const restored = new SimulationWorld('mission-8');
    restored.loadSaveData(world.exportSaveData());
    const restoredInternals = internalsOf(restored);
    const restoredFish = restoredInternals.animals.find(
      (animal) => animal.id === fish.id,
    )!;
    restoredInternals.growRicefish(restoredFish, 0, 1);
    expect(restoredFish.lifespanSeconds).toBe(3_520);
  });

  it('keeps a sub-adult reserve instead of forcing permanent hunting', () => {
    const world = new SimulationWorld('mission-8');
    placeAnimal(world, RICEFISH, { x: 760, y: 320 });
    const internals = internalsOf(world);
    const fish = internals.animals.find(
      (animal) => animal.speciesId === RICEFISH,
    )!;

    fish.lifeStage = 'juvenile';
    fish.ageSeconds = RICEFISH_ECOLOGY_RULES.maturationSeconds - 1;
    fish.structuralBiomass =
      WATER_CYCLE_RULES.ricefish.juvenileStructuralBiomass;
    fish.peakStructuralBiomass = fish.structuralBiomass;
    fish.storedBiomass =
      WATER_CYCLE_RULES.ricefish.juvenileReserveBiomass;
    fish.behavior = 'hunting';
    fish.targetAnimalId = 'missing-prey';

    internals.growRicefish(fish, 1, 1);
    internals.stepRicefishMotion(fish, 0.1);

    expect(fish.storedBiomass).toBeGreaterThanOrEqual(
      WATER_CYCLE_RULES.ricefish.juvenileReserveBiomass *
        RICEFISH_ECOLOGY_RULES.subadultGrowthReserveFraction -
        1e-9,
    );
    expect(fish.energy).toBeGreaterThan(
      RICEFISH_ECOLOGY_RULES.forageStartEnergy,
    );
    expect(fish.targetAnimalId).toBeNull();
    expect(fish.behavior).not.toBe('hunting');
  });

  it('keeps foraging when reserve alone masks an unfinished juvenile body', () => {
    const world = new SimulationWorld('mission-8');
    placeAnimal(world, RICEFISH, { x: 760, y: 320 });
    const internals = internalsOf(world);
    const fish = internals.animals.find(
      (animal) => animal.speciesId === RICEFISH,
    )!;

    fish.lifeStage = 'juvenile';
    fish.ageSeconds = RICEFISH_ECOLOGY_RULES.maturationSeconds + 100;
    fish.structuralBiomass =
      WATER_CYCLE_RULES.ricefish.juvenileStructuralBiomass * 0.62;
    fish.storedBiomass =
      WATER_CYCLE_RULES.ricefish.juvenileReserveBiomass *
      RICEFISH_ECOLOGY_RULES.subadultGrowthReserveFraction;
    fish.behavior = 'exploring';
    fish.targetAnimalId = null;
    fish.nextTargetEvaluation = 0;

    internals.growRicefish(fish, 0, 1);
    internals.stepRicefishMotion(fish, 0.1);

    expect(fish.energy).toBeLessThan(
      RICEFISH_ECOLOGY_RULES.forageStopEnergy,
    );
    expect(fish.behavior).toBe('hunting');
    expect(fish.nextTargetEvaluation).toBeGreaterThan(0);
  });

  it('lets severe body depletion override temporary gut-fullness satiation', () => {
    const world = new SimulationWorld('mission-8');
    placeAnimal(world, RICEFISH, { x: 760, y: 320 });
    const internals = internalsOf(world);
    const fish = internals.animals.find(
      (animal) => animal.speciesId === RICEFISH,
    )!;

    fish.lifeStage = 'juvenile';
    fish.ageSeconds = 320;
    fish.structuralBiomass = 0.002;
    fish.storedBiomass = 0;
    fish.energy = RICEFISH_ECOLOGY_RULES.starvationEmergencyForageEnergy * 0.5;
    fish.recentIntake = 0.001;
    fish.secondsSinceFood = 90;
    fish.behavior = 'exploring';
    fish.targetAnimalId = null;
    fish.nextTargetEvaluation = 0;

    expect(ricefishForagingAppetite(
      fish.recentIntake,
      ricefishGutCapacityReferenceBiomass(
        fish.lifeStage,
        fish.ageSeconds,
        fish.structuralBiomass,
      ),
    )).toBeLessThan(RICEFISH_ECOLOGY_RULES.foragingResumeAppetite);

    internals.stepRicefishMotion(fish, 0.1);

    expect(fish.behavior).toBe('hunting');
    expect(fish.nextTargetEvaluation).toBeGreaterThan(0);
  });

  it('lets an adult resume searching after its real reserve is exhausted', () => {
    const world = new SimulationWorld('mission-8');
    placeAnimal(world, RICEFISH, { x: 760, y: 320 });
    const internals = internalsOf(world);
    const fish = internals.animals.find(
      (animal) => animal.speciesId === RICEFISH,
    )!;

    fish.lifeStage = 'adult';
    fish.structuralBiomass =
      WATER_CYCLE_RULES.ricefish.juvenileStructuralBiomass;
    fish.peakStructuralBiomass = fish.structuralBiomass;
    fish.storedBiomass = 0;
    fish.energy = 0.28;
    fish.recentIntake = 0.002;
    fish.secondsSinceFood =
      RICEFISH_ECOLOGY_RULES.starvationFeedingGapGraceSeconds + 1;
    fish.behavior = 'exploring';
    fish.targetAnimalId = null;
    fish.nextTargetEvaluation = 0;

    expect(ricefishForagingAppetite(
      fish.recentIntake,
      ricefishGutCapacityReferenceBiomass(
        fish.lifeStage,
        fish.ageSeconds,
        fish.structuralBiomass,
      ),
    )).toBeLessThan(RICEFISH_ECOLOGY_RULES.foragingResumeAppetite);

    internals.stepRicefishMotion(fish, 0.1);

    expect(fish.behavior).toBe('hunting');
    expect(fish.nextTargetEvaluation).toBeGreaterThan(0);
  });

  it('keeps its foraging intent through a prey-search cooldown', () => {
    const world = new SimulationWorld('mission-8');
    placeAnimal(world, RICEFISH, { x: 760, y: 320 });
    const internals = internalsOf(world);
    const fish = internals.animals.find(
      (animal) => animal.speciesId === RICEFISH,
    )!;

    fish.lifeStage = 'adult';
    fish.structuralBiomass =
      WATER_CYCLE_RULES.ricefish.juvenileStructuralBiomass;
    fish.storedBiomass =
      WATER_CYCLE_RULES.ricefish.adultReserveBiomass * 0.12;
    fish.energy =
      (RICEFISH_ECOLOGY_RULES.forageStartEnergy +
        RICEFISH_ECOLOGY_RULES.forageStopEnergy) / 2;
    fish.behavior = 'hunting';
    fish.targetAnimalId = null;
    fish.nextTargetEvaluation = 0.4;

    internals.stepRicefishMotion(fish, 0.1);

    expect(fish.energy).toBeGreaterThan(
      RICEFISH_ECOLOGY_RULES.forageStartEnergy,
    );
    expect(fish.energy).toBeLessThan(
      RICEFISH_ECOLOGY_RULES.forageStopEnergy,
    );
    expect(fish.behavior).toBe('hunting');
  });

  it('lets an under-provisioned adult female keep seeking egg matter', () => {
    const world = new SimulationWorld('mission-8');
    placeAnimal(world, RICEFISH, { x: 760, y: 320 });
    const internals = internalsOf(world);
    const fish = internals.animals.find(
      (animal) => animal.speciesId === RICEFISH,
    )!;

    fish.lifeStage = 'adult';
    fish.sex = 'female';
    fish.structuralBiomass =
      WATER_CYCLE_RULES.ricefish.juvenileStructuralBiomass;
    fish.reproductiveBiomass = 0;
    fish.gestationRemaining = null;
    fish.reproductionCooldown = 0;
    fish.storedBiomass =
      ricefishReproductionReserveFloor(fish.structuralBiomass) +
      RICEFISH_ECOLOGY_RULES.eggClutchMinimum *
        WATER_CYCLE_RULES.ricefish.eggBiomass * 0.8;
    fish.energy = 0.28 +
      fish.storedBiomass /
        WATER_CYCLE_RULES.ricefish.adultReserveBiomass * 0.72;
    fish.behavior = 'exploring';
    fish.targetAnimalId = null;
    fish.nextTargetEvaluation = 0;

    internals.stepRicefishMotion(fish, 0.1);

    expect(fish.energy).toBeGreaterThan(
      RICEFISH_ECOLOGY_RULES.forageStartEnergy,
    );
    expect(fish.behavior).toBe('hunting');
    expect(fish.nextTargetEvaluation).toBeGreaterThan(0);
  });

  it('stops reproductive hunting once conserved matter can fund a clutch', () => {
    const world = new SimulationWorld('mission-8');
    placeAnimal(world, RICEFISH, { x: 760, y: 320 });
    const internals = internalsOf(world);
    const fish = internals.animals.find(
      (animal) => animal.speciesId === RICEFISH,
    )!;

    fish.lifeStage = 'adult';
    fish.sex = 'female';
    fish.structuralBiomass =
      WATER_CYCLE_RULES.ricefish.juvenileStructuralBiomass;
    fish.reproductiveBiomass = 0;
    fish.gestationRemaining = null;
    fish.reproductionCooldown = 0;
    fish.storedBiomass =
      ricefishReproductionReserveFloor(fish.structuralBiomass) +
      RICEFISH_ECOLOGY_RULES.eggClutchMinimum *
        WATER_CYCLE_RULES.ricefish.eggBiomass;
    fish.energy = 0.28 +
      fish.storedBiomass /
        WATER_CYCLE_RULES.ricefish.adultReserveBiomass * 0.72;
    fish.behavior = 'exploring';
    fish.targetAnimalId = null;
    fish.nextTargetEvaluation = 0;

    internals.stepRicefishMotion(fish, 0.1);

    expect(fish.behavior).not.toBe('hunting');
    expect(fish.targetAnimalId).toBeNull();
  });

  it('lets a strong local fish cue advance Daphnia maturity without minting matter', () => {
    const controlWorld = new SimulationWorld('mission-8');
    const cueWorld = new SimulationWorld('mission-8');
    placePlankton(controlWorld, 'daphnia', { x: 840, y: 320 });
    placePlankton(cueWorld, 'daphnia', { x: 840, y: 320 });
    const controlInternals = internalsOf(controlWorld);
    const cueInternals = internalsOf(cueWorld);
    const control = controlInternals.animals.find(
      (animal) => animal.speciesId === DAPHNIA,
    )!;
    const exposed = cueInternals.animals.find(
      (animal) => animal.speciesId === DAPHNIA,
    )!;

    for (const animal of [control, exposed]) {
      animal.lifeStage = 'juvenile';
      animal.maturationTargetInstars = 5;
      animal.moltCount = 4;
      animal.moltProgress = 0;
      animal.structuralBiomass =
        PLANKTON_ECOLOGY_RULES.daphnia.adultMinimumStructure;
      animal.storedBiomass = 0;
      animal.reproductiveBiomass = 0;
    }
    const matterBefore = exposed.structuralBiomass +
      exposed.storedBiomass + exposed.reproductiveBiomass;
    cueInternals.biogeochemistry.emitPredatorDangerPulse(
      exposed.position,
      1,
    );

    controlInternals.stepDaphniaEcology(0);
    cueInternals.stepDaphniaEcology(0);

    expect(control.lifeStage).toBe('juvenile');
    expect(exposed.lifeStage).toBe('adult');
    expect(exposed.structuralBiomass).toBeGreaterThanOrEqual(
      PLANKTON_ECOLOGY_RULES.daphnia.adultMinimumStructure,
    );
    expect(
      exposed.structuralBiomass +
        exposed.storedBiomass +
        exposed.reproductiveBiomass,
    ).toBeCloseTo(matterBefore, 12);
  });

  it('allows a strong cue to start a fully funded two-neonate brood', () => {
    const controlWorld = new SimulationWorld('mission-8');
    const cueWorld = new SimulationWorld('mission-8');
    placePlankton(controlWorld, 'daphnia', { x: 840, y: 320 });
    placePlankton(cueWorld, 'daphnia', { x: 840, y: 320 });
    const controlInternals = internalsOf(controlWorld);
    const cueInternals = internalsOf(cueWorld);
    const control = controlInternals.animals.find(
      (animal) => animal.speciesId === DAPHNIA,
    )!;
    const exposed = cueInternals.animals.find(
      (animal) => animal.speciesId === DAPHNIA,
    )!;
    const rules = PLANKTON_ECOLOGY_RULES.daphnia;

    for (const [animal, internals] of [
      [control, controlInternals],
      [exposed, cueInternals],
    ] as const) {
      animal.lifeStage = 'adult';
      animal.structuralBiomass = rules.adultMinimumStructure;
      animal.storedBiomass = rules.reproductiveReserveFloor;
      animal.reproductiveBiomass =
        rules.predatorCueMaximumBroodSize * rules.juvenileBirthBiomass;
      animal.gestationRemaining = null;
      animal.gestatingBroodSize = null;
      animal.moltProgress = 1;
      animal.moltCycleSeconds = rules.broodCooldownSeconds;
      animal.moltCount = rules.maturationInstarsMaximum;
      animal.health = 1;
      internals.biogeochemistry.addPlankton(
        animal.position,
        'phytoplankton',
        0.2,
      );
    }
    cueInternals.biogeochemistry.emitPredatorDangerPulse(
      exposed.position,
      1,
    );

    controlInternals.stepDaphniaEcology(0);
    cueInternals.stepDaphniaEcology(0);

    expect(control.gestatingBroodSize).toBe(rules.maximumBroodSize);
    expect(exposed.gestatingBroodSize)
      .toBe(rules.predatorCueMaximumBroodSize);
  });

  it('accelerates real moderate-ration egg allocation under a local fish cue', () => {
    const controlWorld = new SimulationWorld('mission-8');
    const cueWorld = new SimulationWorld('mission-8');
    placePlankton(controlWorld, 'daphnia', { x: 840, y: 320 });
    placePlankton(cueWorld, 'daphnia', { x: 840, y: 320 });
    const controlInternals = internalsOf(controlWorld);
    const cueInternals = internalsOf(cueWorld);
    const control = controlInternals.animals.find(
      (animal) => animal.speciesId === DAPHNIA,
    )!;
    const exposed = cueInternals.animals.find(
      (animal) => animal.speciesId === DAPHNIA,
    )!;
    const rules = PLANKTON_ECOLOGY_RULES.daphnia;

    for (const [animal, internals] of [
      [control, controlInternals],
      [exposed, cueInternals],
    ] as const) {
      animal.lifeStage = 'adult';
      animal.structuralBiomass = rules.adultStructuralBiomass;
      animal.storedBiomass = rules.adultReserveCapacity;
      animal.reproductiveBiomass = 0;
      animal.gestationRemaining = null;
      animal.gestatingBroodSize = null;
      animal.moltProgress = 0;
      animal.moltCycleSeconds = rules.broodCooldownSeconds;
      animal.moltCount = rules.maturationInstarsMaximum;
      animal.health = 1;
      internals.biogeochemistry.addPlankton(
        animal.position,
        'phytoplankton',
        0.05,
      );
    }
    cueInternals.biogeochemistry.emitPredatorDangerPulse(
      exposed.position,
      1,
    );

    controlInternals.stepDaphniaEcology(1);
    cueInternals.stepDaphniaEcology(1);

    expect(control.reproductiveBiomass).toBeGreaterThan(0);
    expect(exposed.reproductiveBiomass)
      .toBeGreaterThan(control.reproductiveBiomass);
  });

  it('uses the maturity compartment, not maximum adult mass, for condition', () => {
    const world = new SimulationWorld('mission-8');
    placeAnimal(world, RICEFISH, { x: 760, y: 320 });
    const internals = internalsOf(world);
    const fish = internals.animals.find(
      (animal) => animal.speciesId === RICEFISH,
    )!;

    fish.lifeStage = 'adult';
    fish.structuralBiomass =
      WATER_CYCLE_RULES.ricefish.juvenileStructuralBiomass;
    fish.peakStructuralBiomass = fish.structuralBiomass;
    fish.storedBiomass = 0;

    internals.growRicefish(fish, 0, 1);

    expect(fish.energy).toBeCloseTo(0.28, 8);
  });

  it('allocates egg matter consistently across ecology step sizes', () => {
    const makeFemale = (): {
      internals: WorldInternals;
      fish: InternalAnimal;
    } => {
      const world = new SimulationWorld('mission-8');
      placeAnimal(world, RICEFISH, { x: 760, y: 320 });
      const internals = internalsOf(world);
      const fish = internals.animals.find(
        (animal) => animal.speciesId === RICEFISH,
      )!;
      fish.lifeStage = 'adult';
      fish.sex = 'female';
      fish.structuralBiomass =
        WATER_CYCLE_RULES.ricefish.adultStructuralBiomass;
      fish.storedBiomass = 0.06;
      fish.reproductiveBiomass = 0;
      fish.gestationRemaining = null;
      fish.reproductionCooldown = 0;
      return { internals, fish };
    };
    const oneStep = makeFemale();
    const fourSteps = makeFemale();

    oneStep.internals.growRicefish(oneStep.fish, 1, 1);
    for (let index = 0; index < 4; index += 1) {
      fourSteps.internals.growRicefish(fourSteps.fish, 0.25, 1);
    }

    expect(fourSteps.fish.reproductiveBiomass).toBeCloseTo(
      oneStep.fish.reproductiveBiomass,
      10,
    );
    expect(fourSteps.fish.storedBiomass).toBeCloseTo(
      oneStep.fish.storedBiomass,
      10,
    );
  });

  it('lets a mature female split one conserved surplus between eggs and growth', () => {
    const world = new SimulationWorld('mission-8');
    placeAnimal(world, RICEFISH, { x: 760, y: 320 });
    const internals = internalsOf(world);
    const fish = internals.animals.find(
      (animal) => animal.speciesId === RICEFISH,
    )!;
    fish.lifeStage = 'adult';
    fish.sex = 'female';
    fish.structuralBiomass =
      WATER_CYCLE_RULES.ricefish.juvenileStructuralBiomass;
    fish.storedBiomass = 0.05;
    fish.reproductiveBiomass = 0;
    fish.gestationRemaining = null;
    fish.reproductionCooldown = 0;
    const structureBefore = fish.structuralBiomass;
    const matterBefore =
      fish.structuralBiomass +
      fish.storedBiomass +
      fish.reproductiveBiomass;

    internals.growRicefish(fish, 1, 1);

    expect(fish.reproductiveBiomass).toBeGreaterThan(0);
    expect(fish.structuralBiomass).toBeGreaterThan(structureBefore);
    expect(
      fish.structuralBiomass +
        fish.storedBiomass +
        fish.reproductiveBiomass,
    ).toBeCloseTo(matterBefore, 12);
  });

  it('routes an already assimilated reserve surplus into a first clutch without minting matter', () => {
    const world = new SimulationWorld('mission-8');
    placeAnimal(world, RICEFISH, { x: 760, y: 320 });
    const internals = internalsOf(world);
    const fish = internals.animals.find(
      (animal) => animal.speciesId === RICEFISH,
    )!;
    const clutchMatter =
      RICEFISH_ECOLOGY_RULES.eggClutchMinimum *
      WATER_CYCLE_RULES.ricefish.eggBiomass;

    // A near-ready adult has already conserved most of a compressed clutch.
    // This unit isolates the final allocation after maintenance has been paid;
    // feeding and respiration are tested independently.
    fish.lifeStage = 'adult';
    fish.sex = 'female';
    fish.structuralBiomass = 0.017565450634847112;
    fish.storedBiomass = 0.0016051394005616847;
    fish.reproductiveBiomass = 0.0042;
    fish.gestationRemaining = null;
    fish.reproductionCooldown = 0;
    const matterBefore = fish.structuralBiomass +
      fish.storedBiomass +
      fish.reproductiveBiomass;

    internals.growRicefish(fish, 20, 1);

    expect(fish.reproductiveBiomass).toBeGreaterThanOrEqual(clutchMatter);
    expect(fish.storedBiomass).toBeGreaterThanOrEqual(
      ricefishReproductionReserveFloor(fish.structuralBiomass) - 1e-12,
    );
    expect(
      fish.structuralBiomass +
        fish.storedBiomass +
        fish.reproductiveBiomass,
    ).toBeCloseTo(matterBefore, 12);
  });

  it('keeps a body-scaled resting reserve after reproductive allocation', () => {
    const maturityStructure =
      WATER_CYCLE_RULES.ricefish.juvenileStructuralBiomass;
    const metabolicScale = Math.pow(
      maturityStructure /
        WATER_CYCLE_RULES.ricefish.adultStructuralBiomass,
      RICEFISH_ECOLOGY_RULES.metabolicMassExponent,
    );
    const restingMaintenancePerSecond = (
      RICEFISH_ECOLOGY_RULES.adultBaseMetabolismPerSecond +
      RICEFISH_ECOLOGY_RULES.restingActivityCostPerSecond
    ) * metabolicScale;
    const protectedRestingSeconds =
      ricefishReproductionReserveFloor(maturityStructure) /
      restingMaintenancePerSecond;

    expect(protectedRestingSeconds).toBeGreaterThanOrEqual(120);
    expect(protectedRestingSeconds).toBeLessThan(150);
  });

  it('does not lower the somatic-growth reserve for males and post-spawn females', () => {
    const maturityStructure =
      WATER_CYCLE_RULES.ricefish.juvenileStructuralBiomass;
    const reproductiveFloor =
      ricefishReproductionReserveFloor(maturityStructure);
    const somaticGrowthFloor =
      ricefishAdultSomaticGrowthReserveFloor(maturityStructure);

    expect(somaticGrowthFloor).toBeGreaterThan(reproductiveFloor);
    expect(somaticGrowthFloor / reproductiveFloor).toBeCloseTo(
      RICEFISH_ECOLOGY_RULES.adultSomaticGrowthReserveFloor /
        RICEFISH_ECOLOGY_RULES.reproductionReserveFloor,
      12,
    );
    const conditionReserve =
      ricefishConditionReserveCapacity(
        'adult',
        0,
        maturityStructure,
        maturityStructure,
      );
    const conditionAtGrowthFloor =
      0.28 + 0.72 * somaticGrowthFloor / conditionReserve;
    expect(conditionAtGrowthFloor)
      .toBeGreaterThanOrEqual(RICEFISH_ECOLOGY_RULES.forageStopEnergy);
  });

  it('continuously tapers adult somatic growth as maximum size approaches', () => {
    const maturity =
      WATER_CYCLE_RULES.ricefish.juvenileStructuralBiomass;
    const maximum =
      WATER_CYCLE_RULES.ricefish.adultStructuralBiomass;
    const structureAt = (progress: number) =>
      maturity + (maximum - maturity) * progress;

    expect(ricefishAdultSomaticGrowthRateScale(structureAt(0))).toBe(1);
    expect(ricefishAdultSomaticGrowthRateScale(structureAt(0.2)))
      .toBeCloseTo(0.64, 12);
    expect(ricefishAdultSomaticGrowthRateScale(structureAt(0.5)))
      .toBeCloseTo(0.25, 12);
    expect(ricefishAdultSomaticGrowthRateScale(structureAt(0.8)))
      .toBeCloseTo(0.04, 12);
    expect(ricefishAdultSomaticGrowthRateScale(structureAt(1))).toBe(0);
  });

  it('routes an adult male net surplus to bounded growth after its fasting reserve', () => {
    const world = new SimulationWorld('mission-8');
    placeAnimal(world, RICEFISH, { x: 760, y: 320 });
    const internals = internalsOf(world);
    const fish = internals.animals.find(
      (animal) => animal.speciesId === RICEFISH,
    )!;
    fish.lifeStage = 'adult';
    fish.sex = 'male';
    fish.structuralBiomass =
      WATER_CYCLE_RULES.ricefish.juvenileStructuralBiomass;
    fish.peakStructuralBiomass = fish.structuralBiomass;
    fish.storedBiomass = 0;
    const retainedMeal = 0.01;
    const structureBefore = fish.structuralBiomass;
    const matterBefore = fish.structuralBiomass + retainedMeal;
    const initialFastingReserve =
      ricefishAdultSomaticGrowthReserveFloor(fish.structuralBiomass);

    expect(internals.addRicefishReserve(fish, retainedMeal))
      .toBeCloseTo(retainedMeal, 12);
    for (let step = 0; step < 100; step += 1) {
      internals.growRicefish(fish, 1, 1);
    }

    expect(fish.structuralBiomass).toBeGreaterThan(structureBefore);
    expect(fish.storedBiomass).toBeGreaterThanOrEqual(
      initialFastingReserve - 1e-12,
    );
    expect(fish.structuralBiomass + fish.storedBiomass)
      .toBeCloseTo(matterBefore, 12);
  });

  it('lets a receptive female fund eggs and somatic growth from one conserved surplus', () => {
    const world = new SimulationWorld('mission-8');
    placeAnimal(world, RICEFISH, { x: 760, y: 320 });
    const internals = internalsOf(world);
    const fish = internals.animals.find(
      (animal) => animal.speciesId === RICEFISH,
    )!;
    fish.lifeStage = 'adult';
    fish.sex = 'female';
    fish.structuralBiomass =
      WATER_CYCLE_RULES.ricefish.juvenileStructuralBiomass;
    fish.peakStructuralBiomass = fish.structuralBiomass;
    fish.storedBiomass = 0;
    fish.reproductiveBiomass = 0;
    fish.gestationRemaining = null;
    fish.reproductionCooldown = 0;
    const matterBefore = fish.structuralBiomass + 0.01;

    internals.addRicefishReserve(fish, 0.01);
    internals.growRicefish(fish, 1, 1);

    expect(fish.structuralBiomass)
      .toBeGreaterThan(WATER_CYCLE_RULES.ricefish.juvenileStructuralBiomass);
    expect(fish.reproductiveBiomass).toBeGreaterThan(0);
    expect(
      fish.structuralBiomass +
        fish.storedBiomass +
        fish.reproductiveBiomass,
    ).toBeCloseTo(matterBefore, 12);
  });

  it('lets a subadult turn a prey-sized reserve pulse into missing structure', () => {
    const world = new SimulationWorld('mission-8');
    placeAnimal(world, RICEFISH, { x: 760, y: 320 });
    const internals = internalsOf(world);
    const fish = internals.animals.find(
      (animal) => animal.speciesId === RICEFISH,
    )!;

    fish.lifeStage = 'juvenile';
    fish.ageSeconds = RICEFISH_ECOLOGY_RULES.maturationSeconds;
    fish.structuralBiomass = WATER_CYCLE_RULES.ricefish.fryBirthBiomass;
    fish.peakStructuralBiomass = fish.structuralBiomass;
    // One small cue-mature Daphnia yields less than the former fixed juvenile
    // reserve floor, but it is still real assimilated matter.
    fish.storedBiomass = 0.0027;
    const matterBefore = fish.structuralBiomass + fish.storedBiomass;
    const structureBefore = fish.structuralBiomass;

    internals.growRicefish(fish, 1, 1);

    expect(fish.structuralBiomass).toBeGreaterThan(structureBefore);
    expect(fish.structuralBiomass + fish.storedBiomass)
      .toBeCloseTo(matterBefore, 12);
  });

  it('does not pre-fund the next clutch during the post-spawn cooldown', () => {
    const world = new SimulationWorld('mission-8');
    placeAnimal(world, RICEFISH, { x: 760, y: 320 });
    const internals = internalsOf(world);
    const fish = internals.animals.find(
      (animal) => animal.speciesId === RICEFISH,
    )!;

    fish.lifeStage = 'adult';
    fish.sex = 'female';
    fish.structuralBiomass =
      WATER_CYCLE_RULES.ricefish.juvenileStructuralBiomass;
    fish.storedBiomass = 0.05;
    fish.reproductiveBiomass = 0;
    fish.gestationRemaining = null;
    fish.reproductionCooldown = 600;

    internals.growRicefish(fish, 1, 1);
    expect(fish.reproductiveBiomass).toBe(0);

    fish.reproductionCooldown = 0;
    internals.growRicefish(fish, 1, 1);
    expect(fish.reproductiveBiomass).toBeGreaterThan(0);
  });

  it('settles its centre behind a tracked prey so the visible mouth reaches it', () => {
    const world = new SimulationWorld('mission-8');
    placeAnimal(world, RICEFISH, { x: 760, y: 320 });
    placePlankton(world, 'daphnia', { x: 860, y: 320 });
    const internals = internalsOf(world);
    const fish = internals.animals.find(
      (animal) => animal.speciesId === RICEFISH,
    )!;
    const daphnia = internals.animals.find(
      (animal) => animal.speciesId === DAPHNIA,
    )!;
    vi.spyOn(internals, 'sampleLightField').mockReturnValue(100);
    fish.position = { x: 760, y: 320 };
    fish.velocity = { x: 0, y: 0 };
    fish.facing = 1;
    fish.poseAngle = 0;
    fish.energy = 0.2;
    fish.behavior = 'hunting';
    fish.targetAnimalId = daphnia.id;
    daphnia.position = { x: 860, y: 320 };
    daphnia.velocity = { x: 0, y: 0 };

    for (let step = 0; step < 120; step += 1) {
      internals.stepRicefishMotion(fish, 0.02);
    }

    const mouth = ricefishMouthPoint(
      fish.position,
      fish.facing,
      fish.poseAngle,
      fish.bodyLength,
    );
    const mouthDistance = Math.hypot(
      mouth.x - daphnia.position.x,
      mouth.y - daphnia.position.y,
    );
    const centreDistance = Math.hypot(
      fish.position.x - daphnia.position.x,
      fish.position.y - daphnia.position.y,
    );

    expect(mouthDistance).toBeLessThan(
      ricefishMouthContactRadius(fish.bodyLength, daphnia.bodyLength),
    );
    expect(centreDistance).toBeGreaterThan(fish.bodyLength * 0.35);
    expect(fish.targetAnimalId).toBe(daphnia.id);
  });

  it('does not flip its whole body when tracked prey jitters across its centre', () => {
    const world = new SimulationWorld('mission-8');
    placeAnimal(world, RICEFISH, { x: 760, y: 320 });
    placePlankton(world, 'daphnia', { x: 764, y: 320 });
    const internals = internalsOf(world);
    const fish = internals.animals.find(
      (animal) => animal.speciesId === RICEFISH,
    )!;
    const daphnia = internals.animals.find(
      (animal) => animal.speciesId === DAPHNIA,
    )!;
    vi.spyOn(internals, 'sampleLightField').mockReturnValue(100);
    vi.spyOn(internals, 'ricefishPreyShelter').mockReturnValue(0);
    fish.position = { x: 760, y: 320 };
    fish.velocity = { x: 0, y: 0 };
    fish.facing = 1;
    fish.poseAngle = 0;
    fish.energy = 0.2;
    fish.behavior = 'hunting';
    fish.targetAnimalId = daphnia.id;
    daphnia.velocity = { x: 0, y: 0 };

    let facingChanges = 0;
    let previousFacing = fish.facing;
    for (let step = 0; step < 40; step += 1) {
      // A nearby prey can cross the centre line by a few pixels while the
      // fish brakes beside it. That is not enough room for the fish to turn
      // its entire body and put the opposite-side mouth on the prey.
      daphnia.position = {
        x: fish.position.x + (step % 2 === 0 ? 4 : -4),
        y: fish.position.y,
      };
      internals.stepRicefishMotion(fish, 0.1);
      if (fish.facing !== previousFacing) facingChanges += 1;
      previousFacing = fish.facing;
    }

    expect(facingChanges).toBe(0);
    expect(fish.facing).toBe(1);
    expect(fish.targetAnimalId).toBe(daphnia.id);
  });

  it('keeps prey already at its mouth instead of switching across a dense swarm', () => {
    const world = new SimulationWorld('mission-8');
    placeAnimal(world, RICEFISH, { x: 760, y: 320 });
    placePlankton(world, 'daphnia', { x: 785, y: 320 });
    placePlankton(world, 'daphnia', { x: 742, y: 320 });
    const internals = internalsOf(world);
    const fish = internals.animals.find(
      (animal) => animal.speciesId === RICEFISH,
    )!;
    const daphnia = internals.animals.filter(
      (animal) => animal.speciesId === DAPHNIA,
    );
    vi.spyOn(internals, 'sampleLightField').mockReturnValue(100);
    vi.spyOn(internals, 'ricefishPreyShelter').mockReturnValue(0);
    fish.position = { x: 760, y: 320 };
    fish.velocity = { x: 0, y: 0 };
    fish.facing = 1;
    fish.poseAngle = 0;
    fish.energy = 0.2;
    fish.behavior = 'hunting';
    fish.nextTargetEvaluation = 0;
    fish.targetAnimalId = daphnia[0].id;
    for (const prey of daphnia) prey.velocity = { x: 0, y: 0 };

    let targetSwitches = 0;
    let facingChanges = 0;
    let previousTarget = fish.targetAnimalId;
    let previousFacing = fish.facing;
    for (let step = 0; step < 40; step += 1) {
      const current = daphnia.find(
        (prey) => prey.id === fish.targetAnimalId,
      )!;
      const alternative = daphnia.find(
        (prey) => prey.id !== fish.targetAnimalId,
      )!;
      const currentSide = current.id === daphnia[0].id ? 1 : -1;
      current.position = {
        x: fish.position.x + currentSide * 25,
        y: fish.position.y,
      };
      alternative.position = {
        x: fish.position.x - currentSide * 18,
        y: fish.position.y,
      };
      fish.nextTargetEvaluation = Math.max(
        0,
        fish.nextTargetEvaluation - 0.1,
      );
      internals.stepRicefishMotion(fish, 0.1);
      if (fish.targetAnimalId !== previousTarget) targetSwitches += 1;
      if (fish.facing !== previousFacing) facingChanges += 1;
      previousTarget = fish.targetAnimalId;
      previousFacing = fish.facing;
    }

    expect(targetSwitches).toBe(0);
    expect(facingChanges).toBe(0);
    expect(fish.targetAnimalId).toBe(daphnia[0].id);
  });

  it('chases and captures a moving Daphnia without manual target relocking', () => {
    const world = new SimulationWorld('mission-8');
    placeAnimal(world, RICEFISH, { x: 760, y: 320 });
    placePlankton(world, 'daphnia', { x: 860, y: 320 });
    const internals = internalsOf(world);
    const fish = internals.animals.find(
      (animal) => animal.speciesId === RICEFISH,
    )!;
    const daphnia = internals.animals.find(
      (animal) => animal.speciesId === DAPHNIA,
    )!;
    vi.spyOn(internals, 'sampleLightField').mockReturnValue(100);
    vi.spyOn(internals, 'ricefishPreyShelter').mockReturnValue(0);
    fish.position = { x: 760, y: 320 };
    fish.velocity = { x: 0, y: 0 };
    fish.facing = 1;
    fish.poseAngle = 0;
    fish.energy = 0.2;
    fish.storedBiomass = 0;
    fish.reproductiveBiomass = 0;
    fish.randomSeed = 0;
    fish.behavior = 'hunting';
    fish.behaviorTimer = 0;
    fish.targetAnimalId = daphnia.id;
    daphnia.position = { x: 860, y: 320 };
    daphnia.velocity = { x: 18, y: 0 };

    let captureSeconds: number | null = null;
    let minimumMouthDistance = Number.POSITIVE_INFINITY;
    for (let step = 0; step < 200; step += 1) {
      internals.stepDaphniaMotion(daphnia, 0.05);
      internals.stepRicefishMotion(fish, 0.05);
      const mouth = ricefishMouthPoint(
        fish.position,
        fish.facing,
        fish.poseAngle,
        fish.bodyLength,
      );
      minimumMouthDistance = Math.min(
        minimumMouthDistance,
        Math.hypot(
          mouth.x - daphnia.position.x,
          mouth.y - daphnia.position.y,
        ),
      );
      internals.stepRicefishEcology(0.05);
      if (!internals.animals.some((animal) => animal.id === daphnia.id)) {
        captureSeconds = (step + 1) * 0.05;
        break;
      }
    }

    expect(
      captureSeconds,
      JSON.stringify({
        minimumMouthDistance,
        contactRadius: ricefishMouthContactRadius(
          fish.bodyLength,
          daphnia.bodyLength,
        ),
        fishPosition: fish.position,
        fishVelocity: fish.velocity,
        fishFacing: fish.facing,
        fishPoseAngle: fish.poseAngle,
        preyPosition: daphnia.position,
        preyVelocity: daphnia.velocity,
        targetAnimalId: fish.targetAnimalId,
        behavior: fish.behavior,
      }),
    ).not.toBeNull();
    expect(captureSeconds ?? Number.POSITIVE_INFINITY).toBeLessThan(8);
    expect(fish.recentFood).toMatch(/큰물벼룩/);
  });

  it('circles to put its rendered mouth on a steeply offset moving prey', () => {
    const world = new SimulationWorld('mission-8');
    placeAnimal(world, RICEFISH, { x: 760, y: 340 });
    placePlankton(world, 'daphnia', { x: 760, y: 230 });
    const internals = internalsOf(world);
    const fish = internals.animals.find(
      (animal) => animal.speciesId === RICEFISH,
    )!;
    const daphnia = internals.animals.find(
      (animal) => animal.speciesId === DAPHNIA,
    )!;
    vi.spyOn(internals, 'sampleLightField').mockReturnValue(100);
    vi.spyOn(internals, 'ricefishPreyShelter').mockReturnValue(0);
    fish.position = { x: 760, y: 340 };
    fish.velocity = { x: 0, y: 0 };
    fish.facing = 1;
    fish.poseAngle = 0;
    fish.energy = 0.2;
    fish.storedBiomass = 0;
    fish.reproductiveBiomass = 0;
    fish.randomSeed = 0;
    fish.behavior = 'hunting';
    fish.behaviorTimer = 0;
    fish.targetAnimalId = daphnia.id;
    daphnia.position = { x: 760, y: 230 };
    daphnia.velocity = { x: 0, y: -12 };

    let captured = false;
    for (let step = 0; step < 240; step += 1) {
      internals.stepDaphniaMotion(daphnia, 0.05);
      internals.stepRicefishMotion(fish, 0.05);
      internals.stepRicefishEcology(0.05);
      if (!internals.animals.some((animal) => animal.id === daphnia.id)) {
        captured = true;
        break;
      }
    }

    expect(captured).toBe(true);
    expect(fish.recentFood).toMatch(/큰물벼룩/);
  });

  it('records conserved intake and a predation death when ricefish captures Daphnia', () => {
    const world = new SimulationWorld('mission-8');
    placeAnimal(world, RICEFISH, { x: 760, y: 320 });
    placePlankton(world, 'daphnia', { x: 766, y: 320 });
    const internals = internalsOf(world);
    const fish = internals.animals.find(
      (animal) => animal.speciesId === RICEFISH,
    )!;
    const daphnia = internals.animals.find(
      (animal) => animal.speciesId === DAPHNIA,
    )!;
    const preyMass = daphnia.structuralBiomass +
      daphnia.storedBiomass +
      daphnia.reproductiveBiomass;
    const consumedBefore = fish.consumedBiomass;
    const recentIntakeBefore = fish.recentIntake;

    fish.position = { x: 760, y: 320 };
    fish.facing = 1;
    fish.poseAngle = 0;
    fish.randomSeed = 0;
    daphnia.position = ricefishMouthPoint(
      fish.position,
      fish.facing,
      fish.poseAngle,
      fish.bodyLength,
    );
    fish.energy = 0.2;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      fish.behavior = 'hunting';
      fish.behaviorTimer = 0;
      fish.targetAnimalId = daphnia.id;
      internals.stepRicefishEcology(0.25);
      if (!internals.animals.some((animal) => animal.id === daphnia.id)) break;
    }

    const snapshot = world.snapshot();
    const survivingFish = snapshot.animals.find(
      (animal) => animal.id === fish.id,
    );
    expect(snapshot.animals.some((animal) => animal.id === daphnia.id)).toBe(false);
    expect(snapshot.carcasses.some(
      (carcass) => carcass.sourceAnimalId === daphnia.id,
    )).toBe(false);
    expect(snapshot.animalPopulationEvents.some(
      (event) =>
        event.animalId === daphnia.id &&
        event.kind === 'death' &&
        event.cause === 'predation',
    )).toBe(true);
    expect(survivingFish?.consumedBiomass ?? consumedBefore)
      .toBeGreaterThanOrEqual(consumedBefore + preyMass - 1e-9);
    const handlingCapacity =
      fish.structuralBiomass *
      RICEFISH_ECOLOGY_RULES.gutCapacityStructuralFraction;
    expect(survivingFish?.recentIntake ?? recentIntakeBefore)
      .toBeGreaterThan(0);
    expect(survivingFish?.recentIntake ?? recentIntakeBefore)
      .toBeLessThanOrEqual(handlingCapacity + 1e-9);
    expect(survivingFish?.recentFood).toMatch(/큰물벼룩/);
  });

  it('captures a newborn-sized juvenile shrimp when Daphnia are absent', () => {
    const world = new SimulationWorld('mission-8');
    placeAnimal(world, RICEFISH, { x: 760, y: 320 });
    placeAnimal(world, SHRIMP, { x: 766, y: 320 });
    const internals = internalsOf(world);
    const fish = internals.animals.find(
      (animal) => animal.speciesId === RICEFISH,
    )!;
    const shrimp = internals.animals.find(
      (animal) => animal.speciesId === SHRIMP,
    )!;
    vi.spyOn(internals, 'sampleLightField').mockReturnValue(100);
    vi.spyOn(internals, 'ricefishPreyShelter').mockReturnValue(0);
    shrimp.lifeStage = 'juvenile';
    shrimp.growthProgress = 0;
    shrimp.bodyLength = 14;
    fish.position = { x: 760, y: 320 };
    fish.facing = 1;
    fish.poseAngle = 0;
    fish.randomSeed = 0;
    shrimp.position = ricefishMouthPoint(
      fish.position,
      fish.facing,
      fish.poseAngle,
      fish.bodyLength,
    );

    for (let attempt = 0; attempt < 40; attempt += 1) {
      fish.behavior = 'hunting';
      fish.behaviorTimer = 0;
      fish.targetAnimalId = shrimp.id;
      internals.stepRicefishEcology(0.25);
      if (!internals.animals.some((animal) => animal.id === shrimp.id)) break;
    }

    expect(internals.animals.some((animal) => animal.id === shrimp.id))
      .toBe(false);
    expect(world.snapshot().animalPopulationEvents.some(
      (event) =>
        event.animalId === shrimp.id &&
        event.kind === 'death' &&
        event.cause === 'predation',
    )).toBe(true);
    expect(fish.recentFood).toBe('어린 체리새우');
  });

  it('cannot capture a target when the shared visual light field has no exposure', () => {
    const world = new SimulationWorld('mission-8');
    placeAnimal(world, RICEFISH, { x: 760, y: 320 });
    placePlankton(world, 'daphnia', { x: 766, y: 320 });
    const internals = internalsOf(world);
    const fish = internals.animals.find(
      (animal) => animal.speciesId === RICEFISH,
    )!;
    const daphnia = internals.animals.find(
      (animal) => animal.speciesId === DAPHNIA,
    )!;
    vi.spyOn(internals, 'sampleLightField').mockReturnValue(0);
    fish.position = { x: 760, y: 320 };
    fish.facing = 1;
    fish.poseAngle = 0;
    daphnia.position = ricefishMouthPoint(
      fish.position,
      fish.facing,
      fish.poseAngle,
      fish.bodyLength,
    );

    for (let attempt = 0; attempt < 20; attempt += 1) {
      fish.behavior = 'hunting';
      fish.behaviorTimer = 0;
      fish.targetAnimalId = daphnia.id;
      internals.stepRicefishEcology(0.25);
    }

    expect(internals.animals.some((animal) => animal.id === daphnia.id))
      .toBe(true);
    expect(fish.foragingPatchOrigin).toEqual(fish.position);
  });

  it('allows exactly one visible missed-strike recovery and cannot relock forever', () => {
    const world = new SimulationWorld('mission-8');
    placeAnimal(world, RICEFISH, { x: 760, y: 320 });
    placePlankton(world, 'daphnia', { x: 766, y: 320 });
    const internals = internalsOf(world);
    const fish = internals.animals.find(
      (animal) => animal.speciesId === RICEFISH,
    )!;
    const daphnia = internals.animals.find(
      (animal) => animal.speciesId === DAPHNIA,
    )!;
    // Keep a small non-zero visual opportunity so this test exercises the
    // retry state without depending on the removed canopy contact penalty.
    vi.spyOn(internals, 'sampleLightField').mockReturnValue(0.5);
    fish.position = { x: 760, y: 320 };
    fish.facing = 1;
    fish.poseAngle = 0;
    daphnia.position = ricefishMouthPoint(
      fish.position,
      fish.facing,
      fish.poseAngle,
      fish.bodyLength,
    );
    fish.ageSeconds = 0;
    // This deterministic roll stays above the deliberately dim contact chance,
    // giving two genuine visible misses.
    fish.randomSeed = 1;
    fish.behavior = 'hunting';
    fish.behaviorTimer = 0;
    fish.targetAnimalId = daphnia.id;

    internals.stepRicefishEcology(0.25);

    expect(internals.animals.some((animal) => animal.id === daphnia.id))
      .toBe(true);
    expect(fish.targetAnimalId).toBe(daphnia.id);
    expect(fish.behaviorTimer)
      .toBe(RICEFISH_ECOLOGY_RULES.strikeCooldownSeconds);
    expect(fish.strikeRecoveryUses).toBe(1);
    expect(fish.foragingPatchOrigin).toBeNull();

    fish.behaviorTimer = 0;
    internals.stepRicefishEcology(0.25);

    expect(internals.animals.some((animal) => animal.id === daphnia.id))
      .toBe(true);
    expect(fish.targetAnimalId).toBeNull();
    expect(fish.strikeRecoveryUses).toBe(0);
    expect(fish.foragingPatchOrigin).toEqual(fish.position);
  });

  it.each(['blackout', 'relative-refuge'] as const)(
    'releases a recovered target immediately on %s',
    (lossKind) => {
      const world = new SimulationWorld('mission-8');
      placeAnimal(world, RICEFISH, { x: 760, y: 320 });
      placePlankton(world, 'daphnia', { x: 766, y: 320 });
      const internals = internalsOf(world);
      const fish = internals.animals.find(
        (animal) => animal.speciesId === RICEFISH,
      )!;
      const daphnia = internals.animals.find(
        (animal) => animal.speciesId === DAPHNIA,
      )!;
      fish.position = { x: 760, y: 320 };
      daphnia.position = { x: 766, y: 320 };
      fish.energy = 0.2;
      fish.behavior = 'hunting';
      fish.behaviorTimer = RICEFISH_ECOLOGY_RULES.strikeCooldownSeconds;
      fish.targetAnimalId = daphnia.id;
      fish.strikeRecoveryUses = 1;
      const pointWhereContactWasLost = { ...fish.position };

      if (lossKind === 'blackout') {
        vi.spyOn(internals, 'sampleLightField').mockReturnValue(0);
      } else {
        vi.spyOn(internals, 'sampleLightField').mockReturnValue(100);
        vi.spyOn(internals, 'ricefishRelativeRefugeAt').mockReturnValue({
          id: 'test-gap',
        });
      }

      internals.stepRicefishMotion(fish, 0.1);

      expect(fish.targetAnimalId).toBeNull();
      expect(fish.strikeRecoveryUses).toBe(0);
      expect(fish.foragingPatchOrigin).toEqual(pointWhereContactWasLost);
    },
  );

  it('keeps a visible recovered target while closing back into retry range', () => {
    const world = new SimulationWorld('mission-8');
    placeAnimal(world, RICEFISH, { x: 760, y: 320 });
    placePlankton(world, 'daphnia', {
      x: 760 + RICEFISH_ECOLOGY_RULES.strikeDistance + 4,
      y: 320,
    });
    const internals = internalsOf(world);
    const fish = internals.animals.find(
      (animal) => animal.speciesId === RICEFISH,
    )!;
    const daphnia = internals.animals.find(
      (animal) => animal.speciesId === DAPHNIA,
    )!;
    vi.spyOn(internals, 'sampleLightField').mockReturnValue(100);
    fish.position = { x: 760, y: 320 };
    daphnia.position = {
      x: 760 + RICEFISH_ECOLOGY_RULES.strikeDistance + 4,
      y: 320,
    };
    fish.energy = 0.2;
    fish.behavior = 'hunting';
    fish.behaviorTimer = 0;
    fish.targetAnimalId = daphnia.id;
    fish.strikeRecoveryUses = 1;
    const distanceBefore = Math.hypot(
      fish.position.x - daphnia.position.x,
      fish.position.y - daphnia.position.y,
    );

    internals.stepRicefishMotion(fish, 0.1);

    expect(fish.targetAnimalId).toBe(daphnia.id);
    expect(fish.strikeRecoveryUses).toBe(1);
    expect(Math.hypot(
      fish.position.x - daphnia.position.x,
      fish.position.y - daphnia.position.y,
    )).toBeLessThan(distanceBefore);
  });

  it('favours one exposed lateral prey over an equally close exact-rear prey', () => {
    const makeEncounter = (preyPosition: Vec2): {
      internals: WorldInternals;
      fish: InternalAnimal;
    } => {
      const world = new SimulationWorld('mission-8');
      placeAnimal(world, RICEFISH, { x: 900, y: 320 });
      placePlankton(world, 'daphnia', preyPosition);
      const internals = internalsOf(world);
      const fish = internals.animals.find(
        (animal) => animal.speciesId === RICEFISH,
      )!;
      fish.position = { x: 900, y: 320 };
      fish.velocity = { x: 20, y: 0 };
      fish.facing = 1;
      vi.spyOn(internals, 'sampleLightField').mockReturnValue(100);
      return { internals, fish };
    };
    const lateral = makeEncounter({ x: 900, y: 360 });
    const rear = makeEncounter({ x: 860, y: 320 });
    let lateralDetections = 0;
    let rearDetections = 0;

    for (let epoch = 0; epoch < 80; epoch += 1) {
      lateral.fish.ageSeconds = epoch * 0.7;
      rear.fish.ageSeconds = epoch * 0.7;
      if (lateral.internals.chooseRicefishPreySpecies(
        lateral.fish,
        'daphnia',
        new Set(),
        0,
      )) lateralDetections += 1;
      if (rear.internals.chooseRicefishPreySpecies(
        rear.fish,
        'daphnia',
        new Set(),
        0,
      )) rearDetections += 1;
    }

    expect(lateralDetections).toBeGreaterThan(rearDetections);
    expect(rearDetections).toBeGreaterThan(0);
  });

  it('recognises an exposed edible Daphnia already inside near strike range', () => {
    const world = new SimulationWorld('mission-8');
    placeAnimal(world, RICEFISH, { x: 900, y: 320 });
    placePlankton(world, 'daphnia', { x: 914, y: 320 });
    const internals = internalsOf(world);
    const fish = internals.animals.find(
      (animal) => animal.speciesId === RICEFISH,
    )!;
    const daphnia = internals.animals.find(
      (animal) => animal.speciesId === DAPHNIA,
    )!;
    fish.lifeStage = 'fry';
    fish.bodyLength = RICEFISH_ECOLOGY_RULES.fryLength;
    fish.position = { x: 900, y: 320 };
    fish.velocity = { x: -20, y: 0 };
    fish.facing = -1;
    daphnia.position = { x: 914, y: 320 };
    daphnia.structuralBiomass =
      RICEFISH_ECOLOGY_RULES.fryMaximumDaphniaStructuralBiomass * 0.5;
    vi.spyOn(internals, 'sampleLightField').mockReturnValue(100);

    expect(internals.chooseRicefishPreySpecies(
      fish,
      'daphnia',
      new Set(),
      1,
    )?.id).toBe(daphnia.id);
  });

  it('chooses an edible juvenile shrimp at its mouth over a farther Daphnia', () => {
    const world = new SimulationWorld('mission-8');
    placeAnimal(world, RICEFISH, { x: 900, y: 320 });
    placeAnimal(world, SHRIMP, { x: 908, y: 320 });
    placePlankton(world, 'daphnia', { x: 918, y: 320 });
    const internals = internalsOf(world);
    const fish = internals.animals.find(
      (animal) => animal.speciesId === RICEFISH,
    )!;
    const shrimp = internals.animals.find(
      (animal) => animal.speciesId === SHRIMP,
    )!;
    fish.position = { x: 900, y: 320 };
    fish.velocity = { x: 20, y: 0 };
    fish.facing = 1;
    fish.lifeStage = 'juvenile';
    fish.bodyLength = RICEFISH_ECOLOGY_RULES.juvenileLength;
    shrimp.position = { x: 908, y: 320 };
    shrimp.lifeStage = 'juvenile';
    shrimp.growthProgress = 0;
    vi.spyOn(internals, 'sampleLightField').mockReturnValue(100);

    expect(internals.chooseRicefishPrey(fish, 0)?.id).toBe(shrimp.id);
  });

  it('uses biological shrimp growth rather than incompatible sprite lengths', () => {
    const juvenileLimit =
      ricefishMaximumShrimpGrowthProgressForBodyLength(
        RICEFISH_ECOLOGY_RULES.juvenileLength,
      );
    const adultLimit =
      ricefishMaximumShrimpGrowthProgressForBodyLength(
        RICEFISH_ECOLOGY_RULES.adultLength,
      );

    expect(
      ricefishMaximumShrimpGrowthProgressForBodyLength(
        RICEFISH_ECOLOGY_RULES.fryLength,
      ),
    ).toBe(0);
    expect(juvenileLimit).toBeGreaterThan(0);
    expect(adultLimit).toBeGreaterThan(juvenileLimit);

    const world = new SimulationWorld('mission-8');
    placeAnimal(world, RICEFISH, { x: 900, y: 320 });
    placeAnimal(world, SHRIMP, { x: 908, y: 320 });
    const internals = internalsOf(world);
    const fish = internals.animals.find(
      (animal) => animal.speciesId === RICEFISH,
    )!;
    const shrimp = internals.animals.find(
      (animal) => animal.speciesId === SHRIMP,
    )!;
    fish.lifeStage = 'juvenile';
    fish.bodyLength = RICEFISH_ECOLOGY_RULES.juvenileLength;
    shrimp.lifeStage = 'juvenile';
    // Keep the real newborn display size. The former pixel-ratio rule rejected
    // this 14 px animal even though it is the biologically smallest shrimp.
    shrimp.bodyLength = 14;
    shrimp.growthProgress = 0;
    expect(internals.isRicefishAnimalPrey(fish, shrimp)).toBe(true);

    shrimp.growthProgress = juvenileLimit + 0.01;
    expect(internals.isRicefishAnimalPrey(fish, shrimp)).toBe(false);
  });

  it('switches from a distant tracked Daphnia to one entering mouth range', () => {
    const world = new SimulationWorld('mission-8');
    placeAnimal(world, RICEFISH, { x: 900, y: 320 });
    placePlankton(world, 'daphnia', { x: 1_000, y: 320 });
    placePlankton(world, 'daphnia', { x: 910, y: 320 });
    const internals = internalsOf(world);
    const fish = internals.animals.find(
      (animal) => animal.speciesId === RICEFISH,
    )!;
    const daphnia = internals.animals
      .filter((animal) => animal.speciesId === DAPHNIA)
      .sort((left, right) => right.position.x - left.position.x);
    const distant = daphnia[0]!;
    const immediate = daphnia[1]!;
    fish.position = { x: 900, y: 320 };
    fish.velocity = { x: 20, y: 0 };
    fish.facing = 1;
    fish.energy = 0.2;
    fish.behavior = 'hunting';
    fish.behaviorTimer = 0;
    fish.targetAnimalId = distant.id;
    distant.position = { x: 1_000, y: 320 };
    immediate.position = ricefishMouthPoint(
      fish.position,
      fish.facing,
      fish.poseAngle,
      fish.bodyLength,
    );
    vi.spyOn(internals, 'sampleLightField').mockReturnValue(100);

    internals.stepRicefishMotion(fish, 0.1);

    expect(fish.targetAnimalId).toBe(immediate.id);
    expect(fish.behavior).toBe('hunting');
  });

  it('keeps a detected Daphnia target instead of falling back to surface algae', () => {
    const world = new SimulationWorld('mission-8');
    const algae = seededCell(world);
    placeAnimal(world, RICEFISH, { x: 850, y: 330 });
    placePlankton(world, 'daphnia', { x: 880, y: 330 });
    const internals = internalsOf(world);
    const fish = internals.animals.find(
      (animal) => animal.speciesId === RICEFISH,
    )!;
    const daphnia = internals.animals.find(
      (animal) => animal.speciesId === DAPHNIA,
    )!;

    fish.position = { x: 850, y: 330 };
    fish.velocity = { x: 0, y: 0 };
    daphnia.position = { x: 880, y: 330 };
    fish.energy = 0.2;
    fish.behavior = 'grazing';
    fish.targetAnimalId = daphnia.id;
    fish.targetCellId = algae.internal.id;
    fish.nextTargetEvaluation = 1;

    internals.stepRicefishMotion(fish, 0.1);

    expect(fish.behavior).toBe('hunting');
    expect(fish.targetAnimalId).toBe(daphnia.id);
    expect(fish.targetCellId).toBeNull();
    expect(fish.velocity.x).toBeGreaterThan(0);
  });

  it('keeps pursuing a valid seen prey after the acquisition timer expires', () => {
    const world = new SimulationWorld('mission-8');
    placeAnimal(world, RICEFISH, { x: 850, y: 330 });
    placePlankton(world, 'daphnia', { x: 900, y: 330 });
    const internals = internalsOf(world);
    const fish = internals.animals.find(
      (animal) => animal.speciesId === RICEFISH,
    )!;
    const daphnia = internals.animals.find(
      (animal) => animal.speciesId === DAPHNIA,
    )!;

    fish.position = { x: 850, y: 330 };
    fish.velocity = { x: 20, y: 0 };
    fish.facing = 1;
    fish.energy = 0.2;
    fish.behavior = 'hunting';
    fish.targetAnimalId = daphnia.id;
    fish.nextTargetEvaluation = 0;
    const reacquire = vi.spyOn(internals, 'chooseRicefishPrey')
      .mockReturnValue(null);

    internals.stepRicefishMotion(fish, 0.1);

    expect(reacquire).not.toHaveBeenCalled();
    expect(fish.targetAnimalId).toBe(daphnia.id);
    expect(fish.behavior).toBe('hunting');
    expect(fish.velocity.x).toBeGreaterThan(0);
  });

  it.each([
    {
      lifeStage: 'fry' as const,
      bodyLength: RICEFISH_ECOLOGY_RULES.fryLength,
      ageSeconds: 20,
    },
    {
      lifeStage: 'juvenile' as const,
      bodyLength: RICEFISH_ECOLOGY_RULES.juvenileLength,
      ageSeconds: 200,
    },
    {
      lifeStage: 'adult' as const,
      bodyLength: RICEFISH_ECOLOGY_RULES.adultLength,
      ageSeconds: 700,
    },
  ])(
    'does not let $lifeStage ricefish scrape attached algae or biofilm',
    ({ lifeStage, bodyLength, ageSeconds }) => {
      const world = new SimulationWorld('mission-8');
      const algae = seededCell(world);
      placeAnimal(world, RICEFISH, {
        x: algae.snapshot.x,
        y: algae.snapshot.y,
      });
      const internals = internalsOf(world);
      const fish = internals.animals.find(
        (animal) => animal.speciesId === RICEFISH,
      )!;
      algae.internal.biomass.oedogonium = 0.18;
      algae.internal.biofilm.decomposer = 0.12;
      algae.internal.biofilm.nitrifier = 0.08;
      const foodBefore = {
        nitzschia: algae.internal.biomass.nitzschia,
        oedogonium: algae.internal.biomass.oedogonium,
        decomposer: algae.internal.biofilm.decomposer,
        nitrifier: algae.internal.biofilm.nitrifier,
      };
      const consumedBefore = fish.consumedBiomass;

      fish.lifeStage = lifeStage;
      fish.bodyLength = bodyLength;
      fish.ageSeconds = ageSeconds;
      fish.position = {
        x: algae.snapshot.x,
        y: algae.snapshot.y,
      };
      fish.energy = 0.2;
      fish.behavior = 'grazing';
      fish.targetAnimalId = null;
      fish.targetCellId = algae.internal.id;

      internals.stepRicefishEcology(1);

      expect({
        nitzschia: algae.internal.biomass.nitzschia,
        oedogonium: algae.internal.biomass.oedogonium,
        decomposer: algae.internal.biofilm.decomposer,
        nitrifier: algae.internal.biofilm.nitrifier,
      }).toEqual(foodBefore);
      expect(fish.consumedBiomass).toBe(consumedBefore);
      expect(fish.recentFood).toBeNull();
    },
  );

  it('makes Daphnia accelerate away from an approaching ricefish', () => {
    const threatenedWorld = new SimulationWorld('mission-8');
    const baselineWorld = new SimulationWorld('mission-8');
    placePlankton(threatenedWorld, 'daphnia', { x: 840, y: 320 });
    placeAnimal(threatenedWorld, RICEFISH, { x: 790, y: 320 });
    placePlankton(baselineWorld, 'daphnia', { x: 840, y: 320 });

    const threatenedInternals = internalsOf(threatenedWorld);
    const baselineInternals = internalsOf(baselineWorld);
    const threatened = threatenedInternals.animals.find(
      (animal) => animal.speciesId === DAPHNIA,
    )!;
    const baseline = baselineInternals.animals.find(
      (animal) => animal.speciesId === DAPHNIA,
    )!;
    const predator = threatenedInternals.animals.find(
      (animal) => animal.speciesId === RICEFISH,
    )!;

    for (const daphnia of [threatened, baseline]) {
      daphnia.position = { x: 840, y: 320 };
      daphnia.velocity = { x: 0, y: 0 };
      daphnia.ageSeconds = 120;
      daphnia.energy = 0.8;
      daphnia.behavior = 'exploring';
      daphnia.secondsSinceFood = 0;
    }
    predator.position = { x: 790, y: 320 };
    predator.velocity = { x: 90, y: 0 };

    threatenedInternals.stepDaphniaMotion(threatened, 0.1);
    baselineInternals.stepDaphniaMotion(baseline, 0.1);

    expect(threatened.velocity.x).toBeGreaterThan(baseline.velocity.x + 5);
    expect(threatened.position.x).toBeGreaterThan(baseline.position.x + 0.5);
    expect(threatened.behavior).toBe('traveling');
  });

  it('reserves the outer high-speed startle for an actual pursuit', () => {
    const world = new SimulationWorld('mission-8');
    placePlankton(world, 'daphnia', { x: 850, y: 320 });
    placeAnimal(world, RICEFISH, { x: 780, y: 320 });
    const internals = internalsOf(world);
    const daphnia = internals.animals.find(
      (animal) => animal.speciesId === DAPHNIA,
    )!;
    const predator = internals.animals.find(
      (animal) => animal.speciesId === RICEFISH,
    )!;

    predator.lifeStage = 'juvenile';
    predator.bodyLength = RICEFISH_ECOLOGY_RULES.juvenileLength;
    predator.position = { x: 780, y: 320 };
    predator.velocity = { x: 90, y: 0 };
    predator.behavior = 'hunting';
    predator.targetAnimalId = null;
    daphnia.position = { x: 850, y: 320 };
    daphnia.velocity = { x: 0, y: 0 };

    const passingFish = internals.daphniaPredatorEscape(daphnia);
    expect(passingFish?.response).not.toBe('escape');

    predator.targetAnimalId = daphnia.id;
    const pursuingFish = internals.daphniaPredatorEscape(daphnia);
    expect(pursuingFish?.response).toBe('escape');
    expect(pursuingFish!.x).toBeGreaterThan(0.9);
  });

  it('uses Daphnia structure rather than an abrupt stage label for fry prey', () => {
    const world = new SimulationWorld('mission-8');
    placeAnimal(world, RICEFISH, { x: 780, y: 320 });
    placePlankton(world, 'daphnia', { x: 820, y: 320 });
    const internals = internalsOf(world);
    const fry = internals.animals.find(
      (animal) => animal.speciesId === RICEFISH,
    )!;
    const daphnia = internals.animals.find(
      (animal) => animal.speciesId === DAPHNIA,
    )!;

    fry.lifeStage = 'fry';
    fry.bodyLength = RICEFISH_ECOLOGY_RULES.fryLength;
    daphnia.lifeStage = 'adult';
    daphnia.structuralBiomass =
      PLANKTON_ECOLOGY_RULES.daphnia.adultMinimumStructure;
    expect(internals.isRicefishAnimalPrey(fry, daphnia)).toBe(true);

    daphnia.structuralBiomass =
      RICEFISH_ECOLOGY_RULES.fryMaximumDaphniaStructuralBiomass + 1e-6;
    expect(internals.isRicefishAnimalPrey(fry, daphnia)).toBe(false);
  });

  it('smoke: preserves prepared birth paths while a mixed long tank advances 600 seconds', () => {
    const world = new SimulationWorld('mission-8');
    const attachment = seededCell(world, 'vallisneria', 1_050);
    for (const x of [650, 900, 1_200, 1_450]) {
      placePlankton(world, 'phytoplankton', { x, y: 300 });
    }
    placePlankton(world, 'daphnia', { x: 820, y: 310 });
    placeAnimal(world, SHRIMP, { x: 980, y: 570 });
    placeAnimal(world, SHRIMP, { x: 1_010, y: 570 });
    placeAnimal(world, RICEFISH, { x: 1_030, y: 380 });
    placeAnimal(world, RICEFISH, { x: 1_060, y: 380 });

    const internals = internalsOf(world);
    const daphniaMother = internals.animals.find(
      (animal) => animal.speciesId === DAPHNIA,
    )!;
    const shrimpMother = internals.animals.find(
      (animal) => animal.speciesId === SHRIMP && animal.sex === 'female',
    )!;
    const fishMother = internals.animals.find(
      (animal) => animal.speciesId === RICEFISH && animal.sex === 'female',
    )!;

    daphniaMother.health = 1;
    daphniaMother.storedBiomass = Math.max(
      daphniaMother.storedBiomass,
      PLANKTON_ECOLOGY_RULES.daphnia.adultReserveCapacity,
    );
    daphniaMother.reproductiveBiomass =
      PLANKTON_ECOLOGY_RULES.daphnia.juvenileBirthBiomass;
    daphniaMother.gestationRemaining = 0;
    daphniaMother.gestatingBroodSize =
      PLANKTON_ECOLOGY_RULES.daphnia.minimumBroodSize;
    daphniaMother.moltProgress = 1;
    daphniaMother.moltCycleSeconds =
      PLANKTON_ECOLOGY_RULES.daphnia.broodCooldownSeconds;

    shrimpMother.health = 1;
    shrimpMother.energy = 1;
    shrimpMother.structuralBiomass =
      WATER_CYCLE_RULES.shrimp.adultStructuralBiomass;
    shrimpMother.storedBiomass =
      WATER_CYCLE_RULES.shrimp.adultReserveBiomass;
    shrimpMother.reproductiveBiomass =
      SHRIMP_ECOLOGY_RULES.minimumClutchSize *
      WATER_CYCLE_RULES.shrimp.juvenileBirthBiomass;
    shrimpMother.gestationRemaining = 0;
    shrimpMother.ovarianProgress = 1;

    fishMother.position = {
      x: attachment.snapshot.x,
      y: attachment.snapshot.y - 80,
    };
    fishMother.health = 1;
    fishMother.energy = 1;
    fishMother.structuralBiomass =
      WATER_CYCLE_RULES.ricefish.adultStructuralBiomass;
    fishMother.storedBiomass =
      WATER_CYCLE_RULES.ricefish.adultReserveBiomass;
    fishMother.reproductiveBiomass =
      RICEFISH_ECOLOGY_RULES.eggClutchMinimum *
      WATER_CYCLE_RULES.ricefish.eggBiomass;
    fishMother.gestationRemaining = 0;

    internals.stepAnimalEcology(0.25);

    const birthEvents = world.snapshot().animalPopulationEvents.filter(
      (event) => event.kind === 'birth',
    );
    expect(new Set(birthEvents.map((event) => event.speciesId))).toEqual(
      new Set<AnimalSpeciesId>([DAPHNIA, SHRIMP, RICEFISH]),
    );
    expect(world.snapshot().animals.some(
      (animal) =>
        animal.speciesId === DAPHNIA &&
        (animal.generation ?? 0) >= 1,
    )).toBe(true);

    world.handle({ type: 'start' });
    world.handle({ type: 'set-speed', speed: 64 });
    while (world.snapshot().elapsedSeconds < 600) world.tick(0.1);

    expect(world.snapshot().elapsedSeconds).toBeGreaterThanOrEqual(600);
    expect(world.snapshot().biogeochemistry.water.phytoplankton)
      .toHaveLength(72 * 20);
  }, 30_000);
});
