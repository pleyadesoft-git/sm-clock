'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Fingerprint, KeyRound, ShieldCheck } from 'lucide-react';
import {
  MfaVerifyRequestSchema,
  sanitizeRedirectPath,
  UserRoleSchema,
  WebAuthnFactorEnrollSchema,
} from '@sm-clock/contracts';
import { detectWebAuthnCapabilities } from '@/lib/auth/webauthn-client';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { ThemeToggle } from '@/components/theme-toggle';
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
import { SegmentedControl } from '@/components/ui/segmented-control';

type MfaMethodTab = 'TOTP' | 'WEBAUTHN';

export default function MfaVerificationPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = React.useState<MfaMethodTab>('TOTP');
  const [webauthnSupported, setWebauthnSupported] = React.useState(false);
  const [platformBiometricAvailable, setPlatformBiometricAvailable] =
    React.useState(false);

  // Estado TOTP
  const [totpFactorId, setTotpFactorId] = React.useState<string>('');
  const [qrCodeSvg, setQrCodeSvg] = React.useState<string | null>(null);
  const [totpSecret, setTotpSecret] = React.useState<string | null>(null);
  const [code, setCode] = React.useState('');

  // Estado WebAuthn / Biométrico
  const [webauthnFactorId, setWebauthnFactorId] = React.useState<string | null>(
    null,
  );
  const [webauthnFactorName, setWebauthnFactorName] = React.useState<
    string | null
  >(null);
  const [newDeviceName, setNewDeviceName] = React.useState(
    'Biométrico del dispositivo (Touch ID / Face ID / Windows Hello)',
  );

  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isVerifying, setIsVerifying] = React.useState(false);

  const redirectAfterMfaSuccess = React.useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const parsedRol = UserRoleSchema.safeParse(user?.app_metadata?.['rol']);
    const nextParam =
      typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search).get('next')
        : null;
    const safeDestination = sanitizeRedirectPath(
      nextParam,
      parsedRol.success ? parsedRol.data : null,
    );

    router.replace(safeDestination);
  }, [router]);

  React.useEffect(() => {
    let active = true;
    const initMfa = async () => {
      try {
        const caps = await detectWebAuthnCapabilities();
        if (active) {
          setWebauthnSupported(caps.webauthnSupported);
          setPlatformBiometricAvailable(caps.passkeyPlatformAuthenticator);
        }

        const supabase = createSupabaseBrowserClient();
        const { data: factors, error } = await supabase.auth.mfa.listFactors();
        if (error) {
          if (active) {
            setErrorMessage('No se pudieron consultar tus factores MFA.');
          }
          return;
        }

        const verifiedWebAuthn = factors.webauthn?.[0];
        if (verifiedWebAuthn && active) {
          setWebauthnFactorId(verifiedWebAuthn.id);
          setWebauthnFactorName(
            verifiedWebAuthn.friendly_name ?? 'Llave Biométrica Registrada',
          );
          if (caps.webauthnSupported) {
            setActiveTab('WEBAUTHN');
          }
        }

        const verifiedTotp = factors.totp[0];
        if (verifiedTotp) {
          if (active) setTotpFactorId(verifiedTotp.id);
          return;
        }

        // Limpiar factores previos no verificados para evitar colisión de friendlyName al recargar
        for (const f of factors.all) {
          if (f.status === 'unverified') {
            await supabase.auth.mfa.unenroll({ factorId: f.id });
          }
        }

        const { data: enrolled, error: enrollError } =
          await supabase.auth.mfa.enroll({
            factorType: 'totp',
            friendlyName: `SM Clock Authenticator (${Date.now()})`,
          });

        if (enrollError || !enrolled) {
          if (active && !verifiedWebAuthn) {
            setErrorMessage('No fue posible iniciar el enrolamiento MFA TOTP.');
          }
          return;
        }

        if (active) {
          setTotpFactorId(enrolled.id);
          const rawQr = enrolled.totp.qr_code;
          setQrCodeSvg(
            typeof rawQr === 'string' && rawQr.startsWith('data:image/svg+xml')
              ? rawQr
              : null,
          );
          setTotpSecret(enrolled.totp.secret);
        }
      } catch {
        if (active) {
          setErrorMessage('Error al inicializar la verificación MFA.');
        }
      } finally {
        if (active) setIsLoading(false);
      }
    };

    void initMfa();
    return () => {
      active = false;
    };
  }, []);

  const handleVerifyTotp = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);

    const parsed = MfaVerifyRequestSchema.safeParse({
      factorId: totpFactorId,
      code,
    });
    if (!parsed.success) {
      setErrorMessage(
        parsed.error.issues[0]?.message ?? 'Código TOTP inválido',
      );
      return;
    }

    setIsVerifying(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.mfa.challengeAndVerify({
        factorId: parsed.data.factorId,
        code: parsed.data.code,
      });

      if (error) {
        setErrorMessage(
          'Código incorrecto o expirado. Verifica tu app autenticadora.',
        );
        return;
      }

      await redirectAfterMfaSuccess();
    } catch {
      setErrorMessage('No se pudo verificar el código TOTP.');
    } finally {
      setIsVerifying(false);
    }
  };

  const handleWebAuthnVerifyOrRegister = async () => {
    setErrorMessage(null);
    setIsVerifying(true);

    try {
      const supabase = createSupabaseBrowserClient();

      if (webauthnFactorId) {
        const { error } = await supabase.auth.mfa.webauthn.authenticate({
          factorId: webauthnFactorId,
          webauthn: {},
        });

        if (error) {
          setErrorMessage(
            'No se pudo verificar tu huella, rostro o llave de seguridad. Intenta nuevamente o usa código TOTP.',
          );
          return;
        }

        await redirectAfterMfaSuccess();
        return;
      }

      const parsedEnroll = WebAuthnFactorEnrollSchema.safeParse({
        friendlyName: newDeviceName,
      });
      if (!parsedEnroll.success) {
        setErrorMessage(
          parsedEnroll.error.issues[0]?.message ??
            'Ingresa un nombre válido para el dispositivo biométrico',
        );
        return;
      }

      const { error } = await supabase.auth.mfa.webauthn.register(
        {
          friendlyName: parsedEnroll.data.friendlyName,
          webauthn: {},
        },
        platformBiometricAvailable
          ? {
              authenticatorSelection: {
                authenticatorAttachment: 'platform',
                userVerification: 'preferred',
              },
            }
          : undefined,
      );

      if (error) {
        setErrorMessage(
          'No se pudo registrar el factor biométrico WebAuthn. Verifica que tu dispositivo tenga Touch ID, Face ID o Windows Hello activo.',
        );
        return;
      }

      await redirectAfterMfaSuccess();
    } catch {
      setErrorMessage(
        'Error al ejecutar la ceremonia biométrica WebAuthn en el navegador.',
      );
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col bg-[var(--bg)] p-[var(--s-4)] text-[var(--text)]">
      <div className="flex justify-end">
        <ThemeToggle />
      </div>

      <div className="flex flex-1 items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader className="items-center text-center">
            <div className="mb-[var(--s-2)] flex size-12 items-center justify-center rounded-[var(--r-lg)] bg-[var(--accent)] text-[var(--text-on-accent)] shadow-[var(--shadow-1)]">
              <ShieldCheck
                className="size-6"
                strokeWidth={1.75}
                aria-hidden="true"
              />
            </div>
            <CardTitle>Verificación en dos pasos (MFA)</CardTitle>
            <CardDescription>
              Obligatorio para cuentas de SUPER_ADMIN y ADMIN_EMPRESA · Usa Biométrico o App TOTP
            </CardDescription>
          </CardHeader>

          <CardContent className="flex flex-col gap-[var(--s-4)]">
            {isLoading ? (
              <p className="py-[var(--s-6)] text-center text-sm text-[var(--text-2)]">
                Preparando verificación de seguridad…
              </p>
            ) : (
              <>
                {webauthnSupported ? (
                  <SegmentedControl
                    ariaLabel="Seleccionar método de segundo factor MFA"
                    value={activeTab}
                    onChange={(val) => {
                      setActiveTab(val);
                      setErrorMessage(null);
                    }}
                    className="w-full justify-center"
                    options={[
                      {
                        value: 'WEBAUTHN',
                        label: 'Biométrico / WebAuthn',
                      },
                      {
                        value: 'TOTP',
                        label: 'Código App (TOTP)',
                      },
                    ]}
                  />
                ) : null}

                {activeTab === 'WEBAUTHN' && webauthnSupported ? (
                  <div className="flex flex-col gap-[var(--s-4)]">
                    <div className="flex flex-col items-center gap-[var(--s-3)] rounded-[var(--r-md)] border border-[var(--separator)] bg-[var(--surface-2)] p-[var(--s-4)] text-center">
                      <div className="flex size-12 items-center justify-center rounded-full bg-[var(--surface)] text-[var(--accent)] shadow-[var(--shadow-1)]">
                        <Fingerprint
                          className="size-6"
                          strokeWidth={1.75}
                          aria-hidden="true"
                        />
                      </div>

                      {webauthnFactorId ? (
                        <div className="flex flex-col items-center gap-[var(--s-1)]">
                          <Badge variant="success">Dispositivo verificado</Badge>
                          <p className="text-sm font-semibold text-[var(--text)]">
                            {webauthnFactorName}
                          </p>
                          <p className="text-xs text-[var(--text-2)]">
                            Confirma tu identidad con Touch ID, Face ID, Windows
                            Hello o tu llave de seguridad.
                          </p>
                        </div>
                      ) : (
                        <div className="flex w-full flex-col gap-[var(--s-2)] text-left">
                          <p className="text-center text-xs text-[var(--text-2)]">
                            Registra la huella o rostro de tu dispositivo como
                            segundo factor criptográfico (WebAuthn):
                          </p>
                          <label
                            htmlFor="webauthn-device-name"
                            className="ios-label"
                          >
                            Nombre del dispositivo biométrico
                          </label>
                          <Input
                            id="webauthn-device-name"
                            name="webauthn-device-name"
                            value={newDeviceName}
                            onChange={(e) => setNewDeviceName(e.target.value)}
                            placeholder="Ej. MacBook Pro Touch ID"
                          />
                        </div>
                      )}
                    </div>

                    {errorMessage ? (
                      <div
                        role="alert"
                        aria-live="polite"
                        className="rounded-[var(--r-md)] bg-[var(--danger-bg)] px-[var(--s-3)] py-[var(--s-2)] text-xs font-medium text-[var(--danger)]"
                      >
                        {errorMessage}
                      </div>
                    ) : null}

                    <Button
                      type="button"
                      disabled={isVerifying}
                      onClick={() => void handleWebAuthnVerifyOrRegister()}
                      className="w-full"
                    >
                      <Fingerprint
                        className="size-4"
                        strokeWidth={1.75}
                        aria-hidden="true"
                      />
                      <span>
                        {isVerifying
                          ? 'Esperando confirmación biométrica…'
                          : webauthnFactorId
                            ? 'Verificar con Biométrico / WebAuthn'
                            : 'Registrar y verificar Biométrico'}
                      </span>
                    </Button>
                  </div>
                ) : (
                  <form
                    onSubmit={handleVerifyTotp}
                    className="flex flex-col gap-[var(--s-4)]"
                  >
                    {qrCodeSvg ? (
                      <div className="flex flex-col items-center gap-[var(--s-3)] rounded-[var(--r-md)] border border-[var(--separator)] bg-[var(--surface-2)] p-[var(--s-4)]">
                        <p className="text-center text-xs text-[var(--text-2)]">
                          Escanea este código QR con Google Authenticator,
                          1Password o Authy:
                        </p>
                        <img
                          src={qrCodeSvg}
                          alt="Código QR para configurar autenticador TOTP"
                          className="size-44 rounded-[var(--r-md)] bg-white p-[var(--s-2)]"
                        />
                        {totpSecret && (
                          <div className="w-full text-center">
                            <span className="text-xs text-[var(--text-2)]">
                              Clave manual:{' '}
                            </span>
                            <code className="select-all font-mono text-xs font-bold text-[var(--text)]">
                              {totpSecret}
                            </code>
                          </div>
                        )}
                      </div>
                    ) : null}

                    <div className="flex flex-col gap-[var(--s-1)]">
                      <label htmlFor="totp-code" className="ios-label">
                        Código de 6 dígitos
                      </label>
                      <Input
                        id="totp-code"
                        name="totp-code"
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]{6}"
                        maxLength={6}
                        autoComplete="one-time-code"
                        required
                        placeholder="123456"
                        className="text-center font-mono text-lg tracking-widest"
                        value={code}
                        onChange={(e) =>
                          setCode(e.target.value.replace(/\D/g, '').slice(0, 6))
                        }
                      />
                    </div>

                    {errorMessage ? (
                      <div
                        role="alert"
                        aria-live="polite"
                        className="rounded-[var(--r-md)] bg-[var(--danger-bg)] px-[var(--s-3)] py-[var(--s-2)] text-xs font-medium text-[var(--danger)]"
                      >
                        {errorMessage}
                      </div>
                    ) : null}

                    <Button
                      type="submit"
                      disabled={isVerifying || !totpFactorId}
                      className="w-full"
                    >
                      <KeyRound
                        className="size-4"
                        strokeWidth={1.75}
                        aria-hidden="true"
                      />
                      <span>
                        {isVerifying
                          ? 'Verificando código…'
                          : 'Confirmar y continuar'}
                      </span>
                    </Button>
                  </form>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
