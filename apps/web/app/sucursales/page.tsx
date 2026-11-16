'use client';

import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MapPin, Pencil, Plus } from 'lucide-react';
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
  SucursalCreateSchema,
  SucursalUpdateSchema,
} from '@sm-clock/contracts';
import type { z } from 'zod';

type SucursalFormInput = z.input<typeof SucursalCreateSchema>;
type SucursalFormOutput = z.output<typeof SucursalCreateSchema>;
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

type SucursalRow = {
  id: string;
  tenant_id: string;
  clave: string;
  nombre: string;
  direccion: string | null;
  activa: boolean;
  created_at: string;
};

interface SucursalesResponse {
  data: SucursalRow[];
  total: number;
  page: number;
  pageSize: number;
}

export default function SucursalesPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(25);
  const [search, setSearch] = React.useState('');

  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<SucursalRow | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const form = useForm<SucursalFormInput, unknown, SucursalFormOutput>({
    resolver: zodResolver(SucursalCreateSchema),
    defaultValues: {
      clave: '',
      nombre: '',
      direccion: '',
      activa: true,
    },
    mode: 'onTouched',
  });

  const { data, isLoading } = useQuery<SucursalesResponse>({
    queryKey: ['sucursales-list', page, pageSize, search],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        search,
      });
      const res = await fetch(`/api/sucursales?${params.toString()}`);
      if (!res.ok) {
        throw new Error('Error al cargar sucursales');
      }
      return (await res.json()) as SucursalesResponse;
    },
  });

  function openNewSheet() {
    setEditing(null);
    form.reset({
      clave: '',
      nombre: '',
      direccion: '',
      activa: true,
    });
    setSheetOpen(true);
  }

  function openEditSheet(row: SucursalRow) {
    setEditing(row);
    form.reset({
      clave: row.clave,
      nombre: row.nombre,
      direccion: row.direccion ?? '',
      activa: row.activa,
    });
    setSheetOpen(true);
  }

  async function handleSave(values: SucursalFormOutput) {
    const rawBody = editing
      ? { id: editing.id, ...values, direccion: values.direccion || null }
      : { ...values, direccion: values.direccion || null };

    const parsed = editing
      ? SucursalUpdateSchema.safeParse(rawBody)
      : SucursalCreateSchema.safeParse(rawBody);

    if (!parsed.success) {
      toast({
        title: 'Datos de sucursal inválidos',
        description:
          parsed.error.issues[0]?.message ?? 'Verifica los datos ingresados.',
        variant: 'danger',
      });
      return;
    }

    setSubmitting(true);
    try {
      const method = editing ? 'PATCH' : 'POST';
      const res = await fetch('/api/sucursales', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });

      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast({
          title: 'Error al guardar sucursal',
          description: json.error ?? 'Verifica los datos ingresados.',
          variant: 'danger',
        });
        return;
      }

      setSheetOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['sucursales-list'] });
      toast({
        title: editing ? 'Sucursal actualizada' : 'Sucursal creada',
        variant: 'success',
      });
    } finally {
      setSubmitting(false);
    }
  }

  const columns = React.useMemo<DataTableColumnDef<SucursalRow>[]>(
    () => [
      {
        id: 'clave',
        accessorKey: 'clave',
        header: 'Clave',
        cell: ({ row }) => (
          <code className="rounded-[var(--r-sm)] bg-[var(--surface-2)] px-[var(--s-2)] py-[var(--s-1)] font-mono text-xs font-semibold text-[var(--text)]">
            {row.original.clave}
          </code>
        ),
      },
      {
        id: 'nombre',
        accessorKey: 'nombre',
        header: 'Planta / Sucursal',
        cell: ({ row }) => (
          <span className="font-semibold text-[var(--text)]">
            {row.original.nombre}
          </span>
        ),
      },
      {
        id: 'direccion',
        accessorKey: 'direccion',
        header: 'Dirección en Tijuana / B.C.',
        cell: ({ row }) => (
          <span className="text-xs text-[var(--text-2)]">
            {row.original.direccion ?? '—'}
          </span>
        ),
      },
      {
        id: 'activa',
        accessorKey: 'activa',
        header: 'Estatus',
        cell: ({ row }) => (
          <Badge variant={row.original.activa ? 'success' : 'default'}>
            {row.original.activa ? 'Activa' : 'Inactiva'}
          </Badge>
        ),
      },
      {
        id: 'acciones',
        header: 'Acciones',
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex justify-end">
            <TableActionsMenu
              label={`Acciones para ${row.original.nombre}`}
              actions={[
                {
                  id: 'editar',
                  label: 'Editar',
                  icon: Pencil,
                  onClick: () => openEditSheet(row.original),
                },
              ]}
            />
          </div>
        ),
      },
    ],
    [],
  );

  const exportColumns = React.useMemo<ExportColumn<SucursalRow>[]>(
    () => [
      { header: 'Clave', accessor: (r: SucursalRow) => r.clave },
      { header: 'Nombre', accessor: (r: SucursalRow) => r.nombre },
      { header: 'Dirección', accessor: (r: SucursalRow) => r.direccion ?? '' },
      {
        header: 'Estatus',
        accessor: (r: SucursalRow) => (r.activa ? 'Activa' : 'Inactiva'),
      },
    ],
    [],
  );

  return (
    <AppShell
      title="Sucursales y Plantas"
      subtitle="Ubicaciones físicas donde operan los relojes checadores ZKTeco y Hikvision"
      mode="client"
      actions={
        <Button onClick={openNewSheet}>
          <Plus className="size-4" aria-hidden="true" />
          Nueva sucursal
        </Button>
      }
    >
      <DataTable
        caption="Catálogo de sucursales de la empresa"
        columns={columns}
        data={data?.data ?? []}
        total={data?.total ?? 0}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Buscar por clave o nombre de planta…"
        isLoading={isLoading}
        exportFilename="sucursales-sm-clock"
        exportColumns={exportColumns}
        emptyTitle="Sin sucursales registradas"
        emptyDescription="Registra las plantas o sucursales para asignar empleados y relojes checadores."
        emptyAction={
          <Button onClick={openNewSheet}>
            <MapPin className="size-4" aria-hidden="true" />
            Registrar primera sucursal
          </Button>
        }
      />

      <Sheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title={editing ? 'Editar sucursal' : 'Nueva sucursal'}
        description="Define la clave y ubicación de la planta o centro de trabajo."
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
              form="sucursal-sheet-form"
              disabled={submitting}
            >
              {submitting ? 'Guardando…' : 'Guardar sucursal'}
            </Button>
          </>
        }
      >
        <Form {...form}>
          <form
            id="sucursal-sheet-form"
            noValidate
            onSubmit={form.handleSubmit(handleSave)}
            className="flex flex-col gap-[var(--s-4)]"
          >
            <FormField
              control={form.control}
              name="clave"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Clave de sucursal</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="OTAY-1"
                      {...field}
                      onChange={(e) =>
                        field.onChange(e.target.value.toUpperCase())
                      }
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="nombre"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nombre de la planta o sucursal</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Planta Industrial Otay"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="direccion"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Dirección</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Blvd. Bellas Artes 1850, Cd. Industrial Otay, Tijuana"
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
              name="activa"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Estatus operativo</FormLabel>
                  <FormControl>
                    <select
                      value={field.value ? '1' : '0'}
                      onChange={(e) => field.onChange(e.target.value === '1')}
                      className="ios-input w-full px-[var(--s-3)] text-sm"
                    >
                      <option value="1">Activa</option>
                      <option value="0">Inactiva</option>
                    </select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>
      </Sheet>
    </AppShell>
  );
}
