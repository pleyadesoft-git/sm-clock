'use client';

import * as React from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  Check,
  Clock,
  Copy,
  Mail,
  MapPin,
  Phone,
  Send,
  ShieldCheck,
  Users,
  Wifi,
} from 'lucide-react';
import { useForm } from 'react-hook-form';
import {
  AdminTenantEmailSchema,
  type AdminTenantEmailInput,
} from '@sm-clock/contracts';
import type {
  TenantInfraestructuraResponse,
  TenantRelojDetalle,
} from '@/app/api/admin/tenants/[id]/infraestructura/route';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { useToast } from '@/components/ui/toast';
import { formatFechaHoraMx } from '@/lib/utils';

export interface TenantSheetSummary {
  id: string;
  tenant_code: string;
  nombre_comercial: string;
  razon_social: string;
  zona_horaria: string;
}

export interface TenantInfraestructuraSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenant: TenantSheetSummary | null;
  initialMode?: 'overview' | 'email';
}

interface ContactOption {
  key: string;
  nombre: string;
  email: string;
  etiqueta: string;
  telefono?: string | null;
  activo?: boolean;
  authProvider?: string;
  ultimoAccesoEn?: string | null;
}

function buildContactOptions(
  data: TenantInfraestructuraResponse | undefined,
): ContactOption[] {
  if (!data) return [];

  const options: ContactOption[] = [];
  const seenEmails = new Set<string>();

  for (const adm of data.administradores) {
    const normalized = adm.email.trim().toLowerCase();
    seenEmails.add(normalized);
    options.push({
      key: `admin-${adm.id}`,
      nombre: adm.nombre_completo,
      email: adm.email,
      etiqueta: 'Admin Empresa',
      activo: adm.activo,
      authProvider: adm.auth_provider,
      ultimoAccesoEn: adm.ultimo_acceso_en,
    });
  }

  if (data.tenant.contacto_email) {
    const normalized = data.tenant.contacto_email.trim().toLowerCase();
    if (!seenEmails.has(normalized)) {
      seenEmails.add(normalized);
      options.push({
        key: 'contacto-general',
        nombre: data.tenant.contacto_nombre || data.tenant.nombre_comercial,
        email: data.tenant.contacto_email,
        etiqueta: 'Contacto general',
        telefono: data.tenant.contacto_telefono,
      });
    } else if (data.tenant.contacto_telefono && options[0]) {
      options[0].telefono = data.tenant.contacto_telefono;
    }
  }

  if (data.tenant.correo_facturacion) {
    const normalized = data.tenant.correo_facturacion.trim().toLowerCase();
    if (!seenEmails.has(normalized)) {
      seenEmails.add(normalized);
      options.push({
        key: 'facturacion',
        nombre: `Facturación · ${data.tenant.nombre_comercial}`,
        email: data.tenant.correo_facturacion,
        etiqueta: 'Facturación',
      });
    }
  }

  return options;
}

function RelojCard({
  reloj,
  zonaHoraria,
}: {
  reloj: TenantRelojDetalle;
  zonaHoraria: string;
}) {
  const endpointLabel = reloj.ip_local
    ? `${reloj.ip_local}${reloj.puerto ? `:${reloj.puerto}` : ''}`
    : 'Sin IP configurada';

  return (
    <div className="flex flex-col gap-[var(--s-2)] rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--bg)] p-[var(--s-3)]">
      <div className="flex flex-wrap items-start justify-between gap-[var(--s-2)]">
        <div className="flex flex-col gap-[var(--s-1)]">
          <div className="flex flex-wrap items-center gap-[var(--s-2)]">
            {reloj.clave && (
              <code className="rounded-[var(--r-sm)] bg-[var(--surface-2)] px-[var(--s-2)] py-[var(--s-1)] text-xs font-semibold text-[var(--text)]">
                {reloj.clave}
              </code>
            )}
            <span className="text-sm font-semibold text-[var(--text)]">
              {reloj.nombre_ubicacion}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-[var(--s-2)] text-xs text-[var(--text-2)]">
            <span className="inline-flex items-center gap-[var(--s-1)] font-mono">
              <Wifi className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
              {endpointLabel}
            </span>
            {reloj.modelo && <span>· {reloj.modelo}</span>}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-[var(--s-1)]">
          <Badge variant="accent">{reloj.marca}</Badge>
          <Badge variant={reloj.activo ? 'success' : 'default'}>
            {reloj.activo ? 'Activo' : 'Inactivo'}
          </Badge>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-[var(--s-2)] text-xs text-[var(--text-2)]">
        <span className="inline-flex items-center gap-[var(--s-1)]">
          <Clock className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
          {reloj.ultima_conexion_exitosa
            ? `Última conexión: ${formatFechaHoraMx(reloj.ultima_conexion_exitosa, zonaHoraria)}`
            : 'Sin conexión registrada'}
        </span>
      </div>

      {reloj.ultimo_error && (
        <div
          role="alert"
          className="flex items-start gap-[var(--s-2)] rounded-[var(--r-sm)] bg-[var(--danger-soft)] px-[var(--s-2)] py-[var(--s-2)] text-xs text-[var(--danger)]"
        >
          <AlertTriangle
            className="mt-0.5 size-3.5 shrink-0"
            strokeWidth={1.75}
            aria-hidden="true"
          />
          <span className="break-words">{reloj.ultimo_error}</span>
        </div>
      )}
    </div>
  );
}

export function TenantInfraestructuraSheet({
  open,
  onOpenChange,
  tenant,
  initialMode = 'overview',
}: TenantInfraestructuraSheetProps) {
  const { toast } = useToast();
  const [mode, setMode] = React.useState<'overview' | 'email'>(initialMode);
  const [copiedEmail, setCopiedEmail] = React.useState<string | null>(null);
  const [sendingEmail, setSendingEmail] = React.useState(false);
  const [sendError, setSendError] = React.useState<string | null>(null);
  const emailFormId = React.useId();

  const { data, isLoading, error } = useQuery<TenantInfraestructuraResponse>({
    queryKey: ['admin-tenant-infraestructura', tenant?.id],
    enabled: open && Boolean(tenant?.id),
    queryFn: async () => {
      const res = await fetch(
        `/api/admin/tenants/${tenant?.id ?? ''}/infraestructura`,
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(
          body.error ?? 'No se pudo cargar la infraestructura de la empresa',
        );
      }
      return (await res.json()) as TenantInfraestructuraResponse;
    },
  });

  const contacts = React.useMemo(() => buildContactOptions(data), [data]);

  const form = useForm<AdminTenantEmailInput>({
    resolver: zodResolver(AdminTenantEmailSchema),
    mode: 'onChange',
    defaultValues: {
      destinatario_email: '',
      destinatario_nombre: '',
      asunto: '',
      mensaje: '',
    },
  });

  // Sincronizar modo inicial cada vez que se abre el Sheet o cambia la empresa
  React.useEffect(() => {
    if (!open) return;
    setMode(initialMode);
    setSendError(null);
    setCopiedEmail(null);
    form.reset({
      destinatario_email: '',
      destinatario_nombre: '',
      asunto: '',
      mensaje: '',
    });
  }, [open, tenant?.id, initialMode, form]);

  // Preseleccionar primer contacto cuando se abre en modo correo y llegan los datos
  React.useEffect(() => {
    if (!open || mode !== 'email' || contacts.length === 0) return;
    const currentEmail = form.getValues('destinatario_email');
    if (!currentEmail && contacts[0]) {
      form.setValue('destinatario_email', contacts[0].email, {
        shouldDirty: false,
      });
      form.setValue('destinatario_nombre', contacts[0].nombre, {
        shouldDirty: false,
      });
    }
  }, [open, mode, contacts, form]);

  const handleOpenEmailComposer = (contact?: ContactOption) => {
    const target = contact ?? contacts[0];
    setSendError(null);
    form.reset({
      destinatario_email: target?.email ?? '',
      destinatario_nombre: target?.nombre ?? '',
      asunto: '',
      mensaje: '',
    });
    setMode('email');
  };

  const handleCopyEmail = async (email: string) => {
    try {
      await navigator.clipboard.writeText(email);
      setCopiedEmail(email);
      setTimeout(() => setCopiedEmail(null), 2000);
      toast({
        title: 'Correo copiado',
        description: email,
        variant: 'default',
      });
    } catch {
      toast({
        title: 'No se pudo copiar',
        description: 'Copia el correo manualmente desde la tarjeta.',
        variant: 'warning',
      });
    }
  };

  const handleSendEmail = form.handleSubmit(async (values) => {
    if (!tenant || sendingEmail) return;
    setSendingEmail(true);
    setSendError(null);

    try {
      const res = await fetch(`/api/admin/tenants/${tenant.id}/notificar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });

      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        delivered?: boolean;
        simulated?: boolean;
      };

      if (!res.ok) {
        const msg = body.error ?? 'No se pudo enviar el correo electrónico.';
        setSendError(msg);
        toast({
          title: 'Error al enviar correo',
          description: msg,
          variant: 'danger',
        });
        return;
      }

      toast({
        title: body.simulated
          ? 'Correo registrado (modo simulado)'
          : 'Correo enviado',
        description: body.simulated
          ? `Se simuló el envío a ${values.destinatario_email} porque SMTP no está configurado en este entorno.`
          : `Notificación enviada correctamente a ${values.destinatario_email}.`,
        variant: 'success',
      });

      form.reset({
        destinatario_email: values.destinatario_email,
        destinatario_nombre: values.destinatario_nombre ?? '',
        asunto: '',
        mensaje: '',
      });
      setMode('overview');
    } catch {
      const msg = 'No se pudo comunicar con el servidor.';
      setSendError(msg);
      toast({
        title: 'Error de conexión',
        description: msg,
        variant: 'danger',
      });
    } finally {
      setSendingEmail(false);
    }
  });

  const totalSucursales = data?.sucursales.length ?? 0;
  const sucursalesActivas =
    data?.sucursales.filter((s) => s.activa).length ?? 0;
  const totalRelojes =
    (data?.sucursales.reduce((acc, s) => acc + s.relojes.length, 0) ?? 0) +
    (data?.relojes_sin_sucursal.length ?? 0);
  const relojesActivos =
    (data?.sucursales.reduce(
      (acc, s) => acc + s.relojes.filter((r) => r.activo).length,
      0,
    ) ?? 0) +
    (data?.relojes_sin_sucursal.filter((r) => r.activo).length ?? 0);

  const zonaHoraria =
    data?.tenant.zona_horaria ?? tenant?.zona_horaria ?? 'America/Tijuana';

  const footer =
    mode === 'email' ? (
      <>
        <Button
          type="button"
          variant="secondary"
          onClick={() => setMode('overview')}
          disabled={sendingEmail}
        >
          <ArrowLeft className="size-4" strokeWidth={1.75} aria-hidden="true" />
          <span>Volver al detalle</span>
        </Button>
        <Button
          type="submit"
          form={emailFormId}
          disabled={sendingEmail || contacts.length === 0}
        >
          <Send className="size-4" strokeWidth={1.75} aria-hidden="true" />
          <span>{sendingEmail ? 'Enviando…' : 'Enviar correo'}</span>
        </Button>
      </>
    ) : (
      <>
        <Button
          type="button"
          variant="secondary"
          onClick={() => onOpenChange(false)}
        >
          Cerrar
        </Button>
        {contacts.length > 0 && (
          <Button
            type="button"
            onClick={() => handleOpenEmailComposer(contacts[0])}
          >
            <Mail className="size-4" strokeWidth={1.75} aria-hidden="true" />
            <span>Enviar correo</span>
          </Button>
        )}
      </>
    );

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={
        mode === 'email'
          ? `Enviar correo · ${tenant?.nombre_comercial ?? ''}`
          : `${tenant?.nombre_comercial ?? 'Detalle de empresa'}`
      }
      description={
        tenant
          ? `${tenant.tenant_code} · ${tenant.razon_social}`
          : 'Sucursales, relojes instalados y contactos de administración.'
      }
      footer={footer}
    >
      {isLoading ? (
        <div className="flex flex-col gap-[var(--s-3)] py-[var(--s-6)] text-sm text-[var(--text-2)]">
          Cargando sucursales, relojes y contactos…
        </div>
      ) : error ? (
        <div
          role="alert"
          className="rounded-[var(--r-md)] bg-[var(--danger-soft)] p-[var(--s-3)] text-sm text-[var(--danger)]"
        >
          {error instanceof Error
            ? error.message
            : 'No se pudo cargar la información de la empresa.'}
        </div>
      ) : mode === 'email' ? (
        <div className="flex flex-col gap-[var(--s-4)]">
          {contacts.length === 0 ? (
            <div className="rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface-2)] p-[var(--s-4)] text-sm text-[var(--text-2)]">
              Esta empresa no tiene administradores ni correos de contacto
              registrados. Agrega un contacto en la edición de la empresa para
              poder enviar notificaciones.
            </div>
          ) : (
            <Form {...form}>
              <form
                id={emailFormId}
                noValidate
                onSubmit={handleSendEmail}
                className="flex flex-col gap-[var(--s-4)]"
              >
                <FormField
                  control={form.control}
                  name="destinatario_email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Destinatario</FormLabel>
                      <FormControl>
                        <select
                          className="ios-input"
                          value={field.value}
                          onChange={(event) => {
                            const selectedEmail = event.target.value;
                            field.onChange(selectedEmail);
                            const matched = contacts.find(
                              (c) => c.email === selectedEmail,
                            );
                            form.setValue(
                              'destinatario_nombre',
                              matched?.nombre ?? '',
                              { shouldDirty: false },
                            );
                          }}
                          onBlur={field.onBlur}
                        >
                          {contacts.map((contact) => (
                            <option key={contact.key} value={contact.email}>
                              {contact.nombre} ({contact.etiqueta}) —{' '}
                              {contact.email}
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
                  name="asunto"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Asunto</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="Ej. Seguimiento de conectividad de relojes checadores"
                          maxLength={160}
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
                      <FormLabel>Mensaje</FormLabel>
                      <FormControl>
                        <textarea
                          {...field}
                          rows={6}
                          maxLength={4000}
                          placeholder="Escribe el aviso o notificación para el administrador de la empresa…"
                          className="ios-input min-h-[140px] resize-y py-[var(--s-2)]"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {sendError && (
                  <div
                    role="alert"
                    className="rounded-[var(--r-md)] bg-[var(--danger-soft)] px-[var(--s-3)] py-[var(--s-2)] text-xs font-medium text-[var(--danger)]"
                  >
                    {sendError}
                  </div>
                )}
              </form>
            </Form>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-[var(--s-5)]">
          {/* KPIs resumen */}
          <div className="grid grid-cols-3 gap-[var(--s-2)]">
            <div className="flex flex-col gap-[var(--s-1)] rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface-2)] p-[var(--s-3)]">
              <span className="text-xs text-[var(--text-2)]">Sucursales</span>
              <span className="text-lg font-semibold text-[var(--text)]">
                {sucursalesActivas}
                <span className="text-xs font-normal text-[var(--text-2)]">
                  {' '}
                  / {totalSucursales}
                </span>
              </span>
            </div>
            <div className="flex flex-col gap-[var(--s-1)] rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface-2)] p-[var(--s-3)]">
              <span className="text-xs text-[var(--text-2)]">Relojes</span>
              <span className="text-lg font-semibold text-[var(--text)]">
                {relojesActivos}
                <span className="text-xs font-normal text-[var(--text-2)]">
                  {' '}
                  / {totalRelojes}
                </span>
              </span>
            </div>
            <div className="flex flex-col gap-[var(--s-1)] rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface-2)] p-[var(--s-3)]">
              <span className="text-xs text-[var(--text-2)]">Contactos</span>
              <span className="text-lg font-semibold text-[var(--text)]">
                {contacts.length}
              </span>
            </div>
          </div>

          {/* Sección 1: Administradores y contactos */}
          <section className="flex flex-col gap-[var(--s-3)]">
            <div className="flex items-center justify-between gap-[var(--s-2)]">
              <div className="flex items-center gap-[var(--s-2)]">
                <Users
                  className="size-4 text-[var(--accent)]"
                  strokeWidth={1.75}
                  aria-hidden="true"
                />
                <h3 className="text-sm font-semibold text-[var(--text)]">
                  Administradores y contactos
                </h3>
              </div>
              <Badge variant="default">{contacts.length}</Badge>
            </div>

            {contacts.length === 0 ? (
              <div className="rounded-[var(--r-md)] border border-dashed border-[var(--border)] p-[var(--s-4)] text-xs text-[var(--text-2)]">
                No hay administradores ni correos de contacto registrados para
                esta empresa.
              </div>
            ) : (
              <div className="flex flex-col gap-[var(--s-2)]">
                {contacts.map((contact) => (
                  <div
                    key={contact.key}
                    className="flex flex-col gap-[var(--s-2)] rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--s-3)]"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-[var(--s-2)]">
                      <div className="flex flex-col gap-[var(--s-1)]">
                        <div className="flex flex-wrap items-center gap-[var(--s-2)]">
                          <span className="text-sm font-semibold text-[var(--text)]">
                            {contact.nombre}
                          </span>
                          <Badge variant="accent">
                            {contact.etiqueta === 'Admin Empresa' && (
                              <ShieldCheck
                                className="mr-[var(--s-1)] size-3"
                                strokeWidth={1.75}
                                aria-hidden="true"
                              />
                            )}
                            <span>{contact.etiqueta}</span>
                          </Badge>
                          {contact.activo === false && (
                            <Badge variant="danger">Inactivo</Badge>
                          )}
                        </div>
                        <span className="font-mono text-xs text-[var(--text-2)]">
                          {contact.email}
                        </span>
                        {contact.telefono && (
                          <span className="inline-flex items-center gap-[var(--s-1)] text-xs text-[var(--text-2)]">
                            <Phone
                              className="size-3"
                              strokeWidth={1.75}
                              aria-hidden="true"
                            />
                            {contact.telefono}
                          </span>
                        )}
                        {contact.ultimoAccesoEn && (
                          <span className="text-xs text-[var(--text-2)]">
                            Último acceso:{' '}
                            {formatFechaHoraMx(
                              contact.ultimoAccesoEn,
                              zonaHoraria,
                            )}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-[var(--s-1)]">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => void handleCopyEmail(contact.email)}
                          aria-label={`Copiar correo de ${contact.nombre}`}
                        >
                          {copiedEmail === contact.email ? (
                            <Check
                              className="size-3.5 text-[var(--success)]"
                              strokeWidth={2}
                              aria-hidden="true"
                            />
                          ) : (
                            <Copy
                              className="size-3.5"
                              strokeWidth={1.75}
                              aria-hidden="true"
                            />
                          )}
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => handleOpenEmailComposer(contact)}
                        >
                          <Mail
                            className="size-3.5"
                            strokeWidth={1.75}
                            aria-hidden="true"
                          />
                          <span>Correo</span>
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Sección 2: Sucursales y relojes instalados */}
          <section className="flex flex-col gap-[var(--s-3)]">
            <div className="flex items-center justify-between gap-[var(--s-2)]">
              <div className="flex items-center gap-[var(--s-2)]">
                <Building2
                  className="size-4 text-[var(--accent)]"
                  strokeWidth={1.75}
                  aria-hidden="true"
                />
                <h3 className="text-sm font-semibold text-[var(--text)]">
                  Sucursales y relojes instalados
                </h3>
              </div>
              <Badge variant="default">
                {totalSucursales} suc · {totalRelojes} rel
              </Badge>
            </div>

            {totalSucursales === 0 &&
            (data?.relojes_sin_sucursal.length ?? 0) === 0 ? (
              <div className="rounded-[var(--r-md)] border border-dashed border-[var(--border)] p-[var(--s-4)] text-xs text-[var(--text-2)]">
                Esta empresa aún no tiene sucursales ni relojes checadores
                registrados.
              </div>
            ) : (
              <div className="flex flex-col gap-[var(--s-3)]">
                {data?.sucursales.map((sucursal) => (
                  <div
                    key={sucursal.id}
                    className="flex flex-col gap-[var(--s-3)] rounded-[var(--r-lg)] border border-[var(--border)] bg-[var(--surface)] p-[var(--s-3)]"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-[var(--s-2)]">
                      <div className="flex flex-col gap-[var(--s-1)]">
                        <div className="flex flex-wrap items-center gap-[var(--s-2)]">
                          <code className="rounded-[var(--r-sm)] bg-[var(--surface-2)] px-[var(--s-2)] py-[var(--s-1)] text-xs font-semibold text-[var(--text)]">
                            {sucursal.clave}
                          </code>
                          <span className="text-sm font-semibold text-[var(--text)]">
                            {sucursal.nombre}
                          </span>
                        </div>
                        {sucursal.direccion && (
                          <span className="inline-flex items-center gap-[var(--s-1)] text-xs text-[var(--text-2)]">
                            <MapPin
                              className="size-3.5 shrink-0"
                              strokeWidth={1.75}
                              aria-hidden="true"
                            />
                            {sucursal.direccion}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-[var(--s-1)]">
                        <Badge variant={sucursal.activa ? 'success' : 'default'}>
                          {sucursal.activa ? 'Activa' : 'Inactiva'}
                        </Badge>
                        <Badge variant="default">
                          {sucursal.relojes.length}{' '}
                          {sucursal.relojes.length === 1 ? 'reloj' : 'relojes'}
                        </Badge>
                      </div>
                    </div>

                    {sucursal.relojes.length === 0 ? (
                      <p className="rounded-[var(--r-sm)] bg-[var(--surface-2)] px-[var(--s-3)] py-[var(--s-2)] text-xs text-[var(--text-2)]">
                        Sin relojes instalados en esta sucursal.
                      </p>
                    ) : (
                      <div className="flex flex-col gap-[var(--s-2)]">
                        {sucursal.relojes.map((reloj) => (
                          <RelojCard
                            key={reloj.id}
                            reloj={reloj}
                            zonaHoraria={zonaHoraria}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                ))}

                {(data?.relojes_sin_sucursal.length ?? 0) > 0 && (
                  <div className="flex flex-col gap-[var(--s-2)] rounded-[var(--r-lg)] border border-[var(--border)] bg-[var(--surface)] p-[var(--s-3)]">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-[var(--text)]">
                        Relojes sin sucursal asignada
                      </span>
                      <Badge variant="warning">
                        {data?.relojes_sin_sucursal.length}
                      </Badge>
                    </div>
                    <div className="flex flex-col gap-[var(--s-2)]">
                      {data?.relojes_sin_sucursal.map((reloj) => (
                        <RelojCard
                          key={reloj.id}
                          reloj={reloj}
                          zonaHoraria={zonaHoraria}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      )}
    </Sheet>
  );
}
