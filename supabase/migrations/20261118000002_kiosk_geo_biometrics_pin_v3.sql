-- =========================================================================
-- MIGRACIÓN: 20261118000001_kiosk_geo_biometrics_pin_v3.sql
-- Propósito:
--   1. Geolocalización en `sucursales` (latitud, longitud, radio_geocerca_m).
--   2. Empleados: `email`, `pin_codigo` (único de 6 dígitos por tenant),
--      `biometria_facial_activa`, `webauthn_activo`.
--   3. Sucursal asignada en `perfiles_usuarios` y `invitaciones_usuarios`.
--   4. Tabla `empleado_webauthn_credenciales` (llaves públicas FIDO2/WebAuthn,
--      sin plantillas biométricas crudas) + RLS estricto por tenant.
--   5. Ampliar `fuentes_asistencia.marca` con `'KIOSCO_WEB'` y
--      `checadas.tipo_verificacion` con `'WEBAUTHN'`, más coordenadas GPS
--      exactas del Check-In/Check-Out (`latitud`, `longitud`, `precision_m`,
--      `distancia_sucursal_m`, `dentro_geocerca`, `sucursal_id`).
-- =========================================================================

-- =========================================================================
-- 1. GEOLOCALIZACIÓN EN SUCURSALES
-- =========================================================================

alter table public.sucursales
  add column if not exists latitud double precision
    check (latitud is null or (latitud >= -90 and latitud <= 90)),
  add column if not exists longitud double precision
    check (longitud is null or (longitud >= -180 and longitud <= 180)),
  add column if not exists radio_geocerca_m int not null default 150
    check (radio_geocerca_m >= 20 and radio_geocerca_m <= 10000);

-- =========================================================================
-- 2. EMPLEADOS: EMAIL, PIN ÚNICO DE 6 DÍGITOS, WEBAUTHN Y BIOMETRÍA
-- =========================================================================

alter table public.empleados
  add column if not exists email varchar(150),
  add column if not exists pin_codigo varchar(6)
    check (pin_codigo is null or pin_codigo ~ '^[0-9]{6}$'),
  add column if not exists biometria_facial_activa boolean not null default false,
  add column if not exists webauthn_activo boolean not null default false;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'empleados_tenant_pin_codigo_key'
  ) then
    alter table public.empleados
      add constraint empleados_tenant_pin_codigo_key
      unique (tenant_id, pin_codigo);
  end if;
end
$$;

create index if not exists idx_empleados_tenant_pin
  on public.empleados (tenant_id, pin_codigo)
  where pin_codigo is not null;

-- =========================================================================
-- 3. SUCURSAL EN PERFILES_USUARIOS E INVITACIONES_USUARIOS
-- =========================================================================

alter table public.perfiles_usuarios
  add column if not exists sucursal_id uuid references public.sucursales(id) on delete set null;

create index if not exists idx_perfiles_usuarios_sucursal
  on public.perfiles_usuarios (sucursal_id)
  where sucursal_id is not null;

alter table public.invitaciones_usuarios
  add column if not exists sucursal_id uuid references public.sucursales(id) on delete set null;

-- Re-otorgar SELECT de las columnas permitidas en invitaciones_usuarios (sin token_hash)
revoke all on public.invitaciones_usuarios from anon, authenticated;
grant select (
  id,
  tenant_id,
  sucursal_id,
  email,
  nombre_completo,
  rol,
  estatus,
  invitado_por,
  expira_en,
  aceptada_en,
  created_at,
  updated_at
) on public.invitaciones_usuarios to authenticated;

-- =========================================================================
-- 4. TABLA: EMPLEADO_WEBAUTHN_CREDENCIALES (FIDO2 / PASSKEYS)
-- =========================================================================

create table if not exists public.empleado_webauthn_credenciales (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  empleado_id uuid not null references public.empleados(id) on delete cascade,
  credential_id text not null,
  public_key text not null,
  algoritmo int not null default -7,
  sign_count bigint not null default 0,
  nombre_dispositivo varchar(120) not null default 'Dispositivo Biométrico',
  transports text[] not null default array['internal'],
  ultimo_uso_en timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, credential_id)
);

create index if not exists idx_webauthn_tenant_empleado
  on public.empleado_webauthn_credenciales (tenant_id, empleado_id);

-- Permisos: solo lectura de metadatos por authenticated; escritura vía service_role o ADMIN_EMPRESA
grant select, insert, update, delete on public.empleado_webauthn_credenciales to authenticated;

alter table public.empleado_webauthn_credenciales enable row level security;

drop policy if exists empleado_webauthn_select on public.empleado_webauthn_credenciales;
create policy empleado_webauthn_select on public.empleado_webauthn_credenciales
  for select to authenticated
  using (
    (select public.current_user_rol()) = 'SUPER_ADMIN'
    or tenant_id = (select public.current_tenant_id())
  );

drop policy if exists empleado_webauthn_insert on public.empleado_webauthn_credenciales;
create policy empleado_webauthn_insert on public.empleado_webauthn_credenciales
  for insert to authenticated
  with check (
    (select public.current_user_rol()) = 'SUPER_ADMIN'
    or (
      (select public.current_user_rol()) = 'ADMIN_EMPRESA'
      and tenant_id = (select public.current_tenant_id())
    )
  );

drop policy if exists empleado_webauthn_update on public.empleado_webauthn_credenciales;
create policy empleado_webauthn_update on public.empleado_webauthn_credenciales
  for update to authenticated
  using (
    (select public.current_user_rol()) = 'SUPER_ADMIN'
    or (
      (select public.current_user_rol()) = 'ADMIN_EMPRESA'
      and tenant_id = (select public.current_tenant_id())
    )
  )
  with check (
    (select public.current_user_rol()) = 'SUPER_ADMIN'
    or (
      (select public.current_user_rol()) = 'ADMIN_EMPRESA'
      and tenant_id = (select public.current_tenant_id())
    )
  );

drop policy if exists empleado_webauthn_delete on public.empleado_webauthn_credenciales;
create policy empleado_webauthn_delete on public.empleado_webauthn_credenciales
  for delete to authenticated
  using (
    (select public.current_user_rol()) = 'SUPER_ADMIN'
    or (
      (select public.current_user_rol()) = 'ADMIN_EMPRESA'
      and tenant_id = (select public.current_tenant_id())
    )
  );

-- =========================================================================
-- 5. FUENTES_ASISTENCIA Y CHECADAS: KIOSCO_WEB, WEBAUTHN Y GEOLOCALIZACIÓN
-- =========================================================================

alter table public.fuentes_asistencia
  drop constraint if exists fuentes_asistencia_marca_check;

alter table public.fuentes_asistencia
  add constraint fuentes_asistencia_marca_check
  check (marca in ('ZKTECO', 'HIKVISION', 'TACLOUD', 'KIOSCO_WEB'));

alter table public.checadas
  drop constraint if exists checadas_tipo_verificacion_check;

alter table public.checadas
  add constraint checadas_tipo_verificacion_check
  check (
    tipo_verificacion is null
    or tipo_verificacion in ('HUELLA', 'ROSTRO', 'TARJETA', 'API', 'PIN', 'WEBAUTHN')
  );

alter table public.checadas
  add column if not exists sucursal_id uuid references public.sucursales(id) on delete set null,
  add column if not exists latitud double precision
    check (latitud is null or (latitud >= -90 and latitud <= 90)),
  add column if not exists longitud double precision
    check (longitud is null or (longitud >= -180 and longitud <= 180)),
  add column if not exists precision_m double precision
    check (precision_m is null or precision_m >= 0),
  add column if not exists distancia_sucursal_m double precision
    check (distancia_sucursal_m is null or distancia_sucursal_m >= 0),
  add column if not exists dentro_geocerca boolean;

create index if not exists idx_checadas_tenant_sucursal_ts
  on public.checadas (tenant_id, sucursal_id, ts_utc desc);
