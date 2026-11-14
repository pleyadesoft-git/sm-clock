import { z } from 'zod';

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

export const LoginRequestSchema = z.object({
  email: z.string().trim().email('Ingresa un correo electrónico válido'),
  password: z
    .string()
    .min(8, 'La contraseña debe tener al menos 8 caracteres')
    .max(128, 'La contraseña excede la longitud permitida'),
});

export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const ForgotPasswordRequestSchema = z.object({
  email: z.string().trim().email('Ingresa un correo electrónico válido'),
});

export type ForgotPasswordRequest = z.infer<typeof ForgotPasswordRequestSchema>;

export const ResetPasswordRequestSchema = z.object({
  password: z
    .string()
    .min(8, 'La contraseña debe tener al menos 8 caracteres')
    .max(128, 'La contraseña excede la longitud permitida'),
  tokenHash: z.string().trim().min(10).optional(),
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
