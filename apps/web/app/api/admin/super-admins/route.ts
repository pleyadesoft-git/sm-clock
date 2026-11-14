import { NextResponse } from 'next/server';
import {
  AuthProviderSchema,
  CreateSuperAdminRequestSchema,
  sanitizeSearchQuery,
  type SuperAdminRow,
} from '@sm-clock/contracts';
import {
  isBootstrapSuperAdminEmail,
  recordAuditLog,
  requireSuperAdmin,
} from '@/lib/server/auth';
import { createSupabaseServiceClient } from '@/lib/server/supabase-admin';

export async function GET(request: Request): Promise<NextResponse> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { searchParams } = new URL(request.url);
  const search = sanitizeSearchQuery(
    searchParams.get('search') ?? '',
  ).toLowerCase();
  const estatusFilter = searchParams.get('estatus') ?? '';

  const admin = createSupabaseServiceClient();
  const { data: rows, error } = await admin
    .from('perfiles_usuarios')
    .select(
      'id, nombre_completo, email, activo, auth_provider, ultimo_acceso_en, created_at',
    )
    .eq('rol', 'SUPER_ADMIN')
    .is('tenant_id', null)
    .order('created_at', { ascending: true });

  if (error) {
    return NextResponse.json(
      { error: 'No fue posible consultar el catálogo de Super-Administradores' },
      { status: 500 },
    );
  }

  const mapped: SuperAdminRow[] = (rows ?? []).map((r) => {
    const parsedProvider = AuthProviderSchema.safeParse(r.auth_provider);
    return {
      id: r.id,
      nombre_completo: r.nombre_completo,
      email: r.email,
      activo: r.activo,
      auth_provider: parsedProvider.success ? parsedProvider.data : 'GOOGLE',
      ultimo_acceso_en: r.ultimo_acceso_en,
      created_at: r.created_at,
      es_bootstrap: isBootstrapSuperAdminEmail(r.email),
    };
  });

  const filtered = mapped.filter((item) => {
    if (
      search &&
      !item.nombre_completo.toLowerCase().includes(search) &&
      !item.email.toLowerCase().includes(search)
    ) {
      return false;
    }
    if (estatusFilter === 'ACTIVO' && !item.activo) {
      return false;
    }
    if (estatusFilter === 'INACTIVO' && item.activo) {
      return false;
    }
    return true;
  });

  return NextResponse.json({
    data: filtered,
    total: filtered.length,
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: 'Cuerpo JSON inválido' }, { status: 400 });
  }

  const parsed = CreateSuperAdminRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          parsed.error.issues[0]?.message ??
          'Datos de Super-Administrador inválidos',
        details: parsed.error.issues,
      },
      { status: 422 },
    );
  }

  const normalizedEmail = parsed.data.email;
  const admin = createSupabaseServiceClient();

  const { data: existingProfile } = await admin
    .from('perfiles_usuarios')
    .select('id, rol, tenant_id')
    .ilike('email', normalizedEmail)
    .maybeSingle();

  if (existingProfile) {
    return NextResponse.json(
      {
        error:
          existingProfile.rol === 'SUPER_ADMIN'
            ? 'Este correo ya está registrado como Super-Administrador'
            : 'Este correo ya pertenece a un usuario de una empresa cliente',
      },
      { status: 409 },
    );
  }

  let authUserId: string | null = null;
  let createdNewAuthUser = false;

  const { data: createdAuthUser, error: createAuthErr } =
    await admin.auth.admin.createUser({
      email: normalizedEmail,
      email_confirm: true,
      user_metadata: {
        full_name: parsed.data.nombre_completo,
      },
      app_metadata: {
        rol: 'SUPER_ADMIN',
      },
    });

  if (createdAuthUser?.user) {
    authUserId = createdAuthUser.user.id;
    createdNewAuthUser = true;
  } else if (createAuthErr) {
    const { data: usersPage } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 200,
    });
    const matched = usersPage?.users.find(
      (u) => u.email?.toLowerCase() === normalizedEmail,
    );
    if (matched) {
      authUserId = matched.id;
      await admin.auth.admin.updateUserById(matched.id, {
        user_metadata: {
          ...matched.user_metadata,
          full_name: parsed.data.nombre_completo,
        },
        app_metadata: {
          rol: 'SUPER_ADMIN',
        },
      });
    }
  }

  if (!authUserId) {
    return NextResponse.json(
      {
        error:
          'No se pudo aprovisionar la cuenta de Google Auth para el Super-Administrador',
      },
      { status: 500 },
    );
  }

  const { data: insertedProfile, error: profileErr } = await admin
    .from('perfiles_usuarios')
    .insert({
      id: authUserId,
      tenant_id: null,
      nombre_completo: parsed.data.nombre_completo,
      email: normalizedEmail,
      rol: 'SUPER_ADMIN',
      auth_provider: 'GOOGLE',
      activo: true,
    })
    .select(
      'id, nombre_completo, email, activo, auth_provider, ultimo_acceso_en, created_at',
    )
    .single();

  if (profileErr || !insertedProfile) {
    if (createdNewAuthUser) {
      await admin.auth.admin.deleteUser(authUserId);
    }
    return NextResponse.json(
      { error: 'Error al registrar el perfil del Super-Administrador' },
      { status: 500 },
    );
  }

  await recordAuditLog({
    tenantId: null,
    actorId: auth.user.userId,
    accion: 'SUPER_ADMIN_CREATE',
    detalle: {
      target_user_id: insertedProfile.id,
      email: insertedProfile.email,
      nombre_completo: insertedProfile.nombre_completo,
      auth_provider: 'GOOGLE',
    },
  });

  const responseRow: SuperAdminRow = {
    id: insertedProfile.id,
    nombre_completo: insertedProfile.nombre_completo,
    email: insertedProfile.email,
    activo: insertedProfile.activo,
    auth_provider: 'GOOGLE',
    ultimo_acceso_en: insertedProfile.ultimo_acceso_en,
    created_at: insertedProfile.created_at,
    es_bootstrap: isBootstrapSuperAdminEmail(insertedProfile.email),
  };

  return NextResponse.json({ data: responseRow }, { status: 201 });
}
