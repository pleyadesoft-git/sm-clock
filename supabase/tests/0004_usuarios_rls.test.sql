begin;
select plan(10);

-- =========================================================================
-- PREPARACIÓN DE DATOS DE PRUEBA (COMO SUPERUSUARIO / SERVICE_ROLE)
-- =========================================================================

insert into public.tenants (
  id, tenant_code, nombre_comercial, razon_social, rfc, regimen_fiscal, codigo_postal_fiscal, plan_codigo, estatus
) values
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'TEST-E', 'Empresa Tenant E', 'EMPRESA TENANT E SA DE CV', 'ETE010101EEE', '601', '22000', 'PYME', 'ACTIVO'),
  ('ffffffff-ffff-4fff-8fff-ffffffffffff', 'TEST-F', 'Empresa Tenant F', 'EMPRESA TENANT F SA DE CV', 'ETF020202FFF', '601', '22000', 'MICRO', 'ACTIVO');

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    'e0000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'admin.e@empresae.mx',
    '$2a$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234',
    now(),
    '{"provider":"google","providers":["google"],"rol":"ADMIN_EMPRESA","tenant_id":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"}'::jsonb,
    '{"full_name":"Admin Empresa E"}'::jsonb,
    now(),
    now()
  ),
  (
    'f0000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'admin.f@empresaf.mx',
    '$2a$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234',
    now(),
    '{"provider":"google","providers":["google"],"rol":"ADMIN_EMPRESA","tenant_id":"ffffffff-ffff-4fff-8fff-ffffffffffff"}'::jsonb,
    '{"full_name":"Admin Empresa F"}'::jsonb,
    now(),
    now()
  );

insert into public.perfiles_usuarios (
  id, tenant_id, nombre_completo, email, rol, auth_provider, activo
) values
  ('e0000000-0000-4000-8000-000000000001', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'Admin Empresa E', 'admin.e@empresae.mx', 'ADMIN_EMPRESA', 'GOOGLE', true),
  ('f0000000-0000-4000-8000-000000000001', 'ffffffff-ffff-4fff-8fff-ffffffffffff', 'Admin Empresa F', 'admin.f@empresaf.mx', 'ADMIN_EMPRESA', 'GOOGLE', true);

insert into public.configuracion_smtp (
  id, tenant_id, host, puerto, seguridad, usuario, remitente_email, remitente_nombre, activo
) values
  ('eeeeeeee-0009-4000-8000-000000000001', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'smtp.empresae.mx', 587, 'STARTTLS', 'notificaciones@empresae.mx', 'notificaciones@empresae.mx', 'RH Empresa E', true),
  ('ffffffff-0009-4000-8000-000000000001', 'ffffffff-ffff-4fff-8fff-ffffffffffff', 'smtp.empresaf.mx', 587, 'STARTTLS', 'notificaciones@empresaf.mx', 'notificaciones@empresaf.mx', 'RH Empresa F', true);

-- =========================================================================
-- CONTEXTO 1: ADMIN_EMPRESA DEL TENANT E
-- =========================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"e0000000-0000-4000-8000-000000000001","app_metadata":{"rol":"ADMIN_EMPRESA","tenant_id":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"}}';

-- 1. ADMIN_EMPRESA del Tenant E solo ve los perfiles de su propio tenant
select is(
  (select count(*)::int from public.perfiles_usuarios where tenant_id in ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'ffffffff-ffff-4fff-8fff-ffffffffffff')),
  1,
  'ADMIN_EMPRESA del Tenant E solo puede ver perfiles_usuarios de su propio tenant'
);

-- 2. ADMIN_EMPRESA del Tenant E no ve perfiles del Tenant F
select is(
  (select count(*)::int from public.perfiles_usuarios where tenant_id = 'ffffffff-ffff-4fff-8fff-ffffffffffff'),
  0,
  'ADMIN_EMPRESA del Tenant E ve 0 perfiles del Tenant F'
);

-- 3. ADMIN_EMPRESA no puede escalar su rol directamente por cliente (política perfiles_update restringida a SUPER_ADMIN / servidor)
update public.perfiles_usuarios set rol = 'SUPER_ADMIN' where id = 'e0000000-0000-4000-8000-000000000001';
reset role;
select is(
  (select rol from public.perfiles_usuarios where id = 'e0000000-0000-4000-8000-000000000001'),
  'ADMIN_EMPRESA',
  'Un usuario autenticado no puede escalar su propio rol en perfiles_usuarios desde cliente'
);

-- 4. ADMIN_EMPRESA del Tenant E solo ve configuracion_smtp de su propio tenant
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"e0000000-0000-4000-8000-000000000001","app_metadata":{"rol":"ADMIN_EMPRESA","tenant_id":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"}}';
select is(
  (select count(*)::int from public.configuracion_smtp where tenant_id in ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'ffffffff-ffff-4fff-8fff-ffffffffffff')),
  1,
  'ADMIN_EMPRESA del Tenant E solo ve configuracion_smtp de su propio tenant'
);

-- 5. ADMIN_EMPRESA del Tenant E puede actualizar su propia configuracion_smtp
update public.configuracion_smtp set remitente_nombre = 'Asistencia E Actualizado' where id = 'eeeeeeee-0009-4000-8000-000000000001';
select is(
  (select remitente_nombre::text from public.configuracion_smtp where id = 'eeeeeeee-0009-4000-8000-000000000001'),
  'Asistencia E Actualizado',
  'ADMIN_EMPRESA del Tenant E puede actualizar su propia configuracion_smtp'
);

-- 6. ADMIN_EMPRESA del Tenant E NO puede actualizar configuracion_smtp del Tenant F
update public.configuracion_smtp set remitente_nombre = 'Hackeado' where id = 'ffffffff-0009-4000-8000-000000000001';
reset role;
select is(
  (select remitente_nombre::text from public.configuracion_smtp where id = 'ffffffff-0009-4000-8000-000000000001'),
  'RH Empresa F',
  'ADMIN_EMPRESA del Tenant E no puede modificar configuracion_smtp del Tenant F'
);

-- =========================================================================
-- CONTEXTO 2: NOMINISTA DEL TENANT E
-- =========================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"e0000000-0000-4000-8000-000000000002","app_metadata":{"rol":"NOMINISTA","tenant_id":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"}}';

-- 7. NOMINISTA NO puede ver configuracion_smtp
select is(
  (select count(*)::int from public.configuracion_smtp),
  0,
  'NOMINISTA no tiene acceso a configuracion_smtp'
);

-- 8. NOMINISTA NO puede insertar en configuracion_smtp
select throws_ok(
  $$insert into public.configuracion_smtp (tenant_id, host, puerto, seguridad, usuario, remitente_email)
    values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'smtp.hack.mx', 587, 'STARTTLS', 'u', 'u@hack.mx')$$,
  '42501',
  null,
  'NOMINISTA no puede insertar configuracion_smtp'
);

-- =========================================================================
-- CONTEXTO 3: SUPER_ADMIN VE TODOS LOS PERFILES Y CONFIGURACIONES SMTP
-- =========================================================================
set local "request.jwt.claims" = '{"sub":"90000000-0000-4000-8000-000000000099","app_metadata":{"rol":"SUPER_ADMIN","tenant_id":null}}';

-- 9. SUPER_ADMIN ve perfiles de ambos tenants
select is(
  (select count(*)::int from public.perfiles_usuarios where tenant_id in ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'ffffffff-ffff-4fff-8fff-ffffffffffff')),
  2,
  'SUPER_ADMIN puede consultar perfiles_usuarios de todos los tenants'
);

-- 10. SUPER_ADMIN ve configuracion_smtp de ambos tenants
select is(
  (select count(*)::int from public.configuracion_smtp where tenant_id in ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'ffffffff-ffff-4fff-8fff-ffffffffffff')),
  2,
  'SUPER_ADMIN puede consultar configuracion_smtp de todos los tenants'
);

reset role;
select * from finish();
rollback;
