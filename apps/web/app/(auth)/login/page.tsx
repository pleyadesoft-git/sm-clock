'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type { User } from '@supabase/supabase-js';
import {
  ArrowLeft,
  Eye,
  EyeOff,
  Lock,
  Mail,
  ShieldCheck,
} from 'lucide-react';
import {
  LoginRequestSchema,
  roleRequiresMfa,
  UserRoleSchema,
  type LoginRequest,
} from '@sm-clock/contracts';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
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
import { SmClockLogo } from '@/components/ui/sm-clock-logo';

function LoginFormContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [showPassword, setShowPassword] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = React.useState(false);
  const [isSuperAdminMode, setIsSuperAdminMode] = React.useState(false);

  const form = useForm<LoginRequest>({
    resolver: zodResolver(LoginRequestSchema),
    defaultValues: {
      email: '',
      password: '',
    },
    mode: 'onTouched',
  });

  const isLoggedOut = searchParams.get('logged_out') === '1';

  React.useEffect(() => {
    const mode = searchParams.get('mode');
    if (mode === 'super_admin') {
      setIsSuperAdminMode(true);
    }
  }, [searchParams]);

  React.useEffect(() => {
    const err = searchParams.get('error');
    if (err === 'super_admin_no_autorizado') {
      setIsSuperAdminMode(true);
      setErrorMessage(
        'La cuenta de Google seleccionada no está registrada en sm-clock. Acceso denegado al panel Administrativo.',
      );
    } else if (err === 'sin_invitacion') {
      setErrorMessage(
        'No existe una cuenta o invitación activa para tu correo en esta organización. Solicita acceso al administrador de tu empresa.',
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
          'No cuentas con una invitación o empresa activa para ingresar a la aplicación.',
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

  const handleGoogleLogin = async (forSuperAdmin = false) => {
    setErrorMessage(null);
    setIsGoogleLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const callbackUrl = new URL('/api/auth/callback', window.location.origin);
      if (forSuperAdmin) {
        callbackUrl.searchParams.set('mode', 'super_admin');
      }

      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: callbackUrl.toString(),
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

  const handleCredentialsSubmit = async (values: LoginRequest) => {
    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { data, error } = await supabase.auth.signInWithPassword({
        email: values.email,
        password: values.password,
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

  if (isSuperAdminMode) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <div className="mb-[var(--s-2)] flex size-12 items-center justify-center rounded-[var(--r-lg)] bg-[var(--accent)] text-[var(--text-on-accent)] shadow-[var(--shadow-1)]">
            <ShieldCheck
              className="size-6"
              strokeWidth={1.75}
              aria-hidden="true"
            />
          </div>
          <CardTitle id="super-admin-login-heading">
            Acceso Super-Admin
          </CardTitle>
          <CardDescription id="super-admin-login-description">
            Administración global de empresas.
            Solo cuentas registradas.
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-[var(--s-4)]">
          {errorMessage ? (
            <div
              role="alert"
              aria-live="polite"
              className="rounded-[var(--r-md)] bg-[var(--danger-bg)] p-[var(--s-3)] text-sm font-semibold text-[var(--danger)]"
            >
              {errorMessage}
            </div>
          ) : null}

          <Button
            type="button"
            disabled={isGoogleLoading}
            onClick={() => void handleGoogleLogin(true)}
            className="w-full"
          >
            <Mail className="size-4" strokeWidth={1.75} aria-hidden="true" />
            <span>
              {isGoogleLoading
                ? 'Conectando con Google'
                : 'Iniciar sesión con Google'}
            </span>
          </Button>

          <div className="flex justify-center pt-[var(--s-2)]">
            <button
              type="button"
              onClick={() => {
                setIsSuperAdminMode(false);
                setErrorMessage(null);
                router.replace('/login');
              }}
              className="inline-flex items-center gap-[var(--s-1)] text-xs font-medium text-[var(--text-2)] transition-colors hover:text-[var(--text)] cursor-pointer"
            >
              <ArrowLeft className="size-3.5" aria-hidden="true" />
              <span>Volver al inicio de sesión de empresas</span>
            </button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex w-full max-w-md flex-col items-center gap-[var(--s-4)]">
      <Card className="w-full">
        <CardHeader className="items-center text-center">
          <SmClockLogo size={52} className="mb-[var(--s-2)] shadow-[var(--shadow-1)] rounded-[13px]" />
          <CardTitle id="login-title-heading">
            Iniciar sesión en SM Clock
          </CardTitle>
          <CardDescription id="login-title-description">
            Control de Asistencia · Ingresa con tu cuenta de empresa
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-[var(--s-4)]">
          {isLoggedOut ? (
            <div
              role="region"
              aria-label="Selección de método para nueva sesión"
              className="flex flex-col gap-[var(--s-2)] rounded-[var(--r-md)] border border-[var(--separator)] bg-[var(--surface-2)] p-[var(--s-3)] text-xs text-[var(--text-2)]"
            >
              <span className="font-semibold text-[var(--text)]">
                Sesión finalizada correctamente
              </span>
              <span>
                Puedes iniciar sesión con otra cuenta de Google o ingresar con
                tu correo y contraseña.
              </span>
            </div>
          ) : null}

          <Form {...form}>
            <form
              noValidate
              onSubmit={form.handleSubmit(handleCredentialsSubmit)}
              className="flex flex-col gap-[var(--s-4)]"
            >
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Correo electrónico</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        autoComplete="username"
                        aria-describedby="login-title-description"
                        autoFocus
                        spellCheck={false}
                        enterKeyHint="next"
                        placeholder="nombre@empresa.mx"
                        {...field}
                        onChange={(e) => {
                          field.onChange(e);
                          if (errorMessage) setErrorMessage(null);
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center justify-between">
                      <FormLabel>Contraseña</FormLabel>
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
                    <FormControl>
                      <Input
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="current-password"
                        enterKeyHint="done"
                        {...field}
                        onChange={(e) => {
                          field.onChange(e);
                          if (errorMessage) setErrorMessage(null);
                        }}
                      />
                    </FormControl>
                    <div className="mt-[var(--s-1)] flex justify-end">
                      <Link
                        href="/recuperar-contrasena"
                        className="text-xs font-semibold text-[var(--accent)] hover:underline"
                      >
                        ¿Olvidaste tu contraseña?
                      </Link>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

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
          </Form>

          <div className="relative flex items-center justify-center py-[var(--s-1)]">
            <div className="w-full border-t border-[var(--separator)]" />
            <span className="bg-[var(--surface)] px-[var(--s-3)] text-xs font-medium text-[var(--text-2)]">
              ó
            </span>
            <div className="w-full border-t border-[var(--separator)]" />
          </div>

          <Button
            type="button"
            variant="secondary"
            disabled={isGoogleLoading}
            onClick={() => void handleGoogleLogin(false)}
            className="w-full"
          >
            <Mail className="size-4" strokeWidth={1.75} aria-hidden="true" />
            <span>
              {isGoogleLoading
                ? 'Conectando con Google…'
                : 'Continuar con Google'}
            </span>
          </Button>

          {/* Acceso directo al Kiosco Checador para Empleados (sin login administrativo) */}
          <div className="border-t border-[var(--separator)] pt-[var(--s-3)]">
            <Link
              href="/checador"
              className="flex w-full items-center justify-between rounded-[var(--r-lg)] border border-[var(--accent)] bg-[var(--accent-soft)] px-[var(--s-4)] py-[var(--s-3)] text-left transition-opacity hover:opacity-90"
            >
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-[var(--accent)]">
                  ¿Eres Empleado? · Sin Iniciar Sesión
                </p>
                <p className="text-sm font-semibold text-[var(--text)]">
                  Abrir Kiosco de Check-In y Check-Out
                </p>
                <p className="text-xs text-[var(--text-2)]">
                  Registra tu entrada o salida con tu PIN de 6 dígitos, Huella/FaceID o Reconocimiento Facial.
                </p>
              </div>
            </Link>
          </div>
        </CardContent>
      </Card>

      {/* Opción muy discreta para abrir el panel de Super-Admin con Google OAuth */}
      <button
        type="button"
        onClick={() => {
          setErrorMessage(null);
          setIsSuperAdminMode(true);
        }}
        className="inline-flex items-center gap-[var(--s-1)] text-[11px] font-medium text-[var(--text-3)] opacity-70 transition-opacity hover:text-[var(--text-2)] hover:opacity-100 cursor-pointer"
      >
        <ShieldCheck className="size-3" strokeWidth={1.75} aria-hidden="true" />
        <span>Acceso Panel Admin</span>
      </button>
    </div>
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
