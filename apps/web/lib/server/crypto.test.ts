import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { decryptCredentialSecret, encryptCredentialSecret } from './crypto';

const TEST_MASTER_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('AES-256-GCM Credential Envelope Encryption', () => {
  it('encrypts and decrypts secret for the same tenant and keyVersion', () => {
    const secret = 'ClaveRelojZKTeco#2026!';
    const payload = encryptCredentialSecret({
      plaintext: secret,
      tenantId: TENANT_A,
      masterKeyHex: TEST_MASTER_KEY,
      keyVersion: 1,
    });

    expect(payload.ciphertextHex).toMatch(/^\\x[0-9a-f]+$/);
    expect(payload.nonceHex).toMatch(/^\\x[0-9a-f]{24}$/);
    expect(payload.ciphertextHex).not.toContain(
      Buffer.from(secret, 'utf8').toString('hex'),
    );

    const recovered = decryptCredentialSecret({
      ciphertextHex: payload.ciphertextHex,
      nonceHex: payload.nonceHex,
      tenantId: TENANT_A,
      masterKeyHex: TEST_MASTER_KEY,
      keyVersion: payload.keyVersion,
    });

    expect(recovered).toBe(secret);
  });

  it('fails to decrypt if tenantId is different (cross-tenant key isolation)', () => {
    const payload = encryptCredentialSecret({
      plaintext: 'TokenSecretoRH4000',
      tenantId: TENANT_A,
      masterKeyHex: TEST_MASTER_KEY,
    });

    expect(() =>
      decryptCredentialSecret({
        ciphertextHex: payload.ciphertextHex,
        nonceHex: payload.nonceHex,
        tenantId: TENANT_B,
        masterKeyHex: TEST_MASTER_KEY,
        keyVersion: payload.keyVersion,
      }),
    ).toThrow();
  });
});
