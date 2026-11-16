'use client';

import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Copy,
  MailPlus,
  Pencil,
  Shield,
  Trash2,
  UserCheck,
  UserPlus,
  X,
} from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  InviteUserRequestSchema,
  UpdateTenantUserRequestSchema,
  type TenantUserRole,
  type TenantUserRow,
} from '@sm-clock/contracts';
import type { z } from 'zod';

type InviteUserFormInput = z.input<typeof InviteUserRequestSchema>;
type InviteUserFormOutput = z.output<typeof InviteUserRequestSchema>;
import { AppShell } from '@/components/layout/app-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  DataTable,
  type DataTableColumnDef,
} from '@/components/ui/data-table/data-table';
import { TableActionsMenu } from '@/components/ui/table-actions-menu';
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
  const [inviting, setInviting] = React.useState(false);
  const [lastInviteUrl, setLastInviteUrl] = React.useState<string | null>(null);

  const inviteForm = useForm<
    InviteUserFormInput,
    unknown,
    InviteUserFormOutput
  >({
    resolver: zodResolver(InviteUserRequestSchema),
    defaultValues: {
      email: '',
      nombre_completo: '',
      rol: 'OPERADOR',
    },
    mode: 'onTouched',
  });

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
    inviteForm.reset({
      email: '',
      nombre_completo: '',
      rol: 'OPERADOR',
    });
    setInviteOpen(true);
  }

  function openEditUserSheet(row: TenantUserRow) {
    setEditingUser(row);
    setEditRol(row.rol === 'ADMIN_EMPRESA' ? 'ADMIN_EMPRESA' : 'OPERADOR');
    setEditActivo(row.estatus === 'ACTIVO');
  }

  async function handleSendInvitation(values: InviteUserFormOutput) {
    setInviting(true);
    try {
      const res = await fetch('/api/usuarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
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
        description: `Se envió la invitación con rol ${values.rol === 'ADMIN_EMPRESA' ? 'Admin' : 'Operador'}.`,
        variant: 'success',
      });
    } finally {
      setInviting(false);
    }
  }

  async function handleUpdateUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingUser) return;

    const parsed = UpdateTenantUserRequestSchema.safeParse({
      rol: editRol,
      activo: editActivo,
    });
    if (!parsed.success) {
      toast({
        title: 'Datos de usuario inválidos',
        description:
          parsed.error.issues[0]?.message ?? 'Verifica los datos ingresados.',
        variant: 'danger',
      });
      return;
    }

    setUpdatingUser(true);
    try {
      const res = await fetch(`/api/usuarios/${editingUser.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
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

  const [deletingTarget, setDeletingTarget] =
    React.useState<TenantUserRow | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const deleteDialogRef = React.useRef<HTMLDialogElement | null>(null);

  React.useEffect(() => {
    const dialog = deleteDialogRef.current;
    if (!dialog) return;

    if (deletingTarget && !dialog.open) {
      if (typeof dialog.showModal === 'function') {
        dialog.showModal();
      } else {
        dialog.setAttribute('open', '');
      }
    } else if (!deletingTarget && dialog.open) {
      if (typeof dialog.close === 'function') {
        dialog.close();
      } else {
        dialog.removeAttribute('open');
      }
    }
  }, [deletingTarget]);

  React.useEffect(() => {
    const dialog = deleteDialogRef.current;
    if (!dialog) return;

    const handleClose = () => {
      dialog.returnValue = '';
      setDeletingTarget(null);
    };

    dialog.addEventListener('close', handleClose);
    return () => {
      dialog.removeEventListener('close', handleClose);
    };
  }, []);

  async function handleConfirmDelete() {
    if (!deletingTarget) return;

    setDeleting(true);
    try {
      const res = await fetch(`/api/usuarios/${deletingTarget.id}`, {
        method: 'DELETE',
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast({
          title: 'No se pudo completar el borrado',
          description: body.error ?? 'Ocurrió un error al eliminar el registro.',
          variant: 'danger',
        });
        return;
      }

      const wasInvitation = deletingTarget.tipo_registro === 'INVITACION';
      setDeletingTarget(null);
      await queryClient.invalidateQueries({ queryKey: ['usuarios-tenant'] });
      toast({
        title: wasInvitation ? 'Invitación eliminada' : 'Usuario eliminado',
        variant: 'success',
      });
    } finally {
      setDeleting(false);
    }
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
          return (
            <div className="flex justify-end">
              <TableActionsMenu
                label={`Acciones para ${item.nombre_completo}`}
                actions={[
                  ...(item.tipo_registro === 'USUARIO'
                    ? [
                        {
                          id: 'editar',
                          label: 'Editar',
                          icon: Pencil,
                          onClick: () => {
                            openEditUserSheet(item);
                          },
                        },
                      ]
                    : []),
                  {
                    id: 'borrar',
                    label: 'Borrar',
                    icon: Trash2,
                    variant: 'danger' as const,
                    onClick: () => {
                      setDeletingTarget(item);
                    },
                  },
                ]}
              />
            </div>
          );
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
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setInviteOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              form="invite-user-sheet-form"
              disabled={inviting}
            >
              <MailPlus className="size-4" aria-hidden="true" />
              <span>{inviting ? 'Enviando correo…' : 'Enviar invitación'}</span>
            </Button>
          </>
        }
      >
        <Form {...inviteForm}>
          <form
            id="invite-user-sheet-form"
            noValidate
            onSubmit={inviteForm.handleSubmit(handleSendInvitation)}
            className="flex flex-col gap-[var(--s-4)]"
          >
            <FormField
              control={inviteForm.control}
              name="nombre_completo"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nombre completo del invitado</FormLabel>
                  <FormControl>
                    <Input
                      autoComplete="name"
                      placeholder="María Fernanda López"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={inviteForm.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Correo electrónico</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      spellCheck={false}
                      placeholder="operador@empresa.mx"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={inviteForm.control}
              name="rol"
              render={({ field }) => (
                <FormItem>
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
                        checked={field.value === 'OPERADOR'}
                        onChange={() => field.onChange('OPERADOR')}
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
                        checked={field.value === 'ADMIN_EMPRESA'}
                        onChange={() => field.onChange('ADMIN_EMPRESA')}
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
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>
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
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setEditingUser(null)}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              form="edit-user-sheet-form"
              disabled={updatingUser}
            >
              <span>{updatingUser ? 'Guardando…' : 'Guardar cambios'}</span>
            </Button>
          </>
        }
      >
        <form
          id="edit-user-sheet-form"
          noValidate
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
        </form>
      </Sheet>

      {/* Confirmation dialog para confirmar borrado */}
      <dialog
        ref={deleteDialogRef}
        aria-labelledby="delete-user-dialog-title"
        className="fixed inset-0 z-50 m-auto hidden max-h-[85vh] w-[min(92vw,460px)] flex-col overflow-hidden rounded-[var(--r-xl)] border border-[var(--separator)] bg-[var(--surface)] p-0 text-[var(--text)] shadow-[var(--shadow-2)] backdrop:bg-black/50 backdrop:backdrop-blur-sm open:flex"
        {...({ closedby: 'any' } as React.DialogHTMLAttributes<HTMLDialogElement>)}
      >
        <div className="flex items-center justify-between border-b border-[var(--separator)] bg-[var(--surface-translucent)] px-[var(--s-5)] py-[var(--s-4)] backdrop-blur-[var(--blur)]">
          <div className="flex items-center gap-[var(--s-2)]">
            <div className="flex size-8 items-center justify-center rounded-full bg-[var(--danger-bg)] text-[var(--danger)]">
              <AlertTriangle className="size-4" strokeWidth={2} aria-hidden="true" />
            </div>
            <h2
              id="delete-user-dialog-title"
              className="text-base font-semibold text-[var(--text)]"
            >
              {deletingTarget?.tipo_registro === 'INVITACION'
                ? 'Confirmar borrado de invitación'
                : 'Confirmar borrado de usuario'}
            </h2>
          </div>
          <Button
            type="button"
            variant="plain"
            aria-label="Cerrar confirmación de borrado"
            onClick={() => setDeletingTarget(null)}
            disabled={deleting}
            className="size-8 p-0"
          >
            <X className="size-4" strokeWidth={1.75} aria-hidden="true" />
          </Button>
        </div>

        <div className="ios-sheet-body flex-1 overflow-y-auto px-[var(--s-5)] py-[var(--s-4)]">
          <p className="text-sm leading-relaxed text-[var(--text)]">
            {deletingTarget?.tipo_registro === 'INVITACION' ? (
              <>
                ¿Estás seguro de que deseas eliminar la invitación para{' '}
                <span className="font-semibold">{deletingTarget.email}</span>? El
                enlace enviado dejará de ser válido.
              </>
            ) : (
              <>
                ¿Estás seguro de que deseas eliminar al usuario{' '}
                <span className="font-semibold">
                  {deletingTarget?.nombre_completo}
                </span>{' '}
                ({deletingTarget?.email})? Se desactivará su acceso a la empresa.
              </>
            )}
          </p>
        </div>

        <div className="ios-sheet-footer flex items-center justify-end gap-[var(--s-2)] border-t border-[var(--separator)] bg-[var(--surface-translucent)] px-[var(--s-5)] py-[var(--s-3)] backdrop-blur-[var(--blur)]">
          <Button
            type="button"
            variant="secondary"
            onClick={() => setDeletingTarget(null)}
            disabled={deleting}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => void handleConfirmDelete()}
            disabled={deleting}
          >
            <Trash2 className="size-4" aria-hidden="true" />
            <span>{deleting ? 'Borrando…' : 'Confirmar borrado'}</span>
          </Button>
        </div>
      </dialog>
    </AppShell>
  );
}
