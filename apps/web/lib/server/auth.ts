import 'server-only';
import {
  JwtAppMetadataSchema,
  roleRequiresMfa,
  UserRoleSchema,
  type Json,
  type UserRole,
} from '@sm-clock/contracts';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/server/supabase-admin';

export interface AuthenticatedContext {
  userId: string;
  email: string;
  rol: UserRole;
  tenantId: string | null;
  aal: 'aal1' | 'aal2';
}

export class AuthError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: 401 | 403 = 401) {
    super(message);
    this.name = 'AuthError';
    this.statusCode = statusCode;
  }
}

/**
 * Obtiene la lista blanca de correos autorizados como SUPER_ADMIN fundadores
 * desde la variable de entorno `SUPER_ADMIN_BOOTSTRAP_EMAILS` (separada por comas).
 */
export function getBootstrapSuperAdminEmails(): string[] {
  const raw = process.env['SUPER_ADMIN_BOOTSTRAP_EMAILS'] ?? '';
  return raw
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0);
}

export function isBootstrapSuperAdminEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  return getBootstrapSuperAdminEmails().includes(normalized);
}

/**
 * Si el correo autenticado con Google pertenece a `SUPER_ADMIN_BOOTSTRAP_EMAILS`,
 * aprovisiona o reactiva automáticamente su perfil `SUPER_ADMIN` (`tenant_id = null`).
 */
export async function claimBootstrapSuperAdminForUser(params: {
  userId: string;
  email: string;
  fullNameFallback?: string | null;
}): Promise<{ rol: 'SUPER_ADMIN'; tenantId: null } | null> {
  const normalizedEmail = params.email.trim().toLowerCase();
  if (!isBootstrapSuperAdminEmail(normalizedEmail)) {
    return null;
  }

  const adminClient = createSupabaseServiceClient();
  const nowIso = new Date().toISOString();
  const fullName =
    params.fullNameFallback?.trim() ||
    normalizedEmail.split('@')[0] ||
    'Super Admin SaaS';

  const { error: upsertError } = await adminClient
    .from('perfiles_usuarios')
    .upsert(
      {
        id: params.userId,
        tenant_id: null,
        nombre_completo: fullName,
        email: normalizedEmail,
        rol: 'SUPER_ADMIN',
        auth_provider: 'GOOGLE',
        activo: true,
        ultimo_acceso_en: nowIso,
      },
      { onConflict: 'id' },
    );

  if (upsertError) {
    return null;
  }

  await adminClient.auth.admin.updateUserById(params.userId, {
    app_metadata: {
      rol: 'SUPER_ADMIN',
    },
  });

  await recordAuditLog({
    tenantId: null,
    actorId: params.userId,
    accion: 'SUPER_ADMIN_BOOTSTRAP_LOGIN',
    detalle: {
      email: normalizedEmail,
      auth_provider: 'GOOGLE',
    },
  });

  return { rol: 'SUPER_ADMIN', tenantId: null };
}

/**
 * Si el usuario autenticado aún no tiene fila en `perfiles_usuarios`,
 * verifica si tiene una invitación `PENDIENTE` vigente en `invitaciones_usuarios`
 * para su correo electrónico y la activa automáticamente.
 */
export async function claimPendingInvitationForUser(params: {
  userId: string;
  email: string;
  fullNameFallback?: string | null;
  authProvider?: 'GOOGLE' | 'EMAIL' | 'BOTH';
}): Promise<{ rol: UserRole; tenantId: string } | null> {
  const normalizedEmail = params.email.trim().toLowerCase();
  if (!normalizedEmail) return null;

  const adminClient = createSupabaseServiceClient();
  const nowIso = new Date().toISOString();

  const { data: invite } = await adminClient
    .from('invitaciones_usuarios')
    .select('id, tenant_id, nombre_completo, rol, expira_en')
    .ilike('email', normalizedEmail)
    .eq('estatus', 'PENDIENTE')
    .gt('expira_en', nowIso)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!invite) {
    return null;
  }

  const parsedRol = UserRoleSchema.safeParse(invite.rol);
  if (!parsedRol.success) {
    return null;
  }

  const nombreCompleto =
    params.fullNameFallback?.trim() || invite.nombre_completo;
  const provider = params.authProvider ?? 'BOTH';

  const { error: upsertError } = await adminClient
    .from('perfiles_usuarios')
    .upsert(
      {
        id: params.userId,
        tenant_id: invite.tenant_id,
        nombre_completo: nombreCompleto,
        email: normalizedEmail,
        rol: parsedRol.data,
        auth_provider: provider,
        activo: true,
        deleted_at: null,
        ultimo_acceso_en: nowIso,
      },
      { onConflict: 'id' },
    );

  if (upsertError) {
    return null;
  }

  await adminClient
    .from('invitaciones_usuarios')
    .update({
      estatus: 'ACEPTADA',
      aceptada_en: nowIso,
    })
    .eq('id', invite.id);

  await adminClient.auth.admin.updateUserById(params.userId, {
    ban_duration: 'none',
    app_metadata: {
      rol: parsedRol.data,
      tenant_id: invite.tenant_id,
    },
  });

  await recordAuditLog({
    tenantId: invite.tenant_id,
    actorId: params.userId,
    accion: 'INVITACION_ACEPTADA',
    detalle: {
      invitacion_id: invite.id,
      email: normalizedEmail,
      rol: parsedRol.data,
    },
  });

  return {
    rol: parsedRol.data,
    tenantId: invite.tenant_id,
  };
}

/**
 * Extrae el contexto autenticado exclusivamente del JWT verificado en servidor
 * y valida que el usuario cuente con un perfil activo o invitación válida en el tenant.
 * REGLA DURA #2: `tenant_id` jamás viene del body/query; sale del JWT / perfil autenticado.
 */
export async function getAuthenticatedContext(): Promise<AuthenticatedContext> {
  const isDev = process.env['NODE_ENV'] === 'development';
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    throw new AuthError('Sesión no válida o expirada', 401);
  }

  const normalizedEmail = (user.email ?? '').trim().toLowerCase();
  const adminClient = createSupabaseServiceClient();
  const fullNameFallback =
    typeof user.user_metadata?.['full_name'] === 'string'
      ? user.user_metadata['full_name']
      : null;

  let rol: UserRole;
  let tenantId: string | null;

  // 1. Si el correo está en SUPER_ADMIN_BOOTSTRAP_EMAILS, tiene autorización exclusiva de SUPER_ADMIN
  if (isBootstrapSuperAdminEmail(normalizedEmail)) {
    const bootstrapped = await claimBootstrapSuperAdminForUser({
      userId: user.id,
      email: normalizedEmail,
      fullNameFallback,
    });
    rol = bootstrapped?.rol ?? 'SUPER_ADMIN';
    tenantId = null;
  } else {
    // 2. Buscar perfil existente del usuario en su empresa (por ID o por correo)
    const { data: perfilById } = await adminClient
      .from('perfiles_usuarios')
      .select('id, rol, tenant_id, activo, nombre_completo, deleted_at')
      .eq('id', user.id)
      .maybeSingle();

    let perfil = perfilById;

    if (!perfil && normalizedEmail) {
      const { data: perfilByEmail } = await adminClient
        .from('perfiles_usuarios')
        .select('id, rol, tenant_id, activo, nombre_completo, deleted_at')
        .ilike('email', normalizedEmail)
        .maybeSingle();

      if (perfilByEmail && perfilByEmail.rol !== 'SUPER_ADMIN') {
        perfil = perfilByEmail;
      }
    }

    if (perfil) {
      const parsedRol = UserRoleSchema.safeParse(perfil.rol);
      if (!perfil.activo || perfil.deleted_at !== null || !parsedRol.success) {
        throw new AuthError(
          'Tu cuenta de usuario está desactivada o no tiene un rol válido en el tenant',
          403,
        );
      }

      // Regla estricta Paso 1: solo correos en SUPER_ADMIN_BOOTSTRAP_EMAILS pueden tener rol SUPER_ADMIN
      if (parsedRol.data === 'SUPER_ADMIN') {
        throw new AuthError(
          'Solo las cuentas registradas en SUPER_ADMIN_BOOTSTRAP_EMAILS tienen acceso a la sección de Super-Admin.',
          403,
        );
      }

      rol = parsedRol.data;
      tenantId = perfil.tenant_id ?? null;

      const parsedMeta = JwtAppMetadataSchema.safeParse(user.app_metadata);
      if (
        !parsedMeta.success ||
        parsedMeta.data.rol !== rol ||
        (parsedMeta.data.tenant_id ?? null) !== tenantId
      ) {
        await adminClient.auth.admin.updateUserById(user.id, {
          app_metadata: {
            rol,
            ...(tenantId ? { tenant_id: tenantId } : {}),
          },
        });
      }
    } else {
      const claimed = await claimPendingInvitationForUser({
        userId: user.id,
        email: normalizedEmail,
        fullNameFallback,
        authProvider:
          user.app_metadata?.['provider'] === 'google' ? 'GOOGLE' : 'EMAIL',
      });

      if (!claimed) {
        throw new AuthError(
          'No existe una cuenta o invitación activa para tu correo en esta empresa. Solicita acceso al administrador.',
          403,
        );
      }

      rol = claimed.rol;
      tenantId = claimed.tenantId;
    }
  }

  const { data: aalData, error: aalError } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

  if (aalError || !aalData?.currentLevel) {
    if (isDev) {
      return {
        userId: user.id,
        email: normalizedEmail,
        rol,
        tenantId,
        aal: 'aal2',
      };
    }
    throw new AuthError(
      'No se pudo verificar el nivel de autenticación MFA',
      403,
    );
  }

  const currentAal: 'aal1' | 'aal2' =
    aalData.currentLevel === 'aal2' ? 'aal2' : 'aal1';

  const hasEnrolledFactor = aalData.nextLevel === 'aal2';
  if (
    roleRequiresMfa(rol) &&
    currentAal !== 'aal2' &&
    (!isDev || hasEnrolledFactor)
  ) {
    throw new AuthError(
      'Se requiere verificación MFA (TOTP) activa para este rol',
      403,
    );
  }

  return {
    userId: user.id,
    email: normalizedEmail,
    rol,
    tenantId,
    aal: currentAal,
  };
}

export async function resolveTenantIdForUser(auth: {
  rol: UserRole;
  tenantId: string | null;
}): Promise<string | null> {
  if (auth.tenantId) return auth.tenantId;
  if (auth.rol === 'SUPER_ADMIN') {
    const admin = createSupabaseServiceClient();
    const { data: firstTenant } = await admin
      .from('tenants')
      .select('id')
      .eq('estatus', 'ACTIVO')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    return firstTenant?.id ?? null;
  }
  return null;
}

export async function requireRoles(
  allowedRoles: readonly UserRole[],
): Promise<AuthenticatedContext> {
  const ctx = await getAuthenticatedContext();
  if (!allowedRoles.includes(ctx.rol)) {
    throw new AuthError('No tienes permisos para realizar esta acción', 403);
  }
  return ctx;
}

export async function requireAuthenticatedUser(): Promise<
  | { ok: true; user: AuthenticatedContext }
  | { ok: false; status: 401 | 403; message: string }
> {
  try {
    const user = await getAuthenticatedContext();
    return { ok: true, user };
  } catch (err) {
    if (err instanceof AuthError) {
      return {
        ok: false,
        status: err.statusCode === 403 ? 403 : 401,
        message: err.message,
      };
    }
    return { ok: false, status: 401, message: 'No autenticado' };
  }
}

export async function requireTenantAdmin(): Promise<
  | { ok: true; user: AuthenticatedContext; tenantId: string }
  | { ok: false; status: 401 | 403; message: string }
> {
  try {
    const user = await requireRoles(['SUPER_ADMIN', 'ADMIN_EMPRESA']);
    const tenantId = await resolveTenantIdForUser(user);
    if (!tenantId) {
      return {
        ok: false,
        status: 403,
        message: 'Usuario sin empresa asignada',
      };
    }
    return { ok: true, user, tenantId };
  } catch (err) {
    if (err instanceof AuthError) {
      return {
        ok: false,
        status: err.statusCode === 403 ? 403 : 401,
        message: err.message,
      };
    }
    return { ok: false, status: 401, message: 'No autenticado' };
  }
}

export async function requireSuperAdmin(): Promise<
  | { ok: true; user: AuthenticatedContext }
  | { ok: false; status: 401 | 403; message: string }
> {
  try {
    const user = await requireRoles(['SUPER_ADMIN']);
    return { ok: true, user };
  } catch (err) {
    if (err instanceof AuthError) {
      return {
        ok: false,
        status: err.statusCode === 403 ? 403 : 401,
        message: err.message,
      };
    }
    return { ok: false, status: 401, message: 'No autenticado' };
  }
}

export async function recordAuditLog(params: {
  tenantId: string | null;
  actorId: string;
  accion: string;
  detalle?: Json;
  ip?: string | null;
}): Promise<void> {
  const adminClient = createSupabaseServiceClient();
  const { error } = await adminClient.from('auditoria').insert({
    tenant_id: params.tenantId,
    actor_id: params.actorId,
    accion: params.accion,
    detalle: params.detalle ?? null,
    ip: params.ip ?? null,
  });

  if (error) {
    console.error('[auditoria] Error al registrar evento:', error.message);
  }
}
