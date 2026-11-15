from __future__ import annotations

import json
from pathlib import Path

from agent.db import AgentLocalDatabase, QueuedPunch
from agent.targets.layouts import (
    CONTPAQiLayoutGenerator,
    ContpaqiMovimiento,
    TRESSLayoutGenerator,
)
from agent.targets.rh4000 import RH4000Client, RH4000Config

FIXTURES_DIR = Path(__file__).resolve().parents[2] / "docs" / "fixtures"


def test_contpaqi_layout_generation_and_atomic_write(tmp_path: Path) -> None:
    gen = CONTPAQiLayoutGenerator(encoding="utf-8", line_ending="\r\n")

    movimientos = [
        ContpaqiMovimiento(codigo_empleado="1001", fecha="2026-11-14", clave_incidencia="REG", cantidad=1.0),
        ContpaqiMovimiento(codigo_empleado="1002", fecha="2026-11-14", clave_incidencia="RT", cantidad=0.37),
        ContpaqiMovimiento(codigo_empleado="1001", fecha="2026-11-14", clave_incidencia="HE2", cantidad=2.0),
        ContpaqiMovimiento(codigo_empleado="1005", fecha="2026-11-14", clave_incidencia="RDS", cantidad=1.0),
    ]

    rendered = gen.render(movimientos)
    assert "\r\n" in rendered
    lines = [l for l in rendered.split("\r\n") if l]
    assert lines[0] == "CodigoEmpleado,Fecha(YYYYMMDD),ClaveIncidencia,Cantidad"
    assert lines[1] == "1001,20261114,REG,1.00"
    assert lines[2] == "1002,20261114,RT,0.37"

    # Comparar contra fixture si existe
    sample_path = FIXTURES_DIR / "contpaqi" / "MovimientosDyHporperiodo_sample.txt"
    if sample_path.exists():
        sample_text = sample_path.read_text(encoding="utf-8")
        assert rendered.replace("\r\n", "\n").strip() == sample_text.replace("\r\n", "\n").strip()

    # Escritura atómica a disco
    target_file = tmp_path / "layouts" / "MovimientosDyHporperiodo.cfg"
    out_path = gen.write_atomic(target_file, movimientos)
    assert out_path.exists()
    assert target_file.read_bytes() == rendered.encode("utf-8")


def test_tress_layout_generation_and_atomic_write(tmp_path: Path) -> None:
    gen = TRESSLayoutGenerator(encoding="utf-8", line_ending="\r\n", default_terminal="01")

    punches = [
        QueuedPunch(
            id=1,
            fuente_id="11111111-0003-4000-8000-000000000001",
            codigo_empleado="1001",
            ts_utc="2026-11-14T16:01:23.000Z",
            ts_dispositivo_local="2026-11-14 08:01:23",
            ambigua=False,
            tipo_marca="ENTRADA",
            tipo_verificacion="ROSTRO",
            sincronizado=True,
        ),
        QueuedPunch(
            id=2,
            fuente_id="11111111-0003-4000-8000-000000000001",
            codigo_empleado="1002",
            ts_utc="2026-11-14T16:03:45.000Z",
            ts_dispositivo_local="2026-11-14 08:03:45",
            ambigua=False,
            tipo_marca="ENTRADA",
            tipo_verificacion="HUELLA",
            sincronizado=True,
        ),
    ]

    rendered = gen.render(punches)
    lines = [l for l in rendered.split("\r\n") if l]
    assert lines[0] == "NoEmpleado,Fecha(DD/MM/YYYY),Hora(HH:MM:SS),Terminal"
    assert lines[1] == "1001,14/11/2026,08:01:23,01"
    assert lines[2] == "1002,14/11/2026,08:03:45,01"

    # Escritura atómica a disco
    target_file = tmp_path / "layouts" / "tress_checadas.txt"
    out_path = gen.write_atomic(target_file, punches)
    assert out_path.exists()
    assert not target_file.with_suffix(".txt.tmp").exists()


def test_rh4000_client_dispatch_and_audit(tmp_path: Path) -> None:
    db = AgentLocalDatabase(tmp_path / "rh4000_test.sqlite")
    cfg = RH4000Config(
        client_domain="planta-tijuana",
        bearer_token="rh4000_test_token_12345",
        company_code="001",
        access_point_code="001",
    )

    captured_requests: list[tuple[str, dict[str, str], str]] = []

    def mock_transport(url: str, headers: dict[str, str], raw_body: str) -> tuple[int, str]:
        captured_requests.append((url, headers, raw_body))
        return 201, '{"status": "created"}'

    client = RH4000Client(config=cfg, db=db, transport_post=mock_transport)

    punch = QueuedPunch(
        id=1,
        fuente_id="11111111-0003-4000-8000-000000000001",
        codigo_empleado="1001",
        ts_utc="2026-11-14T16:01:23.000Z",
        ts_dispositivo_local="2026-11-14 08:01:23",
        ambigua=False,
        tipo_marca="ENTRADA",
        tipo_verificacion="ROSTRO",
        sincronizado=True,
    )

    success = client.dispatch_punch(punch)
    assert success is True
    assert len(captured_requests) == 1

    url, headers, raw_body = captured_requests[0]
    assert url == "https://planta-tijuana.rh4000.com/api/v1/Employees/1001/Attendance"
    assert headers["Authorization"] == "Bearer rh4000_test_token_12345"
    assert "X-Idempotency-Key" in headers

    payload = json.loads(raw_body)
    assert payload["employeeCode"] == "1001"
    assert payload["accessType"] == "1"  # Entrada
    assert payload["eventDate"] == "2026-11-14T08:01:23"

    # Verificar que quedó registrado en envios_destino_local
    cur = db._conn.cursor()
    row = cur.execute("SELECT * FROM envios_destino_local WHERE destino = 'RH4000';").fetchone()
    assert row is not None
    assert row["estatus"] == "ENVIADO"
    assert row["registros_procesados"] == 1

    db.close()
