import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, screen, session, shell } from 'electron';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

const RENDER_SAFETY_REPAINT_INTERVAL_MS = 15_000;
const RUNTIME_LOG_MAX_BYTES = 256 * 1024;

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
  window.once('closed', () => clearInterval(repaintTimer));

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
