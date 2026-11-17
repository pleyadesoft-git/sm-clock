import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const DEFAULT_URL =
  (import.meta.env.VITE_SUPABASE_URL as string | undefined) ||
  (import.meta.env.NEXT_PUBLIC_SUPABASE_URL as string | undefined) ||
  'https://tu-proyecto.supabase.co';

const DEFAULT_ANON_KEY =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ||
  (import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string | undefined) ||
  'anon-key-placeholder';

let supabaseInstance: SupabaseClient | null = null;

export function getSupabaseClient(url?: string, anonKey?: string): SupabaseClient {
  const storedUrl = typeof window !== 'undefined' ? localStorage.getItem('sm_supabase_url') : null;
  const validStoredUrl = storedUrl && !storedUrl.includes('tu-proyecto') ? storedUrl : null;
  const finalUrl = url || validStoredUrl || DEFAULT_URL;

  const storedKey = typeof window !== 'undefined' ? localStorage.getItem('sm_supabase_anon_key') : null;
  const validStoredKey =
    storedKey && !storedKey.includes('anon-key-placeholder') && !storedKey.includes('tu_supabase')
      ? storedKey
      : null;
  const finalKey = anonKey || validStoredKey || DEFAULT_ANON_KEY;

  if (!supabaseInstance) {
    supabaseInstance = createClient(finalUrl, finalKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        storageKey: 'sm_clock_desktop_auth',
      },
      realtime: {
        params: {
          eventsPerSecond: 10,
        },
      },
    });
  }
  return supabaseInstance;
}

export function resetSupabaseClient(url: string, anonKey: string): SupabaseClient {
  localStorage.setItem('sm_supabase_url', url);
  localStorage.setItem('sm_supabase_anon_key', anonKey);
  supabaseInstance = null;
  return getSupabaseClient(url, anonKey);
}
