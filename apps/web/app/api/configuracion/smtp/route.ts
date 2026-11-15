import { NextResponse } from 'next/server';
import { SmtpConfigUpsertSchema } from '@sm-clock/contracts';
import { recordAuditLog, requireTenantAdmin } from '@/lib/server/auth';
import { encryptCredentialSecret } from '@/lib/server/crypto';
import { getMasterKeyHex } from '@/lib/server/smtp-mailer';
import { createSupabaseServiceClient } from '@/lib/server/supabase-admin';

export async function GET(): Promise<NextResponse> {
  const auth = await requireTenantAdmin();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { tenantId } = auth;
  const admin = createSupabaseServiceClient();

  const { data: row, error } = await admin
    .from('configuracion_smtp')
    .select(
      'id, tenant_id, usar_smtp_propio, host, puerto, seguridad, usuario, remitente_email, remitente_nombre, activo, tiene_password, ultima_prueba_exitosa_en, ultimo_error_prueba, updated_at',
    )
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: 'Error al consultar la configuración SMTP del tenant' },
      { status: 500 },
    );
  }

  if (!row) {
    return NextResponse.json({
      data: {
        tenant_id: tenantId,
        usar_smtp_propio: false,
        host: 'smtp.gmail.com',
        puerto: 465,
        seguridad: 'TLS',
        usuario: '',
        remitente_email: '',
        remitente_nombre: 'SM Clock · Google SMTP',
        activo: true,
        tiene_password: false,
      },
    });
  }

  return NextResponse.json({ data: row });
}

export async function PUT(request: Request): Promise<NextResponse> {
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

  const parsed = SmtpConfigUpsertSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          parsed.error.issues[0]?.message ?? 'Configuración SMTP inválida',
        details: parsed.error.issues,
      },
      { status: 422 },
    );
  }

  const { tenantId, user } = auth;
  const admin = createSupabaseServiceClient();

  const { data: existing } = await admin
    .from('configuracion_smtp')
    .select('id, tiene_password')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  const rawPassword = parsed.data.password?.trim().replace(/\s+/g, '');
  const hasNewPassword = Boolean(rawPassword && rawPassword.length > 0);
  const tienePassword = hasNewPassword || Boolean(existing?.tiene_password);

  if (parsed.data.usar_smtp_propio && !tienePassword) {
    return NextResponse.json(
      {
        error:
          'Debes proporcionar la contraseña o App Password del servidor SMTP al activar un servidor propio',
      },
      { status: 422 },
    );
  }

  const hostToSave = parsed.data.usar_smtp_propio
    ? parsed.data.host
    : 'smtp.gmail.com';
  const puertoToSave = parsed.data.usar_smtp_propio
    ? parsed.data.puerto
    : 465;
  const seguridadToSave = parsed.data.usar_smtp_propio
    ? parsed.data.seguridad
    : 'TLS';

  const { data: upserted, error: upsertError } = await admin
    .from('configuracion_smtp')
    .upsert(
      {
        tenant_id: tenantId,
        usar_smtp_propio: parsed.data.usar_smtp_propio,
        host: hostToSave,
        puerto: puertoToSave,
        seguridad: seguridadToSave,
        usuario: parsed.data.usuario?.trim() || null,
        remitente_email:
          parsed.data.remitente_email?.trim() ||
          parsed.data.usuario?.trim() ||
          null,
        remitente_nombre: parsed.data.remitente_nombre.trim(),
        activo: true,
        tiene_password: tienePassword,
        updated_by: user.userId,
      },
      { onConflict: 'tenant_id' },
    )
    .select(
      'id, tenant_id, usar_smtp_propio, host, puerto, seguridad, usuario, remitente_email, remitente_nombre, activo, tiene_password, updated_at',
    )
    .single();

  if (upsertError || !upserted) {
    return NextResponse.json(
      { error: 'No fue posible guardar la configuración SMTP' },
      { status: 500 },
    );
  }

  // Si se envió una contraseña nueva o App Password, cifrar con AES-256-GCM en `public.credenciales`
  if (hasNewPassword && rawPassword) {
    const encrypted = encryptCredentialSecret({
      plaintext: rawPassword,
      tenantId,
      masterKeyHex: getMasterKeyHex(),
    });

    const { error: credError } = await admin.from('credenciales').upsert(
      {
        tenant_id: tenantId,
        tipo: 'SMTP',
        referencia_id: upserted.id,
        ciphertext: encrypted.ciphertextHex,
        nonce: encrypted.nonceHex,
        key_version: encrypted.keyVersion,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'tenant_id,tipo,referencia_id' },
    );

    if (credError) {
      return NextResponse.json(
        { error: 'Error al cifrar y almacenar la credencial SMTP' },
        { status: 500 },
      );
    }
  }

  await recordAuditLog({
    tenantId,
    actorId: user.userId,
    accion: 'CONFIGURAR_SMTP_TENANT',
    detalle: {
      usar_smtp_propio: upserted.usar_smtp_propio,
      host: upserted.host,
      puerto: upserted.puerto,
      seguridad: upserted.seguridad,
      password_actualizado: hasNewPassword,
    },
  });

  return NextResponse.json({ data: upserted });
}
