'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity,
  Building2,
  Clock,
  LayoutDashboard,
  Radio,
  Settings,
  ShieldCheck,
  UserPlus,
  Users,
} from 'lucide-react';
import { UserRoleSchema, type UserRole } from '@sm-clock/contracts';
import { ThemeToggle } from '@/components/theme-toggle';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export interface NavItem {
  href: string;
  label: string;
  icon: typeof Building2;
}

const ADMIN_NAV_ITEMS: readonly NavItem[] = [
  { href: '/admin/empresas', label: 'Empresas', icon: Building2 },
  { href: '/admin/agentes', label: 'Agentes', icon: Radio },
  { href: '/admin/administradores', label: 'Super-Admins', icon: ShieldCheck },
  { href: '/dashboard', label: 'Dashboard Vivo', icon: Activity },
  { href: '/empleados', label: 'Empleados', icon: Users },
  { href: '/sucursales', label: 'Sucursales', icon: Clock },
  { href: '/usuarios', label: 'Usuarios', icon: UserPlus },
  { href: '/configuracion', label: 'Configuración', icon: Settings },
] as const;

const CLIENT_ADMIN_NAV_ITEMS: readonly NavItem[] = [
  { href: '/dashboard', label: 'En Vivo', icon: LayoutDashboard },
  { href: '/empleados', label: 'Empleados', icon: Users },
  { href: '/sucursales', label: 'Sucursales', icon: Building2 },
  { href: '/usuarios', label: 'Usuarios', icon: UserPlus },
  { href: '/configuracion', label: 'Configuración', icon: Settings },
] as const;

const CLIENT_OPERADOR_NAV_ITEMS: readonly NavItem[] = [
  { href: '/dashboard', label: 'Movimientos en Vivo', icon: LayoutDashboard },
  { href: '/dashboard/checadas', label: 'Consulta y Descarga', icon: Clock },
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

/**
 * Layout responsivo estilo iOS (`docs/UI-UX-IOS.md` §2.4 y §7):
 * - Desktop (`lg+`): Sidebar translúcida + barra superior con ThemeToggle e indicador Realtime.
 * - Móvil (`<lg`): Tab bar inferior translúcida (máx. 5 ítems) con `safe-area-inset-bottom`.
 * - Filtra opciones de navegación según rol (`OPERADOR` solo consulta movimientos y exporta).
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
  const pathname = usePathname();
  const [resolvedRole, setResolvedRole] = React.useState<UserRole | null>(
    userRole ?? null,
  );

  React.useEffect(() => {
    if (userRole) {
      setResolvedRole(userRole);
      return;
    }
    let cancelled = false;
    void fetch('/api/auth/me')
      .then(async (res) => {
        if (!res.ok) return null;
        const json = (await res.json()) as { data?: { rol?: unknown } };
        return json.data?.rol;
      })
      .then((rawRol) => {
        if (cancelled) return;
        const parsed = UserRoleSchema.safeParse(rawRol);
        if (parsed.success) {
          setResolvedRole(parsed.data);
        }
      })
      .catch(() => {
        // Fallback silencioso en modo offline/test
      });
    return () => {
      cancelled = true;
    };
  }, [userRole]);

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

  return (
    <div className="flex min-h-dvh bg-[var(--bg)] text-[var(--text)]">
      {/* Sidebar Desktop */}
      <aside
        aria-label="Navegación principal"
        className="sticky top-0 hidden h-dvh w-[var(--sidebar-w)] shrink-0 flex-col justify-between border-r border-[var(--separator)] bg-[var(--surface-translucent)] p-[var(--s-5)] backdrop-blur-xl lg:flex"
      >
        <div className="flex flex-col gap-[var(--s-6)]">
          <div className="flex items-center gap-[var(--s-3)] px-[var(--s-2)]">
            <div className="flex size-10 items-center justify-center rounded-[var(--r-md)] bg-[var(--accent)] text-[var(--text-on-accent)] shadow-[var(--shadow-1)]">
              <Clock className="size-5" strokeWidth={1.75} aria-hidden="true" />
            </div>
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
            <ThemeToggle />
            {actions}
          </div>
        </header>

        <main className="flex-1 p-[var(--s-4)] md:p-[var(--s-6)] lg:p-[var(--s-8)]">
          {children}
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
