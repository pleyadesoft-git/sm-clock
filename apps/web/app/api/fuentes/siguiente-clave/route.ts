import { NextResponse } from 'next/server';
import { requireAuthenticatedUser } from '@/lib/server/auth';
import { createSupabaseAdminClient } from '@/lib/server/supabase-admin';

export async function GET(request: Request): Promise<NextResponse> {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { searchParams } = new URL(request.url);
  const sucursalId = searchParams.get('sucursal_id');
  const queryTenantId = searchParams.get('tenant_id');

  // Tenant ID resuelto estrictamente
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

  if (!sucursalId) {
    return NextResponse.json(
      { error: 'Parámetro sucursal_id obligatorio' },
      { status: 400 },
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
      { error: error?.message || 'No se pudo generar la nomenclatura para la sucursal' },
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
