'use client';

import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  ClipboardPaste,
  Clock,
  ExternalLink,
  LocateFixed,
  MapPin,
  Pencil,
  Plus,
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
  isValidLatLng,
  parseGoogleMapsCoordinates,
  SucursalCreateSchema,
  SucursalUpdateSchema,
} from '@sm-clock/contracts';
import type { z } from 'zod';

type SucursalFormInput = z.input<typeof SucursalCreateSchema>;
type SucursalFormOutput = z.output<typeof SucursalCreateSchema>;
import {
  buildGoogleMapsSearchUrl,
  LocationMapPreview,
} from '@/components/features/geolocalizacion/location-map-preview';
import { useTenantChannel } from '@/lib/realtime/use-tenant-channel';
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

const DEFAULT_TIJUANA_LAT = 32.514947;
const DEFAULT_TIJUANA_LNG = -117.038247;

export type FuenteAsistenciaSucursal = {
  id: string;
  clave: string | null;
  consecutivo_sucursal: number | null;
  nombre_ubicacion: string;
  marca: 'ZKTECO' | 'HIKVISION' | 'TACLOUD';
  modelo: string | null;
  ip_local: string | null;
  puerto: number;
  activo: boolean;
  ultima_conexion_exitosa: string | null;
  ultimo_error: string | null;
};

type SucursalRow = {
  id: string;
  tenant_id: string;
  clave: string;
  nombre: string;
  direccion: string | null;
  latitud: number | null;
  longitud: number | null;
  radio_geocerca_m: number;
  activa: boolean;
  created_at: string;
  fuentes_asistencia?: FuenteAsistenciaSucursal[];
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
  const [sortBy, setSortBy] = React.useState('clave');
  const [sortDir, setSortDir] = React.useState<'asc' | 'desc'>('asc');

  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<SucursalRow | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [mapsPasteText, setMapsPasteText] = React.useState('');
  const [gettingGps, setGettingGps] = React.useState(false);
  const [previewMapRow, setPreviewMapRow] = React.useState<SucursalRow | null>(
    null,
  );
  const [selectedSucursalForRelojes, setSelectedSucursalForRelojes] =
    React.useState<SucursalRow | null>(null);

  const form = useForm<SucursalFormInput, unknown, SucursalFormOutput>({
    resolver: zodResolver(SucursalCreateSchema),
    defaultValues: {
      clave: '',
      nombre: '',
      direccion: '',
      latitud: DEFAULT_TIJUANA_LAT,
      longitud: DEFAULT_TIJUANA_LNG,
      radio_geocerca_m: 150,
      activa: true,
    },
    mode: 'onTouched',
  });

  const watchedLat = Number(form.watch('latitud'));
  const watchedLng = Number(form.watch('longitud'));
  const watchedRadio = Number(form.watch('radio_geocerca_m')) || 150;
  const watchedNombre = form.watch('nombre');
  const watchedDireccion = form.watch('direccion');

  const hasValidCoords = isValidLatLng(watchedLat, watchedLng);

  const { data, isLoading } = useQuery<SucursalesResponse>({
    queryKey: ['sucursales-list', page, pageSize, search, sortBy, sortDir],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        search,
        sortBy,
        sortDir,
      });
      const res = await fetch(`/api/sucursales?${params.toString()}`);
      if (!res.ok) {
        throw new Error('Error al cargar sucursales');
      }
      return (await res.json()) as SucursalesResponse;
    },
  });

  const { status: realtimeState } = useTenantChannel({
    queryKeysToInvalidate: [['sucursales-list']],
    events: ['*'],
  });

  function openNewSheet() {
    setEditing(null);
    setMapsPasteText('');
    form.reset({
      clave: '',
      nombre: '',
      direccion: '',
      latitud: DEFAULT_TIJUANA_LAT,
      longitud: DEFAULT_TIJUANA_LNG,
      radio_geocerca_m: 150,
      activa: true,
    });
    setSheetOpen(true);
  }

  function openEditSheet(row: SucursalRow) {
    setEditing(row);
    setMapsPasteText(
      row.latitud != null && row.longitud != null
        ? `${row.latitud}, ${row.longitud}`
        : '',
    );
    form.reset({
      clave: row.clave,
      nombre: row.nombre,
      direccion: row.direccion ?? '',
      latitud: row.latitud ?? DEFAULT_TIJUANA_LAT,
      longitud: row.longitud ?? DEFAULT_TIJUANA_LNG,
      radio_geocerca_m: row.radio_geocerca_m ?? 150,
      activa: row.activa,
    });
    setSheetOpen(true);
  }

  function applyMapsInput(rawText: string) {
    setMapsPasteText(rawText);
    const extracted = parseGoogleMapsCoordinates(rawText);
    if (extracted) {
      form.setValue('latitud', extracted.latitud, {
        shouldDirty: true,
        shouldValidate: true,
      });
      form.setValue('longitud', extracted.longitud, {
        shouldDirty: true,
        shouldValidate: true,
      });
      toast({
        title: 'Coordenadas extraídas automáticamente',
        description: `Latitud: ${extracted.latitud}, Longitud: ${extracted.longitud}`,
        variant: 'success',
      });
    }
  }

  async function handlePasteFromClipboard() {
    try {
      const clip = await navigator.clipboard.readText();
      if (!clip.trim()) {
        toast({
          title: 'Portapapeles vacío',
          description: 'Copia las coordenadas o el enlace de Google Maps primero.',
          variant: 'warning',
        });
        return;
      }
      const extracted = parseGoogleMapsCoordinates(clip);
      setMapsPasteText(clip);
      if (extracted) {
        form.setValue('latitud', extracted.latitud, {
          shouldDirty: true,
          shouldValidate: true,
        });
        form.setValue('longitud', extracted.longitud, {
          shouldDirty: true,
          shouldValidate: true,
        });
        toast({
          title: 'Ubicación validada desde portapapeles',
          description: `Se actualizaron las coordenadas a (${extracted.latitud}, ${extracted.longitud}).`,
          variant: 'success',
        });
      } else {
        toast({
          title: 'No se detectaron coordenadas en el texto copiado',
          description:
            'Pega un enlace de Google Maps (con @lat,lng) o coordenadas como "32.5435, -116.9355".',
          variant: 'warning',
        });
      }
    } catch {
      toast({
        title: 'Pega el texto directamente en la caja',
        description:
          'Usa Cmd+V o Ctrl+V en el campo de enlace o coordenadas de Google Maps.',
        variant: 'default',
      });
    }
  }

  function handleUseCurrentGps() {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      toast({
        title: 'Geolocalización no disponible',
        description: 'Tu navegador no soporta geolocalización GPS.',
        variant: 'danger',
      });
      return;
    }

    setGettingGps(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGettingGps(false);
        const lat = Number(pos.coords.latitude.toFixed(6));
        const lng = Number(pos.coords.longitude.toFixed(6));
        form.setValue('latitud', lat, {
          shouldDirty: true,
          shouldValidate: true,
        });
        form.setValue('longitud', lng, {
          shouldDirty: true,
          shouldValidate: true,
        });
        setMapsPasteText(`${lat}, ${lng}`);
        toast({
          title: 'Ubicación GPS obtenida',
          description: `Coordenadas establecidas en (${lat}, ${lng}).`,
          variant: 'success',
        });
      },
      (err) => {
        setGettingGps(false);
        toast({
          title: 'No se pudo obtener el GPS actual',
          description:
            err.code === err.PERMISSION_DENIED
              ? 'Autoriza el permiso de ubicación en tu navegador o pega las coordenadas desde Google Maps.'
              : 'Puedes abrir Google Maps y pegar las coordenadas directamente.',
          variant: 'warning',
        });
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
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
        description: 'La ubicación geográfica y geocerca quedaron guardadas.',
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
          <div className="flex flex-col">
            <span className="font-semibold text-[var(--text)]">
              {row.original.nombre}
            </span>
            <span className="text-xs text-[var(--text-2)]">
              {row.original.direccion ?? 'Sin dirección registrada'}
            </span>
          </div>
        ),
      },
      {
        id: 'geolocalizacion',
        header: 'Ubicación GPS y Mapa',
        accessorFn: (r: SucursalRow) =>
          r.latitud != null && r.longitud != null
            ? `${r.latitud.toFixed(5)}, ${r.longitud.toFixed(5)}`
            : 'Sin coordenadas',
        cell: ({ row }) => {
          const lat = row.original.latitud;
          const lng = row.original.longitud;
          if (lat == null || lng == null) {
            return (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => openEditSheet(row.original)}
              >
                <MapPin className="size-3.5" aria-hidden="true" />
                Agregar ubicación
              </Button>
            );
          }
          return (
            <div className="flex items-center gap-[var(--s-2)]">
              <Badge variant="success">
                <CheckCircle2 className="mr-1 size-3" aria-hidden="true" />
                {lat.toFixed(4)}, {lng.toFixed(4)} · {row.original.radio_geocerca_m}m
              </Badge>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setPreviewMapRow(row.original)}
              >
                <MapPin className="size-3.5 text-[var(--accent)]" aria-hidden="true" />
                Ver mapa
              </Button>
            </div>
          );
        },
      },
      {
        id: 'relojes',
        header: 'Relojes Checadores',
        cell: ({ row }) => {
          const relojes = row.original.fuentes_asistencia ?? [];
          if (relojes.length === 0) {
            return (
              <span className="text-xs text-[var(--text-3)] italic">
                Sin relojes registrados
              </span>
            );
          }
          return (
            <div className="flex flex-wrap items-center gap-1.5">
              {relojes.map((r) => (
                <button
                  type="button"
                  key={r.id}
                  onClick={() => setSelectedSucursalForRelojes(row.original)}
                  className="group inline-flex items-center gap-1.5 rounded-[var(--r-sm)] border border-[var(--separator)] bg-[var(--surface-2)] px-2 py-0.5 text-xs transition hover:border-[var(--accent)] hover:bg-[var(--surface)] text-left"
                  title={`${r.nombre_ubicacion} (${r.marca}) · Clic para ver detalles`}
                >
                  <span
                    className={`size-1.5 rounded-full ${
                      r.activo ? 'bg-[var(--success)]' : 'bg-[var(--text-3)]'
                    }`}
                  />
                  <code className="font-mono font-semibold text-[var(--text)]">
                    {r.clave ?? r.nombre_ubicacion}
                  </code>
                  <Badge variant="neutral" className="text-[10px] py-0 px-1 font-mono">
                    {r.marca}
                  </Badge>
                </button>
              ))}
            </div>
          );
        },
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
                  id: 'ver-relojes',
                  label: 'Ver relojes checadores',
                  icon: Clock,
                  onClick: () => setSelectedSucursalForRelojes(row.original),
                },
                {
                  id: 'ver-mapa',
                  label: 'Ver ubicación en mapa',
                  icon: MapPin,
                  onClick: () => {
                    if (
                      row.original.latitud != null &&
                      row.original.longitud != null
                    ) {
                      setPreviewMapRow(row.original);
                    } else {
                      openEditSheet(row.original);
                    }
                  },
                },
                {
                  id: 'editar',
                  label: 'Editar sucursal y GPS',
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
        header: 'Latitud',
        accessor: (r: SucursalRow) =>
          r.latitud != null ? r.latitud.toFixed(6) : '',
      },
      {
        header: 'Longitud',
        accessor: (r: SucursalRow) =>
          r.longitud != null ? r.longitud.toFixed(6) : '',
      },
      {
        header: 'Geocerca (m)',
        accessor: (r: SucursalRow) => String(r.radio_geocerca_m ?? 150),
      },
      {
        header: 'Estatus',
        accessor: (r: SucursalRow) => (r.activa ? 'Activa' : 'Inactiva'),
      },
    ],
    [],
  );

  const googleMapsQueryUrl = buildGoogleMapsSearchUrl(
    watchedDireccion?.trim() ||
      watchedNombre?.trim() ||
      'Tijuana, Baja California, México',
  );

  return (
    <AppShell
      title="Sucursales y Plantas"
      subtitle="Ubicaciones geográficas, mapas y geocercas para relojes checadores y Kiosco Digital"
      mode="client"
      realtimeState={realtimeState}
      actions={
        <Button onClick={openNewSheet}>
          <Plus className="size-4" aria-hidden="true" />
          Nueva sucursal
        </Button>
      }
    >
      <DataTable
        caption="Catálogo de sucursales de la empresa con geolocalización"
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
        sortBy={sortBy}
        sortDir={sortDir}
        onSortChange={(colId, dir) => {
          setSortBy(colId);
          setSortDir(dir);
        }}
        isLoading={isLoading}
        exportFilename="sucursales-geolocalizacion-sm-clock"
        exportColumns={exportColumns}
        emptyTitle="Sin sucursales registradas"
        emptyDescription="Registra las plantas o sucursales con su ubicación en el mapa para asignar empleados."
        emptyAction={
          <Button onClick={openNewSheet}>
            <MapPin className="size-4" aria-hidden="true" />
            Registrar primera sucursal
          </Button>
        }
      />

      {/* Sheet de vista previa rápida del mapa de una sucursal */}
      <Sheet
        open={Boolean(previewMapRow)}
        onOpenChange={(open) => {
          if (!open) setPreviewMapRow(null);
        }}
        title={
          previewMapRow
            ? `Ubicación · ${previewMapRow.nombre}`
            : 'Ubicación de sucursal'
        }
        description={
          previewMapRow?.direccion ??
          'Coordenadas geográficas y radio de geocerca registrados para esta planta.'
        }
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setPreviewMapRow(null)}
            >
              Cerrar
            </Button>
            {previewMapRow && (
              <Button
                type="button"
                onClick={() => {
                  const row = previewMapRow;
                  setPreviewMapRow(null);
                  openEditSheet(row);
                }}
              >
                <Pencil className="size-4" aria-hidden="true" />
                Editar coordenadas
              </Button>
            )}
          </>
        }
      >
        {previewMapRow &&
          previewMapRow.latitud != null &&
          previewMapRow.longitud != null && (
            <div className="flex flex-col gap-[var(--s-4)]">
              <LocationMapPreview
                latitud={previewMapRow.latitud}
                longitud={previewMapRow.longitud}
                titulo={`${previewMapRow.clave} · ${previewMapRow.nombre}`}
                radioGeocercaM={previewMapRow.radio_geocerca_m}
                heightClassName="h-72"
              />
            </div>
          )}
      </Sheet>

      {/* Sheet de Alta / Edición de Sucursal con Asistente de Geolocalización y Mapa por defecto */}
      <Sheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title={editing ? 'Editar sucursal y geolocalización' : 'Nueva sucursal'}
        description="Define la clave, dirección y valida en el mapa la ubicación geográfica exacta de la sucursal."
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
            <div className="grid grid-cols-1 gap-[var(--s-3)] sm:grid-cols-2">
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
            </div>

            <FormField
              control={form.control}
              name="nombre"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nombre de la planta o sucursal</FormLabel>
                  <FormControl>
                    <Input placeholder="Planta Industrial Otay" {...field} />
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
                  <FormLabel>Dirección física</FormLabel>
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

            {/* Asistente automatizado de Geolocalización y Google Maps */}
            <div className="rounded-[var(--r-lg)] border border-[var(--border)] bg-[var(--surface-2)] p-[var(--s-3)]">
              <div className="mb-[var(--s-2)] flex flex-wrap items-center justify-between gap-[var(--s-2)]">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text)]">
                    Geolocalización y Mapa de la Sucursal
                  </p>
                  <p className="text-xs text-[var(--text-2)]">
                    Abre Google Maps, copia el enlace o coordenadas y pégalas aquí para ubicar el pin automáticamente.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-[var(--s-2)]">
                  <a
                    href={googleMapsQueryUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-8 items-center gap-[var(--s-1)] rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface)] px-[var(--s-3)] text-xs font-semibold text-[var(--accent)] shadow-[var(--shadow-1)] transition-colors hover:bg-[var(--accent-soft)]"
                  >
                    <span>1. Abrir Google Maps</span>
                    <ExternalLink className="size-3.5" aria-hidden="true" />
                  </a>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={handlePasteFromClipboard}
                  >
                    <ClipboardPaste className="size-3.5" aria-hidden="true" />
                    2. Pegar del portapapeles
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={handleUseCurrentGps}
                    disabled={gettingGps}
                  >
                    <LocateFixed className="size-3.5" aria-hidden="true" />
                    {gettingGps ? 'Ubicando GPS…' : 'Usar mi GPS actual'}
                  </Button>
                </div>
              </div>

              <div className="mb-[var(--s-3)]">
                <label
                  htmlFor="google-maps-paste-input"
                  className="mb-[var(--s-1)] block text-xs font-medium text-[var(--text-2)]"
                >
                  Pegar enlace de Google Maps o coordenadas (ej.{' '}
                  <code className="font-mono">32.5435, -116.9355</code> o URL con{' '}
                  <code className="font-mono">@32.5435,-116.9355</code>)
                </label>
                <Input
                  id="google-maps-paste-input"
                  value={mapsPasteText}
                  onChange={(e) => applyMapsInput(e.target.value)}
                  placeholder="Pega aquí la URL de Google Maps o las coordenadas latitud, longitud…"
                />
              </div>

              <div className="grid grid-cols-1 gap-[var(--s-3)] sm:grid-cols-3">
                <FormField
                  control={form.control}
                  name="latitud"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Latitud</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.000001"
                          placeholder="32.543500"
                          name={field.name}
                          ref={field.ref}
                          onBlur={field.onBlur}
                          value={
                            field.value !== undefined && field.value !== null
                              ? String(field.value)
                              : ''
                          }
                          onChange={(e) => {
                            const num = Number(e.target.value);
                            field.onChange(
                              e.target.value === '' || Number.isNaN(num)
                                ? 0
                                : num,
                            );
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="longitud"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Longitud</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.000001"
                          placeholder="-116.935500"
                          name={field.name}
                          ref={field.ref}
                          onBlur={field.onBlur}
                          value={
                            field.value !== undefined && field.value !== null
                              ? String(field.value)
                              : ''
                          }
                          onChange={(e) => {
                            const num = Number(e.target.value);
                            field.onChange(
                              e.target.value === '' || Number.isNaN(num)
                                ? 0
                                : num,
                            );
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="radio_geocerca_m"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Geocerca (metros)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={20}
                          max={10000}
                          step={10}
                          placeholder="150"
                          name={field.name}
                          ref={field.ref}
                          onBlur={field.onBlur}
                          value={
                            field.value !== undefined && field.value !== null
                              ? String(field.value)
                              : '150'
                          }
                          onChange={(e) =>
                            field.onChange(Number(e.target.value) || 150)
                          }
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="mt-[var(--s-3)]">
                {hasValidCoords ? (
                  <LocationMapPreview
                    latitud={watchedLat}
                    longitud={watchedLng}
                    titulo={
                      watchedNombre?.trim() ||
                      'Vista previa de ubicación de la sucursal'
                    }
                    radioGeocercaM={watchedRadio}
                    heightClassName="h-52"
                  />
                ) : (
                  <div className="flex h-40 items-center justify-center rounded-[var(--r-md)] border border-dashed border-[var(--border)] bg-[var(--surface)] p-[var(--s-4)] text-center text-xs text-[var(--text-2)]">
                    Ingresa coordenadas válidas o pégalas desde Google Maps para visualizar el mapa.
                  </div>
                )}
              </div>
            </div>
          </form>
        </Form>
      </Sheet>

      {/* Drawer de Relojes Checadores de la Sucursal */}
      <Sheet
        open={selectedSucursalForRelojes !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedSucursalForRelojes(null);
        }}
        title={`Relojes Checadores · ${selectedSucursalForRelojes?.nombre ?? ''}`}
        description={`Terminales de reloj vinculadas en tiempo real bajo la nomenclatura: Código de tenant + Código de Sucursal (${selectedSucursalForRelojes?.clave ?? ''}) + Consecutivo`}
        footer={
          <div className="flex w-full items-center justify-between">
            <span className="text-xs text-[var(--text-2)]">
              {(selectedSucursalForRelojes?.fuentes_asistencia?.length ?? 0)}{' '}
              terminal(es) configurada(s)
            </span>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setSelectedSucursalForRelojes(null)}
            >
              Cerrar
            </Button>
          </div>
        }
      >
        <div className="ios-sheet-body flex-1 overflow-y-auto p-4 space-y-4">
          {(!selectedSucursalForRelojes?.fuentes_asistencia ||
            selectedSucursalForRelojes.fuentes_asistencia.length === 0) ? (
            <div className="flex flex-col items-center justify-center p-8 text-center rounded-[var(--r-md)] border border-dashed border-[var(--border)] bg-[var(--surface-2)]">
              <Clock className="w-10 h-10 text-[var(--text-3)] mb-2" />
              <p className="font-semibold text-sm text-[var(--text)]">
                No hay relojes checadores registrados en esta sucursal
              </p>
              <p className="text-xs text-[var(--text-2)] max-w-sm mt-1">
                Conecta el Agente Local en la red local (LAN) de la sucursal, realiza la prueba de conectividad y lectura de registros, y da de alta el reloj en tiempo real.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {selectedSucursalForRelojes.fuentes_asistencia.map((reloj) => (
                <div
                  key={reloj.id}
                  className="rounded-[var(--r-md)] border border-[var(--separator)] bg-[var(--surface-2)] p-4 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <code className="text-sm font-bold font-mono text-[var(--accent)] bg-[var(--surface)] px-2 py-0.5 rounded-[var(--r-sm)] border border-[var(--border)]">
                        {reloj.clave ?? 'SIN CLAVE'}
                      </code>
                      <Badge variant="neutral" className="text-xs font-mono">
                        {reloj.marca}
                      </Badge>
                      {reloj.modelo && (
                        <span className="text-xs text-[var(--text-2)]">
                          {reloj.modelo}
                        </span>
                      )}
                    </div>
                    <Badge variant={reloj.activo ? 'success' : 'default'}>
                      {reloj.activo ? 'Activo' : 'Inactivo'}
                    </Badge>
                  </div>

                  <p className="font-medium text-sm text-[var(--text)]">
                    {reloj.nombre_ubicacion}
                  </p>

                  <div className="grid grid-cols-2 gap-2 text-xs text-[var(--text-2)] pt-1 border-t border-[var(--separator)]">
                    <div>
                      <span className="text-[var(--text-3)]">Dirección IP: </span>
                      <span className="font-mono text-[var(--text)]">
                        {reloj.ip_local ?? '—'}:{reloj.puerto}
                      </span>
                    </div>
                    <div>
                      <span className="text-[var(--text-3)]">Consecutivo: </span>
                      <span className="font-mono text-[var(--text)]">
                        #{reloj.consecutivo_sucursal ?? '01'}
                      </span>
                    </div>
                  </div>

                  {reloj.ultima_conexion_exitosa && (
                    <p className="text-[11px] text-[var(--success)] flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" />
                      Última conexión exitosa:{' '}
                      {new Date(reloj.ultima_conexion_exitosa).toLocaleString(
                        'es-MX',
                      )}
                    </p>
                  )}

                  {reloj.ultimo_error && (
                    <p className="text-[11px] text-[var(--danger)]">
                      Último error: {reloj.ultimo_error}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </Sheet>
    </AppShell>
  );
}
