from __future__ import annotations

import logging
from fastapi.testclient import TestClient
from agent.db import AgentLocalDatabase
from agent.log_manager import GLOBAL_LOG_HANDLER
from agent.ui.app import create_diagnostic_app


def test_ui_logs_endpoint_filtering_and_counts(tmp_path) -> None:
    db_file = tmp_path / "test_logs.sqlite"
    db = AgentLocalDatabase(str(db_file))

    app = create_diagnostic_app(db=db)
    client = TestClient(app)

    # Limpiar buffer
    GLOBAL_LOG_HANDLER.clear()

    # Emitir logs de prueba
    test_logger = logging.getLogger("sm_clock_agent.test")
    test_logger.setLevel(logging.INFO)
    test_logger.info("Iniciando servicio de agente de prueba")
    test_logger.warning("Conexión lenta con terminal ZKTeco")
    test_logger.error("Error al conectar con Hikvision en 192.168.1.200")

    # Consultar todos los logs
    res = client.get("/api/logs")
    assert res.status_code == 200
    data = res.json()
    assert data["ok"] is True
    assert data["counts"]["total"] >= 3
    assert data["counts"]["errors"] >= 1
    assert data["counts"]["warnings"] >= 1

    # Filtrar por nivel ERROR
    res_err = client.get("/api/logs?level=ERROR")
    assert res_err.status_code == 200
    err_logs = res_err.json()["logs"]
    assert len(err_logs) >= 1
    assert all(e["level"] == "ERROR" for e in err_logs)

    # Filtrar por búsqueda
    res_search = client.get("/api/logs?search=192.168.1.200")
    assert res_search.status_code == 200
    search_logs = res_search.json()["logs"]
    assert len(search_logs) >= 1
    assert "192.168.1.200" in search_logs[0]["message"]
