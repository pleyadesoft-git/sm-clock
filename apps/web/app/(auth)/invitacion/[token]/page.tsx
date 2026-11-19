'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  Mail,
  UserCheck,
} from 'lucide-react';
import {
  AcceptInvitationPasswordFormSchema,
  roleRequiresMfa,
  UserRoleSchema,
  type AcceptInvitationPasswordFormValues,
} from '@sm-clock/contracts';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { ThemeToggle } from '@/components/theme-toggle';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';

interface InvitationVerificationData {
  id: string;
  email: string;
  nombre_completo: string;
  rol: 'ADMIN_EMPRESA' | 'OPERADOR';
  expira_en: string;
  tenant_nombre: string;
}

/**
 * Página de Pre-registro por invitación (`/invitacion/[token]`):
 * - Permite activar la cuenta con correo y contraseña (con confirmación y ver/ocultar)
 *   para usuarios sin cuenta de Gmail, tanto para la app del tenant como para agentes.
 * - Opción alternativa de ingreso federado con Google Auth vinculado al token de invitación.
 */
export default function InvitacionPreRegistroPage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const token = typeof params.token === 'string' ? params.token : '';

  const [inviteInfo, setInviteInfo] =
    React.useState<InvitationVerificationData | null>(null);
  const [loadingInvite, setLoadingInvite] = React.useState(true);
  const [verifyError, setVerifyError] = React.useState<string | null>(null);

  const [showPassword, setShowPassword] = React.useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = React.useState(false);

  const form = useForm<AcceptInvitationPasswordFormValues>({
    resolver: zodResolver(AcceptInvitationPasswordFormSchema),
    defaultValues: {
      nombre_completo: '',
      password: '',
      confirm_password: '',
    },
    mode: 'onTouched',
  });

  React.useEffect(() => {
    if (!token) {
      setVerifyError('Enlace de invitación incompleto.');
      setLoadingInvite(false);
      return;
    }

    let cancelled = false;
    void fetch(`/api/invitaciones/verificar?token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        const body = (await res.json()) as {
          data?: InvitationVerificationData;
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok || !body.data) {
          setVerifyError(
            body.error ??
              'Esta invitación no es válida o ha expirado. Solicita una nueva al administrador.',
          );
        } else {
          setInviteInfo(body.data);
          form.reset({
            nombre_completo: body.data.nombre_completo,
            password: '',
            confirm_password: '',
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setVerifyError('Error al verificar la invitación con el servidor.');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingInvite(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [token, form]);

  const handleSubmitPassword = async (
    values: AcceptInvitationPasswordFormValues,
  ) => {
    setFormError(null);
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/invitaciones/aceptar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          nombre_completo: values.nombre_completo,
          password: values.password,
        }),
      });

      const body = (await res.json()) as {
        data?: { email: string; rol: string };
        error?: string;
      };

      if (!res.ok || !body.data) {
        setFormError(
          body.error ?? 'No fue posible activar tu cuenta. Intenta nuevamente.',
        );
        return;
      }

      const supabase = createSupabaseBrowserClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: body.data.email,
        password: values.password,
      });

      if (signInError) {
        router.replace('/login');
        return;
      }

      const rolParsed = UserRoleSchema.safeParse(body.data.rol);
      if (rolParsed.success && roleRequiresMfa(rolParsed.data)) {
        const { data: aalData } =
          await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        if (aalData?.nextLevel === 'aal2' && aalData.currentLevel !== 'aal2') {
          router.replace('/mfa');
          return;
        }
      }

      router.replace('/dashboard');
    } catch {
      setFormError('Error de conexión al completar el pre-registro.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleAccept = async () => {
    setFormError(null);
    setIsGoogleLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const callbackUrl = `${window.location.origin}/api/auth/callback?invite_token=${encodeURIComponent(token)}`;
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: callbackUrl,
        },
      });
      if (error) {
        setFormError('No fue posible conectar con Google Auth.');
        setIsGoogleLoading(false);
      }
    } catch {
      setFormError('Error al iniciar autenticación con Google.');
      setIsGoogleLoading(false);
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
              <UserCheck
                className="size-6"
                strokeWidth={1.75}
                aria-hidden="true"
              />
            </div>
            <CardTitle>Pre-registro de Usuario Invitado</CardTitle>
            <CardDescription>
              {inviteInfo
                ? `Invitación a ${inviteInfo.tenant_nombre}`
                : 'Verificación de invitación por organización'}
            </CardDescription>
          </CardHeader>

          <CardContent className="flex flex-col gap-[var(--s-4)]">
            {loadingInvite ? (
              <div
                role="status"
                aria-live="polite"
                className="py-[var(--s-6)] text-center text-sm font-medium text-[var(--text-2)]"
              >
                Verificando invitación…
              </div>
            ) : verifyError || !inviteInfo ? (
              <div className="flex flex-col gap-[var(--s-4)]">
                <div
                  role="alert"
                  className="flex items-start gap-[var(--s-2)] rounded-[var(--r-md)] bg-[var(--danger-bg)] p-[var(--s-3)] text-sm font-semibold text-[var(--danger)]"
                >
                  <AlertCircle
                    className="mt-0.5 size-4 shrink-0"
                    aria-hidden="true"
                  />
                  <span>{verifyError}</span>
                </div>
                <Link
                  href="/login"
                  className="text-center text-sm font-semibold text-[var(--accent)] hover:underline"
                >
                  Ir a Iniciar sesión
                </Link>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between rounded-[var(--r-md)] border border-[var(--separator)] bg-[var(--surface-2)] p-[var(--s-3)]">
                  <div className="flex flex-col">
                    <span className="text-xs font-medium text-[var(--text-2)]">
                      Rol asignado por el Administrador
                    </span>
                    <span className="text-sm font-bold text-[var(--text)]">
                      {inviteInfo.tenant_nombre}
                    </span>
                  </div>
                  <Badge
                    variant={
                      inviteInfo.rol === 'ADMIN_EMPRESA' ? 'accent' : 'info'
                    }
                  >
                    {inviteInfo.rol === 'ADMIN_EMPRESA' ? 'Admin' : 'Operador'}
                  </Badge>
                </div>

                <Form {...form}>
                  <form
                    noValidate
                    onSubmit={form.handleSubmit(handleSubmitPassword)}
                    className="flex flex-col gap-[var(--s-4)]"
                  >
                    <div className="flex flex-col gap-[var(--s-1)]">
                      <label htmlFor="invite-email" className="ios-label">
                        Correo electrónico invitado
                      </label>
                      <Input
                        id="invite-email"
                        name="email"
                        type="email"
                        autoComplete="username"
                        spellCheck={false}
                        readOnly
                        value={inviteInfo.email}
                        className="opacity-80"
                      />
                    </div>

                    <FormField
                      control={form.control}
                      name="nombre_completo"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Nombre completo</FormLabel>
                          <FormControl>
                            <Input
                              type="text"
                              autoComplete="name"
                              enterKeyHint="next"
                              {...field}
                              onChange={(e) => {
                                field.onChange(e);
                                if (formError) setFormError(null);
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
                            <FormLabel>Crear contraseña</FormLabel>
                            <button
                              type="button"
                              onClick={() => setShowPassword((prev) => !prev)}
                              aria-pressed={showPassword}
                              className="inline-flex items-center gap-[var(--s-1)] text-xs font-semibold text-[var(--accent)] cursor-pointer"
                              aria-label={
                                showPassword
                                  ? 'Ocultar contraseña'
                                  : 'Mostrar contraseña'
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
                              autoComplete="new-password"
                              enterKeyHint="next"
                              placeholder="Mínimo 8 caracteres"
                              {...field}
                              onChange={(e) => {
                                field.onChange(e);
                                if (formError) setFormError(null);
                              }}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="confirm_password"
                      render={({ field }) => (
                        <FormItem>
                          <div className="flex items-center justify-between">
                            <FormLabel>Confirmar contraseña</FormLabel>
                            <button
                              type="button"
                              onClick={() =>
                                setShowConfirmPassword((prev) => !prev)
                              }
                              aria-pressed={showConfirmPassword}
                              className="inline-flex items-center gap-[var(--s-1)] text-xs font-semibold text-[var(--accent)] cursor-pointer"
                              aria-label={
                                showConfirmPassword
                                  ? 'Ocultar confirmación de contraseña'
                                  : 'Mostrar confirmación de contraseña'
                              }
                            >
                              {showConfirmPassword ? (
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
                              type={showConfirmPassword ? 'text' : 'password'}
                              autoComplete="new-password"
                              enterKeyHint="done"
                              placeholder="Repite tu contraseña"
                              {...field}
                              onChange={(e) => {
                                field.onChange(e);
                                if (formError) setFormError(null);
                              }}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <span className="text-xs font-medium text-[var(--text-2)]">
                      {inviteInfo.rol === 'ADMIN_EMPRESA'
                        ? 'Esta contraseña te servirá para ingresar a la aplicación web y a los Agentes SM Clock sin requerir Gmail.'
                        : 'Esta contraseña te servirá para ingresar a la aplicación web sin requerir Gmail.'}
                    </span>

                    {formError ? (
                      <div
                        role="alert"
                        className="rounded-[var(--r-md)] bg-[var(--danger-bg)] p-[var(--s-3)] text-sm font-semibold text-[var(--danger)]"
                      >
                        {formError}
                      </div>
                    ) : null}

                    <Button
                      type="submit"
                      disabled={isSubmitting}
                      className="w-full"
                    >
                      <CheckCircle2
                        className="size-4"
                        strokeWidth={1.75}
                        aria-hidden="true"
                      />
                      <span>
                        {isSubmitting
                          ? 'Activando cuenta…'
                          : 'Crear cuenta e iniciar sesión'}
                      </span>
                    </Button>
                  </form>
                </Form>

                <div className="relative flex items-center justify-center py-[var(--s-1)]">
                  <div className="w-full border-t border-[var(--separator)]" />
                  <span className="bg-[var(--surface)] px-[var(--s-3)] text-xs font-medium text-[var(--text-2)]">
                    o regístrate con
                  </span>
                  <div className="w-full border-t border-[var(--separator)]" />
                </div>

                <Button
                  type="button"
                  variant="secondary"
                  disabled={isGoogleLoading}
                  onClick={handleGoogleAccept}
                  className="w-full"
                >
                  <Mail
                    className="size-4"
                    strokeWidth={1.75}
                    aria-hidden="true"
                  />
                  <span>
                    {isGoogleLoading
                      ? 'Conectando con Google…'
                      : 'Activar invitación con Google Auth'}
                  </span>
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
