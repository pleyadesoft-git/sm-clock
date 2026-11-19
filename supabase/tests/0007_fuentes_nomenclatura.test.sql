begin;
select plan(5);

-- Fixtures
insert into public.tenants (id, tenant_code, nombre_comercial, razon_social, rfc, regimen_fiscal, codigo_postal_fiscal)
values (
  '88888888-0000-4000-8000-000000000001'::uuid,
  'TIJ01',
  'Tenant Prueba Reloj',
  'Tenant Prueba Reloj SA de CV',
  'TPR260101AA1',
  '601',
  '22000'
);

insert into public.sucursales (id, tenant_id, clave, nombre)
values (
  '88888888-0000-4000-8000-000000000002'::uuid,
  '88888888-0000-4000-8000-000000000001'::uuid,
  'MATRIZ',
  'Sucursal Matriz Tijuana'
);

-- 1. Test función generar_nomenclatura_fuente para el primer reloj
select is(
  (select clave from public.generar_nomenclatura_fuente(
    '88888888-0000-4000-8000-000000000001'::uuid,
    '88888888-0000-4000-8000-000000000002'::uuid
  )),
  'TIJ01-MATRIZ-01',
  'El primer reloj de la sucursal genera la nomenclatura TIJ01-MATRIZ-01'
);

-- 2. Insertar primera fuente sin clave explícita (debe disparar el trigger)
insert into public.fuentes_asistencia (
  id, tenant_id, sucursal_id, nombre_ubicacion, marca, ip_local, puerto
) values (
  '88888888-0000-4000-8000-000000000010'::uuid,
  '88888888-0000-4000-8000-000000000001'::uuid,
  '88888888-0000-4000-8000-000000000002'::uuid,
  'Reloj Puerta Principal',
  'ZKTECO',
  '192.168.1.201',
  4370
);

select is(
  (select clave from public.fuentes_asistencia where id = '88888888-0000-4000-8000-000000000010'::uuid),
  'TIJ01-MATRIZ-01',
  'Trigger asigna automáticamente clave TIJ01-MATRIZ-01 al insertar fuente'
);

select is(
  (select consecutivo_sucursal from public.fuentes_asistencia where id = '88888888-0000-4000-8000-000000000010'::uuid),
  1,
  'Trigger asigna consecutivo_sucursal = 1'
);

-- 3. Segunda fuente en la misma sucursal
insert into public.fuentes_asistencia (
  id, tenant_id, sucursal_id, nombre_ubicacion, marca, ip_local, puerto
) values (
  '88888888-0000-4000-8000-000000000020'::uuid,
  '88888888-0000-4000-8000-000000000001'::uuid,
  '88888888-0000-4000-8000-000000000002'::uuid,
  'Reloj Puerta Trasera',
  'HIKVISION',
  '192.168.1.202',
  80
);

select is(
  (select clave from public.fuentes_asistencia where id = '88888888-0000-4000-8000-000000000020'::uuid),
  'TIJ01-MATRIZ-02',
  'El segundo reloj en la misma sucursal recibe automáticamente consecutivo 02 (TIJ01-MATRIZ-02)'
);

-- 4. Verificar unicidad de clave por tenant
select throws_ok(
  $$
  insert into public.fuentes_asistencia (
    tenant_id, sucursal_id, nombre_ubicacion, marca, clave
  ) values (
    '88888888-0000-4000-8000-000000000001'::uuid,
    '88888888-0000-4000-8000-000000000002'::uuid,
    'Reloj Duplicado',
    'ZKTECO',
    'TIJ01-MATRIZ-01'
  )
  $$,
  '23505',
  NULL,
  'No se permite duplicar la clave en el mismo tenant'
);

select * from finish();
rollback;
