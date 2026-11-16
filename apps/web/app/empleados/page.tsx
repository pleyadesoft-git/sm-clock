'use client';

import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Camera,
  Pencil,
  Plus,
  UserCheck,
  Users,
  UserX,
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
  EmpleadoCreateSchema,
  EmpleadoUpdateSchema,
} from '@sm-clock/contracts';
import type { z } from 'zod';

type EmpleadoFormInput = z.input<typeof EmpleadoCreateSchema>;
type EmpleadoFormOutput = z.output<typeof EmpleadoCreateSchema>;
import {
  PhotoUploader,
  type StagedPhotoPayload,
} from '@/components/features/empleados/photo-uploader';
import { AppShell } from '@/components/layout/app-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DataTable,
  type DataTableColumnDef,
} from '@/components/ui/data-table/data-table';
import { TableActionsMenu } from '@/components/ui/table-actions-menu';
import { Input } from '@/components/ui/input';
import { Sheet } from '@/components/ui/sheet';
import { useToast } from '@/components/ui/toast';
import type { ExportColumn } from '@/lib/export/exporters';

type EmpleadoRow = {
  id: string;
  tenant_id: string;
  sucursal_id: string | null;
  codigo_empleado: string;
  credencial: string | null;
  nombre_completo: string;
  departamento: string | null;
  puesto: string | null;
  estatus_empleado: 'A' | 'I';
  foto_path?: string | null;
  foto_thumb_path?: string | null;
  foto_thumb_signed_url?: string | null;
  foto_signed_url?: string | null;
  sucursales?: {
    id: string;
    clave: string;
    nombre: string;
  } | null;
};

interface SucursalOption {
  id: string;
  clave: string;
  nombre: string;
}

interface EmpleadosResponse {
  data: EmpleadoRow[];
  total: number;
  page: number;
  pageSize: number;
  sucursales: SucursalOption[];
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p.charAt(0).toUpperCase()).join('') || 'EM';
}

export default function EmpleadosPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(25);
  const [search, setSearch] = React.useState('');
  const [estatusFilter, setEstatusFilter] = React.useState<
    string | undefined
  >();
  const [sucursalFilter, setSucursalFilter] = React.useState<
    string | undefined
  >();

  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<EmpleadoRow | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const form = useForm<EmpleadoFormInput, unknown, EmpleadoFormOutput>({
    resolver: zodResolver(EmpleadoCreateSchema),
    defaultValues: {
      codigo_empleado: '',
      nombre_completo: '',
      credencial: '',
      departamento: '',
      puesto: '',
      sucursal_id: null,
      estatus_empleado: 'A',
    },
    mode: 'onTouched',
  });

  const { data, isLoading } = useQuery<EmpleadosResponse>({
    queryKey: [
      'empleados-list',
      page,
      pageSize,
      search,
      estatusFilter,
      sucursalFilter,
    ],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        search,
      });
      if (estatusFilter) params.set('estatus', estatusFilter);
      if (sucursalFilter) params.set('sucursal_id', sucursalFilter);

      const res = await fetch(`/api/empleados?${params.toString()}`);
      if (!res.ok) {
        throw new Error('Error al cargar empleados');
      }
      return (await res.json()) as EmpleadosResponse;
    },
  });

  const sucursales = data?.sucursales ?? [];
  const [stagedPhoto, setStagedPhoto] =
    React.useState<StagedPhotoPayload | null>(null);

  const photoSectionRef = React.useRef<HTMLDivElement | null>(null);
  const [statusTarget, setStatusTarget] = React.useState<{
    empleado: EmpleadoRow;
    nuevoEstatus: 'A' | 'I';
  } | null>(null);
  const [updatingStatus, setUpdatingStatus] = React.useState(false);
  const statusDialogRef = React.useRef<HTMLDialogElement | null>(null);

  React.useEffect(() => {
    const dialog = statusDialogRef.current;
    if (!dialog) return;

    if (statusTarget && !dialog.open) {
      if (typeof dialog.showModal === 'function') {
        dialog.showModal();
      } else {
        dialog.setAttribute('open', '');
      }
    } else if (!statusTarget && dialog.open) {
      if (typeof dialog.close === 'function') {
        dialog.close();
      } else {
        dialog.removeAttribute('open');
      }
    }
  }, [statusTarget]);

  React.useEffect(() => {
    const dialog = statusDialogRef.current;
    if (!dialog) return;

    const handleClose = () => {
      dialog.returnValue = '';
      setStatusTarget(null);
    };

    dialog.addEventListener('close', handleClose);
    return () => {
      dialog.removeEventListener('close', handleClose);
    };
  }, []);

  async function handleConfirmStatusChange() {
    if (!statusTarget) return;

    setUpdatingStatus(true);
    const { empleado, nuevoEstatus } = statusTarget;
    try {
      const res = await fetch('/api/empleados', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: empleado.id,
          estatus_empleado: nuevoEstatus,
        }),
      });

      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast({
          title: 'Error al cambiar estatus',
          description:
            json.error ?? 'No fue posible actualizar el estatus del empleado.',
          variant: 'danger',
        });
        return;
      }

      setStatusTarget(null);
      await queryClient.invalidateQueries({ queryKey: ['empleados-list'] });
      toast({
        title:
          nuevoEstatus === 'I'
            ? 'Empleado inhabilitado'
            : 'Empleado reactivado',
        description: `${empleado.nombre_completo} ahora tiene estatus ${
          nuevoEstatus === 'I' ? 'Baja / Inactivo (I)' : 'Activo (A)'
        }.`,
        variant: 'success',
      });
    } catch {
      toast({
        title: 'Error de red',
        description: 'No se pudo comunicar con el servidor.',
        variant: 'danger',
      });
    } finally {
      setUpdatingStatus(false);
    }
  }

  function openNewSheet() {
    setEditing(null);
    setStagedPhoto(null);
    form.reset({
      codigo_empleado: '',
      nombre_completo: '',
      credencial: '',
      departamento: '',
      puesto: '',
      sucursal_id: sucursales[0]?.id ?? null,
      estatus_empleado: 'A',
    });
    setSheetOpen(true);
  }

  function openEditSheet(row: EmpleadoRow, section: 'datos' | 'foto' = 'datos') {
    setEditing(row);
    setStagedPhoto(null);
    form.reset({
      codigo_empleado: row.codigo_empleado,
      nombre_completo: row.nombre_completo,
      credencial: row.credencial ?? '',
      departamento: row.departamento ?? '',
      puesto: row.puesto ?? '',
      sucursal_id: row.sucursal_id ?? null,
      estatus_empleado: row.estatus_empleado,
    });
    setSheetOpen(true);
    if (section === 'foto') {
      setTimeout(() => {
        photoSectionRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        });
      }, 250);
    }
  }

  async function handleSave(values: EmpleadoFormOutput) {
    const rawPayload = {
      ...(editing ? { id: editing.id } : {}),
      codigo_empleado: values.codigo_empleado,
      nombre_completo: values.nombre_completo,
      credencial: values.credencial || null,
      departamento: values.departamento || null,
      puesto: values.puesto || null,
      sucursal_id: values.sucursal_id || null,
      estatus_empleado: values.estatus_empleado,
    };

    const parsed = editing
      ? EmpleadoUpdateSchema.safeParse(rawPayload)
      : EmpleadoCreateSchema.safeParse(rawPayload);

    if (!parsed.success) {
      toast({
        title: 'Datos de empleado inválidos',
        description:
          parsed.error.issues[0]?.message ?? 'Verifica los datos ingresados.',
        variant: 'danger',
      });
      return;
    }

    setSubmitting(true);
    try {
      const method = editing ? 'PATCH' : 'POST';
      const res = await fetch('/api/empleados', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });

      const json = (await res.json()) as {
        data?: EmpleadoRow;
        error?: string;
      };
      if (!res.ok || !json.data) {
        toast({
          title: 'Error al guardar empleado',
          description: json.error ?? 'Verifica los datos ingresados.',
          variant: 'danger',
        });
        return;
      }

      if (!editing && stagedPhoto) {
        const photoForm = new FormData();
        photoForm.append('file', stagedPhoto.file);
        const photoRes = await fetch(`/api/empleados/${json.data.id}/foto`, {
          method: 'POST',
          body: photoForm,
        });

        await queryClient.invalidateQueries({ queryKey: ['empleados-list'] });

        if (!photoRes.ok) {
          const photoErr = (await photoRes.json().catch(() => ({}))) as {
            error?: string;
          };
          setEditing(json.data);
          toast({
            title: 'Empleado creado, pero falló la subida de foto',
            description:
              photoErr.error ??
              'Puedes reintentar subir la fotografía desde este panel.',
            variant: 'danger',
          });
          return;
        }

        setStagedPhoto(null);
        setSheetOpen(false);
        toast({
          title: 'Empleado y fotografía registrados',
          description: 'La foto se guardó optimizada a ≤ 720 px.',
          variant: 'success',
        });
        return;
      }

      await queryClient.invalidateQueries({ queryKey: ['empleados-list'] });
      toast({
        title: editing ? 'Empleado actualizado' : 'Empleado registrado',
        description: editing
          ? 'Los cambios quedaron guardados.'
          : 'Ahora puedes subir o tomar su fotografía en la parte inferior.',
        variant: 'success',
      });

      if (!editing) {
        setEditing(json.data);
      } else {
        setSheetOpen(false);
      }
    } finally {
      setSubmitting(false);
    }
  }

  const columns = React.useMemo<DataTableColumnDef<EmpleadoRow>[]>(
    () => [
      {
        id: 'avatar',
        header: 'Foto',
        enableSorting: false,
        cell: ({ row }) => {
          const thumbUrl =
            row.original.foto_thumb_signed_url ?? row.original.foto_signed_url;
          return (
            <div className="flex items-center">
              {thumbUrl ? (
                <img
                  src={thumbUrl}
                  alt={`Fotografía de ${row.original.nombre_completo}`}
                  className="size-9 rounded-full border border-[var(--separator)] object-cover"
                />
              ) : (
                <div
                  aria-label={`Iniciales de ${row.original.nombre_completo}`}
                  className="flex size-9 items-center justify-center rounded-full bg-[var(--primary-soft)] text-xs font-semibold text-[var(--primary)]"
                >
                  {getInitials(row.original.nombre_completo)}
                </div>
              )}
            </div>
          );
        },
      },
      {
        id: 'codigo_empleado',
        accessorKey: 'codigo_empleado',
        header: 'Núm. Reloj / CONTPAQi',
        cell: ({ row }) => (
          <code className="rounded-[var(--r-sm)] bg-[var(--surface-2)] px-[var(--s-2)] py-[var(--s-1)] font-mono text-xs font-semibold text-[var(--text)]">
            {row.original.codigo_empleado}
          </code>
        ),
      },
      {
        id: 'nombre_completo',
        accessorKey: 'nombre_completo',
        header: 'Nombre del Trabajador',
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-semibold text-[var(--text)]">
              {row.original.nombre_completo}
            </span>
            <span className="text-xs text-[var(--text-2)]">
              {row.original.puesto ?? 'Sin puesto asignado'}
            </span>
          </div>
        ),
      },
      {
        id: 'departamento',
        accessorKey: 'departamento',
        header: 'Departamento',
        cell: ({ row }) => (
          <span className="text-sm text-[var(--text-2)]">
            {row.original.departamento ?? 'General'}
          </span>
        ),
      },
      {
        id: 'sucursal',
        header: 'Planta / Sucursal',
        accessorFn: (r: EmpleadoRow) => r.sucursales?.nombre ?? '—',
        cell: ({ row }) => (
          <span className="text-xs font-medium text-[var(--text-2)]">
            {row.original.sucursales?.nombre ?? '—'}
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
            {row.original.estatus_empleado === 'A' ? 'Activo (A)' : 'Baja (I)'}
          </Badge>
        ),
      },
      {
        id: 'acciones',
        header: 'Acciones',
        enableSorting: false,
        cell: ({ row }) => {
          const item = row.original;
          const isActivo = item.estatus_empleado === 'A';
          return (
            <div className="flex justify-end">
              <TableActionsMenu
                label={`Acciones para ${item.nombre_completo}`}
                actions={[
                  {
                    id: 'editar-datos',
                    label: 'Editar datos',
                    icon: Pencil,
                    onClick: () => openEditSheet(item, 'datos'),
                  },
                  {
                    id: 'editar-foto',
                    label: 'Cambiar fotografía',
                    icon: Camera,
                    onClick: () => openEditSheet(item, 'foto'),
                  },
                  isActivo
                    ? {
                        id: 'inhabilitar',
                        label: 'Inhabilitar empleado',
                        icon: UserX,
                        variant: 'danger',
                        onClick: () =>
                          setStatusTarget({
                            empleado: item,
                            nuevoEstatus: 'I',
                          }),
                      }
                    : {
                        id: 'reactivar',
                        label: 'Habilitar empleado',
                        icon: UserCheck,
                        variant: 'success',
                        onClick: () =>
                          setStatusTarget({
                            empleado: item,
                            nuevoEstatus: 'A',
                          }),
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

  const exportColumns = React.useMemo<ExportColumn<EmpleadoRow>[]>(
    () => [
      { header: 'Código', accessor: (r: EmpleadoRow) => r.codigo_empleado },
      { header: 'Nombre Completo', accessor: (r: EmpleadoRow) => r.nombre_completo },
      { header: 'Credencial', accessor: (r: EmpleadoRow) => r.credencial ?? '' },
      { header: 'Departamento', accessor: (r: EmpleadoRow) => r.departamento ?? '' },
      { header: 'Puesto', accessor: (r: EmpleadoRow) => r.puesto ?? '' },
      {
        header: 'Sucursal',
        accessor: (r: EmpleadoRow) => r.sucursales?.nombre ?? '',
      },
      {
        header: 'Estatus',
        accessor: (r: EmpleadoRow) =>
          r.estatus_empleado === 'A' ? 'Activo' : 'Inactivo',
      },
    ],
    [],
  );

  return (
    <AppShell
      title="Padrón de Empleados y Fotografía"
      subtitle="Sincronizado con CONTPAQi Nóminas / TRESS · Fotografía privada con URLs firmadas"
      mode="client"
      actions={
        <Button onClick={openNewSheet}>
          <Plus className="size-4" aria-hidden="true" />
          Nuevo empleado
        </Button>
      }
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
        searchPlaceholder="Buscar por número de empleado, nombre o departamento…"
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
              { label: 'Activo (A)', value: 'A' },
              { label: 'Baja / Inactivo (I)', value: 'I' },
            ],
          },
          {
            id: 'sucursal',
            label: 'Sucursal',
            value: sucursalFilter,
            onChange: (val) => {
              setSucursalFilter(val);
              setPage(1);
            },
            options: sucursales.map((s) => ({
              label: `${s.clave} · ${s.nombre}`,
              value: s.id,
            })),
          },
        ]}
        onClearFilters={() => {
          setEstatusFilter(undefined);
          setSucursalFilter(undefined);
          setPage(1);
        }}
        isLoading={isLoading}
        exportFilename="empleados-sm-clock"
        exportColumns={exportColumns}
        emptyTitle="Sin empleados registrados"
        emptyDescription="Registra empleados manualmente o sincronízalos desde CONTPAQi Nóminas / TRESS."
        emptyAction={
          <Button onClick={openNewSheet}>
            <Users className="size-4" aria-hidden="true" />
            Registrar primer empleado
          </Button>
        }
      />

      <Sheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title={
          editing
            ? `Empleado #${editing.codigo_empleado} · ${editing.nombre_completo}`
            : 'Nuevo empleado'
        }
        description="Datos generales para reloj checador y fotografía privada (≤ 720 px)."
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setSheetOpen(false)}
            >
              Cerrar
            </Button>
            <Button
              type="submit"
              form="empleado-sheet-form"
              disabled={submitting}
            >
              {submitting
                ? 'Guardando…'
                : editing
                  ? 'Guardar datos'
                  : 'Crear empleado'}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-[var(--s-5)]">
          <Form {...form}>
            <form
              id="empleado-sheet-form"
              noValidate
              onSubmit={form.handleSubmit(handleSave)}
              className="flex flex-col gap-[var(--s-4)]"
            >
              <div className="grid grid-cols-1 gap-[var(--s-3)] sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="codigo_empleado"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Código de empleado (Reloj / Nómina)</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="1001"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="credencial"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Número de tarjeta / credencial</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="CRD-1001"
                          {...field}
                          value={field.value ?? ''}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="nombre_completo"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nombre completo</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Alejandro Hernández Soto"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-1 gap-[var(--s-3)] sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="departamento"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Departamento</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Producción"
                          {...field}
                          value={field.value ?? ''}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="puesto"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Puesto</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Operador CNC"
                          {...field}
                          value={field.value ?? ''}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-1 gap-[var(--s-3)] sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="sucursal_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Planta / Sucursal</FormLabel>
                      <FormControl>
                        <select
                          value={field.value ?? ''}
                          onChange={(e) =>
                            field.onChange(e.target.value || null)
                          }
                          className="ios-input w-full px-[var(--s-3)] text-sm"
                        >
                          <option value="">Sin sucursal asignada</option>
                          {sucursales.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.clave} — {s.nombre}
                            </option>
                          ))}
                        </select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="estatus_empleado"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Estatus en nómina</FormLabel>
                      <FormControl>
                        <select
                          value={field.value ?? 'A'}
                          onChange={(e) =>
                            field.onChange(
                              e.target.value === 'I' ? 'I' : 'A',
                            )
                          }
                          className="ios-input w-full px-[var(--s-3)] text-sm"
                        >
                          <option value="A">Activo (A)</option>
                          <option value="I">Inactivo / Baja (I)</option>
                        </select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </form>
          </Form>

          {/* Componente PhotoUploader disponible tanto al crear como al editar */}
          <div ref={photoSectionRef} className="pt-[var(--s-2)]">
            <PhotoUploader
              key={editing?.id ?? 'new-empleado'}
              empleadoId={editing?.id ?? null}
              nombreEmpleado={
                editing?.nombre_completo ??
                (form.watch('nombre_completo') || 'Nuevo empleado')
              }
              value={
                editing
                  ? (editing.foto_signed_url ?? editing.foto_thumb_signed_url)
                  : null
              }
              onStagedChange={setStagedPhoto}
              onSaved={() => {
                void queryClient.invalidateQueries({
                  queryKey: ['empleados-list'],
                });
              }}
            />
          </div>
        </div>
      </Sheet>

      {/* Diálogo de confirmación para inhabilitar / habilitar empleado */}
      <dialog
        ref={statusDialogRef}
        aria-labelledby="empleado-status-dialog-title"
        className="fixed inset-0 z-50 m-auto hidden max-h-[85vh] w-[min(92vw,460px)] flex-col overflow-hidden rounded-[var(--r-xl)] border border-[var(--separator)] bg-[var(--surface)] p-0 text-[var(--text)] shadow-[var(--shadow-2)] backdrop:bg-black/50 backdrop:backdrop-blur-sm open:flex"
        {...({ closedby: 'any' } as React.DialogHTMLAttributes<HTMLDialogElement>)}
      >
        <div className="flex items-center justify-between border-b border-[var(--separator)] bg-[var(--surface-translucent)] px-[var(--s-5)] py-[var(--s-4)] backdrop-blur-[var(--blur)]">
          <div className="flex items-center gap-[var(--s-2)]">
            <div
              className={`flex size-8 items-center justify-center rounded-full ${
                statusTarget?.nuevoEstatus === 'I'
                  ? 'bg-[var(--danger-bg)] text-[var(--danger)]'
                  : 'bg-[var(--success-bg)] text-[var(--success)]'
              }`}
            >
              {statusTarget?.nuevoEstatus === 'I' ? (
                <UserX className="size-4" strokeWidth={2} aria-hidden="true" />
              ) : (
                <UserCheck className="size-4" strokeWidth={2} aria-hidden="true" />
              )}
            </div>
            <h2
              id="empleado-status-dialog-title"
              className="text-base font-semibold text-[var(--text)]"
            >
              {statusTarget?.nuevoEstatus === 'I'
                ? 'Inhabilitar empleado'
                : 'Habilitar empleado'}
            </h2>
          </div>
          <Button
            type="button"
            variant="plain"
            aria-label="Cerrar diálogo de estatus"
            onClick={() => setStatusTarget(null)}
            disabled={updatingStatus}
            className="size-8 p-0"
          >
            <X className="size-4" strokeWidth={1.75} aria-hidden="true" />
          </Button>
        </div>

        <div className="ios-sheet-body flex-1 overflow-y-auto px-[var(--s-5)] py-[var(--s-4)]">
          <p className="text-sm leading-relaxed text-[var(--text)]">
            {statusTarget?.nuevoEstatus === 'I' ? (
              <>
                ¿Estás seguro de que deseas inhabilitar al empleado{' '}
                <span className="font-semibold text-[var(--text)]">
                  {statusTarget.empleado.nombre_completo}
                </span>{' '}
                (Código{' '}
                <code className="rounded bg-[var(--surface-2)] px-1 py-0.5 font-mono text-xs font-semibold">
                  {statusTarget.empleado.codigo_empleado}
                </code>
                )? Pasará a estatus de{' '}
                <span className="font-semibold text-[var(--danger)]">
                  Baja / Inactivo (I)
                </span>{' '}
                y no se procesarán sus registros de checadas como activo.
              </>
            ) : (
              <>
                ¿Deseas habilitar nuevamente al empleado{' '}
                <span className="font-semibold text-[var(--text)]">
                  {statusTarget?.empleado.nombre_completo}
                </span>{' '}
                (Código{' '}
                <code className="rounded bg-[var(--surface-2)] px-1 py-0.5 font-mono text-xs font-semibold">
                  {statusTarget?.empleado.codigo_empleado}
                </code>
                )? Su estatus volverá a ser{' '}
                <span className="font-semibold text-[var(--success)]">
                  Activo (A)
                </span>
                .
              </>
            )}
          </p>
        </div>

        <div className="ios-sheet-footer flex items-center justify-end gap-[var(--s-2)] border-t border-[var(--separator)] bg-[var(--surface-translucent)] px-[var(--s-5)] py-[var(--s-3)] backdrop-blur-[var(--blur)]">
          <Button
            type="button"
            variant="secondary"
            onClick={() => setStatusTarget(null)}
            disabled={updatingStatus}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            variant={statusTarget?.nuevoEstatus === 'I' ? 'destructive' : 'primary'}
            onClick={() => void handleConfirmStatusChange()}
            disabled={updatingStatus}
          >
            {statusTarget?.nuevoEstatus === 'I' ? (
              <UserX className="size-4" aria-hidden="true" />
            ) : (
              <UserCheck className="size-4" aria-hidden="true" />
            )}
            <span>
              {updatingStatus
                ? 'Actualizando…'
                : statusTarget?.nuevoEstatus === 'I'
                  ? 'Inhabilitar empleado'
                  : 'Habilitar empleado'}
            </span>
          </Button>
        </div>
      </dialog>
    </AppShell>
  );
}
