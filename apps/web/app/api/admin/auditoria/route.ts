import { NextResponse } from 'next/server';
import { z } from 'zod';
import { sanitizeSearchQuery } from '@sm-clock/contracts';
import { requireSuperAdmin } from '@/lib/server/auth';
import { createSupabaseAdminClient } from '@/lib/server/supabase-admin';

const ALLOWED_SORT_COLUMNS = [
  'created_at',
  'accion',
  'actor_id',
  'ip',
  'tenant_id',
] as const;

const AuditoriaQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(10).max(100).default(25),
  search: z.string().trim().max(120).optional().default(''),
  sortBy: z.enum(ALLOWED_SORT_COLUMNS).default('created_at'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});

export async function GET(request: Request): Promise<NextResponse> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { searchParams } = new URL(request.url);
  const parsed = AuditoriaQuerySchema.safeParse({
    page: searchParams.get('page') ?? undefined,
    pageSize: searchParams.get('pageSize') ?? undefined,
    search: searchParams.get('search') ?? undefined,
    sortBy: searchParams.get('sortBy') ?? undefined,
    sortDir: searchParams.get('sortDir') ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Parámetros de consulta inválidos' },
      { status: 400 },
    );
  }

  const { page, pageSize, sortBy, sortDir } = parsed.data;
  const search = sanitizeSearchQuery(parsed.data.search);

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

