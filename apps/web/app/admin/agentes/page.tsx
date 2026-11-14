'use client';

import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, Plus, ShieldOff } from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DataTable,
  type DataTableColumnDef,
} from '@/components/ui/data-table/data-table';
import { Sheet } from '@/components/ui/sheet';
import { useToast } from '@/components/ui/toast';
import type { ExportColumn } from '@/lib/export/exporters';

type AgentRow = {
  id: string;
  tenant_id: string;
  nombre: string;
  version: string | null;
  ultimo_latido: string | null;
  revocado_en: string | null;
  created_at: string;
  tenants?: {
    tenant_code: string;
    nombre_comercial: string;
  } | null;
};

interface TenantOption {
  id: string;
  tenant_code: string;
  nombre_comercial: string;
}

interface AgentesResponse {
  data: AgentRow[];
  total: number;
  page: number;
  pageSize: number;
  tenants: TenantOption[];
}

function getAgentHealth(row: AgentRow): {
  label: string;
  variant: BadgeVariant;
} {
  if (row.revocado_en) {
    return { label: 'Revocado', variant: 'danger' };
  }
  if (!row.ultimo_latido) {
    return { label: 'Pendiente', variant: 'default' };
  }
  const diffSec = (Date.now() - new Date(row.ultimo_latido).getTime()) / 1000;
  if (diffSec <= 180) {
    return { label: 'En línea', variant: 'success' };
  }
  return { label: 'Sin señal (>3 min)', variant: 'warning' };
}

export default function AdminAgentesPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(25);
  const [search, setSearch] = React.useState('');
  const [sheetOpen, setSheetOpen] = React.useState(false);

  const [selectedTenantId, setSelectedTenantId] = React.useState('');
  const [ttlMinutos, setTtlMinutos] = React.useState('30');
  const [generatedCode, setGeneratedCode] = React.useState<string | null>(null);
  const [generatedExpiry, setGeneratedExpiry] = React.useState<string | null>(
    null,
  );
  const [submitting, setSubmitting] = React.useState(false);

  const { data, isLoading } = useQuery<AgentesResponse>({
    queryKey: ['admin-agentes', page, pageSize, search],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        search,
      });
      const res = await fetch(`/api/admin/agentes?${params.toString()}`);
      if (!res.ok) {
        throw new Error('Error al cargar agentes locales');
      }
      return (await res.json()) as AgentesResponse;
    },
  });

  const tenants = data?.tenants ?? [];

  React.useEffect(() => {
    const firstTenant = tenants[0];
    if (!selectedTenantId && firstTenant) {
      setSelectedTenantId(firstTenant.id);
    }
  }, [selectedTenantId, tenants]);

  async function handleGenerateCode(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedTenantId) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/admin/agentes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant_id: selectedTenantId,
          ttl_minutos: Number(ttlMinutos) || 30,
        }),
      });
      const json = (await res.json()) as {
        codigo_enrolamiento?: string;
        expira_en?: string;
        error?: string;
      };
      if (!res.ok || !json.codigo_enrolamiento) {
        toast({
          title: 'Error al generar código',
          description: json.error ?? 'Intente nuevamente.',
          variant: 'danger',
        });
        return;
      }
      setGeneratedCode(json.codigo_enrolamiento);
      setGeneratedExpiry(json.expira_en ?? null);
      toast({
        title: 'Código de enrolamiento generado',
        description:
          'Cópielo ahora. Por seguridad solo se muestra una única vez.',
        variant: 'success',
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRevoke(agent: AgentRow) {
    const res = await fetch('/api/admin/agentes', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agente_id: agent.id }),
    });
    if (res.ok) {
      toast({
        title: 'Agente revocado',
        description: `Se revocó la credencial de ${agent.nombre}.`,
        variant: 'default',
      });
      await queryClient.invalidateQueries({ queryKey: ['admin-agentes'] });
    }
  }

  const columns = React.useMemo<DataTableColumnDef<AgentRow>[]>(
    () => [
      {
        id: 'nombre',
        accessorKey: 'nombre',
        header: 'Hostname / Agente',
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-semibold text-[var(--text)]">
              {row.original.nombre}
            </span>
            <span className="font-mono text-xs text-[var(--text-3)]">
              {row.original.id.slice(0, 8)}
            </span>
          </div>
        ),
      },
      {
        id: 'empresa',
        header: 'Empresa (Tenant)',
        accessorFn: (r: AgentRow) => r.tenants?.nombre_comercial ?? r.tenant_id,
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-medium text-[var(--text)]">
              {row.original.tenants?.nombre_comercial ?? '—'}
            </span>
            <span className="font-mono text-xs text-[var(--text-2)]">
              {row.original.tenants?.tenant_code ?? ''}
            </span>
          </div>
        ),
      },
      {
        id: 'version',
        accessorKey: 'version',
        header: 'Versión Python',
        cell: ({ row }) => (
          <span className="font-mono text-xs text-[var(--text-2)]">
            {row.original.version ?? '—'}
          </span>
        ),
      },
      {
        id: 'estado',
        header: 'Estado del Agente',
        accessorFn: (r: AgentRow) => getAgentHealth(r).label,
        cell: ({ row }) => {
          const health = getAgentHealth(row.original);
          return <Badge variant={health.variant}>{health.label}</Badge>;
        },
      },
      {
        id: 'ultimo_latido',
        accessorKey: 'ultimo_latido',
        header: 'Último Latido (Tijuana)',
        meta: { isNumeric: true },
        cell: ({ row }) => (
          <span className="tabular-nums text-xs text-[var(--text-2)]">
            {row.original.ultimo_latido
              ? new Intl.DateTimeFormat('es-MX', {
                  dateStyle: 'short',
                  timeStyle: 'medium',
                  timeZone: 'America/Tijuana',
                }).format(new Date(row.original.ultimo_latido))
              : 'Sin latidos'}
          </span>
        ),
      },
      {
        id: 'acciones',
        header: 'Acciones',
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-[var(--s-2)]">
            {!row.original.revocado_en && (
              <Button
                variant="secondary"
                onClick={() => void handleRevoke(row.original)}
              >
                <ShieldOff className="h-3.5 w-3.5 text-[var(--danger)]" />
                Revocar
              </Button>
            )}
          </div>
        ),
      },
    ],
    [],
  );

  const exportColumns = React.useMemo<ExportColumn<AgentRow>[]>(
    () => [
      { header: 'Agente', accessor: (r: AgentRow) => r.nombre },
      {
        header: 'Empresa',
        accessor: (r: AgentRow) => r.tenants?.nombre_comercial ?? r.tenant_id,
      },
      { header: 'Versión', accessor: (r: AgentRow) => r.version ?? '' },
      { header: 'Estado', accessor: (r: AgentRow) => getAgentHealth(r).label },
      {
        header: 'Último Latido',
        accessor: (r: AgentRow) => r.ultimo_latido ?? '',
      },
    ],
    [],
  );

  return (
    <AppShell
      title="Agentes Locales Python (ZKTeco / Hikvision)"
      subtitle="Enrolamiento seguro de un solo uso, monitoreo de latidos cada 60s y revocación remota"
      mode="admin"
      actions={
        <Button
          onClick={() => {
            setGeneratedCode(null);
            setGeneratedExpiry(null);
            setSheetOpen(true);
          }}
        >
          <Plus className="h-4 w-4" />
          Generar código de enrolamiento
        </Button>
      }
    >
      <DataTable
        caption="Agentes Locales Python registrados en sitios de clientes"
        columns={columns}
        data={data?.data ?? []}
        total={data?.total ?? 0}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Buscar por hostname o nombre del agente…"
        isLoading={isLoading}
        exportFilename="agentes-locales-sm-clock"
        exportColumns={exportColumns}
        emptyTitle="Sin agentes enrolados"
        emptyDescription="Genere un código de enrolamiento de un solo uso para vincular el Agente Local Python en el sitio del cliente."
      />

      <Sheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title="Código de Enrolamiento de Agente Local"
        description="El código expira automáticamente y solo puede canjearse una vez desde el sitio del cliente."
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
              form="agente-enrolar-sheet-form"
              disabled={submitting}
            >
              {submitting ? 'Generando…' : 'Generar nuevo código'}
            </Button>
          </>
        }
      >
        <form
          id="agente-enrolar-sheet-form"
          onSubmit={(e) => void handleGenerateCode(e)}
          className="flex flex-col gap-[var(--s-4)]"
        >
          <div className="flex flex-col gap-[var(--s-1)]">
            <label htmlFor="select-tenant-agent" className="ios-label">
              Empresa destino (Tenant)
            </label>
            <select
              id="select-tenant-agent"
              value={selectedTenantId}
              onChange={(e) => setSelectedTenantId(e.target.value)}
              className="ios-input w-full px-[var(--s-3)] text-sm"
            >
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.tenant_code} — {t.nombre_comercial}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-[var(--s-1)]">
            <label htmlFor="select-ttl-agent" className="ios-label">
              Vigencia del código (minutos)
            </label>
            <select
              id="select-ttl-agent"
              value={ttlMinutos}
              onChange={(e) => setTtlMinutos(e.target.value)}
              className="ios-input w-full px-[var(--s-3)] text-sm"
            >
              <option value="15">15 minutos</option>
              <option value="30">30 minutos (Recomendado)</option>
              <option value="60">1 hora</option>
              <option value="240">4 horas</option>
            </select>
          </div>

          {generatedCode && (
            <div className="rounded-[var(--r-lg)] border border-[var(--separator)] bg-[var(--bg-elevated)] p-[var(--s-4)]">
              <div className="flex items-center gap-[var(--s-2)] text-xs font-semibold text-[var(--primary)]">
                <KeyRound className="h-4 w-4" />
                <span>Código de un solo uso (no se volverá a mostrar)</span>
              </div>
              <div className="mt-[var(--s-2)] flex items-center justify-between gap-[var(--s-2)] rounded-[var(--r-md)] bg-[var(--fill-tertiary)] px-[var(--s-3)] py-[var(--s-2)]">
                <code className="font-mono text-sm font-bold text-[var(--text)]">
                  {generatedCode}
                </code>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    void navigator.clipboard.writeText(generatedCode);
                    toast({
                      title: 'Copiado al portapapeles',
                      variant: 'default',
                    });
                  }}
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copiar
                </Button>
              </div>
              {generatedExpiry && (
                <p className="mt-[var(--s-2)] text-xs text-[var(--text-2)]">
                  Expira:{' '}
                  {new Intl.DateTimeFormat('es-MX', {
                    dateStyle: 'short',
                    timeStyle: 'medium',
                    timeZone: 'America/Tijuana',
                  }).format(new Date(generatedExpiry))}
                </p>
              )}
            </div>
          )}
        </form>
      </Sheet>
    </AppShell>
  );
}
