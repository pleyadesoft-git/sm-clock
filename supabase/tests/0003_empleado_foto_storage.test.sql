begin;
select plan(8);

-- =========================================================================
-- PREPARACIÓN DE DATOS DE PRUEBA (COMO SUPERUSUARIO / SERVICE_ROLE)
-- =========================================================================

insert into public.tenants (
  id, tenant_code, nombre_comercial, razon_social, rfc, regimen_fiscal, codigo_postal_fiscal, plan_codigo, estatus
) values
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'TEST-E', 'Empresa Tenant E', 'EMPRESA TENANT E SA DE CV', 'ETE010101EEE', '601', '22000', 'PYME', 'ACTIVO'),
  ('ffffffff-ffff-4fff-8fff-ffffffffffff', 'TEST-F', 'Empresa Tenant F', 'EMPRESA TENANT F SA DE CV', 'ETF020202FFF', '601', '22000', 'MICRO', 'ACTIVO');

insert into public.empleados (
  id, tenant_id, codigo_empleado, nombre_completo, foto_path, foto_thumb_path, foto_actualizada_en
) values
  (
    'eeeeeeee-0002-4000-8000-000000000001',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    'EMP-E01',
    'Ana Torres E',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee/eeeeeeee-0002-4000-8000-000000000001/f1.webp',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee/eeeeeeee-0002-4000-8000-000000000001/f1_thumb.webp',
    now()
  );

-- Insertar objetos simulados en storage.objects para ambos tenants
insert into storage.objects (id, bucket_id, name, owner, metadata)
values
  (
    'eeeeeeee-0009-4000-8000-000000000001',
    'empleados-fotos',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee/eeeeeeee-0002-4000-8000-000000000001/f1.webp',
    null,
    '{"mimetype":"image/webp","size":42000}'::jsonb
  ),
  (
    'ffffffff-0009-4000-8000-000000000001',
    'empleados-fotos',
    'ffffffff-ffff-4fff-8fff-ffffffffffff/ffffffff-0002-4000-8000-000000000001/f2.webp',
    null,
    '{"mimetype":"image/webp","size":38000}'::jsonb
  );

-- 1. Columnas de foto existen en empleados
select has_column('public', 'empleados', 'foto_path', 'empleados tiene columna foto_path');
select has_column('public', 'empleados', 'foto_thumb_path', 'empleados tiene columna foto_thumb_path');

-- 2. Bucket empleados-fotos es privado y limitado a 512 KB
select is(
  (select public from storage.buckets where id = 'empleados-fotos'),
  false,
  'El bucket empleados-fotos es privado (public = false)'
);

select is(
  (select file_size_limit::int from storage.buckets where id = 'empleados-fotos'),
  524288,
  'El bucket empleados-fotos tiene límite de 512 KB (524288 bytes)'
);

-- =========================================================================
-- CONTEXTO 1: ADMIN_EMPRESA DEL TENANT E
-- =========================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"50000000-0000-4000-8000-000000000001","app_metadata":{"rol":"ADMIN_EMPRESA","tenant_id":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"}}';

-- 5. Tenant E solo ve su propio archivo en storage.objects
select is(
  (
    select count(*)::int
    from storage.objects
    where bucket_id = 'empleados-fotos'
      and id in ('eeeeeeee-0009-4000-8000-000000000001', 'ffffffff-0009-4000-8000-000000000001')
  ),
  1,
  'ADMIN_EMPRESA del Tenant E solo puede leer objetos del bucket con prefijo de su propio tenant_id'
);

-- 6. Tenant E ve 0 objetos del Tenant F
select is(
  (
    select count(*)::int
    from storage.objects
    where bucket_id = 'empleados-fotos'
      and id = 'ffffffff-0009-4000-8000-000000000001'
  ),
  0,
  'ADMIN_EMPRESA del Tenant E no puede ver fotos del Tenant F en storage.objects'
);

-- 7. authenticated NO puede insertar directamente en storage.objects para empleados-fotos
select throws_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('empleados-fotos', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee/emp/hack.webp')$$,
  '42501',
  null,
  'authenticated no puede subir archivos directamente a storage.objects sin pasar por el servidor'
);

-- =========================================================================
-- CONTEXTO 2: SUPER_ADMIN VE AMBOS OBJETOS
-- =========================================================================
set local "request.jwt.claims" = '{"sub":"90000000-0000-4000-8000-000000000099","app_metadata":{"rol":"SUPER_ADMIN","tenant_id":null}}';

-- 8. SUPER_ADMIN ve ambos objetos de prueba
select is(
  (
    select count(*)::int
    from storage.objects
    where bucket_id = 'empleados-fotos'
      and id in ('eeeeeeee-0009-4000-8000-000000000001', 'ffffffff-0009-4000-8000-000000000001')
  ),
  2,
  'SUPER_ADMIN puede consultar objetos del bucket empleados-fotos de distintos tenants'
);

reset role;
select * from finish();
rollback;
