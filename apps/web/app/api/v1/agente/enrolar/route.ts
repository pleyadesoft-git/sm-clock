import { NextResponse } from 'next/server';
import { AgentEnrollRequestSchema } from '@sm-clock/contracts';
import {
  checkRateLimit,
  generateAgentToken,
  sha256Hex,
} from '@/lib/server/agent-auth';
import { createSupabaseAdminClient } from '@/lib/server/supabase-admin';

export async function POST(request: Request): Promise<NextResponse> {
  const clientIp =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '127.0.0.1';

  if (!checkRateLimit(`enroll:${clientIp}`, 10)) {
    return NextResponse.json(
      { error: 'Demasiados intentos de enrolamiento desde esta IP' },
      { status: 429 },
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: 'Cuerpo JSON inválido' }, { status: 400 });
  }

  const parsed = AgentEnrollRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Datos de enrolamiento inválidos', details: parsed.error.issues },
      { status: 422 },
    );
  }

  const codeHash = sha256Hex(parsed.data.codigo_enrolamiento.trim());
  const admin = createSupabaseAdminClient();

  const { data: enrollmentRow, error: enrollError } = await admin
    .from('agente_codigos_enrolamiento')
    .select('id, tenant_id, expira_en, usado_en')
    .eq('codigo_hash', codeHash)
    .single();

  if (enrollError || !enrollmentRow) {
    return NextResponse.json(
      { error: 'Código de enrolamiento inválido o inexistente' },
      { status: 401 },
    );
  }

  if (enrollmentRow.usado_en !== null) {
    return NextResponse.json(
      { error: 'Este código de enrolamiento ya fue utilizado' },
      { status: 409 },
    );
  }

  if (new Date(enrollmentRow.expira_en).getTime() <= Date.now()) {
    return NextResponse.json(
      { error: 'El código de enrolamiento ha expirado' },
      { status: 410 },
    );
  }

  const { data: tenantRow } = await admin
    .from('tenants')
    .select('zona_horaria')
    .eq('id', enrollmentRow.tenant_id)
    .single();

  const { plainToken, tokenHash } = generateAgentToken();

  // Marcar código como usado de forma atómica (solo si usado_en sigue null)
  const { data: updatedCode, error: markUsedError } = await admin
    .from('agente_codigos_enrolamiento')
    .update({ usado_en: new Date().toISOString() })
    .eq('id', enrollmentRow.id)
    .is('usado_en', null)
    .select('id')
    .single();

  if (markUsedError || !updatedCode) {
    return NextResponse.json(
      { error: 'El código de enrolamiento ya fue consumido concurrentemente' },
      { status: 409 },
    );
  }

  const { data: newAgent, error: createAgentError } = await admin
    .from('agentes')
    .insert({
      tenant_id: enrollmentRow.tenant_id,
      nombre: parsed.data.nombre_agente,
      token_hash: tokenHash,
      version: parsed.data.version,
      ultimo_latido: new Date().toISOString(),
    })
    .select('id, tenant_id')
    .single();

  if (createAgentError || !newAgent) {
    return NextResponse.json(
      { error: 'No fue posible registrar el agente' },
      { status: 500 },
    );
  }

  await admin.from('auditoria').insert({
    tenant_id: enrollmentRow.tenant_id,
    actor_id: null,
    accion: 'ENROLAR_AGENTE',
    detalle: {
      agente_id: newAgent.id,
      nombre_agente: parsed.data.nombre_agente,
      version: parsed.data.version,
      hostname: parsed.data.hostname ?? null,
    },
  });

  return NextResponse.json(
    {
      agente_id: newAgent.id,
      credencial_token: plainToken,
      tenant_id: newAgent.tenant_id,
      zona_horaria: tenantRow?.zona_horaria ?? 'America/Tijuana',
    },
    { status: 201 },
  );
}
