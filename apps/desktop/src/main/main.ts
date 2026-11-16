import { app, BrowserWindow, ipcMain, shell, safeStorage } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SidecarManager } from './sidecar.js';
import { AppTray } from './tray.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getRendererPath(): string {
  const candidates = [
    path.join(app.getAppPath(), 'dist/renderer/index.html'),
    path.join(__dirname, '../../renderer/index.html'),
    path.join(__dirname, '../renderer/index.html'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return path.join(app.getAppPath(), 'dist/renderer/index.html');
}

let mainWindow: BrowserWindow | null = null;
let appTray: AppTray | null = null;
const sidecar = new SidecarManager(8085);
let isQuitting = false;

// Manejo de instancia única (single instance lock)
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
  });
}

function createWindow(): BrowserWindow {
  const isWindows = process.platform === 'win32';
  const iconPath = path.resolve(
    app.getAppPath(),
    'assets',
    isWindows ? 'favicon.ico' : 'icons/icon-512.png',
  );

  const win = new BrowserWindow({
    width: 1240,
    height: 840,
    minWidth: 980,
    minHeight: 640,
    icon: iconPath,
    title: 'SM-Clock Agente Local',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#000000',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.once('ready-to-show', () => {
    win.show();
  });

  win.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      win.hide();
    }
  });

  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
  const rendererFile = getRendererPath();

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else if (isDev) {
    // Si el dev server Vite está encendido, usarlo con HMR; si no, cargar index.html compilado
    fetch('http://127.0.0.1:5173')
      .then(() => win.loadURL('http://localhost:5173'))
      .catch(() => win.loadFile(rendererFile));
  } else {
    win.loadFile(rendererFile);
  }

  win.webContents.on('did-fail-load', (_, errorCode, errorDescription) => {
    console.error(`Error al cargar interfaz de usuario (${errorCode}): ${errorDescription}`);
    if (isDev && fs.existsSync(rendererFile)) {
      win.loadFile(rendererFile);
    }
  });

  // Prevenir navegación externa en el webview
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  return win;
}

// Configurar IPC Handlers
function setupIpc() {
  ipcMain.handle('sidecar:getStatus', () => {
    return sidecar.getStatus();
  });

  ipcMain.handle('sidecar:restart', async () => {
    await sidecar.restart();
    appTray?.updateContextMenu();
    return sidecar.getStatus();
  });

  ipcMain.handle('sidecar:getRecentLogs', () => {
    return sidecar.getRecentLogs();
  });

  sidecar.onLog((entry) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('sidecar:log', entry);
    }
  });

  ipcMain.handle('storage:isAvailable', () => {
    return safeStorage.isEncryptionAvailable();
  });

  ipcMain.handle('storage:encrypt', (_, plainText: string) => {
    if (!safeStorage.isEncryptionAvailable()) {
      return Buffer.from(plainText, 'utf8').toString('base64');
    }
    const encrypted = safeStorage.encryptString(plainText);
    return encrypted.toString('hex');
  });

  ipcMain.handle('storage:decrypt', (_, cipherTextHex: string) => {
    if (!safeStorage.isEncryptionAvailable()) {
      return Buffer.from(cipherTextHex, 'base64').toString('utf8');
    }
    const buffer = Buffer.from(cipherTextHex, 'hex');
    return safeStorage.decryptString(buffer);
  });

  ipcMain.on('window:minimize', () => {
    mainWindow?.minimize();
  });

  ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });

  ipcMain.on('window:close', () => {
    mainWindow?.close();
  });

  ipcMain.handle('app:quit', async () => {
    isQuitting = true;
    appTray?.destroy();
    try {
      await sidecar.stop();
    } finally {
      app.quit();
    }
  });

  ipcMain.handle('shell:openExternal', async (_, url: string) => {
    await shell.openExternal(url);
  });
}

app.whenReady().then(async () => {
  setupIpc();

  mainWindow = createWindow();
  appTray = new AppTray(mainWindow, sidecar, () => {
    isQuitting = true;
    sidecar.stop().finally(() => {
      app.quit();
    });
  });

  // Iniciar Sidecar Python en segundo plano
  try {
    await sidecar.start();
    appTray.updateContextMenu();
  } catch (err) {
    console.error('No se pudo arrancar el sidecar en el inicio:', err);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    } else {
      mainWindow?.show();
    }
  });
});

app.on('before-quit', async (e) => {
  if (!isQuitting) {
    isQuitting = true;
    e.preventDefault();
    appTray?.destroy();
    try {
      await sidecar.stop();
    } finally {
      app.quit();
    }
  }
});

app.on('window-all-closed', () => {
  // En macOS y Windows, mantener activo en segundo plano en la bandeja
});
