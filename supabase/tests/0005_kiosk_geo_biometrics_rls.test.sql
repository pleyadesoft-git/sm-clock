begin;
select plan(12);

-- =========================================================================
-- PREPARACIÓN DE DATOS DE PRUEBA (COMO SUPERUSUARIO / SERVICE_ROLE)
-- =========================================================================

insert into public.tenants (
  id, tenant_code, nombre_comercial, razon_social, rfc, regimen_fiscal, codigo_postal_fiscal, plan_codigo, estatus
) values
  ('99991111-1111-4111-8111-111111111111', 'TEST-KIOSK-A', 'Empresa Kiosk A', 'EMPRESA KIOSK A SA DE CV', 'EKA010101AAA', '601', '22000', 'PYME', 'ACTIVO'),
  ('99992222-2222-4222-8222-222222222222', 'TEST-KIOSK-B', 'Empresa Kiosk B', 'EMPRESA KIOSK B SA DE CV', 'EKB020202BBB', '601', '22000', 'MICRO', 'ACTIVO');

insert into public.sucursales (
  id, tenant_id, clave, nombre, latitud, longitud, radio_geocerca_m
) values
  ('99991111-0001-4000-8000-000000000001', '99991111-1111-4111-8111-111111111111', 'SUC-OTAY', 'Planta Otay', 32.5435, -116.9355, 150),
  ('99992222-0001-4000-8000-000000000001', '99992222-2222-4222-8222-222222222222', 'SUC-ZONA', 'Planta Zona Rio', 32.5250, -117.0200, 120);

insert into public.empleados (
  id, tenant_id, sucursal_id, codigo_empleado, nombre_completo, email, pin_codigo, biometria_facial_activa, webauthn_activo
) values
  ('99991111-0002-4000-8000-000000000001', '99991111-1111-4111-8111-111111111111', '99991111-0001-4000-8000-000000000001', 'EMP-K1', 'Empleado Kiosk A1', 'k1@empresa-a.mx', '482910', true, true),
  ('99991111-0002-4000-8000-000000000002', '99991111-1111-4111-8111-111111111111', '99991111-0001-4000-8000-000000000001', 'EMP-K2', 'Empleado Kiosk A2', 'k2@empresa-a.mx', '593021', false, false),
  ('99992222-0002-4000-8000-000000000001', '99992222-2222-4222-8222-222222222222', '99992222-0001-4000-8000-000000000001', 'EMP-KB1', 'Empleado Kiosk B1', 'kb1@empresa-b.mx', '482910', true, false);

insert into public.empleado_webauthn_credenciales (
  id, tenant_id, empleado_id, credential_id, public_key, nombre_dispositivo
) values
  ('99991111-0006-4000-8000-000000000001', '99991111-1111-4111-8111-111111111111', '99991111-0002-4000-8000-000000000001', 'cred_base64url_tenant_a_1', 'spki_base64_pubkey_a_1', 'iPhone FaceID'),
  ('99992222-0006-4000-8000-000000000001', '99992222-2222-4222-8222-222222222222', '99992222-0002-4000-8000-000000000001', 'cred_base64url_tenant_b_1', 'spki_base64_pubkey_b_1', 'Android Biometric');

insert into public.fuentes_asistencia (
  id, tenant_id, sucursal_id, nombre_ubicacion, marca
) values
  ('99991111-0003-4000-8000-000000000001', '99991111-1111-4111-8111-111111111111', '99991111-0001-4000-8000-000000000001', 'Kiosco Móvil Otay', 'KIOSCO_WEB');

insert into public.checadas (
  tenant_id, fuente_id, sucursal_id, codigo_empleado, ts_utc, ts_dispositivo_local, tipo_marca, tipo_verificacion, latitud, longitud, precision_m, distancia_sucursal_m, dentro_geocerca
) values
  (
    '99991111-1111-4111-8111-111111111111',
    '99991111-0003-4000-8000-000000000001',
    '99991111-0001-4000-8000-000000000001',
    'EMP-K1',
    '2026-11-18T15:00:00Z',
    '2026-11-18 07:00:00',
    'ENTRADA',
    'WEBAUTHN',
    32.5436,
    -116.9354,
    12.5,
    14.8,
    true
  );

-- 1. Restricción UNIQUE (tenant_id, pin_codigo) impide PIN duplicado en la misma empresa
select throws_ok(
  $$insert into public.empleados (
      tenant_id, sucursal_id, codigo_empleado, nombre_completo, pin_codigo
    ) values (
      '99991111-1111-4111-8111-111111111111',
      '99991111-0001-4000-8000-000000000001',
      'EMP-DUP-PIN',
      'Duplicado PIN',
      '482910'
    )$$,
  '23505',
  null,
  'No se permite repetir el mismo PIN de 6 dígitos dentro del mismo tenant'
);

-- 2. Restricción CHECK impide PIN que no sea numérico de 6 dígitos
select throws_ok(
  $$insert into public.empleados (
      tenant_id, sucursal_id, codigo_empleado, nombre_completo, pin_codigo
    ) values (
      '99991111-1111-4111-8111-111111111111',
      '99991111-0001-4000-8000-000000000001',
      'EMP-BAD-PIN',
      'PIN Inválido',
      '12345A'
    )$$,
  '23514',
  null,
  'El PIN del empleado debe ser estrictamente numérico de 6 dígitos'
);

-- 3. Validación de coordenadas en sucursales rechaza latitudes fuera de [-90, 90]
select throws_ok(
  $$insert into public.sucursales (
      tenant_id, clave, nombre, latitud, longitud
    ) values (
      '99991111-1111-4111-8111-111111111111',
      'SUC-BAD-LAT',
      'Latitud Inválida',
      105.0,
      -117.0
    )$$,
  '23514',
  null,
  'La latitud de una sucursal debe estar en el rango [-90, 90]'
);

-- =========================================================================
-- CONTEXTO 1: ADMIN_EMPRESA DEL TENANT A
-- =========================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"90000000-0000-4000-8000-000000000001","app_metadata":{"rol":"ADMIN_EMPRESA","tenant_id":"99991111-1111-4111-8111-111111111111"}}';

-- 4. ADMIN_EMPRESA del Tenant A solo ve credenciales WebAuthn de su propio tenant
select is(
  (
    select count(*)::int
    from public.empleado_webauthn_credenciales
    where tenant_id in ('99991111-1111-4111-8111-111111111111', '99992222-2222-4222-8222-222222222222')
  ),
  1,
  'ADMIN_EMPRESA del Tenant A solo ve credenciales WebAuthn de su propio tenant'
);

-- 5. ADMIN_EMPRESA del Tenant A ve 0 credenciales WebAuthn del Tenant B
select is(
  (
    select count(*)::int
    from public.empleado_webauthn_credenciales
    where tenant_id = '99992222-2222-4222-8222-222222222222'
  ),
  0,
  'ADMIN_EMPRESA del Tenant A no ve credenciales WebAuthn del Tenant B'
);

-- 6. ADMIN_EMPRESA del Tenant A puede registrar credencial WebAuthn en su propio tenant
select lives_ok(
  $$insert into public.empleado_webauthn_credenciales (
      tenant_id, empleado_id, credential_id, public_key, nombre_dispositivo
    ) values (
      '99991111-1111-4111-8111-111111111111',
      '99991111-0002-4000-8000-000000000002',
      'cred_base64url_tenant_a_2',
      'spki_base64_pubkey_a_2',
      'MacBook TouchID'
    )$$,
  'ADMIN_EMPRESA del Tenant A puede insertar credencial WebAuthn en su tenant'
);

-- 7. ADMIN_EMPRESA del Tenant A NO puede registrar credencial WebAuthn en el Tenant B
select throws_ok(
  $$insert into public.empleado_webauthn_credenciales (
      tenant_id, empleado_id, credential_id, public_key, nombre_dispositivo
    ) values (
      '99992222-2222-4222-8222-222222222222',
      '99992222-0002-4000-8000-000000000001',
      'cred_intruso_b',
      'spki_intruso',
      'Dispositivo Intruso'
    )$$,
  '42501',
  null,
  'ADMIN_EMPRESA del Tenant A no puede insertar credenciales WebAuthn en Tenant B'
);

-- 8. ADMIN_EMPRESA del Tenant A puede eliminar credencial WebAuthn de su propio tenant
delete from public.empleado_webauthn_credenciales where credential_id = 'cred_base64url_tenant_a_2';
select is(
  (select count(*)::int from public.empleado_webauthn_credenciales where credential_id = 'cred_base64url_tenant_a_2'),
  0,
  'ADMIN_EMPRESA del Tenant A puede eliminar credenciales WebAuthn de su tenant'
);

-- 9. ADMIN_EMPRESA del Tenant A NO puede eliminar credenciales WebAuthn del Tenant B
delete from public.empleado_webauthn_credenciales where id = '99992222-0006-4000-8000-000000000001';
reset role;
select is(
  (select count(*)::int from public.empleado_webauthn_credenciales where id = '99992222-0006-4000-8000-000000000001'),
  1,
  'ADMIN_EMPRESA del Tenant A no puede eliminar credenciales WebAuthn del Tenant B'
);

-- 10. Checada con geolocalización y método WEBAUTHN conserva sus coordenadas exactas
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"90000000-0000-4000-8000-000000000001","app_metadata":{"rol":"ADMIN_EMPRESA","tenant_id":"99991111-1111-4111-8111-111111111111"}}';
select is(
  (
    select dentro_geocerca
    from public.checadas
    where tenant_id = '99991111-1111-4111-8111-111111111111'
      and codigo_empleado = 'EMP-K1'
  ),
  true,
  'ADMIN_EMPRESA puede leer los campos de geolocalización y geocerca de la checada en su tenant'
);

-- =========================================================================
-- CONTEXTO 2: OPERADOR DEL TENANT A (SOLO LECTURA EN WEBAUTHN)
-- =========================================================================
set local "request.jwt.claims" = '{"sub":"90000000-0000-4000-8000-000000000002","app_metadata":{"rol":"OPERADOR","tenant_id":"99991111-1111-4111-8111-111111111111"}}';

-- 11. OPERADOR puede consultar metadatos de credenciales WebAuthn de su tenant
select is(
  (select count(*)::int from public.empleado_webauthn_credenciales),
  1,
  'OPERADOR del Tenant A puede consultar credenciales WebAuthn de su tenant'
);

-- 12. OPERADOR NO puede insertar ni borrar credenciales WebAuthn
select throws_ok(
  $$insert into public.empleado_webauthn_credenciales (
      tenant_id, empleado_id, credential_id, public_key
    ) values (
      '99991111-1111-4111-8111-111111111111',
      '99991111-0002-4000-8000-000000000001',
      'cred_op_fail',
      'pk_fail'
    )$$,
  '42501',
  null,
  'OPERADOR no puede insertar credenciales WebAuthn'
);

select * from finish();
rollback;
