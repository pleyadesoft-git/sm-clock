# Fixtures

Coloca aquí archivos reales o sintéticos basados en especificaciones oficiales de importación (CONTPAQi, TRESS), ejemplos de respuesta RH4000/TA.Cloud y exportaciones/eventos de relojes, **sin datos personales reales** (LFPDPPP). Son la fuente de verdad para pruebas y validación de formatos.

---

## 1. Hikvision (ISAPI & Exportaciones)

Estructura en `docs/fixtures/hikvision/`:

| Archivo | Origen / Protocolo | Propósito |
|---|---|---|
| [`acs_event_search_response.json`](file:///Users/mac/dev/new-era/sm-clock/docs/fixtures/hikvision/acs_event_search_response.json) | `POST /ISAPI/AccessControl/AcsEvent?format=json` | Búsqueda histórica de checadas (reconciliación periódica cada 30 min del Agente Local). |
| [`alert_stream_event.json`](file:///Users/mac/dev/new-era/sm-clock/docs/fixtures/hikvision/alert_stream_event.json) | `GET /ISAPI/Event/notification/alertStream` (JSON) | Evento capturado en vivo vía stream multipart / HTTP Host Push. |
| [`alert_stream_event.xml`](file:///Users/mac/dev/new-era/sm-clock/docs/fixtures/hikvision/alert_stream_event.xml) | `GET /ISAPI/Event/notification/alertStream` (XML) | Evento capturado en vivo en terminales con firmware legado / XML. |
| [`terminal_export_sample.csv`](file:///Users/mac/dev/new-era/sm-clock/docs/fixtures/hikvision/terminal_export_sample.csv) | Exportación Web UI / iVMS-4200 | Archivo CSV plano descargado directamente desde el reloj. |

### Mapeo oficial Hikvision ISAPI → SM-Clock (`ChecadaItem`)

1. **Código de Empleado**:
   - `employeeNoString` (prioridad 1)
   - Si viene vacío, fallback a `cardNo`

2. **Tipo de Marca (`TipoMarca`)**:
   - `attendanceStatus == "checkIn"` → `ENTRADA`
   - `attendanceStatus == "checkOut"` → `SALIDA`
   - `attendanceStatus == "breakOut"` → `SALIDA`
   - `attendanceStatus == "breakIn"` → `ENTRADA`
   - Otros / no especificado → `CHECADA`

3. **Tipo de Verificación (`TipoVerificacion`)**:
   - `currentVerifyMode == "face"` o `minor == 75` → `ROSTRO`
   - `currentVerifyMode == "fingerPrint"` o `minor == 38` → `HUELLA`
   - `currentVerifyMode == "card"` o `minor == 1` → `TARJETA`
   - `currentVerifyMode == "pw"` o `minor == 8` → `PIN`

4. **Timestamp (`time` / `dateTime`)**:
   - Viene en formato ISO 8601 con zona horaria (ej: `2026-11-14T08:01:23-08:00`).
   - Se desglosa en `ts_dispositivo_local` (`2026-11-14 08:01:23`) y `ts_utc` (`2026-11-14T16:01:23Z`).

---

## 2. ZKTeco (SDK Standalone, Live Capture, ADMS & Exportaciones)

Estructura en `docs/fixtures/zkteco/`:

| Archivo | Origen / Protocolo | Propósito |
|---|---|---|
| [`pyzk_attendance_records.json`](file:///Users/mac/dev/new-era/sm-clock/docs/fixtures/zkteco/pyzk_attendance_records.json) | Standalone SDK / `pyzk` (`get_attendance()`, puerto 4370) | Lote de checadas históricas recuperadas en la reconciliación cada 30 min. |
| [`zk_live_capture_event.json`](file:///Users/mac/dev/new-era/sm-clock/docs/fixtures/zkteco/zk_live_capture_event.json) | Live Capture socket (`EF_ATTLOG`) | Evento individual emitido en vivo en tiempo real por el socket ZK. |
| [`1_attlog.dat`](file:///Users/mac/dev/new-era/sm-clock/docs/fixtures/zkteco/1_attlog.dat) | Dump directo a memoria USB / ZK Firmware | Archivo de texto plano delimitado por tabuladores descargado vía USB en el reloj. |
| [`zktime_export_sample.csv`](file:///Users/mac/dev/new-era/sm-clock/docs/fixtures/zkteco/zktime_export_sample.csv) | Exportación ZKTime.Net / BioTime | Archivo CSV tabular generado desde el software oficial de ZKTeco. |
| [`adms_iclock_push_payload.txt`](file:///Users/mac/dev/new-era/sm-clock/docs/fixtures/zkteco/adms_iclock_push_payload.txt) | Protocolo ADMS (`POST /iclock/cdata`) | Payload enviado vía HTTP por terminales ZKTeco con función ADMS/Cloud activada. |

### Mapeo oficial ZKTeco → SM-Clock (`agent/src/agent/drivers/zkteco.py`)

1. **Código de Empleado**:
   - `user_id` / `PIN`: Identificador del usuario configurado en el reloj (string numérico o alfanumérico).

2. **Tipo de Marca (`TipoMarca`)**:
   - `punch_code == 0` (Check-In) → `ENTRADA`
   - `punch_code == 1` (Check-Out) → `SALIDA`
   - `punch_code == 2` (Break-Out) → `SALIDA`
   - `punch_code == 3` (Break-In) → `ENTRADA`
   - `punch_code == 4` (Overtime-In) → `ENTRADA`
   - `punch_code == 5` (Overtime-Out) → `SALIDA`
   - Sin código o desconocido → `CHECADA`

3. **Tipo de Verificación (`TipoVerificacion`)**:
   - `status_code == 0` → `PIN` (Contraseña)
   - `status_code == 1` → `HUELLA` (Fingerprint)
   - `status_code == 2` → `TARJETA` (RFID / Badge)
   - `status_code == 15` → `ROSTRO` (Face recognition)

4. **Timestamp (`timestamp_local`)**:
   - El reloj entrega la fecha/hora local del dispositivo sin zona horaria (ej: `2026-11-14 08:01:23`).
   - El agente local la resuelve a UTC mediante `resolve_device_timestamp()` considerando la zona horaria del tenant (`America/Tijuana`) y resolviendo ambigüedades en cambios de horario de verano.

---

## 3. TA.Cloud (API OAuth2, Exportaciones Genéricas & Incidencias)

Estructura en `docs/fixtures/tacloud/`:

| Archivo | Origen / Protocolo | Propósito |
|---|---|---|
| [`oauth_token_response.json`](file:///Users/mac/dev/new-era/sm-clock/docs/fixtures/tacloud/oauth_token_response.json) | `POST /token` | Autenticación OAuth2 (Resource Owner Password Credentials) que devuelve el Bearer JWT para consumir la API de TA.Cloud. |
| [`exportacion_generica_15col.csv`](file:///Users/mac/dev/new-era/sm-clock/docs/fixtures/tacloud/exportacion_generica_15col.csv) | `POST /api/exportaciones/generico/2` | Archivo CSV de 15 columnas que exporta TA.Cloud con checadas e incidencias ya pre-calculadas. |
| [`punchlogs_response.json`](file:///Users/mac/dev/new-era/sm-clock/docs/fixtures/tacloud/punchlogs_response.json) | `GET /api/v1/punchlogs` | Endpoint REST para sincronización Cloud-to-Cloud de checadas en formato JSON. |

### Las 15 Columnas de la Exportación Genérica de TA.Cloud

1. `NumeroEmpleado`: Código de nómina o ID del trabajador (`codigo_empleado`).
2. `NombreCompleto`: Nombre y apellidos del empleado.
3. `Fecha`: Fecha del evento (`YYYY-MM-DD`).
4. `Hora`: Hora del evento (`HH:MM:SS`).
5. `TipoChecada`: Texto (`Entrada`, `Salida`, `Sin Checada`).
6. `CodigoIncidencia`: Clave de incidencia procesada (`REG`, `RT`, `FALTA`, `RDS`, `HE2`, `HE3`, `SUSP`).
7. `MinutosRetardo`: Minutos calculados respecto a la hora oficial de entrada.
8. `HorasTrabajadas`: Duración de la jornada en horas decimales (ej. `8.00`).
9. `HorasExtra`: Horas suplementarias calculadas (ej. `2.00`).
10. `Dispositivo`: Nombre de la terminal física donde checó.
11. `NumeroSerie`: Número de serie del reloj biométrico.
12. `Departamento`: Área operativa en la empresa.
13. `Puesto`: Cargo del colaborador.
14. `Turno`: Nombre del horario/turno asignado en TA.Cloud.
15. `Estatus`: Estado de validación (`Aceptada`, `Justificada`, `Injustificada`).

### Mapeo de Incidencias TA.Cloud → SM-Clock / Nóminas

A diferencia de ZKTeco e Hikvision (que entregan marcas puras), TA.Cloud provee las incidencias calculadas directamente:

- **`REG` (Registro Regular)**: Checada a tiempo dentro de la tolerancia de entrada o jornada regular.
- **`RT` (Retardo)**: Checada posterior a la tolerancia. Genera incidencia de tipo `RETARDO` con `minutos_retardo`.
- **`FALTA`**: Sin checada de entrada en día laboral. Genera incidencia `FALTA_INJUSTIFICADA`.
- **`RDS` (Descanso Trabajado / Séptimo Día)**: Registro de asistencia en día de descanso semanal asignado.
- **`HE2` / `HE3`**: Horas extra dobles / triples para layouts de CONTPAQi / TRESS.



