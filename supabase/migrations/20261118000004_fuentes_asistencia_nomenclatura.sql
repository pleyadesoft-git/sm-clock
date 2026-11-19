-- =========================================================================
-- NOMENCLATURA Y VINCULACIÓN EN TIEMPO REAL DE FUENTES_ASISTENCIA CON SUCURSALES
-- Nomenclatura obligatoria: Código de tenant + Código de la Sucursal + Consecutivo
-- Formato: [tenant_code]-[clave_sucursal]-[01, 02, ...]
-- =========================================================================

-- 1. Añadir columnas clave y consecutivo_sucursal a fuentes_asistencia
alter table public.fuentes_asistencia
  add column if not exists clave varchar(60),
  add column if not exists consecutivo_sucursal integer;

-- 2. Índice único parcial por tenant_id y clave
create unique index if not exists idx_fuentes_tenant_clave
  on public.fuentes_asistencia (tenant_id, clave)
  where clave is not null;

create index if not exists idx_fuentes_sucursal
  on public.fuentes_asistencia (sucursal_id);

-- 3. Función segura para generar la siguiente nomenclatura por sucursal
create or replace function public.generar_nomenclatura_fuente(
  p_tenant_id uuid,
  p_sucursal_id uuid
)
returns table (consecutivo integer, clave varchar(60))
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant_code varchar(20);
  v_sucursal_clave varchar(30);
  v_next_consecutivo integer;
  v_clave varchar(60);
begin
  select tenant_code into v_tenant_code
    from public.tenants
   where id = p_tenant_id;

  select s.clave into v_sucursal_clave
    from public.sucursales s
   where s.id = p_sucursal_id
     and s.tenant_id = p_tenant_id;

  if v_tenant_code is null or v_sucursal_clave is null then
    raise exception 'Tenant (%) o Sucursal (%) inválidos para generar nomenclatura', p_tenant_id, p_sucursal_id;
  end if;

  select coalesce(max(consecutivo_sucursal), 0) + 1
    into v_next_consecutivo
    from public.fuentes_asistencia
   where tenant_id = p_tenant_id
     and sucursal_id = p_sucursal_id;

  v_clave := upper(trim(v_tenant_code)) || '-' || upper(trim(v_sucursal_clave)) || '-' || lpad(v_next_consecutivo::text, 2, '0');

  return query select v_next_consecutivo, v_clave;
end;
$$;

grant execute on function public.generar_nomenclatura_fuente(uuid, uuid) to authenticated, service_role;

-- 4. Trigger BEFORE INSERT para asegurar que cada nueva fuente tenga su nomenclatura asignada
create or replace function public.set_fuente_asistencia_nomenclatura()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_res record;
begin
  if new.sucursal_id is not null and (new.clave is null or trim(new.clave) = '') then
    select g.consecutivo, g.clave into v_res
      from public.generar_nomenclatura_fuente(new.tenant_id, new.sucursal_id) g;
    new.consecutivo_sucursal := v_res.consecutivo;
    new.clave := v_res.clave;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_fuentes_asistencia_nomenclatura on public.fuentes_asistencia;
create trigger trg_fuentes_asistencia_nomenclatura
  before insert on public.fuentes_asistencia
  for each row execute function public.set_fuente_asistencia_nomenclatura();

-- 5. Backfill de fuentes_asistencia existentes con sucursal asignada
do $$
declare
  r record;
  f record;
  v_tenant_code varchar(20);
  v_sucursal_clave varchar(30);
  v_idx integer;
begin
  for r in select distinct tenant_id, sucursal_id from public.fuentes_asistencia where sucursal_id is not null loop
    select tenant_code into v_tenant_code from public.tenants where id = r.tenant_id;
    select clave into v_sucursal_clave from public.sucursales where id = r.sucursal_id;

    if v_tenant_code is not null and v_sucursal_clave is not null then
      v_idx := 1;
      for f in select id from public.fuentes_asistencia where tenant_id = r.tenant_id and sucursal_id = r.sucursal_id order by created_at asc loop
        update public.fuentes_asistencia
           set consecutivo_sucursal = v_idx,
               clave = upper(trim(v_tenant_code)) || '-' || upper(trim(v_sucursal_clave)) || '-' || lpad(v_idx::text, 2, '0')
         where id = f.id
           and (clave is null or consecutivo_sucursal is null);
        v_idx := v_idx + 1;
      end loop;
    end if;
  end loop;
end;
$$;
