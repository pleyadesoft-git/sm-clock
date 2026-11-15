'use client';

import * as React from 'react';
import { RefreshCw, Download, Sparkles, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export function PwaUpdateNotifier() {
  const [waitingWorker, setWaitingWorker] =
    React.useState<ServiceWorker | null>(null);
  const [showUpdatePrompt, setShowUpdatePrompt] = React.useState(false);
  const [isUpdating, setIsUpdating] = React.useState(false);

  // Fallback install prompt
  const [deferredPrompt, setDeferredPrompt] =
    React.useState<BeforeInstallPromptEvent | null>(null);
  const [showInstallPrompt, setShowInstallPrompt] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }

    let refreshing = false;
    // Escuchar cuando el nuevo SW tome el control para recargar la página limpia
    const handleControllerChange = () => {
      if (!refreshing) {
        refreshing = true;
        window.location.reload();
      }
    };
    navigator.serviceWorker.addEventListener(
      'controllerchange',
      handleControllerChange,
    );

    // Registro del Service Worker
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        // 1. Si ya había un SW esperando (ej. descargado en segundo plano previamente)
        if (reg.waiting) {
          setWaitingWorker(reg.waiting);
          setShowUpdatePrompt(true);
        }

        // Forzar verificación de actualización de inmediato al cargar la página
        void reg.update().catch(() => {});

        // 2. Si se está instalando uno nuevo actualmente
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (!newWorker) return;

          newWorker.addEventListener('statechange', () => {
            // Cuando finaliza la instalación y entra en estado "installed" (waiting)
            if (
              newWorker.state === 'installed' &&
              navigator.serviceWorker.controller
            ) {
              setWaitingWorker(newWorker);
              setShowUpdatePrompt(true);
            }
          });
        });

        // Comprobar periódicamente si hay actualizaciones (cada 30 min) y al reenfocar
        const intervalId = window.setInterval(
          () => {
            void reg.update().catch(() => {});
          },
          30 * 60 * 1000,
        );

        const handleFocus = () => {
          void reg.update().catch(() => {});
        };
        window.addEventListener('focus', handleFocus);

        return () => {
          window.clearInterval(intervalId);
          window.removeEventListener('focus', handleFocus);
        };
      })
      .catch(() => {
        // En entornos donde SW no es permitido o SSL local no está configurado se omite de forma segura
      });

    // Escuchar evento beforeinstallprompt para ofrecer instalación si el usuario lo desea
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      // Solo mostrar banner de instalar si no se está mostrando ya el de update
      setShowInstallPrompt(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);

    return () => {
      navigator.serviceWorker.removeEventListener(
        'controllerchange',
        handleControllerChange,
      );
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
    };
  }, []);

  const handleApplyUpdate = React.useCallback(() => {
    if (!waitingWorker) {
      window.location.reload();
      return;
    }
    setIsUpdating(true);
    // Notificar al SW esperando que ejecute skipWaiting()
    waitingWorker.postMessage({ type: 'SKIP_WAITING' });
  }, [waitingWorker]);

  const handleInstallApp = React.useCallback(async () => {
    if (!deferredPrompt) return;
    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        setShowInstallPrompt(false);
      }
    } catch {
      // Ignorar cancelaciones
    } finally {
      setDeferredPrompt(null);
      setShowInstallPrompt(false);
    }
  }, [deferredPrompt]);

  // Si hay una actualización disponible, el banner de actualización tiene máxima prioridad
  if (showUpdatePrompt) {
    return (
      <aside
        role="region"
        aria-label="Actualización disponible de la aplicación"
        aria-live="polite"
        className="fixed bottom-[calc(var(--tabbar-h)+var(--s-4)+env(safe-area-inset-bottom))] left-1/2 z-50 w-[calc(100%-var(--s-8))] max-w-md -translate-x-1/2 lg:bottom-[var(--s-6)] lg:left-auto lg:right-[var(--s-6)] lg:translate-x-0"
      >
        <div className="flex items-center justify-between gap-[var(--s-3)] rounded-[var(--r-lg)] border border-[var(--separator)] bg-[var(--surface)] p-[var(--s-4)] shadow-[var(--shadow-2)] backdrop-blur-xl">
          <div className="flex items-center gap-[var(--s-3)] min-w-0">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-[var(--r-md)] bg-[var(--accent)] text-[var(--text-on-accent)] shadow-[var(--shadow-1)]">
              <Sparkles className="size-5" strokeWidth={1.75} aria-hidden="true" />
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-sm font-bold tracking-tight text-[var(--text)]">
                Actualización disponible
              </span>
              <span className="truncate text-xs text-[var(--text-2)]">
                Hay una nueva versión de SM Clock lista.
              </span>
            </div>
          </div>

          <div className="flex items-center gap-[var(--s-2)] shrink-0">
            <button
              type="button"
              onClick={handleApplyUpdate}
              disabled={isUpdating}
              className={cn(
                'ios-btn ios-btn-primary min-h-[38px] px-[var(--s-3)] text-xs font-semibold',
                isUpdating && 'opacity-70 cursor-wait',
              )}
            >
              <RefreshCw
                className={cn('size-3.5', isUpdating && 'animate-spin')}
                strokeWidth={2}
                aria-hidden="true"
              />
              <span>{isUpdating ? 'Actualizando…' : 'Actualizar'}</span>
            </button>
            <button
              type="button"
              onClick={() => setShowUpdatePrompt(false)}
              aria-label="Cerrar aviso de actualización"
              className="flex size-8 items-center justify-center rounded-[var(--r-sm)] text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
            >
              <X className="size-4" strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>
        </div>
      </aside>
    );
  }

  // Banner opcional para instalar como PWA cuando el navegador lo soporte
  if (showInstallPrompt && deferredPrompt) {
    return (
      <aside
        role="region"
        aria-label="Instalar SM Clock en el dispositivo"
        aria-live="polite"
        className="fixed bottom-[calc(var(--tabbar-h)+var(--s-4)+env(safe-area-inset-bottom))] left-1/2 z-50 w-[calc(100%-var(--s-8))] max-w-md -translate-x-1/2 lg:bottom-[var(--s-6)] lg:left-auto lg:right-[var(--s-6)] lg:translate-x-0"
      >
        <div className="flex items-center justify-between gap-[var(--s-3)] rounded-[var(--r-lg)] border border-[var(--separator)] bg-[var(--surface)] p-[var(--s-4)] shadow-[var(--shadow-2)]">
          <div className="flex items-center gap-[var(--s-3)] min-w-0">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-[var(--r-md)] bg-[var(--surface-2)] text-[var(--accent)] border border-[var(--separator)]">
              <Download className="size-5" strokeWidth={1.75} aria-hidden="true" />
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-sm font-bold tracking-tight text-[var(--text)]">
                Instalar SM Clock
              </span>
              <span className="truncate text-xs text-[var(--text-2)]">
                Acceso rápido desde tu pantalla de inicio
              </span>
            </div>
          </div>

          <div className="flex items-center gap-[var(--s-2)] shrink-0">
            <button
              type="button"
              onClick={() => void handleInstallApp()}
              className="ios-btn ios-btn-secondary min-h-[38px] px-[var(--s-3)] text-xs font-semibold"
            >
              Instalar
            </button>
            <button
              type="button"
              onClick={() => setShowInstallPrompt(false)}
              aria-label="Cerrar aviso de instalación"
              className="flex size-8 items-center justify-center rounded-[var(--r-sm)] text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
            >
              <X className="size-4" strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>
        </div>
      </aside>
    );
  }

  return null;
}
