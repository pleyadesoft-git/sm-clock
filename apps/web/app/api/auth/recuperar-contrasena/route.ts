import { NextResponse } from 'next/server';
import { ForgotPasswordRequestSchema } from '@sm-clock/contracts';
import { checkRateLimit } from '@/lib/server/agent-auth';
import { recordAuditLog } from '@/lib/server/auth';
import {
  buildPasswordRecoveryEmailTemplate,
  sendTenantEmail,
} from '@/lib/server/smtp-mailer';
import { createSupabaseServiceClient } from '@/lib/server/supabase-admin';

export async function POST(request: Request): Promise<NextResponse> {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  if (!checkRateLimit(`forgot-pwd:${ip}`, 10)) {
    return NextResponse.json(
      { error: 'Demasiadas solicitudes. Intenta nuevamente en un minuto.' },
      { status: 429 },
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: 'Cuerpo JSON inválido' }, { status: 400 });
  }

  const parsed = ForgotPasswordRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          parsed.error.issues[0]?.message ?? 'Correo electrónico inválido',
      },
      { status: 422 },
    );
  }

  const normalizedEmail = parsed.data.email.trim().toLowerCase();
  const admin = createSupabaseServiceClient();

  const { data: perfil } = await admin
    .from('perfiles_usuarios')
    .select('id, tenant_id, nombre_completo, email, activo')
    .ilike('email', normalizedEmail)
    .maybeSingle();

  const genericMessage =
    'Si el correo corresponde a una cuenta activa con invitación en la plataforma, recibirás un enlace para restablecer tu contraseña.';

  if (!perfil || !perfil.activo) {
    return NextResponse.json({ message: genericMessage });
  }

  const origin = new URL(request.url).origin;
  const { data: linkData, error: linkError } =
    await admin.auth.admin.generateLink({
      type: 'recovery',
      email: normalizedEmail,
      options: {
        redirectTo: `${origin}/restablecer-contrasena`,
      },
    });

  if (linkError || !linkData?.properties) {
    return NextResponse.json({ message: genericMessage });
  }

  const hashedToken = linkData.properties.hashed_token;
  const resetUrl = hashedToken
    ? `${origin}/restablecer-contrasena?token_hash=${encodeURIComponent(hashedToken)}&type=recovery`
    : linkData.properties.action_link;

  const template = buildPasswordRecoveryEmailTemplate({
    nombreCompleto: perfil.nombre_completo,
    resetUrl,
  });

  const emailResult = await sendTenantEmail({
    tenantId: perfil.tenant_id,
    to: normalizedEmail,
    subject: template.subject,
    html: template.html,
    text: template.text,
  });

  await recordAuditLog({
    tenantId: perfil.tenant_id,
    actorId: perfil.id,
    accion: 'SOLICITAR_RECUPERACION_CONTRASENA',
    detalle: {
      email: normalizedEmail,
      smtp_provider: emailResult.provider,
      delivered: emailResult.delivered,
    },
  });

  return NextResponse.json({
    message: genericMessage,
    ...(process.env['NODE_ENV'] !== 'production' ? { resetUrl } : {}),
  });
}
