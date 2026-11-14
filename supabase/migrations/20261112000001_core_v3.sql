-- =========================================================================
-- MIGRACIÓN 0001: NÚCLEO V3 + DISPOSITIVOS + SEGURIDAD + RLS (FASE 0)
-- =========================================================================

create extension if not exists "pgcrypto";

-- =========================================================================
-- 1. FUNCIONES AUXILIARES DE JWT Y UPDATED_AT
-- =========================================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;

create or replace function public.current_user_rol()
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(
    auth.jwt() -> 'app_metadata' ->> 'rol',
    auth.jwt() ->> 'rol'
  );
$$;

create or replace function public.current_tenant_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select nullif(
    coalesce(
      auth.jwt() -> 'app_metadata' ->> 'tenant_id',
      auth.jwt() ->> 'tenant_id'
    ),
    ''
  )::uuid;
$$;

-- =========================================================================
-- 2. TABLA: TENANTS (EMPRESAS)
-- =========================================================================

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  tenant_code varchar(20) not null unique,
  nombre_comercial varchar(150) not null,
  razon_social varchar(200) not null,
  rfc varchar(13) not null,
  regimen_fiscal varchar(10) not null,
  codigo_postal_fiscal varchar(5) not null,
  uso_cfdi varchar(10) not null default 'G03',
  correo_facturacion varchar(150),
  contacto_nombre varchar(150),
  contacto_email varchar(150),
  contacto_telefono varchar(30),
  notas_internas text,
  plan_codigo text not null default 'MICRO' check (plan_codigo in ('MICRO', 'PYME', 'INDUSTRIAL', 'CORPORATIVO')),
  estatus text not null default 'ACTIVO' check (estatus in ('ACTIVO', 'PRUEBA', 'SUSPENDIDO', 'CANCELADO')),
  zona_horaria varchar(50) not null default 'America/Tijuana',
  logo_url text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_tenants_estatus on public.tenants (estatus) where deleted_at is null;
create index idx_tenants_rfc on public.tenants (rfc);

create trigger trg_tenants_updated_at
  before update on public.tenants
  for each row execute function public.set_updated_at();

-- =========================================================================
-- 3. TABLA: PERFILES_USUARIOS
-- =========================================================================

create table public.perfiles_usuarios (
  id uuid primary key references auth.users(id) on delete cascade,
  tenant_id uuid references public.tenants(id) on delete cascade,
  nombre_completo varchar(150) not null,
  email varchar(150) not null unique,
  rol text not null check (rol in ('SUPER_ADMIN', 'ADMIN_EMPRESA', 'TECNICO_LOCAL', 'NOMINISTA')),
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_perfil_tenant_por_rol check (
    (rol = 'SUPER_ADMIN') or (tenant_id is not null)
  )
);

create index idx_perfiles_tenant on public.perfiles_usuarios (tenant_id);

create trigger trg_perfiles_usuarios_updated_at
  before update on public.perfiles_usuarios
  for each row execute function public.set_updated_at();

-- =========================================================================
-- 4. HOOK DE CUSTOM ACCESS TOKEN (SUPABASE AUTH)
-- =========================================================================

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_claims jsonb;
  v_app_meta jsonb;
  v_rol text;
  v_tenant_id uuid;
begin
  select p.rol, p.tenant_id
    into v_rol, v_tenant_id
    from public.perfiles_usuarios p
   where p.id = (event ->> 'user_id')::uuid
     and p.activo = true;

  v_claims := coalesce(event -> 'claims', '{}'::jsonb);
  v_app_meta := coalesce(v_claims -> 'app_metadata', '{}'::jsonb);

  if v_rol is not null then
    v_app_meta := jsonb_set(v_app_meta, '{rol}', to_jsonb(v_rol));
    if v_tenant_id is not null then
      v_app_meta := jsonb_set(v_app_meta, '{tenant_id}', to_jsonb(v_tenant_id::text));
    else
      v_app_meta := v_app_meta - 'tenant_id';
    end if;
    v_claims := jsonb_set(v_claims, '{app_metadata}', v_app_meta);
    event := jsonb_set(event, '{claims}', v_claims);
  end if;

  return event;
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;

-- =========================================================================
-- 5. TABLA: SUCURSALES
-- =========================================================================

create table public.sucursales (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  clave varchar(30) not null,
  nombre varchar(120) not null,
  direccion text,
  activa boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, clave)
);

create index idx_sucursales_tenant on public.sucursales (tenant_id);

-- =========================================================================
-- 6. TABLA: EMPLEADOS
-- =========================================================================

create table public.empleados (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  sucursal_id uuid references public.sucursales(id) on delete set null,
  codigo_empleado varchar(30) not null,
  credencial varchar(50),
  nombre_completo varchar(150) not null,
  departamento varchar(100),
  puesto varchar(100),
  estatus_empleado text not null default 'A' check (estatus_empleado in ('A', 'I')),
  sincronizado_en timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (tenant_id, codigo_empleado)
);

create index idx_empleados_tenant_codigo on public.empleados (tenant_id, codigo_empleado);

-- =========================================================================
-- 7. TABLAS DE DISPOSITIVOS Y SECRETOS: AGENTES, CODIGOS, FUENTES, CREDENCIALES
-- =========================================================================

create table public.agentes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  nombre text not null,
  token_hash text not null unique,
  version text,
  ultimo_latido timestamptz,
  revocado_en timestamptz,
  created_at timestamptz not null default now()
);

create index idx_agentes_tenant on public.agentes (tenant_id);

-- Proteger columna sensible token_hash: authenticated jamás puede leerla
revoke all on public.agentes from anon, authenticated;
grant select (id, tenant_id, nombre, version, ultimo_latido, revocado_en, created_at)
  on public.agentes to authenticated;

create table public.agente_codigos_enrolamiento (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  codigo_hash text not null unique,
  expira_en timestamptz not null,
  usado_en timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index idx_codigos_enrolamiento_tenant on public.agente_codigos_enrolamiento (tenant_id);

revoke all on public.agente_codigos_enrolamiento from anon, authenticated;
grant select (id, tenant_id, expira_en, usado_en, created_by, created_at)
  on public.agente_codigos_enrolamiento to authenticated;

create table public.fuentes_asistencia (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  sucursal_id uuid references public.sucursales(id) on delete set null,
  nombre_ubicacion varchar(100) not null,
  marca text not null check (marca in ('ZKTECO', 'HIKVISION', 'TACLOUD')),
  modelo varchar(50),
  ip_local varchar(45),
  puerto int default 4370,
  usuario_dispositivo varchar(50) default 'admin',
  url_api varchar(255),
  tacloud_username varchar(150),
  tacloud_config_exportacion jsonb,
  intervalo_checadas_min int not null default 30,
  activo boolean not null default true,
  ultima_conexion_exitosa timestamptz,
  ultimo_error text,
  created_at timestamptz not null default now()
);

create index idx_fuentes_tenant on public.fuentes_asistencia (tenant_id);

-- Credenciales cifradas (AES-256-GCM envelope): NINGÚN acceso para authenticated ni anon
create table public.credenciales (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  tipo text not null check (tipo in ('RELOJ', 'TACLOUD', 'SQL', 'RH4000')),
  referencia_id uuid not null,
  ciphertext bytea not null,
  nonce bytea not null,
  key_version int not null default 1,
  updated_at timestamptz not null default now(),
  unique (tenant_id, tipo, referencia_id)
);

revoke all on public.credenciales from anon, authenticated;

-- =========================================================================
-- 8. TABLA: AUDITORÍA INMUTABLE
-- =========================================================================

create table public.auditoria (
  id bigint generated always as identity primary key,
  tenant_id uuid references public.tenants(id) on delete set null,
  actor_id uuid,
  accion text not null,
  detalle jsonb,
  ip inet,
  created_at timestamptz not null default now()
);

create index idx_auditoria_tenant_created on public.auditoria (tenant_id, created_at desc);

create or replace function public.prevent_auditoria_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'La bitácora de auditoría es inmutable y no permite modificaciones ni borrados';
end;
$$;

create trigger trg_auditoria_immutable
  before update or delete on public.auditoria
  for each row execute function public.prevent_auditoria_mutation();

revoke insert, update, delete on public.auditoria from anon, authenticated;

-- =========================================================================
-- 9. ROW LEVEL SECURITY (RLS) POR TABLA, OPERACIÓN Y ROL
-- =========================================================================

alter table public.tenants enable row level security;
alter table public.perfiles_usuarios enable row level security;
alter table public.sucursales enable row level security;
alter table public.empleados enable row level security;
alter table public.agentes enable row level security;
alter table public.agente_codigos_enrolamiento enable row level security;
alter table public.fuentes_asistencia enable row level security;
alter table public.credenciales enable row level security;
alter table public.auditoria enable row level security;

-- 9.1 TENANTS
create policy tenants_select on public.tenants
  for select to authenticated
  using (
    (select public.current_user_rol()) = 'SUPER_ADMIN'
    or id = (select public.current_tenant_id())
  );

create policy tenants_insert on public.tenants
  for insert to authenticated
  with check (
    (select public.current_user_rol()) = 'SUPER_ADMIN'
  );

create policy tenants_update on public.tenants
  for update to authenticated
  using (
    (select public.current_user_rol()) = 'SUPER_ADMIN'
  )
  with check (
    (select public.current_user_rol()) = 'SUPER_ADMIN'
  );

create policy tenants_delete on public.tenants
  for delete to authenticated
  using (
    (select public.current_user_rol()) = 'SUPER_ADMIN'
  );

-- 9.2 PERFILES_USUARIOS (cambios de rol/tenant solo por servidor o SUPER_ADMIN)
create policy perfiles_select on public.perfiles_usuarios
  for select to authenticated
  using (
    (select public.current_user_rol()) = 'SUPER_ADMIN'
    or id = (select auth.uid())
    or (
      (select public.current_user_rol()) in ('ADMIN_EMPRESA', 'TECNICO_LOCAL', 'NOMINISTA')
      and tenant_id = (select public.current_tenant_id())
    )
  );

create policy perfiles_insert on public.perfiles_usuarios
  for insert to authenticated
  with check (
    (select public.current_user_rol()) = 'SUPER_ADMIN'
  );

create policy perfiles_update on public.perfiles_usuarios
  for update to authenticated
  using (
    (select public.current_user_rol()) = 'SUPER_ADMIN'
  )
  with check (
    (select public.current_user_rol()) = 'SUPER_ADMIN'
  );

create policy perfiles_delete on public.perfiles_usuarios
  for delete to authenticated
  using (
    (select public.current_user_rol()) = 'SUPER_ADMIN'
  );

-- 9.3 SUCURSALES (NOMINISTA solo SELECT)
create policy sucursales_select on public.sucursales
  for select to authenticated
  using (
    (select public.current_user_rol()) = 'SUPER_ADMIN'
    or tenant_id = (select public.current_tenant_id())
  );

create policy sucursales_insert on public.sucursales
  for insert to authenticated
  with check (
    (select public.current_user_rol()) = 'SUPER_ADMIN'
    or (
      (select public.current_user_rol()) in ('ADMIN_EMPRESA', 'TECNICO_LOCAL')
      and tenant_id = (select public.current_tenant_id())
    )
  );

create policy sucursales_update on public.sucursales
  for update to authenticated
  using (
    (select public.current_user_rol()) = 'SUPER_ADMIN'
    or (
      (select public.current_user_rol()) in ('ADMIN_EMPRESA', 'TECNICO_LOCAL')
      and tenant_id = (select public.current_tenant_id())
    )
  )
  with check (
    (select public.current_user_rol()) = 'SUPER_ADMIN'
    or (
      (select public.current_user_rol()) in ('ADMIN_EMPRESA', 'TECNICO_LOCAL')
      and tenant_id = (select public.current_tenant_id())
    )
  );

create policy sucursales_delete on public.sucursales
  for delete to authenticated
  using (
    (select public.current_user_rol()) = 'SUPER_ADMIN'
    or (
      (select public.current_user_rol()) = 'ADMIN_EMPRESA'
      and tenant_id = (select public.current_tenant_id())
    )
  );

-- 9.4 EMPLEADOS (NOMINISTA solo SELECT)
create policy empleados_select on public.empleados
  for select to authenticated
  using (
    (select public.current_user_rol()) = 'SUPER_ADMIN'
    or tenant_id = (select public.current_tenant_id())
  );

create policy empleados_insert on public.empleados
  for insert to authenticated
  with check (
    (select public.current_user_rol()) = 'SUPER_ADMIN'
    or (
      (select public.current_user_rol()) in ('ADMIN_EMPRESA', 'TECNICO_LOCAL')
      and tenant_id = (select public.current_tenant_id())
    )
  );

create policy empleados_update on public.empleados
  for update to authenticated
  using (
    (select public.current_user_rol()) = 'SUPER_ADMIN'
    or (
      (select public.current_user_rol()) in ('ADMIN_EMPRESA', 'TECNICO_LOCAL')
      and tenant_id = (select public.current_tenant_id())
    )
  )
  with check (
    (select public.current_user_rol()) = 'SUPER_ADMIN'
    or (
      (select public.current_user_rol()) in ('ADMIN_EMPRESA', 'TECNICO_LOCAL')
      and tenant_id = (select public.current_tenant_id())
    )
  );

create policy empleados_delete on public.empleados
  for delete to authenticated
  using (
    (select public.current_user_rol()) = 'SUPER_ADMIN'
    or (
      (select public.current_user_rol()) = 'ADMIN_EMPRESA'
      and tenant_id = (select public.current_tenant_id())
    )
  );

-- 9.5 AGENTES (solo lectura de metadatos sin token_hash; escrituras por service_role)
create policy agentes_select on public.agentes
  for select to authenticated
  using (
    (select public.current_user_rol()) = 'SUPER_ADMIN'
    or tenant_id = (select public.current_tenant_id())
  );

-- 9.6 AGENTE_CODIGOS_ENROLAMIENTO (solo lectura de metadatos sin codigo_hash para ADMIN_EMPRESA/TECNICO_LOCAL/SUPER_ADMIN)
create policy codigos_enrolamiento_select on public.agente_codigos_enrolamiento
  for select to authenticated
  using (
    (select public.current_user_rol()) = 'SUPER_ADMIN'
    or (
      (select public.current_user_rol()) in ('ADMIN_EMPRESA', 'TECNICO_LOCAL')
      and tenant_id = (select public.current_tenant_id())
    )
  );

-- 9.7 FUENTES_ASISTENCIA (NOMINISTA solo SELECT)
create policy fuentes_select on public.fuentes_asistencia
  for select to authenticated
  using (
    (select public.current_user_rol()) = 'SUPER_ADMIN'
    or tenant_id = (select public.current_tenant_id())
  );

create policy fuentes_insert on public.fuentes_asistencia
  for insert to authenticated
  with check (
    (select public.current_user_rol()) = 'SUPER_ADMIN'
    or (
      (select public.current_user_rol()) in ('ADMIN_EMPRESA', 'TECNICO_LOCAL')
      and tenant_id = (select public.current_tenant_id())
    )
  );

create policy fuentes_update on public.fuentes_asistencia
  for update to authenticated
  using (
    (select public.current_user_rol()) = 'SUPER_ADMIN'
    or (
      (select public.current_user_rol()) in ('ADMIN_EMPRESA', 'TECNICO_LOCAL')
      and tenant_id = (select public.current_tenant_id())
    )
  )
  with check (
    (select public.current_user_rol()) = 'SUPER_ADMIN'
    or (
      (select public.current_user_rol()) in ('ADMIN_EMPRESA', 'TECNICO_LOCAL')
      and tenant_id = (select public.current_tenant_id())
    )
  );

create policy fuentes_delete on public.fuentes_asistencia
  for delete to authenticated
  using (
    (select public.current_user_rol()) = 'SUPER_ADMIN'
    or (
      (select public.current_user_rol()) = 'ADMIN_EMPRESA'
      and tenant_id = (select public.current_tenant_id())
    )
  );

-- 9.8 CREDENCIALES: Sin políticas para authenticated/anon (acceso exclusivo service_role)

-- 9.9 AUDITORIA (lectura para SUPER_ADMIN y ADMIN_EMPRESA de su propio tenant)
create policy auditoria_select on public.auditoria
  for select to authenticated
  using (
    (select public.current_user_rol()) = 'SUPER_ADMIN'
    or (
      (select public.current_user_rol()) = 'ADMIN_EMPRESA'
      and tenant_id = (select public.current_tenant_id())
    )
  );
