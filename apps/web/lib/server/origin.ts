import type { NextRequest } from 'next/server';

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
    if (host) {
      return `${forwardedProto}://${host}`;
    }
  }

  // 2. Encabezado host estándar si no es localhost ni contenedor interno
  const host = request.headers.get('host');
  if (
    host &&
    !host.startsWith('localhost') &&
    !host.startsWith('127.0.0.1') &&
    !host.startsWith('0.0.0.0') &&
    !host.startsWith('web:')
  ) {
    const proto =
      request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() ?? 'https';
    return `${proto}://${host}`;
  }

  // 3. Fallback a variables de entorno de dominio público en producción
  const appDomain =
    process.env['APP_DOMAIN'] ||
    process.env['NEXT_PUBLIC_APP_URL'] ||
    process.env['NEXT_PUBLIC_SITE_URL'];

  if (appDomain) {
    const clean = appDomain
      .trim()
      .replace(/^https?:\/\//, '')
      .replace(/\/+$/, '');
    if (
      clean &&
      !clean.startsWith('localhost') &&
      !clean.startsWith('127.0.0.1') &&
      !clean.startsWith('0.0.0.0')
    ) {
      return `https://${clean}`;
    }
  }

  // 4. Fallback local a la URL recibida
  try {
    return new URL(request.url).origin;
  } catch {
    return 'http://localhost:3000';
  }
}
