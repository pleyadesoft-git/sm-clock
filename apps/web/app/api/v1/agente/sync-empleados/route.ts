import { NextResponse } from 'next/server';
import { authenticateAgentRequest } from '@/lib/server/agent-auth';
import { createSupabaseAdminClient } from '@/lib/server/supabase-admin';

/**
 * POST /api/v1/agente/sync-empleados
 * Retorna el catálogo de empleados activos para el tenant del agente autenticado.
 * Autenticado mediante HMAC-SHA256 y credencial del agente.
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

  const { data: empleados, error } = await admin
    .from('empleados')
    .select('id, codigo_empleado, nombre_completo, estatus_empleado')
    .eq('tenant_id', tenantId)
    .eq('estatus_empleado', 'A')
    .order('codigo_empleado', { ascending: true });

  if (error) {
    return NextResponse.json(
      { error: 'Error al consultar catálogo de empleados' },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    empleados: (empleados ?? []).map((e) => ({
      id: e.id,
      codigo_empleado: e.codigo_empleado,
      nombre_completo: e.nombre_completo,
      activo: e.estatus_empleado === 'A',
    })),
  });
}
