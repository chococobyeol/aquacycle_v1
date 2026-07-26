import { SimulationWorld } from '../src/simulation/SimulationWorld';
import { CLOSED_MATERIAL_RELATIVE_TOLERANCE } from '../src/simulation/stoichiometry';
import type {
  AnimalPopulationEventSnapshot,
  AnimalSpeciesId,
  MicrobeGuildId,
  PlantRametSnapshot,
  PlanktonKind,
  SpeciesId,
  SurfaceCellSnapshot,
  Vec2,
} from '../src/simulation/types';
import {
  MISSION7_LONG_RUN_ACCEPTANCE,
  acuteWaterDeathCount,
  analyzeRecoveryOscillation,
  summarizePopulationEvents,
  type LongRunPopulationEvent,
} from './mission7LongRunAcceptance';

export type Mission7AcceptanceScenarioId =
  | 'starter-only-minimal'
  | 'full-stock-stress';

export interface Mission7AcceptanceFixture {
  id: Mission7AcceptanceScenarioId;
  label: string;
  purpose: string;
  seedPlacements: ReadonlyArray<{
    speciesId: SpeciesId;
    substrateFraction: number;
  }>;
  shrimpPlacements: readonly Vec2[];
  planktonPlacements: ReadonlyArray<{
    planktonKind: PlanktonKind;
    point: Vec2;
  }>;
  additionalBiofilmPlacements: ReadonlyArray<{
    guildId: MicrobeGuildId;
    point: Vec2;
  }>;
  /**
   * Mission 8 adds the first fish predation load. Mission 7 fixtures do not
   * claim that their standing Daphnia crop can already support that load.
   */
  ricefishPredationLoad: 'not-verified';
}

const phytoplanktonPlacements = [
  { planktonKind: 'phytoplankton', point: { x: 420, y: 260 } },
  { planktonKind: 'phytoplankton', point: { x: 600, y: 360 } },
  { planktonKind: 'phytoplankton', point: { x: 780, y: 260 } },
] as const satisfies Mission7AcceptanceFixture['planktonPlacements'];

const daphniaPlacements = [
  { planktonKind: 'daphnia', point: { x: 510, y: 300 } },
  { planktonKind: 'daphnia', point: { x: 600, y: 380 } },
  { planktonKind: 'daphnia', point: { x: 690, y: 300 } },
] as const satisfies Mission7AcceptanceFixture['planktonPlacements'];

const shrimpPlacements = [
  // The minimal fixture has only two attached-algae inocula. Each supplied
  // female/male pair begins beside one visible food patch so the acceptance
  // result measures the food web rather than a lucky first random walk outside
  // the species' deliberately local food-sensing radius.
  { x: 180, y: 610 },
  { x: 220, y: 610 },
  { x: 400, y: 610 },
  { x: 440, y: 610 },
] as const;

/**
 * Two fixtures prevent the long-run gate from validating only one convenient
 * setup:
 *
 * - starter-only-minimal uses the mission's seasoned substrate and no extra
 *   bacterial inoculation. It represents a normal player who places the
 *   mission's featured organisms plus one patch of each attached alga.
 * - full-stock-stress spends every finite organism/seed item and adds the same
 *   two inocula per guild used by the former 7,200-second verifier.
 */
export const MISSION7_ACCEPTANCE_MATRIX: Readonly<
  Record<Mission7AcceptanceScenarioId, Mission7AcceptanceFixture>
> = {
  'starter-only-minimal': {
    id: 'starter-only-minimal',
    label: '길든 바닥재 · 최소 정상 배치',
    purpose:
      '추가 균 접종 없이 지급된 기초 균막과 최소 표면 먹이만으로 전체 세대가 이어지는지 확인',
    seedPlacements: [
      { speciesId: 'oedogonium', substrateFraction: 0.14 },
      { speciesId: 'nitzschia', substrateFraction: 0.34 },
      { speciesId: 'vallisneria', substrateFraction: 0.48 },
      { speciesId: 'vallisneria', substrateFraction: 0.66 },
      { speciesId: 'vallisneria', substrateFraction: 0.82 },
    ],
    shrimpPlacements,
    planktonPlacements: [
      ...phytoplanktonPlacements,
      ...daphniaPlacements,
    ],
    additionalBiofilmPlacements: [],
    ricefishPredationLoad: 'not-verified',
  },
  'full-stock-stress': {
    id: 'full-stock-stress',
    label: '지급 풀스톡 · 추가 균 접종',
    purpose:
      '표면 생산자와 소비자를 모두 배치한 높은 생물 부하에서 장기 순환을 확인',
    seedPlacements: [
      { speciesId: 'oedogonium', substrateFraction: 0.08 },
      { speciesId: 'nitzschia', substrateFraction: 0.16 },
      { speciesId: 'vallisneria', substrateFraction: 0.24 },
      { speciesId: 'oedogonium', substrateFraction: 0.32 },
      { speciesId: 'nitzschia', substrateFraction: 0.4 },
      { speciesId: 'vallisneria', substrateFraction: 0.48 },
      { speciesId: 'oedogonium', substrateFraction: 0.56 },
      { speciesId: 'nitzschia', substrateFraction: 0.64 },
      { speciesId: 'vallisneria', substrateFraction: 0.72 },
      { speciesId: 'oedogonium', substrateFraction: 0.8 },
      { speciesId: 'nitzschia', substrateFraction: 0.88 },
    ],
    shrimpPlacements,
    planktonPlacements: [
      ...phytoplanktonPlacements,
      ...daphniaPlacements,
    ],
    additionalBiofilmPlacements: [
      { guildId: 'decomposer', point: { x: 360, y: 630 } },
      { guildId: 'decomposer', point: { x: 540, y: 630 } },
      { guildId: 'nitrifier', point: { x: 720, y: 630 } },
      { guildId: 'nitrifier', point: { x: 900, y: 630 } },
    ],
    ricefishPredationLoad: 'not-verified',
  },
};

const substrateCellAtFraction = (
  cells: readonly SurfaceCellSnapshot[],
  fraction: number,
): SurfaceCellSnapshot => {
  const substrate = cells
    .filter((cell) => cell.surfaceKind === 'substrate')
    .sort((left, right) => left.x - right.x);
  const index = Math.min(
    substrate.length - 1,
    Math.max(0, Math.round((substrate.length - 1) * fraction)),
  );
  const cell = substrate[index];
  if (!cell) throw new Error('Mission 7 fixture requires substrate cells.');
  return cell;
};

const dropPlankton = (
  world: SimulationWorld,
  planktonKind: PlanktonKind,
  point: Vec2,
): void => {
  world.handle({ type: 'pick-plankton', planktonKind, point });
  world.handle({ type: 'drop-held', point });
};

const dropSeed = (
  world: SimulationWorld,
  speciesId: SpeciesId,
  point: SurfaceCellSnapshot,
): void => {
  world.handle({ type: 'pick-seed', speciesId, point });
  world.handle({ type: 'drop-held', point });
};

const dropAnimal = (
  world: SimulationWorld,
  speciesId: AnimalSpeciesId,
  point: Vec2,
): void => {
  world.handle({ type: 'pick-animal', speciesId, point });
  world.handle({ type: 'drop-held', point });
};

const dropBiofilm = (
  world: SimulationWorld,
  guildId: MicrobeGuildId,
  point: Vec2,
): void => {
  world.handle({ type: 'pick-biofilm', guildId, point });
  world.handle({ type: 'drop-held', point });
};

/**
 * Uses the same public pick/drop command path as normal play. The world must be
 * a fresh Mission 7 world; no state or model constant is patched by the gate.
 */
export const applyMission7AcceptanceFixture = (
  world: SimulationWorld,
  scenarioId: Mission7AcceptanceScenarioId,
): Mission7AcceptanceFixture => {
  const fixture = MISSION7_ACCEPTANCE_MATRIX[scenarioId];
  for (const placement of fixture.planktonPlacements) {
    dropPlankton(world, placement.planktonKind, placement.point);
  }
  for (const placement of fixture.seedPlacements) {
    const point = substrateCellAtFraction(
      world.snapshot().cells,
      placement.substrateFraction,
    );
    dropSeed(world, placement.speciesId, point);
  }
  for (const point of fixture.shrimpPlacements) {
    dropAnimal(world, 'cherry-shrimp', point);
  }
  for (const placement of fixture.additionalBiofilmPlacements) {
    dropBiofilm(world, placement.guildId, placement.point);
  }
  return fixture;
};

export interface Mission7AcceptanceSample {
  time: number;
  daphniaCount: number;
  phytoplanktonBiomass: number;
  shrimpCount: number;
  vallisneriaRunnerCount: number;
  decomposerBiomass: number;
  nitrifierBiomass: number;
  oxygen: number;
  toxicWaste: number;
  organicMatter: number;
  nutrients: number;
  dissolvedInorganicCarbon: number;
  nitrogenDriftRatio: number;
  carbonDriftRatio: number;
  oxygenEquivalentDriftRatio: number;
}

export interface Mission7AcceptanceFinalState {
  outcome: string | null;
  daphniaFounders: number;
  daphniaDescendants: number;
  daphniaMaximumLivingGeneration: number;
  shrimpBornDescendants: number;
  shrimpAdultFemales: number;
  shrimpAdultMales: number;
  suppliedVallisneria: number;
  runnerVallisneria: number;
  vallisneriaMaximumLivingGeneration: number;
  vallisneriaBiomass: number;
}

export interface Mission7AcceptanceEvidence {
  samples: Mission7AcceptanceSample[];
  events: LongRunPopulationEvent[];
  final: Mission7AcceptanceFinalState;
}

export type Mission7AcceptanceCheckId =
  | 'duration'
  | 'daphnia-density'
  | 'daphnia-generation'
  | 'daphnia-deaths'
  | 'phytoplankton-recovery'
  | 'vallisneria-generation'
  | 'shrimp-generation'
  | 'shrimp-breeding-pair'
  | 'shrimp-deaths'
  | 'microbe-guilds'
  | 'water-quality'
  | 'material-ledger';

export interface Mission7AcceptanceCheck {
  id: Mission7AcceptanceCheckId;
  passed: boolean;
  detail: string;
}

export interface Mission7AcceptanceReport {
  scenarioId: Mission7AcceptanceScenarioId;
  passed: boolean;
  checks: Mission7AcceptanceCheck[];
  ricefishPredationLoad: 'not-verified';
}

const range = (values: number[]): [number, number] => [
  Math.min(...values),
  Math.max(...values),
];

const mean = (values: number[]): number =>
  values.reduce((total, value) => total + value, 0) /
  Math.max(1, values.length);

/**
 * Evaluates either fixture with one unchanged ecological contract. Scenario-
 * specific lower thresholds are intentionally unsupported: a difficult
 * starter-only run must fail visibly instead of being made easier on paper.
 */
export const evaluateMission7Acceptance = (
  scenarioId: Mission7AcceptanceScenarioId,
  evidence: Mission7AcceptanceEvidence,
): Mission7AcceptanceReport => {
  const thresholds = MISSION7_LONG_RUN_ACCEPTANCE;
  const tail = evidence.samples.filter(
    (sample) => sample.time >= thresholds.tailStartSeconds,
  );
  const allEvents = evidence.events;
  const tailEvents = allEvents.filter(
    (event) => event.elapsedSeconds >= thresholds.tailStartSeconds,
  );
  const daphniaEvents = summarizePopulationEvents(tailEvents, 'daphnia');
  const shrimpEvents = summarizePopulationEvents(
    tailEvents,
    'cherry-shrimp',
  );
  const daphniaCounts = tail.map((sample) => sample.daphniaCount);
  const phytoplankton = tail.map(
    (sample) => sample.phytoplanktonBiomass,
  );
  const shrimpCounts = tail.map((sample) => sample.shrimpCount);
  const runnerCounts = tail.map(
    (sample) => sample.vallisneriaRunnerCount,
  );
  const daphniaRange = range(daphniaCounts);
  const shrimpRange = range(shrimpCounts);
  const runnerRange = range(runnerCounts);
  const phytoplanktonOscillation = analyzeRecoveryOscillation(
    phytoplankton,
    thresholds.phytoplankton.meaningfulStep,
    thresholds.phytoplankton.minimumRecovery,
  );
  const maximumAbsoluteDrift = {
    nitrogen: Math.max(
      ...evidence.samples.map((sample) =>
        Math.abs(sample.nitrogenDriftRatio),
      ),
    ),
    carbon: Math.max(
      ...evidence.samples.map((sample) =>
        Math.abs(sample.carbonDriftRatio),
      ),
    ),
    oxygenEquivalent: Math.max(
      ...evidence.samples.map((sample) =>
        Math.abs(sample.oxygenEquivalentDriftRatio),
      ),
    ),
  };
  const finiteWater = evidence.samples.every((sample) =>
    [
      sample.oxygen,
      sample.toxicWaste,
      sample.organicMatter,
      sample.nutrients,
      sample.dissolvedInorganicCarbon,
    ].every((value) => Number.isFinite(value) && value >= 0),
  );
  const oxygenMinimum = Math.min(...tail.map((sample) => sample.oxygen));
  const toxicWasteMaximum = Math.max(
    ...tail.map((sample) => sample.toxicWaste),
  );
  const organicMatterMaximum = Math.max(
    ...tail.map((sample) => sample.organicMatter),
  );
  const decomposerMinimum = Math.min(
    ...tail.map((sample) => sample.decomposerBiomass),
  );
  const nitrifierMinimum = Math.min(
    ...tail.map((sample) => sample.nitrifierBiomass),
  );

  const checks: Mission7AcceptanceCheck[] = [];
  const add = (
    id: Mission7AcceptanceCheckId,
    passed: boolean,
    detail: string,
  ): void => {
    checks.push({ id, passed, detail });
  };
  add(
    'duration',
    evidence.samples.at(-1)?.time! >= thresholds.durationSeconds &&
      tail.length >=
        Math.floor(
          (thresholds.durationSeconds - thresholds.tailStartSeconds) /
            thresholds.sampleSeconds,
        ),
    `last=${evidence.samples.at(-1)?.time ?? 'none'}, tailSamples=${tail.length}`,
  );
  add(
    'daphnia-density',
    daphniaRange[0] >= thresholds.daphnia.minimumCount &&
      daphniaRange[1] <= thresholds.daphnia.maximumCount,
    `min=${daphniaRange[0]}, mean=${mean(daphniaCounts).toFixed(2)}, max=${daphniaRange[1]}`,
  );
  add(
    'daphnia-generation',
    daphniaEvents.births >= thresholds.daphnia.minimumTailBirths &&
      daphniaEvents.maturations >=
        thresholds.daphnia.minimumTailMaturations &&
      evidence.final.daphniaFounders === 0 &&
      evidence.final.daphniaDescendants >=
        thresholds.daphnia.minimumFinalDescendants &&
      evidence.final.daphniaMaximumLivingGeneration >=
        thresholds.daphnia.minimumLivingGeneration,
    `tailBirths=${daphniaEvents.births}, tailMaturations=${daphniaEvents.maturations}, ` +
      `founders=${evidence.final.daphniaFounders}, descendants=${evidence.final.daphniaDescendants}, ` +
      `generation=${evidence.final.daphniaMaximumLivingGeneration}`,
  );
  add(
    'daphnia-deaths',
    daphniaEvents.deathsByCause['old-age'] > 0 &&
      acuteWaterDeathCount(daphniaEvents) === 0 &&
      daphniaEvents.deathsByCause.predation === 0 &&
      daphniaEvents.deathsByCause.starvation <=
        daphniaEvents.deathsByCause['old-age'],
    `oldAge=${daphniaEvents.deathsByCause['old-age']}, starvation=` +
      `${daphniaEvents.deathsByCause.starvation}, ` +
      `waterStress=${acuteWaterDeathCount(daphniaEvents)}`,
  );
  add(
    'phytoplankton-recovery',
    phytoplanktonOscillation.minimum >=
        thresholds.phytoplankton.minimumBiomass &&
      phytoplanktonOscillation.span >=
        thresholds.phytoplankton.minimumSpan &&
      phytoplanktonOscillation.hasDepletionAndRecovery,
    `min=${phytoplanktonOscillation.minimum.toFixed(3)}, ` +
      `span=${phytoplanktonOscillation.span.toFixed(3)}, ` +
      `recovery=${phytoplanktonOscillation.largestRecoveryAfterTrough.toFixed(3)}`,
  );
  add(
    'vallisneria-generation',
    evidence.final.suppliedVallisneria === 0 &&
      runnerRange[0] >= thresholds.vallisneria.minimumTailRunners &&
      evidence.final.runnerVallisneria >=
        thresholds.vallisneria.minimumFinalRunners &&
      evidence.final.vallisneriaBiomass >
        thresholds.vallisneria.minimumFinalBiomass &&
      evidence.final.vallisneriaMaximumLivingGeneration >= 2,
    `supplied=${evidence.final.suppliedVallisneria}, tailRunnerMin=${runnerRange[0]}, ` +
      `runners=${evidence.final.runnerVallisneria}, ` +
      `generation=${evidence.final.vallisneriaMaximumLivingGeneration}, ` +
      `biomass=${evidence.final.vallisneriaBiomass.toFixed(3)}`,
  );
  add(
    'shrimp-generation',
    shrimpRange[0] > 0 &&
      shrimpEvents.births >= thresholds.shrimp.minimumTailBirths &&
      shrimpEvents.maturations >= thresholds.shrimp.minimumTailMaturations &&
      evidence.final.shrimpBornDescendants >= 2,
    `tailMin=${shrimpRange[0]}, births=${shrimpEvents.births}, ` +
      `maturations=${shrimpEvents.maturations}, bornAlive=${evidence.final.shrimpBornDescendants}`,
  );
  add(
    'shrimp-breeding-pair',
    evidence.final.shrimpAdultFemales > 0 &&
      evidence.final.shrimpAdultMales > 0,
    `females=${evidence.final.shrimpAdultFemales}, males=${evidence.final.shrimpAdultMales}`,
  );
  add(
    'shrimp-deaths',
    shrimpEvents.deathsByCause['old-age'] > 0 &&
      acuteWaterDeathCount(shrimpEvents) === 0 &&
      shrimpEvents.deathsByCause.predation === 0 &&
      shrimpEvents.deathsByCause.starvation <=
        shrimpEvents.deathsByCause['old-age'],
    `oldAge=${shrimpEvents.deathsByCause['old-age']}, starvation=` +
      `${shrimpEvents.deathsByCause.starvation}, ` +
      `waterStress=${acuteWaterDeathCount(shrimpEvents)}`,
  );
  add(
    'microbe-guilds',
    decomposerMinimum > 0 && nitrifierMinimum > 0,
    `decomposerMin=${decomposerMinimum.toFixed(3)}, nitrifierMin=${nitrifierMinimum.toFixed(3)}`,
  );
  add(
    'water-quality',
    finiteWater &&
      oxygenMinimum > thresholds.water.minimumOxygen &&
      toxicWasteMaximum < thresholds.water.maximumToxicWaste &&
      organicMatterMaximum < thresholds.water.maximumOrganicMatter,
    `oxygenMin=${oxygenMinimum.toFixed(3)}, toxicMax=${toxicWasteMaximum.toFixed(3)}, ` +
      `organicMax=${organicMatterMaximum.toFixed(3)}, finite=${finiteWater}`,
  );
  add(
    'material-ledger',
    maximumAbsoluteDrift.nitrogen < CLOSED_MATERIAL_RELATIVE_TOLERANCE &&
      maximumAbsoluteDrift.carbon < CLOSED_MATERIAL_RELATIVE_TOLERANCE &&
      maximumAbsoluteDrift.oxygenEquivalent <
        CLOSED_MATERIAL_RELATIVE_TOLERANCE,
    `N=${maximumAbsoluteDrift.nitrogen.toExponential(3)}, ` +
      `C=${maximumAbsoluteDrift.carbon.toExponential(3)}, ` +
      `O=${maximumAbsoluteDrift.oxygenEquivalent.toExponential(3)}`,
  );

  return {
    scenarioId,
    passed: checks.every((check) => check.passed),
    checks,
    ricefishPredationLoad:
      MISSION7_ACCEPTANCE_MATRIX[scenarioId].ricefishPredationLoad,
  };
};

/**
 * Parent links can outlive a ramet in the current snapshot. The tracker keeps
 * every parent relation seen during the run so living runner-of-runner depth
 * can still be evaluated after its ancestors die.
 */
export class VallisneriaLineageTracker {
  private readonly parents = new Map<string, string | null>();

  observe(plants: readonly PlantRametSnapshot[]): void {
    for (const plant of plants) {
      this.parents.set(plant.id, plant.parentId);
    }
  }

  generationOf(id: string): number {
    let generation = 0;
    let current = id;
    const visited = new Set<string>();
    while (!visited.has(current)) {
      visited.add(current);
      const parent = this.parents.get(current);
      if (!parent) break;
      generation += 1;
      current = parent;
    }
    return generation;
  }

  maximumLivingGeneration(plants: readonly PlantRametSnapshot[]): number {
    this.observe(plants);
    return Math.max(0, ...plants.map((plant) => this.generationOf(plant.id)));
  }
}

export const toLongRunPopulationEvents = (
  events: readonly AnimalPopulationEventSnapshot[],
): LongRunPopulationEvent[] =>
  events.map((event) => ({
    speciesId: event.speciesId,
    kind: event.kind,
    cause: event.cause,
    elapsedSeconds: event.elapsedSeconds,
  }));
