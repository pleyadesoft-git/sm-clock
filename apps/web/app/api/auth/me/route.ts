import { NextResponse } from 'next/server';
import { requireAuthenticatedUser } from '@/lib/server/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function GET(): Promise<NextResponse> {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) {
    if (auth.status === 403) {
      const supabase = await createSupabaseServerClient();
      await supabase.auth.signOut();
    }
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  return NextResponse.json({
    data: {
      userId: auth.user.userId,
      email: auth.user.email,
      rol: auth.user.rol,
      tenantId: auth.user.tenantId,
    },
  });
}
