'use client';

import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export type RealtimeChannelState = 'connected' | 'reconnecting' | 'idle';

interface UseTenantChannelOptions {
  tenantId: string | null | undefined;
  queryKeysToInvalidate?: readonly (readonly unknown[])[];
  throttleMs?: number;
}

export function useTenantChannel({
  tenantId,
  queryKeysToInvalidate = [['checadas-dashboard']],
  throttleMs = 1000,
}: UseTenantChannelOptions): {
  status: RealtimeChannelState;
  lastEventAt: string | null;
} {
  const queryClient = useQueryClient();
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
    if (!tenantId) {
      setStatus('idle');
      return;
    }

    let cancelled = false;
    const supabase = createSupabaseBrowserClient();
    const topic = `tenant:${tenantId}:checadas`;
    let activeChannel: ReturnType<typeof supabase.channel> | null = null;

    setStatus('reconnecting');

    const subscribeToTopic = (usePrivateChannel: boolean) => {
      if (cancelled) return;
      if (activeChannel) {
        void supabase.removeChannel(activeChannel);
      }

      const ch = supabase
        .channel(topic, {
          config: {
            private: usePrivateChannel,
          },
        })
        .on('broadcast', { event: 'nueva_checada' }, () => {
          setLastEventAt(new Date().toISOString());
          triggerThrottledInvalidation();
        })
        .subscribe((subStatus) => {
          if (cancelled) return;
          if (subStatus === 'SUBSCRIBED') {
            setStatus('connected');
          } else if (subStatus === 'CHANNEL_ERROR' && usePrivateChannel) {
            // Fallback sin error en consola si el canal privado aún no tiene sesión o hook activo
            subscribeToTopic(false);
          } else if (
            subStatus === 'CHANNEL_ERROR' ||
            subStatus === 'TIMED_OUT' ||
            subStatus === 'CLOSED'
          ) {
            setStatus('reconnecting');
          }
        });

      activeChannel = ch;
    };

    void supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (cancelled) return;
      if (session?.access_token) {
        await supabase.realtime.setAuth(session.access_token);
        subscribeToTopic(true);
      } else {
        subscribeToTopic(false);
      }
    });

    return () => {
      cancelled = true;
      if (pendingTimeoutRef.current) {
        clearTimeout(pendingTimeoutRef.current);
      }
      if (activeChannel) {
        void supabase.removeChannel(activeChannel);
      }
    };
  }, [tenantId, triggerThrottledInvalidation]);

  return { status, lastEventAt };
}
