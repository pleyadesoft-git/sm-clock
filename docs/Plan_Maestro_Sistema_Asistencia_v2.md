# Plan Maestro de Arquitectura, Desarrollo y Estrategia Comercial (v2.0)
**Plataforma SaaS Multi-Tenant de Control de Asistencia (ZKTeco / Hikvision / TA.Cloud)**  
**Integraciones de Nómina y RH: CONTPAQi Nóminas, Sistema TRESS y RH4000 API**  
**Ubicación Base:** Tijuana, Baja California, México  

---

## 1. Tabla de Precios Actualizada (MXN + IVA)

Esta estructura comercial mantiene tarifas competitivas para el mercado fronterizo de Tijuana y Baja California, delimitando el número de relojes incluidos, la modalidad de instalación y el tipo de conector hacia sistemas de nómina y recursos humanos.

| Plan / Capacidad de Empleados | Relojes / Fuentes Incluidas | Implementación Única (Remota) | Mensualidad SaaS | Reloj / Fuente Adicional (Mensual) | Conector SQL Directo o API RH4000 (Pago Único) |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Micro (1 – 10)** | 1 reloj / fuente | $1,990.00 | $349.00 | +$150.00 | +$990.00 |
| **Básico (11 – 25)** | 1 reloj / fuente | $2,990.00 | $549.00 | +$150.00 | +$1,490.00 |
| **PyME (26 – 50)** | 1 reloj / fuente | $4,490.00 | $849.00 | +$150.00 | +$1,990.00 |
| **Crecimiento (51 – 100)** | 2 relojes / fuentes | $6,990.00 | $1,390.00 | +$200.00 | +$2,490.00 |
| **Empresarial (101 – 250)** | 2 relojes / fuentes | $10,990.00 | $2,690.00 | +$200.00 | +$3,490.00 |
| **Corporativo (251 – 500)** | 4 relojes / fuentes | $17,990.00 | $4,490.00 | +$250.00 | +$4,990.00 |
| **Planta / Maquila (501 – 1,000)** | 6 relojes / fuentes | Desde $29,990.00 | Desde $7,490.00 | +$250.00 | Incluido |
| **Gran Industria (1,001 – 2,500)** | 10 relojes / fuentes | Desde $49,990.00 | Desde $12,990.00 | +$250.00 | Incluido |
| **Enterprise (+2,500)** | Ilimitados | Cotización especial | Cotización especial | A medida | Incluido |

### Condiciones Comerciales y Cargos Adicionales (Tijuana, B.C.)
* **Moneda e Impuestos:** Todos los precios están expresados en **Pesos Mexicanos (MXN) más IVA (16%)**. Para empresas maquiladoras (IMMEX) que requieran facturación en dólares (USD), se tomará el tipo de cambio oficial del DOF del día de facturación.
* **Qué incluye la Implementación Única (Remota):** Alta de empresa en la nube, configuración del Agente Local Python vía acceso remoto (AnyDesk/TeamViewer) o vinculación de API TA.Cloud, enlace de relojes incluidos, carga inicial de catálogo de empleados, configuración de hasta 3 horarios/turnos y entrega de Layouts TXT/CSV para **CONTPAQi Nóminas** o **Sistema TRESS**.
* **Visita Técnica en Sitio (Tijuana):** Si el cliente solicita instalación física en planta/oficina (parques industriales Otay, Pacífico, Florido, Insurgentes, etc.), se cobra un cargo de **$1,800.00 MXN + IVA** por visita (incluye hasta 3 horas de ingeniero en sitio; no incluye cableado estructurado ni hardware).
* **Descuento por Pago Anual:** 10% de descuento en la mensualidad al contratar 12 meses por adelantado.

---

## 2. Arquitectura Técnica Híbrida (Nube + Agente Local)

```text
+-------------------------------------------------------------------+
|                     NUBE (VPS + SUPABASE)                         |
|  - Base de Datos PostgreSQL Multi-Tenant (RLS por tenant_id)      |
|  - API REST Segura (JWT para Web / API_KEY para Agentes)          |
|  - Conector Cloud-to-Cloud: TA.Cloud API (OAuth2) & RH4000 API    |
|  - Panel Web Clientes (Filtros, Reportes XLSX/CSV/PDF, Layouts)   |
|  - Panel Super-Admin (Facturación, Planes, Salud de Agentes)      |
+---------------------------------+---------------------------------+
                                  ^
                                  | HTTPS (TLS 1.3) - Cada 30 min
                                  v
+-------------------------------------------------------------------+
|               RED LOCAL DEL CLIENTE (AGENTE PYTHON)               |
|  - Ejecutable compilado (.exe) corriendo como Servicio Windows    |
|  - SQLite local (tenant_code, api_key, auth offline, cola retry)  |
|  - UI Web Local (http://localhost:8085) con Login Técnico/Admin   |
|  - Drivers Hardware: pyzk (ZKTeco 4370) + ISAPI (Hikvision)       |
|  - Conectores Destino: Layouts TXT/CSV, SQL CONTPAQi, API RH4000  |
+----------------+---------------------------------+----------------+
                 |                                 |
                 v                                 v
      [Relojes ZKTeco / Hikvision]     [CONTPAQi / TRESS / RH4000]
```

---

## 3. Plan de Desarrollo e Implementación por Fases

### Fase 1: Infraestructura Cloud y Base de Datos Multi-Tenant (Semana 1)
1. **Despliegue en Supabase (PostgreSQL):**
   * Ejecución del archivo `schema.sql` con soporte para múltiples empresas (`tenants`), datos fiscales CFDI 4.0, planes comerciales, parametrización multi-origen (**ZKTeco**, **Hikvision**, **TA.Cloud**) y multi-destino (**CONTPAQi Nóminas**, **Sistema TRESS**, **RH4000 API**).
   * Implementación de **Row Level Security (RLS)** por `tenant_id` y configuración de zona horaria fronteriza `America/Tijuana`.
2. **Control de Límites por Plan:**
   * Validaciones en base de datos para controlar `plan_empleados_max` y `limite_relojes`.

### Fase 2: Backend API en VPS, Reportes y Conectores Cloud (Semana 2)
1. **Endpoints para Agente Local:**
   * `POST /api/v1/agente/auth`: Valida credenciales de `TECNICO_LOCAL` o `SUPER_ADMIN`.
   * `GET /api/v1/agente/config`: Entrega la parametrización completa de la empresa (relojes, credenciales SQL de CONTPAQi, endpoints de RH4000, rutas de layouts).
   * `POST /api/v1/agente/sync-empleados` y `POST /api/v1/agente/sync-checadas`: Recepción masiva idempotente (`UPSERT`) con control de duplicados.
2. **Conectores Cloud-to-Cloud:**
   * **Origen TA.Cloud:** Autenticación OAuth2 (`/token`) y descarga automática vía `POST /api/exportaciones/generico/2` (CSV de 15 columnas con checadas e incidencias `REG`, `FALTA`, `RT`, `RDS`).
   * **Destino RH4000 API:** Envío automático de entradas (`accessType: "1"`) y salidas (`accessType: "2"`) hacia `https://{cliente}.rh4000.com/api/v1/Employees/{codigo}/Attendance` con `Bearer Token`, registrando bitácora de respuesta por cada movimiento.
3. **Motor de Reportes Web (XLSX, CSV y PDF):**
   * Consulta multi-filtro (rango de fechas, empleado, departamento, sucursal/reloj, origen, estatus de envío a nómina/RH4000).
   * Generación de archivos descargables en **Excel (.xlsx)**, **CSV** y **PDF** membretado con razón social y logotipo del cliente.

### Fase 3: Agente Local en Python + UI de Diagnóstico (Semanas 3 y 4)
1. **Core y Base de Datos Local (`SQLite`):**
   * Almacenamiento de `tenant_code`, `api_key`, caché de credenciales cifradas para acceso offline y cola de reintentos (`sincronizado = 0/1`).
   * Scheduler interno (`APScheduler`) ejecutando checadas cada **30 minutos** y catálogo de empleados **2 veces al día** (07:05 y 14:05 hrs).
2. **Drivers de Hardware y APIs:**
   * **ZKTeco (`pyzk`):** Lectura TCP/UDP puerto `4370`.
   * **Hikvision (`ISAPI`):** Consultas HTTP Digest Auth a `/ISAPI/AccessControl/UserInfo/Search` y `/ISAPI/AccessControl/AcsEvent`.
   * **TA.Cloud (`OAuth2 + CSV`):** Lectura directa de exportaciones genéricas.
3. **Interfaz Web Local (`http://localhost:8085` con FastAPI):**
   * **Login Técnico / Super-Admin:** Autenticación contra VPS con respaldo local en SQLite.
   * **Panel de Pruebas de Conexión:** Botones para probar **Relojes ZKTeco/Hikvision**, **API TA.Cloud**, **Base de Datos SQL Server (CONTPAQi)** y **API RH4000**.
   * **Visor y Descarga de Layouts de Ejemplo:** Genera muestras reales y descargables para **CONTPAQi Nóminas** (`.txt`) y **Sistema TRESS** (`.txt` / `.csv`).
4. **Empaquetado:**
   * Compilación a binario `.exe` protegido (con **Nuitka** o **PyInstaller**) e instalación como Servicio de Windows mediante **NSSM**.

### Fase 4: Panel Web Multi-Tenant y Piloto Comercial (Semana 5)
1. **Portal del Cliente:** Parametrización de dispositivos, consulta de movimientos con filtros, descarga de reportes (**XLSX, CSV, PDF**), generación de layouts (**CONTPAQi / TRESS**) y monitoreo de envíos a **RH4000**.
2. **Portal Super-Admin:** Gestión de tenants, datos fiscales CFDI 4.0, planes, monitoreo de última conexión de cada agente y suspensión automática por falta de pago.

---

## 4. Formatos de Salida Soportados (CONTPAQi, TRESS y RH4000)

1. **CONTPAQi Nóminas (Layout TXT `MovimientosDyHporperiodo.cfg`):**
   ```text
   CodigoEmpleado,Fecha(YYYYMMDD),ClaveIncidencia,Cantidad
   0015,20261112,RET,1.00
   0015,20261112,HE2,2.50
   ```
2. **Sistema TRESS (Layout TXT/CSV de Checadas o Prenómina):**
   ```text
   NoEmpleado,Fecha(DD/MM/YYYY),Hora(HH:MM:SS),Terminal
   1042,12/11/2026,07:58:12,01
   ```
3. **RH4000 API REST (`POST https://{cliente}.rh4000.com/api/v1/Employees/{codigo}/Attendance`):**
   ```json
   {
     "companyCode": "001",
     "employeeCode": "1042",
     "accessPointCode": "001",
     "eventDate": "2026-11-12T07:58:12",
     "accessType": "1",
     "maskFlag": "2",
     "temperature": ""
   }
   ```
