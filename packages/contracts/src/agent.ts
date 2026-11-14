import { z } from 'zod';

export const TipoMarcaSchema = z.enum(['ENTRADA', 'SALIDA', 'CHECADA']);
export type TipoMarca = z.infer<typeof TipoMarcaSchema>;

export const TipoVerificacionSchema = z.enum([
  'HUELLA',
  'ROSTRO',
  'TARJETA',
  'API',
  'PIN',
]);
export type TipoVerificacion = z.infer<typeof TipoVerificacionSchema>;

export const AgentEnrollRequestSchema = z.object({
  codigo_enrolamiento: z
    .string()
    .trim()
    .min(12, 'El código de enrolamiento es inválido')
    .max(128),
  nombre_agente: z
    .string()
    .trim()
    .min(2, 'El nombre del agente es obligatorio')
    .max(120),
  version: z.string().trim().min(1).max(40),
  hostname: z.string().trim().min(1).max(120).optional(),
});
export type AgentEnrollRequest = z.infer<typeof AgentEnrollRequestSchema>;

export const AgentEnrollResponseSchema = z.object({
  agente_id: z.uuid(),
  credencial_token: z.string().min(32),
  tenant_id: z.uuid(),
  zona_horaria: z.string().min(3),
});
export type AgentEnrollResponse = z.infer<typeof AgentEnrollResponseSchema>;

export const AgentFuenteEstadoSchema = z.object({
  fuente_id: z.uuid(),
  conectado: z.boolean(),
  ultimo_error: z.string().max(500).nullable().optional(),
});
export type AgentFuenteEstado = z.infer<typeof AgentFuenteEstadoSchema>;

export const AgentHeartbeatSchema = z.object({
  version: z.string().trim().min(1).max(40),
  ts_local_agente: z.string().trim().min(10).max(45),
  cola_pendiente: z.number().int().min(0).max(1_000_000),
  fuentes_estado: z.array(AgentFuenteEstadoSchema).max(100).default([]),
});
export type AgentHeartbeat = z.infer<typeof AgentHeartbeatSchema>;

export const ChecadaItemSchema = z.object({
  fuente_id: z.uuid(),
  codigo_empleado: z.string().trim().min(1).max(30),
  ts_utc: z.iso.datetime({ offset: true }),
  ts_dispositivo_local: z
    .string()
    .trim()
    .regex(
      /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/,
      'Formato esperado YYYY-MM-DD HH:MM:SS',
    ),
  ambigua: z.boolean().default(false),
  tipo_marca: TipoMarcaSchema.default('CHECADA'),
  tipo_verificacion: TipoVerificacionSchema.nullable().optional(),
});
export type ChecadaItem = z.infer<typeof ChecadaItemSchema>;

export const AgentChecadasBatchSchema = z.object({
  lote_id: z.string().trim().min(1).max(80),
  checadas: z
    .array(ChecadaItemSchema)
    .min(1, 'El lote debe incluir al menos una checada')
    .max(500, 'El lote no puede exceder 500 checadas'),
});
export type AgentChecadasBatch = z.infer<typeof AgentChecadasBatchSchema>;

export const AgentSignedHeadersSchema = z.object({
  'x-agent-id': z.uuid(),
  'x-agent-timestamp': z.string().regex(/^\d{10,13}$/),
  'x-agent-nonce': z.string().min(16).max(128),
  'x-agent-signature': z.string().regex(/^[0-9a-f]{64}$/i),
});
export type AgentSignedHeaders = z.infer<typeof AgentSignedHeadersSchema>;

export const AdminCreateEnrollmentCodeSchema = z.object({
  tenant_id: z.uuid(),
  ttl_minutos: z.number().int().min(5).max(1440).default(30),
});
export type AdminCreateEnrollmentCodeInput = z.infer<
  typeof AdminCreateEnrollmentCodeSchema
>;

function formatEpochInTimeZone(epochMs: number, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = formatter.formatToParts(new Date(epochMs));
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      map[part.type] = part.value;
    }
  }
  return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}:${map.second}`;
}

function parseWallClockToNaiveUtcMs(wallClock: string): number {
  const normalized = wallClock.trim().replace('T', ' ');
  const match =
    /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(normalized);
  if (!match) {
    throw new Error(`Timestamp local inválido: ${wallClock}`);
  }
  const [, y, m, d, hh, mm, ss] = match;
  return Date.UTC(
    Number(y),
    Number(m) - 1,
    Number(d),
    Number(hh),
    Number(mm),
    Number(ss),
  );
}

/**
 * Convierte el timestamp local del reloj (ej. '2026-11-01 01:30:00') en la zona
 * horaria del sitio (por defecto 'America/Tijuana') a UTC ISO-8601 y detecta
 * automáticamente si cae en la hora repetida del cambio de horario de otoño (`ambigua = true`).
 */
export function resolveDeviceTimestampToUtc(
  tsDispositivoLocal: string,
  timeZone = 'America/Tijuana',
  fold: 0 | 1 = 0,
): {
  ts_utc: string;
  ts_dispositivo_local: string;
  ambigua: boolean;
} {
  const normalized = tsDispositivoLocal.trim().replace('T', ' ');
  const naiveUtcMs = parseWallClockToNaiveUtcMs(normalized);

  // Explorar desplazamientos horarios posibles respecto a UTC (-12h a +14h en pasos de 15 min)
  const matchingUtcInstants: number[] = [];
  for (let offsetMinutes = -14 * 60; offsetMinutes <= 12 * 60; offsetMinutes += 15) {
    const candidateUtcMs = naiveUtcMs + offsetMinutes * 60_000;
    const formatted = formatEpochInTimeZone(candidateUtcMs, timeZone);
    if (formatted === normalized) {
      matchingUtcInstants.push(candidateUtcMs);
    }
  }

  matchingUtcInstants.sort((a, b) => a - b);

  if (matchingUtcInstants.length === 0) {
    // Caso de hora inexistente en salto de primavera: usar aproximación por diferencia
    const probeOffsetMs =
      naiveUtcMs - parseWallClockToNaiveUtcMs(formatEpochInTimeZone(naiveUtcMs, timeZone));
    return {
      ts_utc: new Date(naiveUtcMs + probeOffsetMs).toISOString(),
      ts_dispositivo_local: normalized,
      ambigua: false,
    };
  }

  const ambigua = matchingUtcInstants.length > 1;
  const firstInstant = matchingUtcInstants[0] ?? naiveUtcMs;
  const selectedInstant =
    ambigua && fold === 1
      ? (matchingUtcInstants[1] ?? firstInstant)
      : firstInstant;

  return {
    ts_utc: new Date(selectedInstant).toISOString(),
    ts_dispositivo_local: normalized,
    ambigua,
  };
}

/**
 * Exporta los contratos del agente a JSON Schema estándar para validación cruzada con Python.
 */
export function getAgentContractsJsonSchema(): Record<string, unknown> {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'SMClockAgentContracts',
    definitions: {
      AgentEnrollRequest: z.toJSONSchema(AgentEnrollRequestSchema),
      AgentEnrollResponse: z.toJSONSchema(AgentEnrollResponseSchema),
      AgentHeartbeat: z.toJSONSchema(AgentHeartbeatSchema),
      AgentChecadasBatch: z.toJSONSchema(AgentChecadasBatchSchema),
      AgentSignedHeaders: z.toJSONSchema(AgentSignedHeadersSchema),
    },
  };
}
