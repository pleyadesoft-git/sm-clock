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
  footer?: React.ReactNode;
}

export interface SheetFooterProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * Pie fijo para diálogos, modales y drawers (`Sheet`).
 * Mantiene visibles las acciones primarias ("Guardar", "Cancelar") sin obligar
 * al usuario a hacer scroll hasta el final del formulario.
 */
export function SheetFooter({ children, className = '' }: SheetFooterProps) {
  return (
    <div className={`ios-sheet-footer ${className}`.trim()}>{children}</div>
  );
}

/**
 * Componente Sheet adaptativo (lateral en desktop, hoja inferior en móvil)
 * basado en `<dialog>` nativo con `showModal()`, `closedby="any"`, cuerpo
 * desplazable (`.ios-sheet-body`) y pie de acciones fijo (`.ios-sheet-footer`).
 * Cumple con `modern-web-guidance` (`dialog` y `light-dismiss-a-dialog`).
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
}: SheetProps) {
  const dialogRef = React.useRef<HTMLDialogElement | null>(null);
  const titleId = React.useId();

  React.useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      if (typeof dialog.showModal === 'function') {
        dialog.showModal();
      } else {
        dialog.setAttribute('open', '');
      }
    } else if (!open && dialog.open) {
      if (typeof dialog.close === 'function') {
        dialog.close();
      } else {
        dialog.removeAttribute('open');
      }
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
      const isOutside = (event: PointerEvent) => {
        const rect = dialog.getBoundingClientRect();
        return (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        );
      };
      let pressedOutside = false;
      const handlePointerDown = (event: PointerEvent) => {
        pressedOutside = isOutside(event);
      };
      const handlePointerUp = (event: PointerEvent) => {
        if (pressedOutside && isOutside(event)) {
          dialog.close();
        }
      };
      dialog.addEventListener('pointerdown', handlePointerDown);
      dialog.addEventListener('pointerup', handlePointerUp);
      cleanupFallback = () => {
        dialog.removeEventListener('pointerdown', handlePointerDown);
        dialog.removeEventListener('pointerup', handlePointerUp);
      };
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
      <div className="ios-sheet-header">
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
      <div className="ios-sheet-body">{children}</div>
      {footer ? <div className="ios-sheet-footer">{footer}</div> : null}
    </dialog>
  );
}
