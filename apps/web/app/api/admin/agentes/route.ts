import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  AdminCreateEnrollmentCodeSchema,
  sanitizeSearchQuery,
} from '@sm-clock/contracts';
import { requireSuperAdmin } from '@/lib/server/auth';
import { generateEnrollmentCode } from '@/lib/server/agent-auth';
import {
  broadcastAdminEvent,
  broadcastTenantEvent,
} from '@/lib/server/realtime-broadcast';
import { createSupabaseAdminClient } from '@/lib/server/supabase-admin';

const RevokeAgentSchema = z.object({
  agente_id: z.uuid(),
});

export async function GET(request: Request): Promise<NextResponse> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, Number(searchParams.get('page') ?? '1'));
  const pageSize = Math.min(100, Math.max(10, Number(searchParams.get('pageSize') ?? '25')));
  const search = sanitizeSearchQuery(searchParams.get('search') ?? '');

  const ALLOWED_SORT_COLUMNS = [
    'nombre',
    'version',
    'ultimo_latido',
    'created_at',
    'revocado_en',
  ] as const;

  const rawSortBy = searchParams.get('sortBy');
  const sortBy = ALLOWED_SORT_COLUMNS.includes(
    rawSortBy as (typeof ALLOWED_SORT_COLUMNS)[number],
  )
    ? (rawSortBy as (typeof ALLOWED_SORT_COLUMNS)[number])
    : 'created_at';
  const sortDir = searchParams.get('sortDir') === 'asc' ? 'asc' : 'desc';

  const admin = createSupabaseAdminClient();
  let query = admin
    .from('agentes')
    .select(
      'id, tenant_id, nombre, version, ultimo_latido, revocado_en, created_at, tenants(tenant_code, nombre_comercial)',
      { count: 'exact' },
    )
    .order(sortBy, { ascending: sortDir === 'asc' });

  if (search) {
    query = query.ilike('nombre', `%${search}%`);
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const { data: agentes, count, error } = await query.range(from, to);

  if (error) {
    return NextResponse.json(
      { error: 'Error al consultar agentes locales' },
      { status: 500 },
    );
  }

  const { data: tenants } = await admin
    .from('tenants')
    .select('id, tenant_code, nombre_comercial')
    .order('nombre_comercial', { ascending: true });

  return NextResponse.json({
    data: agentes ?? [],
    total: count ?? 0,
    page,
    pageSize,
    tenants: tenants ?? [],
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: 'Cuerpo JSON inválido' }, { status: 400 });
  }

  const parsed = AdminCreateEnrollmentCodeSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Parámetros inválidos', details: parsed.error.issues },
      { status: 422 },
    );
  }

  const { plainCode, codeHash } = generateEnrollmentCode();
  const expiraEnIso = new Date(
    Date.now() + parsed.data.ttl_minutos * 60_000,
  ).toISOString();

  const admin = createSupabaseAdminClient();
  const { data: codeRow, error } = await admin
    .from('agente_codigos_enrolamiento')
    .insert({
      tenant_id: parsed.data.tenant_id,
      codigo_hash: codeHash,
      expira_en: expiraEnIso,
      created_by: auth.user.userId,
    })
    .select('id, tenant_id, expira_en, created_at')
    .single();

  if (error || !codeRow) {
    return NextResponse.json(
      { error: 'No fue posible generar el código de enrolamiento' },
      { status: 500 },
    );
  }

  await admin.from('auditoria').insert({
    tenant_id: parsed.data.tenant_id,
    actor_id: auth.user.userId,
    accion: 'GENERAR_CODIGO_ENROLAMIENTO_AGENTE',
    detalle: {
      codigo_id: codeRow.id,
      expira_en: codeRow.expira_en,
      ttl_minutos: parsed.data.ttl_minutos,
    },
  });

  // Se retorna plainCode una única vez en pantalla para que el técnico lo pegue en el instalador del sitio
  return NextResponse.json(
    {
      id: codeRow.id,
      tenant_id: codeRow.tenant_id,
      codigo_enrolamiento: plainCode,
      expira_en: codeRow.expira_en,
    },
    { status: 201 },
  );
}

export async function PATCH(request: Request): Promise<NextResponse> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: 'Cuerpo JSON inválido' }, { status: 400 });
  }

  const parsed = RevokeAgentSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'ID de agente inválido' },
      { status: 422 },
    );
  }

  const admin = createSupabaseAdminClient();
  const nowIso = new Date().toISOString();

  const { data: revoked, error } = await admin
    .from('agentes')
    .update({ revocado_en: nowIso })
    .eq('id', parsed.data.agente_id)
    .select('id, tenant_id, nombre, revocado_en')
    .single();

  if (error || !revoked) {
    return NextResponse.json(
      { error: 'No se pudo revocar el agente' },
      { status: 404 },
    );
  }

  await admin.from('auditoria').insert({
    tenant_id: revoked.tenant_id,
    actor_id: auth.user.userId,
    accion: 'REVOCAR_AGENTE',
    detalle: {
      agente_id: revoked.id,
      nombre_agente: revoked.nombre,
      revocado_en: nowIso,
    },
  });

  await Promise.all([
    broadcastAdminEvent('agentes_changed', {
      agente_id: revoked.id,
      tenant_id: revoked.tenant_id,
      accion: 'REVOCAR',
    }),
    broadcastTenantEvent(revoked.tenant_id, 'agentes_changed', {
      agente_id: revoked.id,
      accion: 'REVOCAR',
    }),
  ]);

  return NextResponse.json({ data: revoked });
}
