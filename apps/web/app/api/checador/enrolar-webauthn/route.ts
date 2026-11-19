import { NextResponse } from 'next/server';
import { KioskSelfEnrollWebAuthnSchema } from '@sm-clock/contracts';
import { recordAuditLog } from '@/lib/server/auth';
import { broadcastTenantEvent } from '@/lib/server/realtime-broadcast';
import { createSupabaseServiceClient } from '@/lib/server/supabase-admin';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<NextResponse> {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: 'Cuerpo JSON inválido' }, { status: 400 });
  }

  const parsed = KioskSelfEnrollWebAuthnSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          parsed.error.issues[0]?.message ??
          'Datos de enrolamiento biométrico inválidos',
        details: parsed.error.issues,
      },
      { status: 422 },
    );
  }

  const admin = createSupabaseServiceClient();
  const { data: tenant } = await admin
    .from('tenants')
    .select('id, tenant_code, nombre_comercial, estatus')
    .eq('tenant_code', parsed.data.tenant_code)
    .is('deleted_at', null)
    .maybeSingle();

  if (!tenant || (tenant.estatus !== 'ACTIVO' && tenant.estatus !== 'PRUEBA')) {
    return NextResponse.json(
      { error: 'La empresa ingresada no existe o no se encuentra activa' },
      { status: 404 },
    );
  }

  const { data: empleado } = await admin
    .from('empleados')
    .select('id, codigo_empleado, nombre_completo, estatus_empleado')
    .eq('tenant_id', tenant.id)
    .eq('pin_codigo', parsed.data.pin_codigo)
    .maybeSingle();

  if (!empleado) {
    return NextResponse.json(
      {
        error:
          'PIN de 6 dígitos incorrecto. Debes validar tu identidad con tu PIN personal para vincular tu huella o FaceID.',
      },
      { status: 401 },
    );
  }

  if (empleado.estatus_empleado !== 'A') {
    return NextResponse.json(
      { error: 'Tu expediente de empleado se encuentra inactivo' },
      { status: 403 },
    );
  }

  const { data: created, error } = await admin
    .from('empleado_webauthn_credenciales')
    .insert({
      tenant_id: tenant.id,
      empleado_id: empleado.id,
      credential_id: parsed.data.credential_id,
      public_key: parsed.data.public_key,
      algoritmo: parsed.data.algoritmo,
      nombre_dispositivo: parsed.data.nombre_dispositivo,
      transports: ['internal'],
    })
    .select('id, empleado_id, credential_id, nombre_dispositivo, created_at')
    .single();

  if (error || !created) {
    return NextResponse.json(
      {
        error:
          'No se pudo vincular la llave biométrica (es posible que este dispositivo ya esté registrado)',
      },
      { status: 409 },
    );
  }

  await admin
    .from('empleados')
    .update({
      webauthn_activo: true,
      sincronizado_en: new Date().toISOString(),
    })
    .eq('id', empleado.id)
    .eq('tenant_id', tenant.id);

  await recordAuditLog({
    tenantId: tenant.id,
    actorId: null,
    accion: 'KIOSCO_ENROLAR_WEBAUTHN',
    detalle: {
      empleado_id: empleado.id,
      codigo_empleado: empleado.codigo_empleado,
      nombre_empleado: empleado.nombre_completo,
      nombre_dispositivo: created.nombre_dispositivo,
    },
  });

  await broadcastTenantEvent(tenant.id, 'empleados_changed', {
    empleado_id: empleado.id,
    codigo_empleado: empleado.codigo_empleado,
    accion: 'WEBAUTHN_AUTOENROLADO',
  });

  return NextResponse.json(
    {
      data: {
        credencial: created,
        empleado: {
          id: empleado.id,
          codigo_empleado: empleado.codigo_empleado,
          nombre_completo: empleado.nombre_completo,
        },
      },
    },
    { status: 201 },
  );
}
