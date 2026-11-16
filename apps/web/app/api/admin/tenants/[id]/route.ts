import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { TenantUpdateSchema, type Database } from '@sm-clock/contracts';
import { AuthError, recordAuditLog, requireRoles } from '@/lib/server/auth';
import {
  broadcastAdminEvent,
  broadcastTenantEvent,
} from '@/lib/server/realtime-broadcast';
import { createSupabaseAdminClient } from '@/lib/server/supabase-admin';

const IdParamSchema = z.object({
  id: z.string().uuid('ID de empresa inválido'),
});

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRoles(['SUPER_ADMIN']);
    const rawParams = await context.params;
    const parsedParams = IdParamSchema.safeParse(rawParams);
    if (!parsedParams.success) {
      return NextResponse.json({ error: 'ID inválido' }, { status: 400 });
    }

    const body: unknown = await request.json();
    const parsedBody = TenantUpdateSchema.safeParse(body);
    if (!parsedBody.success) {
      const details = parsedBody.error.issues
        .map((i) => `• [${i.path.join('.') || 'formulario'}]: ${i.message}`)
        .join('\n');
      return NextResponse.json(
        {
          error:
            parsedBody.error.issues[0]?.message ??
            'Datos de actualización inválidos',
          details,
        },
        { status: 400 },
      );
    }

    const updatePayload: Database['public']['Tables']['tenants']['Update'] = {};
    const d = parsedBody.data;
    if (d.tenant_code !== undefined) updatePayload.tenant_code = d.tenant_code;
    if (d.nombre_comercial !== undefined)
      updatePayload.nombre_comercial = d.nombre_comercial;
    if (d.razon_social !== undefined)
      updatePayload.razon_social = d.razon_social;
    if (d.rfc !== undefined) updatePayload.rfc = d.rfc;
    if (d.regimen_fiscal !== undefined)
      updatePayload.regimen_fiscal = d.regimen_fiscal;
    if (d.codigo_postal_fiscal !== undefined)
      updatePayload.codigo_postal_fiscal = d.codigo_postal_fiscal;
    if (d.uso_cfdi !== undefined) updatePayload.uso_cfdi = d.uso_cfdi;
    if (d.correo_facturacion !== undefined)
      updatePayload.correo_facturacion = d.correo_facturacion;
    if (d.contacto_nombre !== undefined)
      updatePayload.contacto_nombre = d.contacto_nombre;
    if (d.contacto_email !== undefined)
      updatePayload.contacto_email = d.contacto_email;
    if (d.contacto_telefono !== undefined)
      updatePayload.contacto_telefono = d.contacto_telefono;
    if (d.notas_internas !== undefined)
      updatePayload.notas_internas = d.notas_internas;
    if (d.plan_codigo !== undefined) updatePayload.plan_codigo = d.plan_codigo;
    if (d.estatus !== undefined) updatePayload.estatus = d.estatus;
    if (d.zona_horaria !== undefined)
      updatePayload.zona_horaria = d.zona_horaria;
    if (d.logo_url !== undefined) updatePayload.logo_url = d.logo_url;

    const supabase = createSupabaseAdminClient();
    const { data: updated, error } = await supabase
      .from('tenants')
      .update(updatePayload)
      .eq('id', parsedParams.data.id)
      .select('*')
      .single();

    if (error || !updated) {
      return NextResponse.json(
        {
          error: 'No se pudo actualizar la empresa',
          details: error
            ? `Postgres [${error.code}]: ${error.message} (${error.details ?? ''})`
            : 'Registro no encontrado',
        },
        { status: 400 },
      );
    }

    await recordAuditLog({
      tenantId: updated.id,
      actorId: ctx.userId,
      accion: 'TENANT_UPDATE',
      detalle: {
        estatus: updated.estatus,
        plan_codigo: updated.plan_codigo,
      },
      ip: request.headers.get('x-forwarded-for'),
    });

    // Broadcast para clientes conectados en tiempo real
    await Promise.all([
      broadcastAdminEvent('tenants_changed', {
        tenant_id: updated.id,
        tenant_code: updated.tenant_code,
        accion: 'ACTUALIZAR',
      }),
      broadcastTenantEvent(updated.id, 'tenants_changed', {
        tenant_id: updated.id,
        accion: 'ACTUALIZAR',
      }),
    ]);

    return NextResponse.json(updated);
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

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRoles(['SUPER_ADMIN']);
    const rawParams = await context.params;
    const parsedParams = IdParamSchema.safeParse(rawParams);
    if (!parsedParams.success) {
      return NextResponse.json({ error: 'ID inválido' }, { status: 400 });
    }

    const supabase = createSupabaseAdminClient();
    const { data: cancelled, error } = await supabase
      .from('tenants')
      .update({
        estatus: 'CANCELADO',
        deleted_at: new Date().toISOString(),
      })
      .eq('id', parsedParams.data.id)
      .select('*')
      .single();

    if (error || !cancelled) {
      return NextResponse.json(
        { error: 'No se pudo dar de baja la empresa' },
        { status: 400 },
      );
    }

    await recordAuditLog({
      tenantId: cancelled.id,
      actorId: ctx.userId,
      accion: 'TENANT_SOFT_DELETE',
      detalle: { tenant_code: cancelled.tenant_code },
      ip: request.headers.get('x-forwarded-for'),
    });

    await Promise.all([
      broadcastAdminEvent('tenants_changed', {
        tenant_id: cancelled.id,
        tenant_code: cancelled.tenant_code,
        accion: 'CANCELAR',
      }),
      broadcastTenantEvent(cancelled.id, 'tenants_changed', {
        tenant_id: cancelled.id,
        accion: 'CANCELAR',
      }),
    ]);

    return NextResponse.json(cancelled);
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
