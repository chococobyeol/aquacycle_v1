import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, BrowserWindow, ipcMain, screen, session, shell } from 'electron';
import {
  createRendererMemoryGuardState,
  evaluateRendererMemoryGuard,
  MEMORY_RECOVERY_COOLDOWN_MS,
} from './runtimeMemoryGuard';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

const RENDER_SAFETY_REPAINT_INTERVAL_MS = 15_000;
const RUNTIME_LOG_MAX_BYTES = 256 * 1024;
const MEMORY_RECOVERY_PREPARE_TIMEOUT_MS = 20_000;
const MEMORY_RECOVERY_MINIMUM_LOADING_MS = 900;
let lastMemoryRecoveryAt = Number.NEGATIVE_INFINITY;
const intentionalRendererRestarts = new WeakSet<Electron.WebContents>();

interface RendererMemoryReport {
  privateKb: number;
  heapUsedKb: number;
  heapTotalKb: number;
}

const isRendererMemoryReport = (value: unknown): value is RendererMemoryReport => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<RendererMemoryReport>;
  return Number.isFinite(candidate.privateKb) &&
    Number.isFinite(candidate.heapUsedKb) &&
    Number.isFinite(candidate.heapTotalKb);
};

const appendRuntimeDiagnostic = (message: string): void => {
  try {
    const logPath = path.join(app.getPath('userData'), 'renderer-health.log');
    if (fs.existsSync(logPath) && fs.statSync(logPath).size > RUNTIME_LOG_MAX_BYTES) {
      fs.rmSync(`${logPath}.previous`, { force: true });
      fs.renameSync(logPath, `${logPath}.previous`);
    }
    fs.appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`, 'utf8');
  } catch {
    // Diagnostics must never interfere with launching or recovering the game.
  }
};

const createRecoveryWindow = (
  bounds: Electron.Rectangle,
  parent: BrowserWindow,
): BrowserWindow => {
  const recoveryWindow = new BrowserWindow({
    ...bounds,
    parent,
    frame: false,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: '#3f858b',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const markup = `<!doctype html>
    <html lang="ko">
      <meta charset="utf-8">
      <title>AquaCycle · 아쿠아사이클</title>
      <style>
        html,body{width:100%;height:100%;margin:0}
        body{display:grid;place-items:center;overflow:hidden;background:#3f858b;color:#344f4d;
          font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo",sans-serif}
        main{position:relative;padding:28px 32px 25px;border:3px solid #466863;
          border-radius:18px 14px 20px 15px;background:#f5f1df;
          box-shadow:7px 9px 0 rgba(52,79,77,.18);text-align:center}
        i{display:block;width:42px;height:42px;margin:0 auto 18px;border:5px solid #b7cbc2;
          border-top-color:#4f7f78;border-radius:50%;animation:spin .8s linear infinite}
        strong{display:block;font-size:18px}
        p{margin:8px 0 0;color:#607873;font-size:13px}
        @keyframes spin{to{transform:rotate(360deg)}}
      </style>
      <body><main role="status" aria-live="assertive"><i></i>
        <strong>수조 상태를 안전하게 정리하고 있습니다…</strong>
        <p>잠시 후 같은 지점부터 자동으로 계속됩니다.</p>
      </main></body>
    </html>`;
  void recoveryWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(markup)}`);
  recoveryWindow.once('ready-to-show', () => recoveryWindow.showInactive());
  return recoveryWindow;
};

const reloadMainRenderer = async (
  window: BrowserWindow,
  onComplete: (success: boolean) => void,
): Promise<void> => {
  if (window.isDestroyed()) return;
  const bounds = window.getContentBounds();
  // Do not ask an already memory-heavy renderer to capture and PNG/base64
  // encode its full frame. The former recovery path duplicated that frame
  // into a giant data URL in the browser process; the 2026-08-06 soak reached
  // its checkpoint and then trapped the Electron main process before renderer
  // recycling began. A tiny static cover keeps recovery independent from the
  // renderer whose native allocator is being discarded.
  const recoveryWindow = createRecoveryWindow(bounds, window);

  let finished = false;
  let readyTimeout: ReturnType<typeof setTimeout> | null = null;
  const finish = (success: boolean): void => {
    if (finished) return;
    finished = true;
    if (readyTimeout !== null) clearTimeout(readyTimeout);
    ipcMain.removeListener('aquacycle:renderer-ready', receiveRendererReady);
    if (!recoveryWindow.isDestroyed()) recoveryWindow.destroy();
    appendRuntimeDiagnostic(
      success
        ? 'memory recovery: renderer restored in the existing window'
        : 'memory recovery: renderer reload timed out',
    );
    onComplete(success);
  };
  const receiveRendererReady = (event: Electron.IpcMainEvent): void => {
    if (event.sender !== window.webContents) return;
    finish(true);
  };
  const reload = (): void => {
    if (window.isDestroyed()) {
      finish(false);
      return;
    }
    appendRuntimeDiagnostic('memory recovery: recycling renderer process');
    ipcMain.on('aquacycle:renderer-ready', receiveRendererReady);
    readyTimeout = setTimeout(
      () => finish(false),
      MEMORY_RECOVERY_PREPARE_TIMEOUT_MS,
    );
    setTimeout(() => {
      if (window.isDestroyed()) {
        finish(false);
        return;
      }
      const restartAfterExit = (): void => {
        setTimeout(() => {
          if (!window.isDestroyed()) window.webContents.reload();
        }, 50);
      };
      window.webContents.once('render-process-gone', restartAfterExit);
      intentionalRendererRestarts.add(window.webContents);
      try {
        // A normal reload keeps Chromium's renderer process and its native
        // allocator high-water mark. Recycle only that process while the
        // unchanged native window is covered by the lightweight recovery view.
        window.webContents.forcefullyCrashRenderer();
      } catch {
        window.webContents.removeListener(
          'render-process-gone',
          restartAfterExit,
        );
        intentionalRendererRestarts.delete(window.webContents);
        window.webContents.reload();
      }
    }, MEMORY_RECOVERY_MINIMUM_LOADING_MS);
  };
  if (recoveryWindow.webContents.isLoading()) {
    recoveryWindow.webContents.once('did-finish-load', reload);
  } else {
    reload();
  }
};

const createMainWindow = (): BrowserWindow => {
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  // Keep the initial window inside compact MacBook work areas instead of
  // creating a 1440x900 surface that is clipped beyond every screen edge.
  const minWidth = Math.min(960, workArea.width);
  const minHeight = Math.min(600, workArea.height);
  const width = Math.min(1440, Math.max(minWidth, workArea.width - 24));
  const height = Math.min(900, Math.max(minHeight, workArea.height - 24));
  const window = new BrowserWindow({
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
    width,
    height,
    minWidth,
    minHeight,
    backgroundColor: '#e8efe8',
    title: 'AquaCycle · 아쿠아사이클',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // AquaCycle is a continuously running simulation, not a document tab.
      // Electron otherwise throttles renderer and worker timers when the
      // window is minimized or covered, changing both the simulated result
      // and the graph samples collected during the same wall-clock period.
      backgroundThrottling: false,
    },
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    void window.loadFile(
      path.join(
        __dirname,
        `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`,
      ),
    );
  }

  const receiveRendererReady = (event: Electron.IpcMainEvent): void => {
    if (event.sender !== window.webContents) return;
    appendRuntimeDiagnostic('renderer reported first complete aquarium frame');
  };
  ipcMain.on('aquacycle:renderer-ready', receiveRendererReady);
  window.once('ready-to-show', () => window.show());
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });

  const notifyRenderingVisibility = (visible: boolean): void => {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send('aquacycle:rendering-visibility', visible);
    }
  };
  const requestWindowRepaint = (reason: string): void => {
    if (window.isDestroyed() || window.webContents.isDestroyed()) return;
    appendRuntimeDiagnostic(`repaint requested: ${reason}`);
    window.webContents.invalidate();
  };
  const resumeVisibleRendering = (reason: string): void => {
    notifyRenderingVisibility(true);
    requestWindowRepaint(reason);
  };
  const memoryGuard = createRendererMemoryGuardState();
  let memoryRecoveryInProgress = false;
  let memoryRecoveryTimeout: ReturnType<typeof setTimeout> | null = null;
  const recordRendererMemory = (
    event: Electron.IpcMainEvent,
    report: unknown,
  ): void => {
    if (event.sender !== window.webContents || !isRendererMemoryReport(report)) return;
    const privateMb = report.privateKb / 1024;
    appendRuntimeDiagnostic(
      `renderer memory: pid=${window.webContents.getOSProcessId()} ` +
      `privateMb=${privateMb.toFixed(1)} ` +
      `heapUsedMb=${(report.heapUsedKb / 1024).toFixed(1)} ` +
      `heapTotalMb=${(report.heapTotalKb / 1024).toFixed(1)}`,
    );
    const now = Date.now();
    const recoveryAllowed =
      !memoryRecoveryInProgress &&
      now - lastMemoryRecoveryAt >= MEMORY_RECOVERY_COOLDOWN_MS;
    const decision = evaluateRendererMemoryGuard(
      memoryGuard,
      privateMb,
      os.totalmem(),
      recoveryAllowed,
    );
    if (!decision.shouldRecover) return;

    memoryRecoveryInProgress = true;
    lastMemoryRecoveryAt = now;
    appendRuntimeDiagnostic(
      `memory recovery requested: privateMb=${privateMb.toFixed(1)} ` +
      `growthMb=${decision.growthMb.toFixed(1)} ` +
      `thresholdMb=${decision.thresholdMb.toFixed(1)}`,
    );
    window.webContents.send('aquacycle:prepare-memory-recovery', {
      privateMb,
      thresholdMb: decision.thresholdMb,
    });
    memoryRecoveryTimeout = setTimeout(() => {
      memoryRecoveryTimeout = null;
      memoryRecoveryInProgress = false;
      appendRuntimeDiagnostic('memory recovery: renderer did not prepare a checkpoint');
    }, MEMORY_RECOVERY_PREPARE_TIMEOUT_MS);
  };
  const finishMemoryRecovery = (
    event: Electron.IpcMainEvent,
    success: unknown,
  ): void => {
    if (
      event.sender !== window.webContents ||
      !memoryRecoveryInProgress ||
      typeof success !== 'boolean'
    ) return;
    if (memoryRecoveryTimeout !== null) {
      clearTimeout(memoryRecoveryTimeout);
      memoryRecoveryTimeout = null;
    }
    if (!success) {
      memoryRecoveryInProgress = false;
      appendRuntimeDiagnostic('memory recovery: checkpoint preparation failed');
      return;
    }
    appendRuntimeDiagnostic('memory recovery: checkpoint prepared');
    void reloadMainRenderer(window, () => {
      memoryRecoveryInProgress = false;
      memoryGuard.minimumPrivateMb = Number.POSITIVE_INFINITY;
      memoryGuard.recentPrivateMb.length = 0;
    });
  };
  ipcMain.on('aquacycle:renderer-memory', recordRendererMemory);
  ipcMain.on('aquacycle:memory-recovery-ready', finishMemoryRecovery);

  window.on('minimize', () => notifyRenderingVisibility(false));
  window.on('hide', () => notifyRenderingVisibility(false));
  window.on('restore', () => resumeVisibleRendering('window restored'));
  window.on('show', () => resumeVisibleRendering('window shown'));
  window.on('focus', () => {
    if (!window.isMinimized()) resumeVisibleRendering('window focused');
  });
  window.webContents.on('did-finish-load', () => {
    notifyRenderingVisibility(window.isVisible() && !window.isMinimized());
    requestWindowRepaint('renderer loaded');
  });
  window.webContents.on('unresponsive', () => {
    appendRuntimeDiagnostic('renderer became unresponsive');
  });
  window.webContents.on('responsive', () => {
    appendRuntimeDiagnostic('renderer became responsive');
    requestWindowRepaint('renderer responsive');
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    appendRuntimeDiagnostic(
      `renderer process gone: reason=${details.reason} exitCode=${details.exitCode}`,
    );
    if (intentionalRendererRestarts.has(window.webContents)) {
      intentionalRendererRestarts.delete(window.webContents);
      appendRuntimeDiagnostic('memory recovery: old renderer process released');
      return;
    }
    if (details.reason === 'clean-exit') return;
    // Once Chromium has terminated the renderer, repaint requests cannot
    // revive it—the BrowserWindow remains as a blank native surface. Start a
    // fresh renderer so the player gets a usable mission menu instead of a
    // permanently white window. The underlying cause is retained in the
    // health log before recovery begins.
    setTimeout(() => {
      if (window.isDestroyed() || window.webContents.isDestroyed()) return;
      window.webContents.reload();
    }, 250);
  });

  // A Chromium compositor can rarely retain a blank surface without killing
  // the renderer or emitting a WebGL context-loss event. invalidate() is a
  // no-op beyond the next normal paint while healthy, but guarantees that a
  // visible stale surface cannot remain white indefinitely.
  const repaintTimer = setInterval(() => {
    if (window.isVisible() && !window.isMinimized()) {
      window.webContents.invalidate();
    }
  }, RENDER_SAFETY_REPAINT_INTERVAL_MS);
  repaintTimer.unref();
  window.once('closed', () => {
    clearInterval(repaintTimer);
    if (memoryRecoveryTimeout !== null) clearTimeout(memoryRecoveryTimeout);
    ipcMain.removeListener('aquacycle:renderer-memory', recordRendererMemory);
    ipcMain.removeListener(
      'aquacycle:memory-recovery-ready',
      finishMemoryRecovery,
    );
    ipcMain.removeListener('aquacycle:renderer-ready', receiveRendererReady);
  });

  return window;
};

app.whenReady().then(() => {
  // SharedArrayBuffer is used for the long-running simulation telemetry
  // channels. Apply the same cross-origin isolation policy to packaged file
  // pages that the Vite development server supplies over HTTP.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Cross-Origin-Opener-Policy': ['same-origin'],
        'Cross-Origin-Embedder-Policy': ['require-corp'],
      },
    });
  });
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('child-process-gone', (_event, details) => {
  appendRuntimeDiagnostic(
    `child process gone: type=${details.type} reason=${details.reason} exitCode=${details.exitCode}`,
  );
  if (details.type !== 'GPU') return;
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed() || window.webContents.isDestroyed()) continue;
    setTimeout(() => window.webContents.invalidate(), 250);
    setTimeout(() => window.webContents.invalidate(), 1_000);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
