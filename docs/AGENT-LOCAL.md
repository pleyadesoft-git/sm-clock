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

## 8. UI local (diagnóstico)
Login técnico contra la nube con respaldo offline (hash con Argon2). Pruebas de conexión (relojes, TA.Cloud, SQL, RH4000), visor de cola, vista y descarga de layouts de muestra, estado de sincronización. Sin CORS abierto, sin exponer en la red.

## 9. Empaquetado y actualización
- Python 3.12, PyInstaller/Nuitka, servicio de Windows (NSSM o `pywin32`).
- Instalador firmado; auto-actualización con verificación de firma y reversión si falla el latido.
- Soporte Windows 10/11 y Server 2016+. Probar con antivirus comunes.

## 10. Pruebas
Simulador de reloj (servidor TCP falso), pruebas de cola ante cortes, pruebas de cambio de horario, pruebas de formato contra fixtures.
