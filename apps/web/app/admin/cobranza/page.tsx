'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Building2, CheckCircle2, Clock, AlertCircle } from 'lucide-react';
import type { Database, PaginatedResult, TenantStatus } from '@sm-clock/contracts';
import { useAdminChannel } from '@/lib/realtime/use-admin-channel';
import { AppShell } from '@/components/layout/app-shell';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import {
  DataTable,
  type DataTableColumnDef,
} from '@/components/ui/data-table/data-table';
import { StatCard } from '@/components/ui/stat-card';
import type { ExportColumn } from '@/lib/export/exporters';

type TenantRow = Database['public']['Tables']['tenants']['Row'];

const PLAN_PRICES_MXN: Record<string, number> = {
  MICRO: 990,
  PYME: 2490,
  INDUSTRIAL: 5990,
  CORPORATIVO: 11900,
};

const STATUS_BADGE: Record<TenantStatus, BadgeVariant> = {
  ACTIVO: 'success',
  PRUEBA: 'warning',
  SUSPENDIDO: 'danger',
  CANCELADO: 'default',
};

const mxnFormatter = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
});

export default function AdminCobranzaPage() {
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(20);
  const [search, setSearch] = React.useState('');
  const [sortBy, setSortBy] = React.useState('created_at');
  const [sortDir, setSortDir] = React.useState<'asc' | 'desc'>('desc');

  const { data, isLoading, error } = useQuery<PaginatedResult<TenantRow>>({
    queryKey: ['admin-cobranza', page, pageSize, search, sortBy, sortDir],
    queryFn: async () => {
      const sp = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (search.trim()) sp.set('search', search.trim());
      const apiSortBy = sortBy === 'cuota_mensual' ? 'plan_codigo' : sortBy;
      const validDbSortColumns = [
        'nombre_comercial',
        'tenant_code',
        'rfc',
        'plan_codigo',
        'estatus',
        'zona_horaria',
        'created_at',
      ];
      if (validDbSortColumns.includes(apiSortBy)) {
        sp.set('sortBy', apiSortBy);
        sp.set('sortDir', sortDir);
      }
      const res = await fetch(`/api/admin/tenants?${sp.toString()}`);
      if (!res.ok) {
        throw new Error('Error al cargar cuentas de cobranza');
      }
      return (await res.json()) as PaginatedResult<TenantRow>;
    },
  });

  const { status: realtimeState } = useAdminChannel({
    queryKeysToInvalidate: [['admin-cobranza']],
    events: ['*'],
  });

  const rows = data?.data ?? [];
  const activos = rows.filter((r) => r.estatus === 'ACTIVO').length;
  const enPrueba = rows.filter((r) => r.estatus === 'PRUEBA').length;
  const suspendidos = rows.filter((r) => r.estatus === 'SUSPENDIDO').length;
  const mrrEstimado = rows
    .filter((r) => r.estatus === 'ACTIVO')
    .reduce((acc, r) => acc + (PLAN_PRICES_MXN[r.plan_codigo] ?? 0), 0);

  const columns = React.useMemo<DataTableColumnDef<TenantRow>[]>(
    () => [
      {
        id: 'nombre_comercial',
        accessorKey: 'nombre_comercial',
        header: 'Cliente / Razón Social',
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-semibold text-[var(--text)]">
              {row.original.nombre_comercial}
            </span>
            <span className="text-xs text-[var(--text-2)]">
              {row.original.razon_social}
            </span>
          </div>
        ),
      },
      {
        id: 'rfc',
        accessorKey: 'rfc',
        header: 'Datos Fiscales (Ref.)',
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-mono text-xs font-semibold text-[var(--text)]">
              {row.original.rfc}
            </span>
            <span className="text-xs text-[var(--text-2)]">
              Régimen {row.original.regimen_fiscal} · Uso {row.original.uso_cfdi}
            </span>
          </div>
        ),
      },
      {
        id: 'plan_codigo',
        accessorKey: 'plan_codigo',
        header: 'Plan',
        cell: ({ row }) => (
          <Badge variant="default">{row.original.plan_codigo}</Badge>
        ),
      },
      {
        id: 'cuota_mensual',
        header: 'Cuota Mensual (MXN)',
        meta: { isNumeric: true },
        accessorFn: (r: TenantRow) => PLAN_PRICES_MXN[r.plan_codigo] ?? 0,
        cell: ({ row }) => (
          <span className="font-mono tabular-nums text-xs font-semibold text-[var(--text)]">
            {mxnFormatter.format(
              PLAN_PRICES_MXN[row.original.plan_codigo] ?? 0,
            )}
          </span>
        ),
      },
      {
        id: 'estatus',
        accessorKey: 'estatus',
        header: 'Estado de Cuenta',
        cell: ({ row }) => {
          const st = row.original.estatus as TenantStatus;
          return (
            <Badge variant={STATUS_BADGE[st] ?? 'default'}>
              {row.original.estatus}
            </Badge>
          );
        },
      },
      {
        id: 'correo_facturacion',
        accessorKey: 'correo_facturacion',
        header: 'Correo Facturación',
        cell: ({ row }) => (
          <span className="text-xs text-[var(--text-2)]">
            {row.original.correo_facturacion ?? '—'}
          </span>
        ),
      },
    ],
    [],
  );

  const exportColumns = React.useMemo<ExportColumn<TenantRow>[]>(
    () => [
      { header: 'Código', accessor: (r: TenantRow) => r.tenant_code },
      { header: 'Cliente', accessor: (r: TenantRow) => r.nombre_comercial },
      { header: 'RFC', accessor: (r: TenantRow) => r.rfc },
      { header: 'Plan', accessor: (r: TenantRow) => r.plan_codigo },
      {
        header: 'Cuota MXN',
        accessor: (r: TenantRow) => PLAN_PRICES_MXN[r.plan_codigo] ?? 0,
      },
      { header: 'Estatus', accessor: (r: TenantRow) => r.estatus },
      {
        header: 'Correo Facturación',
        accessor: (r: TenantRow) => r.correo_facturacion ?? '',
      },
    ],
    [],
  );

  return (
    <AppShell
      title="Planes y Cobranza"
      subtitle="Control administrativo de suscripciones, estados de cuenta y datos fiscales de referencia (sin timbrado CFDI)."
      mode="admin"
      realtimeState={realtimeState}
    >
      <div className="flex flex-col gap-[var(--s-6)]">
        <div className="grid grid-cols-1 gap-[var(--s-4)] sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="MRR Activo (MXN)"
            value={mxnFormatter.format(mrrEstimado)}
            delta="Suscripciones activas"
            deltaVariant="positive"
            icon={<Building2 className="h-4 w-4" />}
            loading={isLoading}
          />
          <StatCard
            label="Empresas Activas"
            value={activos}
            delta="Al corriente"
            deltaVariant="positive"
            icon={<CheckCircle2 className="h-4 w-4" />}
            loading={isLoading}
          />
          <StatCard
            label="En Periodo de Prueba"
            value={enPrueba}
            delta="Seguimiento comercial"
            deltaVariant="neutral"
            icon={<Clock className="h-4 w-4" />}
            loading={isLoading}
          />
          <StatCard
            label="Suspendidas (Dunning)"
            value={suspendidos}
            delta="Ingesta de relojes sigue activa"
            deltaVariant={suspendidos > 0 ? 'negative' : 'positive'}
            icon={<AlertCircle className="h-4 w-4" />}
            loading={isLoading}
          />
        </div>

        <DataTable
          caption="Estado de planes y cobranza por empresa"
          columns={columns}
          data={rows}
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
          searchPlaceholder="Buscar por cliente, razón social o RFC…"
          sortBy={sortBy}
          sortDir={sortDir}
          onSortChange={(colId, dir) => {
            setSortBy(colId);
            setSortDir(dir);
          }}
          isLoading={isLoading}
          errorMessage={error instanceof Error ? error.message : null}
          exportFilename="cobranza-planes-sm-clock"
          exportColumns={exportColumns}
        />
      </div>
    </AppShell>
  );
}

