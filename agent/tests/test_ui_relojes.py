from __future__ import annotations

import socket
import threading
from pathlib import Path

from fastapi.testclient import TestClient

from agent.config import unprotect_secret
from agent.db import AgentLocalDatabase
from agent.drivers.network import probe_device_connection, probe_tcp_socket
from agent.ui.app import create_diagnostic_app


def test_sqlite_fuentes_locales_crud_and_encryption(tmp_path: Path) -> None:
    db = AgentLocalDatabase(tmp_path / "clocks_crud.sqlite")

    # 1. Crear reloj ZKTeco
    zk_id = "zk-otay-01"
    db.upsert_fuente_local(
        clock_id=zk_id,
        nombre="ZKTeco Entrada Principal",
        tipo="ZKTECO",
        ip="192.168.1.201",
        puerto=4370,
        comm_key=1234,
        activo=True,
    )

    # 2. Crear reloj Hikvision con contraseña cifrada
    hik_id = "hik-almacen-01"
    from agent.config import protect_secret

    secret_pass = "HikAdmin2026!"
    cifrada = protect_secret(secret_pass)

    db.upsert_fuente_local(
        clock_id=hik_id,
        nombre="Hikvision Almacén",
        tipo="HIKVISION",
        ip="192.168.1.202",
        puerto=80,
        usuario="admin",
        password_cifrada=cifrada,
        activo=True,
    )

    # 3. Listar relojes
    clocks = db.list_fuentes_locales()
    assert len(clocks) == 2

    # 4. Obtener por ID y verificar que la contraseña en BD está cifrada
    hik = db.get_fuente_local(hik_id)
    assert hik is not None
    assert hik.nombre == "Hikvision Almacén"
    assert hik.password_cifrada is not None
    assert hik.password_cifrada != secret_pass  # Está cifrada
    assert unprotect_secret(hik.password_cifrada) == secret_pass  # Se descifra correctamente

    # 5. Actualizar ping status
    db.update_fuente_ping_status(zk_id, ok=True)
    zk = db.get_fuente_local(zk_id)
    assert zk is not None
    assert zk.ultimo_ping is not None
    assert zk.ultimo_error is None

    db.update_fuente_ping_status(zk_id, ok=False, error="Timeout 3s")
    zk_err = db.get_fuente_local(zk_id)
    assert zk_err is not None
    assert zk_err.ultimo_error == "Timeout 3s"

    # 6. Eliminar reloj
    deleted = db.delete_fuente_local(zk_id)
    assert deleted is True
    assert db.get_fuente_local(zk_id) is None
    assert len(db.list_fuentes_locales()) == 1

    db.close()


def test_api_relojes_endpoints_and_live_test(tmp_path: Path) -> None:
    db = AgentLocalDatabase(tmp_path / "clocks_api.sqlite")
    app = create_diagnostic_app(db=db)
    client = TestClient(app)

    # 1. Crear nuevo reloj sin autenticar debe retornar 401
    resp_unauth = client.post(
        "/api/relojes",
        json={"nombre": "Terminal Comedor", "tipo": "ZKTECO", "ip": "10.0.0.50"},
    )
    assert resp_unauth.status_code == 401

    # Iniciar sesión de administrador (con PIN local de emergencia)
    resp_login = client.post("/api/auth/login", json={"pin_emergencia": "123456"})
    assert resp_login.status_code == 200

    # Ahora crear nuevo reloj vía POST /api/relojes autenticado
    resp_create = client.post(
        "/api/relojes",
        json={
            "nombre": "Terminal Comedor",
            "tipo": "ZKTECO",
            "ip": "10.0.0.50",
            "puerto": 4370,
            "comm_key": 0,
            "activo": True,
        },
    )
    assert resp_create.status_code == 200
    clock_id = resp_create.json()["id"]

    # 2. Listar relojes vía GET /api/relojes
    resp_list = client.get("/api/relojes")
    assert resp_list.status_code == 200
    clocks = resp_list.json()
    assert len(clocks) == 1
    assert clocks[0]["id"] == clock_id
    assert clocks[0]["nombre"] == "Terminal Comedor"
    assert clocks[0]["tipo"] == "ZKTECO"

    # 3. Probar conexión en vivo vía POST /api/relojes/test
    # Con una IP inexistente debe responder ok: False sin lanzar 500
    resp_test = client.post(
        "/api/relojes/test",
        json={
            "id": clock_id,
            "tipo": "ZKTECO",
            "ip": "127.0.0.1",
            "puerto": 59999,  # Puerto cerrado
        },
    )
    assert resp_test.status_code == 200
    test_data = resp_test.json()
    assert test_data["ok"] is False
    assert any(term in test_data["mensaje"].lower() for term in ("fallo", "rechazada", "agotado", "error"))

    # 4. Eliminar reloj vía DELETE /api/relojes/{id}
    resp_del = client.delete(f"/api/relojes/{clock_id}")
    assert resp_del.status_code == 200
    assert len(client.get("/api/relojes").json()) == 0

    db.close()


def test_probe_tcp_socket_live_server() -> None:
    # Levantar un socket servidor temporal para probar probe_tcp_socket y latencia
    server_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server_sock.bind(("127.0.0.1", 0))
    server_sock.listen(1)
    port = server_sock.getsockname()[1]

    def accept_once() -> None:
        try:
            conn, _ = server_sock.accept()
            conn.close()
        except Exception:
            pass

    t = threading.Thread(target=accept_once, daemon=True)
    t.start()

    ok, msg, lat = probe_tcp_socket("127.0.0.1", port, timeout=2.0)
    server_sock.close()

    assert ok is True
    assert "exitosa" in msg.lower()
    assert lat >= 0.0

    # Probar con probe_device_connection
    ok_dev, _, _ = probe_device_connection(tipo="ZKTECO", ip="127.0.0.1", puerto=59998, timeout=0.5)
    assert ok_dev is False
