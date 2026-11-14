import { z } from 'zod';

export const EstatusEmpleadoSchema = z.enum(['A', 'I']);
export type EstatusEmpleado = z.infer<typeof EstatusEmpleadoSchema>;

export const SucursalCreateSchema = z.object({
  clave: z
    .string()
    .trim()
    .min(2, 'La clave de sucursal es obligatoria')
    .max(30)
    .regex(
      /^[A-Z0-9_-]+$/i,
      'Solo letras, números, guion y guion bajo en la clave',
    ),
  nombre: z
    .string()
    .trim()
    .min(2, 'El nombre de la sucursal es obligatorio')
    .max(120),
  direccion: z.string().trim().max(250).nullable().optional(),
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
    .max(30),
  nombre_completo: z
    .string()
    .trim()
    .min(3, 'El nombre completo del empleado es obligatorio')
    .max(150),
  credencial: z.string().trim().max(50).nullable().optional(),
  departamento: z.string().trim().max(100).nullable().optional(),
  puesto: z.string().trim().max(100).nullable().optional(),
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
