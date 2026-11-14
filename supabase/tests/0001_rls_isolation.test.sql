begin;
select plan(20);

-- =========================================================================
-- PREPARACIÓN DE DATOS DE PRUEBA (COMO SUPERUSUARIO / SERVICE_ROLE)
-- =========================================================================

insert into public.tenants (
  id, tenant_code, nombre_comercial, razon_social, rfc, regimen_fiscal, codigo_postal_fiscal, plan_codigo, estatus
) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'TEST-A', 'Empresa Tenant A', 'EMPRESA TENANT A SA DE CV', 'ETA010101AAA', '601', '22000', 'PYME', 'ACTIVO'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'TEST-B', 'Empresa Tenant B', 'EMPRESA TENANT B SA DE CV', 'ETB020202BBB', '601', '22000', 'MICRO', 'ACTIVO');

insert into public.sucursales (id, tenant_id, clave, nombre) values
  ('aaaaaaaa-0001-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'SUC-OTAY', 'Planta Otay A'),
  ('bbbbbbbb-0001-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'SUC-CENTRO', 'Sucursal Centro B');

insert into public.empleados (id, tenant_id, sucursal_id, codigo_empleado, nombre_completo) values
  ('aaaaaaaa-0002-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-0001-4000-8000-000000000001', 'EMP-A01', 'Juan Pérez A'),
  ('bbbbbbbb-0002-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bbbbbbbb-0001-4000-8000-000000000001', 'EMP-B01', 'María López B');

insert into public.fuentes_asistencia (id, tenant_id, nombre_ubicacion, marca) values
  ('aaaaaaaa-0003-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Reloj Acceso A', 'ZKTECO'),
  ('bbbbbbbb-0003-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Reloj Acceso B', 'HIKVISION');

insert into public.agentes (id, tenant_id, nombre, token_hash) values
  ('aaaaaaaa-0004-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Agente A', 'hash_secreto_agente_a'),
  ('bbbbbbbb-0004-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Agente B', 'hash_secreto_agente_b');

insert into public.credenciales (id, tenant_id, tipo, referencia_id, ciphertext, nonce) values
  ('aaaaaaaa-0005-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'RELOJ', 'aaaaaaaa-0003-4000-8000-000000000001', '\xdeadbeef', '\x01020304');

insert into public.auditoria (tenant_id, accion, detalle) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'ALTA_EMPRESA', '{"nota":"A"}'::jsonb),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'ALTA_EMPRESA', '{"nota":"B"}'::jsonb);

-- =========================================================================
-- CONTEXTO 1: ADMIN_EMPRESA DEL TENANT A
-- =========================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"10000000-0000-4000-8000-000000000001","app_metadata":{"rol":"ADMIN_EMPRESA","tenant_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}}';

-- 1. Solo ve su propio tenant
select is(
  (select count(*)::int from public.tenants where id in ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')),
  1,
  'ADMIN_EMPRESA del Tenant A solo puede ver su propio registro en tenants'
);

-- 2. Solo ve empleados del Tenant A
select is(
  (select count(*)::int from public.empleados),
  1,
  'ADMIN_EMPRESA del Tenant A solo ve empleados del Tenant A'
);

-- 3. No ve empleados del Tenant B
select is(
  (select count(*)::int from public.empleados where tenant_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  0,
  'ADMIN_EMPRESA del Tenant A no ve empleados del Tenant B'
);

-- 4. Puede insertar empleado en su propio Tenant A
select lives_ok(
  $$insert into public.empleados (tenant_id, codigo_empleado, nombre_completo)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'EMP-A02', 'Pedro Gómez A')$$,
  'ADMIN_EMPRESA del Tenant A puede insertar empleado en Tenant A'
);

-- 5. NO puede insertar empleado en el Tenant B
select throws_ok(
  $$insert into public.empleados (tenant_id, codigo_empleado, nombre_completo)
    values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'EMP-B99', 'Intruso en B')$$,
  '42501',
  null,
  'ADMIN_EMPRESA del Tenant A no puede insertar empleados en Tenant B'
);

-- 6. NO puede actualizar empleados del Tenant B (0 filas afectadas)
update public.empleados set nombre_completo = 'Hackeado' where id = 'bbbbbbbb-0002-4000-8000-000000000001';
reset role;
select is(
  (select nombre_completo from public.empleados where id = 'bbbbbbbb-0002-4000-8000-000000000001'),
  'María López B',
  'ADMIN_EMPRESA del Tenant A no puede modificar empleados del Tenant B'
);

-- 7. NO puede borrar sucursales del Tenant B
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"10000000-0000-4000-8000-000000000001","app_metadata":{"rol":"ADMIN_EMPRESA","tenant_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}}';
delete from public.sucursales where id = 'bbbbbbbb-0001-4000-8000-000000000001';
reset role;
select is(
  (select count(*)::int from public.sucursales where id = 'bbbbbbbb-0001-4000-8000-000000000001'),
  1,
  'ADMIN_EMPRESA del Tenant A no puede eliminar sucursales del Tenant B'
);

-- 8. Solo ve fuentes_asistencia del Tenant A
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"10000000-0000-4000-8000-000000000001","app_metadata":{"rol":"ADMIN_EMPRESA","tenant_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}}';
select is(
  (select count(*)::int from public.fuentes_asistencia),
  1,
  'ADMIN_EMPRESA del Tenant A solo ve fuentes_asistencia de su tenant'
);

-- 9. NO puede leer la tabla credenciales
select throws_ok(
  $$select * from public.credenciales$$,
  '42501',
  null,
  'authenticated jamás puede hacer SELECT en public.credenciales'
);

-- 10. Puede leer metadatos de agentes de su tenant pero NO token_hash
select is(
  (select count(*)::int from public.agentes),
  1,
  'ADMIN_EMPRESA del Tenant A ve metadatos de sus agentes'
);

-- 11. Intentar leer agentes.token_hash falla por privilegios de columna
select throws_ok(
  $$select token_hash from public.agentes$$,
  '42501',
  null,
  'authenticated jamás puede leer la columna agentes.token_hash'
);

-- 12. ADMIN_EMPRESA solo ve auditoría de su propio tenant
select is(
  (select count(*)::int from public.auditoria),
  1,
  'ADMIN_EMPRESA del Tenant A solo ve registros de auditoría de su tenant'
);

-- =========================================================================
-- CONTEXTO 2: NOMINISTA DEL TENANT A (SOLO LECTURA)
-- =========================================================================
set local "request.jwt.claims" = '{"sub":"10000000-0000-4000-8000-000000000002","app_metadata":{"rol":"NOMINISTA","tenant_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}}';

-- 13. NOMINISTA puede leer empleados de su tenant
select is(
  (select count(*)::int from public.empleados),
  2,
  'NOMINISTA del Tenant A puede consultar empleados de su tenant'
);

-- 14. NOMINISTA NO puede insertar empleados
select throws_ok(
  $$insert into public.empleados (tenant_id, codigo_empleado, nombre_completo)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'EMP-A03', 'No Permitido')$$,
  '42501',
  null,
  'NOMINISTA no tiene permiso para insertar empleados'
);

-- 15. NOMINISTA NO puede insertar sucursales
select throws_ok(
  $$insert into public.sucursales (tenant_id, clave, nombre)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'SUC-NO', 'Sucursal No Permitida')$$,
  '42501',
  null,
  'NOMINISTA no tiene permiso para insertar sucursales'
);

-- 16. NOMINISTA NO puede actualizar empleados
update public.empleados set nombre_completo = 'Intento Nominista' where id = 'aaaaaaaa-0002-4000-8000-000000000001';
reset role;
select is(
  (select nombre_completo from public.empleados where id = 'aaaaaaaa-0002-4000-8000-000000000001'),
  'Juan Pérez A',
  'NOMINISTA no puede actualizar empleados'
);

-- 17. NOMINISTA NO puede eliminar empleados
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"10000000-0000-4000-8000-000000000002","app_metadata":{"rol":"NOMINISTA","tenant_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}}';
delete from public.empleados where id = 'aaaaaaaa-0002-4000-8000-000000000001';
reset role;
select is(
  (select count(*)::int from public.empleados where id = 'aaaaaaaa-0002-4000-8000-000000000001'),
  1,
  'NOMINISTA no puede eliminar empleados'
);

-- =========================================================================
-- CONTEXTO 3: SUPER_ADMIN (DUEÑO DEL SAAS)
-- =========================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"10000000-0000-4000-8000-000000000099","app_metadata":{"rol":"SUPER_ADMIN"}}';

-- 18. SUPER_ADMIN ve todos los tenants
select ok(
  (select count(*)::int from public.tenants where id in ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')) = 2,
  'SUPER_ADMIN puede consultar todos los tenants'
);

-- 19. SUPER_ADMIN puede crear un nuevo tenant
select lives_ok(
  $$insert into public.tenants (tenant_code, nombre_comercial, razon_social, rfc, regimen_fiscal, codigo_postal_fiscal)
    values ('TEST-C', 'Empresa C', 'EMPRESA C SA DE CV', 'ETC030303CCC', '601', '22000')$$,
  'SUPER_ADMIN puede crear nuevos tenants'
);

-- =========================================================================
-- CONTEXTO 4: INMUTABILIDAD DE LA AUDITORÍA
-- =========================================================================
reset role;
-- 20. Ni siquiera superusuario puede hacer DELETE o UPDATE en auditoria por trigger
select throws_ok(
  $$delete from public.auditoria$$,
  'P0001',
  'La bitácora de auditoría es inmutable y no permite modificaciones ni borrados',
  'La tabla auditoria bloquea cualquier intento de UPDATE o DELETE'
);

select * from finish();
rollback;
