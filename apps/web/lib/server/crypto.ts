import 'server-only';
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const NONCE_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const DERIVED_KEY_BYTES = 32;

export interface EncryptedSecretPayload {
  ciphertextHex: string;
  nonceHex: string;
  keyVersion: number;
}

function deriveDataEncryptionKey(
  masterKeyHex: string,
  tenantId: string,
  keyVersion: number,
): Buffer {
  const masterKey = Buffer.from(masterKeyHex, 'hex');
  if (masterKey.byteLength !== 32) {
    throw new Error(
      'CREDENTIALS_MASTER_KEY_HEX debe ser una clave de 256 bits (64 caracteres hexadecimales)',
    );
  }

  const info = Buffer.from(`sm-clock:credenciales:v${keyVersion}:${tenantId}`, 'utf8');
  const derived = hkdfSync('sha256', masterKey, Buffer.alloc(0), info, DERIVED_KEY_BYTES);
  return Buffer.from(derived);
}

/**
 * Cifra un secreto usando AES-256-GCM con clave derivada por tenant y versión (envelope).
 * El tag de autenticación de 16 bytes se concatena al final de `ciphertextHex`.
 */
export function encryptCredentialSecret(params: {
  plaintext: string;
  tenantId: string;
  masterKeyHex: string;
  keyVersion?: number;
}): EncryptedSecretPayload {
  const keyVersion = params.keyVersion ?? 1;
  const dek = deriveDataEncryptionKey(params.masterKeyHex, params.tenantId, keyVersion);
  const nonce = randomBytes(NONCE_BYTES);

  const cipher = createCipheriv(ALGORITHM, dek, nonce, {
    authTagLength: AUTH_TAG_BYTES,
  });

  const encrypted = Buffer.concat([
    cipher.update(params.plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  const combined = Buffer.concat([encrypted, authTag]);

  return {
    ciphertextHex: `\\x${combined.toString('hex')}`,
    nonceHex: `\\x${nonce.toString('hex')}`,
    keyVersion,
  };
}

/**
 * Descifra un secreto almacenado en `public.credenciales`.
 */
export function decryptCredentialSecret(params: {
  ciphertextHex: string;
  nonceHex: string;
  tenantId: string;
  masterKeyHex: string;
  keyVersion: number;
}): string {
  const dek = deriveDataEncryptionKey(
    params.masterKeyHex,
    params.tenantId,
    params.keyVersion,
  );
  const rawCipher = Buffer.from(params.ciphertextHex.replace(/^\\x/, ''), 'hex');
  const nonce = Buffer.from(params.nonceHex.replace(/^\\x/, ''), 'hex');

  if (rawCipher.byteLength < AUTH_TAG_BYTES) {
    throw new Error('Ciphertext inválido o truncado');
  }

  const encryptedData = rawCipher.subarray(0, rawCipher.byteLength - AUTH_TAG_BYTES);
  const authTag = rawCipher.subarray(rawCipher.byteLength - AUTH_TAG_BYTES);

  const decipher = createDecipheriv(ALGORITHM, dek, nonce, {
    authTagLength: AUTH_TAG_BYTES,
  });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(encryptedData),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}
