import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@sm-clock/contracts';

export function createSupabaseBrowserClient() {
  const supabaseUrl = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const supabaseAnonKey = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Faltan variables NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY',
    );
  }

  return createBrowserClient<Database>(supabaseUrl, supabaseAnonKey);
}
