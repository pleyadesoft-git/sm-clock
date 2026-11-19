from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

from agent.db import AgentLocalDatabase
from agent.drivers.hikvision import HikvisionDriver
from agent.drivers.zkteco import ZKTecoDriver
from agent.sync import CloudSyncClient
from agent.ui.app import create_diagnostic_app


class DummyZKTecoSmsAdapter:
    def __init__(self, supports_sms: bool = True) -> None:
        self.supports_sms = supports_sms
        self.sent_messages: list[tuple[str, str, int]] = []

    def is_connected(self) -> bool:
        return True

    def get_attendance_since(self, since_ts: str | None) -> list[Any]:
        return []

    def set_user_sms(self, user_id: str, message: str, duration_minutes: int) -> bool:
        if not self.supports_sms:
            return False
        self.sent_messages.append((user_id, message, duration_minutes))
        return True


class DummyHikvisionPromptAdapter:
    def __init__(self, supports_prompt: bool = True) -> None:
        self.supports_prompt = supports_prompt
        self.prompts: list[tuple[str, str]] = []

    def is_connected(self) -> bool:
        return True

    def search_events(self, since_ts: str | None) -> list[Any]:
        return []

    def set_employee_prompt(self, employee_no: str, message: str) -> bool:
        if not self.supports_prompt:
            return False
        self.prompts.append((employee_no, message))
        return True


def test_agent_stores_and_exposes_triggered_notifications(tmp_path: Path) -> None:
    db = AgentLocalDatabase(tmp_path / "agent_mensajes.db")

    # Simular que el empleado checa y la nube devuelve `notificaciones_disparadas`
    db.enqueue_punch(
        fuente_id="550e8400-e29b-41d4-a716-446655440000",
        codigo_empleado="1001",
        ts_utc="2026-11-18T15:00:00Z",
        ts_dispositivo_local="2026-11-18 07:00:00",
        tipo_marca="ENTRADA",
        tipo_verificacion="HUELLA",
    )

    def fake_transport(path: str, raw_body: str, headers: dict[str, str]) -> tuple[int, dict[str, Any]]:
        assert path == "/api/v1/agente/checadas"
        return (
            200,
            {
                "ok": True,
                "insertadas": 1,
                "servidor_ts_utc": "2026-11-18T15:00:01Z",
                "notificaciones_disparadas": [
                    {
                        "mensaje_id": "88881111-0005-4000-8000-000000000001",
                        "codigo_empleado": "1001",
                        "nombre_empleado": "Alejandro Hernández",
                        "tipo_marca": "ENTRADA",
                        "titulo": "Firma de contrato en RH",
                        "mensaje": "Pasar a RH a firmar contrato",
                        "texto_voz": "Hola Alejandro Hernández, favor de pasar a Recursos Humanos a firmar tu contrato.",
                        "reproducir_audio": True,
                        "canal_utilizado": "AGENTE_AUDIO_VISUAL",
                        "estatus_entrega": "ENTREGADO_DISPOSITIVO",
                        "ts_utc": "2026-11-18T15:00:00Z",
                    }
                ],
            },
        )

    sync = CloudSyncClient(
        db=db,
        agente_id="11111111-2222-4333-8444-555555555555",
        credencial_token="tok_secret_123456789012345678901234567890",
        transport_post=fake_transport,
    )
    synced = sync.flush_pending_batch()
    assert synced == 1

    app = create_diagnostic_app(db=db, sync_client=sync)
    client = TestClient(app)

    # Consultar notificaciones recientes no leídas
    res = client.get("/api/mensajes/recientes?solo_no_leidas=true")
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is True
    assert body["no_leidas_count"] == 1
    notif = body["notificaciones"][0]
    assert notif["codigo_empleado"] == "1001"
    assert notif["titulo"] == "Firma de contrato en RH"
    assert "Alejandro Hernández" in notif["texto_voz"]

    # Marcar como leída tras reproducir el audio personalizado en el agente
    mark_res = client.post("/api/mensajes/marcar-leida", json={"id": notif["id"]})
    assert mark_res.status_code == 200
    assert mark_res.json()["ok"] is True

    after_res = client.get("/api/mensajes/recientes?solo_no_leidas=true")
    assert after_res.json()["no_leidas_count"] == 0


def test_agent_simulate_personalized_voice_endpoint(tmp_path: Path) -> None:
    db = AgentLocalDatabase(tmp_path / "agent_sim.db")
    app = create_diagnostic_app(db=db)
    client = TestClient(app)

    res = client.post(
        "/api/mensajes/simular",
        json={
            "codigo_empleado": "2045",
            "nombre_empleado": "María Fernanda López",
            "tipo_marca": "SALIDA",
            "titulo": "Entrega de credencial",
            "mensaje": "Favor de pasar a la Administración para entrega de credencial",
            "texto_voz_personalizado": "Hola {nombre}, antes de retirarte: {mensaje}",
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert data["ok"] is True
    notif = data["notificacion"]
    assert notif["nombre_empleado"] == "María Fernanda López"
    assert notif["texto_voz"] == (
        "Hola María Fernanda, antes de retirarte: Favor de pasar a la Administración para entrega de credencial"
    )


def test_zkteco_and_hikvision_drivers_send_employee_message(tmp_path: Path) -> None:
    db = AgentLocalDatabase(tmp_path / "agent_drivers_msg.db")

    zk_adapter = DummyZKTecoSmsAdapter(supports_sms=True)
    zk_driver = ZKTecoDriver(
        fuente_id="fuente-zk-1",
        db=db,
        adapter=zk_adapter,  # type: ignore[arg-type]
    )
    ok_zk, msg_zk = zk_driver.send_employee_message("1001", "Pasar a RH a firmar contrato")
    assert ok_zk is True
    assert "ZKTeco" in msg_zk
    assert len(zk_adapter.sent_messages) == 1

    hik_adapter = DummyHikvisionPromptAdapter(supports_prompt=True)
    hik_driver = HikvisionDriver(
        fuente_id="fuente-hik-1",
        db=db,
        adapter=hik_adapter,  # type: ignore[arg-type]
    )
    ok_hik, msg_hik = hik_driver.send_employee_message(
        "1002", "Favor de pasar a Administración para entrega de credencial"
    )
    assert ok_hik is True
    assert "Hikvision" in msg_hik
    assert len(hik_adapter.prompts) == 1
