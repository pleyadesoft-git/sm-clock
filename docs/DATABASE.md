# DATABASE.md — Modelo de datos v3 (reemplaza `schema.sql` v2)

Principio: **checadas inmutables**, incidencias derivadas, envíos por **outbox**, secretos aparte, cobranza separada del tenant.

## 1. Mapa de tablas

| Dominio | Tablas |
|---------|--------|
| Núcleo | `tenants`, `perfiles_usuarios`, `sucursales`, `empleados` |
| Dispositivos | `agentes`, `agente_codigos_enrolamiento`, `fuentes_asistencia`, `credenciales` |
| Asistencia | `checadas`, `horarios`, `turnos`, `asignaciones_turno`, `dias_festivos`, `incidencias` |
| Destinos | `integraciones_destino`, `envios_destino` |
| Cobranza | `planes`, `suscripciones`, `cargos`, `pagos` |
| Soporte/Auditoría | `logs_agente`, `auditoria`, `sesiones_soporte` |

## 2. Cambios clave vs. v2

- `tenants`: se eliminan `api_key`, `precio_*`, `nombre_plan`, límites → viven en `suscripciones`/`planes`. Se agrega `estatus` con `CANCELADO` y `deleted_at`.
- Secretos fuera de `fuentes_asistencia` e `integraciones_destino` → `credenciales`.
- `registros_asistencia` se divide en `checadas` + `incidencias` + `envios_destino`.
- Roles y tenant en JWT (ver `SECURITY.md`).

## 3. DDL base de las tablas nuevas (migración `0002_core_v3.sql`)

```sql
-- Agentes: una credencial por instalación
create table public.agentes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  nombre text not null,
  token_hash text not null unique,          -- hash del token; nunca el token
  version text,
  ultimo_latido timestamptz,
  revocado_en timestamptz,
  created_at timestamptz not null default now()
);

create table public.agente_codigos_enrolamiento (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  codigo_hash text not null unique,
  expira_en timestamptz not null,
  usado_en timestamptz,
  created_by uuid references auth.users(id)
);

-- Credenciales cifradas (solo servidor; sin políticas para authenticated)
create table public.credenciales (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  tipo text not null check (tipo in ('RELOJ','TACLOUD','SQL','RH4000')),
  referencia_id uuid not null,              -- fuente_id o integracion_id
  ciphertext bytea not null,
  nonce bytea not null,
  key_version int not null default 1,
  updated_at timestamptz not null default now()
);

-- Checadas inmutables
create table public.checadas (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  fuente_id uuid not null references public.fuentes_asistencia(id),
  codigo_empleado text not null,
  ts_utc timestamptz not null,
  ts_dispositivo_local text not null,       -- tal como lo reporta el reloj
  ambigua boolean not null default false,   -- hora repetida por cambio de horario
  tipo_marca text not null default 'CHECADA' check (tipo_marca in ('ENTRADA','SALIDA','CHECADA')),
  tipo_verificacion text,                   -- HUELLA | ROSTRO | TARJETA | API (sin plantillas biométricas)
  agente_id uuid references public.agentes(id),
  created_at timestamptz not null default now(),
  unique (tenant_id, fuente_id, codigo_empleado, ts_utc)
);
create index on public.checadas (tenant_id, ts_utc desc);
create index on public.checadas (tenant_id, codigo_empleado, ts_utc desc);

-- Turnos
create table public.turnos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  clave text not null,
  nombre text not null,
  hora_entrada time not null,
  hora_salida time not null,
  cruza_medianoche boolean not null default false,
  tolerancia_min int not null default 10,
  retardo_hasta_min int not null default 30,
  unique (tenant_id, clave)
);

create table public.asignaciones_turno (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  empleado_id uuid not null references public.empleados(id) on delete cascade,
  turno_id uuid not null references public.turnos(id),
  vigente_desde date not null,
  vigente_hasta date,
  dias_semana smallint[] not null default '{1,2,3,4,5}'
);

create table public.dias_festivos (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  fecha date not null,
  descripcion text,
  primary key (tenant_id, fecha)
);

-- Incidencias derivadas (recalculables)
create table public.incidencias (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  empleado_id uuid not null references public.empleados(id) on delete cascade,
  fecha date not null,
  tipo text not null,                       -- REG, RETARDO, FALTA, HORA_EXTRA, ...
  cantidad numeric(8,2) not null default 0,
  origen text not null default 'CALCULADA' check (origen in ('CALCULADA','TACLOUD','MANUAL')),
  version_calculo int not null default 1,
  unique (tenant_id, empleado_id, fecha, tipo)
);

-- Outbox hacia nómina
create table public.envios_destino (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  integracion_id uuid not null references public.integraciones_destino(id),
  entidad text not null check (entidad in ('CHECADA','INCIDENCIA','LAYOUT')),
  entidad_id text not null,
  idempotency_key text not null,
  estatus text not null default 'PENDIENTE' check (estatus in ('PENDIENTE','ENVIANDO','ENVIADO','ERROR','OMITIDO')),
  intentos int not null default 0,
  next_retry_at timestamptz,
  respuesta jsonb,
  enviado_en timestamptz,
  unique (tenant_id, integracion_id, idempotency_key)
);
create index on public.envios_destino (tenant_id, estatus, next_retry_at)
  where estatus in ('PENDIENTE','ERROR');

-- Auditoría inmutable
create table public.auditoria (
  id bigint generated always as identity primary key,
  tenant_id uuid references public.tenants(id) on delete set null,
  actor_id uuid,
  accion text not null,
  detalle jsonb,
  ip inet,
  created_at timestamptz not null default now()
);
```

La parte de cobranza (`planes`, `suscripciones`, `cargos`, `pagos`) está en `ADMIN-BILLING.md`.

## 4. RLS: patrón estándar

```sql
alter table public.checadas enable row level security;

-- Lectura: cualquier rol del tenant; super admin ve todo
create policy checadas_select on public.checadas
  for select to authenticated
  using (
    (select auth.jwt() ->> 'rol') = 'SUPER_ADMIN'
    or tenant_id = ((select auth.jwt() -> 'app_metadata' ->> 'tenant_id'))::uuid
  );
-- Sin políticas de INSERT/UPDATE/DELETE para authenticated:
-- la escritura la hace el servidor con service_role.
```

Reglas:
- Envolver `auth.jwt()` en `(select ...)` para que Postgres lo evalúe una sola vez.
- Escritura de checadas/incidencias/envíos: solo servidor.
- `NOMINISTA`: solo `SELECT`. `credenciales`: ningún acceso para `authenticated`.
- Verificar en la documentación vigente de Supabase dónde viven los claims personalizados (`app_metadata` vs. claim raíz) antes de implementar el hook.

## 5. Límites del plan
Trigger `before insert` en `empleados` y `fuentes_asistencia` que consulta la suscripción vigente. Política de excedente: tolerancia del 10 % con aviso; después, bloquear alta (no la ingesta).

## 6. Particionado y retención
`checadas` crece rápido: particionar por mes (`ts_utc`) cuando supere ~50 M filas. Retención configurable por tenant; archivar, no borrar, salvo solicitud documentada.

## 7. Pruebas obligatorias (`supabase/tests/`)
- Aislamiento entre tenants por tabla y operación.
- `NOMINISTA` no escribe.
- `authenticated` no lee `credenciales` ni `agentes.token_hash`.
- Unicidad/idempotencia de `checadas`.
- Hora repetida del cambio de horario marca `ambigua`.

## 8. Foto del empleado (Storage) — migración `0004_empleado_foto.sql`

```sql
alter table public.empleados
  add column foto_path text,               -- {tenant_id}/{empleado_id}/{uuid}.webp
  add column foto_thumb_path text,         -- miniatura 128 px
  add column foto_actualizada_en timestamptz;

-- Bucket privado (límites a nivel de bucket; la validación real se hace en servidor)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('empleados-fotos', 'empleados-fotos', false, 524288,
        array['image/webp','image/jpeg'])
on conflict (id) do nothing;

-- Lectura: miembros del tenant (primer segmento de la ruta = tenant_id) y super admin
create policy fotos_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'empleados-fotos'
    and (
      (select auth.jwt() ->> 'rol') = 'SUPER_ADMIN'
      or (storage.foldername(name))[1] = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')
    )
  );
-- Sin políticas de insert/update/delete para authenticated:
-- las escrituras las hace el servidor con service_role tras validar la imagen.
```

Reglas:
- Ruta siempre `{tenant_id}/{empleado_id}/{uuid}.webp`; el `tenant_id` lo pone el servidor.
- Al borrar un empleado, un job elimina sus archivos del bucket y registra en `auditoria`.
- Prueba pgTAP/Storage: un usuario del tenant A no puede leer objetos con prefijo del tenant B.
- Confirmar en la documentación vigente de Supabase la función `storage.foldername`, los límites del bucket y dónde viven los claims personalizados.
- Detalle del flujo, validaciones y UI: `docs/FEATURE-FOTO-EMPLEADO.md`.
