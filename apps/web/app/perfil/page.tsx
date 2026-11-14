'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
  UpdateOwnProfileRequestSchema,
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
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { PasskeySecurityCard } from '@/components/features/auth/passkey-security-card';
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

  const [nombreCompleto, setNombreCompleto] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [showPassword, setShowPassword] = React.useState(false);
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

  React.useEffect(() => {
    if (!profile) return;
    setNombreCompleto(profile.nombreCompleto);
    setEmail(profile.email);
    setAvatarLoadError(false);
  }, [profile]);

  async function handleSaveProfile(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const parsed = UpdateOwnProfileRequestSchema.safeParse({
      nombre_completo: nombreCompleto.trim(),
      email: email.trim(),
      password: password.length > 0 ? password : undefined,
    });

    if (!parsed.success) {
      toast({
        title: 'Revisa los datos de tu perfil',
        description:
          parsed.error.issues[0]?.message ?? 'Datos de perfil inválidos',
        variant: 'danger',
      });
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/auth/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });

      const body = (await res.json()) as {
        error?: string;
        data?: { passwordUpdated?: boolean };
      };

      if (!res.ok) {
        toast({
          title: 'No se pudo actualizar tu perfil',
          description: body.error ?? 'Intenta nuevamente en unos segundos.',
          variant: 'danger',
        });
        return;
      }

      setPassword('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['auth-me-profile'] }),
        queryClient.invalidateQueries({ queryKey: ['auth-me-role'] }),
      ]);

      toast({
        title: 'Perfil y credenciales actualizados',
        description: body.data?.passwordUpdated
          ? 'Tu nombre, correo y contraseña de acceso directo se guardaron correctamente.'
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
  const initials = getInitials(
    profile?.nombreCompleto ?? nombreCompleto,
    profile?.email ?? email,
  );
  const showAvatarImg = Boolean(profile?.avatarUrl) && !avatarLoadError;

  return (
    <AppShell
      title="Mi Perfil y Seguridad"
      subtitle="Administra tus datos principales (nombre, correo), usuario + contraseña, datos biométricos y llaves WebAuthn"
      mode={shellMode}
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

        {/* Tarjeta 1: Datos principales (nombre, email) + Usuario y Contraseña */}
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
                      Datos Principales y Usuario + Contraseña
                    </CardTitle>
                    <CardDescription>
                      Actualiza tu nombre completo, correo electrónico de acceso
                      y establece o cambia tu contraseña para ingresar con
                      usuario + contraseña además de Google OAuth.
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
                <form
                  onSubmit={(e) => void handleSaveProfile(e)}
                  className="flex flex-col gap-[var(--s-4)]"
                >
                  <div className="grid grid-cols-1 gap-[var(--s-4)] md:grid-cols-2">
                    <div className="flex flex-col gap-[var(--s-1)]">
                      <label htmlFor="perfil-nombre" className="ios-label">
                        Nombre completo
                      </label>
                      <Input
                        id="perfil-nombre"
                        name="name"
                        type="text"
                        autoComplete="name"
                        required
                        placeholder="Ej. Roberto Gómez"
                        value={nombreCompleto}
                        onChange={(e) => setNombreCompleto(e.target.value)}
                      />
                    </div>

                    <div className="flex flex-col gap-[var(--s-1)]">
                      <label htmlFor="perfil-email" className="ios-label">
                        Correo electrónico (Usuario)
                      </label>
                      <Input
                        id="perfil-email"
                        name="username"
                        type="email"
                        autoComplete="username"
                        spellCheck={false}
                        required
                        placeholder="tu.correo@empresa.mx"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-[var(--s-1)] rounded-[var(--r-md)] border border-[var(--separator)] bg-[var(--surface-2)] p-[var(--s-4)]">
                    <div className="flex items-center justify-between">
                      <label
                        htmlFor="perfil-password"
                        className="inline-flex items-center gap-[var(--s-1)] text-xs font-semibold text-[var(--text-2)]"
                      >
                        <KeyRound
                          className="size-3.5 text-[var(--accent)]"
                          aria-hidden="true"
                        />
                        <span>
                          Contraseña de acceso (Usuario + Contraseña)
                        </span>
                      </label>
                      <button
                        type="button"
                        onClick={() => setShowPassword((prev) => !prev)}
                        aria-pressed={showPassword}
                        className="inline-flex items-center gap-[var(--s-1)] text-xs font-semibold text-[var(--accent)] cursor-pointer"
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
                      id="perfil-password"
                      name="new-password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      minLength={8}
                      maxLength={128}
                      aria-describedby="perfil-password-constraints"
                      placeholder="Dejar en blanco para mantener tu contraseña actual (o escribe mín. 8 caracteres)"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />

                    <span
                      id="perfil-password-constraints"
                      className="inline-flex items-center gap-[var(--s-1)] text-xs text-[var(--text-2)]"
                    >
                      <Mail className="size-3" aria-hidden="true" />
                      <span>
                        Si iniciaste sesión con Google OAuth, definir una
                        contraseña aquí te permitirá entrar también con tu
                        correo y contraseña desde cualquier dispositivo.
                      </span>
                    </span>
                  </div>

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
