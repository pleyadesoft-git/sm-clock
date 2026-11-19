import { NextResponse } from 'next/server';
import {
  EmpleadoCreateSchema,
  EmpleadoUpdateSchema,
  sanitizeSearchQuery,
} from '@sm-clock/contracts';
import {
  recordAuditLog,
  requireAuthenticatedUser,
} from '@/lib/server/auth';
import { broadcastTenantEvent } from '@/lib/server/realtime-broadcast';
import { createSupabaseAdminClient } from '@/lib/server/supabase-admin';

const BUCKET_NAME = 'empleados-fotos';
const SIGNED_URL_TTL_SECONDS = 600; // 10 minutos

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

export const dynamic = 'force-dynamic';
export const revalidate = 0;

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
  const estatus = searchParams.get('estatus') ?? '';
  const sucursalId = searchParams.get('sucursal_id') ?? '';

  const ALLOWED_SORT_COLUMNS = [
    'codigo_empleado',
    'nombre_completo',
    'email',
    'pin_codigo',
    'credencial',
    'departamento',
    'puesto',
    'estatus_empleado',
    'created_at',
  ] as const;

  const rawSortBy = searchParams.get('sortBy');
  const sortBy = ALLOWED_SORT_COLUMNS.includes(
    rawSortBy as (typeof ALLOWED_SORT_COLUMNS)[number],
  )
    ? (rawSortBy as (typeof ALLOWED_SORT_COLUMNS)[number])
    : 'codigo_empleado';
  const sortDir = searchParams.get('sortDir') === 'desc' ? 'desc' : 'asc';

  const admin = createSupabaseAdminClient();

  let query = admin
    .from('empleados')
    .select(
      '*, sucursales(id, clave, nombre, latitud, longitud, radio_geocerca_m)',
      { count: 'exact' },
    )
    .eq('tenant_id', tenantId)
    .order(sortBy, { ascending: sortDir === 'asc' });

  if (search) {
    query = query.or(
      `codigo_empleado.ilike.%${search}%,nombre_completo.ilike.%${search}%,email.ilike.%${search}%,departamento.ilike.%${search}%`,
    );
  }

  if (estatus === 'A' || estatus === 'I') {
    query = query.eq('estatus_empleado', estatus);
  }

  if (sucursalId) {
    query = query.eq('sucursal_id', sucursalId);
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const [
    { data: rows, count, error },
    { data: sucursales },
  ] = await Promise.all([
    query.range(from, to),
    admin
      .from('sucursales')
      .select('id, clave, nombre, latitud, longitud, radio_geocerca_m')
      .eq('tenant_id', tenantId)
      .order('clave', { ascending: true }),
  ]);

  if (error) {
    return NextResponse.json(
      { error: 'Error al consultar empleados' },
      { status: 500 },
    );
  }

  // Consultar conteo de credenciales WebAuthn por empleado
  const empleadoIds = (rows ?? []).map((r) => r.id);
  const webauthnCountMap = new Map<string, number>();
  if (empleadoIds.length > 0) {
    const { data: creds } = await admin
      .from('empleado_webauthn_credenciales')
      .select('empleado_id')
      .eq('tenant_id', tenantId)
      .in('empleado_id', empleadoIds);
    for (const c of creds ?? []) {
      webauthnCountMap.set(
        c.empleado_id,
        (webauthnCountMap.get(c.empleado_id) ?? 0) + 1,
      );
    }
  }

  // Generar URLs firmadas de corta vida (10 min) para las miniaturas y fotos
  const pathsToSign: string[] = [];
  for (const r of rows ?? []) {
    if (r.foto_thumb_path) pathsToSign.push(r.foto_thumb_path);
    if (r.foto_path) pathsToSign.push(r.foto_path);
  }

  const signedMap = new Map<string, string>();
  if (pathsToSign.length > 0) {
    const { data: signedList } = await admin.storage
      .from(BUCKET_NAME)
      .createSignedUrls(pathsToSign, SIGNED_URL_TTL_SECONDS);

    for (const item of signedList ?? []) {
      const url =
        item.signedUrl ??
        (item as unknown as { signedURL?: string | null }).signedURL;
      if (item.path && url) {
        signedMap.set(item.path, url);
      }
    }
  }

  const enriched = (rows ?? []).map((r) => ({
    ...r,
    webauthn_credenciales_count: webauthnCountMap.get(r.id) ?? 0,
    foto_thumb_signed_url: r.foto_thumb_path
      ? (signedMap.get(r.foto_thumb_path) ?? null)
      : null,
    foto_signed_url: r.foto_path
      ? (signedMap.get(r.foto_path) ?? null)
      : null,
  }));

  return NextResponse.json(
    {
      data: enriched,
      total: count ?? 0,
      page,
      pageSize,
      sucursales: sucursales ?? [],
    },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      },
    },
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  if (auth.user.rol === 'OPERADOR') {
    return NextResponse.json(
      { error: 'Tu rol de Operador no permite dar de alta empleados' },
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

  const parsed = EmpleadoCreateSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          parsed.error.issues[0]?.message ?? 'Datos del empleado inválidos',
        details: parsed.error.issues,
      },
      { status: 422 },
    );
  }

  const admin = createSupabaseAdminClient();

  const { data: duplicate } = await admin
    .from('empleados')
    .select('id, nombre_completo')
    .eq('tenant_id', tenantId)
    .eq('codigo_empleado', parsed.data.codigo_empleado)
    .maybeSingle();

  if (duplicate) {
    return NextResponse.json(
      {
        error: `El código de empleado "${parsed.data.codigo_empleado}" ya está registrado por ${duplicate.nombre_completo}. Elige un código disponible.`,
      },
      { status: 409 },
    );
  }

  if (parsed.data.pin_codigo) {
    const { data: duplicatePin } = await admin
      .from('empleados')
      .select('id, nombre_completo, codigo_empleado')
      .eq('tenant_id', tenantId)
      .eq('pin_codigo', parsed.data.pin_codigo)
      .maybeSingle();

    if (duplicatePin) {
      return NextResponse.json(
        {
          error: `El PIN "${parsed.data.pin_codigo}" ya está asignado a ${duplicatePin.nombre_completo} (#${duplicatePin.codigo_empleado}). Elige otro PIN de 6 dígitos.`,
        },
        { status: 409 },
      );
    }
  }

  const { data: created, error } = await admin
    .from('empleados')
    .insert({
      tenant_id: tenantId,
      codigo_empleado: parsed.data.codigo_empleado,
      nombre_completo: parsed.data.nombre_completo,
      email: parsed.data.email ?? null,
      telefono_whatsapp: parsed.data.telefono_whatsapp ?? null,
      pin_codigo: parsed.data.pin_codigo,
      biometria_facial_activa: parsed.data.biometria_facial_activa ?? false,
      webauthn_activo: parsed.data.webauthn_activo ?? false,
      credencial: parsed.data.credencial ?? null,
      departamento: parsed.data.departamento ?? null,
      puesto: parsed.data.puesto ?? null,
      sucursal_id: parsed.data.sucursal_id,
      estatus_empleado: parsed.data.estatus_empleado,
    })
    .select('*')
    .single();

  if (error || !created) {
    return NextResponse.json(
      { error: 'No fue posible registrar el empleado (verifica que el código y el PIN no existan)' },
      { status: 409 },
    );
  }

  await recordAuditLog({
    tenantId,
    actorId: auth.user.userId,
    accion: 'CREAR_EMPLEADO',
    detalle: {
      empleado_id: created.id,
      codigo_empleado: created.codigo_empleado,
      sucursal_id: created.sucursal_id,
    },
  });

  await broadcastTenantEvent(tenantId, 'empleados_changed', {
    empleado_id: created.id,
    codigo_empleado: created.codigo_empleado,
    accion: 'CREAR',
  });

  return NextResponse.json({ data: created }, { status: 201 });
}

export async function PATCH(request: Request): Promise<NextResponse> {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  if (auth.user.rol === 'OPERADOR') {
    return NextResponse.json(
      { error: 'Tu rol de Operador no permite editar empleados' },
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

  const parsed = EmpleadoUpdateSchema.safeParse(rawBody);
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
  const updateData: {
    sincronizado_en: string;
    codigo_empleado?: string;
    nombre_completo?: string;
    email?: string | null;
    telefono_whatsapp?: string | null;
    pin_codigo?: string | null;
    biometria_facial_activa?: boolean;
    webauthn_activo?: boolean;
    credencial?: string | null;
    departamento?: string | null;
    puesto?: string | null;
    sucursal_id?: string | null;
    estatus_empleado?: string;
  } = {
    sincronizado_en: new Date().toISOString(),
  };
  if (parsed.data.codigo_empleado !== undefined) {
    updateData.codigo_empleado = parsed.data.codigo_empleado;
  }
  if (parsed.data.nombre_completo !== undefined) {
    updateData.nombre_completo = parsed.data.nombre_completo;
  }
  if (parsed.data.email !== undefined) {
    updateData.email = parsed.data.email;
  }
  if (parsed.data.telefono_whatsapp !== undefined) {
    updateData.telefono_whatsapp = parsed.data.telefono_whatsapp;
  }
  if (parsed.data.pin_codigo !== undefined) {
    updateData.pin_codigo = parsed.data.pin_codigo;
  }
  if (parsed.data.biometria_facial_activa !== undefined) {
    updateData.biometria_facial_activa = parsed.data.biometria_facial_activa;
  }
  if (parsed.data.webauthn_activo !== undefined) {
    updateData.webauthn_activo = parsed.data.webauthn_activo;
  }
  if (parsed.data.credencial !== undefined) {
    updateData.credencial = parsed.data.credencial;
  }
  if (parsed.data.departamento !== undefined) {
    updateData.departamento = parsed.data.departamento;
  }
  if (parsed.data.puesto !== undefined) {
    updateData.puesto = parsed.data.puesto;
  }
  if (parsed.data.sucursal_id !== undefined) {
    updateData.sucursal_id = parsed.data.sucursal_id;
  }
  if (parsed.data.estatus_empleado !== undefined) {
    updateData.estatus_empleado = parsed.data.estatus_empleado;
  }

  if (parsed.data.codigo_empleado !== undefined) {
    const { data: duplicate } = await admin
      .from('empleados')
      .select('id, nombre_completo')
      .eq('tenant_id', tenantId)
      .eq('codigo_empleado', parsed.data.codigo_empleado)
      .neq('id', parsed.data.id)
      .maybeSingle();

    if (duplicate) {
      return NextResponse.json(
        {
          error: `El código de empleado "${parsed.data.codigo_empleado}" ya está registrado por ${duplicate.nombre_completo}. Elige un código disponible.`,
        },
        { status: 409 },
      );
    }
  }

  if (parsed.data.pin_codigo) {
    const { data: duplicatePin } = await admin
      .from('empleados')
      .select('id, nombre_completo, codigo_empleado')
      .eq('tenant_id', tenantId)
      .eq('pin_codigo', parsed.data.pin_codigo)
      .neq('id', parsed.data.id)
      .maybeSingle();

    if (duplicatePin) {
      return NextResponse.json(
        {
          error: `El PIN "${parsed.data.pin_codigo}" ya está asignado a ${duplicatePin.nombre_completo} (#${duplicatePin.codigo_empleado}). Elige otro PIN de 6 dígitos.`,
        },
        { status: 409 },
      );
    }
  }

  const { data: updated, error } = await admin
    .from('empleados')
    .update(updateData)
    .eq('id', parsed.data.id)
    .eq('tenant_id', tenantId)
    .select('*')
    .single();

  if (error || !updated) {
    return NextResponse.json(
      { error: 'No fue posible actualizar el empleado' },
      { status: 404 },
    );
  }

  await recordAuditLog({
    tenantId,
    actorId: auth.user.userId,
    accion: 'ACTUALIZAR_EMPLEADO',
    detalle: {
      empleado_id: updated.id,
      codigo_empleado: updated.codigo_empleado,
      sucursal_id: updated.sucursal_id,
    },
  });

  await broadcastTenantEvent(tenantId, 'empleados_changed', {
    empleado_id: updated.id,
    codigo_empleado: updated.codigo_empleado,
    accion: 'ACTUALIZAR',
  });

  return NextResponse.json({ data: updated });
}
