import { contextBridge, ipcRenderer } from 'electron';

const RENDERER_MEMORY_REPORT_INTERVAL_MS = 60_000;

const reportRendererMemory = async (): Promise<void> => {
  try {
    const memory = await process.getProcessMemoryInfo();
    const heap = process.getHeapStatistics();
    ipcRenderer.send('aquacycle:renderer-memory', {
      privateKb: memory.private,
      heapUsedKb: heap.usedHeapSize,
      heapTotalKb: heap.totalHeapSize,
    });
  } catch {
    // A diagnostic sample must never interfere with the simulation preload.
  }
};

void reportRendererMemory();
setInterval(() => void reportRendererMemory(), RENDERER_MEMORY_REPORT_INTERVAL_MS);

contextBridge.exposeInMainWorld('aquacycleDesktop', {
  platform: process.platform,
  versions: {
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  },
  onRenderingVisibilityChange: (listener: (visible: boolean) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, visible: boolean): void => {
      listener(visible);
    };
    ipcRenderer.on('aquacycle:rendering-visibility', handler);
    return () => ipcRenderer.removeListener('aquacycle:rendering-visibility', handler);
  },
  onSimulationMemoryPressure: (listener: (privateMb: number) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      privateMb: number,
    ): void => {
      listener(privateMb);
    };
    ipcRenderer.on('aquacycle:simulation-memory-pressure', handler);
    return () =>
      ipcRenderer.removeListener('aquacycle:simulation-memory-pressure', handler);
  },
});
