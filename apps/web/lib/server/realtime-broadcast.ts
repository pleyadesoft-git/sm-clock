import { createSupabaseAdminClient } from '@/lib/server/supabase-admin';

export type RealtimeEvent =
  | 'nueva_checada'
  | 'empleados_changed'
  | 'sucursales_changed'
  | 'usuarios_changed'
  | 'agentes_changed'
  | 'tenants_changed'
  | 'configuracion_changed'
  | 'super_admins_changed'
  | 'mensajes_changed'
  | 'mensajes_checadas_changed'
  | 'mensaje_checada_entregado'
  | 'fuentes_changed';

/**
 * Emite un evento ligero de Supabase Realtime Broadcast al canal privado del tenant.
 * Nunca lanza excepciones para no interrumpir el flujo HTTP principal si Realtime tiene latencia o desconexión.
 */
export async function broadcastTenantEvent(
  tenantId: string,
  event: RealtimeEvent,
  payload: Record<string, unknown> = {},
): Promise<void> {
  if (!tenantId) return;

  try {
    const admin = createSupabaseAdminClient();
    if (typeof admin.channel !== 'function') return;
    const enrichedPayload = {
      ...payload,
      event,
      tenant_id: tenantId,
      ts_utc: new Date().toISOString(),
    };

    // Emitir al canal principal del tenant
    const primaryChannel = admin.channel(`tenant:${tenantId}`, {
      config: { broadcast: { ack: false } },
    });

    if (typeof primaryChannel.httpSend === 'function') {
      await primaryChannel.httpSend(event, enrichedPayload);
    } else {
      await primaryChannel.send({
        type: 'broadcast',
        event,
        payload: enrichedPayload,
      });
    }
    await admin.removeChannel(primaryChannel);

    // Compatibilidad retroactiva: para checadas, emitir también al subcanal legacy
    if (event === 'nueva_checada') {
      const legacyChannel = admin.channel(`tenant:${tenantId}:checadas`, {
        config: { broadcast: { ack: false } },
      });
      if (typeof legacyChannel.httpSend === 'function') {
        await legacyChannel.httpSend(event, enrichedPayload);
      } else {
        await legacyChannel.send({
          type: 'broadcast',
          event,
          payload: enrichedPayload,
        });
      }
      await admin.removeChannel(legacyChannel);
    }
  } catch {
    // Silencioso por resiliencia: la base de datos ya persistió la transacción
  }
}

/**
 * Emite un evento de Supabase Realtime Broadcast para Super Administradores en el canal `admin:events`.
 */
export async function broadcastAdminEvent(
  event: RealtimeEvent,
  payload: Record<string, unknown> = {},
): Promise<void> {
  try {
    const admin = createSupabaseAdminClient();
    if (typeof admin.channel !== 'function') return;
    const channel = admin.channel('admin:events', {
      config: { broadcast: { ack: false } },
    });

    const enrichedPayload = {
      ...payload,
      event,
      ts_utc: new Date().toISOString(),
    };

    if (typeof channel.httpSend === 'function') {
      await channel.httpSend(event, enrichedPayload);
    } else {
      await channel.send({
        type: 'broadcast',
        event,
        payload: enrichedPayload,
      });
    }
    await admin.removeChannel(channel);
  } catch {
    // Silencioso por resiliencia
  }
}
