export interface TimedHistoryPoint {
  elapsedSeconds: number;
}

/**
 * Observation charts deliberately show one stable simulation-time window.
 * The window must not grow with the age of the aquarium: doing so compresses
 * every older change toward the origin during long fast-forward runs.
 */
export const ECOLOGY_HISTORY_WINDOW_SECONDS = 10 * 60;
export const ECOLOGY_HISTORY_WINDOW_OPTIONS_SECONDS = [
  2 * 60,
  5 * 60,
  ECOLOGY_HISTORY_WINDOW_SECONDS,
  20 * 60,
  30 * 60,
  60 * 60,
] as const;
export const ECOLOGY_HISTORY_RETENTION_SECONDS = 60 * 60;
export const ECOLOGY_HISTORY_MAX_POINTS = 2_000;

export interface HistoryTimeBounds {
  start: number;
  end: number;
}

export const historyTimeBounds = (
  latestElapsedSeconds: number,
  windowSeconds = ECOLOGY_HISTORY_WINDOW_SECONDS,
): HistoryTimeBounds => {
  const safeWindow = Math.max(1, windowSeconds);
  const latest = Math.max(0, latestElapsedSeconds);
  const end = Math.max(safeWindow, latest);
  return { start: end - safeWindow, end };
};

export const historyTimeX = (
  elapsedSeconds: number,
  bounds: HistoryTimeBounds,
  left: number,
  right: number,
): number => {
  const span = Math.max(1e-6, bounds.end - bounds.start);
  const ratio = Math.max(0, Math.min(1, (elapsedSeconds - bounds.start) / span));
  return left + ratio * (right - left);
};

export const appendRollingHistory = <Point extends TimedHistoryPoint>(
  current: readonly Point[],
  point: Point,
  windowSeconds = ECOLOGY_HISTORY_RETENTION_SECONDS,
  maximumPoints = ECOLOGY_HISTORY_MAX_POINTS,
): Point[] => {
  const cutoff = Math.max(0, point.elapsedSeconds - Math.max(1, windowSeconds));
  const firstRetained = current.findIndex((entry) => entry.elapsedSeconds >= cutoff);
  const retained = firstRetained < 0
    ? []
    : current.slice(firstRetained);
  return [...retained, point].slice(-Math.max(2, maximumPoints));
};

/** Returns only samples that belong to the selected visible time scale. */
export const historyPointsInWindow = <Point extends TimedHistoryPoint>(
  points: readonly Point[],
  windowSeconds: number,
): Point[] => {
  const latest = points.at(-1)?.elapsedSeconds ?? 0;
  const bounds = historyTimeBounds(latest, windowSeconds);
  return points.filter((point) => point.elapsedSeconds >= bounds.start);
};
