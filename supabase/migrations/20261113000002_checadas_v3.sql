-- =========================================================================
-- MIGRACIÓN: 20261113000002_checadas_v3.sql
-- Propósito: Tabla de checadas inmutables, anti-replay de nonces de agente,
--            RLS estricto por tenant y canal privado de Realtime Broadcast.
-- =========================================================================

-- =========================================================================
-- 1. TABLA: CHECADAS (INMUTABLE + IDEMPOTENTE)
-- =========================================================================

create table public.checadas (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  fuente_id uuid not null references public.fuentes_asistencia(id) on delete restrict,
  codigo_empleado text not null,
  ts_utc timestamptz not null,
  ts_dispositivo_local text not null,
  ambigua boolean not null default false,
  tipo_marca text not null default 'CHECADA'
    check (tipo_marca in ('ENTRADA', 'SALIDA', 'CHECADA')),
  tipo_verificacion text
    check (tipo_verificacion is null or tipo_verificacion in ('HUELLA', 'ROSTRO', 'TARJETA', 'API', 'PIN')),
  agente_id uuid references public.agentes(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tenant_id, fuente_id, codigo_empleado, ts_utc)
);

create index idx_checadas_tenant_ts
  on public.checadas (tenant_id, ts_utc desc);

create index idx_checadas_tenant_emp_ts
  on public.checadas (tenant_id, codigo_empleado, ts_utc desc);

-- Trigger de inmutabilidad: jamás se edita ni se borra una checada cruda
create or replace function public.prevent_checadas_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Las checadas son inmutables y no permiten modificaciones ni borrados';
end;
$$;

create trigger trg_checadas_immutable
  before update or delete on public.checadas
  for each row execute function public.prevent_checadas_mutation();

-- Permisos a nivel tabla: escritura exclusiva vía service_role en el servidor
revoke all on public.checadas from anon, authenticated;
grant select on public.checadas to authenticated;

-- RLS en checadas
alter table public.checadas enable row level security;

create policy checadas_select on public.checadas
  for select to authenticated
  using (
    (select public.current_user_rol()) = 'SUPER_ADMIN'
    or tenant_id = (select public.current_tenant_id())
  );

-- =========================================================================
-- 2. TABLA: AGENTE_NONCES (ANTI-REPLAY DE FIRMAS HMAC)
-- =========================================================================

create table public.agente_nonces (
  agente_id uuid not null references public.agentes(id) on delete cascade,
  nonce text not null,
  expira_en timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (agente_id, nonce)
);

create index idx_agente_nonces_expira
  on public.agente_nonces (expira_en);

revoke all on public.agente_nonces from anon, authenticated;
alter table public.agente_nonces enable row level security;

-- =========================================================================
-- 3. SUPABASE REALTIME: AUTORIZACIÓN DE CANAL PRIVADO POR TENANT
-- =========================================================================

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'realtime'
      and table_name = 'messages'
  ) then
    drop policy if exists realtime_tenant_checadas on realtime.messages;
    execute $pol$
      create policy realtime_tenant_checadas on realtime.messages
        for select to authenticated
        using (
          realtime.messages.extension = 'broadcast'
          and (
            (select public.current_user_rol()) = 'SUPER_ADMIN'
            or realtime.topic() = 'tenant:' || (select public.current_tenant_id())::text || ':checadas'
          )
        )
    $pol$;
  end if;
end
$$;
