from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

from agent.db import AgentLocalDatabase
from agent.sync import CloudSyncClient, verify_technician_credentials
from agent.ui.app import create_diagnostic_app


def test_ui_admin_auth_and_cloud_diagnostics(tmp_path: Path) -> None:
    db = AgentLocalDatabase(tmp_path / "auth_cloud.sqlite")
    agente_id = "11111111-0004-4000-8000-000000000001"
    db.set_config("agente_id", agente_id)
    db.set_config("tenant_id", "22222222-0002-4000-8000-000000000002")

    def mock_cloud_transport(path: str, raw_body: str, headers: dict[str, str]) -> tuple[int, dict[str, Any]]:
        if "/api/v1/agente/verificar-tecnico" in path:
            import json
            data = json.loads(raw_body)
            if data.get("email") == "superadmin@smclock.local" and data.get("password") == "SecretPass123!":
                return 200, {
                    "ok": True,
                    "usuario": {
                        "id": "33333333-0003-4000-8000-000000000003",
                        "email": "superadmin@smclock.local",
                        "nombre_completo": "Super Admin SaaS",
                        "rol": "SUPER_ADMIN",
                        "tenant_id": None,
                    },
                }
            return 401, {"ok": False, "error": "Credenciales inválidas"}

        if "/api/v1/agente/latido" in path:
            return 200, {
                "ok": True,
                "server_ts_utc": "2026-11-15T23:59:00Z",
                "clock_drift_seconds": 1.2,
                "alerta_deriva_reloj": False,
            }

        if "/api/v1/agente/checadas" in path:
            return 200, {
                "ok": True,
                "lote_id": "test_lote",
                "recibidas": 1,
                "insertadas": 1,
                "duplicadas_ignoradas": 0,
            }

        if "/api/v1/agente/sync-empleados" in path:
            return 200, {
                "ok": True,
                "empleados": [
                    {
                        "id": "44444444-0004-4000-8000-000000000004",
                        "codigo_empleado": "EMP001",
                        "nombre_completo": "Carlos Santana",
                        "activo": True,
                    }
                ],
            }

        return 404, {"error": "No encontrado"}

    sync_client = CloudSyncClient(
        db=db,
        agente_id=agente_id,
        credencial_token="token_test_12345",
        transport_post=mock_cloud_transport,
    )

    app = create_diagnostic_app(db=db, sync_client=sync_client)
    client = TestClient(app)

    # 1. Sesión inicial no autenticada
    resp_me = client.get("/api/auth/me")
    assert resp_me.status_code == 200
    assert resp_me.json()["authenticated"] is False

    # 2. Login con PIN erróneo
    resp_pin_bad = client.post("/api/auth/login", json={"pin_emergencia": "999999"})
    assert resp_pin_bad.status_code == 401

    # 3. Login con contraseña en la nube inválida
    resp_cloud_bad = client.post(
        "/api/auth/login",
        json={"email": "superadmin@smclock.local", "password": "WrongPassword"},
    )
    assert resp_cloud_bad.status_code == 401

    # 4. Login con credenciales de Super-Admin válidas
    resp_login = client.post(
        "/api/auth/login",
        json={"email": "superadmin@smclock.local", "password": "SecretPass123!"},
    )
    assert resp_login.status_code == 200
    assert resp_login.json()["ok"] is True
    assert resp_login.json()["usuario"]["rol"] == "SUPER_ADMIN"

    # 5. Probar diagnósticos Cloud
    latido_res = client.post("/api/cloud-test/latido")
    assert latido_res.status_code == 200
    assert latido_res.json()["ok"] is True
    assert latido_res.json()["status_code"] == 200

    checadas_res = client.post("/api/cloud-test/checadas")
    assert checadas_res.status_code == 200
    assert checadas_res.json()["ok"] is True
    assert checadas_res.json()["status_code"] == 200

    empleados_res = client.post("/api/cloud-test/empleados")
    assert empleados_res.status_code == 200
    assert empleados_res.json()["ok"] is True
    assert empleados_res.json()["empleados_actualizados"] == 1

    # Verificar que el empleado se guardó en SQLite
    emp = db.get_empleado_by_codigo("EMP001")
    assert emp is not None
    assert emp.nombre_completo == "Carlos Santana"
    assert emp.activo is True

    # 6. Logout
    client.post("/api/auth/logout")
    assert client.get("/api/auth/me").json()["authenticated"] is False

    db.close()
