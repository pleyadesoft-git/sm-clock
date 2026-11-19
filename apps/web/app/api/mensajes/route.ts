import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  MensajeChecadaCreateSchema,
  MensajeChecadaUpdateSchema,
  sanitizeSearchQuery,
  type Database,
} from '@sm-clock/contracts';
import {
  recordAuditLog,
  requireAuthenticatedUser,
} from '@/lib/server/auth';
import { broadcastTenantEvent } from '@/lib/server/realtime-broadcast';
import { createSupabaseAdminClient } from '@/lib/server/supabase-admin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

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

const ToggleFuenteSoporteSchema = z.object({
  accion: z.literal('TOGGLE_FUENTE_PANTALLA'),
  fuente_id: z.uuid(),
  soporta_mensajes_pantalla: z.boolean(),
});

export async function GET(request: Request): Promise<NextResponse> {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  if (auth.user.rol === 'OPERADOR') {
    return NextResponse.json(
      { error: 'El rol Operador no tiene acceso a la gestión de avisos de RH' },
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
  const search = sanitizeSearchQuery(searchParams.get('search') ?? '');
  const alcanceFilter = searchParams.get('alcance') ?? '';
  const estatusFilter = searchParams.get('estatus') ?? '';

  const admin = createSupabaseAdminClient();

  let msgQuery = admin
    .from('mensajes_checadas')
    .select(
      '*, empleados(id, codigo_empleado, nombre_completo, email, telefono_whatsapp, departamento), sucursales(id, clave, nombre)',
    )
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });

  if (search) {
    msgQuery = msgQuery.or(
      `titulo.ilike.%${search}%,mensaje.ilike.%${search}%,departamento.ilike.%${search}%`,
    );
  }

  if (
    alcanceFilter === 'EMPLEADO' ||
    alcanceFilter === 'SUCURSAL' ||
    alcanceFilter === 'DEPARTAMENTO' ||
    alcanceFilter === 'TODOS'
  ) {
    msgQuery = msgQuery.eq('alcance', alcanceFilter);
  }

  if (estatusFilter === 'ACTIVO') {
    msgQuery = msgQuery.eq('activo', true);
  } else if (estatusFilter === 'INACTIVO') {
    msgQuery = msgQuery.eq('activo', false);
  }

  const [
    { data: mensajesRows, error: msgErr },
    { data: entregasRows },
    { data: empleadosRows },
    { data: sucursalesRows },
    { data: fuentesRows },
  ] = await Promise.all([
    msgQuery,
    admin
      .from('mensajes_checadas_entregas')
      .select(
        '*, empleados(id, codigo_empleado, nombre_completo, email, telefono_whatsapp, departamento), mensajes_checadas(id, titulo, mensaje, alcance)',
      )
      .eq('tenant_id', tenantId)
      .order('entregado_en', { ascending: false })
      .limit(200),
    admin
      .from('empleados')
      .select(
        'id, codigo_empleado, nombre_completo, email, telefono_whatsapp, departamento, sucursal_id, estatus_empleado',
      )
      .eq('tenant_id', tenantId)
      .eq('estatus_empleado', 'A')
      .order('nombre_completo', { ascending: true }),
    admin
      .from('sucursales')
      .select('id, clave, nombre')
      .eq('tenant_id', tenantId)
      .eq('activa', true)
      .order('clave', { ascending: true }),
    admin
      .from('fuentes_asistencia')
      .select(
        'id, nombre_ubicacion, marca, modelo, activo, soporta_mensajes_pantalla',
      )
      .eq('tenant_id', tenantId)
      .order('nombre_ubicacion', { ascending: true }),
  ]);

  if (msgErr) {
    return NextResponse.json(
      { error: 'Error al consultar los avisos de asistencia' },
      { status: 500 },
    );
  }

  // Contabilizar estadísticas por mensaje
  const statsByMensaje = new Map<
    string,
    {
      total: number;
      dispositivo: number;
      email: number;
      whatsapp: number;
      sin_canal: number;
    }
  >();

  let totalEntregasDispositivo = 0;
  let totalEntregasEmail = 0;
  let totalPendientesWhatsapp = 0;
  let totalSinCanal = 0;

  for (const e of entregasRows ?? []) {
    const curr = statsByMensaje.get(e.mensaje_id) ?? {
      total: 0,
      dispositivo: 0,
      email: 0,
      whatsapp: 0,
      sin_canal: 0,
    };
    curr.total += 1;
    if (e.estatus_entrega === 'ENTREGADO_DISPOSITIVO') {
      curr.dispositivo += 1;
      totalEntregasDispositivo += 1;
    } else if (e.estatus_entrega === 'ENTREGADO_EMAIL') {
      curr.email += 1;
      totalEntregasEmail += 1;
    } else if (e.estatus_entrega === 'PENDIENTE_WHATSAPP_WEB') {
      curr.whatsapp += 1;
      totalPendientesWhatsapp += 1;
    } else if (
      e.estatus_entrega === 'SIN_CANAL_DISPONIBLE' ||
      e.estatus_entrega === 'ERROR_ENVIO'
    ) {
      curr.sin_canal += 1;
      totalSinCanal += 1;
    }
    statsByMensaje.set(e.mensaje_id, curr);
  }

  const enrichedMensajes = (mensajesRows ?? []).map((m) => ({
    ...m,
    estadisticas: statsByMensaje.get(m.id) ?? {
      total: 0,
      dispositivo: 0,
      email: 0,
      whatsapp: 0,
      sin_canal: 0,
    },
  }));

  const departamentosSet = new Set<string>();
  for (const emp of empleadosRows ?? []) {
    if (emp.departamento && emp.departamento.trim().length > 0) {
      departamentosSet.add(emp.departamento.trim());
    }
  }

  return NextResponse.json(
    {
      data: enrichedMensajes,
      entregas: entregasRows ?? [],
      empleados: empleadosRows ?? [],
      sucursales: sucursalesRows ?? [],
      departamentos: Array.from(departamentosSet).sort(),
      fuentes: fuentesRows ?? [],
      kpis: {
        avisos_activos: (mensajesRows ?? []).filter((m) => m.activo).length,
        entregas_dispositivo: totalEntregasDispositivo,
        entregas_email: totalEntregasEmail,
        pendientes_whatsapp: totalPendientesWhatsapp,
        sin_canal_disponible: totalSinCanal,
      },
    },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
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
      { error: 'Tu rol de Operador no permite programar avisos de RH' },
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

  const parsed = MensajeChecadaCreateSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          parsed.error.issues[0]?.message ?? 'Datos del aviso inválidos',
        details: parsed.error.issues,
      },
      { status: 422 },
    );
  }

  const admin = createSupabaseAdminClient();
  const payload = parsed.data;

  const { data: created, error } = await admin
    .from('mensajes_checadas')
    .insert({
      tenant_id: tenantId,
      titulo: payload.titulo,
      mensaje: payload.mensaje,
      texto_voz_personalizado: payload.texto_voz_personalizado ?? null,
      reproducir_audio: payload.reproducir_audio,
      alcance: payload.alcance,
      empleado_id:
        payload.alcance === 'EMPLEADO' ? (payload.empleado_id ?? null) : null,
      sucursal_id:
        payload.alcance === 'SUCURSAL' ? (payload.sucursal_id ?? null) : null,
      departamento:
        payload.alcance === 'DEPARTAMENTO'
          ? (payload.departamento ?? null)
          : null,
      evento_disparo: payload.evento_disparo,
      modo_entrega: payload.modo_entrega,
      repeticion: payload.repeticion,
      activo: payload.activo,
      vigente_hasta: payload.vigente_hasta ?? null,
      creado_por: auth.user.userId,
    })
    .select('*')
    .single();

  if (error || !created) {
    return NextResponse.json(
      { error: 'No fue posible guardar el aviso para el empleado' },
      { status: 500 },
    );
  }

  await recordAuditLog({
    tenantId,
    actorId: auth.user.userId,
    accion: 'MENSAJE_CHECADA_CREAR',
    detalle: {
      mensaje_id: created.id,
      titulo: created.titulo,
      alcance: created.alcance,
      evento_disparo: created.evento_disparo,
    },
  });

  await broadcastTenantEvent(tenantId, 'mensajes_checadas_changed', {
    id: created.id,
    accion: 'CREATE',
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
      { error: 'Tu rol de Operador no permite modificar avisos' },
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

  const admin = createSupabaseAdminClient();

  // Caso especial: cambiar flag `soporta_mensajes_pantalla` de una fuente/reloj
  const toggleFuenteParsed = ToggleFuenteSoporteSchema.safeParse(rawBody);
  if (toggleFuenteParsed.success) {
    const { fuente_id, soporta_mensajes_pantalla } = toggleFuenteParsed.data;
    const { data: updatedFuente, error: fuenteErr } = await admin
      .from('fuentes_asistencia')
      .update({ soporta_mensajes_pantalla })
      .eq('id', fuente_id)
      .eq('tenant_id', tenantId)
      .select(
        'id, nombre_ubicacion, marca, soporta_mensajes_pantalla',
      )
      .single();

    if (fuenteErr || !updatedFuente) {
      return NextResponse.json(
        { error: 'No se pudo actualizar la capacidad del dispositivo' },
        { status: 500 },
      );
    }

    await broadcastTenantEvent(tenantId, 'mensajes_checadas_changed', {
      fuente_id,
      soporta_mensajes_pantalla,
    });

    return NextResponse.json({ data: updatedFuente });
  }

  const parsed = MensajeChecadaUpdateSchema.safeParse(rawBody);
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

  const { id, ...fields } = parsed.data;
  const updatePayload: Database['public']['Tables']['mensajes_checadas']['Update'] =
    {
      updated_at: new Date().toISOString(),
    };

  if (fields.titulo !== undefined) updatePayload.titulo = fields.titulo;
  if (fields.mensaje !== undefined) updatePayload.mensaje = fields.mensaje;
  if (fields.texto_voz_personalizado !== undefined) {
    updatePayload.texto_voz_personalizado = fields.texto_voz_personalizado;
  }
  if (fields.reproducir_audio !== undefined) {
    updatePayload.reproducir_audio = fields.reproducir_audio;
  }
  if (fields.alcance !== undefined) {
    updatePayload.alcance = fields.alcance;
    updatePayload.empleado_id =
      fields.alcance === 'EMPLEADO' ? (fields.empleado_id ?? null) : null;
    updatePayload.sucursal_id =
      fields.alcance === 'SUCURSAL' ? (fields.sucursal_id ?? null) : null;
    updatePayload.departamento =
      fields.alcance === 'DEPARTAMENTO' ? (fields.departamento ?? null) : null;
  }
  if (fields.evento_disparo !== undefined) {
    updatePayload.evento_disparo = fields.evento_disparo;
  }
  if (fields.modo_entrega !== undefined) {
    updatePayload.modo_entrega = fields.modo_entrega;
  }
  if (fields.repeticion !== undefined) {
    updatePayload.repeticion = fields.repeticion;
  }
  if (fields.activo !== undefined) {
    updatePayload.activo = fields.activo;
  }
  if (fields.vigente_hasta !== undefined) {
    updatePayload.vigente_hasta = fields.vigente_hasta;
  }

  const { data: updated, error } = await admin
    .from('mensajes_checadas')
    .update(updatePayload)
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .select('*')
    .single();

  if (error || !updated) {
    return NextResponse.json(
      { error: 'No fue posible actualizar el aviso' },
      { status: 500 },
    );
  }

  await recordAuditLog({
    tenantId,
    actorId: auth.user.userId,
    accion: 'MENSAJE_CHECADA_ACTUALIZAR',
    detalle: {
      mensaje_id: updated.id,
      activo: updated.activo,
    },
  });

  await broadcastTenantEvent(tenantId, 'mensajes_checadas_changed', {
    id: updated.id,
    accion: 'UPDATE',
  });

  return NextResponse.json({ data: updated });
}

export async function DELETE(request: Request): Promise<NextResponse> {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  if (auth.user.rol === 'OPERADOR') {
    return NextResponse.json(
      { error: 'Tu rol de Operador no permite eliminar avisos' },
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
  const id = searchParams.get('id');
  const idParsed = z.uuid().safeParse(id);
  if (!idParsed.success) {
    return NextResponse.json(
      { error: 'Identificador de aviso inválido' },
      { status: 400 },
    );
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from('mensajes_checadas')
    .delete()
    .eq('id', idParsed.data)
    .eq('tenant_id', tenantId);

  if (error) {
    return NextResponse.json(
      { error: 'Error al eliminar el aviso' },
      { status: 500 },
    );
  }

  await recordAuditLog({
    tenantId,
    actorId: auth.user.userId,
    accion: 'MENSAJE_CHECADA_ELIMINAR',
    detalle: { mensaje_id: idParsed.data },
  });

  await broadcastTenantEvent(tenantId, 'mensajes_checadas_changed', {
    id: idParsed.data,
    accion: 'DELETE',
  });

  return NextResponse.json({ ok: true });
}
