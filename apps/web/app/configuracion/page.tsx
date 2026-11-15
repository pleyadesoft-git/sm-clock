'use client';

import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ExternalLink,
  Eye,
  EyeOff,
  Lock,
  Mail,
  Save,
  Send,
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
  const [destinatarioPrueba, setDestinatarioPrueba] = React.useState('');
  const [testing, setTesting] = React.useState(false);

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
      if (cfg.usuario && !destinatarioPrueba) {
        setDestinatarioPrueba(cfg.usuario);
      }
    }
  }, [data]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const cleanPassword = password.trim().replace(/\s+/g, '');

    if (!usarSmtpPropio) {
      if (!usuario.trim()) {
        toast({
          title: 'Falta la cuenta de Google',
          description:
            'Debes ingresar la cuenta de Google (Gmail o Google Workspace) que autoriza el envío.',
          variant: 'danger',
        });
        return;
      }
      if (!tienePasswordGuardado && !cleanPassword) {
        toast({
          title: 'Falta la App Password de Google',
          description:
            'Debes ingresar la llave App Password de 16 caracteres generada en tu cuenta de Google.',
          variant: 'danger',
        });
        return;
      }
    } else {
      if (!tienePasswordGuardado && !cleanPassword) {
        toast({
          title: 'Falta la contraseña SMTP',
          description:
            'Debes proporcionar la contraseña del servidor SMTP propio.',
          variant: 'danger',
        });
        return;
      }
    }

    const parsed = SmtpConfigUpsertSchema.safeParse({
      usar_smtp_propio: usarSmtpPropio,
      host: usarSmtpPropio ? host : 'smtp.gmail.com',
      puerto: usarSmtpPropio ? Number(puerto) : 465,
      seguridad: usarSmtpPropio ? seguridad : 'TLS',
      usuario: usuario.trim() || null,
      password: cleanPassword || undefined,
      remitente_email:
        (usarSmtpPropio
          ? remitenteEmail.trim()
          : remitenteEmail.trim() || usuario.trim()) || null,
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
          : 'Se guardó la llave App Password y la cuenta de Google SMTP para el envío seguro de correos.',
        variant: 'success',
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleTestSend() {
    const destino = destinatarioPrueba.trim() || usuario.trim();
    if (!destino) {
      toast({
        title: 'Ingresa un correo destinatario',
        description:
          'Especifica el correo donde deseas recibir el mensaje de prueba.',
        variant: 'danger',
      });
      return;
    }

    const cleanPassword = password.trim().replace(/\s+/g, '');

    setTesting(true);
    try {
      const res = await fetch('/api/configuracion/smtp/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          usar_smtp_propio: usarSmtpPropio,
          host: usarSmtpPropio ? host : 'smtp.gmail.com',
          puerto: usarSmtpPropio ? Number(puerto) : 465,
          seguridad: usarSmtpPropio ? seguridad : 'TLS',
          usuario: usuario.trim() || undefined,
          password: cleanPassword || undefined,
          remitente_email:
            (usarSmtpPropio
              ? remitenteEmail.trim()
              : remitenteEmail.trim() || usuario.trim()) || undefined,
          remitente_nombre: remitenteNombre.trim(),
          destinatario_prueba: destino,
        }),
      });

      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast({
          title: 'Falló la prueba SMTP',
          description:
            body.error ?? 'No fue posible conectar con el servidor de correo.',
          variant: 'danger',
        });
        return;
      }

      toast({
        title: 'Correo de prueba enviado',
        description: `Se envió con éxito a ${destino}. Verifica tu bandeja de entrada.`,
        variant: 'success',
      });
      await queryClient.invalidateQueries({ queryKey: ['configuracion-smtp'] });
    } catch {
      toast({
        title: 'Error de conexión',
        description: 'No fue posible comunicarse con el servicio de correo.',
        variant: 'danger',
      });
    } finally {
      setTesting(false);
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
                noValidate
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
                    placeholder="Recursos Humanos · Maquiladora del Pacífico"
                    value={remitenteNombre}
                    onChange={(e) => setRemitenteNombre(e.target.value)}
                  />
                </div>

                {!usarSmtpPropio ? (
                  <div className="flex flex-col gap-[var(--s-4)] rounded-[var(--r-md)] border border-[var(--separator)] bg-[var(--surface-2)] p-[var(--s-4)]">
                    <div className="flex flex-wrap items-center justify-between gap-[var(--s-2)]">
                      <span className="inline-flex items-center gap-[var(--s-2)] text-sm font-bold text-[var(--text)]">
                        <ShieldCheck
                          className="size-4 text-[var(--accent)]"
                          aria-hidden="true"
                        />
                        <span>Google SMTP (Gmail / Google Workspace)</span>
                      </span>
                      {tienePasswordGuardado ? (
                        <Badge variant="success">
                          App Password guardada (AES-256-GCM)
                        </Badge>
                      ) : (
                        <Badge variant="warning">
                          Requiere App Password
                        </Badge>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-[var(--s-2)] text-xs text-[var(--text-2)]">
                      <span className="inline-flex items-center gap-[var(--s-1)] rounded-[var(--r-sm)] border border-[var(--separator)] bg-[var(--surface)] px-[var(--s-2)] py-[var(--s-1)] font-mono font-medium">
                        Servidor: smtp.gmail.com
                      </span>
                      <span className="inline-flex items-center gap-[var(--s-1)] rounded-[var(--r-sm)] border border-[var(--separator)] bg-[var(--surface)] px-[var(--s-2)] py-[var(--s-1)] font-mono font-medium">
                        Puerto: 465 (SSL / TLS)
                      </span>
                    </div>

                    {/* Guía paso a paso para generar la App Password en Google */}
                    <div className="flex flex-col gap-[var(--s-2)] rounded-[var(--r-sm)] border border-[var(--separator)] bg-[var(--surface)] p-[var(--s-3)] text-xs text-[var(--text-2)]">
                      <div className="flex items-center justify-between gap-[var(--s-2)]">
                        <span className="font-semibold text-[var(--text)]">
                          ¿Cómo obtener la App Password en Google?
                        </span>
                        <a
                          href="https://myaccount.google.com/apppasswords"
                          target="_blank"
                          rel="noreferrer noopener"
                          className="inline-flex items-center gap-[var(--s-1)] font-semibold text-[var(--accent)] hover:underline"
                        >
                          <span>Abrir Google App Passwords</span>
                          <ExternalLink className="size-3" aria-hidden="true" />
                        </a>
                      </div>
                      <ol className="list-inside list-decimal space-y-1 text-[var(--text-2)]">
                        <li>
                          Asegúrate de tener activa la <strong>Verificación en 2 pasos</strong> en tu cuenta de Google.
                        </li>
                        <li>
                          Ingresa a <strong>Seguridad &gt; Contraseñas de aplicaciones</strong> (o usa el enlace directo).
                        </li>
                        <li>
                          En el nombre de la app escribe <code>SM Clock</code> y pulsa <strong>Crear</strong>.
                        </li>
                        <li>
                          Copia la clave de 16 caracteres generada (los espacios se omiten automáticamente) y pégala a continuación.
                        </li>
                      </ol>
                    </div>

                    <div className="flex flex-col gap-[var(--s-1)]">
                      <label htmlFor="google-smtp-usuario" className="ios-label">
                        Cuenta de Google / Correo remitente (Gmail o Google Workspace)
                      </label>
                      <Input
                        id="google-smtp-usuario"
                        name="usuario"
                        type="email"
                        spellCheck={false}
                        placeholder="notificaciones@tuempresa.mx o tuempresa@gmail.com"
                        value={usuario}
                        onChange={(e) => {
                          const val = e.target.value;
                          setUsuario(val);
                          setRemitenteEmail(val);
                        }}
                      />
                      <span className="text-xs text-[var(--text-2)]">
                        Dirección de correo de Google que autenticará el envío de invitaciones y notificaciones ante Google SMTP.
                      </span>
                    </div>

                    <div className="flex flex-col gap-[var(--s-1)]">
                      <div className="flex items-center justify-between">
                        <label
                          htmlFor="google-smtp-password"
                          className="ios-label"
                        >
                          Google App Password (Llave de 16 caracteres)
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
                        id="google-smtp-password"
                        name="password"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        spellCheck={false}
                        placeholder={
                          tienePasswordGuardado
                            ? '•••••••••••••••• (App Password guardada — dejar en blanco para conservar)'
                            : 'ej. abcd efgh ijkl mnop'
                        }
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                      <span className="inline-flex items-center gap-[var(--s-1)] text-xs text-[var(--text-2)]">
                        <Lock className="size-3" aria-hidden="true" />
                        <span>
                          Tu llave App Password se almacena cifrada con AES-256-GCM en la bóveda de credenciales y jamás se expone al cliente.
                        </span>
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

                {/* Sección de prueba SMTP */}
                <div className="rounded-[var(--r-md)] border border-[var(--separator)] bg-[var(--surface-2)] p-[var(--s-4)]">
                  <div className="flex flex-col gap-[var(--s-3)]">
                    <div>
                      <span className="text-sm font-semibold text-[var(--text)]">
                        Probar conexión de correo
                      </span>
                      <p className="text-xs text-[var(--text-2)]">
                        Envía un correo de prueba para verificar que la configuración y las credenciales funcionen correctamente.
                      </p>
                    </div>

                    <div className="flex flex-col gap-[var(--s-2)] sm:flex-row">
                      <Input
                        type="email"
                        spellCheck={false}
                        placeholder="tu-correo@empresa.com"
                        value={destinatarioPrueba}
                        onChange={(e) => setDestinatarioPrueba(e.target.value)}
                        className="flex-1"
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => void handleTestSend()}
                        disabled={testing || saving}
                      >
                        <Send className="size-4" aria-hidden="true" />
                        <span>
                          {testing ? 'Enviando prueba…' : 'Enviar prueba'}
                        </span>
                      </Button>
                    </div>

                    {data?.data?.ultima_prueba_exitosa_en ? (
                      <span className="text-xs text-[var(--success)]">
                        Última prueba exitosa:{' '}
                        {new Date(
                          data.data.ultima_prueba_exitosa_en,
                        ).toLocaleString('es-MX', {
                          timeZone: 'America/Tijuana',
                        })}
                      </span>
                    ) : null}
                    {data?.data?.ultimo_error_prueba ? (
                      <span className="text-xs text-[var(--danger)]">
                        Último error reportado: {data.data.ultimo_error_prueba}
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="flex justify-end pt-[var(--s-2)]">
                  <Button type="submit" disabled={saving || testing}>
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
