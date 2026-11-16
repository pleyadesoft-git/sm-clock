'use client';

import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Ban,
  Building2,
  CheckCircle2,
  Pencil,
  Plus,
  ShieldCheck,
  X,
} from 'lucide-react';
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
import { TableActionsMenu } from '@/components/ui/table-actions-menu';
import { useToast } from '@/components/ui/toast';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
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

function isTenantDisabled(estatus: string): boolean {
  return estatus === 'SUSPENDIDO' || estatus === 'CANCELADO';
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
  const [disablingTarget, setDisablingTarget] =
    React.useState<TenantRow | null>(null);
  const [togglingStatus, setTogglingStatus] = React.useState(false);
  const disableDialogRef = React.useRef<HTMLDialogElement | null>(null);

  React.useEffect(() => {
    const dialog = disableDialogRef.current;
    if (!dialog) return;

    if (disablingTarget && !dialog.open) {
      if (typeof dialog.showModal === 'function') {
        dialog.showModal();
      } else {
        dialog.setAttribute('open', '');
      }
    } else if (!disablingTarget && dialog.open) {
      if (typeof dialog.close === 'function') {
        dialog.close();
      } else {
        dialog.removeAttribute('open');
      }
    }
  }, [disablingTarget]);

  React.useEffect(() => {
    const dialog = disableDialogRef.current;
    if (!dialog) return;

    const handleClose = () => {
      if (!togglingStatus) {
        setDisablingTarget(null);
      }
    };

    dialog.addEventListener('close', handleClose);

    let cleanupFallback: (() => void) | undefined;
    if (
      typeof HTMLDialogElement !== 'undefined' &&
      !('closedBy' in HTMLDialogElement.prototype)
    ) {
      const isOutside = (event: PointerEvent) => {
        const rect = dialog.getBoundingClientRect();
        return (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        );
      };
      let pressedOutside = false;
      const handlePointerDown = (event: PointerEvent) => {
        pressedOutside = isOutside(event);
      };
      const handlePointerUp = (event: PointerEvent) => {
        if (pressedOutside && isOutside(event) && !togglingStatus) {
          dialog.close();
        }
      };
      dialog.addEventListener('pointerdown', handlePointerDown);
      dialog.addEventListener('pointerup', handlePointerUp);
      cleanupFallback = () => {
        dialog.removeEventListener('pointerdown', handlePointerDown);
        dialog.removeEventListener('pointerup', handlePointerUp);
      };
    }

    return () => {
      dialog.removeEventListener('close', handleClose);
      cleanupFallback?.();
    };
  }, [togglingStatus]);

  async function handleUpdateTenantStatus(
    tenant: TenantRow,
    nextStatus: 'ACTIVO' | 'SUSPENDIDO',
  ) {
    if (togglingStatus) return;
    setTogglingStatus(true);
    try {
      const res = await fetch(`/api/admin/tenants/${tenant.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estatus: nextStatus }),
      });

      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast({
          title:
            nextStatus === 'SUSPENDIDO'
              ? 'No se pudo inhabilitar la empresa'
              : 'No se pudo habilitar la empresa',
          description:
            body.error ?? 'Ocurrió un error al actualizar el estatus.',
          variant: 'danger',
        });
        return;
      }

      setDisablingTarget(null);
      await queryClient.invalidateQueries({ queryKey: ['admin-tenants'] });
      toast({
        title:
          nextStatus === 'SUSPENDIDO'
            ? 'Empresa inhabilitada'
            : 'Empresa habilitada',
        description:
          nextStatus === 'SUSPENDIDO'
            ? `${tenant.nombre_comercial} pasó a estatus Suspendido.`
            : `${tenant.nombre_comercial} ahora está activa.`,
        variant: 'success',
      });
    } catch {
      toast({
        title: 'Error de conexión',
        description: 'No se pudo comunicar con el servidor.',
        variant: 'danger',
      });
    } finally {
      setTogglingStatus(false);
    }
  }

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

  // Suscripción Realtime 100% en vivo (postgres_changes y broadcast)
  React.useEffect(() => {
    let supabase: ReturnType<typeof createSupabaseBrowserClient>;
    try {
      supabase = createSupabaseBrowserClient();
    } catch {
      return;
    }

    const channel = supabase
      .channel('admin:tenants:realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tenants' },
        () => {
          void queryClient.invalidateQueries({ queryKey: ['admin-tenants'] });
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'perfiles_usuarios' },
        () => {
          void queryClient.invalidateQueries({ queryKey: ['admin-tenants'] });
        },
      )
      .on('broadcast', { event: '*' }, () => {
        void queryClient.invalidateQueries({ queryKey: ['admin-tenants'] });
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient]);

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
        cell: ({ row }) => {
          const item = row.original;
          const isDisabled = isTenantDisabled(item.estatus);
          return (
            <div className="flex justify-end">
              <TableActionsMenu
                label={`Acciones para ${item.nombre_comercial}`}
                actions={[
                  {
                    id: 'editar',
                    label: 'Editar',
                    icon: Pencil,
                    onClick: () => {
                      setEditingTenant(item);
                      setSheetOpen(true);
                    },
                  },
                  isDisabled
                    ? {
                        id: 'habilitar',
                        label: 'Habilitar',
                        icon: CheckCircle2,
                        variant: 'success',
                        disabled: togglingStatus,
                        onClick: () => {
                          void handleUpdateTenantStatus(item, 'ACTIVO');
                        },
                      }
                    : {
                        id: 'inhabilitar',
                        label: 'Inhabilitar',
                        icon: Ban,
                        variant: 'danger',
                        disabled: togglingStatus,
                        onClick: () => {
                          setDisablingTarget(item);
                        },
                      },
                ]}
              />
            </div>
          );
        },
      },
    ],
    [togglingStatus],
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

      {/* Diálogo de confirmación para inhabilitar empresa */}
      <dialog
        ref={disableDialogRef}
        aria-labelledby="disable-tenant-dialog-title"
        className="fixed inset-0 z-50 m-auto hidden max-h-[85vh] w-[min(92vw,460px)] flex-col overflow-hidden rounded-[var(--r-xl)] border border-[var(--separator)] bg-[var(--surface)] p-0 text-[var(--text)] shadow-[var(--shadow-2)] backdrop:bg-black/50 backdrop:backdrop-blur-sm open:flex"
        {...({ closedby: 'any' } as React.DialogHTMLAttributes<HTMLDialogElement>)}
      >
        <div className="flex items-center justify-between border-b border-[var(--separator)] bg-[var(--surface-translucent)] px-[var(--s-5)] py-[var(--s-4)] backdrop-blur-[var(--blur)]">
          <div className="flex items-center gap-[var(--s-2)]">
            <div className="flex size-8 items-center justify-center rounded-full bg-[var(--danger-bg)] text-[var(--danger)]">
              <AlertTriangle className="size-4" strokeWidth={2} aria-hidden="true" />
            </div>
            <h2
              id="disable-tenant-dialog-title"
              className="text-base font-semibold text-[var(--text)]"
            >
              Confirmar inhabilitación de empresa
            </h2>
          </div>
          <Button
            type="button"
            variant="plain"
            aria-label="Cerrar confirmación de inhabilitación"
            onClick={() => setDisablingTarget(null)}
            disabled={togglingStatus}
            className="size-8 p-0"
          >
            <X className="size-4" strokeWidth={1.75} aria-hidden="true" />
          </Button>
        </div>

        <div className="ios-sheet-body flex-1 overflow-y-auto px-[var(--s-5)] py-[var(--s-4)]">
          <p className="text-sm leading-relaxed text-[var(--text)]">
            ¿Estás seguro de que deseas inhabilitar la empresa{' '}
            <span className="font-semibold">
              {disablingTarget?.nombre_comercial}
            </span>{' '}
            (<code className="font-mono text-xs">{disablingTarget?.tenant_code}</code>
            )? Pasará a estatus <span className="font-semibold">Suspendido</span>{' '}
            y sus usuarios no podrán acceder hasta que sea habilitada nuevamente.
          </p>
        </div>

        <div className="ios-sheet-footer flex items-center justify-end gap-[var(--s-2)] border-t border-[var(--separator)] bg-[var(--surface-translucent)] px-[var(--s-5)] py-[var(--s-3)] backdrop-blur-[var(--blur)]">
          <Button
            type="button"
            variant="secondary"
            onClick={() => setDisablingTarget(null)}
            disabled={togglingStatus}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => {
              if (disablingTarget) {
                void handleUpdateTenantStatus(disablingTarget, 'SUSPENDIDO');
              }
            }}
            disabled={togglingStatus}
          >
            <Ban className="size-4" aria-hidden="true" />
            <span>
              {togglingStatus ? 'Inhabilitando…' : 'Confirmar inhabilitación'}
            </span>
          </Button>
        </div>
      </dialog>
    </AppShell>
  );
}
