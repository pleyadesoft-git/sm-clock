-- =========================================================================
-- SEED DE DESARROLLO LOCAL (FASE 0 + FASE 1)
-- =========================================================================

insert into public.tenants (
  id,
  tenant_code,
  nombre_comercial,
  razon_social,
  rfc,
  regimen_fiscal,
  codigo_postal_fiscal,
  uso_cfdi,
  correo_facturacion,
  contacto_nombre,
  contacto_email,
  contacto_telefono,
  plan_codigo,
  estatus,
  zona_horaria
) values
  (
    '11111111-1111-4111-8111-111111111111',
    'TIJ-001',
    'Maquiladora del Pacífico',
    'MAQUILADORA DEL PACIFICO SA DE CV',
    'MPA010101ABC',
    '601',
    '22444',
    'G03',
    'facturacion@mpacifico.mx',
    'Carlos Mendoza',
    'cmendoza@mpacifico.mx',
    '6641234567',
    'INDUSTRIAL',
    'ACTIVO',
    'America/Tijuana'
  ),
  (
    '22222222-2222-4222-8222-222222222222',
    'TIJ-002',
    'Logística Frontera Norte',
    'LOGISTICA FRONTERA NORTE S DE RL DE CV',
    'LFN050505XYZ',
    '601',
    '22000',
    'G03',
    'cfdi@logisticafrontera.mx',
    'Laura Ríos',
    'lrios@logisticafrontera.mx',
    '6649876543',
    'PYME',
    'PRUEBA',
    'America/Tijuana'
  ),
  (
    '33333333-3333-4333-8333-333333333333',
    'TIJ-003',
    'Taller Precisión Otay',
    'TALLER PRECISION OTAY SA DE CV',
    'TPO121212QWE',
    '626',
    '22430',
    'G03',
    'contabilidad@precisionotay.mx',
    'Roberto Silva',
    'rsilva@precisionotay.mx',
    '6645551122',
    'MICRO',
    'SUSPENDIDO',
    'America/Tijuana'
  )
on conflict (id) do nothing;

-- Sucursales de ejemplo para TIJ-001
insert into public.sucursales (id, tenant_id, clave, nombre, direccion, latitud, longitud, radio_geocerca_m)
values
  (
    '11111111-0001-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111',
    'OTAY-1',
    'Planta Industrial Otay',
    'Blvd. Bellas Artes 1850, Cd. Industrial Otay, Tijuana, B.C.',
    32.5435,
    -116.9355,
    150
  ),
  (
    '11111111-0001-4000-8000-000000000002',
    '11111111-1111-4111-8111-111111111111',
    'FLORIDO-1',
    'Parque Industrial El Florido',
    'Blvd. Insurgentes 21000, El Florido, Tijuana, B.C.',
    32.4561,
    -116.8752,
    200
  )
on conflict (id) do nothing;

-- Empleados de ejemplo para TIJ-001
insert into public.empleados (
  id, tenant_id, sucursal_id, codigo_empleado, credencial, nombre_completo, email, pin_codigo, biometria_facial_activa, webauthn_activo, departamento, puesto
)
values
  (
    '11111111-0002-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111',
    '11111111-0001-4000-8000-000000000001',
    '1001',
    'CRD-1001',
    'Alejandro Hernández Soto',
    'ahernandez@mpacifico.mx',
    '100101',
    true,
    false,
    'Producción',
    'Operador CNC'
  ),
  (
    '11111111-0002-4000-8000-000000000002',
    '11111111-1111-4111-8111-111111111111',
    '11111111-0001-4000-8000-000000000001',
    '1002',
    'CRD-1002',
    'Gabriela Valenzuela Ruiz',
    'gvalenzuela@mpacifico.mx',
    '100202',
    true,
    false,
    'Calidad',
    'Inspectora de Calidad'
  ),
  (
    '11111111-0002-4000-8000-000000000003',
    '11111111-1111-4111-8111-111111111111',
    '11111111-0001-4000-8000-000000000001',
    '1003',
    'CRD-1003',
    'Marco Antonio Estrada Gil',
    'mestrada@mpacifico.mx',
    '100303',
    false,
    false,
    'Almacén',
    'Montacarguista'
  ),
  (
    '11111111-0002-4000-8000-000000000004',
    '11111111-1111-4111-8111-111111111111',
    '11111111-0001-4000-8000-000000000002',
    '1004',
    'CRD-1004',
    'Diana Patricia Morales Vega',
    'dmorales@mpacifico.mx',
    '100404',
    true,
    false,
    'Recursos Humanos',
    'Generalista RH'
  ),
  (
    '11111111-0002-4000-8000-000000000005',
    '11111111-1111-4111-8111-111111111111',
    '11111111-0001-4000-8000-000000000002',
    '1005',
    'CRD-1005',
    'Jorge Luis Camacho Castro',
    'jcamacho@mpacifico.mx',
    '100505',
    false,
    false,
    'Mantenimiento',
    'Técnico Electromecánico'
  )
on conflict (id) do nothing;

-- Fuentes de asistencia (relojes checadores) para TIJ-001
insert into public.fuentes_asistencia (id, tenant_id, sucursal_id, nombre_ubicacion, marca, modelo, ip_local, puerto, activo, ultima_conexion_exitosa)
values
  (
    '11111111-0003-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111',
    '11111111-0001-4000-8000-000000000001',
    'Caseta Principal Otay #1',
    'ZKTECO',
    'SpeedFace-V5L',
    '192.168.10.51',
    4370,
    true,
    now() - interval '2 minutes'
  ),
  (
    '11111111-0003-4000-8000-000000000002',
    '11111111-1111-4111-8111-111111111111',
    '11111111-0001-4000-8000-000000000002',
    'Acceso Comedor El Florido',
    'HIKVISION',
    'DS-K1T341AMF',
    '192.168.20.40',
    80,
    true,
    now() - interval '4 minutes'
  )
on conflict (id) do nothing;

-- Agente local enrolado para TIJ-001
insert into public.agentes (id, tenant_id, nombre, token_hash, version, ultimo_latido)
values
  (
    '11111111-0004-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111',
    'SRV-OTAY-AGENT01',
    'seed_token_hash_otay_01_f3a9d82c7b1e4098a6d5c4b3e2f10987654321abcd',
    '1.0.0',
    now() - interval '40 seconds'
  )
on conflict (id) do nothing;

-- Checadas recientes de ejemplo para TIJ-001
insert into public.checadas (
  tenant_id, fuente_id, codigo_empleado, ts_utc, ts_dispositivo_local, ambigua, tipo_marca, tipo_verificacion, agente_id
)
values
  (
    '11111111-1111-4111-8111-111111111111',
    '11111111-0003-4000-8000-000000000001',
    '1001',
    date_trunc('hour', now()) - interval '3 hours' + interval '58 minutes',
    to_char((date_trunc('hour', now()) - interval '3 hours' + interval '58 minutes') at time zone 'America/Tijuana', 'YYYY-MM-DD HH24:MI:SS'),
    false,
    'ENTRADA',
    'ROSTRO',
    '11111111-0004-4000-8000-000000000001'
  ),
  (
    '11111111-1111-4111-8111-111111111111',
    '11111111-0003-4000-8000-000000000001',
    '1002',
    date_trunc('hour', now()) - interval '3 hours' + interval '59 minutes',
    to_char((date_trunc('hour', now()) - interval '3 hours' + interval '59 minutes') at time zone 'America/Tijuana', 'YYYY-MM-DD HH24:MI:SS'),
    false,
    'ENTRADA',
    'HUELLA',
    '11111111-0004-4000-8000-000000000001'
  ),
  (
    '11111111-1111-4111-8111-111111111111',
    '11111111-0003-4000-8000-000000000001',
    '1003',
    date_trunc('hour', now()) - interval '2 hours' + interval '14 minutes',
    to_char((date_trunc('hour', now()) - interval '2 hours' + interval '14 minutes') at time zone 'America/Tijuana', 'YYYY-MM-DD HH24:MI:SS'),
    false,
    'ENTRADA',
    'HUELLA',
    '11111111-0004-4000-8000-000000000001'
  ),
  (
    '11111111-1111-4111-8111-111111111111',
    '11111111-0003-4000-8000-000000000002',
    '1004',
    date_trunc('hour', now()) - interval '1 hour' + interval '5 minutes',
    to_char((date_trunc('hour', now()) - interval '1 hour' + interval '5 minutes') at time zone 'America/Tijuana', 'YYYY-MM-DD HH24:MI:SS'),
    false,
    'ENTRADA',
    'TARJETA',
    '11111111-0004-4000-8000-000000000001'
  )
on conflict (tenant_id, fuente_id, codigo_empleado, ts_utc) do nothing;

-- Usuarios iniciales en auth.users y perfiles_usuarios (incluyendo ADMIN_EMPRESA con Google Auth por cada tenant)
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'admin@smclock.mx',
    '$2a$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234',
    now(),
    '{"provider":"google","providers":["google","email"],"rol":"SUPER_ADMIN"}'::jsonb,
    '{"full_name":"Super Admin SM Clock"}'::jsonb,
    now(),
    now()
  ),
  (
    '11111111-0009-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'cmendoza@mpacifico.mx',
    '$2a$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234',
    now(),
    '{"provider":"google","providers":["google"],"rol":"ADMIN_EMPRESA","tenant_id":"11111111-1111-4111-8111-111111111111"}'::jsonb,
    '{"full_name":"Carlos Mendoza"}'::jsonb,
    now(),
    now()
  ),
  (
    '22222222-0009-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'lrios@logisticafrontera.mx',
    '$2a$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234',
    now(),
    '{"provider":"google","providers":["google"],"rol":"ADMIN_EMPRESA","tenant_id":"22222222-2222-4222-8222-222222222222"}'::jsonb,
    '{"full_name":"Laura Ríos"}'::jsonb,
    now(),
    now()
  ),
  (
    '33333333-0009-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'rsilva@precisionotay.mx',
    '$2a$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234',
    now(),
    '{"provider":"google","providers":["google"],"rol":"ADMIN_EMPRESA","tenant_id":"33333333-3333-4333-8333-333333333333"}'::jsonb,
    '{"full_name":"Roberto Silva"}'::jsonb,
    now(),
    now()
  )
on conflict (id) do nothing;

insert into public.perfiles_usuarios (
  id, tenant_id, nombre_completo, email, rol, auth_provider, activo
) values
  (
    '00000000-0000-4000-8000-000000000001',
    null,
    'Super Admin SM Clock',
    'admin@smclock.mx',
    'SUPER_ADMIN',
    'BOTH',
    true
  ),
  (
    '11111111-0009-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111',
    'Carlos Mendoza',
    'cmendoza@mpacifico.mx',
    'ADMIN_EMPRESA',
    'GOOGLE',
    true
  ),
  (
    '22222222-0009-4000-8000-000000000001',
    '22222222-2222-4222-8222-222222222222',
    'Laura Ríos',
    'lrios@logisticafrontera.mx',
    'ADMIN_EMPRESA',
    'GOOGLE',
    true
  ),
  (
    '33333333-0009-4000-8000-000000000001',
    '33333333-3333-4333-8333-333333333333',
    'Roberto Silva',
    'rsilva@precisionotay.mx',
    'ADMIN_EMPRESA',
    'GOOGLE',
    true
  )
on conflict (id) do nothing;

-- Bitácora de auditoría inicial de ejemplo
insert into public.auditoria (tenant_id, actor_id, accion, detalle, ip)
select
  '11111111-1111-4111-8111-111111111111',
  '00000000-0000-4000-8000-000000000001',
  'TENANT_CREATE',
  '{"tenant_code": "TIJ-001", "plan_codigo": "INDUSTRIAL", "rfc": "MPA010101ABC", "admin_email": "cmendoza@mpacifico.mx"}'::jsonb,
  '127.0.0.1'::inet
where not exists (select 1 from public.auditoria limit 1);


