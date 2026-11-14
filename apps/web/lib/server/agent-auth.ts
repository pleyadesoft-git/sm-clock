import 'server-only';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { AgentSignedHeadersSchema } from '@sm-clock/contracts';
import { createSupabaseAdminClient } from './supabase-admin';

const MAX_TIMESTAMP_DRIFT_SECONDS = 300;
const RATE_LIMIT_WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 120;

// Caché en memoria para nonces recientes y rate-limit por agente/IP
const seenNoncesMemory = new Map<string, number>();
const rateLimitCounters = new Map<string, { count: number; resetAt: number }>();

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

export function generateEnrollmentCode(): {
  plainCode: string;
  codeHash: string;
} {
  const randomPart = randomBytes(9).toString('hex').toUpperCase();
  const formatted = `ENROL-${randomPart.slice(0, 6)}-${randomPart.slice(6, 12)}-${randomPart.slice(12, 18)}`;
  return {
    plainCode: formatted,
    codeHash: sha256Hex(formatted),
  };
}

export function generateAgentToken(): {
  plainToken: string;
  tokenHash: string;
} {
  const plainToken = `agt_live_${randomBytes(32).toString('hex')}`;
  return {
    plainToken,
    tokenHash: sha256Hex(plainToken),
  };
}

/**
 * Calcula la firma HMAC-SHA256 usando `tokenHash` como llave compartida derivada
 * sobre el mensaje canónico `${timestamp}.${nonce}.${rawBody}`.
 */
export function computeAgentHmacSignature(params: {
  tokenHash: string;
  timestamp: string;
  nonce: string;
  rawBody: string;
}): string {
  const canonical = `${params.timestamp}.${params.nonce}.${params.rawBody}`;
  return createHmac('sha256', params.tokenHash)
    .update(canonical, 'utf8')
    .digest('hex');
}

export function verifyAgentHmacSignature(params: {
  tokenHash: string;
  timestamp: string;
  nonce: string;
  rawBody: string;
  signatureHex: string;
  nowSeconds?: number;
}): { ok: true } | { ok: false; reason: string } {
  const nowSec = params.nowSeconds ?? Math.floor(Date.now() / 1000);
  const tsNum = Number(params.timestamp);
  if (!Number.isFinite(tsNum)) {
    return { ok: false, reason: 'Timestamp inválido' };
  }

  // Soportar segundos o milisegundos
  const tsSeconds = tsNum > 1e11 ? Math.floor(tsNum / 1000) : tsNum;
  if (Math.abs(nowSec - tsSeconds) > MAX_TIMESTAMP_DRIFT_SECONDS) {
    return {
      ok: false,
      reason: 'Timestamp fuera de la ventana permitida (±300s)',
    };
  }

  const expectedHex = computeAgentHmacSignature({
    tokenHash: params.tokenHash,
    timestamp: params.timestamp,
    nonce: params.nonce,
    rawBody: params.rawBody,
  });

  const expectedBuf = Buffer.from(expectedHex, 'hex');
  const providedBuf = Buffer.from(params.signatureHex.toLowerCase(), 'hex');

  if (
    expectedBuf.length !== providedBuf.length ||
    !timingSafeEqual(expectedBuf, providedBuf)
  ) {
    return { ok: false, reason: 'Firma HMAC inválida' };
  }

  return { ok: true };
}

export function checkRateLimit(
  key: string,
  maxRequests = MAX_REQUESTS_PER_WINDOW,
  nowMs = Date.now(),
): boolean {
  const current = rateLimitCounters.get(key);
  if (!current || nowMs >= current.resetAt) {
    rateLimitCounters.set(key, {
      count: 1,
      resetAt: nowMs + RATE_LIMIT_WINDOW_MS,
    });
    return true;
  }

  if (current.count >= maxRequests) {
    return false;
  }

  current.count += 1;
  return true;
}

function purgeExpiredMemoryNonces(nowMs: number): void {
  for (const [key, expiresAt] of seenNoncesMemory.entries()) {
    if (nowMs >= expiresAt) {
      seenNoncesMemory.delete(key);
    }
  }
}

export function checkAndRecordMemoryNonce(
  agentId: string,
  nonce: string,
  nowMs = Date.now(),
): boolean {
  purgeExpiredMemoryNonces(nowMs);
  const compositeKey = `${agentId}:${nonce}`;
  if (seenNoncesMemory.has(compositeKey)) {
    return false;
  }
  seenNoncesMemory.set(
    compositeKey,
    nowMs + (MAX_TIMESTAMP_DRIFT_SECONDS + 60) * 1000,
  );
  return true;
}

export interface AuthenticatedAgentContext {
  agenteId: string;
  tenantId: string;
  nombreAgente: string;
}

/**
 * Autentica una petición firmada del Agente Local Python.
 * - Verifica rate limit
 * - Valida cabeceras con Zod
 * - Verifica Bearer token contra `agentes.token_hash` y que `revocado_en` sea null
 * - Verifica firma HMAC-SHA256 y ventana temporal (±300s)
 * - Registra nonce anti-replay en memoria y en `public.agente_nonces`
 */
export async function authenticateAgentRequest(
  request: Request,
  rawBody: string,
): Promise<
  | { ok: true; agent: AuthenticatedAgentContext }
  | { ok: false; status: number; message: string }
> {
  const headerObj = {
    'x-agent-id': request.headers.get('x-agent-id') ?? '',
    'x-agent-timestamp': request.headers.get('x-agent-timestamp') ?? '',
    'x-agent-nonce': request.headers.get('x-agent-nonce') ?? '',
    'x-agent-signature': request.headers.get('x-agent-signature') ?? '',
  };

  const parsedHeaders = AgentSignedHeadersSchema.safeParse(headerObj);
  if (!parsedHeaders.success) {
    return {
      ok: false,
      status: 401,
      message: 'Cabeceras de autenticación del agente inválidas o incompletas',
    };
  }

  const agentId = parsedHeaders.data['x-agent-id'];
  if (!checkRateLimit(`agent:${agentId}`)) {
    return {
      ok: false,
      status: 429,
      message: 'Límite de peticiones excedido para este agente',
    };
  }

  const authHeader = request.headers.get('authorization') ?? '';
  const bearerToken = authHeader.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length).trim()
    : '';
  if (!bearerToken) {
    return {
      ok: false,
      status: 401,
      message: 'Falta token Bearer del agente',
    };
  }

  const providedTokenHash = sha256Hex(bearerToken);
  const admin = createSupabaseAdminClient();

  const { data: agentRow, error: agentError } = await admin
    .from('agentes')
    .select('id, tenant_id, nombre, token_hash, revocado_en')
    .eq('id', agentId)
    .single();

  if (agentError || !agentRow) {
    return {
      ok: false,
      status: 401,
      message: 'Agente no encontrado',
    };
  }

  if (agentRow.revocado_en !== null) {
    return {
      ok: false,
      status: 403,
      message: 'La credencial de este agente ha sido revocada',
    };
  }

  const storedHashBuf = Buffer.from(agentRow.token_hash, 'utf8');
  const providedHashBuf = Buffer.from(providedTokenHash, 'utf8');
  if (
    storedHashBuf.length !== providedHashBuf.length ||
    !timingSafeEqual(storedHashBuf, providedHashBuf)
  ) {
    return {
      ok: false,
      status: 401,
      message: 'Credencial del agente inválida',
    };
  }

  const hmacVerification = verifyAgentHmacSignature({
    tokenHash: agentRow.token_hash,
    timestamp: parsedHeaders.data['x-agent-timestamp'],
    nonce: parsedHeaders.data['x-agent-nonce'],
    rawBody,
    signatureHex: parsedHeaders.data['x-agent-signature'],
  });

  if (!hmacVerification.ok) {
    return {
      ok: false,
      status: 401,
      message: hmacVerification.reason,
    };
  }

  // Anti-replay en memoria
  const nonce = parsedHeaders.data['x-agent-nonce'];
  if (!checkAndRecordMemoryNonce(agentRow.id, nonce)) {
    return {
      ok: false,
      status: 409,
      message: 'Nonce repetido detectado (anti-replay)',
    };
  }

  // Anti-replay persistente en base de datos
  const expiresAtIso = new Date(
    Date.now() + (MAX_TIMESTAMP_DRIFT_SECONDS + 60) * 1000,
  ).toISOString();

  const { error: nonceError } = await admin.from('agente_nonces').insert({
    agente_id: agentRow.id,
    nonce,
    expira_en: expiresAtIso,
  });

  if (nonceError) {
    return {
      ok: false,
      status: 409,
      message: 'Nonce repetido detectado en registro persistente (anti-replay)',
    };
  }

  return {
    ok: true,
    agent: {
      agenteId: agentRow.id,
      tenantId: agentRow.tenant_id,
      nombreAgente: agentRow.nombre,
    },
  };
}
