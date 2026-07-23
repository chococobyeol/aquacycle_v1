import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  ALGAE_VISIBLE_BIOMASS,
  ANIMALS,
  MICROBE_ECOLOGY_RULES,
  MICROBES,
  SCENARIOS,
  SHRIMP_ECOLOGY_RULES,
  SPECIES,
  STRUCTURES,
  WATER_CYCLE_RULES,
} from '../../simulation/config';
import { growthTrend, netGrowthPotential } from '../../simulation/growth';
import { SIMULATION_SPEED_OPTIONS, type SimulationSpeed } from '../../simulation/speed';
import { thetaTemperatureFactor } from '../../simulation/temperatureResponse';
import type {
  AnimalPopulationEventSnapshot,
  AnimalSpeciesId,
  GrowthTrend,
  InteractionTool,
  InventoryCategory,
  MeasurementKind,
  MicrobeGuildId,
  SelectionFilter,
  ScenarioId,
  SimulationCommand,
  SimulationSnapshot,
  SpeciesId,
  StructureDefinitionId,
  StructureSnapshot,
  Vec2,
} from '../../simulation/types';
import { GROUND_Y, TANK_HEIGHT, TANK_WIDTH, WATER_TOP } from '../../simulation/types';
import { useSimulation, type SimulationMotionSource } from '../hooks/useSimulation';
import {
  discardFrozenAquarium,
  freezeAquarium,
  readFrozenAquariums,
  type FrozenAquariumRecord,
} from '../storage/aquariumSaves';
import { AquariumCanvas, type AquariumCameraTransform } from '../tank/AquariumCanvas';
import { createReusableMotionInterpolator } from '../tank/motionInterpolation';
import {
  structureEditOverlayLayout,
  structureEditOverlaySnapshot,
} from '../tank/structureEditOverlay';
import {
  analysisLayerStatistics,
  biofilmPlacementLayers,
  type WaterQualityLayer,
} from '../tank/waterQualityOverlay';
import { CloseGlyph } from './CloseGlyph';
import {
  appendRollingHistory,
  ECOLOGY_HISTORY_WINDOW_SECONDS,
  ECOLOGY_HISTORY_WINDOW_OPTIONS_SECONDS,
  historyPointsInWindow,
  historyTimeBounds,
  historyTimeX,
} from './ecologyHistory';

interface SimulationScreenProps {
  scenarioId: ScenarioId;
  onBack: () => void;
  onMissionComplete: (scenarioId: ScenarioId) => void;
}

interface PendingInventoryItem {
  requestId: number;
  kind: 'structure' | 'seed' | 'animal' | 'biofilm';
  label: string;
  assetPath?: string;
  definitionId?: StructureDefinitionId;
  speciesId?: SpeciesId;
  animalSpeciesId?: AnimalSpeciesId;
  microbeGuildId?: MicrobeGuildId;
}

interface WaterQualityViewState {
  layers: WaterQualityLayer[];
  visible: boolean;
  legendCollapsed: boolean;
}

interface EcologyHistoryPoint {
  elapsedSeconds: number;
  algaeBiomass: number;
  plantBiomass: number;
  lightMultiplier: number;
  grossPhotosynthesis: number;
  producerRespiration: number;
  shrimpCount: number;
  shrimpAdultFemales: number;
  shrimpAdultMales: number;
  shrimpJuveniles: number;
  cumulativeBirths: number;
  cumulativeDeaths: number;
  organicMatter: number;
  toxicWaste: number;
  nutrients: number;
  oxygen: number;
  decomposer: number;
  nitrifier: number;
  dissolvedInorganicCarbon: number;
  headspaceCarbonDioxide: number;
  headspaceOxygen: number;
}

type HudPanelId = 'menu' | 'inventory' | 'quest' | 'observation';
type ObservationView = 'selection' | 'overview';
type ObservationSection = 'ecology' | 'water' | 'ledger' | 'history';

interface ObservationSectionDefinition {
  id: ObservationSection;
  title: string;
  summary: string;
}

interface DetachedPanelLayout {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface DetachedPanelInteractionState {
  section: ObservationSection;
  mode: 'move' | 'resize';
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startLayout: DetachedPanelLayout;
  workspaceWidth: number;
  workspaceHeight: number;
}

interface RightPanelResizeState {
  pointerId: number;
  startClientY: number;
  startHeight: number;
  maximumHeight: number;
}

const OBSERVATION_SECTION_ORDER: ObservationSection[] = ['ecology', 'water', 'ledger', 'history'];
const DETACHED_PANEL_EDGE = 10;
const DETACHED_PANEL_TOP = 74;
const DETACHED_PANEL_BOTTOM = DETACHED_PANEL_EDGE;
const DETACHED_PANEL_MIN_WIDTH = 300;
const DETACHED_PANEL_MAX_WIDTH = 560;
const DETACHED_PANEL_MIN_HEIGHT = 220;
const RIGHT_PANEL_MIN_HEIGHT = 260;

const clampDetachedPanelLayout = (
  layout: DetachedPanelLayout,
  workspaceWidth: number,
  workspaceHeight: number,
): DetachedPanelLayout => {
  const maximumWidth = Math.max(1, workspaceWidth - DETACHED_PANEL_EDGE * 2);
  const maximumHeight = Math.max(1, workspaceHeight - DETACHED_PANEL_TOP - DETACHED_PANEL_BOTTOM);
  const minimumWidth = Math.min(DETACHED_PANEL_MIN_WIDTH, maximumWidth);
  const minimumHeight = Math.min(DETACHED_PANEL_MIN_HEIGHT, maximumHeight);
  const width = Math.max(minimumWidth, Math.min(Math.min(DETACHED_PANEL_MAX_WIDTH, maximumWidth), layout.width));
  const height = Math.max(minimumHeight, Math.min(maximumHeight, layout.height));
  return {
    x: Math.max(DETACHED_PANEL_EDGE, Math.min(workspaceWidth - DETACHED_PANEL_EDGE - width, layout.x)),
    y: Math.max(DETACHED_PANEL_TOP, Math.min(workspaceHeight - DETACHED_PANEL_BOTTOM - height, layout.y)),
    width,
    height,
  };
};

const createDetachedPanelLayout = (
  section: ObservationSection,
  workspaceWidth: number,
  workspaceHeight: number,
): DetachedPanelLayout => {
  const sectionIndex = OBSERVATION_SECTION_ORDER.indexOf(section);
  const rightRailWidth = Math.min(372, Math.max(300, workspaceWidth * 0.27)) + 22;
  const usableWidth = Math.max(DETACHED_PANEL_MIN_WIDTH, workspaceWidth - rightRailWidth - DETACHED_PANEL_EDGE * 2);
  const initialTop = workspaceHeight >= 760 ? 214 : 114;
  const usableHeight = Math.max(
    DETACHED_PANEL_MIN_HEIGHT,
    workspaceHeight - initialTop - DETACHED_PANEL_BOTTOM,
  );
  const gap = 12;
  const twoColumns = usableWidth >= DETACHED_PANEL_MIN_WIDTH * 2 + gap;

  if (twoColumns) {
    const width = Math.min(380, (usableWidth - gap) / 2);
    const height = Math.max(DETACHED_PANEL_MIN_HEIGHT, (usableHeight - gap) / 2);
    return clampDetachedPanelLayout({
      x: DETACHED_PANEL_EDGE + (sectionIndex % 2) * (width + gap),
      y: initialTop + Math.floor(sectionIndex / 2) * (height + gap),
      width,
      height,
    }, workspaceWidth, workspaceHeight);
  }

  const preferredHeight = section === 'history' ? 460 : section === 'water' ? 360 : 300;
  return clampDetachedPanelLayout({
    x: DETACHED_PANEL_EDGE + sectionIndex * 18,
    y: initialTop + sectionIndex * 30,
    width: Math.min(420, usableWidth),
    height: preferredHeight,
  }, workspaceWidth, workspaceHeight);
};

const detachedPanelLayoutsMatch = (
  first: DetachedPanelLayout,
  second: DetachedPanelLayout,
): boolean => first.x === second.x && first.y === second.y &&
  first.width === second.width && first.height === second.height;

const closedHudPanels = (): Record<HudPanelId, boolean> => ({
  menu: false,
  inventory: false,
  quest: false,
  observation: false,
});

const STRUCTURE_IDS: StructureDefinitionId[] = ['flat-stone', 'round-stone', 'tall-stone'];
const SPECIES_IDS: SpeciesId[] = ['oedogonium', 'nitzschia', 'vallisneria'];
const ANIMAL_IDS: AnimalSpeciesId[] = ['cherry-shrimp'];
const MICROBE_IDS: MicrobeGuildId[] = ['decomposer', 'nitrifier'];

const WATER_QUALITY_CHANNELS: readonly {
  id: WaterQualityLayer;
  label: string;
  shortLabel: string;
}[] = [
  { id: 'organicMatter', label: '유기물', shortLabel: '유기물' },
  { id: 'toxicWaste', label: '암모니아성 노폐물', shortLabel: '암모니아' },
  { id: 'nutrients', label: '영양염', shortLabel: '영양염' },
  { id: 'oxygen', label: '용존산소', shortLabel: '산소' },
  { id: 'temperature', label: '수온', shortLabel: '수온' },
  { id: 'flow', label: '물 흐름', shortLabel: '흐름' },
  { id: 'decomposer', label: '분해균 필름', shortLabel: '분해균' },
  { id: 'nitrifier', label: '질산화균 필름', shortLabel: '질산화균' },
];

const waterQualityChannel = (layer: WaterQualityLayer | null) =>
  WATER_QUALITY_CHANNELS.find((channel) => channel.id === layer);

const waterQualityValue = (
  sample: NonNullable<SimulationSnapshot['probe']>,
  layer: WaterQualityLayer,
): number => layer === 'decomposer' || layer === 'nitrifier'
  ? sample.biofilm[layer] * 100
  : layer === 'temperature'
    ? sample.temperature
    : layer === 'flow'
      ? sample.waterSpeed
      : sample.water[layer];

const formatWaterQualityValue = (layer: WaterQualityLayer, value: number): string =>
  layer === 'decomposer' || layer === 'nitrifier'
    ? `${value.toFixed(2)}%`
    : layer === 'temperature'
      ? `${value.toFixed(1)}°C`
      : layer === 'flow'
        ? `${value.toFixed(3)}칸/초`
        : value.toFixed(2);

const formatTime = (seconds: number): string => {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(safeSeconds % 60).padStart(2, '0')}`;
};

const formatSignedPercent = (ratio: number): string => {
  const percent = ratio * 100;
  return `${percent >= 0 ? '+' : ''}${percent.toFixed(4)}%`;
};

const formatProgressValue = (
  progress: NonNullable<SimulationSnapshot['missionProgress']>,
): string => progress.unit === 'biomass'
  ? `${progress.current.toFixed(1)} / ${progress.target.toFixed(1)}`
  : progress.unit === 'adult-count' || progress.unit === 'population-count'
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

const dayNightPhaseLabel = {
  dawn: '새벽',
  day: '낮',
  dusk: '해질녘',
  night: '밤',
} as const;

function MeasurementIcon({
  kind,
  compact = false,
}: {
  kind: MeasurementKind;
  compact?: boolean;
}) {
  return (
    <svg className={`measurement-icon ${compact ? 'compact' : ''}`} viewBox="0 0 24 24" aria-hidden="true">
      {kind === 'light' ? (
        <>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" />
        </>
      ) : kind === 'temperature' ? (
        <>
          <path d="M9 14.8V5a3 3 0 0 1 6 0v9.8a5 5 0 1 1-6 0Z" />
          <path d="M12 8v8" />
          <circle cx="12" cy="18" r="2" />
        </>
      ) : (
        <>
          <path d="M4 8.5c2.2-2 4.4-2 6.6 0s4.4 2 6.6 0 3.8-1.5 3.8-1.5M4 13c2.2-2 4.4-2 6.6 0s4.4 2 6.6 0 3.8-1.5 3.8-1.5M5 18h14" />
          <circle cx="6" cy="4" r="1.2" />
          <circle cx="12" cy="5.5" r="1.2" />
          <circle cx="18" cy="3.5" r="1.2" />
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

function ObservationDockGlyph({ direction }: { direction: 'detach' | 'attach' }) {
  return (
    <svg className="observation-dock-glyph" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="3.5" width="18" height="17" rx="2.5" />
      <path d="M15.5 3.5v17" />
      {direction === 'detach' ? (
        <path d="M12.5 9H6m0 0 2.5-2.5M6 9l2.5 2.5" />
      ) : (
        <path d="M6 9h6.5m0 0L10 6.5M12.5 9 10 11.5" />
      )}
    </svg>
  );
}

function RotateButton({
  direction,
  send,
  structureId,
  className,
}: {
  direction: -1 | 1;
  send: (command: SimulationCommand) => void;
  structureId?: string;
  className?: string;
}) {
  const timerRef = useRef<number | null>(null);
  const rotate = (): void => {
    const radians = direction * (Math.PI / 18);
    send(structureId
      ? { type: 'rotate-structure', id: structureId, radians }
      : { type: 'rotate-held', radians });
  };
  const stop = (): void => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    timerRef.current = null;
  };
  return (
    <button
      type="button"
      className={className}
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

function StructureEditControls({
  structure,
  cameraTransform,
  motionSource,
  send,
}: {
  structure: StructureSnapshot;
  cameraTransform: AquariumCameraTransform;
  motionSource: SimulationMotionSource;
  send: (command: SimulationCommand) => void;
}) {
  const orbitRef = useRef<HTMLDivElement | null>(null);
  const structureRef = useRef(structure);
  const cameraRef = useRef(cameraTransform);
  structureRef.current = structure;
  cameraRef.current = cameraTransform;

  useEffect(() => {
    const interpolator = createReusableMotionInterpolator();
    let animationFrame = 0;
    let lastLayoutKey = '';
    const updatePosition = (): void => {
      const base = structureRef.current;
      const motion = interpolator.sample(motionSource.getFrames(), performance.now());
      const moving = motion?.structures.find((candidate) => candidate.id === base.id);
      const rendered = structureEditOverlaySnapshot(base, moving);
      const layout = structureEditOverlayLayout(rendered, cameraRef.current);
      const layoutKey = [
        layout.left,
        layout.top,
        layout.rotateLeftX,
        layout.rotateRightX,
        layout.deleteY,
      ].map((value) => value.toFixed(2)).join(':');
      const orbit = orbitRef.current;
      if (orbit && layoutKey !== lastLayoutKey) {
        lastLayoutKey = layoutKey;
        orbit.style.left = `${layout.left}px`;
        orbit.style.top = `${layout.top}px`;
        orbit.style.setProperty('--rotate-left-x', `${layout.rotateLeftX}px`);
        orbit.style.setProperty('--rotate-right-x', `${layout.rotateRightX}px`);
        orbit.style.setProperty('--delete-y', `${layout.deleteY}px`);
      }
      animationFrame = requestAnimationFrame(updatePosition);
    };
    updatePosition();
    return () => cancelAnimationFrame(animationFrame);
  }, [motionSource]);

  return (
    <div
      ref={orbitRef}
      className="tank-structure-edit-orbit"
      aria-label="선택한 구조물 편집"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="structure-action-move"
        aria-label="구조물 이동"
        title="이동"
        onClick={() => send({ type: 'hold-structure', id: structure.id })}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3v18M3 12h18M12 3 9 6m3-3 3 3M12 21l-3-3m3 3 3-3M3 12l3-3m-3 3 3 3M21 12l-3-3m3 3-3 3" />
        </svg>
      </button>
      <RotateButton className="structure-action-rotate-left" direction={-1} send={send} structureId={structure.id} />
      <RotateButton className="structure-action-rotate-right" direction={1} send={send} structureId={structure.id} />
      <button
        type="button"
        className="structure-action-delete"
        aria-label="구조물 삭제"
        title="보유 목록으로 회수 · Delete"
        onClick={() => send({ type: 'retrieve-structure', id: structure.id })}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6" />
        </svg>
      </button>
    </div>
  );
}

export function SimulationScreen({
  scenarioId,
  onBack,
  onMissionComplete,
}: SimulationScreenProps) {
  const { snapshot, motionSource, send, requestSave, loadSave } = useSimulation(scenarioId);
  const scenario = SCENARIOS[scenarioId];
  const [activeTool, setActiveTool] = useState<InteractionTool>('select');
  const [inventoryCategory, setInventoryCategory] = useState<InventoryCategory>('structures');
  const [catalogSpecies, setCatalogSpecies] = useState<SpeciesId | null>(null);
  const [catalogAnimal, setCatalogAnimal] = useState<AnimalSpeciesId | null>(null);
  const [pendingInventory, setPendingInventory] = useState<PendingInventoryItem | null>(null);
  const [waterQualityLayers, setWaterQualityLayers] = useState<WaterQualityLayer[]>(['organicMatter']);
  const [waterQualityMapVisible, setWaterQualityMapVisible] = useState(false);
  const [waterQualityLegendCollapsed, setWaterQualityLegendCollapsed] = useState(false);
  const waterQualityLayer = waterQualityLayers[0] ?? null;
  const [showMissionBriefing, setShowMissionBriefing] = useState(scenario.mode === 'challenge');
  const [openHudPanels, setOpenHudPanels] = useState<Record<HudPanelId, boolean>>(closedHudPanels);
  const [observationView, setObservationView] = useState<ObservationView>('overview');
  const [openObservationSections, setOpenObservationSections] = useState<ObservationSection[]>(['ecology']);
  const [detachedObservationSections, setDetachedObservationSections] = useState<ObservationSection[]>([]);
  const [detachedPanelLayouts, setDetachedPanelLayouts] = useState<Partial<Record<ObservationSection, DetachedPanelLayout>>>({});
  const [activeDetachedSection, setActiveDetachedSection] = useState<ObservationSection | null>(null);
  const [detachedPanelInteraction, setDetachedPanelInteraction] = useState<'move' | 'resize' | null>(null);
  const [rightPanelHeight, setRightPanelHeight] = useState<number | null>(null);
  const [rightPanelResizing, setRightPanelResizing] = useState(false);
  const [saveVaultOpen, setSaveVaultOpen] = useState(false);
  const [frozenAquariums, setFrozenAquariums] = useState<FrozenAquariumRecord[]>(readFrozenAquariums);
  const [saveName, setSaveName] = useState('');
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [showGoalGuide, setShowGoalGuide] = useState(false);
  const [cameraTransform, setCameraTransform] = useState<AquariumCameraTransform | null>(null);
  const [cameraResetToken, setCameraResetToken] = useState(0);
  const [pointer, setPointer] = useState({ x: 0, y: 0 });
  const completionReported = useRef(false);
  const resumeAfterBriefing = useRef(false);
  const pendingInventoryRef = useRef<PendingInventoryItem | null>(null);
  const pendingInventoryRequestIdRef = useRef(0);
  const biofilmOverlayRestoreRef = useRef<WaterQualityViewState | null>(null);
  const biofilmPlacementWasActiveRef = useRef(false);
  const lastEcologySampleAt = useRef(Number.NEGATIVE_INFINITY);
  const lastObservationSelectionKey = useRef<string | null>(null);
  const tankWorkspaceRef = useRef<HTMLElement | null>(null);
  const floatingInfoStackRef = useRef<HTMLElement | null>(null);
  const detachedPanelInteractionRef = useRef<DetachedPanelInteractionState | null>(null);
  const rightPanelResizeRef = useRef<RightPanelResizeState | null>(null);
  const [ecologyHistory, setEcologyHistory] = useState<EcologyHistoryPoint[]>([]);
  const [ecologyHistoryWindowSeconds, setEcologyHistoryWindowSeconds] = useState(
    ECOLOGY_HISTORY_WINDOW_SECONDS,
  );
  pendingInventoryRef.current = pendingInventory;

  const observationSelectionKey = snapshot?.selection
    ? JSON.stringify(snapshot.selection)
    : catalogSpecies
      ? `species:${catalogSpecies}`
      : catalogAnimal
        ? `animal:${catalogAnimal}`
        : null;

  const beginBiofilmOverlay = useCallback((guildId: MicrobeGuildId): void => {
    if (!biofilmOverlayRestoreRef.current) {
      biofilmOverlayRestoreRef.current = {
        layers: [...waterQualityLayers],
        visible: waterQualityMapVisible,
        legendCollapsed: waterQualityLegendCollapsed,
      };
    }
    setWaterQualityLayers(biofilmPlacementLayers(guildId));
    setWaterQualityMapVisible(true);
    setWaterQualityLegendCollapsed(false);
  }, [waterQualityLayers, waterQualityMapVisible, waterQualityLegendCollapsed]);

  const restoreBiofilmOverlay = useCallback((): void => {
    const previous = biofilmOverlayRestoreRef.current;
    if (!previous) return;
    biofilmOverlayRestoreRef.current = null;
    setWaterQualityLayers(previous.layers);
    setWaterQualityMapVisible(previous.visible);
    setWaterQualityLegendCollapsed(previous.legendCollapsed);
  }, []);

  const toggleWaterQualityLayer = useCallback((layer: WaterQualityLayer): void => {
    setWaterQualityMapVisible(true);
    setWaterQualityLayers((current) => current.includes(layer)
      ? current.filter((item) => item !== layer)
      : [...current, layer]);
  }, []);

  useEffect(() => {
    completionReported.current = false;
    biofilmOverlayRestoreRef.current = null;
    biofilmPlacementWasActiveRef.current = false;
    setActiveTool('select');
    setInventoryCategory('structures');
    setCatalogSpecies(null);
    setCatalogAnimal(null);
    setPendingInventory(null);
    setWaterQualityLayers(['organicMatter']);
    setWaterQualityMapVisible(false);
    setWaterQualityLegendCollapsed(false);
    setOpenHudPanels(closedHudPanels());
    setObservationView('overview');
    setOpenObservationSections(['ecology']);
    setDetachedObservationSections([]);
    setDetachedPanelLayouts({});
    setActiveDetachedSection(null);
    setDetachedPanelInteraction(null);
    setRightPanelHeight(null);
    setRightPanelResizing(false);
    rightPanelResizeRef.current = null;
    setSaveVaultOpen(false);
    setFrozenAquariums(readFrozenAquariums());
    setSaveName('');
    setSaveBusy(false);
    setSaveNotice(null);
    setShowGoalGuide(false);
    setCameraTransform(null);
    setCameraResetToken((current) => current + 1);
    resumeAfterBriefing.current = false;
    setShowMissionBriefing(SCENARIOS[scenarioId].mode === 'challenge');
    lastEcologySampleAt.current = Number.NEGATIVE_INFINITY;
    setEcologyHistory([]);
    setEcologyHistoryWindowSeconds(ECOLOGY_HISTORY_WINDOW_SECONDS);
  }, [scenarioId]);

  useEffect(() => {
    const workspace = tankWorkspaceRef.current;
    if (!workspace) return undefined;
    const resizeObserver = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setDetachedPanelLayouts((current) => {
        let changed = false;
        const next = { ...current };
        for (const section of OBSERVATION_SECTION_ORDER) {
          const layout = current[section];
          if (!layout) continue;
          const clamped = clampDetachedPanelLayout(layout, width, height);
          if (!detachedPanelLayoutsMatch(layout, clamped)) {
            next[section] = clamped;
            changed = true;
          }
        }
        return changed ? next : current;
      });
    });
    resizeObserver.observe(workspace);
    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    if (!observationSelectionKey) {
      lastObservationSelectionKey.current = null;
      setObservationView('overview');
      return;
    }
    if (lastObservationSelectionKey.current !== observationSelectionKey) {
      lastObservationSelectionKey.current = observationSelectionKey;
      setObservationView('selection');
    }
  }, [observationSelectionKey]);

  useEffect(() => {
    if (!snapshot) return;
    const elapsedSeconds = snapshot.elapsedSeconds;
    const point: EcologyHistoryPoint = {
      elapsedSeconds,
      algaeBiomass: snapshot.totalBiomass.oedogonium + snapshot.totalBiomass.nitzschia +
        snapshot.totalBiomass.vallisneria,
      plantBiomass: snapshot.totalBiomass.vallisneria,
      lightMultiplier: snapshot.dayNight?.lightMultiplier ?? 1,
      grossPhotosynthesis: snapshot.biogeochemistry.algaeFluxes.grossProductionBiomassPerSecond,
      producerRespiration: snapshot.biogeochemistry.algaeFluxes.respirationBiomassPerSecond,
      shrimpCount: snapshot.animalPopulation['cherry-shrimp'].total,
      shrimpAdultFemales: snapshot.animalPopulation['cherry-shrimp'].adultFemales,
      shrimpAdultMales: snapshot.animalPopulation['cherry-shrimp'].adultMales,
      shrimpJuveniles: snapshot.animalPopulation['cherry-shrimp'].juveniles,
      cumulativeBirths: snapshot.animalPopulationEventTotals.births,
      cumulativeDeaths: snapshot.animalPopulationEventTotals.deaths,
      organicMatter: snapshot.biogeochemistry.average.organicMatter,
      toxicWaste: snapshot.biogeochemistry.average.toxicWaste,
      nutrients: snapshot.biogeochemistry.average.nutrients,
      oxygen: snapshot.biogeochemistry.average.oxygen,
      decomposer: snapshot.biogeochemistry.biofilmTotals.decomposer,
      nitrifier: snapshot.biogeochemistry.biofilmTotals.nitrifier,
      dissolvedInorganicCarbon:
        snapshot.biogeochemistry.carbonCycle.dissolvedInorganicCarbon,
      headspaceCarbonDioxide:
        snapshot.biogeochemistry.carbonCycle.headspaceCarbonDioxide,
      headspaceOxygen: snapshot.biogeochemistry.carbonCycle.headspaceOxygen,
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
    setEcologyHistory((current) => appendRollingHistory(current, point));
  }, [
    snapshot?.elapsedSeconds,
    snapshot?.totalBiomass.oedogonium,
    snapshot?.totalBiomass.nitzschia,
    snapshot?.totalBiomass.vallisneria,
    snapshot?.dayNight?.lightMultiplier,
    snapshot?.biogeochemistry.algaeFluxes.grossProductionBiomassPerSecond,
    snapshot?.biogeochemistry.algaeFluxes.respirationBiomassPerSecond,
    snapshot?.animalPopulation['cherry-shrimp'].total,
    snapshot?.animalPopulation['cherry-shrimp'].adultFemales,
    snapshot?.animalPopulation['cherry-shrimp'].adultMales,
    snapshot?.animalPopulation['cherry-shrimp'].juveniles,
    snapshot?.animalPopulationEventTotals.births,
    snapshot?.animalPopulationEventTotals.deaths,
    snapshot?.biogeochemistry.average.organicMatter,
    snapshot?.biogeochemistry.average.toxicWaste,
    snapshot?.biogeochemistry.average.nutrients,
    snapshot?.biogeochemistry.average.oxygen,
    snapshot?.biogeochemistry.biofilmTotals.decomposer,
    snapshot?.biogeochemistry.biofilmTotals.nitrifier,
    snapshot?.biogeochemistry.carbonCycle.dissolvedInorganicCarbon,
    snapshot?.biogeochemistry.carbonCycle.headspaceCarbonDioxide,
    snapshot?.biogeochemistry.carbonCycle.headspaceOxygen,
  ]);

  useEffect(() => {
    if (snapshot?.outcome !== 'success' || completionReported.current) return;
    completionReported.current = true;
    onMissionComplete(scenarioId);
  }, [onMissionComplete, scenarioId, snapshot?.outcome]);

  useEffect(() => {
    const move = (event: PointerEvent): void => setPointer({ x: event.clientX, y: event.clientY });
    window.addEventListener('pointermove', move);
    return () => window.removeEventListener('pointermove', move);
  }, []);

  useEffect(() => {
    if (!pendingInventory) return;
    const cancel = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      setPendingInventory(null);
      setActiveTool('select');
    };
    window.addEventListener('keydown', cancel);
    return () => window.removeEventListener('keydown', cancel);
  }, [pendingInventory]);

  const biofilmPlacementActive = pendingInventory?.kind === 'biofilm' ||
    snapshot?.holding?.kind === 'biofilm';
  useEffect(() => {
    if (biofilmPlacementActive) {
      biofilmPlacementWasActiveRef.current = true;
      return;
    }
    if (!biofilmPlacementWasActiveRef.current) return;
    biofilmPlacementWasActiveRef.current = false;
    restoreBiofilmOverlay();
  }, [biofilmPlacementActive, restoreBiofilmOverlay]);

  const returnToSelection = useCallback((): void => {
    setActiveTool('select');
    send({ type: 'clear-probe' });
  }, [send]);
  const completeCanvasInteraction = useCallback((completedTool: InteractionTool): void => {
    // Move is a persistent mode: after placing, cancelling, or retrieving one
    // object the next click must be able to pick another object immediately.
    // One-shot probes still return to ordinary selection after installation.
    setActiveTool(completedTool === 'move' ? 'move' : 'select');
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
    } else if (pending.kind === 'biofilm' && pending.microbeGuildId) {
      send({ type: 'pick-biofilm', guildId: pending.microbeGuildId, point });
    }
    setActiveTool('move');
  }, [send]);
  const finishPendingInventoryHandoff = useCallback((): void => {
    setPendingInventory(null);
  }, []);
  const rememberInventoryActivationPoint = (
    event: ReactMouseEvent<HTMLButtonElement>,
  ): void => {
    if (event.clientX !== 0 || event.clientY !== 0) {
      setPointer({ x: event.clientX, y: event.clientY });
      return;
    }
    // Keyboard activation and some macOS accessibility-generated clicks report
    // (0, 0). Put the preview beside the activated card instead of outside the
    // window until the first real pointer movement arrives.
    const rect = event.currentTarget.getBoundingClientRect();
    setPointer({ x: rect.right, y: rect.top + rect.height / 2 });
  };

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
  const biofilmEditable = snapshot.phase === 'setup' ||
    (snapshot.phase === 'paused' && (Boolean(scenario.waterCycle) || snapshot.mode === 'laboratory'));
  const canvasEditable = editable || (biofilmEditable && (
    pendingInventory?.kind === 'biofilm' || snapshot.holding?.kind === 'biofilm'
  ));
  const progress = snapshot.missionProgress;
  const scoredZoneTarget = scenario.target?.type === 'habitat-coverage' ? scenario.target : null;
  const goalGuideCopy = scoredZoneTarget
    ? '구조물 앞면을 작은 관찰 구역으로 나눕니다. 규조류가 적합한 빛에서 일정 밀도 이상 자란 구역만 전체 면적에 포함됩니다.'
    : null;
  const selectedCells = snapshot.selection?.kind === 'colony' && snapshot.selection.cellId
    ? snapshot.cells.filter((cell) => cell.id === snapshot.selection?.cellId)
    : snapshot.selection?.kind === 'region' && snapshot.selection.cellIds
      ? snapshot.cells.filter((cell) => snapshot.selection?.cellIds?.includes(cell.id))
      : [];
  const selectedBiomass = selectedCells.length
    ? selectedCells.reduce((total, cell) => ({
      oedogonium: total.oedogonium + cell.biomass.oedogonium,
      nitzschia: total.nitzschia + cell.biomass.nitzschia,
      vallisneria: total.vallisneria + cell.biomass.vallisneria,
    }), { oedogonium: 0, nitzschia: 0, vallisneria: 0 })
    : undefined;
  const selectedAverageLight = selectedCells.length
    ? selectedCells.reduce((total, cell) => total + cell.light, 0) / selectedCells.length
    : undefined;
  const selectedPlants = selectedCells.length
    ? snapshot.plants.filter((plant) => snapshot.selection?.plantId
      ? plant.id === snapshot.selection.plantId
      : selectedCells.some((cell) => cell.id === plant.cellId))
    : [];
  const selectionSpeciesIds = snapshot.selection?.kind === 'colony' || snapshot.selection?.kind === 'region'
    ? SPECIES_IDS.filter((speciesId) => selectedCells.some((cell) =>
      cell.biomass[speciesId] > ALGAE_VISIBLE_BIOMASS,
    ))
    : [];
  const selectionFilter: SelectionFilter = 'all';
  const selectedAnimal = snapshot.selection?.kind === 'animal' && snapshot.selection.animalId
    ? snapshot.animals.find((animal) => animal.id === snapshot.selection?.animalId)
    : undefined;
  const selectedCarcass = snapshot.selection?.kind === 'carcass' && snapshot.selection.carcassId
    ? snapshot.carcasses.find((carcass) => carcass.id === snapshot.selection?.carcassId)
    : undefined;
  const selectedRegionAnimals = snapshot.selection?.kind === 'region' && snapshot.selection.animalIds
    ? snapshot.animals.filter((animal) => snapshot.selection?.animalIds?.includes(animal.id))
    : [];
  const selectedRegionStructures = snapshot.selection?.kind === 'region' && snapshot.selection.structureIds
    ? snapshot.structures.filter((structure) => snapshot.selection?.structureIds?.includes(structure.id))
    : [];
  const selectedRegionMeasurements = snapshot.selection?.kind === 'region' && snapshot.selection.measurementIds
    ? snapshot.measurements.filter((measurement) => snapshot.selection?.measurementIds?.includes(measurement.id))
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
      : snapshot.selection?.speciesId &&
          selectionSpeciesIds.includes(snapshot.selection.speciesId)
        ? snapshot.selection.speciesId
        : selectionSpeciesIds[0]
    : catalogSpecies;
  const inspectedAnimalSpecies = selectedAnimal?.speciesId ?? selectedCarcass?.speciesId ??
    (selectedRegionAnimals.length ? selectedRegionAnimals[0].speciesId : catalogAnimal);
  const hasObservationSelection = Boolean(snapshot.selection || catalogSpecies || catalogAnimal);
  const observationSelectionLabel = snapshot.selection?.ownerLabel ??
    (catalogSpecies ? SPECIES[catalogSpecies].shortName : null) ??
    (catalogAnimal ? ANIMALS[catalogAnimal].displayName : null) ??
    '선택 대상';
  const showProbePanel = Boolean(snapshot.probe) ||
    activeTool === 'light-probe' ||
    activeTool === 'temperature-probe' ||
    activeTool === 'water-quality-probe';
  const observationSections: ObservationSectionDefinition[] = [
    {
      id: 'ecology',
      title: '생물·생산자',
      summary: `생산자 ${(snapshot.totalBiomass.oedogonium + snapshot.totalBiomass.nitzschia + snapshot.totalBiomass.vallisneria).toFixed(1)} · 새우 ${snapshot.animalPopulation['cherry-shrimp'].total}마리`,
    },
    ...(scenario.waterCycle ? [
      {
        id: 'water' as const,
        title: '수질·미생물',
        summary: `수온 ${snapshot.biogeochemistry.transport.averageTemperature.toFixed(1)}°C · 산소 ${snapshot.biogeochemistry.average.oxygen.toFixed(1)}`,
      },
      {
        id: 'ledger' as const,
        title: '기체·물질 장부',
        summary: '질소·탄소 보존 확인',
      },
    ] : []),
    {
      id: 'history',
      title: '변화 기록',
      summary: '그래프·출생·사망 원인',
    },
  ];
  const selectedProbeTrend = inspectedSpecies
    ? (snapshot.probe ?? selectedMeasurement)?.trends[inspectedSpecies]
    : undefined;
  const heldStructure = snapshot.holding?.kind === 'structure'
    ? snapshot.structures.find((structure) => structure.id === snapshot.holding?.structureId)
    : undefined;
  const editableSelectedStructure = activeTool === 'move' && editable && !snapshot.holding
    ? selectedStructure
    : undefined;
  const observationDockVisible = openHudPanels.observation && !(
    observationView === 'overview' &&
    observationSections.length > 0 &&
    detachedObservationSections.length === observationSections.length
  );
  const rightPanelVisible = (openHudPanels.quest || observationDockVisible) &&
    !snapshot.holding && !pendingInventory;
  const cameraFitView = !cameraTransform || cameraTransform.zoom < 0.999;
  const inventoryPanelVisible = openHudPanels.inventory && !snapshot.holding && !pendingInventory;
  const biologicalPlacementMarker = snapshot.holding &&
    (snapshot.holding.kind === 'seed' || snapshot.holding.kind === 'biofilm') &&
    cameraTransform
    ? {
      kind: snapshot.holding.kind,
      valid: snapshot.holding.valid,
      style: {
        left: `${cameraTransform.offsetX + snapshot.holding.x * cameraTransform.scale}px`,
        top: `${cameraTransform.offsetY + snapshot.holding.y * cameraTransform.scale}px`,
        '--placement-color': `#${(
          snapshot.holding.kind === 'seed'
            ? SPECIES[snapshot.holding.speciesId!].color
            : MICROBES[snapshot.holding.microbeGuildId!].color
        ).toString(16).padStart(6, '0')}`,
      } as CSSProperties,
    }
    : null;

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
  const pausedEditBlocked = snapshot.phase === 'paused' &&
    (snapshot.mode === 'laboratory' || Boolean(scenario.waterCycle)) &&
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
    if (!editable && inventoryCategory === 'organisms' && biofilmEditable) {
      return '일시정지 중에는 균 필름을 표면에 접종할 수 있습니다';
    }
    if (!editable && inventoryCategory !== 'instruments') {
      return snapshot.phase === 'running'
        ? '관찰 중에는 배치가 잠겨 있습니다'
        : '도전 중에는 배치를 수정할 수 없습니다';
    }
    if (inventoryCategory === 'structures') return '구조물을 꺼내 수조에 놓으세요';
    if (inventoryCategory === 'organisms') return '조류나 균을 접종하고 동물을 수중에 놓으세요';
    return snapshot.phase === 'running'
      ? '관찰 중에도 측정점을 설치할 수 있습니다'
      : '도구를 골라 수조 값을 측정하세요';
  })();
  const scenarioFrozenAquariums = frozenAquariums.filter((record) => record.scenarioId === scenarioId);

  const toggleObservationSection = (section: ObservationSection): void => {
    setOpenObservationSections((current) => current.includes(section)
      ? current.filter((item) => item !== section)
      : [...current, section]);
  };

  const changeEcologyHistoryWindow = (direction: -1 | 1): void => {
    setEcologyHistoryWindowSeconds((current) => {
      const currentIndex = ECOLOGY_HISTORY_WINDOW_OPTIONS_SECONDS.indexOf(
        current as (typeof ECOLOGY_HISTORY_WINDOW_OPTIONS_SECONDS)[number],
      );
      const nextIndex = Math.max(
        0,
        Math.min(
          ECOLOGY_HISTORY_WINDOW_OPTIONS_SECONDS.length - 1,
          (currentIndex < 0 ? 2 : currentIndex) + direction,
        ),
      );
      return ECOLOGY_HISTORY_WINDOW_OPTIONS_SECONDS[nextIndex];
    });
  };

  const detachObservationSection = (section: ObservationSection): void => {
    const workspace = tankWorkspaceRef.current;
    if (workspace) {
      const rect = workspace.getBoundingClientRect();
      setDetachedPanelLayouts((current) => current[section]
        ? current
        : {
          ...current,
          [section]: createDetachedPanelLayout(section, rect.width, rect.height),
        });
    }
    setDetachedObservationSections((current) => current.includes(section)
      ? current
      : [...current, section]);
    setActiveDetachedSection(section);
  };

  const attachObservationSection = (section: ObservationSection): void => {
    setDetachedObservationSections((current) => current.filter((item) => item !== section));
    setOpenObservationSections((current) => current.includes(section)
      ? current
      : [...current, section]);
    setActiveDetachedSection((current) => current === section ? null : current);
  };

  const beginDetachedPanelDrag = (
    event: ReactPointerEvent<HTMLElement>,
    section: ObservationSection,
  ): void => {
    if ((event.target as HTMLElement).closest('button')) return;
    const workspace = tankWorkspaceRef.current;
    if (!workspace) return;
    const workspaceRect = workspace.getBoundingClientRect();
    const startLayout = detachedPanelLayouts[section] ?? createDetachedPanelLayout(
      section,
      workspaceRect.width,
      workspaceRect.height,
    );
    detachedPanelInteractionRef.current = {
      section,
      mode: 'move',
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startLayout,
      workspaceWidth: workspaceRect.width,
      workspaceHeight: workspaceRect.height,
    };
    setDetachedPanelLayouts((current) => current[section] ? current : { ...current, [section]: startLayout });
    setActiveDetachedSection(section);
    setDetachedPanelInteraction('move');
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const beginDetachedPanelResize = (
    event: ReactPointerEvent<HTMLButtonElement>,
    section: ObservationSection,
  ): void => {
    const workspace = tankWorkspaceRef.current;
    if (!workspace) return;
    const workspaceRect = workspace.getBoundingClientRect();
    const startLayout = detachedPanelLayouts[section] ?? createDetachedPanelLayout(
      section,
      workspaceRect.width,
      workspaceRect.height,
    );
    detachedPanelInteractionRef.current = {
      section,
      mode: 'resize',
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startLayout,
      workspaceWidth: workspaceRect.width,
      workspaceHeight: workspaceRect.height,
    };
    setDetachedPanelLayouts((current) => current[section] ? current : { ...current, [section]: startLayout });
    setActiveDetachedSection(section);
    setDetachedPanelInteraction('resize');
    event.currentTarget.setPointerCapture(event.pointerId);
    event.stopPropagation();
    event.preventDefault();
  };

  const updateDetachedPanelInteraction = (event: ReactPointerEvent<HTMLElement>): void => {
    const interaction = detachedPanelInteractionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - interaction.startClientX;
    const deltaY = event.clientY - interaction.startClientY;
    const nextLayout = interaction.mode === 'move'
      ? {
        ...interaction.startLayout,
        x: interaction.startLayout.x + deltaX,
        y: interaction.startLayout.y + deltaY,
      }
      : {
        ...interaction.startLayout,
        width: interaction.startLayout.width + deltaX,
        height: interaction.startLayout.height + deltaY,
      };
    setDetachedPanelLayouts((current) => ({
      ...current,
      [interaction.section]: clampDetachedPanelLayout(
        nextLayout,
        interaction.workspaceWidth,
        interaction.workspaceHeight,
      ),
    }));
  };

  const endDetachedPanelInteraction = (event: ReactPointerEvent<HTMLElement>): void => {
    const interaction = detachedPanelInteractionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    detachedPanelInteractionRef.current = null;
    setDetachedPanelInteraction(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const beginRightPanelResize = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const panel = floatingInfoStackRef.current;
    const workspace = tankWorkspaceRef.current;
    if (!panel || !workspace) return;
    const panelRect = panel.getBoundingClientRect();
    const workspaceRect = workspace.getBoundingClientRect();
    rightPanelResizeRef.current = {
      pointerId: event.pointerId,
      startClientY: event.clientY,
      startHeight: panelRect.height,
      maximumHeight: Math.max(RIGHT_PANEL_MIN_HEIGHT, workspaceRect.bottom - panelRect.top - DETACHED_PANEL_EDGE),
    };
    setRightPanelResizing(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.stopPropagation();
    event.preventDefault();
  };

  const updateRightPanelResize = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const interaction = rightPanelResizeRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    setRightPanelHeight(Math.max(
      RIGHT_PANEL_MIN_HEIGHT,
      Math.min(interaction.maximumHeight, interaction.startHeight + event.clientY - interaction.startClientY),
    ));
  };

  const endRightPanelResize = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const interaction = rightPanelResizeRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    rightPanelResizeRef.current = null;
    setRightPanelResizing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const toggleWaterQualityMap = (): void => {
    if (waterQualityMapVisible) {
      setWaterQualityMapVisible(false);
      setWaterQualityLegendCollapsed(false);
      return;
    }
    setWaterQualityLegendCollapsed(false);
    setWaterQualityMapVisible(true);
  };

  const showCatalogSpecies = (speciesId: SpeciesId): void => {
    send({ type: 'clear-selection' });
    setCatalogAnimal(null);
    setCatalogSpecies(speciesId);
    setObservationView('selection');
    setOpenHudPanels((current) => ({ ...current, observation: true }));
  };

  const showCatalogAnimal = (speciesId: AnimalSpeciesId): void => {
    send({ type: 'clear-selection' });
    setCatalogSpecies(null);
    setCatalogAnimal(speciesId);
    setObservationView('selection');
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

  const toggleMeasurementTool = (
    tool: 'light-probe' | 'temperature-probe' | 'water-quality-probe',
  ): void => {
    setPendingInventory(null);
    setCatalogSpecies(null);
    setCatalogAnimal(null);
    if (activeTool === tool) {
      setActiveTool('select');
      send({ type: 'clear-probe' });
    } else {
      setActiveTool(tool);
      if (tool === 'water-quality-probe') {
        setWaterQualityMapVisible(true);
      }
      send({ type: 'clear-selection' });
      if (tool === 'water-quality-probe') {
        setOpenHudPanels((current) => ({
          ...current,
          inventory: false,
          observation: true,
        }));
      }
    }
  };

  const closeObservationMode = (): void => {
    setOpenHudPanels((current) => ({ ...current, observation: false }));
    setWaterQualityMapVisible(false);
    setWaterQualityLegendCollapsed(false);
    if (activeTool === 'water-quality-probe') {
      setActiveTool('select');
      send({ type: 'clear-probe' });
    }
  };

  const toggleObservationMode = (): void => {
    if (openHudPanels.observation) {
      closeObservationMode();
      return;
    }
    setOpenHudPanels((current) => ({ ...current, inventory: false, observation: true }));
    setObservationView(observationSelectionKey ? 'selection' : 'overview');
    if (!scenario.waterCycle) return;
    // Opening the observation record must not override the player's explicit
    // colour-map choice. It only leaves the pointer in ordinary selection mode.
    setActiveTool('select');
    send({ type: 'clear-probe' });
  };

  const resetUiState = (): void => {
    biofilmOverlayRestoreRef.current = null;
    biofilmPlacementWasActiveRef.current = false;
    setActiveTool('select');
    setInventoryCategory('structures');
    setCatalogSpecies(null);
    setCatalogAnimal(null);
    setPendingInventory(null);
    setWaterQualityLayers(['organicMatter']);
    setWaterQualityMapVisible(false);
    setWaterQualityLegendCollapsed(false);
    setObservationView('overview');
    setOpenObservationSections(['ecology']);
    setDetachedObservationSections([]);
    setDetachedPanelLayouts({});
    setActiveDetachedSection(null);
    setDetachedPanelInteraction(null);
    setRightPanelHeight(null);
    setRightPanelResizing(false);
    detachedPanelInteractionRef.current = null;
    rightPanelResizeRef.current = null;
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

  const freezeCurrentAquarium = async (): Promise<void> => {
    if (saveBusy || snapshot.holding || pendingInventory) return;
    setSaveBusy(true);
    setSaveNotice(null);
    try {
      const data = await requestSave();
      const defaultName = `${scenario.title} · 냉동 수조 ${scenarioFrozenAquariums.length + 1}`;
      const next = freezeAquarium(saveName.trim() || defaultName, data);
      setFrozenAquariums(next);
      setSaveName('');
      setSaveNotice('현재 순간을 냉동 수조로 보관했습니다.');
    } catch (error) {
      setSaveNotice(error instanceof Error ? error.message : '수조를 보관하지 못했습니다.');
    } finally {
      setSaveBusy(false);
    }
  };

  const thawAquarium = (record: FrozenAquariumRecord): void => {
    if (record.scenarioId !== scenarioId || snapshot.holding || pendingInventory) return;
    resetUiState();
    completionReported.current = false;
    resumeAfterBriefing.current = false;
    setEcologyHistory([]);
    setShowMissionBriefing(false);
    setCameraResetToken((current) => current + 1);
    setOpenHudPanels(closedHudPanels());
    loadSave(record.data);
  };

  const discardAquarium = (id: string): void => {
    setFrozenAquariums(discardFrozenAquarium(id));
    setSaveNotice('냉동 수조를 보관함에서 버렸습니다.');
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
          className="inventory-cursor-ghost"
          style={{ left: pointer.x, top: pointer.y }}
          aria-hidden="true"
        >
          {pendingInventory.assetPath
            ? <img src={pendingInventory.assetPath} alt="" />
            : pendingInventory.kind === 'animal'
              ? <span className="ghost-shrimp" />
              : pendingInventory.kind === 'biofilm'
                ? <span className={`ghost-biofilm biofilm-${pendingInventory.microbeGuildId}`}><i /><i /><i /></span>
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

      <main ref={tankWorkspaceRef} className={`simulation-screen v2-screen tank-first-screen ${rightPanelVisible ? 'has-right-panel' : ''} ${inventoryPanelVisible ? 'has-inventory-panel' : ''} ${snapshot.holding ? 'has-placement-toolbar' : ''} ${cameraFitView ? 'camera-fit-view' : ''}`}>
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
              aria-expanded={inventoryPanelVisible}
              aria-controls="floating-inventory-panel"
              title="보유 목록"
              onClick={() => toggleHudPanel('inventory')}
            ><HudIcon kind="inventory" /></button>
            <div className="hud-mode-switcher" aria-label="수조 조작 모드">
              <button
                type="button"
                className={activeTool === 'select' ? 'active' : ''}
                disabled={Boolean(snapshot.holding) || Boolean(pendingInventory)}
                onClick={() => {
                  setPendingInventory(null);
                  setActiveTool('select');
                  send({ type: 'clear-probe' });
                }}
              >관찰</button>
              <button
                type="button"
                className={activeTool === 'move' ? 'active' : ''}
                disabled={!editable || Boolean(snapshot.holding) || Boolean(pendingInventory)}
                onClick={() => {
                  setActiveTool('move');
                  send({ type: 'clear-probe' });
                }}
              >편집</button>
            </div>
          </div>

          <div className="game-title tank-hud-title">
            <p>{snapshot.mode === 'challenge' ? '도전 과제' : '자유 연구'}</p>
            <h1>{scenario.title}</h1>
          </div>

          <div className="header-readouts tank-hud-readouts">
            {snapshot.dayNight && (
              <div
                className={`day-night-readout phase-${snapshot.dayNight.phase}`}
                title={`자연광 ${snapshot.dayNight.effectiveNaturalLightOutput.toFixed(0)} / ${snapshot.naturalLightOutput.toFixed(0)} · 전등 ${snapshot.lightOutput.toFixed(0)} · 합계 ${snapshot.dayNight.effectiveLightOutput.toFixed(0)}`}
              >
                <span aria-hidden="true">{snapshot.dayNight.phase === 'night' ? '☾' : '☀'}</span>
                <strong>{dayNightPhaseLabel[snapshot.dayNight.phase]}</strong>
                <small>{Math.round(snapshot.dayNight.lightMultiplier * 100)}%</small>
              </div>
            )}
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
                    : progress.unit === 'adult-count' || progress.unit === 'population-count'
                      ? Math.round(progress.current)
                      : Math.min(99, Math.round(progress.ratio * 100))}
                </i>
              )}
            </button>
            <button
              type="button"
              className={`hud-tool-button ${openHudPanels.observation ? 'active' : ''}`}
              aria-label={scenario.waterCycle ? '관찰 지도' : '관찰 기록'}
              aria-expanded={openHudPanels.observation}
              aria-controls="floating-observation-panel"
              title={scenario.waterCycle ? '관찰 지도' : '관찰 기록'}
              onClick={toggleObservationMode}
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
                <button type="button" className="floating-note-close" aria-label="메뉴 닫기" onClick={() => closeHudPanel('menu')}><CloseGlyph /></button>
              </div>
              <div className="floating-menu-summary">
                <strong>{scenario.title}</strong>
                <span>{phaseName(snapshot)} · {formatTime(snapshot.elapsedSeconds)}</span>
              </div>
              <button
                type="button"
                className={`save-vault-toggle ${saveVaultOpen ? 'active' : ''}`}
                aria-expanded={saveVaultOpen}
                onClick={() => {
                  setSaveVaultOpen((current) => !current);
                  setSaveNotice(null);
                }}
              >수조 보관함 <span>{scenarioFrozenAquariums.length}</span></button>
              {saveVaultOpen && (
                <section className="save-vault" aria-label="수조 보관함">
                  <div className="save-vault-heading">
                    <div><strong>냉동 수조</strong><small>현재 순간을 멈춘 채 보관하고 나중에 해동합니다.</small></div>
                  </div>
                  <div className="save-vault-create">
                    <input
                      type="text"
                      value={saveName}
                      maxLength={28}
                      placeholder={`${scenario.title} · 냉동 수조 ${scenarioFrozenAquariums.length + 1}`}
                      aria-label="냉동 수조 이름"
                      onChange={(event) => setSaveName(event.target.value)}
                    />
                    <button
                      type="button"
                      disabled={saveBusy || Boolean(snapshot.holding) || Boolean(pendingInventory)}
                      onClick={() => void freezeCurrentAquarium()}
                    >{saveBusy ? '냉동 중…' : '현재 수조 냉동'}</button>
                  </div>
                  {(snapshot.holding || pendingInventory) && <small className="save-vault-warning">들고 있는 항목을 놓거나 취소한 뒤 보관할 수 있습니다.</small>}
                  {saveNotice && <p className="save-vault-notice" role="status">{saveNotice}</p>}
                  <div className="save-vault-list">
                    {scenarioFrozenAquariums.length === 0 ? (
                      <p className="save-vault-empty">이 실험에서 보관한 수조가 없습니다.</p>
                    ) : scenarioFrozenAquariums.map((record) => (
                      <article className="frozen-aquarium-card" key={record.id}>
                        <div>
                          <strong>{record.name}</strong>
                          <small>{formatTime(record.elapsedSeconds)} · {new Date(record.createdAt).toLocaleString('ko-KR', {
                            month: 'numeric',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}</small>
                        </div>
                        <div className="frozen-aquarium-actions">
                          <button type="button" onClick={() => thawAquarium(record)}>해동</button>
                          <button type="button" className="discard" onClick={() => discardAquarium(record.id)}>버리기</button>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              )}
              <button type="button" onClick={() => {
                closeHudPanel('menu');
                openMissionBriefing();
              }}>{snapshot.mode === 'laboratory' ? '실험실 안내' : '미션 설명'}</button>
              <button type="button" onClick={resetSimulation}>{snapshot.mode === 'laboratory' ? '실험 초기화' : '다시 도전'}</button>
              <button type="button" className="menu-back-button" onClick={onBack}>미션 목록으로</button>
            </section>
          )}

          {inventoryPanelVisible && (
          <aside id="floating-inventory-panel" className="inventory-panel paper-panel floating-note floating-inventory-panel" aria-label="보유 목록">
            <div className="inventory-heading">
              <div>
                <span className="panel-label">보유 목록</span>
                <strong>{inventoryHint}</strong>
              </div>
              <button type="button" className="floating-note-close" aria-label="보유 목록 닫기" onClick={() => closeHudPanel('inventory')}><CloseGlyph /></button>
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
                  return (
                    <article className="inventory-card structure-card" key={definitionId}>
                      <button
                        type="button"
                        className="inventory-card-main"
                        disabled={!editable || Boolean(snapshot.holding) || Boolean(pendingInventory) || remaining === 0}
                        onClick={(event) => {
                          setCatalogSpecies(null);
                          rememberInventoryActivationPoint(event);
                          setPendingInventory({
                            requestId: ++pendingInventoryRequestIdRef.current,
                            kind: 'structure',
                            label: definition.label,
                            assetPath: definition.assetPath,
                            definitionId,
                          });
                          setActiveTool('move');
                        }}
                      >
                        <span className="inventory-thumb rock-thumb"><img src={definition.assetPath} alt="" /></span>
                        <span className="inventory-copy">
                          <strong>{definition.label}</strong>
                          <small>{definition.material}</small>
                          <em>{countLabel(remaining)}</em>
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
                return (
                  <article className={`inventory-card organism-card ${!unlocked ? 'locked' : ''}`} key={speciesId}>
                    <button
                      type="button"
                      className="inventory-card-main"
                      disabled={!unlocked || !editable || Boolean(snapshot.holding) || Boolean(pendingInventory) || remaining === 0}
                      onClick={(event) => {
                        rememberInventoryActivationPoint(event);
                        setPendingInventory({
                          requestId: ++pendingInventoryRequestIdRef.current,
                          kind: 'seed',
                          label: species.shortName,
                          speciesId,
                        });
                        setCatalogSpecies(speciesId);
                        setActiveTool('move');
                      }}
                    >
                      <span className={`inventory-thumb colony-thumb colony-${speciesId}`} aria-hidden="true"><i /><i /><i /></span>
                      <span className="inventory-copy">
                        <strong>{unlocked ? species.shortName : '잠긴 생물'}</strong>
                        <small>{unlocked ? species.scientificName : '이전 미션 완료 후 해금'}</small>
                        <em>{unlocked ? countLabel(remaining) : '특성 미공개'}</em>
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
                  return (
                    <article className="inventory-card organism-card animal-card" key={speciesId}>
                      <button
                        type="button"
                        className="inventory-card-main"
                        disabled={!editable || Boolean(snapshot.holding) || Boolean(pendingInventory) || remaining === 0}
                        onClick={(event) => {
                          setCatalogSpecies(null);
                          setCatalogAnimal(null);
                          rememberInventoryActivationPoint(event);
                          setPendingInventory({
                            requestId: ++pendingInventoryRequestIdRef.current,
                            kind: 'animal',
                            label: animal.displayName,
                            animalSpeciesId: speciesId,
                          });
                          setActiveTool('move');
                        }}
                      >
                        <span className="inventory-thumb animal-thumb cherry-shrimp-thumb" aria-hidden="true">
                          <i className="shrimp-body" /><i className="shrimp-tail" /><i className="shrimp-antenna" />
                        </span>
                        <span className="inventory-copy">
                          <strong>{animal.displayName}</strong>
                          <small>{animal.scientificName}</small>
                          <em>{remaining === null ? '무제한' : `${remaining}마리 남음`}</em>
                        </span>
                      </button>
                      <button type="button" className="info-chip" disabled={Boolean(snapshot.holding) || Boolean(pendingInventory)} onClick={() => showCatalogAnimal(speciesId)}>정보</button>
                    </article>
                  );
                })}

              {inventoryCategory === 'organisms' && scenario.waterCycle && MICROBE_IDS
                .filter((guildId) => scenario.waterCycle?.allowedMicrobes.includes(guildId))
                .map((guildId) => {
                  const microbe = MICROBES[guildId];
                  const remaining = snapshot.remainingMicrobes[guildId];
                  return (
                    <article className={`inventory-card organism-card biofilm-card biofilm-${guildId}`} key={guildId}>
                      <button
                        type="button"
                        className="inventory-card-main"
                        disabled={!biofilmEditable || Boolean(snapshot.holding) || Boolean(pendingInventory) || remaining === 0}
                        onClick={(event) => {
                          setCatalogSpecies(null);
                          setCatalogAnimal(null);
                          rememberInventoryActivationPoint(event);
                          setPendingInventory({
                            requestId: ++pendingInventoryRequestIdRef.current,
                            kind: 'biofilm',
                            label: microbe.displayName,
                            microbeGuildId: guildId,
                          });
                          beginBiofilmOverlay(guildId);
                          setActiveTool('move');
                        }}
                      >
                        <span className="inventory-thumb biofilm-thumb" aria-hidden="true"><i /><i /><i /><i /></span>
                        <span className="inventory-copy">
                          <strong>{microbe.displayName}</strong>
                          <small>{microbe.foodLabel} → {microbe.productLabel}</small>
                          <em>{biofilmEditable ? countLabel(remaining) : '일시정지 후 접종 가능'}</em>
                        </span>
                      </button>
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
                  {scenario.waterCycle && (
                    <article className="inventory-card instrument-card water-quality-card">
                      <button
                        type="button"
                        className={`inventory-card-main ${activeTool === 'water-quality-probe' ? 'active' : ''}`}
                        disabled={Boolean(snapshot.holding) || Boolean(pendingInventory)}
                        onClick={() => toggleMeasurementTool('water-quality-probe')}
                      >
                        <span className="inventory-thumb water-quality-thumb" aria-hidden="true">
                          <MeasurementIcon kind="water-quality" />
                        </span>
                        <span className="inventory-copy">
                          <strong>수질 탐침</strong>
                          <small>포인터에서 여섯 값을 미리 보고 지점 설치</small>
                          <em>{activeTool === 'water-quality-probe' ? '설치 위치 선택 중 · 다시 눌러 해제' : '6개 수질 값'}</em>
                        </span>
                      </button>
                    </article>
                  )}
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
                            if (measurement.kind === 'water-quality') {
                              setWaterQualityMapVisible(true);
                            }
                            setOpenHudPanels((current) => ({ ...current, observation: true }));
                          }}
                        >
                          <span className="measurement-list-label">
                            <MeasurementIcon kind={measurement.kind} compact />
                            {measurement.kind === 'light' ? '광량' : measurement.kind === 'temperature' ? '수온' : '수질'} {index + 1}
                          </span>
                          <strong>{measurement.kind === 'light'
                            ? Math.round(measurement.light)
                            : measurement.kind === 'temperature'
                              ? `${measurement.temperature.toFixed(1)}°C`
                              : '6개 항목'}</strong>
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
                    editable={canvasEditable}
                    hasPendingInventory={Boolean(pendingInventory)}
                    pendingInventoryKey={pendingInventory ? String(pendingInventory.requestId) : null}
                    onConsumePendingInventory={consumePendingInventory}
                    onPendingInventoryReady={finishPendingInventoryHandoff}
                    onToolComplete={completeCanvasInteraction}
                    onCameraChange={setCameraTransform}
                    cameraResetToken={cameraResetToken}
                    showGoalGuide={showGoalGuide}
                    waterQualityLayers={waterQualityMapVisible ? waterQualityLayers : []}
                  />

                  {biologicalPlacementMarker && (
                    <span
                      className={`tank-biological-placement-marker marker-${biologicalPlacementMarker.kind} ${biologicalPlacementMarker.valid ? 'valid' : 'invalid'}`}
                      style={biologicalPlacementMarker.style}
                      aria-hidden="true"
                    >
                      <i /><i /><i /><i /><i /><i />
                    </span>
                  )}

                  {scenario.waterCycle && openHudPanels.observation && waterQualityMapVisible && (
                    <AnalysisOverlayToolbar
                      snapshot={snapshot}
                      layers={waterQualityLayers}
                      collapsed={waterQualityLegendCollapsed}
                      onLayerToggle={toggleWaterQualityLayer}
                      onToggleCollapsed={() => setWaterQualityLegendCollapsed((current) => !current)}
                      onClose={() => {
                        setWaterQualityMapVisible(false);
                        setWaterQualityLegendCollapsed(false);
                      }}
                    />
                  )}

                  {snapshot.probe && !openHudPanels.observation && (
                    <div className="tank-probe-readout" aria-live="polite">
                      {activeTool === 'water-quality-probe' && waterQualityLayer ? (
                        <span>{waterQualityChannel(waterQualityLayer)?.shortLabel}{' '}
                          <strong>{formatWaterQualityValue(
                            waterQualityLayer,
                            waterQualityValue(snapshot.probe, waterQualityLayer),
                          )}</strong>
                        </span>
                      ) : (
                        <>
                          <span>광량 <strong>{Math.round(snapshot.probe.light)}</strong></span>
                          <span>수온 <strong>{snapshot.probe.temperature.toFixed(1)}°C</strong></span>
                        </>
                      )}
                    </div>
                  )}

                  {!pendingInventory && editableSelectedStructure && cameraTransform && (
                    <StructureEditControls
                      structure={editableSelectedStructure}
                      cameraTransform={cameraTransform}
                      motionSource={motionSource}
                      send={send}
                    />
                  )}
                </div>
              </div>
            </div>
          </section>

          {rightPanelVisible && (
          <aside
            ref={floatingInfoStackRef}
            className={`info-panel v2-info-panel floating-info-stack ${
              observationDockVisible ? 'has-observation-dock' : ''
            } ${rightPanelResizing ? 'is-resizing' : ''}`}
            style={observationDockVisible && rightPanelHeight !== null
              ? { height: `${rightPanelHeight}px` }
              : undefined}
          >
            {openHudPanels.quest && (
            <section id="floating-quest-panel" className="paper-panel mission-note floating-note floating-quest-panel">
              <div className="tape" aria-hidden="true" />
              <button type="button" className="floating-note-close" aria-label="퀘스트 닫기" onClick={() => closeHudPanel('quest')}><CloseGlyph /></button>
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
                    (snapshot.currentTargetMet || progress.unit === 'adult-count' || progress.unit === 'population-count') && (
                    <>
                      {(progress.unit === 'adult-count' || progress.unit === 'population-count') && (
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

            {observationDockVisible && (
            <div id="floating-observation-panel" className="floating-observation-content">
              <section className="paper-panel floating-observation-heading">
                <div>
                  <span className="panel-label">{scenario.waterCycle ? '관찰 지도' : '관찰 기록'}</span>
                  <strong>{observationView === 'selection' ? observationSelectionLabel : '수조 전체'}</strong>
                </div>
                <div className="observation-heading-actions">
                  {scenario.waterCycle && (
                    <button
                      type="button"
                      className={`observation-map-toggle ${waterQualityMapVisible ? 'active' : ''}`}
                      aria-pressed={waterQualityMapVisible}
                      onClick={toggleWaterQualityMap}
                    >
                      <i aria-hidden="true" />
                      {waterQualityMapVisible ? '색 지도 끄기' : '색 지도 켜기'}
                    </button>
                  )}
                  <button type="button" className="floating-note-close" aria-label="관찰 기록 닫기" onClick={closeObservationMode}><CloseGlyph /></button>
                </div>
              </section>

              <div className="observation-scope-tabs" role="tablist" aria-label="관찰 범위">
                <button
                  type="button"
                  role="tab"
                  aria-selected={observationView === 'selection'}
                  className={observationView === 'selection' ? 'active' : ''}
                  disabled={!hasObservationSelection}
                  onClick={() => setObservationView('selection')}
                >선택 대상</button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={observationView === 'overview'}
                  className={observationView === 'overview' ? 'active' : ''}
                  onClick={() => setObservationView('overview')}
                >수조 전체</button>
              </div>

              <div className="floating-observation-scroll">
              {observationView === 'selection' && (
              <>

            {showProbePanel && !selectedMeasurement && !inspectedAnimalSpecies && (
              <section className="paper-panel environment-panel">
                <div className="panel-row">
                  <span className="panel-label">
                    {activeTool === 'light-probe'
                      ? '광량 탐침 미리보기'
                      : activeTool === 'temperature-probe'
                        ? '수온계 미리보기'
                        : scenario.waterCycle
                          ? '수질 지도 · 위치별 값'
                          : '포인터 미리보기'}
                  </span>
                  {snapshot.probe && <button type="button" onClick={() => send({ type: 'clear-probe' })}>미리보기 닫기</button>}
                </div>
                {scenario.waterCycle && activeTool !== 'light-probe' && activeTool !== 'temperature-probe' ? (
                  <>
                    <WaterQualityReadout
                      sample={snapshot.probe}
                      layers={waterQualityLayers}
                      onLayerToggle={toggleWaterQualityLayer}
                    />
                    <p className="probe-location">
                      {snapshot.probe
                        ? activeTool === 'water-quality-probe'
                          ? `${snapshot.probe.locationLabel} · 클릭하면 수질 측정점 설치`
                          : `${snapshot.probe.locationLabel} · 포인터 위치의 현재 값`
                        : activeTool === 'water-quality-probe'
                          ? '수조 위로 포인터를 옮기면 그 위치의 여섯 값이 표시됩니다.'
                          : waterQualityLayers.length
                            ? '지도는 수조 전체 분포만 표시합니다. 정확한 값은 수질 탐침으로 확인할 수 있습니다.'
                            : '위에서 관찰할 항목을 고르거나 수질 탐침을 설치해 정확한 값을 확인하세요.'}
                    </p>
                  </>
                ) : snapshot.probe ? (
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
                {activeTool !== 'water-quality-probe' && selectedProbeTrend && inspectedSpecies && (
                  <div className={`species-trend ${trendCopy[selectedProbeTrend].className}`}>
                    <b><TrendIcon trend={selectedProbeTrend} /></b>
                    <span>{SPECIES[inspectedSpecies].shortName}<strong>{trendCopy[selectedProbeTrend].label}</strong></span>
                  </div>
                )}
              </section>
            )}

            {snapshot.selection?.kind === 'region' ? (
              <RegionSelectionInspector
                structures={selectedRegionStructures}
                measurements={selectedRegionMeasurements}
                animals={selectedRegionAnimals}
                cells={selectedCells}
                snapshot={snapshot}
              />
            ) : selectedStructure ? (
              <StructureInspector
                structure={selectedStructure}
                snapshot={snapshot}
                isHeld={snapshot.holding?.kind === 'structure' && snapshot.holding.structureId === selectedStructure.id}
                canRetrieve={false}
              />
            ) : selectedMeasurement ? (
              <MeasurementInspector
                measurement={selectedMeasurement}
                waterQualityLayers={waterQualityLayers}
                onWaterQualityLayerToggle={toggleWaterQualityLayer}
              />
            ) : selectedAnimal ? (
              <AnimalInspector
                animal={selectedAnimal}
                canRetrieve={false}
              />
            ) : selectedCarcass ? (
              <AnimalCarcassInspector carcass={selectedCarcass} />
            ) : selectedCells.length ? (
              <>
                <SurfaceCommunityInspector
                  cells={selectedCells}
                  snapshot={snapshot}
                />
                {inspectedSpecies && (
                  <SpeciesGuide
                    speciesId={inspectedSpecies}
                    probeLight={snapshot.probe?.light ?? selectedAverageLight}
                    temperature={snapshot.probe?.temperature ?? snapshot.waterTemperature}
                    localBiomass={selectedBiomass}
                    onSelect={setCatalogSpecies}
                    availableSpecies={selectionSpeciesIds}
                    headingLabel="같은 표면의 조류"
                    scopeLabel={`선택 표면 ${selectedCells.length}곳`}
                    plantRamets={selectedPlants}
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
                scopeLabel="선택한 위치"
                plantRamets={selectionSpeciesIds.length ? selectedPlants : snapshot.plants}
              />
            ) : (
              <section className="paper-panel empty-inspector">
                <span className="empty-inspector-icon" aria-hidden="true">
                  <svg viewBox="0 0 32 32"><circle cx="13" cy="13" r="8" /><path d="m19 19 8 8" /><circle cx="13" cy="13" r="1.5" /></svg>
                </span>
                <h3>선택한 대상 없음</h3>
                <p>수조의 대상을 클릭하거나 영역을 드래그하면 구조물·생물·균 필름·측정점을 함께 관찰할 수 있습니다.</p>
              </section>
            )}
            </>
            )}

            {observationView === 'overview' && (
            <>
              <section className="paper-panel observation-panel compact-observation tank-observation-overview">
                <div className="observation-overview-heading">
                  <span className="panel-label">수조 기록</span>
                  {detachedObservationSections.length > 0 && (
                    <small>{detachedObservationSections.length}개 분리해서 보는 중</small>
                  )}
                </div>

                {observationSections
                  .filter((section) => !detachedObservationSections.includes(section.id))
                  .map((section) => {
                    const expanded = openObservationSections.includes(section.id);
                    const panelId = `observation-section-${section.id}`;
                    return (
                      <section className="observation-section" key={section.id}>
                        <div className="observation-section-heading">
                          <button
                            type="button"
                            className="observation-section-toggle"
                            aria-expanded={expanded}
                            aria-controls={panelId}
                            onClick={() => toggleObservationSection(section.id)}
                          >
                            <span>{section.title}</span>
                            <small>{section.summary}</small>
                            <i aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className="observation-section-detach"
                            aria-label={`${section.title} 따로 보기`}
                            title="별도 기록창으로 열기"
                            onClick={() => detachObservationSection(section.id)}
                          ><ObservationDockGlyph direction="detach" /></button>
                        </div>
                        {expanded && (
                          <div className="observation-section-body" id={panelId}>
                            <ObservationSectionContent
                              section={section.id}
                              snapshot={snapshot}
                              ecologyHistory={ecologyHistory}
                              historyWindowSeconds={ecologyHistoryWindowSeconds}
                              onHistoryWindowDecrease={() => changeEcologyHistoryWindow(-1)}
                              onHistoryWindowIncrease={() => changeEcologyHistoryWindow(1)}
                            />
                          </div>
                        )}
                      </section>
                    );
                  })}

                {observationSections.length === detachedObservationSections.length && (
                  <p className="observation-detached-empty">모든 항목을 별도 기록창으로 열었습니다.</p>
                )}
              </section>

              {snapshot.mode === 'laboratory' && (
                <section className="paper-panel lab-controls v2-lab-controls">
                  <div className="panel-label">실험실 광원</div>
                  <label className="lab-light-control">
                    <span>전등 <strong>{Math.round(snapshot.lightOutput)}</strong></span>
                    <input type="range" min={0} max={120} value={snapshot.lightOutput} disabled={!editable} onChange={(event) => send({ type: 'set-light-output', output: Number(event.target.value) })} />
                  </label>
                  <label className="lab-light-control">
                    <span>자연광 <strong>{Math.round(snapshot.naturalLightOutput)}</strong></span>
                    <input type="range" min={0} max={120} value={snapshot.naturalLightOutput} disabled={!editable} onChange={(event) => send({ type: 'set-natural-light-output', output: Number(event.target.value) })} />
                  </label>
                  <label className="lab-day-night-toggle">
                    <input
                      type="checkbox"
                      checked={snapshot.dayNightEnabled}
                      disabled={!editable || snapshot.naturalLightOutput <= 0}
                      onChange={(event) => send({
                        type: 'set-day-night-enabled',
                        enabled: event.target.checked,
                      })}
                    />
                    <span>
                      <strong>자연광 낮·밤 주기</strong>
                      <small>{snapshot.naturalLightOutput > 0
                        ? snapshot.dayNightEnabled ? '새벽·낮·해질녘·밤 반복' : '현재 밝기로 고정'
                        : '자연광 출력을 먼저 올리세요'}</small>
                    </span>
                  </label>
                </section>
              )}
            </>
            )}
              </div>
            </div>
            )}

            {observationDockVisible && (
              <button
                type="button"
                className="floating-info-resize-handle"
                aria-label="관찰 패널 높이 조절"
                title="드래그해 높이 조절 · 두 번 클릭해 전체 높이"
                onDoubleClick={() => setRightPanelHeight(null)}
                onPointerDown={beginRightPanelResize}
                onPointerMove={updateRightPanelResize}
                onPointerUp={endRightPanelResize}
                onPointerCancel={endRightPanelResize}
              ><span aria-hidden="true" /></button>
            )}
          </aside>
          )}

          {openHudPanels.observation && !snapshot.holding && !pendingInventory && detachedObservationSections.length > 0 && (
            <aside className="detached-observation-stack" aria-label="분리한 관찰 기록">
              {detachedObservationSections.map((sectionId) => {
                const section = observationSections.find((item) => item.id === sectionId);
                if (!section) return null;
                const workspaceRect = tankWorkspaceRef.current?.getBoundingClientRect();
                const layout = detachedPanelLayouts[section.id] ?? createDetachedPanelLayout(
                  section.id,
                  workspaceRect?.width ?? window.innerWidth,
                  workspaceRect?.height ?? window.innerHeight,
                );
                const isActive = activeDetachedSection === section.id;
                return (
                  <section
                    className={`paper-panel detached-observation-panel compact-observation ${
                      isActive && detachedPanelInteraction === 'move' ? 'is-dragging' : ''
                    } ${
                      isActive && detachedPanelInteraction === 'resize' ? 'is-resizing' : ''
                    }`}
                    key={section.id}
                    style={{
                      left: `${layout.x}px`,
                      top: `${layout.y}px`,
                      width: `${layout.width}px`,
                      height: `${layout.height}px`,
                      zIndex: isActive ? 5 : 1,
                    }}
                    onPointerDownCapture={() => setActiveDetachedSection(section.id)}
                  >
                    <header
                      className="detached-observation-heading"
                      title="제목줄을 드래그하여 이동"
                      onPointerDown={(event) => beginDetachedPanelDrag(event, section.id)}
                      onPointerMove={updateDetachedPanelInteraction}
                      onPointerUp={endDetachedPanelInteraction}
                      onPointerCancel={endDetachedPanelInteraction}
                    >
                      <span className="detached-observation-grip" aria-hidden="true" />
                      <strong>{section.title}</strong>
                      <button
                        type="button"
                        className="detached-observation-attach"
                        onClick={() => attachObservationSection(section.id)}
                        aria-label={`${section.title} 수조 기록에 넣기`}
                        title="수조 기록에 다시 넣기"
                      ><ObservationDockGlyph direction="attach" /></button>
                    </header>
                    <div className="detached-observation-body">
                      <ObservationSectionContent
                        section={section.id}
                        snapshot={snapshot}
                        ecologyHistory={ecologyHistory}
                        historyWindowSeconds={ecologyHistoryWindowSeconds}
                        onHistoryWindowDecrease={() => changeEcologyHistoryWindow(-1)}
                        onHistoryWindowIncrease={() => changeEcologyHistoryWindow(1)}
                      />
                    </div>
                    <button
                      type="button"
                      className="detached-observation-resize-handle"
                      aria-label={`${section.title} 기록창 크기 조절`}
                      title="드래그하여 창 크기 조절"
                      onPointerDown={(event) => beginDetachedPanelResize(event, section.id)}
                      onPointerMove={updateDetachedPanelInteraction}
                      onPointerUp={endDetachedPanelInteraction}
                      onPointerCancel={endDetachedPanelInteraction}
                    >
                      <svg viewBox="0 0 18 18" aria-hidden="true">
                        <path d="M8 16 16 8M12 16l4-4M4 16 16 4" />
                      </svg>
                    </button>
                  </section>
                );
              })}
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
                      : snapshot.holding.kind === 'biofilm'
                        ? MICROBES[snapshot.holding.microbeGuildId!].displayName
                        : SPECIES[snapshot.holding.speciesId!].shortName}
                </strong>
              </div>
              <small className={snapshot.holding.kind === 'structure' ? 'wheel-rotate-hint' : undefined}>
                {snapshot.holding.kind === 'structure'
                  ? <><i aria-hidden="true" />휠 또는 Q/E로 회전 · 수조를 클릭해 놓기</>
                  : snapshot.holding.kind === 'animal'
                    ? '수면 아래 원하는 위치를 클릭해 방류'
                    : snapshot.holding.kind === 'biofilm'
                      ? '수치를 확인한 표면을 클릭해 균 필름 접종'
                      : '표면을 클릭해 접종'}
              </small>
              <div className="placement-toolbar-actions">
                <button type="button" onClick={() => {
                  send({ type: 'cancel-held' });
                  completeCanvasInteraction('move');
                }}>
                  {snapshot.holding.source === 'existing' ? '원래 자리' : '배치 취소'}
                </button>
                {snapshot.holding.source === 'existing' && (
                  <button type="button" onClick={() => {
                    send({
                      type: snapshot.holding?.kind === 'structure' ? 'remove-held-structure' : 'retrieve-held',
                    });
                    completeCanvasInteraction('move');
                  }}>보유 목록으로</button>
                )}
              </div>
            </section>
          ) : activeTool === 'move' && selectedMeasurement && editable ? (
            <section className="tank-edit-selection-toolbar" aria-label="선택한 측정점 편집">
              <div><span>편집 대상</span><strong>{selectedMeasurement.kind === 'light' ? '광량 측정점' : selectedMeasurement.kind === 'temperature' ? '수온 측정점' : '수질 측정점'}</strong></div>
              <small>관찰 정보와 편집 동작은 분리되어 있습니다.</small>
              <button type="button" onClick={() => send({ type: 'remove-measurement', id: selectedMeasurement.id })}>측정점 회수</button>
            </section>
          ) : null}
        </footer>
      </main>
    </>
  );
}

function ObservationSectionContent({
  section,
  snapshot,
  ecologyHistory,
  historyWindowSeconds,
  onHistoryWindowDecrease,
  onHistoryWindowIncrease,
}: {
  section: ObservationSection;
  snapshot: SimulationSnapshot;
  ecologyHistory: EcologyHistoryPoint[];
  historyWindowSeconds: number;
  onHistoryWindowDecrease: () => void;
  onHistoryWindowIncrease: () => void;
}) {
  const scenario = SCENARIOS[snapshot.scenarioId];
  const hasShrimpRecord = snapshot.animalPopulation['cherry-shrimp'].total > 0 ||
    snapshot.animalPopulationEventTotals.births > 0 ||
    snapshot.animalPopulationEventTotals.deaths > 0 ||
    snapshot.carcasses.length > 0;
  const hasAlgaeRecord = snapshot.totalBiomass.oedogonium > ALGAE_VISIBLE_BIOMASS ||
    snapshot.totalBiomass.nitzschia > ALGAE_VISIBLE_BIOMASS ||
    snapshot.totalBiomass.vallisneria > ALGAE_VISIBLE_BIOMASS;

  if (section === 'ecology') {
    return (
      <dl>
        {hasShrimpRecord && (
          <>
            <div><dt><i className="species-dot cherry-shrimp" />성체 암컷</dt><dd>{snapshot.animalPopulation['cherry-shrimp'].adultFemales}마리</dd></div>
            <div><dt>성체 수컷</dt><dd>{snapshot.animalPopulation['cherry-shrimp'].adultMales}마리</dd></div>
            <div><dt>어린 새우</dt><dd>{snapshot.animalPopulation['cherry-shrimp'].juveniles}마리</dd></div>
            <div><dt>전체 새우</dt><dd>{snapshot.animalPopulation['cherry-shrimp'].total}마리</dd></div>
            <div className="birth-total"><dt>누적 출생</dt><dd>{snapshot.animalPopulationEventTotals.births}마리</dd></div>
            <div className="carcass-total"><dt>누적 사망</dt><dd>{snapshot.animalPopulationEventTotals.deaths}마리</dd></div>
            {snapshot.carcasses.length > 0 && <div><dt>현재 남은 사체</dt><dd>{snapshot.carcasses.length}마리</dd></div>}
            <div className="consumption-total"><dt>새우가 먹은 조류</dt><dd>{snapshot.totalAlgaeConsumed.toFixed(1)}</dd></div>
          </>
        )}
        {snapshot.totalBiomass.oedogonium > ALGAE_VISIBLE_BIOMASS && (
          <div><dt><i className="species-dot oedogonium" />붓뚜껑말 총량</dt><dd>{snapshot.totalBiomass.oedogonium.toFixed(1)}</dd></div>
        )}
        {snapshot.totalBiomass.nitzschia > ALGAE_VISIBLE_BIOMASS && (
          <div><dt><i className="species-dot nitzschia" />규조류 총량</dt><dd>{snapshot.totalBiomass.nitzschia.toFixed(1)}</dd></div>
        )}
        {snapshot.totalBiomass.vallisneria > ALGAE_VISIBLE_BIOMASS && (
          <div><dt><i className="species-dot vallisneria" />나사말 총량</dt><dd>{snapshot.totalBiomass.vallisneria.toFixed(1)}</dd></div>
        )}
        {!hasShrimpRecord && !hasAlgaeRecord && (
          <div className="observation-empty-row"><dt>현재 관찰되는 생물</dt><dd>없음</dd></div>
        )}
        {!scenario.allowedAnimals.length && !snapshot.animals.length && (
          <div><dt>{snapshot.mode === 'challenge' ? '판정 표면 점유' : '전체 표면 점유'}</dt><dd>{Math.round(snapshot.coverageRatio * 100)}%</dd></div>
        )}
      </dl>
    );
  }

  if (section === 'water') {
    const transport = snapshot.biogeochemistry.transport;
    return (
      <dl>
        <div><dt>평균 수온</dt><dd>{transport.averageTemperature.toFixed(1)}°C</dd></div>
        <div><dt>수온 범위</dt><dd>{transport.minimumTemperature.toFixed(1)}–{transport.maximumTemperature.toFixed(1)}°C</dd></div>
        <div><dt>가장 빠른 물 흐름</dt><dd>{transport.maximumSpeed.toFixed(3)}칸/초</dd></div>
        <div><dt>평균 유기물</dt><dd>{snapshot.biogeochemistry.average.organicMatter.toFixed(2)}</dd></div>
        <div><dt>평균 암모니아성 노폐물</dt><dd>{snapshot.biogeochemistry.average.toxicWaste.toFixed(2)}</dd></div>
        <div><dt>평균 영양염</dt><dd>{snapshot.biogeochemistry.average.nutrients.toFixed(2)}</dd></div>
        <div><dt>평균 용존산소</dt><dd>{snapshot.biogeochemistry.average.oxygen.toFixed(2)}</dd></div>
        <div><dt>고형 유기 찌꺼기</dt><dd>{snapshot.biogeochemistry.detritusMass.toFixed(2)}</dd></div>
        <div><dt><i className="species-dot decomposer" />분해균 필름 총량</dt><dd>{snapshot.biogeochemistry.biofilmTotals.decomposer.toFixed(2)}</dd></div>
        <div><dt><i className="species-dot nitrifier" />질산화균 필름 총량</dt><dd>{snapshot.biogeochemistry.biofilmTotals.nitrifier.toFixed(2)}</dd></div>
      </dl>
    );
  }

  if (section === 'ledger') {
    const gas = snapshot.biogeochemistry.gasExchange;
    return (
      <dl>
        <div><dt>물속 무기탄소</dt><dd>{snapshot.biogeochemistry.carbonCycle.dissolvedInorganicCarbon.toFixed(2)}</dd></div>
        <div><dt>공기층 이산화탄소</dt><dd>{snapshot.biogeochemistry.carbonCycle.headspaceCarbonDioxide.toFixed(2)}</dd></div>
        <div><dt>공기층 산소</dt><dd>{snapshot.biogeochemistry.carbonCycle.headspaceOxygen.toFixed(2)}</dd></div>
        <div><dt>총광합성</dt><dd>{snapshot.biogeochemistry.algaeFluxes.grossProductionBiomassPerSecond.toFixed(3)}/초</dd></div>
        <div><dt>생산자 호흡</dt><dd>{snapshot.biogeochemistry.algaeFluxes.respirationBiomassPerSecond.toFixed(3)}/초</dd></div>
        <div><dt>광·수온 스트레스 소실</dt><dd>{snapshot.biogeochemistry.algaeFluxes.stressTurnoverBiomassPerSecond.toFixed(3)}/초</dd></div>
        <div><dt>수면 수온</dt><dd>{gas.surfaceTemperature.toFixed(1)}°C</dd></div>
        <div><dt>담수 산소 포화도</dt><dd>{gas.oxygenSolubilityMgL.toFixed(2)}mg/L <small>1기압 환산</small></dd></div>
        <div><dt>현재 수온의 물쪽 산소 목표</dt><dd>{gas.oxygenWaterEquilibrium.toFixed(2)}</dd></div>
        <div className="material-ledger-row"><dt>질소 장부</dt><dd>{snapshot.biogeochemistry.materialBalance.totalNitrogen.toFixed(2)} <small>{formatSignedPercent(snapshot.biogeochemistry.materialBalance.nitrogenDriftRatio)}</small></dd></div>
        <div className="material-ledger-row"><dt>탄소 장부</dt><dd>{snapshot.biogeochemistry.materialBalance.totalCarbon.toFixed(2)} <small>{formatSignedPercent(snapshot.biogeochemistry.materialBalance.carbonDriftRatio)}</small></dd></div>
        <div className="material-ledger-row"><dt>산소 등가 장부</dt><dd>{snapshot.biogeochemistry.materialBalance.oxygenEquivalent.toFixed(2)} <small>{formatSignedPercent(snapshot.biogeochemistry.materialBalance.oxygenEquivalentDriftRatio)}</small></dd></div>
      </dl>
    );
  }

  const visibleEcologyHistory = historyPointsInWindow(
    ecologyHistory,
    historyWindowSeconds,
  );
  const shortestHistoryWindow = ECOLOGY_HISTORY_WINDOW_OPTIONS_SECONDS[0];
  const longestHistoryWindow = ECOLOGY_HISTORY_WINDOW_OPTIONS_SECONDS.at(-1)!;

  return (
    <>
      <div className="history-window-control" role="group" aria-label="그래프 표시 시간 조절">
        <span>표시 구간</span>
        <div>
          <button
            type="button"
            aria-label="더 짧은 시간 구간 보기"
            title="더 짧게 보기"
            disabled={historyWindowSeconds <= shortestHistoryWindow}
            onClick={onHistoryWindowDecrease}
          >−</button>
          <strong>{formatTime(historyWindowSeconds)}</strong>
          <button
            type="button"
            aria-label="더 긴 시간 구간 보기"
            title="더 길게 보기"
            disabled={historyWindowSeconds >= longestHistoryWindow}
            onClick={onHistoryWindowIncrease}
          >+</button>
        </div>
      </div>
      {(hasShrimpRecord || scenario.allowedAnimals.length > 0) && (
        <>
          <EcologyHistoryChart
            points={visibleEcologyHistory}
            windowSeconds={historyWindowSeconds}
          />
          <AnimalPopulationEventLog snapshot={snapshot} />
        </>
      )}
      {snapshot.dayNight && (
        <DayNightFluxChart
          points={visibleEcologyHistory}
          windowSeconds={historyWindowSeconds}
        />
      )}
      {scenario.waterCycle && (
        <WaterCycleHistoryChart
          points={visibleEcologyHistory}
          windowSeconds={historyWindowSeconds}
        />
      )}
      {scenario.waterCycle && (
        <ClosedCycleHistoryChart
          points={visibleEcologyHistory}
          windowSeconds={historyWindowSeconds}
        />
      )}
      {!scenario.waterCycle && !hasShrimpRecord && (
        <p className="observation-empty-copy">기록할 변화가 생기면 여기에 표시됩니다.</p>
      )}
    </>
  );
}

const waterAtSurfaceCell = (
  snapshot: SimulationSnapshot,
  cell: SimulationSnapshot['cells'][number],
) => {
  const field = snapshot.biogeochemistry.water;
  if (!field.columns || !field.rows) return snapshot.biogeochemistry.average;
  const column = Math.max(0, Math.min(
    field.columns - 1,
    Math.floor((cell.x / TANK_WIDTH) * field.columns),
  ));
  const row = Math.max(0, Math.min(
    field.rows - 1,
    Math.floor(((cell.y - WATER_TOP) / (GROUND_Y - WATER_TOP)) * field.rows),
  ));
  const index = row * field.columns + column;
  return {
    organicMatter: field.organicMatter[index] ?? snapshot.biogeochemistry.average.organicMatter,
    toxicWaste: field.toxicWaste[index] ?? snapshot.biogeochemistry.average.toxicWaste,
    nutrients: field.nutrients[index] ?? snapshot.biogeochemistry.average.nutrients,
    oxygen: field.oxygen[index] ?? snapshot.biogeochemistry.average.oxygen,
  };
};

const transportAtPoint = (
  snapshot: SimulationSnapshot,
  point: Vec2,
) => {
  const transport = snapshot.biogeochemistry.transport;
  const column = Math.max(0, Math.min(
    transport.columns - 1,
    Math.floor((point.x / TANK_WIDTH) * transport.columns),
  ));
  const row = Math.max(0, Math.min(
    transport.rows - 1,
    Math.floor(((point.y - WATER_TOP) / (GROUND_Y - WATER_TOP)) * transport.rows),
  ));
  const index = row * transport.columns + column;
  const velocityX = transport.velocityX[index] ?? 0;
  const velocityY = transport.velocityY[index] ?? 0;
  return {
    temperature: transport.temperature[index] ?? transport.averageTemperature,
    speed: Math.hypot(velocityX, velocityY),
  };
};

function SurfaceCommunityInspector({
  cells,
  snapshot,
}: {
  cells: SimulationSnapshot['cells'];
  snapshot: SimulationSnapshot;
}) {
  const count = Math.max(1, cells.length);
  const averageLight = cells.reduce((sum, cell) => sum + cell.light, 0) / count;
  const decomposer = cells.reduce((sum, cell) => sum + cell.biofilm.decomposer, 0);
  const nitrifier = cells.reduce((sum, cell) => sum + cell.biofilm.nitrifier, 0);
  const water = cells.reduce((sum, cell) => {
    const local = waterAtSurfaceCell(snapshot, cell);
    return {
      organicMatter: sum.organicMatter + local.organicMatter,
      toxicWaste: sum.toxicWaste + local.toxicWaste,
      nutrients: sum.nutrients + local.nutrients,
      oxygen: sum.oxygen + local.oxygen,
    };
  }, { organicMatter: 0, toxicWaste: 0, nutrients: 0, oxygen: 0 });
  const transport = cells.reduce((sum, cell) => {
    const local = transportAtPoint(snapshot, cell);
    return {
      temperature: sum.temperature + local.temperature,
      speed: sum.speed + local.speed,
    };
  }, { temperature: 0, speed: 0 });
  const owners = [...new Set(cells.map((cell) => cell.ownerLabel))];
  const averageTemperature = transport.temperature / count;
  const decomposerTemperatureFactor = thetaTemperatureFactor(
    averageTemperature,
    MICROBE_ECOLOGY_RULES.decomposer.referenceTemperature,
    MICROBE_ECOLOGY_RULES.decomposer.temperatureCoefficient,
  );
  const nitrifierTemperatureFactor = thetaTemperatureFactor(
    averageTemperature,
    MICROBE_ECOLOGY_RULES.nitrifier.referenceTemperature,
    MICROBE_ECOLOGY_RULES.nitrifier.temperatureCoefficient,
  );

  return (
    <section className="paper-panel surface-community-inspector">
      <div className="surface-community-heading">
        <span className="surface-community-icon" aria-hidden="true"><i /><i /><i /></span>
        <div>
          <span className="panel-label">선택한 표면</span>
          <h3>균 필름과 표면 환경</h3>
          <small>{owners.join(' · ')} · {cells.length}개 관찰점</small>
        </div>
      </div>
      <dl className="species-facts">
        <div><dt><i className="species-dot decomposer" />분해균 필름</dt><dd>평균 {(decomposer / count * 100).toFixed(1)}%</dd></div>
        <div><dt><i className="species-dot nitrifier" />질산화균 필름</dt><dd>평균 {(nitrifier / count * 100).toFixed(1)}%</dd></div>
        <div><dt>광량</dt><dd>평균 {averageLight.toFixed(1)} / 100</dd></div>
        <div><dt>수온</dt><dd>평균 {averageTemperature.toFixed(1)}°C</dd></div>
        <div><dt>분해 반응 수온 보정</dt><dd>×{decomposerTemperatureFactor.toFixed(2)}</dd></div>
        <div><dt>질산화 반응 수온 보정</dt><dd>×{nitrifierTemperatureFactor.toFixed(2)}</dd></div>
        <div><dt>물 흐름</dt><dd>평균 {(transport.speed / count).toFixed(3)}칸/초</dd></div>
        <div><dt>유기물</dt><dd>{(water.organicMatter / count).toFixed(2)}</dd></div>
        <div><dt>암모니아성 노폐물</dt><dd>{(water.toxicWaste / count).toFixed(2)}</dd></div>
        <div><dt>영양염</dt><dd>{(water.nutrients / count).toFixed(2)}</dd></div>
        <div><dt>용존산소</dt><dd>{(water.oxygen / count).toFixed(2)}</dd></div>
      </dl>
    </section>
  );
}

function RegionSelectionInspector({
  structures,
  measurements,
  animals,
  cells,
  snapshot,
}: {
  structures: SimulationSnapshot['structures'];
  measurements: SimulationSnapshot['measurements'];
  animals: SimulationSnapshot['animals'];
  cells: SimulationSnapshot['cells'];
  snapshot: SimulationSnapshot;
}) {
  const algaeTotal = cells.reduce(
    (sum, cell) => sum + cell.biomass.oedogonium + cell.biomass.nitzschia,
    0,
  );
  const aquaticPlantTotal = cells.reduce(
    (sum, cell) => sum + cell.biomass.vallisneria,
    0,
  );
  const decomposer = cells.reduce((sum, cell) => sum + cell.biofilm.decomposer, 0);
  const nitrifier = cells.reduce((sum, cell) => sum + cell.biofilm.nitrifier, 0);

  return (
    <section className="paper-panel region-selection-inspector">
      <div className="region-selection-heading">
        <div><span className="panel-label">영역 관찰</span><h3>선택 영역 안의 대상</h3></div>
        <strong>{structures.length + measurements.length + animals.length + cells.length}개</strong>
      </div>
      <div className="region-selection-counts">
        <span>구조물 <b>{structures.length}</b></span>
        <span>측정점 <b>{measurements.length}</b></span>
        <span>새우 <b>{animals.length}</b></span>
        <span>표면 <b>{cells.length}</b></span>
      </div>

      {structures.length > 0 && (
        <section className="region-selection-group">
          <h4>구조물 환경 비교</h4>
          {structures.map((structure) => {
            const definition = STRUCTURES[structure.definitionId];
            const surfaceCells = snapshot.cells.filter((cell) => cell.ownerId === structure.id);
            const lights = surfaceCells.map((cell) => cell.light);
            const minimum = lights.length ? Math.min(...lights) : 0;
            const maximum = lights.length ? Math.max(...lights) : 0;
            const average = lights.length
              ? lights.reduce((sum, value) => sum + value, 0) / lights.length
              : 0;
            const surfaceAlgae = surfaceCells.reduce(
              (sum, cell) => sum + cell.biomass.oedogonium + cell.biomass.nitzschia,
              0,
            );
            const surfacePlants = surfaceCells.reduce(
              (sum, cell) => sum + cell.biomass.vallisneria,
              0,
            );
            const surfaceBiofilm = surfaceCells.reduce(
              (sum, cell) => sum + cell.biofilm.decomposer + cell.biofilm.nitrifier,
              0,
            );
            const localTemperature = surfaceCells.length
              ? surfaceCells.reduce(
                (sum, cell) => sum + transportAtPoint(snapshot, cell).temperature,
                0,
              ) / surfaceCells.length
              : snapshot.biogeochemistry.transport.averageTemperature;
            return (
              <div className="region-structure-row" key={structure.id}>
                <img src={definition.assetPath} alt="" />
                <div><strong>{definition.label}</strong><small>수온 {localTemperature.toFixed(1)}°C · 조류 {surfaceAlgae.toFixed(1)} · 수초 {surfacePlants.toFixed(1)} · 균 {surfaceBiofilm.toFixed(1)}</small></div>
                <span>빛 {minimum.toFixed(0)}–{maximum.toFixed(0)}<b>평균 {average.toFixed(0)}</b></span>
              </div>
            );
          })}
        </section>
      )}

      {measurements.length > 0 && (
        <section className="region-selection-group">
          <h4>측정점 비교</h4>
          {measurements.map((measurement, index) => (
            <div className="region-measurement-row" key={measurement.id}>
              <span><MeasurementIcon kind={measurement.kind} compact />측정점 {index + 1}</span>
              <strong>{measurement.kind === 'light'
                ? `광량 ${Math.round(measurement.light)}`
                : measurement.kind === 'temperature'
                  ? `${measurement.temperature.toFixed(1)}°C`
                  : `산소 ${measurement.water.oxygen.toFixed(1)} · 암모니아 ${measurement.water.toxicWaste.toFixed(1)}`}</strong>
            </div>
          ))}
        </section>
      )}

      {(animals.length > 0 || cells.length > 0) && (
        <section className="region-selection-group region-ecology-summary">
          <h4>생물과 표면</h4>
          <dl className="species-facts">
            <div><dt>체리새우</dt><dd>{animals.length}마리</dd></div>
            {algaeTotal > ALGAE_VISIBLE_BIOMASS && (
              <div><dt>조류 총량</dt><dd>{algaeTotal.toFixed(1)}</dd></div>
            )}
            {aquaticPlantTotal > ALGAE_VISIBLE_BIOMASS && (
              <div><dt>나사말 총량</dt><dd>{aquaticPlantTotal.toFixed(1)}</dd></div>
            )}
            <div><dt>분해균 필름</dt><dd>{decomposer.toFixed(2)}</dd></div>
            <div><dt>질산화균 필름</dt><dd>{nitrifier.toFixed(2)}</dd></div>
          </dl>
        </section>
      )}
    </section>
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
  const averageTemperature = cells.length
    ? cells.reduce(
      (total, cell) => total + transportAtPoint(snapshot, cell).temperature,
      0,
    ) / cells.length
    : snapshot.biogeochemistry.transport.averageTemperature;
  return (
    <section className="paper-panel structure-inspector">
      <div className="structure-inspector-heading">
        <img src={definition.assetPath} alt="" />
        <div><span className="panel-label">{isHeld ? '배치 중인 구조물' : '선택한 구조물'}</span><h3>{definition.label}</h3></div>
      </div>
      <dl className="species-facts">
        <div><dt>재질</dt><dd>{definition.material}</dd></div>
        <div><dt>평균 광량</dt><dd>{isHeld ? '배치 후 계산' : `${Math.round(averageLight)} / 100`}</dd></div>
        <div><dt>수온</dt><dd>{averageTemperature.toFixed(1)}°C</dd></div>
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

function AnalysisOverlayToolbar({
  snapshot,
  layers,
  collapsed,
  onLayerToggle,
  onToggleCollapsed,
  onClose,
}: {
  snapshot: SimulationSnapshot;
  layers: readonly WaterQualityLayer[];
  collapsed: boolean;
  onLayerToggle: (layer: WaterQualityLayer) => void;
  onToggleCollapsed: () => void;
  onClose: () => void;
}) {
  const scalarLayerCount = layers.filter((layer) =>
    layer !== 'decomposer' && layer !== 'nitrifier' && layer !== 'flow').length;

  return (
    <section
      className={`tank-analysis-toolbar analysis-multiple ${collapsed ? 'is-collapsed' : ''}`}
      aria-label="겹쳐 보는 색 지도"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="tank-analysis-heading">
        <span>색 지도</span>
        <strong>{layers.length ? `${layers.length}개 겹쳐 보기` : '표시 없음'}</strong>
        <div className="tank-analysis-actions">
          <button
            type="button"
            className="tank-analysis-collapse"
            onClick={onToggleCollapsed}
            aria-expanded={!collapsed}
            aria-label={collapsed ? '색 지도 범례 펼치기' : '색 지도 범례 접기'}
            title={collapsed ? '범례 펼치기' : '범례 작게 접기'}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              {collapsed
                ? <path d="m4 10 4-4 4 4" />
                : <path d="m4 6 4 4 4-4" />}
            </svg>
          </button>
          <button type="button" className="tank-analysis-close" onClick={onClose} aria-label="색 지도 닫기" title="색 표시 끄기"><CloseGlyph /></button>
        </div>
      </div>
      {!collapsed && (
        <>
          <div className="tank-analysis-selected-layers">
            {layers.map((layer) => {
              const channel = waterQualityChannel(layer)!;
              const statistics = analysisLayerStatistics(snapshot, layer);
              const isBiofilm = layer === 'decomposer' || layer === 'nitrifier';
              const formatValue = (value: number): string => isBiofilm
                ? `${value.toFixed(1)}%`
                : layer === 'temperature'
                  ? `${value.toFixed(1)}°C`
                : layer === 'flow'
                    ? `${value.toFixed(3)}칸/초`
                    : value.toFixed(1);
              const displayMode = isBiofilm
                ? '표면 얼룩'
                : layer === 'flow'
                  ? '방향 화살표'
                  : scalarLayerCount === 1
                  ? '색 지도'
                  : '등치선';
              return (
                <div className={`tank-analysis-selected-row channel-${layer}`} key={layer}>
                  <i aria-hidden="true" />
                  <strong>{channel.shortLabel}</strong>
                  <span>{displayMode}</span>
                  <small>평균 {formatValue(statistics.average)} · 최고 {formatValue(statistics.maximum)}</small>
                </div>
              );
            })}
          </div>
          <small className="tank-analysis-method">
            {layers.length
              ? '수질·수온은 색 또는 등치선으로, 물 흐름은 방향 화살표로 겹칩니다. 균 필름은 표면 얼룩입니다.'
              : '아래에서 보고 싶은 수질·수온·흐름이나 균 필름을 고르세요. 지도 창은 그대로 유지됩니다.'}
          </small>
          <div className="tank-analysis-channel-strip" role="group" aria-label="색 지도 채널">
            {WATER_QUALITY_CHANNELS.map((item) => (
              <button
                type="button"
                key={item.id}
                className={`channel-${item.id} ${layers.includes(item.id) ? 'active' : ''}`}
                aria-pressed={layers.includes(item.id)}
                onClick={() => onLayerToggle(item.id)}
              >
                <i aria-hidden="true" />{layers.includes(item.id) ? '✓ ' : ''}{item.shortLabel}
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function WaterQualityReadout({
  sample,
  layers,
  onLayerToggle,
}: {
  sample: NonNullable<SimulationSnapshot['probe']> | null;
  layers: readonly WaterQualityLayer[];
  onLayerToggle: (layer: WaterQualityLayer) => void;
}) {
  const growthRate = (guildId: MicrobeGuildId): string => {
    if (!sample) return '—';
    const percentPerSecond = sample.microbeNetGrowth[guildId] * 100;
    return `${percentPerSecond >= 0 ? '+' : ''}${percentPerSecond.toFixed(3)}%/초`;
  };

  return (
    <div className="water-quality-readout">
      <div className="water-quality-channels" role="group" aria-label="수질 관찰 채널">
        {WATER_QUALITY_CHANNELS.map((channel) => {
          const value = sample ? waterQualityValue(sample, channel.id) : null;
          return (
            <button
              type="button"
              key={channel.id}
              className={`water-quality-channel channel-${channel.id} ${layers.includes(channel.id) ? 'active' : ''}`}
              aria-pressed={layers.includes(channel.id)}
              onClick={() => onLayerToggle(channel.id)}
              title={layers.includes(channel.id) ? '지도에서 끄기' : '현재 지도에 겹치기'}
            >
              <span><i aria-hidden="true" />{layers.includes(channel.id) ? '✓ ' : ''}{channel.label}</span>
              <strong>{value === null ? '—' : formatWaterQualityValue(channel.id, value)}</strong>
            </button>
          );
        })}
      </div>
      {sample && (
        <div className="microbe-growth-readout">
          <div className="microbe-growth-heading">
            <span>이 위치의 예상 순성장률</span>
            <small>먹이·산소·수온·빈 표면 반영</small>
          </div>
          {MICROBE_IDS.map((guildId) => {
            const netGrowth = sample.microbeNetGrowth[guildId];
            return (
              <div key={guildId} className={netGrowth >= 0 ? 'positive' : 'negative'}>
                <span>{MICROBES[guildId].displayName}</span>
                <strong>{growthRate(guildId)}</strong>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MeasurementInspector({
  measurement,
  waterQualityLayers,
  onWaterQualityLayerToggle,
}: {
  measurement: SimulationSnapshot['measurements'][number];
  waterQualityLayers: readonly WaterQualityLayer[];
  onWaterQualityLayerToggle: (layer: WaterQualityLayer) => void;
}) {
  const isWaterQuality = measurement.kind === 'water-quality';
  const activeWaterLayer = waterQualityLayers[0] ?? 'organicMatter';
  return (
    <section className="paper-panel measurement-inspector">
      <div className="measurement-inspector-heading">
        <span aria-hidden="true"><MeasurementIcon kind={measurement.kind} /></span>
        <div>
          <span className="panel-label">선택한 측정점</span>
          <h3>{measurement.kind === 'light' ? '광량 탐침' : measurement.kind === 'temperature' ? '수온계' : '수질 측정점'}</h3>
        </div>
      </div>
      {isWaterQuality ? (
        <>
          <div className="measurement-primary water-quality-primary">
            <span>{waterQualityChannel(activeWaterLayer)?.label}</span>
            <strong>{formatWaterQualityValue(
              activeWaterLayer,
              waterQualityValue(measurement, activeWaterLayer),
            )}</strong>
          </div>
          <WaterQualityReadout
            sample={measurement}
            layers={waterQualityLayers}
            onLayerToggle={onWaterQualityLayerToggle}
          />
        </>
      ) : (
        <div className="measurement-primary">
          <span>{measurement.kind === 'light' ? '현재 광량' : '현재 수온'}</span>
          <strong>{measurement.kind === 'light' ? Math.round(measurement.light) : `${measurement.temperature.toFixed(1)}°C`}</strong>
        </div>
      )}
      <dl className="species-facts">
        <div><dt>설치 위치</dt><dd>{measurement.locationLabel}</dd></div>
        {measurement.kind === 'light'
          ? <div><dt>함께 기록</dt><dd>수온 {measurement.temperature.toFixed(1)}°C</dd></div>
          : measurement.kind === 'temperature'
            ? <div><dt>함께 기록</dt><dd>광량 {Math.round(measurement.light)} / 100</dd></div>
            : <div><dt>관찰 범위</dt><dd>네 수질 · 두 균 필름</dd></div>}
        <div><dt>기록 방식</dt><dd>시뮬레이션 중 실시간 갱신</dd></div>
      </dl>
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

const animalDeathCauseLabel: Record<SimulationSnapshot['carcasses'][number]['cause'], string> = {
  starvation: '먹이 부족으로 에너지 고갈',
  'old-age': '수명을 다해 자연사',
  hypoxia: '용존산소 부족',
  toxicity: '암모니아 독성 누적',
  temperature: '생존 범위를 벗어난 수온',
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
        <div><dt>현재 수온</dt><dd>{animal.temperature.toFixed(1)}°C</dd></div>
        <div><dt>대사 속도</dt><dd>24°C 기준 ×{animal.metabolicTemperatureFactor.toFixed(2)}</dd></div>
        <div><dt>성장·번식 속도</dt><dd>24°C 기준 ×{animal.reproductionTemperatureFactor.toFixed(2)}</dd></div>
        <div><dt>수온 생존 적합도</dt><dd>{Math.round(animal.thermalHealthSuitability * 100)} / 100</dd></div>
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
        <div><dt>사망 원인</dt><dd>{animalDeathCauseLabel[carcass.cause]}</dd></div>
        {carcass.waterAtDeath && (
          <>
            <div><dt>사망 당시 암모니아</dt><dd>{carcass.waterAtDeath.toxicWaste.toFixed(2)} / 피해 시작 {SHRIMP_ECOLOGY_RULES.toxicWasteStressStart}</dd></div>
            <div><dt>사망 당시 산소</dt><dd>{carcass.waterAtDeath.oxygen.toFixed(2)} / 피해 시작 {SHRIMP_ECOLOGY_RULES.oxygenStressStart} 미만</dd></div>
            <div><dt>사망 당시 유기물</dt><dd>{carcass.waterAtDeath.organicMatter.toFixed(2)}</dd></div>
          </>
        )}
        {carcass.temperatureAtDeath != null && (
          <div><dt>사망 당시 수온</dt><dd>{carcass.temperatureAtDeath.toFixed(1)}°C</dd></div>
        )}
        <div><dt>죽은 뒤</dt><dd>{formatTime(carcass.ageSeconds)}</dd></div>
      </dl>
      <p className="animal-note">수질 순환이 활성화된 실험에서는 죽은 개체가 유기물로 남아 분해균의 먹이가 됩니다.</p>
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

const animalPopulationEventLabel: Record<AnimalPopulationEventSnapshot['kind'], string> = {
  introduced: '수조에 방류',
  removed: '수조에서 회수',
  birth: '새끼 출생',
  matured: '성체로 성장',
  death: '개체 사망',
};

function AnimalPopulationEventLog({ snapshot }: { snapshot: SimulationSnapshot }) {
  const totals = snapshot.animalPopulationEventTotals;
  const recentEvents = snapshot.animalPopulationEvents.slice(-10).reverse();
  const population = snapshot.animalPopulation['cherry-shrimp'];

  const eventDetail = (event: AnimalPopulationEventSnapshot): string => {
    const sex = event.sex === 'female' ? '암컷' : '수컷';
    const stage = event.lifeStage === 'adult' ? '성체' : '어린 새우';
    if (event.kind === 'death' && event.cause) {
      const water = event.water
        ? ` · 산소 ${event.water.oxygen.toFixed(1)} · 암모니아 ${event.water.toxicWaste.toFixed(1)}`
        : '';
      const temperature = event.temperature == null
        ? ''
        : ` · 수온 ${event.temperature.toFixed(1)}°C`;
      return `${sex} ${stage} · ${animalDeathCauseLabel[event.cause]}${water}${temperature}`;
    }
    if (event.kind === 'birth') return `${sex} 새끼 · 어미 개체에서 태어남`;
    return `${sex} ${stage}`;
  };

  return (
    <div className="animal-event-log">
      <div className="animal-event-heading">
        <div><strong>개체군 변화 기록</strong><small>최근 사건 10건 · 누계는 전체 실험</small></div>
        <span>현재 ♀ {population.adultFemales} · ♂ {population.adultMales}</span>
      </div>
      <div className="animal-event-totals" aria-label="새우 누적 변화">
        <div><span>출생</span><strong>{totals.births}</strong></div>
        <div><span>성체 전환</span><strong>{totals.maturations}</strong></div>
        <div><span>사망</span><strong>{totals.deaths}</strong></div>
        <div><span>방류/회수</span><strong>{totals.introduced}/{totals.removed}</strong></div>
      </div>
      {totals.deaths > 0 && (
        <div className="animal-death-breakdown" aria-label="사망 원인 누계">
          <span>먹이 부족 <b>{totals.deathsByCause.starvation}</b></span>
          <span>자연사 <b>{totals.deathsByCause['old-age']}</b></span>
          <span>산소 부족 <b>{totals.deathsByCause.hypoxia}</b></span>
          <span>암모니아 <b>{totals.deathsByCause.toxicity}</b></span>
          <span>수온 <b>{totals.deathsByCause.temperature}</b></span>
        </div>
      )}
      {recentEvents.length ? (
        <ol className="animal-event-list">
          {recentEvents.map((event) => (
            <li key={event.sequence} className={`event-${event.kind}`}>
              <time>{formatTime(event.elapsedSeconds)}</time>
              <span><strong>{animalPopulationEventLabel[event.kind]}</strong><small>{eventDetail(event)}</small></span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="animal-event-empty">시뮬레이션을 시작하면 방류·출생·성장·사망이 여기에 남습니다.</p>
      )}
    </div>
  );
}

const DayNightFluxChart = memo(function DayNightFluxChart({
  points,
  windowSeconds,
}: {
  points: EcologyHistoryPoint[];
  windowSeconds: number;
}) {
  if (!points.length) return null;
  const latestElapsedSeconds = points.at(-1)?.elapsedSeconds ?? 0;
  const timeBounds = historyTimeBounds(latestElapsedSeconds, windowSeconds);
  const maxFlux = Math.max(
    0.001,
    ...points.map((point) => Math.max(point.grossPhotosynthesis, point.producerRespiration)),
  );
  const line = (values: number[], top: number, height: number, maximum: number): string =>
    values.map((value, index) => {
      const x = historyTimeX(points[index]?.elapsedSeconds ?? 0, timeBounds, 46, 224);
      const y = top + height - Math.max(0, Math.min(1, value / maximum)) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
  const light = line(points.map((point) => point.lightMultiplier), 8, 24, 1);
  const gross = line(points.map((point) => point.grossPhotosynthesis), 45, 25, maxFlux);
  const respiration = line(points.map((point) => point.producerRespiration), 45, 25, maxFlux);
  const latest = points.at(-1)!;
  return (
    <div className="day-night-history">
      <div className="ecology-history-heading">
        <strong>낮·밤 생산자 대사</strong>
        <small>광합성과 호흡을 분리해 기록</small>
      </div>
      <svg viewBox="0 0 240 82" role="img" aria-label="낮과 밤의 광량, 총광합성, 생산자 호흡 변화">
        <path className="ecology-history-guide" d="M46 32H224M46 70H224" />
        <text x="5" y="21">빛</text>
        <text x="5" y="58">대사</text>
        <polyline className="day-night-line light" points={light} />
        <polyline className="day-night-line gross" points={gross} />
        <polyline className="day-night-line respiration" points={respiration} />
      </svg>
      <div className="day-night-history-legend">
        <span><i className="light" />광원 {Math.round(latest.lightMultiplier * 100)}%</span>
        <span><i className="gross" />총광합성 {latest.grossPhotosynthesis.toFixed(3)}</span>
        <span><i className="respiration" />호흡 {latest.producerRespiration.toFixed(3)}</span>
      </div>
    </div>
  );
});

const EcologyHistoryChart = memo(function EcologyHistoryChart({
  points,
  windowSeconds,
}: {
  points: EcologyHistoryPoint[];
  windowSeconds: number;
}) {
  const latestElapsedSeconds = points.at(-1)?.elapsedSeconds ?? 0;
  const timeBounds = historyTimeBounds(latestElapsedSeconds, windowSeconds);
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
      const x = historyTimeX(points[index]?.elapsedSeconds ?? 0, timeBounds, 43, 189);
      const y = top + height - 3 - ((value - minimum) / range) * (height - 6);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
  };
  const populationPoints = (values: number[], maximum: number): string => values.map((value, index) => {
    const x = historyTimeX(points[index]?.elapsedSeconds ?? 0, timeBounds, 43, 189);
    const y = 65 - (value / Math.max(1, maximum)) * 22;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const algaeValues = points.map((point) => point.algaeBiomass);
  const shrimpValues = points.map((point) => point.shrimpCount);
  const femaleValues = points.map((point) => point.shrimpAdultFemales);
  const maleValues = points.map((point) => point.shrimpAdultMales);
  const juvenileValues = points.map((point) => point.shrimpJuveniles);
  const maximumShrimpCount = Math.max(1, ...shrimpValues);
  const latest = points.at(-1) ?? {
    elapsedSeconds: 0,
    algaeBiomass: 0,
    plantBiomass: 0,
    lightMultiplier: 1,
    grossPhotosynthesis: 0,
    producerRespiration: 0,
    shrimpCount: 0,
    shrimpAdultFemales: 0,
    shrimpAdultMales: 0,
    shrimpJuveniles: 0,
    cumulativeBirths: 0,
    cumulativeDeaths: 0,
    organicMatter: 0,
    toxicWaste: 0,
    nutrients: 0,
    oxygen: 0,
    decomposer: 0,
    nitrifier: 0,
    dissolvedInorganicCarbon: 0,
    headspaceCarbonDioxide: 0,
    headspaceOxygen: 0,
  };
  const algaePoints = sparkPoints(algaeValues, 4, 28);
  const shrimpPoints = populationPoints(shrimpValues, maximumShrimpCount);
  const femalePoints = populationPoints(femaleValues, maximumShrimpCount);
  const malePoints = populationPoints(maleValues, maximumShrimpCount);
  const juvenilePoints = populationPoints(juvenileValues, maximumShrimpCount);

  return (
    <div className="ecology-history">
      <div className="ecology-history-heading">
        <strong>시간에 따른 변화</strong>
        <small>{points.length > 1 ? `${formatTime(timeBounds.start)}–${formatTime(timeBounds.end)}` : '관찰 대기 중'}</small>
      </div>
      <svg viewBox="0 0 240 72" role="img" aria-label="생산자 총량과 새우 개체 수의 시간 변화">
        <path className="ecology-history-guide" d="M43 32H189M43 68H189" />
        <text x="5" y="12">생산자</text>
        <text x="5" y="48">새우</text>
        {algaePoints && <polyline className="ecology-history-line algae" points={algaePoints} />}
        {shrimpPoints && <polyline className="ecology-history-line shrimp-total" points={shrimpPoints} />}
        {femalePoints && <polyline className="ecology-history-line shrimp-female" points={femalePoints} />}
        {malePoints && <polyline className="ecology-history-line shrimp-male" points={malePoints} />}
        {juvenilePoints && <polyline className="ecology-history-line shrimp-juvenile" points={juvenilePoints} />}
        <text className="ecology-history-value algae" x="235" y="12" textAnchor="end">{latest.algaeBiomass.toFixed(1)}</text>
        <text className="ecology-history-value shrimp" x="235" y="48" textAnchor="end">{latest.shrimpCount}마리</text>
      </svg>
      <div className="population-history-legend">
        <span className="female">성체 ♀ <b>{latest.shrimpAdultFemales}</b></span>
        <span className="male">성체 ♂ <b>{latest.shrimpAdultMales}</b></span>
        <span className="juvenile">어린 새우 <b>{latest.shrimpJuveniles}</b></span>
      </div>
      <small className="ecology-history-note">모든 개체군 선은 0부터 같은 눈금을 사용합니다.</small>
    </div>
  );
});

const WaterCycleHistoryChart = memo(function WaterCycleHistoryChart({
  points,
  windowSeconds,
}: {
  points: EcologyHistoryPoint[];
  windowSeconds: number;
}) {
  const latestElapsedSeconds = points.at(-1)?.elapsedSeconds ?? 0;
  const timeBounds = historyTimeBounds(latestElapsedSeconds, windowSeconds);
  const line = (values: number[], top: number): string => {
    if (!values.length) return '';
    const minimum = Math.min(...values);
    const maximum = Math.max(...values);
    const range = Math.max(maximum - minimum, maximum * 0.08, 0.05);
    return values.map((value, index) => {
      const x = historyTimeX(points[index]?.elapsedSeconds ?? 0, timeBounds, 49, 186);
      const y = top + 18 - ((value - minimum) / range) * 14;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
  };
  const latest = points.at(-1);
  const rows = [
    { key: 'organic', label: '유기물', value: latest?.organicMatter ?? 0, values: points.map((point) => point.organicMatter) },
    { key: 'decomposer', label: '분해균', value: latest?.decomposer ?? 0, values: points.map((point) => point.decomposer) },
    { key: 'toxic', label: '암모니아', value: latest?.toxicWaste ?? 0, values: points.map((point) => point.toxicWaste) },
    { key: 'nitrifier', label: '질산화균', value: latest?.nitrifier ?? 0, values: points.map((point) => point.nitrifier) },
  ] as const;
  return (
    <div className="water-cycle-history">
      <div className="ecology-history-heading">
        <strong>미생물 순환</strong>
        <small>최근 {formatTime(windowSeconds)}</small>
      </div>
      <svg viewBox="0 0 240 94" role="img" aria-label="유기물과 분해균, 암모니아성 노폐물과 질산화균의 시간 변화">
        {rows.map((row, index) => {
          const top = 2 + index * 23;
          const pointsText = line(row.values, top);
          return (
            <g key={row.key}>
              <path className="ecology-history-guide" d={`M49 ${top + 20}H186`} />
              <text x="4" y={top + 11}>{row.label}</text>
              {pointsText && <polyline className={`water-cycle-history-line ${row.key}`} points={pointsText} />}
              <text className={`water-cycle-history-value ${row.key}`} x="236" y={top + 11} textAnchor="end">{row.value.toFixed(2)}</text>
            </g>
          );
        })}
      </svg>
      <small className="ecology-history-note">먹이가 먼저 변하고, 뒤따라 균 필름량이 반응합니다.</small>
    </div>
  );
});

const ClosedCycleHistoryChart = memo(function ClosedCycleHistoryChart({
  points,
  windowSeconds,
}: {
  points: EcologyHistoryPoint[];
  windowSeconds: number;
}) {
  const latestElapsedSeconds = points.at(-1)?.elapsedSeconds ?? 0;
  const timeBounds = historyTimeBounds(latestElapsedSeconds, windowSeconds);
  const line = (values: number[], top: number): string => {
    if (!values.length) return '';
    const minimum = Math.min(...values);
    const maximum = Math.max(...values);
    const range = Math.max(maximum - minimum, maximum * 0.06, 0.05);
    return values.map((value, index) => {
      const x = historyTimeX(points[index]?.elapsedSeconds ?? 0, timeBounds, 49, 186);
      const y = top + 18 - ((value - minimum) / range) * 14;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
  };
  const latest = points.at(-1);
  const rows = [
    {
      key: 'mineral-nitrogen',
      label: '무기질소',
      value: (latest?.toxicWaste ?? 0) + (latest?.nutrients ?? 0),
      values: points.map((point) => point.toxicWaste + point.nutrients),
    },
    { key: 'nutrient', label: '영양염', value: latest?.nutrients ?? 0, values: points.map((point) => point.nutrients) },
    { key: 'dic', label: '무기탄소', value: latest?.dissolvedInorganicCarbon ?? 0, values: points.map((point) => point.dissolvedInorganicCarbon) },
    { key: 'oxygen', label: '용존산소', value: latest?.oxygen ?? 0, values: points.map((point) => point.oxygen) },
  ] as const;
  return (
    <div className="water-cycle-history closed-cycle-history">
      <div className="ecology-history-heading">
        <strong>닫힌 물질·기체 순환</strong>
        <small>최근 {formatTime(windowSeconds)}</small>
      </div>
      <svg viewBox="0 0 240 94" role="img" aria-label="무기질소 합계와 영양염, 물속 무기탄소, 용존산소의 시간 변화">
        {rows.map((row, index) => {
          const top = 2 + index * 23;
          const pointsText = line(row.values, top);
          return (
            <g key={row.key}>
              <path className="ecology-history-guide" d={`M49 ${top + 20}H186`} />
              <text x="4" y={top + 11}>{row.label}</text>
              {pointsText && <polyline className={`water-cycle-history-line ${row.key}`} points={pointsText} />}
              <text className={`water-cycle-history-value ${row.key}`} x="236" y={top + 11} textAnchor="end">{row.value.toFixed(2)}</text>
            </g>
          );
        })}
      </svg>
      <small className="ecology-history-note">무기질소는 암모니아와 영양염의 합계입니다. 생산자는 무기질소와 무기탄소를 흡수합니다.</small>
    </div>
  );
});

function AnimalGuide({ speciesId }: { speciesId: AnimalSpeciesId }) {
  const definition = ANIMALS[speciesId];
  const energyCapacityPerStructure =
    WATER_CYCLE_RULES.shrimp.assimilationFraction /
    SHRIMP_ECOLOGY_RULES.energyPerConsumedBiomass;
  const adultMaintenance = (
    SHRIMP_ECOLOGY_RULES.adultBaseMetabolismPerSecond +
    SHRIMP_ECOLOGY_RULES.restingActivityCostPerSecond
  ) * WATER_CYCLE_RULES.shrimp.adultStructuralBiomass *
    energyCapacityPerStructure;
  const juvenileMaintenance = (
    SHRIMP_ECOLOGY_RULES.juvenileBaseMetabolismPerSecond +
    SHRIMP_ECOLOGY_RULES.restingActivityCostPerSecond
  ) * WATER_CYCLE_RULES.shrimp.juvenileBirthBiomass *
    energyCapacityPerStructure;
  const oxygenPerAdultSecond = adultMaintenance * WATER_CYCLE_RULES.biomassCarbon *
    WATER_CYCLE_RULES.oxygenPerOrganicCarbon;
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
        <div><dt>수온 반응</dt><dd>{definition.temperature.summary}</dd></div>
      </dl>
      <section className="ecology-rules-card">
        <div className="ecology-rules-heading"><strong>게임 생존·수질 기준</strong><span>수질 농도 0–100</span></div>
        <dl>
          <div><dt>용존산소</dt><dd><b>{SHRIMP_ECOLOGY_RULES.oxygenStressStart} 이상</b>은 저산소 피해 없음. 그 아래부터 피해가 커져 0에서 체력 <b>{(SHRIMP_ECOLOGY_RULES.oxygenMaximumDamagePerSecond * 100).toFixed(1)}%/초</b> 감소.</dd></div>
          <div><dt>암모니아성 노폐물</dt><dd><b>{SHRIMP_ECOLOGY_RULES.toxicWasteStressStart} 이하</b>는 독성 피해 없음. {SHRIMP_ECOLOGY_RULES.toxicWasteStressStart}–{SHRIMP_ECOLOGY_RULES.toxicWasteFullStress}에서 증가해 {SHRIMP_ECOLOGY_RULES.toxicWasteFullStress} 이상이면 체력 <b>{(SHRIMP_ECOLOGY_RULES.toxicMaximumDamagePerSecond * 100).toFixed(1)}%/초</b> 감소.</dd></div>
          <div><dt>수온</dt><dd><b>{definition.temperature.referenceTemperature}°C</b> 기준 대사율에 1°C당 <b>×{definition.temperature.metabolicTheta}</b>를 적용합니다. 성장·번식은 별도 종 곡선을 사용하며 33°C에서는 번식 진행이 멈춥니다.</dd></div>
          <div><dt>회복</dt><dd>저산소·독성·수온 스트레스가 없을 때 체력 <b>{(SHRIMP_ECOLOGY_RULES.healthyWaterRecoveryPerSecond * 100).toFixed(1)}%/초</b> 회복. 세 피해는 합산됩니다.</dd></div>
          <div><dt>먹이의 행방</dt><dd>먹은 조류의 <b>{Math.round(WATER_CYCLE_RULES.shrimp.assimilationFraction * 100)}%</b>는 몸과 번식 자원, <b>{Math.round(WATER_CYCLE_RULES.shrimp.fecesFraction * 100)}%</b>는 유기성 찌꺼기, 나머지는 호흡·배설로 돌아갑니다.</dd></div>
          <div><dt>휴식 대사</dt><dd>성체는 몸·저장량 <b>{adultMaintenance.toFixed(6)}</b>, 갓 태어난 새우는 <b>{juvenileMaintenance.toFixed(6)}</b> /마리·초를 사용합니다. 이동 중에는 행동 비용만큼 더 사용합니다.</dd></div>
          <div><dt>산소 소비</dt><dd>성체 기초 대사만으로 약 <b>{oxygenPerAdultSecond.toFixed(6)}</b> /마리·초를 소비하며, 먹이 호흡분도 같은 질량 장부로 계산됩니다.</dd></div>
          <div><dt>번식 자원</dt><dd>암컷은 체력 비축분을 넘는 먹이 동화분을 별도 번식 저장량에 조금씩 모읍니다. 가까운 수컷과 실제로 만난 뒤 이 질량만큼 새끼가 태어납니다.</dd></div>
          <div><dt>사체·배설물</dt><dd>남은 몸·일반 저장량·번식 저장량과 배설물은 유기성 찌꺼기가 되어 분해균의 먹이로 되돌아갑니다.</dd></div>
          <div><dt>굶주림</dt><dd>영양 상태는 일반 저장량을 중심으로 몸의 건전도를 함께 반영합니다. 먹이가 끊기면 번식과 성장이 먼저 멈추고 일반 저장량과 생존 가능한 범위의 몸체를 모두 소모한 뒤 아사합니다.</dd></div>
          <div><dt>수명</dt><dd>성체 기준 약 <b>{formatTime(SHRIMP_ECOLOGY_RULES.minimumLifespanSeconds)}–{formatTime(SHRIMP_ECOLOGY_RULES.maximumLifespanSeconds)}</b>.</dd></div>
        </dl>
      </section>
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
  plantRamets = [],
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
  plantRamets?: SimulationSnapshot['plants'];
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
  const localTotal = localBiomass
    ? localBiomass.oedogonium + localBiomass.nitzschia + localBiomass.vallisneria
    : 0;
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
      {speciesId === 'vallisneria' && (
        <section className="plant-lifecycle-card">
          <div className="ecology-rules-heading">
            <strong>포기 생애</strong>
            <span>{plantRamets.length ? `${plantRamets.length}포기 관찰 중` : '관찰할 포기 없음'}</span>
          </div>
          {plantRamets.length ? (
            <>
              <div className="plant-stage-summary">
                <span>어린 포기 <b>{plantRamets.filter((plant) => plant.lifeStage === 'juvenile').length}</b></span>
                <span>성체 <b>{plantRamets.filter((plant) => plant.lifeStage === 'mature').length}</b></span>
                <span>노쇠 <b>{plantRamets.filter((plant) => plant.lifeStage === 'senescent').length}</b></span>
              </div>
              <dl>
                <div><dt>현재 나이</dt><dd>{Math.floor(plantRamets[0].ageSeconds / 60)}분 {Math.floor(plantRamets[0].ageSeconds % 60)}초 / 예상 {Math.floor(plantRamets[0].lifespanSeconds / 60)}분</dd></div>
                <div><dt>생장 상태</dt><dd>{plantRamets[0].lifeStage === 'juvenile' ? '어린 포기 · 잎을 키우는 중' : plantRamets[0].lifeStage === 'mature' ? '성체 · 러너 번식 가능' : '노쇠 · 잎과 저장량 감소'}</dd></div>
                <div><dt>건강</dt><dd>{Math.round(plantRamets[0].health * 100)} / 100</dd></div>
                <div><dt>러너 준비</dt><dd>{Math.round(plantRamets[0].runnerProgress * 100)}% · 자손 {plantRamets[0].reproductionCount}포기</dd></div>
                <div><dt>부모 연결</dt><dd>{plantRamets[0].connectedToParent ? '러너로 연결됨 · 저장량 지원 중' : '독립한 포기'}</dd></div>
              </dl>
            </>
          ) : <p>수조에서 나사말 포기나 나사말이 있는 영역을 선택하면 나이·건강·러너 번식을 볼 수 있습니다.</p>}
        </section>
      )}
      <section className="ecology-rules-card algae-rules-card">
        <div className="ecology-rules-heading"><strong>게임 생존·수질 기준</strong><span>표면 군락량 1.0 기준</span></div>
        <dl>
          <div><dt>직접 생존 조건</dt><dd>현재 모델에서 용존산소·유기물·암모니아성 노폐물은 조류를 직접 죽이지 않습니다. 빛·수온·영양염·경쟁·섭식이 양을 결정합니다.</dd></div>
          <div><dt>무기질소</dt><dd>암모니아성 노폐물과 영양염 합계 N에 <b>N ÷ ({WATER_CYCLE_RULES.mineralNutrientHalfSaturation} + N)</b>을 곱합니다. 새 군락은 필요한 질소 중 암모니아를 최대 <b>{Math.round(WATER_CYCLE_RULES.algae.ammoniumPreference * 100)}%</b> 우선 흡수하고, 부족분은 영양염에서 가져옵니다.</dd></div>
          <div><dt>무기탄소</dt><dd>유한한 물속 무기탄소 C에 <b>C ÷ ({WATER_CYCLE_RULES.carbonHalfSaturation} + C)</b>을 곱합니다. 새 군락 1.0에 탄소 <b>{WATER_CYCLE_RULES.biomassCarbon}</b>가 실제로 들어갑니다.</dd></div>
          <div><dt>산소 생산</dt><dd>고정한 탄소 1.0당 산소 <b>{WATER_CYCLE_RULES.oxygenPerOrganicCarbon}</b>를 만들고, 질산염을 흡수하면 질소 환원에 해당하는 산소 등가량이 더해집니다. 넘친 산소는 닫힌 공기층으로 이동합니다.</dd></div>
          <div><dt>낮·밤 호흡</dt><dd>빛이 없어 총광합성이 멈춰도 호흡은 계속됩니다. 24°C 기준 군락량 1.0당 <b>{(species.respirationRateAtReference * 100).toFixed(1)}%/초</b>를 호흡하며, 수온이 높을수록 빨라집니다.</dd></div>
          <div><dt>무기질소 흡수</dt><dd>새 생체량 1.0당 무기질소 <b>{WATER_CYCLE_RULES.biomassNitrogen}</b>를 흡수합니다. 죽거나 먹힌 생체량은 찌꺼기와 생물 몸을 거쳐 다시 순환합니다.</dd></div>
          <div><dt>자연 소실</dt><dd>그래프의 환경 성장률 계산 뒤에 군락량의 <b>0.18%/초</b>가 추가로 줄며, 다른 종의 경쟁과 새우 섭식도 별도로 적용됩니다.</dd></div>
        </dl>
      </section>
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
