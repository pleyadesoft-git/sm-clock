begin;
select plan(11);

-- =========================================================================
-- PREPARACIÓN DE DATOS DE PRUEBA (COMO SUPERUSUARIO / SERVICE_ROLE)
-- =========================================================================

insert into public.tenants (
  id, tenant_code, nombre_comercial, razon_social, rfc, regimen_fiscal, codigo_postal_fiscal, plan_codigo, estatus
) values
  ('88881111-1111-4111-8111-111111111111', 'TEST-MSG-A', 'Empresa Mensajes A', 'EMPRESA MENSAJES A SA DE CV', 'EMA010101AAA', '601', '22000', 'PYME', 'ACTIVO'),
  ('88882222-2222-4222-8222-222222222222', 'TEST-MSG-B', 'Empresa Mensajes B', 'EMPRESA MENSAJES B SA DE CV', 'EMB020202BBB', '601', '22000', 'MICRO', 'ACTIVO');

insert into public.sucursales (
  id, tenant_id, clave, nombre
) values
  ('88881111-0001-4000-8000-000000000001', '88881111-1111-4111-8111-111111111111', 'SUC-MSG-A', 'Planta Mensajes A'),
  ('88882222-0001-4000-8000-000000000001', '88882222-2222-4222-8222-222222222222', 'SUC-MSG-B', 'Planta Mensajes B');

insert into public.empleados (
  id, tenant_id, sucursal_id, codigo_empleado, nombre_completo, email, telefono_whatsapp, departamento
) values
  ('88881111-0002-4000-8000-000000000001', '88881111-1111-4111-8111-111111111111', '88881111-0001-4000-8000-000000000001', 'EMP-M1', 'Alejandro Hernandez', 'alejandro@msg-a.mx', '+526641234567', 'Producción'),
  ('88882222-0002-4000-8000-000000000001', '88882222-2222-4222-8222-222222222222', '88882222-0001-4000-8000-000000000001', 'EMP-MB1', 'Empleado B1', 'b1@msg-b.mx', '+526649876543', 'Administración');

insert into public.mensajes_checadas (
  id, tenant_id, titulo, mensaje, texto_voz_personalizado, reproducir_audio, alcance, empleado_id, evento_disparo, modo_entrega, repeticion
) values
  (
    '88881111-0005-4000-8000-000000000001',
    '88881111-1111-4111-8111-111111111111',
    'Firma de Contrato',
    'Pasar a RH a firmar contrato',
    'Hola {nombre}, favor de pasar a Recursos Humanos a firmar tu contrato.',
    true,
    'EMPLEADO',
    '88881111-0002-4000-8000-000000000001',
    'ENTRADA',
    'AUTO_FALLBACK',
    'UNA_VEZ'
  ),
  (
    '88882222-0005-4000-8000-000000000001',
    '88882222-2222-4222-8222-222222222222',
    'Entrega de Credencial B',
    'Favor de pasar a Administración para entrega de credencial',
    null,
    true,
    'TODOS',
    null,
    'CUALQUIERA',
    'AUTO_FALLBACK',
    'UNA_VEZ'
  );

insert into public.mensajes_checadas_entregas (
  id, tenant_id, mensaje_id, empleado_id, codigo_empleado, tipo_marca, canal_utilizado, estatus_entrega, dispositivo_soportaba, email_destino
) values
  (
    '88881111-0007-4000-8000-000000000001',
    '88881111-1111-4111-8111-111111111111',
    '88881111-0005-4000-8000-000000000001',
    '88881111-0002-4000-8000-000000000001',
    'EMP-M1',
    'ENTRADA',
    'EMAIL_SMTP',
    'ENTREGADO_EMAIL',
    false,
    'alejandro@msg-a.mx'
  ),
  (
    '88882222-0007-4000-8000-000000000001',
    '88882222-2222-4222-8222-222222222222',
    '88882222-0005-4000-8000-000000000001',
    '88882222-0002-4000-8000-000000000001',
    'EMP-MB1',
    'SALIDA',
    'DISPOSITIVO',
    'ENTREGADO_DISPOSITIVO',
    true,
    null
  );

-- 1. Restricción CHECK en empleados.telefono_whatsapp rechaza formatos inválidos
select throws_ok(
  $$insert into public.empleados (
      tenant_id, sucursal_id, codigo_empleado, nombre_completo, telefono_whatsapp
    ) values (
      '88881111-1111-4111-8111-111111111111',
      '88881111-0001-4000-8000-000000000001',
      'EMP-BAD-TEL',
      'Telefono Invalido',
      'tel-abc-123'
    )$$,
  '23514',
  null,
  'El teléfono WhatsApp debe cumplir formato numérico E.164 de 10 a 15 dígitos'
);

-- 2. Restricción CHECK en mensajes_checadas.alcance rechaza valores fuera del catálogo
select throws_ok(
  $$insert into public.mensajes_checadas (
      tenant_id, titulo, mensaje, alcance
    ) values (
      '88881111-1111-4111-8111-111111111111',
      'Aviso Inválido',
      'Mensaje',
      'GLOBAL_INVALIDO'
    )$$,
  '23514',
  null,
  'El alcance del mensaje solo permite EMPLEADO, SUCURSAL, DEPARTAMENTO o TODOS'
);

-- =========================================================================
-- CONTEXTO 1: ADMIN_EMPRESA DEL TENANT A
-- =========================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"80000000-0000-4000-8000-000000000001","app_metadata":{"rol":"ADMIN_EMPRESA","tenant_id":"88881111-1111-4111-8111-111111111111"}}';

-- 3. ADMIN_EMPRESA del Tenant A solo ve mensajes de su propio tenant
select is(
  (
    select count(*)::int
    from public.mensajes_checadas
    where tenant_id in ('88881111-1111-4111-8111-111111111111', '88882222-2222-4222-8222-222222222222')
  ),
  1,
  'ADMIN_EMPRESA del Tenant A solo ve avisos de su propio tenant'
);

-- 4. ADMIN_EMPRESA del Tenant A ve 0 avisos del Tenant B
select is(
  (
    select count(*)::int
    from public.mensajes_checadas
    where tenant_id = '88882222-2222-4222-8222-222222222222'
  ),
  0,
  'ADMIN_EMPRESA del Tenant A no puede leer avisos del Tenant B'
);

-- 5. ADMIN_EMPRESA del Tenant A solo ve entregas de su propio tenant
select is(
  (
    select count(*)::int
    from public.mensajes_checadas_entregas
    where tenant_id in ('88881111-1111-4111-8111-111111111111', '88882222-2222-4222-8222-222222222222')
  ),
  1,
  'ADMIN_EMPRESA del Tenant A solo ve entregas de avisos de su propio tenant'
);

-- 6. ADMIN_EMPRESA del Tenant A puede crear un aviso masivo por sucursal en su tenant
select lives_ok(
  $$insert into public.mensajes_checadas (
      tenant_id, titulo, mensaje, alcance, sucursal_id, evento_disparo
    ) values (
      '88881111-1111-4111-8111-111111111111',
      'Entrega de Uniformes',
      'Favor de pasar a RH por tu uniforme al salir',
      'SUCURSAL',
      '88881111-0001-4000-8000-000000000001',
      'SALIDA'
    )$$,
  'ADMIN_EMPRESA del Tenant A puede crear aviso masivo en su propio tenant'
);

-- 7. ADMIN_EMPRESA del Tenant A NO puede crear un aviso en el Tenant B
select throws_ok(
  $$insert into public.mensajes_checadas (
      tenant_id, titulo, mensaje, alcance
    ) values (
      '88882222-2222-4222-8222-222222222222',
      'Intruso en B',
      'Mensaje intruso',
      'TODOS'
    )$$,
  '42501',
  null,
  'ADMIN_EMPRESA del Tenant A no puede insertar avisos en el Tenant B'
);

-- 8. ADMIN_EMPRESA del Tenant A NO puede eliminar avisos del Tenant B
delete from public.mensajes_checadas where id = '88882222-0005-4000-8000-000000000001';
reset role;
select is(
  (select count(*)::int from public.mensajes_checadas where id = '88882222-0005-4000-8000-000000000001'),
  1,
  'ADMIN_EMPRESA del Tenant A no puede eliminar avisos del Tenant B'
);

-- =========================================================================
-- CONTEXTO 2: OPERADOR DEL TENANT A (SOLO LECTURA)
-- =========================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"80000000-0000-4000-8000-000000000002","app_metadata":{"rol":"OPERADOR","tenant_id":"88881111-1111-4111-8111-111111111111"}}';

-- 9. OPERADOR puede consultar los avisos activos de su tenant
select is(
  (
    select count(*)::int
    from public.mensajes_checadas
    where tenant_id = '88881111-1111-4111-8111-111111111111'
  ),
  2,
  'OPERADOR del Tenant A puede consultar avisos de su tenant'
);

-- 10. OPERADOR puede consultar bitácora de entregas de su tenant
select is(
  (
    select count(*)::int
    from public.mensajes_checadas_entregas
    where tenant_id = '88881111-1111-4111-8111-111111111111'
  ),
  1,
  'OPERADOR del Tenant A puede consultar bitácora de entregas de su tenant'
);

-- 11. OPERADOR NO puede crear ni modificar avisos
select throws_ok(
  $$insert into public.mensajes_checadas (
      tenant_id, titulo, mensaje, alcance
    ) values (
      '88881111-1111-4111-8111-111111111111',
      'Intento Operador',
      'No permitido',
      'TODOS'
    )$$,
  '42501',
  null,
  'El rol OPERADOR no tiene permisos de escritura sobre mensajes_checadas'
);

select * from finish();
rollback;
