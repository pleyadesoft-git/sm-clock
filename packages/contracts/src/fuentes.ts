import { z } from 'zod';

/**
 * Función pura para formatear la nomenclatura de un reloj checador:
 * [Código de tenant]-[Código de la Sucursal]-[Consecutivo]
 * Ejemplo: TIJ001-MATRIZ-01
 */
export function generateFuenteNomenclature({
  tenantCode,
  sucursalClave,
  consecutivo,
}: {
  tenantCode: string;
  sucursalClave: string;
  consecutivo: number;
}): string {
  const cleanTenant = tenantCode.trim().toUpperCase();
  const cleanSucursal = sucursalClave.trim().toUpperCase();
  const num = String(Math.max(1, Math.floor(consecutivo))).padStart(2, '0');
  return `${cleanTenant}-${cleanSucursal}-${num}`;
}

export function parseFuenteNomenclature(clave: string): {
  tenantCode: string;
  sucursalClave: string;
  consecutivo: number;
} | null {
  const parts = clave.trim().split('-');
  if (parts.length < 3) return null;
  const numPart = parts[parts.length - 1];
  if (!numPart) return null;
  const num = parseInt(numPart, 10);
  if (isNaN(num)) return null;
  const tenantCode = parts[0];
  if (!tenantCode) return null;
  const sucursalClave = parts.slice(1, -1).join('-');
  return {
    tenantCode,
    sucursalClave,
    consecutivo: num,
  };
}

export const MarcaFuenteSchema = z.enum(['ZKTECO', 'HIKVISION', 'TACLOUD']);
export type MarcaFuente = z.infer<typeof MarcaFuenteSchema>;

export const FuenteAsistenciaSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  sucursal_id: z.string().uuid().nullable().optional(),
  clave: z.string().nullable().optional(),
  consecutivo_sucursal: z.number().int().nullable().optional(),
  nombre_ubicacion: z.string().min(2, 'El nombre debe tener al menos 2 caracteres'),
  marca: MarcaFuenteSchema,
  modelo: z.string().nullable().optional(),
  ip_local: z.string().nullable().optional(),
  puerto: z.number().int().min(1).max(65535).default(4370),
  usuario_dispositivo: z.string().nullable().optional(),
  activo: z.boolean().default(true),
  ultima_conexion_exitosa: z.string().nullable().optional(),
  ultimo_error: z.string().nullable().optional(),
  created_at: z.string().optional(),
});
export type FuenteAsistencia = z.infer<typeof FuenteAsistenciaSchema>;

export const FuenteAltaSchema = z.object({
  id: z.string().uuid().optional(),
  sucursal_id: z.string().uuid({ message: 'La sucursal es obligatoria para dar de alta el reloj' }),
  nombre_ubicacion: z.string().min(2, 'El nombre debe tener al menos 2 caracteres'),
  marca: MarcaFuenteSchema,
  modelo: z.string().optional().nullable(),
  ip_local: z.string().min(1, 'La dirección IP o host es obligatoria'),
  puerto: z.number().int().min(1).max(65535).default(4370),
  comm_key: z.number().int().min(0).default(0),
  usuario_dispositivo: z.string().optional().default('admin'),
  password_dispositivo: z.string().optional(),
  activo: z.boolean().default(true),
  clave: z.string().optional(),
});
export type FuenteAltaInput = z.input<typeof FuenteAltaSchema>;
export type FuenteAltaOutput = z.output<typeof FuenteAltaSchema>;
