import { contextBridge, ipcRenderer } from 'electron';

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
});
