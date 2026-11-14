'use client';

import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Pencil, Plus, ShieldCheck } from 'lucide-react';
import {
  PlanCodigoSchema,
  TenantStatusSchema,
  type Database,
  type PaginatedResult,
  type PlanCodigo,
  type TenantStatus,
} from '@sm-clock/contracts';
import { AppShell } from '@/components/layout/app-shell';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DataTable,
  type DataTableColumnDef,
} from '@/components/ui/data-table/data-table';
import { useToast } from '@/components/ui/toast';
import { formatFechaHoraMx } from '@/lib/utils';
import { EmpresaSheet } from './empresa-sheet';

type TenantRow = Database['public']['Tables']['tenants']['Row'] & {
  admin_inicial?: {
    id: string;
    nombre_completo: string;
    email: string;
    auth_provider: string;
  } | null;
};

const STATUS_BADGE_MAP: Record<TenantStatus, BadgeVariant> = {
  ACTIVO: 'success',
  PRUEBA: 'warning',
  SUSPENDIDO: 'danger',
  CANCELADO: 'default',
};

function getStatusBadgeVariant(rawStatus: string): BadgeVariant {
  const parsed = TenantStatusSchema.safeParse(rawStatus);
  return parsed.success ? STATUS_BADGE_MAP[parsed.data] : 'default';
}

export default function AdminEmpresasPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(20);
  const [search, setSearch] = React.useState('');
  const [estatusFilter, setEstatusFilter] = React.useState<
    string | undefined
  >();
  const [planFilter, setPlanFilter] = React.useState<string | undefined>();
  const [sortBy, setSortBy] = React.useState('created_at');
  const [sortDir, setSortDir] = React.useState<'asc' | 'desc'>('desc');

  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [editingTenant, setEditingTenant] = React.useState<TenantRow | null>(
    null,
  );

  const queryParams = React.useMemo(() => {
    const sp = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      sortBy,
      sortDir,
    });
    if (search.trim()) sp.set('search', search.trim());
    if (estatusFilter) sp.set('estatus', estatusFilter);
    if (planFilter) sp.set('plan_codigo', planFilter);
    return sp.toString();
  }, [page, pageSize, search, estatusFilter, planFilter, sortBy, sortDir]);

  const { data, isLoading, error } = useQuery<PaginatedResult<TenantRow>>({
    queryKey: ['admin-tenants', queryParams],
    queryFn: async () => {
      const res = await fetch(`/api/admin/tenants?${queryParams}`);
      if (!res.ok) {
        const errPayload = (await res.json()) as { error?: string };
        throw new Error(errPayload.error ?? 'Error al cargar empresas');
      }
      return (await res.json()) as PaginatedResult<TenantRow>;
    },
  });

  const columns = React.useMemo<DataTableColumnDef<TenantRow>[]>(
    () => [
      {
        id: 'nombre_comercial',
        accessorKey: 'nombre_comercial',
        header: 'Empresa',
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
        id: 'tenant_code',
        accessorKey: 'tenant_code',
        header: 'Código',
        cell: ({ row }) => (
          <code className="rounded-[var(--r-sm)] bg-[var(--surface-2)] px-[var(--s-2)] py-[var(--s-1)] text-xs font-semibold">
            {row.original.tenant_code}
          </code>
        ),
      },
      {
        id: 'admin_inicial',
        header: 'Admin Inicial (Google Auth)',
        enableSorting: false,
        cell: ({ row }) => {
          const adm = row.original.admin_inicial;
          const fallbackName = row.original.contacto_nombre;
          const fallbackEmail = row.original.contacto_email;
          const displayName = adm?.nombre_completo ?? fallbackName;
          const displayEmail = adm?.email ?? fallbackEmail;

          if (!displayName && !displayEmail) {
            return (
              <span className="text-xs text-[var(--text-2)]">Sin asignar</span>
            );
          }

          return (
            <div className="flex flex-col gap-[var(--s-1)]">
              <div className="flex items-center gap-[var(--s-1)]">
                <span className="text-xs font-semibold text-[var(--text)]">
                  {displayName}
                </span>
                <Badge variant="accent">
                  <ShieldCheck
                    className="mr-[var(--s-1)] size-3"
                    strokeWidth={1.75}
                    aria-hidden="true"
                  />
                  <span>Google</span>
                </Badge>
              </div>
              <span className="font-mono text-xs text-[var(--text-2)]">
                {displayEmail}
              </span>
            </div>
          );
        },
      },
      {
        id: 'rfc',
        accessorKey: 'rfc',
        header: 'RFC / C.P.',
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-mono text-xs font-medium text-[var(--text)]">
              {row.original.rfc}
            </span>
            <span className="text-xs text-[var(--text-2)]">
              Régimen {row.original.regimen_fiscal} · C.P.{' '}
              {row.original.codigo_postal_fiscal}
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
        id: 'estatus',
        accessorKey: 'estatus',
        header: 'Estatus',
        cell: ({ row }) => (
          <Badge variant={getStatusBadgeVariant(row.original.estatus)}>
            {row.original.estatus}
          </Badge>
        ),
      },
      {
        id: 'zona_horaria',
        accessorKey: 'zona_horaria',
        header: 'Zona horaria',
        cell: ({ row }) => (
          <span className="text-xs text-[var(--text-2)]">
            {row.original.zona_horaria}
          </span>
        ),
      },
      {
        id: 'created_at',
        accessorKey: 'created_at',
        header: 'Alta',
        cell: ({ row }) => (
          <span className="text-xs text-[var(--text-2)]">
            {formatFechaHoraMx(
              row.original.created_at,
              row.original.zona_horaria,
            )}
          </span>
        ),
      },
      {
        id: 'acciones',
        header: 'Acciones',
        enableSorting: false,
        cell: ({ row }) => (
          <Button
            variant="plain"
            onClick={() => {
              setEditingTenant(row.original);
              setSheetOpen(true);
            }}
            aria-label={`Editar ${row.original.nombre_comercial}`}
          >
            <Pencil className="size-4" strokeWidth={1.75} aria-hidden="true" />
            <span>Editar</span>
          </Button>
        ),
      },
    ],
    [],
  );

  const exportColumns = React.useMemo(
    () => [
      { header: 'Código', accessor: (r: TenantRow) => r.tenant_code },
      {
        header: 'Nombre Comercial',
        accessor: (r: TenantRow) => r.nombre_comercial,
      },
      { header: 'Razón Social', accessor: (r: TenantRow) => r.razon_social },
      { header: 'RFC', accessor: (r: TenantRow) => r.rfc },
      {
        header: 'Régimen Fiscal',
        accessor: (r: TenantRow) => r.regimen_fiscal,
      },
      {
        header: 'Código Postal',
        accessor: (r: TenantRow) => r.codigo_postal_fiscal,
      },
      { header: 'Plan', accessor: (r: TenantRow) => r.plan_codigo },
      { header: 'Estatus', accessor: (r: TenantRow) => r.estatus },
      { header: 'Zona Horaria', accessor: (r: TenantRow) => r.zona_horaria },
      {
        header: 'Admin Inicial',
        accessor: (r: TenantRow) =>
          r.admin_inicial?.nombre_completo ?? r.contacto_nombre ?? '',
      },
      {
        header: 'Correo Google Admin',
        accessor: (r: TenantRow) =>
          r.admin_inicial?.email ?? r.contacto_email ?? '',
      },
    ],
    [],
  );

  return (
    <AppShell
      title="Empresas"
      subtitle="Administración de clientes (tenants), datos fiscales de referencia, planes, zonas horarias y Administrador inicial con Google Auth."
      actions={
        <Button
          onClick={() => {
            setEditingTenant(null);
            setSheetOpen(true);
          }}
        >
          <Plus className="size-4" strokeWidth={1.75} aria-hidden="true" />
          <span>Nueva empresa</span>
        </Button>
      }
    >
      <DataTable
        caption="Directorio de empresas registradas en SM Clock"
        columns={columns}
        data={data?.data ?? []}
        total={data?.total ?? 0}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        search={search}
        onSearchChange={(val) => {
          setSearch(val);
          setPage(1);
        }}
        searchPlaceholder="Buscar por nombre comercial, razón social, RFC o código…"
        sortBy={sortBy}
        sortDir={sortDir}
        onSortChange={(colId, dir) => {
          setSortBy(colId);
          setSortDir(dir);
        }}
        filters={[
          {
            id: 'estatus',
            label: 'Estatus',
            value: estatusFilter,
            onChange: (val) => {
              setEstatusFilter(val);
              setPage(1);
            },
            options: [
              { label: 'Activo', value: 'ACTIVO' },
              { label: 'Prueba', value: 'PRUEBA' },
              { label: 'Suspendido', value: 'SUSPENDIDO' },
              { label: 'Cancelado', value: 'CANCELADO' },
            ],
          },
          {
            id: 'plan',
            label: 'Plan',
            value: planFilter,
            onChange: (val) => {
              const parsed = PlanCodigoSchema.safeParse(val);
              setPlanFilter(
                parsed.success ? (parsed.data as PlanCodigo) : undefined,
              );
              setPage(1);
            },
            options: [
              { label: 'Micro', value: 'MICRO' },
              { label: 'PyME', value: 'PYME' },
              { label: 'Industrial', value: 'INDUSTRIAL' },
              { label: 'Corporativo', value: 'CORPORATIVO' },
            ],
          },
        ]}
        onClearFilters={() => {
          setEstatusFilter(undefined);
          setPlanFilter(undefined);
          setPage(1);
        }}
        exportColumns={exportColumns}
        exportFilename="empresas-sm-clock"
        isLoading={isLoading}
        errorMessage={error instanceof Error ? error.message : null}
        emptyTitle="Aún no hay empresas registradas"
        emptyDescription="Da de alta el primer cliente junto con su Administrador inicial (Google Auth) para comenzar a operar."
        emptyAction={
          <Button
            onClick={() => {
              setEditingTenant(null);
              setSheetOpen(true);
            }}
          >
            <Building2
              className="size-4"
              strokeWidth={1.75}
              aria-hidden="true"
            />
            <span>Registrar primera empresa</span>
          </Button>
        }
      />

      <EmpresaSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        initialData={editingTenant}
        onSaved={() => {
          void queryClient.invalidateQueries({ queryKey: ['admin-tenants'] });
          toast({
            title: editingTenant
              ? 'Empresa actualizada'
              : 'Empresa y Admin inicial registrados',
            description: editingTenant
              ? 'Los cambios se guardaron y quedaron registrados en la bitácora de auditoría.'
              : 'Se creó la empresa y se aprovisionó al Administrador inicial con Google Auth.',
            variant: 'success',
          });
        }}
      />
    </AppShell>
  );
}
