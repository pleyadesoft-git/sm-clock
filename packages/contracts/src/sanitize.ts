import { z } from 'zod';

/**
 * Patrones de inyección de código (XSS, HTML tags, URIs peligrosos,
 * manejadores de eventos inline, evaluación JS, SSTI y caracteres de control).
 */
const HTML_TAG_OR_ANGLE_REGEX = /[<>]/;
const DANGEROUS_URI_SCHEME_REGEX = /(?:javascript|vbscript|data)\s*:/i;
const INLINE_EVENT_HANDLER_REGEX = /\bon[a-z]{2,}\s*=/i;
const DANGEROUS_JS_SINK_REGEX =
  /\b(?:eval|Function|setTimeout|setInterval|document\.cookie|document\.write|innerHTML|outerHTML|setHTMLUnsafe)\s*\(/i;
const TEMPLATE_INJECTION_REGEX = /(?:\$\{[\s\S]*?\}|\{\{[\s\S]*?\}\})/;
const SQL_COMMENT_OR_UNION_REGEX = /(?:--|\/\*|\*\/|;\s*(?:drop|alter|delete|truncate|insert|update)\b|\bunion\s+select\b)/i;
const CONTROL_AND_BIDI_CHARS_REGEX = /(?![\t\n\r])[\p{Cc}\p{Cf}]/gu;

const FORMULA_PREFIX_CHARS = new Set(['=', '+', '-', '@']);

/**
 * Detecta si una cadena contiene vectores de inyección de código (HTML/XSS,
 * protocolos `javascript:`/`data:`, event handlers `on*=`, sinks DOM, SSTI o SQLi).
 */
export function containsCodeInjectionPattern(raw: string): boolean {
  if (!raw) return false;
  const normalized = raw.normalize('NFKC');
  return (
    HTML_TAG_OR_ANGLE_REGEX.test(normalized) ||
    DANGEROUS_URI_SCHEME_REGEX.test(normalized) ||
    INLINE_EVENT_HANDLER_REGEX.test(normalized) ||
    DANGEROUS_JS_SINK_REGEX.test(normalized) ||
    TEMPLATE_INJECTION_REGEX.test(normalized) ||
    SQL_COMMENT_OR_UNION_REGEX.test(normalized)
  );
}

/**
 * Sanitiza un campo de texto libre procedente de un formulario:
 * 1. Normaliza Unicode en forma canónica (NFC).
 * 2. Elimina bytes nulos, caracteres de control ASCII y overrides bidireccionales Unicode.
 * 3. Remueve etiquetas o corchetes angulares HTML (`<`, `>`) y esquemas ejecutables.
 * 4. Neutraliza prefijos de fórmulas (`=`, `+`, `-`, `@`) al inicio de campos de texto.
 * 5. Colapsa espacios repetidos y recorta extremos (`trim`).
 */
export function sanitizeTextInput(
  raw: string,
  options?: { allowNewlines?: boolean; neutralizeFormulaPrefix?: boolean },
): string {
  if (!raw) return '';
  const allowNewlines = options?.allowNewlines ?? false;
  const neutralizeFormulaPrefix = options?.neutralizeFormulaPrefix ?? true;

  let cleaned = raw
    .normalize('NFC')
    .replace(CONTROL_AND_BIDI_CHARS_REGEX, '')
    .replace(/<[^>]*>/g, '')
    .replace(/[<>]/g, '')
    .replace(/(?:javascript|vbscript|data)\s*:/gi, '');

  if (allowNewlines) {
    cleaned = cleaned
      .replace(/\r\n?/g, '\n')
      .replace(/[^\S\n]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  } else {
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
  }

  if (
    neutralizeFormulaPrefix &&
    cleaned.length > 0 &&
    FORMULA_PREFIX_CHARS.has(cleaned[0] ?? '')
  ) {
    cleaned = cleaned.replace(/^[=+\-@]+\s*/, '').trim();
  }

  return cleaned;
}

/**
 * Sanitiza entradas mientras el usuario escribe en un `<input>` sin recortar
 * espacios intermedios, pero eliminando caracteres de control, bytes nulos,
 * corchetes angulares `<` `>` y esquemas `javascript:`.
 */
export function sanitizeLiveInputValue(raw: string): string {
  if (!raw) return '';
  return raw
    .normalize('NFC')
    .replace(CONTROL_AND_BIDI_CHARS_REGEX, '')
    .replace(/(?:javascript|vbscript)\s*:/gi, '')
    .replace(/[<>]/g, '');
}

/**
 * Sanitiza términos de búsqueda para prevenir inyección de filtros en PostgREST (`.or()`, `.ilike()`)
 * y abusos de comodines SQL (`%`, `_`).
 */
export function sanitizeSearchQuery(raw: string, maxLength = 100): string {
  if (!raw) return '';
  return raw
    .normalize('NFC')
    .replace(CONTROL_AND_BIDI_CHARS_REGEX, '')
    .replace(/[<>,()"'\\;:%_*`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

/**
 * Valida que un host SMTP sea un nombre de dominio válido (FQDN) y bloquea
 * vectores de SSRF (localhost, IPs privadas RFC1918, link-local 169.254.x.x, loopback).
 */
export function isSafeSmtpHost(rawHost: string): boolean {
  const host = rawHost.trim().toLowerCase();
  if (!host || host.length < 4 || host.length > 150) return false;
  if (containsCodeInjectionPattern(host) || /[\s/\\:@?#]/.test(host)) {
    return false;
  }

  // Bloquear localhost y dominios internos
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.lan')
  ) {
    return false;
  }

  // Bloquear literales IPv4 / IPv6 directas para obligar FQDN público y prevenir SSRF a rangos privados
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(':')) {
    return false;
  }

  const fqdnRegex =
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
  return fqdnRegex.test(host);
}

/**
 * Crea un esquema Zod para texto libre de formulario que:
 * 1. Rechaza explícitamente patrones de inyección de código (XSS, HTML tags, JS URIs, SQLi).
 * 2. Sanitiza caracteres de control y normaliza espacios.
 * 3. Valida longitud mínima y máxima sobre el valor sanitizado.
 */
export function safeSanitizedTextSchema(params: {
  min?: number;
  max: number;
  minMessage?: string;
  maxMessage?: string;
  injectionMessage?: string;
  allowNewlines?: boolean;
}) {
  const minLen = params.min ?? 1;
  return z
    .string()
    .refine((val) => !containsCodeInjectionPattern(val), {
      message:
        params.injectionMessage ??
        'El campo contiene caracteres o código no permitido por seguridad',
    })
    .transform((val) =>
      sanitizeTextInput(val, { allowNewlines: params.allowNewlines ?? false }),
    )
    .pipe(
      z
        .string()
        .min(
          minLen,
          params.minMessage ??
            `El campo debe tener al menos ${minLen} caracteres`,
        )
        .max(
          params.max,
          params.maxMessage ??
            `El campo no puede exceder ${params.max} caracteres`,
        ),
    );
}

/**
 * Esquema Zod para correos electrónicos sanitizados (sin caracteres de control ni inyección).
 */
export function safeEmailSchema(
  message = 'Ingresa un correo electrónico válido',
  maxLength = 150,
) {
  return z
    .string()
    .trim()
    .toLowerCase()
    .refine((val) => !containsCodeInjectionPattern(val) && !/[\r\n\0]/.test(val), {
      message: 'El correo electrónico contiene caracteres no permitidos',
    })
    .pipe(z.string().email(message).max(maxLength));
}
