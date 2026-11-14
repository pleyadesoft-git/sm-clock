import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { EmpleadoFotoParamsSchema } from '@sm-clock/contracts';
import { checkRateLimit } from '@/lib/server/agent-auth';
import {
  recordAuditLog,
  requireAuthenticatedUser,
} from '@/lib/server/auth';
import { validateAndProcessEmployeePhoto } from '@/lib/server/photo-validator';
import { createSupabaseAdminClient } from '@/lib/server/supabase-admin';

const BUCKET_NAME = 'empleados-fotos';
const SIGNED_URL_TTL_SECONDS = 600; // 10 minutos

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  // Solo SUPER_ADMIN y ADMIN_EMPRESA pueden subir/reemplazar foto; OPERADOR no
  if (auth.user.rol === 'OPERADOR') {
    return NextResponse.json(
      { error: 'Tu rol de Operador no permite modificar la fotografía del trabajador' },
      { status: 403 },
    );
  }

  if (!checkRateLimit(`photo-upload:${auth.user.userId}`, 20)) {
    return NextResponse.json(
      { error: 'Demasiadas subidas de fotografía en poco tiempo. Intenta en un minuto.' },
      { status: 429 },
    );
  }

  const rawParams = await context.params;
  const parsedParams = EmpleadoFotoParamsSchema.safeParse(rawParams);
  if (!parsedParams.success) {
    return NextResponse.json(
      { error: 'Identificador de empleado inválido' },
      { status: 400 },
    );
  }

  const empleadoId = parsedParams.data.id;
  const admin = createSupabaseAdminClient();

  const { data: empleadoRow, error: empError } = await admin
    .from('empleados')
    .select('id, tenant_id, codigo_empleado, foto_path, foto_thumb_path')
    .eq('id', empleadoId)
    .single();

  if (empError || !empleadoRow) {
    return NextResponse.json(
      { error: 'Empleado no encontrado' },
      { status: 404 },
    );
  }

  // Regla Dura #2: verificar que el empleado pertenece al tenant del JWT
  if (
    auth.user.rol !== 'SUPER_ADMIN' &&
    empleadoRow.tenant_id !== auth.user.tenantId
  ) {
    return NextResponse.json(
      { error: 'No tienes acceso a este empleado' },
      { status: 403 },
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: 'Se esperaba un formulario multipart/form-data válido' },
      { status: 400 },
    );
  }

  const fileField = formData.get('file');
  if (!(fileField instanceof Blob)) {
    return NextResponse.json(
      { error: 'Falta el archivo de imagen en el campo "file"' },
      { status: 400 },
    );
  }

  const inputBytes = new Uint8Array(await fileField.arrayBuffer());
  const validation = await validateAndProcessEmployeePhoto(inputBytes);

  if (!validation.ok) {
    return NextResponse.json(
      { error: validation.message },
      { status: validation.status },
    );
  }

  const tenantId = empleadoRow.tenant_id;
  const fileUuid = randomUUID();
  const newMainPath = `${tenantId}/${empleadoId}/${fileUuid}.webp`;
  const newThumbPath = `${tenantId}/${empleadoId}/${fileUuid}_thumb.webp`;

  const { error: uploadMainErr } = await admin.storage
    .from(BUCKET_NAME)
    .upload(newMainPath, validation.data.mainBuffer, {
      contentType: 'image/webp',
      upsert: false,
    });

  if (uploadMainErr) {
    return NextResponse.json(
      { error: 'Error al almacenar la fotografía en el bucket privado' },
      { status: 500 },
    );
  }

  const { error: uploadThumbErr } = await admin.storage
    .from(BUCKET_NAME)
    .upload(newThumbPath, validation.data.thumbBuffer, {
      contentType: 'image/webp',
      upsert: false,
    });

  if (uploadThumbErr) {
    await admin.storage.from(BUCKET_NAME).remove([newMainPath]);
    return NextResponse.json(
      { error: 'Error al almacenar la miniatura de la fotografía' },
      { status: 500 },
    );
  }

  const nowIso = new Date().toISOString();
  const { error: updateErr } = await admin
    .from('empleados')
    .update({
      foto_path: newMainPath,
      foto_thumb_path: newThumbPath,
      foto_actualizada_en: nowIso,
    })
    .eq('id', empleadoId)
    .eq('tenant_id', tenantId);

  if (updateErr) {
    await admin.storage.from(BUCKET_NAME).remove([newMainPath, newThumbPath]);
    return NextResponse.json(
      { error: 'No fue posible actualizar la ruta de fotografía del empleado' },
      { status: 500 },
    );
  }

  // Borrar archivos anteriores del bucket privado si existían
  const oldPaths = [
    empleadoRow.foto_path,
    empleadoRow.foto_thumb_path,
  ].filter((p): p is string => Boolean(p));

  if (oldPaths.length > 0) {
    await admin.storage.from(BUCKET_NAME).remove(oldPaths);
  }

  await recordAuditLog({
    tenantId,
    actorId: auth.user.userId,
    accion: 'EMPLEADO_FOTO_ACTUALIZADA',
    detalle: {
      empleado_id: empleadoId,
      codigo_empleado: empleadoRow.codigo_empleado,
      foto_path: newMainPath,
      width: validation.data.width,
      height: validation.data.height,
    },
  });

  const { data: signedMain } = await admin.storage
    .from(BUCKET_NAME)
    .createSignedUrl(newMainPath, SIGNED_URL_TTL_SECONDS);

  const { data: signedThumb } = await admin.storage
    .from(BUCKET_NAME)
    .createSignedUrl(newThumbPath, SIGNED_URL_TTL_SECONDS);

  return NextResponse.json({
    ok: true,
    foto_path: newMainPath,
    foto_thumb_path: newThumbPath,
    foto_actualizada_en: nowIso,
    signed_url: signedMain?.signedUrl ?? null,
    signed_thumb_url: signedThumb?.signedUrl ?? null,
  });
}
