from __future__ import annotations

from typing import Sequence

from .drivers.zkteco import RawClockAttendanceRecord


class SimulatedZKTecoClock:
    """
    Simulador determinista de reloj ZKTeco (TCP 4370 / memoria) para pruebas
    de captura en vivo, reconciliación tras caída de red y transición DST en Tijuana.
    """

    def __init__(self, initial_records: Sequence[RawClockAttendanceRecord] | None = None) -> None:
        self._records: list[RawClockAttendanceRecord] = list(initial_records or [])

    def emit_punch(
        self,
        *,
        user_id: str,
        timestamp_local: str,
        punch_code: int = 0,
        status_code: int = 1,
        fold: int = 0,
    ) -> RawClockAttendanceRecord:
        rec = RawClockAttendanceRecord(
            user_id=user_id,
            timestamp_local=timestamp_local,
            punch_code=punch_code,
            status_code=status_code,
            fold=fold,
        )
        self._records.append(rec)
        return rec

    def get_attendance_since(
        self, since_timestamp_local: str | None
    ) -> list[RawClockAttendanceRecord]:
        if since_timestamp_local is None:
            return list(self._records)
        return [
            r for r in self._records if r.timestamp_local >= since_timestamp_local
        ]
