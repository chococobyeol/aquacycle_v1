import { describe, expect, it } from 'vitest';
import {
  appendRollingHistory,
  ECOLOGY_HISTORY_RETENTION_SECONDS,
  ECOLOGY_HISTORY_WINDOW_SECONDS,
  ECOLOGY_HISTORY_WINDOW_OPTIONS_SECONDS,
  historyPointsInWindow,
  historyTimeBounds,
  historyTimeX,
} from '../src/renderer/ui/ecologyHistory';

describe('rolling ecology history window', () => {
  it('retains enough history to expand the visible time window later', () => {
    let points: { elapsedSeconds: number; value: number }[] = [];
    for (let elapsedSeconds = 0; elapsedSeconds <= 4_500; elapsedSeconds += 2) {
      points = appendRollingHistory(points, { elapsedSeconds, value: elapsedSeconds });
    }

    expect(points.at(-1)?.elapsedSeconds).toBe(4_500);
    expect(points[0]?.elapsedSeconds).toBeGreaterThanOrEqual(
      4_500 - ECOLOGY_HISTORY_RETENTION_SECONDS,
    );
    expect(points).toHaveLength(1_801);
  });

  it('selects only the samples in the requested visible window', () => {
    const points = Array.from({ length: 451 }, (_, index) => ({
      elapsedSeconds: index * 2,
    }));

    const visible = historyPointsInWindow(points, 5 * 60);
    expect(visible[0]?.elapsedSeconds).toBe(600);
    expect(visible.at(-1)?.elapsedSeconds).toBe(900);
    expect(ECOLOGY_HISTORY_WINDOW_OPTIONS_SECONDS).toEqual([
      120, 300, 600, 1_200, 1_800, 3_600,
    ]);
  });

  it('uses a stable ten-minute axis from the beginning and then slides it', () => {
    expect(historyTimeBounds(120)).toEqual({ start: 0, end: 600 });
    expect(historyTimeBounds(900)).toEqual({ start: 300, end: 900 });
  });

  it('positions irregular samples by their actual simulation time', () => {
    const bounds = historyTimeBounds(900);
    expect(historyTimeX(300, bounds, 40, 190)).toBeCloseTo(40);
    expect(historyTimeX(450, bounds, 40, 190)).toBeCloseTo(77.5);
    expect(historyTimeX(900, bounds, 40, 190)).toBeCloseTo(190);
  });
});
