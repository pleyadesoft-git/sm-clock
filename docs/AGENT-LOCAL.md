# AGENT-LOCAL.md — Agente Python en sitio del cliente

## 1. Responsabilidades
Leer relojes en la red local, guardar en cola local, sincronizar con la nube, entregar layouts/envíos a destinos locales y exponer una UI de diagnóstico **solo en `127.0.0.1:8085`**.

## 2. Estructura
```
agent/
  src/agent/
    main.py            # arranque, servicio
    config.py          # carga de config desde la nube + SQLite
    db.py              # SQLite (WAL), migraciones locales
    sync.py            # lotes a la nube, reintentos con backoff
    scheduler.py       # APScheduler
    drivers/zkteco.py  # pyzk
    drivers/hikvision.py   # ISAPI (Digest)
    drivers/tacloud.py     # OAuth2 + CSV (puede correr en la nube)
    targets/layouts.py     # CONTPAQi / TRESS (formatos configurables)
    targets/rh4000.py
    ui/                # FastAPI local
  tests/
```

## 3. Ciclo de vida
1. **Enrolamiento**: el técnico ingresa el código de un solo uso → el agente recibe su credencial propia y la guarda con DPAPI.
2. **Latido** cada 60 s (versión, hora local, cola pendiente).
3. **Captura**: modo vivo cuando el dispositivo lo permite (ZKTeco live capture, Hikvision alertStream) + **reconciliación cada 30 min** desde la última marca.
4. **Envío**: lotes de hasta 500 cada 5-10 s; solo se marca `sincronizado=1` tras confirmación del servidor.
5. **Empleados**: sincronización 2 veces al día (07:05 y 14:05) o a demanda.

## 4. Resiliencia
- Cola en SQLite (WAL); reintento exponencial con *jitter*; sin pérdida ante corte de internet o reinicio.
- Un reloj caído no bloquea a los demás (tareas aisladas, timeouts de 10 s).
- Idempotencia: la clave `(fuente, empleado, ts_utc)` evita duplicados en reenvíos.
- Reloj del equipo: comparar con el servidor; alertar si hay desvío >2 min.
- Registro local rotativo, sin datos personales ni secretos.

## 5. Hora y zona
Convertir la hora del reloj con la zona del tenant (`America/Tijuana`, que sí cambia por horario de verano). En la hora repetida de otoño, marcar `ambigua=true` y enviar `ts_dispositivo_local` original para resolución posterior. Documentar si el reloj mismo ajusta horario de verano.

## 6. Hardware
- **ZKTeco** (`pyzk`): TCP/UDP 4370, CommKey si aplica. Leer solo registros nuevos; no borrar del reloj salvo configuración explícita y tras confirmación del servidor.
- **Hikvision** (ISAPI, Digest): endpoints de eventos de acceso y usuarios. **Verificar contra la documentación del modelo exacto**; la paginación y campos varían entre firmware.
- **No extraer ni transmitir plantillas biométricas.**

## 7. Destinos
Los formatos de CONTPAQi, TRESS y RH4000 son **configurables por tenant** y se validan contra `docs/fixtures/` con archivos reales del cliente o del proveedor (aún no verificados; ver `00-REVISION.md`).
- Layout TXT: escribir a ruta configurada, con codificación y fin de línea configurables, y archivo `.tmp` → rename atómico.
- SQL directo: usuario de **solo lectura** para catálogos; escritura solo como opción avanzada con aviso contractual.
- RH4000 API: HTTPS, Bearer, timeouts, reintentos con idempotencia; registrar respuesta en `envios_destino`.

## 8. UI local (diagnóstico en 127.0.0.1:8085)
- **Autenticación Administrativa**:
  - **En Línea**: Valida credenciales contra `POST /api/v1/agente/verificar-tecnico`. Permite acceso a usuarios con rol `SUPER_ADMIN` o `ADMIN_EMPRESA` (del tenant correspondiente al agente).
  - **Offline**: PIN de emergencia local configurable en SQLite (por defecto `123456`) para cuando el sitio del cliente no dispone de internet y se requiere configurar la IP de los relojes.
  - Emite cookie de sesión `sm_agent_session` (SameSite=Lax, HttpOnly, 12h).
- **Funcionalidades en la UI**:
  - **Pestaña 1: Resumen y Cola**: Monitor de checadas en tiempo real, estado de SQLite WAL, forzar sincronización manual de lotes pendientes y reconciliación de 30 min.
  - **Pestaña 2: Relojes y Terminales**: CRUD completo de relojes (ZKTeco, Hikvision, TA.Cloud) con almacenamiento seguro de contraseñas (DPAPI / PBKDF2), edición de IP/puerto y prueba de conexión en vivo con medición de latencia en milisegundos.
  - **Pestaña 3: Diagnóstico Cloud & APIs**:
    1. *Probador de Latido*: Valida `POST /api/v1/agente/latido`, mide latencia en ms y alerta sobre desvíos de reloj (>120s).
    2. *Probador de Checadas*: Envía lote de prueba firmado con HMAC-SHA256 para verificar la ingesta central.
    3. *Probador de Catálogo de Empleados*: Sincroniza `cat_empleados` con `POST /api/v1/agente/sync-empleados`.
    4. *Enrolamiento Central*: Canjea códigos de un solo uso `ENROL-XXXXXX-...`.
  - **Pestaña 4: Layouts y Destinos**: Descarga inmediata de layouts oficiales para CONTPAQi (`MovimientosDyHporperiodo.cfg`) y Sistema TRESS (`tress_checadas.txt`).

## 9. Empaquetado a Ejecutable (.exe) y Servicio de Windows
1. **Compilación en Windows**:
   - Ejecuta `scripts\build-exe.bat` o:
     ```cmd
     cd agent
     pyinstaller --clean -y agent.spec
     ```
   - El ejecutable independiente resultante se genera en `dist\sm-clock-agent.exe`.
2. **Instalación como Servicio de Windows (Segundo Plano)**:
   - Haz clic derecho en `scripts\install-service.bat` y selecciona **"Ejecutar como Administrador"** (o ejecuta `scripts\install-service.ps1`).
   - El instalador configura el servicio de Windows `SMClockAgent` con inicio automático (`SERVICE_AUTO_START`), autoreinicio ante fallos y redirección de logs con rotación en `logs\agent.log`.
3. **Desinstalación**:
   - Ejecuta `scripts\uninstall-service.bat` como Administrador.

## 10. Pruebas y Cobertura
- Cobertura total de pruebas unitarias y de integración en `agent/tests/`:
  - `test_agent.py`: Formatos de checadas, cambio de horario de Tijuana (PDT/PST, hora repetida de otoño `ambigua=True`), DPAPI/PBKDF2.
  - `test_drivers_zkteco.py`, `test_drivers_hikvision.py`, `test_drivers_tacloud.py`: Decodificación y normalización de checadas desde fixtures reales.
  - `test_targets.py`: Generación de layouts atómicos para CONTPAQi y TRESS.
  - `test_sync_and_scheduler.py`: Firma HMAC-SHA256, anti-replay, deriva de reloj, aislamiento de fallos en scheduler.
  - `test_ui.py`, `test_ui_relojes.py`, `test_ui_auth_and_cloud.py`, `test_ui_logs.py`: UI local, bloqueo a non-localhost, login de Super-Admin y Tenant Admin, PIN offline, CRUD de relojes, probadores de endpoints cloud y logs en vivo.
- Comando de verificación:
  ```bash
  cd agent && .venv/bin/pytest -v
  ```

## 11. Aplicación de Escritorio en Electron (`apps/desktop`)
- **Arquitectura**: Electron (Main + Preload + Renderer Vite/React 19 + Shadcn UI).
- **Proceso Sidecar en Segundo Plano**: El proceso Main de Electron orquesta el binario Python (`sm-clock-agent run --no-browser --port 8085`), vigila su salud con autoreinicio automático y permanece minimizable en la bandeja del sistema (System Tray).
- **Módulos en la Interfaz**:
  1. **Autenticación**: Acceso con credenciales de Supabase Auth (Admin de Empresa o Super-Admin con selector de tenant) y acceso de emergencia por PIN offline.
  2. **Terminales y Relojes**: `<DataTable>` TanStack Table de terminales ZKTeco, Hikvision y TA.Cloud, con drawer lateral con footer fijo (`RelojSheet`), prueba de conectividad en la LAN en tiempo real (latencia en ms) y sincronización bidireccional con Supabase (`fuentes_asistencia`).
  3. **Monitor en Vivo**: Estado de SQLite WAL, cola de checadas en tiempo real y forzado de sincronización/reconciliación.
  4. **Logs y Diagnósticos de Errores**: Consola de eventos en vivo, filtro por severidad (`ERROR`, `WARN`, `INFO`), búsqueda rápida, auto-scroll, copiado de logs y exportación de archivo de diagnóstico para soporte técnico.
- **Comandos**:
  ```bash
  cd apps/desktop
  pnpm dev       # Inicia el renderer Vite
  pnpm build     # Compila el renderer y el proceso Electron
  pnpm start     # Lanza la aplicación Electron
  ```

