from __future__ import annotations

import json
from pathlib import Path

from agent.config import resolve_device_timestamp
from agent.db import AgentLocalDatabase
from agent.drivers.zkteco import RawClockAttendanceRecord, ZKTecoDriver
from agent.simulator import SimulatedZKTecoClock
from agent.sync import (
    CloudSyncClient,
    build_signed_headers,
    compute_agent_hmac_signature,
    compute_backoff_seconds,
    sha256_hex,
)
from agent.ui.app import LOCAL_DIAGNOSTIC_HOST, LOCAL_DIAGNOSTIC_PORT, get_diagnostic_status


def test_tijuana_autumn_dst_repeated_hour_detection() -> None:
    """
    En America/Tijuana el primer domingo de noviembre (2026-11-01) a las 02:00 PDT
    el reloj retrocede a 01:00 PST. El intervalo 01:00-01:59 ocurre dos veces:
    - fold=0 -> UTC-7 (08:30:00.000Z)
    - fold=1 -> UTC-8 (09:30:00.000Z)
    Ambos deben marcar ambigua=True.
    """
    r_fold0 = resolve_device_timestamp("2026-11-01 01:30:00", "America/Tijuana", fold=0)
    r_fold1 = resolve_device_timestamp("2026-11-01 01:30:00", "America/Tijuana", fold=1)

    assert r_fold0.ambigua is True
    assert r_fold1.ambigua is True
    assert r_fold0.ts_utc == "2026-11-01T08:30:00.000Z"
    assert r_fold1.ts_utc == "2026-11-01T09:30:00.000Z"

    # Un horario normal de invierno no es ambiguo
    r_winter = resolve_device_timestamp("2026-01-15 08:00:00", "America/Tijuana")
    assert r_winter.ambigua is False
    assert r_winter.ts_utc == "2026-01-15T16:00:00.000Z"


def test_sqlite_wal_queue_and_transactional_sync(tmp_path: Path) -> None:
    db_file = tmp_path / "agent_queue.sqlite"
    db = AgentLocalDatabase(db_file)

    assert db.get_journal_mode() == "wal"

    fuente_id = "11111111-0003-4000-8000-000000000001"
    inserted_1 = db.enqueue_punch(
        fuente_id=fuente_id,
        codigo_empleado="1001",
        ts_utc="2026-11-01T08:30:00.000Z",
        ts_dispositivo_local="2026-11-01 01:30:00",
        ambigua=True,
        tipo_marca="ENTRADA",
        tipo_verificacion="HUELLA",
    )
    # Duplicado exacto debe ser ignorado por UNIQUE (fuente_id, codigo_empleado, ts_utc)
    inserted_dup = db.enqueue_punch(
        fuente_id=fuente_id,
        codigo_empleado="1001",
        ts_utc="2026-11-01T08:30:00.000Z",
        ts_dispositivo_local="2026-11-01 01:30:00",
        ambigua=True,
        tipo_marca="ENTRADA",
        tipo_verificacion="HUELLA",
    )
    assert inserted_1 is True
    assert inserted_dup is False
    assert db.count_pending() == 1

    # Si el servidor devuelve 503 (corte de internet), NO se marca sincronizado=1
    def failing_transport(
        _path: str, _raw_body: str, _headers: dict[str, str]
    ) -> tuple[int, dict[str, object]]:
        return 503, {"error": "Sin red"}

    sync_fail = CloudSyncClient(
        db=db,
        agente_id="11111111-0004-4000-8000-000000000001",
        credencial_token="agt_live_" + "a" * 64,
        transport_post=failing_transport,
    )
    assert sync_fail.flush_pending_batch() == 0
    assert db.count_pending() == 1

    # Cuando vuelve internet y el servidor devuelve 200 OK, se marca sincronizado=1
    captured_requests: list[tuple[str, str, dict[str, str]]] = []

    def ok_transport(
        path: str, raw_body: str, headers: dict[str, str]
    ) -> tuple[int, dict[str, object]]:
        captured_requests.append((path, raw_body, headers))
        return 200, {"ok": True, "insertadas": 1}

    sync_ok = CloudSyncClient(
        db=db,
        agente_id="11111111-0004-4000-8000-000000000001",
        credencial_token="agt_live_" + "a" * 64,
        transport_post=ok_transport,
    )
    assert sync_ok.flush_pending_batch() == 1
    assert db.count_pending() == 0
    assert len(captured_requests) == 1

    path, raw_body, headers = captured_requests[0]
    assert path == "/api/v1/agente/checadas"
    body_json = json.loads(raw_body)
    assert len(body_json["checadas"]) == 1
    assert body_json["checadas"][0]["ambigua"] is True
    assert "x-agent-signature" in headers

    db.close()


def test_zkteco_simulator_and_30min_reconciliation(tmp_path: Path) -> None:
    db = AgentLocalDatabase(tmp_path / "reconcile.sqlite")
    fuente_id = "11111111-0003-4000-8000-000000000001"
    clock = SimulatedZKTecoClock()
    driver = ZKTecoDriver(
        fuente_id=fuente_id,
        tz_name="America/Tijuana",
        db=db,
        adapter=clock,
    )

    # Emitir 3 checadas mientras el agente estaba desconectado del reloj
    clock.emit_punch(
        user_id="1001",
        timestamp_local="2026-11-01 01:30:00",
        punch_code=0,
        status_code=1,
        fold=0,
    )
    clock.emit_punch(
        user_id="1001",
        timestamp_local="2026-11-01 01:30:00",
        punch_code=1,
        status_code=1,
        fold=1,
    )
    clock.emit_punch(
        user_id="1002",
        timestamp_local="2026-11-01 07:00:00",
        punch_code=0,
        status_code=15,
    )

    # Reconciliación recupera las 3 checadas (incluyendo las dos en la hora repetida de otoño)
    recovered = driver.reconcile_missing_punches()
    assert recovered == 3
    assert db.count_pending() == 3

    # Segunda reconciliación sin nuevas checadas inserta 0 duplicados
    recovered_again = driver.reconcile_missing_punches()
    assert recovered_again == 0

    diag = get_diagnostic_status(db, agente_id="11111111-0004-4000-8000-000000000001")
    assert diag["bind"] == f"{LOCAL_DIAGNOSTIC_HOST}:{LOCAL_DIAGNOSTIC_PORT}"
    assert diag["cola_pendiente"] == 3

    db.close()


def test_hmac_signature_and_backoff_bounds() -> None:
    token = "agt_live_" + "b" * 64
    raw_body = '{"lote_id":"test","checadas":[]}'
    headers = build_signed_headers(
        agente_id="11111111-0004-4000-8000-000000000001",
        credencial_token=token,
        raw_body=raw_body,
        timestamp=1763050000,
        nonce="nonce_fixed_0123456789",
    )
    expected = compute_agent_hmac_signature(
        credencial_token=token,
        timestamp="1763050000",
        nonce="nonce_fixed_0123456789",
        raw_body=raw_body,
    )
    assert headers["x-agent-signature"] == expected
    assert len(sha256_hex(token)) == 64

    b0 = compute_backoff_seconds(0, base=1.0, cap=60.0)
    b4 = compute_backoff_seconds(4, base=1.0, cap=60.0)
    assert 1.0 <= b0 <= 1.25
    assert 16.0 <= b4 <= 20.0
