'use client';

import { useQuery } from '@tanstack/react-query';

export interface CurrentUser {
  userId: string;
  email: string;
  nombreCompleto: string;
  rol: 'SUPER_ADMIN' | 'ADMIN_EMPRESA' | 'OPERADOR';
  tenantId: string | null;
  authProvider: string;
  avatarUrl: string | null;
  aal?: string;
}

export function useCurrentUser() {
  return useQuery<CurrentUser | null>({
    queryKey: ['auth-me'],
    queryFn: async () => {
      try {
        const res = await fetch('/api/auth/me');
        if (!res.ok) return null;
        const json = await res.json();
        return (json?.data as CurrentUser) ?? null;
      } catch {
        return null;
      }
    },
    staleTime: 60 * 1000,
  });
}
