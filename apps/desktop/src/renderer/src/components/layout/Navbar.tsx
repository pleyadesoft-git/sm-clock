import React, { useState, useEffect } from 'react';
import { SmClockLogo } from '../ui/sm-clock-logo';
import { ThemeToggle } from '../ui/theme-toggle';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { useAuth } from '../../context/AuthContext';
import { agentApi } from '../../lib/agent-api';
import {
  Watch,
  Activity,
  Terminal,
  LogOut,
  RefreshCw,
  Minus,
  Square,
  X,
  Building2,
  Power,
} from 'lucide-react';
import { ConfirmDialog } from '../ui/confirm-dialog';

interface NavbarProps {
  currentTab: 'relojes' | 'monitor' | 'logs';
  onTabChange: (tab: 'relojes' | 'monitor' | 'logs') => void;
  errorCount?: number;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentTab,
  onTabChange,
  errorCount = 0,
}) => {
  const { user, tenants, selectedTenantId, setSelectedTenantId, logout } = useAuth();
  const [sidecarRunning, setSidecarRunning] = useState<boolean>(true);
  const [restarting, setRestarting] = useState<boolean>(false);
  const [showLogoutDialog, setShowLogoutDialog] = useState<boolean>(false);
  const [showQuitDialog, setShowQuitDialog] = useState<boolean>(false);

  const isMac = navigator.platform.toUpperCase().includes('MAC');

  const handleQuitApp = async () => {
    if (window.electronAPI?.quitApp) {
      await window.electronAPI.quitApp();
    } else {
      await logout();
      window.close();
    }
  };

  useEffect(() => {
    async function checkSidecar() {
      try {
        if (window.electronAPI?.sidecar?.getStatus) {
          const st = await window.electronAPI.sidecar.getStatus();
          setSidecarRunning(st.running);
        } else {
          const st = await agentApi.getStatus();
          setSidecarRunning(Boolean(st.bind));
        }
      } catch {
        setSidecarRunning(false);
      }
    }

    checkSidecar();
    const interval = setInterval(checkSidecar, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleRestartMotor = async () => {
    setRestarting(true);
    try {
      if (window.electronAPI?.sidecar?.restart) {
        await window.electronAPI.sidecar.restart();
      }
      setSidecarRunning(true);
    } catch {
      // Ignorar fallo puntual
    } finally {
      setRestarting(false);
    }
  };

  return (
    <header className="sticky top-0 z-40 bg-[var(--surface-translucent)] backdrop-blur-xl border-b border-[var(--separator)] select-none">
      {/* Barra superior con controles de ventana e información del motor */}
      <div className={`h-14 px-4 flex items-center justify-between gap-3 ${isMac ? 'pl-20' : ''}`}>
        {/* Logo y título */}
        <div className="flex items-center gap-2.5">
          <SmClockLogo size={28} />
          <div className="flex flex-col">
            <span className="font-bold text-sm leading-tight text-[var(--text)]">SM-Clock</span>
            <span className="text-xs text-[var(--text-2)] font-medium leading-none">
              Agente de Sincronización
            </span>
          </div>

          {/* Badge del Motor Local */}
          <div className="ml-3 hidden sm:flex items-center">
            {sidecarRunning ? (
              <Badge
                variant="outline"
                className="text-xs bg-[var(--success-bg)] text-[var(--success)] border-[var(--success)] flex items-center gap-1.5 py-0.5 px-2"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--success)] animate-pulse" />
                <span>Motor Activo (:8085)</span>
              </Badge>
            ) : (
              <div className="flex items-center gap-1.5">
                <Badge
                  variant="outline"
                  className="text-xs bg-[var(--danger-bg)] text-[var(--danger)] border-[var(--danger)] py-0.5 px-2"
                >
                  Motor Detenido
                </Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-1.5 text-xs text-[var(--accent)]"
                  onClick={handleRestartMotor}
                  disabled={restarting}
                >
                  <RefreshCw className={`w-3 h-3 mr-1 ${restarting ? 'animate-spin' : ''}`} />
                  Reiniciar
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Pestañas de Navegación Centrales */}
        <nav className="flex items-center gap-1 bg-[var(--surface-2)] p-1 rounded-[var(--r-md)] border border-[var(--separator)]">
          <button
            onClick={() => onTabChange('relojes')}
            className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-[var(--r-sm)] transition-all cursor-pointer ${
              currentTab === 'relojes'
                ? 'bg-[var(--surface)] text-[var(--text)] shadow-[var(--shadow-1)]'
                : 'text-[var(--text-2)] hover:text-[var(--text)]'
            }`}
          >
            <Watch className="w-3.5 h-3.5" />
            <span>Terminales</span>
          </button>

          <button
            onClick={() => onTabChange('monitor')}
            className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-[var(--r-sm)] transition-all cursor-pointer ${
              currentTab === 'monitor'
                ? 'bg-[var(--surface)] text-[var(--text)] shadow-[var(--shadow-1)]'
                : 'text-[var(--text-2)] hover:text-[var(--text)]'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Monitor en Vivo</span>
          </button>

          <button
            onClick={() => onTabChange('logs')}
            className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-[var(--r-sm)] transition-all cursor-pointer ${
              currentTab === 'logs'
                ? 'bg-[var(--surface)] text-[var(--text)] shadow-[var(--shadow-1)]'
                : 'text-[var(--text-2)] hover:text-[var(--text)]'
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>Logs & Errores</span>
            {errorCount > 0 && (
              <span className="min-w-4 h-4 px-1 rounded-full bg-[var(--danger)] text-[var(--text-on-accent)] text-xs leading-none font-bold flex items-center justify-center ml-0.5">
                {errorCount > 99 ? '99+' : errorCount}
              </span>
            )}
          </button>
        </nav>

        {/* Acciones de usuario y controles de ventana */}
        <div className="flex items-center gap-2">
          {/* Selector de Tenant para Super-Admin */}
          {user?.rol === 'SUPER_ADMIN' && tenants.length > 0 && (
            <div className="hidden md:flex items-center gap-1.5 text-xs text-[var(--text)]">
              <Building2 className="w-3.5 h-3.5 text-[var(--text-2)]" />
              <select
                value={selectedTenantId || ''}
                onChange={(e) => setSelectedTenantId(e.target.value)}
                className="h-8 text-xs bg-[var(--surface-2)] text-[var(--text)] border border-[var(--separator)] rounded-[var(--r-sm)] px-2 outline-none cursor-pointer"
              >
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nombre}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Badge para Admin de Empresa */}
          {user?.rol !== 'SUPER_ADMIN' && (
            <div className="hidden lg:flex items-center gap-1.5 px-2 py-1 rounded-[var(--r-sm)] bg-[var(--surface-2)] text-xs text-[var(--text-2)] border border-[var(--separator)]">
              <span className="font-semibold text-[var(--text)]">{user?.rol === 'ADMIN_EMPRESA' ? 'Admin' : 'Operador'}:</span>
              <span className="max-w-36 truncate">{user?.email}</span>
            </div>
          )}

          <ThemeToggle />

          {/* Botón explícito para cerrar sesión (mantiene el motor activo) */}
          <Button
            variant="outline"
            size="sm"
            className="h-8 px-2.5 text-xs text-[var(--text)] border-[var(--separator)] hover:bg-[var(--surface-2)] flex items-center gap-1.5 cursor-pointer"
            onClick={() => setShowLogoutDialog(true)}
            title="Cerrar sesión actual (el agente sigue operando y leyendo marcas)"
          >
            <LogOut className="w-3.5 h-3.5 text-[var(--text-2)]" />
            <span className="hidden sm:inline font-medium">Cerrar sesión</span>
          </Button>

          {/* Botón para apagar y cerrar totalmente el agente */}
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 text-[var(--text-2)] hover:text-[var(--danger)] hover:bg-[var(--danger-bg)] transition-colors cursor-pointer"
            onClick={() => setShowQuitDialog(true)}
            title="Cerrar totalmente el agente (apagar motor)"
          >
            <Power className="w-4 h-4" />
          </Button>

          {/* Controles de ventana en Windows/Linux */}
          {!isMac && (
            <div className="flex items-center ml-1 border-l border-[var(--separator)] pl-1">
              <button
                onClick={() => window.electronAPI?.window?.minimize()}
                className="h-8 w-8 flex items-center justify-center text-[var(--text-2)] hover:bg-[var(--surface-2)] rounded cursor-pointer"
                title="Minimizar a bandeja"
              >
                <Minus className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => window.electronAPI?.window?.maximize()}
                className="h-8 w-8 flex items-center justify-center text-[var(--text-2)] hover:bg-[var(--surface-2)] rounded cursor-pointer"
                title="Maximizar"
              >
                <Square className="w-3 h-3" />
              </button>
              <button
                onClick={() => window.electronAPI?.window?.close()}
                className="h-8 w-8 flex items-center justify-center text-[var(--text-2)] hover:bg-[var(--danger)] hover:text-white rounded cursor-pointer"
                title="Cerrar ventana (sigue activo en bandeja)"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Diálogo de Confirmación: Cerrar Sesión (Mantiene Motor Activo) */}
      <ConfirmDialog
        open={showLogoutDialog}
        onOpenChange={setShowLogoutDialog}
        title="¿Cerrar sesión de administrador?"
        description="Se cerrará únicamente tu sesión actual. El motor del agente continuará operando en segundo plano, leyendo checadas de los relojes y sincronizándolas con la nómina. La ventana quedará lista para que otro administrador inicie sesión."
        confirmText="Cerrar sesión"
        cancelText="Continuar conectado"
        destructive={false}
        onConfirm={logout}
      />

      {/* Diálogo de Confirmación: Apagar Motor y Cerrar Totalmente */}
      <ConfirmDialog
        open={showQuitDialog}
        onOpenChange={setShowQuitDialog}
        title="¿Cerrar totalmente el agente?"
        description="Se detendrá el motor local y la aplicación se cerrará por completo. Durante este tiempo no se leerán marcas de los relojes biométricos ni se sincronizarán con la nómina hasta que vuelvas a abrir la aplicación."
        confirmText="Cerrar y apagar motor"
        cancelText="Mantener activo"
        destructive={true}
        onConfirm={handleQuitApp}
      />
    </header>
  );
};
