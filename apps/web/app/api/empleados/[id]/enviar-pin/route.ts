import { NextResponse } from 'next/server';
import { EmpleadoFotoParamsSchema } from '@sm-clock/contracts';
import {
  recordAuditLog,
  requireAuthenticatedUser,
  resolveTenantIdForUser,
} from '@/lib/server/auth';
import { getPublicAppOrigin } from '@/lib/server/origin';
import {
  buildEmployeePinEmailTemplate,
  sendTenantEmail,
} from '@/lib/server/smtp-mailer';
import { createSupabaseAdminClient } from '@/lib/server/supabase-admin';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  if (auth.user.rol === 'OPERADOR') {
    return NextResponse.json(
      { error: 'Tu rol de Operador no permite enviar PIN por correo' },
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

  const rawParams = await context.params;
  const parsedParams = EmpleadoFotoParamsSchema.safeParse(rawParams);
  if (!parsedParams.success) {
    return NextResponse.json(
      { error: 'Identificador de empleado inválido' },
      { status: 400 },
    );
  }

  const admin = createSupabaseAdminClient();
  const { data: empleado } = await admin
    .from('empleados')
    .select(
      'id, codigo_empleado, nombre_completo, email, pin_codigo, sucursales(nombre)',
    )
    .eq('id', parsedParams.data.id)
    .eq('tenant_id', tenantId)
    .single();

  if (!empleado) {
    return NextResponse.json(
      { error: 'Empleado no encontrado en tu empresa' },
      { status: 404 },
    );
  }

  if (!empleado.email) {
    return NextResponse.json(
      {
        error:
          'Este empleado no tiene una cuenta de correo electrónico registrada. Agrégala primero para enviarle su PIN.',
      },
      { status: 422 },
    );
  }

  if (!empleado.pin_codigo) {
    return NextResponse.json(
      {
        error:
          'Este empleado aún no tiene un PIN de 6 dígitos asignado. Asígnale uno y guarda antes de enviarlo.',
      },
      { status: 422 },
    );
  }

  const { data: tenant } = await admin
    .from('tenants')
    .select('nombre_comercial, tenant_code')
    .eq('id', tenantId)
    .single();

  const origin = getPublicAppOrigin(request);
  const tenantCode = tenant?.tenant_code ?? 'TIJ-001';
  const kioskUrl = `${origin}/checador?empresa=${encodeURIComponent(tenantCode)}`;
  const sucursalObj = Array.isArray(empleado.sucursales)
    ? empleado.sucursales[0]
    : empleado.sucursales;

  const template = buildEmployeePinEmailTemplate({
    nombreEmpleado: empleado.nombre_completo,
    codigoEmpleado: empleado.codigo_empleado,
    pinCodigo: empleado.pin_codigo,
    tenantNombre: tenant?.nombre_comercial ?? 'Tu Empresa',
    tenantCode,
    sucursalNombre: sucursalObj?.nombre ?? 'Sucursal Principal',
    kioskUrl,
  });

  const delivery = await sendTenantEmail({
    tenantId,
    to: empleado.email,
    subject: template.subject,
    html: template.html,
    text: template.text,
  });

  await recordAuditLog({
    tenantId,
    actorId: auth.user.userId,
    accion: 'ENVIAR_PIN_EMPLEADO_EMAIL',
    detalle: {
      empleado_id: empleado.id,
      codigo_empleado: empleado.codigo_empleado,
      delivered: delivery.delivered,
      provider: delivery.provider,
    },
  });

  return NextResponse.json({
    ok: true,
    email: empleado.email,
    kioskUrl,
    delivery,
  });
}
