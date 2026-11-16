import type { NextRequest } from 'next/server';

const CANONICAL_PRODUCTION_ORIGIN = 'https://sm-clock.pleyadesoft.com';

function isLocalhost(host: string): boolean {
  const lower = host.trim().toLowerCase();
  return (
    lower.startsWith('localhost') ||
    lower.startsWith('127.0.0.1') ||
    lower.startsWith('0.0.0.0') ||
    lower.startsWith('::1')
  );
}

function isInternalOrLocalHost(host: string): boolean {
  const lower = host.trim().toLowerCase();
  return (
    !lower ||
    isLocalhost(lower) ||
    lower.startsWith('web:') ||
    lower === 'web'
  );
}

function getConfiguredPublicOrigin(): string | null {
  const appDomain =
    process.env['APP_DOMAIN'] ||
    process.env['NEXT_PUBLIC_APP_URL'] ||
    process.env['NEXT_PUBLIC_SITE_URL'];

  if (!appDomain) return null;

  const clean = appDomain
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');

  if (!clean || isInternalOrLocalHost(clean)) {
    return null;
  }

  return `https://${clean}`;
}

/**
 * Obtiene el origen público canónico (ej. https://sm-clock.pleyadesoft.com)
 * respetando encabezados de proxy reverso (x-forwarded-host, x-forwarded-proto),
 * encabezado host, variables de entorno de producción (APP_DOMAIN, NEXT_PUBLIC_APP_URL),
 * o fallback a url.origin en desarrollo local.
 */
export function getRequestOrigin(request: Request | NextRequest): string {
  // 1. Respetar headers enviados por proxies inversos (Caddy, Nginx, Cloudflare)
  const forwardedHost = request.headers.get('x-forwarded-host');
  const forwardedProto =
    request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() ?? 'https';

  if (forwardedHost) {
    const host = forwardedHost.split(',')[0]?.trim();
    if (host && !isInternalOrLocalHost(host)) {
      return `${forwardedProto}://${host}`;
    }
  }

  // 2. Encabezado host estándar si no es localhost ni contenedor interno
  const host = request.headers.get('host');
  if (host && !isInternalOrLocalHost(host)) {
    const proto =
      request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() ?? 'https';
    return `${proto}://${host}`;
  }

  // 3. Si la petición proviene de localhost / 127.0.0.1 (desarrollo local directo)
  // o estamos en modo desarrollo: mantener siempre el origen local de la petición
  const requestUrl = new URL(request.url);
  if (
    process.env['NODE_ENV'] === 'development' ||
    isLocalhost(requestUrl.hostname) ||
    (host && isLocalhost(host))
  ) {
    return requestUrl.origin;
  }

  // 4. Fallback a variables de entorno de dominio público en producción (ej. Docker interno 'web:3000')
  const configured = getConfiguredPublicOrigin();
  if (configured) {
    return configured;
  }

  // 5. Fallback final a la URL recibida
  return requestUrl.origin;
}

/**
 * Obtiene el origen público para enlaces enviados por correo electrónico (invitaciones,
 * recuperación de contraseña) tanto en entorno local como en el VPS de producción.
 * Siempre apunta al dominio público configurado (`APP_DOMAIN` / `sm-clock.pleyadesoft.com`)
 * y nunca expone `localhost` ni `127.0.0.1` en correos salientes.
 */
export function getPublicAppOrigin(request?: Request | NextRequest): string {
  const configured = getConfiguredPublicOrigin();
  if (configured) {
    return configured;
  }

  if (request) {
    const forwardedHost = request.headers.get('x-forwarded-host');
    const forwardedProto =
      request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() ??
      'https';
    if (forwardedHost) {
      const host = forwardedHost.split(',')[0]?.trim();
      if (host && !isInternalOrLocalHost(host)) {
        return `${forwardedProto}://${host}`;
      }
    }

    const host = request.headers.get('host');
    if (host && !isInternalOrLocalHost(host)) {
      const proto =
        request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() ??
        'https';
      return `${proto}://${host}`;
    }
  }

  return CANONICAL_PRODUCTION_ORIGIN;
}
