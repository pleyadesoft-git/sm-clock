from __future__ import annotations

import json
from pathlib import Path

from agent.db import AgentLocalDatabase
from agent.drivers.hikvision import (
    HikvisionDriver,
    RawHikvisionEvent,
    map_hikvision_marca,
    map_hikvision_verificacion,
    normalize_hikvision_timestamp,
    parse_acs_event_search_json,
    parse_alert_stream_json,
    parse_alert_stream_xml,
    parse_terminal_export_csv,
)

FIXTURES_DIR = Path(__file__).resolve().parents[2] / "docs" / "fixtures" / "hikvision"


def test_parse_acs_event_search_fixture() -> None:
    json_file = FIXTURES_DIR / "acs_event_search_response.json"
    records = parse_acs_event_search_json(json_file)

    assert len(records) == 4
    # Evento 1: Juan Perez 1001 face checkIn
    assert records[0].employee_no == "1001"
    assert records[0].attendance_status == "checkIn"
    assert records[0].verify_mode == "face"
    assert records[0].minor_event == 75

    # Evento 2: Maria Lopez 1002 fingerPrint checkIn
    assert records[1].employee_no == "1002"
    assert records[1].attendance_status == "checkIn"
    assert records[1].verify_mode == "fingerPrint"

    # Evento 3: Carlos Ramirez 1003 card checkOut
    assert records[2].employee_no == "1003"
    assert records[2].card_no == "0008459201"
    assert records[2].attendance_status == "checkOut"
    assert records[2].verify_mode == "card"


def test_parse_alert_stream_json_fixture() -> None:
    json_file = FIXTURES_DIR / "alert_stream_event.json"
    rec = parse_alert_stream_json(json_file)

    assert rec is not None
    assert rec.employee_no == "1001"
    assert rec.attendance_status == "checkIn"
    assert rec.verify_mode == "face"
    assert rec.minor_event == 75
    assert "2026-11-14T08:01:23" in rec.timestamp_raw


def test_parse_alert_stream_xml_fixture() -> None:
    xml_file = FIXTURES_DIR / "alert_stream_event.xml"
    rec = parse_alert_stream_xml(xml_file)

    assert rec is not None
    assert rec.employee_no == "1001"
    assert rec.attendance_status == "checkIn"
    assert rec.verify_mode == "face"
    assert rec.minor_event == 75
    assert "2026-11-14T08:01:23" in rec.timestamp_raw


def test_parse_terminal_export_csv_fixture() -> None:
    csv_file = FIXTURES_DIR / "terminal_export_sample.csv"
    records = parse_terminal_export_csv(csv_file)

    assert len(records) == 5
    assert records[0].employee_no == "1001"
    assert records[0].attendance_status == "Entrada"
    assert records[0].verify_mode == "Rostro"

    assert records[2].employee_no == "1003"
    assert records[2].card_no == "0008459201"
    assert records[2].attendance_status == "Entrada"

    assert records[4].employee_no == "1001"
    assert records[4].attendance_status == "Salida"


def test_hikvision_mappings_and_normalization() -> None:
    assert map_hikvision_marca("checkIn") == "ENTRADA"
    assert map_hikvision_marca("checkOut") == "SALIDA"
    assert map_hikvision_marca("breakOut") == "SALIDA"
    assert map_hikvision_marca("breakIn") == "ENTRADA"
    assert map_hikvision_marca("other") == "CHECADA"

    assert map_hikvision_verificacion("face") == "ROSTRO"
    assert map_hikvision_verificacion("", minor=75) == "ROSTRO"
    assert map_hikvision_verificacion("fingerPrint") == "HUELLA"
    assert map_hikvision_verificacion("", minor=38) == "HUELLA"
    assert map_hikvision_verificacion("card") == "TARJETA"
    assert map_hikvision_verificacion("", minor=1) == "TARJETA"
    assert map_hikvision_verificacion("pw") == "PIN"
    assert map_hikvision_verificacion("", minor=8) == "PIN"

    local, utc = normalize_hikvision_timestamp("2026-11-14T08:01:23-08:00")
    assert local == "2026-11-14 08:01:23"
    assert utc == "2026-11-14T16:01:23.000Z"


def test_hikvision_driver_integration(tmp_path: Path) -> None:
    db = AgentLocalDatabase(tmp_path / "hik_test.sqlite")
    fuente_id = "22222222-0003-4000-8000-000000000002"

    class MockHikvisionAdapter:
        def search_events(self, start_time: str | None) -> list[RawHikvisionEvent]:
            return [
                RawHikvisionEvent(
                    employee_no="1001",
                    timestamp_raw="2026-11-14T08:01:23-08:00",
                    attendance_status="checkIn",
                    verify_mode="face",
                    minor_event=75,
                ),
                RawHikvisionEvent(
                    employee_no="1002",
                    timestamp_raw="2026-11-14T08:03:45-08:00",
                    attendance_status="checkIn",
                    verify_mode="fingerPrint",
                    minor_event=38,
                ),
            ]

        def is_connected(self) -> bool:
            return True

    driver = HikvisionDriver(
        fuente_id=fuente_id,
        nombre="Hikvision Almacen",
        tz_name="America/Tijuana",
        db=db,
        adapter=MockHikvisionAdapter(),
    )

    ok, msg = driver.test_connection()
    assert ok is True
    assert "exitosa" in msg.lower()

    inserted = driver.reconcile_missing_punches()
    assert inserted == 2
    assert db.count_pending() == 2

    # Segunda reconciliación no duplica
    assert driver.reconcile_missing_punches() == 0

    punches = db.fetch_pending_batch()
    assert len(punches) == 2
    assert punches[0].tipo_marca == "ENTRADA"
    assert punches[0].tipo_verificacion == "ROSTRO"
    assert punches[1].tipo_verificacion == "HUELLA"

    db.close()
