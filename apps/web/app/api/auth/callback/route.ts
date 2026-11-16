import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  roleRequiresMfa,
  sanitizeRedirectPath,
  sanitizeTextInput,
  UserRoleSchema,
  type UserRole,
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

function sanitizeDesktopTarget(rawTarget: string | null | undefined): string {
  if (!rawTarget || typeof rawTarget !== 'string') return 'http://localhost:5173';
  const trimmed = rawTarget.trim();

  // Protocolo nativo de la aplicación de escritorio sm-clock://
  if (trimmed.startsWith('sm-clock://')) {
    return /^sm-clock:\/\/[a-zA-Z0-9_\-./]*$/.test(trimmed)
      ? trimmed
      : 'sm-clock://auth/callback';
  }

  // URLs locales de desarrollo (localhost o 127.0.0.1)
  try {
    const parsed = new URL(trimmed);
    if (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
    ) {
      return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
    }
  } catch {
    return 'http://localhost:5173';
  }

  return 'http://localhost:5173';
}

function buildDesktopResponse(
  rawTarget: string,
  session: { access_token: string; refresh_token: string; expires_in?: number; token_type?: string },
): NextResponse {
  const target = sanitizeDesktopTarget(rawTarget);
  const hash = `access_token=${encodeURIComponent(session.access_token)}&refresh_token=${encodeURIComponent(session.refresh_token)}&token_type=${encodeURIComponent(session.token_type ?? 'bearer')}&expires_in=${session.expires_in ?? 3600}`;

  if (target.startsWith('http://') || target.startsWith('https://')) {
    const destUrl = new URL(target);
    destUrl.searchParams.set('access_token', session.access_token);
    destUrl.searchParams.set('refresh_token', session.refresh_token);
    destUrl.hash = hash;
    return NextResponse.redirect(destUrl);
  }

  // Esquema personalizado sm-clock:// para Electron empaquetado
  const deepLink = `${target}#${hash}`;
  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SM Clock — Sesión Iniciada</title>
  <style>
    :root {
      --bg: #000000;
      --card: #1c1c1e;
      --border: #2c2c2e;
      --text: #ffffff;
      --subtext: #8e8e93;
      --primary: #0a84ff;
    }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 1.5rem;
      box-sizing: border-box;
    }
    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 1.25rem;
      padding: 2.5rem 2rem;
      max-width: 420px;
      width: 100%;
      text-align: center;
      box-shadow: 0 10px 30px rgba(0,0,0,0.5);
    }
    .icon {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: rgba(10, 132, 255, 0.15);
      color: var(--primary);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 1.25rem;
    }
    h1 {
      font-size: 1.35rem;
      font-weight: 600;
      margin: 0 0 0.5rem 0;
    }
    p {
      color: var(--subtext);
      font-size: 0.95rem;
      line-height: 1.5;
      margin: 0 0 1.75rem 0;
    }
    .btn {
      display: inline-block;
      width: 100%;
      box-sizing: border-box;
      background: var(--primary);
      color: #ffffff;
      padding: 0.85rem 1rem;
      border-radius: 0.75rem;
      text-decoration: none;
      font-weight: 600;
      font-size: 0.95rem;
      transition: opacity 0.15s ease;
    }
    .btn:hover {
      opacity: 0.9;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M20 6 9 17l-5-5"/>
      </svg>
    </div>
    <h1>¡Autenticación Exitosa!</h1>
    <p>Hemos verificado tu cuenta con Google. Regresando a la aplicación de escritorio SM Clock...</p>
    <a href="${deepLink}" class="btn">Abrir SM Clock en el escritorio</a>
  </div>
  <script>
    window.location.href = ${JSON.stringify(deepLink)};
  </script>
</body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const origin = getRequestOrigin(request);
  const code = url.searchParams.get('code');
  const inviteToken = (url.searchParams.get('invite_token') ?? '').trim();
  const modeParam = (url.searchParams.get('mode') ?? '').trim();
  const nextParam = url.searchParams.get('next');
  const sourceParam = (url.searchParams.get('source') ?? '').trim();
  const targetParam = (url.searchParams.get('target') ?? '').trim();

  const isDesktop = sourceParam === 'desktop';

  const handleErrorRedirect = (errorCode: string): NextResponse => {
    if (isDesktop) {
      const target = sanitizeDesktopTarget(targetParam);
      if (target.startsWith('http://') || target.startsWith('https://')) {
        const dest = new URL(target);
        dest.searchParams.set('error', errorCode);
        return NextResponse.redirect(dest);
      }
      return NextResponse.redirect(new URL(`${target}?error=${errorCode}`));
    }
    return NextResponse.redirect(
      new URL(
        modeParam === 'super_admin'
          ? `/login?mode=super_admin&error=${errorCode}`
          : `/login?error=${errorCode}`,
        origin,
      ),
    );
  };

  if (!code) {
    return handleErrorRedirect('oauth_invalido');
  }

  const supabase = await createSupabaseServerClient();
  const { data: sessionData, error: exchangeError } =
    await supabase.auth.exchangeCodeForSession(code);

  if (exchangeError || !sessionData.user) {
    return handleErrorRedirect('oauth_invalido');
  }

  const handleSuccessRedirect = (
    defaultPath: string,
    role?: UserRole | null,
  ): NextResponse => {
    if (isDesktop && sessionData.session) {
      return buildDesktopResponse(targetParam, sessionData.session);
    }
    const safeDest = sanitizeRedirectPath(nextParam ?? defaultPath, role);
    return NextResponse.redirect(new URL(safeDest, origin));
  };

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
      return handleErrorRedirect('super_admin_no_autorizado');
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

    return handleSuccessRedirect('/admin/empresas', 'SUPER_ADMIN');
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

      return handleSuccessRedirect(
        safeDest,
        invitedRole.success ? invitedRole.data : null,
      );
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
    return handleSuccessRedirect('/admin/empresas', 'SUPER_ADMIN');
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
      return handleErrorRedirect('cuenta_inactiva');
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

    return handleSuccessRedirect(safeDest, parsedRol.data);
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
    return handleErrorRedirect('sin_invitacion');
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

  return handleSuccessRedirect(safeDest, claimed.rol);
}
