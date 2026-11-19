import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { AuthError, requireRoles } from '@/lib/server/auth';
import { createSupabaseAdminClient } from '@/lib/server/supabase-admin';

const IdParamSchema = z.object({
  id: z.string().uuid('ID de empresa inválido'),
});

export interface TenantRelojDetalle {
  id: string;
  sucursal_id: string | null;
  clave: string | null;
  nombre_ubicacion: string;
  marca: string;
  modelo: string | null;
  ip_local: string | null;
  puerto: number | null;
  activo: boolean;
  ultima_conexion_exitosa: string | null;
  ultimo_error: string | null;
  created_at: string;
}

export interface TenantSucursalConRelojes {
  id: string;
  clave: string;
  nombre: string;
  direccion: string | null;
  activa: boolean;
  created_at: string;
  relojes: TenantRelojDetalle[];
}

export interface TenantAdminContacto {
  id: string;
  nombre_completo: string;
  email: string;
  auth_provider: string;
  activo: boolean;
  ultimo_acceso_en: string | null;
  created_at: string;
}

export interface TenantInfraestructuraResponse {
  tenant: {
    id: string;
    tenant_code: string;
    nombre_comercial: string;
    razon_social: string;
    zona_horaria: string;
    contacto_nombre: string | null;
    contacto_email: string | null;
    contacto_telefono: string | null;
    correo_facturacion: string | null;
  };
  sucursales: TenantSucursalConRelojes[];
  relojes_sin_sucursal: TenantRelojDetalle[];
  administradores: TenantAdminContacto[];
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await requireRoles(['SUPER_ADMIN']);

    const rawParams = await context.params;
    const parsedParams = IdParamSchema.safeParse(rawParams);
    if (!parsedParams.success) {
      return NextResponse.json(
        { error: 'ID de empresa inválido' },
        { status: 400 },
      );
    }

    const tenantId = parsedParams.data.id;
    const supabase = createSupabaseAdminClient();

    const [
      { data: tenant, error: tenantError },
      { data: sucursales, error: sucError },
      { data: fuentes, error: fuentesError },
      { data: admins, error: adminsError },
    ] = await Promise.all([
      supabase
        .from('tenants')
        .select(
          'id, tenant_code, nombre_comercial, razon_social, zona_horaria, contacto_nombre, contacto_email, contacto_telefono, correo_facturacion',
        )
        .eq('id', tenantId)
        .is('deleted_at', null)
        .maybeSingle(),
      supabase
        .from('sucursales')
        .select('id, clave, nombre, direccion, activa, created_at')
        .eq('tenant_id', tenantId)
        .order('clave', { ascending: true }),
      supabase
        .from('fuentes_asistencia')
        .select(
          'id, sucursal_id, clave, nombre_ubicacion, marca, modelo, ip_local, puerto, activo, ultima_conexion_exitosa, ultimo_error, created_at',
        )
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: true }),
      supabase
        .from('perfiles_usuarios')
        .select(
          'id, nombre_completo, email, auth_provider, activo, ultimo_acceso_en, created_at',
        )
        .eq('tenant_id', tenantId)
        .eq('rol', 'ADMIN_EMPRESA')
        .is('deleted_at', null)
        .order('created_at', { ascending: true }),
    ]);

    if (tenantError) {
      return NextResponse.json(
        { error: 'Error al consultar la empresa' },
        { status: 500 },
      );
    }

    if (!tenant) {
      return NextResponse.json(
        { error: 'Empresa no encontrada' },
        { status: 404 },
      );
    }

    if (sucError || fuentesError || adminsError) {
      return NextResponse.json(
        {
          error:
            'Error al consultar la infraestructura y contactos de la empresa',
        },
        { status: 500 },
      );
    }

    const relojesPorSucursal = new Map<string, TenantRelojDetalle[]>();
    const relojesSinSucursal: TenantRelojDetalle[] = [];

    for (const fuente of fuentes ?? []) {
      const reloj: TenantRelojDetalle = {
        id: fuente.id,
        sucursal_id: fuente.sucursal_id,
        clave: fuente.clave,
        nombre_ubicacion: fuente.nombre_ubicacion,
        marca: fuente.marca,
        modelo: fuente.modelo,
        ip_local: fuente.ip_local,
        puerto: fuente.puerto,
        activo: fuente.activo,
        ultima_conexion_exitosa: fuente.ultima_conexion_exitosa,
        ultimo_error: fuente.ultimo_error,
        created_at: fuente.created_at,
      };

      if (reloj.sucursal_id) {
        const list = relojesPorSucursal.get(reloj.sucursal_id) ?? [];
        list.push(reloj);
        relojesPorSucursal.set(reloj.sucursal_id, list);
      } else {
        relojesSinSucursal.push(reloj);
      }
    }

    const sucursalesConRelojes: TenantSucursalConRelojes[] = (
      sucursales ?? []
    ).map((suc) => ({
      id: suc.id,
      clave: suc.clave,
      nombre: suc.nombre,
      direccion: suc.direccion,
      activa: suc.activa,
      created_at: suc.created_at,
      relojes: relojesPorSucursal.get(suc.id) ?? [],
    }));

    // Incluir cualquier reloj cuya sucursal ya no exista en la lista de sucursales
    const knownSucursalIds = new Set(sucursalesConRelojes.map((s) => s.id));
    for (const [sucId, list] of relojesPorSucursal.entries()) {
      if (!knownSucursalIds.has(sucId)) {
        relojesSinSucursal.push(...list);
      }
    }

    const payload: TenantInfraestructuraResponse = {
      tenant,
      sucursales: sucursalesConRelojes,
      relojes_sin_sucursal: relojesSinSucursal,
      administradores: (admins ?? []).map((adm) => ({
        id: adm.id,
        nombre_completo: adm.nombre_completo,
        email: adm.email,
        auth_provider: adm.auth_provider,
        activo: adm.activo,
        ultimo_acceso_en: adm.ultimo_acceso_en,
        created_at: adm.created_at,
      })),
    };

    return NextResponse.json(payload);
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json(
        { error: err.message },
        { status: err.statusCode },
      );
    }
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 },
    );
  }
}
