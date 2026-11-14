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

type EmpleadoRow = {
  id: string;
  codigo_empleado: string;
  credencial: string | null;
  nombre_completo: string;
  departamento: string | null;
  puesto: string | null;
  estatus_empleado: 'A' | 'I';
  sincronizado_en: string;
  sucursales?: {
    clave: string;
    nombre: string;
  } | null;
};

interface EmpleadosResponse {
  data: EmpleadoRow[];
  total: number;
  page: number;
  pageSize: number;
}

export default function DashboardEmpleadosPage() {
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(25);
  const [search, setSearch] = React.useState('');

  const { data, isLoading, error } = useQuery<EmpleadosResponse>({
    queryKey: ['dashboard-empleados', page, pageSize, search],
    queryFn: async () => {
      const sp = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        search,
      });
      const res = await fetch(`/api/empleados?${sp.toString()}`);
      if (!res.ok) {
        throw new Error('Error al cargar el padrón de empleados');
      }
      return (await res.json()) as EmpleadosResponse;
    },
  });

  const columns = React.useMemo<DataTableColumnDef<EmpleadoRow>[]>(
    () => [
      {
        id: 'codigo_empleado',
        accessorKey: 'codigo_empleado',
        header: 'No. Empleado',
        cell: ({ row }) => (
          <code className="rounded-[var(--r-sm)] bg-[var(--surface-2)] px-[var(--s-2)] py-[var(--s-1)] font-mono text-xs font-semibold">
            {row.original.codigo_empleado}
          </code>
        ),
      },
      {
        id: 'nombre_completo',
        accessorKey: 'nombre_completo',
        header: 'Nombre Completo',
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-semibold text-[var(--text)]">
              {row.original.nombre_completo}
            </span>
            <span className="text-xs text-[var(--text-2)]">
              {row.original.puesto ?? 'Sin puesto'}
            </span>
          </div>
        ),
      },
      {
        id: 'departamento',
        accessorKey: 'departamento',
        header: 'Departamento',
        cell: ({ row }) => (
          <span className="text-sm text-[var(--text)]">
            {row.original.departamento ?? 'General'}
          </span>
        ),
      },
      {
        id: 'sucursal',
        header: 'Planta / Sucursal',
        accessorFn: (r: EmpleadoRow) => r.sucursales?.nombre ?? '—',
        cell: ({ row }) => (
          <span className="text-xs text-[var(--text-2)]">
            {row.original.sucursales?.nombre ?? '—'}
          </span>
        ),
      },
      {
        id: 'credencial',
        accessorKey: 'credencial',
        header: 'Credencial Biometrica',
        cell: ({ row }) => (
          <span className="font-mono text-xs text-[var(--text-2)]">
            {row.original.credencial ?? '—'}
          </span>
        ),
      },
      {
        id: 'estatus_empleado',
        accessorKey: 'estatus_empleado',
        header: 'Estatus',
        cell: ({ row }) => (
          <Badge
            variant={
              row.original.estatus_empleado === 'A' ? 'success' : 'default'
            }
          >
            {row.original.estatus_empleado === 'A' ? 'ACTIVO' : 'BAJA'}
          </Badge>
        ),
      },
      {
        id: 'sincronizado_en',
        accessorKey: 'sincronizado_en',
        header: 'Última Sincronización',
        meta: { isNumeric: true },
        cell: ({ row }) => (
          <span className="tabular-nums text-xs text-[var(--text-2)]">
            {formatFechaHoraMx(row.original.sincronizado_en, 'America/Tijuana')}
          </span>
        ),
      },
    ],
    [],
  );

  const exportColumns = React.useMemo<ExportColumn<EmpleadoRow>[]>(
    () => [
      { header: 'Código', accessor: (r: EmpleadoRow) => r.codigo_empleado },
      { header: 'Nombre', accessor: (r: EmpleadoRow) => r.nombre_completo },
      {
        header: 'Departamento',
        accessor: (r: EmpleadoRow) => r.departamento ?? '',
      },
      { header: 'Puesto', accessor: (r: EmpleadoRow) => r.puesto ?? '' },
      {
        header: 'Sucursal',
        accessor: (r: EmpleadoRow) => r.sucursales?.nombre ?? '',
      },
      {
        header: 'Credencial',
        accessor: (r: EmpleadoRow) => r.credencial ?? '',
      },
      {
        header: 'Estatus',
        accessor: (r: EmpleadoRow) =>
          r.estatus_empleado === 'A' ? 'ACTIVO' : 'BAJA',
      },
    ],
    [],
  );

  return (
    <AppShell
      title="Padrón de Empleados"
      subtitle="Empleados activos sincronizados con relojes checadores y sistemas de nómina."
      mode="client"
    >
      <DataTable
        caption="Padrón de empleados registrados en la empresa"
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
        searchPlaceholder="Buscar por nombre, número de empleado o departamento…"
        isLoading={isLoading}
        errorMessage={error instanceof Error ? error.message : null}
        exportFilename="empleados-sm-clock"
        exportColumns={exportColumns}
      />
    </AppShell>
  );
}

