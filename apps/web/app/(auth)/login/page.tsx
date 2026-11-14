'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type { User } from '@supabase/supabase-js';
import { Clock, Eye, EyeOff, Fingerprint, Lock, Mail } from 'lucide-react';
import {
  LoginRequestSchema,
  roleRequiresMfa,
  UserRoleSchema,
} from '@sm-clock/contracts';
import {
  authenticateWithPasskey,
  detectWebAuthnCapabilities,
} from '@/lib/auth/webauthn-client';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
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

function LoginFormContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [showPassword, setShowPassword] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = React.useState(false);
  const [isPasskeyLoading, setIsPasskeyLoading] = React.useState(false);
  const [webauthnAvailable, setWebauthnAvailable] = React.useState(false);
  const [biometricPlatformAvailable, setBiometricPlatformAvailable] =
    React.useState(false);

  const conditionalAbortRef = React.useRef<AbortController | null>(null);

  const completePostSignInRedirect = React.useCallback(
    async (user: User) => {
      const supabase = createSupabaseBrowserClient();
      const verifyRes = await fetch('/api/auth/me');
      if (!verifyRes.ok) {
        const errBody = (await verifyRes.json().catch(() => ({}))) as {
          error?: string;
        };
        await supabase.auth.signOut();
        setErrorMessage(
          errBody.error ??
            'No cuentas con una invitación activa para ingresar a la aplicación.',
        );
        return;
      }

      const verifyJson = (await verifyRes.json()) as {
        data?: { rol?: unknown };
      };
      const rawRol = verifyJson.data?.rol ?? user.app_metadata?.['rol'];
      const rolResult = UserRoleSchema.safeParse(rawRol);

      if (rolResult.success && roleRequiresMfa(rolResult.data)) {
        const { data: aalData } =
          await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        if (aalData?.nextLevel === 'aal2' && aalData.currentLevel !== 'aal2') {
          router.push('/mfa');
          return;
        }
      }

      if (rolResult.success && rolResult.data === 'SUPER_ADMIN') {
        router.push('/admin/empresas');
      } else {
        router.push('/dashboard');
      }
    },
    [router],
  );

  const startConditionalAutofill = React.useCallback(async () => {
    const caps = await detectWebAuthnCapabilities();
    setWebauthnAvailable(caps.webauthnSupported);
    setBiometricPlatformAvailable(caps.passkeyPlatformAuthenticator);

    if (!caps.conditionalGet) {
      return;
    }

    conditionalAbortRef.current?.abort();
    const controller = new AbortController();
    conditionalAbortRef.current = controller;

    const supabase = createSupabaseBrowserClient();
    const result = await authenticateWithPasskey({
      supabase,
      signal: controller.signal,
      mediation: 'conditional',
    });

    if (result.ok) {
      await completePostSignInRedirect(result.user);
    }
  }, [completePostSignInRedirect]);

  React.useEffect(() => {
    void startConditionalAutofill();
    return () => {
      conditionalAbortRef.current?.abort();
    };
  }, [startConditionalAutofill]);

  React.useEffect(() => {
    const err = searchParams.get('error');
    if (err === 'sin_invitacion') {
      setErrorMessage(
        'No existe una invitación activa para tu correo en esta organización. Solicita una invitación al administrador de tu empresa.',
      );
    } else if (err === 'cuenta_inactiva') {
      setErrorMessage(
        'Tu cuenta de usuario se encuentra desactivada. Contacta al administrador de tu empresa.',
      );
    } else if (err === 'oauth_invalido') {
      setErrorMessage(
        'No fue posible completar la autenticación con Google. Intenta nuevamente.',
      );
    }
  }, [searchParams]);

  const handleGoogleLogin = async () => {
    setErrorMessage(null);
    conditionalAbortRef.current?.abort();
    setIsGoogleLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/api/auth/callback`,
          queryParams: {
            prompt: 'select_account',
          },
        },
      });
      if (error) {
        setErrorMessage('Error al iniciar autenticación con Google.');
        setIsGoogleLoading(false);
      }
    } catch {
      setErrorMessage('Error de conexión con el proveedor Google Auth.');
      setIsGoogleLoading(false);
    }
  };

  const handlePasskeyLogin = async () => {
    setErrorMessage(null);
    // Cancelar cualquier mediación condicional activa para evitar colisión de prompts WebAuthn
    conditionalAbortRef.current?.abort();
    const explicitController = new AbortController();
    conditionalAbortRef.current = explicitController;

    setIsPasskeyLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const result = await authenticateWithPasskey({
        supabase,
        signal: explicitController.signal,
      });

      if (!result.ok) {
        if (!result.cancelled) {
          setErrorMessage(result.message);
        }
        // Rearmar sugerencias Conditional UI tras cancelar el diálogo explícito
        void startConditionalAutofill();
        return;
      }

      await completePostSignInRedirect(result.user);
    } catch {
      setErrorMessage('Error al verificar la llave biométrica.');
    } finally {
      setIsPasskeyLoading(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);

    const parsed = LoginRequestSchema.safeParse({ email, password });
    if (!parsed.success) {
      setErrorMessage(
        parsed.error.issues[0]?.message ?? 'Verifica tus credenciales',
      );
      return;
    }

    conditionalAbortRef.current?.abort();
    setIsSubmitting(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { data, error } = await supabase.auth.signInWithPassword({
        email: parsed.data.email,
        password: parsed.data.password,
      });

      if (error || !data.user) {
        setErrorMessage('Correo o contraseña incorrectos. Intenta nuevamente.');
        return;
      }

      await completePostSignInRedirect(data.user);
    } catch {
      setErrorMessage('Error de conexión al servidor de autenticación.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="items-center text-center">
        <div className="mb-[var(--s-2)] flex size-12 items-center justify-center rounded-[var(--r-lg)] bg-[var(--accent)] text-[var(--text-on-accent)] shadow-[var(--shadow-1)]">
          <Clock className="size-6" strokeWidth={1.75} aria-hidden="true" />
        </div>
        <CardTitle id="login-title-heading">
          Iniciar sesión en SM Clock
        </CardTitle>
        <CardDescription id="login-title-description">
          Plataforma SaaS de Control de Asistencia · Acceso con Gmail, Biométricos o Contraseña
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-[var(--s-4)]">
        <form onSubmit={handleSubmit} className="flex flex-col gap-[var(--s-4)]">
          <div className="flex flex-col gap-[var(--s-1)]">
            <label htmlFor="email" className="ios-label">
              Correo electrónico
            </label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="username webauthn"
              aria-describedby="login-title-description"
              autoFocus
              spellCheck={false}
              enterKeyHint="next"
              required
              placeholder="nombre@empresa.mx"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (errorMessage) setErrorMessage(null);
              }}
            />
          </div>

          <div className="flex flex-col gap-[var(--s-1)]">
            <div className="flex items-center justify-between">
              <label htmlFor="current-password" className="ios-label">
                Contraseña
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
              id="current-password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              enterKeyHint="done"
              required
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (errorMessage) setErrorMessage(null);
              }}
            />
            <div className="mt-[var(--s-1)] flex justify-end">
              <Link
                href="/recuperar-contrasena"
                className="text-xs font-semibold text-[var(--accent)] hover:underline"
              >
                ¿Olvidaste tu contraseña?
              </Link>
            </div>
          </div>

          {errorMessage ? (
            <div
              role="alert"
              aria-live="polite"
              className="rounded-[var(--r-md)] bg-[var(--danger-bg)] p-[var(--s-3)] text-sm font-semibold text-[var(--danger)]"
            >
              {errorMessage}
            </div>
          ) : null}

          <Button type="submit" disabled={isSubmitting} className="w-full">
            <Lock className="size-4" strokeWidth={1.75} aria-hidden="true" />
            <span>{isSubmitting ? 'Verificando…' : 'Iniciar sesión'}</span>
          </Button>
        </form>

        <div className="relative flex items-center justify-center py-[var(--s-1)]">
          <div className="w-full border-t border-[var(--separator)]" />
          <span className="bg-[var(--surface)] px-[var(--s-3)] text-xs font-medium text-[var(--text-2)]">
            o ingresa sin contraseña
          </span>
          <div className="w-full border-t border-[var(--separator)]" />
        </div>

        <div className="flex flex-col gap-[var(--s-2)]">
          <Button
            type="button"
            variant="secondary"
            disabled={isGoogleLoading || isPasskeyLoading}
            onClick={() => void handleGoogleLogin()}
            className="w-full"
          >
            <Mail className="size-4" strokeWidth={1.75} aria-hidden="true" />
            <span>
              {isGoogleLoading
                ? 'Conectando con Google…'
                : 'Continuar con Google Auth'}
            </span>
          </Button>

          {webauthnAvailable ? (
            <Button
              type="button"
              variant="secondary"
              disabled={isPasskeyLoading || isGoogleLoading}
              onClick={() => void handlePasskeyLogin()}
              className="w-full"
            >
              <Fingerprint
                className="size-4 text-[var(--accent)]"
                strokeWidth={1.75}
                aria-hidden="true"
              />
              <span>
                {isPasskeyLoading
                  ? 'Esperando lectura biométrica…'
                  : biometricPlatformAvailable
                    ? 'Ingresar con Biométrico / Passkey'
                    : 'Ingresar con Llave de Seguridad (WebAuthn)'}
              </span>
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-[var(--bg)] p-[var(--s-4)] text-[var(--text)]">
      <div className="flex justify-end">
        <ThemeToggle />
      </div>

      <div className="flex flex-1 items-center justify-center">
        <React.Suspense fallback={null}>
          <LoginFormContent />
        </React.Suspense>
      </div>
    </div>
  );
}
