'use client';

import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, Pencil, Plus, Users } from 'lucide-react';
import {
  EmpleadoCreateSchema,
  EmpleadoUpdateSchema,
} from '@sm-clock/contracts';
import { PhotoUploader } from '@/components/features/empleados/photo-uploader';
import { AppShell } from '@/components/layout/app-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DataTable,
  type DataTableColumnDef,
} from '@/components/ui/data-table/data-table';
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

  const [codigoEmpleado, setCodigoEmpleado] = React.useState('');
  const [nombreCompleto, setNombreCompleto] = React.useState('');
  const [credencial, setCredencial] = React.useState('');
  const [departamento, setDepartamento] = React.useState('');
  const [puesto, setPuesto] = React.useState('');
  const [sucursalId, setSucursalId] = React.useState('');
  const [estatusEmpleado, setEstatusEmpleado] = React.useState<'A' | 'I'>('A');
  const [submitting, setSubmitting] = React.useState(false);

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

  function openNewSheet() {
    setEditing(null);
    setCodigoEmpleado('');
    setNombreCompleto('');
    setCredencial('');
    setDepartamento('');
    setPuesto('');
    setSucursalId(sucursales[0]?.id ?? '');
    setEstatusEmpleado('A');
    setSheetOpen(true);
  }

  function openEditSheet(row: EmpleadoRow) {
    setEditing(row);
    setCodigoEmpleado(row.codigo_empleado);
    setNombreCompleto(row.nombre_completo);
    setCredencial(row.credencial ?? '');
    setDepartamento(row.departamento ?? '');
    setPuesto(row.puesto ?? '');
    setSucursalId(row.sucursal_id ?? '');
    setEstatusEmpleado(row.estatus_empleado);
    setSheetOpen(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const rawPayload = {
      ...(editing ? { id: editing.id } : {}),
      codigo_empleado: codigoEmpleado,
      nombre_completo: nombreCompleto,
      credencial: credencial || null,
      departamento: departamento || null,
      puesto: puesto || null,
      sucursal_id: sucursalId || null,
      estatus_empleado: estatusEmpleado,
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
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-[var(--s-2)]">
            <Button
              variant="secondary"
              onClick={() => openEditSheet(row.original)}
            >
              <Camera className="size-3.5" aria-hidden="true" />
              <Pencil className="size-3.5" aria-hidden="true" />
              Editar / Foto
            </Button>
          </div>
        ),
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
      >
        <div className="flex flex-col gap-[var(--s-5)]">
          <form
            onSubmit={(e) => void handleSave(e)}
            className="flex flex-col gap-[var(--s-4)]"
          >
            <div className="grid grid-cols-1 gap-[var(--s-3)] sm:grid-cols-2">
              <div className="flex flex-col gap-[var(--s-1)]">
                <label htmlFor="emp-codigo" className="ios-label">
                  Código de empleado (Reloj / Nómina)
                </label>
                <Input
                  id="emp-codigo"
                  required
                  placeholder="1001"
                  value={codigoEmpleado}
                  onChange={(e) => setCodigoEmpleado(e.target.value)}
                />
              </div>

              <div className="flex flex-col gap-[var(--s-1)]">
                <label htmlFor="emp-credencial" className="ios-label">
                  Número de tarjeta / credencial
                </label>
                <Input
                  id="emp-credencial"
                  placeholder="CRD-1001"
                  value={credencial}
                  onChange={(e) => setCredencial(e.target.value)}
                />
              </div>
            </div>

            <div className="flex flex-col gap-[var(--s-1)]">
              <label htmlFor="emp-nombre" className="ios-label">
                Nombre completo
              </label>
              <Input
                id="emp-nombre"
                required
                placeholder="Alejandro Hernández Soto"
                value={nombreCompleto}
                onChange={(e) => setNombreCompleto(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-1 gap-[var(--s-3)] sm:grid-cols-2">
              <div className="flex flex-col gap-[var(--s-1)]">
                <label htmlFor="emp-depto" className="ios-label">
                  Departamento
                </label>
                <Input
                  id="emp-depto"
                  placeholder="Producción"
                  value={departamento}
                  onChange={(e) => setDepartamento(e.target.value)}
                />
              </div>

              <div className="flex flex-col gap-[var(--s-1)]">
                <label htmlFor="emp-puesto" className="ios-label">
                  Puesto
                </label>
                <Input
                  id="emp-puesto"
                  placeholder="Operador CNC"
                  value={puesto}
                  onChange={(e) => setPuesto(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-[var(--s-3)] sm:grid-cols-2">
              <div className="flex flex-col gap-[var(--s-1)]">
                <label htmlFor="emp-sucursal" className="ios-label">
                  Planta / Sucursal
                </label>
                <select
                  id="emp-sucursal"
                  value={sucursalId}
                  onChange={(e) => setSucursalId(e.target.value)}
                  className="ios-input w-full px-[var(--s-3)] text-sm"
                >
                  <option value="">Sin sucursal asignada</option>
                  {sucursales.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.clave} — {s.nombre}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-[var(--s-1)]">
                <label htmlFor="emp-estatus" className="ios-label">
                  Estatus en nómina
                </label>
                <select
                  id="emp-estatus"
                  value={estatusEmpleado}
                  onChange={(e) =>
                    setEstatusEmpleado(e.target.value === 'I' ? 'I' : 'A')
                  }
                  className="ios-input w-full px-[var(--s-3)] text-sm"
                >
                  <option value="A">Activo (A)</option>
                  <option value="I">Inactivo / Baja (I)</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-[var(--s-2)] pt-[var(--s-2)]">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setSheetOpen(false)}
              >
                Cerrar
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting
                  ? 'Guardando…'
                  : editing
                    ? 'Guardar datos'
                    : 'Crear empleado'}
              </Button>
            </div>
          </form>

          {/* Componente PhotoUploader disponible en cuanto el empleado tiene ID */}
          {editing && (
            <PhotoUploader
              empleadoId={editing.id}
              nombreEmpleado={editing.nombre_completo}
              value={editing.foto_signed_url ?? editing.foto_thumb_signed_url}
              onSaved={() => {
                void queryClient.invalidateQueries({
                  queryKey: ['empleados-list'],
                });
              }}
            />
          )}
        </div>
      </Sheet>
    </AppShell>
  );
}
