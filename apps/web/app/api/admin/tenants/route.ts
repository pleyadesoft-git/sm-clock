import { randomBytes } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import {
  sanitizeSearchQuery,
  TenantCreateWithAdminSchema,
  TenantListQuerySchema,
  type Database,
  type PaginatedResult,
} from '@sm-clock/contracts';
import { AuthError, recordAuditLog, requireRoles } from '@/lib/server/auth';
import { createSupabaseAdminClient } from '@/lib/server/supabase-admin';

type TenantRow = Database['public']['Tables']['tenants']['Row'];

export interface TenantWithInitialAdmin extends TenantRow {
  admin_inicial?: {
    id: string;
    nombre_completo: string;
    email: string;
    auth_provider: string;
  } | null;
}

export async function GET(request: NextRequest) {
  try {
    await requireRoles(['SUPER_ADMIN']);

    const rawQuery = Object.fromEntries(request.nextUrl.searchParams.entries());
    const parsedQuery = TenantListQuerySchema.safeParse(rawQuery);
    if (!parsedQuery.success) {
      return NextResponse.json(
        {
          error: 'Parámetros de consulta inválidos',
          details: parsedQuery.error.flatten(),
        },
        { status: 400 },
      );
    }

    const { page, pageSize, search, estatus, plan_codigo, sortBy, sortDir } =
      parsedQuery.data;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const supabase = createSupabaseAdminClient();
    let query = supabase
      .from('tenants')
      .select('*', { count: 'exact' })
      .is('deleted_at', null);

    if (estatus) {
      query = query.eq('estatus', estatus);
    }
    if (plan_codigo) {
      query = query.eq('plan_codigo', plan_codigo);
    }
    if (search && search.length > 0) {
      const safeTerm = sanitizeSearchQuery(search);
      if (safeTerm) {
        query = query.or(
          `nombre_comercial.ilike.%${safeTerm}%,razon_social.ilike.%${safeTerm}%,rfc.ilike.%${safeTerm}%,tenant_code.ilike.%${safeTerm}%`,
        );
      }
    }

    const { data, error, count } = await query
      .order(sortBy, { ascending: sortDir === 'asc' })
      .range(from, to);

    if (error) {
      return NextResponse.json(
        { error: 'Error al consultar las empresas' },
        { status: 500 },
      );
    }

    const rows = data ?? [];
    const tenantIds = rows.map((t) => t.id);

    const adminByTenant = new Map<
      string,
      { id: string; nombre_completo: string; email: string; auth_provider: string }
    >();

    if (tenantIds.length > 0) {
      const { data: admins } = await supabase
        .from('perfiles_usuarios')
        .select('id, tenant_id, nombre_completo, email, auth_provider, created_at')
        .in('tenant_id', tenantIds)
        .eq('rol', 'ADMIN_EMPRESA')
        .eq('activo', true)
        .order('created_at', { ascending: true });

      for (const adm of admins ?? []) {
        if (adm.tenant_id && !adminByTenant.has(adm.tenant_id)) {
          adminByTenant.set(adm.tenant_id, {
            id: adm.id,
            nombre_completo: adm.nombre_completo,
            email: adm.email,
            auth_provider: adm.auth_provider,
          });
        }
      }
    }

    const enrichedRows: TenantWithInitialAdmin[] = rows.map((t) => ({
      ...t,
      admin_inicial: adminByTenant.get(t.id) ?? null,
    }));

    const total = count ?? 0;
    const payload: PaginatedResult<TenantWithInitialAdmin> = {
      data: enrichedRows,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };

    return NextResponse.json(payload);
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json(
        { error: err.message },
        { status: err.statusCode },
      );
    }
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireRoles(['SUPER_ADMIN']);

    const body: unknown = await request.json();
    const parsed = TenantCreateWithAdminSchema.safeParse(body);
    if (!parsed.success) {
      const details = parsed.error.issues
        .map((i) => `• [${i.path.join('.') || 'formulario'}]: ${i.message}`)
        .join('\n');
      return NextResponse.json(
        {
          error:
            parsed.error.issues[0]?.message ??
            'Datos de empresa o del Administrador inicial inválidos',
          details,
        },
        { status: 400 },
      );
    }

    const supabase = createSupabaseAdminClient();
    const adminEmail = parsed.data.admin_inicial.email.toLowerCase();
    const adminNombre = parsed.data.admin_inicial.nombre_completo;

    // 1. Verificar que el correo del Admin inicial no pertenezca ya a otro perfil
    const { data: existingProfile } = await supabase
      .from('perfiles_usuarios')
      .select('id, email')
      .ilike('email', adminEmail)
      .maybeSingle();

    if (existingProfile) {
      return NextResponse.json(
        {
          error:
            'El correo electrónico del Administrador inicial ya está registrado en otra empresa.',
          details: `El email "${adminEmail}" ya está asignado al perfil ID ${existingProfile.id}`,
        },
        { status: 409 },
      );
    }

    // 2. Insertar empresa (tenant)
    const insertPayload: Database['public']['Tables']['tenants']['Insert'] = {
      tenant_code: parsed.data.tenant_code,
      nombre_comercial: parsed.data.nombre_comercial,
      razon_social: parsed.data.razon_social,
      rfc: parsed.data.rfc,
      regimen_fiscal: parsed.data.regimen_fiscal,
      codigo_postal_fiscal: parsed.data.codigo_postal_fiscal,
      uso_cfdi: parsed.data.uso_cfdi,
      correo_facturacion: parsed.data.correo_facturacion ?? null,
      contacto_nombre: parsed.data.contacto_nombre ?? adminNombre,
      contacto_email: parsed.data.contacto_email ?? adminEmail,
      contacto_telefono: parsed.data.contacto_telefono ?? null,
      notas_internas: parsed.data.notas_internas ?? null,
      plan_codigo: parsed.data.plan_codigo,
      estatus: parsed.data.estatus,
      zona_horaria: parsed.data.zona_horaria,
      logo_url: parsed.data.logo_url ?? null,
    };

    const { data: created, error } = await supabase
      .from('tenants')
      .insert(insertPayload)
      .select('*')
      .single();

    if (error || !created) {
      return NextResponse.json(
        {
          error:
            'No se pudo registrar la empresa (verifica código o RFC único)',
          details: error
            ? `Postgres [${error.code}]: ${error.message} (${error.details ?? ''})`
            : 'No se obtuvo respuesta de inserción',
        },
        { status: 409 },
      );
    }

    // 3. Aprovisionar el usuario ADMIN_EMPRESA inicial en Supabase Auth para ingreso con Google Auth
    let authUserId: string | null = null;
    let createdNewAuthUser = false;

    const randomBootstrapPassword = `GAuth!${randomBytes(24).toString('hex')}`;
    const { data: authCreated, error: authCreateError } =
      await supabase.auth.admin.createUser({
        email: adminEmail,
        password: randomBootstrapPassword,
        email_confirm: true,
        user_metadata: {
          full_name: adminNombre,
          auth_provider: 'GOOGLE',
        },
        app_metadata: {
          rol: 'ADMIN_EMPRESA',
          tenant_id: created.id,
        },
      });

    if (authCreated?.user) {
      authUserId = authCreated.user.id;
      createdNewAuthUser = true;
    } else {
      // Si el usuario ya existía en auth.users (p. ej. intentó iniciar con Google antes), vincularlo
      const { data: usersList } = await supabase.auth.admin.listUsers({
        page: 1,
        perPage: 200,
      });
      const existingAuthUser = usersList?.users.find(
        (u) => u.email?.toLowerCase() === adminEmail,
      );

      if (existingAuthUser) {
        authUserId = existingAuthUser.id;
        await supabase.auth.admin.updateUserById(existingAuthUser.id, {
          user_metadata: {
            ...existingAuthUser.user_metadata,
            full_name: adminNombre,
            auth_provider: 'GOOGLE',
          },
          app_metadata: {
            ...existingAuthUser.app_metadata,
            rol: 'ADMIN_EMPRESA',
            tenant_id: created.id,
          },
        });
      } else {
        await supabase.from('tenants').delete().eq('id', created.id);
        return NextResponse.json(
          {
            error:
              authCreateError?.message ??
              'No se pudo aprovisionar la cuenta Google Auth del Administrador inicial',
          },
          { status: 500 },
        );
      }
    }

    // 4. Registrar el perfil ADMIN_EMPRESA con requisito de Google Auth en public.perfiles_usuarios
    const { error: profileError } = await supabase
      .from('perfiles_usuarios')
      .insert({
        id: authUserId,
        tenant_id: created.id,
        nombre_completo: adminNombre,
        email: adminEmail,
        rol: 'ADMIN_EMPRESA',
        auth_provider: 'GOOGLE',
        activo: true,
      });

    if (profileError) {
      if (createdNewAuthUser && authUserId) {
        await supabase.auth.admin.deleteUser(authUserId);
      }
      await supabase.from('tenants').delete().eq('id', created.id);
      return NextResponse.json(
        {
          error:
            'No se pudo registrar el perfil del Administrador inicial de la empresa',
        },
        { status: 500 },
      );
    }

    await recordAuditLog({
      tenantId: created.id,
      actorId: ctx.userId,
      accion: 'TENANT_CREATE',
      detalle: {
        tenant_code: created.tenant_code,
        rfc: created.rfc,
        plan_codigo: created.plan_codigo,
        admin_inicial_id: authUserId,
        admin_inicial_email: adminEmail,
        admin_auth_provider: 'GOOGLE',
      },
      ip: request.headers.get('x-forwarded-for'),
    });

    // Broadcast para clientes conectados en tiempo real
    try {
      const realtimeChannel = supabase.channel('admin:tenants:realtime');
      await realtimeChannel.send({
        type: 'broadcast',
        event: 'tenant_created',
        payload: { tenant_id: created.id, tenant_code: created.tenant_code },
      });
      await supabase.removeChannel(realtimeChannel);
    } catch {
      // Continuar incluso si broadcast falla
    }

    const responsePayload: TenantWithInitialAdmin = {
      ...created,
      admin_inicial: {
        id: authUserId,
        nombre_completo: adminNombre,
        email: adminEmail,
        auth_provider: 'GOOGLE',
      },
    };

    return NextResponse.json(responsePayload, { status: 201 });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json(
        { error: err.message },
        { status: err.statusCode },
      );
    }
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 },
    );
  }
}
