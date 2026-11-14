# PROMPT-INICIO.md — Prompts maestros por fase

Cómo usarlos: abre una sesión nueva en la raíz del repo, activa **plan mode**, pega el prompt de la fase y revisa el plan antes de aprobar. Una fase = una o varias sesiones; haz `/clear` entre sesiones.

Supuestos por defecto (cámbialos aquí si decides otra cosa antes de empezar):
- Supabase **Cloud** (no auto-alojado). Next.js y worker en el VPS de IONOS con Docker + Caddy.
- Pagos **manuales** en el MVP (sin pasarela). **No hay facturación** en la app.
- Cola de trabajos: `pg-boss`.

---

## PROMPT MAESTRO — Fase 0: Fundaciones

```
Eres el agente principal de un SaaS multi-tenant de control de asistencia
(relojes ZKTeco/Hikvision → CONTPAQi Nóminas, TRESS, RH4000) para México.

ANTES DE ESCRIBIR CÓDIGO
1. Lee AGENTS.md y estos docs completos: docs/00-REVISION.md,
   docs/ARCHITECTURE.md, docs/SECURITY.md, docs/DATABASE.md y docs/UI-UX-IOS.md.
   No leas el resto salvo que la tarea lo requiera.
2. Consulta la documentación oficial vigente de Next.js, Tailwind, shadcn/ui,
   Supabase, Zod, TanStack y Motion antes de usar sus APIs. No uses APIs de memoria.
3. Entra en plan mode y preséntame un plan por pasos con archivos a crear.
   Espera mi aprobación antes de implementar.

OBJETIVO DE LA FASE 0
Dejar la base lista para construir encima, sin funciones de negocio todavía:

A. Monorepo pnpm: apps/web (Next.js App Router, TypeScript estricto),
   apps/worker (esqueleto pg-boss), packages/contracts (Zod), agent/ (solo carpeta
   con README), supabase/. Versiones últimas estables, fijadas exactas.
B. Calidad: ESLint, Prettier, typecheck, Vitest, scripts de AGENTS.md
   (dev, build, lint, typecheck, test, db:reset, db:types, db:test).
   CI con GitHub Actions: typecheck + lint + test + db:test.
C. Base de datos: migraciones iniciales según docs/DATABASE.md §3
   (tenants, perfiles_usuarios, sucursales, empleados, agentes,
   agente_codigos_enrolamiento, fuentes_asistencia, credenciales, auditoría)
   con RLS por operación y rol, funciones security definer con search_path vacío,
   y pruebas pgTAP de aislamiento entre tenants. NO incluyas aún checadas,
   incidencias, envíos ni cobranza (son de fases posteriores).
D. Auth: Supabase Auth con claims tenant_id y rol en el JWT, MFA TOTP obligatorio
   para SUPER_ADMIN y ADMIN_EMPRESA, middleware de protección de rutas,
   roles SUPER_ADMIN / ADMIN_EMPRESA / TECNICO_LOCAL / NOMINISTA.
E. Design system iOS: tokens en globals.css (docs/UI-UX-IOS.md §1), modo claro y
   oscuro, componentes base en components/ui (Button con gradiente sutil, Card,
   Input, Sheet, Toast, Badge, Skeleton, EmptyState, SegmentedControl) y layout
   responsivo (tab bar en móvil, sidebar en desktop).
F. <DataTable> estándar con TanStack Table + Query: header sticky, búsqueda,
   filtros, orden, paginación en servidor, visibilidad de columnas y exportación
   XLSX/CSV/PDF (con neutralización de fórmulas). Demostrarlo con la tabla
   de empresas.
G. Panel /admin: login, layout y CRUD de empresas (datos de contacto y fiscales
   como referencia, plan, estatus, zona horaria) usando DataTable.
H. Docker Compose (web, worker, caddy) y .env.example sin secretos.

REGLAS
- Respeta las reglas duras de AGENTS.md y las de .claude/rules/.
- No inventes formatos de nómina ni endpoints de terceros; no están verificados.
- Cambios pequeños y verificables: tras cada bloque (A–H) ejecuta
  pnpm typecheck && pnpm lint && pnpm test (y pnpm db:test si tocaste SQL).
- Si falta una decisión de negocio, pregúntame; no asumas.

ENTREGA
Por cada bloque: resumen de máximo 5 líneas (qué cambió, qué falta, cómo probarlo).
Al final: checklist de docs/SECURITY.md §8 marcando qué quedó cubierto.
```

---

## Fase 1 — Ingesta y agente base

```
Lee AGENTS.md, docs/ARCHITECTURE.md §3-4, docs/AGENT-LOCAL.md, docs/DATABASE.md
y packages/contracts. Entra en plan mode.

Objetivo: ingesta en tiempo casi real.
1. Migración: checadas (inmutables), índices y RLS + pruebas pgTAP.
2. Contratos Zod del agente (enrolar, latido, lote de checadas) y JSON Schema.
3. API del agente: enrolamiento con código de un solo uso, credencial por agente
   (hash), latido, ingesta idempotente por lotes (máx. 500), firma HMAC + nonce,
   rate limit.
4. Realtime: Broadcast por canal privado del tenant; hook useTenantChannel que
   invalida queries de TanStack Query; indicador "En vivo".
5. Agente Python (agent/): SQLite con cola, enrolamiento, latido, driver ZKTeco
   (pyzk) con captura en vivo + reconciliación cada 30 min, reintentos con backoff.
   Incluye simulador de reloj para pruebas.
6. Dashboard del cliente: tarjetas y gráficas en vivo (docs/UI-UX-IOS.md §5)
   y tabla de checadas con DataTable.

Verifica con pruebas, incluida la de cambio de horario de otoño (hora repetida).
No avances a motor de turnos ni envíos a nómina.
```

## Fase 2 — Empleados, foto y reportes

```
Lee AGENTS.md, docs/FEATURE-FOTO-EMPLEADO.md, docs/DATABASE.md §8,
docs/SECURITY.md y docs/UI-UX-IOS.md. Entra en plan mode.

Objetivo:
1. CRUD de empleados y sucursales con DataTable (sticky, búsqueda, filtros,
   export XLSX/CSV/PDF), con columna de avatar (miniatura por URL firmada).
2. Foto del trabajador según docs/FEATURE-FOTO-EMPLEADO.md:
   - Migración 0004 (columnas + bucket privado empleados-fotos + políticas).
   - <PhotoUploader />: drag & drop, selector, captura desde cámara
     (input capture en móvil/tablet, getUserMedia en computadora) y editor
     <canvas> para girar y recortar; exportación <=720 px en WebP con respaldo JPEG.
   - Endpoint POST /api/empleados/[id]/foto con validaciones de servidor (rol,
     tenant, magic bytes, sharp, miniatura, borrado de la foto anterior, auditoría).
3. Pruebas: exportación nunca >720 px, rechazo de archivos inválidos, aislamiento
   del bucket entre tenants (pgTAP/Storage) y E2E del flujo completo.
Consulta la documentación vigente de Supabase Storage antes de escribir las políticas.
```

## Fase 3 — Motor de turnos y envíos a nómina

```
Lee AGENTS.md, docs/DATABASE.md, docs/AGENT-LOCAL.md §7 y docs/fixtures/.
ANTES de implementar layouts, confirma que docs/fixtures/ contiene archivos reales
de CONTPAQi y TRESS. Si no existen, detente y pídemelos.

Objetivo: turnos, incidencias (retardo, falta, hora extra, cruce de medianoche),
días festivos, outbox envios_destino con reintentos e idempotencia, layouts
configurables por tenant validados contra los fixtures, y conector RH4000
(solo si hay documentación verificada). Cobertura de pruebas alta en el motor
de cálculo.
```

## Fase 4 — Cobranza (sin facturación)

```
Lee AGENTS.md y docs/ADMIN-BILLING.md. Entra en plan mode.
Implementa planes versionados (con los precios del plan maestro), suscripciones,
cargos mensuales idempotentes (job pg-boss), registro manual de pagos con
comprobante, cobranza escalonada y suspensión segura (la ingesta nunca se
bloquea). Dashboard admin con MRR, saldo vencido y agentes caídos.
No generes CFDI ni integres pasarela de pago.
```

---

## Prompt corto para tareas sueltas

```
Objetivo: <una frase>
Archivos a tocar: <rutas>
Docs a leer: <1-2 de docs/>
Criterio de hecho: typecheck + lint + test (+ db:test)
Fuera de alcance: <lista>
```
