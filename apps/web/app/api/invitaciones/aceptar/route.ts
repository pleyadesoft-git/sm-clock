import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { AcceptInvitationPasswordRequestSchema } from '@sm-clock/contracts';
import { checkRateLimit } from '@/lib/server/agent-auth';
import { recordAuditLog } from '@/lib/server/auth';
import { broadcastTenantEvent } from '@/lib/server/realtime-broadcast';
import { createSupabaseServiceClient } from '@/lib/server/supabase-admin';

export async function POST(request: Request): Promise<NextResponse> {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  if (!checkRateLimit(`accept-invite:${ip}`, 15)) {
    return NextResponse.json(
      { error: 'Demasiados intentos. Intenta nuevamente en un minuto.' },
      { status: 429 },
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: 'Cuerpo JSON inválido' }, { status: 400 });
  }

  const parsed = AcceptInvitationPasswordRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          parsed.error.issues[0]?.message ?? 'Datos de pre-registro inválidos',
        details: parsed.error.issues,
      },
      { status: 422 },
    );
  }

  const tokenHash = createHash('sha256')
    .update(parsed.data.token)
    .digest('hex');
  const admin = createSupabaseServiceClient();

  const { data: invite, error: inviteError } = await admin
    .from('invitaciones_usuarios')
    .select('id, tenant_id, sucursal_id, email, nombre_completo, rol, estatus, expira_en')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (inviteError || !invite) {
    return NextResponse.json(
      { error: 'Invitación no encontrada o enlace inválido' },
      { status: 404 },
    );
  }

  if (invite.estatus !== 'PENDIENTE') {
    return NextResponse.json(
      { error: 'Esta invitación ya fue utilizada o revocada' },
      { status: 410 },
    );
  }

  if (new Date(invite.expira_en).getTime() <= Date.now()) {
    return NextResponse.json(
      { error: 'La invitación ha expirado. Solicita una nueva al administrador.' },
      { status: 410 },
    );
  }

  const normalizedEmail = invite.email.trim().toLowerCase();
  const nowIso = new Date().toISOString();

  // Crear o actualizar usuario en Supabase Auth con confirmación de correo inmediata
  let userId: string | null = null;
  let hasGoogleIdentity = false;
  const { data: createdAuth, error: createAuthError } =
    await admin.auth.admin.createUser({
      email: normalizedEmail,
      password: parsed.data.password,
      email_confirm: true,
      user_metadata: {
        full_name: parsed.data.nombre_completo,
      },
      app_metadata: {
        rol: invite.rol,
        tenant_id: invite.tenant_id,
      },
    });

  if (createdAuth?.user) {
    userId = createdAuth.user.id;
  } else if (createAuthError) {
    // Si el correo ya existe en auth.users (por ej. admin inicial o intento previo), localizar y actualizar
    const { data: listData } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 200,
    });
    const existingAuthUser = listData?.users.find(
      (u) => u.email?.toLowerCase() === normalizedEmail,
    );

    if (!existingAuthUser) {
      return NextResponse.json(
        { error: 'No fue posible crear la cuenta de autenticación' },
        { status: 500 },
      );
    }

    userId = existingAuthUser.id;
    hasGoogleIdentity = Boolean(
      existingAuthUser.identities?.some((idn) => idn.provider === 'google'),
    );
    await admin.auth.admin.updateUserById(userId, {
      password: parsed.data.password,
      email_confirm: true,
      user_metadata: {
        ...existingAuthUser.user_metadata,
        full_name: parsed.data.nombre_completo,
      },
      app_metadata: {
        ...existingAuthUser.app_metadata,
        rol: invite.rol,
        tenant_id: invite.tenant_id,
      },
    });
  }

  if (!userId) {
    return NextResponse.json(
      { error: 'Error al registrar el usuario en el sistema' },
      { status: 500 },
    );
  }

  const { error: profileError } = await admin.from('perfiles_usuarios').upsert(
    {
      id: userId,
      tenant_id: invite.tenant_id,
      sucursal_id: invite.sucursal_id ?? null,
      nombre_completo: parsed.data.nombre_completo,
      email: normalizedEmail,
      rol: invite.rol,
      auth_provider: hasGoogleIdentity ? 'BOTH' : 'EMAIL',
      activo: true,
      ultimo_acceso_en: nowIso,
    },
    { onConflict: 'id' },
  );

  if (profileError) {
    return NextResponse.json(
      { error: 'No fue posible vincular el perfil al tenant' },
      { status: 500 },
    );
  }

  await admin
    .from('invitaciones_usuarios')
    .update({
      estatus: 'ACEPTADA',
      aceptada_en: nowIso,
    })
    .eq('id', invite.id);

  await recordAuditLog({
    tenantId: invite.tenant_id,
    actorId: userId,
    accion: 'INVITACION_ACEPTADA_PASSWORD',
    detalle: {
      invitacion_id: invite.id,
      email: normalizedEmail,
      rol: invite.rol,
    },
  });

  await broadcastTenantEvent(invite.tenant_id, 'usuarios_changed', {
    accion: 'INVITACION_ACEPTADA',
    user_id: userId,
    email: normalizedEmail,
  });

  return NextResponse.json({
    data: {
      email: normalizedEmail,
      rol: invite.rol,
      tenant_id: invite.tenant_id,
    },
  });
}
