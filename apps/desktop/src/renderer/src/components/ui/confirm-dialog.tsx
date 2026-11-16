import * as React from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { Button } from './button';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  onOpenChange,
  title,
  description,
  confirmText = 'Confirmar',
  cancelText = 'Cancelar',
  destructive = false,
  onConfirm,
}) => {
  const dialogRef = React.useRef<HTMLDialogElement | null>(null);
  const [isProcessing, setIsProcessing] = React.useState(false);

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

    const handleCancel = (e: Event) => {
      e.preventDefault();
      onOpenChange(false);
    };

    dialog.addEventListener('close', handleClose);
    dialog.addEventListener('cancel', handleCancel);

    return () => {
      dialog.removeEventListener('close', handleClose);
      dialog.removeEventListener('cancel', handleCancel);
    };
  }, [onOpenChange]);

  const handleConfirmAction = async () => {
    setIsProcessing(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } finally {
      setIsProcessing(false);
    }
  };

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      className="m-auto fixed inset-0 z-50 p-0 border-0 bg-transparent backdrop:bg-black/60 backdrop:backdrop-blur-sm select-none"
      onClick={(e) => {
        if (e.target === dialogRef.current) {
          onOpenChange(false);
        }
      }}
    >
      <div className="w-[90vw] max-w-md bg-[var(--surface)] border border-[var(--separator)] rounded-[var(--r-lg)] shadow-[var(--shadow-2)] overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-150">
        {/* Cabecera del diálogo */}
        <div className="p-5 pb-3 flex items-start gap-3.5">
          <div
            className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
              destructive
                ? 'bg-[var(--danger-bg)] text-[var(--danger)]'
                : 'bg-[var(--accent-bg)] text-[var(--accent)]'
            }`}
          >
            <AlertTriangle className="w-5 h-5" />
          </div>

          <div className="flex-1 min-w-0 pr-2">
            <h3 className="text-base font-semibold text-[var(--text)] leading-snug">
              {title}
            </h3>
            <p className="mt-1 text-xs text-[var(--text-2)] leading-relaxed">
              {description}
            </p>
          </div>

          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="text-[var(--text-2)] hover:text-[var(--text)] p-1 rounded-md transition-colors cursor-pointer"
            aria-label="Cerrar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Footer fijo sin scroll con botones de acción */}
        <div className="p-4 bg-[var(--surface-2)] border-t border-[var(--separator)] flex items-center justify-end gap-2.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={isProcessing}
            className="text-xs"
          >
            {cancelText}
          </Button>

          <Button
            type="button"
            variant={destructive ? 'destructive' : 'primary'}
            size="sm"
            onClick={handleConfirmAction}
            disabled={isProcessing}
            className="text-xs font-semibold"
          >
            {isProcessing ? 'Cerrando...' : confirmText}
          </Button>
        </div>
      </div>
    </dialog>
  );
};
