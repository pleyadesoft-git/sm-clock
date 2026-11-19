'use client';

import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  BellRing,
  ExternalLink,
  Mail,
  MessageSquare,
  MonitorSpeaker,
  Pencil,
  Play,
  Plus,
  Power,
  Radio,
  Sparkles,
  Trash2,
  Volume2,
  X,
} from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import {
  buildPersonalizedVoiceText,
  buildWhatsAppWebUrl,
  MensajeChecadaCreateSchema,
  PLANTILLAS_MENSAJES_RH,
  type AgentTriggeredNotificationItem,
  type MensajeAlcance,
  type MensajeCanalUtilizado,
  type MensajeEstatusEntrega,
  type MensajeEventoDisparo,
  type MensajeModoEntrega,
  type MensajeRepeticion,
} from '@sm-clock/contracts';
import { speakPersonalizedPunchNotification } from '@/lib/audio/punch-voice-player';
import { useCurrentUser } from '@/lib/auth/use-current-user';
import type { ExportColumn } from '@/lib/export/exporters';
import { useTenantChannel } from '@/lib/realtime/use-tenant-channel';
import { AppShell } from '@/components/layout/app-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  DataTable,
  type DataTableColumnDef,
} from '@/components/ui/data-table/data-table';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Sheet } from '@/components/ui/sheet';
import { TableActionsMenu } from '@/components/ui/table-actions-menu';
import { useToast } from '@/components/ui/toast';

type MensajeFormInput = z.input<typeof MensajeChecadaCreateSchema>;
type MensajeFormOutput = z.output<typeof MensajeChecadaCreateSchema>;

interface EmpleadoOption {
  id: string;
  codigo_empleado: string;
  nombre_completo: string;
  email: string | null;
  telefono_whatsapp: string | null;
  departamento: string | null;
  sucursal_id: string | null;
}

interface SucursalOption {
  id: string;
  clave: string;
  nombre: string;
}

interface FuenteItem {
  id: string;
  nombre_ubicacion: string;
  marca: string;
  modelo: string | null;
  activo: boolean;
  soporta_mensajes_pantalla: boolean;
}

interface MensajeChecadaRow {
  id: string;
  tenant_id: string;
  titulo: string;
  mensaje: string;
  texto_voz_personalizado: string | null;
  reproducir_audio: boolean;
  alcance: MensajeAlcance;
  empleado_id: string | null;
  sucursal_id: string | null;
  departamento: string | null;
  evento_disparo: MensajeEventoDisparo;
  modo_entrega: MensajeModoEntrega;
  repeticion: MensajeRepeticion;
  activo: boolean;
  vigente_hasta: string | null;
  created_at: string;
  empleados?: {
    id: string;
    codigo_empleado: string;
    nombre_completo: string;
    email: string | null;
    telefono_whatsapp: string | null;
    departamento: string | null;
  } | null;
  sucursales?: {
    id: string;
    clave: string;
    nombre: string;
  } | null;
  estadisticas: {
    total: number;
    dispositivo: number;
    email: number;
    whatsapp: number;
    sin_canal: number;
  };
}

interface EntregaRow {
  id: string;
  tenant_id: string;
  mensaje_id: string;
  empleado_id: string;
  codigo_empleado: string;
  checada_id: number | null;
  tipo_marca: 'ENTRADA' | 'SALIDA' | 'CHECADA';
  canal_utilizado: MensajeCanalUtilizado;
  estatus_entrega: MensajeEstatusEntrega;
  dispositivo_soportaba: boolean;
  email_destino: string | null;
  telefono_whatsapp: string | null;
  whatsapp_web_url: string | null;
  detalle: string | null;
  entregado_en: string;
  empleados?: {
    id: string;
    codigo_empleado: string;
    nombre_completo: string;
    email: string | null;
    telefono_whatsapp: string | null;
    departamento: string | null;
  } | null;
  mensajes_checadas?: {
    id: string;
    titulo: string;
    mensaje: string;
    alcance: MensajeAlcance;
  } | null;
}

interface MensajesResponse {
  data: MensajeChecadaRow[];
  entregas: EntregaRow[];
  empleados: EmpleadoOption[];
  sucursales: SucursalOption[];
  departamentos: string[];
  fuentes: FuenteItem[];
  kpis: {
    avisos_activos: number;
    entregas_dispositivo: number;
    entregas_email: number;
    pendientes_whatsapp: number;
    sin_canal_disponible: number;
  };
}

function formatTijuanaDateTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat('es-MX', {
      timeZone: 'America/Tijuana',
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export default function MensajesChecadasPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: currentUser } = useCurrentUser();

  const [activeTab, setActiveTab] = React.useState<
    'avisos' | 'entregas' | 'dispositivos'
  >('avisos');
  const [search, setSearch] = React.useState('');
  const [alcanceFilter, setAlcanceFilter] = React.useState<string | undefined>();
  const [estatusFilter, setEstatusFilter] = React.useState<string | undefined>();
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(25);

  const [entregasSearch, setEntregasSearch] = React.useState('');
  const [entregasPage, setEntregasPage] = React.useState(1);
  const [entregasPageSize, setEntregasPageSize] = React.useState(25);

  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<MensajeChecadaRow | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  // Estado para simulador en vivo de checada + audio dinámico
  const [simEmpleadoId, setSimEmpleadoId] = React.useState('');
  const [simMarca, setSimMarca] = React.useState<'ENTRADA' | 'SALIDA'>('ENTRADA');
  const [simFuenteId, setSimFuenteId] = React.useState('');
  const [simRunning, setSimRunning] = React.useState(false);
  const [liveBannerNotification, setLiveBannerNotification] =
    React.useState<AgentTriggeredNotificationItem | null>(null);

  const { data, isLoading } = useQuery<MensajesResponse>({
    queryKey: ['mensajes-checadas', search, alcanceFilter, estatusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (alcanceFilter) params.set('alcance', alcanceFilter);
      if (estatusFilter) params.set('estatus', estatusFilter);

      const res = await fetch(`/api/mensajes?${params.toString()}`, {
        cache: 'no-store',
      });
      if (!res.ok) {
        throw new Error('Error al consultar avisos de asistencia');
      }
      return (await res.json()) as MensajesResponse;
    },
  });

  const effectiveTenantId =
    currentUser?.tenantId ?? data?.data?.[0]?.tenant_id;

  const { status: realtimeState } = useTenantChannel({
    tenantId: effectiveTenantId,
    queryKeysToInvalidate: [['mensajes-checadas']],
    events: ['*'],
  });

  const empleados = data?.empleados ?? [];
  const sucursales = data?.sucursales ?? [];
  const departamentos = data?.departamentos ?? [];
  const fuentes = data?.fuentes ?? [];

  React.useEffect(() => {
    if (!simEmpleadoId && empleados.length > 0) {
      setSimEmpleadoId(empleados[0]?.id ?? '');
    }
    if (!simFuenteId && fuentes.length > 0) {
      setSimFuenteId(fuentes[0]?.id ?? '');
    }
  }, [empleados, fuentes, simEmpleadoId, simFuenteId]);

  const form = useForm<MensajeFormInput, unknown, MensajeFormOutput>({
    resolver: zodResolver(MensajeChecadaCreateSchema),
    defaultValues: {
      titulo: '',
      mensaje: '',
      texto_voz_personalizado:
        'Hola {nombre}, favor de atender el siguiente aviso de Recursos Humanos: {mensaje}',
      reproducir_audio: true,
      alcance: 'EMPLEADO',
      empleado_id: '',
      sucursal_id: '',
      departamento: '',
      evento_disparo: 'CUALQUIERA',
      modo_entrega: 'AUTO_FALLBACK',
      repeticion: 'UNA_VEZ',
      activo: true,
      vigente_hasta: null,
    },
    mode: 'onTouched',
  });

  const watchedAlcance = form.watch('alcance') ?? 'EMPLEADO';
  const watchedTitulo = form.watch('titulo') ?? '';
  const watchedMensaje = form.watch('mensaje') ?? '';
  const watchedVoz = form.watch('texto_voz_personalizado') ?? '';
  const watchedEmpleadoId = form.watch('empleado_id');
  const watchedEvento = form.watch('evento_disparo') ?? 'CUALQUIERA';

  function openNewSheet() {
    setEditing(null);
    form.reset({
      titulo: '',
      mensaje: '',
      texto_voz_personalizado:
        'Hola {nombre}, favor de atender el siguiente aviso de Recursos Humanos: {mensaje}',
      reproducir_audio: true,
      alcance: 'EMPLEADO',
      empleado_id: empleados[0]?.id ?? '',
      sucursal_id: sucursales[0]?.id ?? '',
      departamento: departamentos[0] ?? '',
      evento_disparo: 'CUALQUIERA',
      modo_entrega: 'AUTO_FALLBACK',
      repeticion: 'UNA_VEZ',
      activo: true,
      vigente_hasta: null,
    });
    setSheetOpen(true);
  }

  function openEditSheet(row: MensajeChecadaRow) {
    setEditing(row);
    form.reset({
      titulo: row.titulo,
      mensaje: row.mensaje,
      texto_voz_personalizado:
        row.texto_voz_personalizado ??
        'Hola {nombre}, favor de atender el siguiente aviso de Recursos Humanos: {mensaje}',
      reproducir_audio: row.reproducir_audio,
      alcance: row.alcance,
      empleado_id: row.empleado_id ?? '',
      sucursal_id: row.sucursal_id ?? '',
      departamento: row.departamento ?? '',
      evento_disparo: row.evento_disparo,
      modo_entrega: row.modo_entrega,
      repeticion: row.repeticion,
      activo: row.activo,
      vigente_hasta: row.vigente_hasta,
    });
    setSheetOpen(true);
  }

  function applyTemplate(tplId: string) {
    const tpl = PLANTILLAS_MENSAJES_RH.find((t) => t.id === tplId);
    if (!tpl) return;
    form.setValue('titulo', tpl.titulo, {
      shouldDirty: true,
      shouldValidate: true,
    });
    form.setValue('mensaje', tpl.mensaje, {
      shouldDirty: true,
      shouldValidate: true,
    });
    form.setValue('texto_voz_personalizado', tpl.texto_voz_personalizado, {
      shouldDirty: true,
      shouldValidate: true,
    });
    form.setValue('evento_disparo', tpl.evento_disparo, {
      shouldDirty: true,
      shouldValidate: true,
    });
  }

  async function handlePreviewVoice() {
    const selectedEmp =
      empleados.find((e) => e.id === watchedEmpleadoId) ?? empleados[0];
    const sampleName = selectedEmp?.nombre_completo ?? 'Alejandro Hernández';
    const sampleCode = selectedEmp?.codigo_empleado ?? '1001';

    const previewSpeech = buildPersonalizedVoiceText({
      template: watchedVoz,
      nombreEmpleado: sampleName,
      codigoEmpleado: sampleCode,
      titulo: watchedTitulo || 'Aviso de Recursos Humanos',
      mensaje: watchedMensaje || 'Pasar a RH a firmar contrato',
      tipoMarca: watchedEvento === 'SALIDA' ? 'SALIDA' : 'ENTRADA',
    });

    await speakPersonalizedPunchNotification(previewSpeech, {
      playChime: true,
    });

    toast({
      title: 'Reproduciendo audio personalizado',
      description: `“${previewSpeech}”`,
      variant: 'default',
    });
  }

  async function handleSave(values: MensajeFormOutput) {
    setSubmitting(true);
    try {
      const method = editing ? 'PATCH' : 'POST';
      const payload = editing ? { id: editing.id, ...values } : values;

      const res = await fetch('/api/mensajes', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as { error?: string };

      if (!res.ok) {
        toast({
          title: 'Error al guardar aviso',
          description: json.error ?? 'Revisa los campos del formulario.',
          variant: 'danger',
        });
        return;
      }

      await queryClient.invalidateQueries({ queryKey: ['mensajes-checadas'] });
      setSheetOpen(false);
      setEditing(null);
      toast({
        title: editing ? 'Aviso actualizado' : 'Aviso programado',
        description:
          values.alcance === 'EMPLEADO'
            ? 'El aviso se disparará cuando el empleado realice su checada.'
            : 'El aviso masivo quedó activo para los colaboradores seleccionados.',
        variant: 'success',
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggleActivo(row: MensajeChecadaRow) {
    const res = await fetch('/api/mensajes', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: row.id, activo: !row.activo }),
    });
    if (res.ok) {
      await queryClient.invalidateQueries({ queryKey: ['mensajes-checadas'] });
      toast({
        title: !row.activo ? 'Aviso reactivado' : 'Aviso pausado',
        description: row.titulo,
        variant: 'success',
      });
    }
  }

  async function handleDelete(row: MensajeChecadaRow) {
    const res = await fetch(`/api/mensajes?id=${encodeURIComponent(row.id)}`, {
      method: 'DELETE',
    });
    if (res.ok) {
      await queryClient.invalidateQueries({ queryKey: ['mensajes-checadas'] });
      toast({
        title: 'Aviso eliminado',
        description: row.titulo,
        variant: 'success',
      });
    }
  }

  async function handleToggleDeviceScreen(fuente: FuenteItem) {
    const nextValue = !fuente.soporta_mensajes_pantalla;
    const res = await fetch('/api/mensajes', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accion: 'TOGGLE_FUENTE_PANTALLA',
        fuente_id: fuente.id,
        soporta_mensajes_pantalla: nextValue,
      }),
    });

    if (res.ok) {
      await queryClient.invalidateQueries({ queryKey: ['mensajes-checadas'] });
      toast({
        title: nextValue
          ? 'Mensajes en pantalla habilitados'
          : 'Fallback automático por Correo / WhatsApp activado',
        description: nextValue
          ? `${fuente.nombre_ubicacion} mostrará avisos en pantalla y audio en el agente.`
          : `${fuente.nombre_ubicacion} enviará correo SMTP o WhatsApp Web al checar.`,
        variant: 'success',
      });
    }
  }

  async function handleSimulatePunch() {
    if (!simEmpleadoId) {
      toast({
        title: 'Selecciona un empleado',
        description: 'Elige un empleado para simular su check-in o check-out.',
        variant: 'danger',
      });
      return;
    }

    setSimRunning(true);
    try {
      const res = await fetch('/api/mensajes/probar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          empleado_id: simEmpleadoId,
          tipo_marca: simMarca,
          fuente_id: simFuenteId || undefined,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        notificaciones_disparadas?: AgentTriggeredNotificationItem[];
      };

      if (!res.ok) {
        toast({
          title: 'Error en simulación',
          description: json.error ?? 'No se pudo procesar la prueba.',
          variant: 'danger',
        });
        return;
      }

      await queryClient.invalidateQueries({ queryKey: ['mensajes-checadas'] });

      const triggered = json.notificaciones_disparadas ?? [];
      if (triggered.length === 0) {
        toast({
          title: 'Sin avisos pendientes para este empleado',
          description:
            'No hay avisos activos que coincidan con este empleado y tipo de checada (o ya fueron entregados si eran de 1 sola vez).',
          variant: 'default',
        });
        return;
      }

      const firstNotif = triggered[0];
      if (firstNotif) {
        setLiveBannerNotification(firstNotif);
        if (firstNotif.reproducir_audio) {
          await speakPersonalizedPunchNotification(firstNotif.texto_voz, {
            playChime: true,
          });
        }
      }

      toast({
        title: `${triggered.length} aviso(s) disparado(s) al checar`,
        description:
          firstNotif?.estatus_entrega === 'ENTREGADO_EMAIL'
            ? 'El dispositivo no soportaba pantalla: se envió correo automático por SMTP.'
            : firstNotif?.estatus_entrega === 'SIN_CANAL_DISPONIBLE'
              ? 'Alerta: Dispositivo sin pantalla y empleado sin correo/WhatsApp.'
              : 'Notificación visual y audio dinámico reproducidos.',
        variant:
          firstNotif?.estatus_entrega === 'SIN_CANAL_DISPONIBLE'
            ? 'danger'
            : 'success',
      });
    } finally {
      setSimRunning(false);
    }
  }

  const avisosColumns = React.useMemo<DataTableColumnDef<MensajeChecadaRow>[]>(
    () => [
      {
        id: 'titulo',
        accessorKey: 'titulo',
        header: 'Aviso / Mensaje al Checar',
        cell: ({ row }) => (
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-[var(--s-2)]">
              <span className="font-semibold text-[var(--text)]">
                {row.original.titulo}
              </span>
              {row.original.reproducir_audio ? (
                <Badge variant="accent">
                  <Volume2 className="mr-1 size-3" aria-hidden="true" />
                  Audio TTS
                </Badge>
              ) : null}
            </div>
            <span className="text-xs text-[var(--text-2)]">
              “{row.original.mensaje}”
            </span>
          </div>
        ),
      },
      {
        id: 'alcance',
        header: 'Destinatarios',
        accessorFn: (r) => r.alcance,
        cell: ({ row }) => {
          const item = row.original;
          if (item.alcance === 'EMPLEADO') {
            return (
              <div className="flex flex-col">
                <Badge variant="default">Individual</Badge>
                <span className="mt-1 text-xs font-medium text-[var(--text)]">
                  {item.empleados
                    ? `#${item.empleados.codigo_empleado} · ${item.empleados.nombre_completo}`
                    : 'Empleado asignado'}
                </span>
              </div>
            );
          }
          if (item.alcance === 'SUCURSAL') {
            return (
              <div className="flex flex-col">
                <Badge variant="info">Masivo · Sucursal</Badge>
                <span className="mt-1 text-xs font-medium text-[var(--text)]">
                  {item.sucursales
                    ? `${item.sucursales.clave} · ${item.sucursales.nombre}`
                    : 'Sucursal'}
                </span>
              </div>
            );
          }
          if (item.alcance === 'DEPARTAMENTO') {
            return (
              <div className="flex flex-col">
                <Badge variant="info">Masivo · Depto.</Badge>
                <span className="mt-1 text-xs font-medium text-[var(--text)]">
                  {item.departamento ?? 'General'}
                </span>
              </div>
            );
          }
          return <Badge variant="accent">Masivo · Toda la Empresa</Badge>;
        },
      },
      {
        id: 'evento_disparo',
        header: 'Disparador',
        accessorFn: (r) => r.evento_disparo,
        cell: ({ row }) => {
          const ev = row.original.evento_disparo;
          const rep = row.original.repeticion;
          return (
            <div className="flex flex-col gap-1">
              <Badge
                variant={
                  ev === 'ENTRADA'
                    ? 'success'
                    : ev === 'SALIDA'
                      ? 'warning'
                      : 'default'
                }
              >
                {ev === 'ENTRADA'
                  ? 'Al hacer Check-In'
                  : ev === 'SALIDA'
                    ? 'Al hacer Check-Out'
                    : 'Check-In o Check-Out'}
              </Badge>
              <span className="text-xs text-[var(--text-2)]">
                {rep === 'UNA_VEZ' ? 'Mostrar 1 sola vez' : 'Mientras esté vigente'}
              </span>
            </div>
          );
        },
      },
      {
        id: 'entregas',
        header: 'Entregas y Fallback',
        accessorFn: (r) => r.estadisticas.total,
        cell: ({ row }) => {
          const st = row.original.estadisticas;
          return (
            <div className="flex flex-wrap items-center gap-[var(--s-2)] text-xs">
              <Badge variant="default">Total: {st.total}</Badge>
              {st.dispositivo > 0 ? (
                <Badge variant="success">Reloj/Audio: {st.dispositivo}</Badge>
              ) : null}
              {st.email > 0 ? (
                <Badge variant="info">Email SMTP: {st.email}</Badge>
              ) : null}
              {st.whatsapp > 0 ? (
                <Badge variant="warning">WhatsApp Web: {st.whatsapp}</Badge>
              ) : null}
              {st.sin_canal > 0 ? (
                <Badge variant="danger">Sin canal: {st.sin_canal}</Badge>
              ) : null}
            </div>
          );
        },
      },
      {
        id: 'activo',
        header: 'Estatus',
        accessorFn: (r) => (r.activo ? 'ACTIVO' : 'INACTIVO'),
        cell: ({ row }) => (
          <Badge variant={row.original.activo ? 'success' : 'default'}>
            {row.original.activo ? 'Activo' : 'Completado / Pausado'}
          </Badge>
        ),
      },
      {
        id: 'acciones',
        header: 'Acciones',
        enableSorting: false,
        cell: ({ row }) => {
          const item = row.original;
          const empWhatsappUrl = item.empleados
            ? buildWhatsAppWebUrl({
                telefonoWhatsapp: item.empleados.telefono_whatsapp,
                nombreEmpleado: item.empleados.nombre_completo,
                tenantNombre: currentUser?.tenantNombre ?? 'Recursos Humanos',
                titulo: item.titulo,
                mensaje: item.mensaje,
                tipoMarca:
                  item.evento_disparo === 'SALIDA' ? 'SALIDA' : 'ENTRADA',
              })
            : null;

          return (
            <div className="flex items-center justify-end gap-[var(--s-1)]">
              {empWhatsappUrl ? (
                <a
                  href={empWhatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Abrir WhatsApp Web con mensaje prellenado"
                  className="inline-flex items-center gap-1 rounded-[var(--r-md)] border border-[var(--separator)] bg-[var(--surface-2)] px-[var(--s-3)] py-[var(--s-1)] text-xs font-semibold text-[var(--success)] transition-colors hover:bg-[var(--surface)]"
                >
                  <MessageSquare className="size-3.5" aria-hidden="true" />
                  WhatsApp
                </a>
              ) : null}
              <TableActionsMenu
                label={`Acciones para ${item.titulo}`}
                actions={[
                  {
                    id: 'escuchar-voz',
                    label: 'Escuchar audio personalizado',
                    icon: Volume2,
                    onClick: () => {
                      const voice = buildPersonalizedVoiceText({
                        template: item.texto_voz_personalizado,
                        nombreEmpleado:
                          item.empleados?.nombre_completo ??
                          'Colaborador de Planta',
                        codigoEmpleado:
                          item.empleados?.codigo_empleado ?? '1001',
                        titulo: item.titulo,
                        mensaje: item.mensaje,
                        tipoMarca:
                          item.evento_disparo === 'SALIDA'
                            ? 'SALIDA'
                            : 'ENTRADA',
                      });
                      void speakPersonalizedPunchNotification(voice);
                    },
                  },
                  {
                    id: 'editar',
                    label: 'Editar aviso',
                    icon: Pencil,
                    onClick: () => openEditSheet(item),
                  },
                  {
                    id: 'toggle',
                    label: item.activo ? 'Pausar aviso' : 'Reactivar aviso',
                    icon: Power,
                    onClick: () => void handleToggleActivo(item),
                  },
                  {
                    id: 'eliminar',
                    label: 'Eliminar aviso',
                    icon: Trash2,
                    variant: 'danger',
                    onClick: () => void handleDelete(item),
                  },
                ]}
              />
            </div>
          );
        },
      },
    ],
    [currentUser?.tenantNombre],
  );

  const entregasColumns = React.useMemo<DataTableColumnDef<EntregaRow>[]>(
    () => [
      {
        id: 'entregado_en',
        accessorKey: 'entregado_en',
        header: 'Fecha y Hora (Tijuana)',
        cell: ({ row }) => (
          <span className="font-mono text-xs text-[var(--text-2)]">
            {formatTijuanaDateTime(row.original.entregado_en)}
          </span>
        ),
      },
      {
        id: 'empleado',
        header: 'Empleado',
        accessorFn: (r) =>
          r.empleados?.nombre_completo ?? r.codigo_empleado,
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-semibold text-[var(--text)]">
              {row.original.empleados?.nombre_completo ?? 'Empleado'}
            </span>
            <span className="font-mono text-xs text-[var(--text-2)]">
              #{row.original.codigo_empleado} · {row.original.tipo_marca}
            </span>
          </div>
        ),
      },
      {
        id: 'aviso',
        header: 'Aviso Disparado',
        accessorFn: (r) => r.mensajes_checadas?.titulo ?? 'Aviso',
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-semibold text-[var(--text)]">
              {row.original.mensajes_checadas?.titulo ?? 'Aviso RH'}
            </span>
            <span className="text-xs text-[var(--text-2)]">
              “{row.original.mensajes_checadas?.mensaje ?? ''}”
            </span>
          </div>
        ),
      },
      {
        id: 'canal_estatus',
        header: 'Canal y Estado de Entrega',
        accessorFn: (r) => r.estatus_entrega,
        cell: ({ row }) => {
          const item = row.original;
          const badgeVariant =
            item.estatus_entrega === 'ENTREGADO_DISPOSITIVO'
              ? 'success'
              : item.estatus_entrega === 'ENTREGADO_EMAIL'
                ? 'info'
                : item.estatus_entrega === 'PENDIENTE_WHATSAPP_WEB'
                  ? 'warning'
                  : 'danger';

          const label =
            item.estatus_entrega === 'ENTREGADO_DISPOSITIVO'
              ? 'Mostrado en Reloj / Agente (Audio)'
              : item.estatus_entrega === 'ENTREGADO_EMAIL'
                ? `Fallback Correo SMTP (${item.email_destino ?? ''})`
                : item.estatus_entrega === 'PENDIENTE_WHATSAPP_WEB'
                  ? 'Listo para WhatsApp Web'
                  : item.estatus_entrega === 'SIN_CANAL_DISPONIBLE'
                    ? 'Sin Canal Disponible (Sin pantalla/correo/tel)'
                    : 'Error de Envío';

          return (
            <div className="flex flex-col gap-1">
              <Badge variant={badgeVariant}>{label}</Badge>
              {item.detalle ? (
                <span className="text-xs text-[var(--text-2)]">
                  {item.detalle}
                </span>
              ) : null}
            </div>
          );
        },
      },
      {
        id: 'accion_whatsapp',
        header: 'Acción Directa',
        enableSorting: false,
        cell: ({ row }) => {
          const item = row.original;
          const waUrl =
            item.whatsapp_web_url ??
            buildWhatsAppWebUrl({
              telefonoWhatsapp:
                item.telefono_whatsapp ??
                item.empleados?.telefono_whatsapp,
              nombreEmpleado:
                item.empleados?.nombre_completo ?? item.codigo_empleado,
              tenantNombre: currentUser?.tenantNombre ?? 'Recursos Humanos',
              titulo: item.mensajes_checadas?.titulo ?? 'Aviso de RH',
              mensaje: item.mensajes_checadas?.mensaje ?? '',
              tipoMarca: item.tipo_marca,
            });

          return (
            <div className="flex items-center justify-end gap-[var(--s-2)]">
              {waUrl ? (
                <a
                  href={waUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-[var(--r-md)] bg-[var(--success)] px-[var(--s-3)] py-[var(--s-2)] text-xs font-semibold text-white shadow-[var(--shadow-1)] transition-opacity hover:opacity-90"
                >
                  <ExternalLink className="size-3.5" aria-hidden="true" />
                  Enviar por WhatsApp Web
                </a>
              ) : (
                <span className="text-xs text-[var(--text-3)]">
                  Sin teléfono WhatsApp
                </span>
              )}
            </div>
          );
        },
      },
    ],
    [currentUser?.tenantNombre],
  );

  const exportAvisosColumns = React.useMemo<ExportColumn<MensajeChecadaRow>[]>(
    () => [
      { header: 'Título', accessor: (r) => r.titulo },
      { header: 'Mensaje', accessor: (r) => r.mensaje },
      { header: 'Alcance', accessor: (r) => r.alcance },
      { header: 'Disparador', accessor: (r) => r.evento_disparo },
      {
        header: 'Audio Personalizado',
        accessor: (r) => (r.reproducir_audio ? 'Sí' : 'No'),
      },
      { header: 'Total Entregas', accessor: (r) => r.estadisticas.total },
      {
        header: 'Estatus',
        accessor: (r) => (r.activo ? 'Activo' : 'Inactivo'),
      },
    ],
    [],
  );

  const exportEntregasColumns = React.useMemo<ExportColumn<EntregaRow>[]>(
    () => [
      {
        header: 'Fecha (Tijuana)',
        accessor: (r) => formatTijuanaDateTime(r.entregado_en),
      },
      { header: 'Código Empleado', accessor: (r) => r.codigo_empleado },
      {
        header: 'Empleado',
        accessor: (r) => r.empleados?.nombre_completo ?? '',
      },
      { header: 'Tipo Marca', accessor: (r) => r.tipo_marca },
      {
        header: 'Aviso',
        accessor: (r) => r.mensajes_checadas?.titulo ?? '',
      },
      { header: 'Canal', accessor: (r) => r.canal_utilizado },
      { header: 'Estatus Entrega', accessor: (r) => r.estatus_entrega },
    ],
    [],
  );

  const filteredEntregas = React.useMemo(() => {
    const list = data?.entregas ?? [];
    if (!entregasSearch.trim()) return list;
    const q = entregasSearch.toLowerCase();
    return list.filter(
      (e) =>
        e.codigo_empleado.toLowerCase().includes(q) ||
        (e.empleados?.nombre_completo ?? '').toLowerCase().includes(q) ||
        (e.mensajes_checadas?.titulo ?? '').toLowerCase().includes(q) ||
        e.estatus_entrega.toLowerCase().includes(q),
    );
  }, [data?.entregas, entregasSearch]);

  return (
    <AppShell
      title="Avisos y Notificaciones al Checar (Check-In / Check-Out)"
      subtitle="Mensajes en pantalla del reloj, notificación visual + audio dinámico personalizado en Agente y fallback por Correo SMTP / WhatsApp Web"
      mode="client"
      realtimeState={realtimeState}
      actions={
        <Button onClick={openNewSheet}>
          <Plus className="size-4" aria-hidden="true" />
          Nuevo aviso al empleado
        </Button>
      }
    >
      <div className="flex flex-col gap-[var(--s-5)]">
        {/* Banner interactivo cuando se dispara una notificación visual + audio dinámico */}
        {liveBannerNotification ? (
          <div
            role="alert"
            data-testid="live-punch-notification-banner"
            className="flex flex-col justify-between gap-[var(--s-3)] rounded-[var(--r-xl)] border-2 border-[var(--accent)] bg-[var(--surface)] p-[var(--s-4)] shadow-[var(--shadow-2)] sm:flex-row sm:items-center"
          >
            <div className="flex items-start gap-[var(--s-3)]">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent)]">
                <Volume2 className="size-6 animate-pulse" aria-hidden="true" />
              </div>
              <div className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-[var(--s-2)]">
                  <Badge variant="accent">
                    {liveBannerNotification.tipo_marca === 'ENTRADA'
                      ? 'CHECK-IN DETECTADO'
                      : 'CHECK-OUT DETECTADO'}
                  </Badge>
                  <span className="font-mono text-xs font-bold text-[var(--text)]">
                    #{liveBannerNotification.codigo_empleado} ·{' '}
                    {liveBannerNotification.nombre_empleado}
                  </span>
                  <Badge
                    variant={
                      liveBannerNotification.estatus_entrega ===
                      'ENTREGADO_DISPOSITIVO'
                        ? 'success'
                        : liveBannerNotification.estatus_entrega ===
                            'ENTREGADO_EMAIL'
                          ? 'info'
                          : liveBannerNotification.estatus_entrega ===
                              'PENDIENTE_WHATSAPP_WEB'
                            ? 'warning'
                            : 'danger'
                    }
                  >
                    {liveBannerNotification.estatus_entrega}
                  </Badge>
                </div>
                <h3 className="text-base font-bold text-[var(--text)]">
                  {liveBannerNotification.titulo}: “
                  {liveBannerNotification.mensaje}”
                </h3>
                <p className="text-xs text-[var(--text-2)]">
                  <strong>Audio personalizado (TTS):</strong> “
                  {liveBannerNotification.texto_voz}”
                </p>
              </div>
            </div>

            <div className="flex items-center gap-[var(--s-2)]">
              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  void speakPersonalizedPunchNotification(
                    liveBannerNotification.texto_voz,
                  )
                }
              >
                <Volume2 className="size-4" aria-hidden="true" />
                Repetir Audio
              </Button>
              {liveBannerNotification.whatsapp_web_url ? (
                <a
                  href={liveBannerNotification.whatsapp_web_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-[var(--r-md)] bg-[var(--success)] px-[var(--s-3)] py-[var(--s-2)] text-xs font-semibold text-white"
                >
                  <ExternalLink className="size-3.5" aria-hidden="true" />
                  WhatsApp Web
                </a>
              ) : null}
              <Button
                type="button"
                variant="plain"
                aria-label="Cerrar notificación en vivo"
                onClick={() => setLiveBannerNotification(null)}
              >
                <X className="size-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
        ) : null}

        {/* KPIs de Avisos y Canales de Entrega */}
        <div className="grid grid-cols-1 gap-[var(--s-3)] sm:grid-cols-2 lg:grid-cols-4">
          <Card className="flex flex-col justify-between p-[var(--s-4)]">
            <div className="flex items-center justify-between text-xs font-semibold text-[var(--text-2)]">
              <span>Avisos Activos</span>
              <BellRing className="size-4 text-[var(--accent)]" />
            </div>
            <div className="mt-[var(--s-2)] font-mono text-2xl font-bold text-[var(--text)]">
              {data?.kpis.avisos_activos ?? 0}
            </div>
            <span className="mt-1 text-xs text-[var(--text-2)]">
              Individuales y masivos por sucursal/depto.
            </span>
          </Card>

          <Card className="flex flex-col justify-between p-[var(--s-4)]">
            <div className="flex items-center justify-between text-xs font-semibold text-[var(--text-2)]">
              <span>Entregados en Reloj / Agente</span>
              <MonitorSpeaker className="size-4 text-[var(--success)]" />
            </div>
            <div className="mt-[var(--s-2)] font-mono text-2xl font-bold text-[var(--success)]">
              {data?.kpis.entregas_dispositivo ?? 0}
            </div>
            <span className="mt-1 text-xs text-[var(--text-2)]">
              Con pantalla local y voz dinámica (TTS)
            </span>
          </Card>

          <Card className="flex flex-col justify-between p-[var(--s-4)]">
            <div className="flex items-center justify-between text-xs font-semibold text-[var(--text-2)]">
              <span>Fallback Correo SMTP</span>
              <Mail className="size-4 text-[var(--accent)]" />
            </div>
            <div className="mt-[var(--s-2)] font-mono text-2xl font-bold text-[var(--accent)]">
              {data?.kpis.entregas_email ?? 0}
            </div>
            <span className="mt-1 text-xs text-[var(--text-2)]">
              Enviados cuando el reloj no tiene pantalla
            </span>
          </Card>

          <Card className="flex flex-col justify-between p-[var(--s-4)]">
            <div className="flex items-center justify-between text-xs font-semibold text-[var(--text-2)]">
              <span>Sin Canal / WhatsApp Web</span>
              <AlertTriangle
                className={`size-4 ${
                  (data?.kpis.sin_canal_disponible ?? 0) > 0
                    ? 'text-[var(--danger)]'
                    : 'text-[var(--warning)]'
                }`}
              />
            </div>
            <div className="mt-[var(--s-2)] flex items-baseline gap-[var(--s-2)]">
              <span className="font-mono text-2xl font-bold text-[var(--danger)]">
                {data?.kpis.sin_canal_disponible ?? 0}
              </span>
              <span className="text-xs text-[var(--text-2)]">
                sin canal · {data?.kpis.pendientes_whatsapp ?? 0} WhatsApp
              </span>
            </div>
            <span className="mt-1 text-xs text-[var(--text-2)]">
              Empleados sin correo en reloj sin pantalla
            </span>
          </Card>
        </div>

        {/* Simulador Rápido de Check-In / Check-Out para probar Audio Dinámico y Fallback SMTP */}
        <Card className="p-[var(--s-4)]">
          <div className="flex flex-col justify-between gap-[var(--s-3)] lg:flex-row lg:items-end">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-[var(--s-2)]">
                <Sparkles className="size-4 text-[var(--accent)]" />
                <h2 className="text-sm font-semibold text-[var(--text)]">
                  Probador en Vivo de Checada + Audio Dinámico Personalizado y
                  Fallback SMTP
                </h2>
              </div>
              <p className="text-xs text-[var(--text-2)]">
                Simula el Check-In o Check-Out de un empleado en una terminal
                para escuchar el mensaje de voz personalizado o verificar el
                envío por Correo SMTP / WhatsApp Web si la terminal no soporta
                pantalla.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-[var(--s-2)] sm:grid-cols-4">
              <select
                aria-label="Empleado para simular checada"
                value={simEmpleadoId}
                onChange={(e) => setSimEmpleadoId(e.target.value)}
                className="ios-input px-[var(--s-3)] text-xs"
              >
                <option value="">Selecciona empleado…</option>
                {empleados.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    #{emp.codigo_empleado} · {emp.nombre_completo}
                  </option>
                ))}
              </select>

              <select
                aria-label="Tipo de marca a simular"
                value={simMarca}
                onChange={(e) =>
                  setSimMarca(
                    e.target.value === 'SALIDA' ? 'SALIDA' : 'ENTRADA',
                  )
                }
                className="ios-input px-[var(--s-3)] text-xs"
              >
                <option value="ENTRADA">Check-In (Entrada)</option>
                <option value="SALIDA">Check-Out (Salida)</option>
              </select>

              <select
                aria-label="Terminal o reloj de prueba"
                value={simFuenteId}
                onChange={(e) => setSimFuenteId(e.target.value)}
                className="ios-input px-[var(--s-3)] text-xs"
              >
                <option value="">Terminal predeterminada</option>
                {fuentes.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.nombre_ubicacion} (
                    {f.soporta_mensajes_pantalla
                      ? 'Con Pantalla/Audio'
                      : 'Sin Pantalla → Fallback'}
                    )
                  </option>
                ))}
              </select>

              <Button
                type="button"
                disabled={simRunning || !simEmpleadoId}
                onClick={() => void handleSimulatePunch()}
              >
                <Play className="size-4" aria-hidden="true" />
                {simRunning ? 'Procesando…' : 'Simular Checada'}
              </Button>
            </div>
          </div>
        </Card>

        {/* Selector de Pestañas (Segmented Control iOS) */}
        <div
          role="tablist"
          aria-label="Secciones de avisos al empleado"
          className="inline-flex w-fit rounded-[var(--r-lg)] border border-[var(--separator)] bg-[var(--surface-2)] p-1"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'avisos'}
            onClick={() => setActiveTab('avisos')}
            className={`rounded-[var(--r-md)] px-[var(--s-4)] py-[var(--s-2)] text-xs font-semibold transition-all ${
              activeTab === 'avisos'
                ? 'bg-[var(--surface)] text-[var(--text)] shadow-[var(--shadow-1)]'
                : 'text-[var(--text-2)] hover:text-[var(--text)]'
            }`}
          >
            Avisos Programados ({data?.data.length ?? 0})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'entregas'}
            onClick={() => setActiveTab('entregas')}
            className={`rounded-[var(--r-md)] px-[var(--s-4)] py-[var(--s-2)] text-xs font-semibold transition-all ${
              activeTab === 'entregas'
                ? 'bg-[var(--surface)] text-[var(--text)] shadow-[var(--shadow-1)]'
                : 'text-[var(--text-2)] hover:text-[var(--text)]'
            }`}
          >
            Bitácora de Entregas y WhatsApp ({data?.entregas.length ?? 0})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'dispositivos'}
            onClick={() => setActiveTab('dispositivos')}
            className={`rounded-[var(--r-md)] px-[var(--s-4)] py-[var(--s-2)] text-xs font-semibold transition-all ${
              activeTab === 'dispositivos'
                ? 'bg-[var(--surface)] text-[var(--text)] shadow-[var(--shadow-1)]'
                : 'text-[var(--text-2)] hover:text-[var(--text)]'
            }`}
          >
            Terminales y Capacidad de Pantalla ({fuentes.length})
          </button>
        </div>

        {/* PESTAÑA 1: AVISOS PROGRAMADOS */}
        {activeTab === 'avisos' ? (
          <DataTable
            caption="Avisos y notificaciones programadas para empleados al registrar entrada o salida"
            columns={avisosColumns}
            data={data?.data ?? []}
            total={data?.data.length ?? 0}
            page={page}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            search={search}
            onSearchChange={(val) => {
              setSearch(val);
              setPage(1);
            }}
            searchPlaceholder="Buscar por título, mensaje o departamento…"
            filters={[
              {
                id: 'alcance',
                label: 'Alcance',
                value: alcanceFilter,
                onChange: (val) => {
                  setAlcanceFilter(val);
                  setPage(1);
                },
                options: [
                  { label: 'Individual (Por Empleado)', value: 'EMPLEADO' },
                  { label: 'Masivo por Sucursal', value: 'SUCURSAL' },
                  { label: 'Masivo por Departamento', value: 'DEPARTAMENTO' },
                  { label: 'Masivo Toda la Empresa', value: 'TODOS' },
                ],
              },
              {
                id: 'estatus',
                label: 'Estatus',
                value: estatusFilter,
                onChange: (val) => {
                  setEstatusFilter(val);
                  setPage(1);
                },
                options: [
                  { label: 'Activos', value: 'ACTIVO' },
                  { label: 'Completados / Inactivos', value: 'INACTIVO' },
                ],
              },
            ]}
            onClearFilters={() => {
              setAlcanceFilter(undefined);
              setEstatusFilter(undefined);
              setPage(1);
            }}
            isLoading={isLoading}
            exportFilename="avisos-rh-checadas"
            exportColumns={exportAvisosColumns}
            emptyTitle="Sin avisos programados"
            emptyDescription="Programa un aviso individual o masivo para que el empleado lo reciba en el reloj, con voz personalizada en el agente o por correo al checar."
            emptyAction={
              <Button onClick={openNewSheet}>
                <Plus className="size-4" aria-hidden="true" />
                Programar primer aviso
              </Button>
            }
          />
        ) : null}

        {/* PESTAÑA 2: BITÁCORA DE ENTREGAS Y FALLBACKS */}
        {activeTab === 'entregas' ? (
          <DataTable
            caption="Bitácora de avisos entregados en reloj, correo SMTP o WhatsApp Web"
            columns={entregasColumns}
            data={filteredEntregas}
            total={filteredEntregas.length}
            page={entregasPage}
            pageSize={entregasPageSize}
            onPageChange={setEntregasPage}
            onPageSizeChange={setEntregasPageSize}
            search={entregasSearch}
            onSearchChange={(val) => {
              setEntregasSearch(val);
              setEntregasPage(1);
            }}
            searchPlaceholder="Buscar por empleado, código, aviso o estatus…"
            isLoading={isLoading}
            exportFilename="bitacora-entregas-avisos-rh"
            exportColumns={exportEntregasColumns}
            emptyTitle="Aún no hay entregas registradas"
            emptyDescription="Cuando un empleado con un aviso activo realice Check-In o Check-Out, aquí aparecerá el canal utilizado y el enlace directo a WhatsApp Web."
          />
        ) : null}

        {/* PESTAÑA 3: CAPACIDAD DE PANTALLA POR DISPOSITIVO */}
        {activeTab === 'dispositivos' ? (
          <div className="grid grid-cols-1 gap-[var(--s-3)] md:grid-cols-2">
            {fuentes.map((fuente) => (
              <Card
                key={fuente.id}
                className="flex items-center justify-between gap-[var(--s-3)] p-[var(--s-4)]"
              >
                <div className="flex items-start gap-[var(--s-3)]">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--surface-2)] text-[var(--accent)]">
                    <Radio className="size-5" aria-hidden="true" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-[var(--s-2)]">
                      <span className="font-semibold text-[var(--text)]">
                        {fuente.nombre_ubicacion}
                      </span>
                      <Badge variant="default">{fuente.marca}</Badge>
                    </div>
                    <p className="text-xs text-[var(--text-2)]">
                      {fuente.soporta_mensajes_pantalla
                        ? 'Permite mostrar mensajes en pantalla y reproducir audio personalizado en el Agente.'
                        : 'No permite mensajes en pantalla: dispara fallback automático por Correo SMTP o WhatsApp Web.'}
                    </p>
                  </div>
                </div>

                <Button
                  type="button"
                  variant={
                    fuente.soporta_mensajes_pantalla ? 'secondary' : 'primary'
                  }
                  onClick={() => void handleToggleDeviceScreen(fuente)}
                >
                  {fuente.soporta_mensajes_pantalla
                    ? 'Simular Sin Pantalla (Fallback)'
                    : 'Habilitar Pantalla'}
                </Button>
              </Card>
            ))}
          </div>
        ) : null}
      </div>

      {/* Drawer (Sheet) con footer fijo para Crear / Editar Aviso (Regla Dura #11 y #12) */}
      <Sheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title={
          editing
            ? `Editar aviso · ${editing.titulo}`
            : 'Nuevo aviso al empleado en Check-In / Check-Out'
        }
        description="Si el reloj lo permite se mostrará en pantalla + audio personalizado en el agente; de lo contrario se enviará por correo SMTP o WhatsApp Web."
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
              type="button"
              variant="secondary"
              onClick={() => void handlePreviewVoice()}
            >
              <Volume2 className="size-4" aria-hidden="true" />
              Probar Audio TTS
            </Button>
            <Button
              type="submit"
              form="mensaje-checada-form"
              disabled={submitting}
              onClick={() => {
                void form.handleSubmit(handleSave)();
              }}
            >
              {submitting
                ? 'Guardando…'
                : editing
                  ? 'Guardar cambios'
                  : 'Programar aviso'}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-[var(--s-4)]">
          {/* Selector rápido de plantillas de RH */}
          <div className="rounded-[var(--r-lg)] border border-[var(--separator)] bg-[var(--surface-2)] p-[var(--s-3)]">
            <span className="block text-xs font-semibold text-[var(--text)]">
              Plantillas rápidas de Recursos Humanos y Administración
            </span>
            <div className="mt-[var(--s-2)] flex flex-wrap gap-[var(--s-2)]">
              {PLANTILLAS_MENSAJES_RH.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => applyTemplate(tpl.id)}
                  className="rounded-full border border-[var(--separator)] bg-[var(--surface)] px-[var(--s-3)] py-1 text-xs font-medium text-[var(--text)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
                >
                  {tpl.titulo}
                </button>
              ))}
            </div>
          </div>

          <Form {...form}>
            <form
              id="mensaje-checada-form"
              noValidate
              onSubmit={form.handleSubmit(handleSave)}
              className="flex flex-col gap-[var(--s-4)]"
            >
              <FormField
                control={form.control}
                name="alcance"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Alcance de destinatarios</FormLabel>
                    <FormControl>
                      <select
                        value={field.value ?? 'EMPLEADO'}
                        onChange={(e) =>
                          field.onChange(e.target.value as MensajeAlcance)
                        }
                        className="ios-input w-full px-[var(--s-3)] text-sm"
                      >
                        <option value="EMPLEADO">
                          Individual (Un empleado específico)
                        </option>
                        <option value="SUCURSAL">
                          Masivo por Planta / Sucursal
                        </option>
                        <option value="DEPARTAMENTO">
                          Masivo por Departamento
                        </option>
                        <option value="TODOS">
                          Masivo a Toda la Empresa
                        </option>
                      </select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {watchedAlcance === 'EMPLEADO' ? (
                <FormField
                  control={form.control}
                  name="empleado_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Empleado destinatario</FormLabel>
                      <FormControl>
                        <select
                          value={field.value ?? ''}
                          onChange={(e) => field.onChange(e.target.value)}
                          aria-invalid={Boolean(
                            form.formState.errors.empleado_id,
                          )}
                          className="ios-input w-full px-[var(--s-3)] text-sm"
                        >
                          <option value="">Selecciona un empleado…</option>
                          {empleados.map((emp) => (
                            <option key={emp.id} value={emp.id}>
                              #{emp.codigo_empleado} — {emp.nombre_completo} (
                              {emp.email
                                ? emp.email
                                : emp.telefono_whatsapp
                                  ? emp.telefono_whatsapp
                                  : 'Solo reloj'}
                              )
                            </option>
                          ))}
                        </select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ) : null}

              {watchedAlcance === 'SUCURSAL' ? (
                <FormField
                  control={form.control}
                  name="sucursal_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Sucursal destinataria (Masivo)</FormLabel>
                      <FormControl>
                        <select
                          value={field.value ?? ''}
                          onChange={(e) => field.onChange(e.target.value)}
                          aria-invalid={Boolean(
                            form.formState.errors.sucursal_id,
                          )}
                          className="ios-input w-full px-[var(--s-3)] text-sm"
                        >
                          <option value="">Selecciona una sucursal…</option>
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
              ) : null}

              {watchedAlcance === 'DEPARTAMENTO' ? (
                <FormField
                  control={form.control}
                  name="departamento"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Departamento destinatario (Masivo)</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Producción"
                          list="departamentos-sugeridos"
                          {...field}
                          value={field.value ?? ''}
                        />
                      </FormControl>
                      <datalist id="departamentos-sugeridos">
                        {departamentos.map((d) => (
                          <option key={d} value={d} />
                        ))}
                      </datalist>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ) : null}

              <FormField
                control={form.control}
                name="titulo"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Título corto del aviso</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Firma de contrato en RH"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="mensaje"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Mensaje para pantalla del reloj / correo / WhatsApp
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Pasar a RH a firmar contrato"
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
                  name="evento_disparo"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>¿Cuándo disparar el mensaje?</FormLabel>
                      <FormControl>
                        <select
                          value={field.value ?? 'CUALQUIERA'}
                          onChange={(e) =>
                            field.onChange(
                              e.target.value as MensajeEventoDisparo,
                            )
                          }
                          className="ios-input w-full px-[var(--s-3)] text-sm"
                        >
                          <option value="CUALQUIERA">
                            Al hacer Check-In o Check-Out
                          </option>
                          <option value="ENTRADA">
                            Solo en Check-In (Entrada)
                          </option>
                          <option value="SALIDA">
                            Solo en Check-Out (Salida)
                          </option>
                        </select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="repeticion"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Frecuencia por empleado</FormLabel>
                      <FormControl>
                        <select
                          value={field.value ?? 'UNA_VEZ'}
                          onChange={(e) =>
                            field.onChange(e.target.value as MensajeRepeticion)
                          }
                          className="ios-input w-full px-[var(--s-3)] text-sm"
                        >
                          <option value="UNA_VEZ">
                            Entregar 1 sola vez por empleado
                          </option>
                          <option value="SIEMPRE_VIGENTE">
                            Repetir en cada checada mientras esté activo
                          </option>
                        </select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="modo_entrega"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Regla de canal y fallback</FormLabel>
                    <FormControl>
                      <select
                        value={field.value ?? 'AUTO_FALLBACK'}
                        onChange={(e) =>
                          field.onChange(e.target.value as MensajeModoEntrega)
                        }
                        className="ios-input w-full px-[var(--s-3)] text-sm"
                      >
                        <option value="AUTO_FALLBACK">
                          Automático: Mostrar en dispositivo/agente; si no lo
                          permite, enviar Correo SMTP o WhatsApp Web
                        </option>
                        <option value="SIEMPRE_CORREO">
                          Enviar siempre por Correo SMTP al detectar la checada
                        </option>
                        <option value="SOLO_DISPOSITIVO">
                          Solo mostrar en pantalla/audio del dispositivo
                        </option>
                      </select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Configuración de Audio Dinámico Personalizado (TTS) */}
              <div className="flex flex-col gap-[var(--s-3)] rounded-[var(--r-lg)] border border-[var(--separator)] bg-[var(--surface-2)] p-[var(--s-3)]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-[var(--s-2)]">
                    <Volume2 className="size-4 text-[var(--accent)]" />
                    <span className="text-xs font-semibold text-[var(--text)]">
                      Audio Dinámico Personalizado (Voz TTS en Agente Local /
                      Kiosco)
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    aria-label="Reproducir audio dinámico al checar"
                    checked={Boolean(form.watch('reproducir_audio'))}
                    onChange={(e) =>
                      form.setValue('reproducir_audio', e.target.checked, {
                        shouldDirty: true,
                      })
                    }
                    className="size-4 accent-[var(--accent)]"
                  />
                </div>

                <FormField
                  control={form.control}
                  name="texto_voz_personalizado"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Frase de voz dinámica (Variables:{' '}
                        <code>{'{nombre}'}</code>, <code>{'{mensaje}'}</code>,{' '}
                        <code>{'{titulo}'}</code>, <code>{'{codigo}'}</code>)
                      </FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Hola {nombre}, favor de pasar a Recursos Humanos: {mensaje}"
                          {...field}
                          value={field.value ?? ''}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </form>
          </Form>
        </div>
      </Sheet>
    </AppShell>
  );
}
