import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseServiceClient } from '@/lib/server/supabase-admin';

const VerificarInvitacionQuerySchema = z.object({
  token: z.string().trim().min(16, 'Token de invitación no válido').max(256),
});

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const parsed = VerificarInvitacionQuerySchema.safeParse({
    token: searchParams.get('token') ?? '',
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Token de invitación no válido' },
      { status: 400 },
    );
  }

  const tokenHash = createHash('sha256')
    .update(parsed.data.token)
    .digest('hex');
  const admin = createSupabaseServiceClient();

  const { data: invite, error } = await admin
    .from('invitaciones_usuarios')
    .select(
      'id, tenant_id, email, nombre_completo, rol, estatus, expira_en, tenants(nombre_comercial)',
    )
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (error || !invite) {
    return NextResponse.json(
      { error: 'La invitación no existe o el enlace es incorrecto' },
      { status: 404 },
    );
  }

  if (invite.estatus !== 'PENDIENTE') {
    return NextResponse.json(
      {
        error:
          invite.estatus === 'ACEPTADA'
            ? 'Esta invitación ya fue aceptada previamente. Puedes iniciar sesión directamente.'
            : 'Esta invitación fue revocada o ya no se encuentra disponible.',
      },
      { status: 410 },
    );
  }

  if (new Date(invite.expira_en).getTime() <= Date.now()) {
    return NextResponse.json(
      {
        error:
          'El enlace de invitación ha expirado. Solicita una nueva invitación al administrador de tu empresa.',
      },
      { status: 410 },
    );
  }

  const tenantData = Array.isArray(invite.tenants)
    ? invite.tenants[0]
    : invite.tenants;

  return NextResponse.json({
    data: {
      id: invite.id,
      email: invite.email,
      nombre_completo: invite.nombre_completo,
      rol: invite.rol,
      expira_en: invite.expira_en,
      tenant_nombre: tenantData?.nombre_comercial ?? 'Tu Empresa',
    },
  });
}
