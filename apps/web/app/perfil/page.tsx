'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Eye,
  EyeOff,
  KeyRound,
  LogOut,
  Mail,
  Save,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';
import {
  safeEmailSchema,
  safeSanitizedTextSchema,
  type UserRole,
} from '@sm-clock/contracts';
import { AppShell } from '@/components/layout/app-shell';
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
import { useToast } from '@/components/ui/toast';
import { PasskeySecurityCard } from '@/components/features/auth/passkey-security-card';
import { useAdminChannel } from '@/lib/realtime/use-admin-channel';
import { useTenantChannel } from '@/lib/realtime/use-tenant-channel';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export interface CurrentUserProfileData {
  userId: string;
  email: string;
  nombreCompleto: string;
  rol: UserRole;
  tenantId: string | null;
  authProvider: 'GOOGLE' | 'EMAIL' | 'BOTH';
  avatarUrl: string | null;
}

function buildProfileFormSchema(requireCurrentPassword: boolean) {
  return z
    .object({
      nombre_completo: safeSanitizedTextSchema({
        min: 2,
        max: 140,
        minMessage: 'Ingresa tu nombre completo (mínimo 2 caracteres)',
        maxMessage: 'El nombre completo no puede exceder 140 caracteres',
        injectionMessage:
          'El nombre completo contiene caracteres o código no permitido',
      }),
      email: safeEmailSchema('Ingresa un correo electrónico válido'),
      current_password: z.string().max(128).optional().or(z.literal('')),
      password: z.string().max(128).optional().or(z.literal('')),
      confirm_password: z.string().max(128).optional().or(z.literal('')),
    })
    .superRefine((data, ctx) => {
      const currentPwd = data.current_password ?? '';
      const newPwd = data.password ?? '';
      const confirmPwd = data.confirm_password ?? '';
      const wantsPasswordChange =
        currentPwd.length > 0 || newPwd.length > 0 || confirmPwd.length > 0;

      if (!wantsPasswordChange) return;

      if (requireCurrentPassword && currentPwd.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['current_password'],
          message: 'Ingresa tu contraseña actual para confirmar el cambio',
        });
      }

      if (newPwd.length < 8) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['password'],
          message: 'La nueva contraseña debe tener al menos 8 caracteres',
        });
      }

      if (confirmPwd.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['confirm_password'],
          message: 'Confirma tu nueva contraseña',
        });
      } else if (newPwd !== confirmPwd) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['confirm_password'],
          message: 'Las contraseñas no coinciden',
        });
      }
    });
}

type ProfileFormValues = z.infer<ReturnType<typeof buildProfileFormSchema>>;

function getInitials(name: string, email: string): string {
  const source = name.trim() || email.trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}`.toUpperCase();
  }
  return (source.slice(0, 2) || 'US').toUpperCase();
}

function formatRoleLabel(rol: UserRole): string {
  if (rol === 'SUPER_ADMIN') return 'Super Admin SaaS';
  if (rol === 'ADMIN_EMPRESA') return 'Administrador de Empresa';
  return 'Operador (Consulta y Exportación)';
}

export default function PerfilUsuarioPage() {
  const router = useRouter();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [showCurrentPassword, setShowCurrentPassword] = React.useState(false);
  const [showPassword, setShowPassword] = React.useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [signingOut, setSigningOut] = React.useState(false);
  const [avatarLoadError, setAvatarLoadError] = React.useState(false);

  const { data: meRes, isLoading } = useQuery<{ data: CurrentUserProfileData }>({
    queryKey: ['auth-me-profile'],
    queryFn: async () => {
      const res = await fetch('/api/auth/me');
      if (!res.ok) {
        throw new Error('No se pudo cargar el perfil del usuario');
      }
      return (await res.json()) as { data: CurrentUserProfileData };
    },
  });

  const profile = meRes?.data;
  const isGoogleOnly = profile?.authProvider === 'GOOGLE';

  const formSchema = React.useMemo(
    () => buildProfileFormSchema(!isGoogleOnly),
    [isGoogleOnly],
  );

  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      nombre_completo: '',
      email: '',
      current_password: '',
      password: '',
      confirm_password: '',
    },
    mode: 'onTouched',
  });

  const { status: tenantState } = useTenantChannel({
    tenantId: profile?.tenantId,
    queryKeysToInvalidate: [['perfil-usuario']],
    events: ['*'],
  });
  const { status: adminState } = useAdminChannel({
    queryKeysToInvalidate: [['perfil-usuario']],
    events: ['*'],
  });
  const realtimeState =
    profile?.rol === 'SUPER_ADMIN' ? adminState : tenantState;

  React.useEffect(() => {
    if (!profile) return;
    form.reset({
      nombre_completo: profile.nombreCompleto,
      email: profile.email,
      current_password: '',
      password: '',
      confirm_password: '',
    });
    setAvatarLoadError(false);
  }, [profile, form]);

  async function handleSaveProfile(values: ProfileFormValues) {
    const newPassword = values.password?.trim() ? values.password : undefined;
    const payload = {
      nombre_completo: values.nombre_completo.trim(),
      email: values.email.trim(),
      ...(newPassword
        ? {
            current_password: values.current_password || undefined,
            password: newPassword,
            confirm_password: values.confirm_password || undefined,
          }
        : {}),
    };

    setSaving(true);
    try {
      const res = await fetch('/api/auth/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const body = (await res.json()) as {
        error?: string;
        data?: { passwordUpdated?: boolean };
      };

      if (!res.ok) {
        if (
          body.error &&
          body.error.toLowerCase().includes('contraseña actual')
        ) {
          form.setError('current_password', {
            type: 'server',
            message: body.error,
          });
        }
        toast({
          title: 'No se pudo actualizar tu perfil',
          description: body.error ?? 'Intenta nuevamente en unos segundos.',
          variant: 'danger',
        });
        return;
      }

      form.reset({
        nombre_completo: values.nombre_completo.trim(),
        email: values.email.trim(),
        current_password: '',
        password: '',
        confirm_password: '',
      });
      setShowCurrentPassword(false);
      setShowPassword(false);
      setShowConfirmPassword(false);

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['auth-me-profile'] }),
        queryClient.invalidateQueries({ queryKey: ['auth-me-role'] }),
      ]);

      toast({
        title: 'Perfil y credenciales actualizados',
        description: body.data?.passwordUpdated
          ? 'Tu nombre, correo y contraseña de acceso se guardaron correctamente.'
          : 'Tus datos principales de perfil fueron actualizados.',
        variant: 'success',
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleSignOut() {
    setSigningOut(true);
    try {
      const supabase = createSupabaseBrowserClient();
      await supabase.auth.signOut();
      queryClient.clear();
      router.replace('/login?logged_out=1');
    } finally {
      setSigningOut(false);
    }
  }

  const shellMode = profile?.rol === 'SUPER_ADMIN' ? 'admin' : 'client';
  const watchedName = form.watch('nombre_completo');
  const watchedEmail = form.watch('email');
  const initials = getInitials(
    profile?.nombreCompleto ?? watchedName,
    profile?.email ?? watchedEmail,
  );
  const showAvatarImg = Boolean(profile?.avatarUrl) && !avatarLoadError;

  return (
    <AppShell
      title="Mi Perfil y Seguridad"
      subtitle="Administra tus datos principales (nombre, correo), contraseña de acceso, datos biométricos y llaves"
      mode={shellMode}
      realtimeState={realtimeState}
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-[var(--s-6)]">
        {/* Resumen de identidad y fotografía Google OAuth */}
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-[var(--s-4)] pt-[var(--s-5)]">
            <div className="flex items-center gap-[var(--s-4)]">
              <div className="relative flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--separator)] bg-[var(--accent)] text-lg font-bold text-[var(--text-on-accent)]">
                {showAvatarImg && profile?.avatarUrl ? (
                  <img
                    src={profile.avatarUrl}
                    alt={`Fotografía de perfil de ${profile.nombreCompleto}`}
                    referrerPolicy="no-referrer"
                    onError={() => setAvatarLoadError(true)}
                    className="size-full rounded-full object-cover"
                  />
                ) : (
                  <span aria-hidden="true">{initials}</span>
                )}
              </div>

              <div className="flex flex-col gap-[var(--s-1)]">
                <div className="flex flex-wrap items-center gap-[var(--s-2)]">
                  <h2 className="text-lg font-bold text-[var(--text)]">
                    {profile?.nombreCompleto || 'Cargando perfil…'}
                  </h2>
                  {profile?.rol ? (
                    <Badge
                      variant={
                        profile.rol === 'OPERADOR' ? 'default' : 'accent'
                      }
                    >
                      {formatRoleLabel(profile.rol)}
                    </Badge>
                  ) : null}
                </div>
                <span className="text-sm text-[var(--text-2)]">
                  {profile?.email ?? ''}
                </span>
                <div className="flex flex-wrap items-center gap-[var(--s-2)] pt-[var(--s-1)]">
                  <Badge variant="success">
                    <ShieldCheck className="mr-1 size-3" aria-hidden="true" />
                    {profile?.authProvider === 'BOTH'
                      ? 'Google OAuth + Usuario y Contraseña'
                      : profile?.authProvider === 'GOOGLE'
                        ? 'Vinculado con Google OAuth'
                        : 'Usuario y Contraseña activo'}
                  </Badge>
                </div>
              </div>
            </div>

            <Button
              type="button"
              variant="destructive"
              disabled={signingOut}
              onClick={() => void handleSignOut()}
            >
              <LogOut className="size-4" aria-hidden="true" />
              <span>{signingOut ? 'Cerrando sesión…' : 'Cerrar sesión'}</span>
            </Button>
          </CardContent>
        </Card>

        {/* Tarjeta 1: Datos principales (nombre, email) + Credenciales */}
        <div id="credenciales">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-[var(--s-3)]">
                <div className="flex items-center gap-[var(--s-3)]">
                  <div className="flex size-10 items-center justify-center rounded-[var(--r-md)] bg-[var(--accent)] text-[var(--text-on-accent)]">
                    <UserCheck
                      className="size-5"
                      strokeWidth={1.75}
                      aria-hidden="true"
                    />
                  </div>
                  <div>
                    <CardTitle>
                      Datos Principales y Credenciales de Acceso
                    </CardTitle>
                    <CardDescription>
                      {isGoogleOnly
                        ? 'Actualiza tu nombre completo o correo electrónico. Tu sesión se gestiona directamente con Google OAuth.'
                        : 'Actualiza tu nombre completo, correo electrónico y cambia tu contraseña de acceso para la app web y los agentes.'}
                    </CardDescription>
                  </div>
                </div>
              </div>
            </CardHeader>

            <CardContent>
              {isLoading ? (
                <div
                  role="status"
                  aria-live="polite"
                  className="py-[var(--s-5)] text-sm text-[var(--text-2)]"
                >
                  Cargando información de tu cuenta…
                </div>
              ) : (
                <Form {...form}>
                  <form
                    noValidate
                    onSubmit={form.handleSubmit(handleSaveProfile)}
                    className="flex flex-col gap-[var(--s-4)]"
                  >
                    <div className="grid grid-cols-1 gap-[var(--s-4)] md:grid-cols-2">
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
                                placeholder="Ej. Roberto Gómez"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="email"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Correo electrónico (Usuario)</FormLabel>
                            <FormControl>
                              <Input
                                type="email"
                                autoComplete="username"
                                spellCheck={false}
                                placeholder="tu.correo@empresa.mx"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    {isGoogleOnly ? (
                      <div className="flex items-start gap-[var(--s-3)] rounded-[var(--r-md)] border border-[var(--separator)] bg-[var(--surface-2)] p-[var(--s-4)] text-xs text-[var(--text-2)]">
                        <Mail
                          className="mt-0.5 size-4 shrink-0 text-[var(--accent)]"
                          aria-hidden="true"
                        />
                        <div className="flex flex-col gap-[var(--s-1)]">
                          <span className="font-semibold text-[var(--text)]">
                            Sesión gestionada con Google OAuth
                          </span>
                          <span>
                            Tu cuenta utiliza Google para iniciar sesión, por lo
                            que no necesitas cambiar tu contraseña aquí. Administra
                            la seguridad de tu contraseña directamente desde tu
                            cuenta de Google.
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-[var(--s-4)] rounded-[var(--r-md)] border border-[var(--separator)] bg-[var(--surface-2)] p-[var(--s-4)]">
                        <div className="flex items-center gap-[var(--s-2)]">
                          <KeyRound
                            className="size-4 text-[var(--accent)]"
                            aria-hidden="true"
                          />
                          <span className="text-sm font-semibold text-[var(--text)]">
                            Cambiar contraseña de acceso
                          </span>
                        </div>

                        <FormField
                          control={form.control}
                          name="current_password"
                          render={({ field }) => (
                            <FormItem>
                              <div className="flex items-center justify-between">
                                <FormLabel>Contraseña actual</FormLabel>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setShowCurrentPassword((prev) => !prev)
                                  }
                                  aria-pressed={showCurrentPassword}
                                  className="inline-flex items-center gap-[var(--s-1)] text-xs font-semibold text-[var(--accent)] cursor-pointer"
                                  aria-label={
                                    showCurrentPassword
                                      ? 'Ocultar contraseña actual'
                                      : 'Mostrar contraseña actual'
                                  }
                                >
                                  {showCurrentPassword ? (
                                    <>
                                      <EyeOff
                                        className="size-3.5"
                                        aria-hidden="true"
                                      />
                                      <span>Ocultar</span>
                                    </>
                                  ) : (
                                    <>
                                      <Eye
                                        className="size-3.5"
                                        aria-hidden="true"
                                      />
                                      <span>Mostrar</span>
                                    </>
                                  )}
                                </button>
                              </div>
                              <FormControl>
                                <Input
                                  type={showCurrentPassword ? 'text' : 'password'}
                                  autoComplete="current-password"
                                  placeholder="Ingresa tu contraseña actual"
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <div className="grid grid-cols-1 gap-[var(--s-4)] md:grid-cols-2">
                          <FormField
                            control={form.control}
                            name="password"
                            render={({ field }) => (
                              <FormItem>
                                <div className="flex items-center justify-between">
                                  <FormLabel>Nueva contraseña</FormLabel>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setShowPassword((prev) => !prev)
                                    }
                                    aria-pressed={showPassword}
                                    className="inline-flex items-center gap-[var(--s-1)] text-xs font-semibold text-[var(--accent)] cursor-pointer"
                                    aria-label={
                                      showPassword
                                        ? 'Ocultar nueva contraseña'
                                        : 'Mostrar nueva contraseña'
                                    }
                                  >
                                    {showPassword ? (
                                      <>
                                        <EyeOff
                                          className="size-3.5"
                                          aria-hidden="true"
                                        />
                                        <span>Ocultar</span>
                                      </>
                                    ) : (
                                      <>
                                        <Eye
                                          className="size-3.5"
                                          aria-hidden="true"
                                        />
                                        <span>Mostrar</span>
                                      </>
                                    )}
                                  </button>
                                </div>
                                <FormControl>
                                  <Input
                                    type={showPassword ? 'text' : 'password'}
                                    autoComplete="new-password"
                                    placeholder="Mínimo 8 caracteres"
                                    {...field}
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
                                  <FormLabel>Confirmar nueva contraseña</FormLabel>
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
                                        <EyeOff
                                          className="size-3.5"
                                          aria-hidden="true"
                                        />
                                        <span>Ocultar</span>
                                      </>
                                    ) : (
                                      <>
                                        <Eye
                                          className="size-3.5"
                                          aria-hidden="true"
                                        />
                                        <span>Mostrar</span>
                                      </>
                                    )}
                                  </button>
                                </div>
                                <FormControl>
                                  <Input
                                    type={
                                      showConfirmPassword ? 'text' : 'password'
                                    }
                                    autoComplete="new-password"
                                    placeholder="Repite la nueva contraseña"
                                    {...field}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>

                        <span className="text-xs text-[var(--text-2)]">
                          Deja estos campos en blanco si solo deseas actualizar tu
                          nombre o correo electrónico.
                        </span>
                      </div>
                    )}

                    <div className="flex justify-end pt-[var(--s-1)]">
                      <Button type="submit" disabled={saving}>
                        <Save className="size-4" aria-hidden="true" />
                        <span>
                          {saving
                            ? 'Guardando cambios…'
                            : 'Guardar datos y credenciales'}
                        </span>
                      </Button>
                    </div>
                  </form>
                </Form>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Tarjeta 2: Datos biométricos, Passkeys y llaves de seguridad WebAuthn */}
        <div id="biometricos">
          <PasskeySecurityCard />
        </div>
      </div>
    </AppShell>
  );
}
