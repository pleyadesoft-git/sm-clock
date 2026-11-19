import 'server-only';
import {
  buildPersonalizedVoiceText,
  buildWhatsAppWebUrl,
  type AgentTriggeredNotificationItem,
  type MensajeCanalUtilizado,
  type MensajeEstatusEntrega,
} from '@sm-clock/contracts';
import { broadcastTenantEvent } from '@/lib/server/realtime-broadcast';
import {
  buildEmployeePunchNotificationEmailTemplate,
  sendTenantEmail,
} from '@/lib/server/smtp-mailer';
import { createSupabaseAdminClient } from '@/lib/server/supabase-admin';

export interface PunchEventForNotification {
  checada_id?: number | null;
  fuente_id: string;
  codigo_empleado: string;
  ts_utc: string;
  ts_dispositivo_local: string;
  tipo_marca: 'ENTRADA' | 'SALIDA' | 'CHECADA';
}

/**
 * Evalúa y dispara los avisos activos de RH/Administración para un lote de checadas.
 * - Si el dispositivo lo permite (`soporta_mensajes_pantalla = true` y modo != `SIEMPRE_CORREO`),
 *   entrega el mensaje para visualización en pantalla y audio dinámico personalizado (TTS).
 * - Si el dispositivo NO lo permite (o se configuró `SIEMPRE_CORREO`), envía automáticamente
 *   un correo vía el servidor SMTP del tenant, o genera el enlace de WhatsApp Web,
 *   o marca `SIN_CANAL_DISPONIBLE` para alerta en el panel de RH.
 */
export async function processPunchNotificationsForBatch(params: {
  tenantId: string;
  punches: PunchEventForNotification[];
}): Promise<AgentTriggeredNotificationItem[]> {
  if (params.punches.length === 0) {
    return [];
  }

  const admin = createSupabaseAdminClient();
  const nowIso = new Date().toISOString();

  // 1. Consultar avisos activos del tenant
  const { data: activeMessages, error: msgErr } = await admin
    .from('mensajes_checadas')
    .select('*')
    .eq('tenant_id', params.tenantId)
    .eq('activo', true);

  if (msgErr || !activeMessages || activeMessages.length === 0) {
    return [];
  }

  // Filtrar por vigencia si tiene `vigente_hasta`
  const validMessages = activeMessages.filter(
    (m) => !m.vigente_hasta || m.vigente_hasta >= nowIso,
  );
  if (validMessages.length === 0) {
    return [];
  }

  // 2. Consultar datos del tenant, empleados involucrados y fuentes de asistencia
  const uniqueCodes = Array.from(
    new Set(params.punches.map((p) => p.codigo_empleado)),
  );
  const uniqueFuentes = Array.from(
    new Set(params.punches.map((p) => p.fuente_id)),
  );

  const [{ data: tenantRow }, { data: empleadosRows }, { data: fuentesRows }] =
    await Promise.all([
      admin
        .from('tenants')
        .select('id, nombre_comercial, razon_social')
        .eq('id', params.tenantId)
        .maybeSingle(),
      admin
        .from('empleados')
        .select(
          'id, codigo_empleado, nombre_completo, email, telefono_whatsapp, departamento, sucursal_id, estatus_empleado',
        )
        .eq('tenant_id', params.tenantId)
        .in('codigo_empleado', uniqueCodes),
      admin
        .from('fuentes_asistencia')
        .select('id, nombre_ubicacion, marca, soporta_mensajes_pantalla')
        .eq('tenant_id', params.tenantId)
        .in('id', uniqueFuentes),
    ]);

  if (!empleadosRows || empleadosRows.length === 0) {
    return [];
  }

  const tenantNombre =
    tenantRow?.nombre_comercial ?? tenantRow?.razon_social ?? 'SM Clock';

  const empleadoByCode = new Map(
    empleadosRows.map((e) => [e.codigo_empleado, e]),
  );
  const fuenteById = new Map((fuentesRows ?? []).map((f) => [f.id, f]));

  // 3. Consultar entregas previas para respetar `repeticion = 'UNA_VEZ'`
  const empleadoIds = empleadosRows.map((e) => e.id);
  const mensajeIds = validMessages.map((m) => m.id);

  const { data: prevDeliveries } = await admin
    .from('mensajes_checadas_entregas')
    .select('mensaje_id, empleado_id, estatus_entrega')
    .eq('tenant_id', params.tenantId)
    .in('mensaje_id', mensajeIds)
    .in('empleado_id', empleadoIds);

  const deliveredPairs = new Set<string>();
  for (const d of prevDeliveries ?? []) {
    if (
      d.estatus_entrega === 'ENTREGADO_DISPOSITIVO' ||
      d.estatus_entrega === 'ENTREGADO_EMAIL' ||
      d.estatus_entrega === 'PENDIENTE_WHATSAPP_WEB'
    ) {
      deliveredPairs.add(`${d.mensaje_id}::${d.empleado_id}`);
    }
  }

  const triggeredNotifications: AgentTriggeredNotificationItem[] = [];
  const singleEmployeeMessagesToDeactivate = new Set<string>();

  for (const punch of params.punches) {
    const empleado = empleadoByCode.get(punch.codigo_empleado);
    if (!empleado || empleado.estatus_empleado !== 'A') {
      continue;
    }

    const fuente = fuenteById.get(punch.fuente_id);
    const deviceSupportsMessages =
      fuente?.soporta_mensajes_pantalla !== undefined
        ? Boolean(fuente.soporta_mensajes_pantalla)
        : fuente?.marca !== 'TACLOUD';

    for (const msg of validMessages) {
      // A. Validar alcance (EMPLEADO, SUCURSAL, DEPARTAMENTO, TODOS)
      if (msg.alcance === 'EMPLEADO' && msg.empleado_id !== empleado.id) {
        continue;
      }
      if (
        msg.alcance === 'SUCURSAL' &&
        (!empleado.sucursal_id || msg.sucursal_id !== empleado.sucursal_id)
      ) {
        continue;
      }
      if (msg.alcance === 'DEPARTAMENTO') {
        const msgDept = (msg.departamento ?? '').trim().toLowerCase();
        const empDept = (empleado.departamento ?? '').trim().toLowerCase();
        if (!msgDept || msgDept !== empDept) {
          continue;
        }
      }

      // B. Validar evento de disparo (ENTRADA, SALIDA, CUALQUIERA)
      if (
        msg.evento_disparo === 'ENTRADA' &&
        punch.tipo_marca !== 'ENTRADA' &&
        punch.tipo_marca !== 'CHECADA'
      ) {
        continue;
      }
      if (msg.evento_disparo === 'SALIDA' && punch.tipo_marca !== 'SALIDA') {
        continue;
      }

      // C. Validar repetición
      const pairKey = `${msg.id}::${empleado.id}`;
      if (msg.repeticion === 'UNA_VEZ' && deliveredPairs.has(pairKey)) {
        continue;
      }

      // Construir voz personalizada y URL de WhatsApp Web
      const textoVoz = buildPersonalizedVoiceText({
        template: msg.texto_voz_personalizado,
        nombreEmpleado: empleado.nombre_completo,
        codigoEmpleado: empleado.codigo_empleado,
        titulo: msg.titulo,
        mensaje: msg.mensaje,
        tipoMarca: punch.tipo_marca,
      });

      const whatsappWebUrl = buildWhatsAppWebUrl({
        telefonoWhatsapp: empleado.telefono_whatsapp,
        nombreEmpleado: empleado.nombre_completo,
        tenantNombre,
        titulo: msg.titulo,
        mensaje: msg.mensaje,
        tipoMarca: punch.tipo_marca,
      });

      let canalUtilizado: MensajeCanalUtilizado;
      let estatusEntrega: MensajeEstatusEntrega;
      let detalle: string | null;

      const canDeliverOnDevice =
        deviceSupportsMessages && msg.modo_entrega !== 'SIEMPRE_CORREO';

      if (canDeliverOnDevice) {
        canalUtilizado = msg.reproducir_audio
          ? 'AGENTE_AUDIO_VISUAL'
          : 'DISPOSITIVO';
        estatusEntrega = 'ENTREGADO_DISPOSITIVO';
        detalle = `Mostrado en terminal ${fuente?.nombre_ubicacion ?? 'local'} y agente con audio dinámico.`;
      } else if (msg.modo_entrega === 'SOLO_DISPOSITIVO') {
        canalUtilizado = 'SIN_CANAL';
        estatusEntrega = 'SIN_CANAL_DISPONIBLE';
        detalle =
          'El reloj no soporta mensajes en pantalla y el aviso está configurado como Solo Dispositivo.';
      } else if (empleado.email && empleado.email.trim().length > 0) {
        // Fallback automático por Correo SMTP configurado en la empresa
        const emailTpl = buildEmployeePunchNotificationEmailTemplate({
          nombreEmpleado: empleado.nombre_completo,
          codigoEmpleado: empleado.codigo_empleado,
          tenantNombre,
          titulo: msg.titulo,
          mensaje: msg.mensaje,
          tipoMarca: punch.tipo_marca,
          fechaHoraLocal: punch.ts_dispositivo_local,
          dispositivoNombre: fuente?.nombre_ubicacion ?? null,
        });

        const sendRes = await sendTenantEmail({
          tenantId: params.tenantId,
          to: empleado.email.trim(),
          subject: emailTpl.subject,
          html: emailTpl.html,
          text: emailTpl.text,
        });

        if (sendRes.delivered) {
          canalUtilizado = 'EMAIL_SMTP';
          estatusEntrega = 'ENTREGADO_EMAIL';
          detalle = `Enviado por correo SMTP (${sendRes.provider}) a ${empleado.email.trim()}.`;
        } else if (whatsappWebUrl) {
          canalUtilizado = 'WHATSAPP_WEB';
          estatusEntrega = 'PENDIENTE_WHATSAPP_WEB';
          detalle = `Fallo SMTP (${sendRes.error ?? 'error'}); enlace de WhatsApp Web generado.`;
        } else {
          canalUtilizado = 'EMAIL_SMTP';
          estatusEntrega = 'ERROR_ENVIO';
          detalle = sendRes.error ?? 'Error al enviar correo por SMTP.';
        }
      } else if (whatsappWebUrl) {
        canalUtilizado = 'WHATSAPP_WEB';
        estatusEntrega = 'PENDIENTE_WHATSAPP_WEB';
        detalle =
          'Dispositivo sin pantalla y empleado sin correo; enlace directo de WhatsApp Web listo para envío.';
      } else {
        canalUtilizado = 'SIN_CANAL';
        estatusEntrega = 'SIN_CANAL_DISPONIBLE';
        detalle =
          'El dispositivo no permite mensajes en pantalla y el empleado no cuenta con correo ni WhatsApp registrados.';
      }

      // Registrar en bitácora de entregas
      const { data: insertedDelivery } = await admin
        .from('mensajes_checadas_entregas')
        .insert({
          tenant_id: params.tenantId,
          mensaje_id: msg.id,
          empleado_id: empleado.id,
          codigo_empleado: empleado.codigo_empleado,
          checada_id: punch.checada_id ?? null,
          tipo_marca: punch.tipo_marca,
          canal_utilizado: canalUtilizado,
          estatus_entrega: estatusEntrega,
          dispositivo_soportaba: deviceSupportsMessages,
          email_destino: empleado.email ?? null,
          telefono_whatsapp: empleado.telefono_whatsapp ?? null,
          whatsapp_web_url: whatsappWebUrl,
          detalle,
        })
        .select('id')
        .maybeSingle();

      if (
        estatusEntrega === 'ENTREGADO_DISPOSITIVO' ||
        estatusEntrega === 'ENTREGADO_EMAIL' ||
        estatusEntrega === 'PENDIENTE_WHATSAPP_WEB'
      ) {
        deliveredPairs.add(pairKey);
        if (msg.alcance === 'EMPLEADO' && msg.repeticion === 'UNA_VEZ') {
          singleEmployeeMessagesToDeactivate.add(msg.id);
        }
      }

      triggeredNotifications.push({
        entrega_id: insertedDelivery?.id,
        mensaje_id: msg.id,
        codigo_empleado: empleado.codigo_empleado,
        nombre_empleado: empleado.nombre_completo,
        tipo_marca: punch.tipo_marca,
        titulo: msg.titulo,
        mensaje: msg.mensaje,
        texto_voz: textoVoz,
        reproducir_audio: msg.reproducir_audio,
        canal_utilizado: canalUtilizado,
        estatus_entrega: estatusEntrega,
        whatsapp_web_url: whatsappWebUrl,
        ts_utc: punch.ts_utc,
      });
    }
  }

  // Si un mensaje individual de UNA_VEZ ya fue entregado a su único destinatario, marcarlo completado (activo = false)
  if (singleEmployeeMessagesToDeactivate.size > 0) {
    await admin
      .from('mensajes_checadas')
      .update({
        activo: false,
        updated_at: new Date().toISOString(),
      })
      .eq('tenant_id', params.tenantId)
      .in('id', Array.from(singleEmployeeMessagesToDeactivate));
  }

  if (triggeredNotifications.length > 0) {
    await broadcastTenantEvent(params.tenantId, 'mensaje_checada_entregado', {
      total: triggeredNotifications.length,
      ultimo_titulo:
        triggeredNotifications[triggeredNotifications.length - 1]?.titulo ??
        null,
    });
  }

  return triggeredNotifications;
}
