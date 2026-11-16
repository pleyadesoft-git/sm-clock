import { contextBridge, ipcRenderer } from 'electron';

export interface ElectronAPI {
  sidecar: {
    getStatus: () => Promise<{
      running: boolean;
      pid: number | null;
      port: number;
      url: string;
      error: string | null;
      restarts: number;
    }>;
    restart: () => Promise<void>;
    getRecentLogs: () => Promise<Array<{ timestamp: string; level: string; message: string }>>;
    onLog: (callback: (entry: { timestamp: string; level: string; message: string }) => void) => () => void;
  };
  safeStorage: {
    isAvailable: () => Promise<boolean>;
    encrypt: (plainText: string) => Promise<string>;
    decrypt: (cipherTextHex: string) => Promise<string>;
  };
  window: {
    minimize: () => void;
    maximize: () => void;
    close: () => void;
  };
  openExternal: (url: string) => Promise<void>;
}

const electronAPI: ElectronAPI = {
  sidecar: {
    getStatus: () => ipcRenderer.invoke('sidecar:getStatus'),
    restart: () => ipcRenderer.invoke('sidecar:restart'),
    getRecentLogs: () => ipcRenderer.invoke('sidecar:getRecentLogs'),
    onLog: (callback) => {
      const handler = (_: unknown, entry: { timestamp: string; level: string; message: string }) => {
        callback(entry);
      };
      ipcRenderer.on('sidecar:log', handler);
      return () => {
        ipcRenderer.removeListener('sidecar:log', handler);
      };
    },
  },
  safeStorage: {
    isAvailable: () => ipcRenderer.invoke('storage:isAvailable'),
    encrypt: (plainText: string) => ipcRenderer.invoke('storage:encrypt', plainText),
    decrypt: (cipherTextHex: string) => ipcRenderer.invoke('storage:decrypt', cipherTextHex),
  },
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
  },
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
