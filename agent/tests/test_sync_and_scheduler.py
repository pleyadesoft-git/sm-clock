from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from agent.config import protect_secret, unprotect_secret
from agent.db import AgentLocalDatabase
from agent.drivers.base import BaseClockDriver
from agent.scheduler import AgentScheduler
from agent.sync import (
    CloudSyncClient,
    check_clock_drift,
    enroll_agent_with_code,
)


def test_protect_and_unprotect_secret() -> None:
    original = "token_secreto_super_seguro_2026"
    encrypted = protect_secret(original)
    assert encrypted != original
    decrypted = unprotect_secret(encrypted)
    assert decrypted == original


def test_clock_drift_detection() -> None:
    now_utc = datetime.now(timezone.utc).isoformat()
    drift, alert = check_clock_drift(now_utc, max_drift_seconds=120.0)
    assert drift < 2.0
    assert alert is False

    # Servidor desfasado por 5 minutos (300 segundos)
    past_utc = "2020-01-01T00:00:00Z"
    drift_past, alert_past = check_clock_drift(past_utc, max_drift_seconds=120.0)
    assert drift_past > 120.0
    assert alert_past is True


def test_enroll_agent_with_code_mock() -> None:
    captured: list[dict[str, Any]] = []

    def mock_enroll_post(path: str, raw_body: str, headers: dict[str, str]) -> tuple[int, dict[str, Any]]:
        captured.append({"path": path, "body": json.loads(raw_body)})
        return 200, {
            "agente_id": "11111111-0004-4000-8000-000000000001",
            "credencial_token": "agt_token_live_12345",
            "tenant_id": "99999999-0001-4000-8000-000000000001",
            "zona_horaria": "America/Tijuana",
        }

    res = enroll_agent_with_code(
        codigo_enrolamiento="CODE-TIJ001-123456",
        nombre_agente="Agente Planta 1",
        server_url="https://smclock.test",
        transport_post=mock_enroll_post,
    )
    assert res is not None
    assert res["agente_id"] == "11111111-0004-4000-8000-000000000001"
    assert res["credencial_token"] == "agt_token_live_12345"
    assert len(captured) == 1
    assert captured[0]["path"] == "/api/v1/agente/enrolar"


def test_sync_employees_and_local_cache(tmp_path: Path) -> None:
    db = AgentLocalDatabase(tmp_path / "emp_sync.sqlite")

    def mock_transport(path: str, raw_body: str, headers: dict[str, str]) -> tuple[int, dict[str, Any]]:
        return 200, {
            "empleados": [
                {"id": "emp-1", "codigo_empleado": "1001", "nombre_completo": "Juan Perez", "activo": True},
                {"id": "emp-2", "codigo_empleado": "1002", "nombre_completo": "Maria Lopez", "activo": True},
            ]
        }

    sync_client = CloudSyncClient(
        db=db,
        agente_id="11111111-0004-4000-8000-000000000001",
        credencial_token="token_test",
        transport_post=mock_transport,
    )

    upserted = sync_client.sync_employees()
    assert upserted == 2

    emp = db.get_empleado_by_codigo("1001")
    assert emp is not None
    assert emp.nombre_completo == "Juan Perez"
    assert emp.activo is True

    db.close()


def test_scheduler_fault_isolation(tmp_path: Path) -> None:
    db = AgentLocalDatabase(tmp_path / "scheduler_test.sqlite")

    class WorkingDriver(BaseClockDriver):
        def __init__(self, fuente_id: str) -> None:
            super().__init__(fuente_id=fuente_id, nombre="Reloj OK", tipo="ZKTECO")

        def test_connection(self) -> tuple[bool, str]:
            return True, "OK"

        def reconcile_missing_punches(self) -> int:
            return 3

    class BrokenDriver(BaseClockDriver):
        def __init__(self, fuente_id: str) -> None:
            super().__init__(fuente_id=fuente_id, nombre="Reloj Roto", tipo="HIKVISION")

        def test_connection(self) -> tuple[bool, str]:
            return False, "Error de red"

        def reconcile_missing_punches(self) -> int:
            raise ConnectionError("Host inalcanzable")

    def mock_sync_post(_path: str, _raw_body: str, _headers: dict[str, str]) -> tuple[int, dict[str, Any]]:
        return 200, {"ok": True, "servidor_ts_utc": datetime.now(timezone.utc).isoformat()}

    sync_client = CloudSyncClient(
        db=db,
        agente_id="11111111-0004-4000-8000-000000000001",
        credencial_token="token_test",
        transport_post=mock_sync_post,
    )

    scheduler = AgentScheduler(
        db=db,
        sync_client=sync_client,
        drivers=[WorkingDriver("ok-1"), BrokenDriver("broken-1")],
    )

    # La reconciliación no debe fallar; el driver roto da -1 pero el sano completa sus 3 marcas
    results = scheduler.job_reconcile_all_clocks()
    assert results["ok-1"] == 3
    assert results["broken-1"] == -1

    # El latido reporta el estado de ambos drivers sin romperse
    hb_ok = scheduler.job_heartbeat()
    assert hb_ok is True

    db.close()


def test_agent_error_alert_reporting_and_cooldown(tmp_path: Path) -> None:
    db = AgentLocalDatabase(db_path=tmp_path / "test_alert.db")
    captured_requests: list[dict[str, Any]] = []

    def mock_alert_post(path: str, raw_body: str, headers: dict[str, str]) -> tuple[int, dict[str, Any]]:
        captured_requests.append({
            "path": path,
            "body": json.loads(raw_body),
            "headers": headers,
        })
        return 200, {"ok": True, "notificados": 2}

    client = CloudSyncClient(
        db=db,
        agente_id="11111111-0004-4000-8000-000000000001",
        credencial_token="token_test_alert_12345",
        transport_post=mock_alert_post,
    )

    # 1. Enviar primera alerta de error
    sent = client.report_error(
        tipo_error="FALLO_CONEXION_RELOJ",
        mensaje="No se pudo contactar el reloj ZKTeco 192.168.1.100",
        detalle="Timeout de 5000ms",
        fuente_id="22222222-0001-4000-8000-000000000001",
        dispositivo="Reloj Entrada",
    )
    assert sent is True
    assert len(captured_requests) == 1
    req = captured_requests[0]
    assert req["path"] == "/api/v1/agente/alertas"
    assert req["body"]["tipo_error"] == "FALLO_CONEXION_RELOJ"
    assert req["body"]["mensaje"] == "No se pudo contactar el reloj ZKTeco 192.168.1.100"
    assert "x-agent-signature" in req["headers"]

    # 2. Segundo intento inmediato del mismo error debe ser omitido por cooldown (<120s)
    second_sent = client.report_error(
        tipo_error="FALLO_CONEXION_RELOJ",
        mensaje="No se pudo contactar el reloj ZKTeco 192.168.1.100",
        fuente_id="22222222-0001-4000-8000-000000000001",
    )
    assert second_sent is False
    assert len(captured_requests) == 1

    # 3. Forzar envío inmediato sí pasa
    forced_sent = client.report_error(
        tipo_error="FALLO_CONEXION_RELOJ",
        mensaje="No se pudo contactar el reloj ZKTeco 192.168.1.100",
        fuente_id="22222222-0001-4000-8000-000000000001",
        force=True,
    )
    assert forced_sent is True
    assert len(captured_requests) == 2

    db.close()

