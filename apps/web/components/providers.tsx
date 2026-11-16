'use client';

import * as React from 'react';
import { z } from 'zod';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/components/ui/toast';
import { PwaUpdateNotifier } from '@/components/pwa-update-notifier';

// Evita la sonda new Function("") en navegadores con Content-Security-Policy estricto
z.config({ jitless: true });

export function AppProviders({ children }: { children: React.ReactNode }) {
  const [queryClient] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        {children}
        <PwaUpdateNotifier />
      </ToastProvider>
    </QueryClientProvider>
  );
}
