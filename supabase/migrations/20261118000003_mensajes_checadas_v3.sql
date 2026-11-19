-- =========================================================================
-- MIGRACIÓN: 20261118000003_mensajes_checadas_v3.sql
-- Propósito:
--   1. Agregar `telefono_whatsapp` a `public.empleados` (formato E.164 opcional)
--      y `soporta_mensajes_pantalla` a `public.fuentes_asistencia`.
--   2. Crear tabla `public.mensajes_checadas` para avisos individuales o masivos
--      (por Empleado, Sucursal, Departamento o Toda la Empresa) al hacer
--      Check-In (ENTRADA), Check-Out (SALIDA) o CUALQUIERA, con soporte de
--      audio dinámico personalizado (TTS) para el Agente Local.
--   3. Crear tabla `public.mensajes_checadas_entregas` para auditar si el mensaje
--      se mostró en el dispositivo/agente, si hizo fallback por Correo SMTP,
--      si generó enlace de WhatsApp Web o si quedó como `SIN_CANAL_DISPONIBLE`.
--   4. Habilitar RLS estricto por tenant en ambas tablas.
-- =========================================================================

-- 1. Ampliar empleados con telefono_whatsapp y fuentes_asistencia con capacidad de pantalla
alter table public.empleados
  add column if not exists email varchar(150),
  add column if not exists telefono_whatsapp varchar(25)
    check (telefono_whatsapp is null or telefono_whatsapp ~ '^\+?[0-9]{10,15}$');

alter table public.fuentes_asistencia
  add column if not exists soporta_mensajes_pantalla boolean not null default true;

-- 2. Tabla de avisos y mensajes al checar (individuales o masivos)
create table if not exists public.mensajes_checadas (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  titulo varchar(120) not null,
  mensaje varchar(240) not null,
  texto_voz_personalizado varchar(300),
  reproducir_audio boolean not null default true,
  alcance text not null default 'EMPLEADO'
    check (alcance in ('EMPLEADO', 'SUCURSAL', 'DEPARTAMENTO', 'TODOS')),
  empleado_id uuid references public.empleados(id) on delete cascade,
  sucursal_id uuid references public.sucursales(id) on delete cascade,
  departamento varchar(100),
  evento_disparo text not null default 'CUALQUIERA'
    check (evento_disparo in ('ENTRADA', 'SALIDA', 'CUALQUIERA')),
  modo_entrega text not null default 'AUTO_FALLBACK'
    check (modo_entrega in ('AUTO_FALLBACK', 'SIEMPRE_CORREO', 'SOLO_DISPOSITIVO')),
  repeticion text not null default 'UNA_VEZ'
    check (repeticion in ('UNA_VEZ', 'SIEMPRE_VIGENTE')),
  activo boolean not null default true,
  vigente_hasta timestamptz,
  creado_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_mensajes_checadas_tenant_activo
  on public.mensajes_checadas (tenant_id, activo, created_at desc);

create index if not exists idx_mensajes_checadas_empleado
  on public.mensajes_checadas (tenant_id, empleado_id)
  where empleado_id is not null;

-- 3. Tabla de entregas y auditoría de notificaciones disparadas al checar
create table if not exists public.mensajes_checadas_entregas (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  mensaje_id uuid not null references public.mensajes_checadas(id) on delete cascade,
  empleado_id uuid not null references public.empleados(id) on delete cascade,
  codigo_empleado text not null,
  checada_id bigint references public.checadas(id) on delete set null,
  tipo_marca text not null default 'CHECADA'
    check (tipo_marca in ('ENTRADA', 'SALIDA', 'CHECADA')),
  canal_utilizado text not null
    check (canal_utilizado in ('DISPOSITIVO', 'AGENTE_AUDIO_VISUAL', 'EMAIL_SMTP', 'WHATSAPP_WEB', 'SIN_CANAL')),
  estatus_entrega text not null
    check (estatus_entrega in (
      'ENTREGADO_DISPOSITIVO',
      'ENTREGADO_EMAIL',
      'PENDIENTE_WHATSAPP_WEB',
      'SIN_CANAL_DISPONIBLE',
      'ERROR_ENVIO'
    )),
  dispositivo_soportaba boolean not null default false,
  email_destino varchar(150),
  telefono_whatsapp varchar(25),
  whatsapp_web_url text,
  detalle text,
  entregado_en timestamptz not null default now()
);

create index if not exists idx_mensajes_entregas_tenant_fecha
  on public.mensajes_checadas_entregas (tenant_id, entregado_en desc);

create index if not exists idx_mensajes_entregas_mensaje_empleado
  on public.mensajes_checadas_entregas (tenant_id, mensaje_id, empleado_id);

-- 4. Permisos y RLS estricto por tenant
grant select, insert, update, delete on public.mensajes_checadas to authenticated;
grant select, insert, update on public.mensajes_checadas_entregas to authenticated;

alter table public.mensajes_checadas enable row level security;
alter table public.mensajes_checadas_entregas enable row level security;

drop policy if exists mensajes_checadas_select on public.mensajes_checadas;
create policy mensajes_checadas_select on public.mensajes_checadas
  for select to authenticated
  using (
    (select public.current_user_rol()) = 'SUPER_ADMIN'
    or tenant_id = (select public.current_tenant_id())
  );

drop policy if exists mensajes_checadas_insert on public.mensajes_checadas;
create policy mensajes_checadas_insert on public.mensajes_checadas
  for insert to authenticated
  with check (
    (select public.current_user_rol()) = 'SUPER_ADMIN'
    or (
      (select public.current_user_rol()) = 'ADMIN_EMPRESA'
      and tenant_id = (select public.current_tenant_id())
    )
  );

drop policy if exists mensajes_checadas_update on public.mensajes_checadas;
create policy mensajes_checadas_update on public.mensajes_checadas
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

drop policy if exists mensajes_checadas_delete on public.mensajes_checadas;
create policy mensajes_checadas_delete on public.mensajes_checadas
  for delete to authenticated
  using (
    (select public.current_user_rol()) = 'SUPER_ADMIN'
    or (
      (select public.current_user_rol()) = 'ADMIN_EMPRESA'
      and tenant_id = (select public.current_tenant_id())
    )
  );

drop policy if exists mensajes_checadas_entregas_select on public.mensajes_checadas_entregas;
create policy mensajes_checadas_entregas_select on public.mensajes_checadas_entregas
  for select to authenticated
  using (
    (select public.current_user_rol()) = 'SUPER_ADMIN'
    or tenant_id = (select public.current_tenant_id())
  );

drop policy if exists mensajes_checadas_entregas_insert on public.mensajes_checadas_entregas;
create policy mensajes_checadas_entregas_insert on public.mensajes_checadas_entregas
  for insert to authenticated
  with check (
    (select public.current_user_rol()) = 'SUPER_ADMIN'
    or (
      (select public.current_user_rol()) = 'ADMIN_EMPRESA'
      and tenant_id = (select public.current_tenant_id())
    )
  );

drop policy if exists mensajes_checadas_entregas_update on public.mensajes_checadas_entregas;
create policy mensajes_checadas_entregas_update on public.mensajes_checadas_entregas
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
