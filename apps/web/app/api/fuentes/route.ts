import { NextResponse } from 'next/server';
import { FuenteAltaSchema } from '@sm-clock/contracts';
import {
  recordAuditLog,
  requireAuthenticatedUser,
} from '@/lib/server/auth';
import { broadcastTenantEvent } from '@/lib/server/realtime-broadcast';
import { createSupabaseAdminClient } from '@/lib/server/supabase-admin';

export async function GET(request: Request): Promise<NextResponse> {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { searchParams } = new URL(request.url);
  const sucursalId = searchParams.get('sucursal_id');
  const queryTenantId = searchParams.get('tenant_id');

  let tenantId = auth.user.tenantId;
  if (!tenantId && auth.user.rol === 'SUPER_ADMIN') {
    tenantId = queryTenantId;
  }

  if (!tenantId) {
    return NextResponse.json(
      { error: 'Usuario sin empresa asignada' },
      { status: 403 },
    );
  }

  const admin = createSupabaseAdminClient();
  let query = admin
    .from('fuentes_asistencia')
    .select('id, tenant_id, sucursal_id, clave, consecutivo_sucursal, nombre_ubicacion, marca, modelo, ip_local, puerto, usuario_dispositivo, activo, ultima_conexion_exitosa, ultimo_error, created_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: true });

  if (sucursalId) {
    query = query.eq('sucursal_id', sucursalId);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json(
      { error: 'Error al consultar terminales de asistencia' },
      { status: 500 },
    );
  }

  return NextResponse.json({
    data: data ?? [],
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  if (auth.user.rol === 'OPERADOR') {
    return NextResponse.json(
      { error: 'No tienes permisos para registrar terminales de reloj checador' },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Cuerpo JSON inválido' }, { status: 400 });
  }

  const parsed = FuenteAltaSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Datos de terminal inválidos' },
      { status: 400 },
    );
  }

  const payload = parsed.data;
  let tenantId = auth.user.tenantId;
  if (!tenantId && auth.user.rol === 'SUPER_ADMIN') {
    // Si es super admin, puede venir en el payload o inferirse de la sucursal
    const admin = createSupabaseAdminClient();
    const { data: suc } = await admin
      .from('sucursales')
      .select('tenant_id')
      .eq('id', payload.sucursal_id)
      .single();
    tenantId = suc?.tenant_id ?? null;
  }

  if (!tenantId) {
    return NextResponse.json(
      { error: 'No se pudo determinar la empresa asignada a la sucursal' },
      { status: 400 },
    );
  }

  const admin = createSupabaseAdminClient();

  // Si no se proporcionó clave explícita, el trigger SQL la asigna automáticamente con la nomenclatura
  const insertPayload = {
    ...(payload.id ? { id: payload.id } : {}),
    tenant_id: tenantId,
    sucursal_id: payload.sucursal_id,
    nombre_ubicacion: payload.nombre_ubicacion,
    marca: payload.marca,
    modelo: payload.modelo ?? null,
    ip_local: payload.ip_local,
    puerto: payload.puerto,
    usuario_dispositivo: payload.usuario_dispositivo ?? 'admin',
    activo: payload.activo,
    intervalo_checadas_min: 30,
    ...(payload.clave ? { clave: payload.clave } : {}),
  };

  const { data, error } = await admin
    .from('fuentes_asistencia')
    .upsert(insertPayload)
    .select('id, tenant_id, sucursal_id, clave, consecutivo_sucursal, nombre_ubicacion, marca, modelo, ip_local, puerto, activo, created_at')
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message || 'Error al guardar el reloj en la nube' },
      { status: 500 },
    );
  }

  // Notificar en tiempo real al tenant por broadcast
  await broadcastTenantEvent(tenantId, 'fuentes_changed', {
    fuente_id: data.id,
    sucursal_id: data.sucursal_id,
    clave: data.clave,
  });

  await broadcastTenantEvent(tenantId, 'sucursales_changed', {
    sucursal_id: data.sucursal_id,
    fuente_id: data.id,
    clave: data.clave,
  });

  await recordAuditLog({
    tenantId,
    actorId: auth.user.userId,
    accion: 'CREAR_FUENTE_ASISTENCIA',
    detalle: {
      fuente_id: data.id,
      clave: data.clave,
      marca: data.marca,
      ip: data.ip_local,
      sucursal_id: data.sucursal_id,
    },
  });

  return NextResponse.json({
    ok: true,
    data,
    mensaje: `Terminal ${data.clave || data.nombre_ubicacion} registrada exitosamente en tiempo real`,
  });
}
