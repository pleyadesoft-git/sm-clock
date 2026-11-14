# SECURITY.md

## 1. Autenticación y autorización (web)
- Supabase Auth con **MFA (TOTP) obligatorio** para `SUPER_ADMIN` y `ADMIN_EMPRESA`.
- Claims `tenant_id` y `rol` en el JWT mediante *custom access token hook*; RLS los lee de `auth.jwt()` (sin subconsultas por fila).
- Roles: `SUPER_ADMIN` (dueño del SaaS), `ADMIN_EMPRESA`, `TECNICO_LOCAL`, `NOMINISTA` (solo lectura y exportación).
- Cambios de rol y de tenant solo por servidor; nunca desde el cliente.
- Sesiones: expiración corta, refresh rotativo, cierre de sesión global ante cambio de contraseña.

## 2. RLS (regla de oro)
- Toda tabla con `tenant_id` tiene RLS activo y políticas **por operación** (`SELECT/INSERT/UPDATE/DELETE`) y por rol. Evitar `FOR ALL`.
- Funciones `SECURITY DEFINER` con `SET search_path = ''` y nombres de objetos calificados.
- `service_role` solo en servidor; nunca en el agente ni en el navegador.
- Pruebas **pgTAP** obligatorias: usuario del tenant A no ve/escribe datos del tenant B, por cada tabla y operación.

## 3. Agente local
- Tabla `agentes` con credencial **propia** por instalación (token aleatorio de 256 bits, almacenado como hash). No compartir `api_key` por tenant.
- Enrolamiento con **código de un solo uso** y expiración corta, emitido por el panel; el agente recibe su credencial al canjearlo.
- Revocación y rotación desde el panel; el servidor rechaza agentes revocados.
- Peticiones firmadas (HMAC con timestamp + nonce) para evitar replays; validar reloj del agente contra el servidor.
- Credenciales de relojes/SQL se almacenan en el servidor cifradas; el agente las recibe en memoria y las guarda en SQLite cifradas con DPAPI de Windows. UI local solo en `127.0.0.1`.
- Actualizaciones del agente firmadas; verificar firma antes de aplicar.

## 4. Secretos y cifrado
- Tabla `credenciales`: AES-256-GCM con *envelope encryption* (clave maestra fuera de la BD, en variable del servidor o gestor de secretos). Sin política SELECT para `authenticated`.
- Nunca registrar secretos, tokens, ni datos de empleados en logs.
- Rotación de claves documentada; cada secreto con `key_version`.
- TLS 1.2+ en todo; HSTS; cookies `Secure`, `HttpOnly`, `SameSite=Lax`.

## 5. Aplicación web
- Validación Zod en todos los bordes. Salida escapada; sin `dangerouslySetInnerHTML`.
- CSP estricta, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`.
- Server Actions y Route Handlers: verificar sesión y rol **en cada uno**.
- Rate limiting en login, enrolamiento y API del agente.
- Exportaciones (XLSX/CSV/PDF): neutralizar fórmulas (prefijo `'` en celdas que empiecen con `= + - @`) para evitar CSV/XLSX injection.
- SSRF: las URLs configurables por el cliente (TA.Cloud, RH4000) se validan contra lista de dominios/esquemas permitidos y se bloquean rangos privados desde el servidor.

## 6. Privacidad (México)
- Los datos biométricos son datos personales sensibles. **No almacenar plantillas de huella/rostro en la nube.** Solo código de empleado, fecha/hora, tipo de verificación.
- Contar con aviso de privacidad, contrato de encargado de tratamiento y política de retención por tenant. Validar alcance legal con un abogado.
- Auditoría: bitácora inmutable de accesos de `SUPER_ADMIN` a datos de un tenant (modo "soporte" con motivo y expiración).

### Fotos de empleados
- Bucket **privado** `empleados-fotos`; acceso solo con URLs firmadas de corta vida generadas en servidor.
- Subida **solo por servidor**: valida firma real del archivo, ≤720 px, re-codifica y elimina EXIF. No confiar en lo que envía el navegador.
- La foto es dato personal; no se usa para reconocimiento facial. Retención y borrado según política del tenant.
- Detalle: `docs/FEATURE-FOTO-EMPLEADO.md`.

## 7. Respaldo y continuidad
- PITR activo; **prueba de restauración trimestral** documentada.
- El agente conserva cola local hasta confirmación del servidor (sin pérdida ante caídas).

## 8. Checklist previo a producción
- [ ] pgTAP de aislamiento en verde para todas las tablas
- [ ] MFA activo para administradores
- [ ] Secretos fuera del repo, `.env*` ignorados
- [ ] Dependencias auditadas (`pnpm audit`, `pip-audit`)
- [ ] Pentest básico a API del agente y exportaciones
- [ ] Restauración de backup probada
- [ ] Pruebas de aislamiento del bucket de fotos entre tenants
