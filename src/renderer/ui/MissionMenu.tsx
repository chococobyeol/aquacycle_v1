import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import type { ScenarioId } from '../../simulation/types';
import { CloseGlyph } from './CloseGlyph';

type MissionId = Exclude<ScenarioId, 'laboratory'>;

interface MissionCardDefinition {
  id: MissionId;
  stamp: string;
  className: string;
  title: string;
  description: string;
  tags: string;
  illustrationClassName: string;
  illustration: ReactNode;
}

const MISSION_CARDS: readonly MissionCardDefinition[] = [
  {
    id: 'mission-1',
    stamp: '실험 1',
    className: 'mission-one',
    title: '빛을 찾아서',
    description: '붓뚜껑말 군락을 목표 면적까지 성장시키세요.',
    tags: '붓뚜껑말 · 광량 관찰 · 표면 점유',
    illustrationClassName: 'sun-algae',
    illustration: <><i className="mini-sun" /><i className="mini-rock" /><i className="mini-algae" /></>,
  },
  {
    id: 'mission-2',
    stamp: '실험 2',
    className: 'mission-two',
    title: '빛의 틈새',
    description: '강한 고정 조명 아래에서 규조류가 자란 양을 목표까지 늘리세요.',
    tags: '규조류 · 제한된 자원 · 군락량',
    illustrationClassName: 'shade-algae',
    illustration: <><i className="mini-tall-rock" /><i className="mini-shade" /><i className="mini-diatom" /></>,
  },
  {
    id: 'mission-3',
    stamp: '실험 3',
    className: 'mission-three',
    title: '닿지 않는 빛',
    description: '빛이 부족한 수조에서 붓뚜껑말이 자란 양을 목표까지 늘리세요.',
    tags: '붓뚜껑말 · 제한된 빛 · 성장량',
    illustrationClassName: 'bridge-algae',
    illustration: <><i className="mini-tall-rock" /><i className="mini-rock" /><i className="mini-algae" /></>,
  },
  {
    id: 'mission-4',
    stamp: '실험 4',
    className: 'mission-four',
    title: '첫 번째 소비자',
    description: '체리새우 성체 개체 수를 일정 시간 유지하세요.',
    tags: '체리새우 · 섭식 · 개체군 유지',
    illustrationClassName: 'shrimp-ecosystem',
    illustration: (
      <>
        <i className="mini-shrimp-tail" />
        <i className="mini-shrimp-body" />
        <i className="mini-shrimp-head" />
        <i className="mini-shrimp-antenna" />
        <i className="mini-shrimp-legs" />
        <i className="mini-shrimp-algae" />
      </>
    ),
  },
  {
    id: 'mission-5',
    stamp: '실험 5',
    className: 'mission-five',
    title: '보이지 않는 순환',
    description: '균 필름과 수질의 변화를 관찰하며 체리새우 군집을 오래 유지하세요.',
    tags: '분해균 · 질산화균 · 수질 순환 · 군집 생존',
    illustrationClassName: 'microbe-cycle',
    illustration: (
      <>
        <i className="mini-cycle-arrow cycle-a" />
        <i className="mini-cycle-arrow cycle-b" />
        <i className="mini-microbe decomposer" />
        <i className="mini-microbe nitrifier" />
        <i className="mini-shrimp-water" />
      </>
    ),
  },
  {
    id: 'mission-6',
    stamp: '실험 6',
    className: 'mission-six',
    title: '밤을 건너는 수조',
    description: '전등 없는 자연광 수조에서 낮과 밤이 반복되는 동안 체리새우 군집을 유지하세요.',
    tags: '자연광 · 낮·밤 주기 · 나사말 · 광합성·호흡 · 장기 생존',
    illustrationClassName: 'day-night-cycle',
    illustration: (
      <>
        <i className="mini-day-sun" />
        <i className="mini-night-moon" />
        <i className="mini-vallisneria" />
        <i className="mini-waterline" />
      </>
    ),
  },
];
export const MISSION_IDS: readonly MissionId[] = MISSION_CARDS.map(({ id }) => id);

interface CarouselPosition {
  first: number;
  last: number;
  canScrollLeft: boolean;
  canScrollRight: boolean;
}

const initialCarouselPosition: CarouselPosition = {
  first: 0,
  last: 0,
  canScrollLeft: false,
  canScrollRight: true,
};

interface MissionMenuProps {
  completedMissions: readonly MissionId[];
  onOpen: (scenarioId: ScenarioId) => void;
  onResetMissionProgress: () => void;
}

export function MissionMenu({
  completedMissions,
  onOpen,
  onResetMissionProgress,
}: MissionMenuProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [resetComplete, setResetComplete] = useState(false);
  const [carouselPosition, setCarouselPosition] = useState<CarouselPosition>(initialCarouselPosition);
  const [draggingCarousel, setDraggingCarousel] = useState(false);
  const carouselRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startScrollLeft: number;
    moved: boolean;
  } | null>(null);
  const suppressCardClickRef = useRef(false);
  const completed = useMemo(() => new Set(completedMissions), [completedMissions]);
  const hasMissionProgress = completedMissions.length > 0;

  const updateCarouselPosition = useCallback((): void => {
    const track = carouselRef.current;
    if (!track) return;
    const cards = Array.from(track.querySelectorAll<HTMLElement>('.mission-card'));
    if (!cards.length) return;

    const viewportStart = track.scrollLeft;
    const viewportEnd = viewportStart + track.clientWidth;
    const substantiallyVisible = cards.reduce<number[]>((indices, card, index) => {
      const cardStart = card.offsetLeft;
      const cardEnd = cardStart + card.offsetWidth;
      const overlap = Math.max(0, Math.min(cardEnd, viewportEnd) - Math.max(cardStart, viewportStart));
      if (overlap >= card.offsetWidth * 0.45) indices.push(index);
      return indices;
    }, []);
    const nearestIndex = cards.reduce((nearest, card, index) => {
      const distance = Math.abs(card.offsetLeft - viewportStart);
      const nearestDistance = Math.abs(cards[nearest].offsetLeft - viewportStart);
      return distance < nearestDistance ? index : nearest;
    }, 0);
    const first = substantiallyVisible[0] ?? nearestIndex;
    const last = substantiallyVisible.at(-1) ?? nearestIndex;
    const maxScroll = Math.max(0, track.scrollWidth - track.clientWidth);

    setCarouselPosition({
      first,
      last,
      canScrollLeft: track.scrollLeft > 2,
      canScrollRight: track.scrollLeft < maxScroll - 2,
    });
  }, []);

  useEffect(() => {
    const track = carouselRef.current;
    if (!track) return undefined;
    const frame = window.requestAnimationFrame(updateCarouselPosition);
    const observer = new ResizeObserver(updateCarouselPosition);
    observer.observe(track);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [updateCarouselPosition]);

  const scrollCarousel = useCallback((direction: -1 | 1): void => {
    const track = carouselRef.current;
    const firstCard = track?.querySelector<HTMLElement>('.mission-card');
    if (!track || !firstCard) return;
    const styles = window.getComputedStyle(track);
    const gap = Number.parseFloat(styles.columnGap || styles.gap) || 0;
    track.scrollBy({ left: direction * (firstCard.offsetWidth + gap), behavior: 'smooth' });
  }, []);

  const handleCarouselWheel = useCallback((event: WheelEvent): void => {
    const track = carouselRef.current;
    if (!track) return;
    const dominantDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (dominantDelta === 0) return;
    const maxScroll = Math.max(0, track.scrollWidth - track.clientWidth);
    const canMove = dominantDelta < 0 ? track.scrollLeft > 1 : track.scrollLeft < maxScroll - 1;
    if (!canMove) return;
    const deltaScale = event.deltaMode === 1 ? 28 : event.deltaMode === 2 ? track.clientWidth : 1;
    event.preventDefault();
    track.scrollLeft += dominantDelta * deltaScale;
  }, []);

  useEffect(() => {
    const track = carouselRef.current;
    if (!track) return undefined;
    track.addEventListener('wheel', handleCarouselWheel, { passive: false });
    return () => track.removeEventListener('wheel', handleCarouselWheel);
  }, [handleCarouselWheel]);

  const handleCarouselPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    const track = carouselRef.current;
    if (!track) return;
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startScrollLeft: track.scrollLeft,
      moved: false,
    };
  };

  const handleCarouselPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const track = carouselRef.current;
    const drag = dragStateRef.current;
    if (!track || !drag || drag.pointerId !== event.pointerId) return;
    const distance = event.clientX - drag.startX;
    if (Math.abs(distance) > 5 && !drag.moved) {
      drag.moved = true;
      track.setPointerCapture(event.pointerId);
      setDraggingCarousel(true);
    }
    if (!drag.moved) return;
    event.preventDefault();
    track.scrollLeft = drag.startScrollLeft - distance;
  };

  const finishCarouselDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const track = carouselRef.current;
    const drag = dragStateRef.current;
    if (!track || !drag || drag.pointerId !== event.pointerId) return;
    if (drag.moved) {
      suppressCardClickRef.current = true;
      window.setTimeout(() => { suppressCardClickRef.current = false; }, 0);
    }
    dragStateRef.current = null;
    if (track.hasPointerCapture(event.pointerId)) track.releasePointerCapture(event.pointerId);
    setDraggingCarousel(false);
    updateCarouselPosition();
  };

  const handleCarouselKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    scrollCarousel(event.key === 'ArrowLeft' ? -1 : 1);
  };

  const closeSettings = (): void => {
    setSettingsOpen(false);
    setConfirmingReset(false);
    setResetComplete(false);
  };

  useEffect(() => {
    if (!settingsOpen) return undefined;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeSettings();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [settingsOpen]);

  const resetProgress = (): void => {
    onResetMissionProgress();
    setConfirmingReset(false);
    setResetComplete(true);
  };

  return (
    <main className="menu-screen">
      <div className="menu-water-lines" aria-hidden="true" />
      <button
        type="button"
        className="menu-settings-button"
        aria-label="설정 열기"
        aria-expanded={settingsOpen}
        aria-controls="menu-settings-dialog"
        onClick={() => {
          setSettingsOpen(true);
          setResetComplete(false);
        }}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 7h5m4 0h7M9 4v6M4 17h8m4 0h4m-4-3v6" />
        </svg>
        <span>설정</span>
      </button>

      {settingsOpen && (
        <div className="menu-settings-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeSettings();
        }}>
          <section id="menu-settings-dialog" className="menu-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="menu-settings-title">
            <button type="button" className="menu-settings-close" aria-label="설정 닫기" onClick={closeSettings}><CloseGlyph /></button>
            <p className="panel-kicker">AQUACYCLE</p>
            <h2 id="menu-settings-title">설정</h2>

            <div className="settings-progress-row">
              <div>
                <span>미션 완료 기록</span>
                <strong>완료 {completedMissions.length} / {MISSION_CARDS.length}</strong>
              </div>
              <div className="settings-progress-marks" aria-label={`완료한 미션 ${completedMissions.length}개`}>
                {MISSION_IDS.map((missionId, index) => (
                  <i key={missionId} className={completed.has(missionId) ? 'completed' : ''}>{index + 1}</i>
                ))}
              </div>
            </div>

            {resetComplete && <p className="settings-reset-complete">미션 완료 기록을 초기화했습니다.</p>}

            {confirmingReset ? (
              <div className="settings-reset-confirm">
                <strong>완료 기록을 초기화할까요?</strong>
                <p>완료 도장만 사라집니다. {MISSION_CARDS.length}개 미션과 실험실은 계속 자유롭게 선택할 수 있습니다.</p>
                <div>
                  <button type="button" onClick={() => setConfirmingReset(false)}>취소</button>
                  <button type="button" className="confirm-reset-button" onClick={resetProgress}>초기화</button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="settings-reset-button"
                disabled={!hasMissionProgress}
                onClick={() => setConfirmingReset(true)}
              >{hasMissionProgress ? '미션 완료 기록 초기화' : '초기화할 완료 기록 없음'}</button>
            )}
          </section>
        </div>
      )}

      <header className="title-card">
        <p className="eyebrow">A TINY AQUATIC ECOLOGY LAB</p>
        <h1>AquaCycle</h1>
        <p className="title-korean">아쿠아사이클 · 수중 생태 설계 시뮬레이션</p>
        <p className="title-copy">
          생물을 돌보는 대신, 스스로 균형을 찾는 수중 환경을 설계하세요.
        </p>
      </header>

      <section className="mode-section" aria-labelledby="challenge-title">
        <div className="section-heading">
          <div>
            <p className="section-number">01</p>
            <h2 id="challenge-title">도전 과제</h2>
          </div>
          <p>관찰 도구를 하나씩 익히며 생태계의 규칙을 발견합니다.</p>
        </div>

        <div className={`mission-carousel-shell ${carouselPosition.canScrollLeft ? 'can-scroll-left' : ''} ${carouselPosition.canScrollRight ? 'can-scroll-right' : ''}`}>
          <button
            type="button"
            className="mission-carousel-button previous"
            aria-label="이전 미션 보기"
            disabled={!carouselPosition.canScrollLeft}
            onClick={() => scrollCarousel(-1)}
          ><span aria-hidden="true">‹</span></button>

          <div
            ref={carouselRef}
            className={`mission-carousel-track ${draggingCarousel ? 'is-dragging' : ''}`}
            role="region"
            aria-label="도전 과제 목록"
            tabIndex={0}
            onScroll={updateCarouselPosition}
            onPointerDown={handleCarouselPointerDown}
            onPointerMove={handleCarouselPointerMove}
            onPointerUp={finishCarouselDrag}
            onPointerCancel={finishCarouselDrag}
            onKeyDown={handleCarouselKeyDown}
          >
            {MISSION_CARDS.map((mission) => (
              <button
                type="button"
                key={mission.id}
                className={`mission-card ${mission.className} ${completed.has(mission.id) ? 'completed' : ''}`}
                onClick={() => {
                  if (suppressCardClickRef.current) return;
                  onOpen(mission.id);
                }}
              >
                <span className="mission-stamp">{mission.stamp}</span>
                <span className={`mission-illustration ${mission.illustrationClassName}`} aria-hidden="true">
                  {mission.illustration}
                </span>
                <strong>{mission.title}</strong>
                <span>{mission.description}</span>
                <em>{mission.tags}</em>
                {completed.has(mission.id) && <span className="mission-complete-seal"><i aria-hidden="true">✓</i> 완료</span>}
              </button>
            ))}
          </div>

          <button
            type="button"
            className="mission-carousel-button next"
            aria-label="다음 미션 보기"
            disabled={!carouselPosition.canScrollRight}
            onClick={() => scrollCarousel(1)}
          ><span aria-hidden="true">›</span></button>
        </div>

        <div className="mission-carousel-position" aria-live="polite">
          <span>휠이나 드래그로 둘러보기</span>
          <div className="mission-carousel-rail" aria-hidden="true">
            <i style={{
              left: `${(carouselPosition.first / MISSION_CARDS.length) * 100}%`,
              width: `${((carouselPosition.last - carouselPosition.first + 1) / MISSION_CARDS.length) * 100}%`,
            }} />
          </div>
          <strong>{carouselPosition.first + 1}{carouselPosition.last > carouselPosition.first ? `–${carouselPosition.last + 1}` : ''} / {MISSION_CARDS.length}</strong>
        </div>
      </section>

      <section className="lab-banner">
        <div>
          <p className="section-number">02</p>
          <h2>실험실</h2>
          <p>조류와 체리새우, 균 필름과 수질 순환을 자유롭게 조합해 동적 평형을 시험합니다.</p>
        </div>
        <button type="button" className="primary-button" onClick={() => onOpen('laboratory')}>
          실험실 열기
        </button>
      </section>

      <footer className="menu-footer">
        <span>현재 구현 범위 · 생산자·소비자·미생물 순환</span>
        <span>Windows / macOS 데스크톱 버전</span>
      </footer>
    </main>
  );
}
