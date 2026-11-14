'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle2, Eye, EyeOff, KeyRound } from 'lucide-react';
import { ResetPasswordRequestSchema } from '@sm-clock/contracts';
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

function ResetPasswordFormContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tokenHash = searchParams.get('token_hash') ?? undefined;

  const [password, setPassword] = React.useState('');
  const [showPassword, setShowPassword] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(
    null,
  );
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    const parsed = ResetPasswordRequestSchema.safeParse({
      password,
      tokenHash,
    });
    if (!parsed.success) {
      setErrorMessage(
        parsed.error.issues[0]?.message ?? 'Verifica la nueva contraseña',
      );
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch('/api/auth/restablecer-contrasena', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });

      const body = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) {
        setErrorMessage(
          body.error ??
            'No fue posible restablecer la contraseña. Solicita un nuevo enlace.',
        );
        return;
      }

      setSuccessMessage(
        body.message ?? 'Contraseña actualizada correctamente.',
      );
      setTimeout(() => {
        router.push('/login');
      }, 1600);
    } catch {
      setErrorMessage('Error de conexión con el servidor.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="items-center text-center">
        <div className="mb-[var(--s-2)] flex size-12 items-center justify-center rounded-[var(--r-lg)] bg-[var(--accent)] text-[var(--text-on-accent)] shadow-[var(--shadow-1)]">
          <KeyRound className="size-6" strokeWidth={1.75} aria-hidden="true" />
        </div>
        <CardTitle>Definir nueva contraseña</CardTitle>
        <CardDescription>
          Elige una contraseña segura de al menos 8 caracteres para tu cuenta en SM Clock.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-[var(--s-4)]">
        <form onSubmit={handleSubmit} className="flex flex-col gap-[var(--s-4)]">
          <div className="flex flex-col gap-[var(--s-1)]">
            <div className="flex items-center justify-between">
              <label htmlFor="new-password" className="ios-label">
                Nueva contraseña
              </label>
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-pressed={showPassword}
                className="inline-flex items-center gap-[var(--s-1)] text-xs font-semibold text-[var(--accent)] cursor-pointer"
                aria-label={
                  showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'
                }
              >
                {showPassword ? (
                  <>
                    <EyeOff className="size-3.5" aria-hidden="true" />
                    <span>Ocultar</span>
                  </>
                ) : (
                  <>
                    <Eye className="size-3.5" aria-hidden="true" />
                    <span>Mostrar</span>
                  </>
                )}
              </button>
            </div>
            <Input
              id="new-password"
              name="new-password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              minLength={8}
              enterKeyHint="done"
              required
              aria-describedby="new-password-help"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (errorMessage) setErrorMessage(null);
              }}
            />
            <span
              id="new-password-help"
              className="text-xs font-medium text-[var(--text-2)]"
            >
              Mínimo 8 caracteres.
            </span>
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
              className="flex items-center gap-[var(--s-2)] rounded-[var(--r-md)] bg-[var(--success-bg)] p-[var(--s-3)] text-sm font-semibold text-[var(--success)]"
            >
              <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
              <span>{successMessage}</span>
            </div>
          ) : null}

          <Button type="submit" disabled={isSubmitting} className="w-full">
            <span>
              {isSubmitting ? 'Guardando…' : 'Guardar nueva contraseña'}
            </span>
          </Button>
        </form>

        <div className="flex justify-center pt-[var(--s-1)]">
          <Link
            href="/login"
            className="text-sm font-semibold text-[var(--accent)] hover:underline"
          >
            Ir a Iniciar sesión
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

export default function RestablecerContrasenaPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-[var(--bg)] p-[var(--s-4)] text-[var(--text)]">
      <div className="flex justify-end">
        <ThemeToggle />
      </div>

      <div className="flex flex-1 items-center justify-center">
        <React.Suspense fallback={null}>
          <ResetPasswordFormContent />
        </React.Suspense>
      </div>
    </div>
  );
}
