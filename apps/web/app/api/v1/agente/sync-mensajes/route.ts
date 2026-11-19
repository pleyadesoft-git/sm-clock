import { NextResponse } from 'next/server';
import { authenticateAgentRequest } from '@/lib/server/agent-auth';
import { createSupabaseAdminClient } from '@/lib/server/supabase-admin';

/**
 * POST /api/v1/agente/sync-mensajes
 * Permite al Agente Local Python descargar los avisos activos del tenant
 * para precargarlos en la memoria de los relojes físicos (ZKTeco SMS / Hikvision ISAPI)
 * y reproducir notificaciones visuales + audio dinámico personalizado en sitio.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const rawBody = await request.text();
  const authResult = await authenticateAgentRequest(request, rawBody);

  if (!authResult.ok) {
    return NextResponse.json(
      { error: authResult.message },
      { status: authResult.status },
    );
  }

  const { tenantId } = authResult.agent;
  const admin = createSupabaseAdminClient();
  const nowIso = new Date().toISOString();

  const { data: rows, error } = await admin
    .from('mensajes_checadas')
    .select(
      'id, titulo, mensaje, texto_voz_personalizado, reproducir_audio, alcance, empleado_id, sucursal_id, departamento, evento_disparo, modo_entrega, repeticion, activo, vigente_hasta, empleados(codigo_empleado, nombre_completo)',
    )
    .eq('tenant_id', tenantId)
    .eq('activo', true)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: 'Error al sincronizar avisos activos del tenant' },
      { status: 500 },
    );
  }

  const activeList = (rows ?? [])
    .filter((r) => !r.vigente_hasta || r.vigente_hasta >= nowIso)
    .map((r) => {
      const empRel = r.empleados as unknown as {
        codigo_empleado?: string;
        nombre_completo?: string;
      } | null;
      return {
        id: r.id,
        titulo: r.titulo,
        mensaje: r.mensaje,
        texto_voz_personalizado: r.texto_voz_personalizado,
        reproducir_audio: r.reproducir_audio,
        alcance: r.alcance,
        empleado_id: r.empleado_id,
        codigo_empleado: empRel?.codigo_empleado ?? null,
        nombre_empleado: empRel?.nombre_completo ?? null,
        sucursal_id: r.sucursal_id,
        departamento: r.departamento,
        evento_disparo: r.evento_disparo,
        modo_entrega: r.modo_entrega,
        repeticion: r.repeticion,
        vigente_hasta: r.vigente_hasta,
      };
    });

  return NextResponse.json({
    ok: true,
    mensajes: activeList,
    servidor_ts_utc: nowIso,
  });
}
