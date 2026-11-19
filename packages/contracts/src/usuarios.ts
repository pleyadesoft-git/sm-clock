import { z } from 'zod';
import { TenantUserRoleSchema, UserRoleSchema } from './auth';
import {
  containsCodeInjectionPattern,
  isSafeSmtpHost,
  safeEmailSchema,
  safeSanitizedTextSchema,
  sanitizeTextInput,
} from './sanitize';

export const InviteStatusSchema = z.enum([
  'PENDIENTE',
  'ACEPTADA',
  'REVOCADA',
  'EXPIRADA',
]);

export type InviteStatus = z.infer<typeof InviteStatusSchema>;

export const InviteUserRequestSchema = z.object({
  email: safeEmailSchema('Ingresa un correo electrónico válido', 150),
  nombre_completo: safeSanitizedTextSchema({
    min: 2,
    max: 150,
    minMessage: 'El nombre completo debe tener al menos 2 caracteres',
    maxMessage: 'El nombre completo no puede exceder 150 caracteres',
    injectionMessage:
      'El nombre del invitado contiene caracteres o código no permitido',
  }),
  rol: TenantUserRoleSchema,
  sucursal_id: z
    .string({
      error: 'Debes seleccionar una sucursal obligatoriamente',
    })
    .trim()
    .uuid('Selecciona una sucursal válida'),
});

export type InviteUserRequest = z.infer<typeof InviteUserRequestSchema>;

export const UpdateTenantUserRequestSchema = z
  .object({
    rol: TenantUserRoleSchema.optional(),
    activo: z.boolean().optional(),
    sucursal_id: z.string().trim().uuid('Selecciona una sucursal válida').optional(),
    nombre_completo: safeSanitizedTextSchema({
      min: 2,
      max: 150,
      minMessage: 'El nombre completo debe tener al menos 2 caracteres',
      maxMessage: 'El nombre completo no puede exceder 150 caracteres',
      injectionMessage:
        'El nombre completo contiene caracteres o código no permitido',
    }).optional(),
  })
  .refine(
    (data) =>
      data.rol !== undefined ||
      data.activo !== undefined ||
      data.sucursal_id !== undefined ||
      data.nombre_completo !== undefined,
    { message: 'Debes especificar al menos un campo a actualizar' },
  );

export type UpdateTenantUserRequest = z.infer<
  typeof UpdateTenantUserRequestSchema
>;

export const AcceptInvitationPasswordRequestSchema = z.object({
  token: z
    .string()
    .trim()
    .min(16, 'El enlace de invitación no es válido')
    .max(256)
    .regex(/^[A-Za-z0-9._-]+$/, 'El enlace de invitación no es válido'),
  nombre_completo: safeSanitizedTextSchema({
    min: 2,
    max: 150,
    minMessage: 'Ingresa tu nombre completo',
    maxMessage: 'El nombre completo no puede exceder 150 caracteres',
    injectionMessage:
      'El nombre completo contiene caracteres o código no permitido',
  }),
  password: z
    .string()
    .min(8, 'La contraseña debe tener al menos 8 caracteres')
    .max(128, 'La contraseña excede la longitud permitida'),
});

export type AcceptInvitationPasswordRequest = z.infer<
  typeof AcceptInvitationPasswordRequestSchema
>;

export const AcceptInvitationPasswordFormSchema = z
  .object({
    nombre_completo: safeSanitizedTextSchema({
      min: 2,
      max: 150,
      minMessage: 'Ingresa tu nombre completo',
      maxMessage: 'El nombre completo no puede exceder 150 caracteres',
      injectionMessage:
        'El nombre completo contiene caracteres o código no permitido',
    }),
    password: z
      .string()
      .min(8, 'La contraseña debe tener al menos 8 caracteres')
      .max(128, 'La contraseña excede la longitud permitida'),
    confirm_password: z
      .string()
      .min(1, 'Confirma tu contraseña'),
  })
  .refine((data) => data.password === data.confirm_password, {
    message: 'Las contraseñas no coinciden',
    path: ['confirm_password'],
  });

export type AcceptInvitationPasswordFormValues = z.infer<
  typeof AcceptInvitationPasswordFormSchema
>;

export const AcceptInvitationOAuthRequestSchema = z.object({
  token: z
    .string()
    .trim()
    .min(16)
    .max(256)
    .regex(/^[A-Za-z0-9._-]+$/, 'Token de invitación inválido')
    .optional(),
});

export type AcceptInvitationOAuthRequest = z.infer<
  typeof AcceptInvitationOAuthRequestSchema
>;

export const SmtpSecuritySchema = z.enum(['STARTTLS', 'TLS', 'NONE']);

export type SmtpSecurity = z.infer<typeof SmtpSecuritySchema>;

const SafeSmtpHostSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'Ingresa un host SMTP válido')
  .max(150)
  .refine((val) => isSafeSmtpHost(val), {
    message:
      'Ingresa un dominio SMTP válido (no se permiten IPs privadas, localhost ni código ejecutable)',
  })
  .default('smtp.gmail.com');

const SafeSmtpUserSchema = z
  .string()
  .trim()
  .max(150)
  .refine(
    (val) =>
      val.length === 0 ||
      (!containsCodeInjectionPattern(val) && !/[\r\n\0]/.test(val)),
    {
      message: 'El usuario SMTP contiene caracteres no permitidos',
    },
  )
  .transform((val) => sanitizeTextInput(val))
  .nullable()
  .optional();

export const SmtpConfigUpsertSchema = z
  .object({
    usar_smtp_propio: z.boolean(),
    host: SafeSmtpHostSchema,
    puerto: z.coerce
      .number()
      .int()
      .min(1, 'Puerto inválido')
      .max(65535, 'Puerto inválido')
      .default(465),
    seguridad: SmtpSecuritySchema.default('TLS'),
    usuario: SafeSmtpUserSchema,
    password: z.string().max(256).optional(),
    remitente_email: z
      .union([
        safeEmailSchema('Ingresa un correo remitente válido', 150),
        z.literal(''),
        z.null(),
      ])
      .optional(),
    remitente_nombre: safeSanitizedTextSchema({
      min: 2,
      max: 150,
      minMessage: 'Ingresa el nombre del remitente',
      maxMessage: 'El nombre del remitente no puede exceder 150 caracteres',
      injectionMessage:
        'El nombre del remitente contiene caracteres o código no permitido',
    }).default('SM Clock Notificaciones'),
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
  host: SafeSmtpHostSchema,
  puerto: z.coerce
    .number()
    .int()
    .min(1, 'Puerto inválido')
    .max(65535, 'Puerto inválido')
    .default(465),
  seguridad: SmtpSecuritySchema.default('TLS'),
  usuario: SafeSmtpUserSchema,
  password: z.string().max(256).optional(),
  remitente_email: z
    .union([
      safeEmailSchema('Ingresa un correo remitente válido', 150),
      z.literal(''),
      z.null(),
    ])
    .optional(),
  remitente_nombre: safeSanitizedTextSchema({
    min: 2,
    max: 150,
    minMessage: 'Ingresa el nombre del remitente',
    maxMessage: 'El nombre del remitente no puede exceder 150 caracteres',
    injectionMessage:
      'El nombre del remitente contiene caracteres o código no permitido',
  }).default('SM Clock Notificaciones'),
  destinatario_prueba: safeEmailSchema(
    'Ingresa un correo electrónico válido para recibir la prueba SMTP',
    150,
  ),
});

export type SmtpTestSendInput = z.infer<typeof SmtpTestSendSchema>;

export type TenantUserRow = {
  id: string;
  tipo_registro: 'USUARIO' | 'INVITACION';
  nombre_completo: string;
  email: string;
  rol: z.infer<typeof UserRoleSchema>;
  sucursal_id?: string | null;
  sucursal_nombre?: string | null;
  estatus: 'ACTIVO' | 'INACTIVO' | 'PENDIENTE' | 'REVOCADA' | 'EXPIRADA';
  auth_provider: 'GOOGLE' | 'EMAIL' | 'BOTH' | 'INVITACION';
  created_at: string;
  expira_en: string | null;
};

export const CreateSuperAdminRequestSchema = z.object({
  nombre_completo: safeSanitizedTextSchema({
    min: 2,
    max: 150,
    minMessage: 'El nombre completo debe tener al menos 2 caracteres',
    maxMessage: 'El nombre completo no puede exceder 150 caracteres',
    injectionMessage:
      'El nombre completo contiene caracteres o código no permitido',
  }),
  email: safeEmailSchema(
    'Ingresa un correo electrónico válido vinculado a Google Auth',
    150,
  ),
});

export type CreateSuperAdminRequest = z.infer<
  typeof CreateSuperAdminRequestSchema
>;

export const UpdateSuperAdminRequestSchema = z
  .object({
    activo: z.boolean().optional(),
    nombre_completo: safeSanitizedTextSchema({
      min: 2,
      max: 150,
      minMessage: 'El nombre completo debe tener al menos 2 caracteres',
      maxMessage: 'El nombre completo no puede exceder 150 caracteres',
      injectionMessage:
        'El nombre completo contiene caracteres o código no permitido',
    }).optional(),
  })
  .refine(
    (data) => data.activo !== undefined || data.nombre_completo !== undefined,
    { message: 'Especifica al menos un campo a actualizar' },
  );

export type UpdateSuperAdminRequest = z.infer<
  typeof UpdateSuperAdminRequestSchema
>;

export type SuperAdminRow = {
  id: string;
  nombre_completo: string;
  email: string;
  activo: boolean;
  auth_provider: AuthProvider;
  ultimo_acceso_en: string | null;
  created_at: string;
  es_bootstrap: boolean;
};
