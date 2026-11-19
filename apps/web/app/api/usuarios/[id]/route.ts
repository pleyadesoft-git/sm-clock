import { NextResponse } from 'next/server';
import { UpdateTenantUserRequestSchema } from '@sm-clock/contracts';
import { recordAuditLog, requireTenantAdmin } from '@/lib/server/auth';
import { broadcastTenantEvent } from '@/lib/server/realtime-broadcast';
import { createSupabaseServiceClient } from '@/lib/server/supabase-admin';

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireTenantAdmin();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { id } = await context.params;
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: 'Cuerpo JSON inválido' }, { status: 400 });
  }

  const parsed = UpdateTenantUserRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          parsed.error.issues[0]?.message ?? 'Datos de actualización inválidos',
      },
      { status: 422 },
    );
  }

  const { tenantId, user } = auth;
  if (id === user.userId && parsed.data.activo === false) {
    return NextResponse.json(
      { error: 'No puedes desactivar tu propio usuario administrador' },
      { status: 400 },
    );
  }

  const admin = createSupabaseServiceClient();
  const { data: updated, error } = await admin
    .from('perfiles_usuarios')
    .update({
      ...(parsed.data.rol !== undefined ? { rol: parsed.data.rol } : {}),
      ...(parsed.data.activo !== undefined
        ? { activo: parsed.data.activo }
        : {}),
      ...(parsed.data.sucursal_id !== undefined
        ? { sucursal_id: parsed.data.sucursal_id }
        : {}),
      ...(parsed.data.nombre_completo !== undefined
        ? { nombre_completo: parsed.data.nombre_completo }
        : {}),
    })
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .select(
      'id, tenant_id, sucursal_id, nombre_completo, email, rol, activo, auth_provider, created_at',
    )
    .maybeSingle();

  if (error || !updated) {
    return NextResponse.json(
      { error: 'Usuario no encontrado en la empresa' },
      { status: 404 },
    );
  }

  await admin.auth.admin.updateUserById(updated.id, {
    app_metadata: {
      rol: updated.rol,
      tenant_id: updated.tenant_id,
    },
  });

  await recordAuditLog({
    tenantId,
    actorId: user.userId,
    accion: 'ACTUALIZAR_USUARIO_TENANT',
    detalle: {
      target_user_id: updated.id,
      rol: updated.rol,
      activo: updated.activo,
    },
  });

  await broadcastTenantEvent(tenantId, 'usuarios_changed', {
    target_user_id: updated.id,
    accion: 'ACTUALIZAR',
  });

  return NextResponse.json({ data: updated });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireTenantAdmin();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { id } = await context.params;
  const { tenantId, user } = auth;

  if (id === user.userId) {
    return NextResponse.json(
      { error: 'No puedes eliminar tu propia cuenta de administrador' },
      { status: 400 },
    );
  }

  const admin = createSupabaseServiceClient();
  const nowIso = new Date().toISOString();

  const { data: deletedUser, error: deleteUserError } = await admin
    .from('perfiles_usuarios')
    .update({
      activo: false,
      deleted_at: nowIso,
    })
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .select('id, email, nombre_completo')
    .maybeSingle();

  if (deleteUserError) {
    return NextResponse.json(
      { error: 'No se pudo eliminar el usuario' },
      { status: 500 },
    );
  }

  if (deletedUser) {
    await admin.auth.admin.updateUserById(id, {
      ban_duration: '876000h',
    });

    await recordAuditLog({
      tenantId,
      actorId: user.userId,
      accion: 'ELIMINAR_USUARIO_TENANT',
      detalle: {
        target_user_id: deletedUser.id,
        email: deletedUser.email,
      },
    });

    await broadcastTenantEvent(tenantId, 'usuarios_changed', {
      target_user_id: deletedUser.id,
      accion: 'ELIMINAR_USUARIO',
    });

    return NextResponse.json({ data: deletedUser });
  }

  const { data: deletedInvite } = await admin
    .from('invitaciones_usuarios')
    .delete()
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .select('id, email')
    .maybeSingle();

  if (deletedInvite) {
    await recordAuditLog({
      tenantId,
      actorId: user.userId,
      accion: 'ELIMINAR_INVITACION',
      detalle: {
        invitacion_id: deletedInvite.id,
        email: deletedInvite.email,
      },
    });

    await broadcastTenantEvent(tenantId, 'usuarios_changed', {
      invitacion_id: deletedInvite.id,
      accion: 'ELIMINAR_INVITACION',
    });

    return NextResponse.json({ data: deletedInvite });
  }

  return NextResponse.json(
    { error: 'Usuario o invitación no encontrada' },
    { status: 404 },
  );
}
