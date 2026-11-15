from __future__ import annotations

import json
from pathlib import Path

from agent.db import AgentLocalDatabase
from agent.drivers.zkteco import (
    RawClockAttendanceRecord,
    ZKTecoDriver,
    parse_adms_payload,
    parse_attlog_dat,
    parse_live_socket_event,
    parse_pyzk_json,
    parse_zktime_csv,
)
from agent.simulator import SimulatedZKTecoClock

FIXTURES_DIR = Path(__file__).resolve().parents[2] / "docs" / "fixtures" / "zkteco"


def test_parse_1_attlog_dat_fixture() -> None:
    dat_file = FIXTURES_DIR / "1_attlog.dat"
    records = parse_attlog_dat(dat_file)

    assert len(records) == 5
    assert records[0].user_id == "1001"
    assert records[0].timestamp_local == "2026-11-14 08:01:23"
    assert records[0].status_code == 15  # Rostro
    assert records[0].punch_code == 0  # Entrada

    assert records[1].user_id == "1002"
    assert records[1].status_code == 1  # Huella
    assert records[1].punch_code == 0

    assert records[3].user_id == "1003"
    assert records[3].punch_code == 1  # Salida


def test_parse_zktime_export_csv_fixture() -> None:
    csv_file = FIXTURES_DIR / "zktime_export_sample.csv"
    records = parse_zktime_csv(csv_file)

    assert len(records) == 5
    assert records[0].user_id == "1001"
    assert records[0].timestamp_local == "2026-11-14 08:01:23"
    assert records[0].punch_code == 0  # Check-In
    assert records[0].status_code == 15  # Face

    assert records[3].user_id == "1003"
    assert records[3].punch_code == 1  # Check-Out
    assert records[3].status_code == 2  # Card


def test_parse_pyzk_json_fixture() -> None:
    json_file = FIXTURES_DIR / "pyzk_attendance_records.json"
    records = parse_pyzk_json(json_file)

    assert len(records) == 5
    assert records[0].user_id == "1001"
    assert records[0].timestamp_local == "2026-11-14 08:01:23"
    assert records[0].punch_code == 0
    assert records[0].status_code == 15


def test_parse_adms_push_payload_fixture() -> None:
    adms_file = FIXTURES_DIR / "adms_iclock_push_payload.txt"
    records = parse_adms_payload(adms_file)

    assert len(records) == 5
    assert records[0].user_id == "1001"
    assert records[0].timestamp_local == "2026-11-14 08:01:23"
    assert records[0].punch_code == 0
    assert records[0].status_code == 15

    assert records[4].user_id == "1001"
    assert records[4].punch_code == 1  # Out


def test_parse_live_socket_event_fixture() -> None:
    event_file = FIXTURES_DIR / "zk_live_capture_event.json"
    data = json.loads(event_file.read_text(encoding="utf-8"))
    rec = parse_live_socket_event(data)

    assert rec is not None
    assert rec.user_id == "1001"
    assert rec.timestamp_local == "2026-11-14 08:01:23"
    assert rec.status_code == 15
    assert rec.punch_code == 0


def test_zkteco_driver_connection_and_processing(tmp_path: Path) -> None:
    db = AgentLocalDatabase(tmp_path / "zk_test.sqlite")
    sim = SimulatedZKTecoClock()
    driver = ZKTecoDriver(
        fuente_id="11111111-0003-4000-8000-000000000001",
        nombre="ZKTeco Entrada",
        tz_name="America/Tijuana",
        db=db,
        adapter=sim,
    )

    ok, msg = driver.test_connection()
    assert ok is True
    assert "exitosa" in msg.lower()

    # Reconciliar eventos
    sim.emit_punch(user_id="1005", timestamp_local="2026-11-14 08:00:00", punch_code=0, status_code=1)
    inserted = driver.reconcile_missing_punches()
    assert inserted == 1
    assert db.count_pending() == 1

    status = driver.get_status()
    assert status["conectado"] is True
    assert status["tipo"] == "ZKTECO"

    db.close()
