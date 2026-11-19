'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import {
  Building2,
  ChevronsUpDown,
  Clock,
  Fingerprint,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  PanelLeft,
  PanelLeftClose,
  Radio,
  Settings,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  UserCircle,
  UserPlus,
  Users,
  X,
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
  tenantNombre?: string | null;
  children: React.ReactNode;
}

interface HeaderUserSummary {
  nombreCompleto: string;
  email: string;
  rol: UserRole | null;
  avatarUrl: string | null;
  tenantNombre: string | null;
}

function getInitials(name: string, email: string): string {
  const source = name.trim() || email.trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}`.toUpperCase();
  }
  return (source.slice(0, 2) || 'US').toUpperCase();
}

interface UserNavMenuProps {
  userSummary: HeaderUserSummary;
  showAvatarImage: boolean;
  onAvatarError: () => void;
  initials: string;
  roleBadgeLabel: string | null;
  signingOut: boolean;
  onSignOut: () => void;
  onItemClick?: () => void;
}

function UserNavMenu({
  userSummary,
  showAvatarImage,
  onAvatarError,
  initials,
  roleBadgeLabel,
  signingOut,
  onSignOut,
  onItemClick,
}: UserNavMenuProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!isOpen) return;
    function handleOutsideClick(event: MouseEvent) {
      if (
        containerRef.current &&
        event.target instanceof Node &&
        !containerRef.current.contains(event.target)
      ) {
        setIsOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handleAction = () => {
    setIsOpen(false);
    onItemClick?.();
  };

  return (
    <div ref={containerRef} className="relative w-full">
      <AnimatePresence>
        {isOpen ? (
          <motion.div
            role="menu"
            aria-label="Opciones de cuenta y seguridad del usuario"
            initial={{ opacity: 0, scale: 0.95, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 8 }}
            transition={{ type: 'spring', stiffness: 450, damping: 32 }}
            className="absolute bottom-full left-0 right-0 z-50 mb-[var(--s-2)] rounded-[var(--r-lg)] border border-[var(--separator)] bg-[var(--surface)] p-[var(--s-3)] shadow-[var(--shadow-2)]"
          >
            {roleBadgeLabel || userSummary.tenantNombre ? (
              <div className="flex flex-col gap-[var(--s-2)] border-b border-[var(--separator)] px-[var(--s-3)] pb-[var(--s-2)]">
                {roleBadgeLabel ? (
                  <div className="flex items-center gap-[var(--s-3)]">
                    <ShieldCheck
                      className="size-4 shrink-0 text-[var(--accent)]"
                      strokeWidth={1.75}
                      aria-hidden="true"
                    />
                    <Badge
                      variant={
                        userSummary.rol === 'OPERADOR' ? 'info' : 'accent'
                      }
                    >
                      {roleBadgeLabel}
                    </Badge>
                  </div>
                ) : null}
                {userSummary.tenantNombre ? (
                  <div
                    data-testid="user-nav-tenant-item"
                    className="flex items-center gap-[var(--s-2)] text-xs text-[var(--text-2)]"
                  >
                    <Building2
                      className="size-3.5 shrink-0 text-[var(--accent)]"
                      strokeWidth={2}
                      aria-hidden="true"
                    />
                    <span
                      className="truncate font-semibold text-[var(--text)]"
                      title={userSummary.tenantNombre}
                    >
                      {userSummary.tenantNombre}
                    </span>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="flex flex-col gap-[var(--s-1)] py-[var(--s-2)]">
              <Link
                href="/perfil#credenciales"
                role="menuitem"
                onClick={handleAction}
                className="flex items-center gap-[var(--s-3)] rounded-[var(--r-md)] px-[var(--s-3)] py-[var(--s-2)] text-xs font-semibold text-[var(--text)] transition-colors hover:bg-[var(--surface-2)]"
              >
                <UserCheck
                  className="size-4 shrink-0 text-[var(--accent)]"
                  strokeWidth={1.75}
                  aria-hidden="true"
                />
                <div className="flex flex-col">
                  <span>Datos principales (Nombre y Email)</span>
                  <span className="text-xs font-normal text-[var(--text-2)]">
                    Editar perfil e información de cuenta
                  </span>
                </div>
              </Link>

              <Link
                href="/perfil#credenciales"
                role="menuitem"
                onClick={handleAction}
                className="flex items-center gap-[var(--s-3)] rounded-[var(--r-md)] px-[var(--s-3)] py-[var(--s-2)] text-xs font-semibold text-[var(--text)] transition-colors hover:bg-[var(--surface-2)]"
              >
                <KeyRound
                  className="size-4 shrink-0 text-[var(--accent)]"
                  strokeWidth={1.75}
                  aria-hidden="true"
                />
                <div className="flex flex-col">
                  <span>Usuario y Contraseña</span>
                  <span className="text-xs font-normal text-[var(--text-2)]">
                    Configurar o cambiar tu contraseña
                  </span>
                </div>
              </Link>

              <Link
                href="/perfil#biometricos"
                role="menuitem"
                onClick={handleAction}
                className="flex items-center gap-[var(--s-3)] rounded-[var(--r-md)] px-[var(--s-3)] py-[var(--s-2)] text-xs font-semibold text-[var(--text)] transition-colors hover:bg-[var(--surface-2)]"
              >
                <Fingerprint
                  className="size-4 shrink-0 text-[var(--accent)]"
                  strokeWidth={1.75}
                  aria-hidden="true"
                />
                <div className="flex flex-col">
                  <span>Biométricos y WebAuthn</span>
                  <span className="text-xs font-normal text-[var(--text-2)]">
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
                onClick={() => {
                  setIsOpen(false);
                  onSignOut();
                }}
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
          </motion.div>
        ) : null}
      </AnimatePresence>

      <button
        type="button"
        aria-label="Abrir menú de perfil y credenciales de usuario"
        aria-expanded={isOpen}
        aria-haspopup="menu"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex min-h-[var(--touch-min)] w-full items-center gap-[var(--s-3)] rounded-[var(--r-md)] border border-[var(--separator)] bg-[var(--surface-2)] p-[var(--s-2)] text-left transition-colors hover:bg-[var(--surface)] active:scale-[0.98] cursor-pointer"
      >
        <span className="relative flex size-9 min-h-[36px] min-w-[36px] shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--accent)] text-xs font-bold text-[var(--text-on-accent)] shadow-[var(--shadow-1)]">
          {showAvatarImage && userSummary.avatarUrl ? (
            <img
              src={userSummary.avatarUrl}
              alt="Avatar de usuario"
              referrerPolicy="no-referrer"
              onError={onAvatarError}
              className="size-full rounded-full object-cover"
            />
          ) : (
            <span aria-hidden="true">{initials}</span>
          )}
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-xs font-bold text-[var(--text)]">
            {userSummary.nombreCompleto}
          </span>
          <span className="truncate text-[11px] text-[var(--text-2)]">
            {userSummary.tenantNombre ?? userSummary.email}
          </span>
        </div>
        <ChevronsUpDown
          className="size-4 shrink-0 text-[var(--text-2)]"
          strokeWidth={1.75}
          aria-hidden="true"
        />
      </button>
    </div>
  );
}

/**
 * Layout responsivo estilo iOS (`docs/UI-UX-IOS.md` §2.4 y §7) con Browser Routing Guard
 * y Avatar de Usuario en la parte inferior del menú de navegación.
 */
export function AppShell({
  title,
  subtitle,
  actions,
  realtimeState = 'connected',
  mode = 'admin',
  userRole,
  tenantNombre,
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
    tenantNombre: tenantNombre ?? null,
  });
  const [avatarLoadError, setAvatarLoadError] = React.useState(false);
  const [signingOut, setSigningOut] = React.useState(false);

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
            tenantNombre?: unknown;
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
          tenantNombre:
            tenantNombre ??
            (typeof data?.tenantNombre === 'string' &&
              data.tenantNombre.trim().length > 0
              ? data.tenantNombre.trim()
              : null),
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

  async function handleSignOut() {
    setSigningOut(true);
    try {
      const supabase = createSupabaseBrowserClient();
      await supabase.auth.signOut();
      router.replace('/login?logged_out=1');
    } finally {
      setSigningOut(false);
    }
  }

  // Estado y persistencia del menú lateral en escritorio
  const [desktopSidebarOpen, setDesktopSidebarOpen] = React.useState<boolean>(true);
  // Estado del cajón de navegación para móviles y tabletas
  const [mobileDrawerOpen, setMobileDrawerOpen] = React.useState<boolean>(false);
  // Detección reactiva de pantalla móvil o tablet (< 1024px)
  const [isMobileScreen, setIsMobileScreen] = React.useState<boolean>(false);

  React.useEffect(() => {
    function checkMobile() {
      setIsMobileScreen(window.innerWidth < 1024);
    }
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  React.useEffect(() => {
    try {
      const stored = localStorage.getItem('sm_clock_sidebar_open');
      if (stored !== null) {
        setDesktopSidebarOpen(stored === 'true');
      }
    } catch {
      // Ignorar bloqueos de almacenamiento local
    }
  }, []);

  const toggleDesktopSidebar = React.useCallback(() => {
    setDesktopSidebarOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('sm_clock_sidebar_open', String(next));
      } catch {
        // Ignorar bloqueos de almacenamiento local
      }
      return next;
    });
  }, []);

  // Cierra el cajón móvil al cambiar de ruta
  React.useEffect(() => {
    setMobileDrawerOpen(false);
  }, [pathname]);

  // Bloqueo de scroll y tecla Escape para el cajón de navegación móvil/tablet
  React.useEffect(() => {
    if (!mobileDrawerOpen) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setMobileDrawerOpen(false);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [mobileDrawerOpen]);

  // Gesto táctil desde el borde izquierdo (edge swipe) para abrir en móviles y tablets
  React.useEffect(() => {
    let startX: number | null = null;
    let startY: number | null = null;

    function handleTouchStart(e: TouchEvent) {
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      if (!touch) return;
      // Solo iniciar el gesto si el toque comienza a menos de 32px del borde izquierdo
      if (touch.clientX <= 32) {
        startX = touch.clientX;
        startY = touch.clientY;
      } else {
        startX = null;
        startY = null;
      }
    }

    function handleTouchEnd(e: TouchEvent) {
      if (startX === null || startY === null) return;
      const touch = e.changedTouches[0];
      if (!touch) return;
      const deltaX = touch.clientX - startX;
      const deltaY = touch.clientY - startY;

      // Deslizamiento horizontal hacia la derecha de al menos 45px
      if (deltaX > 45 && Math.abs(deltaX) > Math.abs(deltaY) * 1.2) {
        setMobileDrawerOpen(true);
      }

      startX = null;
      startY = null;
    }

    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchend', handleTouchEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, []);

  // Control táctil para deslizar hacia la izquierda y cerrar el panel móvil/tablet
  const touchDrawerStartXRef = React.useRef<number | null>(null);
  const touchDrawerStartYRef = React.useRef<number | null>(null);

  function handleDrawerTouchStart(e: React.TouchEvent) {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    if (!touch) return;
    touchDrawerStartXRef.current = touch.clientX;
    touchDrawerStartYRef.current = touch.clientY;
  }

  function handleDrawerTouchEnd(e: React.TouchEvent) {
    if (touchDrawerStartXRef.current === null || touchDrawerStartYRef.current === null) return;
    const touch = e.changedTouches[0];
    if (!touch) return;
    const deltaX = touch.clientX - touchDrawerStartXRef.current;
    const deltaY = touch.clientY - touchDrawerStartYRef.current;

    // Deslizamiento hacia la izquierda de al menos 45px para cerrar
    if (deltaX < -45 && Math.abs(deltaX) > Math.abs(deltaY) * 1.1) {
      setMobileDrawerOpen(false);
    }

    touchDrawerStartXRef.current = null;
    touchDrawerStartYRef.current = null;
  }

  function handleNavToggle() {
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      setMobileDrawerOpen((prev) => !prev);
    } else {
      toggleDesktopSidebar();
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

  const hasMoreNavItems = navItems.length > 5;
  const mobileTabBarItems = React.useMemo(() => {
    if (navItems.length <= 5) return navItems;
    return navItems.slice(0, 4);
  }, [navItems]);

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
  const currentTenantNombre = tenantNombre ?? userSummary.tenantNombre;

  return (
    <div className="flex min-h-dvh bg-[var(--bg)] text-[var(--text)]">
      {/* Sidebar Desktop */}
      <aside
        id="desktop-nav-sidebar"
        aria-label="Navegación principal"
        className={cn(
          'sticky top-0 hidden h-dvh shrink-0 flex-col justify-between border-r border-[var(--separator)] bg-[var(--surface-translucent)] backdrop-blur-xl transition-[width,padding,opacity] duration-200 ease-in-out lg:flex',
          desktopSidebarOpen
            ? 'w-[var(--sidebar-w)] p-[var(--s-5)] opacity-100'
            : 'w-0 p-0 border-r-0 opacity-0 overflow-hidden pointer-events-none',
        )}
      >
        <div className="flex flex-col gap-[var(--s-4)]">
          <div className="flex items-center justify-between gap-[var(--s-2)] px-[var(--s-2)]">
            <div className="flex items-center gap-[var(--s-3)] min-w-0">
              <SmClockLogo size={40} className="shrink-0 shadow-[var(--shadow-1)] rounded-[10px]" />
              <div className="flex flex-col min-w-0">
                <span className="text-base font-bold tracking-tight text-[var(--text)] truncate">
                  SM Clock
                </span>
                <span className="text-xs font-medium text-[var(--text-2)] truncate">
                  {resolvedRole === 'OPERADOR'
                    ? 'Portal de Operador'
                    : mode === 'client'
                      ? 'Control de Asistencia'
                      : 'Panel Super-Admin'}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={toggleDesktopSidebar}
              aria-label="Colapsar barra lateral"
              title="Colapsar barra lateral"
              className="flex size-8 min-h-[32px] min-w-[32px] shrink-0 items-center justify-center rounded-[var(--r-sm)] text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--text)] transition-colors active:scale-95 cursor-pointer"
            >
              <PanelLeftClose className="size-4" strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>

          {mode === 'client' && currentTenantNombre ? (
            <div
              data-testid="sidebar-tenant-badge"
              className="mx-[var(--s-1)] flex items-center gap-[var(--s-2)] rounded-[var(--r-md)] border border-[var(--separator)] bg-[var(--surface-2)]/80 px-[var(--s-3)] py-[var(--s-2)] text-xs shadow-xs"
            >
              <div className="flex size-7 shrink-0 items-center justify-center rounded-[var(--r-sm)] bg-[var(--surface)] text-[var(--accent)]">
                <Building2 className="size-4" strokeWidth={2} aria-hidden="true" />
              </div>
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-2)]">
                  Empresa
                </span>
                <span
                  className="truncate text-xs font-bold text-[var(--text)]"
                  title={currentTenantNombre}
                >
                  {currentTenantNombre}
                </span>
              </div>
            </div>
          ) : null}

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

          <UserNavMenu
            userSummary={userSummary}
            showAvatarImage={showAvatarImage}
            onAvatarError={() => setAvatarLoadError(true)}
            initials={initials}
            roleBadgeLabel={roleBadgeLabel}
            signingOut={signingOut}
            onSignOut={() => void handleSignOut()}
          />
        </div>
      </aside>

      {/* Contenedor Principal */}
      <div className="flex min-w-0 flex-1 flex-col pb-[calc(var(--tabbar-h)+env(safe-area-inset-bottom))] lg:pb-0">
        <header className="sticky top-0 z-30 flex min-h-[var(--topbar-h)] flex-wrap items-center justify-between gap-[var(--s-3)] border-b border-[var(--separator)] bg-[var(--surface-translucent)] px-[var(--s-4)] py-[var(--s-3)] backdrop-blur-xl md:px-[var(--s-6)] lg:px-[var(--s-8)]">
          <div className="flex items-center gap-[var(--s-3)]">
            <button
              type="button"
              onClick={handleNavToggle}
              aria-label={
                isMobileScreen
                  ? mobileDrawerOpen
                    ? 'Cerrar menú de navegación'
                    : 'Abrir menú de navegación'
                  : desktopSidebarOpen
                    ? 'Colapsar menú lateral'
                    : 'Expandir menú lateral'
              }
              aria-expanded={isMobileScreen ? mobileDrawerOpen : desktopSidebarOpen}
              aria-controls={isMobileScreen ? 'mobile-nav-drawer' : 'desktop-nav-sidebar'}
              title={
                isMobileScreen
                  ? mobileDrawerOpen
                    ? 'Cerrar menú de navegación'
                    : 'Abrir menú de navegación'
                  : desktopSidebarOpen
                    ? 'Colapsar menú lateral'
                    : 'Expandir menú lateral'
              }
              className="flex size-10 min-h-[var(--touch-min)] min-w-[var(--touch-min)] shrink-0 items-center justify-center rounded-[var(--r-md)] border border-[var(--separator)] bg-[var(--surface-2)] text-[var(--text)] shadow-[var(--shadow-1)] transition-transform active:scale-95 hover:bg-[var(--surface)] hover:text-[var(--accent)] cursor-pointer"
            >
              <Menu className="size-5 lg:hidden" strokeWidth={1.75} aria-hidden="true" />
              <PanelLeft
                className={cn(
                  'hidden size-5 lg:block transition-transform',
                  !desktopSidebarOpen && 'rotate-180',
                )}
                strokeWidth={1.75}
                aria-hidden="true"
              />
            </button>

            <div className="flex flex-col">
              <div className="flex items-center gap-[var(--s-2)] flex-wrap">
                <h1 className="text-xl font-bold tracking-tight text-[var(--text)] md:text-2xl">
                  {title}
                </h1>
                {mode === 'client' && currentTenantNombre ? (
                  <span
                    data-testid="header-tenant-badge"
                    className="inline-flex items-center gap-[var(--s-1)] rounded-[var(--r-pill)] border border-[var(--separator)] bg-[var(--surface-2)] px-[var(--s-3)] py-[var(--s-1)] text-xs font-semibold text-[var(--text)] shadow-xs"
                  >
                    <Building2 className="size-3 text-[var(--accent)] shrink-0" strokeWidth={2} aria-hidden="true" />
                    <span className="max-w-[200px] truncate sm:max-w-[320px]" title={currentTenantNombre}>
                      {currentTenantNombre}
                    </span>
                  </span>
                ) : null}
              </div>
              {subtitle ? (
                <p className="text-xs font-medium text-[var(--text-2)] md:text-sm">
                  {subtitle}
                </p>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-[var(--s-3)]">
            {!isRoleForbiddenOnCurrentRoute && authStatus !== 'redirecting'
              ? actions
              : null}
            <ThemeToggle />
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
        {mobileTabBarItems.map((item) => {
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
                'relative flex min-h-[var(--touch-min)] flex-1 flex-col items-center justify-center gap-[var(--s-1)] py-[var(--s-1)] text-xs font-semibold transition-colors',
                active ? 'text-[var(--accent)]' : 'text-[var(--text-2)]',
              )}
            >
              {active ? (
                <motion.span
                  layoutId="mobile-tab-indicator"
                  transition={{ type: 'spring', stiffness: 400, damping: 34 }}
                  className="absolute inset-x-2 inset-y-1 -z-10 rounded-[var(--r-md)] bg-[var(--surface-2)]"
                />
              ) : null}
              <Icon className="size-5" strokeWidth={1.75} aria-hidden="true" />
              <span>{item.label}</span>
            </Link>
          );
        })}
        {hasMoreNavItems ? (
          <button
            type="button"
            onClick={() => setMobileDrawerOpen(true)}
            aria-label="Abrir menú completo de navegación"
            aria-expanded={mobileDrawerOpen}
            aria-controls="mobile-nav-drawer"
            className={cn(
              'relative flex min-h-[var(--touch-min)] flex-1 flex-col items-center justify-center gap-[var(--s-1)] py-[var(--s-1)] text-xs font-semibold transition-colors active:scale-95 cursor-pointer',
              mobileDrawerOpen
                ? 'text-[var(--accent)]'
                : 'text-[var(--text-2)] hover:text-[var(--text)]',
            )}
          >
            <Menu className="size-5" strokeWidth={1.75} aria-hidden="true" />
            <span>Menú</span>
          </button>
        ) : null}
      </nav>

      {/* Cajón de Navegación Móvil y Tablet (con soporte para deslizar con el dedo / swipe / touch) */}
      <AnimatePresence>
        {mobileDrawerOpen ? (
          <div
            id="mobile-nav-drawer-root"
            className="fixed inset-0 z-50 flex lg:hidden"
          >
            {/* Backdrop translúcido */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setMobileDrawerOpen(false)}
              className="fixed inset-0 bg-black/40 backdrop-blur-sm"
              aria-hidden="true"
            />

            {/* Hoja / Cajón lateral deslizable con soporte de arrastre por toque */}
            <motion.aside
              id="mobile-nav-drawer"
              role="dialog"
              aria-modal="true"
              aria-label="Menú de navegación principal"
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', stiffness: 400, damping: 34 }}
              drag="x"
              dragConstraints={{ left: -320, right: 0 }}
              dragElastic={{ left: 0.05, right: 0 }}
              onDragEnd={(_e, info) => {
                if (info.offset.x < -60 || info.velocity.x < -300) {
                  setMobileDrawerOpen(false);
                }
              }}
              onTouchStart={handleDrawerTouchStart}
              onTouchEnd={handleDrawerTouchEnd}
              className="relative z-10 flex h-dvh w-[min(300px,85vw)] flex-col justify-between border-r border-[var(--separator)] bg-[var(--surface)] p-[var(--s-5)] shadow-[var(--shadow-2)] touch-pan-y"
            >
              {/* Indicador táctil de deslizamiento (iOS grab handle) */}
              <div
                aria-hidden="true"
                className="absolute right-2 top-1/2 -translate-y-1/2 flex flex-col items-center justify-center pointer-events-none"
              >
                <span className="h-12 w-1.5 rounded-full bg-[var(--separator)] opacity-60" />
              </div>

              <div className="flex flex-col gap-[var(--s-4)]">
                {/* Encabezado con Logo y Botón de Cierre */}
                <div className="flex items-center justify-between gap-[var(--s-2)] px-[var(--s-1)]">
                  <div className="flex items-center gap-[var(--s-3)] min-w-0">
                    <SmClockLogo size={36} className="shrink-0 shadow-[var(--shadow-1)] rounded-[10px]" />
                    <div className="flex flex-col min-w-0">
                      <span className="text-base font-bold tracking-tight text-[var(--text)] truncate">
                        SM Clock
                      </span>
                      <span className="text-xs font-medium text-[var(--text-2)] truncate">
                        {resolvedRole === 'OPERADOR'
                          ? 'Portal de Operador'
                          : mode === 'client'
                            ? 'Control de Asistencia'
                            : 'Panel Super-Admin'}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setMobileDrawerOpen(false)}
                    aria-label="Cerrar panel de navegación"
                    className="flex size-10 min-h-[var(--touch-min)] min-w-[var(--touch-min)] shrink-0 items-center justify-center rounded-[var(--r-md)] border border-[var(--separator)] bg-[var(--surface-2)] text-[var(--text-2)] hover:bg-[var(--surface)] hover:text-[var(--text)] transition-colors active:scale-95 cursor-pointer"
                  >
                    <X className="size-5" strokeWidth={1.75} aria-hidden="true" />
                  </button>
                </div>

                {mode === 'client' && currentTenantNombre ? (
                  <div
                    data-testid="mobile-tenant-badge"
                    className="flex items-center gap-[var(--s-2)] rounded-[var(--r-md)] border border-[var(--separator)] bg-[var(--surface-2)]/80 px-[var(--s-3)] py-[var(--s-2)] text-xs shadow-xs"
                  >
                    <div className="flex size-7 shrink-0 items-center justify-center rounded-[var(--r-sm)] bg-[var(--surface)] text-[var(--accent)]">
                      <Building2 className="size-4" strokeWidth={2} aria-hidden="true" />
                    </div>
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-2)]">
                        Empresa
                      </span>
                      <span
                        className="truncate text-xs font-bold text-[var(--text)]"
                        title={currentTenantNombre}
                      >
                        {currentTenantNombre}
                      </span>
                    </div>
                  </div>
                ) : null}

                {/* Enlaces de navegación */}
                <nav className="flex flex-col gap-[var(--s-1)] overflow-y-auto pr-[var(--s-1)]">
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
                        onClick={() => setMobileDrawerOpen(false)}
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

              {/* Pie con Estado Realtime y Avatar de Usuario con Menú de Opciones */}
              <div className="flex flex-col gap-[var(--s-3)] border-t border-[var(--separator)] pt-[var(--s-4)]">
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

                <UserNavMenu
                  userSummary={userSummary}
                  showAvatarImage={showAvatarImage}
                  onAvatarError={() => setAvatarLoadError(true)}
                  initials={initials}
                  roleBadgeLabel={roleBadgeLabel}
                  signingOut={signingOut}
                  onSignOut={() => void handleSignOut()}
                  onItemClick={() => setMobileDrawerOpen(false)}
                />
              </div>
            </motion.aside>
          </div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
