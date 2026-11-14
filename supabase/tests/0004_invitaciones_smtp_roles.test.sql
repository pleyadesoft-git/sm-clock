begin;
select plan(15);

-- =========================================================================
-- PREPARACIÓN DE DATOS DE PRUEBA (COMO SUPERUSUARIO / SERVICE_ROLE)
-- =========================================================================

insert into public.tenants (
  id, tenant_code, nombre_comercial, razon_social, rfc, regimen_fiscal, codigo_postal_fiscal, plan_codigo, estatus
) values
  ('11112222-3333-4444-8555-666677778881', 'TEST-INV-A', 'Empresa Inv A', 'EMPRESA INV A SA DE CV', 'EIA010101AAA', '601', '22000', 'PYME', 'ACTIVO'),
  ('11112222-3333-4444-8555-666677778882', 'TEST-INV-B', 'Empresa Inv B', 'EMPRESA INV B SA DE CV', 'EIB020202BBB', '601', '22000', 'MICRO', 'ACTIVO');

insert into public.invitaciones_usuarios (
  id, tenant_id, email, nombre_completo, rol, token_hash, estatus, expira_en
) values
  (
    'aaaa1111-0001-4000-8000-000000000001',
    '11112222-3333-4444-8555-666677778881',
    'operador.a@empresa-a.mx',
    'Operador Uno A',
    'OPERADOR',
    'sha256_token_secreto_invitacion_a',
    'PENDIENTE',
    now() + interval '7 days'
  ),
  (
    'bbbb2222-0001-4000-8000-000000000002',
    '11112222-3333-4444-8555-666677778882',
    'admin.b@empresa-b.mx',
    'Admin Uno B',
    'ADMIN_EMPRESA',
    'sha256_token_secreto_invitacion_b',
    'PENDIENTE',
    now() + interval '7 days'
  );

insert into public.configuracion_smtp (
  tenant_id, usar_smtp_propio, host, puerto, seguridad, usuario, remitente_email, remitente_nombre, tiene_password
) values
  (
    '11112222-3333-4444-8555-666677778881',
    true,
    'smtp.gmail.com',
    465,
    'TLS',
    'notificaciones@empresa-a.mx',
    'notificaciones@empresa-a.mx',
    'RRHH Empresa A',
    true
  ),
  (
    '11112222-3333-4444-8555-666677778882',
    false,
    'smtp.gmail.com',
    465,
    'TLS',
    null,
    null,
    'Empresa B',
    false
  );

insert into public.credenciales (
  id, tenant_id, tipo, referencia_id, ciphertext, nonce
) values
  (
    'aaaa1111-0005-4000-8000-000000000001',
    '11112222-3333-4444-8555-666677778881',
    'SMTP',
    '11112222-3333-4444-8555-666677778881',
    '\xdeadbeef',
    '\x0102030405060708090a0b0c'
  );

insert into public.empleados (
  id, tenant_id, codigo_empleado, nombre_completo
) values
  (
    'aaaa1111-0002-4000-8000-000000000001',
    '11112222-3333-4444-8555-666677778881',
    'EMP-INV-01',
    'Roberto Empleados A'
  );

-- =========================================================================
-- CONTEXTO 1: ADMIN_EMPRESA DEL TENANT A
-- =========================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"70000000-0000-4000-8000-000000000001","app_metadata":{"rol":"ADMIN_EMPRESA","tenant_id":"11112222-3333-4444-8555-666677778881"}}';

-- 1. ADMIN_EMPRESA del Tenant A solo ve invitaciones de su propio tenant
select is(
  (
    select count(*)::int
    from public.invitaciones_usuarios
    where tenant_id in ('11112222-3333-4444-8555-666677778881', '11112222-3333-4444-8555-666677778882')
  ),
  1,
  'ADMIN_EMPRESA del Tenant A solo puede ver las invitaciones de su propio tenant'
);

-- 2. ADMIN_EMPRESA del Tenant A ve 0 invitaciones del Tenant B
select is(
  (
    select count(*)::int
    from public.invitaciones_usuarios
    where tenant_id = '11112222-3333-4444-8555-666677778882'
  ),
  0,
  'ADMIN_EMPRESA del Tenant A no puede ver invitaciones del Tenant B'
);

-- 3. authenticated jamás puede leer la columna sensible token_hash de invitaciones_usuarios
select throws_ok(
  $$select token_hash from public.invitaciones_usuarios$$,
  '42501',
  null,
  'authenticated jamás puede leer invitaciones_usuarios.token_hash'
);

-- 4. ADMIN_EMPRESA del Tenant A solo ve configuracion_smtp de su propio tenant
select is(
  (
    select count(*)::int
    from public.configuracion_smtp
    where tenant_id in ('11112222-3333-4444-8555-666677778881', '11112222-3333-4444-8555-666677778882')
  ),
  1,
  'ADMIN_EMPRESA del Tenant A solo ve la configuración SMTP de su propio tenant'
);

-- 5. ADMIN_EMPRESA del Tenant A puede actualizar configuracion_smtp de su propio tenant
select lives_ok(
  $$update public.configuracion_smtp
       set remitente_nombre = 'RRHH Actualizado A'
     where tenant_id = '11112222-3333-4444-8555-666677778881'$$,
  'ADMIN_EMPRESA puede actualizar configuracion_smtp de su propio tenant'
);

-- 6. ADMIN_EMPRESA NO puede actualizar configuracion_smtp del Tenant B
update public.configuracion_smtp
   set remitente_nombre = 'Hackeado B'
 where tenant_id = '11112222-3333-4444-8555-666677778882';
reset role;
select is(
  (select remitente_nombre::text from public.configuracion_smtp where tenant_id = '11112222-3333-4444-8555-666677778882'),
  'Empresa B',
  'ADMIN_EMPRESA del Tenant A no puede modificar configuracion_smtp del Tenant B'
);

-- 7. ADMIN_EMPRESA jamás puede leer credenciales SMTP en texto ni cifradas
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"70000000-0000-4000-8000-000000000001","app_metadata":{"rol":"ADMIN_EMPRESA","tenant_id":"11112222-3333-4444-8555-666677778881"}}';
select throws_ok(
  $$select * from public.credenciales where tipo = 'SMTP'$$,
  '42501',
  null,
  'authenticated jamás puede leer credenciales SMTP'
);

-- =========================================================================
-- CONTEXTO 2: OPERADOR DEL TENANT A (SOLO CONSULTA DE MOVIMIENTOS)
-- =========================================================================
set local "request.jwt.claims" = '{"sub":"70000000-0000-4000-8000-000000000002","app_metadata":{"rol":"OPERADOR","tenant_id":"11112222-3333-4444-8555-666677778881"}}';

-- 8. OPERADOR NO puede ver invitaciones de usuarios (0 filas)
select is(
  (
    select count(*)::int
    from public.invitaciones_usuarios
    where tenant_id = '11112222-3333-4444-8555-666677778881'
  ),
  0,
  'OPERADOR no puede ver las invitaciones de usuarios del tenant'
);

-- 9. OPERADOR NO puede ver configuracion_smtp (0 filas)
select is(
  (
    select count(*)::int
    from public.configuracion_smtp
    where tenant_id = '11112222-3333-4444-8555-666677778881'
  ),
  0,
  'OPERADOR no tiene acceso a configuracion_smtp del tenant'
);

-- 10. OPERADOR NO puede insertar en configuracion_smtp
select throws_ok(
  $$insert into public.configuracion_smtp (tenant_id, usar_smtp_propio)
    values ('11112222-3333-4444-8555-666677778881', false)$$,
  '42501',
  null,
  'OPERADOR no puede insertar en configuracion_smtp'
);

-- 11. OPERADOR NO puede insertar empleados
select throws_ok(
  $$insert into public.empleados (tenant_id, codigo_empleado, nombre_completo)
    values ('11112222-3333-4444-8555-666677778881', 'EMP-OP-99', 'Intento Operador')$$,
  '42501',
  null,
  'OPERADOR no puede insertar empleados'
);

-- 12. OPERADOR NO puede actualizar empleados
update public.empleados
   set nombre_completo = 'Alterado por Operador'
 where id = 'aaaa1111-0002-4000-8000-000000000001';
reset role;
select is(
  (select nombre_completo::text from public.empleados where id = 'aaaa1111-0002-4000-8000-000000000001'),
  'Roberto Empleados A',
  'OPERADOR no puede actualizar empleados'
);

-- 13. OPERADOR NO puede eliminar empleados
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"70000000-0000-4000-8000-000000000002","app_metadata":{"rol":"OPERADOR","tenant_id":"11112222-3333-4444-8555-666677778881"}}';
delete from public.empleados where id = 'aaaa1111-0002-4000-8000-000000000001';
reset role;
select is(
  (select count(*)::int from public.empleados where id = 'aaaa1111-0002-4000-8000-000000000001'),
  1,
  'OPERADOR no puede eliminar empleados'
);

-- =========================================================================
-- CONTEXTO 3: SUPER_ADMIN VE AMBOS TENANTS
-- =========================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"90000000-0000-4000-8000-000000000099","app_metadata":{"rol":"SUPER_ADMIN","tenant_id":null}}';

-- 14. SUPER_ADMIN ve las invitaciones de ambos tenants
select is(
  (
    select count(*)::int
    from public.invitaciones_usuarios
    where tenant_id in ('11112222-3333-4444-8555-666677778881', '11112222-3333-4444-8555-666677778882')
  ),
  2,
  'SUPER_ADMIN puede consultar invitaciones de múltiples tenants'
);

-- 15. SUPER_ADMIN ve la configuración SMTP de ambos tenants
select is(
  (
    select count(*)::int
    from public.configuracion_smtp
    where tenant_id in ('11112222-3333-4444-8555-666677778881', '11112222-3333-4444-8555-666677778882')
  ),
  2,
  'SUPER_ADMIN puede consultar configuracion_smtp de múltiples tenants'
);

reset role;
select * from finish();
rollback;
