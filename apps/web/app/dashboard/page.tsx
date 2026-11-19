'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  Clock,
  Cpu,
  ExternalLink,
  Fingerprint,
  MapPin,
  UserCheck,
  UserX,
} from 'lucide-react';
import { LocationMapPreview } from '@/components/features/geolocalizacion/location-map-preview';
import { AppShell } from '@/components/layout/app-shell';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChartCard, type ChartDataPoint } from '@/components/ui/chart-card';
import {
  DataTable,
  type DataTableColumnDef,
} from '@/components/ui/data-table/data-table';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Sheet } from '@/components/ui/sheet';
import { StatCard } from '@/components/ui/stat-card';
import type { ExportColumn } from '@/lib/export/exporters';
import { useTenantChannel } from '@/lib/realtime/use-tenant-channel';

type FiltroMarca = 'TODAS' | 'ENTRADA' | 'SALIDA' | 'AMBIGUAS';

type ChecadaRow = {
  id: number;
  tenant_id: string;
  fuente_id: string;
  sucursal_id?: string | null;
  codigo_empleado: string;
  nombre_empleado: string;
  departamento: string;
  ts_utc: string;
  ts_dispositivo_local: string;
  ambigua: boolean;
  tipo_marca: 'ENTRADA' | 'SALIDA' | 'CHECADA';
  tipo_verificacion:
    | 'HUELLA'
    | 'ROSTRO'
    | 'TARJETA'
    | 'API'
    | 'PIN'
    | 'WEBAUTHN'
    | null;
  latitud?: number | null;
  longitud?: number | null;
  precision_m?: number | null;
  distancia_sucursal_m?: number | null;
  dentro_geocerca?: boolean | null;
  sucursal_asignada?: {
    id: string;
    clave: string;
    nombre: string;
    direccion: string | null;
    latitud: number | null;
    longitud: number | null;
    radio_geocerca_m: number;
  } | null;
  fuentes_asistencia?: {
    nombre_ubicacion: string;
    marca: string;
  } | null;
};

interface DashboardChecadasResponse {
  tenant: {
    id: string;
    tenant_code: string;
    nombre_comercial: string;
    zona_horaria: string;
    estatus: string;
  };
  kpis: {
    presentesHoy: number;
    plantillaActiva: number;
    retardosHoy: number;
    faltasHoy: number;
    checadasUltimaHora: number;
    relojesEnLinea: number;
    relojesTotales: number;
    agentesEnLinea: number;
  };
  charts: {
    hourlySeries: ChartDataPoint[];
    departmentSeries: ChartDataPoint[];
  };
  data: ChecadaRow[];
  total: number;
  page: number;
  pageSize: number;
}

function formatDistanceLabel(meters: number | null | undefined): string {
  if (meters == null || !Number.isFinite(meters)) return '—';
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(2)} km`;
  }
  return `${Math.round(meters)} m`;
}

export default function DashboardPage() {
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(25);
  const [search, setSearch] = React.useState('');
  const [filtroMarca, setFiltroMarca] = React.useState<FiltroMarca>('TODAS');
  const [sortBy, setSortBy] = React.useState('ts_utc');
  const [sortDir, setSortDir] = React.useState<'asc' | 'desc'>('desc');
  const [selectedGeoChecada, setSelectedGeoChecada] =
    React.useState<ChecadaRow | null>(null);

  const { data, isLoading } = useQuery<DashboardChecadasResponse>({
    queryKey: [
      'checadas-dashboard',
      page,
      pageSize,
      search,
      filtroMarca,
      sortBy,
      sortDir,
    ],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        search,
        filtroMarca,
        sortBy,
        sortDir,
      });
      const res = await fetch(`/api/checadas?${params.toString()}`);
      if (!res.ok) {
        throw new Error('No se pudo cargar el tablero de asistencia');
      }
      return (await res.json()) as DashboardChecadasResponse;
    },
  });

  const tenantId = data?.tenant.id ?? null;
  const tenantCode = data?.tenant.tenant_code ?? 'TIJ-001';
  const timeZone = data?.tenant.zona_horaria ?? 'America/Tijuana';

  const { status: realtimeState } = useTenantChannel({
    tenantId,
    queryKeysToInvalidate: [['checadas-dashboard']],
    throttleMs: 1000,
  });

  const columns = React.useMemo<DataTableColumnDef<ChecadaRow>[]>(
    () => [
      {
        id: 'codigo_empleado',
        accessorKey: 'codigo_empleado',
        header: 'Empleado y Sucursal',
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-semibold text-[var(--text)]">
              {row.original.nombre_empleado}
            </span>
            <span className="font-mono text-xs text-[var(--text-2)]">
              #{row.original.codigo_empleado} · {row.original.departamento}
              {row.original.sucursal_asignada
                ? ` · ${row.original.sucursal_asignada.clave}`
                : ''}
            </span>
          </div>
        ),
      },
      {
        id: 'tipo_marca',
        accessorKey: 'tipo_marca',
        header: 'Evento',
        cell: ({ row }) => {
          const marca = row.original.tipo_marca;
          const variant: BadgeVariant =
            marca === 'ENTRADA'
              ? 'success'
              : marca === 'SALIDA'
                ? 'warning'
                : 'default';
          return (
            <div className="flex items-center gap-[var(--s-2)]">
              <Badge variant={variant}>{marca}</Badge>
              {row.original.ambigua && (
                <Badge variant="warning">Hora repetida DST</Badge>
              )}
            </div>
          );
        },
      },
      {
        id: 'tipo_verificacion',
        accessorKey: 'tipo_verificacion',
        header: 'Biometría / Medio',
        cell: ({ row }) => {
          const v = row.original.tipo_verificacion ?? 'RELOJ';
          return (
            <Badge
              variant={
                v === 'WEBAUTHN' || v === 'ROSTRO' || v === 'HUELLA'
                  ? 'info'
                  : 'default'
              }
            >
              {v}
            </Badge>
          );
        },
      },
      {
        id: 'fuente',
        header: 'Origen / Dispositivo',
        accessorFn: (r: ChecadaRow) =>
          r.fuentes_asistencia?.nombre_ubicacion ?? '—',
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="text-sm font-medium text-[var(--text)]">
              {row.original.fuentes_asistencia?.nombre_ubicacion ?? '—'}
            </span>
            <span className="text-xs text-[var(--text-3)]">
              {row.original.fuentes_asistencia?.marca ?? 'ZKTECO'}
            </span>
          </div>
        ),
      },
      {
        id: 'geolocalizacion',
        header: 'Geolocalización / Geocerca',
        accessorFn: (r: ChecadaRow) =>
          r.latitud != null && r.longitud != null
            ? `${r.latitud.toFixed(5)}, ${r.longitud.toFixed(5)}`
            : 'Reloj físico en planta',
        cell: ({ row }) => {
          const item = row.original;
          if (item.latitud == null || item.longitud == null) {
            return (
              <span className="text-xs text-[var(--text-3)]">
                Reloj fijo ({item.sucursal_asignada?.clave ?? 'Sitio'})
              </span>
            );
          }

          const isInside = item.dentro_geocerca !== false;
          const distLabel = formatDistanceLabel(item.distancia_sucursal_m);

          return (
            <div className="flex flex-wrap items-center gap-[var(--s-2)]">
              <Badge variant={isInside ? 'success' : 'warning'}>
                {isInside
                  ? `En sucursal (${distLabel})`
                  : `Fuera de geocerca (${distLabel})`}
              </Badge>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setSelectedGeoChecada(item)}
              >
                <MapPin
                  className="size-3.5 text-[var(--accent)]"
                  aria-hidden="true"
                />
                <span>Mapa</span>
              </Button>
            </div>
          );
        },
      },
      {
        id: 'ts_dispositivo_local',
        accessorKey: 'ts_dispositivo_local',
        header: 'Hora Reloj (Sitio)',
        meta: { isNumeric: true },
        cell: ({ row }) => (
          <span className="font-mono tabular-nums text-xs font-semibold text-[var(--text)]">
            {row.original.ts_dispositivo_local}
          </span>
        ),
      },
      {
        id: 'ts_utc',
        accessorKey: 'ts_utc',
        header: `Hora Oficial (${timeZone})`,
        meta: { isNumeric: true },
        cell: ({ row }) => (
          <span className="tabular-nums text-xs text-[var(--text-2)]">
            {new Intl.DateTimeFormat('es-MX', {
              dateStyle: 'short',
              timeStyle: 'medium',
              timeZone,
            }).format(new Date(row.original.ts_utc))}
          </span>
        ),
      },
    ],
    [timeZone],
  );

  const exportColumns = React.useMemo<ExportColumn<ChecadaRow>[]>(
    () => [
      {
        header: 'Código Empleado',
        accessor: (r: ChecadaRow) => r.codigo_empleado,
      },
      {
        header: 'Nombre Empleado',
        accessor: (r: ChecadaRow) => r.nombre_empleado,
      },
      {
        header: 'Departamento',
        accessor: (r: ChecadaRow) => r.departamento,
      },
      {
        header: 'Sucursal Asignada',
        accessor: (r: ChecadaRow) =>
          r.sucursal_asignada
            ? `${r.sucursal_asignada.clave} - ${r.sucursal_asignada.nombre}`
            : '',
      },
      { header: 'Tipo Marca', accessor: (r: ChecadaRow) => r.tipo_marca },
      {
        header: 'Verificación Biométrica',
        accessor: (r: ChecadaRow) => r.tipo_verificacion ?? 'RELOJ',
      },
      {
        header: 'Ubicación / Fuente',
        accessor: (r: ChecadaRow) =>
          r.fuentes_asistencia?.nombre_ubicacion ?? '',
      },
      {
        header: 'Latitud Check-In/Out',
        accessor: (r: ChecadaRow) =>
          r.latitud != null ? r.latitud.toFixed(6) : '',
      },
      {
        header: 'Longitud Check-In/Out',
        accessor: (r: ChecadaRow) =>
          r.longitud != null ? r.longitud.toFixed(6) : '',
      },
      {
        header: 'Distancia a Sucursal (m)',
        accessor: (r: ChecadaRow) =>
          r.distancia_sucursal_m != null
            ? String(Math.round(r.distancia_sucursal_m))
            : '',
      },
      {
        header: 'Estatus Geocerca',
        accessor: (r: ChecadaRow) =>
          r.dentro_geocerca == null
            ? 'RELOJ_FISICO'
            : r.dentro_geocerca
              ? 'EN_SUCURSAL'
              : 'FUERA_DE_SUCURSAL',
      },
      {
        header: 'Hora Local Dispositivo',
        accessor: (r: ChecadaRow) => r.ts_dispositivo_local,
      },
      { header: 'Timestamp UTC', accessor: (r: ChecadaRow) => r.ts_utc },
      {
        header: 'Hora Ambigua DST',
        accessor: (r: ChecadaRow) => (r.ambigua ? 'SÍ' : 'NO'),
      },
    ],
    [],
  );

  const kpis = data?.kpis;

  return (
    <AppShell
      title="Tablero de Asistencia en Vivo"
      subtitle={`Zona horaria activa: ${timeZone} · Sincronización en tiempo real desde Relojes y Kiosco Digital`}
      mode="client"
      realtimeState={realtimeState}
      tenantNombre={data?.tenant?.nombre_comercial}
      actions={
        <Link
          href={`/checador?empresa=${encodeURIComponent(tenantCode)}`}
          target="_blank"
          className="inline-flex h-10 items-center gap-[var(--s-2)] rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface)] px-[var(--s-3)] text-sm font-medium text-[var(--text)] shadow-[var(--shadow-1)] transition-colors hover:bg-[var(--surface-2)]"
        >
          <Fingerprint
            className="size-4 text-[var(--accent)]"
            aria-hidden="true"
          />
          <span>Abrir Kiosco Checador</span>
          <ExternalLink
            className="size-3.5 text-[var(--text-3)]"
            aria-hidden="true"
          />
        </Link>
      }
    >
      <div className="flex flex-col gap-[var(--s-6)]">
        {/* Fila de 5 KPIs en vivo */}
        <div className="grid grid-cols-1 gap-[var(--s-4)] sm:grid-cols-2 lg:grid-cols-5">
          <StatCard
            label="Presentes hoy"
            value={
              kpis
                ? `${kpis.presentesHoy} / ${kpis.plantillaActiva}`
                : '0 / 0'
            }
            delta="En turno"
            deltaVariant="positive"
            icon={<UserCheck className="h-4 w-4" />}
            sparkline={[3, 4, 4, 5, kpis?.presentesHoy ?? 4]}
            loading={isLoading}
          />
          <StatCard
            label="Retardos hoy"
            value={kpis?.retardosHoy ?? 0}
            delta={
              (kpis?.retardosHoy ?? 0) > 0 ? 'Requiere revisión' : 'Sin retardos'
            }
            deltaVariant={(kpis?.retardosHoy ?? 0) > 0 ? 'negative' : 'positive'}
            icon={<Clock className="h-4 w-4" />}
            loading={isLoading}
          />
          <StatCard
            label="Ausencias estimadas"
            value={kpis?.faltasHoy ?? 0}
            delta="Plantilla activa"
            deltaVariant={(kpis?.faltasHoy ?? 0) > 0 ? 'neutral' : 'positive'}
            icon={<UserX className="h-4 w-4" />}
            loading={isLoading}
          />
          <StatCard
            label="Checadas última hora"
            value={kpis?.checadasUltimaHora ?? 0}
            delta="Tiempo real"
            deltaVariant="positive"
            icon={<Activity className="h-4 w-4" />}
            sparkline={[1, 2, 1, 3, kpis?.checadasUltimaHora ?? 2]}
            loading={isLoading}
          />
          <StatCard
            label="Relojes y Kioscos"
            value={
              kpis
                ? `${kpis.relojesEnLinea}/${kpis.relojesTotales} activos`
                : '—'
            }
            delta={`${kpis?.agentesEnLinea ?? 0} agente activo`}
            deltaVariant={
              kpis && kpis.relojesEnLinea === kpis.relojesTotales
                ? 'positive'
                : 'negative'
            }
            icon={<Cpu className="h-4 w-4" />}
            loading={isLoading}
          />
        </div>

        {/* Gráficas operativas */}
        <div className="grid grid-cols-1 gap-[var(--s-4)] lg:grid-cols-2">
          <ChartCard
            title="Checadas por hora (Hoy vs Promedio)"
            subtitle={`Distribución horaria en ${timeZone}`}
            primaryLabel="Hoy"
            secondaryLabel="Promedio 7d"
            data={data?.charts.hourlySeries ?? []}
            loading={isLoading}
          />
          <ChartCard
            title="Asistencia por departamento"
            subtitle="Empleados con checada registrada vs plantilla del área"
            primaryLabel="Presentes"
            secondaryLabel="Plantilla"
            data={data?.charts.departmentSeries ?? []}
            loading={isLoading}
          />
        </div>

        {/* Bitácora inmutable de checadas con DataTable y Geolocalización */}
        <div className="flex flex-col gap-[var(--s-3)]">
          <div className="flex flex-wrap items-center justify-between gap-[var(--s-3)]">
            <div>
              <h2 className="text-base font-semibold text-[var(--text)]">
                Bitácora Inmutable de Checadas y Geolocalización
              </h2>
              <span className="inline-flex items-center gap-[var(--s-1)] text-xs text-[var(--text-2)]">
                <AlertTriangle className="h-3.5 w-3.5 text-[var(--warning)]" />
                Las checadas crudas y coordenadas GPS son inmutables por auditoría legal
              </span>
            </div>

            <SegmentedControl<FiltroMarca>
              ariaLabel="Filtrar por tipo de marca"
              value={filtroMarca}
              onChange={(val) => {
                setFiltroMarca(val);
                setPage(1);
              }}
              options={[
                { value: 'TODAS', label: 'Todas' },
                { value: 'ENTRADA', label: 'Entradas' },
                { value: 'SALIDA', label: 'Salidas' },
                { value: 'AMBIGUAS', label: 'Ambiguas DST' },
              ]}
            />
          </div>

          <DataTable
            caption="Bitácora de checadas de asistencia y ubicación geográfica en tiempo real"
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
            searchPlaceholder="Buscar por número de empleado (ej. 1001)…"
            sortBy={sortBy}
            sortDir={sortDir}
            onSortChange={(colId, dir) => {
              setSortBy(colId);
              setSortDir(dir);
            }}
            isLoading={isLoading}
            exportFilename="checadas-asistencia-geolocalizacion-tijuana"
            exportColumns={exportColumns}
          />
        </div>
      </div>

      {/* Sheet de Auditoría Geográfica de la Checada */}
      <Sheet
        open={Boolean(selectedGeoChecada)}
        onOpenChange={(open) => {
          if (!open) setSelectedGeoChecada(null);
        }}
        title={
          selectedGeoChecada
            ? `Ubicación de ${selectedGeoChecada.tipo_marca} · ${selectedGeoChecada.nombre_empleado}`
            : 'Ubicación geográfica del registro'
        }
        description={
          selectedGeoChecada
            ? `Empleado #${selectedGeoChecada.codigo_empleado} · Verificado por ${selectedGeoChecada.tipo_verificacion ?? 'KIOSCO'} · ${selectedGeoChecada.ts_dispositivo_local}`
            : ''
        }
        footer={
          <Button
            type="button"
            variant="secondary"
            onClick={() => setSelectedGeoChecada(null)}
          >
            Cerrar
          </Button>
        }
      >
        {selectedGeoChecada &&
          selectedGeoChecada.latitud != null &&
          selectedGeoChecada.longitud != null && (
            <div className="flex flex-col gap-[var(--s-4)]">
              <LocationMapPreview
                latitud={selectedGeoChecada.latitud}
                longitud={selectedGeoChecada.longitud}
                titulo={`${selectedGeoChecada.tipo_marca} de ${selectedGeoChecada.nombre_empleado}`}
                subtitulo={
                  selectedGeoChecada.precision_m != null
                    ? `Precisión GPS ±${Math.round(selectedGeoChecada.precision_m)} m`
                    : undefined
                }
                sucursalLatitud={selectedGeoChecada.sucursal_asignada?.latitud}
                sucursalLongitud={selectedGeoChecada.sucursal_asignada?.longitud}
                sucursalNombre={
                  selectedGeoChecada.sucursal_asignada
                    ? `${selectedGeoChecada.sucursal_asignada.clave} · ${selectedGeoChecada.sucursal_asignada.nombre}`
                    : null
                }
                distanciaMetros={selectedGeoChecada.distancia_sucursal_m}
                dentroGeocerca={selectedGeoChecada.dentro_geocerca}
                heightClassName="h-72"
              />
            </div>
          )}
      </Sheet>
    </AppShell>
  );
}
