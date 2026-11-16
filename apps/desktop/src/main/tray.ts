import { Tray, Menu, nativeImage, type BrowserWindow, app } from 'electron';
import path from 'node:path';
import type { SidecarManager } from './sidecar.js';

export class AppTray {
  private tray: Tray | null = null;
  private mainWindow: BrowserWindow;
  private sidecar: SidecarManager;
  private onQuit?: () => void;

  constructor(mainWindow: BrowserWindow, sidecar: SidecarManager, onQuit?: () => void) {
    this.mainWindow = mainWindow;
    this.sidecar = sidecar;
    this.onQuit = onQuit;
    this.initTray();
  }

  private initTray() {
    const isWindows = process.platform === 'win32';
    const iconName = isWindows ? 'favicon.ico' : 'icons/icon-192.png';
    const iconPath = path.resolve(app.getAppPath(), 'assets', iconName);

    let image = nativeImage.createFromPath(iconPath);
    if (image.isEmpty()) {
      image = nativeImage.createEmpty();
    } else {
      image = image.resize({ width: 16, height: 16 });
    }

    this.tray = new Tray(image);
    this.tray.setToolTip('SM-Clock Agente Local');

    this.updateContextMenu();

    this.tray.on('click', () => {
      if (this.mainWindow.isVisible()) {
        if (this.mainWindow.isMinimized()) {
          this.mainWindow.restore();
        }
        this.mainWindow.focus();
      } else {
        this.mainWindow.show();
      }
    });
  }

  public updateContextMenu() {
    if (!this.tray) return;

    const status = this.sidecar.getStatus();
    const statusLabel = status.running
      ? `Estado: Motor Activo (:8085)`
      : `Estado: Motor Detenido`;

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Abrir SM-Clock Agente',
        click: () => {
          this.mainWindow.show();
          this.mainWindow.focus();
        },
      },
      { type: 'separator' },
      {
        label: statusLabel,
        enabled: false,
      },
      {
        label: 'Reiniciar Motor',
        click: () => {
          this.sidecar.restart().catch(() => {});
        },
      },
      { type: 'separator' },
      {
        label: 'Salir y detener agente (Cerrar totalmente)',
        click: () => {
          if (this.onQuit) {
            this.onQuit();
          } else {
            app.quit();
          }
        },
      },
    ]);

    this.tray.setContextMenu(contextMenu);
  }

  public destroy() {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }
}
