import { SimulationWorld } from '../src/simulation/SimulationWorld';
import { CLOSED_MATERIAL_RELATIVE_TOLERANCE } from '../src/simulation/stoichiometry';
import type {
  AnimalPopulationEventSnapshot,
  AnimalSpeciesId,
  MicrobeGuildId,
  PlantRametSnapshot,
  PlanktonKind,
  SpeciesId,
  StructureDefinitionId,
  SurfaceCellSnapshot,
  Vec2,
} from '../src/simulation/types';
import {
  MISSION7_LONG_RUN_ACCEPTANCE,
  acuteWaterDeathCount,
  analyzeRecoveryOscillation,
  recentHalf,
  summarizeLinearTailTrend,
  summarizePopulationEvents,
  sustainedProjectedCeilingBreach,
  sustainedProjectedFloorBreach,
  type LongRunPopulationEvent,
} from './mission7LongRunAcceptance';

export type Mission7AcceptanceScenarioId =
  | 'starter-only-minimal'
  | 'full-stock-stress';

export interface Mission7AcceptanceFixture {
  id: Mission7AcceptanceScenarioId;
  label: string;
  purpose: string;
  structurePlacements: ReadonlyArray<{
    definitionId: StructureDefinitionId;
    point: Vec2;
  }>;
  seedPlacements: ReadonlyArray<{
    speciesId: SpeciesId;
    target:
      | { kind: 'substrate'; fraction: number }
      | { kind: 'structure'; structureIndex: number; cellFraction: number };
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

const habitatStructures = [
  // Low rounded stones leave illuminated gaps for rooted plants and put their
  // edible faces near the bottom-dwelling shrimp. Four tall plates cast a
  // continuous low-light band over all three Vallisneria roots.
  { definitionId: 'round-stone', point: { x: 240, y: 360 } },
  { definitionId: 'round-stone', point: { x: 480, y: 360 } },
  { definitionId: 'round-stone', point: { x: 720, y: 360 } },
  { definitionId: 'round-stone', point: { x: 960, y: 360 } },
] as const satisfies Mission7AcceptanceFixture['structurePlacements'];

const shrimpPlacements = [
  // Keep one female/male pair beside each central food inoculum. The adjacent
  // rounded stones leave separate grazing surfaces but overlapping odour and
  // walking corridors, so low-density mating is an outcome of placement
  // rather than a whole-tank partner search.
  { x: 450, y: 610 },
  { x: 510, y: 610 },
  { x: 690, y: 610 },
  { x: 750, y: 610 },
] as const;

const explicitCyclingCultures = [
  { guildId: 'decomposer', point: { x: 360, y: 630 } },
  { guildId: 'decomposer', point: { x: 540, y: 630 } },
  { guildId: 'nitrifier', point: { x: 720, y: 630 } },
  { guildId: 'nitrifier', point: { x: 900, y: 630 } },
] as const satisfies Mission7AcceptanceFixture['additionalBiofilmPlacements'];

/**
 * Two fixtures prevent the long-run gate from validating only one convenient
 * setup:
 *
 * - starter-only-minimal explicitly inoculates both cycling guilds and places
 *   the mission's featured organisms plus one patch of each attached alga.
 * - full-stock-stress spends every finite organism/seed item with the same
 *   explicit two inocula per guild.
 */
export const MISSION7_ACCEPTANCE_MATRIX: Readonly<
  Record<Mission7AcceptanceScenarioId, Mission7AcceptanceFixture>
> = {
  'starter-only-minimal': {
    id: 'starter-only-minimal',
    label: '명시적 순환 접종 · 최소 정상 배치',
    purpose:
      '숨은 기초 균막 없이 두 균 기능군을 직접 접종한 최소 구성에서 전체 세대가 이어지는지 확인',
    structurePlacements: habitatStructures,
    seedPlacements: [
      {
        speciesId: 'oedogonium',
        target: { kind: 'structure', structureIndex: 1, cellFraction: 0.45 },
      },
      {
        speciesId: 'nitzschia',
        target: { kind: 'structure', structureIndex: 2, cellFraction: 0.45 },
      },
      { speciesId: 'vallisneria', target: { kind: 'substrate', fraction: 0.1 } },
      { speciesId: 'vallisneria', target: { kind: 'substrate', fraction: 0.5 } },
      { speciesId: 'vallisneria', target: { kind: 'substrate', fraction: 0.9 } },
    ],
    shrimpPlacements,
    planktonPlacements: [
      ...phytoplanktonPlacements,
      ...daphniaPlacements,
    ],
    additionalBiofilmPlacements: explicitCyclingCultures,
    ricefishPredationLoad: 'not-verified',
  },
  'full-stock-stress': {
    id: 'full-stock-stress',
    label: '지급 풀스톡 · 추가 균 접종',
    purpose:
      '표면 생산자와 소비자를 모두 배치한 높은 생물 부하에서 장기 순환을 확인',
    structurePlacements: habitatStructures,
    seedPlacements: [
      ...Array.from({ length: 4 }, (_, structureIndex) => ({
        speciesId: 'oedogonium' as const,
        target: {
          kind: 'structure' as const,
          structureIndex,
          cellFraction: 0.34,
        },
      })),
      ...Array.from({ length: 4 }, (_, structureIndex) => ({
        speciesId: 'nitzschia' as const,
        target: {
          kind: 'structure' as const,
          structureIndex,
          cellFraction: 0.66,
        },
      })),
      { speciesId: 'vallisneria', target: { kind: 'substrate', fraction: 0.1 } },
      { speciesId: 'vallisneria', target: { kind: 'substrate', fraction: 0.5 } },
      { speciesId: 'vallisneria', target: { kind: 'substrate', fraction: 0.9 } },
    ],
    shrimpPlacements,
    planktonPlacements: [
      ...phytoplanktonPlacements,
      ...daphniaPlacements,
    ],
    additionalBiofilmPlacements: explicitCyclingCultures,
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

const structureCellAtFraction = (
  world: SimulationWorld,
  structureIndex: number,
  fraction: number,
): SurfaceCellSnapshot => {
  const snapshot = world.snapshot();
  const structure = snapshot.structures[structureIndex];
  if (!structure) {
    throw new Error(
      `Mission 7 fixture requires structure ${structureIndex}.`,
    );
  }
  const cells = snapshot.cells
    .filter((cell) => cell.ownerId === structure.id)
    .sort((left, right) => left.y - right.y || left.x - right.x);
  const index = Math.min(
    cells.length - 1,
    Math.max(0, Math.round((cells.length - 1) * fraction)),
  );
  const cell = cells[index];
  if (!cell) {
    throw new Error(
      `Mission 7 fixture structure ${structureIndex} has no surface cells.`,
    );
  }
  return cell;
};

const dropStructure = (
  world: SimulationWorld,
  definitionId: StructureDefinitionId,
  point: Vec2,
): void => {
  world.handle({ type: 'pick-structure', definitionId, point });
  world.handle({ type: 'drop-held', point });
  // The public placement path uses the same falling/settling physics as play.
  // Finish that setup motion before selecting its authored surface cells.
  for (let index = 0; index < 720; index += 1) {
    world.tick(1 / 60);
  }
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
  for (const placement of fixture.structurePlacements) {
    dropStructure(world, placement.definitionId, placement.point);
  }
  for (const placement of fixture.planktonPlacements) {
    dropPlankton(world, placement.planktonKind, placement.point);
  }
  for (const placement of fixture.seedPlacements) {
    const point = placement.target.kind === 'substrate'
      ? substrateCellAtFraction(
        world.snapshot().cells,
        placement.target.fraction,
      )
      : structureCellAtFraction(
        world,
        placement.target.structureIndex,
        placement.target.cellFraction,
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
  daphniaAdultCount: number;
  phytoplanktonBiomass: number;
  shrimpCount: number;
  shrimpAdultCount: number;
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
  shrimpFemales: number;
  shrimpMales: number;
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
  | 'daphnia-trajectory'
  | 'daphnia-deaths'
  | 'phytoplankton-recovery'
  | 'vallisneria-generation'
  | 'shrimp-generation'
  | 'shrimp-trajectory'
  | 'shrimp-breeding-pair'
  | 'shrimp-deaths'
  | 'microbe-guilds'
  | 'water-quality'
  | 'water-trajectory'
  | 'material-ledger';

export interface Mission7AcceptanceCheck {
  id: Mission7AcceptanceCheckId;
  passed: boolean;
  detail: string;
}

export interface Mission7AcceptanceObservation {
  id: 'daphnia-death-composition' | 'shrimp-death-composition';
  level: 'info' | 'warning';
  detail: string;
}

export interface Mission7AcceptanceReport {
  scenarioId: Mission7AcceptanceScenarioId;
  passed: boolean;
  checks: Mission7AcceptanceCheck[];
  observations: Mission7AcceptanceObservation[];
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
  const recentTailSamples = recentHalf(tail);
  const recentTailStartSeconds =
    recentTailSamples[0]?.time ?? thresholds.tailStartSeconds;
  const recentTailEvents = allEvents.filter(
    (event) => event.elapsedSeconds >= recentTailStartSeconds,
  );
  const daphniaEvents = summarizePopulationEvents(tailEvents, 'daphnia');
  const recentDaphniaEvents = summarizePopulationEvents(
    recentTailEvents,
    'daphnia',
  );
  const shrimpEvents = summarizePopulationEvents(
    tailEvents,
    'cherry-shrimp',
  );
  const recentShrimpEvents = summarizePopulationEvents(
    recentTailEvents,
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
  const trendSeries = (
    select: (sample: Mission7AcceptanceSample) => number,
  ) => tail.map((sample) => ({
    time: sample.time,
    value: select(sample),
  }));
  const daphniaPopulationSeries = trendSeries(
    (sample) => sample.daphniaCount,
  );
  const daphniaAdultSeries = trendSeries(
    (sample) => sample.daphniaAdultCount,
  );
  const shrimpPopulationSeries = trendSeries(
    (sample) => sample.shrimpCount,
  );
  const shrimpAdultSeries = trendSeries(
    (sample) => sample.shrimpAdultCount,
  );
  const oxygenSeries = trendSeries((sample) => sample.oxygen);
  const toxicWasteSeries = trendSeries((sample) => sample.toxicWaste);
  const organicMatterSeries = trendSeries((sample) => sample.organicMatter);
  const daphniaPopulationTrend =
    summarizeLinearTailTrend(daphniaPopulationSeries);
  const recentDaphniaPopulationTrend = summarizeLinearTailTrend(
    recentHalf(daphniaPopulationSeries),
  );
  const daphniaAdultTrend = summarizeLinearTailTrend(daphniaAdultSeries);
  const recentDaphniaAdultTrend = summarizeLinearTailTrend(
    recentHalf(daphniaAdultSeries),
  );
  const shrimpPopulationTrend =
    summarizeLinearTailTrend(shrimpPopulationSeries);
  const recentShrimpPopulationTrend = summarizeLinearTailTrend(
    recentHalf(shrimpPopulationSeries),
  );
  const shrimpAdultTrend = summarizeLinearTailTrend(shrimpAdultSeries);
  const recentShrimpAdultTrend = summarizeLinearTailTrend(
    recentHalf(shrimpAdultSeries),
  );
  const oxygenTrend = summarizeLinearTailTrend(oxygenSeries);
  const recentOxygenTrend = summarizeLinearTailTrend(
    recentHalf(oxygenSeries),
  );
  const toxicWasteTrend = summarizeLinearTailTrend(toxicWasteSeries);
  const recentToxicWasteTrend = summarizeLinearTailTrend(
    recentHalf(toxicWasteSeries),
  );
  const organicMatterTrend = summarizeLinearTailTrend(organicMatterSeries);
  const recentOrganicMatterTrend = summarizeLinearTailTrend(
    recentHalf(organicMatterSeries),
  );
  const daphniaPopulationProjectedCollapse =
    sustainedProjectedFloorBreach(
      recentDaphniaPopulationTrend,
      thresholds.daphnia.minimumCount,
    );
  const daphniaAdultProjectedCollapse = sustainedProjectedFloorBreach(
    recentDaphniaAdultTrend,
    1,
  );
  const shrimpPopulationProjectedCollapse =
    sustainedProjectedFloorBreach(
      recentShrimpPopulationTrend,
      thresholds.shrimp.minimumCount,
    );
  const shrimpAdultProjectedCollapse = sustainedProjectedFloorBreach(
    recentShrimpAdultTrend,
    1,
  );
  const waterProjectedUnsafe =
    sustainedProjectedFloorBreach(
      recentOxygenTrend,
      thresholds.water.minimumOxygen,
    ) ||
    sustainedProjectedCeilingBreach(
      recentToxicWasteTrend,
      thresholds.water.maximumToxicWaste,
    ) ||
    sustainedProjectedCeilingBreach(
      recentOrganicMatterTrend,
      thresholds.water.maximumOrganicMatter,
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

  const observations: Mission7AcceptanceObservation[] = [
    {
      id: 'daphnia-death-composition',
      level: daphniaEvents.deathsByCause.starvation >
          daphniaEvents.deathsByCause['old-age']
        ? 'warning'
        : 'info',
      detail:
        `oldAge=${daphniaEvents.deathsByCause['old-age']}, starvation=` +
        `${daphniaEvents.deathsByCause.starvation}, ` +
        `waterStress=${acuteWaterDeathCount(daphniaEvents)}, ` +
        `predation=${daphniaEvents.deathsByCause.predation}`,
    },
    {
      id: 'shrimp-death-composition',
      level: shrimpEvents.deathsByCause.starvation >
          shrimpEvents.deathsByCause['old-age']
        ? 'warning'
        : 'info',
      detail:
        `oldAge=${shrimpEvents.deathsByCause['old-age']}, starvation=` +
        `${shrimpEvents.deathsByCause.starvation}, ` +
        `waterStress=${acuteWaterDeathCount(shrimpEvents)}, ` +
        `predation=${shrimpEvents.deathsByCause.predation}`,
    },
  ];
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
      mean(daphniaCounts) >= thresholds.daphnia.minimumMeanCount &&
      (daphniaCounts.at(-1) ?? 0) >=
        thresholds.daphnia.minimumFinalCount &&
      daphniaRange[1] <= thresholds.daphnia.maximumCount,
    `min=${daphniaRange[0]}, mean=${mean(daphniaCounts).toFixed(2)}, ` +
      `final=${daphniaCounts.at(-1) ?? 0}, max=${daphniaRange[1]}`,
  );
  add(
    'daphnia-generation',
    daphniaEvents.births >= thresholds.daphnia.minimumTailBirths &&
      daphniaEvents.maturations >=
        thresholds.daphnia.minimumTailMaturations &&
      recentDaphniaEvents.births >=
        thresholds.daphnia.minimumTailBirths &&
      recentDaphniaEvents.maturations >=
        thresholds.daphnia.minimumTailMaturations &&
      evidence.final.daphniaFounders === 0 &&
      evidence.final.daphniaDescendants >=
        thresholds.daphnia.minimumFinalDescendants &&
      evidence.final.daphniaMaximumLivingGeneration >=
        thresholds.daphnia.minimumLivingGeneration,
    `tailBirths=${daphniaEvents.births}, tailMaturations=${daphniaEvents.maturations}, ` +
      `recentBirths=${recentDaphniaEvents.births}, ` +
      `recentMaturations=${recentDaphniaEvents.maturations}, ` +
      `founders=${evidence.final.daphniaFounders}, descendants=${evidence.final.daphniaDescendants}, ` +
      `generation=${evidence.final.daphniaMaximumLivingGeneration}`,
  );
  add(
    'daphnia-trajectory',
    !daphniaPopulationProjectedCollapse &&
      !daphniaAdultProjectedCollapse,
    `populationFullSlope95=[${daphniaPopulationTrend.slopeLower95.toExponential(3)}, ` +
      `${daphniaPopulationTrend.slopeUpper95.toExponential(3)}], ` +
      `populationRecentSlope95=[${recentDaphniaPopulationTrend.slopeLower95.toExponential(3)}, ` +
      `${recentDaphniaPopulationTrend.slopeUpper95.toExponential(3)}], ` +
      `populationRecentProjected=${recentDaphniaPopulationTrend.projectedAfterSameDuration.toFixed(2)}, ` +
      `adultFullSlope95=[${daphniaAdultTrend.slopeLower95.toExponential(3)}, ` +
      `${daphniaAdultTrend.slopeUpper95.toExponential(3)}], ` +
      `adultRecentSlope95=[${recentDaphniaAdultTrend.slopeLower95.toExponential(3)}, ` +
      `${recentDaphniaAdultTrend.slopeUpper95.toExponential(3)}], ` +
      `adultRecentProjected=${recentDaphniaAdultTrend.projectedAfterSameDuration.toFixed(2)}`,
  );
  add(
    'daphnia-deaths',
    acuteWaterDeathCount(daphniaEvents) === 0 &&
      daphniaEvents.deathsByCause.predation === 0,
    `oldAge=${daphniaEvents.deathsByCause['old-age']}, starvation=` +
      `${daphniaEvents.deathsByCause.starvation}, ` +
      `waterStress=${acuteWaterDeathCount(daphniaEvents)}, ` +
      `predation=${daphniaEvents.deathsByCause.predation}`,
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
    shrimpRange[0] >= thresholds.shrimp.minimumCount &&
      shrimpEvents.births >= thresholds.shrimp.minimumTailBirths &&
      shrimpEvents.maturations >= thresholds.shrimp.minimumTailMaturations &&
      recentShrimpEvents.births >= thresholds.shrimp.minimumTailBirths &&
      recentShrimpEvents.maturations >=
        thresholds.shrimp.minimumTailMaturations &&
      evidence.final.shrimpBornDescendants >= 2,
    `tailMin=${shrimpRange[0]}, births=${shrimpEvents.births}, ` +
      `maturations=${shrimpEvents.maturations}, ` +
      `recentBirths=${recentShrimpEvents.births}, ` +
      `recentMaturations=${recentShrimpEvents.maturations}, ` +
      `bornAlive=${evidence.final.shrimpBornDescendants}`,
  );
  add(
    'shrimp-trajectory',
    !shrimpPopulationProjectedCollapse &&
      !shrimpAdultProjectedCollapse,
    `populationFullSlope95=[${shrimpPopulationTrend.slopeLower95.toExponential(3)}, ` +
      `${shrimpPopulationTrend.slopeUpper95.toExponential(3)}], ` +
      `populationRecentSlope95=[${recentShrimpPopulationTrend.slopeLower95.toExponential(3)}, ` +
      `${recentShrimpPopulationTrend.slopeUpper95.toExponential(3)}], ` +
      `populationRecentProjected=${recentShrimpPopulationTrend.projectedAfterSameDuration.toFixed(2)}, ` +
      `adultFullSlope95=[${shrimpAdultTrend.slopeLower95.toExponential(3)}, ` +
      `${shrimpAdultTrend.slopeUpper95.toExponential(3)}], ` +
      `adultRecentSlope95=[${recentShrimpAdultTrend.slopeLower95.toExponential(3)}, ` +
      `${recentShrimpAdultTrend.slopeUpper95.toExponential(3)}], ` +
      `adultRecentProjected=${recentShrimpAdultTrend.projectedAfterSameDuration.toFixed(2)}`,
  );
  add(
    'shrimp-breeding-pair',
    evidence.final.shrimpFemales > 0 &&
      evidence.final.shrimpMales > 0 &&
      evidence.final.shrimpAdultFemales +
        evidence.final.shrimpAdultMales > 0,
    `livingFemales=${evidence.final.shrimpFemales}, ` +
      `livingMales=${evidence.final.shrimpMales}, ` +
      `adultFemales=${evidence.final.shrimpAdultFemales}, ` +
      `adultMales=${evidence.final.shrimpAdultMales}`,
  );
  add(
    'shrimp-deaths',
    acuteWaterDeathCount(shrimpEvents) === 0 &&
      shrimpEvents.deathsByCause.predation === 0,
    `oldAge=${shrimpEvents.deathsByCause['old-age']}, starvation=` +
      `${shrimpEvents.deathsByCause.starvation}, ` +
      `waterStress=${acuteWaterDeathCount(shrimpEvents)}, ` +
      `predation=${shrimpEvents.deathsByCause.predation}`,
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
    'water-trajectory',
    !waterProjectedUnsafe,
    `oxygenFullSlope95=[${oxygenTrend.slopeLower95.toExponential(3)}, ` +
      `${oxygenTrend.slopeUpper95.toExponential(3)}], ` +
      `oxygenRecentSlope95=[${recentOxygenTrend.slopeLower95.toExponential(3)}, ` +
      `${recentOxygenTrend.slopeUpper95.toExponential(3)}], ` +
      `oxygenRecentProjected=${recentOxygenTrend.projectedAfterSameDuration.toFixed(3)}, ` +
      `toxicFullSlope95=[${toxicWasteTrend.slopeLower95.toExponential(3)}, ` +
      `${toxicWasteTrend.slopeUpper95.toExponential(3)}], ` +
      `toxicRecentSlope95=[${recentToxicWasteTrend.slopeLower95.toExponential(3)}, ` +
      `${recentToxicWasteTrend.slopeUpper95.toExponential(3)}], ` +
      `toxicRecentProjected=${recentToxicWasteTrend.projectedAfterSameDuration.toFixed(3)}, ` +
      `organicFullSlope95=[${organicMatterTrend.slopeLower95.toExponential(3)}, ` +
      `${organicMatterTrend.slopeUpper95.toExponential(3)}], ` +
      `organicRecentSlope95=[${recentOrganicMatterTrend.slopeLower95.toExponential(3)}, ` +
      `${recentOrganicMatterTrend.slopeUpper95.toExponential(3)}], ` +
      `organicRecentProjected=${recentOrganicMatterTrend.projectedAfterSameDuration.toFixed(3)}`,
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
    observations,
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
