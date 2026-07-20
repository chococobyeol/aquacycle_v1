import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  ALGAE_VISIBLE_BIOMASS,
  ANIMALS,
  SCENARIOS,
  SPECIES,
  STRUCTURES,
} from '../../simulation/config';
import { growthTrend, netGrowthPotential } from '../../simulation/growth';
import { SIMULATION_SPEED_OPTIONS, type SimulationSpeed } from '../../simulation/speed';
import type {
  AnimalSpeciesId,
  GrowthTrend,
  InteractionTool,
  InventoryCategory,
  SelectionFilter,
  ScenarioId,
  SimulationCommand,
  SimulationSnapshot,
  SpeciesId,
  StructureDefinitionId,
  Vec2,
} from '../../simulation/types';
import { TANK_HEIGHT, TANK_WIDTH } from '../../simulation/types';
import { useSimulation } from '../hooks/useSimulation';
import { AquariumCanvas, type AquariumCameraTransform } from '../tank/AquariumCanvas';

interface SimulationScreenProps {
  scenarioId: ScenarioId;
  onBack: () => void;
  onMissionComplete: (scenarioId: ScenarioId) => void;
}

interface PendingInventoryItem {
  kind: 'structure' | 'seed' | 'animal';
  label: string;
  assetPath?: string;
  definitionId?: StructureDefinitionId;
  speciesId?: SpeciesId;
  animalSpeciesId?: AnimalSpeciesId;
}

interface EcologyHistoryPoint {
  elapsedSeconds: number;
  algaeBiomass: number;
  shrimpCount: number;
}

type HudPanelId = 'menu' | 'inventory' | 'quest' | 'observation';

const closedHudPanels = (): Record<HudPanelId, boolean> => ({
  menu: false,
  inventory: false,
  quest: false,
  observation: false,
});

const STRUCTURE_IDS: StructureDefinitionId[] = ['flat-stone', 'round-stone', 'tall-stone'];
const SPECIES_IDS: SpeciesId[] = ['oedogonium', 'nitzschia'];
const ANIMAL_IDS: AnimalSpeciesId[] = ['cherry-shrimp'];

const formatTime = (seconds: number): string => {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(safeSeconds % 60).padStart(2, '0')}`;
};

const formatProgressValue = (
  progress: NonNullable<SimulationSnapshot['missionProgress']>,
): string => progress.unit === 'biomass'
  ? `${progress.current.toFixed(1)} / ${progress.target.toFixed(1)}`
  : progress.unit === 'adult-count'
    ? `${Math.round(progress.current)} / ${Math.round(progress.target)}마리`
    : `${Math.round(progress.current * 100)} / ${Math.round(progress.target * 100)}%`;

const countLabel = (remaining: number | null): string =>
  remaining === null ? '무제한' : `${remaining}개 남음`;

const trendCopy: Record<GrowthTrend, { label: string; className: string }> = {
  growing: { label: '성장 예상', className: 'trend-growing' },
  stable: { label: '거의 유지', className: 'trend-stable' },
  declining: { label: '감소 예상', className: 'trend-declining' },
};

const potentialTrendLabel: Record<GrowthTrend, string> = {
  growing: '성장에 유리',
  stable: '유지권',
  declining: '감소 위험',
};

function TrendIcon({ trend }: { trend: GrowthTrend }) {
  const path = trend === 'growing'
    ? 'M2 17 8 12 13 14 22 5'
    : trend === 'declining'
      ? 'M2 6 8 11 13 9 22 18'
      : 'M2 12h20';
  return (
    <svg className="trend-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

const phaseName = (snapshot: SimulationSnapshot): string => {
  if (snapshot.outcome === 'success') return '성공 · 관찰 중';
  if (snapshot.outcome === 'failure') return '실패 · 관찰 중';
  if (snapshot.phase === 'setup') return snapshot.holding ? '배치 중' : '준비';
  if (snapshot.phase === 'running') return '관찰 중';
  return '일시정지';
};

function MeasurementIcon({
  kind,
  compact = false,
}: {
  kind: 'light' | 'temperature';
  compact?: boolean;
}) {
  return (
    <svg className={`measurement-icon ${compact ? 'compact' : ''}`} viewBox="0 0 24 24" aria-hidden="true">
      {kind === 'light' ? (
        <>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" />
        </>
      ) : (
        <>
          <path d="M9 14.8V5a3 3 0 0 1 6 0v9.8a5 5 0 1 1-6 0Z" />
          <path d="M12 8v8" />
          <circle cx="12" cy="18" r="2" />
        </>
      )}
    </svg>
  );
}

function HudIcon({ kind }: { kind: HudPanelId | 'back' }) {
  return (
    <svg className="hud-icon" viewBox="0 0 24 24" aria-hidden="true">
      {kind === 'back' && (
        <>
          <path d="m10 5-7 7 7 7" />
          <path d="M4 12h10.5c3.6 0 5.5 1.8 5.5 5" />
        </>
      )}
      {kind === 'menu' && <path d="M4 6.5h16M5 12h14M4 17.5h16" />}
      {kind === 'inventory' && (
        <>
          <path d="M4 8.5h16v11H4zM7 8.5V5h10v3.5" />
          <path d="M8 13h8M12 10.5V16" />
        </>
      )}
      {kind === 'quest' && (
        <>
          <path d="M6 4.5h12v16H6zM9 4.5V3h6v1.5" />
          <path d="m9 12 2 2 4-5M9 17h6" />
        </>
      )}
      {kind === 'observation' && (
        <>
          <circle cx="10.5" cy="10.5" r="5.5" />
          <path d="m14.5 14.5 5 5M8 10.5h5M10.5 8v5" />
        </>
      )}
    </svg>
  );
}

function RotateButton({
  direction,
  send,
}: {
  direction: -1 | 1;
  send: (command: SimulationCommand) => void;
}) {
  const timerRef = useRef<number | null>(null);
  const rotate = (): void => send({
    type: 'rotate-held',
    radians: direction * (Math.PI / 18),
  });
  const stop = (): void => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    timerRef.current = null;
  };
  return (
    <button
      type="button"
      aria-label={direction < 0 ? '반시계 방향 회전' : '시계 방향 회전'}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        rotate();
        stop();
        timerRef.current = window.setInterval(rotate, 80);
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onPointerLeave={stop}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d={direction < 0
          ? 'M3 12a9 9 0 1 0 2.64-6.36L3 8'
          : 'M21 12a9 9 0 1 1-2.64-6.36L21 8'} />
        <path d={direction < 0 ? 'M3 3v5h5' : 'M21 3v5h-5'} />
      </svg>
    </button>
  );
}

export function SimulationScreen({
  scenarioId,
  onBack,
  onMissionComplete,
}: SimulationScreenProps) {
  const { snapshot, motionSource, send } = useSimulation(scenarioId);
  const scenario = SCENARIOS[scenarioId];
  const [activeTool, setActiveTool] = useState<InteractionTool>('select');
  const [inventoryCategory, setInventoryCategory] = useState<InventoryCategory>('structures');
  const [catalogSpecies, setCatalogSpecies] = useState<SpeciesId | null>(null);
  const [catalogAnimal, setCatalogAnimal] = useState<AnimalSpeciesId | null>(null);
  const [pendingInventory, setPendingInventory] = useState<PendingInventoryItem | null>(null);
  const [showMissionBriefing, setShowMissionBriefing] = useState(scenario.mode === 'challenge');
  const [openHudPanels, setOpenHudPanels] = useState<Record<HudPanelId, boolean>>(closedHudPanels);
  const [showGoalGuide, setShowGoalGuide] = useState(false);
  const [cameraTransform, setCameraTransform] = useState<AquariumCameraTransform | null>(null);
  const [cameraResetToken, setCameraResetToken] = useState(0);
  const [pointer, setPointer] = useState({ x: 0, y: 0 });
  const completionReported = useRef(false);
  const resumeAfterBriefing = useRef(false);
  const pendingInventoryRef = useRef<PendingInventoryItem | null>(null);
  const lastEcologySampleAt = useRef(Number.NEGATIVE_INFINITY);
  const [ecologyHistory, setEcologyHistory] = useState<EcologyHistoryPoint[]>([]);
  pendingInventoryRef.current = pendingInventory;

  useEffect(() => {
    completionReported.current = false;
    setActiveTool('select');
    setInventoryCategory('structures');
    setCatalogSpecies(null);
    setCatalogAnimal(null);
    setPendingInventory(null);
    setOpenHudPanels(closedHudPanels());
    setShowGoalGuide(false);
    setCameraTransform(null);
    setCameraResetToken((current) => current + 1);
    resumeAfterBriefing.current = false;
    setShowMissionBriefing(SCENARIOS[scenarioId].mode === 'challenge');
    lastEcologySampleAt.current = Number.NEGATIVE_INFINITY;
    setEcologyHistory([]);
  }, [scenarioId]);

  useEffect(() => {
    if (!snapshot) return;
    const elapsedSeconds = snapshot.elapsedSeconds;
    const point: EcologyHistoryPoint = {
      elapsedSeconds,
      algaeBiomass: snapshot.totalBiomass.oedogonium + snapshot.totalBiomass.nitzschia,
      shrimpCount: snapshot.animalPopulation['cherry-shrimp'].total,
    };

    // A same-scenario reset sends elapsed time back to zero. Start a fresh trace
    // instead of joining the previous experiment to the new one.
    if (elapsedSeconds + 0.01 < lastEcologySampleAt.current) {
      lastEcologySampleAt.current = elapsedSeconds;
      setEcologyHistory([point]);
      return;
    }
    if (elapsedSeconds - lastEcologySampleAt.current < 2) return;

    lastEcologySampleAt.current = elapsedSeconds;
    setEcologyHistory((current) => [...current, point].slice(-120));
  }, [
    snapshot?.elapsedSeconds,
    snapshot?.totalBiomass.oedogonium,
    snapshot?.totalBiomass.nitzschia,
    snapshot?.animalPopulation['cherry-shrimp'].total,
  ]);

  useEffect(() => {
    if (snapshot?.outcome !== 'success' || completionReported.current) return;
    completionReported.current = true;
    onMissionComplete(scenarioId);
  }, [onMissionComplete, scenarioId, snapshot?.outcome]);

  useEffect(() => {
    if (!pendingInventory) return;
    const move = (event: PointerEvent): void => setPointer({ x: event.clientX, y: event.clientY });
    const cancel = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      setPendingInventory(null);
      setActiveTool('select');
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('keydown', cancel);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('keydown', cancel);
    };
  }, [pendingInventory]);

  const returnToSelection = useCallback((): void => {
    setActiveTool('select');
    send({ type: 'clear-probe' });
  }, [send]);
  const toggleHudPanel = useCallback((panel: HudPanelId): void => {
    setOpenHudPanels((current) => ({ ...current, [panel]: !current[panel] }));
  }, []);
  const closeHudPanel = useCallback((panel: HudPanelId): void => {
    setOpenHudPanels((current) => current[panel] ? { ...current, [panel]: false } : current);
  }, []);
  const consumePendingInventory = useCallback((point: Vec2): void => {
    const pending = pendingInventoryRef.current;
    if (!pending) return;
    if (pending.kind === 'structure' && pending.definitionId) {
      send({ type: 'pick-structure', definitionId: pending.definitionId, point });
    } else if (pending.kind === 'seed' && pending.speciesId) {
      send({ type: 'pick-seed', speciesId: pending.speciesId, point });
    } else if (pending.kind === 'animal' && pending.animalSpeciesId) {
      send({ type: 'pick-animal', speciesId: pending.animalSpeciesId, point });
    }
    setActiveTool('move');
  }, [send]);
  const finishPendingInventoryHandoff = useCallback((): void => {
    setPendingInventory(null);
  }, []);

  if (!snapshot) {
    return (
      <main className="loading-screen">
        <div className="loading-bubbles" aria-hidden="true">○　◦　○</div>
        <p>작은 수조를 준비하고 있습니다…</p>
      </main>
    );
  }

  const editable = snapshot.phase === 'setup' ||
    (snapshot.mode === 'laboratory' && snapshot.phase === 'paused');
  const removalEditable = editable && !snapshot.holding && !pendingInventory;
  const progress = snapshot.missionProgress;
  const scoredZoneTarget = scenario.target?.type === 'habitat-coverage' ? scenario.target : null;
  const goalGuideCopy = scoredZoneTarget
    ? '구조물 앞면을 작은 관찰 구역으로 나눕니다. 규조류가 적합한 빛에서 일정 밀도 이상 자란 구역만 전체 면적에 포함됩니다.'
    : null;
  const selectedCells = snapshot.selection?.kind === 'colony' && snapshot.selection.cellId
    ? snapshot.cells.filter((cell) => cell.id === snapshot.selection?.cellId)
    : snapshot.selection?.kind === 'region' && snapshot.selection.bounds
      ? snapshot.cells.filter((cell) => {
        const { minX, minY, maxX, maxY } = snapshot.selection!.bounds!;
        return cell.x >= minX && cell.x <= maxX && cell.y >= minY && cell.y <= maxY &&
          cell.biomass.oedogonium + cell.biomass.nitzschia > ALGAE_VISIBLE_BIOMASS;
      })
      : [];
  const selectedBiomass = selectedCells.length
    ? selectedCells.reduce((total, cell) => ({
      oedogonium: total.oedogonium + cell.biomass.oedogonium,
      nitzschia: total.nitzschia + cell.biomass.nitzschia,
    }), { oedogonium: 0, nitzschia: 0 })
    : undefined;
  const selectedAverageLight = selectedCells.length
    ? selectedCells.reduce((total, cell) => total + cell.light, 0) / selectedCells.length
    : undefined;
  const selectionSpeciesIds = snapshot.selection?.kind === 'colony' || snapshot.selection?.kind === 'region'
    ? SPECIES_IDS.filter((speciesId) => selectedCells.some((cell) =>
      cell.biomass[speciesId] > ALGAE_VISIBLE_BIOMASS,
    ))
    : [];
  const selectionFilter: SelectionFilter = inventoryCategory === 'structures'
    ? 'structure'
    : inventoryCategory === 'organisms'
      ? 'organism'
      : 'measurement';
  const selectedAnimal = snapshot.selection?.kind === 'animal' && snapshot.selection.animalId
    ? snapshot.animals.find((animal) => animal.id === snapshot.selection?.animalId)
    : undefined;
  const selectedCarcass = snapshot.selection?.kind === 'carcass' && snapshot.selection.carcassId
    ? snapshot.carcasses.find((carcass) => carcass.id === snapshot.selection?.carcassId)
    : undefined;
  const selectedRegionAnimals = snapshot.selection?.kind === 'region' && snapshot.selection.animalIds
    ? snapshot.animals.filter((animal) => snapshot.selection?.animalIds?.includes(animal.id))
    : [];
  const selectedStructure = snapshot.selection?.kind === 'structure' && snapshot.selection.structureId
    ? snapshot.structures.find((structure) => structure.id === snapshot.selection?.structureId)
    : undefined;
  const selectedMeasurement = snapshot.selection?.kind === 'measurement'
    ? snapshot.measurements.find((measurement) => measurement.id === snapshot.selection?.measurementId)
    : undefined;
  const inspectedSpecies = selectionSpeciesIds.length
    ? catalogSpecies && selectionSpeciesIds.includes(catalogSpecies)
      ? catalogSpecies
      : snapshot.selection?.speciesId ?? selectionSpeciesIds[0]
    : catalogSpecies;
  const inspectedAnimalSpecies = selectedAnimal?.speciesId ?? selectedCarcass?.speciesId ??
    (selectedRegionAnimals.length ? selectedRegionAnimals[0].speciesId : catalogAnimal);
  const selectedProbeTrend = inspectedSpecies
    ? (snapshot.probe ?? selectedMeasurement)?.trends[inspectedSpecies]
    : undefined;
  const heldStructure = snapshot.holding?.kind === 'structure'
    ? snapshot.structures.find((structure) => structure.id === snapshot.holding?.structureId)
    : undefined;
  const heldStructurePosition = snapshot.holding?.kind === 'structure'
    ? snapshot.holding
    : heldStructure;
  const rightPanelVisible = (openHudPanels.quest || openHudPanels.observation) &&
    !snapshot.holding && !pendingInventory;
  const cameraFitView = !cameraTransform || cameraTransform.zoom < 0.999;
  const inventoryPanelVisible = openHudPanels.inventory && !snapshot.holding && !pendingInventory;
  const heldStructureScreenWidth = heldStructure
    ? Math.abs(heldStructure.width * Math.cos(heldStructure.angle)) +
      Math.abs(heldStructure.height * Math.sin(heldStructure.angle))
    : 0;
  const rotationOrbitStyle = (() => {
    if (!heldStructure) return undefined;
    if (cameraTransform) {
      const span = Math.min(
        Math.max(80, cameraTransform.viewportWidth - 12),
        Math.max(130, heldStructureScreenWidth * cameraTransform.scale + 96),
      );
      const x = cameraTransform.offsetX + heldStructurePosition!.x * cameraTransform.scale;
      const y = cameraTransform.offsetY + heldStructurePosition!.y * cameraTransform.scale;
      return {
        left: `${Math.max(span / 2 + 6, Math.min(cameraTransform.viewportWidth - span / 2 - 6, x))}px`,
        top: `${Math.max(84, Math.min(cameraTransform.viewportHeight - 84, y))}px`,
        '--orbit-span': `${span}px`,
      } as CSSProperties;
    }
    const span = Math.max(26, (heldStructureScreenWidth / TANK_WIDTH) * 100 + 18);
    return {
      left: `${Math.max(span / 2 + 1, Math.min(99 - span / 2, (heldStructurePosition!.x / TANK_WIDTH) * 100))}%`,
      top: `${(heldStructurePosition!.y / TANK_HEIGHT) * 100}%`,
      '--orbit-span': `${span}%`,
    } as CSSProperties;
  })();

  const phaseAction = (): void => {
    if (snapshot.phase === 'setup') {
      setActiveTool('select');
      send({ type: 'clear-probe' });
      send({ type: 'start' });
    }
    else if (snapshot.phase === 'running') send({ type: 'pause' });
    else {
      if (pendingInventory || snapshot.holding || !snapshot.allSettled) return;
      setPendingInventory(null);
      setActiveTool('select');
      send({ type: 'clear-probe' });
      send({ type: 'resume' });
    }
  };
  const requiredStructuresReady = Object.entries(scenario.requiredStructures).every(([definitionId, required]) =>
    snapshot.structures.filter((structure) => structure.definitionId === definitionId).length >= (required ?? 0),
  );
  const targetSurfaceReady = scenario.targetIncludesSubstrate || snapshot.cells.some((cell) => cell.targetEligible);
  const requiredSeedsReady = scenario.requiredSeedSpecies.every((speciesId) =>
    snapshot.seeds.some((seed) =>
      seed.speciesId === speciesId && snapshot.cells.some((cell) => cell.id === seed.cellId && cell.targetEligible),
    ),
  );
  const setupReady = !pendingInventory && !snapshot.holding && snapshot.allSettled &&
    requiredStructuresReady && targetSurfaceReady && requiredSeedsReady;
  const pausedEditBlocked = snapshot.phase === 'paused' && snapshot.mode === 'laboratory' &&
    (Boolean(pendingInventory) || Boolean(snapshot.holding) || !snapshot.allSettled);
  const setupButtonLabel = pendingInventory || snapshot.holding
    ? '먼저 항목 놓기'
    : !snapshot.allSettled
      ? '안착 대기 중'
      : !requiredStructuresReady
        ? '필수 구조물 배치'
        : !targetSurfaceReady
          ? '성장 표면 배치'
        : !requiredSeedsReady
          ? '필수 조류 접종'
          : '시뮬레이션 시작';
  const runButtonLabel = snapshot.phase === 'setup'
    ? setupButtonLabel
    : snapshot.phase === 'running'
      ? '일시정지'
      : pausedEditBlocked
        ? pendingInventory || snapshot.holding ? '먼저 항목 놓기' : '안착 대기 중'
        : '계속 관찰';
  const compactRunButtonLabel = snapshot.phase === 'setup'
    ? '시작'
    : snapshot.phase === 'running'
      ? '일시정지'
      : pausedEditBlocked
        ? '대기'
        : '계속';

  const inventoryHint = (() => {
    if (pendingInventory || snapshot.holding) return '현재 항목을 배치하는 중입니다';
    if (!editable && inventoryCategory !== 'instruments') {
      return snapshot.phase === 'running'
        ? '관찰 중에는 배치가 잠겨 있습니다'
        : '도전 중에는 배치를 수정할 수 없습니다';
    }
    if (inventoryCategory === 'structures') return '구조물을 꺼내 수조에 놓으세요';
    if (inventoryCategory === 'organisms') return '조류를 접종하거나 동물을 수중에 놓으세요';
    return snapshot.phase === 'running'
      ? '관찰 중에도 측정점을 설치할 수 있습니다'
      : '도구를 골라 수조 값을 측정하세요';
  })();

  const showCatalogSpecies = (speciesId: SpeciesId): void => {
    send({ type: 'clear-selection' });
    setCatalogAnimal(null);
    setCatalogSpecies(speciesId);
    setOpenHudPanels((current) => ({ ...current, observation: true }));
  };

  const showCatalogAnimal = (speciesId: AnimalSpeciesId): void => {
    send({ type: 'clear-selection' });
    setCatalogSpecies(null);
    setCatalogAnimal(speciesId);
    setOpenHudPanels((current) => ({ ...current, observation: true }));
  };

  const switchInventoryCategory = (category: InventoryCategory): void => {
    setInventoryCategory(category);
    setPendingInventory(null);
    setCatalogSpecies(null);
    setCatalogAnimal(null);
    setActiveTool('select');
    send({ type: 'clear-probe' });
    send({ type: 'clear-selection' });
  };

  const toggleMeasurementTool = (tool: 'light-probe' | 'temperature-probe'): void => {
    setPendingInventory(null);
    if (activeTool === tool) {
      setActiveTool('select');
      send({ type: 'clear-probe' });
    } else {
      setActiveTool(tool);
      send({ type: 'clear-selection' });
    }
  };

  const resetUiState = (): void => {
    setActiveTool('select');
    setInventoryCategory('structures');
    setCatalogSpecies(null);
    setCatalogAnimal(null);
    setPendingInventory(null);
    send({ type: 'clear-probe' });
    send({ type: 'clear-selection' });
  };

  const resetSimulation = (): void => {
    resetUiState();
    resumeAfterBriefing.current = false;
    send({ type: 'reset' });
    setCameraResetToken((current) => current + 1);
    setOpenHudPanels(closedHudPanels());
    setShowMissionBriefing(snapshot.mode === 'challenge');
  };

  const openMissionBriefing = (): void => {
    resumeAfterBriefing.current = snapshot.phase === 'running';
    if (resumeAfterBriefing.current) send({ type: 'pause' });
    setShowMissionBriefing(true);
  };

  const closeMissionBriefing = (): void => {
    setShowMissionBriefing(false);
    if (!resumeAfterBriefing.current) return;
    resumeAfterBriefing.current = false;
    send({ type: 'resume' });
  };

  const briefingButtonLabel = resumeAfterBriefing.current
    ? '계속 관찰'
    : snapshot.hasStarted
      ? snapshot.phase === 'paused' && snapshot.mode === 'laboratory'
        ? '편집으로 돌아가기'
        : '관찰 화면으로 돌아가기'
      : snapshot.mode === 'laboratory'
        ? '실험실로 돌아가기'
        : '배치 시작하기';

  return (
    <>
      {pendingInventory && (
        <div
          className={`inventory-cursor-ghost ghost-${pendingInventory.kind}`}
          style={{ left: pointer.x, top: pointer.y }}
          aria-hidden="true"
        >
          {pendingInventory.assetPath
            ? <img src={pendingInventory.assetPath} alt="" />
            : pendingInventory.kind === 'animal'
              ? <span className="ghost-shrimp" />
              : <span className={`ghost-colony colony-${pendingInventory.speciesId}`} />}
          <small>{pendingInventory.label}</small>
        </div>
      )}

      {showMissionBriefing && (
        <div className="mission-briefing-backdrop" role="presentation">
          <section className="mission-briefing-dialog" role="dialog" aria-modal="true" aria-labelledby="mission-briefing-title">
            <div className="briefing-index">{scenarioId === 'laboratory' ? 'LAB' : `MISSION ${scenarioId.at(-1)}`}</div>
            <p className="panel-kicker">실험 의뢰서</p>
            <h2 id="mission-briefing-title">{scenario.title}</h2>
            <blockquote>{scenario.briefing.question}</blockquote>
            <div className="briefing-goal"><span>목표</span><strong>{scenario.briefing.goal}</strong></div>
            {goalGuideCopy && (
              <div className="briefing-score-note">
                <p>{goalGuideCopy}</p>
              </div>
            )}
            <dl className="briefing-meta">
              <div><dt>지급</dt><dd>{scenario.briefing.supplied}</dd></div>
              <div><dt>판정</dt><dd>{scenario.briefing.success}</dd></div>
            </dl>
            <button type="button" className="briefing-start" onClick={closeMissionBriefing}>{briefingButtonLabel}</button>
          </section>
        </div>
      )}

      <main className={`simulation-screen v2-screen tank-first-screen ${rightPanelVisible ? 'has-right-panel' : ''} ${inventoryPanelVisible ? 'has-inventory-panel' : ''} ${cameraFitView ? 'camera-fit-view' : ''}`}>
        <header className="game-header tank-hud" aria-label="수조 화면 메뉴">
          <div className="hud-tool-group hud-tool-group-left">
            <button
              type="button"
              className="hud-tool-button hud-back-button"
              aria-label="미션 목록으로 돌아가기"
              title="미션 목록으로 돌아가기"
              onClick={onBack}
            >
              <HudIcon kind="back" />
              <span>미션 목록</span>
            </button>
            <button
              type="button"
              className={`hud-tool-button ${openHudPanels.menu ? 'active' : ''}`}
              aria-label="메뉴"
              aria-expanded={openHudPanels.menu}
              aria-controls="floating-menu-panel"
              title="메뉴"
              onClick={() => toggleHudPanel('menu')}
            ><HudIcon kind="menu" /></button>
            <button
              type="button"
              className={`hud-tool-button ${openHudPanels.inventory ? 'active' : ''} ${pendingInventory || snapshot.holding ? 'has-attention' : ''}`}
              aria-label="보유 목록"
              aria-expanded={openHudPanels.inventory}
              aria-controls="floating-inventory-panel"
              title="보유 목록"
              onClick={() => toggleHudPanel('inventory')}
            ><HudIcon kind="inventory" /></button>
          </div>

          <div className="game-title tank-hud-title">
            <p>{snapshot.mode === 'challenge' ? '도전 과제' : '자유 연구'}</p>
            <h1>{scenario.title}</h1>
          </div>

          <div className="header-readouts tank-hud-readouts">
            <div className="readout">
              <span>실행</span>
              <strong>
                {formatTime(snapshot.elapsedSeconds)}
                {snapshot.timeLimitSeconds !== null && snapshot.outcome === 'pending' && (
                  <small> / {formatTime(snapshot.timeLimitSeconds)}</small>
                )}
              </strong>
            </div>
            <div className={`phase-badge phase-${snapshot.phase}`} title={snapshot.message}>{phaseName(snapshot)}</div>
            <div className="hud-transport-controls" aria-label="시뮬레이션 조작">
              <button
                type="button"
                className="hud-run-button"
                title={runButtonLabel}
                aria-label={runButtonLabel}
                disabled={(snapshot.phase === 'setup' && !setupReady) || pausedEditBlocked}
                onClick={phaseAction}
              >{compactRunButtonLabel}</button>
              <select
                className="hud-speed-select"
                aria-label="시간 배속"
                title="시간 배속"
                value={snapshot.speed}
                onChange={(event) => send({
                  type: 'set-speed',
                  speed: Number(event.target.value) as SimulationSpeed,
                })}
              >
                {SIMULATION_SPEED_OPTIONS.map((speed) => (
                  <option key={speed} value={speed}>×{speed}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="hud-tool-group hud-tool-group-right">
            <button
              type="button"
              className={`hud-tool-button ${openHudPanels.quest ? 'active' : ''}`}
              aria-label="퀘스트"
              aria-expanded={openHudPanels.quest}
              aria-controls="floating-quest-panel"
              title="퀘스트"
              onClick={() => toggleHudPanel('quest')}
            >
              <HudIcon kind="quest" />
              {progress && (
                <i className="hud-progress-badge">
                  {snapshot.outcome === 'success'
                    ? '✓'
                    : progress.unit === 'adult-count'
                      ? Math.round(progress.current)
                      : Math.min(99, Math.round(progress.ratio * 100))}
                </i>
              )}
            </button>
            <button
              type="button"
              className={`hud-tool-button ${openHudPanels.observation ? 'active' : ''}`}
              aria-label="관찰 기록"
              aria-expanded={openHudPanels.observation}
              aria-controls="floating-observation-panel"
              title="관찰 기록"
              onClick={() => toggleHudPanel('observation')}
            >
              <HudIcon kind="observation" />
              {(snapshot.selection || snapshot.probe) && <i className="hud-notice-dot" />}
            </button>
          </div>
        </header>

        <section className="game-layout v2-layout tank-first-layout">
          {openHudPanels.menu && (
            <section id="floating-menu-panel" className="paper-panel floating-note floating-menu-panel" aria-label="메뉴">
              <div className="floating-note-heading">
                <div><span className="panel-label">AQUACYCLE</span><h2>메뉴</h2></div>
                <button type="button" className="floating-note-close" aria-label="메뉴 닫기" onClick={() => closeHudPanel('menu')}>×</button>
              </div>
              <div className="floating-menu-summary">
                <strong>{scenario.title}</strong>
                <span>{phaseName(snapshot)} · {formatTime(snapshot.elapsedSeconds)}</span>
              </div>
              <button type="button" onClick={() => {
                closeHudPanel('menu');
                openMissionBriefing();
              }}>{snapshot.mode === 'laboratory' ? '실험실 안내' : '미션 설명'}</button>
              <button type="button" onClick={resetSimulation}>{snapshot.mode === 'laboratory' ? '실험 초기화' : '다시 도전'}</button>
              <button type="button" className="menu-back-button" onClick={onBack}>미션 목록으로</button>
            </section>
          )}

          {openHudPanels.inventory && (
          <aside id="floating-inventory-panel" className="inventory-panel paper-panel floating-note floating-inventory-panel" aria-label="보유 목록">
            <div className="inventory-heading">
              <div>
                <span className="panel-label">보유 목록</span>
                <strong>{inventoryHint}</strong>
              </div>
              <button type="button" className="floating-note-close" aria-label="보유 목록 닫기" onClick={() => closeHudPanel('inventory')}>×</button>
            </div>

            <div className="tool-switcher" aria-label="조작 모드">
              <button
                type="button"
                className={activeTool === 'select' ? 'active' : ''}
                disabled={Boolean(snapshot.holding) || Boolean(pendingInventory)}
                onClick={() => {
                  setPendingInventory(null);
                  setActiveTool('select');
                  send({ type: 'clear-probe' });
                }}
              >선택·관찰</button>
              <button
                type="button"
                className={activeTool === 'move' ? 'active' : ''}
                disabled={!editable || Boolean(snapshot.holding) || Boolean(pendingInventory)}
                onClick={() => {
                  setActiveTool('move');
                  send({ type: 'clear-probe' });
                }}
              >이동·배치</button>
            </div>

            <div className="inventory-tabs" role="tablist" aria-label="목록 종류">
              <button type="button" disabled={Boolean(snapshot.holding) || Boolean(pendingInventory)} className={inventoryCategory === 'structures' ? 'active' : ''} onClick={() => switchInventoryCategory('structures')}>구조물</button>
              <button type="button" disabled={Boolean(snapshot.holding) || Boolean(pendingInventory)} className={inventoryCategory === 'organisms' ? 'active' : ''} onClick={() => switchInventoryCategory('organisms')}>생물</button>
              <button type="button" disabled={Boolean(snapshot.holding) || Boolean(pendingInventory)} className={inventoryCategory === 'instruments' ? 'active' : ''} onClick={() => switchInventoryCategory('instruments')}>측정</button>
            </div>

            <div className="inventory-list">
              {inventoryCategory === 'structures' && STRUCTURE_IDS
                .filter((id) => scenario.allowedStructures.includes(id))
                .map((definitionId) => {
                  const definition = STRUCTURES[definitionId];
                  const remaining = snapshot.remainingStructures[definitionId];
                  const isHeld = snapshot.holding?.kind === 'structure'
                    ? snapshot.holding.structureDefinitionId === definitionId
                    : pendingInventory?.kind === 'structure' && pendingInventory.definitionId === definitionId;
                  return (
                    <article className={`inventory-card structure-card ${isHeld ? 'held' : ''}`} key={definitionId}>
                      <button
                        type="button"
                        className="inventory-card-main"
                        disabled={!editable || Boolean(snapshot.holding) || Boolean(pendingInventory) || remaining === 0}
                        onClick={(event) => {
                          send({ type: 'clear-selection' });
                          setCatalogSpecies(null);
                          setPointer({ x: event.clientX, y: event.clientY });
                          setPendingInventory({
                            kind: 'structure',
                            label: definition.label,
                            assetPath: definition.assetPath,
                            definitionId,
                          });
                          setActiveTool('move');
                          closeHudPanel('inventory');
                        }}
                      >
                        <span className="inventory-thumb rock-thumb"><img src={definition.assetPath} alt="" /></span>
                        <span className="inventory-copy">
                          <strong>{definition.label}</strong>
                          <small>{definition.material}</small>
                          <em>{isHeld ? '배치 중' : countLabel(remaining)}</em>
                        </span>
                      </button>
                    </article>
                  );
                })}

              {inventoryCategory === 'organisms' && SPECIES_IDS
                .filter((speciesId) => scenario.allowedSpecies.includes(speciesId))
                .map((speciesId) => {
                const species = SPECIES[speciesId];
                const unlocked = true;
                const remaining = snapshot.remainingSeeds[speciesId];
                const isHeld = snapshot.holding?.kind === 'seed'
                  ? snapshot.holding.speciesId === speciesId
                  : pendingInventory?.kind === 'seed' && pendingInventory.speciesId === speciesId;
                return (
                  <article className={`inventory-card organism-card ${!unlocked ? 'locked' : ''} ${isHeld ? 'held' : ''}`} key={speciesId}>
                    <button
                      type="button"
                      className="inventory-card-main"
                      disabled={!unlocked || !editable || Boolean(snapshot.holding) || Boolean(pendingInventory) || remaining === 0}
                      onClick={(event) => {
                        send({ type: 'clear-selection' });
                        setPointer({ x: event.clientX, y: event.clientY });
                        setPendingInventory({ kind: 'seed', label: species.shortName, speciesId });
                        setCatalogSpecies(speciesId);
                        setActiveTool('move');
                        closeHudPanel('inventory');
                      }}
                    >
                      <span className={`inventory-thumb colony-thumb colony-${speciesId}`} aria-hidden="true"><i /><i /><i /></span>
                      <span className="inventory-copy">
                        <strong>{unlocked ? species.shortName : '잠긴 생물'}</strong>
                        <small>{unlocked ? species.scientificName : '이전 미션 완료 후 해금'}</small>
                        <em>{isHeld ? '배치 중' : unlocked ? countLabel(remaining) : '특성 미공개'}</em>
                      </span>
                    </button>
                    <button type="button" className="info-chip" disabled={!unlocked || Boolean(snapshot.holding) || Boolean(pendingInventory)} onClick={() => showCatalogSpecies(speciesId)}>정보</button>
                  </article>
                );
              })}

              {inventoryCategory === 'organisms' && ANIMAL_IDS
                .filter((speciesId) => scenario.allowedAnimals.includes(speciesId))
                .map((speciesId) => {
                  const animal = ANIMALS[speciesId];
                  const remaining = snapshot.remainingAnimals[speciesId];
                  const isHeld = snapshot.holding?.kind === 'animal'
                    ? snapshot.holding.animalSpeciesId === speciesId
                    : pendingInventory?.kind === 'animal' && pendingInventory.animalSpeciesId === speciesId;
                  return (
                    <article className={`inventory-card organism-card animal-card ${isHeld ? 'held' : ''}`} key={speciesId}>
                      <button
                        type="button"
                        className="inventory-card-main"
                        disabled={!editable || Boolean(snapshot.holding) || Boolean(pendingInventory) || remaining === 0}
                        onClick={(event) => {
                          send({ type: 'clear-selection' });
                          setCatalogSpecies(null);
                          setCatalogAnimal(null);
                          setPointer({ x: event.clientX, y: event.clientY });
                          setPendingInventory({
                            kind: 'animal',
                            label: animal.displayName,
                            animalSpeciesId: speciesId,
                          });
                          setActiveTool('move');
                          closeHudPanel('inventory');
                        }}
                      >
                        <span className="inventory-thumb animal-thumb cherry-shrimp-thumb" aria-hidden="true">
                          <i className="shrimp-body" /><i className="shrimp-tail" /><i className="shrimp-antenna" />
                        </span>
                        <span className="inventory-copy">
                          <strong>{animal.displayName}</strong>
                          <small>{animal.scientificName}</small>
                          <em>{isHeld ? '방류 위치 선택 중' : remaining === null ? '무제한' : `${remaining}마리 남음`}</em>
                        </span>
                      </button>
                      <button type="button" className="info-chip" disabled={Boolean(snapshot.holding) || Boolean(pendingInventory)} onClick={() => showCatalogAnimal(speciesId)}>정보</button>
                    </article>
                  );
                })}

              {inventoryCategory === 'instruments' && (
                <>
                  <article className="inventory-card instrument-card">
                    <button
                      type="button"
                      className={`inventory-card-main ${activeTool === 'light-probe' ? 'active' : ''}`}
                      disabled={Boolean(snapshot.holding) || Boolean(pendingInventory)}
                      onClick={() => toggleMeasurementTool('light-probe')}
                    >
                      <span className="inventory-thumb probe-thumb" aria-hidden="true"><i /></span>
                      <span className="inventory-copy">
                        <strong>광량 탐침</strong>
                        <small>포인터에서 미리 보고 지점 설치</small>
                        <em>{activeTool === 'light-probe' ? '설치 위치 선택 중 · 다시 눌러 해제' : '0~100 광량'}</em>
                      </span>
                    </button>
                  </article>
                  <article className="inventory-card instrument-card thermometer-card">
                    <button
                      type="button"
                      className={`inventory-card-main ${activeTool === 'temperature-probe' ? 'active' : ''}`}
                      disabled={Boolean(snapshot.holding) || Boolean(pendingInventory)}
                      onClick={() => toggleMeasurementTool('temperature-probe')}
                    >
                      <span className="inventory-thumb thermometer-thumb" aria-hidden="true"><i /></span>
                      <span className="inventory-copy">
                        <strong>수온계</strong>
                        <small>포인터에서 미리 보고 지점 설치</small>
                        <em>{activeTool === 'temperature-probe' ? '설치 위치 선택 중 · 다시 눌러 해제' : `${snapshot.waterTemperature.toFixed(1)}°C`}</em>
                      </span>
                    </button>
                  </article>
                  {snapshot.measurements.length > 0 && (
                    <div className="installed-measurements">
                      <strong>설치된 측정점 · {snapshot.measurements.length}</strong>
                      {snapshot.measurements.map((measurement, index) => (
                        <button
                          type="button"
                          key={measurement.id}
                          disabled={Boolean(snapshot.holding) || Boolean(pendingInventory)}
                          className={selectedMeasurement?.id === measurement.id ? 'active' : ''}
                          onClick={() => {
                            setActiveTool('select');
                            send({ type: 'clear-probe' });
                            send({ type: 'select-measurement', id: measurement.id });
                            setOpenHudPanels((current) => ({ ...current, observation: true }));
                          }}
                        >
                          <span className="measurement-list-label">
                            <MeasurementIcon kind={measurement.kind} compact />
                            {measurement.kind === 'light' ? '광량' : '수온'} {index + 1}
                          </span>
                          <strong>{measurement.kind === 'light' ? Math.round(measurement.light) : `${measurement.temperature.toFixed(1)}°C`}</strong>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </aside>
          )}

          <section className="tank-column">
            <div className="tank-stage-slot">
              <div className="tank-scene-fit">
                <div className="tank-frame" onPointerDownCapture={(event) => {
                  if (event.button === 0 && activeTool === 'select') {
                    setCatalogSpecies(null);
                    setCatalogAnimal(null);
                  }
                }}>
                  <AquariumCanvas
                    snapshot={snapshot}
                    motionSource={motionSource}
                    activeTool={activeTool}
                    selectionFilter={selectionFilter}
                    send={send}
                    editable={editable}
                    hasPendingInventory={Boolean(pendingInventory)}
                    onConsumePendingInventory={consumePendingInventory}
                    onPendingInventoryReady={finishPendingInventoryHandoff}
                    onToolComplete={returnToSelection}
                    onCameraChange={setCameraTransform}
                    cameraResetToken={cameraResetToken}
                    showGoalGuide={showGoalGuide}
                  />

                  {snapshot.probe && !openHudPanels.observation && (
                    <div className="tank-probe-readout" aria-live="polite">
                      <span>광량 <strong>{Math.round(snapshot.probe.light)}</strong></span>
                      <span>수온 <strong>{snapshot.probe.temperature.toFixed(1)}°C</strong></span>
                    </div>
                  )}

                  {!pendingInventory && snapshot.holding?.kind === 'structure' && heldStructure && (
                    <div
                      className="tank-rotation-orbit"
                      style={rotationOrbitStyle}
                      aria-label="구조물 회전"
                    >
                      <RotateButton direction={-1} send={send} />
                      <RotateButton direction={1} send={send} />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>

          {rightPanelVisible && (
          <aside className="info-panel v2-info-panel floating-info-stack">
            {openHudPanels.quest && (
            <section id="floating-quest-panel" className="paper-panel mission-note floating-note floating-quest-panel">
              <div className="tape" aria-hidden="true" />
              <button type="button" className="floating-note-close" aria-label="퀘스트 닫기" onClick={() => closeHudPanel('quest')}>×</button>
              <p className="panel-kicker">오늘의 관찰</p>
              <div className="mission-note-heading">
                <h2>{scenario.subtitle}</h2>
                <button type="button" onClick={openMissionBriefing}>{snapshot.mode === 'laboratory' ? '실험실 안내' : '미션 설명'}</button>
              </div>
              <p>{scenario.instruction}</p>
              {goalGuideCopy && (
                <div className="goal-guide-card">
                  <p>{goalGuideCopy}</p>
                  <div className="goal-guide-actions">
                    <span><i aria-hidden="true" /> 현재 점수에 포함된 대표 위치</span>
                    <button
                      type="button"
                      className={showGoalGuide ? 'active' : ''}
                      aria-pressed={showGoalGuide}
                      onClick={() => setShowGoalGuide((current) => !current)}
                    >{showGoalGuide ? '수조 표시 숨기기' : '수조에 표시하기'}</button>
                  </div>
                </div>
              )}
              {progress && (
                <div className="progress-block">
                  <div className="progress-label">
                    <span>{progress.label}</span>
                    <strong>{formatProgressValue(progress)}</strong>
                  </div>
                  <div className="progress-track"><span style={{ width: `${Math.min(100, progress.ratio * 100)}%` }} /></div>
                  {snapshot.outcome === 'pending' &&
                    (snapshot.currentTargetMet || progress.unit === 'adult-count') && (
                    <>
                      {progress.unit === 'adult-count' && (
                        <div className="progress-track hold-progress-track">
                          <span style={{ width: `${Math.min(100, (progress.holdCurrent / progress.holdTarget) * 100)}%` }} />
                        </div>
                      )}
                      <small className="hold-progress">
                        연속 유지 {formatTime(progress.holdCurrent)} / {formatTime(progress.holdTarget)}
                      </small>
                    </>
                  )}
                </div>
              )}
              {snapshot.outcome !== 'pending' && (
                <div className={`mission-outcome-note outcome-${snapshot.outcome}`}>
                  <strong>{snapshot.outcome === 'success' ? '실험 성공 기록' : '제한시간 실패 기록'}</strong>
                  <span>
                    {snapshot.currentTargetMet ? '현재 목표 조건 충족' : '현재 목표 조건 미충족'} · 계속 관찰 중
                  </span>
                </div>
              )}
            </section>
            )}

            {openHudPanels.observation && (
            <div id="floating-observation-panel" className="floating-observation-content">
              <section className="paper-panel floating-observation-heading">
                <div><span className="panel-label">관찰 기록</span><strong>{snapshot.selection?.ownerLabel ?? '수조 전체'}</strong></div>
                <button type="button" className="floating-note-close" aria-label="관찰 기록 닫기" onClick={() => closeHudPanel('observation')}>×</button>
              </section>

            {!selectedMeasurement && !inspectedAnimalSpecies && (
              <section className="paper-panel environment-panel">
                <div className="panel-row">
                  <span className="panel-label">포인터 미리보기</span>
                  {snapshot.probe && <button type="button" onClick={() => send({ type: 'clear-probe' })}>미리보기 닫기</button>}
                </div>
                {snapshot.probe ? (
                  <>
                    <div className="environment-readouts">
                      <div><span>광량</span><strong>{Math.round(snapshot.probe.light)}</strong></div>
                      <div><span>수온</span><strong>{snapshot.probe.temperature.toFixed(1)}°C</strong></div>
                    </div>
                    <p className="probe-location">{snapshot.probe.locationLabel} · 클릭하면 측정점 설치</p>
                  </>
                ) : (
                  <p className="measurement-empty">
                    {activeTool === 'light-probe' || activeTool === 'temperature-probe'
                      ? '수조 위로 포인터를 옮기면 그 위치의 값이 실시간으로 표시됩니다.'
                      : '측정 도구를 고르면 포인터 위치의 값이 실시간으로 표시됩니다.'}
                  </p>
                )}
                {selectedProbeTrend && inspectedSpecies && (
                  <div className={`species-trend ${trendCopy[selectedProbeTrend].className}`}>
                    <b><TrendIcon trend={selectedProbeTrend} /></b>
                    <span>{SPECIES[inspectedSpecies].shortName}<strong>{trendCopy[selectedProbeTrend].label}</strong></span>
                  </div>
                )}
              </section>
            )}

            {selectedStructure ? (
              <StructureInspector
                structure={selectedStructure}
                snapshot={snapshot}
                isHeld={snapshot.holding?.kind === 'structure' && snapshot.holding.structureId === selectedStructure.id}
                canRetrieve={removalEditable && !selectedStructure.locked}
                onRetrieve={() => send({ type: 'retrieve-structure', id: selectedStructure.id })}
              />
            ) : selectedMeasurement ? (
              <MeasurementInspector measurement={selectedMeasurement} send={send} />
            ) : selectedAnimal ? (
              <AnimalInspector
                animal={selectedAnimal}
                canRetrieve={removalEditable}
                onRetrieve={() => send({ type: 'retrieve-animal', id: selectedAnimal.id })}
              />
            ) : selectedCarcass ? (
              <AnimalCarcassInspector carcass={selectedCarcass} />
            ) : selectedRegionAnimals.length ? (
              <>
                <AnimalGroupInspector animals={selectedRegionAnimals} />
                {inspectedSpecies && selectedCells.length > 0 && (
                  <SpeciesGuide
                    speciesId={inspectedSpecies}
                    probeLight={snapshot.probe?.light ?? selectedAverageLight}
                    temperature={snapshot.probe?.temperature ?? snapshot.waterTemperature}
                    localBiomass={selectedBiomass}
                    onSelect={setCatalogSpecies}
                    availableSpecies={selectionSpeciesIds}
                    headingLabel="선택 영역의 조류"
                    scopeLabel={`선택 영역 관찰점 ${selectedCells.length}개`}
                    onRemoveFromSelection={removalEditable
                      ? () => send({ type: 'remove-selected-algae', speciesId: inspectedSpecies })
                      : undefined}
                    removalScopeLabel="선택 영역"
                  />
                )}
              </>
            ) : inspectedAnimalSpecies ? (
              <AnimalGuide speciesId={inspectedAnimalSpecies} />
            ) : inspectedSpecies ? (
              <SpeciesGuide
                speciesId={inspectedSpecies}
                probeLight={snapshot.probe?.light ?? selectedAverageLight}
                temperature={snapshot.probe?.temperature ?? snapshot.waterTemperature}
                localBiomass={selectedBiomass}
                onSelect={selectionSpeciesIds.length ? setCatalogSpecies : showCatalogSpecies}
                availableSpecies={selectionSpeciesIds.length ? selectionSpeciesIds : [inspectedSpecies]}
                headingLabel={selectionSpeciesIds.length ? '선택한 생물' : '생물 정보'}
                scopeLabel={snapshot.selection?.kind === 'region' ? `선택 영역 관찰점 ${selectedCells.length}개` : '선택한 위치'}
                onRemoveFromSelection={removalEditable && selectedCells.length
                  ? () => send({ type: 'remove-selected-algae', speciesId: inspectedSpecies })
                  : undefined}
                removalScopeLabel={snapshot.selection?.kind === 'region' ? '선택 영역' : '선택 지점'}
              />
            ) : (
              <section className="paper-panel empty-inspector">
                <span className="empty-inspector-icon" aria-hidden="true">
                  <svg viewBox="0 0 32 32"><circle cx="13" cy="13" r="8" /><path d="m19 19 8 8" /><circle cx="13" cy="13" r="1.5" /></svg>
                </span>
                <h3>선택한 대상 없음</h3>
                <p>
                  {inventoryCategory === 'structures' && '수조의 구조물을 선택하면 해당 구조물 정보가 표시됩니다.'}
                  {inventoryCategory === 'organisms' && '보이는 군락이나 동물을 클릭하고, 영역을 드래그해 그 안의 생물을 관찰할 수 있습니다.'}
                  {inventoryCategory === 'instruments' && '측정점을 설치하거나 수조의 측정점을 선택하면 실시간 값이 표시됩니다.'}
                </p>
              </section>
            )}

            <section className="paper-panel observation-panel compact-observation">
              <div className="panel-label">{scenario.allowedAnimals.length || snapshot.animals.length ? '생태 기록' : '군락 기록'}</div>
              <dl>
                {(scenario.allowedAnimals.length || snapshot.animals.length) && (
                  <>
                    <div><dt><i className="species-dot cherry-shrimp" />체리새우 성체</dt><dd>{snapshot.animalPopulation['cherry-shrimp'].adults}마리</dd></div>
                    <div><dt>어린 새우</dt><dd>{snapshot.animalPopulation['cherry-shrimp'].juveniles}마리</dd></div>
                    <div><dt>전체 새우</dt><dd>{snapshot.animalPopulation['cherry-shrimp'].total}마리</dd></div>
                    {snapshot.carcasses.length > 0 && (
                      <div className="carcass-total"><dt>죽은 새우</dt><dd>{snapshot.carcasses.length}마리</dd></div>
                    )}
                    <div className="consumption-total"><dt>새우가 먹은 조류</dt><dd>{snapshot.totalAlgaeConsumed.toFixed(1)}</dd></div>
                  </>
                )}
                {(scenario.allowedSpecies.includes('oedogonium') || snapshot.totalBiomass.oedogonium > 0) && (
                  <div><dt><i className="species-dot oedogonium" />붓뚜껑말 총량</dt><dd>{snapshot.totalBiomass.oedogonium.toFixed(1)}</dd></div>
                )}
                {(scenario.allowedSpecies.includes('nitzschia') || snapshot.totalBiomass.nitzschia > 0) && (
                  <div><dt><i className="species-dot nitzschia" />규조류 총량</dt><dd>{snapshot.totalBiomass.nitzschia.toFixed(1)}</dd></div>
                )}
                {!scenario.allowedAnimals.length && !snapshot.animals.length && (
                  <div><dt>{snapshot.mode === 'challenge' ? '판정 표면 점유' : '전체 표면 점유'}</dt><dd>{Math.round(snapshot.coverageRatio * 100)}%</dd></div>
                )}
              </dl>
              {(scenario.allowedAnimals.length > 0 || snapshot.animals.length > 0) && (
                <EcologyHistoryChart points={ecologyHistory} />
              )}
            </section>

            {snapshot.mode === 'laboratory' && (
              <section className="paper-panel lab-controls v2-lab-controls">
                <div className="panel-label">실험실 광원</div>
                <label>
                  <span>출력 <strong>{Math.round(snapshot.lightOutput)}</strong></span>
                  <input type="range" min={30} max={120} value={snapshot.lightOutput} disabled={!editable} onChange={(event) => send({ type: 'set-light-output', output: Number(event.target.value) })} />
                </label>
              </section>
            )}
            </div>
            )}
          </aside>
          )}
        </section>

        <footer className="control-dock">
          {snapshot.holding ? (
            <section className="tank-placement-toolbar" aria-label="들고 있는 항목 조작">
              <div className="placement-toolbar-item">
                <span className={snapshot.holding.valid ? 'valid' : 'invalid'}>
                  {snapshot.holding.valid ? '놓을 수 있음' : '놓을 수 없음'}
                </span>
                <strong>
                  {snapshot.holding.kind === 'structure'
                    ? heldStructure?.label
                    : snapshot.holding.kind === 'animal'
                      ? ANIMALS[snapshot.holding.animalSpeciesId!].displayName
                      : SPECIES[snapshot.holding.speciesId!].shortName}
                </strong>
              </div>
              <small>
                {snapshot.holding.kind === 'structure'
                  ? 'Q/E 또는 휠로 회전 · 수조를 클릭해 놓기'
                  : snapshot.holding.kind === 'animal'
                    ? '수면 아래 원하는 위치를 클릭해 방류'
                    : '표면을 클릭해 접종'}
              </small>
              <div className="placement-toolbar-actions">
                <button type="button" onClick={() => {
                  send({ type: 'cancel-held' });
                  returnToSelection();
                }}>
                  {snapshot.holding.source === 'existing' ? '원래 자리' : '배치 취소'}
                </button>
                {snapshot.holding.source === 'existing' && (
                  <button type="button" onClick={() => {
                    send({
                      type: snapshot.holding?.kind === 'structure' ? 'remove-held-structure' : 'retrieve-held',
                    });
                    returnToSelection();
                  }}>보유 목록으로</button>
                )}
              </div>
            </section>
          ) : null}
        </footer>
      </main>
    </>
  );
}

function StructureInspector({
  structure,
  snapshot,
  isHeld = false,
  canRetrieve = false,
  onRetrieve,
}: {
  structure: SimulationSnapshot['structures'][number];
  snapshot: SimulationSnapshot;
  isHeld?: boolean;
  canRetrieve?: boolean;
  onRetrieve?: () => void;
}) {
  const definition = STRUCTURES[structure.definitionId];
  const cells = snapshot.cells.filter((cell) => cell.ownerId === structure.id);
  const averageLight = cells.length
    ? cells.reduce((total, cell) => total + cell.light, 0) / cells.length
    : 0;
  return (
    <section className="paper-panel structure-inspector">
      <div className="structure-inspector-heading">
        <img src={definition.assetPath} alt="" />
        <div><span className="panel-label">{isHeld ? '배치 중인 구조물' : '선택한 구조물'}</span><h3>{definition.label}</h3></div>
      </div>
      <dl className="species-facts">
        <div><dt>재질</dt><dd>{definition.material}</dd></div>
        <div><dt>평균 광량</dt><dd>{isHeld ? '배치 후 계산' : `${Math.round(averageLight)} / 100`}</dd></div>
        <div><dt>수온</dt><dd>{snapshot.waterTemperature.toFixed(1)}°C</dd></div>
        <div><dt>상태</dt><dd>{isHeld ? '배치 중' : structure.isSleeping ? '안정됨' : '움직이는 중'}</dd></div>
      </dl>
      {canRetrieve && onRetrieve && (
        <div className="manual-removal-actions">
          <button type="button" onClick={onRetrieve}>수조에서 치우기</button>
          <small>보유 목록으로 돌아가며 돌 표면의 조류도 함께 제거됩니다.</small>
        </div>
      )}
    </section>
  );
}

function MeasurementInspector({
  measurement,
  send,
}: {
  measurement: SimulationSnapshot['measurements'][number];
  send: (command: SimulationCommand) => void;
}) {
  return (
    <section className="paper-panel measurement-inspector">
      <div className="measurement-inspector-heading">
        <span aria-hidden="true"><MeasurementIcon kind={measurement.kind} /></span>
        <div>
          <span className="panel-label">선택한 측정점</span>
          <h3>{measurement.kind === 'light' ? '광량 탐침' : '수온계'}</h3>
        </div>
      </div>
      <div className="measurement-primary">
        <span>{measurement.kind === 'light' ? '현재 광량' : '현재 수온'}</span>
        <strong>{measurement.kind === 'light' ? Math.round(measurement.light) : `${measurement.temperature.toFixed(1)}°C`}</strong>
      </div>
      <dl className="species-facts">
        <div><dt>설치 위치</dt><dd>{measurement.locationLabel}</dd></div>
        {measurement.kind === 'light'
          ? <div><dt>함께 기록</dt><dd>수온 {measurement.temperature.toFixed(1)}°C</dd></div>
          : <div><dt>함께 기록</dt><dd>광량 {Math.round(measurement.light)} / 100</dd></div>}
        <div><dt>기록 방식</dt><dd>시뮬레이션 중 실시간 갱신</dd></div>
      </dl>
      <button type="button" className="remove-measurement" onClick={() => send({ type: 'remove-measurement', id: measurement.id })}>측정점 회수</button>
    </section>
  );
}

const animalBehaviorLabel: Record<SimulationSnapshot['animals'][number]['behavior'], string> = {
  held: '방류 위치 선택 중',
  exploring: '표면을 탐색하는 중',
  traveling: '먹이 쪽으로 이동 중',
  grazing: '조류를 뜯어 먹는 중',
  resting: '쉬며 몸을 다듬는 중',
  starving: '먹이가 부족해 쇠약함',
};

function AnimalInspector({
  animal,
  canRetrieve = false,
  onRetrieve,
}: {
  animal: SimulationSnapshot['animals'][number];
  canRetrieve?: boolean;
  onRetrieve?: () => void;
}) {
  const definition = ANIMALS[animal.speciesId];
  const nutrition = animal.energy >= 0.72
    ? '충분함'
    : animal.energy >= 0.4
      ? '보통'
      : animal.energy >= 0.18
        ? '부족함'
        : '굶주림';
  const reproduction = animal.sex === 'male'
    ? '수컷'
    : animal.reproductiveState === 'berried'
      ? '알을 품고 있음'
      : animal.reproductiveState === 'ready'
        ? '번식 가능한 상태'
        : '번식 조건 미충족';
  const feedingState = animal.behavior === 'grazing' && animal.recentIntake > 0.001
    ? '지금 조류를 먹는 중'
    : animal.recentIntake >= 0.01
      ? '방금 조류를 먹었음'
      : '최근 먹지 않음';
  return (
    <section className="paper-panel animal-inspector">
      <div className="animal-inspector-heading">
        <span className="animal-thumb cherry-shrimp-thumb large" aria-hidden="true">
          <i className="shrimp-body" /><i className="shrimp-tail" /><i className="shrimp-antenna" />
        </span>
        <div><span className="panel-label">선택한 동물</span><h3>{definition.displayName}</h3><small>{definition.scientificName}</small></div>
      </div>
      <dl className="species-facts">
        <div><dt>생활 단계</dt><dd>{animal.lifeStage === 'adult' ? '성체' : '어린 새우'} · {animal.sex === 'female' ? '암컷' : '수컷'}</dd></div>
        <div><dt>시뮬레이션 나이</dt><dd>{formatTime(animal.ageSeconds)} / 수명 약 {formatTime(animal.lifespanSeconds)}</dd></div>
        <div><dt>현재 행동</dt><dd>{animalBehaviorLabel[animal.behavior]}</dd></div>
        <div><dt>영양 상태</dt><dd>{nutrition} · {Math.round(animal.energy * 100)} / 100</dd></div>
        <div><dt>최근 섭식</dt><dd>{feedingState}</dd></div>
        <div><dt>먹은 조류</dt><dd>누적 {animal.consumedBiomass.toFixed(1)}</dd></div>
        <div><dt>번식 상태</dt><dd>{animal.lifeStage === 'juvenile' ? '아직 성장 중' : reproduction}</dd></div>
      </dl>
      <p className="animal-note">실제로 먹은 만큼 표면의 조류가 줄고, 확보한 에너지가 생존·성장·번식에 사용됩니다.</p>
      {canRetrieve && onRetrieve && (
        <div className="manual-removal-actions">
          <button type="button" onClick={onRetrieve}>수조에서 회수하기</button>
          <small>배치를 편집할 수 있을 때 선택한 개체를 보유 목록으로 돌려보냅니다.</small>
        </div>
      )}
    </section>
  );
}

function AnimalCarcassInspector({
  carcass,
}: {
  carcass: SimulationSnapshot['carcasses'][number];
}) {
  const definition = ANIMALS[carcass.speciesId];
  return (
    <section className="paper-panel animal-inspector animal-carcass-inspector">
      <div className="animal-inspector-heading">
        <span className="animal-thumb cherry-shrimp-thumb large carcass" aria-hidden="true">
          <i className="shrimp-body" /><i className="shrimp-tail" /><i className="shrimp-antenna" />
        </span>
        <div>
          <span className="panel-label">선택한 죽은 개체</span>
          <h3>{definition.displayName}</h3>
          <small>{definition.scientificName}</small>
        </div>
      </div>
      <dl className="species-facts">
        <div><dt>상태</dt><dd>죽은 개체</dd></div>
        <div><dt>생활 단계</dt><dd>{carcass.lifeStage === 'adult' ? '성체' : '어린 새우'}</dd></div>
        <div><dt>사망 원인</dt><dd>{carcass.cause === 'starvation' ? '먹이 부족으로 에너지 고갈' : '수명을 다해 자연사'}</dd></div>
        <div><dt>죽은 뒤</dt><dd>{formatTime(carcass.ageSeconds)}</dd></div>
      </dl>
      <p className="animal-note">사망 질량은 수조의 유기물 기록에 남습니다. 분해와 수질 영향은 아직 활성화하지 않았습니다.</p>
    </section>
  );
}

function AnimalGroupInspector({
  animals,
}: {
  animals: SimulationSnapshot['animals'];
}) {
  const adults = animals.filter((animal) => animal.lifeStage === 'adult').length;
  const juveniles = animals.length - adults;
  const averageEnergy = animals.reduce((sum, animal) => sum + animal.energy, 0) /
    Math.max(1, animals.length);
  const grazing = animals.filter((animal) => animal.behavior === 'grazing').length;
  const consumedBiomass = animals.reduce((sum, animal) => sum + animal.consumedBiomass, 0);
  return (
    <section className="paper-panel animal-inspector animal-group-inspector">
      <div className="animal-inspector-heading">
        <span className="animal-thumb cherry-shrimp-thumb large" aria-hidden="true">
          <i className="shrimp-body" /><i className="shrimp-tail" /><i className="shrimp-antenna" />
        </span>
        <div><span className="panel-label">선택 영역의 동물</span><h3>체리새우 {animals.length}마리</h3></div>
      </div>
      <dl className="species-facts">
        <div><dt>개체 구성</dt><dd>성체 {adults} · 어린 새우 {juveniles}</dd></div>
        <div><dt>평균 에너지</dt><dd>{Math.round(averageEnergy * 100)} / 100</dd></div>
        <div><dt>현재 섭식</dt><dd>{grazing}마리</dd></div>
        <div><dt>먹은 조류</dt><dd>누적 {consumedBiomass.toFixed(1)}</dd></div>
      </dl>
    </section>
  );
}

function EcologyHistoryChart({ points }: { points: EcologyHistoryPoint[] }) {
  const sparkPoints = (
    values: number[],
    top: number,
    height: number,
  ): string => {
    if (!values.length) return '';
    const minimum = Math.min(...values);
    const maximum = Math.max(...values);
    const range = Math.max(maximum - minimum, maximum * 0.08, 0.25);
    return values.map((value, index) => {
      const x = values.length === 1 ? 116 : 43 + (index / (values.length - 1)) * 146;
      const y = top + height - 3 - ((value - minimum) / range) * (height - 6);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
  };
  const algaeValues = points.map((point) => point.algaeBiomass);
  const shrimpValues = points.map((point) => point.shrimpCount);
  const latest = points.at(-1) ?? { elapsedSeconds: 0, algaeBiomass: 0, shrimpCount: 0 };
  const algaePoints = sparkPoints(algaeValues, 4, 28);
  const shrimpPoints = sparkPoints(shrimpValues, 40, 28);

  return (
    <div className="ecology-history">
      <div className="ecology-history-heading">
        <strong>시간에 따른 변화</strong>
        <small>{points.length > 1 ? `${formatTime(points[0].elapsedSeconds)}–${formatTime(latest.elapsedSeconds)}` : '관찰 대기 중'}</small>
      </div>
      <svg viewBox="0 0 240 72" role="img" aria-label="조류 총량과 새우 개체 수의 시간 변화">
        <path className="ecology-history-guide" d="M43 32H189M43 68H189" />
        <text x="5" y="12">조류</text>
        <text x="5" y="48">새우</text>
        {algaePoints && <polyline className="ecology-history-line algae" points={algaePoints} />}
        {shrimpPoints && <polyline className="ecology-history-line shrimp" points={shrimpPoints} />}
        <text className="ecology-history-value algae" x="235" y="12" textAnchor="end">{latest.algaeBiomass.toFixed(1)}</text>
        <text className="ecology-history-value shrimp" x="235" y="48" textAnchor="end">{latest.shrimpCount}마리</text>
      </svg>
      <small className="ecology-history-note">새우가 먹은 양은 조류 총량에 바로 반영됩니다.</small>
    </div>
  );
}

function AnimalGuide({ speciesId }: { speciesId: AnimalSpeciesId }) {
  const definition = ANIMALS[speciesId];
  return (
    <section className="paper-panel animal-inspector animal-guide">
      <div className="animal-inspector-heading">
        <span className="animal-thumb cherry-shrimp-thumb large" aria-hidden="true">
          <i className="shrimp-body" /><i className="shrimp-tail" /><i className="shrimp-antenna" />
        </span>
        <div><span className="panel-label">동물 정보</span><h3>{definition.displayName}</h3><small>{definition.scientificName}</small></div>
      </div>
      <p>{definition.description}</p>
      <dl className="species-facts">
        <div><dt>먹이</dt><dd>{definition.diet}</dd></div>
        <div><dt>성체 크기</dt><dd>{definition.adultLength}</dd></div>
        <div><dt>번식</dt><dd>충분히 먹은 성체 암수가 번식합니다. 먹이가 부족해지면 번식과 성장이 멈추고, 오래 굶으면 죽습니다.</dd></div>
      </dl>
    </section>
  );
}

function SpeciesGuide({
  speciesId,
  probeLight,
  temperature,
  localBiomass,
  onSelect,
  availableSpecies,
  headingLabel,
  scopeLabel,
  onRemoveFromSelection,
  removalScopeLabel,
}: {
  speciesId: SpeciesId;
  probeLight?: number;
  temperature: number;
  localBiomass?: SimulationSnapshot['cells'][number]['biomass'];
  onSelect: (speciesId: SpeciesId) => void;
  availableSpecies: SpeciesId[];
  headingLabel: string;
  scopeLabel: string;
  onRemoveFromSelection?: () => void;
  removalScopeLabel?: string;
}) {
  const species = SPECIES[speciesId];
  const minRate = -0.045;
  const maxRate = 0.07;
  const chartLeft = 32;
  const chartRight = 224;
  const chartTop = 13;
  const chartBottom = 84;
  const toX = (light: number): number => chartLeft + (light / 100) * (chartRight - chartLeft);
  const toY = (rate: number): number => chartBottom -
    ((rate - minRate) / (maxRate - minRate)) * (chartBottom - chartTop);
  const curveSamples = Array.from({ length: 51 }, (_, index) => index * 2);
  const curvePath = curveSamples.map((light, index) => {
    const x = toX(light);
    const y = toY(netGrowthPotential(speciesId, light, temperature));
    return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');
  const currentRate = probeLight === undefined
    ? undefined
    : netGrowthPotential(speciesId, probeLight, temperature);
  const markerX = probeLight === undefined ? null : toX(probeLight);
  const markerY = probeLight === undefined
    ? null
    : toY(currentRate!);
  const rateLabel = currentRate === undefined
    ? null
    : `${currentRate >= 0 ? '+' : ''}${(currentRate * 100).toFixed(1)}%/초`;
  const currentTrend = probeLight === undefined
    ? null
    : growthTrend(speciesId, probeLight, temperature);
  const xTicks = [0, 25, 50, 75, 100];
  const yTicks = [0.07, 0.04, 0, -0.04];
  const localTotal = localBiomass ? localBiomass.oedogonium + localBiomass.nitzschia : 0;
  const localShare = localBiomass && localTotal > 0 ? localBiomass[speciesId] / localTotal : null;
  return (
    <section className="paper-panel species-guide">
      <div className="species-guide-tabs">
        {availableSpecies.map((id) => (
          <button key={id} type="button" className={speciesId === id ? 'active' : ''} onClick={() => onSelect(id)}>
            {SPECIES[id].shortName}
          </button>
        ))}
      </div>
      <div className="species-heading">
        <span className={`microscope-preview microscope-${speciesId}`} aria-hidden="true"><i /><i /><i /></span>
        <div><span className="panel-label">{headingLabel}</span><h3>{species.displayName}</h3><em>{species.scientificName}</em></div>
      </div>
      {localShare !== null && <div className="local-share">{scopeLabel}의 군락 비율 <strong>{Math.round(localShare * 100)}%</strong></div>}
      <p>{species.description}</p>
      <dl className="species-facts">
        <div><dt>실제 크기</dt><dd>{species.realScale}</dd></div>
        <div><dt>육안 군락</dt><dd>{species.colonyAppearance}</dd></div>
        <div><dt>빛의 틈새</dt><dd>{species.niche}</dd></div>
        <div><dt>수온 반응</dt><dd>{species.temperatureSummary}</dd></div>
      </dl>
      <div className="response-chart">
        <div>
          <strong>광량에 따른 성장 잠재력</strong>
          <span>{probeLight === undefined
            ? '가로축 광량 · 세로축 %/초'
            : `광량 ${Math.round(probeLight)} · 잠재 ${rateLabel} · ${currentTrend ? potentialTrendLabel[currentTrend] : ''}`}</span>
        </div>
        <svg viewBox="0 0 238 108" role="img" aria-label={`${species.shortName} 상대 광량별 환경 성장 잠재율 곡선`}>
          {xTicks.map((tick) => (
            <g key={`x-${tick}`}>
              <line x1={toX(tick)} y1={chartTop} x2={toX(tick)} y2={chartBottom} className="grid-line" />
              <text x={toX(tick)} y="97" textAnchor="middle">{tick}</text>
            </g>
          ))}
          {yTicks.map((tick) => (
            <g key={`y-${tick}`}>
              <line x1={chartLeft} y1={toY(tick)} x2={chartRight} y2={toY(tick)} className={tick === 0 ? 'zero-line' : 'grid-line'} />
              <text x="27" y={toY(tick) + 3} textAnchor="end">{tick > 0 ? '+' : ''}{Math.round(tick * 100)}</text>
            </g>
          ))}
          <line x1={chartLeft} y1={chartTop} x2={chartLeft} y2={chartBottom} className="axis-line" />
          <line x1={chartLeft} y1={chartBottom} x2={chartRight} y2={chartBottom} className="axis-line" />
          <path d={curvePath} className={`curve curve-${speciesId}`} />
          {markerX !== null && markerY !== null && (
            <g className="probe-marker">
              <line x1={markerX} y1={chartTop} x2={markerX} y2={chartBottom} />
              <circle cx={markerX} cy={markerY} r="4" />
              <text x={markerX} y={Math.max(11, markerY - 7)} textAnchor="middle">{Math.round(probeLight!)}</text>
            </g>
          )}
          <text x="4" y="9" className="axis-title">환경 잠재 %/초</text>
          <text x="224" y="106" textAnchor="end" className="axis-title">상대 광량</text>
          <text x="228" y={toY(0) - 3} className="zero-caption">성장</text>
          <text x="228" y={toY(0) + 9} className="zero-caption">감소</text>
        </svg>
      </div>
      {onRemoveFromSelection && (
        <div className="manual-removal-actions algae-removal-actions">
          <button type="button" onClick={onRemoveFromSelection}>
            {removalScopeLabel ?? '선택 범위'}에서 {species.shortName} 걷어내기
          </button>
          <small>배치를 편집할 수 있을 때 사용하며 다른 조류 종은 남습니다.</small>
        </div>
      )}
    </section>
  );
}
