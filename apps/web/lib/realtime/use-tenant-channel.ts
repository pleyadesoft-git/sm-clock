'use client';

import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useCurrentUser } from '@/lib/auth/use-current-user';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export type RealtimeChannelState = 'connected' | 'reconnecting' | 'idle';

interface UseTenantChannelOptions {
  tenantId?: string | null | undefined;
  queryKeysToInvalidate?: readonly (readonly unknown[])[];
  events?: readonly string[];
  throttleMs?: number;
}

export function useTenantChannel({
  tenantId,
  queryKeysToInvalidate = [['checadas-dashboard']],
  events = ['*'],
  throttleMs = 1000,
}: UseTenantChannelOptions = {}): {
  status: RealtimeChannelState;
  lastEventAt: string | null;
} {
  const queryClient = useQueryClient();
  const { data: currentUser } = useCurrentUser();
  const effectiveTenantId = tenantId ?? currentUser?.tenantId ?? null;

  const [status, setStatus] = React.useState<RealtimeChannelState>('idle');
  const [lastEventAt, setLastEventAt] = React.useState<string | null>(null);
  const lastInvalidatedRef = React.useRef<number>(0);
  const pendingTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const triggerThrottledInvalidation = React.useCallback(() => {
    const now = Date.now();
    const elapsed = now - lastInvalidatedRef.current;

    const runInvalidation = () => {
      lastInvalidatedRef.current = Date.now();
      for (const key of queryKeysToInvalidate) {
        void queryClient.invalidateQueries({ queryKey: [...key] });
      }
    };

    if (elapsed >= throttleMs) {
      runInvalidation();
    } else if (!pendingTimeoutRef.current) {
      pendingTimeoutRef.current = setTimeout(() => {
        pendingTimeoutRef.current = null;
        runInvalidation();
      }, throttleMs - elapsed);
    }
  }, [queryClient, queryKeysToInvalidate, throttleMs]);

  React.useEffect(() => {
    if (!effectiveTenantId) {
      setStatus('idle');
      return;
    }

    let cancelled = false;
    const supabase = createSupabaseBrowserClient();
    const topic = `tenant:${effectiveTenantId}`;
    const legacyTopic = `tenant:${effectiveTenantId}:checadas`;
    const channels: ReturnType<typeof supabase.channel>[] = [];

    setStatus('reconnecting');

    const handleBroadcast = () => {
      setLastEventAt(new Date().toISOString());
      triggerThrottledInvalidation();
    };

    const subscribeToTopic = (targetTopic: string) => {
      if (cancelled) return;

      // Limpiar canal previo si ya existía en la instancia del cliente para evitar colisiones
      const existing = supabase
        .getChannels()
        .find((c) => c.topic === `realtime:${targetTopic}` || c.topic === targetTopic);
      if (existing) {
        void supabase.removeChannel(existing);
      }

      const ch = supabase.channel(targetTopic, {
        config: {
          broadcast: { ack: false },
        },
      });

      // Registrar eventos deseados por Broadcast
      if (events.includes('*')) {
        ch.on('broadcast', { event: '*' }, handleBroadcast);
      } else {
        for (const evt of events) {
          ch.on('broadcast', { event: evt }, handleBroadcast);
        }
      }

      // Escuchar también cambios directos en Postgres (postgres_changes) para las tablas del tenant
      ch.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'empleados',
          filter: `tenant_id=eq.${effectiveTenantId}`,
        },
        handleBroadcast,
      );
      ch.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'checadas',
          filter: `tenant_id=eq.${effectiveTenantId}`,
        },
        handleBroadcast,
      );
      ch.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'sucursales',
          filter: `tenant_id=eq.${effectiveTenantId}`,
        },
        handleBroadcast,
      );
      ch.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'usuarios',
          filter: `tenant_id=eq.${effectiveTenantId}`,
        },
        handleBroadcast,
      );

      ch.subscribe((subStatus) => {
        if (cancelled) return;
        if (subStatus === 'SUBSCRIBED') {
          setStatus('connected');
        } else if (
          subStatus === 'CHANNEL_ERROR' ||
          subStatus === 'TIMED_OUT' ||
          subStatus === 'CLOSED'
        ) {
          setStatus('reconnecting');
        }
      });

      channels.push(ch);
    };

    const {
      data: { subscription: authSub },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.access_token) {
        void supabase.realtime.setAuth(session.access_token);
      }
    });

    void supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (cancelled) return;
      if (session?.access_token) {
        await supabase.realtime.setAuth(session.access_token);
      }

      // Suscribir al canal principal del tenant y al subcanal retroactivo de checadas
      subscribeToTopic(topic);
      subscribeToTopic(legacyTopic);
    });

    return () => {
      cancelled = true;
      authSub.unsubscribe();
      if (pendingTimeoutRef.current) {
        clearTimeout(pendingTimeoutRef.current);
      }
      for (const ch of channels) {
        void supabase.removeChannel(ch);
      }
    };
  }, [effectiveTenantId, events, triggerThrottledInvalidation]);

  return { status, lastEventAt };
}
