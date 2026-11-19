import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuthenticatedUser } from '@/lib/server/auth';
import { createSupabaseAdminClient } from '@/lib/server/supabase-admin';

const SiguienteClaveQuerySchema = z.object({
  sucursal_id: z.string().uuid('Parámetro sucursal_id inválido'),
  tenant_id: z.string().uuid('Parámetro tenant_id inválido').optional(),
});

export async function GET(request: Request): Promise<NextResponse> {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { searchParams } = new URL(request.url);
  const parsed = SiguienteClaveQuerySchema.safeParse({
    sucursal_id: searchParams.get('sucursal_id'),
    tenant_id: searchParams.get('tenant_id') ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          parsed.error.issues[0]?.message ??
          'Parámetros de consulta inválidos',
      },
      { status: 400 },
    );
  }

  const { sucursal_id: sucursalId, tenant_id: queryTenantId } = parsed.data;

  // Tenant ID resuelto estrictamente
  let tenantId = auth.user.tenantId;
  if (!tenantId && auth.user.rol === 'SUPER_ADMIN') {
    tenantId = queryTenantId ?? null;
  }

  if (!tenantId) {
    return NextResponse.json(
      { error: 'Usuario sin empresa asignada' },
      { status: 403 },
    );
  }

  const admin = createSupabaseAdminClient();

  // Llamar a la función PostgreSQL generar_nomenclatura_fuente
  const { data, error } = await admin.rpc('generar_nomenclatura_fuente', {
    p_tenant_id: tenantId,
    p_sucursal_id: sucursalId,
  });

  if (error || !data || data.length === 0) {
    return NextResponse.json(
      { error: 'No se pudo generar la nomenclatura para la sucursal' },
      { status: 400 },
    );
  }

  const result = data[0];
  if (!result) {
    return NextResponse.json(
      { error: 'No se pudo generar la nomenclatura para la sucursal' },
      { status: 400 },
    );
  }

  return NextResponse.json({
    ok: true,
    consecutivo: result.consecutivo,
    clave: result.clave,
  });
}
