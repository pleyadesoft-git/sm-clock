'use client';

import * as React from 'react';
import {
  Check,
  Edit3,
  Fingerprint,
  KeyRound,
  Plus,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import {
  PasskeyRenameRequestSchema,
  WebAuthnFactorEnrollSchema,
} from '@sm-clock/contracts';
import {
  detectWebAuthnCapabilities,
  registerUserPasskey,
  syncAcceptedPasskeyCredentials,
  toUnpaddedBase64Url,
} from '@/lib/auth/webauthn-client';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';

interface PasskeyItem {
  id: string;
  friendly_name?: string;
  created_at: string;
  last_used_at?: string;
}

interface WebAuthnMfaFactorItem {
  id: string;
  friendly_name?: string;
  status: string;
  created_at: string;
  updated_at: string;
}

function formatTijuanaDate(isoDate?: string): string {
  if (!isoDate) return 'Sin uso reciente';
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: 'America/Tijuana',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(parsed);
}

export function PasskeySecurityCard() {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = React.useState(true);
  const [canCreatePasskey, setCanCreatePasskey] = React.useState(false);
  const [webauthnSupported, setWebauthnSupported] = React.useState(false);

  const [passkeys, setPasskeys] = React.useState<PasskeyItem[]>([]);
  const [webauthnFactors, setWebauthnFactors] = React.useState<
    WebAuthnMfaFactorItem[]
  >([]);
  const [serverRpId, setServerRpId] = React.useState<string>('');
  const [userIdBase64Url, setUserIdBase64Url] = React.useState<string>('');

  const [newPasskeyName, setNewPasskeyName] = React.useState(
    'Biométrico Principal (Touch ID / Face ID / Windows Hello)',
  );
  const [isRegisteringPasskey, setIsRegisteringPasskey] = React.useState(false);
  const [isRegisteringMfaWebAuthn, setIsRegisteringMfaWebAuthn] =
    React.useState(false);

  const [editingPasskeyId, setEditingPasskeyId] = React.useState<string | null>(
    null,
  );
  const [editingNameValue, setEditingNameValue] = React.useState('');
  const [isUpdatingId, setIsUpdatingId] = React.useState<string | null>(null);

  const loadCredentials = React.useCallback(
    async (knownRpId?: string, knownUserIdB64?: string) => {
      const supabase = createSupabaseBrowserClient();
      const [passkeyRes, mfaRes, userRes] = await Promise.all([
        supabase.auth.passkey.list(),
        supabase.auth.mfa.listFactors(),
        supabase.auth.getUser(),
      ]);

      const loadedPasskeys = passkeyRes.data ?? [];
      setPasskeys(loadedPasskeys);

      const loadedWebAuthnMfa = (mfaRes.data?.webauthn ?? []).map((f) => ({
        id: f.id,
        friendly_name: f.friendly_name,
        status: f.status,
        created_at: f.created_at,
        updated_at: f.updated_at,
      }));
      setWebauthnFactors(loadedWebAuthnMfa);

      const resolvedRpId =
        knownRpId ||
        serverRpId ||
        process.env['NEXT_PUBLIC_WEBAUTHN_RP_ID'] ||
        '';
      const rawUserId = userRes.data.user?.id ?? '';
      const resolvedUserIdB64 =
        knownUserIdB64 ||
        userIdBase64Url ||
        (rawUserId ? toUnpaddedBase64Url(rawUserId) : '');

      if (resolvedRpId) setServerRpId(resolvedRpId);
      if (resolvedUserIdB64) setUserIdBase64Url(resolvedUserIdB64);

      if (resolvedRpId && resolvedUserIdB64) {
        const b64CredentialIds = loadedPasskeys.map((pk) =>
          toUnpaddedBase64Url(pk.id),
        );
        await syncAcceptedPasskeyCredentials({
          rpId: resolvedRpId,
          userId: resolvedUserIdB64,
          credentialIds: b64CredentialIds,
        });
      }
    },
    [serverRpId, userIdBase64Url],
  );

  React.useEffect(() => {
    let active = true;
    const init = async () => {
      try {
        const caps = await detectWebAuthnCapabilities();
        if (!active) return;
        setWebauthnSupported(caps.webauthnSupported);
        setCanCreatePasskey(caps.passkeyPlatformAuthenticator);
        await loadCredentials();
      } finally {
        if (active) setIsLoading(false);
      }
    };
    void init();
    return () => {
      active = false;
    };
  }, [loadCredentials]);

  const handleCreatePasskey = async () => {
    const parsedName = WebAuthnFactorEnrollSchema.safeParse({
      friendlyName: newPasskeyName,
    });
    if (!parsedName.success) {
      toast({
        title: 'Nombre de llave inválido',
        description:
          parsedName.error.issues[0]?.message ??
          'Ingresa un nombre descriptivo para tu dispositivo.',
        variant: 'danger',
      });
      return;
    }

    setIsRegisteringPasskey(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const result = await registerUserPasskey({
        supabase,
        friendlyName: parsedName.data.friendlyName,
        isPromotion: false,
      });

      if (!result.ok) {
        if (!result.cancelled) {
          toast({
            title: 'No se pudo registrar la Passkey biométrica',
            description: result.message,
            variant: 'danger',
          });
        }
        return;
      }

      await loadCredentials(result.rpId, result.userIdBase64Url);
      toast({
        title: 'Passkey biométrica registrada',
        description:
          'Ahora puedes iniciar sesión directamente con huella, rostro o llave de acceso sin escribir contraseña.',
        variant: 'success',
      });
    } finally {
      setIsRegisteringPasskey(false);
    }
  };

  const handleRenamePasskey = async (passkeyId: string) => {
    const parsed = PasskeyRenameRequestSchema.safeParse({
      passkeyId,
      friendlyName: editingNameValue,
    });
    if (!parsed.success) {
      toast({
        title: 'Nombre inválido',
        description:
          parsed.error.issues[0]?.message ?? 'Revisa el nombre ingresado.',
        variant: 'danger',
      });
      return;
    }

    setIsUpdatingId(passkeyId);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.passkey.update({
        passkeyId: parsed.data.passkeyId,
        friendlyName: parsed.data.friendlyName,
      });
      if (error) {
        toast({
          title: 'Error al renombrar la llave biométrica',
          description: 'No fue posible actualizar el nombre en el servidor.',
          variant: 'danger',
        });
        return;
      }

      setEditingPasskeyId(null);
      setEditingNameValue('');
      await loadCredentials();
      toast({
        title: 'Nombre actualizado',
        description: 'Se actualizó la etiqueta de tu llave de acceso.',
        variant: 'success',
      });
    } finally {
      setIsUpdatingId(null);
    }
  };

  const handleDeletePasskey = async (passkeyId: string) => {
    setIsUpdatingId(passkeyId);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.passkey.delete({ passkeyId });
      if (error) {
        toast({
          title: 'No se pudo eliminar la Passkey',
          description: 'Intenta nuevamente o verifica tu sesión activa.',
          variant: 'danger',
        });
        return;
      }

      await loadCredentials();
      toast({
        title: 'Passkey eliminada',
        description:
          'La credencial biométrica fue revocada y sincronizada con tu gestor de llaves.',
        variant: 'success',
      });
    } finally {
      setIsUpdatingId(null);
    }
  };

  const handleEnrollMfaWebAuthn = async () => {
    const parsedName = WebAuthnFactorEnrollSchema.safeParse({
      friendlyName: newPasskeyName,
    });
    if (!parsedName.success) {
      toast({
        title: 'Nombre inválido',
        description:
          parsedName.error.issues[0]?.message ??
          'Ingresa un nombre para el factor MFA.',
        variant: 'danger',
      });
      return;
    }

    setIsRegisteringMfaWebAuthn(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.mfa.webauthn.register({
        friendlyName: parsedName.data.friendlyName,
        webauthn: {},
      });

      if (error) {
        toast({
          title: 'No se pudo registrar el factor MFA WebAuthn',
          description:
            'Verifica que WebAuthn MFA esté activo en tu proyecto Supabase.',
          variant: 'danger',
        });
        return;
      }

      await loadCredentials();
      toast({
        title: 'Factor MFA Biométrico activado',
        description:
          'Tu huella/rostro o llave de seguridad quedó vinculada para verificación de segundo factor (AAL2).',
        variant: 'success',
      });
    } finally {
      setIsRegisteringMfaWebAuthn(false);
    }
  };

  const handleUnenrollMfaWebAuthn = async (factorId: string) => {
    setIsUpdatingId(factorId);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.mfa.unenroll({ factorId });
      if (error) {
        toast({
          title: 'No se pudo eliminar el factor MFA',
          description:
            'Se requiere sesión verificada con segundo factor (AAL2) para desvincular un factor MFA.',
          variant: 'danger',
        });
        return;
      }

      await loadCredentials();
      toast({
        title: 'Factor MFA eliminado',
        description: 'El dispositivo biométrico fue desvinculado de MFA.',
        variant: 'success',
      });
    } finally {
      setIsUpdatingId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-[var(--s-3)]">
          <div className="flex items-center gap-[var(--s-3)]">
            <div className="flex size-10 items-center justify-center rounded-[var(--r-md)] bg-[var(--accent)] text-[var(--text-on-accent)]">
              <Fingerprint
                className="size-5"
                strokeWidth={1.75}
                aria-hidden="true"
              />
            </div>
            <div>
              <CardTitle>
                Biométricos, Passkeys y Llaves de Seguridad (WebAuthn)
              </CardTitle>
              <CardDescription>
                Vincula Touch ID, Face ID, Windows Hello o llaves FIDO2 para
                iniciar sesión sin contraseña y verificar tu segundo factor MFA
                (sin almacenar plantillas biométricas en la nube).
              </CardDescription>
            </div>
          </div>
          <Badge variant={canCreatePasskey ? 'success' : 'warning'}>
            {canCreatePasskey
              ? 'Biométrico de Plataforma Disponible'
              : webauthnSupported
                ? 'WebAuthn Estándar'
                : 'No soportado en este navegador'}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-[var(--s-5)]">
        {isLoading ? (
          <p className="py-[var(--s-4)] text-sm text-[var(--text-2)]">
            Consultando llaves biométricas registradas…
          </p>
        ) : (
          <>
            {canCreatePasskey || webauthnSupported ? (
              <div className="flex flex-col gap-[var(--s-3)] rounded-[var(--r-md)] border border-[var(--separator)] bg-[var(--surface-2)] p-[var(--s-4)]">
                <div className="flex flex-col gap-[var(--s-1)]">
                  <label
                    htmlFor="passkey-friendly-name"
                    className="ios-label"
                  >
                    Nombre descriptivo del dispositivo o lector biométrico
                  </label>
                  <Input
                    id="passkey-friendly-name"
                    name="passkey_friendly_name"
                    value={newPasskeyName}
                    onChange={(e) => setNewPasskeyName(e.target.value)}
                    placeholder="Ej. MacBook Pro Touch ID · Oficina Tijuana"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-[var(--s-3)]">
                  {canCreatePasskey ? (
                    <Button
                      type="button"
                      disabled={
                        isRegisteringPasskey || isRegisteringMfaWebAuthn
                      }
                      onClick={() => void handleCreatePasskey()}
                    >
                      <Plus
                        className="size-4"
                        strokeWidth={1.75}
                        aria-hidden="true"
                      />
                      <span>
                        {isRegisteringPasskey
                          ? 'Registrando Passkey…'
                          : 'Registrar Passkey Biométrica (Login directo)'}
                      </span>
                    </Button>
                  ) : null}

                  <Button
                    type="button"
                    variant="secondary"
                    disabled={isRegisteringMfaWebAuthn || isRegisteringPasskey}
                    onClick={() => void handleEnrollMfaWebAuthn()}
                  >
                    <ShieldCheck
                      className="size-4"
                      strokeWidth={1.75}
                      aria-hidden="true"
                    />
                    <span>
                      {isRegisteringMfaWebAuthn
                        ? 'Enrolando factor MFA…'
                        : 'Agregar Biométrico como 2do Factor MFA (AAL2)'}
                    </span>
                  </Button>
                </div>
              </div>
            ) : (
              <div className="rounded-[var(--r-md)] border border-[var(--separator)] bg-[var(--surface-2)] p-[var(--s-4)] text-xs text-[var(--text-2)]">
                Este navegador o dispositivo no reporta un autenticador
                biométrico de plataforma. Utiliza una aplicación autenticadora
                TOTP (Google Authenticator / 1Password) para tu segundo factor.
              </div>
            )}

            {/* Lista de Passkeys de acceso directo */}
            <div className="flex flex-col gap-[var(--s-2)]">
              <h3 className="text-sm font-bold text-[var(--text)]">
                Passkeys para inicio de sesión directo ({passkeys.length})
              </h3>
              {passkeys.length === 0 ? (
                <div className="rounded-[var(--r-md)] border border-[var(--separator)] bg-[var(--surface-2)] p-[var(--s-4)] text-xs text-[var(--text-2)]">
                  No se encontraron Passkeys registradas en tu cuenta. Registra
                  una arriba para entrar con huella o rostro desde la pantalla de
                  login.
                </div>
              ) : (
                <div className="flex flex-col divide-y divide-[var(--separator)] rounded-[var(--r-md)] border border-[var(--separator)] bg-[var(--surface)]">
                  {passkeys.map((pk) => {
                    const isEditing = editingPasskeyId === pk.id;
                    const isBusy = isUpdatingId === pk.id;
                    return (
                      <div
                        key={pk.id}
                        className="flex flex-wrap items-center justify-between gap-[var(--s-3)] p-[var(--s-3)]"
                      >
                        <div className="flex items-center gap-[var(--s-3)]">
                          <div className="flex size-9 items-center justify-center rounded-[var(--r-sm)] bg-[var(--surface-2)] text-[var(--accent)]">
                            <KeyRound
                              className="size-4"
                              strokeWidth={1.75}
                              aria-hidden="true"
                            />
                          </div>
                          <div className="flex flex-col">
                            {isEditing ? (
                              <div className="flex items-center gap-[var(--s-2)]">
                                <Input
                                  aria-label="Nuevo nombre de la llave de acceso"
                                  value={editingNameValue}
                                  onChange={(e) =>
                                    setEditingNameValue(e.target.value)
                                  }
                                  className="h-8 text-xs"
                                />
                                <Button
                                  type="button"
                                  variant="secondary"
                                  disabled={isBusy}
                                  onClick={() => void handleRenamePasskey(pk.id)}
                                  aria-label="Guardar nuevo nombre"
                                >
                                  <Check className="size-4" aria-hidden="true" />
                                </Button>
                                <Button
                                  type="button"
                                  variant="plain"
                                  onClick={() => {
                                    setEditingPasskeyId(null);
                                    setEditingNameValue('');
                                  }}
                                  aria-label="Cancelar edición"
                                >
                                  <X className="size-4" aria-hidden="true" />
                                </Button>
                              </div>
                            ) : (
                              <span className="text-sm font-semibold text-[var(--text)]">
                                {pk.friendly_name ||
                                  'Passkey Biométrica Registrada'}
                              </span>
                            )}
                            <span className="text-xs text-[var(--text-2)]">
                              Registrada: {formatTijuanaDate(pk.created_at)} ·
                              Último uso: {formatTijuanaDate(pk.last_used_at)}
                            </span>
                          </div>
                        </div>

                        {!isEditing ? (
                          <div className="flex items-center gap-[var(--s-2)]">
                            <Button
                              type="button"
                              variant="secondary"
                              disabled={isBusy}
                              onClick={() => {
                                setEditingPasskeyId(pk.id);
                                setEditingNameValue(
                                  pk.friendly_name ||
                                    'Passkey Biométrica Registrada',
                                );
                              }}
                            >
                              <Edit3
                                className="size-3.5"
                                strokeWidth={1.75}
                                aria-hidden="true"
                              />
                              <span>Renombrar</span>
                            </Button>
                            <Button
                              type="button"
                              variant="destructive"
                              disabled={isBusy}
                              onClick={() => void handleDeletePasskey(pk.id)}
                            >
                              <Trash2
                                className="size-3.5"
                                strokeWidth={1.75}
                                aria-hidden="true"
                              />
                              <span>Eliminar</span>
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Lista de Factores MFA WebAuthn */}
            {webauthnFactors.length > 0 ? (
              <div className="flex flex-col gap-[var(--s-2)]">
                <h3 className="text-sm font-bold text-[var(--text)]">
                  Factores Biométricos MFA 2FA ({webauthnFactors.length})
                </h3>
                <div className="flex flex-col divide-y divide-[var(--separator)] rounded-[var(--r-md)] border border-[var(--separator)] bg-[var(--surface)]">
                  {webauthnFactors.map((factor) => (
                    <div
                      key={factor.id}
                      className="flex flex-wrap items-center justify-between gap-[var(--s-3)] p-[var(--s-3)]"
                    >
                      <div className="flex items-center gap-[var(--s-3)]">
                        <div className="flex size-9 items-center justify-center rounded-[var(--r-sm)] bg-[var(--surface-2)] text-[var(--success)]">
                          <ShieldCheck
                            className="size-4"
                            strokeWidth={1.75}
                            aria-hidden="true"
                          />
                        </div>
                        <div className="flex flex-col">
                          <span className="text-sm font-semibold text-[var(--text)]">
                            {factor.friendly_name ||
                              'Factor Biométrico WebAuthn'}
                          </span>
                          <span className="text-xs text-[var(--text-2)]">
                            Registrado: {formatTijuanaDate(factor.created_at)}
                          </span>
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="destructive"
                        disabled={isUpdatingId === factor.id}
                        onClick={() =>
                          void handleUnenrollMfaWebAuthn(factor.id)
                        }
                      >
                        <Trash2
                          className="size-3.5"
                          strokeWidth={1.75}
                          aria-hidden="true"
                        />
                        <span>Desvincular</span>
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
