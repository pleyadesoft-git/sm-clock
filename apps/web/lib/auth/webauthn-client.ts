import type { SupabaseClient, Session, User } from '@supabase/supabase-js';

type StartAuthData = NonNullable<
  Awaited<
    ReturnType<SupabaseClient['auth']['passkey']['startAuthentication']>
  >['data']
>;
export type ServerRequestOptionsJSON = StartAuthData['options'];

type StartRegData = NonNullable<
  Awaited<
    ReturnType<SupabaseClient['auth']['passkey']['startRegistration']>
  >['data']
>;
export type ServerCreationOptionsJSON = StartRegData['options'];

type VerifyAuthCredentialJSON = Parameters<
  SupabaseClient['auth']['passkey']['verifyAuthentication']
>[0]['credential'];

type VerifyRegCredentialJSON = Parameters<
  SupabaseClient['auth']['passkey']['verifyRegistration']
>[0]['credential'];

export interface WebAuthnClientCapabilities {
  webauthnSupported: boolean;
  conditionalGet: boolean;
  passkeyPlatformAuthenticator: boolean;
  userVerifyingPlatformAuthenticator: boolean;
}

interface PublicKeyCredentialWithLevel3Statics {
  getClientCapabilities?: () => Promise<Record<string, boolean | undefined>>;
  parseCreationOptionsFromJSON?: (
    options: ServerCreationOptionsJSON,
  ) => PublicKeyCredentialCreationOptions;
  parseRequestOptionsFromJSON?: (
    options: ServerRequestOptionsJSON,
  ) => PublicKeyCredentialRequestOptions;
  signalUnknownCredential?: (options: {
    rpId: string;
    credentialId: string;
  }) => Promise<void>;
  signalAllAcceptedCredentials?: (options: {
    rpId: string;
    userId: string;
    allAcceptedCredentialIds: string[];
  }) => Promise<void>;
  signalCurrentUserDetails?: (options: {
    rpId: string;
    userId: string;
    name: string;
    displayName: string;
  }) => Promise<void>;
}

function getLevel3PublicKeyCredential(): PublicKeyCredentialWithLevel3Statics | null {
  if (
    typeof window === 'undefined' ||
    typeof window.PublicKeyCredential === 'undefined'
  ) {
    return null;
  }
  return window.PublicKeyCredential as unknown as PublicKeyCredentialWithLevel3Statics;
}

/**
 * Valida que una cadena sea Base64URL sin padding (`=`), requerida por WebAuthn Signal API.
 */
export function isValidBase64Url(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length % 4 !== 1 &&
    /^[A-Za-z0-9_-]+$/.test(value)
  );
}

/**
 * Convierte un UUID o string arbitrario en Base64URL sin padding.
 */
export function toUnpaddedBase64Url(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToArrayBuffer(base64url: string): ArrayBuffer {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (base64.length % 4)) % 4;
  const padded = base64 + '='.repeat(padLen);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function arrayBufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function parseRequestOptions(
  optionsJson: ServerRequestOptionsJSON,
): PublicKeyCredentialRequestOptions {
  const pkc = getLevel3PublicKeyCredential();
  if (pkc?.parseRequestOptionsFromJSON) {
    return pkc.parseRequestOptionsFromJSON(optionsJson);
  }

  return {
    challenge: base64UrlToArrayBuffer(optionsJson.challenge),
    timeout: optionsJson.timeout,
    rpId: optionsJson.rpId,
    userVerification: optionsJson.userVerification,
    allowCredentials: optionsJson.allowCredentials?.map((cred) => ({
      id: base64UrlToArrayBuffer(cred.id),
      type: 'public-key' as const,
      transports: cred.transports as AuthenticatorTransport[] | undefined,
    })),
  };
}

export function parseCreationOptions(
  optionsJson: ServerCreationOptionsJSON,
  isPromotionFlow = false,
): PublicKeyCredentialCreationOptions {
  const pkc = getLevel3PublicKeyCredential();
  const baseOptions: ServerCreationOptionsJSON = isPromotionFlow
    ? {
        ...optionsJson,
        authenticatorSelection: {
          ...optionsJson.authenticatorSelection,
          authenticatorAttachment: 'platform',
        },
      }
    : optionsJson;

  if (pkc?.parseCreationOptionsFromJSON) {
    return pkc.parseCreationOptionsFromJSON(baseOptions);
  }

  return {
    rp: baseOptions.rp,
    user: {
      id: base64UrlToArrayBuffer(baseOptions.user.id),
      name: baseOptions.user.name,
      displayName: baseOptions.user.displayName,
    },
    challenge: base64UrlToArrayBuffer(baseOptions.challenge),
    pubKeyCredParams: baseOptions.pubKeyCredParams,
    timeout: baseOptions.timeout,
    excludeCredentials: baseOptions.excludeCredentials?.map((cred) => ({
      id: base64UrlToArrayBuffer(cred.id),
      type: 'public-key' as const,
      transports: cred.transports as AuthenticatorTransport[] | undefined,
    })),
    authenticatorSelection: baseOptions.authenticatorSelection,
    attestation: baseOptions.attestation,
  };
}

function serializeAssertionCredential(
  credential: PublicKeyCredential,
): VerifyAuthCredentialJSON {
  if ('toJSON' in credential && typeof credential.toJSON === 'function') {
    return credential.toJSON() as unknown as VerifyAuthCredentialJSON;
  }

  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    id: credential.id,
    rawId: credential.id,
    type: 'public-key',
    authenticatorAttachment:
      (credential.authenticatorAttachment as AuthenticatorAttachment | null) ??
      undefined,
    clientExtensionResults: credential.getClientExtensionResults(),
    response: {
      authenticatorData: arrayBufferToBase64Url(response.authenticatorData),
      clientDataJSON: arrayBufferToBase64Url(response.clientDataJSON),
      signature: arrayBufferToBase64Url(response.signature),
      userHandle: response.userHandle
        ? arrayBufferToBase64Url(response.userHandle)
        : undefined,
    },
  };
}

function serializeRegistrationCredential(
  credential: PublicKeyCredential,
): VerifyRegCredentialJSON {
  if ('toJSON' in credential && typeof credential.toJSON === 'function') {
    return credential.toJSON() as unknown as VerifyRegCredentialJSON;
  }

  const response = credential.response as AuthenticatorAttestationResponse;
  const result: VerifyRegCredentialJSON = {
    id: credential.id,
    rawId: credential.id,
    type: 'public-key',
    authenticatorAttachment:
      (credential.authenticatorAttachment as AuthenticatorAttachment | null) ??
      undefined,
    clientExtensionResults: credential.getClientExtensionResults(),
    response: {
      attestationObject: arrayBufferToBase64Url(response.attestationObject),
      clientDataJSON: arrayBufferToBase64Url(response.clientDataJSON),
    },
  };
  return result;
}

/**
 * Detecta las capacidades WebAuthn y Biométricas del navegador/dispositivo usando
 * `PublicKeyCredential.getClientCapabilities()` con respaldo a métodos estándar.
 */
export async function detectWebAuthnCapabilities(): Promise<WebAuthnClientCapabilities> {
  if (
    typeof window === 'undefined' ||
    typeof window.PublicKeyCredential === 'undefined' ||
    typeof navigator === 'undefined' ||
    !navigator.credentials
  ) {
    return {
      webauthnSupported: false,
      conditionalGet: false,
      passkeyPlatformAuthenticator: false,
      userVerifyingPlatformAuthenticator: false,
    };
  }

  const pkc = getLevel3PublicKeyCredential();
  if (pkc?.getClientCapabilities) {
    try {
      const caps = await pkc.getClientCapabilities();
      const uvpa = Boolean(caps['userVerifyingPlatformAuthenticator']);
      const passkeyPlatform = Boolean(
        caps['passkeyPlatformAuthenticator'] ?? uvpa,
      );
      const conditionalGet = Boolean(caps['conditionalGet']);
      return {
        webauthnSupported: true,
        conditionalGet,
        passkeyPlatformAuthenticator: passkeyPlatform,
        userVerifyingPlatformAuthenticator: uvpa,
      };
    } catch {
      // Fallback a detección individual
    }
  }

  let uvpa = false;
  let conditionalGet = false;
  try {
    if (
      typeof window.PublicKeyCredential
        .isUserVerifyingPlatformAuthenticatorAvailable === 'function'
    ) {
      uvpa =
        await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    }
    if (
      typeof window.PublicKeyCredential.isConditionalMediationAvailable ===
      'function'
    ) {
      conditionalGet =
        await window.PublicKeyCredential.isConditionalMediationAvailable();
    }
  } catch {
    // Entorno sin soporte
  }

  return {
    webauthnSupported: true,
    conditionalGet,
    passkeyPlatformAuthenticator: uvpa,
    userVerifyingPlatformAuthenticator: uvpa,
  };
}

/**
 * Notifica al gestor de contraseñas que una credencial ya no existe en el servidor (HTTP 404).
 * Siempre utiliza el `rpId` provisto por el servidor, nunca `window.location.hostname`.
 */
export async function signalUnknownPasskeyCredential(
  serverRpId: string | undefined,
  credentialId: string,
): Promise<void> {
  const pkc = getLevel3PublicKeyCredential();
  if (!pkc?.signalUnknownCredential) return;
  if (!serverRpId || !isValidBase64Url(credentialId)) return;

  try {
    await pkc.signalUnknownCredential({
      rpId: serverRpId,
      credentialId,
    });
  } catch (err) {
    console.warn('SignalUnknownCredential sync warning:', err);
  }
}

/**
 * Sincroniza la lista completa de credenciales aceptadas con el gestor de contraseñas del navegador.
 * Valida formato Base64URL sin padding antes de invocar la API nativa.
 */
export async function syncAcceptedPasskeyCredentials(params: {
  rpId: string | undefined;
  userId: string;
  credentialIds: string[];
}): Promise<void> {
  const pkc = getLevel3PublicKeyCredential();
  if (!pkc?.signalAllAcceptedCredentials) return;

  const { rpId, userId, credentialIds } = params;
  if (
    !rpId ||
    !isValidBase64Url(userId) ||
    !credentialIds.every((id) => isValidBase64Url(id))
  ) {
    console.warn(
      'SignalAllAcceptedCredentials skipped: server rpId and valid unpadded Base64URL userId and credential IDs are required.',
    );
    return;
  }

  try {
    await pkc.signalAllAcceptedCredentials({
      rpId,
      userId,
      allAcceptedCredentialIds: credentialIds,
    });
  } catch (err) {
    console.warn('SignalAllAcceptedCredentials sync warning:', err);
  }
}

export type PasskeyAuthResult =
  | {
      ok: true;
      user: User;
      session: Session | null;
    }
  | {
      ok: false;
      cancelled: boolean;
      message: string;
    };

/**
 * Ejecuta el flujo de inicio de sesión con Passkey / Biométrico separando la ceremonia del navegador
 * y la verificación en el servidor para soportar `signalUnknownCredential` ante HTTP 404.
 */
export async function authenticateWithPasskey(params: {
  supabase: SupabaseClient;
  signal?: AbortSignal;
  mediation?: CredentialMediationRequirement;
}): Promise<PasskeyAuthResult> {
  const { supabase, signal, mediation } = params;

  const { data: startData, error: startError } =
    await supabase.auth.passkey.startAuthentication();

  if (startError || !startData) {
    return {
      ok: false,
      cancelled: false,
      message:
        'El inicio de sesión con Passkey / Biométrico no está habilitado o disponible en este momento.',
    };
  }

  const serverRpId = startData.options.rpId;
  const publicKey = parseRequestOptions(startData.options);

  let credential: PublicKeyCredential | null;
  try {
    credential = (await navigator.credentials.get({
      publicKey,
      signal,
      mediation,
    })) as PublicKeyCredential | null;
  } catch (err) {
    const errName = err instanceof Error ? err.name : '';
    if (errName === 'NotAllowedError' || errName === 'AbortError') {
      return {
        ok: false,
        cancelled: true,
        message: 'Operación biométrica cancelada.',
      };
    }
    if (errName === 'SecurityError') {
      return {
        ok: false,
        cancelled: false,
        message:
          'Error de dominio (RP ID) o contexto seguro HTTPS al verificar biométrico.',
      };
    }
    return {
      ok: false,
      cancelled: false,
      message: 'No se pudo leer la llave biométrica del dispositivo.',
    };
  }

  if (!credential) {
    return {
      ok: false,
      cancelled: true,
      message: 'No se seleccionó ninguna llave de acceso.',
    };
  }

  const encoded = serializeAssertionCredential(credential);

  try {
    const { data: verifyData, error: verifyError } =
      await supabase.auth.passkey.verifyAuthentication({
        challengeId: startData.challenge_id,
        credential: encoded,
      });

    if (verifyError || !verifyData?.user) {
      const status =
        verifyError && 'status' in verifyError ? verifyError.status : undefined;
      if (status === 404) {
        await signalUnknownPasskeyCredential(serverRpId, encoded.id);
      }
      return {
        ok: false,
        cancelled: false,
        message:
          'Esta llave biométrica no está registrada o ha sido revocada.',
      };
    }

    return {
      ok: true,
      user: verifyData.user,
      session: verifyData.session,
    };
  } catch {
    return {
      ok: false,
      cancelled: false,
      message: 'Error de red al verificar la firma biométrica con el servidor.',
    };
  }
}

export type PasskeyRegisterResult =
  | {
      ok: true;
      passkeyId: string;
      rpId: string;
      userIdBase64Url: string;
    }
  | {
      ok: false;
      cancelled: boolean;
      message: string;
    };

/**
 * Registra una nueva Passkey / llave biométrica en la cuenta del usuario autenticado.
 * Separa la creación WebAuthn en navegador de la verificación en servidor y sincroniza
 * credenciales huérfanas mediante `signalUnknownCredential` si falla la verificación.
 */
export async function registerUserPasskey(params: {
  supabase: SupabaseClient;
  friendlyName?: string;
  isPromotion?: boolean;
  signal?: AbortSignal;
}): Promise<PasskeyRegisterResult> {
  const { supabase, friendlyName, isPromotion = false, signal } = params;

  const caps = await detectWebAuthnCapabilities();
  if (!caps.passkeyPlatformAuthenticator && !caps.webauthnSupported) {
    return {
      ok: false,
      cancelled: false,
      message:
        'Tu navegador o dispositivo no soporta llaves de acceso biométricas (WebAuthn).',
    };
  }

  const { data: startData, error: startError } =
    await supabase.auth.passkey.startRegistration();

  if (startError || !startData) {
    return {
      ok: false,
      cancelled: false,
      message:
        'No fue posible iniciar el registro de la llave biométrica en el servidor.',
    };
  }

  const serverRpId = startData.options.rp.id ?? '';
  const serverUserId = startData.options.user.id;
  const publicKey = parseCreationOptions(startData.options, isPromotion);

  let credential: PublicKeyCredential | null;
  try {
    credential = (await navigator.credentials.create({
      publicKey,
      signal,
    })) as PublicKeyCredential | null;
  } catch (err) {
    const errName = err instanceof Error ? err.name : '';
    if (errName === 'InvalidStateError') {
      return {
        ok: false,
        cancelled: false,
        message:
          'Este dispositivo biométrico o llave de acceso ya se encuentra registrado en tu cuenta.',
      };
    }
    if (errName === 'SecurityError') {
      return {
        ok: false,
        cancelled: false,
        message:
          'Error de configuración de dominio (RP ID) o contexto seguro HTTPS.',
      };
    }
    if (errName === 'NotAllowedError' || errName === 'AbortError') {
      return {
        ok: false,
        cancelled: true,
        message: 'Registro biométrico cancelado por el usuario.',
      };
    }
    return {
      ok: false,
      cancelled: false,
      message: 'No se pudo completar el registro biométrico en el dispositivo.',
    };
  }

  if (!credential) {
    return {
      ok: false,
      cancelled: true,
      message: 'No se generó ninguna credencial biométrica.',
    };
  }

  const encodedResponse = serializeRegistrationCredential(credential);

  try {
    const { data: verifyData, error: verifyError } =
      await supabase.auth.passkey.verifyRegistration({
        challengeId: startData.challenge_id,
        credential: encodedResponse,
      });

    if (verifyError || !verifyData) {
      await signalUnknownPasskeyCredential(serverRpId, encodedResponse.id);
      return {
        ok: false,
        cancelled: false,
        message:
          'El servidor rechazó el registro de la llave biométrica. Intenta nuevamente.',
      };
    }

    if (friendlyName && friendlyName.trim().length >= 2) {
      await supabase.auth.passkey.update({
        passkeyId: verifyData.id,
        friendlyName: friendlyName.trim(),
      });
    }

    return {
      ok: true,
      passkeyId: verifyData.id,
      rpId: serverRpId,
      userIdBase64Url: serverUserId,
    };
  } catch {
    await signalUnknownPasskeyCredential(serverRpId, encodedResponse.id);
    return {
      ok: false,
      cancelled: false,
      message:
        'Error de conexión al verificar el registro biométrico con el servidor.',
    };
  }
}
