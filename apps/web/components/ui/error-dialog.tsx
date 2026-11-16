'use client';

import * as React from 'react';
import { AlertCircle, Check, Copy, Mail, X } from 'lucide-react';
import { Button } from './button';

export interface ErrorDialogData {
  title?: string;
  userMessage: string;
  technicalDetails?: string | null;
  endpoint?: string;
  status?: number | string;
}

export interface ErrorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  error: ErrorDialogData | null;
}

/**
 * Diálogo modal para notificar errores al usuario con mensaje amigable,
 * separador <hr> y detalles técnicos en letras pequeñas con botón para
 * copiar al portapapeles y notificar al desarrollador.
 */
export function ErrorDialog({ open, onOpenChange, error }: ErrorDialogProps) {
  const dialogRef = React.useRef<HTMLDialogElement | null>(null);
  const titleId = React.useId();
  const [copied, setCopied] = React.useState(false);

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
      setCopied(false);
    };

    dialog.addEventListener('close', handleClose);
    return () => {
      dialog.removeEventListener('close', handleClose);
    };
  }, [onOpenChange]);

  if (!error) return null;

  const formattedReport = [
    '=== REPORTE DE ERROR — SM CLOCK ===',
    `Fecha: ${new Date().toISOString()}`,
    error.endpoint ? `Operación / Endpoint: ${error.endpoint}` : null,
    error.status !== undefined ? `Estado / Código: ${error.status}` : null,
    `Mensaje para el usuario: ${error.userMessage}`,
    '',
    '--- DETALLES TÉCNICOS ---',
    error.technicalDetails || 'Sin detalles técnicos adicionales proporcionados.',
    '====================================',
  ]
    .filter(Boolean)
    .join('\n');

  const handleCopy = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(formattedReport);
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      }
    } catch {
      // Fallback para entornos con permisos restringidos de portapapeles
      const textarea = document.createElement('textarea');
      textarea.value = formattedReport;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  const mailtoUrl = `mailto:soporte@smclock.mx?subject=${encodeURIComponent(
    `Reporte de error: ${error.title ?? 'Falla en el sistema'}`,
  )}&body=${encodeURIComponent(formattedReport)}`;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className="fixed inset-0 z-50 m-auto hidden max-h-[85vh] w-[min(92vw,560px)] flex-col overflow-hidden rounded-[var(--r-xl)] border border-[var(--separator)] bg-[var(--surface)] p-0 text-[var(--text)] shadow-[var(--shadow-2)] backdrop:bg-black/50 backdrop:backdrop-blur-sm open:flex"
      {...({ closedby: 'any' } as React.DialogHTMLAttributes<HTMLDialogElement>)}
    >
      {/* Header del diálogo */}
      <div className="flex items-center justify-between border-b border-[var(--separator)] bg-[var(--surface-translucent)] px-[var(--s-5)] py-[var(--s-4)] backdrop-blur-[var(--blur)]">
        <div className="flex items-center gap-[var(--s-2)]">
          <div className="flex size-8 items-center justify-center rounded-full bg-[var(--danger-bg)] text-[var(--danger)]">
            <AlertCircle className="size-4" strokeWidth={2} aria-hidden="true" />
          </div>
          <h2 id={titleId} className="text-base font-semibold text-[var(--text)]">
            {error.title ?? 'No se pudo completar la acción'}
          </h2>
        </div>
        <Button
          variant="plain"
          aria-label="Cerrar ventana de error"
          onClick={() => onOpenChange(false)}
          className="size-8 p-0"
        >
          <X className="size-4" strokeWidth={1.75} aria-hidden="true" />
        </Button>
      </div>

      {/* Cuerpo del diálogo con scroll vertical contenido */}
      <div className="flex-1 overflow-y-auto px-[var(--s-6)] py-[var(--s-4)]">
        {/* Mensaje amigable para el usuario */}
        <p className="text-sm leading-relaxed text-[var(--text)]">
          {error.userMessage}
        </p>

        {/* Separador requerido */}
        <hr className="my-[var(--s-4)] border-t border-[var(--separator)]" />

        {/* Información técnica en letras pequeñas */}
        <div className="flex flex-col gap-[var(--s-2)]">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-2)]">
              Información técnica para soporte
            </span>
            {error.status ? (
              <span className="rounded bg-[var(--surface-2)] px-[var(--s-2)] py-0.5 font-mono text-[11px] font-medium text-[var(--text-2)]">
                Código: {error.status}
              </span>
            ) : null}
          </div>

          <pre className="max-h-44 overflow-x-auto whitespace-pre-wrap rounded-[var(--r-md)] border border-[var(--separator)] bg-[var(--surface-2)] p-[var(--s-3)] font-mono text-[11px] leading-relaxed text-[var(--text-2)] select-all">
            {error.technicalDetails || formattedReport}
          </pre>
          <p className="text-[11px] text-[var(--text-2)]">
            Puedes copiar este reporte para enviarlo por correo electrónico al equipo de desarrollo.
          </p>
        </div>
      </div>

      {/* Pie fijo con acciones */}
      <div className="flex flex-wrap items-center justify-between gap-[var(--s-2)] border-t border-[var(--separator)] bg-[var(--surface-translucent)] px-[var(--s-5)] py-[var(--s-3)] backdrop-blur-[var(--blur)]">
        <div className="flex items-center gap-[var(--s-2)]">
          <Button
            type="button"
            variant="secondary"
            onClick={handleCopy}
            className="text-xs"
            aria-label="Copiar reporte técnico"
          >
            {copied ? (
              <>
                <Check className="size-3.5 text-[var(--success)]" strokeWidth={2} aria-hidden="true" />
                <span className="text-[var(--success)] font-medium">¡Copiado!</span>
              </>
            ) : (
              <>
                <Copy className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                <span>Copiar reporte</span>
              </>
            )}
          </Button>

          <a
            href={mailtoUrl}
            className="ios-btn ios-btn-secondary inline-flex items-center gap-[var(--s-1)] text-xs"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Mail className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
            <span>Enviar por email</span>
          </a>
        </div>

        <Button
          type="button"
          onClick={() => onOpenChange(false)}
          className="text-xs"
        >
          Cerrar
        </Button>
      </div>
    </dialog>
  );
}
