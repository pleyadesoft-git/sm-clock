import React, { useState, useEffect } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Sheet, SheetFooter } from '../../ui/sheet';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '../../ui/form';
import { SegmentedControl } from '../../ui/segmented-control';
import { agentApi, type ClockRecord, type TestConnectionResult } from '../../../lib/agent-api';
import { getSupabaseClient } from '../../../lib/supabase';
import { useAuth } from '../../../context/AuthContext';
import { Activity, CheckCircle2, XCircle, Loader2 } from 'lucide-react';

const relojSchema = z.object({
  id: z.string().optional(),
  nombre: z.string().min(2, 'El nombre debe tener al menos 2 caracteres'),
  tipo: z.enum(['ZKTECO', 'HIKVISION', 'TACLOUD']),
  ip: z.string().min(1, 'La dirección IP o host es obligatoria'),
  puerto: z.coerce.number().int().min(1).max(65535, 'Puerto inválido'),
  comm_key: z.coerce.number().int().min(0).default(0),
  usuario: z.string().optional().or(z.literal('')),
  password: z.string().optional().or(z.literal('')),
  activo: z.boolean().default(true),
});

type RelojFormInput = z.input<typeof relojSchema>;
type RelojFormOutput = z.output<typeof relojSchema>;

interface RelojSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  relojToEdit?: ClockRecord | null;
  onSaved: () => void;
}

export const RelojSheet: React.FC<RelojSheetProps> = ({
  open,
  onOpenChange,
  relojToEdit,
  onSaved,
}) => {
  const { user, selectedTenantId } = useAuth();
  const [testingConn, setTestingConn] = useState(false);
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<RelojFormInput, unknown, RelojFormOutput>({
    resolver: zodResolver(relojSchema),
    defaultValues: {
      nombre: '',
      tipo: 'ZKTECO',
      ip: '192.168.1.201',
      puerto: 4370,
      comm_key: 0,
      usuario: 'admin',
      password: '',
      activo: true,
    },
    mode: 'onTouched',
  });

  const tipo = useWatch({ control: form.control, name: 'tipo' });

  useEffect(() => {
    if (relojToEdit) {
      form.reset({
        id: relojToEdit.id,
        nombre: relojToEdit.nombre,
        tipo: relojToEdit.tipo,
        ip: relojToEdit.ip,
        puerto: relojToEdit.puerto,
        comm_key: relojToEdit.comm_key || 0,
        usuario: relojToEdit.usuario || 'admin',
        password: '',
        activo: relojToEdit.activo,
      });
    } else {
      form.reset({
        nombre: '',
        tipo: 'ZKTECO',
        ip: '192.168.1.201',
        puerto: 4370,
        comm_key: 0,
        usuario: 'admin',
        password: '',
        activo: true,
      });
    }
    setTestResult(null);
    setSaveError(null);
  }, [relojToEdit, form, open]);

  // Cambiar puerto por defecto al cambiar la marca
  const handleTipoChange = (newTipo: 'ZKTECO' | 'HIKVISION' | 'TACLOUD') => {
    form.setValue('tipo', newTipo);
    if (newTipo === 'ZKTECO') {
      form.setValue('puerto', 4370);
    } else if (newTipo === 'HIKVISION') {
      form.setValue('puerto', 80);
      form.setValue('usuario', 'admin');
    } else if (newTipo === 'TACLOUD') {
      form.setValue('puerto', 443);
      form.setValue('ip', 'api.tacloud.com');
    }
    setTestResult(null);
  };

  const handleTestConnection = async () => {
    const values = form.getValues();
    setTestingConn(true);
    setTestResult(null);
    try {
      const res = await agentApi.testConnection({
        id: values.id,
        tipo: values.tipo,
        ip: values.ip,
        puerto: Number(values.puerto),
        comm_key: Number(values.comm_key),
        usuario: values.usuario,
        password: values.password,
      });
      setTestResult(res);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error desconocido al probar conexión';
      setTestResult({
        ok: false,
        mensaje: msg,
        latencia_ms: 0,
      });
    } finally {
      setTestingConn(false);
    }
  };

  const onSubmit = async (values: RelojFormOutput) => {
    setIsSubmitting(true);
    setSaveError(null);
    try {
      // 1. Guardar en la base de datos local SQLite del agente
      const localRes = await agentApi.saveReloj({
        id: values.id,
        nombre: values.nombre,
        tipo: values.tipo,
        ip: values.ip,
        puerto: values.puerto,
        comm_key: values.comm_key,
        usuario: values.usuario,
        password: values.password,
        activo: values.activo,
      });

      // 2. Si el usuario está autenticado con Supabase y hay un tenant seleccionado, sincronizar con la nube
      const activeTenantId = selectedTenantId || user?.tenant_id;
      if (activeTenantId && !user?.isOfflinePin) {
        try {
          const supabase = getSupabaseClient();
          const relojPayload = {
            id: values.id || localRes.id,
            tenant_id: activeTenantId,
            nombre_ubicacion: values.nombre,
            marca: values.tipo,
            ip_local: values.ip,
            puerto: values.puerto,
            usuario_dispositivo: values.usuario || 'admin',
            activo: values.activo,
            intervalo_checadas_min: 30,
          };

          await supabase.from('fuentes_asistencia').upsert(relojPayload);
        } catch {
          // No bloquear si la nube está offline temporalmente
        }
      }

      onSaved();
      onOpenChange(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al guardar el reloj';
      setSaveError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={relojToEdit ? 'Editar Terminal' : 'Nueva Terminal de Reloj'}
      description="Configura los parámetros de red y protocolo según la marca del dispositivo"
      footer={
        <SheetFooter className="flex items-center justify-end gap-2 p-4 border-t border-[var(--separator)] bg-[var(--surface)]">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={form.handleSubmit(onSubmit)}
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Guardando...' : relojToEdit ? 'Actualizar Reloj' : 'Guardar Reloj'}
          </Button>
        </SheetFooter>
      }
    >
      <div className="ios-sheet-body flex-1 overflow-y-auto p-4 space-y-4">
          {saveError && (
            <div className="p-3 text-xs rounded-[var(--r-sm)] bg-[var(--danger-bg)] text-[var(--danger)] flex items-start gap-2 border border-[var(--danger)]">
              <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{saveError}</span>
            </div>
          )}

          <Form {...form}>
            <form className="space-y-4">
              <div>
                <FormLabel className="block mb-1.5 text-xs font-medium text-[var(--text-2)]">
                  Marca de la Terminal
                </FormLabel>
                <SegmentedControl
                  ariaLabel="Marca de la Terminal"
                  options={[
                    { value: 'ZKTECO', label: 'ZKTeco' },
                    { value: 'HIKVISION', label: 'Hikvision' },
                    { value: 'TACLOUD', label: 'TA.Cloud' },
                  ]}
                  value={tipo}
                  onChange={(val) => handleTipoChange(val as 'ZKTECO' | 'HIKVISION' | 'TACLOUD')}
                />
              </div>

              <FormField
                control={form.control}
                name="nombre"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nombre o Ubicación</FormLabel>
                    <FormControl>
                      <Input placeholder="Ej. Puerta Principal Nave 1" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <FormField
                    control={form.control}
                    name="ip"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{tipo === 'TACLOUD' ? 'Host / Dominio' : 'Dirección IP'}</FormLabel>
                        <FormControl>
                          <Input placeholder="192.168.1.201" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div>
                  <FormField
                    control={form.control}
                    name="puerto"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Puerto</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            placeholder="4370"
                            {...field}
                            value={field.value !== undefined ? String(field.value) : ''}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              {tipo === 'ZKTECO' && (
                <FormField
                  control={form.control}
                  name="comm_key"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Clave de Comunicación (CommKey)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          placeholder="0 (por defecto)"
                          {...field}
                          value={field.value !== undefined ? String(field.value) : ''}
                        />
                      </FormControl>
                      <p className="text-[11px] text-[var(--text-2)]">
                        0 indica que no requiere contraseña de comunicación UDP/TCP.
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {tipo === 'HIKVISION' && (
                <div className="space-y-3">
                  <FormField
                    control={form.control}
                    name="usuario"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Usuario ISAPI</FormLabel>
                        <FormControl>
                          <Input placeholder="admin" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Contraseña del Dispositivo</FormLabel>
                        <FormControl>
                          <Input
                            type="password"
                            placeholder={relojToEdit?.has_password ? '•••••••• (Sin cambios)' : 'Contraseña de admin'}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              )}

              {tipo === 'TACLOUD' && (
                <div className="space-y-3">
                  <FormField
                    control={form.control}
                    name="usuario"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Usuario de API / Tenant</FormLabel>
                        <FormControl>
                          <Input placeholder="api_user" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Token / Secreto de API</FormLabel>
                        <FormControl>
                          <Input
                            type="password"
                            placeholder="Clave de API"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              )}

              {/* Botón de prueba de conexión en tiempo real */}
              <div className="pt-2">
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full flex items-center justify-center gap-2"
                  onClick={handleTestConnection}
                  disabled={testingConn}
                >
                  {testingConn ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-[var(--accent)]" />
                      <span>Probando conexión en la LAN...</span>
                    </>
                  ) : (
                    <>
                      <Activity className="w-4 h-4 text-[var(--accent)]" />
                      <span>Probar Conectividad Ahora</span>
                    </>
                  )}
                </Button>

                {testResult && (
                  <div
                    className={`mt-2 p-3 text-xs rounded-[var(--r-sm)] border flex items-start gap-2 ${
                      testResult.ok
                        ? 'bg-[var(--success-bg)] text-[var(--success)] border-[var(--success)]'
                        : 'bg-[var(--danger-bg)] text-[var(--danger)] border-[var(--danger)]'
                    }`}
                  >
                    {testResult.ok ? (
                      <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                    ) : (
                      <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    )}
                    <div>
                      <p className="font-semibold">
                        {testResult.ok ? 'Conexión Exitosa' : 'Fallo de Conexión'}
                      </p>
                      <p>{testResult.mensaje}</p>
                      {testResult.latencia_ms > 0 && (
                        <p className="mt-1 font-mono text-[10px]">
                          Latencia: {testResult.latencia_ms.toFixed(1)} ms
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </form>
          </Form>
        </div>
    </Sheet>
  );
};
