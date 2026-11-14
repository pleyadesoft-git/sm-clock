'use client';

import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Ban,
  Copy,
  MailPlus,
  Pencil,
  Shield,
  UserCheck,
  UserPlus,
} from 'lucide-react';
import type { TenantUserRole, TenantUserRow } from '@sm-clock/contracts';
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

interface UsuariosResponse {
  data: TenantUserRow[];
  total: number;
}

export default function UsuariosPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(25);
  const [search, setSearch] = React.useState('');
  const [rolFilter, setRolFilter] = React.useState<
    'TODOS' | 'ADMIN_EMPRESA' | 'OPERADOR'
  >('TODOS');

  // Estado del Sheet de Invitación
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [inviteEmail, setInviteEmail] = React.useState('');
  const [inviteNombre, setInviteNombre] = React.useState('');
  const [inviteRol, setInviteRol] =
    React.useState<TenantUserRole>('OPERADOR');
  const [inviting, setInviting] = React.useState(false);
  const [lastInviteUrl, setLastInviteUrl] = React.useState<string | null>(null);

  // Estado del Sheet de Edición de Usuario
  const [editingUser, setEditingUser] = React.useState<TenantUserRow | null>(
    null,
  );
  const [editRol, setEditRol] = React.useState<TenantUserRole>('OPERADOR');
  const [editActivo, setEditActivo] = React.useState(true);
  const [updatingUser, setUpdatingUser] = React.useState(false);

  const { data, isLoading } = useQuery<UsuariosResponse>({
    queryKey: ['usuarios-tenant', search, rolFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ search });
      if (rolFilter !== 'TODOS') {
        params.set('rol', rolFilter);
      }
      const res = await fetch(`/api/usuarios?${params.toString()}`);
      if (!res.ok) {
        throw new Error('No fue posible cargar el catálogo de usuarios');
      }
      return (await res.json()) as UsuariosResponse;
    },
  });

  function openInviteSheet() {
    setInviteEmail('');
    setInviteNombre('');
    setInviteRol('OPERADOR');
    setInviteOpen(true);
  }

  function openEditUserSheet(row: TenantUserRow) {
    setEditingUser(row);
    setEditRol(row.rol === 'ADMIN_EMPRESA' ? 'ADMIN_EMPRESA' : 'OPERADOR');
    setEditActivo(row.estatus === 'ACTIVO');
  }

  async function handleSendInvitation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setInviting(true);
    try {
      const res = await fetch('/api/usuarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: inviteEmail,
          nombre_completo: inviteNombre,
          rol: inviteRol,
        }),
      });

      const body = (await res.json()) as {
        error?: string;
        inviteUrl?: string;
        emailDelivery?: { provider: string; delivered: boolean };
      };

      if (!res.ok) {
        toast({
          title: 'Error al enviar invitación',
          description: body.error ?? 'Verifica los datos ingresados.',
          variant: 'danger',
        });
        return;
      }

      setInviteOpen(false);
      if (body.inviteUrl) {
        setLastInviteUrl(body.inviteUrl);
      }
      await queryClient.invalidateQueries({ queryKey: ['usuarios-tenant'] });
      toast({
        title: 'Invitación enviada',
        description: `Se envió la invitación con rol ${inviteRol === 'ADMIN_EMPRESA' ? 'Admin' : 'Operador'}.`,
        variant: 'success',
      });
    } finally {
      setInviting(false);
    }
  }

  async function handleUpdateUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingUser) return;
    setUpdatingUser(true);
    try {
      const res = await fetch(`/api/usuarios/${editingUser.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rol: editRol,
          activo: editActivo,
        }),
      });

      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast({
          title: 'Error al actualizar usuario',
          description: body.error ?? 'No se pudo actualizar el usuario.',
          variant: 'danger',
        });
        return;
      }

      setEditingUser(null);
      await queryClient.invalidateQueries({ queryKey: ['usuarios-tenant'] });
      toast({
        title: 'Usuario actualizado',
        variant: 'success',
      });
    } finally {
      setUpdatingUser(false);
    }
  }

  async function handleRevokeInvitation(invitationId: string) {
    const res = await fetch(`/api/usuarios/${invitationId}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      toast({
        title: 'No se pudo revocar la invitación',
        variant: 'danger',
      });
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ['usuarios-tenant'] });
    toast({
      title: 'Invitación revocada',
      variant: 'success',
    });
  }

  const columns = React.useMemo<DataTableColumnDef<TenantUserRow>[]>(
    () => [
      {
        id: 'nombre_completo',
        accessorKey: 'nombre_completo',
        header: 'Usuario / Invitado',
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-semibold text-[var(--text)]">
              {row.original.nombre_completo}
            </span>
            <span className="text-xs text-[var(--text-2)]">
              {row.original.email}
            </span>
          </div>
        ),
      },
      {
        id: 'rol',
        accessorKey: 'rol',
        header: 'Rol en Empresa',
        cell: ({ row }) => {
          const isAdmin =
            row.original.rol === 'ADMIN_EMPRESA' ||
            row.original.rol === 'SUPER_ADMIN';
          return (
            <Badge variant={isAdmin ? 'accent' : 'info'}>
              {isAdmin ? 'Admin' : 'Operador'}
            </Badge>
          );
        },
      },
      {
        id: 'estatus',
        accessorKey: 'estatus',
        header: 'Estatus',
        cell: ({ row }) => {
          const st = row.original.estatus;
          const variant =
            st === 'ACTIVO'
              ? 'success'
              : st === 'PENDIENTE'
                ? 'warning'
                : 'default';
          const label =
            st === 'ACTIVO'
              ? 'Activo'
              : st === 'INACTIVO'
                ? 'Inactivo'
                : st === 'PENDIENTE'
                  ? 'Invitación pendiente'
                  : st === 'REVOCADA'
                    ? 'Revocada'
                    : 'Expirada';
          return <Badge variant={variant}>{label}</Badge>;
        },
      },
      {
        id: 'created_at',
        accessorKey: 'created_at',
        header: 'Fecha registro / envío',
        cell: ({ row }) => (
          <span className="font-mono text-xs text-[var(--text-2)]">
            {new Intl.DateTimeFormat('es-MX', {
              timeZone: 'America/Tijuana',
              dateStyle: 'medium',
              timeStyle: 'short',
            }).format(new Date(row.original.created_at))}
          </span>
        ),
      },
      {
        id: 'acciones',
        header: 'Acciones',
        enableSorting: false,
        cell: ({ row }) => {
          const item = row.original;
          if (item.tipo_registro === 'USUARIO') {
            return (
              <div className="flex justify-end">
                <Button
                  variant="secondary"
                  onClick={() => openEditUserSheet(item)}
                >
                  <Pencil className="size-3.5" aria-hidden="true" />
                  <span>Permisos</span>
                </Button>
              </div>
            );
          }
          if (item.estatus === 'PENDIENTE') {
            return (
              <div className="flex justify-end">
                <Button
                  variant="destructive"
                  onClick={() => void handleRevokeInvitation(item.id)}
                >
                  <Ban className="size-3.5" aria-hidden="true" />
                  <span>Revocar</span>
                </Button>
              </div>
            );
          }
          return null;
        },
      },
    ],
    [],
  );

  const exportColumns = React.useMemo<ExportColumn<TenantUserRow>[]>(
    () => [
      { header: 'Nombre', accessor: (r: TenantUserRow) => r.nombre_completo },
      { header: 'Correo', accessor: (r: TenantUserRow) => r.email },
      {
        header: 'Rol',
        accessor: (r: TenantUserRow) =>
          r.rol === 'ADMIN_EMPRESA' ? 'Admin' : 'Operador',
      },
      { header: 'Estatus', accessor: (r: TenantUserRow) => r.estatus },
      { header: 'Tipo', accessor: (r: TenantUserRow) => r.tipo_registro },
    ],
    [],
  );

  return (
    <AppShell
      title="Usuarios e Invitaciones"
      subtitle="Administra el acceso por invitación a tu empresa con roles Admin y Operador"
      mode="client"
      actions={
        <Button onClick={openInviteSheet}>
          <UserPlus className="size-4" aria-hidden="true" />
          <span>Invitar usuario</span>
        </Button>
      }
    >
      <div className="flex flex-col gap-[var(--s-4)]">
        {lastInviteUrl ? (
          <Card className="border-[var(--accent)] bg-[var(--surface)]">
            <CardContent className="flex flex-wrap items-center justify-between gap-[var(--s-3)] p-[var(--s-4)]">
              <div className="flex flex-col gap-[var(--s-1)]">
                <span className="text-xs font-bold uppercase tracking-wider text-[var(--accent)]">
                  Enlace de Pre-registro Generado
                </span>
                <span className="font-mono text-xs text-[var(--text-2)] break-all">
                  {lastInviteUrl}
                </span>
              </div>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  void navigator.clipboard.writeText(lastInviteUrl);
                  toast({
                    title: 'Enlace copiado al portapapeles',
                    variant: 'success',
                  });
                }}
              >
                <Copy className="size-4" aria-hidden="true" />
                <span>Copiar link de invitación</span>
              </Button>
            </CardContent>
          </Card>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-[var(--s-3)]">
          <SegmentedControl
            ariaLabel="Filtrar por rol de usuario"
            value={rolFilter}
            onChange={setRolFilter}
            options={[
              { value: 'TODOS', label: 'Todos los roles' },
              { value: 'ADMIN_EMPRESA', label: 'Administradores' },
              { value: 'OPERADOR', label: 'Operadores' },
            ]}
          />
        </div>

        <DataTable
          caption="Usuarios e invitaciones de la organización"
          columns={columns}
          data={data?.data ?? []}
          total={data?.total ?? 0}
          page={page}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder="Buscar por nombre o correo electrónico…"
          isLoading={isLoading}
          exportFilename="usuarios-empresa-sm-clock"
          exportColumns={exportColumns}
          emptyTitle="Sin usuarios ni invitaciones registradas"
          emptyDescription="Invita a otro Administrador o a un Operador para consultar movimientos y descargar reportes."
          emptyAction={
            <Button onClick={openInviteSheet}>
              <MailPlus className="size-4" aria-hidden="true" />
              <span>Enviar primera invitación</span>
            </Button>
          }
        />
      </div>

      {/* Sheet para Enviar Invitación por SMTP */}
      <Sheet
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        title="Invitar usuario a la empresa"
        description="Se enviará un correo mediante el SMTP configurado de la empresa con un enlace único de pre-registro."
      >
        <form
          onSubmit={(e) => void handleSendInvitation(e)}
          className="flex flex-col gap-[var(--s-4)]"
        >
          <div className="flex flex-col gap-[var(--s-1)]">
            <label htmlFor="invite-nombre" className="ios-label">
              Nombre completo del invitado
            </label>
            <Input
              id="invite-nombre"
              name="nombre_completo"
              type="text"
              autoComplete="name"
              required
              placeholder="María Fernanda López"
              value={inviteNombre}
              onChange={(e) => setInviteNombre(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-[var(--s-1)]">
            <label htmlFor="invite-correo" className="ios-label">
              Correo electrónico
            </label>
            <Input
              id="invite-correo"
              name="email"
              type="email"
              spellCheck={false}
              required
              placeholder="operador@empresa.mx"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
            />
          </div>

          <fieldset className="flex flex-col gap-[var(--s-2)] rounded-[var(--r-md)] border border-[var(--separator)] p-[var(--s-3)]">
            <legend className="px-[var(--s-1)] text-xs font-bold uppercase tracking-wider text-[var(--text-2)]">
              Rol asignado en la plataforma
            </legend>

            <div className="flex items-start gap-[var(--s-2)]">
              <input
                type="radio"
                id="rol-operador"
                name="rol"
                value="OPERADOR"
                checked={inviteRol === 'OPERADOR'}
                onChange={() => setInviteRol('OPERADOR')}
                className="mt-1 accent-[var(--accent)]"
              />
              <label
                htmlFor="rol-operador"
                className="flex flex-col text-sm font-semibold text-[var(--text)] cursor-pointer"
              >
                <span className="inline-flex items-center gap-[var(--s-1)]">
                  <UserCheck className="size-4 text-[var(--accent)]" aria-hidden="true" />
                  <span>Operador</span>
                </span>
                <span className="text-xs font-normal text-[var(--text-2)]">
                  Solo consulta movimientos (entradas y salidas) y descarga reportes en XLSX, CSV y PDF. Sin acceso a Usuarios ni Configuración.
                </span>
              </label>
            </div>

            <div className="flex items-start gap-[var(--s-2)] pt-[var(--s-2)] border-t border-[var(--separator)]">
              <input
                type="radio"
                id="rol-admin"
                name="rol"
                value="ADMIN_EMPRESA"
                checked={inviteRol === 'ADMIN_EMPRESA'}
                onChange={() => setInviteRol('ADMIN_EMPRESA')}
                className="mt-1 accent-[var(--accent)]"
              />
              <label
                htmlFor="rol-admin"
                className="flex flex-col text-sm font-semibold text-[var(--text)] cursor-pointer"
              >
                <span className="inline-flex items-center gap-[var(--s-1)]">
                  <Shield className="size-4 text-[var(--accent)]" aria-hidden="true" />
                  <span>Admin (Administrador)</span>
                </span>
                <span className="text-xs font-normal text-[var(--text-2)]">
                  Acceso completo a Empleados, Sucursales, CRUD de Usuarios, envío de invitaciones y Configuración SMTP.
                </span>
              </label>
            </div>
          </fieldset>

          <div className="flex justify-end gap-[var(--s-2)] pt-[var(--s-2)]">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setInviteOpen(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={inviting}>
              <MailPlus className="size-4" aria-hidden="true" />
              <span>{inviting ? 'Enviando correo…' : 'Enviar invitación'}</span>
            </Button>
          </div>
        </form>
      </Sheet>

      {/* Sheet para Editar Rol / Estatus de un Usuario Activo */}
      <Sheet
        open={Boolean(editingUser)}
        onOpenChange={(open) => {
          if (!open) setEditingUser(null);
        }}
        title="Permisos del usuario"
        description={
          editingUser
            ? `${editingUser.nombre_completo} (${editingUser.email})`
            : ''
        }
      >
        <form
          onSubmit={(e) => void handleUpdateUser(e)}
          className="flex flex-col gap-[var(--s-4)]"
        >
          <fieldset className="flex flex-col gap-[var(--s-2)] rounded-[var(--r-md)] border border-[var(--separator)] p-[var(--s-3)]">
            <legend className="px-[var(--s-1)] text-xs font-bold uppercase tracking-wider text-[var(--text-2)]">
              Rol del usuario
            </legend>
            <div className="flex items-center gap-[var(--s-2)]">
              <input
                type="radio"
                id="edit-rol-operador"
                name="edit-rol"
                value="OPERADOR"
                checked={editRol === 'OPERADOR'}
                onChange={() => setEditRol('OPERADOR')}
                className="accent-[var(--accent)]"
              />
              <label
                htmlFor="edit-rol-operador"
                className="text-sm font-semibold text-[var(--text)]"
              >
                Operador (Solo consulta de movimientos y exportación)
              </label>
            </div>
            <div className="flex items-center gap-[var(--s-2)]">
              <input
                type="radio"
                id="edit-rol-admin"
                name="edit-rol"
                value="ADMIN_EMPRESA"
                checked={editRol === 'ADMIN_EMPRESA'}
                onChange={() => setEditRol('ADMIN_EMPRESA')}
                className="accent-[var(--accent)]"
              />
              <label
                htmlFor="edit-rol-admin"
                className="text-sm font-semibold text-[var(--text)]"
              >
                Admin (Acceso total y configuración)
              </label>
            </div>
          </fieldset>

          <div className="flex items-center gap-[var(--s-2)]">
            <input
              type="checkbox"
              id="edit-usuario-activo"
              name="activo"
              checked={editActivo}
              onChange={(e) => setEditActivo(e.target.checked)}
              className="size-4 accent-[var(--accent)]"
            />
            <label
              htmlFor="edit-usuario-activo"
              className="text-sm font-semibold text-[var(--text)]"
            >
              Cuenta activa con permiso para iniciar sesión
            </label>
          </div>

          <div className="flex justify-end gap-[var(--s-2)] pt-[var(--s-2)]">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setEditingUser(null)}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={updatingUser}>
              <span>{updatingUser ? 'Guardando…' : 'Guardar cambios'}</span>
            </Button>
          </div>
        </form>
      </Sheet>
    </AppShell>
  );
}
