'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  Clock,
  Cpu,
  UserCheck,
  UserX,
} from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { ChartCard, type ChartDataPoint } from '@/components/ui/chart-card';
import {
  DataTable,
  type DataTableColumnDef,
} from '@/components/ui/data-table/data-table';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { StatCard } from '@/components/ui/stat-card';
import type { ExportColumn } from '@/lib/export/exporters';
import { useTenantChannel } from '@/lib/realtime/use-tenant-channel';

type FiltroMarca = 'TODAS' | 'ENTRADA' | 'SALIDA' | 'AMBIGUAS';

type ChecadaRow = {
  id: number;
  tenant_id: string;
  fuente_id: string;
  codigo_empleado: string;
  nombre_empleado: string;
  departamento: string;
  ts_utc: string;
  ts_dispositivo_local: string;
  ambigua: boolean;
  tipo_marca: 'ENTRADA' | 'SALIDA' | 'CHECADA';
  tipo_verificacion: 'HUELLA' | 'ROSTRO' | 'TARJETA' | 'API' | 'PIN' | null;
  fuentes_asistencia?: {
    nombre_ubicacion: string;
    marca: string;
  } | null;
};

interface DashboardChecadasResponse {
  tenant: {
    id: string;
    tenant_code: string;
    nombre_comercial: string;
    zona_horaria: string;
    estatus: string;
  };
  kpis: {
    presentesHoy: number;
    plantillaActiva: number;
    retardosHoy: number;
    faltasHoy: number;
    checadasUltimaHora: number;
    relojesEnLinea: number;
    relojesTotales: number;
    agentesEnLinea: number;
  };
  charts: {
    hourlySeries: ChartDataPoint[];
    departmentSeries: ChartDataPoint[];
  };
  data: ChecadaRow[];
  total: number;
  page: number;
  pageSize: number;
}

export default function DashboardPage() {
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(25);
  const [search, setSearch] = React.useState('');
  const [filtroMarca, setFiltroMarca] = React.useState<FiltroMarca>('TODAS');
  const [sortBy, setSortBy] = React.useState('ts_utc');
  const [sortDir, setSortDir] = React.useState<'asc' | 'desc'>('desc');

  const { data, isLoading } = useQuery<DashboardChecadasResponse>({
    queryKey: [
      'checadas-dashboard',
      page,
      pageSize,
      search,
      filtroMarca,
      sortBy,
      sortDir,
    ],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        search,
        filtroMarca,
        sortBy,
        sortDir,
      });
      const res = await fetch(`/api/checadas?${params.toString()}`);
      if (!res.ok) {
        throw new Error('No se pudo cargar el tablero de asistencia');
      }
      return (await res.json()) as DashboardChecadasResponse;
    },
  });

  const tenantId = data?.tenant.id ?? null;
  const timeZone = data?.tenant.zona_horaria ?? 'America/Tijuana';

  const { status: realtimeState } = useTenantChannel({
    tenantId,
    queryKeysToInvalidate: [['checadas-dashboard']],
    throttleMs: 1000,
  });

  const columns = React.useMemo<DataTableColumnDef<ChecadaRow>[]>(
    () => [
      {
        id: 'codigo_empleado',
        accessorKey: 'codigo_empleado',
        header: 'Empleado',
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-semibold text-[var(--text)]">
              {row.original.nombre_empleado}
            </span>
            <span className="font-mono text-xs text-[var(--text-2)]">
              #{row.original.codigo_empleado} · {row.original.departamento}
            </span>
          </div>
        ),
      },
      {
        id: 'tipo_marca',
        accessorKey: 'tipo_marca',
        header: 'Evento',
        cell: ({ row }) => {
          const marca = row.original.tipo_marca;
          const variant: BadgeVariant =
            marca === 'ENTRADA'
              ? 'success'
              : marca === 'SALIDA'
                ? 'warning'
                : 'default';
          return (
            <div className="flex items-center gap-[var(--s-2)]">
              <Badge variant={variant}>{marca}</Badge>
              {row.original.ambigua && (
                <Badge variant="warning">Hora repetida DST</Badge>
              )}
            </div>
          );
        },
      },
      {
        id: 'tipo_verificacion',
        accessorKey: 'tipo_verificacion',
        header: 'Biometría / Medio',
        cell: ({ row }) => (
          <span className="text-xs font-medium text-[var(--text-2)]">
            {row.original.tipo_verificacion ?? 'RELOJ'}
          </span>
        ),
      },
      {
        id: 'fuente',
        header: 'Reloj / Ubicación',
        accessorFn: (r: ChecadaRow) =>
          r.fuentes_asistencia?.nombre_ubicacion ?? '—',
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="text-sm font-medium text-[var(--text)]">
              {row.original.fuentes_asistencia?.nombre_ubicacion ?? '—'}
            </span>
            <span className="text-xs text-[var(--text-3)]">
              {row.original.fuentes_asistencia?.marca ?? 'ZKTECO'}
            </span>
          </div>
        ),
      },
      {
        id: 'ts_dispositivo_local',
        accessorKey: 'ts_dispositivo_local',
        header: 'Hora Reloj (Sitio)',
        meta: { isNumeric: true },
        cell: ({ row }) => (
          <span className="font-mono tabular-nums text-xs font-semibold text-[var(--text)]">
            {row.original.ts_dispositivo_local}
          </span>
        ),
      },
      {
        id: 'ts_utc',
        accessorKey: 'ts_utc',
        header: `Hora Oficial (${timeZone})`,
        meta: { isNumeric: true },
        cell: ({ row }) => (
          <span className="tabular-nums text-xs text-[var(--text-2)]">
            {new Intl.DateTimeFormat('es-MX', {
              dateStyle: 'short',
              timeStyle: 'medium',
              timeZone,
            }).format(new Date(row.original.ts_utc))}
          </span>
        ),
      },
    ],
    [timeZone],
  );

  const exportColumns = React.useMemo<ExportColumn<ChecadaRow>[]>(
    () => [
      {
        header: 'Código Empleado',
        accessor: (r: ChecadaRow) => r.codigo_empleado,
      },
      {
        header: 'Nombre Empleado',
        accessor: (r: ChecadaRow) => r.nombre_empleado,
      },
      {
        header: 'Departamento',
        accessor: (r: ChecadaRow) => r.departamento,
      },
      { header: 'Tipo Marca', accessor: (r: ChecadaRow) => r.tipo_marca },
      {
        header: 'Verificación',
        accessor: (r: ChecadaRow) => r.tipo_verificacion ?? '',
      },
      {
        header: 'Ubicación Reloj',
        accessor: (r: ChecadaRow) =>
          r.fuentes_asistencia?.nombre_ubicacion ?? '',
      },
      {
        header: 'Hora Local Dispositivo',
        accessor: (r: ChecadaRow) => r.ts_dispositivo_local,
      },
      { header: 'Timestamp UTC', accessor: (r: ChecadaRow) => r.ts_utc },
      {
        header: 'Hora Ambigua DST',
        accessor: (r: ChecadaRow) => (r.ambigua ? 'SÍ' : 'NO'),
      },
    ],
    [],
  );

  const kpis = data?.kpis;

  return (
    <AppShell
      title={
        data?.tenant.nombre_comercial
          ? `Asistencia en Vivo · ${data.tenant.nombre_comercial}`
          : 'Tablero de Asistencia en Vivo'
      }
      subtitle={`Zona horaria activa: ${timeZone} · Sincronización en tiempo real desde Agente Local`}
      mode="client"
      realtimeState={realtimeState}
    >
      <div className="flex flex-col gap-[var(--s-6)]">
        {/* Fila de 5 KPIs en vivo */}
        <div className="grid grid-cols-1 gap-[var(--s-4)] sm:grid-cols-2 lg:grid-cols-5">
          <StatCard
            label="Presentes hoy"
            value={
              kpis
                ? `${kpis.presentesHoy} / ${kpis.plantillaActiva}`
                : '0 / 0'
            }
            delta="En turno"
            deltaVariant="positive"
            icon={<UserCheck className="h-4 w-4" />}
            sparkline={[3, 4, 4, 5, kpis?.presentesHoy ?? 4]}
            loading={isLoading}
          />
          <StatCard
            label="Retardos hoy"
            value={kpis?.retardosHoy ?? 0}
            delta={
              (kpis?.retardosHoy ?? 0) > 0 ? 'Requiere revisión' : 'Sin retardos'
            }
            deltaVariant={(kpis?.retardosHoy ?? 0) > 0 ? 'negative' : 'positive'}
            icon={<Clock className="h-4 w-4" />}
            loading={isLoading}
          />
          <StatCard
            label="Ausencias estimadas"
            value={kpis?.faltasHoy ?? 0}
            delta="Plantilla activa"
            deltaVariant={(kpis?.faltasHoy ?? 0) > 0 ? 'neutral' : 'positive'}
            icon={<UserX className="h-4 w-4" />}
            loading={isLoading}
          />
          <StatCard
            label="Checadas última hora"
            value={kpis?.checadasUltimaHora ?? 0}
            delta="Tiempo real"
            deltaVariant="positive"
            icon={<Activity className="h-4 w-4" />}
            sparkline={[1, 2, 1, 3, kpis?.checadasUltimaHora ?? 2]}
            loading={isLoading}
          />
          <StatCard
            label="Relojes y Agentes"
            value={
              kpis
                ? `${kpis.relojesEnLinea}/${kpis.relojesTotales} relojes`
                : '—'
            }
            delta={`${kpis?.agentesEnLinea ?? 0} agente activo`}
            deltaVariant={
              kpis && kpis.relojesEnLinea === kpis.relojesTotales
                ? 'positive'
                : 'negative'
            }
            icon={<Cpu className="h-4 w-4" />}
            loading={isLoading}
          />
        </div>

        {/* Gráficas operativas */}
        <div className="grid grid-cols-1 gap-[var(--s-4)] lg:grid-cols-2">
          <ChartCard
            title="Checadas por hora (Hoy vs Promedio)"
            subtitle={`Distribución horaria en ${timeZone}`}
            primaryLabel="Hoy"
            secondaryLabel="Promedio 7d"
            data={data?.charts.hourlySeries ?? []}
            loading={isLoading}
          />
          <ChartCard
            title="Asistencia por departamento"
            subtitle="Empleados con checada registrada vs plantilla del área"
            primaryLabel="Presentes"
            secondaryLabel="Plantilla"
            data={data?.charts.departmentSeries ?? []}
            loading={isLoading}
          />
        </div>

        {/* Bitácora inmutable de checadas con DataTable */}
        <div className="flex flex-col gap-[var(--s-3)]">
          <div className="flex flex-wrap items-center justify-between gap-[var(--s-3)]">
            <div>
              <h2 className="text-base font-semibold text-[var(--text)]">
                Bitácora Inmutable de Checadas
              </h2>
              <span className="inline-flex items-center gap-[var(--s-1)] text-xs text-[var(--text-2)]">
                <AlertTriangle className="h-3.5 w-3.5 text-[var(--warning)]" />
                Las checadas crudas son inmutables por auditoría legal
              </span>
            </div>

            <SegmentedControl<FiltroMarca>
              ariaLabel="Filtrar por tipo de marca"
              value={filtroMarca}
              onChange={(val) => {
                setFiltroMarca(val);
                setPage(1);
              }}
              options={[
                { value: 'TODAS', label: 'Todas' },
                { value: 'ENTRADA', label: 'Entradas' },
                { value: 'SALIDA', label: 'Salidas' },
                { value: 'AMBIGUAS', label: 'Ambiguas DST' },
              ]}
            />
          </div>

          <DataTable
            caption="Bitácora de checadas de asistencia en tiempo real"
            columns={columns}
            data={data?.data ?? []}
            total={data?.total ?? 0}
            page={page}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            search={search}
            onSearchChange={(val) => {
              setSearch(val);
              setPage(1);
            }}
            searchPlaceholder="Buscar por número de empleado (ej. 1001)…"
            sortBy={sortBy}
            sortDir={sortDir}
            onSortChange={(colId, dir) => {
              setSortBy(colId);
              setSortDir(dir);
            }}
            isLoading={isLoading}
            exportFilename="checadas-asistencia-tijuana"
            exportColumns={exportColumns}
          />
        </div>
      </div>
    </AppShell>
  );
}
