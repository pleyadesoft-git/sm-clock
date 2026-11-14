import { z } from 'zod';
import {
  containsCodeInjectionPattern,
  safeEmailSchema,
  safeSanitizedTextSchema,
  sanitizeSearchQuery,
  sanitizeTextInput,
} from './sanitize';

export const TenantStatusSchema = z.enum([
  'ACTIVO',
  'PRUEBA',
  'SUSPENDIDO',
  'CANCELADO',
]);
export type TenantStatus = z.infer<typeof TenantStatusSchema>;

export const PlanCodigoSchema = z.enum([
  'MICRO',
  'PYME',
  'INDUSTRIAL',
  'CORPORATIVO',
]);
export type PlanCodigo = z.infer<typeof PlanCodigoSchema>;

export const ZonaHorariaMexicoSchema = z.enum([
  'America/Tijuana',
  'America/Hermosillo',
  'America/Mazatlan',
  'America/Chihuahua',
  'America/Ciudad_Juarez',
  'America/Monterrey',
  'America/Mexico_City',
  'America/Cancun',
]);
export type ZonaHorariaMexico = z.infer<typeof ZonaHorariaMexicoSchema>;

const RFC_REGEX = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/;
const CODIGO_POSTAL_REGEX = /^\d{5}$/;
const TENANT_CODE_REGEX = /^[A-Z0-9-]{3,20}$/;
const USO_CFDI_REGEX = /^[A-Z0-9]{3,5}$/;
const TELEFONO_REGEX = /^[0-9+()\-.\s]{7,30}$/;

const OptionalSanitizedTenantField = (
  maxLength: number,
  fieldLabel: string,
  allowNewlines = false,
) =>
  z
    .string()
    .refine((val) => !containsCodeInjectionPattern(val), {
      message: `${fieldLabel} contiene caracteres o código no permitido`,
    })
    .transform((val) => {
      const cleaned = sanitizeTextInput(val, { allowNewlines });
      return cleaned.length > 0 ? cleaned : null;
    })
    .refine((val) => val === null || val.length <= maxLength, {
      message: `Máximo ${maxLength} caracteres`,
    })
    .nullable()
    .optional();

export const InitialTenantAdminSchema = z.object({
  nombre_completo: safeSanitizedTextSchema({
    min: 3,
    max: 150,
    minMessage:
      'El nombre completo del Administrador inicial es obligatorio',
    maxMessage: 'Máximo 150 caracteres',
    injectionMessage:
      'El nombre del Administrador contiene caracteres o código no permitido',
  }),
  email: safeEmailSchema(
    'Ingresa un correo electrónico válido para Google Auth',
    150,
  ),
});

export type InitialTenantAdminInput = z.infer<typeof InitialTenantAdminSchema>;

export const TenantBaseSchema = z.object({
  tenant_code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(
      TENANT_CODE_REGEX,
      'El código debe tener entre 3 y 20 caracteres alfanuméricos o guiones (ej. TIJ-001)',
    ),
  nombre_comercial: safeSanitizedTextSchema({
    min: 2,
    max: 150,
    minMessage: 'El nombre comercial es obligatorio',
    maxMessage: 'Máximo 150 caracteres',
    injectionMessage:
      'El nombre comercial contiene caracteres o código no permitido',
  }),
  razon_social: safeSanitizedTextSchema({
    min: 3,
    max: 200,
    minMessage: 'La razón social es obligatoria',
    maxMessage: 'Máximo 200 caracteres',
    injectionMessage:
      'La razón social contiene caracteres o código no permitido',
  }),
  rfc: z
    .string()
    .trim()
    .toUpperCase()
    .regex(RFC_REGEX, 'RFC inválido (12 o 13 caracteres alfanuméricos)'),
  regimen_fiscal: z
    .string()
    .trim()
    .regex(
      /^\d{3}$/,
      'El régimen fiscal debe ser una clave SAT de 3 dígitos (ej. 601)',
    ),
  codigo_postal_fiscal: z
    .string()
    .trim()
    .regex(CODIGO_POSTAL_REGEX, 'El código postal debe tener 5 dígitos'),
  uso_cfdi: z
    .string()
    .trim()
    .toUpperCase()
    .regex(USO_CFDI_REGEX, 'Clave de uso CFDI inválida')
    .default('G03'),
  correo_facturacion: safeEmailSchema('Correo de facturación inválido', 150)
    .nullable()
    .optional(),
  contacto_nombre: OptionalSanitizedTenantField(150, 'El nombre de contacto'),
  contacto_email: safeEmailSchema('Correo de contacto inválido', 150)
    .nullable()
    .optional(),
  contacto_telefono: z
    .string()
    .trim()
    .max(30, 'Máximo 30 caracteres')
    .refine(
      (val) => val.length === 0 || TELEFONO_REGEX.test(val),
      'Teléfono de contacto inválido (solo dígitos, espacios y + - ( ))',
    )
    .transform((val) => (val.length > 0 ? sanitizeTextInput(val) : null))
    .nullable()
    .optional(),
  notas_internas: OptionalSanitizedTenantField(
    1000,
    'Las notas internas',
    true,
  ),
  plan_codigo: PlanCodigoSchema.default('MICRO'),
  estatus: TenantStatusSchema.default('ACTIVO'),
  zona_horaria: ZonaHorariaMexicoSchema.default('America/Tijuana'),
  logo_url: z
    .string()
    .trim()
    .url('URL de logo inválida')
    .refine((val) => val.startsWith('https://'), {
      message: 'La URL del logo debe usar protocolo seguro HTTPS',
    })
    .nullable()
    .optional(),
});

export const TenantCreateSchema = TenantBaseSchema.extend({
  admin_inicial: InitialTenantAdminSchema.optional(),
});

export type TenantCreateInput = z.infer<typeof TenantCreateSchema>;

export const TenantCreateWithAdminSchema = TenantBaseSchema.extend({
  admin_inicial: InitialTenantAdminSchema,
});

export type TenantCreateWithAdminInput = z.infer<
  typeof TenantCreateWithAdminSchema
>;

export const TenantUpdateSchema = TenantBaseSchema.partial();
export type TenantUpdateInput = z.infer<typeof TenantUpdateSchema>;

export const TenantRecordSchema = TenantBaseSchema.extend({
  id: z.string().uuid(),
  deleted_at: z.string().datetime({ offset: true }).nullable(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});

export type TenantRecord = z.infer<typeof TenantRecordSchema>;

export const TenantListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(20),
  search: z
    .string()
    .max(100)
    .transform((val) => sanitizeSearchQuery(val, 100))
    .optional(),
  estatus: TenantStatusSchema.optional(),
  plan_codigo: PlanCodigoSchema.optional(),
  sortBy: z
    .enum([
      'nombre_comercial',
      'tenant_code',
      'rfc',
      'plan_codigo',
      'estatus',
      'zona_horaria',
      'created_at',
    ])
    .default('created_at'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});

export type TenantListQuery = z.infer<typeof TenantListQuerySchema>;

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
