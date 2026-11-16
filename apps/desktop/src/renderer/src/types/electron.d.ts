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

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
