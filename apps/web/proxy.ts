import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { JwtAppMetadataSchema, roleRequiresMfa } from '@sm-clock/contracts';

const PUBLIC_PATHS = [
  '/login',
  '/invitacion',
  '/recuperar-contrasena',
  '/restablecer-contrasena',
  '/api/invitaciones/verificar',
  '/api/invitaciones/aceptar',
  '/api/auth/callback',
  '/api/auth/recuperar-contrasena',
  '/api/auth/restablecer-contrasena',
  '/api/health',
  '/api/v1/agente',
];

const TENANT_ADMIN_ONLY_PATHS = [
  '/usuarios',
  '/configuracion',
  '/empleados',
  '/sucursales',
  '/dashboard/empleados',
  '/api/usuarios',
  '/api/configuracion',
  '/api/empleados',
  '/api/sucursales',
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (pub) => pathname === pub || pathname.startsWith(`${pub}/`),
  );
}

function isTenantAdminOnlyPath(pathname: string): boolean {
  return TENANT_ADMIN_ONLY_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === '/' || pathname === '/admin') {
    const dest = request.nextUrl.clone();
    dest.pathname = '/admin/empresas';
    return NextResponse.redirect(dest);
  }

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const supabaseUrl = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const supabaseAnonKey = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];
  const isDev = process.env['NODE_ENV'] === 'development';

  if (!supabaseUrl || !supabaseAnonKey) {
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

  if (!user) {
    if (isDev) {
      return response;
    }
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  const parsedMeta = JwtAppMetadataSchema.safeParse(user.app_metadata);
  if (!parsedMeta.success) {
    // Permitir que el servidor valide o reclame invitación en `perfiles_usuarios` / `invitaciones_usuarios`
    return response;
  }

  const { rol } = parsedMeta.data;

  // Verificar MFA obligatorio para SUPER_ADMIN y ADMIN_EMPRESA
  if (roleRequiresMfa(rol) && !pathname.startsWith('/mfa')) {
    const { data: aalData } =
      await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    const hasEnrolledFactor = aalData?.nextLevel === 'aal2';
    if (aalData?.currentLevel !== 'aal2' && (!isDev || hasEnrolledFactor)) {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json(
          { error: 'Se requiere verificación MFA (TOTP)' },
          { status: 403 },
        );
      }
      const mfaUrl = request.nextUrl.clone();
      mfaUrl.pathname = '/mfa';
      mfaUrl.searchParams.set('next', pathname);
      return NextResponse.redirect(mfaUrl);
    }
  }

  // Protección estricta de /admin/* y /api/admin/* solo para SUPER_ADMIN
  if (
    (pathname.startsWith('/admin') || pathname.startsWith('/api/admin')) &&
    rol !== 'SUPER_ADMIN'
  ) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { error: 'Acceso restringido a SUPER_ADMIN' },
        { status: 403 },
      );
    }
    const deniedUrl = request.nextUrl.clone();
    deniedUrl.pathname = '/dashboard';
    return NextResponse.redirect(deniedUrl);
  }

  // Protección estricta para OPERADOR: no puede acceder a CRUD de Usuarios, Configuración, Empleados ni Sucursales
  if (rol === 'OPERADOR' && isTenantAdminOnlyPath(pathname)) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        {
          error:
            'Acceso restringido a usuarios Administradores. El rol Operador solo puede consultar movimientos.',
        },
        { status: 403 },
      );
    }
    const deniedUrl = request.nextUrl.clone();
    deniedUrl.pathname = '/dashboard';
    return NextResponse.redirect(deniedUrl);
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
