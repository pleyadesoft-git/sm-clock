-- =========================================================================
-- MIGRACIÓN: 20261114000004_invitaciones_smtp_roles_v3.sql
-- Propósito:
--   1. Estandarizar roles de empresa a ADMIN_EMPRESA y OPERADOR (más SUPER_ADMIN).
--   2. Tabla `invitaciones_usuarios` para invitación previa obligatoria por tenant.
--   3. Extender `configuracion_smtp` con `usar_smtp_propio` (Google SMTP por default)
--      y `tiene_password`.
--   4. Políticas RLS estrictas por operación y rol.
-- =========================================================================

-- =========================================================================
-- 1. ACTUALIZACIÓN DE ROLES EN PERFILES_USUARIOS Y POLÍTICAS RLS EXISTENTES
-- =========================================================================

update public.perfiles_usuarios
   set rol = 'OPERADOR'
 where rol in ('NOMINISTA', 'TECNICO_LOCAL');

alter table public.perfiles_usuarios
  drop constraint if exists perfiles_usuarios_rol_check;

alter table public.perfiles_usuarios
  add constraint perfiles_usuarios_rol_check
  check (rol in ('SUPER_ADMIN', 'ADMIN_EMPRESA', 'OPERADOR'));

-- En perfiles_usuarios: OPERADOR solo puede leer su propio perfil; ADMIN_EMPRESA ve los de su tenant
drop policy if exists perfiles_select on public.perfiles_usuarios;
create policy perfiles_select on public.perfiles_usuarios
  for select to authenticated
  using (
    (select public.current_user_rol()) = 'SUPER_ADMIN'
    or id = (select auth.uid())
    or (
      (select public.current_user_rol()) = 'ADMIN_EMPRESA'
      and tenant_id = (select public.current_tenant_id())
    )
  );

-- En sucursales: solo SUPER_ADMIN y ADMIN_EMPRESA pueden escribir
drop policy if exists sucursales_insert on public.sucursales;
create policy sucursales_insert on public.sucursales
  for insert to authenticated
  with check (
    (select public.current_user_rol()) = 'SUPER_ADMIN'
    or (
      (select public.current_user_rol()) = 'ADMIN_EMPRESA'
      and tenant_id = (select public.current_tenant_id())
    )
  );

drop policy if exists sucursales_update on public.sucursales;
create policy sucursales_update on public.sucursales
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

-- En empleados: solo SUPER_ADMIN y ADMIN_EMPRESA pueden escribir
drop policy if exists empleados_insert on public.empleados;
create policy empleados_insert on public.empleados
  for insert to authenticated
  with check (
    (select public.current_user_rol()) = 'SUPER_ADMIN'
    or (
      (select public.current_user_rol()) = 'ADMIN_EMPRESA'
      and tenant_id = (select public.current_tenant_id())
    )
  );

drop policy if exists empleados_update on public.empleados;
create policy empleados_update on public.empleados
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

-- En agente_codigos_enrolamiento: solo SUPER_ADMIN y ADMIN_EMPRESA pueden leer
drop policy if exists codigos_enrolamiento_select on public.agente_codigos_enrolamiento;
create policy codigos_enrolamiento_select on public.agente_codigos_enrolamiento
  for select to authenticated
  using (
    (select public.current_user_rol()) = 'SUPER_ADMIN'
    or (
      (select public.current_user_rol()) = 'ADMIN_EMPRESA'
      and tenant_id = (select public.current_tenant_id())
    )
  );

-- En fuentes_asistencia: solo SUPER_ADMIN y ADMIN_EMPRESA pueden escribir
drop policy if exists fuentes_insert on public.fuentes_asistencia;
create policy fuentes_insert on public.fuentes_asistencia
  for insert to authenticated
  with check (
    (select public.current_user_rol()) = 'SUPER_ADMIN'
    or (
      (select public.current_user_rol()) = 'ADMIN_EMPRESA'
      and tenant_id = (select public.current_tenant_id())
    )
  );

drop policy if exists fuentes_update on public.fuentes_asistencia;
create policy fuentes_update on public.fuentes_asistencia
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

-- =========================================================================
-- 2. EXTENDER CONFIGURACION_SMTP CON GOOGLE SMTP POR DEFECTO
-- =========================================================================

alter table public.configuracion_smtp
  add column if not exists usar_smtp_propio boolean not null default false,
  add column if not exists tiene_password boolean not null default false;

alter table public.configuracion_smtp
  alter column host set default 'smtp.gmail.com',
  alter column usuario drop not null,
  alter column remitente_email drop not null;

-- Permitir a ADMIN_EMPRESA eliminar configuracion_smtp de su propio tenant si restablece a Google SMTP default
drop policy if exists configuracion_smtp_delete on public.configuracion_smtp;
create policy configuracion_smtp_delete on public.configuracion_smtp
  for delete to authenticated
  using (
    (select public.current_user_rol()) = 'SUPER_ADMIN'
    or (
      (select public.current_user_rol()) = 'ADMIN_EMPRESA'
      and tenant_id = (select public.current_tenant_id())
    )
  );

-- =========================================================================
-- 3. TABLA: INVITACIONES_USUARIOS
-- =========================================================================

create table if not exists public.invitaciones_usuarios (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  email varchar(150) not null,
  nombre_completo varchar(150) not null,
  rol text not null check (rol in ('ADMIN_EMPRESA', 'OPERADOR')),
  token_hash text not null unique,
  estatus text not null default 'PENDIENTE'
    check (estatus in ('PENDIENTE', 'ACEPTADA', 'REVOCADA', 'EXPIRADA')),
  invitado_por uuid references auth.users(id) on delete set null,
  expira_en timestamptz not null,
  aceptada_en timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_invitaciones_tenant_estatus
  on public.invitaciones_usuarios (tenant_id, estatus);

create index if not exists idx_invitaciones_email_lower
  on public.invitaciones_usuarios (lower(email));

drop trigger if exists trg_invitaciones_usuarios_updated_at on public.invitaciones_usuarios;
create trigger trg_invitaciones_usuarios_updated_at
  before update on public.invitaciones_usuarios
  for each row execute function public.set_updated_at();

-- Proteger columna sensible `token_hash`: jamás legible por `authenticated` ni `anon`
revoke all on public.invitaciones_usuarios from anon, authenticated;
grant select (
  id,
  tenant_id,
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

alter table public.invitaciones_usuarios enable row level security;

drop policy if exists invitaciones_select on public.invitaciones_usuarios;
create policy invitaciones_select on public.invitaciones_usuarios
  for select to authenticated
  using (
    (select public.current_user_rol()) = 'SUPER_ADMIN'
    or (
      (select public.current_user_rol()) = 'ADMIN_EMPRESA'
      and tenant_id = (select public.current_tenant_id())
    )
  );

drop policy if exists invitaciones_insert on public.invitaciones_usuarios;
create policy invitaciones_insert on public.invitaciones_usuarios
  for insert to authenticated
  with check (
    (select public.current_user_rol()) = 'SUPER_ADMIN'
    or (
      (select public.current_user_rol()) = 'ADMIN_EMPRESA'
      and tenant_id = (select public.current_tenant_id())
    )
  );

drop policy if exists invitaciones_update on public.invitaciones_usuarios;
create policy invitaciones_update on public.invitaciones_usuarios
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

drop policy if exists invitaciones_delete on public.invitaciones_usuarios;
create policy invitaciones_delete on public.invitaciones_usuarios
  for delete to authenticated
  using (
    (select public.current_user_rol()) = 'SUPER_ADMIN'
    or (
      (select public.current_user_rol()) = 'ADMIN_EMPRESA'
      and tenant_id = (select public.current_tenant_id())
    )
  );
