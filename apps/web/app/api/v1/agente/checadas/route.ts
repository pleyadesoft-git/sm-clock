import { NextResponse } from 'next/server';
import { AgentChecadasBatchSchema } from '@sm-clock/contracts';
import { authenticateAgentRequest } from '@/lib/server/agent-auth';
import { createSupabaseAdminClient } from '@/lib/server/supabase-admin';

/**
 * POST /api/v1/agente/checadas
 * Recibe un lote firmado de hasta 500 checadas desde el Agente Local Python.
 * Regla Dura #2: `tenant_id` sale exclusivamente de la credencial del agente.
 * Regla de Negocio (docs/ARCHITECTURE.md §6): Aunque el tenant esté en estatus
 * SUSPENDIDO por falta de pago, la ingesta NUNCA se bloquea para no perder asistencia.
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

  let bodyJson: unknown;
  try {
    bodyJson = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Cuerpo JSON inválido' }, { status: 400 });
  }

  const parsed = AgentChecadasBatchSchema.safeParse(bodyJson);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Lote de checadas inválido', details: parsed.error.issues },
      { status: 422 },
    );
  }

  const { agenteId, tenantId } = authResult.agent;
  const admin = createSupabaseAdminClient();

  const rowsToInsert = parsed.data.checadas.map((item) => ({
    tenant_id: tenantId,
    fuente_id: item.fuente_id,
    codigo_empleado: item.codigo_empleado,
    ts_utc: item.ts_utc,
    ts_dispositivo_local: item.ts_dispositivo_local,
    ambigua: item.ambigua,
    tipo_marca: item.tipo_marca,
    tipo_verificacion: item.tipo_verificacion ?? null,
    agente_id: agenteId,
  }));

  // Upsert idempotente: ON CONFLICT (tenant_id, fuente_id, codigo_empleado, ts_utc) DO NOTHING
  const { data: insertedRows, error: insertError } = await admin
    .from('checadas')
    .upsert(rowsToInsert, {
      onConflict: 'tenant_id,fuente_id,codigo_empleado,ts_utc',
      ignoreDuplicates: true,
    })
    .select('id, fuente_id, ts_utc');

  if (insertError) {
    return NextResponse.json(
      { error: 'Error al registrar el lote de checadas en la base de datos' },
      { status: 500 },
    );
  }

  // Actualizar latido del agente implícitamente al recibir checadas
  await admin
    .from('agentes')
    .update({ ultimo_latido: new Date().toISOString() })
    .eq('id', agenteId)
    .eq('tenant_id', tenantId);

  const insertedCount = insertedRows?.length ?? 0;

  // Emitir evento ligero (sin PII) al canal privado de Supabase Realtime Broadcast
  if (insertedCount > 0) {
    try {
      const channel = admin.channel(`tenant:${tenantId}:checadas`, {
        config: { broadcast: { ack: false } },
      });
      await channel.send({
        type: 'broadcast',
        event: 'nueva_checada',
        payload: {
          lote_id: parsed.data.lote_id,
          nuevas: insertedCount,
          ultimo_id: insertedRows?.[0]?.id ?? null,
          ts_utc: new Date().toISOString(),
        },
      });
      await admin.removeChannel(channel);
    } catch {
      // No fallar la ingesta si el broadcast falla momentáneamente
    }
  }

  return NextResponse.json({
    ok: true,
    lote_id: parsed.data.lote_id,
    recibidas: rowsToInsert.length,
    insertadas: insertedCount,
    duplicadas_ignoradas: rowsToInsert.length - insertedCount,
  });
}
