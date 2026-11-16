from __future__ import annotations

import argparse
import logging
import sys
import threading
import time
import webbrowser
from pathlib import Path

import uvicorn

try:
    from . import __version__
    from .config import AgentSettings
    from .db import AgentLocalDatabase
    from .scheduler import AgentScheduler
    from .sync import CloudSyncClient, enroll_agent_with_code
    from .ui.app import LOCAL_DIAGNOSTIC_HOST, LOCAL_DIAGNOSTIC_PORT, create_diagnostic_app
except (ImportError, ValueError):
    from agent import __version__
    from agent.config import AgentSettings
    from agent.db import AgentLocalDatabase
    from agent.scheduler import AgentScheduler
    from agent.sync import CloudSyncClient, enroll_agent_with_code
    from agent.ui.app import LOCAL_DIAGNOSTIC_HOST, LOCAL_DIAGNOSTIC_PORT, create_diagnostic_app

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("sm_clock_agent")


def _launch_browser_after_delay(url: str, delay: float = 1.2) -> None:
    time.sleep(delay)
    try:
        webbrowser.open(url)
    except Exception:
        pass


def run_agent_service(settings: AgentSettings | None = None, open_browser: bool = True) -> None:
    cfg = settings or AgentSettings()
    db = AgentLocalDatabase(cfg.db_path)

    # Restaurar credenciales y URL si ya se enroló previamente
    saved_agent_id = db.get_config("agente_id")
    saved_token = db.get_config("credencial_token")
    saved_server_url = db.get_config("server_url")
    if saved_agent_id:
        cfg.agente_id = saved_agent_id
    if saved_token:
        cfg.credencial_token = saved_token
    if saved_server_url:
        cfg.server_url = saved_server_url

    saved_tz = db.get_config("zona_horaria")
    if saved_tz:
        cfg.zona_horaria = saved_tz

    ui_url = f"http://{cfg.diagnostic_host}:{cfg.diagnostic_port}"

    print("=" * 66)
    print(f"  SM-CLOCK AGENTE LOCAL v{__version__} (Tijuana, B.C.)")
    print("=" * 66)
    print(f"  * Base de datos:  {cfg.db_path} (WAL: {db.get_journal_mode()})")
    print(f"  * Agente ID:      {cfg.agente_id or '(Sin enrolar)'}")
    print(f"  * Servidor SaaS:  {cfg.server_url}")
    print(f"  * Interfaz Web:   {ui_url}")
    if open_browser:
        print(f"  -> Abriendo navegador automaticamente en {ui_url} ...")
        threading.Thread(target=_launch_browser_after_delay, args=(ui_url,), daemon=True).start()
    print("  (Presiona Ctrl+C en esta consola para detener el agente)")
    print("=" * 66)

    sync_client = CloudSyncClient(
        db=db,
        agente_id=cfg.agente_id,
        credencial_token=cfg.credencial_token,
        server_url=cfg.server_url,
    )

    scheduler = AgentScheduler(
        db=db,
        sync_client=sync_client,
        batch_interval_seconds=cfg.batch_interval_seconds,
        heartbeat_interval_seconds=cfg.heartbeat_interval_seconds,
        reconciliation_interval_minutes=cfg.reconciliation_interval_minutes,
        version=__version__,
    )

    scheduler.start()

    app = create_diagnostic_app(
        db=db,
        sync_client=sync_client,
        drivers=scheduler.drivers,
        tz_name=cfg.zona_horaria,
    )

    logger.info("Servidor de diagnóstico disponible en %s", ui_url)
    try:
        uvicorn.run(
            app,
            host=cfg.diagnostic_host,
            port=cfg.diagnostic_port,
            log_level="info",
            access_log=False,
        )
    finally:
        scheduler.stop()
        db.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=f"SM-Clock Agente Local v{__version__}")
    subparsers = parser.add_subparsers(dest="command")

    # Comando run
    run_parser = subparsers.add_parser("run", help="Inicia el servicio del agente y la UI de diagnóstico")
    run_parser.add_argument("--db", default="agent.sqlite", help="Ruta de la base de datos SQLite")
    run_parser.add_argument("--port", type=int, default=LOCAL_DIAGNOSTIC_PORT, help="Puerto de diagnóstico (8085)")
    run_parser.add_argument("--no-browser", action="store_true", help="No abrir automáticamente el navegador web")

    # Comando enroll
    enroll_parser = subparsers.add_parser("enroll", help="Enrola el agente con un código de un solo uso")
    enroll_parser.add_argument("code", help="Código de enrolamiento emitido en el panel web")
    enroll_parser.add_argument("--name", default="Agente Local", help="Nombre descriptivo para este agente")
    enroll_parser.add_argument("--server", default="http://127.0.0.1:3000", help="URL base del servidor SaaS")
    enroll_parser.add_argument("--db", default="agent.sqlite", help="Ruta de la base de datos SQLite")

    # Comando status
    status_parser = subparsers.add_parser("status", help="Muestra el estado actual del agente")
    status_parser.add_argument("--db", default="agent.sqlite", help="Ruta de la base de datos SQLite")

    args = parser.parse_args()

    if args.command == "run":
        cfg = AgentSettings(db_path=args.db, diagnostic_port=args.port)
        run_agent_service(cfg, open_browser=not args.no_browser)

    elif args.command == "enroll":
        db = AgentLocalDatabase(args.db)
        print(f"Enrolando agente '{args.name}' contra {args.server}...")
        res = enroll_agent_with_code(
            codigo_enrolamiento=args.code,
            nombre_agente=args.name,
            server_url=args.server,
        )
        if res:
            db.set_config("agente_id", res["agente_id"])
            db.set_config("credencial_token", res["credencial_token"])
            db.set_config("tenant_id", res.get("tenant_id", ""))
            db.set_config("server_url", args.server)
            if "zona_horaria" in res:
                db.set_config("zona_horaria", res["zona_horaria"])
            print(f"[OK] Enrolamiento exitoso! Agente ID: {res['agente_id']}")
        else:
            print("[ERROR] Falló el enrolamiento. Verifica el código y la conectividad.")
            sys.exit(1)
        db.close()

    elif args.command == "status":
        db = AgentLocalDatabase(args.db)
        print(f"Versión: {__version__}")
        print(f"Agente ID: {db.get_config('agente_id') or 'No enrolado'}")
        print(f"Tenant ID: {db.get_config('tenant_id') or 'N/A'}")
        print(f"Modo WAL: {db.get_journal_mode()}")
        print(f"Cola pendiente: {db.count_pending()} checadas")
        print(f"Total procesadas: {db.count_total()} checadas")
        db.close()

    else:
        # Ejecución por defecto (ej. doble clic en sm-clock-agent.exe)
        run_agent_service(open_browser=True)


if __name__ == "__main__":
    main()
