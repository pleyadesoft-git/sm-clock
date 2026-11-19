import React, { useState, useEffect, useCallback } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Sheet, SheetFooter } from '../../ui/sheet';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '../../ui/form';
import { SegmentedControl } from '../../ui/segmented-control';
import {
  agentApi,
  type ClockRecord,
  type TestConnectionResult,
  type TestReadRecordsResult,
} from '../../../lib/agent-api';
import { getSupabaseClient } from '../../../lib/supabase';
import { useAuth } from '../../../context/AuthContext';
import { generateFuenteNomenclature } from '@sm-clock/contracts';
import {
  Activity,
  CheckCircle2,
  XCircle,
  Loader2,
  Building2,
  FileText,
  ShieldCheck,
  Radio,
} from 'lucide-react';

const relojSchema = z.object({
  id: z.string().optional(),
  sucursal_id: z.string().min(1, 'Debes seleccionar una sucursal para asignar la terminal'),
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

interface SucursalOption {
  id: string;
  clave: string;
  nombre: string;
}

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
  const [sucursales, setSucursales] = useState<SucursalOption[]>([]);
  const [tenantCode, setTenantCode] = useState<string>('EMP');
  const [loadingSucursales, setLoadingSucursales] = useState(false);
  const [nomenclatura, setNomenclatura] = useState<string | null>(null);

  const [testingConn, setTestingConn] = useState(false);
  const [testConnResult, setTestConnResult] = useState<TestConnectionResult | null>(null);

  const [testingRead, setTestingRead] = useState(false);
  const [testReadResult, setTestReadResult] = useState<TestReadRecordsResult | null>(null);

  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<RelojFormInput, unknown, RelojFormOutput>({
    resolver: zodResolver(relojSchema),
    defaultValues: {
      sucursal_id: '',
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
  const watchedSucursalId = useWatch({ control: form.control, name: 'sucursal_id' });

  // Cargar lista de sucursales y código del tenant activo
  const loadSucursales = useCallback(async () => {
    const activeTenantId = selectedTenantId || user?.tenant_id;
    if (!activeTenantId || user?.isOfflinePin) return;

    setLoadingSucursales(true);
    try {
      const supabase = getSupabaseClient();

      // 1. Obtener código del tenant
      const { data: tenantData } = await supabase
        .from('tenants')
        .select('tenant_code')
        .eq('id', activeTenantId)
        .single();
      if (tenantData?.tenant_code) {
        setTenantCode(tenantData.tenant_code);
      }

      // 2. Obtener sucursales
      const { data: sucsData } = await supabase
        .from('sucursales')
        .select('id, clave, nombre')
        .eq('tenant_id', activeTenantId)
        .eq('activa', true)
        .order('nombre', { ascending: true });

      if (sucsData && sucsData.length > 0) {
        setSucursales(sucsData);
        if (!form.getValues('sucursal_id') && !relojToEdit?.sucursal_id) {
          const firstSucursal = sucsData[0];
          if (firstSucursal) {
            form.setValue('sucursal_id', firstSucursal.id, { shouldDirty: true });
          }
        }
      }
    } catch {
      // Offline fallback
    } finally {
      setLoadingSucursales(false);
    }
  }, [selectedTenantId, user, relojToEdit, form]);

  useEffect(() => {
    if (open) {
      loadSucursales();
    }
  }, [open, loadSucursales]);

  // Calcular nomenclatura según la sucursal seleccionada
  const updateNomenclaturaPreview = useCallback(
    async (sucursalId: string) => {
      if (!sucursalId) {
        setNomenclatura(null);
        return;
      }

      const activeTenantId = selectedTenantId || user?.tenant_id;
      const sucursal = sucursales.find((s) => s.id === sucursalId);
      if (!sucursal) return;

      try {
        const supabase = getSupabaseClient();
        const { data: clocks } = await supabase
          .from('fuentes_asistencia')
          .select('id, consecutivo_sucursal')
          .eq('tenant_id', activeTenantId)
          .eq('sucursal_id', sucursalId);

        const otherClocks = (clocks || []).filter((c) => c.id !== relojToEdit?.id);
        const maxConsecutivo = otherClocks.reduce(
          (max, c) => Math.max(max, c.consecutivo_sucursal || 0),
          0,
        );
        const nextNum = maxConsecutivo + 1;

        const generated = generateFuenteNomenclature({
          tenantCode: tenantCode || 'EMP',
          sucursalClave: sucursal.clave || 'SUC',
          consecutivo: relojToEdit?.consecutivo_sucursal || nextNum,
        });
        setNomenclatura(generated);
      } catch {
        const fallback = `${tenantCode}-${sucursal.clave}-01`;
        setNomenclatura(fallback);
      }
    },
    [selectedTenantId, user, sucursales, relojToEdit, tenantCode],
  );

  useEffect(() => {
    if (watchedSucursalId) {
      updateNomenclaturaPreview(watchedSucursalId);
    }
  }, [watchedSucursalId, updateNomenclaturaPreview]);

  useEffect(() => {
    if (relojToEdit) {
      form.reset({
        id: relojToEdit.id,
        sucursal_id: relojToEdit.sucursal_id || '',
        nombre: relojToEdit.nombre,
        tipo: relojToEdit.tipo,
        ip: relojToEdit.ip,
        puerto: relojToEdit.puerto,
        comm_key: relojToEdit.comm_key || 0,
        usuario: relojToEdit.usuario || 'admin',
        password: '',
        activo: relojToEdit.activo,
      });
      setNomenclatura(relojToEdit.clave || null);
    } else {
      form.reset({
        sucursal_id: sucursales[0]?.id || '',
        nombre: '',
        tipo: 'ZKTECO',
        ip: '192.168.1.201',
        puerto: 4370,
        comm_key: 0,
        usuario: 'admin',
        password: '',
        activo: true,
      });
      setNomenclatura(null);
    }
    setTestConnResult(null);
    setTestReadResult(null);
    setSaveError(null);
  }, [relojToEdit, form, open, sucursales]);

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
    setTestConnResult(null);
    setTestReadResult(null);
  };

  // Paso 1: Prueba de Conectividad LAN
  const handleTestConnection = async () => {
    const values = form.getValues();
    setTestingConn(true);
    setTestConnResult(null);
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
      setTestConnResult(res);
      return res.ok;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error desconocido al probar conexión';
      setTestConnResult({
        ok: false,
        mensaje: msg,
        latencia_ms: 0,
      });
      return false;
    } finally {
      setTestingConn(false);
    }
  };

  // Paso 2: Prueba de Lectura de Registros
  const handleTestReadRecords = async () => {
    const values = form.getValues();
    setTestingRead(true);
    setTestReadResult(null);
    try {
      const res = await agentApi.testReadRecords({
        id: values.id,
        tipo: values.tipo,
        ip: values.ip,
        puerto: Number(values.puerto),
        comm_key: Number(values.comm_key),
        usuario: values.usuario,
        password: values.password,
      });
      setTestReadResult(res);
      return res.ok;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error desconocido al leer registros';
      setTestReadResult({
        ok: false,
        mensaje: msg,
        total_registros: 0,
        registros: [],
      });
      return false;
    } finally {
      setTestingRead(false);
    }
  };

  // Botón unificado para ejecutar ambas pruebas
  const handleTestAll = async () => {
    const connOk = await handleTestConnection();
    if (connOk) {
      await handleTestReadRecords();
    }
  };

  // Regla estricta: dar de alta se habilita tras pruebas exitosas
  const canRegister = Boolean(
    testConnResult?.ok && testReadResult?.ok && watchedSucursalId && nomenclatura,
  );

  const onSubmit = async (values: RelojFormOutput) => {
    setIsSubmitting(true);
    setSaveError(null);
    try {
      // 1. Guardar en SQLite local del agente con nomenclatura y sucursal
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

      // 2. Dar de alta en el tenant en tiempo real vía Supabase / API Web
      const activeTenantId = selectedTenantId || user?.tenant_id;
      if (activeTenantId && !user?.isOfflinePin) {
        const supabase = getSupabaseClient();
        const relojPayload = {
          id: values.id || localRes.id,
          tenant_id: activeTenantId,
          sucursal_id: values.sucursal_id,
          clave: nomenclatura,
          nombre_ubicacion: values.nombre,
          marca: values.tipo,
          ip_local: values.ip,
          puerto: values.puerto,
          usuario_dispositivo: values.usuario || 'admin',
          activo: values.activo,
          intervalo_checadas_min: 30,
          ultima_conexion_exitosa: new Date().toISOString(),
        };

        const { error: upsertErr } = await supabase.from('fuentes_asistencia').upsert(relojPayload);
        if (upsertErr) {
          throw new Error(upsertErr.message);
        }

        // Emitir broadcast en tiempo real para refrescar la vista de Sucursales en la web
        try {
          const chan = supabase.channel(`tenant:${activeTenantId}`);
          await chan.send({
            type: 'broadcast',
            event: 'fuentes_changed',
            payload: {
              fuente_id: relojPayload.id,
              sucursal_id: values.sucursal_id,
              clave: nomenclatura,
            },
          });
        } catch {
          // Ignorar si falla broadcast
        }
      }

      onSaved();
      onOpenChange(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al guardar el reloj en el tenant';
      setSaveError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={relojToEdit ? 'Editar Terminal de Reloj' : 'Dar de Alta Reloj en el Tenant'}
      description="Configura los parámetros del reloj, realiza las pruebas de conectividad y lectura de registros para registrarlo en la sucursal en tiempo real."
      footer={
        <SheetFooter className="flex flex-col sm:flex-row items-center justify-between gap-3 p-4 border-t border-[var(--separator)] bg-[var(--surface)]">
          <div className="text-xs text-[var(--text-2)] flex items-center gap-1.5">
            {canRegister ? (
              <span className="text-[var(--success)] flex items-center gap-1 font-medium">
                <CheckCircle2 className="w-4 h-4" />
                Listo para registrar · Nomenclatura: {nomenclatura}
              </span>
            ) : (
              <span className="text-[var(--text-3)] flex items-center gap-1">
                <ShieldCheck className="w-4 h-4 text-[var(--warning)]" />
                Requiere pruebas de conexión y lectura
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
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
              disabled={isSubmitting || !canRegister}
              className="bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] font-semibold"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-1.5" />
                  Registrando...
                </>
              ) : relojToEdit ? (
                'Actualizar en el Tenant'
              ) : (
                'Dar de Alta en el Tenant'
              )}
            </Button>
          </div>
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
          <form noValidate className="space-y-4">
            {/* 1. Selector de Sucursal y Nomenclatura */}
            <div className="p-3 rounded-[var(--r-md)] border border-[var(--separator)] bg-[var(--surface-2)] space-y-2.5">
              <div className="flex items-center justify-between">
                <FormLabel className="text-xs font-semibold text-[var(--text)] flex items-center gap-1.5">
                  <Building2 className="w-4 h-4 text-[var(--accent)]" />
                  Sucursal de la Empresa
                </FormLabel>
                {loadingSucursales && (
                  <span className="text-[11px] text-[var(--text-3)] flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" /> Cargando...
                  </span>
                )}
              </div>

              <FormField
                control={form.control}
                name="sucursal_id"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <select
                        {...field}
                        disabled={loadingSucursales}
                        className="w-full h-9 text-xs bg-[var(--surface)] text-[var(--text)] border border-[var(--separator)] rounded-[var(--r-sm)] px-2.5 outline-none cursor-pointer focus:border-[var(--accent)]"
                      >
                        <option value="">-- Selecciona una Sucursal --</option>
                        {sucursales.map((s) => (
                          <option key={s.id} value={s.id}>
                            [{s.clave}] {s.nombre}
                          </option>
                        ))}
                      </select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Nomenclatura generada */}
              {nomenclatura && (
                <div className="pt-2 border-t border-[var(--separator)] flex items-center justify-between text-xs">
                  <span className="text-[var(--text-2)]">Nomenclatura asignada:</span>
                  <code className="font-mono font-bold text-[var(--accent)] bg-[var(--surface)] px-2 py-0.5 rounded-[var(--r-sm)] border border-[var(--separator)]">
                    {nomenclatura}
                  </code>
                </div>
              )}
            </div>

            {/* 2. Marca y Nombre */}
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
                  <FormLabel>Nombre o Ubicación del Reloj</FormLabel>
                  <FormControl>
                    <Input placeholder="Ej. Puerta Principal Nave 1" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* 3. Parámetros de Red */}
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
                          placeholder={
                            relojToEdit?.has_password ? '•••••••• (Sin cambios)' : 'Contraseña de admin'
                          }
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
                        <Input type="password" placeholder="Clave de API" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            )}

            {/* 4. Bloque de Pruebas Obligatorias (Conexión y Lectura) */}
            <div className="pt-2 border-t border-[var(--separator)] space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-semibold text-[var(--text)]">
                    Pruebas de Certificación en la LAN
                  </h4>
                  <p className="text-[11px] text-[var(--text-2)]">
                    Realiza ambas pruebas para verificar conectividad y acceso a la bitácora de marcas.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={handleTestAll}
                  disabled={testingConn || testingRead}
                  className="text-xs flex items-center gap-1.5"
                >
                  {testingConn || testingRead ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--accent)]" />
                  ) : (
                    <Activity className="w-3.5 h-3.5 text-[var(--accent)]" />
                  )}
                  Ejecutar Pruebas
                </Button>
              </div>

              {/* Botón y resultado Prueba 1: Conectividad */}
              <div className="p-2.5 rounded-[var(--r-sm)] border border-[var(--separator)] bg-[var(--surface-2)] space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Radio className="w-3.5 h-3.5 text-[var(--accent)]" />
                    <span className="text-xs font-medium text-[var(--text)]">
                      1. Prueba de Conexión de Red
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs px-2"
                    onClick={handleTestConnection}
                    disabled={testingConn}
                  >
                    {testingConn ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      'Probar Conexión'
                    )}
                  </Button>
                </div>

                {testConnResult && (
                  <div
                    className={`p-2 text-xs rounded-[var(--r-sm)] border flex items-start gap-2 ${
                      testConnResult.ok
                        ? 'bg-[var(--success-bg)] text-[var(--success)] border-[var(--success)]'
                        : 'bg-[var(--danger-bg)] text-[var(--danger)] border-[var(--danger)]'
                    }`}
                  >
                    {testConnResult.ok ? (
                      <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                    ) : (
                      <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    )}
                    <div>
                      <p className="font-semibold">
                        {testConnResult.ok ? 'Conexión Exitosa' : 'Fallo de Conexión'}
                      </p>
                      <p>{testConnResult.mensaje}</p>
                      {testConnResult.latencia_ms > 0 && (
                        <p className="mt-0.5 font-mono text-[10px]">
                          Latencia: {testConnResult.latencia_ms.toFixed(1)} ms
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Botón y resultado Prueba 2: Lectura de Registros */}
              <div className="p-2.5 rounded-[var(--r-sm)] border border-[var(--separator)] bg-[var(--surface-2)] space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileText className="w-3.5 h-3.5 text-[var(--accent)]" />
                    <span className="text-xs font-medium text-[var(--text)]">
                      2. Prueba de Lectura de Registros
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs px-2"
                    onClick={handleTestReadRecords}
                    disabled={testingRead}
                  >
                    {testingRead ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      'Probar Lectura'
                    )}
                  </Button>
                </div>

                {testReadResult && (
                  <div
                    className={`p-2 text-xs rounded-[var(--r-sm)] border flex items-start gap-2 ${
                      testReadResult.ok
                        ? 'bg-[var(--success-bg)] text-[var(--success)] border-[var(--success)]'
                        : 'bg-[var(--danger-bg)] text-[var(--danger)] border-[var(--danger)]'
                    }`}
                  >
                    {testReadResult.ok ? (
                      <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                    ) : (
                      <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    )}
                    <div>
                      <p className="font-semibold">
                        {testReadResult.ok
                          ? 'Lectura de Registros Verificada'
                          : 'Fallo al Leer Registros'}
                      </p>
                      <p>{testReadResult.mensaje}</p>
                      {testReadResult.ok && testReadResult.total_registros > 0 && (
                        <p className="mt-0.5 text-[10px] text-[var(--text-2)] font-mono">
                          Registros leídos: {testReadResult.total_registros}
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </form>
        </Form>
      </div>
    </Sheet>
  );
};
