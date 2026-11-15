from __future__ import annotations

from pathlib import Path

from agent.db import AgentLocalDatabase
from agent.drivers.tacloud import (
    RawTACloudPunch,
    TACloudDriver,
    parse_oauth_token,
    parse_punchlogs_json,
    parse_tacloud_15col_csv,
)

FIXTURES_DIR = Path(__file__).resolve().parents[2] / "docs" / "fixtures" / "tacloud"


def test_parse_oauth_token_fixture() -> None:
    token_file = FIXTURES_DIR / "oauth_token_response.json"
    data = parse_oauth_token(token_file)

    assert data["token_type"] == "bearer"
    assert "access_token" in data
    assert data["expires_in"] == 86400
    assert data["userName"] == "admin@empresa.mx"


def test_parse_exportacion_generica_15col_fixture() -> None:
    csv_file = FIXTURES_DIR / "exportacion_generica_15col.csv"
    records = parse_tacloud_15col_csv(csv_file)

    # El CSV tiene 7 filas con datos, 1 es 'Sin Checada' con 'FALTA' que se filtra
    assert len(records) == 6
    assert records[0].codigo_empleado == "1001"
    assert records[0].tipo_checada == "Entrada"
    assert records[0].codigo_incidencia == "REG"
    assert records[0].dispositivo == "Checador Entrada Planta"

    # Fila 2: Maria Lopez Garcia con retardo
    assert records[1].codigo_empleado == "1002"
    assert records[1].codigo_incidencia == "RT"
    assert records[1].minutos_retardo == 22

    # Fila 5: Roberto Sanchez con descanso obligatorio (RDS)
    assert records[3].codigo_empleado == "1005"
    assert records[3].codigo_incidencia == "RDS"

    # Fila 7: Juan Perez salida con horas extra
    assert records[5].codigo_empleado == "1001"
    assert records[5].tipo_checada == "Salida"
    assert records[5].horas_extra == 2.0


def test_parse_punchlogs_json_fixture() -> None:
    json_file = FIXTURES_DIR / "punchlogs_response.json"
    records = parse_punchlogs_json(json_file)

    assert len(records) == 5
    assert records[0].codigo_empleado == "1001"
    assert records[0].tipo_checada == "ENTRADA"
    assert records[0].metodo_verificacion == "ROSTRO"
    assert records[0].fecha_hora_utc == "2026-11-14T16:01:23Z"

    assert records[1].codigo_empleado == "1002"
    assert records[1].metodo_verificacion == "HUELLA"
    assert records[1].minutos_retardo == 22


def test_tacloud_driver_integration(tmp_path: Path) -> None:
    db = AgentLocalDatabase(tmp_path / "tacloud_test.sqlite")
    fuente_id = "33333333-0003-4000-8000-000000000003"

    class MockTACloudAdapter:
        def fetch_punches_since(self, since_ts: str | None) -> list[RawTACloudPunch]:
            return [
                RawTACloudPunch(
                    codigo_empleado="1001",
                    nombre_completo="Juan Perez",
                    fecha_hora_local="2026-11-14 08:01:23",
                    tipo_checada="Entrada",
                    codigo_incidencia="REG",
                    metodo_verificacion="ROSTRO",
                ),
                RawTACloudPunch(
                    codigo_empleado="1002",
                    nombre_completo="Maria Lopez",
                    fecha_hora_local="2026-11-14 08:22:15",
                    tipo_checada="Entrada",
                    codigo_incidencia="RT",
                    minutos_retardo=22,
                    metodo_verificacion="HUELLA",
                ),
            ]

        def is_connected(self) -> bool:
            return True

    driver = TACloudDriver(
        fuente_id=fuente_id,
        nombre="Conector TA.Cloud Maquila",
        tz_name="America/Tijuana",
        db=db,
        adapter=MockTACloudAdapter(),
    )

    ok, msg = driver.test_connection()
    assert ok is True
    assert "exitosa" in msg.lower()

    inserted = driver.reconcile_missing_punches()
    assert inserted == 2
    assert db.count_pending() == 2

    # Sin duplicados en segunda corrida
    assert driver.reconcile_missing_punches() == 0

    punches = db.fetch_pending_batch()
    assert punches[0].tipo_marca == "ENTRADA"
    assert punches[0].tipo_verificacion == "ROSTRO"
    assert punches[1].tipo_verificacion == "HUELLA"

    db.close()
