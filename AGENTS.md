# AGENTS.md — Plataforma SaaS de Asistencia (multi-tenant)

SaaS que lee checadas de relojes ZKTeco/Hikvision (vía **Agente Local Python** en el sitio del cliente) o TA.Cloud, las procesa y las envía a CONTPAQi Nóminas, TRESS y RH4000. Mercado: Tijuana, B.C., México. UI en español (es-MX), código y commits en inglés.

## Stack
Next.js (App Router) · TypeScript estricto · Supabase (Postgres, Auth, Realtime) · Tailwind · shadcn/ui · TanStack Query + TanStack Table · React Hook Form + Zod · Motion (`motion/react`) · pnpm workspaces · Agente: Python 3.12 + FastAPI + SQLite.

> **Versiones:** usa las últimas estables al inicializar y fíjalas exactas. **No asumas APIs de memoria**: consulta la documentación oficial antes de usar APIs de Next, Tailwind, shadcn, Zod o Supabase (cambian entre mayores).

## Estructura
```
apps/web/            Next.js (UI + Route Handlers /api)
apps/worker/         Worker pg-boss (envíos a nómina, dunning, reportes grandes)
packages/contracts/  Esquemas Zod compartidos (contratos API agente↔nube) → JSON Schema para Python
agent/               Agente local Python
supabase/migrations/ Única fuente de verdad del schema
docs/                Documentación profunda (cargar bajo demanda)
```

## Comandos
```
pnpm dev | build | lint | typecheck | test
pnpm db:reset        # supabase db reset
pnpm db:types        # supabase gen types typescript → packages/contracts/db.types.ts
pnpm db:test         # pgTAP (RLS)
cd agent && pytest
```
**Definición de hecho:** `pnpm typecheck && pnpm lint && pnpm test` en verde (+ `pnpm db:test` si tocaste SQL).

## Reglas duras (no negociables)
1. `service_role` **nunca** en cliente ni en el agente. Solo en `apps/web/lib/server/**` y `apps/worker`.
2. `tenant_id` **jamás** viene del body/query. Sale del JWT (web) o de la credencial del agente (API agente).
3. Todo input externo se valida con **Zod** (`safeParse`) en el borde: Route Handlers, Server Actions, respuestas de APIs de terceros.
4. Cambios de schema solo vía nueva migración en `supabase/migrations/`. Nunca editar una migración aplicada. Toda tabla nueva: RLS habilitado + políticas + prueba pgTAP.
5. Secretos (passwords de relojes/SQL/tokens) cifrados en `credenciales`; nunca en logs, nunca al cliente, nunca en `.env` versionado.
6. Fechas: `timestamptz` en UTC en BD; mostrar con `America/Tijuana` (o zona del tenant) y locale `es-MX`. Dinero: `numeric` + MXN.
7. UI: solo componentes de `components/ui` y tokens CSS de `docs/UI-UX-IOS.md`. **Prohibido** hex/px sueltos en componentes.
8. Toda tabla de datos usa `<DataTable>` (sticky header, búsqueda, filtros, export XLSX/CSV/PDF).
9. Sin `any`, sin `@ts-ignore`, sin `console.log` de datos de empleados.
10. Cambios pequeños y enfocados; no refactorizar fuera de alcance.
11. Todo diálogo, modal o drawer (`Sheet`) con acciones de guardado o confirmación **debe tener un footer fijo** (prop `footer` o clase `.ios-sheet-footer`) con los botones de acción siempre a la vista sin requerir scroll. El formulario/cuerpo (`.ios-sheet-body`) es el que tiene scroll vertical.
12. Validación de formularios: no utilizar validaciones nativas del navegador (HTML); utilizar `react-hook-form` con esquemas `zod` (`@hookform/resolvers/zod`) y componentes `<Form>` de Shadcn (`components/ui/form`). La validación de error solo debe mostrarse una vez que el campo tenga la propiedad `dirty` (`isDirty: true`) o se intente enviar el formulario (`isSubmitted`). El estado de error se presenta exclusivamente con `input[aria-invalid="true"] { border-color: var(--danger); }` (nunca con `input:invalid` nativo para evitar campos rojos al cargar), `<FormLabel>` en rojo (`--danger`) y `<FormMessage>` (`text-xs font-medium text-[var(--danger)]`).

## Mapa de documentación (leer solo lo necesario)
| Tema | Archivo |
|------|---------|
| Brechas del plan y roadmap | `docs/00-REVISION.md` |
| Arquitectura, realtime, despliegue | `docs/ARCHITECTURE.md` |
| Seguridad y privacidad | `docs/SECURITY.md` |
| Modelo de datos, RLS, DDL nuevo | `docs/DATABASE.md` |
| Panel super-admin, planes y cobranza (sin facturación) | `docs/ADMIN-BILLING.md` |
| Diseño iOS, tablas, dashboard | `docs/UI-UX-IOS.md` |
| Agente local | `docs/AGENT-LOCAL.md` |
| Eficiencia de tokens / flujo de trabajo | `docs/TOKEN-BUDGET.md` |
| Prompts maestros por fase | `docs/PROMPT-INICIO.md` |
| Foto del empleado (upload, canvas, Storage) | `docs/FEATURE-FOTO-EMPLEADO.md` |

Reglas por ruta se cargan automáticamente desde `.claude/rules/`.

## Flujo de trabajo
1. Lee solo los docs del tema. 2. Plan breve si toca >3 archivos. 3. Implementa. 4. Verifica (definición de hecho). 5. Resume en ≤5 líneas qué cambió y qué falta.
Ante ambigüedad de negocio (precios, formatos de nómina), **pregunta**; no inventes formatos de layout: usa `docs/fixtures/`.
