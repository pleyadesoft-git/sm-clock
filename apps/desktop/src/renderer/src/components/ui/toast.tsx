'use client';

import * as React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2, AlertCircle, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ToastMessage {
  id: string;
  title: string;
  description?: string;
  variant?: 'default' | 'success' | 'danger';
}

interface ToastContextValue {
  toast: (msg: Omit<ToastMessage, 'id'>) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [messages, setMessages] = React.useState<ToastMessage[]>([]);

  const toast = React.useCallback((msg: Omit<ToastMessage, 'id'>) => {
    const id = crypto.randomUUID();
    setMessages((prev) => [...prev, { ...msg, id }]);
    window.setTimeout(() => {
      setMessages((prev) => prev.filter((item) => item.id !== id));
    }, 4000);
  }, []);

  const dismiss = React.useCallback((id: string) => {
    setMessages((prev) => prev.filter((item) => item.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div
        role="region"
        aria-label="Notificaciones"
        aria-live="polite"
        className="pointer-events-none fixed bottom-[var(--s-6)] right-[var(--s-6)] z-50 flex flex-col gap-[var(--s-2)]"
      >
        <AnimatePresence mode="popLayout">
          {messages.map((m) => (
            <motion.div
              key={m.id}
              layout
              initial={{ opacity: 0, y: 16, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 400, damping: 34 }}
              className={cn(
                'pointer-events-auto flex min-w-72 items-start justify-between gap-[var(--s-3)] rounded-[var(--r-lg)] border border-[var(--separator)] bg-[var(--surface)] p-[var(--s-4)] shadow-[var(--shadow-2)]',
              )}
            >
              <div className="flex items-start gap-[var(--s-2)]">
                {m.variant === 'danger' ? (
                  <AlertCircle
                    className="size-5 shrink-0 text-[var(--danger)]"
                    strokeWidth={1.75}
                    aria-hidden="true"
                  />
                ) : (
                  <CheckCircle2
                    className="size-5 shrink-0 text-[var(--success)]"
                    strokeWidth={1.75}
                    aria-hidden="true"
                  />
                )}
                <div className="flex flex-col gap-[var(--s-1)]">
                  <p className="text-sm font-semibold text-[var(--text)]">
                    {m.title}
                  </p>
                  {m.description ? (
                    <p className="text-xs text-[var(--text-2)]">
                      {m.description}
                    </p>
                  ) : null}
                </div>
              </div>
              <button
                type="button"
                aria-label="Descartar notificación"
                onClick={() => dismiss(m.id)}
                className="text-[var(--text-2)] hover:text-[var(--text)]"
              >
                <X className="size-4" strokeWidth={1.75} aria-hidden="true" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = React.useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast debe usarse dentro de <ToastProvider>');
  }
  return ctx;
}
