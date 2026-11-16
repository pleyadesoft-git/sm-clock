'use client';

import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useCurrentUser } from '@/lib/auth/use-current-user';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import type { RealtimeChannelState } from './use-tenant-channel';

interface UseAdminChannelOptions {
  queryKeysToInvalidate?: readonly (readonly unknown[])[];
  events?: readonly string[];
  throttleMs?: number;
}

export function useAdminChannel({
  queryKeysToInvalidate = [['admin-agentes']],
  events = ['*'],
  throttleMs = 1000,
}: UseAdminChannelOptions = {}): {
  status: RealtimeChannelState;
  lastEventAt: string | null;
} {
  const queryClient = useQueryClient();
  const { data: currentUser } = useCurrentUser();
  const isSuperAdmin = currentUser?.rol === 'SUPER_ADMIN';

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
    if (!isSuperAdmin) {
      setStatus('idle');
      return;
    }

    let cancelled = false;
    const supabase = createSupabaseBrowserClient();
    const topic = 'admin:events';
    let channel: ReturnType<typeof supabase.channel> | null = null;

    setStatus('reconnecting');

    const handleBroadcast = () => {
      setLastEventAt(new Date().toISOString());
      triggerThrottledInvalidation();
    };

    const subscribe = (usePrivate: boolean) => {
      if (cancelled) return;

      channel = supabase.channel(topic, {
        config: {
          private: usePrivate,
        },
      });

      if (events.includes('*')) {
        channel.on('broadcast', { event: '*' }, handleBroadcast);
      } else {
        for (const evt of events) {
          channel.on('broadcast', { event: evt }, handleBroadcast);
        }
      }

      channel.subscribe((subStatus) => {
        if (cancelled) return;
        if (subStatus === 'SUBSCRIBED') {
          setStatus('connected');
        } else if (subStatus === 'CHANNEL_ERROR' && usePrivate) {
          subscribe(false);
        } else if (
          subStatus === 'CHANNEL_ERROR' ||
          subStatus === 'TIMED_OUT' ||
          subStatus === 'CLOSED'
        ) {
          setStatus('reconnecting');
        }
      });
    };

    void supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (cancelled) return;
      if (session?.access_token) {
        await supabase.realtime.setAuth(session.access_token);
        subscribe(true);
      } else {
        subscribe(false);
      }
    });

    return () => {
      cancelled = true;
      if (pendingTimeoutRef.current) {
        clearTimeout(pendingTimeoutRef.current);
      }
      if (channel) {
        void supabase.removeChannel(channel);
      }
    };
  }, [isSuperAdmin, events, triggerThrottledInvalidation]);

  return { status, lastEventAt };
}
