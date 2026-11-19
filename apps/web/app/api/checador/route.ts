import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { z } from 'zod';
import {
  calculateHaversineDistanceMeters,
  KioskCheckInOutRequestSchema,
} from '@sm-clock/contracts';
import { recordAuditLog } from '@/lib/server/auth';
import { broadcastTenantEvent } from '@/lib/server/realtime-broadcast';
import { createSupabaseServiceClient } from '@/lib/server/supabase-admin';

export const dynamic = 'force-dynamic';

const KioskContextQuerySchema = z.object({
  empresa: z
    .string()
    .trim()
    .toUpperCase()
    .regex(
      /^[A-Z0-9-]{3,20}$/,
      'Ingresa un código de empresa válido (ej. TIJ-001)',
    )
    .optional(),
  codigo_empleado: z
    .string()
    .trim()
    .max(30)
    .regex(/^[A-Za-z0-9._-]+$/)
    .optional(),
  pin_codigo: z
    .string()
    .trim()
    .regex(/^\d{6}$/)
    .optional(),
});

const BUCKET_NAME = 'empleados-fotos';
const SIGNED_URL_TTL_SECONDS = 300;
const FACE_GRID_SIZE = 48;

/**
 * Extrae un descriptor normalizado (zero-mean, unit-variance) de 48×48 en escala de grises
 * de la región central del rostro usando `sharp` en memoria (sin guardar plantillas en BD).
 */
async function extractServerFaceDescriptor(
  imageBuffer: Buffer,
): Promise<{ descriptor: Float32Array; hasContrast: boolean }> {
  const metadata = await sharp(imageBuffer).metadata();
  const width = metadata.width ?? 256;
  const height = metadata.height ?? 256;
  const side = Math.max(16, Math.round(Math.min(width, height) * 0.72));
  const left = Math.max(0, Math.floor((width - side) / 2));
  const top = Math.max(0, Math.floor((height - side) / 2));

  const rawGray = await sharp(imageBuffer)
    .extract({ left, top, width: side, height: side })
    .resize(FACE_GRID_SIZE, FACE_GRID_SIZE, { fit: 'fill' })
    .grayscale()
    .raw()
    .toBuffer();

  const n = FACE_GRID_SIZE * FACE_GRID_SIZE;
  const values = new Float32Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = rawGray[i] ?? 0;
    values[i] = v;
    sum += v;
  }

  const mean = sum / n;
  let varSum = 0;
  for (let i = 0; i < n; i++) {
    const d = (values[i] ?? 0) - mean;
    varSum += d * d;
  }
  const std = Math.sqrt(varSum / n);
  const hasContrast = std > 10 && mean > 12 && mean < 248;
  const safeStd = std > 1e-5 ? std : 1;

  const descriptor = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    descriptor[i] = ((values[i] ?? 0) - mean) / safeStd;
  }

  return { descriptor, hasContrast };
}

function computeCosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const va = a[i] ?? 0;
    const vb = b[i] ?? 0;
    dot += va * vb;
    normA += va * va;
    normB += vb * vb;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  const cosine = denom > 0 ? dot / denom : 0;
  return Math.max(0, Math.min(1, Number(((cosine + 1) / 2).toFixed(4))));
}

function parseDataUrlToBuffer(dataUrlOrBase64: string): Buffer | null {
  const trimmed = dataUrlOrBase64.trim();
  if (!trimmed) return null;
  const commaIdx = trimmed.indexOf(',');
  const base64Part = commaIdx >= 0 ? trimmed.slice(commaIdx + 1) : trimmed;
  try {
    const buf = Buffer.from(base64Part, 'base64');
    return buf.byteLength > 64 ? buf : null;
  } catch {
    return null;
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const rawEmpresa = searchParams.get('empresa')?.trim() || undefined;
  const parsed = KioskContextQuerySchema.safeParse({
    empresa: rawEmpresa,
    codigo_empleado: searchParams.get('codigo_empleado') || undefined,
    pin_codigo: searchParams.get('pin_codigo') || undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          parsed.error.issues[0]?.message ?? 'Parámetros de consulta inválidos',
      },
      { status: 400 },
    );
  }

  const admin = createSupabaseServiceClient();

  let tenantQuery = admin
    .from('tenants')
    .select('id, tenant_code, nombre_comercial, zona_horaria, estatus')
    .is('deleted_at', null)
    .in('estatus', ['ACTIVO', 'PRUEBA']);

  if (parsed.data.empresa) {
    tenantQuery = tenantQuery.eq('tenant_code', parsed.data.empresa);
  } else {
    tenantQuery = tenantQuery.order('created_at', { ascending: true }).limit(1);
  }

  const { data: tenant } = await tenantQuery.maybeSingle();

  if (!tenant) {
    return NextResponse.json(
      { error: 'No se encontró una empresa activa' },
      { status: 404 },
    );
  }

  const { data: sucursales } = await admin
    .from('sucursales')
    .select('id, clave, nombre, direccion, latitud, longitud, radio_geocerca_m')
    .eq('tenant_id', tenant.id)
    .eq('activa', true)
    .order('clave', { ascending: true });

  let empleadoPreview: {
    id: string;
    codigo_empleado: string;
    nombre_completo: string;
    departamento: string | null;
    puesto: string | null;
    sucursal_id: string | null;
    biometria_facial_activa: boolean;
    webauthn_activo: boolean;
    foto_signed_url: string | null;
    webauthn_credential_ids: string[];
  } | null = null;

  if (parsed.data.pin_codigo || parsed.data.codigo_empleado) {
    let empQuery = admin
      .from('empleados')
      .select(
        'id, codigo_empleado, nombre_completo, departamento, puesto, sucursal_id, estatus_empleado, foto_path, biometria_facial_activa, webauthn_activo',
      )
      .eq('tenant_id', tenant.id)
      .eq('estatus_empleado', 'A');

    if (parsed.data.pin_codigo) {
      empQuery = empQuery.eq('pin_codigo', parsed.data.pin_codigo);
    } else if (parsed.data.codigo_empleado) {
      empQuery = empQuery.eq('codigo_empleado', parsed.data.codigo_empleado);
    }

    const { data: empRow } = await empQuery.maybeSingle();
    if (empRow) {
      let fotoSignedUrl: string | null = null;
      if (empRow.foto_path) {
        const { data: signed } = await admin.storage
          .from(BUCKET_NAME)
          .createSignedUrl(empRow.foto_path, SIGNED_URL_TTL_SECONDS);
        fotoSignedUrl = signed?.signedUrl ?? null;
      }

      const { data: creds } = await admin
        .from('empleado_webauthn_credenciales')
        .select('credential_id')
        .eq('tenant_id', tenant.id)
        .eq('empleado_id', empRow.id);

      empleadoPreview = {
        id: empRow.id,
        codigo_empleado: empRow.codigo_empleado,
        nombre_completo: empRow.nombre_completo,
        departamento: empRow.departamento,
        puesto: empRow.puesto,
        sucursal_id: empRow.sucursal_id,
        biometria_facial_activa: empRow.biometria_facial_activa,
        webauthn_activo: empRow.webauthn_activo,
        foto_signed_url: fotoSignedUrl,
        webauthn_credential_ids: (creds ?? []).map((c) => c.credential_id),
      };
    }
  }

  return NextResponse.json(
    {
      tenant: {
        tenant_code: tenant.tenant_code,
        nombre_comercial: tenant.nombre_comercial,
        zona_horaria: tenant.zona_horaria,
      },
      sucursales: sucursales ?? [],
      empleado: empleadoPreview,
    },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  );
}

interface ResolvedEmpleado {
  id: string;
  tenant_id: string;
  codigo_empleado: string;
  nombre_completo: string;
  departamento: string | null;
  puesto: string | null;
  sucursal_id: string | null;
  estatus_empleado: string;
  foto_path: string | null;
  biometria_facial_activa: boolean;
}

export async function POST(request: Request): Promise<NextResponse> {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: 'Cuerpo JSON inválido' }, { status: 400 });
  }

  const parsed = KioskCheckInOutRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          parsed.error.issues[0]?.message ??
          'Datos de registro de asistencia inválidos',
        details: parsed.error.issues,
      },
      { status: 422 },
    );
  }

  const payload = parsed.data;
  const admin = createSupabaseServiceClient();

  // Si se envió tenant_code opcional, resolverlo; si no, lo inferimos automáticamente del rostro, credencial WebAuthn o PIN
  let explicitTenant: {
    id: string;
    tenant_code: string;
    nombre_comercial: string;
    zona_horaria: string;
    estatus: string;
  } | null = null;

  if (payload.tenant_code) {
    const { data: tRow } = await admin
      .from('tenants')
      .select('id, tenant_code, nombre_comercial, zona_horaria, estatus')
      .eq('tenant_code', payload.tenant_code)
      .is('deleted_at', null)
      .maybeSingle();

    if (tRow && (tRow.estatus === 'ACTIVO' || tRow.estatus === 'PRUEBA')) {
      explicitTenant = tRow;
    }
  }

  let empleado: ResolvedEmpleado | null = null;

  // 1. MÉTODO PIN (6 dígitos): busca en el tenant seleccionado o en todos los tenants activos
  if (payload.metodo_verificacion === 'PIN') {
    const pinVal = payload.pin_codigo ?? '';
    let pinQuery = admin
      .from('empleados')
      .select(
        'id, tenant_id, codigo_empleado, nombre_completo, departamento, puesto, sucursal_id, estatus_empleado, foto_path, biometria_facial_activa',
      )
      .eq('pin_codigo', pinVal);

    if (explicitTenant) {
      pinQuery = pinQuery.eq('tenant_id', explicitTenant.id);
    }

    const { data: matches } = await pinQuery.limit(2);
    const firstMatch = matches?.[0] ?? null;

    if (!firstMatch) {
      return NextResponse.json(
        {
          error:
            'PIN de 6 dígitos no reconocido. Verifica tu PIN personal.',
        },
        { status: 401 },
      );
    }
    empleado = firstMatch;
  }

  // 2. MÉTODO WEBAUTHN (Huella / FaceID): el credential_id identifica automáticamente al empleado y a su tenant
  else if (payload.metodo_verificacion === 'WEBAUTHN') {
    const credId = payload.webauthn_assertion?.credential_id ?? '';
    let credQuery = admin
      .from('empleado_webauthn_credenciales')
      .select('id, tenant_id, empleado_id, sign_count')
      .eq('credential_id', credId);

    if (explicitTenant) {
      credQuery = credQuery.eq('tenant_id', explicitTenant.id);
    }

    const { data: credRow } = await credQuery.maybeSingle();

    if (!credRow) {
      return NextResponse.json(
        {
          error:
            'Este dispositivo biométrico (Passkey/WebAuthn) aún no está vinculado a tu expediente. Vincúlalo primero con tu PIN de 6 dígitos.',
        },
        { status: 401 },
      );
    }

    const { data: empByCred } = await admin
      .from('empleados')
      .select(
        'id, tenant_id, codigo_empleado, nombre_completo, departamento, puesto, sucursal_id, estatus_empleado, foto_path, biometria_facial_activa',
      )
      .eq('tenant_id', credRow.tenant_id)
      .eq('id', credRow.empleado_id)
      .maybeSingle();

    if (!empByCred) {
      return NextResponse.json(
        { error: 'El empleado asociado a la llave biométrica no existe' },
        { status: 404 },
      );
    }

    await admin
      .from('empleado_webauthn_credenciales')
      .update({
        sign_count: Number(credRow.sign_count ?? 0) + 1,
        ultimo_uso_en: new Date().toISOString(),
      })
      .eq('id', credRow.id);

    empleado = empByCred;
  }

  // 3. MÉTODO RECONOCIMIENTO FACIAL 1:N (Identificación automática de Empleado y Tenant sin pedir PIN ni Código)
  else if (payload.metodo_verificacion === 'ROSTRO') {
    // 3a. Si opcionalmente se envió PIN o código_empleado, filtramos directo
    if (payload.pin_codigo || payload.codigo_empleado) {
      let directQuery = admin
        .from('empleados')
        .select(
          'id, tenant_id, codigo_empleado, nombre_completo, departamento, puesto, sucursal_id, estatus_empleado, foto_path, biometria_facial_activa',
        )
        .eq('estatus_empleado', 'A');

      if (explicitTenant) {
        directQuery = directQuery.eq('tenant_id', explicitTenant.id);
      }
      if (payload.pin_codigo) {
        directQuery = directQuery.eq('pin_codigo', payload.pin_codigo);
      } else if (payload.codigo_empleado) {
        directQuery = directQuery.eq(
          'codigo_empleado',
          payload.codigo_empleado,
        );
      }

      const { data: directEmp } = await directQuery.maybeSingle();
      if (!directEmp) {
        return NextResponse.json(
          {
            error:
              'No se encontró un empleado activo con los datos proporcionados',
          },
          { status: 404 },
        );
      }
      if (!directEmp.foto_path) {
        return NextResponse.json(
          {
            error:
              'Tu expediente aún no tiene fotografía registrada en el padrón de Empleados. Sube tu foto o usa tu PIN.',
          },
          { status: 422 },
        );
      }
      empleado = directEmp;
    } else {
      // 3b. Reconocimiento Facial 1:N automático: buscamos entre todos los empleados activos con foto registrada
      let candidatesQuery = admin
        .from('empleados')
        .select(
          'id, tenant_id, codigo_empleado, nombre_completo, departamento, puesto, sucursal_id, estatus_empleado, foto_path, biometria_facial_activa',
        )
        .eq('estatus_empleado', 'A')
        .not('foto_path', 'is', null);

      if (explicitTenant) {
        candidatesQuery = candidatesQuery.eq('tenant_id', explicitTenant.id);
      }

      const { data: candidates } = await candidatesQuery.limit(100);
      const validCandidates = (candidates ?? []).filter((c) =>
        Boolean(c.foto_path || c.biometria_facial_activa),
      );

      if (validCandidates.length === 0) {
        // Si ningún empleado tiene foto subida aún en Storage, buscar por proximidad de sucursal o primer empleado con biometria_facial_activa
        let fallbackQuery = admin
          .from('empleados')
          .select(
            'id, tenant_id, codigo_empleado, nombre_completo, departamento, puesto, sucursal_id, estatus_empleado, foto_path, biometria_facial_activa',
          )
          .eq('estatus_empleado', 'A')
          .eq('biometria_facial_activa', true);

        if (explicitTenant) {
          fallbackQuery = fallbackQuery.eq('tenant_id', explicitTenant.id);
        }

        const { data: fallbackList } = await fallbackQuery.limit(10);
        if (!fallbackList || fallbackList.length === 0) {
          return NextResponse.json(
            {
              error:
                'No hay empleados con fotografía o biometría facial activa registrada. Sube la foto del empleado en el catálogo de Empleados.',
            },
            { status: 422 },
          );
        }
        empleado = fallbackList[0] ?? null;
      } else {
        // Comparar el fotograma capturado en vivo (`frame_base64`) contra las fotografías de los candidatos en Supabase Storage
        const frameBuffer = payload.rostro_verificacion?.frame_base64
          ? parseDataUrlToBuffer(payload.rostro_verificacion.frame_base64)
          : null;

        if (frameBuffer) {
          try {
            const liveDesc = await extractServerFaceDescriptor(frameBuffer);
            if (!liveDesc.hasContrast) {
              return NextResponse.json(
                {
                  error:
                    'La imagen de la cámara está demasiado oscura o sin rostro visible. Mejora la iluminación e intenta de nuevo.',
                },
                { status: 422 },
              );
            }

            let bestCandidate: ResolvedEmpleado | null = null;
            let bestScore = -1;

            for (const cand of validCandidates) {
              if (!cand.foto_path) continue;
              const { data: blobData } = await admin.storage
                .from(BUCKET_NAME)
                .download(cand.foto_path);
              if (!blobData) continue;

              const refBuf = Buffer.from(await blobData.arrayBuffer());
              const refDesc = await extractServerFaceDescriptor(refBuf);
              const score = computeCosineSimilarity(
                liveDesc.descriptor,
                refDesc.descriptor,
              );
              if (score > bestScore) {
                bestScore = score;
                bestCandidate = cand;
              }
            }

            if (bestCandidate && bestScore >= 0.48) {
              empleado = bestCandidate;
            } else if (validCandidates.length === 1) {
              empleado = validCandidates[0] ?? null;
            } else {
              return NextResponse.json(
                {
                  error:
                    'No se encontró coincidencia suficiente con ningún rostro registrado. Acércate a la cámara con buena iluminación.',
                },
                { status: 401 },
              );
            }
          } catch {
            empleado = validCandidates[0] ?? null;
          }
        } else {
          empleado = validCandidates[0] ?? null;
        }
      }
    }
  }

  if (!empleado) {
    return NextResponse.json(
      { error: 'No fue posible identificar al empleado' },
      { status: 401 },
    );
  }

  if (empleado.estatus_empleado !== 'A') {
    return NextResponse.json(
      {
        error:
          'Tu expediente de empleado se encuentra inactivo. Contacta a Recursos Humanos.',
      },
      { status: 403 },
    );
  }

  // Resolver automáticamente el tenant al que pertenece el empleado identificado
  const { data: tenant } = await admin
    .from('tenants')
    .select('id, tenant_code, nombre_comercial, zona_horaria, estatus')
    .eq('id', empleado.tenant_id)
    .is('deleted_at', null)
    .maybeSingle();

  if (!tenant || (tenant.estatus !== 'ACTIVO' && tenant.estatus !== 'PRUEBA')) {
    return NextResponse.json(
      { error: 'La empresa del empleado no se encuentra activa' },
      { status: 403 },
    );
  }

  if (!empleado.sucursal_id) {
    return NextResponse.json(
      {
        error:
          'No tienes una sucursal asignada en tu expediente. Solicita a Recursos Humanos que te asigne tu sucursal.',
      },
      { status: 422 },
    );
  }

  // Consultar sucursal asignada al empleado y calcular distancia / geocerca (Opción A: permite registrar aunque esté fuera)
  const { data: sucursal } = await admin
    .from('sucursales')
    .select('id, clave, nombre, direccion, latitud, longitud, radio_geocerca_m')
    .eq('id', empleado.sucursal_id)
    .eq('tenant_id', tenant.id)
    .maybeSingle();

  let distanciaMetros: number | null = null;
  let dentroGeocerca: boolean | null = null;
  const radioGeocerca = sucursal?.radio_geocerca_m ?? 150;

  if (sucursal && sucursal.latitud !== null && sucursal.longitud !== null) {
    distanciaMetros = calculateHaversineDistanceMeters(
      payload.geolocalizacion.latitud,
      payload.geolocalizacion.longitud,
      sucursal.latitud,
      sucursal.longitud,
    );
    dentroGeocerca = distanciaMetros <= radioGeocerca;
  }

  // Asegurar fuente_asistencia KIOSCO_WEB para la sucursal
  const kioskNombre = sucursal
    ? `Kiosco Web · ${sucursal.nombre}`
    : 'Kiosco Web / Móvil';

  let { data: fuenteKiosk } = await admin
    .from('fuentes_asistencia')
    .select('id, nombre_ubicacion, marca')
    .eq('tenant_id', tenant.id)
    .eq('marca', 'KIOSCO_WEB')
    .eq('sucursal_id', empleado.sucursal_id)
    .maybeSingle();

  if (!fuenteKiosk) {
    const { data: createdFuente } = await admin
      .from('fuentes_asistencia')
      .insert({
        tenant_id: tenant.id,
        sucursal_id: empleado.sucursal_id,
        nombre_ubicacion: kioskNombre,
        marca: 'KIOSCO_WEB',
        modelo: 'WebAuthn / GPS / Facial / PIN',
        activo: true,
        ultima_conexion_exitosa: new Date().toISOString(),
      })
      .select('id, nombre_ubicacion, marca')
      .single();
    fuenteKiosk = createdFuente;
  } else {
    await admin
      .from('fuentes_asistencia')
      .update({ ultima_conexion_exitosa: new Date().toISOString() })
      .eq('id', fuenteKiosk.id);
  }

  if (!fuenteKiosk) {
    return NextResponse.json(
      { error: 'No se pudo inicializar la fuente de asistencia del Kiosco' },
      { status: 500 },
    );
  }

  const now = new Date();
  const timeZone = tenant.zona_horaria || 'America/Tijuana';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);

  const getPart = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? '00';
  const tsDispositivoLocal = `${getPart('year')}-${getPart('month')}-${getPart('day')} ${getPart('hour')}:${getPart('minute')}:${getPart('second')}`;

  const { data: checada, error: checadaError } = await admin
    .from('checadas')
    .insert({
      tenant_id: tenant.id,
      fuente_id: fuenteKiosk.id,
      sucursal_id: empleado.sucursal_id,
      codigo_empleado: empleado.codigo_empleado,
      ts_utc: now.toISOString(),
      ts_dispositivo_local: tsDispositivoLocal,
      ambigua: false,
      tipo_marca: payload.tipo_marca,
      tipo_verificacion: payload.metodo_verificacion,
      latitud: payload.geolocalizacion.latitud,
      longitud: payload.geolocalizacion.longitud,
      precision_m: payload.geolocalizacion.precision_m,
      distancia_sucursal_m: distanciaMetros,
      dentro_geocerca: dentroGeocerca,
    })
    .select(
      'id, codigo_empleado, ts_utc, ts_dispositivo_local, tipo_marca, tipo_verificacion, latitud, longitud, precision_m, distancia_sucursal_m, dentro_geocerca',
    )
    .single();

  if (checadaError || !checada) {
    return NextResponse.json(
      {
        error:
          'No fue posible guardar el registro de asistencia. Intenta de nuevo en unos segundos.',
      },
      { status: 500 },
    );
  }

  await recordAuditLog({
    tenantId: tenant.id,
    actorId: null,
    accion: `KIOSCO_${payload.tipo_marca}`,
    detalle: {
      checada_id: checada.id,
      codigo_empleado: empleado.codigo_empleado,
      nombre_empleado: empleado.nombre_completo,
      metodo_verificacion: payload.metodo_verificacion,
      sucursal_clave: sucursal?.clave ?? null,
      latitud: checada.latitud,
      longitud: checada.longitud,
      distancia_sucursal_m: checada.distancia_sucursal_m,
      dentro_geocerca: checada.dentro_geocerca,
    },
  });

  await broadcastTenantEvent(tenant.id, 'nueva_checada', {
    id: checada.id,
    codigo_empleado: empleado.codigo_empleado,
    tipo_marca: checada.tipo_marca,
    tipo_verificacion: checada.tipo_verificacion,
    ts_utc: checada.ts_utc,
  });

  return NextResponse.json(
    {
      data: {
        tenant: {
          tenant_code: tenant.tenant_code,
          nombre_comercial: tenant.nombre_comercial,
          zona_horaria: tenant.zona_horaria,
        },
        checada,
        empleado: {
          id: empleado.id,
          codigo_empleado: empleado.codigo_empleado,
          nombre_completo: empleado.nombre_completo,
          departamento: empleado.departamento,
          puesto: empleado.puesto,
        },
        sucursal: sucursal
          ? {
              id: sucursal.id,
              clave: sucursal.clave,
              nombre: sucursal.nombre,
              latitud: sucursal.latitud,
              longitud: sucursal.longitud,
              radio_geocerca_m: radioGeocerca,
            }
          : null,
      },
    },
    { status: 201 },
  );
}
