import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuthenticatedUser } from '@/lib/server/auth';
import { processPunchNotificationsForBatch } from '@/lib/server/mensajes-checadas';
import { createSupabaseAdminClient } from '@/lib/server/supabase-admin';

const ProbarDisparoSchema = z.object({
  empleado_id: z.uuid('Selecciona un empleado válido para la prueba'),
  tipo_marca: z.enum(['ENTRADA', 'SALIDA']).default('ENTRADA'),
  fuente_id: z.uuid().optional(),
});

export async function POST(request: Request): Promise<NextResponse> {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  if (auth.user.rol === 'OPERADOR') {
    return NextResponse.json(
      { error: 'Tu rol de Operador no permite ejecutar pruebas de avisos' },
      { status: 403 },
    );
  }

  const admin = createSupabaseAdminClient();
  let tenantId = auth.user.tenantId;
  if (!tenantId && auth.user.rol === 'SUPER_ADMIN') {
    const { data: firstTenant } = await admin
      .from('tenants')
      .select('id')
      .eq('estatus', 'ACTIVO')
      .order('created_at', { ascending: true })
      .limit(1)
      .single();
    tenantId = firstTenant?.id ?? null;
  }

  if (!tenantId) {
    return NextResponse.json(
      { error: 'Usuario sin empresa asignada' },
      { status: 403 },
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: 'Cuerpo JSON inválido' }, { status: 400 });
  }

  const parsed = ProbarDisparoSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          parsed.error.issues[0]?.message ?? 'Parámetros de prueba inválidos',
      },
      { status: 422 },
    );
  }

  const { data: empleado } = await admin
    .from('empleados')
    .select('id, codigo_empleado, nombre_completo, sucursal_id')
    .eq('id', parsed.data.empleado_id)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (!empleado) {
    return NextResponse.json(
      { error: 'Empleado no encontrado en la empresa' },
      { status: 404 },
    );
  }

  let fuenteId = parsed.data.fuente_id ?? null;
  if (!fuenteId) {
    const { data: defaultFuente } = await admin
      .from('fuentes_asistencia')
      .select('id')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    fuenteId = defaultFuente?.id ?? '00000000-0000-4000-8000-000000000000';
  }

  const now = new Date();
  const tsLocal = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Tijuana',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(now);

  const notificaciones = await processPunchNotificationsForBatch({
    tenantId,
    punches: [
      {
        checada_id: null,
        fuente_id: fuenteId,
        codigo_empleado: empleado.codigo_empleado,
        ts_utc: now.toISOString(),
        ts_dispositivo_local: tsLocal,
        tipo_marca: parsed.data.tipo_marca,
      },
    ],
  });

  return NextResponse.json({
    ok: true,
    notificaciones_disparadas: notificaciones,
  });
}
