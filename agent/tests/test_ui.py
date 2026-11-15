from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from agent.db import AgentLocalDatabase
from agent.drivers.base import BaseClockDriver
from agent.sync import CloudSyncClient
from agent.ui.app import create_diagnostic_app


class DummyDriver(BaseClockDriver):
    def __init__(self, fuente_id: str = "fuente-dummy") -> None:
        super().__init__(fuente_id=fuente_id, nombre="Reloj Demo", tipo="ZKTECO")

    def test_connection(self) -> tuple[bool, str]:
        return True, "Reloj de prueba conectado"

    def reconcile_missing_punches(self) -> int:
        return 0


def test_ui_diagnostic_endpoints_and_security(tmp_path: Path) -> None:
    db = AgentLocalDatabase(tmp_path / "ui_test.sqlite")
    fuente_id = "11111111-0003-4000-8000-000000000001"

    # Encolar un par de checadas para pruebas
    db.enqueue_punch(
        fuente_id=fuente_id,
        codigo_empleado="1001",
        ts_utc="2026-11-14T16:01:23.000Z",
        ts_dispositivo_local="2026-11-14 08:01:23",
        ambigua=False,
        tipo_marca="ENTRADA",
        tipo_verificacion="ROSTRO",
    )

    def mock_sync_post(path: str, raw_body: str, headers: dict[str, str]) -> tuple[int, dict[str, object]]:
        return 200, {"ok": True, "recibidas": 1}

    sync_client = CloudSyncClient(
        db=db,
        agente_id="11111111-0004-4000-8000-000000000001",
        credencial_token="token_test_12345",
        transport_post=mock_sync_post,
    )

    dummy_driver = DummyDriver(fuente_id)
    app = create_diagnostic_app(
        db=db,
        sync_client=sync_client,
        drivers=[dummy_driver],
        tz_name="America/Tijuana",
    )

    client = TestClient(app)

    # 1. Dashboard HTML
    resp_html = client.get("/")
    assert resp_html.status_code == 200
    assert "SM-Clock Agente Local" in resp_html.text
    assert "127.0.0.1:8085" in resp_html.text

    # 2. JSON Status
    resp_status = client.get("/api/status")
    assert resp_status.status_code == 200
    status_data = resp_status.json()
    assert status_data["cola_pendiente"] == 1
    assert status_data["zona_horaria"] == "America/Tijuana"
    assert status_data["sqlite_journal_mode"] == "wal"

    # 3. Queue endpoint
    resp_queue = client.get("/api/queue")
    assert resp_queue.status_code == 200
    queue_data = resp_queue.json()
    assert queue_data["pendientes_count"] == 1
    assert len(queue_data["checadas"]) == 1
    assert queue_data["checadas"][0]["codigo_empleado"] == "1001"

    # 4. Probar conexión
    resp_test = client.post("/api/test-connection", json={"fuente_id": fuente_id})
    assert resp_test.status_code == 200
    assert resp_test.json()["ok"] is True

    # 5. Sincronizar lote
    resp_sync = client.post("/api/sync-now")
    assert resp_sync.status_code == 200
    assert resp_sync.json()["checadas_sincronizadas"] == 1
    assert db.count_pending() == 0

    # 6. Descarga de layouts
    resp_contpaqi = client.get("/api/layouts/contpaqi")
    assert resp_contpaqi.status_code == 200
    assert "CodigoEmpleado,Fecha(YYYYMMDD),ClaveIncidencia,Cantidad" in resp_contpaqi.text

    resp_tress = client.get("/api/layouts/tress")
    assert resp_tress.status_code == 200
    assert "NoEmpleado,Fecha(DD/MM/YYYY),Hora(HH:MM:SS),Terminal" in resp_tress.text

    # 7. Bloqueo de IP no localhost
    remote_client = TestClient(app, client=("192.168.1.50", 54321))
    resp_blocked = remote_client.get("/api/status")
    assert resp_blocked.status_code == 403
    assert "Acceso prohibido" in resp_blocked.text

    db.close()
