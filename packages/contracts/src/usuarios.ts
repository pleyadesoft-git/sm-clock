import { z } from 'zod';
import { TenantUserRoleSchema, UserRoleSchema } from './auth';

export const InviteStatusSchema = z.enum([
  'PENDIENTE',
  'ACEPTADA',
  'REVOCADA',
  'EXPIRADA',
]);

export type InviteStatus = z.infer<typeof InviteStatusSchema>;

export const InviteUserRequestSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('Ingresa un correo electrónico válido')
    .max(150),
  nombre_completo: z
    .string()
    .trim()
    .min(2, 'El nombre completo debe tener al menos 2 caracteres')
    .max(150, 'El nombre completo no puede exceder 150 caracteres'),
  rol: TenantUserRoleSchema,
});

export type InviteUserRequest = z.infer<typeof InviteUserRequestSchema>;

export const UpdateTenantUserRequestSchema = z
  .object({
    rol: TenantUserRoleSchema.optional(),
    activo: z.boolean().optional(),
    nombre_completo: z.string().trim().min(2).max(150).optional(),
  })
  .refine(
    (data) =>
      data.rol !== undefined ||
      data.activo !== undefined ||
      data.nombre_completo !== undefined,
    { message: 'Debes especificar al menos un campo a actualizar' },
  );

export type UpdateTenantUserRequest = z.infer<
  typeof UpdateTenantUserRequestSchema
>;

export const AcceptInvitationPasswordRequestSchema = z.object({
  token: z.string().trim().min(16, 'El enlace de invitación no es válido'),
  nombre_completo: z
    .string()
    .trim()
    .min(2, 'Ingresa tu nombre completo')
    .max(150),
  password: z
    .string()
    .min(8, 'La contraseña debe tener al menos 8 caracteres')
    .max(128, 'La contraseña excede la longitud permitida'),
});

export type AcceptInvitationPasswordRequest = z.infer<
  typeof AcceptInvitationPasswordRequestSchema
>;

export const AcceptInvitationOAuthRequestSchema = z.object({
  token: z.string().trim().min(16).optional(),
});

export type AcceptInvitationOAuthRequest = z.infer<
  typeof AcceptInvitationOAuthRequestSchema
>;

export const SmtpSecuritySchema = z.enum(['STARTTLS', 'TLS', 'NONE']);

export type SmtpSecurity = z.infer<typeof SmtpSecuritySchema>;

export const SmtpConfigUpsertSchema = z
  .object({
    usar_smtp_propio: z.boolean(),
    host: z
      .string()
      .trim()
      .min(3, 'Ingresa un host SMTP válido')
      .max(150)
      .default('smtp.gmail.com'),
    puerto: z.coerce
      .number()
      .int()
      .min(1, 'Puerto inválido')
      .max(65535, 'Puerto inválido')
      .default(465),
    seguridad: SmtpSecuritySchema.default('TLS'),
    usuario: z.string().trim().max(150).nullable().optional(),
    password: z.string().max(256).optional(),
    remitente_email: z
      .union([
        z.string().trim().email('Ingresa un correo remitente válido').max(150),
        z.literal(''),
        z.null(),
      ])
      .optional(),
    remitente_nombre: z
      .string()
      .trim()
      .min(2, 'Ingresa el nombre del remitente')
      .max(150)
      .default('SM Clock Notificaciones'),
  })
  .superRefine((val, ctx) => {
    if (val.usar_smtp_propio) {
      if (!val.usuario || val.usuario.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['usuario'],
          message: 'El usuario SMTP es obligatorio cuando usas SMTP propio',
        });
      }
      if (!val.remitente_email || val.remitente_email.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['remitente_email'],
          message: 'El correo remitente es obligatorio cuando usas SMTP propio',
        });
      }
    }
  });

export type SmtpConfigUpsert = z.infer<typeof SmtpConfigUpsertSchema>;

export const AuthProviderSchema = z.enum(['GOOGLE', 'EMAIL', 'BOTH']);
export type AuthProvider = z.infer<typeof AuthProviderSchema>;

export const SmtpTestSendSchema = z.object({
  usar_smtp_propio: z.boolean().default(true),
  host: z
    .string()
    .trim()
    .min(3, 'Ingresa un host SMTP válido')
    .max(150)
    .default('smtp.gmail.com'),
  puerto: z.coerce
    .number()
    .int()
    .min(1, 'Puerto inválido')
    .max(65535, 'Puerto inválido')
    .default(465),
  seguridad: SmtpSecuritySchema.default('TLS'),
  usuario: z.string().trim().max(150).nullable().optional(),
  password: z.string().max(256).optional(),
  remitente_email: z
    .union([
      z.string().trim().email('Ingresa un correo remitente válido').max(150),
      z.literal(''),
      z.null(),
    ])
    .optional(),
  remitente_nombre: z
    .string()
    .trim()
    .min(2, 'Ingresa el nombre del remitente')
    .max(150)
    .default('SM Clock Notificaciones'),
  destinatario_prueba: z
    .string()
    .trim()
    .toLowerCase()
    .email('Ingresa un correo electrónico válido para recibir la prueba SMTP'),
});

export type SmtpTestSendInput = z.infer<typeof SmtpTestSendSchema>;

export interface TenantUserRow {
  id: string;
  tipo_registro: 'USUARIO' | 'INVITACION';
  nombre_completo: string;
  email: string;
  rol: z.infer<typeof UserRoleSchema>;
  estatus: 'ACTIVO' | 'INACTIVO' | 'PENDIENTE' | 'REVOCADA' | 'EXPIRADA';
  auth_provider: 'GOOGLE' | 'EMAIL' | 'BOTH' | 'INVITACION';
  created_at: string;
  expira_en: string | null;
}

