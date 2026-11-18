from __future__ import annotations

from pathlib import Path
import uuid
from datetime import datetime, timezone
from typing import Any, Sequence

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import HTMLResponse, PlainTextResponse

from .. import __version__
from ..config import protect_secret, unprotect_secret
from ..db import AgentLocalDatabase, LocalClockRecord, QueuedPunch
from ..drivers.base import BaseClockDriver
from ..drivers.network import probe_device_connection
from ..log_manager import GLOBAL_LOG_HANDLER
from ..sync import CloudSyncClient, enroll_agent_with_code, verify_technician_credentials
from ..targets.layouts import CONTPAQiLayoutGenerator, ContpaqiMovimiento, TRESSLayoutGenerator

LOCAL_DIAGNOSTIC_HOST = "127.0.0.1"
LOCAL_DIAGNOSTIC_PORT = 8085


def get_diagnostic_status(
    db: AgentLocalDatabase,
    *,
    agente_id: str | None = None,
    tz_name: str = "America/Tijuana",
    drivers: Sequence[BaseClockDriver] | None = None,
    sync_client: CloudSyncClient | None = None,
) -> dict[str, object]:
    """
    Genera el estado de diagnóstico local servido exclusivamente en 127.0.0.1:8085.
    """
    driver_statuses = [d.get_status() for d in (drivers or [])]
    local_clocks = db.list_fuentes_locales()

    return {
        "bind": f"{LOCAL_DIAGNOSTIC_HOST}:{LOCAL_DIAGNOSTIC_PORT}",
        "version": __version__,
        "agente_id": agente_id or db.get_config("agente_id"),
        "tenant_id": db.get_config("tenant_id"),
        "server_url": sync_client.server_url if sync_client else "http://127.0.0.1:3000",
        "zona_horaria": tz_name,
        "sqlite_journal_mode": db.get_journal_mode(),
        "cola_pendiente": db.count_pending(),
        "cola_total": db.count_total(),
        "ts_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "ultimo_latido_ts": sync_client.ultimo_latido_ts if sync_client else None,
        "desvio_reloj_segundos": sync_client.ultimo_drift_segundos if sync_client else 0.0,
        "alerta_desvio_reloj": sync_client.alerta_desvio_reloj if sync_client else False,
        "fuentes_activas_memoria": driver_statuses,
        "relojes_locales_count": len(local_clocks),
    }


def create_diagnostic_app(
    db: AgentLocalDatabase,
    sync_client: CloudSyncClient | None = None,
    drivers: Sequence[BaseClockDriver] | None = None,
    tz_name: str = "America/Tijuana",
) -> FastAPI:
    app = FastAPI(
        title="SM-Clock Agente Local — Diagnóstico",
        version=__version__,
        docs_url="/docs",
        redoc_url=None,
    )

    drivers_list = list(drivers or [])

    @app.middleware("http")
    async def enforce_localhost(request: Request, call_next: Any) -> Response:
        client_host = request.client.host if request.client else ""
        if client_host not in ("127.0.0.1", "::1", "localhost", "testclient"):
            return Response("Acceso prohibido: La UI de diagnóstico solo está disponible en 127.0.0.1", status_code=403)
        return await call_next(request)

    @app.get("/favicon.ico", include_in_schema=False)
    def api_favicon() -> Response:
        icon_path = Path(__file__).parent / "icon.ico"
        if not icon_path.exists():
            icon_path = Path("icon.ico")
        if icon_path.exists():
            return Response(content=icon_path.read_bytes(), media_type="image/x-icon")
        return Response(status_code=404)

    def get_current_session(request: Request) -> dict[str, Any] | None:
        token = request.cookies.get("sm_agent_session")
        if not token:
            auth_header = request.headers.get("Authorization", "")
            if auth_header.startswith("Bearer "):
                token = auth_header[7:].strip()
        if not token:
            return None
        return db.get_auth_session(token)

    def require_admin_auth(request: Request) -> dict[str, Any]:
        session = get_current_session(request)
        if not session:
            raise HTTPException(
                status_code=401,
                detail="Se requiere iniciar sesión con credenciales de Super-Admin o Admin del Tenant",
            )
        return session

    # --- Endpoints de Autenticación de Administrador ---

    @app.post("/api/auth/login")
    def api_auth_login(payload: dict[str, Any], response: Response) -> dict[str, Any]:
        pin_emergencia = str(payload.get("pin_emergencia") or "").strip()
        if pin_emergencia:
            stored_pin = db.get_emergency_pin()
            if pin_emergencia != stored_pin:
                raise HTTPException(status_code=401, detail="PIN de emergencia inválido")

            token = db.create_auth_session(
                email="admin_local@smclock.local",
                nombre="Administrador Local (Offline)",
                rol="SUPER_ADMIN",
                tenant_id=db.get_config("tenant_id"),
            )
            response.set_cookie(
                key="sm_agent_session",
                value=token,
                httponly=True,
                samesite="lax",
                max_age=12 * 3600,
            )
            return {
                "ok": True,
                "token": token,
                "usuario": {
                    "email": "admin_local@smclock.local",
                    "nombre_completo": "Administrador Local (Offline)",
                    "rol": "SUPER_ADMIN",
                },
            }

        email = str(payload.get("email") or "").strip()
        password = str(payload.get("password") or "")
        srv_url = str(payload.get("server_url") or (sync_client.server_url if sync_client else "http://127.0.0.1:3000"))

        if not email or not password:
            raise HTTPException(status_code=400, detail="Ingresa correo y contraseña, o un PIN de emergencia")

        agente_id = db.get_config("agente_id")
        transport_func = sync_client.transport_post if sync_client else None
        ok, msg, user_data = verify_technician_credentials(
            email=email,
            password=password,
            server_url=srv_url,
            agente_id=agente_id,
            transport_post=transport_func,
        )

        if not ok or not user_data:
            raise HTTPException(status_code=401, detail=msg or "Credenciales inválidas")

        token = db.create_auth_session(
            email=user_data.get("email", email),
            nombre=user_data.get("nombre_completo", "Administrador"),
            rol=user_data.get("rol", "ADMIN_EMPRESA"),
            tenant_id=user_data.get("tenant_id"),
        )
        response.set_cookie(
            key="sm_agent_session",
            value=token,
            httponly=True,
            samesite="lax",
            max_age=12 * 3600,
        )
        return {"ok": True, "token": token, "usuario": user_data}

    @app.get("/api/auth/me")
    def api_auth_me(request: Request) -> dict[str, Any]:
        sess = get_current_session(request)
        if not sess:
            return {"authenticated": False, "usuario": None}
        return {"authenticated": True, "usuario": sess}

    @app.post("/api/auth/logout")
    def api_auth_logout(request: Request, response: Response) -> dict[str, Any]:
        token = request.cookies.get("sm_agent_session")
        if token:
            db.delete_auth_session(token)
        response.delete_cookie("sm_agent_session")
        return {"ok": True, "mensaje": "Sesión cerrada"}

    # --- Endpoints de Estado y Diagnóstico General ---

    @app.get("/api/status")
    def api_status(request: Request) -> dict[str, object]:
        status = get_diagnostic_status(db, tz_name=tz_name, drivers=drivers_list, sync_client=sync_client)
        session = get_current_session(request)
        status["session"] = session
        return status

    @app.get("/api/queue")
    def api_queue(limit: int = 50) -> dict[str, object]:
        recent = db.get_recent_punches(limit=limit)
        return {
            "pendientes_count": db.count_pending(),
            "total_count": db.count_total(),
            "checadas": [
                {
                    "id": p.id,
                    "fuente_id": p.fuente_id,
                    "codigo_empleado": p.codigo_empleado,
                    "ts_utc": p.ts_utc,
                    "ts_dispositivo_local": p.ts_dispositivo_local,
                    "ambigua": p.ambigua,
                    "tipo_marca": p.tipo_marca,
                    "tipo_verificacion": p.tipo_verificacion,
                    "sincronizado": p.sincronizado,
                }
                for p in recent
            ],
        }

    # --- Endpoints de Logs y Diagnóstico en Vivo ---

    @app.get("/api/logs")
    def api_get_logs(level: str | None = None, search: str | None = None, limit: int = 100) -> dict[str, Any]:
        logs = GLOBAL_LOG_HANDLER.get_logs(level=level, search=search, limit=min(limit, 500))
        counts = GLOBAL_LOG_HANDLER.get_counts()
        return {
            "ok": True,
            "counts": counts,
            "logs": logs,
        }

    @app.post("/api/logs/clear")
    def api_clear_logs(request: Request) -> dict[str, Any]:
        require_admin_auth(request)
        GLOBAL_LOG_HANDLER.clear()
        return {"ok": True, "mensaje": "Logs limpiados correctamente"}

    # --- Endpoints de Relojes Locales ---

    @app.get("/api/relojes")
    def api_list_relojes() -> list[dict[str, Any]]:
        clocks = db.list_fuentes_locales()
        return [
            {
                "id": c.id,
                "nombre": c.nombre,
                "tipo": c.tipo,
                "ip": c.ip,
                "puerto": c.puerto,
                "comm_key": c.comm_key,
                "usuario": c.usuario,
                "has_password": bool(c.password_cifrada),
                "activo": c.activo,
                "ultimo_ping": c.ultimo_ping,
                "ultimo_error": c.ultimo_error,
                "created_at": c.created_at,
                "updated_at": c.updated_at,
            }
            for c in clocks
        ]

    @app.post("/api/relojes")
    def api_upsert_reloj(payload: dict[str, Any], request: Request) -> dict[str, Any]:
        require_admin_auth(request)
        nombre = str(payload.get("nombre", "")).strip()
        tipo = str(payload.get("tipo", "ZKTECO")).strip().upper()
        ip = str(payload.get("ip", "127.0.0.1")).strip()
        puerto = int(payload.get("puerto", 4370 if tipo == "ZKTECO" else 80))
        comm_key = int(payload.get("comm_key", 0))
        usuario = payload.get("usuario")
        raw_password = payload.get("password")
        activo = bool(payload.get("activo", True))
        clock_id = str(payload.get("id") or uuid.uuid4()).strip()

        if not nombre:
            raise HTTPException(status_code=400, detail="El nombre del reloj es obligatorio")
        if tipo not in ("ZKTECO", "HIKVISION", "TACLOUD"):
            raise HTTPException(status_code=400, detail="Tipo de reloj inválido (ZKTECO, HIKVISION o TACLOUD)")

        password_cifrada = None
        if raw_password and str(raw_password).strip():
            password_cifrada = protect_secret(str(raw_password).strip())

        saved_id = db.upsert_fuente_local(
            clock_id=clock_id,
            nombre=nombre,
            tipo=tipo,
            ip=ip,
            puerto=puerto,
            comm_key=comm_key,
            usuario=str(usuario).strip() if usuario else None,
            password_cifrada=password_cifrada,
            activo=activo,
        )

        return {"ok": True, "id": saved_id, "mensaje": "Reloj guardado exitosamente"}

    @app.delete("/api/relojes/{clock_id}")
    def api_delete_reloj(clock_id: str, request: Request) -> dict[str, Any]:
        require_admin_auth(request)
        deleted = db.delete_fuente_local(clock_id)
        if not deleted:
            raise HTTPException(status_code=404, detail="Reloj no encontrado")
        return {"ok": True, "mensaje": "Reloj eliminado de la base local"}

    @app.post("/api/relojes/test")
    def api_test_reloj(payload: dict[str, Any]) -> dict[str, Any]:
        clock_id = payload.get("id")
        tipo = str(payload.get("tipo", "ZKTECO")).strip().upper()
        ip = str(payload.get("ip", "127.0.0.1")).strip()
        puerto = int(payload.get("puerto", 4370 if tipo == "ZKTECO" else 80))
        comm_key = int(payload.get("comm_key", 0))
        usuario = payload.get("usuario")
        password = payload.get("password")

        if clock_id:
            existing = db.get_fuente_local(clock_id)
            if existing:
                tipo = str(payload.get("tipo") or existing.tipo).strip().upper()
                ip = str(payload.get("ip") or existing.ip).strip()
                puerto = int(payload.get("puerto") or existing.puerto)
                comm_key = int(payload.get("comm_key") if payload.get("comm_key") is not None else existing.comm_key)
                usuario = payload.get("usuario") or existing.usuario
                if not password and existing.password_cifrada:
                    password = unprotect_secret(existing.password_cifrada)

        ok, msg, lat = probe_device_connection(
            tipo=tipo,
            ip=ip,
            puerto=puerto,
            usuario=str(usuario).strip() if usuario else None,
            password=str(password).strip() if password else None,
            comm_key=comm_key,
            timeout=3.0,
        )

        if clock_id:
            db.update_fuente_ping_status(clock_id, ok=ok, error=None if ok else msg)

        return {"ok": ok, "mensaje": msg, "latencia_ms": lat}

    # --- Endpoints de Diagnóstico de la Nube ---

    @app.post("/api/cloud-test/latido")
    def api_cloud_test_latido(request: Request) -> dict[str, Any]:
        require_admin_auth(request)
        if not sync_client:
            raise HTTPException(status_code=400, detail="Cliente de nube no configurado (agente sin credenciales)")
        return sync_client.test_endpoint_latido(version=__version__)

    @app.post("/api/cloud-test/checadas")
    def api_cloud_test_checadas(request: Request) -> dict[str, Any]:
        require_admin_auth(request)
        if not sync_client:
            raise HTTPException(status_code=400, detail="Cliente de nube no configurado (agente sin credenciales)")
        return sync_client.test_endpoint_checadas()

    @app.post("/api/cloud-test/empleados")
    def api_cloud_test_empleados(request: Request) -> dict[str, Any]:
        require_admin_auth(request)
        if not sync_client:
            raise HTTPException(status_code=400, detail="Cliente de nube no configurado (agente sin credenciales)")
        return sync_client.test_endpoint_empleados()

    @app.post("/api/alertas/reportar")
    async def api_alertas_reportar(request: Request) -> dict[str, Any]:
        require_admin_auth(request)
        if not sync_client:
            raise HTTPException(status_code=400, detail="Cliente de nube no configurado (agente sin credenciales)")
        try:
            payload = await request.json()
        except Exception:
            payload = {}
        tipo_error = str(payload.get("tipo_error") or "PRUEBA_MANUAL_ADMIN")
        mensaje = str(payload.get("mensaje") or "Prueba de alerta disparada manualmente desde el agente local")
        detalle = payload.get("detalle")
        dispositivo = payload.get("dispositivo")
        fuente_id = payload.get("fuente_id")
        force = bool(payload.get("force", True))
        ok = sync_client.report_error(
            tipo_error=tipo_error,
            mensaje=mensaje,
            detalle=detalle,
            fuente_id=fuente_id,
            dispositivo=dispositivo,
            force=force,
        )
        return {
            "ok": ok,
            "mensaje": "Alerta enviada correctamente a la nube para notificación por correo" if ok else "No se pudo enviar la alerta o se encuentra en enfriamiento",
        }

    # --- Acciones Generales y Layouts ---

    @app.post("/api/sync-now")
    def api_sync_now(request: Request) -> dict[str, object]:
        require_admin_auth(request)
        if not sync_client:
            raise HTTPException(status_code=400, detail="Cliente de sincronización con la nube no configurado")
        synced = sync_client.flush_pending_batch()
        return {
            "ok": True,
            "checadas_sincronizadas": synced,
            "pendientes_restantes": db.count_pending(),
        }

    @app.post("/api/reconcile-now")
    def api_reconcile_now(request: Request) -> dict[str, object]:
        require_admin_auth(request)
        results = {}
        for d in drivers_list:
            try:
                results[d.fuente_id] = d.reconcile_missing_punches()
            except Exception as exc:
                results[d.fuente_id] = f"Error: {exc}"
        return {"ok": True, "reconciliacion": results, "pendientes": db.count_pending()}

    @app.post("/api/test-connection")
    def api_test_connection(payload: dict[str, Any]) -> dict[str, object]:
        fuente_id = payload.get("fuente_id")
        driver = next((d for d in drivers_list if d.fuente_id == fuente_id), None)
        if not driver:
            if not drivers_list:
                return {"ok": False, "mensaje": "No hay relojes configurados"}
            driver = drivers_list[0]
        ok, msg = driver.test_connection()
        return {"ok": ok, "mensaje": msg, "fuente_id": driver.fuente_id}

    @app.get("/api/layouts/contpaqi")
    def api_download_contpaqi() -> PlainTextResponse:
        recent = db.get_recent_punches(limit=100)
        movimientos = [
            ContpaqiMovimiento(
                codigo_empleado=p.codigo_empleado,
                fecha=p.ts_dispositivo_local.split(" ")[0] if " " in p.ts_dispositivo_local else p.ts_dispositivo_local,
                clave_incidencia="REG" if p.tipo_marca == "ENTRADA" else "SALIDA",
                cantidad=1.0,
            )
            for p in recent
        ]
        gen = CONTPAQiLayoutGenerator()
        content = gen.render(movimientos)
        return PlainTextResponse(
            content,
            headers={"Content-Disposition": "attachment; filename=MovimientosDyHporperiodo.cfg"},
        )

    @app.get("/api/layouts/tress")
    def api_download_tress() -> PlainTextResponse:
        recent = db.get_recent_punches(limit=100)
        gen = TRESSLayoutGenerator()
        content = gen.render(recent)
        return PlainTextResponse(
            content,
            headers={"Content-Disposition": "attachment; filename=tress_checadas.txt"},
        )

    @app.post("/api/enroll")
    def api_enroll(payload: dict[str, Any], request: Request, response: Response) -> dict[str, object]:
        current_agent = db.get_config("agente_id")
        if current_agent:
            require_admin_auth(request)

        code = str(payload.get("codigo_enrolamiento") or "").strip()
        agent_name = str(payload.get("nombre_agente") or "Agente Local").strip()
        srv_url = str(payload.get("server_url") or db.get_config("server_url") or "http://127.0.0.1:3000").strip()
        if not code:
            raise HTTPException(status_code=400, detail="Código de enrolamiento obligatorio")

        result = enroll_agent_with_code(
            codigo_enrolamiento=code,
            nombre_agente=agent_name,
            server_url=srv_url,
        )
        if not result:
            raise HTTPException(status_code=400, detail="No se pudo enrolar el agente. Verifica el código y la conectividad.")

        db.set_config("agente_id", str(result["agente_id"]))
        db.set_config("credencial_token", str(result["credencial_token"]))
        db.set_config("tenant_id", str(result.get("tenant_id", "")))
        db.set_config("server_url", srv_url)
        if "zona_horaria" in result:
            db.set_config("zona_horaria", str(result["zona_horaria"]))

        if sync_client:
            sync_client.agente_id = str(result["agente_id"])
            sync_client.credencial_token = str(result["credencial_token"])
            sync_client.server_url = srv_url.rstrip("/")

        # Iniciar sesión de admin local automáticamente tras enrolar
        session_token = db.create_auth_session(
            email="admin_local@smclock.local",
            nombre=agent_name,
            rol="SUPER_ADMIN",
            tenant_id=result.get("tenant_id"),
        )
        response.set_cookie(
            key="sm_agent_session",
            value=session_token,
            httponly=True,
            samesite="lax",
            max_age=12 * 3600,
        )

        return {"ok": True, "agente_id": result["agente_id"], "tenant_id": result.get("tenant_id")}

    @app.get("/", response_class=HTMLResponse)
    def index_dashboard() -> str:
        status = get_diagnostic_status(db, tz_name=tz_name, drivers=drivers_list, sync_client=sync_client)
        pending = db.count_pending()
        total = db.count_total()
        journal = db.get_journal_mode()
        agente_id = status["agente_id"] or "Sin enrolar"
        tenant_id = status["tenant_id"] or "N/A"
        server_url = status["server_url"]

        html = f"""<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>SM-Clock Agente Local (127.0.0.1:8085)</title>
  <link rel="icon" type="image/x-icon" href="/favicon.ico">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    :root {{
      --bg: #0b0f19;
      --card: #151b2b;
      --card-hover: #1c2438;
      --border: #222d42;
      --text: #f1f5f9;
      --text-muted: #94a3b8;
      --primary: #3b82f6;
      --primary-hover: #2563eb;
      --success: #10b981;
      --warning: #f59e0b;
      --danger: #ef4444;
      --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      padding: 24px;
      background: var(--bg);
      color: var(--text);
      font-family: var(--font);
      -webkit-font-smoothing: antialiased;
    }}
    .container {{
      max-width: 980px;
      margin: 0 auto;
    }}
    .header {{
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--border);
    }}
    .title {{
      font-size: 20px;
      font-weight: 700;
      letter-spacing: -0.5px;
    }}
    .badge {{
      display: inline-block;
      padding: 4px 10px;
      border-radius: 9999px;
      font-size: 12px;
      font-weight: 600;
      background: #1e293b;
      color: #94a3b8;
    }}
    .badge.ok {{ background: rgba(16, 185, 129, 0.15); color: var(--success); border: 1px solid rgba(16, 185, 129, 0.3); }}
    .badge.warn {{ background: rgba(245, 158, 11, 0.15); color: var(--warning); border: 1px solid rgba(245, 158, 11, 0.3); }}
    .badge.danger {{ background: rgba(239, 68, 68, 0.15); color: var(--danger); border: 1px solid rgba(239, 68, 68, 0.3); }}

    /* Tabs */
    .tabs {{
      display: flex;
      gap: 8px;
      background: #0f1422;
      padding: 6px;
      border-radius: 10px;
      border: 1px solid var(--border);
      margin-bottom: 24px;
    }}
    .tab-btn {{
      flex: 1;
      padding: 10px 16px;
      border-radius: 8px;
      border: none;
      background: transparent;
      color: var(--text-muted);
      font-weight: 600;
      font-size: 14px;
      cursor: pointer;
      transition: all 0.15s ease;
      text-align: center;
    }}
    .tab-btn.active {{
      background: var(--card);
      color: var(--text);
      box-shadow: 0 2px 8px rgba(0,0,0,0.4);
    }}

    .tab-content {{ display: none; }}
    .tab-content.active {{ display: block; }}

    .grid {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }}
    .card {{
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 18px;
    }}
    .card-label {{
      font-size: 12px;
      color: var(--text-muted);
      margin-bottom: 6px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }}
    .card-value {{
      font-size: 22px;
      font-weight: 700;
    }}

    .actions {{
      display: flex;
      gap: 10px;
      margin-bottom: 24px;
      flex-wrap: wrap;
    }}
    button, a.btn {{
      background: var(--primary);
      color: white;
      border: none;
      padding: 10px 18px;
      border-radius: 8px;
      font-weight: 600;
      cursor: pointer;
      text-decoration: none;
      font-size: 14px;
      transition: background 0.15s;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }}
    button:hover, a.btn:hover {{ background: var(--primary-hover); }}
    .btn-secondary {{ background: #334155; }}
    .btn-secondary:hover {{ background: #475569; }}
    .btn-success {{ background: #059669; }}
    .btn-success:hover {{ background: #10b981; }}
    .btn-danger {{ background: #dc2626; }}
    .btn-danger:hover {{ background: #ef4444; }}
    .btn-sm {{ padding: 6px 12px; font-size: 12px; border-radius: 6px; }}

    table {{
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }}
    th, td {{
      padding: 12px 14px;
      text-align: left;
      border-bottom: 1px solid var(--border);
    }}
    th {{ color: var(--text-muted); font-weight: 600; }}
    tr:last-child td {{ border-bottom: none; }}

    /* Formularios */
    .form-grid {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 14px;
      margin-bottom: 16px;
    }}
    .form-group {{
      display: flex;
      flex-direction: column;
      gap: 6px;
    }}
    .form-group label {{
      font-size: 12px;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
    }}
    .form-group input, .form-group select {{
      padding: 10px 12px;
      background: #0d121f;
      border: 1px solid var(--border);
      border-radius: 8px;
      color: var(--text);
      font-size: 14px;
      outline: none;
      font-family: inherit;
    }}
    .form-group input:focus, .form-group select:focus {{
      border-color: var(--primary);
    }}
    .alert-box {{
      padding: 12px 16px;
      border-radius: 8px;
      font-size: 13px;
      margin-bottom: 16px;
      display: none;
    }}
    .alert-box.ok {{ display: block; background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); }}
    .alert-box.err {{ display: block; background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); }}

    /* Modal iOS */
    .modal-overlay {{
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(4px);
      align-items: center;
      justify-content: center;
      z-index: 999;
    }}
    .modal-overlay.active {{ display: flex; }}
    .modal-card {{
      background: #151b2b;
      border: 1px solid var(--border);
      border-radius: 14px;
      width: 100%;
      max-width: 440px;
      padding: 24px;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
    }}
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div style="display: flex; align-items: center; gap: 14px;">
        <img src="/favicon.ico" alt="SM-Clock" style="width: 40px; height: 40px; border-radius: 9px; box-shadow: 0 4px 10px rgba(0,0,0,0.5); object-fit: contain; background: #000; padding: 2px; border: 1px solid var(--border);">
        <div>
          <div class="title">SM-Clock Agente Local (127.0.0.1:8085)</div>
          <div style="font-size: 13px; color: var(--text-muted); margin-top: 4px;">
            Tijuana, B.C. | Versión {__version__} | Agente: <code>{agente_id}</code>
          </div>
        </div>
      </div>
      <div style="display: flex; gap: 10px; align-items: center;">
        <span class="badge ok">127.0.0.1:8085 LOCALHOST</span>
        <div id="auth-status-container">
          <button class="btn btn-secondary btn-sm" onclick="openLoginModal()">🔒 Iniciar Sesión Admin</button>
        </div>
      </div>
    </div>

    <!-- Navegación por pestañas -->
    <div class="tabs">
      <button class="tab-btn active" onclick="switchTab('tab-resumen')">📊 Resumen y Cola</button>
      <button class="tab-btn" onclick="switchTab('tab-relojes')">⏰ Relojes y Terminales</button>
      <button class="tab-btn" onclick="switchTab('tab-cloud')">☁️ Diagnóstico Cloud & APIs</button>
      <button class="tab-btn" onclick="switchTab('tab-layouts')">📁 Layouts y Destinos</button>
    </div>

    <!-- Pestaña 1: Resumen y Cola -->
    <div id="tab-resumen" class="tab-content active">
      <div class="grid">
        <div class="card">
          <div class="card-label">Cola Pendiente</div>
          <div class="card-value" style="color: {'var(--warning)' if pending > 0 else 'var(--success)'};">{pending}</div>
        </div>
        <div class="card">
          <div class="card-label">Total Procesadas</div>
          <div class="card-value">{total}</div>
        </div>
        <div class="card">
          <div class="card-label">SQLite WAL Mode</div>
          <div class="card-value" style="font-size: 18px; text-transform: uppercase;">{journal}</div>
        </div>
        <div class="card">
          <div class="card-label">Zona Horaria</div>
          <div class="card-value" style="font-size: 16px;">{tz_name}</div>
        </div>
      </div>

      <div class="actions">
        <button onclick="triggerSync()">Sincronizar Lote Ahora</button>
        <button class="btn-secondary" onclick="triggerReconcile()">Reconciliar Relojes (30 min)</button>
        <a class="btn btn-secondary" href="/docs" target="_blank">Documentación API</a>
      </div>

      <div class="card">
        <div style="font-weight: 700; margin-bottom: 12px;">Últimas Checadas Capturadas en SQLite Local</div>
        <div id="queue-table">Cargando registros...</div>
      </div>
    </div>

    <!-- Pestaña 2: Relojes y Terminales -->
    <div id="tab-relojes" class="tab-content">
      <div class="card" style="margin-bottom: 24px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
          <div style="font-size: 16px; font-weight: 700;" id="form-clock-title">Configurar Nuevo Reloj Checador</div>
          <button class="btn-secondary btn-sm" id="btn-cancel-edit" style="display:none;" onclick="resetClockForm()">Cancelar Edición</button>
        </div>

        <div id="test-alert" class="alert-box"></div>

        <form id="clock-form" onsubmit="saveClock(event)">
          <input type="hidden" id="clock-id" value="">
          <div class="form-grid">
            <div class="form-group">
              <label>Nombre del Checador</label>
              <input type="text" id="clock-nombre" placeholder="Ej. Entrada Planta Otay" required>
            </div>
            <div class="form-group">
              <label>Marca / Protocolo</label>
              <select id="clock-tipo" onchange="onTipoChange()">
                <option value="ZKTECO">ZKTeco (Standalone TCP 4370)</option>
                <option value="HIKVISION">Hikvision (ISAPI HTTP/HTTPS)</option>
                <option value="TACLOUD">TA.Cloud (OAuth2 Cloud)</option>
              </select>
            </div>
            <div class="form-group">
              <label>Dirección IP o Host</label>
              <input type="text" id="clock-ip" placeholder="192.168.1.100" required>
            </div>
            <div class="form-group">
              <label>Puerto de Red</label>
              <input type="number" id="clock-puerto" value="4370" required>
            </div>
          </div>

          <div class="form-grid" id="auth-fields">
            <div class="form-group" id="group-commkey">
              <label>CommKey (ZKTeco)</label>
              <input type="number" id="clock-commkey" value="0">
            </div>
            <div class="form-group" id="group-usuario" style="display:none;">
              <label>Usuario (Hikvision / API)</label>
              <input type="text" id="clock-usuario" placeholder="admin">
            </div>
            <div class="form-group" id="group-password" style="display:none;">
              <label>Contraseña (Cifrada con DPAPI)</label>
              <input type="password" id="clock-password" placeholder="••••••••">
            </div>
          </div>

          <div class="actions" style="margin-bottom: 0;">
            <button type="button" class="btn-secondary" onclick="testCurrentFormConnection()">⚡ Probar Conexión en Vivo</button>
            <button type="submit" class="btn-success">💾 Guardar Reloj en SQLite</button>
          </div>
        </form>
      </div>

      <div class="card">
        <div style="font-weight: 700; margin-bottom: 12px;">Relojes Configurados en este Agente Local</div>
        <div id="clocks-table">Cargando lista de relojes...</div>
      </div>
    </div>

    <!-- Pestaña 3: Diagnóstico Cloud & APIs (Nube) -->
    <div id="tab-cloud" class="tab-content">
      <div class="grid" style="margin-bottom: 24px;">
        <div class="card">
          <div class="card-label">Servidor Central</div>
          <div class="card-value" style="font-size: 15px; font-family: monospace;">{server_url}</div>
        </div>
        <div class="card">
          <div class="card-label">Tenant ID</div>
          <div class="card-value" style="font-size: 14px; font-family: monospace;">{tenant_id}</div>
        </div>
        <div class="card">
          <div class="card-label">Estado de Enrolamiento</div>
          <div class="card-value" style="font-size: 15px;">
            {'<span class="badge ok">ENROLADO</span>' if agente_id != "Sin enrolar" else '<span class="badge warn">SIN ENROLAR</span>'}
          </div>
        </div>
      </div>

      <div class="card" style="margin-bottom: 20px;">
        <div style="font-weight: 700; font-size: 16px; margin-bottom: 8px;">1. Probador de Latido (/api/v1/agente/latido)</div>
        <div style="color: var(--text-muted); font-size: 13px; margin-bottom: 14px;">
          Envía el latido del agente, evalúa el desvío del reloj local respecto al servidor UTC (>120s alerta) y confirma comunicación bidireccional.
        </div>
        <div class="actions" style="margin-bottom: 10px;">
          <button onclick="testCloudLatido()">⚡ Probar Latido</button>
        </div>
        <div id="diag-latido-result" style="display:none; font-size: 13px;"></div>
      </div>

      <div class="card" style="margin-bottom: 20px;">
        <div style="font-weight: 700; font-size: 16px; margin-bottom: 8px;">2. Probador de Ingesta y Firma HMAC (/api/v1/agente/checadas)</div>
        <div style="color: var(--text-muted); font-size: 13px; margin-bottom: 14px;">
          Envía una checada diagnóstica de prueba firmada con HMAC-SHA256 usando el token secreto local para validar el pipeline de ingesta en la nube.
        </div>
        <div class="actions" style="margin-bottom: 10px;">
          <button onclick="testCloudChecadas()">📤 Probar Ingesta HMAC</button>
        </div>
        <div id="diag-checadas-result" style="display:none; font-size: 13px;"></div>
      </div>

      <div class="card" style="margin-bottom: 20px;">
        <div style="font-weight: 700; font-size: 16px; margin-bottom: 8px;">3. Probador de Catálogo de Empleados (/api/v1/agente/sync-empleados)</div>
        <div style="color: var(--text-muted); font-size: 13px; margin-bottom: 14px;">
          Descarga el catálogo de empleados activos del tenant asignado y actualiza la tabla <code>cat_empleados</code> en SQLite local.
        </div>
        <div class="actions" style="margin-bottom: 10px;">
          <button onclick="testCloudEmpleados()">👥 Descargar Catálogo</button>
        </div>
        <div id="diag-empleados-result" style="display:none; font-size: 13px;"></div>
      </div>

      <div class="card">
        <div style="font-weight: 700; font-size: 16px; margin-bottom: 8px;">4. Enrolamiento con Código de Un Solo Uso</div>
        <div style="color: var(--text-muted); font-size: 13px; margin-bottom: 14px;">
          Canjea un código generado en la plataforma web (ej. <code>ENROL-XXXXXX-XXXXXX-XXXXXX</code>) para registrar este agente local.
        </div>
        <form onsubmit="submitEnroll(event)">
          <div class="form-grid">
            <div class="form-group">
              <label>Código de Enrolamiento</label>
              <input type="text" id="enroll-code" placeholder="ENROL-XXXXXX-XXXXXX-XXXXXX" required>
            </div>
            <div class="form-group">
              <label>Nombre del Agente</label>
              <input type="text" id="enroll-name" value="Agente Planta 1" required>
            </div>
            <div class="form-group">
              <label>URL del Servidor</label>
              <input type="text" id="enroll-server" value="{server_url}" required>
            </div>
          </div>
          <button type="submit" class="btn-success">🔑 Enrolar Agente</button>
        </form>
      </div>
    </div>

    <!-- Pestaña 4: Layouts y Destinos -->
    <div id="tab-layouts" class="tab-content">
      <div class="card" style="margin-bottom: 24px;">
        <div style="font-weight: 700; margin-bottom: 8px;">CONTPAQi Nóminas</div>
        <div style="color: var(--text-muted); font-size: 13px; margin-bottom: 16px;">
          Genera el archivo <code>MovimientosDyHporperiodo.cfg</code> (formato oficial de texto plano) para importación automática en sistemas de nómina CONTPAQi.
        </div>
        <a class="btn" href="/api/layouts/contpaqi" download>📥 Descargar Layout CONTPAQi (.cfg)</a>
      </div>

      <div class="card">
        <div style="font-weight: 700; margin-bottom: 8px;">Sistema TRESS</div>
        <div style="color: var(--text-muted); font-size: 13px; margin-bottom: 16px;">
          Genera el layout de checadas delimitado para prenómina y control de asistencia en Sistema TRESS (formato Día/Mes/Año y hora local).
        </div>
        <a class="btn" href="/api/layouts/tress" download>📥 Descargar Layout Sistema TRESS (.txt)</a>
      </div>
    </div>
  </div>

  <!-- Modal de Inicio de Sesión de Administrador -->
  <div id="login-modal" class="modal-overlay">
    <div class="modal-card">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
        <div style="font-size: 17px; font-weight: 700;">Acceso Administrativo</div>
        <button class="btn-secondary btn-sm" onclick="closeLoginModal()">✕</button>
      </div>
      <div style="color: var(--text-muted); font-size: 13px; margin-bottom: 16px;">
        Inicia sesión con credenciales de <strong>Super-Admin</strong> o <strong>Admin de Empresa</strong> para configurar relojes checadores y realizar pruebas de API.
      </div>

      <div class="tabs" style="margin-bottom: 16px;">
        <button type="button" class="tab-btn active" id="btn-mode-online" onclick="setAuthMode('online')">En Línea (Cloud)</button>
        <button type="button" class="tab-btn" id="btn-mode-offline" onclick="setAuthMode('offline')">Offline (PIN Local)</button>
      </div>

      <div id="modal-alert" class="alert-box"></div>

      <form id="form-login" onsubmit="submitLogin(event)">
        <div id="fields-online">
          <div class="form-group" style="margin-bottom: 12px;">
            <label>Correo Electrónico</label>
            <input type="email" id="login-email" placeholder="admin@empresa.com">
          </div>
          <div class="form-group" style="margin-bottom: 16px;">
            <label>Contraseña</label>
            <input type="password" id="login-password" placeholder="••••••••">
          </div>
        </div>

        <div id="fields-offline" style="display:none;">
          <div style="font-size: 12px; color: var(--warning); margin-bottom: 12px;">💡 Acceso técnico local inmediato sin requerir internet. PIN por defecto: <strong>123456</strong>.</div>
          <div class="form-group" style="margin-bottom: 16px;">
            <label>PIN de Emergencia Local</label>
            <input type="password" id="login-pin" placeholder="123456">
          </div>
        </div>

        <div style="display: flex; gap: 10px; justify-content: flex-end;">
          <button type="button" class="btn-secondary" onclick="closeLoginModal()">Cancelar</button>
          <button type="submit" class="btn-success">Entrar</button>
        </div>
      </form>
    </div>
  </div>

  <script>
    let currentAuthMode = 'online';
    let currentUser = null;

    function checkAuth() {{
      fetch('/api/auth/me')
        .then(r => r.json())
        .then(data => {{
          const container = document.getElementById('auth-status-container');
          if (data.authenticated && data.usuario) {{
            currentUser = data.usuario;
            container.innerHTML = `
              <div style="display: flex; align-items: center; gap: 8px;">
                <span class="badge ok">👤 ${{data.usuario.nombre}} (${{data.usuario.rol}})</span>
                <button class="btn-secondary btn-sm" onclick="logout()">Cerrar Sesión</button>
              </div>
            `;
          }} else {{
            currentUser = null;
            container.innerHTML = `<button class="btn btn-secondary btn-sm" onclick="openLoginModal()">🔒 Iniciar Sesión Admin</button>`;
          }}
        }});
    }}

    function openLoginModal() {{
      document.getElementById('login-modal').classList.add('active');
      document.getElementById('modal-alert').style.display = 'none';
    }}

    function closeLoginModal() {{
      document.getElementById('login-modal').classList.remove('active');
    }}

    function setAuthMode(mode) {{
      currentAuthMode = mode;
      document.getElementById('btn-mode-online').classList.toggle('active', mode === 'online');
      document.getElementById('btn-mode-offline').classList.toggle('active', mode === 'offline');
      document.getElementById('fields-online').style.display = mode === 'online' ? 'block' : 'none';
      document.getElementById('fields-offline').style.display = mode === 'offline' ? 'block' : 'none';
    }}

    function submitLogin(e) {{
      e.preventDefault();
      const alertBox = document.getElementById('modal-alert');
      alertBox.className = 'alert-box';
      alertBox.style.display = 'none';

      let payload = {{}};
      if (currentAuthMode === 'online') {{
        payload = {{
          email: document.getElementById('login-email').value,
          password: document.getElementById('login-password').value,
        }};
      }} else {{
        payload = {{
          pin_emergencia: document.getElementById('login-pin').value,
        }};
      }}

      fetch('/api/auth/login', {{
        method: 'POST',
        headers: {{'Content-Type': 'application/json'}},
        body: JSON.stringify(payload),
      }})
      .then(async r => {{
        const data = await r.json();
        if (!r.ok || !data.ok) {{
          alertBox.className = 'alert-box err';
          alertBox.innerText = data.detail || data.error || 'Credenciales incorrectas';
          alertBox.style.display = 'block';
        }} else {{
          closeLoginModal();
          checkAuth();
        }}
      }})
      .catch(err => {{
        alertBox.className = 'alert-box err';
        alertBox.innerText = 'Error de conexión: ' + err;
        alertBox.style.display = 'block';
      }});
    }}

    function logout() {{
      fetch('/api/auth/logout', {{method: 'POST'}})
        .then(() => {{
          checkAuth();
        }});
    }}

    function switchTab(tabId) {{
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      event.target.classList.add('active');
      document.getElementById(tabId).classList.add('active');
      if (tabId === 'tab-relojes') {{
        loadClocks();
      }}
    }}

    function onTipoChange() {{
      const tipo = document.getElementById('clock-tipo').value;
      const puertoInput = document.getElementById('clock-puerto');
      const commKeyGroup = document.getElementById('group-commkey');
      const usuarioGroup = document.getElementById('group-usuario');
      const passwordGroup = document.getElementById('group-password');

      if (tipo === 'ZKTECO') {{
        puertoInput.value = 4370;
        commKeyGroup.style.display = 'flex';
        usuarioGroup.style.display = 'none';
        passwordGroup.style.display = 'none';
      }} else if (tipo === 'HIKVISION') {{
        puertoInput.value = 80;
        commKeyGroup.style.display = 'none';
        usuarioGroup.style.display = 'flex';
        passwordGroup.style.display = 'flex';
      }} else {{
        puertoInput.value = 443;
        commKeyGroup.style.display = 'none';
        usuarioGroup.style.display = 'flex';
        passwordGroup.style.display = 'flex';
      }}
    }}

    function triggerSync() {{
      fetch('/api/sync-now', {{method:'POST'}})
        .then(async r => {{
          if (r.status === 401) {{
            openLoginModal();
            throw new Error('Inicia sesión para sincronizar');
          }}
          return r.json();
        }})
        .then(d => {{
          alert(`Sincronizadas: ${{d.checadas_sincronizadas}} | Pendientes: ${{d.pendientes_restantes}}`);
          loadQueue();
        }})
        .catch(e => alert(e.message || e));
    }}

    function triggerReconcile() {{
      fetch('/api/reconcile-now', {{method:'POST'}})
        .then(async r => {{
          if (r.status === 401) {{
            openLoginModal();
            throw new Error('Inicia sesión para reconciliar');
          }}
          return r.json();
        }})
        .then(d => {{
          alert('Reconciliación completada: ' + JSON.stringify(d.reconciliacion));
          loadQueue();
        }})
        .catch(e => alert(e.message || e));
    }}

    function loadQueue() {{
      fetch('/api/queue?limit=15')
        .then(r => r.json())
        .then(data => {{
          if (!data.checadas || data.checadas.length === 0) {{
            document.getElementById('queue-table').innerHTML = '<div style="color: var(--text-muted); padding: 12px 0;">No hay checadas en la cola local.</div>';
            return;
          }}
          let rows = data.checadas.map(c => `
            <tr>
              <td><code>${{c.codigo_empleado}}</code></td>
              <td>${{c.ts_dispositivo_local}}</td>
              <td>${{c.ts_utc}}</td>
              <td><span class="badge ok">${{c.tipo_marca}}</span></td>
              <td>${{c.tipo_verificacion || 'N/A'}}</td>
              <td>${{c.ambigua ? '<span class="badge warn">AMBIGUA DST</span>' : 'NO'}}</td>
              <td>${{c.sincronizado ? '<span class="badge ok">SINCRONIZADO</span>' : '<span class="badge warn">PENDIENTE</span>'}}</td>
            </tr>
          `).join('');
          document.getElementById('queue-table').innerHTML = `
            <table>
              <thead>
                <tr>
                  <th>Empleado</th>
                  <th>Hora Local</th>
                  <th>Hora UTC</th>
                  <th>Marca</th>
                  <th>Verif</th>
                  <th>Horario Verano</th>
                  <th>Estatus Nube</th>
                </tr>
              </thead>
              <tbody>${{rows}}</tbody>
            </table>
          `;
        }});
    }}

    function loadClocks() {{
      fetch('/api/relojes')
        .then(r => r.json())
        .then(clocks => {{
          if (!clocks || clocks.length === 0) {{
            document.getElementById('clocks-table').innerHTML = '<div style="color: var(--text-muted); padding: 12px 0;">No hay relojes configurados en SQLite local. Agrega uno con el formulario arriba.</div>';
            return;
          }}
          let rows = clocks.map(c => `
            <tr>
              <td>
                <span class="badge ${{c.ultimo_error ? 'danger' : (c.ultimo_ping ? 'ok' : '')}}">
                  ${{c.ultimo_error ? 'ERROR' : (c.ultimo_ping ? 'EN LÍNEA' : 'PENDIENTE')}}
                </span>
              </td>
              <td><strong>${{c.nombre}}</strong></td>
              <td><span class="badge">${{c.tipo}}</span></td>
              <td><code>${{c.ip}}:${{c.puerto}}</code></td>
              <td style="font-size: 11px; color: var(--text-muted);">
                ${{c.ultimo_ping || 'Nunca'}}
                ${{c.ultimo_error ? '<div style="color: var(--danger);">' + c.ultimo_error + '</div>' : ''}}
              </td>
              <td>
                <button class="btn-secondary btn-sm" onclick="testSavedClock('${{c.id}}')">⚡ Probar</button>
                <button class="btn-secondary btn-sm" onclick='editClock(${{JSON.stringify(c)}})'>✏️</button>
                <button class="btn-danger btn-sm" onclick="deleteClock('${{c.id}}')">🗑️</button>
              </td>
            </tr>
          `).join('');
          document.getElementById('clocks-table').innerHTML = `
            <table>
              <thead>
                <tr>
                  <th>Estado</th>
                  <th>Nombre</th>
                  <th>Tipo</th>
                  <th>IP / Puerto</th>
                  <th>Última Conexión</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>${{rows}}</tbody>
            </table>
          `;
        }});
    }}

    function testCurrentFormConnection() {{
      const alertBox = document.getElementById('test-alert');
      alertBox.className = 'alert-box';
      alertBox.style.display = 'block';
      alertBox.innerText = 'Probando conexión socket en vivo...';

      const payload = {{
        tipo: document.getElementById('clock-tipo').value,
        ip: document.getElementById('clock-ip').value,
        puerto: parseInt(document.getElementById('clock-puerto').value || 4370),
        comm_key: parseInt(document.getElementById('clock-commkey').value || 0),
        usuario: document.getElementById('clock-usuario').value,
        password: document.getElementById('clock-password').value,
      }};

      fetch('/api/relojes/test', {{
        method: 'POST',
        headers: {{'Content-Type': 'application/json'}},
        body: JSON.stringify(payload),
      }})
      .then(r => r.json())
      .then(d => {{
        if (d.ok) {{
          alertBox.className = 'alert-box ok';
          alertBox.innerText = `✅ ${{d.mensaje}} (Latencia: ${{d.latencia_ms}} ms)`;
        }} else {{
          alertBox.className = 'alert-box err';
          alertBox.innerText = `❌ ${{d.mensaje}}`;
        }}
      }})
      .catch(e => {{
        alertBox.className = 'alert-box err';
        alertBox.innerText = `❌ Error: ${{e}}`;
      }});
    }}

    function testSavedClock(id) {{
      fetch('/api/relojes/test', {{
        method: 'POST',
        headers: {{'Content-Type': 'application/json'}},
        body: JSON.stringify({{id: id}}),
      }})
      .then(r => r.json())
      .then(d => {{
        alert(`${{d.ok ? '✅ EN LÍNEA' : '❌ ERROR'}}: ${{d.mensaje}} ${{d.latencia_ms ? '(' + d.latencia_ms + ' ms)' : ''}}`);
        loadClocks();
      }});
    }}

    function saveClock(event) {{
      event.preventDefault();
      const payload = {{
        id: document.getElementById('clock-id').value || undefined,
        nombre: document.getElementById('clock-nombre').value,
        tipo: document.getElementById('clock-tipo').value,
        ip: document.getElementById('clock-ip').value,
        puerto: parseInt(document.getElementById('clock-puerto').value),
        comm_key: parseInt(document.getElementById('clock-commkey').value || 0),
        usuario: document.getElementById('clock-usuario').value || undefined,
        password: document.getElementById('clock-password').value || undefined,
        activo: true,
      }};

      fetch('/api/relojes', {{
        method: 'POST',
        headers: {{'Content-Type': 'application/json'}},
        body: JSON.stringify(payload),
      }})
      .then(async r => {{
        if (r.status === 401) {{
          openLoginModal();
          throw new Error('Inicia sesión para guardar la configuración del reloj');
        }}
        return r.json();
      }})
      .then(d => {{
        alert(d.mensaje || 'Guardado exitosamente');
        resetClockForm();
        loadClocks();
      }})
      .catch(e => alert(e.message || e));
    }}

    function editClock(clock) {{
      document.getElementById('clock-id').value = clock.id;
      document.getElementById('clock-nombre').value = clock.nombre;
      document.getElementById('clock-tipo').value = clock.tipo;
      document.getElementById('clock-ip').value = clock.ip;
      document.getElementById('clock-puerto').value = clock.puerto;
      document.getElementById('clock-commkey').value = clock.comm_key || 0;
      document.getElementById('clock-usuario').value = clock.usuario || '';
      document.getElementById('clock-password').value = '';
      document.getElementById('form-clock-title').innerText = 'Editando Reloj: ' + clock.nombre;
      document.getElementById('btn-cancel-edit').style.display = 'inline-block';
      onTipoChange();
      window.scrollTo({{top: 0, behavior: 'smooth'}});
    }}

    function resetClockForm() {{
      document.getElementById('clock-form').reset();
      document.getElementById('clock-id').value = '';
      document.getElementById('form-clock-title').innerText = 'Configurar Nuevo Reloj Checador';
      document.getElementById('btn-cancel-edit').style.display = 'none';
      document.getElementById('test-alert').style.display = 'none';
      onTipoChange();
    }}

    function deleteClock(id) {{
      if (!confirm('¿Seguro que deseas eliminar este reloj de la base local?')) return;
      fetch('/api/relojes/' + id, {{method: 'DELETE'}})
        .then(async r => {{
          if (r.status === 401) {{
            openLoginModal();
            throw new Error('Inicia sesión para eliminar relojes');
          }}
          return r.json();
        }})
        .then(d => {{
          loadClocks();
        }})
        .catch(e => alert(e.message || e));
    }}

    // --- Diagnósticos Cloud ---

    function testCloudLatido() {{
      const el = document.getElementById('diag-latido-result');
      el.style.display = 'block';
      el.innerHTML = '<div style="color: var(--text-muted);">Enviando latido a la nube...</div>';

      fetch('/api/cloud-test/latido', {{method: 'POST'}})
        .then(async r => {{
          if (r.status === 401) {{
            openLoginModal();
            throw new Error('Inicia sesión para probar endpoints cloud');
          }}
          return r.json();
        }})
        .then(d => {{
          const isOk = d.ok;
          el.innerHTML = `
            <div class="alert-box ${{isOk ? 'ok' : 'err'}}" style="display:block;">
              <strong>${{isOk ? '✅ Latido Exitoso' : '❌ Fallo en Latido'}}</strong> (Status HTTP: ${{d.status_code}}, Latencia: ${{d.latencia_ms}} ms)<br>
              Desvío de Reloj: <strong>${{d.drift_segundos}} s</strong> ${{d.alerta_desvio_reloj ? '<span class="badge danger">ALERTA DERIVA >120s</span>' : '<span class="badge ok">SINCRONIZADO</span>'}}<br>
              <pre style="margin-top: 6px; font-size: 11px;">${{JSON.stringify(d.respuesta, null, 2)}}</pre>
            </div>
          `;
        }})
        .catch(e => {{
          el.innerHTML = `<div class="alert-box err" style="display:block;">${{e.message || e}}</div>`;
        }});
    }}

    function testCloudChecadas() {{
      const el = document.getElementById('diag-checadas-result');
      el.style.display = 'block';
      el.innerHTML = '<div style="color: var(--text-muted);">Enviando checada de prueba firmada con HMAC-SHA256...</div>';

      fetch('/api/cloud-test/checadas', {{method: 'POST'}})
        .then(async r => {{
          if (r.status === 401) {{
            openLoginModal();
            throw new Error('Inicia sesión para probar endpoints cloud');
          }}
          return r.json();
        }})
        .then(d => {{
          const isOk = d.ok;
          el.innerHTML = `
            <div class="alert-box ${{isOk ? 'ok' : 'err'}}" style="display:block;">
              <strong>${{isOk ? '✅ Checada Ingerida y Validada' : '❌ Fallo en Ingesta'}}</strong> (Status HTTP: ${{d.status_code}}, Latencia: ${{d.latencia_ms}} ms)<br>
              <pre style="margin-top: 6px; font-size: 11px;">${{JSON.stringify(d.respuesta, null, 2)}}</pre>
            </div>
          `;
        }})
        .catch(e => {{
          el.innerHTML = `<div class="alert-box err" style="display:block;">${{e.message || e}}</div>`;
        }});
    }}

    function testCloudEmpleados() {{
      const el = document.getElementById('diag-empleados-result');
      el.style.display = 'block';
      el.innerHTML = '<div style="color: var(--text-muted);">Consultando catálogo de empleados en la nube...</div>';

      fetch('/api/cloud-test/empleados', {{method: 'POST'}})
        .then(async r => {{
          if (r.status === 401) {{
            openLoginModal();
            throw new Error('Inicia sesión para sincronizar empleados');
          }}
          return r.json();
        }})
        .then(d => {{
          const isOk = d.ok;
          el.innerHTML = `
            <div class="alert-box ${{isOk ? 'ok' : 'err'}}" style="display:block;">
              <strong>${{isOk ? '✅ Catálogo Descargado' : '❌ Fallo en Descarga'}}</strong> (Status HTTP: ${{d.status_code}}, Latencia: ${{d.latencia_ms}} ms)<br>
              Empleados actualizados en SQLite local: <strong>${{d.empleados_actualizados || 0}}</strong><br>
              <pre style="margin-top: 6px; font-size: 11px;">${{JSON.stringify(d.respuesta, null, 2)}}</pre>
            </div>
          `;
        }})
        .catch(e => {{
          el.innerHTML = `<div class="alert-box err" style="display:block;">${{e.message || e}}</div>`;
        }});
    }}

    function submitEnroll(e) {{
      e.preventDefault();
      const code = document.getElementById('enroll-code').value;
      const name = document.getElementById('enroll-name').value;
      const server = document.getElementById('enroll-server').value;

      fetch('/api/enroll', {{
        method: 'POST',
        headers: {{'Content-Type': 'application/json'}},
        body: JSON.stringify({{codigo_enrolamiento: code, nombre_agente: name, server_url: server}}),
      }})
      .then(async r => {{
        if (r.status === 401) {{
          openLoginModal();
          throw new Error('Inicia sesión para enrolar');
        }}
        return r.json();
      }})
      .then(d => {{
        if (d.ok) {{
          alert('¡Agente enrolado exitosamente! Recargando...');
          location.reload();
        }} else {{
          alert('Error al enrolar: ' + (d.detail || JSON.stringify(d)));
        }}
      }})
      .catch(e => alert(e.message || e));
    }}

    // Carga inicial
    checkAuth();
    loadQueue();
  </script>
</body>
</html>
"""
        return html

    return app
