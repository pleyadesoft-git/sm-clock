import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { SmClockLogo } from '../../ui/sm-clock-logo';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../../ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '../../ui/form';
import { SegmentedControl } from '../../ui/segmented-control';
import { useAuth } from '../../../context/AuthContext';
import { ShieldCheck, KeyRound, Server, AlertCircle, Power, Eye, EyeOff } from 'lucide-react';
import { ConfirmDialog } from '../../ui/confirm-dialog';

const loginSchema = z.object({
  email: z.string().email('Ingresa un correo electrónico válido'),
  password: z.string().min(6, 'La contraseña debe tener al menos 6 caracteres'),
  serverUrl: z.string().url('Ingresa una URL válida').optional().or(z.literal('')),
});

const pinSchema = z.object({
  pin: z.string().min(4, 'El PIN debe tener al menos 4 dígitos'),
});

type LoginFormValues = z.infer<typeof loginSchema>;
type PinFormValues = z.infer<typeof pinSchema>;

export const LoginView: React.FC = () => {
  const { loginWithCredentials, loginWithGoogle, loginWithEmergencyPin } = useAuth();
  const [tab, setTab] = useState<'cloud' | 'offline'>('cloud');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showQuitDialog, setShowQuitDialog] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleQuitApp = async () => {
    if (window.electronAPI?.quitApp) {
      await window.electronAPI.quitApp();
    } else {
      window.close();
    }
  };

  // Abre el flujo de recuperación de contraseña de la app web (envío de link por email)
  const handleForgotPassword = async () => {
    const customServer = formCloud.getValues('serverUrl');
    const webBase =
      (showAdvanced && customServer ? customServer : undefined) ||
      (import.meta.env.VITE_WEB_URL as string | undefined) ||
      (import.meta.env.NEXT_PUBLIC_APP_URL as string | undefined) ||
      'http://127.0.0.1:3000';
    let recoveryUrl: string;
    try {
      recoveryUrl = new URL('/recuperar-contrasena', webBase).toString();
    } catch {
      setLoginError('La URL del servidor no es válida para recuperar la contraseña.');
      return;
    }
    if (window.electronAPI?.openExternal) {
      await window.electronAPI.openExternal(recoveryUrl);
    } else {
      window.open(recoveryUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const formCloud = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
      serverUrl: 'http://127.0.0.1:3000',
    },
    mode: 'onTouched',
  });

  const formPin = useForm<PinFormValues>({
    resolver: zodResolver(pinSchema),
    defaultValues: {
      pin: '',
    },
    mode: 'onTouched',
  });

  React.useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const err = params.get('error');
      if (err) {
        if (err === 'cuenta_inactiva') {
          setLoginError('Tu cuenta se encuentra inactiva o no autorizada. Contacta al administrador.');
        } else if (err === 'sin_invitacion') {
          setLoginError('No se encontró una invitación o perfil activo para esta cuenta de Google.');
        } else if (err === 'super_admin_no_autorizado') {
          setLoginError('Esta cuenta no cuenta con permisos de Super-Administrador.');
        } else {
          setLoginError('Error al autenticar con Google. Por favor intenta de nuevo.');
        }
        window.history.replaceState(null, '', window.location.pathname);
      }
    } catch {
      // Continuar normalmente
    }
  }, []);

  const handleGoogleLogin = async () => {
    setLoginError(null);
    setIsGoogleLoading(true);
    try {
      await loginWithGoogle();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al conectar con Google Auth';
      setLoginError(msg);
    } finally {
      setIsGoogleLoading(false);
    }
  };

  const onSubmitCloud = async (values: LoginFormValues) => {
    setLoginError(null);
    setIsSubmitting(true);
    try {
      await loginWithCredentials(values.email, values.password, values.serverUrl || undefined);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al iniciar sesión';
      setLoginError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const onSubmitPin = async (values: PinFormValues) => {
    setLoginError(null);
    setIsSubmitting(true);
    try {
      await loginWithEmergencyPin(values.pin);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'PIN inválido';
      setLoginError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4 bg-[var(--bg)]">
      <Card className="w-full max-w-[440px] shadow-[var(--shadow-2)] border-[var(--separator)]">
        <CardHeader className="text-center pb-4">
          <div className="flex justify-center mb-3">
            <SmClockLogo size={52} />
          </div>
          <CardTitle className="text-xl font-bold tracking-tight">SM-Clock Agente Local</CardTitle>
          <CardDescription className="text-xs text-[var(--text-2)]">
            Acceso administrativo para configuración de terminales y sincronización
          </CardDescription>

          <div className="pt-3">
            <SegmentedControl
              ariaLabel="Tipo de acceso al agente"
              options={[
                { value: 'cloud', label: 'Cuenta Cloud' },
                { value: 'offline', label: 'PIN Offline' },
              ]}
              value={tab}
              onChange={(val) => {
                setTab(val as 'cloud' | 'offline');
                setLoginError(null);
              }}
            />
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="flex items-center gap-2 p-2.5 rounded-[var(--r-sm)] bg-[var(--success-bg)] text-[var(--success)] text-[11px] border border-[var(--success)]">
            <span className="w-2 h-2 rounded-full bg-[var(--success)] animate-pulse shrink-0" />
            <span>
              <strong>Motor activo en segundo plano:</strong> La lectura y sincronización de checadas continúa operando.
            </span>
          </div>

          {loginError && (
            <div className="p-3 text-xs rounded-[var(--r-sm)] bg-[var(--danger-bg)] text-[var(--danger)] flex items-start gap-2 border border-[var(--danger)]">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{loginError}</span>
            </div>
          )}

          {tab === 'cloud' ? (
            <div className="space-y-4">
              <Form {...formCloud}>
                <form
                  noValidate
                  onSubmit={formCloud.handleSubmit(onSubmitCloud)}
                  className="space-y-3"
                >
                <FormField
                  control={formCloud.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Correo Electrónico</FormLabel>
                      <FormControl>
                        <Input
                          type="email"
                          placeholder="admin@empresa.com"
                          autoComplete="username"
                          disabled={isSubmitting}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={formCloud.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex items-center justify-between">
                        <FormLabel>Contraseña</FormLabel>
                        <button
                          type="button"
                          onClick={() => setShowPassword((prev) => !prev)}
                          aria-pressed={showPassword}
                          aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--accent)] cursor-pointer"
                        >
                          {showPassword ? (
                            <>
                              <EyeOff className="w-3.5 h-3.5" aria-hidden="true" />
                              <span>Ocultar</span>
                            </>
                          ) : (
                            <>
                              <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                              <span>Mostrar</span>
                            </>
                          )}
                        </button>
                      </div>
                      <FormControl>
                        <Input
                          type={showPassword ? 'text' : 'password'}
                          placeholder="••••••••"
                          autoComplete="current-password"
                          disabled={isSubmitting}
                          {...field}
                        />
                      </FormControl>
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => void handleForgotPassword()}
                          className="text-[11px] font-semibold text-[var(--accent)] hover:underline cursor-pointer"
                        >
                          ¿Olvidaste tu contraseña?
                        </button>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div>
                  <button
                    type="button"
                    onClick={() => setShowAdvanced(!showAdvanced)}
                    className="text-[11px] text-[var(--accent)] hover:underline flex items-center gap-1 mt-1 cursor-pointer"
                  >
                    <Server className="w-3 h-3" />
                    {showAdvanced ? 'Ocultar servidor' : 'Configurar servidor personalizado'}
                  </button>
                </div>

                {showAdvanced && (
                  <FormField
                    control={formCloud.control}
                    name="serverUrl"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>URL del Servidor SaaS</FormLabel>
                        <FormControl>
                          <Input
                            type="url"
                            placeholder="http://127.0.0.1:3000"
                            disabled={isSubmitting}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                <Button
                  type="submit"
                  className="w-full mt-4"
                  disabled={isSubmitting || isGoogleLoading}
                >
                  {isSubmitting ? 'Iniciando sesión...' : 'Ingresar con Correo y Contraseña'}
                </Button>
              </form>
            </Form>

            <div className="relative flex items-center justify-center my-3">
              <div className="w-full border-t border-[var(--separator)]" />
              <span className="bg-[var(--surface)] px-3 text-xs font-medium text-[var(--text-2)]">
                ó
              </span>
              <div className="w-full border-t border-[var(--separator)]" />
            </div>

            <Button
              type="button"
              variant="secondary"
              disabled={isSubmitting || isGoogleLoading}
              onClick={handleGoogleLogin}
              className="w-full flex items-center justify-center gap-2 border border-[var(--separator)] hover:bg-[var(--surface-2)]"
            >
              <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                />
              </svg>
              <span>
                {isGoogleLoading ? 'Conectando con Google...' : 'Continuar con Google'}
              </span>
            </Button>
          </div>
          ) : (
            <Form {...formPin}>
              <form
                noValidate
                onSubmit={formPin.handleSubmit(onSubmitPin)}
                className="space-y-4"
              >
                <div className="p-3 text-xs rounded-[var(--r-sm)] bg-[var(--surface-2)] text-[var(--text-2)] flex items-start gap-2 border border-[var(--separator)]">
                  <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5 text-[var(--accent)]" />
                  <span>
                    El PIN local permite configurar terminales e IPs cuando el sitio del cliente aún no tiene conexión a internet.
                  </span>
                </div>

                <FormField
                  control={formPin.control}
                  name="pin"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>PIN de Emergencia</FormLabel>
                      <FormControl>
                        <Input
                          type="password"
                          placeholder="Ingresa PIN local (default: 123456)"
                          maxLength={12}
                          autoFocus
                          disabled={isSubmitting}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Button
                  type="submit"
                  className="w-full"
                  disabled={isSubmitting}
                >
                  <KeyRound className="w-4 h-4 mr-2" />
                  {isSubmitting ? 'Verificando PIN...' : 'Acceder con PIN Local'}
                </Button>
              </form>
            </Form>
          )}
        </CardContent>

        <CardFooter className="pt-0 pb-4 flex justify-center border-t border-[var(--separator)]/40 mt-1">
          <button
            type="button"
            onClick={() => setShowQuitDialog(true)}
            className="text-xs text-[var(--text-2)] hover:text-[var(--danger)] flex items-center gap-1.5 transition-colors cursor-pointer py-1.5 px-3 rounded-md hover:bg-[var(--surface-2)] mt-3"
          >
            <Power className="w-3.5 h-3.5" />
            <span>Cerrar totalmente el agente</span>
          </button>
        </CardFooter>
      </Card>

      <ConfirmDialog
        open={showQuitDialog}
        onOpenChange={setShowQuitDialog}
        title="¿Cerrar totalmente el agente?"
        description="Se detendrá el motor local y la aplicación se cerrará por completo. Durante este tiempo no se leerán marcas de los relojes biométricos ni se sincronizarán con la nómina hasta que vuelvas a abrir la aplicación."
        confirmText="Cerrar y apagar motor"
        cancelText="Mantener activo"
        destructive={true}
        onConfirm={handleQuitApp}
      />
    </div>
  );
};
