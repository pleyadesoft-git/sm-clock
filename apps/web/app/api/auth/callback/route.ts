import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { roleRequiresMfa, UserRoleSchema } from '@sm-clock/contracts';
import {
  claimBootstrapSuperAdminForUser,
  claimPendingInvitationForUser,
  recordAuditLog,
} from '@/lib/server/auth';
import { createSupabaseServiceClient } from '@/lib/server/supabase-admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const inviteToken = (url.searchParams.get('invite_token') ?? '').trim();

  if (!code) {
    return NextResponse.redirect(
      new URL('/login?error=oauth_invalido', url.origin),
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data: sessionData, error: exchangeError } =
    await supabase.auth.exchangeCodeForSession(code);

  if (exchangeError || !sessionData.user) {
    return NextResponse.redirect(
      new URL('/login?error=oauth_invalido', url.origin),
    );
  }

  const user = sessionData.user;
  const normalizedEmail = (user.email ?? '').trim().toLowerCase();
  const admin = createSupabaseServiceClient();
  const nowIso = new Date().toISOString();

  // 1. Si viene desde un enlace de invitación (/invitacion/[token]), validar el token específico
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
        typeof user.user_metadata?.['full_name'] === 'string' &&
        user.user_metadata['full_name'].trim().length > 0
          ? user.user_metadata['full_name'].trim()
          : invite.nombre_completo;

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

      return NextResponse.redirect(new URL('/dashboard', url.origin));
    }
  }

  // 2. Verificar si ya cuenta con perfil activo en `perfiles_usuarios`
  const { data: existingProfile } = await admin
    .from('perfiles_usuarios')
    .select('id, rol, tenant_id, activo')
    .eq('id', user.id)
    .maybeSingle();

  if (existingProfile) {
    const parsedRol = UserRoleSchema.safeParse(existingProfile.rol);
    if (!existingProfile.activo || !parsedRol.success) {
      await supabase.auth.signOut();
      return NextResponse.redirect(
        new URL('/login?error=cuenta_inactiva', url.origin),
      );
    }

    await admin
      .from('perfiles_usuarios')
      .update({ ultimo_acceso_en: nowIso })
      .eq('id', user.id);

    if (roleRequiresMfa(parsedRol.data)) {
      const { data: aalData } =
        await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aalData?.nextLevel === 'aal2' && aalData.currentLevel !== 'aal2') {
        return NextResponse.redirect(new URL('/mfa', url.origin));
      }
    }

    const dest =
      parsedRol.data === 'SUPER_ADMIN' ? '/admin/empresas' : '/dashboard';
    return NextResponse.redirect(new URL(dest, url.origin));
  }

  const fullNameFallback =
    typeof user.user_metadata?.['full_name'] === 'string'
      ? user.user_metadata['full_name']
      : null;

  // 3. Verificar si el correo pertenece a la lista de bootstrap SUPER_ADMIN_BOOTSTRAP_EMAILS
  const bootstrappedSuperAdmin = await claimBootstrapSuperAdminForUser({
    userId: user.id,
    email: normalizedEmail,
    fullNameFallback,
  });

  if (bootstrappedSuperAdmin) {
    const { data: aalData } =
      await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aalData?.nextLevel === 'aal2' && aalData.currentLevel !== 'aal2') {
      return NextResponse.redirect(new URL('/mfa', url.origin));
    }
    return NextResponse.redirect(new URL('/admin/empresas', url.origin));
  }

  // 4. Intentar reclamar invitación PENDIENTE por correo electrónico
  const claimed = await claimPendingInvitationForUser({
    userId: user.id,
    email: normalizedEmail,
    fullNameFallback,
    authProvider: 'GOOGLE',
  });

  if (!claimed) {
    // Regla estricta: sin invitación al tenant no puede ingresar a la aplicación
    await supabase.auth.signOut();
    return NextResponse.redirect(
      new URL('/login?error=sin_invitacion', url.origin),
    );
  }

  return NextResponse.redirect(new URL('/dashboard', url.origin));
}
