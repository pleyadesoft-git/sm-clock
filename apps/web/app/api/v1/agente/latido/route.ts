import { NextResponse } from 'next/server';
import { AgentHeartbeatSchema } from '@sm-clock/contracts';
import { authenticateAgentRequest } from '@/lib/server/agent-auth';
import { createSupabaseAdminClient } from '@/lib/server/supabase-admin';

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

  const parsed = AgentHeartbeatSchema.safeParse(bodyJson);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Datos de latido inválidos', details: parsed.error.issues },
      { status: 422 },
    );
  }

  const { agenteId, tenantId } = authResult.agent;
  const nowIso = new Date().toISOString();
  const admin = createSupabaseAdminClient();

  await admin
    .from('agentes')
    .update({
      version: parsed.data.version,
      ultimo_latido: nowIso,
    })
    .eq('id', agenteId)
    .eq('tenant_id', tenantId);

  // Actualizar estado de conexión de las fuentes reportadas por el agente
  for (const fuente of parsed.data.fuentes_estado) {
    await admin
      .from('fuentes_asistencia')
      .update({
        ultima_conexion_exitosa: fuente.conectado ? nowIso : undefined,
        ultimo_error: fuente.conectado ? null : (fuente.ultimo_error ?? 'Sin conexión'),
      })
      .eq('id', fuente.fuente_id)
      .eq('tenant_id', tenantId);
  }

  // Verificar deriva de reloj (>120 segundos)
  const agentClockMs = Date.parse(parsed.data.ts_local_agente);
  const driftSeconds = Number.isFinite(agentClockMs)
    ? Math.round(Math.abs(Date.now() - agentClockMs) / 1000)
    : 0;

  return NextResponse.json({
    ok: true,
    server_ts_utc: nowIso,
    clock_drift_seconds: driftSeconds,
    alerta_deriva_reloj: driftSeconds > 120,
  });
}
