# ARCHITECTURE.md

## 1. Vista general

```
 Navegador (Next.js UI, iOS-like)
        │  JWT (Supabase Auth)  ▲ Realtime (Broadcast)
        ▼                       │
 ┌─────────────── VPS IONOS (Docker + Caddy, TLS) ───────────────┐
 │  apps/web  (Next.js: UI + Route Handlers /api)                │
 │  apps/worker (pg-boss: envíos nómina, dunning, reportes)      │
 └───────────────┬───────────────────────────────────────────────┘
                 │ Postgres / Auth / Realtime
                 ▼
            Supabase (Cloud recomendado; self-host opcional)
                 ▲
                 │ HTTPS + credencial por agente (mTLS opcional)
 ┌───────────────┴───────────────┐
 │ Agente Local (Windows)        │──► ZKTeco 4370 / Hikvision ISAPI
 │ SQLite + cola + captura viva  │──► Layouts TXT / SQL / API RH4000
 └───────────────────────────────┘
```

## 2. Decisiones

| Tema | Decisión | Motivo |
|------|----------|--------|
| Hosting app | VPS IONOS, Docker Compose + Caddy | Control y costo |
| Base de datos | Supabase Cloud (inicio) | Backups/PITR, Auth, Realtime administrados |
| Cola | `pg-boss` | Sin infraestructura extra |
| Contratos | Zod en `packages/contracts` → JSON Schema para el agente | Una sola definición agente↔nube |
| Tiempo real | Agente captura en vivo y envía lotes cada 5–10 s; UI recibe por Realtime | El polling de 30 min queda solo como reconciliación |
| Ingesta | Route Handler idempotente, `ON CONFLICT DO NOTHING` | Reintentos seguros |

## 3. Flujo de ingesta

1. Agente captura checada (ZK live capture / Hikvision alertStream) y la guarda en SQLite (`sincronizado=0`).
2. Cada 5–10 s envía lote firmado a `POST /api/v1/agente/checadas` (máx. 500 por lote).
3. Servidor valida Zod, resuelve `tenant_id` desde la credencial, inserta en `checadas` con clave idempotente `(tenant_id, fuente_id, codigo_empleado, ts_utc)`.
4. Trigger/worker emite evento Broadcast al canal `tenant:{id}:checadas` (sin datos sensibles: solo IDs y conteos; la UI refresca con TanStack Query).
5. Worker calcula incidencias y encola `envios_destino` (outbox).
6. Reconciliación cada 30 min: el agente relee el reloj desde la última marca y llena huecos.

## 4. Realtime

- Usar **Broadcast** con canales privados autorizados por RLS en `realtime.messages`; no usar `postgres_changes` sobre tablas grandes.
- Cliente: suscripción en un hook (`useTenantChannel`) que invalida queries de TanStack Query; no mutar caché a mano con datos parciales.
- Indicador "En vivo / Reconectando" visible en el header.

## 5. Despliegue

- `docker compose`: `web`, `worker`, `caddy`. Variables en archivo fuera del repo (permisos 600).
- Caddy: TLS automático, HSTS, límite de tamaño de body, rate limit en `/api/v1/agente/*`.
- CI: typecheck, lint, test, `db:test`, build de imagen, migraciones aplicadas por pipeline (nunca desde laptop contra producción).
- Observabilidad: logs JSON estructurados, healthcheck `/api/health`, alerta si un agente no reporta en >15 min.

## 6. Suspensión segura

Suspender tenant = bloquear UI y exportaciones. La ingesta **sigue aceptando y almacenando** checadas. Nunca borrar datos por falta de pago.

## 7. Zona horaria

Guardar `ts_dispositivo_local` (texto/tiempo sin zona tal como lo da el reloj), `ts_utc` y `fuente_id`. El agente convierte con la zona del tenant y marca `ambigua=true` en la hora repetida del cambio de horario de otoño. Tijuana sí aplica horario de verano.
