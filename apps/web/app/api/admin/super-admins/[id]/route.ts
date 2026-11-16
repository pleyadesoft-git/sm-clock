import { NextResponse } from 'next/server';
import { UpdateSuperAdminRequestSchema } from '@sm-clock/contracts';
import {
  isBootstrapSuperAdminEmail,
  recordAuditLog,
  requireSuperAdmin,
} from '@/lib/server/auth';
import { broadcastAdminEvent } from '@/lib/server/realtime-broadcast';
import { createSupabaseServiceClient } from '@/lib/server/supabase-admin';

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireSuperAdmin();
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

  const parsed = UpdateSuperAdminRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          parsed.error.issues[0]?.message ?? 'Datos de actualización inválidos',
      },
      { status: 422 },
    );
  }

  if (id === auth.user.userId && parsed.data.activo === false) {
    return NextResponse.json(
      { error: 'No puedes desactivar tu propia cuenta de Super-Administrador' },
      { status: 400 },
    );
  }

  const admin = createSupabaseServiceClient();
  const { data: existing } = await admin
    .from('perfiles_usuarios')
    .select('id, email, rol')
    .eq('id', id)
    .eq('rol', 'SUPER_ADMIN')
    .is('tenant_id', null)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json(
      { error: 'Super-Administrador no encontrado' },
      { status: 404 },
    );
  }

  if (
    parsed.data.activo === false &&
    isBootstrapSuperAdminEmail(existing.email)
  ) {
    return NextResponse.json(
      {
        error:
          'No es posible desactivar una cuenta fundadora definida en SUPER_ADMIN_BOOTSTRAP_EMAILS',
      },
      { status: 403 },
    );
  }

  const { data: updated, error } = await admin
    .from('perfiles_usuarios')
    .update({
      ...(parsed.data.activo !== undefined
        ? { activo: parsed.data.activo }
        : {}),
      ...(parsed.data.nombre_completo !== undefined
        ? { nombre_completo: parsed.data.nombre_completo }
        : {}),
    })
    .eq('id', id)
    .eq('rol', 'SUPER_ADMIN')
    .is('tenant_id', null)
    .select(
      'id, nombre_completo, email, activo, auth_provider, ultimo_acceso_en, created_at',
    )
    .single();

  if (error || !updated) {
    return NextResponse.json(
      { error: 'No fue posible actualizar el Super-Administrador' },
      { status: 500 },
    );
  }

  await recordAuditLog({
    tenantId: null,
    actorId: auth.user.userId,
    accion: 'SUPER_ADMIN_UPDATE',
    detalle: {
      target_user_id: updated.id,
      email: updated.email,
      activo: updated.activo,
    },
  });

  await broadcastAdminEvent('super_admins_changed', {
    user_id: updated.id,
    accion: 'ACTUALIZAR',
  });

  return NextResponse.json({
    data: {
      ...updated,
      es_bootstrap: isBootstrapSuperAdminEmail(updated.email),
    },
  });
}
