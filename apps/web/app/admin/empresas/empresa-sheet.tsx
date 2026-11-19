'use client';

import * as React from 'react';
import { ShieldCheck } from 'lucide-react';
import {
  PlanCodigoSchema,
  TenantCreateWithAdminSchema,
  TenantStatusSchema,
  TenantUpdateSchema,
  ZonaHorariaMexicoSchema,
  type Database,
  type PlanCodigo,
  type TenantStatus,
  type ZonaHorariaMexico,
} from '@sm-clock/contracts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorDialog, type ErrorDialogData } from '@/components/ui/error-dialog';
import { Input } from '@/components/ui/input';
import { Sheet } from '@/components/ui/sheet';

type TenantRow = Database['public']['Tables']['tenants']['Row'] & {
  admin_inicial?: {
    id: string;
    nombre_completo: string;
    email: string;
    auth_provider: string;
  } | null;
};

export interface EmpresaSavedMeta {
  inviteUrl?: string;
  emailDelivered?: boolean;
}

export interface EmpresaSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialData?: TenantRow | null;
  onSaved: (meta?: EmpresaSavedMeta) => void;
}

const PLAN_OPTIONS: readonly { value: PlanCodigo; label: string }[] = [
  { value: 'MICRO', label: 'Micro (1–10 empleados)' },
  { value: 'PYME', label: 'PyME (11–50 empleados)' },
  { value: 'INDUSTRIAL', label: 'Industrial (51–250 empleados)' },
  { value: 'CORPORATIVO', label: 'Corporativo (250+ empleados)' },
];

const STATUS_OPTIONS: readonly { value: TenantStatus; label: string }[] = [
  { value: 'ACTIVO', label: 'Activo' },
  { value: 'PRUEBA', label: 'Prueba' },
  { value: 'SUSPENDIDO', label: 'Suspendido (ingesta activa)' },
  { value: 'CANCELADO', label: 'Cancelado' },
];

const TIMEZONE_OPTIONS: readonly { value: ZonaHorariaMexico; label: string }[] =
  [
    { value: 'America/Tijuana', label: 'America/Tijuana (B.C. con DST)' },
    { value: 'America/Hermosillo', label: 'America/Hermosillo (Sonora)' },
    { value: 'America/Mazatlan', label: 'America/Mazatlan (Pacífico)' },
    { value: 'America/Chihuahua', label: 'America/Chihuahua' },
    { value: 'America/Ciudad_Juarez', label: 'America/Ciudad_Juarez' },
    { value: 'America/Monterrey', label: 'America/Monterrey' },
    { value: 'America/Mexico_City', label: 'America/Mexico_City (Centro)' },
    { value: 'America/Cancun', label: 'America/Cancun (Sureste)' },
  ];

export function EmpresaSheet({
  open,
  onOpenChange,
  initialData = null,
  onSaved,
}: EmpresaSheetProps) {
  const isEditing = Boolean(initialData);
  const [tenantCode, setTenantCode] = React.useState('');
  const [nombreComercial, setNombreComercial] = React.useState('');
  const [razonSocial, setRazonSocial] = React.useState('');
  const [rfc, setRfc] = React.useState('');
  const [regimenFiscal, setRegimenFiscal] = React.useState('601');
  const [codigoPostalFiscal, setCodigoPostalFiscal] = React.useState('22000');
  const [usoCfdi, setUsoCfdi] = React.useState('G03');
  const [correoFacturacion, setCorreoFacturacion] = React.useState('');
  const [contactoNombre, setContactoNombre] = React.useState('');
  const [contactoEmail, setContactoEmail] = React.useState('');
  const [contactoTelefono, setContactoTelefono] = React.useState('');
  const [notasInternas, setNotasInternas] = React.useState('');
  const [planCodigo, setPlanCodigo] = React.useState<PlanCodigo>('MICRO');
  const [estatus, setEstatus] = React.useState<TenantStatus>('ACTIVO');
  const [zonaHoraria, setZonaHoraria] =
    React.useState<ZonaHorariaMexico>('America/Tijuana');

  // Datos del Administrador inicial (Google Auth obligatorio)
  const [adminNombre, setAdminNombre] = React.useState('');
  const [adminEmail, setAdminEmail] = React.useState('');

  const [fieldErrors, setFieldErrors] = React.useState<
    Record<string, string>
  >({});
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [errorDialog, setErrorDialog] = React.useState<ErrorDialogData | null>(
    null,
  );
  const [isSaving, setIsSaving] = React.useState(false);
  const formRef = React.useRef<HTMLFormElement | null>(null);
  const prevOpenRef = React.useRef(open);
  const prevInitialDataIdRef = React.useRef(initialData?.id);

  const clearFieldError = (key: string) => {
    setFieldErrors((prev) => {
      if (!prev[key]) return prev;
      const { [key]: _removed, ...rest } = prev;
      return rest;
    });
  };

  React.useEffect(() => {
    const justOpened = open && !prevOpenRef.current;
    const initialDataChanged = initialData?.id !== prevInitialDataIdRef.current;
    prevOpenRef.current = open;
    prevInitialDataIdRef.current = initialData?.id;

    if (!justOpened && !initialDataChanged) {
      return;
    }

    if (initialData) {
      setTenantCode(initialData.tenant_code);
      setNombreComercial(initialData.nombre_comercial);
      setRazonSocial(initialData.razon_social);
      setRfc(initialData.rfc);
      setRegimenFiscal(initialData.regimen_fiscal);
      setCodigoPostalFiscal(initialData.codigo_postal_fiscal);
      setUsoCfdi(initialData.uso_cfdi);
      setCorreoFacturacion(initialData.correo_facturacion ?? '');
      setContactoNombre(initialData.contacto_nombre ?? '');
      setContactoEmail(initialData.contacto_email ?? '');
      setContactoTelefono(initialData.contacto_telefono ?? '');
      setNotasInternas(initialData.notas_internas ?? '');
      const parsedPlan = PlanCodigoSchema.safeParse(initialData.plan_codigo);
      setPlanCodigo(parsedPlan.success ? parsedPlan.data : 'MICRO');
      const parsedStatus = TenantStatusSchema.safeParse(initialData.estatus);
      setEstatus(parsedStatus.success ? parsedStatus.data : 'ACTIVO');
      const parsedTz = ZonaHorariaMexicoSchema.safeParse(
        initialData.zona_horaria,
      );
      setZonaHoraria(parsedTz.success ? parsedTz.data : 'America/Tijuana');
      setAdminNombre(
        initialData.admin_inicial?.nombre_completo ??
          initialData.contacto_nombre ??
          '',
      );
      setAdminEmail(
        initialData.admin_inicial?.email ?? initialData.contacto_email ?? '',
      );
    } else {
      setTenantCode('');
      setNombreComercial('');
      setRazonSocial('');
      setRfc('');
      setRegimenFiscal('601');
      setCodigoPostalFiscal('22000');
      setUsoCfdi('G03');
      setCorreoFacturacion('');
      setContactoNombre('');
      setContactoEmail('');
      setContactoTelefono('');
      setNotasInternas('');
      setPlanCodigo('MICRO');
      setEstatus('ACTIVO');
      setZonaHoraria('America/Tijuana');
      setAdminNombre('');
      setAdminEmail('');
    }
    setFieldErrors({});
    setErrorMessage(null);
    setErrorDialog(null);
  }, [initialData, open]);

  const handleSave = async (event?: React.FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    setErrorMessage(null);

    const basePayload = {
      tenant_code: tenantCode.trim(),
      nombre_comercial: nombreComercial.trim(),
      razon_social: razonSocial.trim(),
      rfc: rfc.trim().toUpperCase(),
      regimen_fiscal: regimenFiscal.trim(),
      codigo_postal_fiscal: codigoPostalFiscal.trim(),
      uso_cfdi: usoCfdi.trim().toUpperCase(),
      correo_facturacion: correoFacturacion.trim() || null,
      contacto_nombre:
        (isEditing ? contactoNombre || adminNombre : adminNombre).trim() ||
        null,
      contacto_email:
        (isEditing ? contactoEmail || adminEmail : adminEmail).trim() ||
        null,
      contacto_telefono: contactoTelefono.trim() || null,
      notas_internas: notasInternas.trim() || null,
      plan_codigo: planCodigo,
      estatus,
      zona_horaria: zonaHoraria,
    };

    const parsed = isEditing
      ? TenantUpdateSchema.safeParse(basePayload)
      : TenantCreateWithAdminSchema.safeParse({
          ...basePayload,
          admin_inicial: {
            nombre_completo: adminNombre.trim(),
            email: adminEmail.trim(),
          },
        });

    if (!parsed.success) {
      const errMap: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const pathKey = issue.path.join('.');
        if (!errMap[pathKey]) {
          errMap[pathKey] = issue.message;
        }
      }
      setFieldErrors(errMap);

      const technicalList = parsed.error.issues
        .map(
          (issue) =>
            `• Campo "${issue.path.join('.') || 'formulario'}": ${issue.message}`,
        )
        .join('\n');

      const friendlyMsg =
        parsed.error.issues.length === 1
          ? parsed.error.issues[0]?.message ?? 'Revisa los campos obligatorios'
          : 'Por favor verifica la información capturada; se encontraron datos obligatorios pendientes o con formato inválido.';

      setErrorMessage(friendlyMsg);
      setErrorDialog({
        title: isEditing
          ? 'Error al validar cambios de la empresa'
          : 'Error al validar nueva empresa y Admin',
        userMessage: friendlyMsg,
        technicalDetails: technicalList,
        endpoint: isEditing
          ? `PATCH /api/admin/tenants/${initialData?.id ?? ''}`
          : 'POST /api/admin/tenants',
        status: 'VALIDATION_ERROR',
      });
      return;
    }

    setFieldErrors({});
    setIsSaving(true);
    const endpoint = initialData
      ? `/api/admin/tenants/${initialData.id}`
      : '/api/admin/tenants';
    const method = initialData ? 'PATCH' : 'POST';

    try {
      const response = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });

      if (!response.ok) {
        const errJson = (await response.json().catch(() => ({}))) as {
          error?: string;
          details?: unknown;
        };

        const technicalDetails = errJson.details
          ? typeof errJson.details === 'string'
            ? errJson.details
            : JSON.stringify(errJson.details, null, 2)
          : `HTTP ${response.status} (${response.statusText || 'Error en servidor'})`;

        const friendlyMsg =
          errJson.error ?? 'No se pudo guardar la información de la empresa.';

        setErrorMessage(friendlyMsg);
        setErrorDialog({
          title: isEditing
            ? 'Error al actualizar empresa'
            : 'Error al registrar empresa',
          userMessage: friendlyMsg,
          technicalDetails,
          endpoint,
          status: response.status,
        });
        return;
      }

      const okJson = (await response.json().catch(() => ({}))) as {
        inviteUrl?: string;
        emailDelivery?: { delivered?: boolean };
      };

      onSaved(
        isEditing
          ? undefined
          : {
              inviteUrl: okJson.inviteUrl,
              emailDelivered: okJson.emailDelivery?.delivered,
            },
      );
      onOpenChange(false);
    } catch (err) {
      const technicalDetails =
        err instanceof Error
          ? `${err.name}: ${err.message}\n${err.stack ?? ''}`
          : String(err);
      const friendlyMsg =
        'Error de red o conexión al intentar guardar los datos de la empresa. Por favor intenta de nuevo.';

      setErrorMessage(friendlyMsg);
      setErrorDialog({
        title: 'Error de conexión con el servidor',
        userMessage: friendlyMsg,
        technicalDetails,
        endpoint,
        status: 'NETWORK_ERROR',
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={onOpenChange}
        title={isEditing ? 'Editar empresa' : 'Nueva empresa y Admin inicial'}
        description="Datos comerciales, referencia fiscal y alta del Administrador inicial (ADMIN_EMPRESA) con invitación por correo electrónico o Google Auth."
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={isSaving}
              onClick={() => {
                void handleSave();
              }}
            >
              {isSaving
                ? 'Guardando…'
                : isEditing
                  ? 'Guardar cambios'
                  : 'Registrar empresa y Admin'}
            </Button>
          </>
        }
      >
        <form
          ref={formRef}
          id="empresa-sheet-form"
          noValidate
          onSubmit={(e) => {
            void handleSave(e);
          }}
          className="flex flex-col gap-[var(--s-4)]"
        >
        <fieldset className="flex flex-col gap-[var(--s-3)] rounded-[var(--r-lg)] border border-[var(--separator)] bg-[var(--surface-2)] p-[var(--s-4)]">
          <legend className="px-[var(--s-2)] text-xs font-bold uppercase tracking-wider text-[var(--accent)]">
            1. Administrador inicial de la empresa
          </legend>

          <div className="flex flex-wrap items-center justify-between gap-[var(--s-2)]">
            <p className="text-xs text-[var(--text-2)]">
              Este usuario recibirá el rol <strong>ADMIN_EMPRESA</strong> y una
              invitación por correo para crear su contraseña (para la app web y
              los agentes, sin requerir Gmail) o iniciar con Google Auth.
            </p>
            <Badge variant="accent">
              <ShieldCheck
                className="mr-[var(--s-1)] size-3.5"
                strokeWidth={1.75}
                aria-hidden="true"
              />
              <span>Email o Google Auth</span>
            </Badge>
          </div>

          <div className="grid grid-cols-1 gap-[var(--s-3)] sm:grid-cols-2">
            <div className="flex flex-col gap-[var(--s-1)]">
              <label htmlFor="admin-nombre" className="ios-label">
                Nombre completo del Admin *
              </label>
              <Input
                id="admin-nombre"
                name="admin_nombre"
                autoComplete="name"
                disabled={isEditing}
                placeholder="Carlos Mendoza"
                value={adminNombre}
                errorMessage={fieldErrors['admin_inicial.nombre_completo']}
                onChange={(e) => {
                  setAdminNombre(e.target.value);
                  clearFieldError('admin_inicial.nombre_completo');
                }}
              />
            </div>

            <div className="flex flex-col gap-[var(--s-1)]">
              <label htmlFor="admin-email" className="ios-label">
                Correo electrónico del Admin *
              </label>
              <Input
                id="admin-email"
                name="admin_email"
                type="email"
                autoComplete="email"
                spellCheck={false}
                autoCapitalize="none"
                autoCorrect="off"
                disabled={isEditing}
                placeholder="admin@empresa.mx"
                value={adminEmail}
                errorMessage={fieldErrors['admin_inicial.email']}
                onChange={(e) => {
                  setAdminEmail(e.target.value);
                  clearFieldError('admin_inicial.email');
                }}
              />
            </div>
          </div>
        </fieldset>

        <div className="grid grid-cols-1 gap-[var(--s-3)] sm:grid-cols-2">
          <div className="flex flex-col gap-[var(--s-1)]">
            <label htmlFor="tenant-code" className="ios-label">
              Código de empresa *
            </label>
            <Input
              id="tenant-code"
              name="tenant_code"
              spellCheck={false}
              autoCapitalize="characters"
              autoCorrect="off"
              placeholder="TIJ-001"
              value={tenantCode}
              errorMessage={fieldErrors['tenant_code']}
              onChange={(e) => {
                setTenantCode(e.target.value);
                clearFieldError('tenant_code');
              }}
            />
          </div>

          <div className="flex flex-col gap-[var(--s-1)]">
            <label htmlFor="plan-codigo" className="ios-label">
              Plan *
            </label>
            <select
              id="plan-codigo"
              name="plan_codigo"
              value={planCodigo}
              onChange={(e) => setPlanCodigo(e.target.value as PlanCodigo)}
              className="ios-input"
            >
              {PLAN_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-col gap-[var(--s-1)]">
          <label htmlFor="nombre-comercial" className="ios-label">
            Nombre comercial *
          </label>
          <Input
            id="nombre-comercial"
            name="nombre_comercial"
            placeholder="Maquiladora del Pacífico"
            value={nombreComercial}
            errorMessage={fieldErrors['nombre_comercial']}
            onChange={(e) => {
              setNombreComercial(e.target.value);
              clearFieldError('nombre_comercial');
            }}
          />
        </div>

        <div className="flex flex-col gap-[var(--s-1)]">
          <label htmlFor="razon-social" className="ios-label">
            Razón social (referencia fiscal) *
          </label>
          <Input
            id="razon-social"
            name="razon_social"
            placeholder="MAQUILADORA DEL PACIFICO SA DE CV"
            value={razonSocial}
            errorMessage={fieldErrors['razon_social']}
            onChange={(e) => {
              setRazonSocial(e.target.value);
              clearFieldError('razon_social');
            }}
          />
        </div>

        <div className="grid grid-cols-1 gap-[var(--s-3)] sm:grid-cols-3">
          <div className="flex flex-col gap-[var(--s-1)]">
            <label htmlFor="rfc" className="ios-label">
              RFC *
            </label>
            <Input
              id="rfc"
              name="rfc"
              spellCheck={false}
              autoCapitalize="characters"
              autoCorrect="off"
              placeholder="MPA010101ABC"
              value={rfc}
              errorMessage={fieldErrors['rfc']}
              onChange={(e) => {
                setRfc(e.target.value);
                clearFieldError('rfc');
              }}
            />
          </div>

          <div className="flex flex-col gap-[var(--s-1)]">
            <label htmlFor="regimen-fiscal" className="ios-label">
              Régimen SAT *
            </label>
            <Input
              id="regimen-fiscal"
              name="regimen_fiscal"
              inputMode="numeric"
              placeholder="601"
              value={regimenFiscal}
              errorMessage={fieldErrors['regimen_fiscal']}
              onChange={(e) => {
                setRegimenFiscal(e.target.value);
                clearFieldError('regimen_fiscal');
              }}
            />
          </div>

          <div className="flex flex-col gap-[var(--s-1)]">
            <label htmlFor="cp-fiscal" className="ios-label">
              C.P. Fiscal *
            </label>
            <Input
              id="cp-fiscal"
              name="codigo_postal_fiscal"
              inputMode="numeric"
              autoComplete="postal-code"
              placeholder="22000"
              value={codigoPostalFiscal}
              errorMessage={fieldErrors['codigo_postal_fiscal']}
              onChange={(e) => {
                setCodigoPostalFiscal(e.target.value);
                clearFieldError('codigo_postal_fiscal');
              }}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-[var(--s-3)] sm:grid-cols-2">
          <div className="flex flex-col gap-[var(--s-1)]">
            <label htmlFor="estatus-select" className="ios-label">
              Estatus operativo *
            </label>
            <select
              id="estatus-select"
              name="estatus"
              value={estatus}
              onChange={(e) => setEstatus(e.target.value as TenantStatus)}
              className="ios-input"
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-[var(--s-1)]">
            <label htmlFor="zona-horaria" className="ios-label">
              Zona horaria *
            </label>
            <select
              id="zona-horaria"
              name="zona_horaria"
              value={zonaHoraria}
              onChange={(e) =>
                setZonaHoraria(e.target.value as ZonaHorariaMexico)
              }
              className="ios-input"
            >
              {TIMEZONE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-[var(--s-3)] sm:grid-cols-2">
          <div className="flex flex-col gap-[var(--s-1)]">
            <label htmlFor="contacto-telefono" className="ios-label">
              Teléfono de contacto
            </label>
            <Input
              id="contacto-telefono"
              name="contacto_telefono"
              type="tel"
              autoComplete="tel"
              placeholder="664 123 4567"
              value={contactoTelefono}
              errorMessage={fieldErrors['contacto_telefono']}
              onChange={(e) => {
                setContactoTelefono(e.target.value);
                clearFieldError('contacto_telefono');
              }}
            />
          </div>

          <div className="flex flex-col gap-[var(--s-1)]">
            <label htmlFor="correo-facturacion" className="ios-label">
              Correo de facturación (referencia)
            </label>
            <Input
              id="correo-facturacion"
              name="correo_facturacion"
              type="email"
              spellCheck={false}
              autoCapitalize="none"
              autoCorrect="off"
              placeholder="cfdi@empresa.mx"
              value={correoFacturacion}
              errorMessage={fieldErrors['correo_facturacion']}
              onChange={(e) => {
                setCorreoFacturacion(e.target.value);
                clearFieldError('correo_facturacion');
              }}
            />
          </div>
        </div>

        <div className="flex flex-col gap-[var(--s-1)]">
          <label htmlFor="notas-internas" className="ios-label">
            Notas internas
          </label>
          <Input
            id="notas-internas"
            name="notas_internas"
            placeholder="Observaciones de instalación o cobranza…"
            value={notasInternas}
            errorMessage={fieldErrors['notas_internas']}
            onChange={(e) => {
              setNotasInternas(e.target.value);
              clearFieldError('notas_internas');
            }}
          />
        </div>

        {errorMessage ? (
          <div
            role="alert"
            className="rounded-[var(--r-md)] bg-[var(--danger-bg)] p-[var(--s-3)] text-sm font-medium text-[var(--danger)]"
          >
            {errorMessage}
          </div>
        ) : null}
        </form>
      </Sheet>

      <ErrorDialog
        open={Boolean(errorDialog)}
        onOpenChange={(isOpen) => {
          if (!isOpen) setErrorDialog(null);
        }}
        error={errorDialog}
      />
    </>
  );
}
