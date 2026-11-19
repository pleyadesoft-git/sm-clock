import { z } from 'zod';
import {
  containsCodeInjectionPattern,
  safeEmailSchema,
  safeSanitizedTextSchema,
} from './sanitize';

export const UserRoleSchema = z.enum([
  'SUPER_ADMIN',
  'ADMIN_EMPRESA',
  'OPERADOR',
]);

export type UserRole = z.infer<typeof UserRoleSchema>;

export const TenantUserRoleSchema = z.enum(['ADMIN_EMPRESA', 'OPERADOR']);

export type TenantUserRole = z.infer<typeof TenantUserRoleSchema>;

export const MFA_REQUIRED_ROLES: readonly UserRole[] = [
  'SUPER_ADMIN',
  'ADMIN_EMPRESA',
] as const;

export function roleRequiresMfa(rol: UserRole): boolean {
  return MFA_REQUIRED_ROLES.includes(rol);
}

/**
 * Rutas públicas que no requieren sesión activa.
 */
export const PUBLIC_PATHS = [
  '/login',
  '/checador',
  '/invitacion',
  '/recuperar-contrasena',
  '/restablecer-contrasena',
  '/auth/callback',
  '/api/checador',
  '/api/invitaciones/verificar',
  '/api/invitaciones/aceptar',
  '/api/auth/callback',
  '/api/auth/recuperar-contrasena',
  '/api/auth/restablecer-contrasena',
  '/api/health',
  '/api/v1/agente',
  '/manifest.webmanifest',
  '/sw.js',
  '/favicon.ico',
  '/favicon-16x16.png',
  '/favicon-32x32.png',
] as const;

/**
 * Rutas de autenticación de invitado (si el usuario ya tiene sesión válida, se redirige a su home).
 */
export const AUTH_GUEST_ONLY_PATHS = [
  '/login',
  '/recuperar-contrasena',
] as const;

/**
 * Rutas exclusivas para `SUPER_ADMIN` (dueño del SaaS).
 */
export const SUPER_ADMIN_ONLY_PATHS = ['/admin', '/api/admin'] as const;

/**
 * Rutas exclusivas para administradores (`SUPER_ADMIN` o `ADMIN_EMPRESA`),
 * prohibidas para `OPERADOR`.
 */
export const TENANT_ADMIN_ONLY_PATHS = [
  '/usuarios',
  '/configuracion',
  '/empleados',
  '/sucursales',
  '/mensajes',
  '/dashboard/empleados',
  '/api/usuarios',
  '/api/configuracion',
  '/api/empleados',
  '/api/sucursales',
  '/api/mensajes',
] as const;

function matchesPathPrefix(
  pathname: string,
  prefixes: readonly string[],
): boolean {
  return prefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function isPublicPath(pathname: string): boolean {
  return matchesPathPrefix(pathname, PUBLIC_PATHS);
}

export function isAuthGuestOnlyPath(pathname: string): boolean {
  return matchesPathPrefix(pathname, AUTH_GUEST_ONLY_PATHS);
}

export function isSuperAdminOnlyPath(pathname: string): boolean {
  return matchesPathPrefix(pathname, SUPER_ADMIN_ONLY_PATHS);
}

export function isTenantAdminOnlyPath(pathname: string): boolean {
  return matchesPathPrefix(pathname, TENANT_ADMIN_ONLY_PATHS);
}

export function getDefaultHomeForRole(rol: UserRole): string {
  return rol === 'SUPER_ADMIN' ? '/admin/empresas' : '/dashboard';
}

/**
 * Evalúa si un rol autenticado tiene permiso para acceder a `pathname`
 * aplicando lista blanca por rol (tanto en Middleware como en Browser Guard).
 */
export function canRoleAccessPath(rol: UserRole, pathname: string): boolean {
  if (isSuperAdminOnlyPath(pathname)) {
    return rol === 'SUPER_ADMIN';
  }
  if (isTenantAdminOnlyPath(pathname)) {
    return rol === 'SUPER_ADMIN' || rol === 'ADMIN_EMPRESA';
  }
  return true;
}

/**
 * Sanitiza el parámetro `?next=` para prevenir ataques de Open Redirect (`//evil.com`,
 * `https://evil.com`, `javascript:...`, `\r\n`) y verifica que el destino sea permitido
 * para el rol del usuario.
 */
export function sanitizeRedirectPath(
  rawNext: string | null | undefined,
  rol?: UserRole | null | undefined,
): string {
  const defaultDest = rol ? getDefaultHomeForRole(rol) : '/dashboard';
  if (!rawNext || typeof rawNext !== 'string') {
    return defaultDest;
  }

  const trimmed = rawNext.trim();
  if (
    !trimmed.startsWith('/') ||
    trimmed.startsWith('//') ||
    trimmed.startsWith('/\\') ||
    /[\p{Cc}\p{Cf}<>\\]/u.test(trimmed) ||
    containsCodeInjectionPattern(trimmed)
  ) {
    return defaultDest;
  }

  let parsedPathname: string;
  let parsedSearch: string;
  try {
    const dummyUrl = new URL(trimmed, 'https://smclock.local');
    if (dummyUrl.origin !== 'https://smclock.local') {
      return defaultDest;
    }
    parsedPathname = dummyUrl.pathname;
    parsedSearch = dummyUrl.search;
  } catch {
    return defaultDest;
  }

  if (
    parsedPathname === '/' ||
    parsedPathname === '/admin' ||
    parsedPathname.startsWith('/api/') ||
    parsedPathname.startsWith('/auth/') ||
    parsedPathname.startsWith('/mfa') ||
    isPublicPath(parsedPathname)
  ) {
    return defaultDest;
  }

  if (rol && !canRoleAccessPath(rol, parsedPathname)) {
    return defaultDest;
  }

  return `${parsedPathname}${parsedSearch}`;
}

export const LoginRequestSchema = z.object({
  email: safeEmailSchema('Ingresa un correo electrónico válido'),
  password: z
    .string()
    .min(8, 'La contraseña debe tener al menos 8 caracteres')
    .max(128, 'La contraseña excede la longitud permitida'),
});

export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const ForgotPasswordRequestSchema = z.object({
  email: safeEmailSchema('Ingresa un correo electrónico válido'),
});

export type ForgotPasswordRequest = z.infer<typeof ForgotPasswordRequestSchema>;

export const ResetPasswordRequestSchema = z.object({
  password: z
    .string()
    .min(8, 'La contraseña debe tener al menos 8 caracteres')
    .max(128, 'La contraseña excede la longitud permitida'),
  tokenHash: z
    .string()
    .trim()
    .min(10)
    .max(256)
    .regex(/^[A-Za-z0-9._-]+$/, 'Token de recuperación inválido')
    .optional(),
});

export type ResetPasswordRequest = z.infer<typeof ResetPasswordRequestSchema>;

export const MfaVerifyRequestSchema = z.object({
  factorId: z.string().uuid('Factor MFA inválido'),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'El código TOTP debe tener 6 dígitos numéricos'),
});

export type MfaVerifyRequest = z.infer<typeof MfaVerifyRequestSchema>;

export const JwtAppMetadataSchema = z.object({
  rol: UserRoleSchema,
  tenant_id: z.string().uuid().nullable().optional(),
});

export type JwtAppMetadata = z.infer<typeof JwtAppMetadataSchema>;

export const PasskeyRenameRequestSchema = z.object({
  passkeyId: z.string().uuid('ID de llave de acceso inválido'),
  friendlyName: safeSanitizedTextSchema({
    min: 2,
    max: 120,
    minMessage: 'El nombre del dispositivo debe tener al menos 2 caracteres',
    maxMessage: 'El nombre del dispositivo no puede exceder 120 caracteres',
    injectionMessage:
      'El nombre del dispositivo contiene caracteres o código no permitido',
  }),
});

export type PasskeyRenameRequest = z.infer<typeof PasskeyRenameRequestSchema>;

export const WebAuthnFactorEnrollSchema = z.object({
  friendlyName: safeSanitizedTextSchema({
    min: 2,
    max: 120,
    minMessage:
      'Ingresa un nombre descriptivo para tu dispositivo biométrico',
    maxMessage: 'El nombre no puede exceder 120 caracteres',
    injectionMessage:
      'El nombre del dispositivo contiene caracteres o código no permitido',
  }),
});

export type WebAuthnFactorEnroll = z.infer<typeof WebAuthnFactorEnrollSchema>;

export const ResetPasswordFormSchema = z
  .object({
    password: z
      .string()
      .min(8, 'La contraseña debe tener al menos 8 caracteres')
      .max(128, 'La contraseña excede la longitud permitida'),
    confirm_password: z
      .string()
      .min(1, 'Confirma tu nueva contraseña'),
  })
  .refine((data) => data.password === data.confirm_password, {
    message: 'Las contraseñas no coinciden',
    path: ['confirm_password'],
  });

export type ResetPasswordFormValues = z.infer<typeof ResetPasswordFormSchema>;

export const UpdateOwnProfileRequestSchema = z
  .object({
    nombre_completo: safeSanitizedTextSchema({
      min: 2,
      max: 140,
      minMessage: 'Ingresa tu nombre completo (mínimo 2 caracteres)',
      maxMessage: 'El nombre completo no puede exceder 140 caracteres',
      injectionMessage:
        'El nombre completo contiene caracteres o código no permitido',
    }),
    email: safeEmailSchema('Ingresa un correo electrónico válido'),
    current_password: z
      .string()
      .min(1, 'Ingresa tu contraseña actual')
      .max(128, 'La contraseña excede la longitud permitida')
      .optional(),
    password: z
      .string()
      .min(8, 'La contraseña debe tener al menos 8 caracteres')
      .max(128, 'La contraseña excede la longitud permitida')
      .optional(),
    confirm_password: z
      .string()
      .max(128, 'La contraseña excede la longitud permitida')
      .optional(),
  })
  .superRefine((data, ctx) => {
    if (
      data.password &&
      data.confirm_password !== undefined &&
      data.password !== data.confirm_password
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['confirm_password'],
        message: 'Las contraseñas no coinciden',
      });
    }
  });

export type UpdateOwnProfileRequest = z.infer<
  typeof UpdateOwnProfileRequestSchema
>;
