# TOKEN-BUDGET.md — Eficiencia de contexto para agentes

## Principios
1. **Contexto mínimo suficiente**: `AGENTS.md` corto (<80 líneas); detalle en `docs/*` bajo demanda.
2. **Una tarea por sesión.** `/clear` entre tareas no relacionadas.
3. **Leer rangos, no archivos completos** (offset/limit). Buscar con Grep antes de leer.
4. **Delegar búsquedas amplias** a subagentes (`Explore`); traer solo conclusiones.
5. **Compactar al ~50 %** del contexto con instrucciones de qué conservar.

## Qué leer según la tarea
| Tarea | Leer |
|-------|------|
| Migración/RLS | `DATABASE.md`, `SECURITY.md` §2 |
| Pantalla/UI | `UI-UX-IOS.md` |
| Cobranza/admin | `ADMIN-BILLING.md` |
| Agente Python | `AGENT-LOCAL.md`, `packages/contracts` |
| Ingesta/realtime | `ARCHITECTURE.md` |

## Reglas para ahorrar tokens
- No pegar logs completos: filtrar con `tail -n 50` / `grep`.
- No reabrir archivos que acabas de editar.
- Tipos generados (`db.types.ts`) no se leen completos; buscar por nombre de tabla.
- Salidas de comandos largas → redirigir a archivo en scratchpad y leer solo lo relevante.
- Respuestas finales ≤5 líneas: qué cambió, qué falta.
- Evitar explorar `node_modules`, `.next`, `dist`, `supabase/.temp` (ignorados).

## Plantilla de tarea para un agente
```
Objetivo: <una frase>
Archivos a tocar: <rutas>
Docs a leer: <1-2>
Criterio de hecho: typecheck + lint + test (+ db:test)
Fuera de alcance: <lista>
```

## Compactación
`/compact Conserva: decisiones de arquitectura, rutas de archivos modificados, comandos de verificación y pendientes. Descarta salidas de logs.`
