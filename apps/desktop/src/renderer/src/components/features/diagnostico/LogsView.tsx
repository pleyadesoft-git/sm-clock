import React, { useState, useEffect, useRef, useMemo } from 'react';
import { agentApi, type LogEntry, type LogsResponse } from '../../../lib/agent-api';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Badge } from '../../ui/badge';
import { Card, CardHeader, CardContent } from '../../ui/card';
import {
  AlertTriangle,
  XCircle,
  Info,
  Copy,
  Download,
  Trash2,
  RefreshCw,
  Search,
  Check,
  ChevronDown,
  ChevronRight,
  Terminal,
  Bell,
} from 'lucide-react';

export const LogsView: React.FC = () => {
  const [logsData, setLogsData] = useState<LogsResponse>({
    ok: true,
    counts: { total: 0, errors: 0, warnings: 0, infos: 0 },
    logs: [],
  });
  const [selectedLevel, setSelectedLevel] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [isSendingAlert, setIsSendingAlert] = useState<boolean>(false);
  const [expandedTracebacks, setExpandedTracebacks] = useState<Record<number, boolean>>({});

  const terminalEndRef = useRef<HTMLDivElement>(null);

  const fetchLogs = async () => {
    setIsLoading(true);
    try {
      const levelFilter = selectedLevel === 'ALL' ? undefined : selectedLevel;
      const res = await agentApi.getLogs(levelFilter, searchQuery || undefined, 300);
      setLogsData(res);
    } catch {
      // Ignorar fallo puntual
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
    const interval = setInterval(fetchLogs, 3000);
    return () => clearInterval(interval);
  }, [selectedLevel, searchQuery]);

  // Suscripción directa a eventos de log de Electron si está disponible
  useEffect(() => {
    if (window.electronAPI?.sidecar?.onLog) {
      const unsubscribe = window.electronAPI.sidecar.onLog((entry) => {
        setLogsData((prev) => {
          const normalizedLevel: LogEntry['level'] = entry.level.includes('ERROR')
            ? 'ERROR'
            : entry.level.includes('WARN')
            ? 'WARNING'
            : 'INFO';

          const newEntry: LogEntry = {
            timestamp: entry.timestamp,
            level: normalizedLevel,
            logger: 'sidecar',
            message: entry.message,
          };
          const isErr = entry.level.includes('ERROR');
          const isWarn = entry.level.includes('WARN');
          return {
            ...prev,
            counts: {
              ...prev.counts,
              total: prev.counts.total + 1,
              errors: isErr ? prev.counts.errors + 1 : prev.counts.errors,
              warnings: isWarn ? prev.counts.warnings + 1 : prev.counts.warnings,
              infos: !isErr && !isWarn ? prev.counts.infos + 1 : prev.counts.infos,
            },
            logs: [newEntry, ...prev.logs.slice(0, 299)],
          };
        });
      });
      return () => {
        unsubscribe();
      };
    }
  }, []);

  // Auto-scroll al final del terminal si está habilitado
  useEffect(() => {
    if (autoScroll && terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logsData.logs, autoScroll]);

  const handleCopyLogs = () => {
    const textToCopy = logsData.logs
      .map(
        (l) =>
          `[${l.timestamp}] [${l.level}] [${l.logger}]: ${l.message}${
            l.traceback ? `\n${l.traceback}` : ''
          }`
      )
      .join('\n');

    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleExportDiagnostics = () => {
    const header = `=== SM-CLOCK AGENTE LOCAL - REPORTE DE DIAGNÓSTICO ===\nFecha Generación: ${new Date().toISOString()}\nTotal Registros: ${logsData.counts.total}\nErrores: ${logsData.counts.errors}\nAdvertencias: ${logsData.counts.warnings}\n=====================================================\n\n`;
    const body = logsData.logs
      .map(
        (l) =>
          `[${l.timestamp}] [${l.level}] [${l.logger}]: ${l.message}${
            l.traceback ? `\n--- TRACEBACK ---\n${l.traceback}\n--- FIN TRACEBACK ---` : ''
          }`
      )
      .join('\n');

    const blob = new Blob([header + body], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `sm-clock-diagnostico-${new Date().toISOString().slice(0, 10)}.log`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleClearLogs = async () => {
    if (window.confirm('¿Deseas limpiar todos los logs almacenados en memoria?')) {
      try {
        await agentApi.clearLogs();
        await fetchLogs();
      } catch (err: unknown) {
        alert(err instanceof Error ? err.message : 'Error al limpiar logs');
      }
    }
  };

  const handleSendTestAlert = async () => {
    setIsSendingAlert(true);
    try {
      const res = await agentApi.reportAlert({
        tipo_error: 'ALERTA_DIAGNOSTICO_ADMIN',
        mensaje: 'Prueba de diagnóstico de alerta enviada desde la consola de logs del agente de escritorio.',
        detalle: 'Verificación de entrega SMTP a Super-Admins y Administradores de Tenant.',
        force: true,
      });
      alert(res.mensaje || 'Alerta enviada correctamente a los administradores');
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error al enviar alerta a los administradores');
    } finally {
      setIsSendingAlert(false);
    }
  };

  const toggleTraceback = (index: number) => {
    setExpandedTracebacks((prev) => ({
      ...prev,
      [index]: !prev[index],
    }));
  };

  const filteredLogs = useMemo(() => {
    return logsData.logs;
  }, [logsData.logs]);

  return (
    <div className="space-y-4">
      {/* Tarjetas de estado rápido de errores */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card
          className={`cursor-pointer transition-all border ${
            selectedLevel === 'ALL'
              ? 'border-[var(--accent)] ring-1 ring-[var(--accent)] bg-[var(--surface)]'
              : 'border-[var(--separator)] bg-[var(--surface)] opacity-85'
          }`}
          onClick={() => setSelectedLevel('ALL')}
        >
          <CardHeader className="p-3 pb-1 flex flex-row items-center justify-between">
            <span className="text-xs font-medium text-[var(--text-2)]">Total Logs</span>
            <Terminal className="w-4 h-4 text-[var(--text-2)]" />
          </CardHeader>
          <CardContent className="p-3 pt-0">
            <span className="text-xl font-bold font-mono text-[var(--text)]">
              {logsData.counts.total}
            </span>
          </CardContent>
        </Card>

        <Card
          className={`cursor-pointer transition-all border ${
            selectedLevel === 'ERROR'
              ? 'border-[var(--danger)] ring-1 ring-[var(--danger)] bg-[var(--danger-bg)]'
              : 'border-[var(--separator)] bg-[var(--surface)] opacity-85'
          }`}
          onClick={() => setSelectedLevel(selectedLevel === 'ERROR' ? 'ALL' : 'ERROR')}
        >
          <CardHeader className="p-3 pb-1 flex flex-row items-center justify-between">
            <span className="text-xs font-medium text-[var(--danger)]">Errores Críticos</span>
            <XCircle className="w-4 h-4 text-[var(--danger)]" />
          </CardHeader>
          <CardContent className="p-3 pt-0">
            <span className="text-xl font-bold font-mono text-[var(--danger)]">
              {logsData.counts.errors}
            </span>
          </CardContent>
        </Card>

        <Card
          className={`cursor-pointer transition-all border ${
            selectedLevel === 'WARNING'
              ? 'border-[var(--warning)] ring-1 ring-[var(--warning)] bg-[var(--warning-bg)]'
              : 'border-[var(--separator)] bg-[var(--surface)] opacity-85'
          }`}
          onClick={() => setSelectedLevel(selectedLevel === 'WARNING' ? 'ALL' : 'WARNING')}
        >
          <CardHeader className="p-3 pb-1 flex flex-row items-center justify-between">
            <span className="text-xs font-medium text-[var(--warning)]">Advertencias</span>
            <AlertTriangle className="w-4 h-4 text-[var(--warning)]" />
          </CardHeader>
          <CardContent className="p-3 pt-0">
            <span className="text-xl font-bold font-mono text-[var(--warning)]">
              {logsData.counts.warnings}
            </span>
          </CardContent>
        </Card>

        <Card
          className={`cursor-pointer transition-all border ${
            selectedLevel === 'INFO'
              ? 'border-[var(--accent)] ring-1 ring-[var(--accent)] bg-[var(--surface-2)]'
              : 'border-[var(--separator)] bg-[var(--surface)] opacity-85'
          }`}
          onClick={() => setSelectedLevel(selectedLevel === 'INFO' ? 'ALL' : 'INFO')}
        >
          <CardHeader className="p-3 pb-1 flex flex-row items-center justify-between">
            <span className="text-xs font-medium text-[var(--accent)]">Informativos</span>
            <Info className="w-4 h-4 text-[var(--accent)]" />
          </CardHeader>
          <CardContent className="p-3 pt-0">
            <span className="text-xl font-bold font-mono text-[var(--text)]">
              {logsData.counts.infos}
            </span>
          </CardContent>
        </Card>
      </div>

      {/* Barra de herramientas de filtros y acciones */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-[var(--surface)] p-3 rounded-[var(--r-lg)] border border-[var(--separator)] shadow-[var(--shadow-1)]">
        <div className="flex-1 flex items-center gap-2 max-w-md">
          <div className="relative w-full">
            <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-2)]" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar error, IP de reloj, módulo o palabra clave..."
              className="pl-8 h-8 text-xs bg-[var(--surface-2)]"
            />
          </div>
          {searchQuery && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs"
              onClick={() => setSearchQuery('')}
            >
              Limpiar
            </Button>
          )}
        </div>

        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs flex items-center gap-1.5"
            onClick={fetchLogs}
            disabled={isLoading}
            title="Refrescar logs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Refrescar</span>
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs flex items-center gap-1.5"
            onClick={handleCopyLogs}
            title="Copiar logs al portapapeles"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-[var(--success)]" />
                <span className="text-[var(--success)]">Copiado</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-[var(--text-2)]" />
                <span>Copiar</span>
              </>
            )}
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs flex items-center gap-1.5 border-[var(--separator)] text-[var(--accent)] hover:bg-[var(--surface-2)] cursor-pointer"
            onClick={handleSendTestAlert}
            disabled={isSendingAlert}
            title="Probar notificación de error por correo a Super-Admins y Administradores"
          >
            <Bell className={`w-3.5 h-3.5 ${isSendingAlert ? 'animate-pulse' : ''}`} />
            <span>{isSendingAlert ? 'Enviando...' : 'Probar Alerta Email'}</span>
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs flex items-center gap-1.5"
            onClick={handleExportDiagnostics}
            title="Descargar archivo de diagnóstico para soporte"
          >
            <Download className="w-3.5 h-3.5 text-[var(--text-2)]" />
            <span>Exportar Diagnóstico</span>
          </Button>

          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 text-[var(--danger)] hover:bg-[var(--danger-bg)]"
            onClick={handleClearLogs}
            title="Limpiar logs en memoria"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* Consola Terminal de Logs */}
      <div className="relative rounded-[var(--r-lg)] border border-[var(--separator)] bg-[#0d1117] text-[#e6edf3] font-mono text-[11px] overflow-hidden shadow-[var(--shadow-2)]">
        {/* Cabecera de consola */}
        <div className="flex items-center justify-between px-3 py-2 bg-[#161b22] border-b border-[#30363d] select-none">
          <div className="flex items-center gap-2">
            <div className="flex gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-[#ff5f56]" />
              <div className="w-2.5 h-2.5 rounded-full bg-[#ffbd2e]" />
              <div className="w-2.5 h-2.5 rounded-full bg-[#27c93f]" />
            </div>
            <span className="text-xs text-[#8b949e] font-sans font-medium ml-2">
              Consola en Vivo — Agente Local (:8085)
            </span>
          </div>

          <div className="flex items-center gap-2 text-[11px] text-[#8b949e] font-sans">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
                className="rounded accent-[var(--accent)]"
              />
              <span>Auto-scroll</span>
            </label>
          </div>
        </div>

        {/* Cuerpo del log con scroll */}
        <div className="p-3 h-[480px] overflow-y-auto space-y-1 scrollbar-thin">
          {filteredLogs.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-[#8b949e] space-y-2">
              <Terminal className="w-8 h-8 opacity-40" />
              <span>No hay registros de eventos para el filtro seleccionado</span>
            </div>
          ) : (
            filteredLogs.map((log, index) => {
              const isErr = log.level === 'ERROR' || log.level === 'CRITICAL';
              const isWarn = log.level === 'WARNING';
              const isTraceExpanded = expandedTracebacks[index];

              return (
                <div
                  key={`${log.timestamp}-${index}`}
                  className={`p-1.5 rounded transition-colors ${
                    isErr
                      ? 'bg-[rgba(248,81,73,0.12)] border-l-2 border-[#f85149]'
                      : isWarn
                      ? 'bg-[rgba(210,153,34,0.1)] border-l-2 border-[#d29922]'
                      : 'hover:bg-[#161b22]'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <span className="text-[#8b949e] shrink-0">{log.timestamp.slice(11, 19)}</span>

                    <Badge
                      variant="outline"
                      className={`text-[9px] px-1 py-0 h-4 font-mono font-bold shrink-0 ${
                        isErr
                          ? 'border-[#f85149] text-[#f85149] bg-[rgba(248,81,73,0.1)]'
                          : isWarn
                          ? 'border-[#d29922] text-[#d29922] bg-[rgba(210,153,34,0.1)]'
                          : 'border-[#58a6ff] text-[#58a6ff] bg-[rgba(88,166,255,0.1)]'
                      }`}
                    >
                      {log.level}
                    </Badge>

                    <span className="text-[#79c0ff] shrink-0">[{log.logger}]:</span>

                    <span className={`flex-1 break-words ${isErr ? 'text-[#ff7b72] font-semibold' : 'text-[#c9d1d9]'}`}>
                      {log.message}
                    </span>

                    {log.traceback && (
                      <button
                        onClick={() => toggleTraceback(index)}
                        className="text-[10px] text-[#58a6ff] hover:underline flex items-center gap-0.5 shrink-0 cursor-pointer"
                      >
                        {isTraceExpanded ? (
                          <>
                            <span>Ocultar Detalle</span>
                            <ChevronDown className="w-3 h-3" />
                          </>
                        ) : (
                          <>
                            <span>Ver Error Detallado</span>
                            <ChevronRight className="w-3 h-3" />
                          </>
                        )}
                      </button>
                    )}
                  </div>

                  {log.traceback && isTraceExpanded && (
                    <pre className="mt-2 p-2 bg-[#090d13] border border-[#30363d] rounded text-[#ff7b72] text-[10px] overflow-x-auto whitespace-pre-wrap">
                      {log.traceback}
                    </pre>
                  )}
                </div>
              );
            })
          )}
          <div ref={terminalEndRef} />
        </div>
      </div>
    </div>
  );
};
