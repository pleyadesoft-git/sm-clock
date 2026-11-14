import { NextResponse } from 'next/server';
import {
  EmpleadoCreateSchema,
  EmpleadoUpdateSchema,
} from '@sm-clock/contracts';
import {
  recordAuditLog,
  requireAuthenticatedUser,
} from '@/lib/server/auth';
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
  const search = (searchParams.get('search') ?? '').trim();
  const estatus = searchParams.get('estatus') ?? '';
  const sucursalId = searchParams.get('sucursal_id') ?? '';

  const admin = createSupabaseAdminClient();

  let query = admin
    .from('empleados')
    .select(
      '*, sucursales(id, clave, nombre)',
      { count: 'exact' },
    )
    .eq('tenant_id', tenantId)
    .order('codigo_empleado', { ascending: true });

  if (search) {
    const safe = search.replace(/[%_]/g, '');
    query = query.or(
      `codigo_empleado.ilike.%${safe}%,nombre_completo.ilike.%${safe}%,departamento.ilike.%${safe}%`,
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
  const { data: rows, count, error } = await query.range(from, to);

  if (error) {
    return NextResponse.json(
      { error: 'Error al consultar empleados' },
      { status: 500 },
    );
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
      if (item.path && item.signedUrl) {
        signedMap.set(item.path, item.signedUrl);
      }
    }
  }

  const enriched = (rows ?? []).map((r) => ({
    ...r,
    foto_thumb_signed_url: r.foto_thumb_path
      ? (signedMap.get(r.foto_thumb_path) ?? null)
      : null,
    foto_signed_url: r.foto_path
      ? (signedMap.get(r.foto_path) ?? null)
      : null,
  }));

  const { data: sucursales } = await admin
    .from('sucursales')
    .select('id, clave, nombre')
    .eq('tenant_id', tenantId)
    .order('clave', { ascending: true });

  return NextResponse.json({
    data: enriched,
    total: count ?? 0,
    page,
    pageSize,
    sucursales: sucursales ?? [],
  });
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
      { error: 'Datos del empleado inválidos', details: parsed.error.issues },
      { status: 422 },
    );
  }

  const admin = createSupabaseAdminClient();
  const { data: created, error } = await admin
    .from('empleados')
    .insert({
      tenant_id: tenantId,
      codigo_empleado: parsed.data.codigo_empleado,
      nombre_completo: parsed.data.nombre_completo,
      credencial: parsed.data.credencial ?? null,
      departamento: parsed.data.departamento ?? null,
      puesto: parsed.data.puesto ?? null,
      sucursal_id: parsed.data.sucursal_id ?? null,
      estatus_empleado: parsed.data.estatus_empleado,
    })
    .select('*')
    .single();

  if (error || !created) {
    return NextResponse.json(
      { error: 'No fue posible registrar el empleado (verifica que el código no exista)' },
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
    },
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
      { error: 'Datos de actualización inválidos', details: parsed.error.issues },
      { status: 422 },
    );
  }

  const admin = createSupabaseAdminClient();
  const { data: updated, error } = await admin
    .from('empleados')
    .update({
      codigo_empleado: parsed.data.codigo_empleado,
      nombre_completo: parsed.data.nombre_completo,
      credencial: parsed.data.credencial,
      departamento: parsed.data.departamento,
      puesto: parsed.data.puesto,
      sucursal_id: parsed.data.sucursal_id,
      estatus_empleado: parsed.data.estatus_empleado,
      sincronizado_en: new Date().toISOString(),
    })
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
    },
  });

  return NextResponse.json({ data: updated });
}
