import { createHash, randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  InviteUserRequestSchema,
  sanitizeSearchQuery,
  UserRoleSchema,
  type TenantUserRow,
} from '@sm-clock/contracts';
import { recordAuditLog, requireTenantAdmin } from '@/lib/server/auth';
import {
  buildInvitationEmailTemplate,
  sendTenantEmail,
} from '@/lib/server/smtp-mailer';
import { createSupabaseServiceClient } from '@/lib/server/supabase-admin';

const INVITE_TTL_DAYS = 7;

export async function GET(request: Request): Promise<NextResponse> {
  const auth = await requireTenantAdmin();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { tenantId } = auth;
  const { searchParams } = new URL(request.url);
  const search = sanitizeSearchQuery(
    searchParams.get('search') ?? '',
  ).toLowerCase();
  const rolFilter = searchParams.get('rol') ?? '';
  const estatusFilter = searchParams.get('estatus') ?? '';

  const admin = createSupabaseServiceClient();

  const [perfilesRes, invitacionesRes] = await Promise.all([
    admin
      .from('perfiles_usuarios')
      .select(
        'id, nombre_completo, email, rol, activo, auth_provider, created_at',
      )
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false }),
    admin
      .from('invitaciones_usuarios')
      .select(
        'id, nombre_completo, email, rol, estatus, expira_en, created_at',
      )
      .eq('tenant_id', tenantId)
      .neq('estatus', 'ACEPTADA')
      .order('created_at', { ascending: false }),
  ]);

  if (perfilesRes.error || invitacionesRes.error) {
    return NextResponse.json(
      { error: 'Error al consultar usuarios e invitaciones del tenant' },
      { status: 500 },
    );
  }

  const nowMs = Date.now();
  const rows: TenantUserRow[] = [];

  for (const p of perfilesRes.data ?? []) {
    const parsedRol = UserRoleSchema.safeParse(p.rol);
    const provider: TenantUserRow['auth_provider'] =
      p.auth_provider === 'EMAIL' || p.auth_provider === 'BOTH'
        ? p.auth_provider
        : 'GOOGLE';
    rows.push({
      id: p.id,
      tipo_registro: 'USUARIO',
      nombre_completo: p.nombre_completo,
      email: p.email,
      rol: parsedRol.success ? parsedRol.data : 'OPERADOR',
      estatus: p.activo ? 'ACTIVO' : 'INACTIVO',
      auth_provider: provider,
      created_at: p.created_at,
      expira_en: null,
    });
  }

  for (const inv of invitacionesRes.data ?? []) {
    const parsedRol = UserRoleSchema.safeParse(inv.rol);
    const isExpired =
      inv.estatus === 'PENDIENTE' &&
      new Date(inv.expira_en).getTime() <= nowMs;
    const computedStatus: TenantUserRow['estatus'] = isExpired
      ? 'EXPIRADA'
      : inv.estatus === 'REVOCADA' || inv.estatus === 'EXPIRADA'
        ? inv.estatus
        : 'PENDIENTE';

    rows.push({
      id: inv.id,
      tipo_registro: 'INVITACION',
      nombre_completo: inv.nombre_completo,
      email: inv.email,
      rol: parsedRol.success ? parsedRol.data : 'OPERADOR',
      estatus: computedStatus,
      auth_provider: 'INVITACION',
      created_at: inv.created_at,
      expira_en: inv.expira_en,
    });
  }

  const filtered = rows.filter((row) => {
    if (
      search &&
      !row.nombre_completo.toLowerCase().includes(search) &&
      !row.email.toLowerCase().includes(search)
    ) {
      return false;
    }
    if (rolFilter && row.rol !== rolFilter) {
      return false;
    }
    if (estatusFilter && row.estatus !== estatusFilter) {
      return false;
    }
    return true;
  });

  return NextResponse.json({
    data: filtered,
    total: filtered.length,
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  const auth = await requireTenantAdmin();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: 'Cuerpo JSON inválido' }, { status: 400 });
  }

  const parsed = InviteUserRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message ?? 'Datos de invitación inválidos',
        details: parsed.error.issues,
      },
      { status: 422 },
    );
  }

  const { tenantId, user } = auth;
  const admin = createSupabaseServiceClient();

  const { data: existingProfile } = await admin
    .from('perfiles_usuarios')
    .select('id, tenant_id, activo')
    .ilike('email', parsed.data.email)
    .maybeSingle();

  if (existingProfile && existingProfile.activo) {
    return NextResponse.json(
      { error: 'Ya existe un usuario activo registrado con este correo electrónico' },
      { status: 409 },
    );
  }

  const { data: tenantRow } = await admin
    .from('tenants')
    .select('nombre_comercial')
    .eq('id', tenantId)
    .single();

  const tenantNombre = tenantRow?.nombre_comercial ?? 'Tu Empresa en SM Clock';

  // Revocar invitaciones PENDIENTE previas para el mismo correo en este tenant
  await admin
    .from('invitaciones_usuarios')
    .update({ estatus: 'REVOCADA' })
    .eq('tenant_id', tenantId)
    .ilike('email', parsed.data.email)
    .eq('estatus', 'PENDIENTE');

  const rawToken = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(rawToken).digest('hex');
  const expiraEn = new Date(
    Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000,
  );

  const { data: createdInvite, error: insertError } = await admin
    .from('invitaciones_usuarios')
    .insert({
      tenant_id: tenantId,
      email: parsed.data.email,
      nombre_completo: parsed.data.nombre_completo,
      rol: parsed.data.rol,
      token_hash: tokenHash,
      estatus: 'PENDIENTE',
      invitado_por: user.userId,
      expira_en: expiraEn.toISOString(),
    })
    .select(
      'id, tenant_id, email, nombre_completo, rol, estatus, expira_en, created_at',
    )
    .single();

  if (insertError || !createdInvite) {
    return NextResponse.json(
      { error: 'No fue posible registrar la invitación de usuario' },
      { status: 500 },
    );
  }

  const origin = new URL(request.url).origin;
  const inviteUrl = `${origin}/invitacion/${rawToken}`;

  const expiraEnFormatted = new Intl.DateTimeFormat('es-MX', {
    timeZone: 'America/Tijuana',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(expiraEn);

  const emailTemplate = buildInvitationEmailTemplate({
    nombreCompleto: parsed.data.nombre_completo,
    tenantNombre,
    rol: parsed.data.rol,
    inviteUrl,
    expiraEnFormatted,
  });

  const emailResult = await sendTenantEmail({
    tenantId,
    to: parsed.data.email,
    subject: emailTemplate.subject,
    html: emailTemplate.html,
    text: emailTemplate.text,
  });

  await recordAuditLog({
    tenantId,
    actorId: user.userId,
    accion: 'INVITAR_USUARIO',
    detalle: {
      invitacion_id: createdInvite.id,
      email: parsed.data.email,
      rol: parsed.data.rol,
      smtp_provider: emailResult.provider,
      email_delivered: emailResult.delivered,
    },
  });

  return NextResponse.json(
    {
      data: createdInvite,
      inviteUrl,
      emailDelivery: emailResult,
    },
    { status: 201 },
  );
}
