# ADMIN-BILLING.md — Panel Super-Admin, planes y cobranza

Ruta: `/admin/*`, solo rol `SUPER_ADMIN` + MFA. Toda acción sensible queda en `auditoria`.

## 1. Módulos del panel

| Módulo | Contenido |
|--------|-----------|
| Dashboard | MRR, clientes activos/prueba/suspendidos, cobranza vencida, altas del mes, agentes en línea, checadas/hora |
| Empresas | Alta/edición, datos de contacto y datos fiscales (solo referencia), plan, estatus, notas internas, zona horaria |
| Suscripciones | Plan, precio pactado, ciclo (mensual/anual), próxima renovación, descuento anual 10 % |
| Cobranza | Cargos, pagos, saldo por empresa, antigüedad de saldos |
| Agentes | Estado, versión, último latido, revocar/rotar, códigos de enrolamiento |
| Soporte | Modo "ver como empresa" con motivo y expiración, bitácora |
| Catálogo | Planes y precios versionados |

## 2. Modelo de cobranza (migración `0003_billing.sql`)

```sql
create table public.planes (
  id uuid primary key default gen_random_uuid(),
  codigo text not null,
  version int not null default 1,
  nombre text not null,
  empleados_min int not null,
  empleados_max int,                         -- null = ilimitado
  relojes_incluidos int not null,
  mensualidad numeric(12,2) not null,
  implementacion numeric(12,2) not null,
  extra_reloj_mensual numeric(12,2) not null,
  conector_pago_unico numeric(12,2) not null default 0,
  conector_mantenimiento_mensual numeric(12,2) not null default 0,
  activo boolean not null default true,
  unique (codigo, version)
);

create table public.suscripciones (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  plan_id uuid not null references public.planes(id),
  precio_pactado numeric(12,2) not null,     -- snapshot
  moneda text not null default 'MXN' check (moneda in ('MXN','USD')),
  ciclo text not null default 'MENSUAL' check (ciclo in ('MENSUAL','ANUAL')),
  descuento_pct numeric(5,2) not null default 0,
  relojes_extra int not null default 0,
  estatus text not null default 'ACTIVA' check (estatus in ('PRUEBA','ACTIVA','VENCIDA','SUSPENDIDA','CANCELADA')),
  inicio date not null,
  proxima_renovacion date,
  fin date
);

create table public.cargos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  suscripcion_id uuid references public.suscripciones(id),
  concepto text not null,                    -- MENSUALIDAD, IMPLEMENTACION, VISITA, CONECTOR, AJUSTE
  periodo daterange,
  subtotal numeric(12,2) not null,
  iva numeric(12,2) not null,
  total numeric(12,2) not null,
  moneda text not null default 'MXN',
  tipo_cambio_dof numeric(10,4),             -- solo si USD
  folio_factura_externo text,                -- opcional, solo referencia
  vence_en date not null,
  estatus text not null default 'PENDIENTE' check (estatus in ('PENDIENTE','PAGADO','PARCIAL','VENCIDO','CANCELADO')),
  created_at timestamptz not null default now()
);

create table public.pagos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  cargo_id uuid references public.cargos(id),
  monto numeric(12,2) not null,
  moneda text not null default 'MXN',
  metodo text not null,                      -- SPEI, TRANSFERENCIA, TARJETA, EFECTIVO
  referencia text,
  pagado_en timestamptz not null,
  registrado_por uuid references auth.users(id)
);
```

Todas con RLS: `SUPER_ADMIN` total; `ADMIN_EMPRESA` solo `SELECT` de lo suyo; nadie más.

## 2. Reglas de negocio

- Precios en `planes` (versionados). Cambiar precio = nueva versión; las suscripciones existentes conservan `precio_pactado`.
- IVA 16 % calculado en servidor; dinero siempre `numeric`, nunca `float`.
- IMMEX en USD: guardar `moneda` y `tipo_cambio_dof` del día del cargo.
- Descuento anual 10 %: se aplica en la mensualidad con ciclo `ANUAL` (12 meses por adelantado).
- Conector de nómina: pago único + mantenimiento mensual (recomendado).
- Generación de cargos mensuales: job `pg-boss` diario e **idempotente** (clave `tenant+periodo+concepto`).

## 3. Ciclo de cobranza (dunning)

| Día vs. vencimiento | Acción |
|---------------------|--------|
| -5 | Recordatorio por correo |
| 0 | Aviso de vencimiento |
| +5 | Segundo aviso, banner en la app |
| +10 | Estatus `VENCIDA`, aviso al contacto de cobranza |
| +20 | `SUSPENDIDA`: se bloquean UI y exportaciones |
| +60 | Revisión manual; **nunca borrar datos** |

Suspensión segura: el agente **sigue capturando** y el servidor sigue almacenando checadas. La reactivación al registrar pago es automática. Los umbrales son configurables.

## 4. Pagos
- MVP: **registro manual** (SPEI/transferencia) con conciliación, subida de comprobante y asignación a cargo.
- Fase posterior: pasarela (Stripe / Mercado Pago / Conekta). Decisión pendiente; los webhooks se guardan en `webhook_eventos` con verificación de firma e idempotencia.

## 5. Facturación fuera de la app
La app **no emite facturas (CFDI)**: eso se hace en tu sistema externo. Aquí solo se guardan los datos del cliente necesarios para facturar (razón social, RFC, régimen, CP, correo) y, opcionalmente, el folio de la factura externa en el cargo para conciliar.

## 6. KPIs del dashboard admin
MRR, ARR, churn mensual, ARPA, saldo vencido por antigüedad (0-30/31-60/60+), clientes por plan, agentes sin latido >15 min, checadas ingeridas por hora, errores de envío a nómina.
