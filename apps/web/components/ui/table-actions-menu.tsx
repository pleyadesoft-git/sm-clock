'use client';

import * as React from 'react';
import { MoreVertical } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface TableActionItem {
  id: string;
  label: string;
  icon?: React.ComponentType<{ className?: string; strokeWidth?: number; 'aria-hidden'?: boolean | 'true' | 'false' }>;
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

export function TableActionsMenu({
  label,
  actions,
  align = 'end',
  className,
}: TableActionsMenuProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [coords, setCoords] = React.useState<{
    top: number;
    right?: number;
    left?: number;
  }>({
    top: 0,
    right: 0,
  });

  const buttonRef = React.useRef<HTMLButtonElement | null>(null);

  React.useEffect(() => {
    if (!isOpen) return;

    const close = () => setIsOpen(false);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handleToggle = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (isOpen) {
      setIsOpen(false);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const right = Math.max(8, window.innerWidth - rect.right);
    const left = align === 'start' ? rect.left : undefined;
    setCoords({
      top: rect.bottom + 4,
      right: align === 'end' ? right : 0,
      left,
    });
    setIsOpen(true);
  };

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

      {isOpen ? (
        <div
          role="menu"
          aria-label={label}
          style={{ top: coords.top, right: coords.right, left: coords.left }}
          className="fixed z-50 flex min-w-[176px] flex-col rounded-[var(--r-md)] border border-[var(--separator)] bg-[var(--surface)] p-[var(--s-1)] shadow-[var(--shadow-2)] animate-in fade-in-50 zoom-in-95 duration-100"
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
                  'flex w-full items-center gap-[var(--s-2)] rounded-[var(--r-sm)] px-[var(--s-3)] py-[var(--s-2)] text-left text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50',
                  variantClass,
                )}
                onClick={(event) => {
                  event.stopPropagation();
                  setIsOpen(false);
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
      ) : null}
    </div>
  );
}
