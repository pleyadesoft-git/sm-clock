import 'server-only';
import * as net from 'node:net';
import * as tls from 'node:tls';
import type { SmtpSecurity, TenantUserRole } from '@sm-clock/contracts';
import { decryptCredentialSecret } from '@/lib/server/crypto';
import { createSupabaseServiceClient } from '@/lib/server/supabase-admin';

export interface ResolvedSmtpConfig {
  provider: 'GOOGLE_DEFAULT' | 'CUSTOM_TENANT';
  host: string;
  port: number;
  security: SmtpSecurity;
  user: string | null;
  pass: string | null;
  fromEmail: string;
  fromName: string;
}

export interface SendEmailResult {
  delivered: boolean;
  simulated: boolean;
  provider: 'GOOGLE_DEFAULT' | 'CUSTOM_TENANT';
  error?: string;
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function getMasterKeyHex(): string {
  return (
    process.env['CREDENTIALS_MASTER_KEY_HEX'] ??
    '0000000000000000000000000000000000000000000000000000000000000000'
  );
}

/**
 * Resuelve la configuración SMTP del tenant.
 * Por defecto utiliza Google SMTP gestionado por la plataforma (`smtp.gmail.com`),
 * salvo que el tenant tenga `usar_smtp_propio = true` y credencial cifrada en `public.credenciales`.
 */
export async function resolveTenantSmtpConfig(
  tenantId: string | null,
): Promise<ResolvedSmtpConfig> {
  const defaultHost = process.env['SMTP_HOST'] ?? 'smtp.gmail.com';
  const defaultPort = Number(process.env['SMTP_PORT'] ?? '465');
  const rawSec = process.env['SMTP_SECURE'] ?? 'TLS';
  const defaultSecurity: SmtpSecurity =
    rawSec === 'STARTTLS' || rawSec === 'NONE' ? rawSec : 'TLS';
  const defaultUser = process.env['SMTP_USER'] ?? null;
  const defaultPass = process.env['SMTP_PASS'] ?? null;
  const defaultFromEmail =
    process.env['SMTP_FROM_EMAIL'] ?? 'notificaciones@smclock.mx';
  const defaultFromName =
    process.env['SMTP_FROM_NAME'] ?? 'SM Clock · Google SMTP';

  if (!tenantId) {
    return {
      provider: 'GOOGLE_DEFAULT',
      host: defaultHost,
      port: defaultPort,
      security: defaultSecurity,
      user: defaultUser,
      pass: defaultPass,
      fromEmail: defaultFromEmail,
      fromName: defaultFromName,
    };
  }

  const adminClient = createSupabaseServiceClient();
  const { data: smtpRow } = await adminClient
    .from('configuracion_smtp')
    .select(
      'id, usar_smtp_propio, host, puerto, seguridad, usuario, remitente_email, remitente_nombre, activo, tiene_password',
    )
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (!smtpRow || !smtpRow.activo) {
    return {
      provider: 'GOOGLE_DEFAULT',
      host: defaultHost,
      port: defaultPort,
      security: defaultSecurity,
      user: defaultUser,
      pass: defaultPass,
      fromEmail: defaultFromEmail,
      fromName: defaultFromName,
    };
  }

  let decryptedPass: string | null = null;
  const { data: cred } = await adminClient
    .from('credenciales')
    .select('ciphertext, nonce, key_version')
    .eq('tenant_id', tenantId)
    .eq('tipo', 'SMTP')
    .eq('referencia_id', smtpRow.id)
    .maybeSingle();

  if (cred) {
    try {
      decryptedPass = decryptCredentialSecret({
        ciphertextHex: cred.ciphertext,
        nonceHex: cred.nonce,
        tenantId,
        masterKeyHex: getMasterKeyHex(),
        keyVersion: cred.key_version,
      });
    } catch {
      decryptedPass = null;
    }
  }

  if (smtpRow.usar_smtp_propio) {
    if (!smtpRow.usuario || !smtpRow.remitente_email) {
      return {
        provider: 'GOOGLE_DEFAULT',
        host: defaultHost,
        port: defaultPort,
        security: defaultSecurity,
        user: defaultUser,
        pass: defaultPass,
        fromEmail: defaultFromEmail,
        fromName: smtpRow.remitente_nombre ?? defaultFromName,
      };
    }

    const sec: SmtpSecurity =
      smtpRow.seguridad === 'STARTTLS' || smtpRow.seguridad === 'NONE'
        ? smtpRow.seguridad
        : 'TLS';

    return {
      provider: 'CUSTOM_TENANT',
      host: smtpRow.host,
      port: smtpRow.puerto,
      security: sec,
      user: smtpRow.usuario,
      pass: decryptedPass,
      fromEmail: smtpRow.remitente_email,
      fromName: smtpRow.remitente_nombre,
    };
  }

  // Google SMTP (Por defecto) autenticado con cuenta de Google y App Password del tenant
  return {
    provider: 'GOOGLE_DEFAULT',
    host: 'smtp.gmail.com',
    port: 465,
    security: 'TLS',
    user: smtpRow.usuario ?? defaultUser,
    pass: decryptedPass ?? defaultPass,
    fromEmail:
      smtpRow.remitente_email ?? smtpRow.usuario ?? defaultFromEmail,
    fromName: smtpRow.remitente_nombre ?? defaultFromName,
  };
}

function sendRawSmtpCommand(
  socket: net.Socket | tls.TLSSocket,
  command: string | null,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split(/\r?\n/).filter(Boolean);
      const lastLine = lines[lines.length - 1];
      if (lastLine && /^\d{3} /.test(lastLine)) {
        cleanup();
        const code = Number(lastLine.slice(0, 3));
        if (code >= 400) {
          reject(new Error(`Respuesta SMTP ${code}`));
        } else {
          resolve(buffer);
        }
      }
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      socket.off('data', onData);
      socket.off('error', onError);
    };
    socket.on('data', onData);
    socket.on('error', onError);
    if (command !== null) {
      socket.write(`${command}\r\n`);
    }
  });
}

async function deliverViaSmtpSocket(
  config: ResolvedSmtpConfig,
  params: { to: string; subject: string; html: string; text: string },
): Promise<void> {
  const timeoutMs = 6000;
  let socket: net.Socket | tls.TLSSocket =
    config.security === 'TLS'
      ? tls.connect({
          host: config.host,
          port: config.port,
          servername: config.host,
        })
      : net.createConnection({ host: config.host, port: config.port });

  socket.setTimeout(timeoutMs, () => {
    socket.destroy(new Error('Tiempo de espera agotado al conectar con SMTP'));
  });

  try {
    await sendRawSmtpCommand(socket, null);
    await sendRawSmtpCommand(socket, 'EHLO smclock.local');

    if (config.security === 'STARTTLS' && !(socket instanceof tls.TLSSocket)) {
      await sendRawSmtpCommand(socket, 'STARTTLS');
      socket = tls.connect({
        socket,
        servername: config.host,
      });
      await sendRawSmtpCommand(socket, 'EHLO smclock.local');
    }

    if (
      config.user &&
      config.pass &&
      config.pass !== 'reemplazar_con_smtp_password'
    ) {
      const authPlain = Buffer.from(
        `\u0000${config.user}\u0000${config.pass}`,
        'utf8',
      ).toString('base64');
      await sendRawSmtpCommand(socket, `AUTH PLAIN ${authPlain}`);
    }

    await sendRawSmtpCommand(socket, `MAIL FROM:<${config.fromEmail}>`);
    await sendRawSmtpCommand(socket, `RCPT TO:<${params.to}>`);
    await sendRawSmtpCommand(socket, 'DATA');

    const boundary = `smclock_${Date.now().toString(36)}`;
    const encodedSubject = `=?UTF-8?B?${Buffer.from(params.subject, 'utf8').toString('base64')}?=`;
    const encodedFromName = `=?UTF-8?B?${Buffer.from(config.fromName, 'utf8').toString('base64')}?=`;
    const dateHeader = new Date().toUTCString();
    const messageId = `<smclock.${Date.now()}.${Math.random().toString(36).slice(2)}@gmail.com>`;

    const mimeMessage = [
      `Date: ${dateHeader}`,
      `Message-ID: ${messageId}`,
      `From: ${encodedFromName} <${config.fromEmail}>`,
      `To: <${params.to}>`,
      `Subject: ${encodedSubject}`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      params.text,
      '',
      `--${boundary}`,
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      params.html,
      '',
      `--${boundary}--`,
      '.',
    ].join('\r\n');

    await sendRawSmtpCommand(socket, mimeMessage);
    await sendRawSmtpCommand(socket, 'QUIT');
  } finally {
    socket.destroy();
  }
}

export async function sendTenantEmail(params: {
  tenantId: string | null;
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<SendEmailResult> {
  const config = await resolveTenantSmtpConfig(params.tenantId);

  const isPlaceholderDefault =
    config.provider === 'GOOGLE_DEFAULT' &&
    (!config.pass || config.pass === 'reemplazar_con_smtp_password') &&
    config.host === 'smtp.gmail.com';

  if (isPlaceholderDefault) {
    return {
      delivered: true,
      simulated: true,
      provider: config.provider,
    };
  }

  try {
    await deliverViaSmtpSocket(config, params);
    return {
      delivered: true,
      simulated: false,
      provider: config.provider,
    };
  } catch (err) {
    if (process.env['NODE_ENV'] !== 'production') {
      return {
        delivered: true,
        simulated: true,
        provider: config.provider,
        error: err instanceof Error ? err.message : 'SMTP no disponible en dev',
      };
    }
    return {
      delivered: false,
      simulated: false,
      provider: config.provider,
      error:
        err instanceof Error
          ? err.message
          : 'Error al enviar correo por servidor SMTP',
    };
  }
}

export function buildInvitationEmailTemplate(params: {
  nombreCompleto: string;
  tenantNombre: string;
  rol: TenantUserRole;
  inviteUrl: string;
  expiraEnFormatted: string;
}): { subject: string; html: string; text: string } {
  const rolLabel =
    params.rol === 'ADMIN_EMPRESA' ? 'Administrador' : 'Operador';
  const safeName = escapeHtml(params.nombreCompleto);
  const safeTenant = escapeHtml(params.tenantNombre);
  const safeUrl = escapeHtml(params.inviteUrl);
  const safeExp = escapeHtml(params.expiraEnFormatted);

  const subject = `Invitación a ${params.tenantNombre} en SM Clock (${rolLabel})`;
  const text = [
    `Hola ${params.nombreCompleto},`,
    '',
    `Has sido invitado a unirte a ${params.tenantNombre} en la plataforma SM Clock con el rol de ${rolLabel}.`,
    '',
    'Completa tu pre-registro e inicia sesión con correo y contraseña o con Google Auth en el siguiente enlace:',
    params.inviteUrl,
    '',
    `Este enlace expira el ${params.expiraEnFormatted}.`,
  ].join('\n');

  const html = `<!DOCTYPE html>
<html lang="es-MX">
<head><meta charset="UTF-8" /></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #F2F2F7; padding: 24px; color: #1C1C1E;">
  <div style="max-width: 520px; margin: 0 auto; background: #FFFFFF; border-radius: 14px; padding: 28px; border: 1px solid #E5E5EA;">
    <h2 style="margin-top: 0; color: #007AFF;">Invitación a ${safeTenant}</h2>
    <p>Hola <strong>${safeName}</strong>,</p>
    <p>El administrador de <strong>${safeTenant}</strong> te ha invitado a colaborar en <strong>SM Clock</strong> con el rol de <strong>${rolLabel}</strong>.</p>
    <p>Haz clic en el siguiente botón para acudir al pre-registro y activar tu acceso mediante usuario y contraseña o con <strong>Google Auth</strong>:</p>
    <p style="margin: 24px 0;">
      <a href="${safeUrl}" style="display: inline-block; background-color: #007AFF; color: #FFFFFF; text-decoration: none; font-weight: 600; padding: 12px 20px; border-radius: 10px;">
        Completar Pre-registro
      </a>
    </p>
    <p style="font-size: 13px; color: #636366;">Vigencia de la invitación: ${safeExp} (America/Tijuana).</p>
  </div>
</body>
</html>`;

  return { subject, html, text };
}

export function buildPasswordRecoveryEmailTemplate(params: {
  nombreCompleto: string;
  resetUrl: string;
}): { subject: string; html: string; text: string } {
  const safeName = escapeHtml(params.nombreCompleto);
  const safeUrl = escapeHtml(params.resetUrl);

  const subject = 'Recuperación de contraseña · SM Clock';
  const text = [
    `Hola ${params.nombreCompleto},`,
    '',
    'Recibimos una solicitud para restablecer tu contraseña en SM Clock.',
    'Abre el siguiente enlace para definir una nueva contraseña:',
    params.resetUrl,
    '',
    'Si no solicitaste este cambio, puedes ignorar este mensaje.',
  ].join('\n');

  const html = `<!DOCTYPE html>
<html lang="es-MX">
<head><meta charset="UTF-8" /></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #F2F2F7; padding: 24px; color: #1C1C1E;">
  <div style="max-width: 520px; margin: 0 auto; background: #FFFFFF; border-radius: 14px; padding: 28px; border: 1px solid #E5E5EA;">
    <h2 style="margin-top: 0; color: #007AFF;">Restablecer contraseña</h2>
    <p>Hola <strong>${safeName}</strong>,</p>
    <p>Recibimos una solicitud para restablecer la contraseña de tu cuenta en <strong>SM Clock</strong>.</p>
    <p style="margin: 24px 0;">
      <a href="${safeUrl}" style="display: inline-block; background-color: #007AFF; color: #FFFFFF; text-decoration: none; font-weight: 600; padding: 12px 20px; border-radius: 10px;">
        Restablecer mi contraseña
      </a>
    </p>
    <p style="font-size: 13px; color: #636366;">Si tú no solicitaste este enlace, tu cuenta permanece segura y puedes ignorar este correo.</p>
  </div>
</body>
</html>`;

  return { subject, html, text };
}

export function buildAgentErrorReportEmailTemplate(params: {
  agenteNombre: string;
  tenantNombre: string;
  tipoError: string;
  mensaje: string;
  detalle?: string | null;
  dispositivo?: string | null;
  timestampFormatted: string;
}): { subject: string; html: string; text: string } {
  const safeAgent = escapeHtml(params.agenteNombre);
  const safeTenant = escapeHtml(params.tenantNombre);
  const safeTipo = escapeHtml(params.tipoError);
  const safeMensaje = escapeHtml(params.mensaje);
  const safeDetalle = params.detalle ? escapeHtml(params.detalle) : null;
  const safeDispositivo = params.dispositivo ? escapeHtml(params.dispositivo) : null;
  const safeFecha = escapeHtml(params.timestampFormatted);

  const subject = `🚨 Alerta de Error en Agente Local: [${params.tenantNombre}] ${params.tipoError}`;

  const textLines = [
    `ALERTA DE ERROR EN AGENTE LOCAL · SM CLOCK`,
    `==========================================`,
    `Empresa: ${params.tenantNombre}`,
    `Agente: ${params.agenteNombre}`,
  ];
  if (params.dispositivo) {
    textLines.push(`Dispositivo / Reloj: ${params.dispositivo}`);
  }
  textLines.push(
    `Tipo de error: ${params.tipoError}`,
    `Mensaje: ${params.mensaje}`,
  );
  if (params.detalle) {
    textLines.push(`Detalle técnico:\n${params.detalle}`);
  }
  textLines.push(
    '',
    `Fecha y hora del evento: ${params.timestampFormatted} (America/Tijuana)`,
    '',
    'Este correo fue enviado automáticamente por el sistema de monitoreo de SM Clock.',
    'Verifica la conexión del reloj biométrico y el estado del agente local.',
  );
  const text = textLines.join('\n');

  const html = `<!DOCTYPE html>
<html lang="es-MX">
<head><meta charset="UTF-8" /></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #F2F2F7; padding: 24px; color: #1C1C1E;">
  <div style="max-width: 580px; margin: 0 auto; background: #FFFFFF; border-radius: 14px; padding: 28px; border: 1px solid #E5E5EA; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);">
    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 16px;">
      <span style="display: inline-block; background-color: #FF3B30; color: #FFFFFF; font-size: 11px; font-weight: 700; padding: 4px 8px; border-radius: 6px; letter-spacing: 0.5px;">ALERTA DE ERROR</span>
      <span style="font-size: 13px; color: #8E8E93; font-weight: 500;">SM Clock · Agente Local</span>
    </div>
    <h2 style="margin: 0 0 8px 0; color: #1C1C1E; font-size: 20px;">Fallo detectado en ${safeAgent}</h2>
    <p style="margin: 0 0 20px 0; color: #636366; font-size: 14px;">
      El agente local reportó una incidencia durante la captura o sincronización de checadas para <strong>${safeTenant}</strong>.
    </p>

    <div style="background-color: #F9F9FB; border-radius: 10px; border: 1px solid #E5E5EA; padding: 16px; margin-bottom: 20px;">
      <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
        <tr>
          <td style="padding: 6px 0; color: #8E8E93; width: 140px;">Tipo de error:</td>
          <td style="padding: 6px 0; color: #FF3B30; font-weight: 600;">${safeTipo}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #8E8E93;">Agente:</td>
          <td style="padding: 6px 0; color: #1C1C1E; font-weight: 500;">${safeAgent}</td>
        </tr>
        ${safeDispositivo ? `<tr>
          <td style="padding: 6px 0; color: #8E8E93;">Dispositivo:</td>
          <td style="padding: 6px 0; color: #1C1C1E; font-weight: 500;">${safeDispositivo}</td>
        </tr>` : ''}
        <tr>
          <td style="padding: 6px 0; color: #8E8E93;">Fecha y hora:</td>
          <td style="padding: 6px 0; color: #1C1C1E;">${safeFecha} (Tijuana)</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #8E8E93; vertical-align: top;">Descripción:</td>
          <td style="padding: 6px 0; color: #1C1C1E; font-weight: 500;">${safeMensaje}</td>
        </tr>
      </table>
    </div>

    ${safeDetalle ? `
    <div style="margin-bottom: 20px;">
      <div style="font-size: 12px; font-weight: 600; color: #8E8E93; margin-bottom: 6px; text-transform: uppercase;">Detalle Técnico:</div>
      <pre style="background: #1C1C1E; color: #34C759; padding: 12px; border-radius: 8px; font-size: 11px; overflow-x: auto; white-space: pre-wrap; word-break: break-all; font-family: ui-monospace, Menlo, Monaco, Consolas, monospace; margin: 0;">${safeDetalle}</pre>
    </div>` : ''}

    <p style="font-size: 12px; color: #8E8E93; margin-top: 24px; border-top: 1px solid #E5E5EA; padding-top: 16px;">
      Este aviso se generó utilizando la configuración SMTP asignada para <strong>${safeTenant}</strong>.
    </p>
  </div>
</body>
</html>`;

  return { subject, html, text };
}

export async function sendSmtpTestEmail(params: {
  tenantId: string | null;
  to: string;
  overrideConfig?: {
    usar_smtp_propio: boolean;
    host: string;
    puerto: number;
    seguridad: SmtpSecurity;
    usuario?: string | null;
    password?: string;
    remitente_email?: string | null;
    remitente_nombre: string;
  };
}): Promise<SendEmailResult> {
  const savedConfig = await resolveTenantSmtpConfig(params.tenantId);

  const effectiveConfig: ResolvedSmtpConfig = params.overrideConfig
    ? params.overrideConfig.usar_smtp_propio
      ? {
          provider: 'CUSTOM_TENANT',
          host: params.overrideConfig.host,
          port: params.overrideConfig.puerto,
          security: params.overrideConfig.seguridad,
          user: params.overrideConfig.usuario ?? savedConfig.user,
          pass:
            params.overrideConfig.password &&
            params.overrideConfig.password.trim().length > 0
              ? params.overrideConfig.password.trim().replace(/\s+/g, '')
              : savedConfig.pass,
          fromEmail:
            params.overrideConfig.remitente_email &&
            params.overrideConfig.remitente_email.trim().length > 0
              ? params.overrideConfig.remitente_email
              : savedConfig.fromEmail,
          fromName: params.overrideConfig.remitente_nombre,
        }
      : {
          provider: 'GOOGLE_DEFAULT',
          host: 'smtp.gmail.com',
          port: 465,
          security: 'TLS',
          user: params.overrideConfig.usuario ?? savedConfig.user,
          pass:
            params.overrideConfig.password &&
            params.overrideConfig.password.trim().length > 0
              ? params.overrideConfig.password.trim().replace(/\s+/g, '')
              : savedConfig.pass,
          fromEmail:
            params.overrideConfig.remitente_email &&
            params.overrideConfig.remitente_email.trim().length > 0
              ? params.overrideConfig.remitente_email
              : (params.overrideConfig.usuario ?? savedConfig.fromEmail),
          fromName:
            params.overrideConfig.remitente_nombre || savedConfig.fromName,
        }
    : savedConfig;

  const safeFromName = escapeHtml(effectiveConfig.fromName);
  const safeHost = escapeHtml(
    `${effectiveConfig.host}:${effectiveConfig.port} (${effectiveConfig.security})`,
  );
  const subject = 'Prueba de configuración SMTP · SM Clock';
  const text = [
    'Prueba de envío SMTP exitosa en SM Clock.',
    `Proveedor: ${effectiveConfig.provider === 'CUSTOM_TENANT' ? 'SMTP Propio de la Empresa' : 'Google SMTP (Por defecto)'}`,
    `Servidor: ${effectiveConfig.host}:${effectiveConfig.port} (${effectiveConfig.security})`,
    `Remitente: ${effectiveConfig.fromName} <${effectiveConfig.fromEmail}>`,
  ].join('\n');

  const html = `<!DOCTYPE html>
<html lang="es-MX">
<head><meta charset="UTF-8" /></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #F2F2F7; padding: 24px; color: #1C1C1E;">
  <div style="max-width: 520px; margin: 0 auto; background: #FFFFFF; border-radius: 14px; padding: 28px; border: 1px solid #E5E5EA;">
    <h2 style="margin-top: 0; color: #34C759;">Prueba SMTP exitosa</h2>
    <p>Los datos de conexión SMTP configurados para <strong>${safeFromName}</strong> funcionan correctamente.</p>
    <p style="font-size: 13px; color: #636366;">Servidor verificado: <code>${safeHost}</code></p>
  </div>
</body>
</html>`;

  const isPlaceholderDefault =
    effectiveConfig.provider === 'GOOGLE_DEFAULT' &&
    (!effectiveConfig.pass ||
      effectiveConfig.pass === 'reemplazar_con_smtp_password') &&
    effectiveConfig.host === 'smtp.gmail.com';

  let result: SendEmailResult;
  if (isPlaceholderDefault) {
    result = {
      delivered: false,
      simulated: false,
      provider: effectiveConfig.provider,
      error:
        'No se ha configurado la App Password de Google o contraseña SMTP para este tenant.',
    };
  } else {
    try {
      await deliverViaSmtpSocket(effectiveConfig, {
        to: params.to,
        subject,
        html,
        text,
      });
      result = {
        delivered: true,
        simulated: false,
        provider: effectiveConfig.provider,
      };
    } catch (err) {
      result = {
        delivered: false,
        simulated: false,
        provider: effectiveConfig.provider,
        error:
          err instanceof Error
            ? err.message
            : 'No se pudo conectar al servidor SMTP',
      };
    }
  }

  if (params.tenantId) {
    const adminClient = createSupabaseServiceClient();
    await adminClient
      .from('configuracion_smtp')
      .update({
        ultima_prueba_exitosa_en: result.delivered
          ? new Date().toISOString()
          : null,
        ultimo_error_prueba: result.delivered ? null : (result.error ?? null),
      })
      .eq('tenant_id', params.tenantId);
  }

  return result;
}

