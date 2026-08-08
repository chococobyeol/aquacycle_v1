import { describe, expect, it } from 'vitest';
import { SimulationWorld } from '../src/simulation/SimulationWorld';
import {
  MISSION7_ACCEPTANCE_MATRIX,
  VallisneriaLineageTracker,
  applyMission7AcceptanceFixture,
  evaluateMission7Acceptance,
  type Mission7AcceptanceEvidence,
  type Mission7AcceptanceSample,
} from '../scripts/mission7AcceptanceMatrix';
import { MISSION7_LONG_RUN_ACCEPTANCE } from '../scripts/mission7LongRunAcceptance';
import type {
  AnimalDeathCause,
  AnimalPopulationEventKind,
  AnimalSpeciesId,
  PlantRametSnapshot,
} from '../src/simulation/types';
import {
  PLANKTON_ECOLOGY_RULES,
  WATER_CYCLE_RULES,
} from '../src/simulation/config';

const event = (
  speciesId: AnimalSpeciesId,
  kind: AnimalPopulationEventKind,
  elapsedSeconds: number,
  cause: AnimalDeathCause | null = null,
) => ({ speciesId, kind, elapsedSeconds, cause });

const sampleAt = (
  time: number,
  index: number,
): Mission7AcceptanceSample => {
  const phytoplanktonCycle = [3.4, 2.8, 1.6, 1.9, 2.7, 3.2];
  return {
    time,
    daphniaCount: 36 + (index % 5) - 2,
    daphniaAdultCount: 14 + (index % 3) - 1,
    phytoplanktonBiomass:
      phytoplanktonCycle[index % phytoplanktonCycle.length]!,
    shrimpCount: 7,
    shrimpAdultCount: 5,
    vallisneriaRunnerCount: 5,
    decomposerBiomass: 0.4,
    nitrifierBiomass: 0.35,
    oxygen: 74,
    toxicWaste: 1.1,
    organicMatter: 4.2,
    nutrients: 22,
    dissolvedInorganicCarbon: 30,
    nitrogenDriftRatio: 1e-14,
    carbonDriftRatio: -1e-14,
    oxygenEquivalentDriftRatio: 2e-14,
  };
};

const passingEvidence = (): Mission7AcceptanceEvidence => ({
  samples: Array.from({ length: 91 }, (_, index) =>
    sampleAt(index * 120, index),
  ),
  events: [
    event('daphnia', 'birth', 3_720),
    event('daphnia', 'birth', 4_200),
    event('daphnia', 'birth', 5_040),
    event('daphnia', 'birth', 6_120),
    event('daphnia', 'matured', 4_080),
    event('daphnia', 'matured', 5_280),
    event('daphnia', 'matured', 6_600),
    event('daphnia', 'death', 5_600, 'old-age'),
    event('daphnia', 'death', 6_900, 'old-age'),
    event('daphnia', 'birth', 8_000),
    event('daphnia', 'matured', 8_600),
    event('cherry-shrimp', 'birth', 4_000),
    event('cherry-shrimp', 'birth', 5_200),
    event('cherry-shrimp', 'matured', 4_900),
    event('cherry-shrimp', 'matured', 6_300),
    event('cherry-shrimp', 'death', 6_000, 'old-age'),
    event('cherry-shrimp', 'birth', 8_200),
    event('cherry-shrimp', 'matured', 9_000),
  ],
  final: {
    outcome: 'success',
    daphniaFounders: 0,
    daphniaDescendants: 6,
    daphniaMaximumLivingGeneration: 5,
    shrimpBornDescendants: 4,
    shrimpFemales: 4,
    shrimpMales: 3,
    shrimpAdultFemales: 3,
    shrimpAdultMales: 2,
    suppliedVallisneria: 0,
    runnerVallisneria: 5,
    vallisneriaMaximumLivingGeneration: 3,
    vallisneriaBiomass: 3.2,
  },
});

describe('mission 7 acceptance matrix fixtures', () => {
  it('keeps the ledger and individual Daphnia body budgets on one mass scale', () => {
    const ledger = WATER_CYCLE_RULES.daphnia;
    const individual = PLANKTON_ECOLOGY_RULES.daphnia;

    expect({
      adultStructuralBiomass: ledger.adultStructuralBiomass,
      juvenileBirthBiomass: ledger.juvenileBirthBiomass,
      suppliedAdultReserveBiomass: ledger.suppliedReserveBiomass,
      adultReserveCapacity: ledger.adultReserveBiomass,
      juvenileReserveCapacity: ledger.juvenileReserveBiomass,
    }).toEqual({
      adultStructuralBiomass: individual.adultStructuralBiomass,
      juvenileBirthBiomass: individual.juvenileBirthBiomass,
      suppliedAdultReserveBiomass:
        individual.suppliedAdultReserveBiomass,
      adultReserveCapacity: individual.adultReserveCapacity,
      juvenileReserveCapacity: individual.juvenileReserveCapacity,
    });
    expect(PLANKTON_ECOLOGY_RULES.inoculum.daphniaAdultBiomass).toBeCloseTo(
      individual.adultStructuralBiomass +
        individual.suppliedAdultReserveBiomass,
      12,
    );
  });

  it('uses explicit cycling cultures in the minimal fixture', () => {
    const world = new SimulationWorld('mission-7');

    applyMission7AcceptanceFixture(world, 'starter-only-minimal');

    const snapshot = world.snapshot();
    const saved = world.exportSaveData();
    expect(saved.microbeInventoryUsed).toEqual({
      decomposer: 2,
      nitrifier: 2,
    });
    expect(snapshot.animalPopulation['cherry-shrimp'].total).toBe(4);
    expect(snapshot.animalPopulation.daphnia.total).toBe(3);
    expect(snapshot.plants).toHaveLength(3);
    expect(snapshot.structures).toHaveLength(4);
    expect(snapshot.structures.every(
      (structure) => structure.definitionId === 'round-stone',
    )).toBe(true);
    const shrimp = snapshot.animals
      .filter((animal) => animal.speciesId === 'cherry-shrimp')
      .sort((left, right) => left.x - right.x);
    expect(shrimp.map((animal) => animal.sex)).toEqual([
      'female',
      'male',
      'female',
      'male',
    ]);
    expect(shrimp[1].x - shrimp[0].x).toBeLessThan(100);
    expect(shrimp[2].x - shrimp[1].x).toBeGreaterThan(100);
    expect(shrimp[2].x - shrimp[1].x).toBeLessThan(250);
    expect(shrimp[3].x - shrimp[2].x).toBeLessThan(100);
    expect(saved.seedPlacements.filter(
      (placement) => placement.speciesId === 'oedogonium',
    )).toHaveLength(1);
    expect(saved.seedPlacements.filter(
      (placement) => placement.speciesId === 'nitzschia',
    )).toHaveLength(1);
    expect(saved.planktonInventoryUsed).toEqual({
      phytoplankton: 3,
      daphnia: 3,
    });
  });

  it('keeps the former verifier full-stock load as a separate stress fixture', () => {
    const world = new SimulationWorld('mission-7');

    applyMission7AcceptanceFixture(world, 'full-stock-stress');

    const saved = world.exportSaveData();
    expect(saved.microbeInventoryUsed).toEqual({
      decomposer: 2,
      nitrifier: 2,
    });
    expect(saved.seedPlacements.filter(
      (placement) => placement.speciesId === 'oedogonium',
    )).toHaveLength(4);
    expect(saved.seedPlacements.filter(
      (placement) => placement.speciesId === 'nitzschia',
    )).toHaveLength(4);
    expect(saved.seedPlacements.filter(
      (placement) => placement.speciesId === 'vallisneria',
    )).toHaveLength(3);
    expect(world.snapshot().animalPopulation['cherry-shrimp'].total).toBe(4);
    expect(world.snapshot().animalPopulation.daphnia.total).toBe(3);
  });

  it('never labels either mission 7 fixture as ricefish-ready without a predation-load run', () => {
    expect(Object.values(MISSION7_ACCEPTANCE_MATRIX)).toHaveLength(2);
    expect(Object.values(MISSION7_ACCEPTANCE_MATRIX).every(
      (fixture) => fixture.ricefishPredationLoad === 'not-verified',
    )).toBe(true);
  });
});

describe('mission 7 shared long-run acceptance contract', () => {
  it('requires a renewable prey reserve rather than token lineage survival', () => {
    expect(MISSION7_LONG_RUN_ACCEPTANCE.daphnia.minimumCount).toBe(15);
    expect(MISSION7_LONG_RUN_ACCEPTANCE.daphnia.minimumMeanCount).toBe(30);
    expect(MISSION7_LONG_RUN_ACCEPTANCE.daphnia.minimumFinalCount).toBe(20);
    expect(MISSION7_LONG_RUN_ACCEPTANCE.daphnia.maximumCount).toBe(1_000);
    expect(MISSION7_LONG_RUN_ACCEPTANCE.shrimp.minimumCount).toBe(4);
  });

  it('does not treat a single 19-versus-20 boundary sample as a biological failure', () => {
    const evidence = passingEvidence();
    const firstTailIndex = evidence.samples.findIndex(
      (sample) => sample.time >=
        MISSION7_LONG_RUN_ACCEPTANCE.tailStartSeconds,
    );
    evidence.samples[firstTailIndex] = {
      ...evidence.samples[firstTailIndex]!,
      daphniaCount: 19,
    };

    const report = evaluateMission7Acceptance(
      'full-stock-stress',
      evidence,
    );

    expect(report.checks.find(
      (check) => check.id === 'daphnia-density',
    )?.passed).toBe(true);
  });

  it.each([
    'starter-only-minimal',
    'full-stock-stress',
  ] as const)('applies the same non-relaxed checks to %s', (scenarioId) => {
    const report = evaluateMission7Acceptance(
      scenarioId,
      passingEvidence(),
    );

    expect(report.passed).toBe(true);
    expect(report.checks).toHaveLength(15);
    expect(report.checks.every((check) => check.passed)).toBe(true);
    expect(report.ricefishPredationLoad).toBe('not-verified');
  });

  it('does not use the time-limited mission outcome as ecological evidence', () => {
    const evidence = passingEvidence();
    evidence.final.outcome = 'failure';

    const report = evaluateMission7Acceptance(
      'starter-only-minimal',
      evidence,
    );

    expect(report.passed).toBe(true);
    expect(report.checks.map((check) => check.id))
      .not.toContain('mission-outcome');
  });

  it('fails the exact ecological signals that the previous final-count check missed', () => {
    const evidence = passingEvidence();
    evidence.samples = evidence.samples.map((sample) => ({
      ...sample,
      daphniaCount: 0,
      phytoplanktonBiomass: 3.5 - sample.time / 7_200,
    }));
    evidence.final = {
      ...evidence.final,
      shrimpBornDescendants: 0,
      vallisneriaMaximumLivingGeneration: 1,
    };

    const report = evaluateMission7Acceptance(
      'starter-only-minimal',
      evidence,
    );
    const failed = report.checks
      .filter((check) => !check.passed)
      .map((check) => check.id);

    expect(failed).toContain('daphnia-density');
    expect(failed).toContain('phytoplankton-recovery');
    expect(failed).toContain('vallisneria-generation');
    expect(failed).toContain('shrimp-generation');
  });

  it('rejects a grow-then-terminal shrimp decline despite a neutral full-tail slope', () => {
    const evidence = passingEvidence();
    const tail = evidence.samples.filter(
      (sample) =>
        sample.time >= MISSION7_LONG_RUN_ACCEPTANCE.tailStartSeconds,
    );
    evidence.samples = evidence.samples.map((sample) => {
      const tailIndex = tail.findIndex(
        (candidate) => candidate.time === sample.time,
      );
      if (tailIndex < 0) return sample;
      const distanceFromPeak = Math.abs(tailIndex - 30);
      return {
        ...sample,
        shrimpCount: 4 + Math.round(
          16 * (1 - distanceFromPeak / 30),
        ),
        shrimpAdultCount: 1 + Math.round(
          7 * (1 - distanceFromPeak / 30),
        ),
      };
    });

    const report = evaluateMission7Acceptance(
      'full-stock-stress',
      evidence,
    );

    expect(report.checks.find(
      (check) => check.id === 'shrimp-generation',
    )?.passed).toBe(true);
    expect(report.checks.find(
      (check) => check.id === 'shrimp-trajectory',
    )?.passed).toBe(false);
  });

  it('rejects a late Daphnia decline while observed density floors still pass', () => {
    const evidence = passingEvidence();
    const tail = evidence.samples.filter(
      (sample) =>
        sample.time >= MISSION7_LONG_RUN_ACCEPTANCE.tailStartSeconds,
    );
    evidence.samples = evidence.samples.map((sample) => {
      const tailIndex = tail.findIndex(
        (candidate) => candidate.time === sample.time,
      );
      if (tailIndex < 0) return sample;
      const distanceFromPeak = Math.abs(tailIndex - 30);
      return {
        ...sample,
        daphniaCount: 20 + Math.round(
          80 * (1 - distanceFromPeak / 30),
        ),
        daphniaAdultCount: 1 + Math.round(
          39 * (1 - distanceFromPeak / 30),
        ),
      };
    });

    const report = evaluateMission7Acceptance(
      'starter-only-minimal',
      evidence,
    );

    expect(report.checks.find(
      (check) => check.id === 'daphnia-density',
    )?.passed).toBe(true);
    expect(report.checks.find(
      (check) => check.id === 'daphnia-generation',
    )?.passed).toBe(true);
    expect(report.checks.find(
      (check) => check.id === 'daphnia-trajectory',
    )?.passed).toBe(false);
  });

  it('keeps mortality ratios diagnostic when recruitment and trajectories are healthy', () => {
    const evidence = passingEvidence();
    evidence.events = evidence.events
      .filter((candidate) => candidate.kind !== 'death')
      .concat([
        event('daphnia', 'death', 8_100, 'starvation'),
        event('daphnia', 'death', 8_200, 'starvation'),
        event('cherry-shrimp', 'death', 8_300, 'starvation'),
        event('cherry-shrimp', 'death', 8_400, 'starvation'),
      ]);

    const report = evaluateMission7Acceptance(
      'full-stock-stress',
      evidence,
    );

    expect(report.passed).toBe(true);
    expect(report.checks.find(
      (check) => check.id === 'daphnia-deaths',
    )?.passed).toBe(true);
    expect(report.checks.find(
      (check) => check.id === 'shrimp-deaths',
    )?.passed).toBe(true);
    expect(report.observations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'daphnia-death-composition',
        level: 'warning',
      }),
      expect.objectContaining({
        id: 'shrimp-death-composition',
        level: 'warning',
      }),
    ]));
  });

  it('rejects a recent water decline before any sampled threshold is crossed', () => {
    const evidence = passingEvidence();
    const tail = evidence.samples.filter(
      (sample) =>
        sample.time >= MISSION7_LONG_RUN_ACCEPTANCE.tailStartSeconds,
    );
    evidence.samples = evidence.samples.map((sample) => {
      const tailIndex = tail.findIndex(
        (candidate) => candidate.time === sample.time,
      );
      if (tailIndex < 0) return sample;
      const distanceFromPeak = Math.abs(tailIndex - 30);
      return {
        ...sample,
        oxygen: 31 + 49 * (1 - distanceFromPeak / 30),
      };
    });

    const report = evaluateMission7Acceptance(
      'starter-only-minimal',
      evidence,
    );

    expect(report.checks.find(
      (check) => check.id === 'water-quality',
    )?.passed).toBe(true);
    expect(report.checks.find(
      (check) => check.id === 'water-trajectory',
    )?.passed).toBe(false);
  });

  it('fails hidden loss of a microbe guild, unsafe water, or a ledger leak', () => {
    const evidence = passingEvidence();
    evidence.samples = evidence.samples.map((sample) => ({
      ...sample,
      nitrifierBiomass: 0,
      oxygen: 12,
      nitrogenDriftRatio: 1e-4,
    }));

    const report = evaluateMission7Acceptance(
      'full-stock-stress',
      evidence,
    );
    const failed = report.checks
      .filter((check) => !check.passed)
      .map((check) => check.id);

    expect(failed).toContain('microbe-guilds');
    expect(failed).toContain('water-quality');
    expect(failed).toContain('material-ledger');
  });
});

describe('Vallisneria lineage tracking', () => {
  const plant = (
    id: string,
    parentId: string | null,
    origin: 'supplied' | 'runner',
  ): PlantRametSnapshot => ({
    id,
    parentId,
    origin,
    speciesId: 'vallisneria',
    cellId: id,
    x: 0,
    y: 0,
    connectedToParent: parentId !== null,
    ageSeconds: 100,
    lifespanSeconds: 1_000,
    lifeStage: 'mature',
    leafRetention: 1,
    structuralScale: 1,
    nitrogenReserve: 0,
    runnerReserveBiomass: 0,
    health: 1,
    runnerProgress: 0,
    runnerState: 'preparing',
    reproductionCount: 0,
  });

  it('remembers dead ancestors when evaluating a living runner-of-runner', () => {
    const tracker = new VallisneriaLineageTracker();
    tracker.observe([
      plant('founder', null, 'supplied'),
      plant('daughter', 'founder', 'runner'),
    ]);

    expect(tracker.maximumLivingGeneration([
      plant('granddaughter', 'daughter', 'runner'),
    ])).toBe(2);
  });
});
