import { z } from 'zod';

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

export const InitialTenantAdminSchema = z.object({
  nombre_completo: z
    .string()
    .trim()
    .min(3, 'El nombre completo del Administrador inicial es obligatorio')
    .max(150, 'Máximo 150 caracteres'),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('Ingresa un correo electrónico válido para Google Auth'),
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
  nombre_comercial: z
    .string()
    .trim()
    .min(2, 'El nombre comercial es obligatorio')
    .max(150, 'Máximo 150 caracteres'),
  razon_social: z
    .string()
    .trim()
    .min(3, 'La razón social es obligatoria')
    .max(200, 'Máximo 200 caracteres'),
  rfc: z
    .string()
    .trim()
    .toUpperCase()
    .regex(RFC_REGEX, 'RFC inválido (12 o 13 caracteres alfanuméricos)'),
  regimen_fiscal: z
    .string()
    .trim()
    .regex(/^\d{3}$/, 'El régimen fiscal debe ser una clave SAT de 3 dígitos (ej. 601)'),
  codigo_postal_fiscal: z
    .string()
    .trim()
    .regex(CODIGO_POSTAL_REGEX, 'El código postal debe tener 5 dígitos'),
  uso_cfdi: z
    .string()
    .trim()
    .min(3, 'Clave de uso CFDI inválida')
    .max(10)
    .default('G03'),
  correo_facturacion: z
    .string()
    .trim()
    .email('Correo de facturación inválido')
    .nullable()
    .optional(),
  contacto_nombre: z
    .string()
    .trim()
    .max(150, 'Máximo 150 caracteres')
    .nullable()
    .optional(),
  contacto_email: z
    .string()
    .trim()
    .email('Correo de contacto inválido')
    .nullable()
    .optional(),
  contacto_telefono: z
    .string()
    .trim()
    .max(30, 'Máximo 30 caracteres')
    .nullable()
    .optional(),
  notas_internas: z
    .string()
    .trim()
    .max(1000, 'Máximo 1000 caracteres')
    .nullable()
    .optional(),
  plan_codigo: PlanCodigoSchema.default('MICRO'),
  estatus: TenantStatusSchema.default('ACTIVO'),
  zona_horaria: ZonaHorariaMexicoSchema.default('America/Tijuana'),
  logo_url: z.string().url('URL de logo inválida').nullable().optional(),
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
  search: z.string().trim().max(100).optional(),
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
