import { z } from 'zod';
import {
  containsCodeInjectionPattern,
  safeSanitizedTextSchema,
  sanitizeTextInput,
} from './sanitize';
import { OptionalUuidSchema } from './empleado';

export const MensajeAlcanceSchema = z.enum([
  'EMPLEADO',
  'SUCURSAL',
  'DEPARTAMENTO',
  'TODOS',
]);
export type MensajeAlcance = z.infer<typeof MensajeAlcanceSchema>;

export const MensajeEventoDisparoSchema = z.enum([
  'ENTRADA',
  'SALIDA',
  'CUALQUIERA',
]);
export type MensajeEventoDisparo = z.infer<typeof MensajeEventoDisparoSchema>;

export const MensajeModoEntregaSchema = z.enum([
  'AUTO_FALLBACK',
  'SIEMPRE_CORREO',
  'SOLO_DISPOSITIVO',
]);
export type MensajeModoEntrega = z.infer<typeof MensajeModoEntregaSchema>;

export const MensajeRepeticionSchema = z.enum(['UNA_VEZ', 'SIEMPRE_VIGENTE']);
export type MensajeRepeticion = z.infer<typeof MensajeRepeticionSchema>;

export const MensajeCanalUtilizadoSchema = z.enum([
  'DISPOSITIVO',
  'AGENTE_AUDIO_VISUAL',
  'EMAIL_SMTP',
  'WHATSAPP_WEB',
  'SIN_CANAL',
]);
export type MensajeCanalUtilizado = z.infer<typeof MensajeCanalUtilizadoSchema>;

export const MensajeEstatusEntregaSchema = z.enum([
  'ENTREGADO_DISPOSITIVO',
  'ENTREGADO_EMAIL',
  'PENDIENTE_WHATSAPP_WEB',
  'SIN_CANAL_DISPONIBLE',
  'ERROR_ENVIO',
]);
export type MensajeEstatusEntrega = z.infer<typeof MensajeEstatusEntregaSchema>;

export interface PlantillaMensajeRh {
  id: string;
  titulo: string;
  mensaje: string;
  texto_voz_personalizado: string;
  evento_disparo: MensajeEventoDisparo;
}

export const PLANTILLAS_MENSAJES_RH: readonly PlantillaMensajeRh[] = [
  {
    id: 'firma-contrato',
    titulo: 'Firma de contrato en RH',
    mensaje: 'Pasar a RH a firmar contrato',
    texto_voz_personalizado:
      'Hola {nombre}, favor de pasar a Recursos Humanos a firmar tu contrato.',
    evento_disparo: 'ENTRADA',
  },
  {
    id: 'entrega-credencial',
    titulo: 'Entrega de credencial',
    mensaje: 'Favor de pasar a la Administración para entrega de credencial',
    texto_voz_personalizado:
      'Hola {nombre}, favor de pasar a la Administración para la entrega de tu credencial.',
    evento_disparo: 'CUALQUIERA',
  },
  {
    id: 'firma-nomina',
    titulo: 'Firma de recibo de nómina',
    mensaje: 'Pasar a RH a firmar recibos de nómina pendientes',
    texto_voz_personalizado:
      'Hola {nombre}, recuerda pasar a Recursos Humanos a firmar tus recibos de nómina.',
    evento_disparo: 'SALIDA',
  },
  {
    id: 'documentos-expediente',
    titulo: 'Actualización de expediente',
    mensaje: 'Favor de entregar documentación pendiente en Recursos Humanos',
    texto_voz_personalizado:
      'Hola {nombre}, te recordamos entregar tu documentación pendiente en Recursos Humanos.',
    evento_disparo: 'ENTRADA',
  },
  {
    id: 'entrega-uniforme',
    titulo: 'Entrega de uniforme / EPP',
    mensaje: 'Favor de pasar al almacén o RH por tu uniforme y equipo',
    texto_voz_personalizado:
      'Hola {nombre}, favor de pasar por tu uniforme y equipo de protección.',
    evento_disparo: 'SALIDA',
  },
] as const;

const OptionalVoiceTemplateSchema = z
  .string()
  .refine((val) => !containsCodeInjectionPattern(val), {
    message: 'El texto de voz contiene caracteres o código no permitido',
  })
  .transform((val) => {
    const cleaned = sanitizeTextInput(val);
    return cleaned.length > 0 ? cleaned : null;
  })
  .refine((val) => val === null || val.length <= 300, {
    message: 'El texto de voz personalizado no puede exceder 300 caracteres',
  })
  .nullable()
  .optional();

const OptionalDepartmentSchema = z
  .string()
  .refine((val) => !containsCodeInjectionPattern(val), {
    message: 'El departamento contiene caracteres no permitidos',
  })
  .transform((val) => {
    const cleaned = sanitizeTextInput(val);
    return cleaned.length > 0 ? cleaned : null;
  })
  .refine((val) => val === null || val.length <= 100, {
    message: 'El departamento no puede exceder 100 caracteres',
  })
  .nullable()
  .optional();

export const MensajeChecadaCreateSchema = z
  .object({
    titulo: safeSanitizedTextSchema({
      min: 3,
      max: 120,
      minMessage: 'El título del aviso es obligatorio (mínimo 3 caracteres)',
      maxMessage: 'El título no puede exceder 120 caracteres',
      injectionMessage: 'El título contiene caracteres o código no permitido',
    }),
    mensaje: safeSanitizedTextSchema({
      min: 4,
      max: 240,
      minMessage: 'El mensaje para el empleado es obligatorio',
      maxMessage:
        'El mensaje no puede exceder 240 caracteres para ser compatible con pantallas de relojes',
      injectionMessage: 'El mensaje contiene caracteres o código no permitido',
    }),
    texto_voz_personalizado: OptionalVoiceTemplateSchema,
    reproducir_audio: z.boolean().default(true),
    alcance: MensajeAlcanceSchema.default('EMPLEADO'),
    empleado_id: OptionalUuidSchema,
    sucursal_id: OptionalUuidSchema,
    departamento: OptionalDepartmentSchema,
    evento_disparo: MensajeEventoDisparoSchema.default('CUALQUIERA'),
    modo_entrega: MensajeModoEntregaSchema.default('AUTO_FALLBACK'),
    repeticion: MensajeRepeticionSchema.default('UNA_VEZ'),
    activo: z.boolean().default(true),
    vigente_hasta: z
      .union([z.string().trim(), z.null()])
      .transform((val) => (val && val.length > 0 ? val : null))
      .nullable()
      .optional(),
  })
  .superRefine((val, ctx) => {
    if (val.alcance === 'EMPLEADO' && !val.empleado_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['empleado_id'],
        message: 'Selecciona el empleado destinatario para el aviso individual',
      });
    }
    if (val.alcance === 'SUCURSAL' && !val.sucursal_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sucursal_id'],
        message: 'Selecciona la sucursal destinataria para el aviso masivo',
      });
    }
    if (
      val.alcance === 'DEPARTAMENTO' &&
      (!val.departamento || val.departamento.trim().length < 2)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['departamento'],
        message: 'Ingresa o selecciona el departamento para el aviso masivo',
      });
    }
  });

export type MensajeChecadaCreateInput = z.infer<
  typeof MensajeChecadaCreateSchema
>;

export const MensajeChecadaUpdateSchema = z.object({
  id: z.uuid(),
  titulo: safeSanitizedTextSchema({
    min: 3,
    max: 120,
    minMessage: 'El título del aviso es obligatorio',
    maxMessage: 'El título no puede exceder 120 caracteres',
    injectionMessage: 'El título contiene caracteres o código no permitido',
  }).optional(),
  mensaje: safeSanitizedTextSchema({
    min: 4,
    max: 240,
    minMessage: 'El mensaje es obligatorio',
    maxMessage: 'El mensaje no puede exceder 240 caracteres',
    injectionMessage: 'El mensaje contiene caracteres o código no permitido',
  }).optional(),
  texto_voz_personalizado: OptionalVoiceTemplateSchema,
  reproducir_audio: z.boolean().optional(),
  alcance: MensajeAlcanceSchema.optional(),
  empleado_id: OptionalUuidSchema,
  sucursal_id: OptionalUuidSchema,
  departamento: OptionalDepartmentSchema,
  evento_disparo: MensajeEventoDisparoSchema.optional(),
  modo_entrega: MensajeModoEntregaSchema.optional(),
  repeticion: MensajeRepeticionSchema.optional(),
  activo: z.boolean().optional(),
  vigente_hasta: z
    .union([z.string().trim(), z.null()])
    .transform((val) => (val && val.length > 0 ? val : null))
    .nullable()
    .optional(),
});

export type MensajeChecadaUpdateInput = z.infer<
  typeof MensajeChecadaUpdateSchema
>;

export const AgentTriggeredNotificationItemSchema = z.object({
  entrega_id: z.uuid().optional(),
  mensaje_id: z.uuid(),
  codigo_empleado: z.string().trim().min(1).max(30),
  nombre_empleado: z.string().trim().min(1).max(150),
  tipo_marca: z.enum(['ENTRADA', 'SALIDA', 'CHECADA']),
  titulo: z.string().trim().min(1).max(120),
  mensaje: z.string().trim().min(1).max(240),
  texto_voz: z.string().trim().min(1).max(400),
  reproducir_audio: z.boolean().default(true),
  canal_utilizado: MensajeCanalUtilizadoSchema,
  estatus_entrega: MensajeEstatusEntregaSchema,
  whatsapp_web_url: z.string().nullable().optional(),
  ts_utc: z.string(),
});
export type AgentTriggeredNotificationItem = z.infer<
  typeof AgentTriggeredNotificationItemSchema
>;

/**
 * Construye el texto dinámico personalizado para síntesis de voz (TTS)
 * reemplazando las variables `{nombre}`, `{codigo}`, `{mensaje}`, `{titulo}` y `{evento}`.
 */
export function buildPersonalizedVoiceText(params: {
  template?: string | null;
  nombreEmpleado: string;
  codigoEmpleado: string;
  titulo: string;
  mensaje: string;
  tipoMarca?: 'ENTRADA' | 'SALIDA' | 'CHECADA';
}): string {
  const primerNombre =
    params.nombreEmpleado.trim().split(/\s+/).slice(0, 2).join(' ') ||
    params.nombreEmpleado;
  const eventoLabel =
    params.tipoMarca === 'ENTRADA'
      ? 'registrar tu entrada'
      : params.tipoMarca === 'SALIDA'
        ? 'registrar tu salida'
        : 'registrar tu asistencia';

  const baseTemplate =
    params.template && params.template.trim().length > 0
      ? params.template.trim()
      : 'Hola {nombre}. Aviso de Recursos Humanos: {mensaje}';

  return baseTemplate
    .replace(/\{nombre\}/gi, primerNombre)
    .replace(/\{nombre_completo\}/gi, params.nombreEmpleado.trim())
    .replace(/\{codigo\}/gi, params.codigoEmpleado.trim())
    .replace(/\{titulo\}/gi, params.titulo.trim())
    .replace(/\{mensaje\}/gi, params.mensaje.trim())
    .replace(/\{evento\}/gi, eventoLabel);
}

/**
 * Genera el enlace directo a WhatsApp Web (`https://wa.me/<numero>?text=<mensaje>`)
 * para envío rápido sin licencia de WhatsApp Business API.
 */
export function buildWhatsAppWebUrl(params: {
  telefonoWhatsapp: string | null | undefined;
  nombreEmpleado: string;
  tenantNombre: string;
  titulo: string;
  mensaje: string;
  tipoMarca?: 'ENTRADA' | 'SALIDA' | 'CHECADA';
}): string | null {
  if (!params.telefonoWhatsapp) return null;
  const digits = params.telefonoWhatsapp.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) return null;

  // Si es número mexicano de 10 dígitos sin código de país, anteponer 52
  const normalizedPhone = digits.length === 10 ? `52${digits}` : digits;

  const marcaText =
    params.tipoMarca === 'ENTRADA'
      ? 'Check-In (Entrada)'
      : params.tipoMarca === 'SALIDA'
        ? 'Check-Out (Salida)'
        : 'Asistencia';

  const text = [
    `Hola *${params.nombreEmpleado.trim()}*,`,
    `Notificación de *${params.tenantNombre.trim()}* al registrar tu ${marcaText}:`,
    '',
    `📌 *${params.titulo.trim()}*`,
    params.mensaje.trim(),
  ].join('\n');

  return `https://wa.me/${normalizedPhone}?text=${encodeURIComponent(text)}`;
}
