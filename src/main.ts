import path from 'node:path';
import { app, BrowserWindow, screen, shell } from 'electron';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

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

  return window;
};

app.whenReady().then(() => {
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
