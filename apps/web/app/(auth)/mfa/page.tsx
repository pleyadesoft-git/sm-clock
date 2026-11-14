'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ShieldCheck } from 'lucide-react';
import { MfaVerifyRequestSchema, UserRoleSchema } from '@sm-clock/contracts';
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

export default function MfaVerificationPage() {
  const router = useRouter();
  const [factorId, setFactorId] = React.useState<string>('');
  const [qrCodeSvg, setQrCodeSvg] = React.useState<string | null>(null);
  const [totpSecret, setTotpSecret] = React.useState<string | null>(null);
  const [code, setCode] = React.useState('');
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isVerifying, setIsVerifying] = React.useState(false);

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
          if (active) setFactorId(verifiedTotp.id);
          return;
        }

        // Limpiar factores TOTP previos no verificados para evitar colisión de friendlyName al recargar
        for (const f of factors.all) {
          if (f.factor_type === 'totp' && f.status === 'unverified') {
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
          setFactorId(enrolled.id);
          setQrCodeSvg(enrolled.totp.qr_code);
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

  const handleVerify = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);

    const parsed = MfaVerifyRequestSchema.safeParse({ factorId, code });
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

      const {
        data: { user },
      } = await supabase.auth.getUser();
      const parsedRol = UserRoleSchema.safeParse(user?.app_metadata?.['rol']);

      if (parsedRol.success && parsedRol.data === 'SUPER_ADMIN') {
        router.push('/admin/empresas');
      } else {
        router.push('/dashboard');
      }
    } catch {
      setErrorMessage('No se pudo verificar el código TOTP.');
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
            <CardTitle>Verificación en dos pasos (TOTP)</CardTitle>
            <CardDescription>
              Obligatorio para cuentas de SUPER_ADMIN y ADMIN_EMPRESA.
            </CardDescription>
          </CardHeader>

          <CardContent>
            {isLoading ? (
              <p className="py-[var(--s-6)] text-center text-sm text-[var(--text-2)]">
                Preparando verificación de seguridad…
              </p>
            ) : (
              <form
                onSubmit={handleVerify}
                className="flex flex-col gap-[var(--s-4)]"
              >
                {qrCodeSvg ? (
                  <div className="flex flex-col items-center gap-[var(--s-3)] rounded-[var(--r-md)] border border-[var(--separator)] bg-[var(--surface-2)] p-[var(--s-4)]">
                    <p className="text-center text-xs text-[var(--text-2)]">
                      Escanea este código QR con Google Authenticator, 1Password
                      o Authy:
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
                    className="rounded-[var(--r-md)] bg-[var(--danger-bg)] px-[var(--s-3)] py-[var(--s-2)] text-xs font-medium text-[var(--danger)]"
                  >
                    {errorMessage}
                  </div>
                ) : null}

                <Button
                  type="submit"
                  disabled={isVerifying || !factorId}
                  className="w-full"
                >
                  {isVerifying
                    ? 'Verificando código…'
                    : 'Confirmar y continuar'}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
