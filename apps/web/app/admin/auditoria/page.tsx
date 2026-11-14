'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { AppShell } from '@/components/layout/app-shell';
import { Badge } from '@/components/ui/badge';
import {
  DataTable,
  type DataTableColumnDef,
} from '@/components/ui/data-table/data-table';
import type { ExportColumn } from '@/lib/export/exporters';
import { formatFechaHoraMx } from '@/lib/utils';

type AuditRow = {
  id: number;
  tenant_id: string | null;
  actor_id: string | null;
  accion: string;
  detalle: Record<string, unknown> | null;
  ip: string | null;
  created_at: string;
  tenants?: {
    tenant_code: string;
    nombre_comercial: string;
  } | null;
};

interface AuditoriaResponse {
  data: AuditRow[];
  total: number;
  page: number;
  pageSize: number;
}

export default function AdminAuditoriaPage() {
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(25);
  const [search, setSearch] = React.useState('');

  const { data, isLoading, error } = useQuery<AuditoriaResponse>({
    queryKey: ['admin-auditoria', page, pageSize, search],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        search,
      });
      const res = await fetch(`/api/admin/auditoria?${params.toString()}`);
      if (!res.ok) {
        throw new Error('Error al cargar la bitácora de auditoría');
      }
      return (await res.json()) as AuditoriaResponse;
    },
  });

  const columns = React.useMemo<DataTableColumnDef<AuditRow>[]>(
    () => [
      {
        id: 'id',
        accessorKey: 'id',
        header: 'Folio',
        meta: { isNumeric: true },
        cell: ({ row }) => (
          <span className="font-mono tabular-nums text-xs text-[var(--text-2)]">
            #{row.original.id}
          </span>
        ),
      },
      {
        id: 'accion',
        accessorKey: 'accion',
        header: 'Acción',
        cell: ({ row }) => (
          <Badge variant="default">{row.original.accion}</Badge>
        ),
      },
      {
        id: 'empresa',
        header: 'Empresa (Tenant)',
        accessorFn: (r: AuditRow) =>
          r.tenants?.nombre_comercial ?? r.tenant_id ?? 'Global',
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-medium text-[var(--text)]">
              {row.original.tenants?.nombre_comercial ?? 'Plataforma Global'}
            </span>
            <span className="font-mono text-xs text-[var(--text-2)]">
              {row.original.tenants?.tenant_code ?? ''}
            </span>
          </div>
        ),
      },
      {
        id: 'detalle',
        header: 'Detalle',
        accessorFn: (r: AuditRow) =>
          r.detalle ? JSON.stringify(r.detalle) : '—',
        cell: ({ row }) => (
          <code className="text-xs text-[var(--text-2)]">
            {row.original.detalle ? JSON.stringify(row.original.detalle) : '—'}
          </code>
        ),
      },
      {
        id: 'created_at',
        accessorKey: 'created_at',
        header: 'Fecha / Hora (Tijuana)',
        meta: { isNumeric: true },
        cell: ({ row }) => (
          <span className="tabular-nums text-xs text-[var(--text-2)]">
            {formatFechaHoraMx(row.original.created_at, 'America/Tijuana')}
          </span>
        ),
      },
    ],
    [],
  );

  const exportColumns = React.useMemo<ExportColumn<AuditRow>[]>(
    () => [
      { header: 'Folio', accessor: (r: AuditRow) => r.id },
      { header: 'Acción', accessor: (r: AuditRow) => r.accion },
      {
        header: 'Empresa',
        accessor: (r: AuditRow) =>
          r.tenants?.nombre_comercial ?? r.tenant_id ?? 'Global',
      },
      {
        header: 'Detalle',
        accessor: (r: AuditRow) =>
          r.detalle ? JSON.stringify(r.detalle) : '',
      },
      {
        header: 'Fecha UTC',
        accessor: (r: AuditRow) => r.created_at,
      },
    ],
    [],
  );

  return (
    <AppShell
      title="Bitácora Inmutable de Auditoría"
      subtitle="Registro protegido por trigger contra edición o borrado de acciones administrativas y de agentes."
      mode="admin"
    >
      <DataTable
        caption="Eventos registrados en la bitácora inmutable de auditoría"
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
        searchPlaceholder="Filtrar por código de acción (ej. TENANT_CREATE)…"
        isLoading={isLoading}
        errorMessage={error instanceof Error ? error.message : null}
        exportFilename="auditoria-sm-clock"
        exportColumns={exportColumns}
      />
    </AppShell>
  );
}

