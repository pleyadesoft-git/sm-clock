import { NextResponse } from 'next/server';
import {
  ValidarPinEmpleadoSchema,
  type ValidarPinEmpleadoResponse,
} from '@sm-clock/contracts';
import {
  requireAuthenticatedUser,
  resolveTenantIdForUser,
} from '@/lib/server/auth';
import { createSupabaseAdminClient } from '@/lib/server/supabase-admin';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  if (auth.user.rol === 'OPERADOR') {
    return NextResponse.json(
      {
        error:
          'El rol Operador no tiene permisos para consultar validación de PIN',
      },
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
  const parsed = ValidarPinEmpleadoSchema.safeParse({
    pin: searchParams.get('pin') ?? '',
    excludeId: searchParams.get('excludeId') || undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          parsed.error.issues[0]?.message ?? 'El PIN debe ser de 6 dígitos',
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
    .eq('pin_codigo', parsed.data.pin);

  if (parsed.data.excludeId) {
    query = query.neq('id', parsed.data.excludeId);
  }

  const { data: existing, error } = await query.maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: 'Error al consultar disponibilidad del PIN' },
      { status: 500 },
    );
  }

  const responseBody: ValidarPinEmpleadoResponse = {
    disponible: !existing,
    pin: parsed.data.pin,
    empleadoExistente: existing
      ? {
          id: existing.id,
          nombre: existing.nombre_completo,
          codigo_empleado: existing.codigo_empleado,
          estatus: existing.estatus_empleado as 'A' | 'I',
        }
      : null,
  };

  return NextResponse.json(responseBody);
}
