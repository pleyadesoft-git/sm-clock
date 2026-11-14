import { NextResponse, type NextRequest } from 'next/server';
import { SmtpTestSendSchema } from '@sm-clock/contracts';
import { recordAuditLog, requireTenantAdmin } from '@/lib/server/auth';
import { sendSmtpTestEmail } from '@/lib/server/smtp-mailer';

export async function POST(request: NextRequest) {
  const auth = await requireTenantAdmin();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Cuerpo JSON inválido' }, { status: 400 });
  }

  const parsed = SmtpTestSendSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          parsed.error.issues[0]?.message ??
          'Revisa los datos para la prueba de envío SMTP',
        details: parsed.error.flatten(),
      },
      { status: 422 },
    );
  }

  const d = parsed.data;
  if (d.usar_smtp_propio) {
    if (!d.usuario || d.usuario.trim().length === 0) {
      return NextResponse.json(
        { error: 'El usuario SMTP es obligatorio para probar SMTP propio' },
        { status: 422 },
      );
    }
    if (!d.remitente_email || d.remitente_email.trim().length === 0) {
      return NextResponse.json(
        { error: 'El correo remitente es obligatorio para probar SMTP propio' },
        { status: 422 },
      );
    }
  }

  const { tenantId, user } = auth;
  const sendResult = await sendSmtpTestEmail({
    tenantId,
    to: d.destinatario_prueba,
    overrideConfig: {
      usar_smtp_propio: d.usar_smtp_propio,
      host: d.host,
      puerto: d.puerto,
      seguridad: d.seguridad,
      usuario: d.usuario ?? null,
      password: d.password,
      remitente_email: d.remitente_email || null,
      remitente_nombre: d.remitente_nombre,
    },
  });

  await recordAuditLog({
    tenantId,
    actorId: user.userId,
    accion: 'SMTP_TEST_SEND',
    detalle: {
      destinatario_prueba: d.destinatario_prueba,
      provider: sendResult.provider,
      host: d.host,
      puerto: d.puerto,
      seguridad: d.seguridad,
      delivered: sendResult.delivered,
      simulated: sendResult.simulated,
    },
    ip: request.headers.get('x-forwarded-for'),
  });

  if (!sendResult.delivered) {
    return NextResponse.json(
      {
        error:
          sendResult.error ??
          'No se pudo enviar el correo de prueba con los datos SMTP proporcionados',
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    delivered: sendResult.delivered,
    simulated: sendResult.simulated,
    provider: sendResult.provider,
    message: sendResult.simulated
      ? `Prueba validada en modo desarrollo hacia ${d.destinatario_prueba} (${sendResult.provider}).`
      : `Correo de prueba enviado exitosamente a ${d.destinatario_prueba}.`,
  });
}
