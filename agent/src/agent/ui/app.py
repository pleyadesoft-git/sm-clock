from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Sequence

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import HTMLResponse, PlainTextResponse

from .. import __version__
from ..db import AgentLocalDatabase, QueuedPunch
from ..drivers.base import BaseClockDriver
from ..sync import CloudSyncClient, enroll_agent_with_code
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
    return {
        "bind": f"{LOCAL_DIAGNOSTIC_HOST}:{LOCAL_DIAGNOSTIC_PORT}",
        "version": __version__,
        "agente_id": agente_id or db.get_config("agente_id"),
        "tenant_id": db.get_config("tenant_id"),
        "zona_horaria": tz_name,
        "sqlite_journal_mode": db.get_journal_mode(),
        "cola_pendiente": db.count_pending(),
        "cola_total": db.count_total(),
        "ts_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "ultimo_latido_ts": sync_client.ultimo_latido_ts if sync_client else None,
        "desvio_reloj_segundos": sync_client.ultimo_drift_segundos if sync_client else 0.0,
        "alerta_desvio_reloj": sync_client.alerta_desvio_reloj if sync_client else False,
        "fuentes": driver_statuses,
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

    @app.get("/api/status")
    def api_status() -> dict[str, object]:
        return get_diagnostic_status(db, tz_name=tz_name, drivers=drivers_list, sync_client=sync_client)

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

    @app.post("/api/sync-now")
    def api_sync_now() -> dict[str, object]:
        if not sync_client:
            raise HTTPException(status_code=400, detail="Cliente de sincronización con la nube no configurado")
        synced = sync_client.flush_pending_batch()
        return {
            "ok": True,
            "checadas_sincronizadas": synced,
            "pendientes_restantes": db.count_pending(),
        }

    @app.post("/api/reconcile-now")
    def api_reconcile_now() -> dict[str, object]:
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
    def api_enroll(payload: dict[str, Any]) -> dict[str, object]:
        code = payload.get("codigo_enrolamiento", "")
        agent_name = payload.get("nombre_agente", "Agente Local")
        srv_url = payload.get("server_url", "http://127.0.0.1:3000")
        if not code:
            raise HTTPException(status_code=400, detail="Código de enrolamiento obligatorio")

        result = enroll_agent_with_code(
            codigo_enrolamiento=code,
            nombre_agente=agent_name,
            server_url=srv_url,
        )
        if not result:
            raise HTTPException(status_code=400, detail="No se pudo enrolar el agente. Verifica el código.")

        db.set_config("agente_id", str(result["agente_id"]))
        db.set_config("credencial_token", str(result["credencial_token"]))
        db.set_config("tenant_id", str(result.get("tenant_id", "")))
        if "zona_horaria" in result:
            db.set_config("zona_horaria", str(result["zona_horaria"]))

        return {"ok": True, "agente_id": result["agente_id"], "tenant_id": result.get("tenant_id")}

    @app.get("/", response_class=HTMLResponse)
    def index_dashboard() -> str:
        status = get_diagnostic_status(db, tz_name=tz_name, drivers=drivers_list, sync_client=sync_client)
        pending = db.count_pending()
        total = db.count_total()
        journal = db.get_journal_mode()
        agente_id = status["agente_id"] or "Sin enrolar"

        html = f"""<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>SM-Clock — Diagnóstico de Agente Local</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    :root {{
      --bg: #0b0f19;
      --card: #151b2b;
      --border: #222d42;
      --text: #f1f5f9;
      --text-muted: #94a3b8;
      --primary: #3b82f6;
      --success: #10b981;
      --warning: #f59e0b;
      --danger: #ef4444;
      --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }}
    body {{
      margin: 0;
      padding: 24px;
      background: var(--bg);
      color: var(--text);
      font-family: var(--font);
      -webkit-font-smoothing: antialiased;
    }}
    .container {{
      max-width: 900px;
      margin: 0 auto;
    }}
    .header {{
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--border);
    }}
    .title {{
      font-size: 20px;
      font-weight: 700;
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
    .badge.ok {{ background: rgba(16, 185, 129, 0.2); color: var(--success); }}
    .badge.warn {{ background: rgba(245, 158, 11, 0.2); color: var(--warning); }}
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
      padding: 16px;
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
      gap: 12px;
      margin-bottom: 24px;
      flex-wrap: wrap;
    }}
    button, a.btn {{
      background: var(--primary);
      color: white;
      border: none;
      padding: 10px 16px;
      border-radius: 8px;
      font-weight: 600;
      cursor: pointer;
      text-decoration: none;
      font-size: 14px;
      transition: opacity 0.2s;
    }}
    button:hover, a.btn:hover {{ opacity: 0.9; }}
    .btn-secondary {{ background: #334155; }}
    table {{
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }}
    th, td {{
      padding: 10px 12px;
      text-align: left;
      border-bottom: 1px solid var(--border);
    }}
    th {{ color: var(--text-muted); font-weight: 600; }}
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div>
        <div class="title">SM-Clock Agente Local (127.0.0.1:8085)</div>
        <div style="font-size: 13px; color: var(--text-muted); margin-top: 4px;">
          Tijuana, B.C. | Versión {__version__} | Agente: <code>{agente_id}</code>
        </div>
      </div>
      <div>
        <span class="badge ok">127.0.0.1 LOCALHOST</span>
      </div>
    </div>

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
      <button onclick="fetch('/api/sync-now', {{method:'POST'}}).then(r=>r.json()).then(d=>alert(JSON.stringify(d)))">Sincronizar Lote Ahora</button>
      <button class="btn-secondary" onclick="fetch('/api/reconcile-now', {{method:'POST'}}).then(r=>r.json()).then(d=>alert(JSON.stringify(d)))">Reconciliar Relojes</button>
      <a class="btn btn-secondary" href="/api/layouts/contpaqi" download>Descargar Layout CONTPAQi</a>
      <a class="btn btn-secondary" href="/api/layouts/tress" download>Descargar Layout TRESS</a>
      <a class="btn btn-secondary" href="/docs" target="_blank">Documentación API</a>
    </div>

    <div class="card">
      <div style="font-weight: 700; margin-bottom: 12px;">Últimas Checadas Capturadas</div>
      <div id="queue-table">Cargando registros...</div>
    </div>
  </div>

  <script>
    fetch('/api/queue?limit=10')
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
  </script>
</body>
</html>
"""
        return html

    return app
