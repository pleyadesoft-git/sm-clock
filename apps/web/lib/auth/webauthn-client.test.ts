import { describe, expect, it, vi } from 'vitest';
import {
  isValidBase64Url,
  parseCreationOptions,
  parseRequestOptions,
  signalUnknownPasskeyCredential,
  syncAcceptedPasskeyCredentials,
  toUnpaddedBase64Url,
} from './webauthn-client';

describe('webauthn-client helpers', () => {
  it('validates unpadded Base64URL strings strictly', () => {
    const validB64 = toUnpaddedBase64Url('550e8400-e29b-41d4-a716-446655440000');
    expect(isValidBase64Url(validB64)).toBe(true);
    expect(isValidBase64Url('dGVzdC1jcmVkLTE')).toBe(true);

    // Rechazar padding '=', caracteres inválidos o longitud % 4 === 1
    expect(isValidBase64Url('dGVzdA==')).toBe(false);
    expect(isValidBase64Url('cred:01')).toBe(false);
    expect(isValidBase64Url('a')).toBe(false);
    expect(isValidBase64Url('')).toBe(false);
  });

  it('parses WebAuthn request and creation options with ArrayBuffer conversion', () => {
    const reqOpts = parseRequestOptions({
      challenge: toUnpaddedBase64Url('random-challenge-123456'),
      rpId: 'localhost',
      userVerification: 'preferred',
      allowCredentials: [
        {
          id: toUnpaddedBase64Url('cred-id-1'),
          type: 'public-key',
          transports: ['internal'],
        },
      ],
    });

    expect(reqOpts.rpId).toBe('localhost');
    expect(reqOpts.challenge).toBeInstanceOf(ArrayBuffer);
    expect(reqOpts.allowCredentials?.[0]?.id).toBeInstanceOf(ArrayBuffer);

    const createOpts = parseCreationOptions(
      {
        rp: { id: 'localhost', name: 'SM Clock' },
        user: {
          id: toUnpaddedBase64Url('user-1234'),
          name: 'admin@empresa.mx',
          displayName: 'Admin Empresa',
        },
        challenge: toUnpaddedBase64Url('challenge-create-123'),
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        authenticatorSelection: {
          residentKey: 'required',
          userVerification: 'preferred',
        },
      },
      true,
    );

    expect(createOpts.rp.id).toBe('localhost');
    expect(createOpts.user.id).toBeInstanceOf(ArrayBuffer);
    expect(createOpts.authenticatorSelection?.authenticatorAttachment).toBe(
      'platform',
    );
  });

  it('skips Signal API calls safely when rpId or Base64URL IDs are invalid', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await syncAcceptedPasskeyCredentials({
      rpId: undefined,
      userId: 'invalid:id',
      credentialIds: ['dGVzdC1jcmVkLTE'],
    });
    await signalUnknownPasskeyCredential(undefined, 'dGVzdC1jcmVkLTE');
    warnSpy.mockRestore();
  });
});
