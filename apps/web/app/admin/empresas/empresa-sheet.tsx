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

export interface EmpresaSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialData?: TenantRow | null;
  onSaved: () => void;
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

  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [isSaving, setIsSaving] = React.useState(false);

  React.useEffect(() => {
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
    setErrorMessage(null);
  }, [initialData, open]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);

    const basePayload = {
      tenant_code: tenantCode,
      nombre_comercial: nombreComercial,
      razon_social: razonSocial,
      rfc,
      regimen_fiscal: regimenFiscal,
      codigo_postal_fiscal: codigoPostalFiscal,
      uso_cfdi: usoCfdi,
      correo_facturacion: correoFacturacion || null,
      contacto_nombre: contactoNombre || adminNombre || null,
      contacto_email: contactoEmail || adminEmail || null,
      contacto_telefono: contactoTelefono || null,
      notas_internas: notasInternas || null,
      plan_codigo: planCodigo,
      estatus,
      zona_horaria: zonaHoraria,
    };

    const parsed = isEditing
      ? TenantUpdateSchema.safeParse(basePayload)
      : TenantCreateWithAdminSchema.safeParse({
          ...basePayload,
          admin_inicial: {
            nombre_completo: adminNombre,
            email: adminEmail,
          },
        });

    if (!parsed.success) {
      setErrorMessage(
        parsed.error.issues[0]?.message ?? 'Revisa los campos obligatorios',
      );
      return;
    }

    setIsSaving(true);
    try {
      const endpoint = initialData
        ? `/api/admin/tenants/${initialData.id}`
        : '/api/admin/tenants';
      const method = initialData ? 'PATCH' : 'POST';

      const response = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });

      if (!response.ok) {
        const errJson = (await response.json()) as { error?: string };
        setErrorMessage(errJson.error ?? 'No se pudo guardar la empresa');
        return;
      }

      onSaved();
      onOpenChange(false);
    } catch {
      setErrorMessage('Error de red al guardar los datos de la empresa.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={isEditing ? 'Editar empresa' : 'Nueva empresa y Admin inicial'}
      description="Datos comerciales, referencia fiscal y alta obligatoria del primer usuario Administrador (ADMIN_EMPRESA) con Google Auth."
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
            type="submit"
            form="empresa-sheet-form"
            disabled={isSaving}
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
        id="empresa-sheet-form"
        onSubmit={handleSubmit}
        className="flex flex-col gap-[var(--s-4)]"
      >
        <fieldset className="flex flex-col gap-[var(--s-3)] rounded-[var(--r-lg)] border border-[var(--separator)] bg-[var(--surface-2)] p-[var(--s-4)]">
          <legend className="px-[var(--s-2)] text-xs font-bold uppercase tracking-wider text-[var(--accent)]">
            1. Administrador inicial de la empresa (Google Auth)
          </legend>

          <div className="flex flex-wrap items-center justify-between gap-[var(--s-2)]">
            <p className="text-xs text-[var(--text-2)]">
              Este usuario recibirá el rol <strong>ADMIN_EMPRESA</strong> para
              iniciar sesión con su cuenta de Google e invitar al resto de su
              equipo.
            </p>
            <Badge variant="accent">
              <ShieldCheck
                className="mr-[var(--s-1)] size-3.5"
                strokeWidth={1.75}
                aria-hidden="true"
              />
              <span>Google Auth requerido</span>
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
                required={!isEditing}
                disabled={isEditing}
                placeholder="Carlos Mendoza"
                value={adminNombre}
                onChange={(e) => {
                  setAdminNombre(e.target.value);
                  if (!isEditing && !contactoNombre) {
                    setContactoNombre(e.target.value);
                  }
                }}
              />
            </div>

            <div className="flex flex-col gap-[var(--s-1)]">
              <label htmlFor="admin-email" className="ios-label">
                Correo de Google (Workspace / Gmail) *
              </label>
              <Input
                id="admin-email"
                name="admin_email"
                type="email"
                autoComplete="email"
                spellCheck={false}
                autoCapitalize="none"
                autoCorrect="off"
                required={!isEditing}
                disabled={isEditing}
                placeholder="admin@empresa.mx"
                value={adminEmail}
                onChange={(e) => {
                  setAdminEmail(e.target.value);
                  if (!isEditing && !contactoEmail) {
                    setContactoEmail(e.target.value);
                  }
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
              required
              spellCheck={false}
              autoCapitalize="characters"
              autoCorrect="off"
              placeholder="TIJ-001"
              value={tenantCode}
              onChange={(e) => setTenantCode(e.target.value)}
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
            required
            placeholder="Maquiladora del Pacífico"
            value={nombreComercial}
            onChange={(e) => setNombreComercial(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-[var(--s-1)]">
          <label htmlFor="razon-social" className="ios-label">
            Razón social (referencia fiscal) *
          </label>
          <Input
            id="razon-social"
            name="razon_social"
            required
            placeholder="MAQUILADORA DEL PACIFICO SA DE CV"
            value={razonSocial}
            onChange={(e) => setRazonSocial(e.target.value)}
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
              required
              spellCheck={false}
              autoCapitalize="characters"
              autoCorrect="off"
              placeholder="MPA010101ABC"
              value={rfc}
              onChange={(e) => setRfc(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-[var(--s-1)]">
            <label htmlFor="regimen-fiscal" className="ios-label">
              Régimen SAT *
            </label>
            <Input
              id="regimen-fiscal"
              name="regimen_fiscal"
              required
              inputMode="numeric"
              placeholder="601"
              value={regimenFiscal}
              onChange={(e) => setRegimenFiscal(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-[var(--s-1)]">
            <label htmlFor="cp-fiscal" className="ios-label">
              C.P. Fiscal *
            </label>
            <Input
              id="cp-fiscal"
              name="codigo_postal_fiscal"
              required
              inputMode="numeric"
              autoComplete="postal-code"
              placeholder="22000"
              value={codigoPostalFiscal}
              onChange={(e) => setCodigoPostalFiscal(e.target.value)}
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
              onChange={(e) => setContactoTelefono(e.target.value)}
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
              onChange={(e) => setCorreoFacturacion(e.target.value)}
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
            onChange={(e) => setNotasInternas(e.target.value)}
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
  );
}
