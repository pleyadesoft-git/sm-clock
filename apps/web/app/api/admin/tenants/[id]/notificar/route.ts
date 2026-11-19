import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { AdminTenantEmailSchema } from '@sm-clock/contracts';
import { AuthError, recordAuditLog, requireRoles } from '@/lib/server/auth';
import {
  buildAdminTenantNotificationEmail,
  sendTenantEmail,
} from '@/lib/server/smtp-mailer';
import { createSupabaseAdminClient } from '@/lib/server/supabase-admin';

const IdParamSchema = z.object({
  id: z.string().uuid('ID de empresa inválido'),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRoles(['SUPER_ADMIN']);

    const rawParams = await context.params;
    const parsedParams = IdParamSchema.safeParse(rawParams);
    if (!parsedParams.success) {
      return NextResponse.json(
        { error: 'ID de empresa inválido' },
        { status: 400 },
      );
    }

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Cuerpo JSON inválido' },
        { status: 400 },
      );
    }

    const parsedBody = AdminTenantEmailSchema.safeParse(rawBody);
    if (!parsedBody.success) {
      return NextResponse.json(
        {
          error:
            parsedBody.error.issues[0]?.message ??
            'Datos del correo inválidos',
          details: parsedBody.error.flatten(),
        },
        { status: 400 },
      );
    }

    const tenantId = parsedParams.data.id;
    const supabase = createSupabaseAdminClient();

    const [{ data: tenant, error: tenantError }, { data: admins }, { data: actorProfile }] =
      await Promise.all([
        supabase
          .from('tenants')
          .select(
            'id, tenant_code, nombre_comercial, contacto_email, correo_facturacion',
          )
          .eq('id', tenantId)
          .is('deleted_at', null)
          .maybeSingle(),
        supabase
          .from('perfiles_usuarios')
          .select('email, nombre_completo')
          .eq('tenant_id', tenantId)
          .eq('rol', 'ADMIN_EMPRESA')
          .is('deleted_at', null),
        supabase
          .from('perfiles_usuarios')
          .select('nombre_completo')
          .eq('id', ctx.userId)
          .maybeSingle(),
      ]);

    if (tenantError) {
      return NextResponse.json(
        { error: 'Error al consultar la empresa' },
        { status: 500 },
      );
    }

    if (!tenant) {
      return NextResponse.json(
        { error: 'Empresa no encontrada' },
        { status: 404 },
      );
    }

    // Validar que el correo destino pertenezca a un contacto registrado de este tenant
    const allowedEmails = new Set<string>();
    if (tenant.contacto_email) {
      allowedEmails.add(tenant.contacto_email.trim().toLowerCase());
    }
    if (tenant.correo_facturacion) {
      allowedEmails.add(tenant.correo_facturacion.trim().toLowerCase());
    }
    for (const adm of admins ?? []) {
      if (adm.email) {
        allowedEmails.add(adm.email.trim().toLowerCase());
      }
    }

    const targetEmail = parsedBody.data.destinatario_email.trim().toLowerCase();
    if (!allowedEmails.has(targetEmail)) {
      return NextResponse.json(
        {
          error:
            'El correo destinatario debe corresponder a un administrador o contacto registrado de esta empresa.',
        },
        { status: 400 },
      );
    }

    const { subject, html, text } = buildAdminTenantNotificationEmail({
      tenantNombre: tenant.nombre_comercial,
      tenantCode: tenant.tenant_code,
      destinatarioNombre: parsedBody.data.destinatario_nombre,
      asunto: parsedBody.data.asunto,
      mensaje: parsedBody.data.mensaje,
      remitenteNombre: actorProfile?.nombre_completo ?? 'Soporte SM Clock',
    });

    // Usa SMTP gestionado de la plataforma (tenantId: null) para notificaciones del Super-Admin
    const sendResult = await sendTenantEmail({
      tenantId: null,
      to: targetEmail,
      subject,
      html,
      text,
    });

    await recordAuditLog({
      tenantId: tenant.id,
      actorId: ctx.userId,
      accion: 'TENANT_ADMIN_EMAIL_SENT',
      detalle: {
        destinatario_email: targetEmail,
        asunto: parsedBody.data.asunto,
        delivered: sendResult.delivered,
        simulated: sendResult.simulated,
        provider: sendResult.provider,
      },
      ip: request.headers.get('x-forwarded-for'),
    });

    if (!sendResult.delivered) {
      return NextResponse.json(
        {
          error:
            sendResult.error ??
            'No se pudo entregar el correo electrónico. Verifica la configuración SMTP de la plataforma.',
          delivered: false,
          simulated: sendResult.simulated,
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      delivered: true,
      simulated: sendResult.simulated,
      provider: sendResult.provider,
      destinatario_email: targetEmail,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json(
        { error: err.message },
        { status: err.statusCode },
      );
    }
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 },
    );
  }
}
