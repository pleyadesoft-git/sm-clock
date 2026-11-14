import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import {
  checkAndRecordMemoryNonce,
  checkRateLimit,
  computeAgentHmacSignature,
  generateAgentToken,
  generateEnrollmentCode,
  sha256Hex,
  verifyAgentHmacSignature,
} from './agent-auth';

describe('Agent Authentication & HMAC-SHA256 Security', () => {
  it('generates formatted enrollment codes and 256-bit agent tokens with SHA-256 hashes', () => {
    const enroll = generateEnrollmentCode();
    expect(enroll.plainCode).toMatch(/^ENROL-[0-9A-F]{6}-[0-9A-F]{6}-[0-9A-F]{6}$/);
    expect(enroll.codeHash).toBe(sha256Hex(enroll.plainCode));

    const token = generateAgentToken();
    expect(token.plainToken).toMatch(/^agt_live_[0-9a-f]{64}$/);
    expect(token.tokenHash).toBe(sha256Hex(token.plainToken));
  });

  it('verifies valid HMAC-SHA256 signatures and rejects tampered payloads or expired timestamps', () => {
    const token = generateAgentToken();
    const nowSeconds = 1_763_050_000;
    const timestamp = String(nowSeconds - 15);
    const nonce = 'nonce_9988776655443322';
    const rawBody = JSON.stringify({ lote_id: 'lote-1', checadas: [] });

    const signatureHex = computeAgentHmacSignature({
      tokenHash: token.tokenHash,
      timestamp,
      nonce,
      rawBody,
    });

    const valid = verifyAgentHmacSignature({
      tokenHash: token.tokenHash,
      timestamp,
      nonce,
      rawBody,
      signatureHex,
      nowSeconds,
    });
    expect(valid.ok).toBe(true);

    // Payload modificado
    const tampered = verifyAgentHmacSignature({
      tokenHash: token.tokenHash,
      timestamp,
      nonce,
      rawBody: JSON.stringify({ lote_id: 'lote-hacked', checadas: [] }),
      signatureHex,
      nowSeconds,
    });
    expect(tampered.ok).toBe(false);

    // Timestamp fuera de ventana (>300s)
    const expired = verifyAgentHmacSignature({
      tokenHash: token.tokenHash,
      timestamp: String(nowSeconds - 450),
      nonce,
      rawBody,
      signatureHex,
      nowSeconds,
    });
    expect(expired.ok).toBe(false);
  });

  it('blocks replay nonces and enforces rate limits', () => {
    const agentId = '11111111-0004-4000-8000-000000000001';
    const nonce = 'nonce_unique_test_123456';
    const nowMs = 1_763_050_000_000;

    expect(checkAndRecordMemoryNonce(agentId, nonce, nowMs)).toBe(true);
    expect(checkAndRecordMemoryNonce(agentId, nonce, nowMs + 1000)).toBe(false);

    const rateKey = 'test-rate-key';
    expect(checkRateLimit(rateKey, 2, nowMs)).toBe(true);
    expect(checkRateLimit(rateKey, 2, nowMs + 100)).toBe(true);
    expect(checkRateLimit(rateKey, 2, nowMs + 200)).toBe(false);
  });
});
