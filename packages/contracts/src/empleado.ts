import { z } from 'zod';
import {
  containsCodeInjectionPattern,
  safeOptionalEmailSchema,
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

/**
 * Extrae latitud y longitud de una cadena pegada por el usuario:
 * - Coordenadas directas: "32.5435, -116.9355" o "32.5435 -116.9355"
 * - URLs de Google Maps con @lat,lng: "https://www.google.com/maps/place/.../@32.5435,-116.9355,17z/..."
 * - URLs de Google Maps con ?q=lat,lng o ll=lat,lng o !3dlat!4dlng
 */
export function parseGoogleMapsCoordinates(
  rawInput: string,
): { latitud: number; longitud: number } | null {
  const input = rawInput.trim();
  if (!input) return null;

  // 1. Formato !3d<lat>!4d<lng> de Google Maps (es el pin exacto del lugar, más preciso que el @viewport)
  const bangMatch = input.match(
    /!3d(-?\d{1,2}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/,
  );
  if (bangMatch && bangMatch[1] && bangMatch[2]) {
    const lat = Number(bangMatch[1]);
    const lng = Number(bangMatch[2]);
    if (isValidLatLng(lat, lng)) {
      return {
        latitud: Number(lat.toFixed(6)),
        longitud: Number(lng.toFixed(6)),
      };
    }
  }

  // 2. Formato @<lat>,<lng> en URLs de Google Maps
  const atMatch = input.match(
    /@(-?\d{1,2}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)/,
  );
  if (atMatch && atMatch[1] && atMatch[2]) {
    const lat = Number(atMatch[1]);
    const lng = Number(atMatch[2]);
    if (isValidLatLng(lat, lng)) {
      return {
        latitud: Number(lat.toFixed(6)),
        longitud: Number(lng.toFixed(6)),
      };
    }
  }

  // 3. Parámetros q=lat,lng, query=lat,lng, ll=lat,lng o center=lat,lng
  const queryMatch = input.match(
    /(?:[?&](?:q|query|ll|center|destination)=)(-?\d{1,2}(?:\.\d+)?)(?:%2C|,|\s)+(-?\d{1,3}(?:\.\d+)?)/i,
  );
  if (queryMatch && queryMatch[1] && queryMatch[2]) {
    const lat = Number(queryMatch[1]);
    const lng = Number(queryMatch[2]);
    if (isValidLatLng(lat, lng)) {
      return {
        latitud: Number(lat.toFixed(6)),
        longitud: Number(lng.toFixed(6)),
      };
    }
  }

  // 4. Coordenadas directas "32.5435, -116.9355"
  const directMatch = input.match(
    /^\s*\(?(-?\d{1,2}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)\)?\s*$/,
  );
  if (directMatch && directMatch[1] && directMatch[2]) {
    const lat = Number(directMatch[1]);
    const lng = Number(directMatch[2]);
    if (isValidLatLng(lat, lng)) {
      return {
        latitud: Number(lat.toFixed(6)),
        longitud: Number(lng.toFixed(6)),
      };
    }
  }

  return null;
}

export function isValidLatLng(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

/**
 * Calcula la distancia en metros entre dos coordenadas GPS mediante la fórmula de Haversine.
 */
export function calculateHaversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371000; // Radio terrestre medio en metros
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
}

export const LatitudSchema = z
  .number({
    error: 'La latitud es obligatoria y debe ser un número válido',
  })
  .min(-90, 'La latitud debe estar entre -90 y 90')
  .max(90, 'La latitud debe estar entre -90 y 90');

export const LongitudSchema = z
  .number({
    error: 'La longitud es obligatoria y debe ser un número válido',
  })
  .min(-180, 'La longitud debe estar entre -180 y 180')
  .max(180, 'La longitud debe estar entre -180 y 180');

export const OptionalLatitudSchema = z
  .union([LatitudSchema, z.null()])
  .optional();

export const OptionalLongitudSchema = z
  .union([LongitudSchema, z.null()])
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
  latitud: LatitudSchema,
  longitud: LongitudSchema,
  radio_geocerca_m: z.coerce
    .number()
    .int()
    .min(20, 'El radio mínimo de geocerca es de 20 metros')
    .max(10000, 'El radio máximo de geocerca es de 10,000 metros')
    .default(150),
  activa: z.boolean().default(true),
});
export type SucursalCreateInput = z.infer<typeof SucursalCreateSchema>;

export const SucursalUpdateSchema = SucursalCreateSchema.partial().extend({
  id: z.uuid(),
});
export type SucursalUpdateInput = z.infer<typeof SucursalUpdateSchema>;

export const OptionalUuidSchema = z
  .union([z.uuid(), z.literal(''), z.null()])
  .transform((val) => (val && val.length > 0 ? val : null))
  .nullable()
  .optional();

export const RequiredSucursalUuidSchema = z
  .string({
    error: 'Debes seleccionar una sucursal obligatoriamente',
  })
  .trim()
  .uuid('Selecciona una sucursal válida');

export const PinEmpleadoSchema = z
  .string({
    error: 'El PIN debe ser numérico de 6 dígitos',
  })
  .trim()
  .regex(/^\d{6}$/, 'El PIN debe ser estrictamente numérico de 6 dígitos');

export const OptionalPinEmpleadoSchema = z
  .union([
    z
      .string()
      .trim()
      .regex(/^\d{6}$/, 'El PIN debe ser estrictamente numérico de 6 dígitos'),
    z.literal(''),
  ])
  .transform((val) => (val && val.length > 0 ? val : null))
  .nullable()
  .optional()
  .default(null);

export const OptionalTelefonoWhatsappSchema = z
  .union([
    z
      .string()
      .trim()
      .regex(
        /^\+?[0-9]{10,15}$/,
        'Ingresa un teléfono WhatsApp válido de 10 a 15 dígitos (ej. +526641234567)',
      ),
    z.literal(''),
  ])
  .transform((val) => (val && val.length > 0 ? val : null))
  .nullable()
  .optional()
  .default(null);

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
  email: safeOptionalEmailSchema(
    'Ingresa un correo electrónico válido para el empleado',
    150,
  ),
  telefono_whatsapp: OptionalTelefonoWhatsappSchema,
  pin_codigo: OptionalPinEmpleadoSchema,
  biometria_facial_activa: z.boolean().default(false),
  webauthn_activo: z.boolean().default(false),
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
  sucursal_id: OptionalUuidSchema,
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

export const ValidarCodigoEmpleadoSchema = z.object({
  codigo: z
    .string()
    .trim()
    .min(1, 'El código de empleado es obligatorio')
    .max(30, 'El código de empleado no puede exceder 30 caracteres')
    .regex(
      /^[A-Za-z0-9._-]+$/,
      'El código de empleado solo puede contener letras, números, punto, guion y guion bajo',
    ),
  excludeId: OptionalUuidSchema,
});
export type ValidarCodigoEmpleadoInput = z.infer<
  typeof ValidarCodigoEmpleadoSchema
>;

export const ValidarCodigoEmpleadoResponseSchema = z.object({
  disponible: z.boolean(),
  codigo: z.string(),
  empleadoExistente: z
    .object({
      id: z.string(),
      nombre: z.string(),
      estatus: EstatusEmpleadoSchema,
    })
    .nullable(),
});
export type ValidarCodigoEmpleadoResponse = z.infer<
  typeof ValidarCodigoEmpleadoResponseSchema
>;

export const ValidarPinEmpleadoSchema = z.object({
  pin: PinEmpleadoSchema,
  excludeId: OptionalUuidSchema,
});
export type ValidarPinEmpleadoInput = z.infer<typeof ValidarPinEmpleadoSchema>;

export const ValidarPinEmpleadoResponseSchema = z.object({
  disponible: z.boolean(),
  pin: z.string(),
  empleadoExistente: z
    .object({
      id: z.string(),
      nombre: z.string(),
      codigo_empleado: z.string(),
      estatus: EstatusEmpleadoSchema,
    })
    .nullable(),
});
export type ValidarPinEmpleadoResponse = z.infer<
  typeof ValidarPinEmpleadoResponseSchema
>;

export const WebAuthnCredentialRegisterSchema = z.object({
  empleado_id: z.uuid(),
  credential_id: z
    .string()
    .trim()
    .min(8, 'Identificador de credencial WebAuthn inválido')
    .max(1024)
    .regex(/^[A-Za-z0-9_-]+$/, 'credential_id debe estar en formato Base64URL'),
  public_key: z
    .string()
    .trim()
    .min(16, 'Llave pública WebAuthn inválida')
    .max(4096),
  algoritmo: z.number().int().default(-7),
  nombre_dispositivo: safeSanitizedTextSchema({
    min: 2,
    max: 120,
    minMessage: 'Ingresa el nombre del dispositivo biométrico',
    maxMessage: 'Máximo 120 caracteres',
    injectionMessage: 'Nombre de dispositivo contiene caracteres no permitidos',
  }).default('Dispositivo Biométrico'),
  transports: z
    .array(z.enum(['internal', 'hybrid', 'usb', 'nfc', 'ble']))
    .default(['internal']),
});
export type WebAuthnCredentialRegisterInput = z.infer<
  typeof WebAuthnCredentialRegisterSchema
>;

export const KioskMetodoVerificacionSchema = z.enum([
  'PIN',
  'WEBAUTHN',
  'ROSTRO',
]);
export type KioskMetodoVerificacion = z.infer<
  typeof KioskMetodoVerificacionSchema
>;

export const KioskCheckInOutRequestSchema = z
  .object({
    tenant_code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9-]{3,20}$/, 'Código de empresa inválido (ej. TIJ-001)')
      .optional(),
    tipo_marca: z.enum(['ENTRADA', 'SALIDA']),
    metodo_verificacion: KioskMetodoVerificacionSchema,
    pin_codigo: z
      .string()
      .trim()
      .regex(/^\d{6}$/, 'El PIN debe ser de 6 dígitos numéricos')
      .optional(),
    codigo_empleado: z
      .string()
      .trim()
      .max(30)
      .regex(/^[A-Za-z0-9._-]+$/, 'Código de empleado inválido')
      .optional(),
    webauthn_assertion: z
      .object({
        credential_id: z
          .string()
          .trim()
          .min(8)
          .max(1024)
          .regex(/^[A-Za-z0-9_-]+$/),
        client_data_json: z.string().min(10).max(4096),
        authenticator_data: z.string().min(10).max(4096),
        signature: z.string().min(10).max(4096),
      })
      .optional(),
    rostro_verificacion: z
      .object({
        frame_base64: z.string().max(600000).optional(),
        similitud_score: z.number().min(0).max(1).optional(),
        rostro_detectado: z.boolean(),
      })
      .optional(),
    geolocalizacion: z.object({
      latitud: LatitudSchema,
      longitud: LongitudSchema,
      precision_m: z.number().min(0).max(50000).default(15),
    }),
  })
  .superRefine((val, ctx) => {
    if (val.metodo_verificacion === 'PIN' && !val.pin_codigo) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['pin_codigo'],
        message: 'Ingresa tu PIN de 6 dígitos para registrar tu asistencia',
      });
    }
    if (val.metodo_verificacion === 'WEBAUTHN' && !val.webauthn_assertion) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['webauthn_assertion'],
        message:
          'Se requiere la firma biométrica WebAuthn del dispositivo para continuar',
      });
    }
    if (val.metodo_verificacion === 'ROSTRO') {
      if (!val.rostro_verificacion || !val.rostro_verificacion.rostro_detectado) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['rostro_verificacion'],
          message:
            'No se pudo detectar el rostro frente a la cámara. Intenta de nuevo.',
        });
      }
    }
  });

export type KioskCheckInOutRequest = z.infer<
  typeof KioskCheckInOutRequestSchema
>;

export const KioskSelfEnrollWebAuthnSchema = z.object({
  tenant_code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{3,20}$/, 'Código de empresa inválido'),
  pin_codigo: PinEmpleadoSchema,
  credential_id: z
    .string()
    .trim()
    .min(8)
    .max(1024)
    .regex(/^[A-Za-z0-9_-]+$/),
  public_key: z.string().trim().min(16).max(4096),
  algoritmo: z.number().int().default(-7),
  nombre_dispositivo: safeSanitizedTextSchema({
    min: 2,
    max: 120,
    minMessage: 'Nombre de dispositivo requerido',
    maxMessage: 'Máximo 120 caracteres',
    injectionMessage: 'Caracteres no permitidos',
  }).default('Móvil / Tablet Personal'),
});
export type KioskSelfEnrollWebAuthnInput = z.infer<
  typeof KioskSelfEnrollWebAuthnSchema
>;
