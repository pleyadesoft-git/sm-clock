import { NextResponse } from 'next/server';
import { sanitizeSearchQuery } from '@sm-clock/contracts';
import { requireSuperAdmin } from '@/lib/server/auth';
import { createSupabaseAdminClient } from '@/lib/server/supabase-admin';

export async function GET(request: Request): Promise<NextResponse> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, Number(searchParams.get('page') ?? '1'));
  const pageSize = Math.min(
    100,
    Math.max(10, Number(searchParams.get('pageSize') ?? '25')),
  );
  const search = sanitizeSearchQuery(searchParams.get('search') ?? '');

  const ALLOWED_SORT_COLUMNS = [
    'created_at',
    'accion',
    'actor_id',
    'ip',
    'tenant_id',
  ] as const;

  const rawSortBy = searchParams.get('sortBy');
  const sortBy = ALLOWED_SORT_COLUMNS.includes(
    rawSortBy as (typeof ALLOWED_SORT_COLUMNS)[number],
  )
    ? (rawSortBy as (typeof ALLOWED_SORT_COLUMNS)[number])
    : 'created_at';
  const sortDir = searchParams.get('sortDir') === 'asc' ? 'asc' : 'desc';

  const admin = createSupabaseAdminClient();
  let query = admin
    .from('auditoria')
    .select(
      'id, tenant_id, actor_id, accion, detalle, ip, created_at, tenants(tenant_code, nombre_comercial)',
      { count: 'exact' },
    )
    .order(sortBy, { ascending: sortDir === 'asc' });

  if (search) {
    query = query.ilike('accion', `%${search}%`);
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const { data, count, error } = await query.range(from, to);

  if (error) {
    return NextResponse.json(
      { error: 'Error al consultar la bitácora de auditoría' },
      { status: 500 },
    );
  }

  return NextResponse.json({
    data: data ?? [],
    total: count ?? 0,
    page,
    pageSize,
  });
}

