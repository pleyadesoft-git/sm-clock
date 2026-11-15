from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

import uvicorn

from . import __version__
from .config import AgentSettings
from .db import AgentLocalDatabase
from .scheduler import AgentScheduler
from .sync import CloudSyncClient, enroll_agent_with_code
from .ui.app import LOCAL_DIAGNOSTIC_HOST, LOCAL_DIAGNOSTIC_PORT, create_diagnostic_app

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("sm_clock_agent")


def run_agent_service(settings: AgentSettings | None = None) -> None:
    cfg = settings or AgentSettings()
    db = AgentLocalDatabase(cfg.db_path)

    # Restaurar credenciales si ya se enroló previamente
    saved_agent_id = db.get_config("agente_id")
    saved_token = db.get_config("credencial_token")
    if saved_agent_id:
        cfg.agente_id = saved_agent_id
    if saved_token:
        cfg.credencial_token = saved_token

    saved_tz = db.get_config("zona_horaria")
    if saved_tz:
        cfg.zona_horaria = saved_tz

    logger.info("Iniciando SM-Clock Agente Local v%s (Tijuana, B.C.)", __version__)
    logger.info("Base de datos local: %s (WAL: %s)", cfg.db_path, db.get_journal_mode())
    logger.info("Zona horaria: %s", cfg.zona_horaria)
    logger.info("Agente ID: %s", cfg.agente_id or "(Pendiente de enrolamiento)")

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

    logger.info("Servidor de diagnóstico disponible exclusivamente en http://%s:%d", cfg.diagnostic_host, cfg.diagnostic_port)
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

    if args.command == "enroll":
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
        run_agent_service()


if __name__ == "__main__":
    main()
