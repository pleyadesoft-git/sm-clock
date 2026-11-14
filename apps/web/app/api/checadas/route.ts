import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuthenticatedUser } from '@/lib/server/auth';
import { createSupabaseAdminClient } from '@/lib/server/supabase-admin';

const QueryParamsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(10).max(100).default(25),
  search: z.string().trim().max(80).default(''),
  filtroMarca: z
    .enum(['TODAS', 'ENTRADA', 'SALIDA', 'AMBIGUAS'])
    .default('TODAS'),
});

export async function GET(request: Request): Promise<NextResponse> {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { searchParams } = new URL(request.url);
  const parsedParams = QueryParamsSchema.safeParse({
    page: searchParams.get('page') ?? '1',
    pageSize: searchParams.get('pageSize') ?? '25',
    search: searchParams.get('search') ?? '',
    filtroMarca: searchParams.get('filtroMarca') ?? 'TODAS',
  });

  if (!parsedParams.success) {
    return NextResponse.json(
      { error: 'Parámetros de consulta inválidos' },
      { status: 400 },
    );
  }

  const { page, pageSize, search, filtroMarca } = parsedParams.data;
  const admin = createSupabaseAdminClient();

  // Regla Dura #2: tenant_id sale exclusivamente del JWT (o primer tenant activo para SUPER_ADMIN en vista soporte)
  let tenantId = auth.user.tenantId;
  if (!tenantId && auth.user.rol === 'SUPER_ADMIN') {
    const { data: firstTenant } = await admin
      .from('tenants')
      .select('id')
      .eq('estatus', 'ACTIVO')
      .order('created_at', { ascending: true })
      .limit(1)
      .single();
    tenantId = firstTenant?.id ?? null;
  }

  if (!tenantId) {
    return NextResponse.json(
      { error: 'El usuario no tiene empresa (tenant) asignada' },
      { status: 403 },
    );
  }

  const { data: tenantInfo } = await admin
    .from('tenants')
    .select('id, tenant_code, nombre_comercial, zona_horaria, estatus')
    .eq('id', tenantId)
    .single();

  // Consultar empleados del tenant para enriquecer nombres y departamentos
  const { data: empleados } = await admin
    .from('empleados')
    .select('codigo_empleado, nombre_completo, departamento, puesto, estatus_empleado')
    .eq('tenant_id', tenantId);

  const empMap = new Map<
    string,
    { nombre_completo: string; departamento: string | null; puesto: string | null }
  >();
  for (const emp of empleados ?? []) {
    empMap.set(emp.codigo_empleado, {
      nombre_completo: emp.nombre_completo,
      departamento: emp.departamento,
      puesto: emp.puesto,
    });
  }

  // Consultar fuentes y agentes del tenant
  const { data: fuentes } = await admin
    .from('fuentes_asistencia')
    .select('id, nombre_ubicacion, marca, activo, ultima_conexion_exitosa, ultimo_error')
    .eq('tenant_id', tenantId);

  const { data: agentes } = await admin
    .from('agentes')
    .select('id, nombre, version, ultimo_latido, revocado_en')
    .eq('tenant_id', tenantId)
    .is('revocado_en', null);

  // Construir consulta paginada de checadas del tenant
  let checadasQuery = admin
    .from('checadas')
    .select(
      'id, tenant_id, fuente_id, codigo_empleado, ts_utc, ts_dispositivo_local, ambigua, tipo_marca, tipo_verificacion, agente_id, created_at, fuentes_asistencia(nombre_ubicacion, marca)',
      { count: 'exact' },
    )
    .eq('tenant_id', tenantId)
    .order('ts_utc', { ascending: false });

  if (search) {
    const safeSearch = search.replace(/[%_]/g, '');
    checadasQuery = checadasQuery.ilike('codigo_empleado', `%${safeSearch}%`);
  }

  if (filtroMarca === 'ENTRADA' || filtroMarca === 'SALIDA') {
    checadasQuery = checadasQuery.eq('tipo_marca', filtroMarca);
  } else if (filtroMarca === 'AMBIGUAS') {
    checadasQuery = checadasQuery.eq('ambigua', true);
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const { data: checadasRows, count, error } = await checadasQuery.range(
    from,
    to,
  );

  if (error) {
    return NextResponse.json(
      { error: 'Error al consultar checadas' },
      { status: 500 },
    );
  }

  const enrichedRows = (checadasRows ?? []).map((row) => {
    const emp = empMap.get(row.codigo_empleado);
    return {
      ...row,
      nombre_empleado: emp?.nombre_completo ?? 'Empleado no registrado',
      departamento: emp?.departamento ?? 'Sin departamento',
    };
  });

  // KPIs en tiempo real (últimas 24h)
  const since24hIso = new Date(Date.now() - 24 * 3600_000).toISOString();
  const since1hIso = new Date(Date.now() - 3600_000).toISOString();

  const { data: recentChecadas } = await admin
    .from('checadas')
    .select('codigo_empleado, ts_utc, tipo_marca')
    .eq('tenant_id', tenantId)
    .gte('ts_utc', since24hIso);

  const uniquePresentCodes = new Set<string>();
  let checadasUltimaHora = 0;
  let retardosHoy = 0;

  const hourlyCounts = new Map<string, number>();
  for (let h = 6; h <= 17; h++) {
    const label = `${String(h).padStart(2, '0')}h`;
    hourlyCounts.set(label, 0);
  }

  const timeZone = tenantInfo?.zona_horaria ?? 'America/Tijuana';
  const hourFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });

  for (const item of recentChecadas ?? []) {
    uniquePresentCodes.add(item.codigo_empleado);
    if (item.ts_utc >= since1hIso) {
      checadasUltimaHora += 1;
    }

    const parts = hourFormatter.formatToParts(new Date(item.ts_utc));
    const hourStr = parts.find((p) => p.type === 'hour')?.value ?? '08';
    const minStr = parts.find((p) => p.type === 'minute')?.value ?? '00';
    const hKey = `${hourStr}h`;
    if (hourlyCounts.has(hKey)) {
      hourlyCounts.set(hKey, (hourlyCounts.get(hKey) ?? 0) + 1);
    }

    // Retardo operativo simple de referencia: entradas después de las 07:10 o 08:10
    if (
      item.tipo_marca === 'ENTRADA' &&
      (hourStr === '07' || hourStr === '08') &&
      Number(minStr) > 10
    ) {
      retardosHoy += 1;
    }
  }

  const activeEmployeesCount = (empleados ?? []).filter(
    (e) => e.estatus_empleado === 'A',
  ).length;
  const presentesHoy = uniquePresentCodes.size;
  const faltasHoy = Math.max(0, activeEmployeesCount - presentesHoy);

  const relojesTotales = (fuentes ?? []).length;
  const relojesEnLinea = (fuentes ?? []).filter(
    (f) => f.activo && !f.ultimo_error,
  ).length;

  const hourlySeries = Array.from(hourlyCounts.entries()).map(
    ([label, count]) => ({
      label,
      primary: count,
      secondary: Math.max(1, Math.round(count * 0.85)),
    }),
  );

  // Serie por departamento
  const deptCounts = new Map<string, { present: number; total: number }>();
  for (const emp of empleados ?? []) {
    if (emp.estatus_empleado !== 'A') continue;
    const dept = emp.departamento ?? 'General';
    const curr = deptCounts.get(dept) ?? { present: 0, total: 0 };
    curr.total += 1;
    if (uniquePresentCodes.has(emp.codigo_empleado)) {
      curr.present += 1;
    }
    deptCounts.set(dept, curr);
  }

  const departmentSeries = Array.from(deptCounts.entries()).map(
    ([dept, counts]) => ({
      label: dept.slice(0, 10),
      primary: counts.present,
      secondary: counts.total,
    }),
  );

  return NextResponse.json({
    tenant: {
      id: tenantId,
      tenant_code: tenantInfo?.tenant_code ?? 'TIJ-001',
      nombre_comercial:
        tenantInfo?.nombre_comercial ?? 'Maquiladora del Pacífico',
      zona_horaria: timeZone,
      estatus: tenantInfo?.estatus ?? 'ACTIVO',
    },
    kpis: {
      presentesHoy,
      plantillaActiva: activeEmployeesCount,
      retardosHoy,
      faltasHoy,
      checadasUltimaHora,
      relojesEnLinea,
      relojesTotales,
      agentesEnLinea: (agentes ?? []).length,
    },
    charts: {
      hourlySeries,
      departmentSeries,
    },
    data: enrichedRows,
    total: count ?? 0,
    page,
    pageSize,
  });
}
