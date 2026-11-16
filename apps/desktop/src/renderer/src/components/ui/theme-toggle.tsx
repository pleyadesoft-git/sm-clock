'use client';

import * as React from 'react';
import { Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';

const STORAGE_KEY = 'color-scheme';

export type ColorSchemeMode = 'light' | 'dark';

/**
 * Selector segmentado de tema (Claro / Oscuro) siguiendo `modern-web-guidance` (`dark-mode-toggle`).
 * Permite cambiar explícitamente entre modo Claro y Oscuro, sincroniza `<meta name="color-scheme">`
 * y las clases `.light` / `.dark` en `document.documentElement`, y limpia `localStorage` cuando
 * la selección coincide con la preferencia del sistema operativo.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const [renderedScheme, setRenderedScheme] =
    React.useState<ColorSchemeMode>('light');

  const getSystemScheme = React.useCallback((): ColorSchemeMode => {
    if (typeof window === 'undefined') return 'light';
    return window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  }, []);

  const applyThemeToDom = React.useCallback(
    (metaContent: string) => {
      const meta = document.querySelector<HTMLMetaElement>(
        'meta[name="color-scheme"]',
      );
      if (meta) {
        meta.content = metaContent;
      }

      const resolved: ColorSchemeMode =
        metaContent === 'dark'
          ? 'dark'
          : metaContent === 'light'
            ? 'light'
            : getSystemScheme();

      const root = document.documentElement;
      root.classList.toggle('dark', resolved === 'dark');
      root.classList.toggle('light', resolved === 'light');
      root.dataset['theme'] = resolved;
      setRenderedScheme(resolved);
    },
    [getSystemScheme],
  );

  React.useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const syncFromState = () => {
      let stored: string | null;
      try {
        stored = localStorage.getItem(STORAGE_KEY);
      } catch {
        stored = null;
      }
      applyThemeToDom(
        stored === 'light' || stored === 'dark' ? stored : 'light dark',
      );
    };

    syncFromState();

    const handleSystemChange = () => {
      syncFromState();
    };

    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) {
        syncFromState();
      }
    };

    mediaQuery.addEventListener('change', handleSystemChange);
    window.addEventListener('storage', handleStorageChange);
    return () => {
      mediaQuery.removeEventListener('change', handleSystemChange);
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [applyThemeToDom]);

  const selectScheme = (target: ColorSchemeMode) => {
    const systemScheme = getSystemScheme();
    try {
      if (target === systemScheme) {
        localStorage.removeItem(STORAGE_KEY);
        applyThemeToDom('light dark');
      } else {
        localStorage.setItem(STORAGE_KEY, target);
        applyThemeToDom(target);
      }
    } catch {
      applyThemeToDom(target);
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label="Tema de la interfaz"
      className={cn(
        'inline-flex items-center rounded-[var(--r-md)] border border-[var(--separator)] bg-[var(--surface-2)] p-[var(--s-1)]',
        className,
      )}
    >
      <button
        type="button"
        role="radio"
        aria-checked={renderedScheme === 'light'}
        onClick={() => selectScheme('light')}
        className={cn(
          'inline-flex min-h-[var(--s-8)] items-center gap-[var(--s-1)] rounded-[var(--r-sm)] px-[var(--s-3)] py-[var(--s-1)] text-xs font-semibold transition-colors cursor-pointer',
          renderedScheme === 'light'
            ? 'bg-[var(--surface)] text-[var(--text)] shadow-[var(--shadow-1)]'
            : 'text-[var(--text-2)] hover:text-[var(--text)]',
        )}
      >
        <Sun className="size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
        <span>Claro</span>
      </button>

      <button
        type="button"
        role="radio"
        aria-checked={renderedScheme === 'dark'}
        onClick={() => selectScheme('dark')}
        className={cn(
          'inline-flex min-h-[var(--s-8)] items-center gap-[var(--s-1)] rounded-[var(--r-sm)] px-[var(--s-3)] py-[var(--s-1)] text-xs font-semibold transition-colors cursor-pointer',
          renderedScheme === 'dark'
            ? 'bg-[var(--surface)] text-[var(--text)] shadow-[var(--shadow-1)]'
            : 'text-[var(--text-2)] hover:text-[var(--text)]',
        )}
      >
        <Moon
          className="size-4 shrink-0"
          strokeWidth={1.75}
          aria-hidden="true"
        />
        <span>Oscuro</span>
      </button>
    </div>
  );
}
