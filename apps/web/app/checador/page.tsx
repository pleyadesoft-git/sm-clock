'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  Camera,
  CheckCircle2,
  Clock,
  Delete,
  Fingerprint,
  KeyRound,
  Loader2,
  LocateFixed,
  LogIn,
  LogOut,
  MapPin,
  RefreshCw,
  ScanFace,
  ShieldCheck,
} from 'lucide-react';
import {
  calculateHaversineDistanceMeters,
  type KioskMetodoVerificacion,
} from '@sm-clock/contracts';
import {
  assertEmployeeWebAuthnCredential,
  createEmployeeWebAuthnCredential,
} from '@/lib/biometrics/webauthn-client';
import { LocationMapPreview } from '@/components/features/geolocalizacion/location-map-preview';
import { ThemeToggle } from '@/components/theme-toggle';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Sheet } from '@/components/ui/sheet';
import { SmClockLogo } from '@/components/ui/sm-clock-logo';
import { useToast } from '@/components/ui/toast';

const STORAGE_TENANT_KEY = 'sm_clock_kiosk_tenant_code';

interface KioskSucursal {
  id: string;
  clave: string;
  nombre: string;
  direccion: string | null;
  latitud: number | null;
  longitud: number | null;
  radio_geocerca_m: number;
}

interface KioskTenantInfo {
  tenant_code: string;
  nombre_comercial: string;
  zona_horaria: string;
}

interface KioskCheckInReceipt {
  tenant?: KioskTenantInfo;
  checada: {
    id: number;
    codigo_empleado: string;
    ts_utc: string;
    ts_dispositivo_local: string;
    tipo_marca: 'ENTRADA' | 'SALIDA';
    tipo_verificacion: string;
    latitud: number;
    longitud: number;
    precision_m: number;
    distancia_sucursal_m: number | null;
    dentro_geocerca: boolean | null;
  };
  empleado: {
    id: string;
    codigo_empleado: string;
    nombre_completo: string;
    departamento: string | null;
    puesto: string | null;
  };
  sucursal: {
    id: string;
    clave: string;
    nombre: string;
    latitud: number | null;
    longitud: number | null;
    radio_geocerca_m: number;
  } | null;
}

function ChecadorKioskContent() {
  const searchParams = useSearchParams();
  const { toast } = useToast();

  const [tenantCodeInput, setTenantCodeInput] = React.useState('');
  const [tenantInfo, setTenantInfo] = React.useState<KioskTenantInfo | null>(
    null,
  );
  const [sucursales, setSucursales] = React.useState<KioskSucursal[]>([]);

  const [tipoMarca, setTipoMarca] = React.useState<'ENTRADA' | 'SALIDA'>(
    'ENTRADA',
  );
  const [metodo, setMetodo] = React.useState<KioskMetodoVerificacion>('ROSTRO');
  const [pinDigits, setPinDigits] = React.useState('');

  // Estado de Geolocalización GPS obligatoria
  const [gpsState, setGpsState] = React.useState<
    | { status: 'loading' }
    | {
        status: 'ready';
        latitud: number;
        longitud: number;
        precision_m: number;
      }
    | { status: 'error'; message: string }
  >({ status: 'loading' });

  const [submitting, setSubmitting] = React.useState(false);
  const [receipt, setReceipt] = React.useState<KioskCheckInReceipt | null>(
    null,
  );

  // Estado de cámara para Reconocimiento Facial 1:N automático
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const [cameraActive, setCameraActive] = React.useState(false);
  const [cameraError, setCameraError] = React.useState<string | null>(null);

  // Sheet para que el empleado vincule su propio dispositivo WebAuthn con su PIN
  const [enrollSheetOpen, setEnrollSheetOpen] = React.useState(false);
  const [enrollPin, setEnrollPin] = React.useState('');
  const [enrollDeviceName, setEnrollDeviceName] = React.useState(
    'Mi Teléfono / Tablet',
  );
  const [enrollingSelf, setEnrollingSelf] = React.useState(false);

  // Reloj en vivo
  const [nowTime, setNowTime] = React.useState<Date>(() => new Date());
  React.useEffect(() => {
    const id = setInterval(() => setNowTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const requestGpsLocation = React.useCallback((): Promise<{
    latitud: number;
    longitud: number;
    precision_m: number;
  } | null> => {
    return new Promise((resolve) => {
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        setGpsState({
          status: 'error',
          message:
            'Este navegador no soporta geolocalización GPS. Abre el checador en un navegador compatible.',
        });
        resolve(null);
        return;
      }

      setGpsState((prev) =>
        prev.status === 'ready' ? prev : { status: 'loading' },
      );

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const coords = {
            latitud: Number(pos.coords.latitude.toFixed(6)),
            longitud: Number(pos.coords.longitude.toFixed(6)),
            precision_m: Math.round(pos.coords.accuracy || 15),
          };
          setGpsState({
            status: 'ready',
            ...coords,
          });
          resolve(coords);
        },
        (err) => {
          setGpsState({
            status: 'error',
            message:
              err.code === err.PERMISSION_DENIED
                ? 'Permiso de ubicación denegado. Es obligatorio activar el GPS para registrar dónde realizas tu Check-In / Check-Out.'
                : 'No fue posible obtener tu ubicación GPS actual. Verifica que el GPS esté encendido e intenta de nuevo.',
          });
          resolve(null);
        },
        {
          enableHighAccuracy: true,
          timeout: 12000,
          maximumAge: 15000,
        },
      );
    });
  }, []);

  React.useEffect(() => {
    void requestGpsLocation();
  }, [requestGpsLocation]);

  const loadTenantContext = React.useCallback(async (code?: string) => {
    const clean = (code ?? '').trim().toUpperCase();
    try {
      const url = clean
        ? `/api/checador?empresa=${encodeURIComponent(clean)}`
        : '/api/checador';
      const res = await fetch(url);
      const json = (await res.json()) as {
        tenant?: KioskTenantInfo;
        sucursales?: KioskSucursal[];
      };
      if (res.ok && json.tenant) {
        setTenantInfo(json.tenant);
        setSucursales(json.sucursales ?? []);
        setTenantCodeInput(json.tenant.tenant_code);
        try {
          localStorage.setItem(STORAGE_TENANT_KEY, json.tenant.tenant_code);
        } catch {
          // Ignorar si storage está bloqueado
        }
      }
    } catch {
      // Silencioso: el tenant se resolverá automáticamente al identificar al empleado
    }
  }, []);

  React.useEffect(() => {
    const fromQuery = searchParams.get('empresa')?.trim().toUpperCase() || '';
    let initialCode = fromQuery;
    if (!initialCode) {
      try {
        initialCode = localStorage.getItem(STORAGE_TENANT_KEY) ?? '';
      } catch {
        initialCode = '';
      }
    }
    setTenantCodeInput(initialCode);
    void loadTenantContext(initialCode || undefined);
  }, [searchParams, loadTenantContext]);

  // Manejo de cámara para Reconocimiento Facial
  const stopCamera = React.useCallback(() => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    setCameraActive(false);
  }, []);

  const startCamera = React.useCallback(async () => {
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 640 },
          height: { ideal: 640 },
        },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraActive(true);
    } catch {
      setCameraError(
        'No se pudo acceder a la cámara frontal. Autoriza el permiso de cámara o utiliza Huella/FaceID o PIN.',
      );
      setCameraActive(false);
    }
  }, []);

  React.useEffect(() => {
    if (metodo === 'ROSTRO') {
      void startCamera();
    } else {
      stopCamera();
    }
    return () => {
      stopCamera();
    };
  }, [metodo, startCamera, stopCamera]);

  function handleAppendDigit(digit: string) {
    setPinDigits((prev) => (prev.length < 6 ? `${prev}${digit}` : prev));
  }

  function handleBackspaceDigit() {
    setPinDigits((prev) => prev.slice(0, -1));
  }

  async function ensureGpsCoords(): Promise<{
    latitud: number;
    longitud: number;
    precision_m: number;
  } | null> {
    if (gpsState.status === 'ready') {
      return {
        latitud: gpsState.latitud,
        longitud: gpsState.longitud,
        precision_m: gpsState.precision_m,
      };
    }
    const fresh = await requestGpsLocation();
    if (!fresh) {
      toast({
        title: 'Ubicación GPS obligatoria',
        description:
          'Autoriza el acceso a tu ubicación GPS para registrar dónde realizas tu Check-In / Check-Out.',
        variant: 'danger',
      });
    }
    return fresh;
  }

  async function handleFaceRecognitionSubmit() {
    if (!videoRef.current || !cameraActive) {
      await startCamera();
      if (!videoRef.current) {
        toast({
          title: 'Cámara no activa',
          description: 'Enciende la cámara para identificar tu rostro.',
          variant: 'warning',
        });
        return;
      }
    }

    const coords = await ensureGpsCoords();
    if (!coords) return;

    setSubmitting(true);
    try {
      // Capturar fotograma en vivo y redimensionar a 256×256 para identificación facial 1:N rápida en servidor
      const captureCanvas = document.createElement('canvas');
      captureCanvas.width = 256;
      captureCanvas.height = 256;
      const ctx = captureCanvas.getContext('2d');
      if (!ctx || !videoRef.current) {
        throw new Error('No se pudo procesar el fotograma de la cámara');
      }

      const vw = videoRef.current.videoWidth || 480;
      const vh = videoRef.current.videoHeight || 480;
      const side = Math.min(vw, vh);
      const sx = (vw - side) / 2;
      const sy = (vh - side) / 2;
      ctx.drawImage(videoRef.current, sx, sy, side, side, 0, 0, 256, 256);

      const frameBase64 = captureCanvas.toDataURL('image/jpeg', 0.85);

      const res = await fetch('/api/checador', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(tenantCodeInput.trim()
            ? { tenant_code: tenantCodeInput.trim().toUpperCase() }
            : {}),
          tipo_marca: tipoMarca,
          metodo_verificacion: 'ROSTRO',
          rostro_verificacion: {
            frame_base64: frameBase64,
            rostro_detectado: true,
          },
          geolocalizacion: coords,
        }),
      });

      const json = (await res.json()) as {
        data?: KioskCheckInReceipt;
        error?: string;
      };

      if (!res.ok || !json.data) {
        toast({
          title: 'No se pudo identificar tu rostro',
          description:
            json.error ??
            'Asegúrate de tener tu fotografía registrada en el padrón de Empleados y buena iluminación.',
          variant: 'danger',
        });
        return;
      }

      if (json.data.tenant) {
        setTenantInfo(json.data.tenant);
        setTenantCodeInput(json.data.tenant.tenant_code);
      }
      setReceipt(json.data);
      toast({
        title: `${tipoMarca === 'ENTRADA' ? 'Check-In Facial' : 'Check-Out Facial'} registrado`,
        description: `Identificado automáticamente: ${json.data.empleado.nombre_completo} (#${json.data.empleado.codigo_empleado})`,
        variant: 'success',
      });
    } catch (err) {
      toast({
        title: 'Error en reconocimiento facial',
        description:
          err instanceof Error
            ? err.message
            : 'No se pudo completar el reconocimiento facial.',
        variant: 'danger',
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleWebAuthnSubmit() {
    const coords = await ensureGpsCoords();
    if (!coords) return;

    setSubmitting(true);
    try {
      const assertion = await assertEmployeeWebAuthnCredential();
      const res = await fetch('/api/checador', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(tenantCodeInput.trim()
            ? { tenant_code: tenantCodeInput.trim().toUpperCase() }
            : {}),
          tipo_marca: tipoMarca,
          metodo_verificacion: 'WEBAUTHN',
          webauthn_assertion: assertion,
          geolocalizacion: coords,
        }),
      });

      const json = (await res.json()) as {
        data?: KioskCheckInReceipt;
        error?: string;
      };

      if (!res.ok || !json.data) {
        toast({
          title: 'No se pudo verificar con WebAuthn',
          description:
            json.error ??
            'Si aún no has vinculado tu huella o FaceID en este dispositivo, usa el botón "Vincular mi huella/FaceID con mi PIN".',
          variant: 'danger',
        });
        return;
      }

      if (json.data.tenant) {
        setTenantInfo(json.data.tenant);
        setTenantCodeInput(json.data.tenant.tenant_code);
      }
      setReceipt(json.data);
      toast({
        title: `${tipoMarca === 'ENTRADA' ? 'Check-In Biométrico' : 'Check-Out Biométrico'} registrado`,
        description: `${json.data.empleado.nombre_completo} · ${json.data.checada.ts_dispositivo_local}`,
        variant: 'success',
      });
    } catch (err) {
      toast({
        title: 'Lectura biométrica cancelada',
        description:
          err instanceof Error
            ? err.message
            : 'No se completó la verificación biométrica del dispositivo.',
        variant: 'warning',
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePinSubmit() {
    if (!/^\d{6}$/.test(pinDigits)) {
      toast({
        title: 'PIN incompleto',
        description: 'Ingresa los 6 dígitos de tu PIN personal.',
        variant: 'warning',
      });
      return;
    }

    const coords = await ensureGpsCoords();
    if (!coords) return;

    setSubmitting(true);
    try {
      const res = await fetch('/api/checador', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(tenantCodeInput.trim()
            ? { tenant_code: tenantCodeInput.trim().toUpperCase() }
            : {}),
          tipo_marca: tipoMarca,
          metodo_verificacion: 'PIN',
          pin_codigo: pinDigits,
          geolocalizacion: coords,
        }),
      });

      const json = (await res.json()) as {
        data?: KioskCheckInReceipt;
        error?: string;
      };

      if (!res.ok || !json.data) {
        toast({
          title: 'No se pudo registrar la asistencia',
          description: json.error ?? 'Verifica tu PIN de 6 dígitos.',
          variant: 'danger',
        });
        return;
      }

      if (json.data.tenant) {
        setTenantInfo(json.data.tenant);
        setTenantCodeInput(json.data.tenant.tenant_code);
      }
      setPinDigits('');
      setReceipt(json.data);
      toast({
        title: `${tipoMarca === 'ENTRADA' ? 'Check-In (Entrada)' : 'Check-Out (Salida)'} registrado`,
        description: `${json.data.empleado.nombre_completo} · ${json.data.checada.ts_dispositivo_local}`,
        variant: 'success',
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSelfEnrollWebAuthn(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(enrollPin)) {
      toast({
        title: 'Ingresa tu PIN de 6 dígitos',
        description:
          'Se requiere tu PIN personal para autorizar el vínculo de este dispositivo.',
        variant: 'warning',
      });
      return;
    }

    const effectiveTenantCode =
      tenantInfo?.tenant_code || tenantCodeInput.trim().toUpperCase() || 'TIJ-001';

    setEnrollingSelf(true);
    try {
      const lookupRes = await fetch(
        `/api/checador?empresa=${encodeURIComponent(effectiveTenantCode)}&pin_codigo=${encodeURIComponent(enrollPin)}`,
      );
      const lookupJson = (await lookupRes.json()) as {
        empleado?: {
          id: string;
          codigo_empleado: string;
          nombre_completo: string;
        } | null;
      };

      if (!lookupRes.ok || !lookupJson.empleado) {
        toast({
          title: 'PIN no reconocido',
          description: 'Verifica tu PIN de 6 dígitos e intenta nuevamente.',
          variant: 'danger',
        });
        return;
      }

      const cred = await createEmployeeWebAuthnCredential({
        empleadoId: lookupJson.empleado.id,
        codigoEmpleado: lookupJson.empleado.codigo_empleado,
        nombreEmpleado: lookupJson.empleado.nombre_completo,
        tenantNombre: tenantInfo?.nombre_comercial,
      });

      const saveRes = await fetch('/api/checador/enrolar-webauthn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant_code: effectiveTenantCode,
          pin_codigo: enrollPin,
          credential_id: cred.credential_id,
          public_key: cred.public_key,
          algoritmo: cred.algoritmo,
          nombre_dispositivo:
            enrollDeviceName.trim() || 'Móvil / Tablet Personal',
        }),
      });

      const saveJson = (await saveRes.json()) as { error?: string };
      if (!saveRes.ok) {
        toast({
          title: 'No se pudo vincular el dispositivo',
          description:
            saveJson.error ?? 'Intenta con otro nombre de dispositivo.',
          variant: 'danger',
        });
        return;
      }

      setEnrollSheetOpen(false);
      setEnrollPin('');
      setMetodo('WEBAUTHN');
      toast({
        title: 'Huella / FaceID vinculado con éxito',
        description: `Hola ${lookupJson.empleado.nombre_completo}, ahora puedes hacer Check-In y Check-Out con un toque biométrico.`,
        variant: 'success',
      });
    } catch (err) {
      toast({
        title: 'Enrolamiento biométrico cancelado',
        description:
          err instanceof Error
            ? err.message
            : 'No se completó el registro biométrico en tu dispositivo.',
        variant: 'warning',
      });
    } finally {
      setEnrollingSelf(false);
    }
  }

  // Calcular sucursal más cercana a la ubicación GPS actual como referencia visual
  const nearestBranchInfo = React.useMemo(() => {
    if (gpsState.status !== 'ready' || sucursales.length === 0) return null;
    let best: {
      sucursal: KioskSucursal;
      distanciaM: number;
      dentro: boolean;
    } | null = null;

    for (const s of sucursales) {
      if (s.latitud == null || s.longitud == null) continue;
      const dist = calculateHaversineDistanceMeters(
        gpsState.latitud,
        gpsState.longitud,
        s.latitud,
        s.longitud,
      );
      if (!best || dist < best.distanciaM) {
        best = {
          sucursal: s,
          distanciaM: dist,
          dentro: dist <= (s.radio_geocerca_m || 150),
        };
      }
    }
    return best;
  }, [gpsState, sucursales]);

  const timeZone = tenantInfo?.zona_horaria ?? 'America/Tijuana';
  const formattedClock = new Intl.DateTimeFormat('es-MX', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(nowTime);

  const formattedDate = new Intl.DateTimeFormat('es-MX', {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(nowTime);

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      {/* Barra superior del Kiosco sin login */}
      <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--surface-translucent)] backdrop-blur-[var(--blur)]">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-[var(--s-4)] py-[var(--s-3)]">
          <div className="flex items-center gap-[var(--s-3)]">
            <SmClockLogo className="size-9" />
            <div>
              <div className="flex items-center gap-[var(--s-2)]">
                <h1 className="text-sm font-bold text-[var(--text)]">
                  Kiosco Checador Digital
                </h1>
                <Badge variant="info">Acceso Directo Empleados</Badge>
              </div>
              <p className="text-xs text-[var(--text-2)]">
                Check-In y Check-Out con Reconocimiento Facial Automático, Huella / FaceID o PIN + GPS
              </p>
            </div>
          </div>

          <div className="flex items-center gap-[var(--s-2)]">
            <ThemeToggle />
            <Link
              href="/login"
              className="inline-flex h-9 items-center gap-[var(--s-1)] rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface)] px-[var(--s-3)] text-xs font-medium text-[var(--text-2)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
            >
              <ArrowLeft className="size-3.5" aria-hidden="true" />
              <span>Acceso RH / Admin</span>
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-[var(--s-4)] py-[var(--s-6)]">
        <div className="grid grid-cols-1 gap-[var(--s-5)] lg:grid-cols-12">
          {/* Columna izquierda: Reloj Oficial y Estado GPS */}
          <div className="flex flex-col gap-[var(--s-4)] lg:col-span-5">
            <Card>
              <CardHeader className="pb-[var(--s-2)]">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-[var(--accent)]">
                    Hora Oficial ({timeZone})
                  </span>
                  <Clock className="size-4 text-[var(--accent)]" aria-hidden="true" />
                </div>
                <div className="font-mono text-4xl font-extrabold tabular-nums tracking-tight text-[var(--text)]">
                  {formattedClock}
                </div>
                <CardDescription className="capitalize">
                  {formattedDate}
                </CardDescription>
              </CardHeader>

              {tenantInfo && (
                <CardContent className="border-t border-[var(--border)] pt-[var(--s-3)]">
                  <div className="flex items-center gap-[var(--s-2)] rounded-[var(--r-md)] bg-[var(--surface-2)] p-[var(--s-3)]">
                    <Building2
                      className="size-5 shrink-0 text-[var(--accent)]"
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-[var(--text)]">
                        {tenantInfo.nombre_comercial}
                      </p>
                      <p className="text-xs text-[var(--text-2)]">
                        Detección automática de empleado y sucursal
                      </p>
                    </div>
                  </div>
                </CardContent>
              )}
            </Card>

            {/* Tarjeta de Geolocalización GPS en Tiempo Real */}
            <Card>
              <CardHeader className="pb-[var(--s-2)]">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">
                    Ubicación Geográfica del Registro
                  </CardTitle>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => void requestGpsLocation()}
                  >
                    <RefreshCw className="size-3.5" aria-hidden="true" />
                    Actualizar GPS
                  </Button>
                </div>
                <CardDescription>
                  Tu ubicación se guarda junto con tu Check-In / Check-Out para validación de sucursal.
                </CardDescription>
              </CardHeader>

              <CardContent className="flex flex-col gap-[var(--s-3)]">
                {gpsState.status === 'loading' && (
                  <div className="flex items-center gap-[var(--s-2)] rounded-[var(--r-md)] bg-[var(--surface-2)] p-[var(--s-3)] text-xs text-[var(--text-2)]">
                    <Loader2 className="size-4 animate-spin text-[var(--accent)]" />
                    <span>Obteniendo coordenadas GPS del dispositivo…</span>
                  </div>
                )}

                {gpsState.status === 'error' && (
                  <div className="flex flex-col gap-[var(--s-2)] rounded-[var(--r-md)] border border-[var(--danger)] bg-[var(--danger-bg)] p-[var(--s-3)] text-xs text-[var(--danger)]">
                    <div className="flex items-center gap-[var(--s-2)] font-semibold">
                      <AlertTriangle className="size-4 shrink-0" />
                      <span>GPS requerido para checar</span>
                    </div>
                    <p>{gpsState.message}</p>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => void requestGpsLocation()}
                    >
                      <LocateFixed className="size-3.5" />
                      Activar GPS ahora
                    </Button>
                  </div>
                )}

                {gpsState.status === 'ready' && (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-[var(--s-2)] rounded-[var(--r-md)] bg-[var(--surface-2)] p-[var(--s-3)] text-xs">
                      <div className="flex items-center gap-[var(--s-2)]">
                        <MapPin className="size-4 text-[var(--success)]" />
                        <div>
                          <p className="font-mono font-semibold text-[var(--text)]">
                            {gpsState.latitud.toFixed(5)},{' '}
                            {gpsState.longitud.toFixed(5)}
                          </p>
                          <p className="text-[var(--text-2)]">
                            Precisión: ±{gpsState.precision_m} m
                          </p>
                        </div>
                      </div>

                      {nearestBranchInfo && (
                        <Badge
                          variant={
                            nearestBranchInfo.dentro ? 'success' : 'warning'
                          }
                        >
                          {nearestBranchInfo.dentro
                            ? `En ${nearestBranchInfo.sucursal.clave} (${Math.round(nearestBranchInfo.distanciaM)} m)`
                            : `A ${
                                nearestBranchInfo.distanciaM >= 1000
                                  ? `${(nearestBranchInfo.distanciaM / 1000).toFixed(1)} km`
                                  : `${Math.round(nearestBranchInfo.distanciaM)} m`
                              } de ${nearestBranchInfo.sucursal.clave}`}
                        </Badge>
                      )}
                    </div>

                    <LocationMapPreview
                      latitud={gpsState.latitud}
                      longitud={gpsState.longitud}
                      titulo="Tu ubicación actual de Check-In / Check-Out"
                      heightClassName="h-40"
                    />
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Columna derecha: Selector Check-In / Check-Out y Métodos de Verificación */}
          <div className="flex flex-col gap-[var(--s-4)] lg:col-span-7">
            <Card>
              <CardHeader>
                <CardTitle>Registrar Asistencia</CardTitle>
                <CardDescription>
                  Selecciona si vas a registrar tu Entrada o tu Salida. La aplicación te identificará automáticamente por tu rostro, huella o PIN.
                </CardDescription>

                {/* Botones grandes Check-In / Check-Out */}
                <div className="grid grid-cols-2 gap-[var(--s-3)] pt-[var(--s-2)]">
                  <button
                    type="button"
                    onClick={() => setTipoMarca('ENTRADA')}
                    className={`flex items-center justify-center gap-[var(--s-2)] rounded-[var(--r-lg)] border-2 px-[var(--s-4)] py-[var(--s-3)] text-sm font-bold transition-all ${
                      tipoMarca === 'ENTRADA'
                        ? 'border-[var(--success)] bg-[var(--success-bg)] text-[var(--success)] shadow-[var(--shadow-1)]'
                        : 'border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-2)] hover:bg-[var(--surface)]'
                    }`}
                  >
                    <LogIn className="size-5" aria-hidden="true" />
                    <span>Check-In (Entrada)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setTipoMarca('SALIDA')}
                    className={`flex items-center justify-center gap-[var(--s-2)] rounded-[var(--r-lg)] border-2 px-[var(--s-4)] py-[var(--s-3)] text-sm font-bold transition-all ${
                      tipoMarca === 'SALIDA'
                        ? 'border-[var(--warning)] bg-[var(--warning-bg)] text-[var(--warning)] shadow-[var(--shadow-1)]'
                        : 'border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-2)] hover:bg-[var(--surface)]'
                    }`}
                  >
                    <LogOut className="size-5" aria-hidden="true" />
                    <span>Check-Out (Salida)</span>
                  </button>
                </div>

                {/* Selector de Método: Reconocimiento Facial / Huella-FaceID / PIN */}
                <div className="pt-[var(--s-3)]">
                  <SegmentedControl
                    ariaLabel="Método de verificación de identidad"
                    value={metodo}
                    onChange={(val) => {
                      setMetodo(val);
                      setReceipt(null);
                    }}
                    options={[
                      { value: 'ROSTRO', label: 'Reconocimiento Facial' },
                      { value: 'WEBAUTHN', label: 'Huella / FaceID' },
                      { value: 'PIN', label: 'PIN (6 dígitos)' },
                    ]}
                  />
                </div>
              </CardHeader>

              <CardContent>
                {/* MÉTODO 1: RECONOCIMIENTO FACIAL AUTOMÁTICO (SIN PEDIR CÓDIGO NI PIN) */}
                {metodo === 'ROSTRO' && (
                  <div className="flex flex-col items-center gap-[var(--s-4)]">
                    <p className="text-center text-xs text-[var(--text-2)]">
                      Coloca tu rostro dentro del óvalo. El sistema identificará automáticamente quién eres y a qué empresa y sucursal perteneces.
                    </p>

                    <div className="relative aspect-square w-full max-w-xs overflow-hidden rounded-[var(--r-xl)] border-2 border-[var(--accent)] bg-black shadow-[var(--shadow-2)]">
                      <video
                        ref={videoRef}
                        playsInline
                        muted
                        className="size-full object-cover"
                      />
                      {/* Guía ovalada facial */}
                      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                        <div className="h-52 w-40 rounded-full border-2 border-dashed border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
                      </div>
                      <div className="absolute bottom-2 left-2 right-2 rounded-[var(--r-md)] bg-black/65 px-2.5 py-1.5 text-center text-[11px] font-medium text-white">
                        Reconocimiento Facial 1:N Automático · Sin ingresar código ni PIN
                      </div>
                    </div>

                    {cameraError && (
                      <p className="text-xs font-medium text-[var(--danger)]">
                        {cameraError}
                      </p>
                    )}

                    <div className="flex flex-wrap items-center justify-center gap-[var(--s-2)]">
                      {!cameraActive && (
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => void startCamera()}
                        >
                          <Camera className="size-4" />
                          Activar cámara
                        </Button>
                      )}
                      <Button
                        type="button"
                        size="lg"
                        disabled={submitting || !cameraActive}
                        onClick={() => void handleFaceRecognitionSubmit()}
                      >
                        {submitting ? (
                          <>
                            <Loader2 className="size-5 animate-spin" />
                            <span>Identificando rostro…</span>
                          </>
                        ) : (
                          <>
                            <ScanFace className="size-5" />
                            <span>
                              Reconocer Rostro y Registrar{' '}
                              {tipoMarca === 'ENTRADA'
                                ? 'Check-In (Entrada)'
                                : 'Check-Out (Salida)'}
                            </span>
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                )}

                {/* MÉTODO 2: WEBAUTHN (HUELLA / FACEID / PASSKEY DEL DISPOSITIVO) */}
                {metodo === 'WEBAUTHN' && (
                  <div className="flex flex-col items-center gap-[var(--s-4)] py-[var(--s-4)] text-center">
                    <div className="flex size-20 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent)] shadow-[var(--shadow-1)]">
                      <Fingerprint className="size-10" strokeWidth={1.75} />
                    </div>
                    <div className="max-w-md">
                      <h3 className="text-base font-bold text-[var(--text)]">
                        Verificación Biométrica WebAuthn (Huella / FaceID)
                      </h3>
                      <p className="mt-1 text-xs text-[var(--text-2)]">
                        Utiliza el sensor biométrico de tu teléfono, tablet o computadora para firmar criptográficamente tu{' '}
                        {tipoMarca === 'ENTRADA'
                          ? 'Check-In (Entrada)'
                          : 'Check-Out (Salida)'}{' '}
                        con tu ubicación GPS actual.
                      </p>
                    </div>

                    <Button
                      type="button"
                      size="lg"
                      disabled={submitting}
                      onClick={() => void handleWebAuthnSubmit()}
                    >
                      <Fingerprint className="size-5" />
                      <span>
                        {submitting
                          ? 'Verificando sensor biométrico…'
                          : `Hacer ${tipoMarca === 'ENTRADA' ? 'Check-In' : 'Check-Out'} con Huella / FaceID`}
                      </span>
                    </Button>

                    <div className="mt-[var(--s-2)] border-t border-[var(--border)] pt-[var(--s-3)]">
                      <p className="mb-[var(--s-2)] text-xs text-[var(--text-2)]">
                        ¿Es la primera vez que usas este dispositivo?
                      </p>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => setEnrollSheetOpen(true)}
                      >
                        <ShieldCheck className="size-4 text-[var(--accent)]" />
                        <span>Vincular mi Huella / FaceID usando mi PIN</span>
                      </Button>
                    </div>
                  </div>
                )}

                {/* MÉTODO 3: PIN DE 6 DÍGITOS */}
                {metodo === 'PIN' && (
                  <div className="mx-auto flex max-w-xs flex-col items-center gap-[var(--s-4)]">
                    <div className="flex items-center gap-[var(--s-2)] text-xs font-medium text-[var(--text-2)]">
                      <KeyRound className="size-4 text-[var(--accent)]" />
                      <span>Ingresa tu PIN personal único de 6 dígitos</span>
                    </div>

                    {/* Indicadores de los 6 dígitos */}
                    <div
                      className="flex items-center justify-center gap-[var(--s-2)]"
                      aria-label={`PIN ingresado: ${pinDigits.length} de 6 dígitos`}
                    >
                      {Array.from({ length: 6 }).map((_, idx) => {
                        const char = pinDigits[idx];
                        return (
                          <div
                            key={idx}
                            className={`flex size-11 items-center justify-center rounded-[var(--r-md)] border text-lg font-bold font-mono transition-all ${
                              char
                                ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                                : 'border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-3)]'
                            }`}
                          >
                            {char ? '●' : ''}
                          </div>
                        );
                      })}
                    </div>

                    {/* Teclado numérico táctil estilo iOS */}
                    <div className="grid w-full grid-cols-3 gap-[var(--s-2)]">
                      {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(
                        (digit) => (
                          <button
                            key={digit}
                            type="button"
                            onClick={() => handleAppendDigit(digit)}
                            className="flex h-13 items-center justify-center rounded-[var(--r-lg)] border border-[var(--border)] bg-[var(--surface-2)] font-mono text-xl font-bold text-[var(--text)] transition-colors active:bg-[var(--accent)] active:text-white hover:bg-[var(--surface)]"
                          >
                            {digit}
                          </button>
                        ),
                      )}
                      <button
                        type="button"
                        onClick={() => setPinDigits('')}
                        className="flex h-13 items-center justify-center rounded-[var(--r-lg)] border border-[var(--border)] bg-[var(--surface-2)] text-xs font-semibold text-[var(--text-2)] hover:bg-[var(--surface)]"
                      >
                        Limpiar
                      </button>
                      <button
                        key="0"
                        type="button"
                        onClick={() => handleAppendDigit('0')}
                        className="flex h-13 items-center justify-center rounded-[var(--r-lg)] border border-[var(--border)] bg-[var(--surface-2)] font-mono text-xl font-bold text-[var(--text)] transition-colors active:bg-[var(--accent)] active:text-white hover:bg-[var(--surface)]"
                      >
                        0
                      </button>
                      <button
                        type="button"
                        onClick={handleBackspaceDigit}
                        aria-label="Borrar último dígito"
                        className="flex h-13 items-center justify-center rounded-[var(--r-lg)] border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-2)] hover:bg-[var(--surface)]"
                      >
                        <Delete className="size-5" />
                      </button>
                    </div>

                    <Button
                      type="button"
                      className="w-full"
                      disabled={submitting || pinDigits.length !== 6}
                      onClick={() => void handlePinSubmit()}
                    >
                      {submitting ? (
                        <>
                          <Loader2 className="size-4 animate-spin" />
                          <span>Registrando…</span>
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="size-4" />
                          <span>
                            Confirmar{' '}
                            {tipoMarca === 'ENTRADA'
                              ? 'Check-In (Entrada)'
                              : 'Check-Out (Salida)'}{' '}
                            con PIN
                          </span>
                        </>
                      )}
                    </Button>
                  </div>
                )}

                {/* Comprobante inmediato del Check-In / Check-Out realizado */}
                {receipt && (
                  <div className="mt-[var(--s-5)] rounded-[var(--r-xl)] border-2 border-[var(--success)] bg-[var(--surface-2)] p-[var(--s-4)]">
                    <div className="mb-[var(--s-3)] flex flex-wrap items-center justify-between gap-[var(--s-2)]">
                      <div className="flex items-center gap-[var(--s-2)]">
                        <CheckCircle2 className="size-6 text-[var(--success)]" />
                        <div>
                          <h4 className="text-sm font-bold text-[var(--text)]">
                            {receipt.checada.tipo_marca === 'ENTRADA'
                              ? 'Check-In (Entrada) Confirmado'
                              : 'Check-Out (Salida) Confirmado'}
                          </h4>
                          <p className="text-xs text-[var(--text-2)]">
                            {receipt.empleado.nombre_completo} (#
                            {receipt.empleado.codigo_empleado}) ·{' '}
                            {receipt.checada.ts_dispositivo_local}
                          </p>
                        </div>
                      </div>
                      <Badge variant="info">
                        Verificado por {receipt.checada.tipo_verificacion}
                      </Badge>
                    </div>

                    <LocationMapPreview
                      latitud={receipt.checada.latitud}
                      longitud={receipt.checada.longitud}
                      titulo={`Registro en ${receipt.sucursal?.nombre ?? 'Sucursal'}`}
                      sucursalLatitud={receipt.sucursal?.latitud}
                      sucursalLongitud={receipt.sucursal?.longitud}
                      sucursalNombre={receipt.sucursal?.nombre}
                      distanciaMetros={receipt.checada.distancia_sucursal_m}
                      dentroGeocerca={receipt.checada.dentro_geocerca}
                      heightClassName="h-44"
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </main>

      {/* Sheet de Auto-Enrolamiento WebAuthn con PIN de 6 dígitos */}
      <Sheet
        open={enrollSheetOpen}
        onOpenChange={setEnrollSheetOpen}
        title="Vincular mi Huella / FaceID (WebAuthn)"
        description="Ingresa tu PIN personal de 6 dígitos para autorizar y registrar el lector biométrico de este dispositivo."
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setEnrollSheetOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              form="self-enroll-webauthn-form"
              disabled={enrollingSelf || enrollPin.length !== 6}
            >
              <Fingerprint className="size-4" />
              <span>
                {enrollingSelf
                  ? 'Esperando huella / FaceID…'
                  : 'Verificar PIN y registrar biometría'}
              </span>
            </Button>
          </>
        }
      >
        <form
          id="self-enroll-webauthn-form"
          onSubmit={(e) => void handleSelfEnrollWebAuthn(e)}
          className="flex flex-col gap-[var(--s-4)]"
        >
          <div>
            <label
              htmlFor="self-enroll-pin"
              className="mb-[var(--s-1)] block text-xs font-semibold text-[var(--text-2)]"
            >
              Tu PIN personal de 6 dígitos
            </label>
            <Input
              id="self-enroll-pin"
              inputMode="numeric"
              maxLength={6}
              value={enrollPin}
              onChange={(e) =>
                setEnrollPin(e.target.value.replace(/\D/g, '').slice(0, 6))
              }
              placeholder="100101"
              className="font-mono text-lg tracking-widest"
            />
          </div>

          <div>
            <label
              htmlFor="self-enroll-device-name"
              className="mb-[var(--s-1)] block text-xs font-semibold text-[var(--text-2)]"
            >
              Nombre de este dispositivo
            </label>
            <Input
              id="self-enroll-device-name"
              value={enrollDeviceName}
              onChange={(e) => setEnrollDeviceName(e.target.value)}
              placeholder="Ej. iPhone de Alejandro / Tablet Caseta"
            />
          </div>
        </form>
      </Sheet>
    </div>
  );
}

export default function ChecadorKioskPage() {
  return (
    <React.Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] text-sm text-[var(--text-2)]">
          Cargando Kiosco Checador…
        </div>
      }
    >
      <ChecadorKioskContent />
    </React.Suspense>
  );
}
