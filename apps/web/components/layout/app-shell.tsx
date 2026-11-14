'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Building2,
  Clock,
  Fingerprint,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Radio,
  Settings,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  UserCircle,
  UserPlus,
  Users,
} from 'lucide-react';
import {
  canRoleAccessPath,
  getDefaultHomeForRole,
  sanitizeRedirectPath,
  UserRoleSchema,
  type UserRole,
} from '@sm-clock/contracts';
import { ThemeToggle } from '@/components/theme-toggle';
import { Badge } from '@/components/ui/badge';
import { SmClockLogo } from '@/components/ui/sm-clock-logo';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';

export interface NavItem {
  href: string;
  label: string;
  icon: typeof Building2;
}

const ADMIN_NAV_ITEMS: readonly NavItem[] = [
  { href: '/admin/empresas', label: 'Empresas', icon: Building2 },
  { href: '/admin/agentes', label: 'Agentes', icon: Radio },
] as const;

const CLIENT_ADMIN_NAV_ITEMS: readonly NavItem[] = [
  { href: '/dashboard', label: 'En Vivo', icon: LayoutDashboard },
  { href: '/empleados', label: 'Empleados', icon: Users },
  { href: '/sucursales', label: 'Sucursales', icon: Building2 },
  { href: '/usuarios', label: 'Usuarios', icon: UserPlus },
  { href: '/configuracion', label: 'Configuración', icon: Settings },
  { href: '/perfil', label: 'Mi Perfil', icon: UserCircle },
] as const;

const CLIENT_OPERADOR_NAV_ITEMS: readonly NavItem[] = [
  { href: '/dashboard', label: 'Movimientos en Vivo', icon: LayoutDashboard },
  { href: '/dashboard/checadas', label: 'Consulta y Descarga', icon: Clock },
  { href: '/perfil', label: 'Mi Perfil', icon: UserCircle },
] as const;

export type RealtimeConnectionState = 'connected' | 'reconnecting' | 'idle';

export interface AppShellProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  realtimeState?: RealtimeConnectionState;
  mode?: 'admin' | 'client';
  userRole?: UserRole;
  children: React.ReactNode;
}

interface HeaderUserSummary {
  nombreCompleto: string;
  email: string;
  rol: UserRole | null;
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

/**
 * Layout responsivo estilo iOS (`docs/UI-UX-IOS.md` §2.4 y §7) con Browser Routing Guard
 * y Avatar de Usuario en la esquina superior derecha (fotografía Google OAuth + menú de credenciales y cierre de sesión).
 */
export function AppShell({
  title,
  subtitle,
  actions,
  realtimeState = 'connected',
  mode = 'admin',
  userRole,
  children,
}: AppShellProps) {
  const pathname = usePathname() || '/dashboard';
  const router = useRouter();
  const [resolvedRole, setResolvedRole] = React.useState<UserRole | null>(
    userRole ?? null,
  );
  const [authStatus, setAuthStatus] = React.useState<
    'checking' | 'authorized' | 'redirecting'
  >(userRole ? 'authorized' : 'checking');
  const [userSummary, setUserSummary] = React.useState<HeaderUserSummary>({
    nombreCompleto: 'Mi Perfil',
    email: '',
    rol: userRole ?? null,
    avatarUrl: null,
  });
  const [avatarLoadError, setAvatarLoadError] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [signingOut, setSigningOut] = React.useState(false);
  const menuContainerRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (userRole) {
      setResolvedRole(userRole);
      if (
        !canRoleAccessPath(userRole, pathname) ||
        (mode === 'admin' && userRole !== 'SUPER_ADMIN')
      ) {
        setAuthStatus('redirecting');
        router.replace(getDefaultHomeForRole(userRole));
      } else {
        setAuthStatus('authorized');
      }
    }

    let cancelled = false;
    void fetch('/api/auth/me')
      .then(async (res) => {
        if (cancelled) return;

        if (!res.ok) {
          if (userRole) return;
          const errJson = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          const errMsg = (errJson.error ?? '').toLowerCase();
          setAuthStatus('redirecting');

          if (res.status === 403 && errMsg.includes('mfa')) {
            const safeNext = sanitizeRedirectPath(pathname);
            router.replace(`/mfa?next=${encodeURIComponent(safeNext)}`);
            return;
          }

          if (res.status === 401 || res.status === 403) {
            const safeNext = sanitizeRedirectPath(pathname);
            router.replace(`/login?next=${encodeURIComponent(safeNext)}`);
            return;
          }
          setAuthStatus('authorized');
          return;
        }

        const json = (await res.json()) as {
          data?: {
            rol?: unknown;
            nombreCompleto?: unknown;
            email?: unknown;
            avatarUrl?: unknown;
          };
        };
        const data = json.data;
        const parsed = UserRoleSchema.safeParse(data?.rol);
        if (!parsed.success) {
          if (!userRole) {
            setAuthStatus('redirecting');
            router.replace('/login');
          }
          return;
        }

        const rol = parsed.data;
        setResolvedRole(rol);
        setUserSummary({
          nombreCompleto:
            typeof data?.nombreCompleto === 'string' &&
            data.nombreCompleto.trim().length > 0
              ? data.nombreCompleto.trim()
              : 'Mi Perfil',
          email: typeof data?.email === 'string' ? data.email : '',
          rol,
          avatarUrl:
            typeof data?.avatarUrl === 'string' &&
            data.avatarUrl.trim().length > 0
              ? data.avatarUrl.trim()
              : null,
        });
        setAvatarLoadError(false);

        const isAllowedOnPath =
          canRoleAccessPath(rol, pathname) &&
          (mode !== 'admin' || rol === 'SUPER_ADMIN');

        if (!isAllowedOnPath) {
          setAuthStatus('redirecting');
          router.replace(getDefaultHomeForRole(rol));
          return;
        }

        setAuthStatus('authorized');
      })
      .catch(() => {
        if (!cancelled) {
          setAuthStatus('authorized');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [mode, pathname, router, userRole]);

  React.useEffect(() => {
    if (!menuOpen) return;
    function handleOutsideClick(event: MouseEvent) {
      if (
        menuContainerRef.current &&
        event.target instanceof Node &&
        !menuContainerRef.current.contains(event.target)
      ) {
        setMenuOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      const supabase = createSupabaseBrowserClient();
      await supabase.auth.signOut();
      setMenuOpen(false);
      router.replace('/login?logged_out=1');
    } finally {
      setSigningOut(false);
    }
  }

  const isRoleForbiddenOnCurrentRoute =
    resolvedRole !== null &&
    (!canRoleAccessPath(resolvedRole, pathname) ||
      (mode === 'admin' && resolvedRole !== 'SUPER_ADMIN'));

  const navItems: readonly NavItem[] = React.useMemo(() => {
    if (resolvedRole === 'OPERADOR') {
      return CLIENT_OPERADOR_NAV_ITEMS;
    }
    if (mode === 'client') {
      if (resolvedRole === 'SUPER_ADMIN') {
        return [
          ...CLIENT_ADMIN_NAV_ITEMS,
          { href: '/admin/empresas', label: 'Admin SaaS', icon: ShieldCheck },
        ];
      }
      return CLIENT_ADMIN_NAV_ITEMS;
    }
    return ADMIN_NAV_ITEMS;
  }, [mode, resolvedRole]);

  const roleBadgeLabel =
    resolvedRole === 'OPERADOR'
      ? 'Rol: Operador'
      : resolvedRole === 'ADMIN_EMPRESA'
        ? 'Rol: Admin'
        : resolvedRole === 'SUPER_ADMIN'
          ? 'Rol: Super-Admin'
          : null;

  const initials = getInitials(userSummary.nombreCompleto, userSummary.email);
  const showAvatarImage = Boolean(userSummary.avatarUrl) && !avatarLoadError;

  return (
    <div className="flex min-h-dvh bg-[var(--bg)] text-[var(--text)]">
      {/* Sidebar Desktop */}
      <aside
        aria-label="Navegación principal"
        className="sticky top-0 hidden h-dvh w-[var(--sidebar-w)] shrink-0 flex-col justify-between border-r border-[var(--separator)] bg-[var(--surface-translucent)] p-[var(--s-5)] backdrop-blur-xl lg:flex"
      >
        <div className="flex flex-col gap-[var(--s-6)]">
          <div className="flex items-center gap-[var(--s-3)] px-[var(--s-2)]">
            <SmClockLogo size={40} className="shadow-[var(--shadow-1)] rounded-[10px]" />
            <div className="flex flex-col">
              <span className="text-base font-bold tracking-tight text-[var(--text)]">
                SM Clock
              </span>
              <span className="text-xs font-medium text-[var(--text-2)]">
                {resolvedRole === 'OPERADOR'
                  ? 'Portal de Operador'
                  : mode === 'client'
                    ? 'Control de Asistencia'
                    : 'Panel Super-Admin'}
              </span>
            </div>
          </div>

          <nav className="flex flex-col gap-[var(--s-1)]">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active =
                item.href === '/admin' || item.href === '/dashboard'
                  ? pathname === item.href
                  : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex min-h-[var(--touch-min)] items-center gap-[var(--s-3)] rounded-[var(--r-md)] px-[var(--s-3)] text-sm font-semibold transition-colors',
                    active
                      ? 'bg-[var(--accent)] text-[var(--text-on-accent)] shadow-[var(--shadow-1)]'
                      : 'text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]',
                  )}
                >
                  <Icon
                    className="size-5 shrink-0"
                    strokeWidth={1.75}
                    aria-hidden="true"
                  />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex flex-col gap-[var(--s-3)] border-t border-[var(--separator)] pt-[var(--s-4)]">
          {roleBadgeLabel ? (
            <div className="px-[var(--s-1)]">
              <Badge
                variant={resolvedRole === 'OPERADOR' ? 'info' : 'accent'}
              >
                {roleBadgeLabel}
              </Badge>
            </div>
          ) : null}
          <div
            role="status"
            aria-live="polite"
            className="flex items-center gap-[var(--s-2)] px-[var(--s-1)]"
          >
            <span
              className={cn(
                'size-2.5 rounded-full',
                realtimeState === 'reconnecting'
                  ? 'animate-pulse bg-[var(--warning)]'
                  : 'bg-[var(--success)]',
              )}
              aria-hidden="true"
            />
            <span className="text-xs font-semibold text-[var(--text)]">
              {realtimeState === 'reconnecting'
                ? 'Reconectando…'
                : 'En vivo · America/Tijuana'}
            </span>
          </div>
        </div>
      </aside>

      {/* Contenedor Principal */}
      <div className="flex min-w-0 flex-1 flex-col pb-[calc(var(--tabbar-h)+env(safe-area-inset-bottom))] lg:pb-0">
        <header className="sticky top-0 z-30 flex min-h-[var(--topbar-h)] flex-wrap items-center justify-between gap-[var(--s-3)] border-b border-[var(--separator)] bg-[var(--surface-translucent)] px-[var(--s-4)] py-[var(--s-3)] backdrop-blur-xl md:px-[var(--s-6)] lg:px-[var(--s-8)]">
          <div className="flex flex-col">
            <h1 className="text-xl font-bold tracking-tight text-[var(--text)] md:text-2xl">
              {title}
            </h1>
            {subtitle ? (
              <p className="text-xs font-medium text-[var(--text-2)] md:text-sm">
                {subtitle}
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-[var(--s-3)]">
            {!isRoleForbiddenOnCurrentRoute && authStatus !== 'redirecting'
              ? actions
              : null}
            <ThemeToggle />

            {/* Avatar de usuario en esquina superior derecha (solo imagen de avatar, sin texto de nombre) */}
            <div ref={menuContainerRef} className="relative">
              <button
                type="button"
                aria-label="Abrir menú de perfil y credenciales de usuario"
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                onClick={() => setMenuOpen((prev) => !prev)}
                className="relative flex size-10 min-h-[var(--touch-min)] min-w-[var(--touch-min)] shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--separator)] bg-[var(--accent)] text-xs font-bold text-[var(--text-on-accent)] shadow-[var(--shadow-1)] transition-transform active:scale-95 cursor-pointer"
              >
                {showAvatarImage && userSummary.avatarUrl ? (
                  <img
                    src={userSummary.avatarUrl}
                    alt="Avatar de usuario"
                    referrerPolicy="no-referrer"
                    onError={() => setAvatarLoadError(true)}
                    className="size-full rounded-full object-cover"
                  />
                ) : (
                  <span aria-hidden="true">{initials}</span>
                )}
              </button>

              {menuOpen ? (
                <div
                  role="menu"
                  aria-label="Opciones de cuenta y seguridad del usuario"
                  className="absolute right-0 z-50 mt-[var(--s-2)] w-72 rounded-[var(--r-lg)] border border-[var(--separator)] bg-[var(--surface)] p-[var(--s-3)] shadow-[var(--shadow-2)]"
                >
                  <div className="flex items-center gap-[var(--s-3)] border-b border-[var(--separator)] pb-[var(--s-3)]">
                    <span className="relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--accent)] text-xs font-bold text-[var(--text-on-accent)]">
                      {showAvatarImage && userSummary.avatarUrl ? (
                        <img
                          src={userSummary.avatarUrl}
                          alt={userSummary.nombreCompleto}
                          referrerPolicy="no-referrer"
                          onError={() => setAvatarLoadError(true)}
                          className="size-full rounded-full object-cover"
                        />
                      ) : (
                        <span aria-hidden="true">{initials}</span>
                      )}
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-bold text-[var(--text)]">
                        {userSummary.nombreCompleto}
                      </span>
                      {userSummary.email ? (
                        <span className="truncate text-xs text-[var(--text-2)]">
                          {userSummary.email}
                        </span>
                      ) : null}
                      {roleBadgeLabel ? (
                        <span className="mt-[var(--s-1)]">
                          <Badge
                            variant={
                              resolvedRole === 'OPERADOR' ? 'info' : 'accent'
                            }
                          >
                            {roleBadgeLabel}
                          </Badge>
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex flex-col gap-[var(--s-1)] py-[var(--s-2)]">
                    <Link
                      href="/perfil#credenciales"
                      role="menuitem"
                      onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-[var(--s-3)] rounded-[var(--r-md)] px-[var(--s-3)] py-[var(--s-2)] text-xs font-semibold text-[var(--text)] transition-colors hover:bg-[var(--surface-2)]"
                    >
                      <UserCheck
                        className="size-4 shrink-0 text-[var(--accent)]"
                        strokeWidth={1.75}
                        aria-hidden="true"
                      />
                      <div className="flex flex-col">
                        <span>Datos principales (Nombre y Email)</span>
                        <span className="text-[11px] font-normal text-[var(--text-2)]">
                          Editar perfil e información de cuenta
                        </span>
                      </div>
                    </Link>

                    <Link
                      href="/perfil#credenciales"
                      role="menuitem"
                      onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-[var(--s-3)] rounded-[var(--r-md)] px-[var(--s-3)] py-[var(--s-2)] text-xs font-semibold text-[var(--text)] transition-colors hover:bg-[var(--surface-2)]"
                    >
                      <KeyRound
                        className="size-4 shrink-0 text-[var(--accent)]"
                        strokeWidth={1.75}
                        aria-hidden="true"
                      />
                      <div className="flex flex-col">
                        <span>Usuario y Contraseña</span>
                        <span className="text-[11px] font-normal text-[var(--text-2)]">
                          Configurar o cambiar tu contraseña
                        </span>
                      </div>
                    </Link>

                    <Link
                      href="/perfil#biometricos"
                      role="menuitem"
                      onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-[var(--s-3)] rounded-[var(--r-md)] px-[var(--s-3)] py-[var(--s-2)] text-xs font-semibold text-[var(--text)] transition-colors hover:bg-[var(--surface-2)]"
                    >
                      <Fingerprint
                        className="size-4 shrink-0 text-[var(--accent)]"
                        strokeWidth={1.75}
                        aria-hidden="true"
                      />
                      <div className="flex flex-col">
                        <span>Biométricos y WebAuthn</span>
                        <span className="text-[11px] font-normal text-[var(--text-2)]">
                          Passkeys, Touch ID, Face ID y llaves 2FA
                        </span>
                      </div>
                    </Link>
                  </div>

                  <div className="border-t border-[var(--separator)] pt-[var(--s-2)]">
                    <button
                      type="button"
                      role="menuitem"
                      disabled={signingOut}
                      onClick={() => void handleSignOut()}
                      className="flex w-full items-center gap-[var(--s-3)] rounded-[var(--r-md)] px-[var(--s-3)] py-[var(--s-2)] text-left text-xs font-semibold text-[var(--danger)] transition-colors hover:bg-[var(--surface-2)] cursor-pointer"
                    >
                      <LogOut
                        className="size-4 shrink-0"
                        strokeWidth={1.75}
                        aria-hidden="true"
                      />
                      <span>
                        {signingOut ? 'Cerrando sesión…' : 'Cerrar sesión'}
                      </span>
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <main className="flex-1 p-[var(--s-4)] md:p-[var(--s-6)] lg:p-[var(--s-8)]">
          {authStatus === 'redirecting' || isRoleForbiddenOnCurrentRoute ? (
            <div
              role="alert"
              aria-live="assertive"
              className="mx-auto flex max-w-md flex-col items-center justify-center gap-[var(--s-3)] rounded-[var(--r-lg)] border border-[var(--separator)] bg-[var(--surface)] p-[var(--s-6)] text-center shadow-[var(--shadow-1)]"
            >
              <ShieldAlert
                className="size-8 text-[var(--warning)]"
                strokeWidth={1.75}
                aria-hidden="true"
              />
              <h2 className="text-base font-bold text-[var(--text)]">
                Acceso restringido por seguridad
              </h2>
              <p className="text-xs text-[var(--text-2)]">
                Redirigiendo automáticamente a tu vista autorizada…
              </p>
            </div>
          ) : (
            children
          )}
        </main>
      </div>

      {/* Tab Bar Inferior Móvil (máx 5 ítems) */}
      <nav
        aria-label="Navegación móvil"
        className="fixed inset-x-0 bottom-0 z-40 flex min-h-[var(--tabbar-h)] items-center justify-around border-t border-[var(--separator)] bg-[var(--surface-translucent)] pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden"
      >
        {navItems.slice(0, 5).map((item) => {
          const Icon = item.icon;
          const active =
            item.href === '/admin' || item.href === '/dashboard'
              ? pathname === item.href
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex min-h-[var(--touch-min)] flex-1 flex-col items-center justify-center gap-[var(--s-1)] py-[var(--s-1)] text-xs font-semibold',
                active ? 'text-[var(--accent)]' : 'text-[var(--text-2)]',
              )}
            >
              <Icon className="size-5" strokeWidth={1.75} aria-hidden="true" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
