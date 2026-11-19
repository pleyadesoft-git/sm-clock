import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  EmpleadoFotoParamsSchema,
  WebAuthnCredentialRegisterSchema,
} from '@sm-clock/contracts';
import {
  recordAuditLog,
  requireAuthenticatedUser,
  resolveTenantIdForUser,
} from '@/lib/server/auth';
import { broadcastTenantEvent } from '@/lib/server/realtime-broadcast';
import { createSupabaseAdminClient } from '@/lib/server/supabase-admin';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  if (auth.user.rol === 'OPERADOR') {
    return NextResponse.json(
      { error: 'El rol Operador no tiene permisos para gestionar WebAuthn' },
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
  const { data: credenciales, error } = await admin
    .from('empleado_webauthn_credenciales')
    .select(
      'id, empleado_id, credential_id, algoritmo, nombre_dispositivo, transports, ultimo_uso_en, created_at',
    )
    .eq('tenant_id', tenantId)
    .eq('empleado_id', parsedParams.data.id)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: 'Error al consultar llaves biométricas WebAuthn del empleado' },
      { status: 500 },
    );
  }

  return NextResponse.json({ data: credenciales ?? [] });
}

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
      { error: 'Tu rol de Operador no permite registrar llaves WebAuthn' },
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

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: 'Cuerpo JSON inválido' }, { status: 400 });
  }

  const parsed = WebAuthnCredentialRegisterSchema.safeParse({
    ...(typeof rawBody === 'object' && rawBody !== null ? rawBody : {}),
    empleado_id: parsedParams.data.id,
  });

  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          parsed.error.issues[0]?.message ??
          'Datos de credencial WebAuthn inválidos',
        details: parsed.error.issues,
      },
      { status: 422 },
    );
  }

  const admin = createSupabaseAdminClient();
  const { data: empleado } = await admin
    .from('empleados')
    .select('id, codigo_empleado, nombre_completo')
    .eq('id', parsed.data.empleado_id)
    .eq('tenant_id', tenantId)
    .single();

  if (!empleado) {
    return NextResponse.json(
      { error: 'Empleado no encontrado en tu empresa' },
      { status: 404 },
    );
  }

  const { data: created, error } = await admin
    .from('empleado_webauthn_credenciales')
    .insert({
      tenant_id: tenantId,
      empleado_id: empleado.id,
      credential_id: parsed.data.credential_id,
      public_key: parsed.data.public_key,
      algoritmo: parsed.data.algoritmo,
      nombre_dispositivo: parsed.data.nombre_dispositivo,
      transports: parsed.data.transports,
    })
    .select(
      'id, empleado_id, credential_id, algoritmo, nombre_dispositivo, transports, ultimo_uso_en, created_at',
    )
    .single();

  if (error || !created) {
    return NextResponse.json(
      {
        error:
          'No fue posible registrar la llave biométrica WebAuthn (verifica que no esté duplicada)',
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
    .eq('tenant_id', tenantId);

  await recordAuditLog({
    tenantId,
    actorId: auth.user.userId,
    accion: 'REGISTRAR_WEBAUTHN_EMPLEADO',
    detalle: {
      empleado_id: empleado.id,
      codigo_empleado: empleado.codigo_empleado,
      nombre_dispositivo: created.nombre_dispositivo,
    },
  });

  await broadcastTenantEvent(tenantId, 'empleados_changed', {
    empleado_id: empleado.id,
    codigo_empleado: empleado.codigo_empleado,
    accion: 'WEBAUTHN_REGISTRADO',
  });

  return NextResponse.json({ data: created }, { status: 201 });
}

const DeleteQuerySchema = z.object({
  credencialId: z.uuid('Identificador de credencial WebAuthn inválido'),
});

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  if (auth.user.rol === 'OPERADOR') {
    return NextResponse.json(
      { error: 'Tu rol de Operador no permite eliminar llaves WebAuthn' },
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

  const { searchParams } = new URL(request.url);
  const parsedQuery = DeleteQuerySchema.safeParse({
    credencialId: searchParams.get('credencialId') ?? '',
  });
  if (!parsedQuery.success) {
    return NextResponse.json(
      { error: 'Parámetro credencialId inválido' },
      { status: 400 },
    );
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from('empleado_webauthn_credenciales')
    .delete()
    .eq('id', parsedQuery.data.credencialId)
    .eq('empleado_id', parsedParams.data.id)
    .eq('tenant_id', tenantId);

  if (error) {
    return NextResponse.json(
      { error: 'No se pudo eliminar la credencial WebAuthn' },
      { status: 500 },
    );
  }

  const { count } = await admin
    .from('empleado_webauthn_credenciales')
    .select('id', { count: 'exact', head: true })
    .eq('empleado_id', parsedParams.data.id)
    .eq('tenant_id', tenantId);

  if ((count ?? 0) === 0) {
    await admin
      .from('empleados')
      .update({ webauthn_activo: false })
      .eq('id', parsedParams.data.id)
      .eq('tenant_id', tenantId);
  }

  await recordAuditLog({
    tenantId,
    actorId: auth.user.userId,
    accion: 'REVOCAR_WEBAUTHN_EMPLEADO',
    detalle: {
      empleado_id: parsedParams.data.id,
      credencial_id: parsedQuery.data.credencialId,
    },
  });

  await broadcastTenantEvent(tenantId, 'empleados_changed', {
    empleado_id: parsedParams.data.id,
    accion: 'WEBAUTHN_REVOCADO',
  });

  return NextResponse.json({ ok: true });
}
