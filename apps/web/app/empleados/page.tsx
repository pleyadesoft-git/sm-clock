'use client';

import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  Dices,
  ExternalLink,
  Fingerprint,
  KeyRound,
  Loader2,
  Mail,
  Pencil,
  Plus,
  Send,
  ScanFace,
  Trash2,
  UserCheck,
  Users,
  UserX,
  X,
} from 'lucide-react';
import Link from 'next/link';
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
  type ValidarCodigoEmpleadoResponse,
  type ValidarPinEmpleadoResponse,
} from '@sm-clock/contracts';
import type { z } from 'zod';

type EmpleadoFormInput = z.input<typeof EmpleadoCreateSchema>;
type EmpleadoFormOutput = z.output<typeof EmpleadoCreateSchema>;
import {
  PhotoUploader,
  type StagedPhotoPayload,
} from '@/components/features/empleados/photo-uploader';
import {
  createEmployeeWebAuthnCredential,
  isWebAuthnAvailable,
} from '@/lib/biometrics/webauthn-client';
import { useTenantChannel } from '@/lib/realtime/use-tenant-channel';
import { useCurrentUser } from '@/lib/auth/use-current-user';
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
  email: string | null;
  telefono_whatsapp?: string | null;
  pin_codigo: string | null;
  biometria_facial_activa: boolean;
  webauthn_activo: boolean;
  webauthn_credenciales_count?: number;
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

interface WebAuthnCredentialItem {
  id: string;
  empleado_id: string;
  credential_id: string;
  algoritmo: number;
  nombre_dispositivo: string;
  transports: string[];
  ultimo_uso_en: string | null;
  created_at: string;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p.charAt(0).toUpperCase()).join('') || 'EM';
}

function generateRandom6DigitPin(): string {
  const n = Math.floor(100000 + Math.random() * 900000);
  return String(n);
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
  const [sortBy, setSortBy] = React.useState('codigo_empleado');
  const [sortDir, setSortDir] = React.useState<'asc' | 'desc'>('asc');

  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<EmpleadoRow | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [sendingPinEmailId, setSendingPinEmailId] = React.useState<
    string | null
  >(null);
  const [deviceNickname, setDeviceNickname] = React.useState(
    'Dispositivo Biométrico',
  );
  const [enrollingWebAuthn, setEnrollingWebAuthn] = React.useState(false);
  const [revokingCredId, setRevokingCredId] = React.useState<string | null>(
    null,
  );

  const form = useForm<EmpleadoFormInput, unknown, EmpleadoFormOutput>({
    resolver: zodResolver(EmpleadoCreateSchema),
    defaultValues: {
      codigo_empleado: '',
      nombre_completo: '',
      email: '',
      telefono_whatsapp: '',
      pin_codigo: '',
      biometria_facial_activa: true,
      webauthn_activo: false,
      credencial: '',
      departamento: '',
      puesto: '',
      sucursal_id: '',
      estatus_empleado: 'A',
    },
    mode: 'onTouched',
  });

  type CodeCheckState =
    | { status: 'idle' }
    | { status: 'checking'; codigo: string }
    | { status: 'available'; codigo: string }
    | {
        status: 'unavailable';
        codigo: string;
        empleadoExistente?: {
          id: string;
          nombre: string;
          estatus: 'A' | 'I';
        } | null;
      }
    | { status: 'error'; codigo: string; message: string };

  const [codeCheckState, setCodeCheckState] = React.useState<CodeCheckState>({
    status: 'idle',
  });

  type PinCheckState =
    | { status: 'idle' }
    | { status: 'checking'; pin: string }
    | { status: 'available'; pin: string }
    | {
        status: 'unavailable';
        pin: string;
        empleadoExistente?: {
          id: string;
          nombre: string;
          codigo_empleado: string;
          estatus: 'A' | 'I';
        } | null;
      }
    | { status: 'error'; pin: string; message: string };

  const [pinCheckState, setPinCheckState] = React.useState<PinCheckState>({
    status: 'idle',
  });

  const codigoValue = form.watch('codigo_empleado');
  const pinValue = form.watch('pin_codigo');

  React.useEffect(() => {
    if (!sheetOpen) {
      setCodeCheckState({ status: 'idle' });
      return;
    }

    const trimmed = (codigoValue ?? '').trim();

    if (editing && trimmed === editing.codigo_empleado.trim()) {
      setCodeCheckState({ status: 'available', codigo: trimmed });
      if (form.formState.errors.codigo_empleado?.type === 'manual') {
        form.clearErrors('codigo_empleado');
      }
      return;
    }

    if (!trimmed) {
      setCodeCheckState({ status: 'idle' });
      if (form.formState.errors.codigo_empleado?.type === 'manual') {
        form.clearErrors('codigo_empleado');
      }
      return;
    }

    const isValidFormat = /^[A-Za-z0-9._-]+$/.test(trimmed);
    if (!isValidFormat) {
      setCodeCheckState({ status: 'idle' });
      return;
    }

    setCodeCheckState({ status: 'checking', codigo: trimmed });

    let active = true;
    const timer = setTimeout(async () => {
      try {
        const queryParams = new URLSearchParams({ codigo: trimmed });
        if (editing) {
          queryParams.set('excludeId', editing.id);
        }
        const res = await fetch(
          `/api/empleados/validar-codigo?${queryParams.toString()}`,
        );

        if (!active) return;

        if (!res.ok) {
          setCodeCheckState({
            status: 'error',
            codigo: trimmed,
            message: 'No fue posible verificar el código.',
          });
          return;
        }

        const data = (await res.json()) as ValidarCodigoEmpleadoResponse;
        if (!active) return;

        if (data.disponible) {
          setCodeCheckState({ status: 'available', codigo: trimmed });
          if (form.formState.errors.codigo_empleado?.type === 'manual') {
            form.clearErrors('codigo_empleado');
          }
        } else {
          setCodeCheckState({
            status: 'unavailable',
            codigo: trimmed,
            empleadoExistente: data.empleadoExistente,
          });
          const detail = data.empleadoExistente
            ? `El código "${trimmed}" ya está registrado por ${data.empleadoExistente.nombre} (${data.empleadoExistente.estatus === 'A' ? 'Activo' : 'Inactivo'}).`
            : `El código "${trimmed}" ya está registrado en la empresa.`;
          form.setError('codigo_empleado', {
            type: 'manual',
            message: detail,
          });
        }
      } catch {
        if (active) {
          setCodeCheckState({
            status: 'error',
            codigo: trimmed,
            message: 'Error de red al verificar disponibilidad.',
          });
        }
      }
    }, 350);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [codigoValue, editing, form, sheetOpen]);

  // Validación en tiempo real de unicidad del PIN de 6 dígitos
  React.useEffect(() => {
    if (!sheetOpen) {
      setPinCheckState({ status: 'idle' });
      return;
    }

    const trimmed = (pinValue ?? '').trim();

    if (editing && editing.pin_codigo && trimmed === editing.pin_codigo.trim()) {
      setPinCheckState({ status: 'available', pin: trimmed });
      if (form.formState.errors.pin_codigo?.type === 'manual') {
        form.clearErrors('pin_codigo');
      }
      return;
    }

    if (!/^\d{6}$/.test(trimmed)) {
      setPinCheckState({ status: 'idle' });
      if (form.formState.errors.pin_codigo?.type === 'manual') {
        form.clearErrors('pin_codigo');
      }
      return;
    }

    setPinCheckState({ status: 'checking', pin: trimmed });

    let active = true;
    const timer = setTimeout(async () => {
      try {
        const queryParams = new URLSearchParams({ pin: trimmed });
        if (editing) {
          queryParams.set('excludeId', editing.id);
        }
        const res = await fetch(
          `/api/empleados/validar-pin?${queryParams.toString()}`,
        );

        if (!active) return;

        if (!res.ok) {
          setPinCheckState({
            status: 'error',
            pin: trimmed,
            message: 'No fue posible verificar la unicidad del PIN.',
          });
          return;
        }

        const data = (await res.json()) as ValidarPinEmpleadoResponse;
        if (!active) return;

        if (data.disponible) {
          setPinCheckState({ status: 'available', pin: trimmed });
          if (form.formState.errors.pin_codigo?.type === 'manual') {
            form.clearErrors('pin_codigo');
          }
        } else {
          setPinCheckState({
            status: 'unavailable',
            pin: trimmed,
            empleadoExistente: data.empleadoExistente,
          });
          const detail = data.empleadoExistente
            ? `El PIN "${trimmed}" ya está asignado a ${data.empleadoExistente.nombre} (#${data.empleadoExistente.codigo_empleado}).`
            : `El PIN "${trimmed}" ya está en uso en la empresa.`;
          form.setError('pin_codigo', {
            type: 'manual',
            message: detail,
          });
        }
      } catch {
        if (active) {
          setPinCheckState({
            status: 'error',
            pin: trimmed,
            message: 'Error de red al verificar PIN.',
          });
        }
      }
    }, 300);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [pinValue, editing, form, sheetOpen]);

  const { data, isLoading } = useQuery<EmpleadosResponse>({
    queryKey: [
      'empleados-list',
      page,
      pageSize,
      search,
      estatusFilter,
      sucursalFilter,
      sortBy,
      sortDir,
    ],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        search,
        sortBy,
        sortDir,
      });
      if (estatusFilter) params.set('estatus', estatusFilter);
      if (sucursalFilter) params.set('sucursal_id', sucursalFilter);

      const res = await fetch(`/api/empleados?${params.toString()}`, {
        cache: 'no-store',
      });
      if (!res.ok) {
        throw new Error('Error al cargar empleados');
      }
      return (await res.json()) as EmpleadosResponse;
    },
  });

  const sucursales = data?.sucursales ?? [];

  // Consultar credenciales WebAuthn del empleado en edición
  const { data: webauthnListData, refetch: refetchWebAuthn } = useQuery<{
    data: WebAuthnCredentialItem[];
  }>({
    queryKey: ['empleado-webauthn', editing?.id],
    enabled: Boolean(sheetOpen && editing?.id),
    queryFn: async () => {
      if (!editing?.id) {
        return { data: [] };
      }
      const res = await fetch(`/api/empleados/${editing.id}/webauthn`);
      if (!res.ok) {
        return { data: [] };
      }
      return (await res.json()) as { data: WebAuthnCredentialItem[] };
    },
  });

  const webauthnCredentials = webauthnListData?.data ?? [];

  const { data: currentUser } = useCurrentUser();
  const effectiveTenantId =
    currentUser?.tenantId ??
    (data?.data?.[0]?.tenant_id as string | undefined);

  const { status: realtimeState } = useTenantChannel({
    tenantId: effectiveTenantId,
    queryKeysToInvalidate: [['empleados-list']],
    events: ['*'],
  });

  const [stagedPhoto, setStagedPhoto] =
    React.useState<StagedPhotoPayload | null>(null);

  const photoSectionRef = React.useRef<HTMLDivElement | null>(null);
  const biometriaSectionRef = React.useRef<HTMLDivElement | null>(null);
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
    setCodeCheckState({ status: 'idle' });
    setPinCheckState({ status: 'idle' });
    const randomPin = generateRandom6DigitPin();
    form.reset({
      codigo_empleado: '',
      nombre_completo: '',
      email: '',
      telefono_whatsapp: '',
      pin_codigo: randomPin,
      biometria_facial_activa: true,
      webauthn_activo: false,
      credencial: '',
      departamento: '',
      puesto: '',
      sucursal_id: sucursales[0]?.id ?? '',
      estatus_empleado: 'A',
    });
    setSheetOpen(true);
  }

  function openEditSheet(
    row: EmpleadoRow,
    section: 'datos' | 'foto' | 'biometria' = 'datos',
  ) {
    setEditing(row);
    setStagedPhoto(null);
    setCodeCheckState({ status: 'available', codigo: row.codigo_empleado });
    setPinCheckState(
      row.pin_codigo
        ? { status: 'available', pin: row.pin_codigo }
        : { status: 'idle' },
    );
    form.reset({
      codigo_empleado: row.codigo_empleado,
      nombre_completo: row.nombre_completo,
      email: row.email ?? '',
      telefono_whatsapp: row.telefono_whatsapp ?? '',
      pin_codigo: row.pin_codigo ?? generateRandom6DigitPin(),
      biometria_facial_activa: row.biometria_facial_activa ?? true,
      webauthn_activo: row.webauthn_activo ?? false,
      credencial: row.credencial ?? '',
      departamento: row.departamento ?? '',
      puesto: row.puesto ?? '',
      sucursal_id: row.sucursal_id ?? sucursales[0]?.id ?? '',
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
    } else if (section === 'biometria') {
      setTimeout(() => {
        biometriaSectionRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        });
      }, 250);
    }
  }

  async function handleSendPinByEmail(empleado: EmpleadoRow) {
    if (!empleado.email) {
      toast({
        title: 'Empleado sin correo electrónico',
        description:
          'Abre el expediente del empleado y agrega su cuenta de correo electrónico primero.',
        variant: 'warning',
      });
      openEditSheet(empleado, 'datos');
      return;
    }

    setSendingPinEmailId(empleado.id);
    try {
      const res = await fetch(`/api/empleados/${empleado.id}/enviar-pin`, {
        method: 'POST',
      });
      const json = (await res.json()) as {
        ok?: boolean;
        email?: string;
        error?: string;
        delivery?: { delivered: boolean; simulated: boolean };
      };

      if (!res.ok) {
        toast({
          title: 'No se pudo enviar el PIN por correo',
          description: json.error ?? 'Verifica la configuración SMTP.',
          variant: 'danger',
        });
        return;
      }

      toast({
        title: 'PIN enviado al correo del empleado',
        description: `Se envió el PIN de 6 dígitos y enlace del Checador a ${empleado.email}.`,
        variant: 'success',
      });
    } catch {
      toast({
        title: 'Error de red',
        description: 'No fue posible enviar el correo.',
        variant: 'danger',
      });
    } finally {
      setSendingPinEmailId(null);
    }
  }

  async function handleEnrollWebAuthnDevice() {
    if (!editing) return;
    if (!isWebAuthnAvailable()) {
      toast({
        title: 'WebAuthn no disponible en este navegador',
        description:
          'Abre la aplicación en un dispositivo con lector de huella, FaceID, TouchID o Windows Hello.',
        variant: 'warning',
      });
      return;
    }

    setEnrollingWebAuthn(true);
    try {
      const cred = await createEmployeeWebAuthnCredential({
        empleadoId: editing.id,
        codigoEmpleado: editing.codigo_empleado,
        nombreEmpleado: editing.nombre_completo,
      });

      const res = await fetch(`/api/empleados/${editing.id}/webauthn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...cred,
          nombre_dispositivo:
            deviceNickname.trim() || 'Dispositivo Biométrico',
        }),
      });

      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast({
          title: 'Error al guardar llave WebAuthn',
          description:
            json.error ?? 'No se pudo registrar la credencial biométrica.',
          variant: 'danger',
        });
        return;
      }

      form.setValue('webauthn_activo', true);
      await refetchWebAuthn();
      await queryClient.invalidateQueries({ queryKey: ['empleados-list'] });
      toast({
        title: 'Huella / FaceID (WebAuthn) vinculado',
        description: `${editing.nombre_completo} ya puede hacer Check-In y Check-Out con este dispositivo biométrico.`,
        variant: 'success',
      });
    } catch (err) {
      toast({
        title: 'Registro biométrico cancelado',
        description:
          err instanceof Error
            ? err.message
            : 'No se completó la captura biométrica.',
        variant: 'warning',
      });
    } finally {
      setEnrollingWebAuthn(false);
    }
  }

  async function handleRevokeWebAuthn(credId: string) {
    if (!editing) return;
    setRevokingCredId(credId);
    try {
      const res = await fetch(
        `/api/empleados/${editing.id}/webauthn?credencialId=${encodeURIComponent(credId)}`,
        { method: 'DELETE' },
      );
      if (!res.ok) {
        toast({
          title: 'Error al revocar llave biométrica',
          variant: 'danger',
        });
        return;
      }
      await refetchWebAuthn();
      await queryClient.invalidateQueries({ queryKey: ['empleados-list'] });
      toast({
        title: 'Llave biométrica eliminada',
        variant: 'success',
      });
    } finally {
      setRevokingCredId(null);
    }
  }

  function handleFormInvalid(errors: Record<string, { message?: string }>) {
    const errorValues = Object.values(errors);
    const firstErr = errorValues[0];
    toast({
      title: 'Verifica los datos del empleado',
      description:
        firstErr?.message ??
        'Revisa los campos obligatorios (Sucursal, PIN único de 6 dígitos, Código y Nombre).',
      variant: 'danger',
    });
  }

  async function handleSave(values: EmpleadoFormOutput) {
    if (codeCheckState.status === 'unavailable') {
      toast({
        title: 'Código de empleado no disponible',
        description:
          form.formState.errors.codigo_empleado?.message ??
          'El código de empleado ya está en uso.',
        variant: 'danger',
      });
      return;
    }

    if (pinCheckState.status === 'unavailable') {
      toast({
        title: 'PIN de 6 dígitos repetido',
        description:
          form.formState.errors.pin_codigo?.message ??
          'El PIN ya está asignado a otro empleado. Genera o escribe uno único.',
        variant: 'danger',
      });
      return;
    }

    if (
      codeCheckState.status === 'checking' ||
      pinCheckState.status === 'checking'
    ) {
      toast({
        title: 'Verificando disponibilidad',
        description:
          'Espera un momento mientras se verifica que el código y el PIN sean únicos.',
        variant: 'default',
      });
      return;
    }

    const rawPayload = {
      ...(editing ? { id: editing.id } : {}),
      codigo_empleado: values.codigo_empleado,
      nombre_completo: values.nombre_completo,
      email: values.email || null,
      telefono_whatsapp: values.telefono_whatsapp || null,
      pin_codigo: values.pin_codigo,
      biometria_facial_activa: values.biometria_facial_activa,
      webauthn_activo: values.webauthn_activo,
      credencial: values.credencial || null,
      departamento: values.departamento || null,
      puesto: values.puesto || null,
      sucursal_id: values.sucursal_id,
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
        if (res.status === 409) {
          if (json.error?.toLowerCase().includes('pin')) {
            form.setError('pin_codigo', {
              type: 'manual',
              message: json.error,
            });
            setPinCheckState({
              status: 'unavailable',
              pin: values.pin_codigo ?? '',
            });
          } else {
            form.setError('codigo_empleado', {
              type: 'manual',
              message:
                json.error ??
                'El código de empleado ya está en uso. Elige un código disponible.',
            });
            setCodeCheckState({
              status: 'unavailable',
              codigo: values.codigo_empleado,
            });
          }
        }
        toast({
          title: 'Error al guardar empleado',
          description: json.error ?? 'Verifica los datos ingresados.',
          variant: 'danger',
        });
        return;
      }

      const targetId = editing ? editing.id : json.data.id;

      if (stagedPhoto) {
        const photoForm = new FormData();
        photoForm.append('file', stagedPhoto.file);
        const photoRes = await fetch(`/api/empleados/${targetId}/foto`, {
          method: 'POST',
          body: photoForm,
        });

        if (!photoRes.ok) {
          await queryClient.invalidateQueries({ queryKey: ['empleados-list'] });
          const photoErr = (await photoRes.json().catch(() => ({}))) as {
            error?: string;
          };
          if (!editing) setEditing(json.data);
          toast({
            title: editing
              ? 'Empleado actualizado, pero falló la subida de foto'
              : 'Empleado creado, pero falló la subida de foto',
            description:
              photoErr.error ??
              'Puedes reintentar subir la fotografía desde este panel.',
            variant: 'danger',
          });
          return;
        }

        await queryClient.invalidateQueries({ queryKey: ['empleados-list'] });
        setStagedPhoto(null);
        setSheetOpen(false);
        setEditing(null);
        toast({
          title: editing
            ? 'Empleado y fotografía actualizados'
            : 'Empleado y fotografía registrados',
          description: 'La foto y el PIN de 6 dígitos quedaron guardados.',
          variant: 'success',
        });
        return;
      }

      await queryClient.invalidateQueries({ queryKey: ['empleados-list'] });
      toast({
        title: editing ? 'Empleado actualizado' : 'Empleado registrado',
        description: editing
          ? 'Los cambios quedaron guardados.'
          : `${json.data.nombre_completo} fue registrado con su PIN único de 6 dígitos.`,
        variant: 'success',
      });

      setSheetOpen(false);
      setEditing(null);
      setStagedPhoto(null);
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
                  key={thumbUrl}
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
        header: 'Nombre y Correo',
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-semibold text-[var(--text)]">
              {row.original.nombre_completo}
            </span>
            <span className="text-xs text-[var(--text-2)]">
              {row.original.email ?? row.original.puesto ?? 'Sin correo registrado'}
            </span>
          </div>
        ),
      },
      {
        id: 'pin_biometria',
        header: 'PIN (6 dígitos) y Biometría',
        accessorFn: (r: EmpleadoRow) => r.pin_codigo ?? '—',
        cell: ({ row }) => {
          const item = row.original;
          const hasPhoto = Boolean(item.foto_path);
          const hasWebAuthn =
            item.webauthn_activo ||
            (item.webauthn_credenciales_count ?? 0) > 0;
          return (
            <div className="flex flex-wrap items-center gap-[var(--s-1)]">
              {item.pin_codigo ? (
                <code className="inline-flex items-center gap-1 rounded-[var(--r-sm)] bg-[var(--accent-soft)] px-[var(--s-2)] py-0.5 font-mono text-xs font-bold tracking-wider text-[var(--accent)]">
                  <KeyRound className="size-3" aria-hidden="true" />
                  {item.pin_codigo}
                </code>
              ) : (
                <Badge variant="warning">Sin PIN</Badge>
              )}
              {hasPhoto && item.biometria_facial_activa && (
                <Badge variant="info">
                  <ScanFace className="mr-1 size-3" aria-hidden="true" />
                  Facial
                </Badge>
              )}
              {hasWebAuthn && (
                <Badge variant="success">
                  <Fingerprint className="mr-1 size-3" aria-hidden="true" />
                  WebAuthn
                </Badge>
              )}
            </div>
          );
        },
      },
      {
        id: 'sucursal',
        header: 'Sucursal Asignada',
        accessorFn: (r: EmpleadoRow) => r.sucursales?.nombre ?? '—',
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="text-xs font-semibold text-[var(--text)]">
              {row.original.sucursales?.nombre ?? 'Sin asignar'}
            </span>
            <span className="text-xs text-[var(--text-2)]">
              {row.original.departamento ?? 'General'}
            </span>
          </div>
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
                    label: 'Editar datos y PIN',
                    icon: Pencil,
                    onClick: () => openEditSheet(item, 'datos'),
                  },
                  {
                    id: 'enviar-pin',
                    label:
                      sendingPinEmailId === item.id
                        ? 'Enviando PIN…'
                        : 'Enviar PIN por correo',
                    icon: Send,
                    onClick: () => void handleSendPinByEmail(item),
                  },
                  {
                    id: 'configurar-biometria',
                    label: 'Configurar WebAuthn / Biometría',
                    icon: Fingerprint,
                    onClick: () => openEditSheet(item, 'biometria'),
                  },
                  {
                    id: 'editar-foto',
                    label: 'Cambiar fotografía facial',
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
    [sendingPinEmailId],
  );

  const exportColumns = React.useMemo<ExportColumn<EmpleadoRow>[]>(
    () => [
      { header: 'Código', accessor: (r: EmpleadoRow) => r.codigo_empleado },
      { header: 'Nombre Completo', accessor: (r: EmpleadoRow) => r.nombre_completo },
      { header: 'Correo Electrónico', accessor: (r: EmpleadoRow) => r.email ?? '' },
      { header: 'PIN (6 dígitos)', accessor: (r: EmpleadoRow) => r.pin_codigo ?? '' },
      {
        header: 'Biometría Facial',
        accessor: (r: EmpleadoRow) =>
          r.foto_path && r.biometria_facial_activa ? 'ACTIVA' : 'INACTIVA',
      },
      {
        header: 'WebAuthn',
        accessor: (r: EmpleadoRow) => (r.webauthn_activo ? 'ACTIVO' : 'NO'),
      },
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
      title="Padrón de Empleados, Biometría y PIN"
      subtitle="Fotografía facial (≤ 720 px), llaves biométricas WebAuthn (Passkeys) y PIN único de 6 dígitos"
      mode="client"
      realtimeState={realtimeState}
      actions={
        <div className="flex flex-wrap items-center gap-[var(--s-2)]">
          <Link
            href="/checador"
            target="_blank"
            className="inline-flex h-10 items-center gap-[var(--s-2)] rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface)] px-[var(--s-3)] text-sm font-medium text-[var(--text)] shadow-[var(--shadow-1)] transition-colors hover:bg-[var(--surface-2)]"
          >
            <Fingerprint className="size-4 text-[var(--accent)]" aria-hidden="true" />
            <span>Abrir Kiosco Checador</span>
            <ExternalLink className="size-3.5 text-[var(--text-3)]" aria-hidden="true" />
          </Link>
          <Button onClick={openNewSheet}>
            <Plus className="size-4" aria-hidden="true" />
            Nuevo empleado
          </Button>
        </div>
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
        searchPlaceholder="Buscar por número de empleado, nombre, correo o departamento…"
        sortBy={sortBy}
        sortDir={sortDir}
        onSortChange={(colId, dir) => {
          setSortBy(colId);
          setSortDir(dir);
        }}
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
        emptyDescription="Registra empleados asignándoles su sucursal, PIN único de 6 dígitos, foto y biometría."
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
        description="Asigna sucursal obligatoria, PIN único de 6 dígitos, correo electrónico, fotografía facial y WebAuthn."
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setSheetOpen(false)}
            >
              Cerrar
            </Button>
            {editing && editing.email && editing.pin_codigo && (
              <Button
                type="button"
                variant="secondary"
                disabled={sendingPinEmailId === editing.id}
                onClick={() => void handleSendPinByEmail(editing)}
              >
                <Mail className="size-4" aria-hidden="true" />
                {sendingPinEmailId === editing.id
                  ? 'Enviando PIN…'
                  : 'Enviar PIN por Email'}
              </Button>
            )}
            <Button
              type="submit"
              form="empleado-sheet-form"
              disabled={
                submitting ||
                codeCheckState.status === 'checking' ||
                codeCheckState.status === 'unavailable' ||
                pinCheckState.status === 'checking' ||
                pinCheckState.status === 'unavailable'
              }
              onClick={() => {
                void form.handleSubmit(handleSave, handleFormInvalid)();
              }}
            >
              {submitting
                ? 'Guardando…'
                : codeCheckState.status === 'checking' ||
                    pinCheckState.status === 'checking'
                  ? 'Verificando…'
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
              onSubmit={form.handleSubmit(handleSave, handleFormInvalid)}
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
                        <Input placeholder="1001" {...field} />
                      </FormControl>
                      {codeCheckState.status === 'checking' && field.value ? (
                        <p
                          className="flex items-center gap-[var(--s-1)] text-xs text-[var(--text-2)] animate-pulse"
                          role="status"
                        >
                          <Loader2 className="size-3.5 animate-spin text-[var(--accent)]" />
                          <span>Comprobando disponibilidad del código…</span>
                        </p>
                      ) : null}
                      {codeCheckState.status === 'available' &&
                      field.value &&
                      !form.formState.errors.codigo_empleado ? (
                        <p
                          className="flex items-center gap-[var(--s-1)] text-xs font-medium text-[var(--success)]"
                          role="status"
                        >
                          <CheckCircle2 className="size-3.5" />
                          <span>Código disponible</span>
                        </p>
                      ) : null}
                      {codeCheckState.status === 'error' &&
                      !form.formState.errors.codigo_empleado ? (
                        <p
                          className="flex items-center gap-[var(--s-1)] text-xs text-[var(--warning)]"
                          role="status"
                        >
                          <AlertCircle className="size-3.5" />
                          <span>{codeCheckState.message}</span>
                        </p>
                      ) : null}
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="pin_codigo"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex items-center justify-between">
                        <FormLabel>PIN Único (6 dígitos numéricos)</FormLabel>
                        <button
                          type="button"
                          onClick={() => {
                            const nextPin = generateRandom6DigitPin();
                            form.setValue('pin_codigo', nextPin, {
                              shouldDirty: true,
                              shouldValidate: true,
                            });
                          }}
                          className="inline-flex items-center gap-1 text-xs font-medium text-[var(--accent)] hover:underline"
                        >
                          <Dices className="size-3.5" aria-hidden="true" />
                          Generar PIN
                        </button>
                      </div>
                      <FormControl>
                        <Input
                          placeholder="482910"
                          inputMode="numeric"
                          maxLength={6}
                          className="font-mono tracking-widest"
                          {...field}
                          value={field.value ?? ''}
                          onChange={(e) => {
                            const digitsOnly = e.target.value
                              .replace(/\D/g, '')
                              .slice(0, 6);
                            field.onChange(digitsOnly);
                          }}
                        />
                      </FormControl>
                      {pinCheckState.status === 'checking' && field.value ? (
                        <p
                          className="flex items-center gap-[var(--s-1)] text-xs text-[var(--text-2)] animate-pulse"
                          role="status"
                        >
                          <Loader2 className="size-3.5 animate-spin text-[var(--accent)]" />
                          <span>Verificando que el PIN no se repita…</span>
                        </p>
                      ) : null}
                      {pinCheckState.status === 'available' &&
                      field.value &&
                      !form.formState.errors.pin_codigo ? (
                        <p
                          className="flex items-center gap-[var(--s-1)] text-xs font-medium text-[var(--success)]"
                          role="status"
                        >
                          <CheckCircle2 className="size-3.5" />
                          <span>PIN único y disponible</span>
                        </p>
                      ) : null}
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
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Correo electrónico (Avisos RH / PIN)</FormLabel>
                      <FormControl>
                        <Input
                          type="email"
                          placeholder="ahernandez@empresa.mx"
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
                  name="telefono_whatsapp"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Teléfono WhatsApp (Avisos RH)</FormLabel>
                      <FormControl>
                        <Input
                          type="tel"
                          placeholder="+526641234567"
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
                      <FormLabel>Planta / Sucursal (Obligatoria)</FormLabel>
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

              <div className="grid grid-cols-1 gap-[var(--s-3)] sm:grid-cols-3">
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

              {/* Sección de Biometría Facial y WebAuthn */}
              <div
                ref={biometriaSectionRef}
                className="rounded-[var(--r-lg)] border border-[var(--border)] bg-[var(--surface-2)] p-[var(--s-4)]"
              >
                <div className="mb-[var(--s-3)] flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-[var(--text)]">
                      Métodos Biométricos y WebAuthn para Kiosco
                    </h3>
                    <p className="text-xs text-[var(--text-2)]">
                      Configura el reconocimiento facial (con su fotografía actual) y llaves Passkey/WebAuthn para Check-In y Check-Out.
                    </p>
                  </div>
                </div>

                <FormField
                  control={form.control}
                  name="biometria_facial_activa"
                  render={({ field }) => (
                    <FormItem className="mb-[var(--s-3)] flex flex-row items-center justify-between rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--s-3)]">
                      <div className="flex items-center gap-[var(--s-2)]">
                        <ScanFace
                          className="size-5 text-[var(--accent)]"
                          aria-hidden="true"
                        />
                        <div>
                          <FormLabel className="text-sm font-semibold">
                            Reconocimiento Facial con Fotografía Registrada
                          </FormLabel>
                          <p className="text-xs text-[var(--text-2)]">
                            Permite al empleado hacer Check-In / Check-Out comparando su rostro en cámara contra su fotografía guardada.
                          </p>
                        </div>
                      </div>
                      <FormControl>
                        <input
                          type="checkbox"
                          checked={Boolean(field.value)}
                          onChange={(e) => field.onChange(e.target.checked)}
                          className="size-4 accent-[var(--accent)]"
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />

                {editing ? (
                  <div className="rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--s-3)]">
                    <div className="mb-[var(--s-2)] flex flex-wrap items-center justify-between gap-[var(--s-2)]">
                      <div className="flex items-center gap-[var(--s-2)]">
                        <Fingerprint
                          className="size-5 text-[var(--accent)]"
                          aria-hidden="true"
                        />
                        <div>
                          <p className="text-sm font-semibold text-[var(--text)]">
                            Llaves Biométricas WebAuthn (Huella / FaceID / TouchID)
                          </p>
                          <p className="text-xs text-[var(--text-2)]">
                            El empleado también puede enrolar su propio teléfono desde el Kiosco usando su PIN de 6 dígitos.
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="mb-[var(--s-3)] flex flex-wrap items-center gap-[var(--s-2)]">
                      <Input
                        value={deviceNickname}
                        onChange={(e) => setDeviceNickname(e.target.value)}
                        placeholder="Nombre del dispositivo (ej. Tablet Caseta / iPhone)"
                        className="max-w-xs text-xs"
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={enrollingWebAuthn}
                        onClick={() => void handleEnrollWebAuthnDevice()}
                      >
                        <Fingerprint className="size-3.5" aria-hidden="true" />
                        {enrollingWebAuthn
                          ? 'Esperando lector biométrico…'
                          : 'Registrar Huella / FaceID en este dispositivo'}
                      </Button>
                    </div>

                    {webauthnCredentials.length > 0 ? (
                      <ul className="divide-y divide-[var(--border)] rounded-[var(--r-sm)] border border-[var(--border)]">
                        {webauthnCredentials.map((cred) => (
                          <li
                            key={cred.id}
                            className="flex items-center justify-between px-[var(--s-3)] py-[var(--s-2)] text-xs"
                          >
                            <div>
                              <span className="font-semibold text-[var(--text)]">
                                {cred.nombre_dispositivo}
                              </span>
                              <span className="ml-2 font-mono text-[var(--text-3)]">
                                ID: {cred.credential_id.slice(0, 12)}…
                              </span>
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={revokingCredId === cred.id}
                              onClick={() => void handleRevokeWebAuthn(cred.id)}
                            >
                              <Trash2
                                className="size-3.5 text-[var(--danger)]"
                                aria-hidden="true"
                              />
                              Eliminar
                            </Button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-[var(--text-3)]">
                        Aún no hay dispositivos WebAuthn vinculados para este empleado.
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-[var(--text-2)]">
                    Guarda primero el empleado para registrar llaves biométricas WebAuthn (o comparte su PIN de 6 dígitos para que registre su dispositivo en el primer Check-In).
                  </p>
                )}
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
              onSaved={(saved) => {
                setEditing((prev) =>
                  prev
                    ? {
                        ...prev,
                        foto_path: saved.foto_path,
                        foto_thumb_path: saved.foto_thumb_path,
                        foto_signed_url: saved.signed_url,
                        foto_thumb_signed_url: saved.signed_thumb_url,
                      }
                    : null,
                );
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
                y no podrá registrar Check-In ni Check-Out.
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
