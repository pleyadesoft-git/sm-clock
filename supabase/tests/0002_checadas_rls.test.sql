begin;
select plan(12);

-- =========================================================================
-- PREPARACIÓN DE DATOS DE PRUEBA (COMO SUPERUSUARIO / SERVICE_ROLE)
-- =========================================================================

insert into public.tenants (
  id, tenant_code, nombre_comercial, razon_social, rfc, regimen_fiscal, codigo_postal_fiscal, plan_codigo, estatus
) values
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'TEST-C', 'Empresa Tenant C', 'EMPRESA TENANT C SA DE CV', 'ETC010101CCC', '601', '22000', 'PYME', 'ACTIVO'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'TEST-D', 'Empresa Tenant D', 'EMPRESA TENANT D SA DE CV', 'ETD020202DDD', '601', '22000', 'MICRO', 'ACTIVO');

insert into public.fuentes_asistencia (id, tenant_id, nombre_ubicacion, marca) values
  ('cccccccc-0003-4000-8000-000000000001', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Reloj C1', 'ZKTECO'),
  ('dddddddd-0003-4000-8000-000000000001', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'Reloj D1', 'ZKTECO');

insert into public.agentes (id, tenant_id, nombre, token_hash) values
  ('cccccccc-0004-4000-8000-000000000001', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Agente C1', 'hash_secreto_agente_c1'),
  ('dddddddd-0004-4000-8000-000000000001', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'Agente D1', 'hash_secreto_agente_d1');

-- Insertar checadas incluyendo hora repetida DST de otoño (ambigua = true)
insert into public.checadas (
  tenant_id, fuente_id, codigo_empleado, ts_utc, ts_dispositivo_local, ambigua, tipo_marca, tipo_verificacion, agente_id
) values
  (
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'cccccccc-0003-4000-8000-000000000001',
    'EMP-C01',
    '2026-11-01T08:30:00Z',
    '2026-11-01 01:30:00',
    true,
    'ENTRADA',
    'HUELLA',
    'cccccccc-0004-4000-8000-000000000001'
  ),
  (
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'cccccccc-0003-4000-8000-000000000001',
    'EMP-C01',
    '2026-11-01T09:30:00Z',
    '2026-11-01 01:30:00',
    true,
    'SALIDA',
    'HUELLA',
    'cccccccc-0004-4000-8000-000000000001'
  ),
  (
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    'dddddddd-0003-4000-8000-000000000001',
    'EMP-D01',
    '2026-11-01T15:00:00Z',
    '2026-11-01 07:00:00',
    false,
    'ENTRADA',
    'ROSTRO',
    'dddddddd-0004-4000-8000-000000000001'
  );

-- 1. Idempotencia: insertar duplicado (tenant_id, fuente_id, codigo_empleado, ts_utc) lanza 23505 o se ignora con ON CONFLICT
select throws_ok(
  $$insert into public.checadas (
      tenant_id, fuente_id, codigo_empleado, ts_utc, ts_dispositivo_local, ambigua
    ) values (
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      'cccccccc-0003-4000-8000-000000000001',
      'EMP-C01',
      '2026-11-01T08:30:00Z',
      '2026-11-01 01:30:00',
      true
    )$$,
  '23505',
  null,
  'Restricción UNIQUE (tenant_id, fuente_id, codigo_empleado, ts_utc) impide duplicar checadas'
);

-- 2. Inmutabilidad: ni siquiera superusuario puede hacer UPDATE sobre checadas
select throws_ok(
  $$update public.checadas set codigo_empleado = 'HACK' where codigo_empleado = 'EMP-C01'$$,
  'P0001',
  'Las checadas son inmutables y no permiten modificaciones ni borrados',
  'Trigger trg_checadas_immutable bloquea UPDATE sobre checadas'
);

-- 3. Inmutabilidad: ni siquiera superusuario puede hacer DELETE sobre checadas
select throws_ok(
  $$delete from public.checadas where codigo_empleado = 'EMP-C01'$$,
  'P0001',
  'Las checadas son inmutables y no permiten modificaciones ni borrados',
  'Trigger trg_checadas_immutable bloquea DELETE sobre checadas'
);

-- =========================================================================
-- CONTEXTO 1: ADMIN_EMPRESA DEL TENANT C
-- =========================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"30000000-0000-4000-8000-000000000001","app_metadata":{"rol":"ADMIN_EMPRESA","tenant_id":"cccccccc-cccc-4ccc-8ccc-cccccccccccc"}}';

-- 4. Solo ve las 2 checadas del Tenant C
select is(
  (select count(*)::int from public.checadas where tenant_id in ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd')),
  2,
  'ADMIN_EMPRESA del Tenant C solo ve las checadas de su propio tenant'
);

-- 5. No ve checadas del Tenant D
select is(
  (select count(*)::int from public.checadas where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'),
  0,
  'ADMIN_EMPRESA del Tenant C ve 0 checadas del Tenant D'
);

-- 6. Preserva flag ambigua = true para horas repetidas en cambio de horario de otoño
select is(
  (select count(*)::int from public.checadas where tenant_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' and ambigua = true),
  2,
  'Las dos checadas en la hora repetida de otoño conservan ambigua = true y distintos ts_utc'
);

-- 7. authenticated NO puede hacer INSERT en checadas (escritura exclusiva vía service_role)
select throws_ok(
  $$insert into public.checadas (
      tenant_id, fuente_id, codigo_empleado, ts_utc, ts_dispositivo_local
    ) values (
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      'cccccccc-0003-4000-8000-000000000001',
      'EMP-C99',
      now(),
      '2026-11-01 10:00:00'
    )$$,
  '42501',
  null,
  'authenticated no tiene permiso INSERT directo sobre checadas'
);

-- 8. authenticated NO puede hacer UPDATE en checadas
select throws_ok(
  $$update public.checadas set tipo_marca = 'SALIDA'$$,
  '42501',
  null,
  'authenticated no tiene permiso UPDATE sobre checadas'
);

-- 9. authenticated NO puede hacer DELETE en checadas
select throws_ok(
  $$delete from public.checadas$$,
  '42501',
  null,
  'authenticated no tiene permiso DELETE sobre checadas'
);

-- 10. authenticated NO puede leer agente_nonces
select throws_ok(
  $$select * from public.agente_nonces$$,
  '42501',
  null,
  'authenticated no tiene acceso a la tabla interna agente_nonces'
);

-- =========================================================================
-- CONTEXTO 2: SUPER_ADMIN VE AMBOS TENANTS
-- =========================================================================
set local "request.jwt.claims" = '{"sub":"90000000-0000-4000-8000-000000000099","app_metadata":{"rol":"SUPER_ADMIN","tenant_id":null}}';

-- 11. SUPER_ADMIN ve las 3 checadas de prueba (Tenant C + Tenant D)
select is(
  (select count(*)::int from public.checadas where tenant_id in ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd')),
  3,
  'SUPER_ADMIN puede consultar checadas de múltiples tenants para soporte'
);

-- =========================================================================
-- CONTEXTO 3: ANON NO TIENE ACCESO
-- =========================================================================
reset role;
set local role anon;
set local "request.jwt.claims" = '{}';

-- 12. anon no puede leer checadas
select throws_ok(
  $$select * from public.checadas$$,
  '42501',
  null,
  'anon no tiene ningún acceso a checadas'
);

reset role;
select * from finish();
rollback;
