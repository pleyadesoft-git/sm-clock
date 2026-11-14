'use client';

import * as React from 'react';
import { X } from 'lucide-react';
import { Button } from './button';

export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
}

/**
 * Componente Sheet adaptativo (lateral en desktop, hoja inferior en móvil)
 * basado en `<dialog>` nativo con `showModal()` y `closedby="any"`.
 * Cumple con `modern-web-guidance` (`dialog` y `light-dismiss-a-dialog`).
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
}: SheetProps) {
  const dialogRef = React.useRef<HTMLDialogElement | null>(null);
  const titleId = React.useId();

  React.useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  React.useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleClose = () => {
      dialog.returnValue = '';
      onOpenChange(false);
    };

    dialog.addEventListener('close', handleClose);

    // Fallback para navegadores sin soporte nativo de `closedby="any"`
    let cleanupFallback: (() => void) | undefined;
    if (
      typeof HTMLDialogElement !== 'undefined' &&
      !('closedBy' in HTMLDialogElement.prototype)
    ) {
      const handleBackdropClick = (event: MouseEvent) => {
        if (event.target !== dialog) return;
        const rect = dialog.getBoundingClientRect();
        const isInsideContent =
          rect.top <= event.clientY &&
          event.clientY <= rect.top + rect.height &&
          rect.left <= event.clientX &&
          event.clientX <= rect.left + rect.width;
        if (!isInsideContent) {
          dialog.close();
        }
      };
      dialog.addEventListener('click', handleBackdropClick);
      cleanupFallback = () =>
        dialog.removeEventListener('click', handleBackdropClick);
    }

    return () => {
      dialog.removeEventListener('close', handleClose);
      cleanupFallback?.();
    };
  }, [onOpenChange]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className="ios-sheet"
      {...({ closedby: 'any' } as React.DialogHTMLAttributes<HTMLDialogElement>)}
    >
      <div className="flex items-start justify-between gap-[var(--s-3)] border-b border-[var(--separator)] pb-[var(--s-3)]">
        <div className="flex flex-col gap-[var(--s-1)]">
          <h2 id={titleId} className="text-lg font-semibold text-[var(--text)]">
            {title}
          </h2>
          {description ? (
            <p className="text-sm text-[var(--text-2)]">{description}</p>
          ) : null}
        </div>
        <Button
          variant="plain"
          aria-label="Cerrar panel"
          onClick={() => dialogRef.current?.close()}
        >
          <X className="size-5" strokeWidth={1.75} aria-hidden="true" />
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto">{children}</div>
    </dialog>
  );
}
