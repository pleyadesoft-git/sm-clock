import { NextResponse } from 'next/server';
import { ResetPasswordRequestSchema } from '@sm-clock/contracts';
import { checkRateLimit } from '@/lib/server/agent-auth';
import { recordAuditLog } from '@/lib/server/auth';
import { createSupabaseServiceClient } from '@/lib/server/supabase-admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function POST(request: Request): Promise<NextResponse> {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  if (!checkRateLimit(`reset-pwd:${ip}`, 10)) {
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

  const parsed = ResetPasswordRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          parsed.error.issues[0]?.message ?? 'Datos de contraseña inválidos',
      },
      { status: 422 },
    );
  }

  const supabase = await createSupabaseServerClient();
  let userId: string;

  if (parsed.data.tokenHash) {
    const { data: otpData, error: otpError } = await supabase.auth.verifyOtp({
      token_hash: parsed.data.tokenHash,
      type: 'recovery',
    });

    if (otpError || !otpData.user) {
      return NextResponse.json(
        {
          error:
            'El enlace de recuperación es inválido o ha expirado. Solicita uno nuevo.',
        },
        { status: 400 },
      );
    }
    userId = otpData.user.id;
  } else {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        {
          error:
            'Sesión de recuperación no encontrada o expirada. Solicita un nuevo enlace.',
        },
        { status: 401 },
      );
    }
    userId = user.id;
  }

  const admin = createSupabaseServiceClient();
  const { error: updateError } = await admin.auth.admin.updateUserById(userId, {
    password: parsed.data.password,
  });

  if (updateError) {
    return NextResponse.json(
      { error: 'No fue posible actualizar la contraseña. Intenta nuevamente.' },
      { status: 500 },
    );
  }

  const { data: perfil } = await admin
    .from('perfiles_usuarios')
    .select('tenant_id')
    .eq('id', userId)
    .maybeSingle();

  await recordAuditLog({
    tenantId: perfil?.tenant_id ?? null,
    actorId: userId,
    accion: 'RESTABLECER_CONTRASENA',
    detalle: { metodo: 'recovery_link' },
  });

  return NextResponse.json({
    message: 'Contraseña actualizada correctamente. Ya puedes iniciar sesión.',
  });
}
