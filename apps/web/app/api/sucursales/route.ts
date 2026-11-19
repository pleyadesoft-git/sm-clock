import { NextResponse } from 'next/server';
import {
  sanitizeSearchQuery,
  SucursalCreateSchema,
  SucursalUpdateSchema,
} from '@sm-clock/contracts';
import {
  recordAuditLog,
  requireAuthenticatedUser,
} from '@/lib/server/auth';
import { broadcastTenantEvent } from '@/lib/server/realtime-broadcast';
import { createSupabaseAdminClient } from '@/lib/server/supabase-admin';

async function resolveTenantIdForUser(auth: {
  rol: string;
  tenantId: string | null;
}): Promise<string | null> {
  if (auth.tenantId) return auth.tenantId;
  if (auth.rol === 'SUPER_ADMIN') {
    const admin = createSupabaseAdminClient();
    const { data: firstTenant } = await admin
      .from('tenants')
      .select('id')
      .eq('estatus', 'ACTIVO')
      .order('created_at', { ascending: true })
      .limit(1)
      .single();
    return firstTenant?.id ?? null;
  }
  return null;
}

const SUCURSAL_SELECT_COLUMNS =
  'id, tenant_id, clave, nombre, direccion, latitud, longitud, radio_geocerca_m, activa, created_at, fuentes_asistencia(id, clave, consecutivo_sucursal, nombre_ubicacion, marca, modelo, ip_local, puerto, activo, ultima_conexion_exitosa, ultimo_error)';

export async function GET(request: Request): Promise<NextResponse> {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  if (auth.user.rol === 'OPERADOR') {
    return NextResponse.json(
      { error: 'El rol Operador únicamente tiene acceso a la consulta de movimientos' },
      { status: 403 },
    );
  }

  const tenantId = await resolveTenantIdForUser(auth.user);
  if (!tenantId) {
    return NextResponse.json(
      { error: 'Usuario sin empresa asignada' },
      { status: 403 },
    );
  }

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, Number(searchParams.get('page') ?? '1'));
  const pageSize = Math.min(
    100,
    Math.max(10, Number(searchParams.get('pageSize') ?? '25')),
  );
  const search = sanitizeSearchQuery(searchParams.get('search') ?? '');

  const ALLOWED_SORT_COLUMNS = [
    'clave',
    'nombre',
    'direccion',
    'activa',
    'created_at',
  ] as const;

  const rawSortBy = searchParams.get('sortBy');
  const sortBy = ALLOWED_SORT_COLUMNS.includes(
    rawSortBy as (typeof ALLOWED_SORT_COLUMNS)[number],
  )
    ? (rawSortBy as (typeof ALLOWED_SORT_COLUMNS)[number])
    : 'clave';
  const sortDir = searchParams.get('sortDir') === 'desc' ? 'desc' : 'asc';

  const admin = createSupabaseAdminClient();
  let query = admin
    .from('sucursales')
    .select(SUCURSAL_SELECT_COLUMNS, {
      count: 'exact',
    })
    .eq('tenant_id', tenantId)
    .order(sortBy, { ascending: sortDir === 'asc' });

  if (search) {
    query = query.or(`clave.ilike.%${search}%,nombre.ilike.%${search}%`);
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const { data, count, error } = await query.range(from, to);

  if (error) {
    return NextResponse.json(
      { error: 'Error al consultar sucursales' },
      { status: 500 },
    );
  }

  return NextResponse.json({
    data: data ?? [],
    total: count ?? 0,
    page,
    pageSize,
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  if (auth.user.rol !== 'SUPER_ADMIN' && auth.user.rol !== 'ADMIN_EMPRESA') {
    return NextResponse.json(
      { error: 'Solo ADMIN_EMPRESA puede crear sucursales' },
      { status: 403 },
    );
  }

  const tenantId = await resolveTenantIdForUser(auth.user);
  if (!tenantId) {
    return NextResponse.json(
      { error: 'Usuario sin empresa asignada' },
      { status: 403 },
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: 'Cuerpo JSON inválido' }, { status: 400 });
  }

  const parsed = SucursalCreateSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message ?? 'Datos de sucursal inválidos',
        details: parsed.error.issues,
      },
      { status: 422 },
    );
  }

  const admin = createSupabaseAdminClient();
  const { data: created, error } = await admin
    .from('sucursales')
    .insert({
      tenant_id: tenantId,
      clave: parsed.data.clave.toUpperCase(),
      nombre: parsed.data.nombre,
      direccion: parsed.data.direccion ?? null,
      latitud: parsed.data.latitud,
      longitud: parsed.data.longitud,
      radio_geocerca_m: parsed.data.radio_geocerca_m,
      activa: parsed.data.activa,
    })
    .select(SUCURSAL_SELECT_COLUMNS)
    .single();

  if (error || !created) {
    return NextResponse.json(
      { error: 'No se pudo crear la sucursal (verifica que la clave no esté duplicada)' },
      { status: 409 },
    );
  }

  await recordAuditLog({
    tenantId,
    actorId: auth.user.userId,
    accion: 'CREAR_SUCURSAL',
    detalle: {
      sucursal_id: created.id,
      clave: created.clave,
      latitud: created.latitud,
      longitud: created.longitud,
      radio_geocerca_m: created.radio_geocerca_m,
    },
  });

  await broadcastTenantEvent(tenantId, 'sucursales_changed', {
    sucursal_id: created.id,
    clave: created.clave,
    accion: 'CREAR',
  });

  return NextResponse.json({ data: created }, { status: 201 });
}

export async function PATCH(request: Request): Promise<NextResponse> {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  if (auth.user.rol !== 'SUPER_ADMIN' && auth.user.rol !== 'ADMIN_EMPRESA') {
    return NextResponse.json(
      { error: 'Solo ADMIN_EMPRESA puede modificar sucursales' },
      { status: 403 },
    );
  }

  const tenantId = await resolveTenantIdForUser(auth.user);
  if (!tenantId) {
    return NextResponse.json(
      { error: 'Usuario sin empresa asignada' },
      { status: 403 },
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: 'Cuerpo JSON inválido' }, { status: 400 });
  }

  const parsed = SucursalUpdateSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          parsed.error.issues[0]?.message ?? 'Datos de actualización inválidos',
        details: parsed.error.issues,
      },
      { status: 422 },
    );
  }

  const admin = createSupabaseAdminClient();
  const { data: updated, error } = await admin
    .from('sucursales')
    .update({
      clave: parsed.data.clave ? parsed.data.clave.toUpperCase() : undefined,
      nombre: parsed.data.nombre,
      direccion: parsed.data.direccion,
      latitud: parsed.data.latitud,
      longitud: parsed.data.longitud,
      radio_geocerca_m: parsed.data.radio_geocerca_m,
      activa: parsed.data.activa,
    })
    .eq('id', parsed.data.id)
    .eq('tenant_id', tenantId)
    .select(SUCURSAL_SELECT_COLUMNS)
    .single();

  if (error || !updated) {
    return NextResponse.json(
      { error: 'No se pudo actualizar la sucursal' },
      { status: 404 },
    );
  }

  await recordAuditLog({
    tenantId,
    actorId: auth.user.userId,
    accion: 'ACTUALIZAR_SUCURSAL',
    detalle: {
      sucursal_id: updated.id,
      clave: updated.clave,
      latitud: updated.latitud,
      longitud: updated.longitud,
      radio_geocerca_m: updated.radio_geocerca_m,
    },
  });

  await broadcastTenantEvent(tenantId, 'sucursales_changed', {
    sucursal_id: updated.id,
    clave: updated.clave,
    accion: 'ACTUALIZAR',
  });

  return NextResponse.json({ data: updated });
}
