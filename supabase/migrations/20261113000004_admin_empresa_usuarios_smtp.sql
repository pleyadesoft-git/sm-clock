-- =========================================================================
-- MIGRACIÓN 0004: ADMIN INICIAL CON GOOGLE AUTH, GESTIÓN DE USUARIOS Y SMTP
-- =========================================================================

-- 1. Ampliar perfiles_usuarios con proveedor de autenticación requerido y último acceso
alter table public.perfiles_usuarios
  add column if not exists auth_provider text not null default 'GOOGLE'
    check (auth_provider in ('GOOGLE', 'EMAIL', 'BOTH')),
  add column if not exists ultimo_acceso_en timestamptz;

create index if not exists idx_perfiles_email_lower
  on public.perfiles_usuarios (lower(email));

-- 2. Ampliar tipos permitidos en credenciales para soportar secretos SMTP cifrados (AES-256-GCM)
alter table public.credenciales
  drop constraint if exists credenciales_tipo_check;

alter table public.credenciales
  add constraint credenciales_tipo_check
  check (tipo in ('RELOJ', 'TACLOUD', 'SQL', 'RH4000', 'SMTP'));

-- 3. Tabla de metadatos de configuración SMTP (sin secretos en texto plano; el password vive en public.credenciales)
create table public.configuracion_smtp (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  host varchar(150) not null,
  puerto int not null default 587 check (puerto between 1 and 65535),
  seguridad text not null default 'STARTTLS' check (seguridad in ('STARTTLS', 'TLS', 'NONE')),
  usuario varchar(150) not null,
  remitente_email varchar(150) not null,
  remitente_nombre varchar(150) not null default 'SM Clock Notificaciones',
  activo boolean not null default true,
  ultima_prueba_exitosa_en timestamptz,
  ultimo_error_prueba text,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (tenant_id)
);

create index idx_configuracion_smtp_tenant on public.configuracion_smtp (tenant_id);

create trigger trg_configuracion_smtp_updated_at
  before update on public.configuracion_smtp
  for each row execute function public.set_updated_at();

-- 4. RLS para configuracion_smtp
alter table public.configuracion_smtp enable row level security;

create policy configuracion_smtp_select on public.configuracion_smtp
  for select to authenticated
  using (
    (select public.current_user_rol()) = 'SUPER_ADMIN'
    or (
      (select public.current_user_rol()) = 'ADMIN_EMPRESA'
      and tenant_id = (select public.current_tenant_id())
    )
  );

create policy configuracion_smtp_insert on public.configuracion_smtp
  for insert to authenticated
  with check (
    (select public.current_user_rol()) = 'SUPER_ADMIN'
    or (
      (select public.current_user_rol()) = 'ADMIN_EMPRESA'
      and tenant_id = (select public.current_tenant_id())
    )
  );

create policy configuracion_smtp_update on public.configuracion_smtp
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

create policy configuracion_smtp_delete on public.configuracion_smtp
  for delete to authenticated
  using (
    (select public.current_user_rol()) = 'SUPER_ADMIN'
  );
