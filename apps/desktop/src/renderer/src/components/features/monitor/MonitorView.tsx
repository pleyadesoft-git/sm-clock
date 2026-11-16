import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { DataTable, type DataTableColumnDef } from '../../ui/data-table/data-table';
import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';
import { Card, CardHeader, CardContent } from '../../ui/card';
import { agentApi, type AgentStatus, type QueuedPunchItem } from '../../../lib/agent-api';
import type { ExportColumn } from '../../../lib/export/exporters';
import {
  Activity,
  Database,
  Clock,
  CloudUpload,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  History,
} from 'lucide-react';

export const MonitorView: React.FC = () => {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [punches, setPunches] = useState<QueuedPunchItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [syncingManual, setSyncingManual] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState('');

  const loadData = useCallback(async () => {
    try {
      const [st, q] = await Promise.all([agentApi.getStatus(), agentApi.getQueue(50)]);
      setStatus(st);
      setPunches(q.checadas);
    } catch {
      // Ignorar fallo puntual
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 5000);
    return () => clearInterval(interval);
  }, [loadData]);

  const handleManualSync = async () => {
    setSyncingManual(true);
    setActionMsg(null);
    try {
      const res = await agentApi.triggerSync();
      setActionMsg(res.mensaje || 'Sincronización manual ejecutada con éxito');
      await loadData();
    } catch (err: unknown) {
      setActionMsg(
        `Error al sincronizar: ${err instanceof Error ? err.message : 'Error desconocido'}`
      );
    } finally {
      setSyncingManual(false);
    }
  };

  const handleReconcile = async () => {
    setReconciling(true);
    setActionMsg(null);
    try {
      const res = await agentApi.triggerReconciliation();
      setActionMsg(res.mensaje || 'Reconciliación iniciada en segundo plano');
      await loadData();
    } catch (err: unknown) {
      setActionMsg(
        `Error al reconciliar: ${err instanceof Error ? err.message : 'Error desconocido'}`
      );
    } finally {
      setReconciling(false);
    }
  };

  const filteredData = useMemo(() => {
    if (!search) return punches;
    const q = search.toLowerCase();
    return punches.filter(
      (p) =>
        p.codigo_empleado.toLowerCase().includes(q) ||
        p.ts_dispositivo_local.toLowerCase().includes(q)
    );
  }, [punches, search]);

  const pagedData = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredData.slice(start, start + pageSize);
  }, [filteredData, page, pageSize]);

  const exportColumns = useMemo<ExportColumn<QueuedPunchItem>[]>(
    () => [
      { header: 'Empleado', accessor: (p) => p.codigo_empleado },
      { header: 'Hora Local', accessor: (p) => p.ts_dispositivo_local },
      { header: 'Tipo Marca', accessor: (p) => p.tipo_marca || '0' },
      { header: 'Verificación', accessor: (p) => p.tipo_verificacion || 'Huella/Facial' },
      { header: 'Sincronizado', accessor: (p) => (p.sincronizado ? 'Sí' : 'No') },
    ],
    []
  );

  const columns = useMemo<DataTableColumnDef<QueuedPunchItem>[]>(
    () => [
      {
        accessorKey: 'codigo_empleado',
        header: 'Empleado',
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-mono font-semibold text-xs text-[var(--text)]">
              #{row.original.codigo_empleado}
            </span>
            <span className="text-[10px] text-[var(--text-2)] font-mono">
              ID: {row.original.id}
            </span>
          </div>
        ),
      },
      {
        accessorKey: 'ts_dispositivo_local',
        header: 'Hora Local (Tijuana)',
        cell: ({ row }) => (
          <div className="flex items-center gap-1.5 font-mono text-xs">
            <span>{row.original.ts_dispositivo_local}</span>
            {row.original.ambigua && (
              <Badge variant="outline" className="text-[9px] text-[var(--warning)] border-[var(--warning)]">
                Ambigua (DST)
              </Badge>
            )}
          </div>
        ),
      },
      {
        accessorKey: 'tipo_marca',
        header: 'Tipo Marca',
        cell: ({ row }) => {
          const tm = row.original.tipo_marca || '0';
          const label = tm === '0' ? 'Entrada' : tm === '1' ? 'Salida' : `Tipo ${tm}`;
          return (
            <Badge variant="secondary" className="text-[10px]">
              {label}
            </Badge>
          );
        },
      },
      {
        accessorKey: 'tipo_verificacion',
        header: 'Verificación',
        cell: ({ row }) => (
          <span className="text-xs text-[var(--text-2)]">
            {row.original.tipo_verificacion || 'Huella/Facial'}
          </span>
        ),
      },
      {
        accessorKey: 'sincronizado',
        header: 'Estado Nube',
        cell: ({ row }) => {
          const sinc = row.original.sincronizado;
          return sinc ? (
            <span className="flex items-center gap-1 text-xs text-[var(--success)] font-medium">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Sincronizado</span>
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs text-[var(--warning)] font-medium">
              <Clock className="w-3.5 h-3.5" />
              <span>Pendiente en Cola</span>
            </span>
          );
        },
      },
    ],
    []
  );

  return (
    <div className="space-y-4">
      {/* Tarjetas de Métricas de Cola y Salud */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="border-[var(--separator)] bg-[var(--surface)]">
          <CardHeader className="p-3 pb-1 flex flex-row items-center justify-between">
            <span className="text-xs font-medium text-[var(--text-2)]">Cola Pendiente</span>
            <CloudUpload className="w-4 h-4 text-[var(--warning)]" />
          </CardHeader>
          <CardContent className="p-3 pt-0">
            <span className="text-2xl font-bold font-mono text-[var(--warning)]">
              {status?.cola_pendiente ?? 0}
            </span>
          </CardContent>
        </Card>

        <Card className="border-[var(--separator)] bg-[var(--surface)]">
          <CardHeader className="p-3 pb-1 flex flex-row items-center justify-between">
            <span className="text-xs font-medium text-[var(--text-2)]">Total Histórico</span>
            <History className="w-4 h-4 text-[var(--accent)]" />
          </CardHeader>
          <CardContent className="p-3 pt-0">
            <span className="text-2xl font-bold font-mono text-[var(--text)]">
              {status?.cola_total ?? 0}
            </span>
          </CardContent>
        </Card>

        <Card className="border-[var(--separator)] bg-[var(--surface)]">
          <CardHeader className="p-3 pb-1 flex flex-row items-center justify-between">
            <span className="text-xs font-medium text-[var(--text-2)]">SQLite Journal</span>
            <Database className="w-4 h-4 text-[var(--text-2)]" />
          </CardHeader>
          <CardContent className="p-3 pt-0">
            <span className="text-lg font-bold font-mono text-[var(--success)] uppercase">
              {status?.sqlite_journal_mode ?? 'WAL'}
            </span>
          </CardContent>
        </Card>

        <Card className="border-[var(--separator)] bg-[var(--surface)]">
          <CardHeader className="p-3 pb-1 flex flex-row items-center justify-between">
            <span className="text-xs font-medium text-[var(--text-2)]">Desvío de Reloj</span>
            <Activity className="w-4 h-4 text-[var(--text-2)]" />
          </CardHeader>
          <CardContent className="p-3 pt-0 flex items-center gap-1.5">
            <span
              className={`text-lg font-bold font-mono ${
                status?.alerta_desvio_reloj ? 'text-[var(--danger)]' : 'text-[var(--text)]'
              }`}
            >
              {status ? `${Math.abs(status.desvio_reloj_segundos).toFixed(1)}s` : '0s'}
            </span>
            {status?.alerta_desvio_reloj && (
              <AlertTriangle className="w-4 h-4 text-[var(--danger)] shrink-0" />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Barra de Acciones de Sincronización */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-[var(--surface)] p-3 rounded-[var(--r-lg)] border border-[var(--separator)] shadow-[var(--shadow-1)]">
        <div>
          <h3 className="text-sm font-semibold text-[var(--text)]">Monitor de Checadas en Vivo</h3>
          <p className="text-xs text-[var(--text-2)]">
            Transmisión continua de marcajes leídos desde terminales en la red local
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="text-xs flex items-center gap-1.5"
            onClick={handleReconcile}
            disabled={reconciling}
            title="Lee checadas de los últimos 30 min desde los relojes"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${reconciling ? 'animate-spin' : ''}`} />
            <span>Reconciliar (30 min)</span>
          </Button>

          <Button
            size="sm"
            className="text-xs flex items-center gap-1.5"
            onClick={handleManualSync}
            disabled={syncingManual}
            title="Enviar lote pendiente a Supabase Cloud ahora"
          >
            <CloudUpload className={`w-3.5 h-3.5 ${syncingManual ? 'animate-spin' : ''}`} />
            <span>Enviar a la Nube</span>
          </Button>
        </div>
      </div>

      {actionMsg && (
        <div className="p-3 text-xs rounded-[var(--r-sm)] bg-[var(--surface-2)] text-[var(--text)] border border-[var(--separator)] flex items-center justify-between">
          <span>{actionMsg}</span>
          <button
            onClick={() => setActionMsg(null)}
            className="text-[var(--text-2)] hover:text-[var(--text)] text-xs ml-2 cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      )}

      {/* Tabla de Checadas con TanStack Table */}
      <DataTable
        caption="Monitor de Checadas en Vivo"
        columns={columns}
        data={pagedData}
        total={filteredData.length}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Buscar por código de empleado..."
        exportColumns={exportColumns}
        exportFilename="sm-clock-checadas"
        isLoading={isLoading}
        emptyTitle="No hay checadas en cola"
        emptyDescription="Las checadas registradas en las terminales aparecerán aquí en tiempo real antes y después de enviarse a la nube."
      />
    </div>
  );
};
