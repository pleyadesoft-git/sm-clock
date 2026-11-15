import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  roleRequiresMfa,
  sanitizeRedirectPath,
  sanitizeTextInput,
  UserRoleSchema,
} from '@sm-clock/contracts';
import {
  claimBootstrapSuperAdminForUser,
  claimPendingInvitationForUser,
  isBootstrapSuperAdminEmail,
  recordAuditLog,
} from '@/lib/server/auth';
import { createSupabaseServiceClient } from '@/lib/server/supabase-admin';
import { getRequestOrigin } from '@/lib/server/origin';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const origin = getRequestOrigin(request);
  const code = url.searchParams.get('code');
  const inviteToken = (url.searchParams.get('invite_token') ?? '').trim();
  const modeParam = (url.searchParams.get('mode') ?? '').trim();
  const nextParam = url.searchParams.get('next');

  if (!code) {
    return NextResponse.redirect(
      new URL('/login?error=oauth_invalido', origin),
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data: sessionData, error: exchangeError } =
    await supabase.auth.exchangeCodeForSession(code);

  if (exchangeError || !sessionData.user) {
    return NextResponse.redirect(
      new URL('/login?error=oauth_invalido', origin),
    );
  }

  const user = sessionData.user;
  const normalizedEmail = (user.email ?? '').trim().toLowerCase();
  const admin = createSupabaseServiceClient();
  const nowIso = new Date().toISOString();
  const fullNameFallback =
    typeof user.user_metadata?.['full_name'] === 'string'
      ? sanitizeTextInput(user.user_metadata['full_name'])
      : null;

  // 1. Flujo explícito de Acceso Super-Admin desde la opción discreta del Login
  if (modeParam === 'super_admin') {
    if (!isBootstrapSuperAdminEmail(normalizedEmail)) {
      await supabase.auth.signOut();
      return NextResponse.redirect(
        new URL(
          '/login?mode=super_admin&error=super_admin_no_autorizado',
          origin,
        ),
      );
    }

    await claimBootstrapSuperAdminForUser({
      userId: user.id,
      email: normalizedEmail,
      fullNameFallback,
    });

    const safeDest = sanitizeRedirectPath(
      nextParam ?? '/admin/empresas',
      'SUPER_ADMIN',
    );
    const { data: aalData } =
      await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aalData?.nextLevel === 'aal2' && aalData.currentLevel !== 'aal2') {
      return NextResponse.redirect(
        new URL(`/mfa?next=${encodeURIComponent(safeDest)}`, origin),
      );
    }

    return NextResponse.redirect(new URL(safeDest, origin));
  }

  // 2. Si viene desde un enlace de invitación (/invitacion/[token]), validar el token específico
  if (inviteToken.length >= 16) {
    const tokenHash = createHash('sha256').update(inviteToken).digest('hex');
    const { data: invite } = await admin
      .from('invitaciones_usuarios')
      .select('id, tenant_id, email, nombre_completo, rol, estatus, expira_en')
      .eq('token_hash', tokenHash)
      .maybeSingle();

    if (
      invite &&
      invite.estatus === 'PENDIENTE' &&
      new Date(invite.expira_en).getTime() > Date.now() &&
      invite.email.trim().toLowerCase() === normalizedEmail
    ) {
      const fullName =
        fullNameFallback && fullNameFallback.length >= 2
          ? fullNameFallback
          : sanitizeTextInput(invite.nombre_completo);

      await admin.from('perfiles_usuarios').upsert(
        {
          id: user.id,
          tenant_id: invite.tenant_id,
          nombre_completo: fullName,
          email: normalizedEmail,
          rol: invite.rol,
          auth_provider: 'GOOGLE',
          activo: true,
          ultimo_acceso_en: nowIso,
        },
        { onConflict: 'id' },
      );

      await admin
        .from('invitaciones_usuarios')
        .update({ estatus: 'ACEPTADA', aceptada_en: nowIso })
        .eq('id', invite.id);

      await admin.auth.admin.updateUserById(user.id, {
        app_metadata: {
          rol: invite.rol,
          tenant_id: invite.tenant_id,
        },
      });

      await recordAuditLog({
        tenantId: invite.tenant_id,
        actorId: user.id,
        accion: 'INVITACION_ACEPTADA_GOOGLE',
        detalle: {
          invitacion_id: invite.id,
          email: normalizedEmail,
          rol: invite.rol,
        },
      });

      const invitedRole = UserRoleSchema.safeParse(invite.rol);
      const safeDest = sanitizeRedirectPath(
        nextParam,
        invitedRole.success ? invitedRole.data : null,
      );
      if (invitedRole.success && roleRequiresMfa(invitedRole.data)) {
        const { data: aalData } =
          await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        if (aalData?.nextLevel === 'aal2' && aalData.currentLevel !== 'aal2') {
          return NextResponse.redirect(
            new URL(`/mfa?next=${encodeURIComponent(safeDest)}`, origin),
          );
        }
      }

      return NextResponse.redirect(new URL(safeDest, origin));
    }
  }

  // 3. Verificar si el correo pertenece a la lista de bootstrap SUPER_ADMIN_BOOTSTRAP_EMAILS
  if (isBootstrapSuperAdminEmail(normalizedEmail)) {
    await claimBootstrapSuperAdminForUser({
      userId: user.id,
      email: normalizedEmail,
      fullNameFallback,
    });
    const safeDest = sanitizeRedirectPath(
      nextParam ?? '/admin/empresas',
      'SUPER_ADMIN',
    );
    const { data: aalData } =
      await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aalData?.nextLevel === 'aal2' && aalData.currentLevel !== 'aal2') {
      return NextResponse.redirect(
        new URL(`/mfa?next=${encodeURIComponent(safeDest)}`, origin),
      );
    }
    return NextResponse.redirect(new URL(safeDest, origin));
  }

  // 4. Verificar si ya cuenta con perfil activo en `perfiles_usuarios` (por ID o por correo dado de alta en Super-Admin)
  const { data: profileById } = await admin
    .from('perfiles_usuarios')
    .select('id, rol, tenant_id, activo, nombre_completo')
    .eq('id', user.id)
    .maybeSingle();

  let existingProfile = profileById;
  if (!existingProfile && normalizedEmail) {
    const { data: profileByEmail } = await admin
      .from('perfiles_usuarios')
      .select('id, rol, tenant_id, activo, nombre_completo')
      .ilike('email', normalizedEmail)
      .maybeSingle();
    if (profileByEmail && profileByEmail.rol !== 'SUPER_ADMIN') {
      existingProfile = profileByEmail;
    }
  }

  if (existingProfile) {
    const parsedRol = UserRoleSchema.safeParse(existingProfile.rol);
    if (
      !existingProfile.activo ||
      !parsedRol.success ||
      parsedRol.data === 'SUPER_ADMIN'
    ) {
      await supabase.auth.signOut();
      return NextResponse.redirect(
        new URL('/login?error=cuenta_inactiva', origin),
      );
    }

    await admin
      .from('perfiles_usuarios')
      .update({ ultimo_acceso_en: nowIso })
      .eq('id', existingProfile.id);

    await admin.auth.admin.updateUserById(user.id, {
      app_metadata: {
        rol: parsedRol.data,
        ...(existingProfile.tenant_id
          ? { tenant_id: existingProfile.tenant_id }
          : {}),
      },
    });

    const safeDest = sanitizeRedirectPath(nextParam, parsedRol.data);

    if (roleRequiresMfa(parsedRol.data)) {
      const { data: aalData } =
        await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aalData?.nextLevel === 'aal2' && aalData.currentLevel !== 'aal2') {
        return NextResponse.redirect(
          new URL(`/mfa?next=${encodeURIComponent(safeDest)}`, origin),
        );
      }
    }

    return NextResponse.redirect(new URL(safeDest, origin));
  }

  // 5. Intentar reclamar invitación PENDIENTE por correo electrónico
  const claimed = await claimPendingInvitationForUser({
    userId: user.id,
    email: normalizedEmail,
    fullNameFallback,
    authProvider: 'GOOGLE',
  });

  if (!claimed) {
    await supabase.auth.signOut();
    return NextResponse.redirect(
      new URL('/login?error=sin_invitacion', origin),
    );
  }

  const safeDest = sanitizeRedirectPath(nextParam, claimed.rol);
  if (roleRequiresMfa(claimed.rol)) {
    const { data: aalData } =
      await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aalData?.nextLevel === 'aal2' && aalData.currentLevel !== 'aal2') {
      return NextResponse.redirect(
        new URL(`/mfa?next=${encodeURIComponent(safeDest)}`, origin),
      );
    }
  }

  return NextResponse.redirect(new URL(safeDest, origin));
}
