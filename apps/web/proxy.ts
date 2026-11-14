import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import {
  canRoleAccessPath,
  getDefaultHomeForRole,
  isAuthGuestOnlyPath,
  isPublicPath,
  isSuperAdminOnlyPath,
  isTenantAdminOnlyPath,
  JwtAppMetadataSchema,
  roleRequiresMfa,
  sanitizeRedirectPath,
} from '@sm-clock/contracts';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 1. Protección Fetch Metadata (Sec-Fetch-Site) contra CSRF en endpoints mutantes de navegador
  if (
    pathname.startsWith('/api/') &&
    !pathname.startsWith('/api/v1/agente') &&
    MUTATING_METHODS.has(request.method.toUpperCase())
  ) {
    const secFetchSite = request.headers.get('sec-fetch-site');
    if (secFetchSite === 'cross-site') {
      return NextResponse.json(
        { error: 'Solicitud cross-site bloqueada por política de seguridad' },
        { status: 403 },
      );
    }
  }

  // 2. Rutas públicas que no son exclusivas de invitado (ej. /api/health, /invitacion, /api/v1/agente)
  if (isPublicPath(pathname) && !isAuthGuestOnlyPath(pathname)) {
    return NextResponse.next();
  }

  const supabaseUrl = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const supabaseAnonKey = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];
  const isDev = process.env['NODE_ENV'] === 'development';

  if (!supabaseUrl || !supabaseAnonKey) {
    if (pathname === '/' || pathname === '/admin') {
      const dest = request.nextUrl.clone();
      dest.pathname = '/admin/empresas';
      return NextResponse.redirect(dest);
    }
    return NextResponse.next();
  }

  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({
          request,
        });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 3. Usuario no autenticado
  if (!user) {
    if (isAuthGuestOnlyPath(pathname)) {
      return response;
    }
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.search = '';
    if (isSuperAdminOnlyPath(pathname)) {
      loginUrl.searchParams.set('mode', 'super_admin');
    } else if (pathname !== '/' && !pathname.startsWith('/mfa')) {
      loginUrl.searchParams.set(
        'next',
        sanitizeRedirectPath(`${pathname}${request.nextUrl.search}`),
      );
    }
    return NextResponse.redirect(loginUrl);
  }

  // 4. Usuario autenticado sin `rol` sincronizado aún en `app_metadata`
  const parsedMeta = JwtAppMetadataSchema.safeParse(user.app_metadata);
  if (!parsedMeta.success) {
    if (isAuthGuestOnlyPath(pathname)) {
      return response;
    }
    // Permitir que `/api/auth/me` reclame la invitación pendiente o aprovisione Bootstrap Super-Admin
    if (pathname === '/api/auth/me' || pathname.startsWith('/mfa')) {
      return response;
    }
    // Bloquear acceso a rutas administrativas si el JWT aún no acredita rol
    if (isSuperAdminOnlyPath(pathname) || isTenantAdminOnlyPath(pathname)) {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json(
          { error: 'Tu sesión aún no cuenta con permisos administrativos verificados' },
          { status: 403 },
        );
      }
      const fallbackUrl = request.nextUrl.clone();
      fallbackUrl.pathname = '/dashboard';
      fallbackUrl.search = '';
      return NextResponse.redirect(fallbackUrl);
    }
    if (pathname === '/') {
      const fallbackUrl = request.nextUrl.clone();
      fallbackUrl.pathname = '/dashboard';
      fallbackUrl.search = '';
      return NextResponse.redirect(fallbackUrl);
    }
    return response;
  }

  const { rol } = parsedMeta.data;

  // 5. Verificación MFA (TOTP / WebAuthn) obligatoria para SUPER_ADMIN y ADMIN_EMPRESA
  if (roleRequiresMfa(rol)) {
    const { data: aalData } =
      await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    const hasEnrolledFactor = aalData?.nextLevel === 'aal2';
    const requiresMfaChallenge =
      aalData?.currentLevel !== 'aal2' && (!isDev || hasEnrolledFactor);

    if (requiresMfaChallenge) {
      if (pathname.startsWith('/mfa') || pathname === '/api/auth/me') {
        return response;
      }
      if (pathname.startsWith('/api/')) {
        return NextResponse.json(
          { error: 'Se requiere verificación MFA (TOTP)' },
          { status: 403 },
        );
      }
      const mfaUrl = request.nextUrl.clone();
      mfaUrl.pathname = '/mfa';
      mfaUrl.search = '';
      if (pathname !== '/' && !isAuthGuestOnlyPath(pathname)) {
        mfaUrl.searchParams.set(
          'next',
          sanitizeRedirectPath(`${pathname}${request.nextUrl.search}`, rol),
        );
      }
      return NextResponse.redirect(mfaUrl);
    }

    // Si ya completó MFA (aal2) e intenta abrir /mfa, redirigir a su ruta autorizada
    if (pathname.startsWith('/mfa') && aalData?.currentLevel === 'aal2') {
      const targetPath = sanitizeRedirectPath(
        request.nextUrl.searchParams.get('next'),
        rol,
      );
      return NextResponse.redirect(new URL(targetPath, request.url));
    }
  } else if (pathname.startsWith('/mfa')) {
    // El rol OPERADOR no requiere MFA; redirigir a su panel
    const targetPath = sanitizeRedirectPath(
      request.nextUrl.searchParams.get('next'),
      rol,
    );
    return NextResponse.redirect(new URL(targetPath, request.url));
  }

  // 6. Si un usuario ya autenticado visita /login o /recuperar-contrasena (sin query de logout o error), redirigir a su home
  if (
    isAuthGuestOnlyPath(pathname) &&
    !request.nextUrl.searchParams.has('logged_out') &&
    !request.nextUrl.searchParams.has('error')
  ) {
    const targetPath = sanitizeRedirectPath(
      request.nextUrl.searchParams.get('next'),
      rol,
    );
    return NextResponse.redirect(new URL(targetPath, request.url));
  }

  // 7. Resolución segura de raíz `/` y `/admin` según el rol verificado
  if (pathname === '/') {
    const dest = request.nextUrl.clone();
    dest.pathname = getDefaultHomeForRole(rol);
    dest.search = '';
    return NextResponse.redirect(dest);
  }

  if (pathname === '/admin') {
    const dest = request.nextUrl.clone();
    dest.pathname = rol === 'SUPER_ADMIN' ? '/admin/empresas' : '/dashboard';
    dest.search = '';
    return NextResponse.redirect(dest);
  }

  // 8. Guard de autorización por rol en todas las rutas protegidas (lista blanca)
  if (!canRoleAccessPath(rol, pathname)) {
    if (pathname.startsWith('/api/')) {
      const errorMsg = isSuperAdminOnlyPath(pathname)
        ? 'Acceso restringido a SUPER_ADMIN'
        : 'Acceso restringido a usuarios Administradores. El rol Operador solo puede consultar movimientos.';
      return NextResponse.json({ error: errorMsg }, { status: 403 });
    }
    const deniedUrl = request.nextUrl.clone();
    deniedUrl.pathname = getDefaultHomeForRole(rol);
    deniedUrl.search = '';
    return NextResponse.redirect(deniedUrl);
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
