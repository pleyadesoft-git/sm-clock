# Revisión del Plan Maestro v2 + schema.sql

> Veredicto: la base es sólida (modelo híbrido nube + agente, multi-tenant con RLS, precios claros).
> Hay **10 brechas** que conviene cerrar antes de escribir código. Las 1–6 son críticas.

## 1. Hallazgos

| # | Hallazgo | Riesgo | Solución (detalle en doc indicado) |
|---|----------|--------|-------------------------------------|
| 1 | `tenants.api_key` única por empresa, en texto plano, compartida por todos los agentes | Una fuga compromete al tenant; no se puede revocar un agente | Tabla `agentes` con credencial propia (hash), enrolamiento con código de un solo uso, rotación y revocación → `SECURITY.md`, `DATABASE.md` |
| 2 | Contraseñas de relojes, SQL, TA.Cloud y token RH4000 en columnas `VARCHAR` (varias sin cifrar) y legibles por `ADMIN_EMPRESA` vía RLS `FOR ALL` | Fuga de credenciales de clientes | Tabla `credenciales` cifrada (AES-256-GCM, envelope), sin política SELECT para `authenticated`; solo servidor |
| 3 | RLS: solo 4 políticas `FOR ALL`; sin políticas para `tenants`, `perfiles_usuarios`, `logs_agente`; roles no diferenciados; `is_super_admin()` consulta tabla por fila | Escalada de privilegios, lentitud, `NOMINISTA` con escritura | Claims `tenant_id`/`rol` en JWT (custom access token hook), políticas por rol y operación, `search_path` fijo, pruebas pgTAP obligatorias |
| 4 | Falta el **motor de turnos/incidencias**. El layout CONTPAQi usa `RET`, `HE2`, pero ZKTeco/Hikvision solo entregan checadas crudas | El producto no puede generar el layout sin esto (solo TA.Cloud lo trae calculado) | Tablas `horarios`, `turnos`, `asignaciones_turno`, `dias_festivos`, `incidencias` + motor de cálculo (tolerancias, retardos, HE, cruce de medianoche) |
| 5 | Checadas crudas e incidencias mezcladas en `registros_asistencia`; `estatus_envio_destino` es un solo campo | No se puede enviar a 2 destinos, ni reintentar con trazabilidad | Separar `checadas` (inmutables) de `incidencias`; patrón **outbox** con `envios_destino` (intentos, `next_retry_at`, idempotency key) |
| 6 | Cero modelo de cobranza: precios hardcodeados en `tenants`, sin suscripciones, cargos ni pagos | No puedes operar el negocio ni suspender por falta de pago de forma auditable | `planes` versionados, `suscripciones`, `cargos`, `pagos` → `ADMIN-BILLING.md` |
| 7 | Zona horaria: relojes guardan hora local sin zona; **Tijuana sí aplica horario de verano** (a diferencia del resto de México). La hora repetida de otoño (1-nov) genera ambigüedad; el `UNIQUE` además omite `fuente_id` | Checadas duplicadas/perdidas, horas mal calculadas | Guardar `ts_dispositivo_local` + `ts_utc` + `fuente_id`; agente convierte con la zona del tenant y marca ambigüedad |
| 8 | "100% tiempo real" choca con polling cada 30 min | Expectativa incumplida | Captura en vivo en agente (ZK `live_capture`, Hikvision `alertStream`), envío por lotes cada 5–10 s, polling 30 min solo como reconciliación; Realtime por *Broadcast* hacia UI → `ARCHITECTURE.md` |
| 9 | Sin estrategia de **suspensión segura**: "suspensión automática" podría hacer perder checadas | Pérdida de datos del cliente | Suspender = bloquear web/exports; el agente **sigue capturando** y la nube acepta/almacena o el agente encola; nunca borrar |
| 10 | Cronograma de 5 semanas | Entrega de baja calidad | Roadmap realista de ~12 semanas con MVP vendible en la semana 7 (abajo) |

## 2. Decisiones abiertas (necesito tu respuesta antes de la Fase 0)

1. **¿Supabase en la nube o self-hosted en el IONOS VPS?** El plan dice "VPS + Supabase". Recomendación: **Next.js + worker en tu VPS (Docker + Caddy) y Supabase Cloud** (Auth/Realtime/Backups/PITR administrados) hasta tener ingresos que justifiquen operar Supabase tú mismo. Self-host implica backups, upgrades de Realtime/Auth y monitoreo por tu cuenta. Si necesitas todo en México por contrato, self-host y presupuesta tiempo de operación.
2. **Pasarela de pago**: Stripe, Mercado Pago o Conekta. Para PyMEs de Tijuana domina SPEI/transferencia; sugerido: MVP con **registro manual de pagos + conciliación**, y pasarela en fase posterior.
3. **Cola de trabajos**: `pg-boss` (usa Postgres, cero infraestructura nueva) vs Redis/BullMQ. Recomendado: `pg-boss`.

## 3. Lo que NO pude verificar (validar antes de implementar)

Estos formatos/endpoints vienen en tu plan y no los pude contrastar con documentación oficial:
- Layout `MovimientosDyHporperiodo.cfg` de CONTPAQi Nóminas (nombre, columnas, claves de incidencia).
- Layout de checadas/prenómina de TRESS.
- Endpoint y payload de RH4000 (`/Employees/{codigo}/Attendance`, `accessType`, `maskFlag`).
- Endpoint `POST /api/exportaciones/generico/2` de TA.Cloud.

**Acción:** pide a cada proveedor documentación o un archivo de importación real de un cliente y guárdalo en `docs/fixtures/` como casos de prueba. Los formatos deben ser *configurables* por tenant (`mapeo_incidencias`, longitudes), nunca fijos en código.

Además: **escribir directo al SQL de CONTPAQi** puede invalidar soporte del fabricante y es frágil entre versiones. Recomendación: ofrecer layout TXT como vía principal y SQL directo solo con usuario de **solo lectura** para catálogo de empleados, o como opción avanzada con aviso contractual.

## 4. Observaciones de precios

- Mueve los precios a la tabla `planes` (versionada). `tenants` guarda solo el plan y el **precio pactado** (snapshot) en `suscripciones`.
- Cobra el conector de nómina también con **mantenimiento recurrente** (los proveedores cambian APIs); hoy es pago único.
- Define excedente por empleado sobre el límite del plan (tolerancia 10 % con aviso de upsell) en vez de bloquear.
- El cargo de implementación de Micro ($1,990) puede no cubrir el soporte real de instalar un agente en Windows de cliente; mide horas en los primeros 5 clientes.
- Para IMMEX en USD: guarda `moneda` y `tipo_cambio_dof` en cada cargo.

## 5. Privacidad (México)

Los datos biométricos son datos personales sensibles. **Diseño recomendado: nunca almacenar plantillas de huella/rostro en la nube**; solo código de empleado, fecha/hora y tipo de verificación. Incluye aviso de privacidad, contrato de encargado de tratamiento y política de retención por tenant. Revisa con un abogado el alcance de la ley de protección de datos vigente (hubo reforma en 2025).

## 6. Roadmap realista

| Fase | Semanas | Entregable |
|------|---------|-----------|
| F0 Fundaciones | 1 | Monorepo, CI, design system iOS, Auth + MFA, RLS + pruebas, CRUD de tenants |
| F1 Ingesta | 2–3 | `agentes`, enrolamiento, API de ingesta idempotente, agente ZKTeco, dashboard en vivo |
| F2 Datos | 4–5 | Empleados (con foto: drag & drop, cámara, canvas, Storage), sucursales, `DataTable` estándar, exports XLSX/CSV/PDF, reportes |
| F3 Nómina | 6–7 | Motor de turnos/incidencias, layouts CONTPAQi y TRESS, outbox de envíos → **MVP vendible** |
| F4 Negocio | 8–9 | Panel super-admin, planes, suscripciones, cargos, pagos manuales, dunning |
| F5 Integraciones | 10 | Hikvision, RH4000 API, TA.Cloud |
| F6 Hardening | 11–12 | Pentest, prueba de restauración de backups, carga, piloto con 2–3 clientes |
