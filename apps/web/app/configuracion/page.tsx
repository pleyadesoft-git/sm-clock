'use client';

import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Eye,
  EyeOff,
  Lock,
  Mail,
  Save,
  Server,
  ShieldCheck,
} from 'lucide-react';
import {
  SmtpConfigUpsertSchema,
  type SmtpSecurity,
} from '@sm-clock/contracts';
import { AppShell } from '@/components/layout/app-shell';
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
import { useToast } from '@/components/ui/toast';

interface SmtpConfigResponse {
  data: {
    tenant_id: string;
    usar_smtp_propio: boolean;
    host: string;
    puerto: number;
    seguridad: SmtpSecurity;
    usuario: string | null;
    remitente_email: string | null;
    remitente_nombre: string;
    tiene_password: boolean;
    ultima_prueba_exitosa_en?: string | null;
    ultimo_error_prueba?: string | null;
  };
}

export default function ConfiguracionPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [usarSmtpPropio, setUsarSmtpPropio] = React.useState(false);
  const [host, setHost] = React.useState('smtp.gmail.com');
  const [puerto, setPuerto] = React.useState('465');
  const [seguridad, setSeguridad] = React.useState<SmtpSecurity>('TLS');
  const [usuario, setUsuario] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [showPassword, setShowPassword] = React.useState(false);
  const [remitenteEmail, setRemitenteEmail] = React.useState('');
  const [remitenteNombre, setRemitenteNombre] = React.useState(
    'SM Clock · Google SMTP',
  );
  const [tienePasswordGuardado, setTienePasswordGuardado] =
    React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const { data, isLoading } = useQuery<SmtpConfigResponse>({
    queryKey: ['configuracion-smtp'],
    queryFn: async () => {
      const res = await fetch('/api/configuracion/smtp');
      if (!res.ok) {
        throw new Error('Error al cargar configuración SMTP');
      }
      return (await res.json()) as SmtpConfigResponse;
    },
  });

  React.useEffect(() => {
    if (data?.data) {
      const cfg = data.data;
      setUsarSmtpPropio(cfg.usar_smtp_propio);
      setHost(cfg.host || 'smtp.gmail.com');
      setPuerto(String(cfg.puerto || 465));
      setSeguridad(cfg.seguridad || 'TLS');
      setUsuario(cfg.usuario ?? '');
      setRemitenteEmail(cfg.remitente_email ?? '');
      setRemitenteNombre(cfg.remitente_nombre || 'SM Clock · Google SMTP');
      setTienePasswordGuardado(cfg.tiene_password);
      setPassword('');
    }
  }, [data]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const parsed = SmtpConfigUpsertSchema.safeParse({
      usar_smtp_propio: usarSmtpPropio,
      host,
      puerto: Number(puerto),
      seguridad,
      usuario: usuario.trim() || null,
      password: password.trim() || undefined,
      remitente_email: remitenteEmail.trim() || null,
      remitente_nombre: remitenteNombre.trim(),
    });

    if (!parsed.success) {
      toast({
        title: 'Revisa los campos de configuración SMTP',
        description:
          parsed.error.issues[0]?.message ?? 'Datos de servidor SMTP inválidos',
        variant: 'danger',
      });
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/configuracion/smtp', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });

      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast({
          title: 'Error al guardar configuración SMTP',
          description: body.error ?? 'No fue posible actualizar los ajustes.',
          variant: 'danger',
        });
        return;
      }

      setPassword('');
      await queryClient.invalidateQueries({ queryKey: ['configuracion-smtp'] });
      toast({
        title: 'Configuración SMTP guardada',
        description: usarSmtpPropio
          ? 'Se utilizará el servidor SMTP personalizado de tu empresa para invitaciones y recuperación de contraseñas.'
          : 'Se utilizará Google SMTP por defecto para el envío de invitaciones.',
        variant: 'success',
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell
      title="Configuración de la Empresa"
      subtitle="Ajustes de servidor de correo SMTP para envío de invitaciones y recuperación de contraseñas (Exclusivo Admin)"
      mode="client"
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-[var(--s-6)]">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-[var(--s-3)]">
              <div className="flex items-center gap-[var(--s-3)]">
                <div className="flex size-10 items-center justify-center rounded-[var(--r-md)] bg-[var(--accent)] text-[var(--text-on-accent)]">
                  <Mail className="size-5" strokeWidth={1.75} aria-hidden="true" />
                </div>
                <div>
                  <CardTitle>Servidor de Correo saliente (SMTP)</CardTitle>
                  <CardDescription>
                    Este servidor se utiliza para enviar invitaciones a nuevos usuarios (Admin u Operador) y enlaces de restablecimiento de contraseña.
                  </CardDescription>
                </div>
              </div>
              <Badge variant={usarSmtpPropio ? 'accent' : 'success'}>
                {usarSmtpPropio
                  ? 'SMTP Propio del Cliente'
                  : 'Google SMTP (Por defecto)'}
              </Badge>
            </div>
          </CardHeader>

          <CardContent>
            {isLoading ? (
              <div
                role="status"
                aria-live="polite"
                className="py-[var(--s-6)] text-sm font-medium text-[var(--text-2)]"
              >
                Cargando configuración SMTP…
              </div>
            ) : (
              <form
                onSubmit={(e) => void handleSubmit(e)}
                className="flex flex-col gap-[var(--s-5)]"
              >
                <div className="flex flex-col gap-[var(--s-2)]">
                  <span className="ios-label">Modo de envío de correo</span>
                  <SegmentedControl
                    ariaLabel="Seleccionar proveedor SMTP"
                    value={usarSmtpPropio ? 'PROPIO' : 'GOOGLE_DEFAULT'}
                    onChange={(val) =>
                      setUsarSmtpPropio(val === 'PROPIO')
                    }
                    options={[
                      {
                        value: 'GOOGLE_DEFAULT',
                        label: 'Google SMTP (Por defecto)',
                      },
                      {
                        value: 'PROPIO',
                        label: 'SMTP Propio de la Empresa',
                      },
                    ]}
                  />
                </div>

                <div className="flex flex-col gap-[var(--s-1)]">
                  <label htmlFor="smtp-remitente-nombre" className="ios-label">
                    Nombre visible del remitente en los correos de invitación
                  </label>
                  <Input
                    id="smtp-remitente-nombre"
                    name="remitente_nombre"
                    required
                    placeholder="Recursos Humanos · Maquiladora del Pacífico"
                    value={remitenteNombre}
                    onChange={(e) => setRemitenteNombre(e.target.value)}
                  />
                </div>

                {!usarSmtpPropio ? (
                  <div className="flex items-start gap-[var(--s-3)] rounded-[var(--r-md)] border border-[var(--separator)] bg-[var(--surface-2)] p-[var(--s-4)]">
                    <ShieldCheck
                      className="mt-0.5 size-5 shrink-0 text-[var(--success)]"
                      aria-hidden="true"
                    />
                    <div className="flex flex-col gap-[var(--s-1)] text-sm">
                      <span className="font-semibold text-[var(--text)]">
                        Gestionado automáticamente por Google SMTP (`smtp.gmail.com`)
                      </span>
                      <span className="text-xs text-[var(--text-2)]">
                        Las invitaciones a usuarios Administradores y Operadores, así como los correos de recuperación de contraseña, se envían utilizando el canal seguro de Google SMTP por defecto. Si deseas emplear una cuenta corporativa propia, cambia a &ldquo;SMTP Propio de la Empresa&rdquo;.
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-[var(--s-4)] rounded-[var(--r-md)] border border-[var(--separator)] bg-[var(--surface-2)] p-[var(--s-4)]">
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center gap-[var(--s-2)] text-sm font-bold text-[var(--text)]">
                        <Server className="size-4 text-[var(--accent)]" aria-hidden="true" />
                        <span>Parámetros del Servidor SMTP del Cliente</span>
                      </span>
                      {tienePasswordGuardado ? (
                        <Badge variant="success">
                          Contraseña cifrada (AES-256-GCM)
                        </Badge>
                      ) : null}
                    </div>

                    <div className="grid grid-cols-1 gap-[var(--s-4)] md:grid-cols-3">
                      <div className="flex flex-col gap-[var(--s-1)] md:col-span-2">
                        <label htmlFor="smtp-host" className="ios-label">
                          Servidor SMTP (Host)
                        </label>
                        <Input
                          id="smtp-host"
                          name="host"
                          spellCheck={false}
                          required
                          placeholder="smtp.gmail.com"
                          value={host}
                          onChange={(e) => setHost(e.target.value)}
                        />
                      </div>

                      <div className="flex flex-col gap-[var(--s-1)]">
                        <label htmlFor="smtp-puerto" className="ios-label">
                          Puerto
                        </label>
                        <Input
                          id="smtp-puerto"
                          name="puerto"
                          type="text"
                          inputMode="numeric"
                          pattern="\d+"
                          required
                          placeholder="465"
                          value={puerto}
                          onChange={(e) => setPuerto(e.target.value)}
                        />
                      </div>
                    </div>

                    <fieldset className="flex flex-col gap-[var(--s-2)]">
                      <legend className="ios-label mb-[var(--s-1)]">
                        Seguridad de transporte
                      </legend>
                      <div className="flex flex-wrap gap-[var(--s-4)]">
                        {(['TLS', 'STARTTLS', 'NONE'] as const).map((sec) => (
                          <div
                            key={sec}
                            className="flex items-center gap-[var(--s-2)]"
                          >
                            <input
                              type="radio"
                              id={`smtp-sec-${sec}`}
                              name="seguridad"
                              value={sec}
                              checked={seguridad === sec}
                              onChange={() => setSeguridad(sec)}
                              className="accent-[var(--accent)]"
                            />
                            <label
                              htmlFor={`smtp-sec-${sec}`}
                              className="text-sm font-medium text-[var(--text)]"
                            >
                              {sec === 'TLS'
                                ? 'SSL / TLS (Puerto 465)'
                                : sec === 'STARTTLS'
                                  ? 'STARTTLS (Puerto 587)'
                                  : 'Sin cifrado'}
                            </label>
                          </div>
                        ))}
                      </div>
                    </fieldset>

                    <div className="grid grid-cols-1 gap-[var(--s-4)] md:grid-cols-2">
                      <div className="flex flex-col gap-[var(--s-1)]">
                        <label htmlFor="smtp-usuario" className="ios-label">
                          Usuario SMTP
                        </label>
                        <Input
                          id="smtp-usuario"
                          name="usuario"
                          type="email"
                          spellCheck={false}
                          required={usarSmtpPropio}
                          placeholder="notificaciones@tuempresa.mx"
                          value={usuario}
                          onChange={(e) => setUsuario(e.target.value)}
                        />
                      </div>

                      <div className="flex flex-col gap-[var(--s-1)]">
                        <label
                          htmlFor="smtp-remitente-email"
                          className="ios-label"
                        >
                          Correo remitente (From)
                        </label>
                        <Input
                          id="smtp-remitente-email"
                          name="remitente_email"
                          type="email"
                          spellCheck={false}
                          required={usarSmtpPropio}
                          placeholder="notificaciones@tuempresa.mx"
                          value={remitenteEmail}
                          onChange={(e) => setRemitenteEmail(e.target.value)}
                        />
                      </div>
                    </div>

                    <div className="flex flex-col gap-[var(--s-1)]">
                      <div className="flex items-center justify-between">
                        <label htmlFor="smtp-password" className="ios-label">
                          Contraseña SMTP / Google App Password
                        </label>
                        <button
                          type="button"
                          onClick={() => setShowPassword((prev) => !prev)}
                          aria-pressed={showPassword}
                          className="inline-flex items-center gap-[var(--s-1)] text-xs font-semibold text-[var(--accent)] cursor-pointer"
                        >
                          {showPassword ? (
                            <>
                              <EyeOff className="size-3.5" aria-hidden="true" />
                              <span>Ocultar</span>
                            </>
                          ) : (
                            <>
                              <Eye className="size-3.5" aria-hidden="true" />
                              <span>Mostrar</span>
                            </>
                          )}
                        </button>
                      </div>
                      <Input
                        id="smtp-password"
                        name="password"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        required={usarSmtpPropio && !tienePasswordGuardado}
                        placeholder={
                          tienePasswordGuardado
                            ? '•••••••••••••••• (Dejar en blanco para conservar la actual)'
                            : 'Ingresa la contraseña o App Password de 16 caracteres'
                        }
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                      <span className="inline-flex items-center gap-[var(--s-1)] text-xs text-[var(--text-2)]">
                        <Lock className="size-3" aria-hidden="true" />
                        <span>
                          Se almacena cifrada con AES-256-GCM en la bóveda `credenciales` y jamás se expone al navegador.
                        </span>
                      </span>
                    </div>
                  </div>
                )}

                <div className="flex justify-end pt-[var(--s-2)]">
                  <Button type="submit" disabled={saving}>
                    <Save className="size-4" aria-hidden="true" />
                    <span>
                      {saving
                        ? 'Guardando configuración…'
                        : 'Guardar configuración SMTP'}
                    </span>
                  </Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
