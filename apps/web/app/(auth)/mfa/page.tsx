'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, ShieldCheck } from 'lucide-react';
import {
  MfaVerifyRequestSchema,
  sanitizeRedirectPath,
  UserRoleSchema,
} from '@sm-clock/contracts';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';

/*
// =========================================================================
// SOPORTE FUTURO: WebAuthn / Biometría para MFA (AAL2)
// -------------------------------------------------------------------------
// Supabase Cloud soporta Passkeys para inicio de sesión primario, pero en MFA (AAL2)
// mantiene 'mfa_web_authn_enroll_enabled' desactivado por defecto en la nube.
// Cuando Supabase libere soporte de WebAuthn como segundo factor MFA en GoTrue,
// re-importar:
//   import { Fingerprint } from 'lucide-react';
//   import { WebAuthnFactorEnrollSchema } from '@sm-clock/contracts';
//   import { detectWebAuthnCapabilities } from '@/lib/auth/webauthn-client';
//   import { SegmentedControl } from '@/components/ui/segmented-control';
//   import { Badge } from '@/components/ui/badge';
// =========================================================================
*/

export default function MfaVerificationPage() {
  const router = useRouter();

  // Estado TOTP
  const [totpFactorId, setTotpFactorId] = React.useState<string>('');
  const [qrCodeSvg, setQrCodeSvg] = React.useState<string | null>(null);
  const [totpSecret, setTotpSecret] = React.useState<string | null>(null);
  const [code, setCode] = React.useState('');

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
        const supabase = createSupabaseBrowserClient();
        const { data: factors, error } = await supabase.auth.mfa.listFactors();
        if (error) {
          if (active) {
            setErrorMessage('No se pudieron consultar tus factores MFA.');
          }
          return;
        }

        const verifiedTotp = factors.totp[0];
        if (verifiedTotp) {
          if (active) setTotpFactorId(verifiedTotp.id);
          return;
        }

        // Limpiar factores previos no verificados para evitar colisión al recargar
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
          if (active) {
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

  /*
  // =========================================================================
  // RESERVADO PARA EL FUTURO: Manejador WebAuthn MFA en Supabase
  // -------------------------------------------------------------------------
  // Descomentar cuando Supabase Cloud habilite 'mfa_web_authn_enroll_enabled'.
  // =========================================================================
  const handleWebAuthnVerifyOrRegister = async () => { ... };
  */

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
              Obligatorio para cuentas de Administrador · App de autenticación (TOTP)
            </CardDescription>
          </CardHeader>

          <CardContent className="flex flex-col gap-[var(--s-4)]">
            {isLoading ? (
              <p className="py-[var(--s-6)] text-center text-sm text-[var(--text-2)]">
                Preparando verificación de seguridad…
              </p>
            ) : (
              <form
                noValidate
                onSubmit={handleVerifyTotp}
                className="flex flex-col gap-[var(--s-4)]"
              >
                {qrCodeSvg ? (
                  <div className="flex flex-col items-center gap-[var(--s-3)] rounded-[var(--r-md)] border border-[var(--separator)] bg-[var(--surface-2)] p-[var(--s-4)]">
                    <p className="text-center text-xs text-[var(--text-2)]">
                      Escanea este código QR con Google Authenticator,
                      1Password, Microsoft Authenticator o Llavero de iCloud:
                    </p>
                    <img
                      src={qrCodeSvg}
                      alt="Código QR para configurar autenticador"
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
                ) : (
                  <div className="flex items-start gap-[var(--s-3)] rounded-[var(--r-md)] border border-[var(--separator)] bg-[var(--surface-2)] p-[var(--s-3)] text-xs text-[var(--text-2)]">
                    <KeyRound className="size-4 shrink-0 text-[var(--accent)] mt-0.5" aria-hidden="true" />
                    <div>
                      <p className="font-semibold text-[var(--text)]">Autenticador ya vinculado</p>
                      <p className="mt-[var(--s-1)]">
                        Abre la app de autenticación que vinculaste previamente (Google Authenticator, Microsoft Authenticator o Contraseñas de tu iPhone) e introduce el código temporal de 6 dígitos.
                      </p>
                    </div>
                  </div>
                )}

                <div className="flex flex-col gap-[var(--s-1)]">
                  <label htmlFor="totp-code" className="ios-label">
                    Código de 6 dígitos
                  </label>
                  <Input
                    id="totp-code"
                    name="totp-code"
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    autoComplete="one-time-code"
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
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
