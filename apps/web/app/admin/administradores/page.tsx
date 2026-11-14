'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Ban,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  UserPlus,
} from 'lucide-react';
import {
  CreateSuperAdminRequestSchema,
  type SuperAdminRow,
} from '@sm-clock/contracts';
import { AppShell } from '@/components/layout/app-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  DataTable,
  type DataTableColumnDef,
} from '@/components/ui/data-table/data-table';
import { Input } from '@/components/ui/input';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Sheet } from '@/components/ui/sheet';
import { useToast } from '@/components/ui/toast';
import type { ExportColumn } from '@/lib/export/exporters';
import { formatFechaHoraMx } from '@/lib/utils';

interface SuperAdminsResponse {
  data: SuperAdminRow[];
  total: number;
}

export default function AdminSuperAdminsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(20);
  const [search, setSearch] = React.useState('');
  const [estatusFilter, setEstatusFilter] = React.useState<
    'TODOS' | 'ACTIVO' | 'INACTIVO'
  >('TODOS');

  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [nombreCompleto, setNombreCompleto] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [formError, setFormError] = React.useState<string | null>(null);

  const { data, isLoading } = useQuery<SuperAdminsResponse>({
    queryKey: ['admin-super-admins', search, estatusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (estatusFilter !== 'TODOS') params.set('estatus', estatusFilter);

      const res = await fetch(`/api/admin/super-admins?${params.toString()}`);
      if (!res.ok) {
        throw new Error('No fue posible cargar los Super-Administradores');
      }
      return (await res.json()) as SuperAdminsResponse;
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const parsed = CreateSuperAdminRequestSchema.safeParse({
        nombre_completo: nombreCompleto,
        email,
      });
      if (!parsed.success) {
        throw new Error(
          parsed.error.issues[0]?.message ??
            'Revisa los datos del Super-Administrador',
        );
      }

      const res = await fetch('/api/admin/super-admins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });

      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        data?: SuperAdminRow;
      };

      if (!res.ok) {
        throw new Error(
          body.error ?? 'Error al registrar al Super-Administrador',
        );
      }

      return body.data;
    },
    onSuccess: async (created) => {
      setSheetOpen(false);
      setNombreCompleto('');
      setEmail('');
      setFormError(null);
      toast({
        title: 'Super-Administrador registrado',
        description: `${created?.email ?? 'El usuario'} ya puede iniciar sesión con Google Auth y enrolar su MFA (TOTP).`,
        variant: 'success',
      });
      await queryClient.invalidateQueries({ queryKey: ['admin-super-admins'] });
    },
    onError: (err: Error) => {
      setFormError(err.message);
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async (params: { id: string; activo: boolean }) => {
      const res = await fetch(`/api/admin/super-admins/${params.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activo: params.activo }),
      });

      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(
          body.error ?? 'No se pudo actualizar el estatus del Super-Admin',
        );
      }
    },
    onSuccess: async () => {
      toast({
        title: 'Estatus actualizado',
        description: 'Se actualizó el acceso al panel Super-Admin.',
        variant: 'success',
      });
      await queryClient.invalidateQueries({ queryKey: ['admin-super-admins'] });
    },
    onError: (err: Error) => {
      toast({
        title: 'Operación no permitida',
        description: err.message,
        variant: 'danger',
      });
    },
  });

  const columns = React.useMemo<DataTableColumnDef<SuperAdminRow>[]>(
    () => [
      {
        id: 'nombre_completo',
        accessorKey: 'nombre_completo',
        header: 'Super-Administrador',
        meta: { isPrimary: true },
        cell: ({ row }) => (
          <div className="flex flex-col">
            <div className="flex items-center gap-[var(--s-2)]">
              <span className="font-semibold text-[var(--text)]">
                {row.original.nombre_completo}
              </span>
              {row.original.es_bootstrap ? (
                <Badge variant="accent">Fundador (Bootstrap Env)</Badge>
              ) : null}
            </div>
            <span className="text-xs text-[var(--text-2)]">
              {row.original.email}
            </span>
          </div>
        ),
      },
      {
        id: 'auth_provider',
        accessorKey: 'auth_provider',
        header: 'Autenticación',
        cell: () => <Badge variant="info">Google Auth + MFA (TOTP)</Badge>,
      },
      {
        id: 'activo',
        accessorKey: 'activo',
        header: 'Estatus',
        cell: ({ row }) => (
          <Badge variant={row.original.activo ? 'success' : 'danger'}>
            {row.original.activo ? 'ACTIVO' : 'REVOCADO'}
          </Badge>
        ),
      },
      {
        id: 'ultimo_acceso_en',
        accessorKey: 'ultimo_acceso_en',
        header: 'Último acceso',
        meta: { hideOnMobile: true },
        cell: ({ row }) => (
          <span className="tabular-nums text-xs text-[var(--text-2)]">
            {row.original.ultimo_acceso_en
              ? formatFechaHoraMx(row.original.ultimo_acceso_en)
              : 'Pendiente primer ingreso'}
          </span>
        ),
      },
      {
        id: 'created_at',
        accessorKey: 'created_at',
        header: 'Alta en plataforma',
        meta: { hideOnMobile: true },
        cell: ({ row }) => (
          <span className="tabular-nums text-xs text-[var(--text-2)]">
            {formatFechaHoraMx(row.original.created_at)}
          </span>
        ),
      },
      {
        id: 'acciones',
        header: 'Acciones',
        enableSorting: false,
        cell: ({ row }) => {
          const item = row.original;
          if (item.es_bootstrap) {
            return (
              <span className="text-xs font-medium text-[var(--text-2)]">
                Protegido en .env
              </span>
            );
          }

          return (
            <Button
              variant="secondary"
              onClick={() =>
                toggleMutation.mutate({ id: item.id, activo: !item.activo })
              }
              disabled={toggleMutation.isPending}
              className="min-h-[var(--s-8)] px-[var(--s-3)] py-[var(--s-1)] text-xs"
            >
              {item.activo ? (
                <>
                  <Ban
                    className="size-3.5"
                    strokeWidth={1.75}
                    aria-hidden="true"
                  />
                  <span>Revocar</span>
                </>
              ) : (
                <>
                  <UserCheck
                    className="size-3.5"
                    strokeWidth={1.75}
                    aria-hidden="true"
                  />
                  <span>Reactivar</span>
                </>
              )}
            </Button>
          );
        },
      },
    ],
    [toggleMutation],
  );

  const exportColumns = React.useMemo<ExportColumn<SuperAdminRow>[]>(
    () => [
      { header: 'Nombre Completo', accessor: (r) => r.nombre_completo },
      { header: 'Correo Google Auth', accessor: (r) => r.email },
      {
        header: 'Tipo',
        accessor: (r) => (r.es_bootstrap ? 'BOOTSTRAP_ENV' : 'PANEL_ADMIN'),
      },
      {
        header: 'Estatus',
        accessor: (r) => (r.activo ? 'ACTIVO' : 'REVOCADO'),
      },
      {
        header: 'Último Acceso',
        accessor: (r) =>
          r.ultimo_acceso_en ? formatFechaHoraMx(r.ultimo_acceso_en) : '—',
      },
      {
        header: 'Fecha Alta',
        accessor: (r) => formatFechaHoraMx(r.created_at),
      },
    ],
    [],
  );

  const allRows = data?.data ?? [];
  const pagedRows = React.useMemo(() => {
    const start = (page - 1) * pageSize;
    return allRows.slice(start, start + pageSize);
  }, [allRows, page, pageSize]);

  return (
    <AppShell
      mode="admin"
      title="Super-Administradores del SaaS"
      subtitle="Control de cuentas dueñas de la plataforma con acceso global a /admin/* (Google Auth + MFA obligatorio)"
      actions={
        <Button
          onClick={() => {
            setFormError(null);
            setNombreCompleto('');
            setEmail('');
            setSheetOpen(true);
          }}
        >
          <UserPlus className="size-4" strokeWidth={1.75} aria-hidden="true" />
          <span>Registrar Super-Admin</span>
        </Button>
      }
    >
      <div className="flex flex-col gap-[var(--s-5)]">
        <Card>
          <CardContent className="flex items-start gap-[var(--s-3)] p-[var(--s-4)]">
            <ShieldCheck
              className="mt-0.5 size-5 shrink-0 text-[var(--accent)]"
              aria-hidden="true"
            />
            <div className="flex flex-col gap-[var(--s-1)] text-xs text-[var(--text-2)]">
              <span className="text-sm font-semibold text-[var(--text)]">
                Estrategia de alta en 2 niveles (Bootstrap + Panel Admin)
              </span>
              <span>
                1. <strong>Bootstrap de Fundador</strong>: Tu correo definido en{' '}
                <code>SUPER_ADMIN_BOOTSTRAP_EMAILS</code> se activa
                automáticamente como <code>SUPER_ADMIN</code> al iniciar sesión
                con <strong>Google Auth</strong> en <code>/login</code>.
              </span>
              <span>
                2. <strong>Alta desde este módulo</strong>: Cualquier otro
                socio u operador de plataforma que registres aquí queda
                pre-autorizado con <code>rol = SUPER_ADMIN</code> (sin{' '}
                <code>tenant_id</code>) para ingresar con Google Auth + MFA
                (TOTP).
              </span>
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-wrap items-center justify-between gap-[var(--s-3)]">
          <SegmentedControl
            ariaLabel="Filtrar por estatus de Super-Admin"
            value={estatusFilter}
            onChange={(val) => {
              setEstatusFilter(val);
              setPage(1);
            }}
            options={[
              { value: 'TODOS', label: 'Todos' },
              { value: 'ACTIVO', label: 'Activos' },
              { value: 'INACTIVO', label: 'Revocados' },
            ]}
          />
        </div>

        <DataTable
          caption="Catálogo de Super-Administradores del SaaS"
          columns={columns}
          data={pagedRows}
          total={allRows.length}
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
          searchPlaceholder="Buscar Super-Admin por nombre o correo…"
          isLoading={isLoading}
          exportFilename="super-admins-sm-clock"
          exportColumns={exportColumns}
          emptyTitle="Sin Super-Administradores registrados"
          emptyDescription="Registra una cuenta de Google para otorgar acceso global al panel Super-Admin."
          emptyAction={
            <Button onClick={() => setSheetOpen(true)}>
              <UserPlus className="size-4" aria-hidden="true" />
              <span>Registrar Super-Admin</span>
            </Button>
          }
        />
      </div>

      <Sheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title="Registrar nuevo Super-Administrador"
        description="Otorga acceso global al panel de administración de clientes (/admin/*) mediante Google Auth y MFA obligatorio."
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setSheetOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              form="super-admin-sheet-form"
              disabled={createMutation.isPending}
            >
              <ShieldCheck
                className="size-4"
                strokeWidth={1.75}
                aria-hidden="true"
              />
              <span>
                {createMutation.isPending
                  ? 'Registrando…'
                  : 'Autorizar Super-Admin'}
              </span>
            </Button>
          </>
        }
      >
        <form
          id="super-admin-sheet-form"
          onSubmit={(e) => {
            e.preventDefault();
            setFormError(null);
            createMutation.mutate();
          }}
          className="flex flex-col gap-[var(--s-4)]"
        >
          <fieldset className="flex flex-col gap-[var(--s-3)] rounded-[var(--r-md)] border border-[var(--separator)] bg-[var(--surface-2)] p-[var(--s-4)]">
            <legend className="px-[var(--s-2)] text-xs font-semibold uppercase tracking-wider text-[var(--accent)]">
              Cuenta Google del Super-Administrador
            </legend>

            <div className="flex flex-col gap-[var(--s-1)]">
              <label htmlFor="sa-nombre" className="ios-label">
                Nombre completo *
              </label>
              <Input
                id="sa-nombre"
                name="nombre_completo"
                autoComplete="name"
                required
                value={nombreCompleto}
                onChange={(e) => setNombreCompleto(e.target.value)}
                placeholder="Ej. Carlos Mendoza"
              />
            </div>

            <div className="flex flex-col gap-[var(--s-1)]">
              <label htmlFor="sa-email" className="ios-label">
                Correo electrónico (Google Auth) *
              </label>
              <Input
                id="sa-email"
                name="email"
                type="email"
                autoComplete="email"
                spellCheck={false}
                autoCapitalize="none"
                autoCorrect="off"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="socio@smclock.mx"
              />
            </div>
          </fieldset>

          <div className="flex items-start gap-[var(--s-2)] rounded-[var(--r-md)] border border-[var(--separator)] bg-[var(--surface-2)] p-[var(--s-3)] text-xs text-[var(--text-2)]">
            <ShieldAlert
              className="mt-0.5 size-4 shrink-0 text-[var(--warning)]"
              aria-hidden="true"
            />
            <span>
              Este usuario tendrá privilegios globales sobre todas las empresas,
              suscripciones y agentes. Al iniciar sesión con Google Auth se le
              exigirá verificación MFA (TOTP) y toda acción quedará registrada
              en <code>auditoria</code>.
            </span>
          </div>

          {formError ? (
            <div
              role="alert"
              className="rounded-[var(--r-md)] bg-[var(--danger-bg)] p-[var(--s-3)] text-xs font-semibold text-[var(--danger)]"
            >
              {formError}
            </div>
          ) : null}
        </form>
      </Sheet>
    </AppShell>
  );
}
