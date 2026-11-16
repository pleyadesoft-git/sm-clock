import { NextResponse } from 'next/server';
import {
  ValidarCodigoEmpleadoSchema,
  type ValidarCodigoEmpleadoResponse,
} from '@sm-clock/contracts';
import {
  requireAuthenticatedUser,
  resolveTenantIdForUser,
} from '@/lib/server/auth';
import { createSupabaseAdminClient } from '@/lib/server/supabase-admin';

export async function GET(request: Request): Promise<NextResponse> {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  if (auth.user.rol === 'OPERADOR') {
    return NextResponse.json(
      { error: 'El rol Operador no tiene permisos para consultar validación de empleados' },
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
  const parsed = ValidarCodigoEmpleadoSchema.safeParse({
    codigo: searchParams.get('codigo') ?? '',
    excludeId: searchParams.get('excludeId') || undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Parámetros de validación inválidos',
        details: parsed.error.issues,
      },
      { status: 422 },
    );
  }

  const admin = createSupabaseAdminClient();
  let query = admin
    .from('empleados')
    .select('id, codigo_empleado, nombre_completo, estatus_empleado')
    .eq('tenant_id', tenantId)
    .eq('codigo_empleado', parsed.data.codigo);

  if (parsed.data.excludeId) {
    query = query.neq('id', parsed.data.excludeId);
  }

  const { data: existing, error } = await query.maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: 'Error al consultar disponibilidad del código de empleado' },
      { status: 500 },
    );
  }

  const responseBody: ValidarCodigoEmpleadoResponse = {
    disponible: !existing,
    codigo: parsed.data.codigo,
    empleadoExistente: existing
      ? {
          id: existing.id,
          nombre: existing.nombre_completo,
          estatus: existing.estatus_empleado as 'A' | 'I',
        }
      : null,
  };

  return NextResponse.json(responseBody);
}
