import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { DataTable, type DataTableColumnDef } from '../../ui/data-table/data-table';
import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';
import { RelojSheet } from './RelojSheet';
import { agentApi, type ClockRecord } from '../../../lib/agent-api';
import { getSupabaseClient } from '../../../lib/supabase';
import { useAuth } from '../../../context/AuthContext';
import { formatFechaHoraMx } from '../../../lib/utils';
import type { ExportColumn } from '../../../lib/export/exporters';
import {
  Plus,
  RefreshCw,
  Activity,
  Trash2,
  Edit2,
  Server,
  CloudDownload,
  CheckCircle2,
  XCircle,
  Clock,
} from 'lucide-react';

export const RelojesView: React.FC = () => {
  const { user, selectedTenantId } = useAuth();
  const [relojes, setRelojes] = useState<ClockRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [relojToEdit, setRelojToEdit] = useState<ClockRecord | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [syncingCloud, setSyncingCloud] = useState(false);
  const [syncStatusMsg, setSyncStatusMsg] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState('');

  const loadRelojes = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await agentApi.listRelojes();
      setRelojes(data);
    } catch {
      // Ignorar si el agente no responde aún
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRelojes();
  }, [loadRelojes]);

  // Suscripción a Supabase Realtime para cambios en fuentes_asistencia
  useEffect(() => {
    const activeTenantId = selectedTenantId || user?.tenant_id;
    if (!activeTenantId || user?.isOfflinePin) return;

    try {
      const supabase = getSupabaseClient();
      const channel = supabase
        .channel(`fuentes-changes-${activeTenantId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'fuentes_asistencia',
            filter: `tenant_id=eq.${activeTenantId}`,
          },
          () => {
            loadRelojes();
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    } catch {
      // Sin conexión o suscripción no disponible
    }
  }, [selectedTenantId, user, loadRelojes]);

  const handleTestConnection = async (reloj: ClockRecord) => {
    setTestingId(reloj.id);
    try {
      await agentApi.testConnection({
        id: reloj.id,
        tipo: reloj.tipo,
        ip: reloj.ip,
        puerto: reloj.puerto,
        comm_key: reloj.comm_key,
        usuario: reloj.usuario || undefined,
      });
      await loadRelojes();
    } catch {
      // Error manejado en update de estado
    } finally {
      setTestingId(null);
    }
  };

  const handleDelete = async (reloj: ClockRecord) => {
    if (!window.confirm(`¿Estás seguro de eliminar el reloj "${reloj.nombre}"?`)) {
      return;
    }
    try {
      await agentApi.deleteReloj(reloj.id);
      await loadRelojes();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error al eliminar');
    }
  };

  // Sincronizar catálogo de relojes desde la BD de Supabase
  const handleSyncFromCloud = async () => {
    const activeTenantId = selectedTenantId || user?.tenant_id;
    if (!activeTenantId) return;

    setSyncingCloud(true);
    setSyncStatusMsg(null);
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('fuentes_asistencia')
        .select('*')
        .eq('tenant_id', activeTenantId);

      if (error) throw error;

      if (data && data.length > 0) {
        let imported = 0;
        for (const item of data) {
          await agentApi.saveReloj({
            id: item.id,
            nombre: item.nombre_ubicacion,
            tipo: item.marca as ClockRecord['tipo'],
            ip: item.ip_local || '127.0.0.1',
            puerto: item.puerto || 4370,
            usuario: item.usuario_dispositivo,
            activo: item.activo,
          });
          imported++;
        }
        setSyncStatusMsg(`Sincronizados ${imported} relojes desde la nube`);
        await loadRelojes();
      } else {
        setSyncStatusMsg('No hay relojes registrados en la nube para esta empresa');
      }
    } catch (err: unknown) {
      setSyncStatusMsg(
        `Error al sincronizar: ${err instanceof Error ? err.message : 'Error de conexión'}`
      );
    } finally {
      setSyncingCloud(false);
    }
  };

  const filteredData = useMemo(() => {
    if (!search) return relojes;
    const q = search.toLowerCase();
    return relojes.filter(
      (r) =>
        r.nombre.toLowerCase().includes(q) ||
        r.tipo.toLowerCase().includes(q) ||
        r.ip.toLowerCase().includes(q)
    );
  }, [relojes, search]);

  const pagedData = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredData.slice(start, start + pageSize);
  }, [filteredData, page, pageSize]);

  const exportColumns = useMemo<ExportColumn<ClockRecord>[]>(
    () => [
      { header: 'Nombre', accessor: (r) => r.nombre },
      { header: 'Marca', accessor: (r) => r.tipo },
      { header: 'Dirección IP', accessor: (r) => r.ip },
      { header: 'Puerto', accessor: (r) => String(r.puerto) },
      {
        header: 'Estado',
        accessor: (r) => (r.ultimo_error ? 'Desconectado' : r.ultimo_ping ? 'En línea' : 'Sin probar'),
      },
      {
        header: 'Último Ping',
        accessor: (r) => (r.ultimo_ping ? formatFechaHoraMx(r.ultimo_ping) : '—'),
      },
    ],
    []
  );

  const columns = useMemo<DataTableColumnDef<ClockRecord>[]>(
    () => [
      {
        accessorKey: 'nombre',
        header: 'Nombre / Ubicación',
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-semibold text-sm">{row.original.nombre}</span>
            <span className="text-[11px] text-[var(--text-2)] font-mono">
              ID: {row.original.id.slice(0, 8)}...
            </span>
          </div>
        ),
      },
      {
        accessorKey: 'tipo',
        header: 'Marca / Protocolo',
        cell: ({ row }) => {
          const t = row.original.tipo;
          let badgeVariant: 'default' | 'secondary' | 'outline' = 'default';
          if (t === 'HIKVISION') badgeVariant = 'secondary';
          if (t === 'TACLOUD') badgeVariant = 'outline';

          return (
            <Badge variant={badgeVariant} className="font-mono text-[11px] tracking-wide">
              {t}
            </Badge>
          );
        },
      },
      {
        id: 'red',
        header: 'Dirección de Red',
        cell: ({ row }) => (
          <div className="flex items-center gap-1.5 font-mono text-xs text-[var(--text)]">
            <Server className="w-3.5 h-3.5 text-[var(--text-2)]" />
            <span>
              {row.original.ip}:{row.original.puerto}
            </span>
          </div>
        ),
      },
      {
        id: 'estado',
        header: 'Estado en Vivo',
        cell: ({ row }) => {
          const reloj = row.original;
          const isTesting = testingId === reloj.id;

          if (isTesting) {
            return (
              <span className="flex items-center gap-1.5 text-xs text-[var(--accent)] font-medium">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Sondeando...</span>
              </span>
            );
          }

          if (reloj.ultimo_error) {
            return (
              <span className="flex items-center gap-1.5 text-xs text-[var(--danger)]" title={reloj.ultimo_error}>
                <XCircle className="w-4 h-4 shrink-0" />
                <span className="truncate max-w-[150px]">{reloj.ultimo_error}</span>
              </span>
            );
          }

          if (reloj.ultimo_ping) {
            return (
              <span className="flex items-center gap-1.5 text-xs text-[var(--success)] font-medium">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>En Línea</span>
              </span>
            );
          }

          return (
            <span className="flex items-center gap-1.5 text-xs text-[var(--text-2)]">
              <Clock className="w-3.5 h-3.5 shrink-0" />
              <span>Sin probar</span>
            </span>
          );
        },
      },
      {
        accessorKey: 'ultimo_ping',
        header: 'Último Ping',
        cell: ({ row }) => (
          <span className="text-xs text-[var(--text-2)]">
            {row.original.ultimo_ping ? formatFechaHoraMx(row.original.ultimo_ping) : '—'}
          </span>
        ),
      },
      {
        id: 'acciones',
        header: 'Acciones',
        cell: ({ row }) => {
          const reloj = row.original;
          const isTesting = testingId === reloj.id;

          return (
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-2.5 text-xs flex items-center gap-1"
                onClick={() => handleTestConnection(reloj)}
                disabled={isTesting}
                title="Probar conexión en la red local"
              >
                <Activity className={`w-3.5 h-3.5 text-[var(--accent)] ${isTesting ? 'animate-spin' : ''}`} />
                <span>Probar</span>
              </Button>

              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => {
                  setRelojToEdit(reloj);
                  setSheetOpen(true);
                }}
                title="Editar reloj"
              >
                <Edit2 className="w-3.5 h-3.5 text-[var(--text-2)]" />
              </Button>

              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 hover:bg-[var(--danger-bg)] hover:text-[var(--danger)]"
                onClick={() => handleDelete(reloj)}
                title="Eliminar reloj"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          );
        },
      },
    ],
    [testingId]
  );

  return (
    <div className="space-y-4">
      {/* Barra de cabecera con acciones principales */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[var(--surface)] p-4 rounded-[var(--r-lg)] border border-[var(--separator)] shadow-[var(--shadow-1)]">
        <div>
          <h2 className="text-base font-bold text-[var(--text)]">Terminales y Relojes Biométricos</h2>
          <p className="text-xs text-[var(--text-2)]">
            Relojes ZKTeco, Hikvision y TA.Cloud configurados para recolección en este sitio
          </p>
        </div>

        <div className="flex items-center gap-2">
          {!user?.isOfflinePin && (
            <Button
              variant="outline"
              size="sm"
              className="flex items-center gap-1.5 text-xs"
              onClick={handleSyncFromCloud}
              disabled={syncingCloud}
            >
              <CloudDownload className={`w-3.5 h-3.5 ${syncingCloud ? 'animate-spin' : ''}`} />
              <span>{syncingCloud ? 'Sincronizando...' : 'Descargar de Nube'}</span>
            </Button>
          )}

          <Button
            size="sm"
            className="flex items-center gap-1.5 text-xs"
            onClick={() => {
              setRelojToEdit(null);
              setSheetOpen(true);
            }}
          >
            <Plus className="w-4 h-4" />
            <span>Agregar Reloj</span>
          </Button>
        </div>
      </div>

      {syncStatusMsg && (
        <div className="p-3 text-xs rounded-[var(--r-sm)] bg-[var(--surface-2)] text-[var(--text)] border border-[var(--separator)] flex items-center justify-between">
          <span>{syncStatusMsg}</span>
          <button
            onClick={() => setSyncStatusMsg(null)}
            className="text-[var(--text-2)] hover:text-[var(--text)] text-xs ml-2 cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      )}

      {/* Tabla con TanStack Table */}
      <DataTable
        caption="Terminales y Relojes Biométricos"
        columns={columns}
        data={pagedData}
        total={filteredData.length}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Buscar por nombre, marca o IP..."
        exportColumns={exportColumns}
        exportFilename="sm-clock-relojes"
        isLoading={isLoading}
        emptyTitle="No hay terminales configuradas"
        emptyDescription="Haz clic en 'Agregar Reloj' para registrar un reloj ZKTeco, Hikvision o TA.Cloud en este agente."
      />

      {/* Sheet con footer fijo para agregar/editar reloj */}
      <RelojSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        relojToEdit={relojToEdit}
        onSaved={loadRelojes}
      />
    </div>
  );
};
