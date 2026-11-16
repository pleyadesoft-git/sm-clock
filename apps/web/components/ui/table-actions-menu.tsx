'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { MoreVertical } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface TableActionItem {
  id: string;
  label: string;
  icon?: React.ComponentType<{
    className?: string;
    strokeWidth?: number;
    'aria-hidden'?: boolean | 'true' | 'false';
  }>;
  variant?: 'default' | 'danger' | 'success';
  disabled?: boolean;
  onClick: () => void;
}

export interface TableActionsMenuProps {
  label: string;
  actions: readonly TableActionItem[];
  align?: 'end' | 'start';
  className?: string;
}

// Coordinador global para garantizar que SÓLO un menú esté abierto a la vez
let activeMenuClose: (() => void) | null = null;

export function TableActionsMenu({
  label,
  actions,
  align = 'end',
  className,
}: TableActionsMenuProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [mounted, setMounted] = React.useState(false);
  const [coords, setCoords] = React.useState<{
    top: number;
    right?: number;
    left?: number;
  }>({
    top: 0,
    right: 0,
  });

  const buttonRef = React.useRef<HTMLButtonElement | null>(null);
  const menuRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  const closeMenu = React.useCallback(() => {
    setIsOpen(false);
    if (activeMenuClose === closeMenu) {
      activeMenuClose = null;
    }
  }, []);

  React.useEffect(() => {
    if (!isOpen) return;

    const handleWindowClick = (event: MouseEvent) => {
      // Si el clic fue dentro del menú o del botón disparador, no cerrar aquí
      if (
        menuRef.current?.contains(event.target as Node) ||
        buttonRef.current?.contains(event.target as Node)
      ) {
        return;
      }
      closeMenu();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeMenu();
      }
    };

    const handleScrollOrResize = () => {
      closeMenu();
    };

    window.addEventListener('click', handleWindowClick);
    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('click', handleWindowClick);
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, closeMenu]);

  // Si se desmonta el componente, limpiar la referencia activa
  React.useEffect(() => {
    return () => {
      if (activeMenuClose === closeMenu) {
        activeMenuClose = null;
      }
    };
  }, [closeMenu]);

  const handleToggle = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();

    if (isOpen) {
      closeMenu();
      return;
    }

    // Cerrar cualquier otro menú abierto antes de abrir este
    if (activeMenuClose && activeMenuClose !== closeMenu) {
      activeMenuClose();
    }
    activeMenuClose = closeMenu;

    const rect = event.currentTarget.getBoundingClientRect();
    const right = Math.max(8, window.innerWidth - rect.right);
    const left = align === 'start' ? rect.left : undefined;

    // Calcular si debe abrirse hacia arriba si queda poco espacio abajo
    const estimatedMenuHeight = actions.length * 40 + 16;
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUpwards =
      spaceBelow < estimatedMenuHeight && rect.top > estimatedMenuHeight;
    const top = openUpwards
      ? Math.max(8, rect.top - estimatedMenuHeight - 4)
      : rect.bottom + 4;

    setCoords({
      top,
      right: align === 'end' ? right : undefined,
      left,
    });
    setIsOpen(true);
  };

  const menuElement =
    isOpen && mounted && typeof document !== 'undefined' ? (
      <div
        ref={menuRef}
        role="menu"
        aria-label={label}
        style={{ top: coords.top, right: coords.right, left: coords.left }}
        className="fixed z-50 flex min-w-[180px] w-max max-w-[calc(100vw-16px)] flex-col overflow-hidden rounded-[var(--r-md)] border border-[var(--separator)] bg-[var(--surface)] p-[var(--s-1)] shadow-[var(--shadow-2)] backdrop-blur-[var(--blur)] animate-in fade-in-50 zoom-in-95 duration-100"
        onClick={(event) => event.stopPropagation()}
      >
        {actions.map((act) => {
          const Icon = act.icon;
          const variantClass =
            act.variant === 'danger'
              ? 'text-[var(--danger)] hover:bg-[var(--danger-bg)]'
              : act.variant === 'success'
                ? 'text-[var(--success)] hover:bg-[var(--surface-2)]'
                : 'text-[var(--text)] hover:bg-[var(--surface-2)]';

          return (
            <button
              key={act.id}
              type="button"
              role="menuitem"
              disabled={act.disabled}
              className={cn(
                'flex w-full items-center gap-[var(--s-2)] rounded-[var(--r-sm)] px-[var(--s-3)] py-[var(--s-2)] text-left text-sm font-medium whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-50',
                variantClass,
              )}
              onClick={(event) => {
                event.stopPropagation();
                closeMenu();
                act.onClick();
              }}
            >
              {Icon ? (
                <Icon
                  className="size-4 shrink-0 text-current"
                  strokeWidth={1.75}
                  aria-hidden="true"
                />
              ) : null}
              <span>{act.label}</span>
            </button>
          );
        })}
      </div>
    ) : null;

  return (
    <div className={cn('relative inline-flex items-center justify-end', className)}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={handleToggle}
        className="inline-flex size-8 items-center justify-center rounded-[var(--r-md)] border border-[var(--separator)] bg-[var(--surface-2)] text-[var(--text)] shadow-[var(--shadow-1)] transition-colors hover:border-[var(--accent)] hover:bg-[var(--surface)] hover:text-[var(--accent)] focus-visible:outline-2 focus-visible:outline-[var(--accent)] active:scale-95"
      >
        <MoreVertical
          className="size-4 shrink-0"
          strokeWidth={2}
          aria-hidden="true"
        />
      </button>

      {menuElement ? createPortal(menuElement, document.body) : null}
    </div>
  );
}
