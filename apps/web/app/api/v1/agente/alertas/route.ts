import { NextResponse } from 'next/server';
import {
  AgentReportErrorSchema,
  type AgentReportError,
} from '@sm-clock/contracts';
import { authenticateAgentRequest } from '@/lib/server/agent-auth';
import {
  getBootstrapSuperAdminEmails,
  requireTenantAdmin,
} from '@/lib/server/auth';
import {
  broadcastAdminEvent,
  broadcastTenantEvent,
} from '@/lib/server/realtime-broadcast';
import {
  buildAgentErrorReportEmailTemplate,
  sendTenantEmail,
} from '@/lib/server/smtp-mailer';
import { createSupabaseServiceClient } from '@/lib/server/supabase-admin';

// Caché en memoria para evitar saturar bandejas con errores repetitivos idénticos (< 120 segundos)
const lastAlertTimestamps = new Map<string, number>();

export async function POST(request: Request): Promise<NextResponse> {
  const rawBody = await request.text();
  let tenantId: string | null = null;
  let agenteId: string | null = null;
  let agenteNombre = 'SM-Clock Agente';

  // 1. Probar autenticación por firma HMAC de agente local
  const hasAgentHeaders = request.headers.has('x-agent-id');
  if (hasAgentHeaders) {
    const authResult = await authenticateAgentRequest(request, rawBody);
    if (!authResult.ok) {
      return NextResponse.json(
        { error: authResult.message },
        { status: authResult.status },
      );
    }
    tenantId = authResult.agent.tenantId;
    agenteId = authResult.agent.agenteId;
    agenteNombre = authResult.agent.nombreAgente;
  } else {
    // 2. Si no viene firmado por el agente, verificar sesión de administrador autenticado
    const userAuth = await requireTenantAdmin();
    if (!userAuth.ok) {
      return NextResponse.json(
        { error: 'No autorizado. Se requieren credenciales de agente o sesión de administrador' },
        { status: 401 },
      );
    }
    tenantId = userAuth.tenantId;
  }

  if (!tenantId) {
    return NextResponse.json(
      { error: 'No se pudo determinar el tenant_id para enviar la alerta' },
      { status: 400 },
    );
  }

  // 3. Parsear y validar el cuerpo del error con Zod
  let bodyJson: unknown;
  try {
    bodyJson = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Cuerpo JSON inválido' }, { status: 400 });
  }

  const parsed = AgentReportErrorSchema.safeParse(bodyJson);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Datos de error inválidos', details: parsed.error.issues },
      { status: 422 },
    );
  }

  const errorData: AgentReportError = parsed.data;
  const adminClient = createSupabaseServiceClient();

  // 4. Obtener nombre de la empresa/tenant
  const { data: tenantRow } = await adminClient
    .from('tenants')
    .select('nombre_comercial, razon_social')
    .eq('id', tenantId)
    .maybeSingle();

  const tenantNombre =
    tenantRow?.nombre_comercial || tenantRow?.razon_social || 'Empresa';

  // 5. Obtener destinatarios: Super-Admins y Admins del Tenant
  const recipientsSet = new Set<string>();

  // A) Bootstrap Super-Admin emails
  for (const bEmail of getBootstrapSuperAdminEmails()) {
    if (bEmail.includes('@')) {
      recipientsSet.add(bEmail.toLowerCase());
    }
  }

  // B) Perfiles Super-Admin activos en base de datos
  const { data: superAdmins } = await adminClient
    .from('perfiles_usuarios')
    .select('email')
    .eq('rol', 'SUPER_ADMIN')
    .eq('activo', true);

  if (superAdmins) {
    for (const sa of superAdmins) {
      if (sa.email) recipientsSet.add(sa.email.trim().toLowerCase());
    }
  }

  // C) Perfiles Admin de Empresa del tenant específico
  const { data: tenantAdmins } = await adminClient
    .from('perfiles_usuarios')
    .select('email')
    .eq('tenant_id', tenantId)
    .eq('rol', 'ADMIN_EMPRESA')
    .eq('activo', true);

  if (tenantAdmins) {
    for (const ta of tenantAdmins) {
      if (ta.email) recipientsSet.add(ta.email.trim().toLowerCase());
    }
  }

  const recipients = Array.from(recipientsSet);
  const nowIso = new Date().toISOString();

  // 6. Evitar bombardeo por reloj que falla repetitivamente en bucle corto (< 120s)
  const throttleKey = `${tenantId}:${errorData.tipo_error}:${errorData.fuente_id ?? ''}`;
  const nowMs = Date.now();
  const lastSent = lastAlertTimestamps.get(throttleKey) ?? 0;
  const shouldSendEmail = nowMs - lastSent > 120_000;

  if (shouldSendEmail && recipients.length > 0) {
    lastAlertTimestamps.set(throttleKey, nowMs);

    const formatter = new Intl.DateTimeFormat('es-MX', {
      timeZone: 'America/Tijuana',
      dateStyle: 'medium',
      timeStyle: 'medium',
    });
    const timestampFormatted = formatter.format(new Date());

    const { subject, html, text } = buildAgentErrorReportEmailTemplate({
      agenteNombre,
      tenantNombre,
      tipoError: errorData.tipo_error,
      mensaje: errorData.mensaje,
      detalle: errorData.detalle ?? null,
      dispositivo: errorData.dispositivo ?? null,
      timestampFormatted,
    });

    // Enviar correo a todos los administradores involucrados usando la configuración SMTP del tenant
    await Promise.all(
      recipients.map((to) =>
        sendTenantEmail({
          tenantId,
          to,
          subject,
          html,
          text,
        }),
      ),
    );
  }

  // 7. Notificar en tiempo real a los dashboards conectados
  await Promise.all([
    broadcastTenantEvent(tenantId, 'agentes_changed', {
      tipo: 'ALERTA_ERROR_AGENTE',
      agente_id: agenteId,
      error: errorData,
    }),
    broadcastAdminEvent('agentes_changed', {
      tipo: 'ALERTA_ERROR_AGENTE',
      tenant_id: tenantId,
      agente_id: agenteId,
      error: errorData,
    }),
  ]);

  // 8. Registrar en bitácora de auditoría
  try {
    await adminClient.from('auditoria').insert({
      tenant_id: tenantId,
      actor_id: agenteId ?? null,
      accion: 'AGENTE_ERROR_REPORTADO',
      detalle: {
        agente_id: agenteId,
        agente_nombre: agenteNombre,
        tipo_error: errorData.tipo_error,
        mensaje: errorData.mensaje,
        dispositivo: errorData.dispositivo,
        recipientes_notificados: shouldSendEmail ? recipients : [],
        correo_enviado: shouldSendEmail,
      },
    });
  } catch {
    // La auditoría no debe bloquear la respuesta
  }

  return NextResponse.json({
    ok: true,
    notificados: shouldSendEmail ? recipients.length : 0,
    recipientes: shouldSendEmail ? recipients : [],
    servidor_ts_utc: nowIso,
    mensaje: shouldSendEmail
      ? `Alerta enviada por correo a ${recipients.length} administradores`
      : 'Alerta registrada (envío de correo en periodo de enfriamiento)',
  });
}
