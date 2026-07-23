import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  BACKGROUND_TELEMETRY_POLL_INTERVAL_MS,
  startTelemetryPolling,
  type TelemetryPollingClock,
} from '../src/renderer/hooks/useSimulation';

describe('background simulation continuity', () => {
  it('keeps ecology snapshot collection alive when animation frames stop', () => {
    let frameCallback: FrameRequestCallback | null = null;
    let timerCallback: (() => void) | null = null;
    const cancelAnimationFrame = vi.fn();
    const clearInterval = vi.fn();
    const clock: TelemetryPollingClock = {
      requestAnimationFrame: vi.fn((callback) => {
        frameCallback = callback;
        return 41;
      }),
      cancelAnimationFrame,
      setInterval: vi.fn((callback, intervalMs) => {
        expect(intervalMs).toBe(BACKGROUND_TELEMETRY_POLL_INTERVAL_MS);
        timerCallback = callback;
        return 73;
      }),
      clearInterval,
    };
    const pollSnapshot = vi.fn();
    const pollMotion = vi.fn();

    const stop = startTelemetryPolling(pollSnapshot, pollMotion, clock);

    // A minimized window may not paint another frame. The independent timer
    // must still consume full snapshots for mission state and graph history.
    expect(timerCallback).not.toBeNull();
    (timerCallback as unknown as () => void)();
    (timerCallback as unknown as () => void)();
    expect(pollSnapshot).toHaveBeenCalledTimes(2);
    expect(pollMotion).not.toHaveBeenCalled();

    // Visible frames collect both topology and motion in the established order.
    expect(frameCallback).not.toBeNull();
    (frameCallback as unknown as FrameRequestCallback)(100);
    expect(pollSnapshot).toHaveBeenCalledTimes(3);
    expect(pollMotion).toHaveBeenCalledTimes(1);

    stop();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(41);
    expect(clearInterval).toHaveBeenCalledWith(73);
  });

  it('disables Electron timer throttling for the simulation window', () => {
    const mainSource = fs.readFileSync(
      path.resolve(process.cwd(), 'src/main.ts'),
      'utf8',
    );
    expect(mainSource).toContain('backgroundThrottling: false');
  });

  it('pauses only Pixi painting while the desktop window is hidden', () => {
    const preloadSource = fs.readFileSync(
      path.resolve(process.cwd(), 'src/preload.ts'),
      'utf8',
    );
    const canvasSource = fs.readFileSync(
      path.resolve(process.cwd(), 'src/renderer/tank/AquariumCanvas.tsx'),
      'utf8',
    );
    expect(preloadSource).toContain('aquacycle:rendering-visibility');
    expect(canvasSource).toContain('onRenderingVisibilityChange');
    expect(canvasSource).toContain('app.stop();');
    expect(canvasSource).toContain('app.start();');
  });

  it('forces stale visible compositor surfaces to repaint and records process loss', () => {
    const mainSource = fs.readFileSync(
      path.resolve(process.cwd(), 'src/main.ts'),
      'utf8',
    );
    expect(mainSource).toContain('window.webContents.invalidate()');
    expect(mainSource).toContain("window.webContents.on('render-process-gone'");
    expect(mainSource).toContain('window.webContents.reload()');
    expect(mainSource).toContain("app.on('child-process-gone'");
    expect(mainSource).toContain('renderer-health.log');
  });
});
