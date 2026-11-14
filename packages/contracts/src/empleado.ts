import { z } from 'zod';
import {
  containsCodeInjectionPattern,
  safeSanitizedTextSchema,
  sanitizeTextInput,
} from './sanitize';

export const EstatusEmpleadoSchema = z.enum(['A', 'I']);
export type EstatusEmpleado = z.infer<typeof EstatusEmpleadoSchema>;

const OptionalSanitizedString = (maxLength: number, fieldName: string) =>
  z
    .string()
    .refine((val) => !containsCodeInjectionPattern(val), {
      message: `${fieldName} contiene caracteres o código no permitido`,
    })
    .transform((val) => {
      const cleaned = sanitizeTextInput(val);
      return cleaned.length > 0 ? cleaned : null;
    })
    .refine((val) => val === null || val.length <= maxLength, {
      message: `${fieldName} no puede exceder ${maxLength} caracteres`,
    })
    .nullable()
    .optional();

export const SucursalCreateSchema = z.object({
  clave: z
    .string()
    .trim()
    .toUpperCase()
    .min(2, 'La clave de sucursal es obligatoria')
    .max(30)
    .regex(
      /^[A-Z0-9_-]+$/i,
      'Solo letras, números, guion y guion bajo en la clave',
    ),
  nombre: safeSanitizedTextSchema({
    min: 2,
    max: 120,
    minMessage: 'El nombre de la sucursal es obligatorio',
    maxMessage: 'El nombre de la sucursal no puede exceder 120 caracteres',
    injectionMessage:
      'El nombre de la sucursal contiene caracteres o código no permitido',
  }),
  direccion: OptionalSanitizedString(250, 'La dirección'),
  activa: z.boolean().default(true),
});
export type SucursalCreateInput = z.infer<typeof SucursalCreateSchema>;

export const SucursalUpdateSchema = SucursalCreateSchema.partial().extend({
  id: z.uuid(),
});
export type SucursalUpdateInput = z.infer<typeof SucursalUpdateSchema>;

export const EmpleadoCreateSchema = z.object({
  codigo_empleado: z
    .string()
    .trim()
    .min(1, 'El código de empleado es obligatorio')
    .max(30)
    .regex(
      /^[A-Za-z0-9._-]+$/,
      'El código de empleado solo puede contener letras, números, punto, guion y guion bajo',
    ),
  nombre_completo: safeSanitizedTextSchema({
    min: 3,
    max: 150,
    minMessage: 'El nombre completo del empleado es obligatorio',
    maxMessage: 'El nombre completo no puede exceder 150 caracteres',
    injectionMessage:
      'El nombre del empleado contiene caracteres o código no permitido',
  }),
  credencial: z
    .string()
    .trim()
    .max(50)
    .refine(
      (val) => val.length === 0 || /^[A-Za-z0-9._-]+$/.test(val),
      'La credencial solo puede contener letras, números, punto, guion y guion bajo',
    )
    .transform((val) => (val.length > 0 ? val : null))
    .nullable()
    .optional(),
  departamento: OptionalSanitizedString(100, 'El departamento'),
  puesto: OptionalSanitizedString(100, 'El puesto'),
  sucursal_id: z.uuid().nullable().optional(),
  estatus_empleado: EstatusEmpleadoSchema.default('A'),
});
export type EmpleadoCreateInput = z.infer<typeof EmpleadoCreateSchema>;

export const EmpleadoUpdateSchema = EmpleadoCreateSchema.partial().extend({
  id: z.uuid(),
});
export type EmpleadoUpdateInput = z.infer<typeof EmpleadoUpdateSchema>;

export const EmpleadoFotoParamsSchema = z.object({
  id: z.uuid(),
});
