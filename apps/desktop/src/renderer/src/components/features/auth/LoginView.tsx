import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { SmClockLogo } from '../../ui/sm-clock-logo';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '../../ui/form';
import { SegmentedControl } from '../../ui/segmented-control';
import { useAuth } from '../../../context/AuthContext';
import { ShieldCheck, KeyRound, Server, AlertCircle } from 'lucide-react';

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
  const { loginWithCredentials, loginWithEmergencyPin } = useAuth();
  const [tab, setTab] = useState<'cloud' | 'offline'>('cloud');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

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
          {loginError && (
            <div className="p-3 text-xs rounded-[var(--r-sm)] bg-[var(--danger-bg)] text-[var(--danger)] flex items-start gap-2 border border-[var(--danger)]">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{loginError}</span>
            </div>
          )}

          {tab === 'cloud' ? (
            <Form {...formCloud}>
              <form onSubmit={formCloud.handleSubmit(onSubmitCloud)} className="space-y-3">
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
                      <FormLabel>Contraseña</FormLabel>
                      <FormControl>
                        <Input
                          type="password"
                          placeholder="••••••••"
                          autoComplete="current-password"
                          disabled={isSubmitting}
                          {...field}
                        />
                      </FormControl>
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
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Iniciando sesión...' : 'Ingresar como Administrador'}
                </Button>
              </form>
            </Form>
          ) : (
            <Form {...formPin}>
              <form onSubmit={formPin.handleSubmit(onSubmitPin)} className="space-y-4">
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
      </Card>
    </div>
  );
};
