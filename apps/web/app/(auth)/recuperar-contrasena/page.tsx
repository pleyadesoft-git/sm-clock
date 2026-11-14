'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowLeft, KeyRound, MailCheck } from 'lucide-react';
import { ForgotPasswordRequestSchema } from '@sm-clock/contracts';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export default function RecuperarContrasenaPage() {
  const [email, setEmail] = React.useState('');
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(
    null,
  );
  const [devResetUrl, setDevResetUrl] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);
    setDevResetUrl(null);

    const parsed = ForgotPasswordRequestSchema.safeParse({ email });
    if (!parsed.success) {
      setErrorMessage(
        parsed.error.issues[0]?.message ?? 'Ingresa un correo válido',
      );
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch('/api/auth/recuperar-contrasena', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: parsed.data.email }),
      });

      const body = (await res.json()) as {
        message?: string;
        error?: string;
        resetUrl?: string;
      };

      if (!res.ok) {
        setErrorMessage(
          body.error ?? 'No fue posible procesar la solicitud. Intenta de nuevo.',
        );
        return;
      }

      setSuccessMessage(
        body.message ??
          'Si el correo corresponde a una cuenta activa, enviamos el enlace para restablecer tu contraseña.',
      );
      if (body.resetUrl) {
        setDevResetUrl(body.resetUrl);
      }
    } catch {
      setErrorMessage('Error de conexión con el servidor.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col bg-[var(--bg)] p-[var(--s-4)] text-[var(--text)]">
      <div className="flex justify-end">
        <ThemeToggle />
      </div>

      <div className="flex flex-1 items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader className="items-center text-center">
            <div className="mb-[var(--s-2)] flex size-12 items-center justify-center rounded-[var(--r-lg)] bg-[var(--accent)] text-[var(--text-on-accent)] shadow-[var(--shadow-1)]">
              <KeyRound className="size-6" strokeWidth={1.75} aria-hidden="true" />
            </div>
            <CardTitle>Recuperar contraseña</CardTitle>
            <CardDescription>
              Ingresa tu correo electrónico y te enviaremos un enlace seguro para restablecer tu contraseña.
            </CardDescription>
          </CardHeader>

          <CardContent className="flex flex-col gap-[var(--s-4)]">
            <form onSubmit={handleSubmit} className="flex flex-col gap-[var(--s-4)]">
              <div className="flex flex-col gap-[var(--s-1)]">
                <label htmlFor="recovery-email" className="ios-label">
                  Correo electrónico registrado
                </label>
                <Input
                  id="recovery-email"
                  name="email"
                  type="email"
                  autoComplete="username"
                  spellCheck={false}
                  enterKeyHint="done"
                  required
                  placeholder="nombre@empresa.mx"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (errorMessage) setErrorMessage(null);
                  }}
                />
              </div>

              {errorMessage ? (
                <div
                  role="alert"
                  className="rounded-[var(--r-md)] bg-[var(--danger-bg)] p-[var(--s-3)] text-sm font-semibold text-[var(--danger)]"
                >
                  {errorMessage}
                </div>
              ) : null}

              {successMessage ? (
                <div
                  role="status"
                  aria-live="polite"
                  className="flex flex-col gap-[var(--s-2)] rounded-[var(--r-md)] bg-[var(--success-bg)] p-[var(--s-3)] text-sm font-semibold text-[var(--success)]"
                >
                  <div className="flex items-center gap-[var(--s-2)]">
                    <MailCheck className="size-4 shrink-0" aria-hidden="true" />
                    <span>{successMessage}</span>
                  </div>
                  {devResetUrl ? (
                    <a
                      href={devResetUrl}
                      className="text-xs underline text-[var(--accent)] break-all"
                    >
                      Abrir enlace de restablecimiento (modo desarrollo)
                    </a>
                  ) : null}
                </div>
              ) : null}

              <Button type="submit" disabled={isSubmitting} className="w-full">
                <span>
                  {isSubmitting
                    ? 'Enviando instrucciones…'
                    : 'Enviar enlace de recuperación'}
                </span>
              </Button>
            </form>

            <div className="flex justify-center pt-[var(--s-2)]">
              <Link
                href="/login"
                className="inline-flex items-center gap-[var(--s-1)] text-sm font-semibold text-[var(--accent)] hover:underline"
              >
                <ArrowLeft className="size-4" aria-hidden="true" />
                <span>Volver a Iniciar sesión</span>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
