import { NextResponse } from 'next/server';
import { AgentVerifyTechnicianRequestSchema } from '@sm-clock/contracts';
import { checkRateLimit } from '@/lib/server/agent-auth';
import { createSupabaseAdminClient } from '@/lib/server/supabase-admin';

export async function POST(request: Request): Promise<NextResponse> {
  const clientIp =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '127.0.0.1';

  if (!checkRateLimit(`verify_tech:${clientIp}`, 20)) {
    return NextResponse.json(
      { error: 'Demasiados intentos de verificación desde esta IP' },
      { status: 429 },
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: 'Cuerpo JSON inválido' }, { status: 400 });
  }

  const parsed = AgentVerifyTechnicianRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Datos de verificación inválidos', details: parsed.error.issues },
      { status: 422 },
    );
  }

  const { email, password, agente_id } = parsed.data;
  const admin = createSupabaseAdminClient();

  // 1. Verificar credenciales con Supabase Auth
  const { data: authData, error: authError } = await admin.auth.signInWithPassword({
    email,
    password,
  });

  if (authError || !authData.user) {
    return NextResponse.json(
      { error: 'Credenciales inválidas. Verifica tu correo y contraseña.' },
      { status: 401 },
    );
  }

  // 2. Consultar perfil en perfiles_usuarios
  const { data: perfil, error: perfilError } = await admin
    .from('perfiles_usuarios')
    .select('id, email, nombre_completo, rol, tenant_id, activo')
    .eq('id', authData.user.id)
    .single();

  if (perfilError || !perfil || !perfil.activo) {
    return NextResponse.json(
      { error: 'Usuario no encontrado o inactivo en el sistema' },
      { status: 403 },
    );
  }

  // 3. Verificar que el rol sea SUPER_ADMIN o ADMIN_EMPRESA
  if (perfil.rol !== 'SUPER_ADMIN' && perfil.rol !== 'ADMIN_EMPRESA') {
    return NextResponse.json(
      { error: 'Acceso denegado: solo Super-Admin o Administrador de Empresa pueden configurar el agente' },
      { status: 403 },
    );
  }

  // 4. Si es ADMIN_EMPRESA y se proporcionó agente_id, validar pertenencia al tenant
  if (perfil.rol === 'ADMIN_EMPRESA' && agente_id) {
    const { data: agente, error: agenteError } = await admin
      .from('agentes')
      .select('tenant_id')
      .eq('id', agente_id)
      .single();

    if (agenteError || !agente) {
      return NextResponse.json(
        { error: 'Agente no registrado o no encontrado' },
        { status: 404 },
      );
    }

    if (agente.tenant_id !== perfil.tenant_id) {
      return NextResponse.json(
        { error: 'No tienes permisos de administrador sobre la empresa asignada a este agente' },
        { status: 403 },
      );
    }
  }

  return NextResponse.json({
    ok: true,
    usuario: {
      id: perfil.id,
      email: perfil.email,
      nombre_completo: perfil.nombre_completo,
      rol: perfil.rol as 'SUPER_ADMIN' | 'ADMIN_EMPRESA',
      tenant_id: perfil.tenant_id,
    },
  });
}
