import 'server-only';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@sm-clock/contracts';

/**
 * Cliente administrativo con `service_role`.
 * REGLA DURA #1: Exclusivo de `apps/web/lib/server/**` y `apps/worker`.
 * Jamás importar en componentes de cliente ni exponer al navegador.
 */
export function createSupabaseServiceClient() {
  const supabaseUrl = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const serviceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      'Faltan variables NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el servidor',
    );
  }

  return createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export const createSupabaseAdminClient = createSupabaseServiceClient;
