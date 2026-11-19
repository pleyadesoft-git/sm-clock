import { NextResponse, type NextRequest } from 'next/server';
import {
  containsCodeInjectionPattern,
  sanitizeTextInput,
  UpdateOwnProfileRequestSchema,
} from '@sm-clock/contracts';
import {
  recordAuditLog,
  requireAuthenticatedUser,
  resolveTenantIdForUser,
} from '@/lib/server/auth';
import { createSupabaseServiceClient } from '@/lib/server/supabase-admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';

function sanitizeAvatarUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || containsCodeInjectionPattern(trimmed)) return null;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export async function GET(): Promise<NextResponse> {
  const auth = await requireAuthenticatedUser({ allowPendingMfa: true });
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user: sessionUser },
  } = await supabase.auth.getUser();

  const admin = createSupabaseServiceClient();
  const { data: perfil } = await admin
    .from('perfiles_usuarios')
    .select('nombre_completo, email, rol, auth_provider, ultimo_acceso_en')
    .eq('id', auth.user.userId)
    .maybeSingle();

  const rawMeta = sessionUser?.user_metadata ?? {};
  const avatarCandidate =
    sanitizeAvatarUrl(rawMeta['avatar_url']) ??
    sanitizeAvatarUrl(rawMeta['picture']);

  const fullNameMeta =
    typeof rawMeta['full_name'] === 'string' &&
    rawMeta['full_name'].trim().length > 0
      ? sanitizeTextInput(rawMeta['full_name'])
      : typeof rawMeta['name'] === 'string' && rawMeta['name'].trim().length > 0
        ? sanitizeTextInput(rawMeta['name'])
        : null;

  const nombreCompleto =
    sanitizeTextInput(
      perfil?.nombre_completo ||
        fullNameMeta ||
        auth.user.email.split('@')[0] ||
        'Usuario',
    ) || 'Usuario';

  const authProvider =
    perfil?.auth_provider === 'GOOGLE' ||
    perfil?.auth_provider === 'EMAIL' ||
    perfil?.auth_provider === 'BOTH'
      ? perfil.auth_provider
      : sessionUser?.app_metadata?.['provider'] === 'google'
        ? 'GOOGLE'
        : 'EMAIL';

  const resolvedTenantId = await resolveTenantIdForUser(auth.user);
  let tenantNombre: string | null = null;
  let tenantLogoUrl: string | null = null;

  if (resolvedTenantId) {
    const { data: tenant } = await admin
      .from('tenants')
      .select('nombre_comercial, razon_social, logo_url')
      .eq('id', resolvedTenantId)
      .maybeSingle();

    tenantNombre = tenant?.nombre_comercial || tenant?.razon_social || null;
    tenantLogoUrl = tenant?.logo_url || null;
  }

  return NextResponse.json({
    data: {
      userId: auth.user.userId,
      email: perfil?.email ?? auth.user.email,
      nombreCompleto,
      rol: auth.user.rol,
      tenantId: auth.user.tenantId,
      tenantNombre,
      tenantLogoUrl,
      authProvider,
      avatarUrl: avatarCandidate,
      aal: auth.user.aal,
    },
  });
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: 'Cuerpo JSON inválido' }, { status: 400 });
  }

  const parsed = UpdateOwnProfileRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Datos de perfil inválidos',
        details: parsed.error.flatten().fieldErrors,
      },
      { status: 400 },
    );
  }

  const normalizedEmail = parsed.data.email.toLowerCase();
  const nombreCompleto = parsed.data.nombre_completo;
  const currentPassword = parsed.data.current_password;
  const newPassword = parsed.data.password;

  const admin = createSupabaseServiceClient();

  const { data: currentPerfil } = await admin
    .from('perfiles_usuarios')
    .select('id, email, auth_provider')
    .eq('id', auth.user.userId)
    .maybeSingle();

  const prevProvider = currentPerfil?.auth_provider ?? 'EMAIL';
  const isGoogleOnly = prevProvider === 'GOOGLE';

  if (newPassword && !isGoogleOnly) {
    if (!currentPassword) {
      return NextResponse.json(
        {
          error:
            'Debes ingresar tu contraseña actual para poder cambiar tu contraseña.',
        },
        { status: 400 },
      );
    }

    const verifier = createSupabaseServiceClient();
    const { data: verifyData, error: verifyError } =
      await verifier.auth.signInWithPassword({
        email: auth.user.email,
        password: currentPassword,
      });

    if (verifyError || !verifyData.user) {
      return NextResponse.json(
        { error: 'La contraseña actual es incorrecta.' },
        { status: 400 },
      );
    }
  }

  if (normalizedEmail !== auth.user.email.toLowerCase()) {
    const { data: conflict } = await admin
      .from('perfiles_usuarios')
      .select('id')
      .ilike('email', normalizedEmail)
      .neq('id', auth.user.userId)
      .maybeSingle();

    if (conflict) {
      return NextResponse.json(
        {
          error:
            'El correo electrónico ingresado ya está en uso por otro usuario en la plataforma.',
        },
        { status: 409 },
      );
    }
  }

  const { data: authUserLookup } = await admin.auth.admin.getUserById(
    auth.user.userId,
  );

  if (authUserLookup?.user) {
    const existingUserMeta = authUserLookup.user.user_metadata ?? {};
    const { error: updateAuthError } = await admin.auth.admin.updateUserById(
      auth.user.userId,
      {
        email: normalizedEmail,
        email_confirm: true,
        user_metadata: {
          ...existingUserMeta,
          full_name: nombreCompleto,
        },
        ...(newPassword ? { password: newPassword } : {}),
      },
    );

    if (updateAuthError) {
      return NextResponse.json(
        {
          error:
            'No fue posible actualizar tus credenciales de autenticación. Verifica que el correo sea válido.',
        },
        { status: 500 },
      );
    }
  }

  const nextProvider = newPassword
    ? prevProvider === 'GOOGLE'
      ? 'BOTH'
      : prevProvider
    : prevProvider;

  if (currentPerfil) {
    const { error: updatePerfilError } = await admin
      .from('perfiles_usuarios')
      .update({
        nombre_completo: nombreCompleto,
        email: normalizedEmail,
        auth_provider: nextProvider,
      })
      .eq('id', auth.user.userId);

    if (updatePerfilError) {
      return NextResponse.json(
        { error: 'Error al guardar los cambios en tu perfil de usuario.' },
        { status: 500 },
      );
    }
  }

  await recordAuditLog({
    tenantId: auth.user.tenantId,
    actorId: auth.user.userId,
    accion: 'PERFIL_PROPIO_ACTUALIZADO',
    detalle: {
      nombre_completo: nombreCompleto,
      email: normalizedEmail,
      password_actualizado: Boolean(newPassword),
      auth_provider: nextProvider,
    },
  });

  return NextResponse.json({
    data: {
      userId: auth.user.userId,
      email: normalizedEmail,
      nombreCompleto,
      rol: auth.user.rol,
      tenantId: auth.user.tenantId,
      authProvider: nextProvider,
      passwordUpdated: Boolean(newPassword),
    },
  });
}
