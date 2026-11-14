from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, Sequence

from ..config import resolve_device_timestamp
from ..db import AgentLocalDatabase

VERIFICACION_ZK_MAP: dict[int, str] = {
    0: "PIN",
    1: "HUELLA",
    2: "TARJETA",
    15: "ROSTRO",
}

MARCA_ZK_MAP: dict[int, str] = {
    0: "ENTRADA",
    1: "SALIDA",
    2: "SALIDA",
    3: "ENTRADA",
}


@dataclass(frozen=True)
class RawClockAttendanceRecord:
    """
    Registro de checada crudo leído de un reloj ZKTeco.
    PRIVACIDAD LFPDPPP: Jamás incluye plantillas biométricas ni imágenes faciales;
    únicamente código de empleado, timestamp local del reloj y código numérico de evento.
    """

    user_id: str
    timestamp_local: str
    punch_code: int = 0
    status_code: int = 1
    fold: int = 0


class ZKTecoDeviceAdapter(Protocol):
    def get_attendance_since(
        self, since_timestamp_local: str | None
    ) -> Sequence[RawClockAttendanceRecord]: ...


class ZKTecoDriver:
    """
    Driver ZKTeco con captura en vivo y reconciliación periódica cada 30 minutos
    desde el último timestamp procesado hacia adelante.
    """

    def __init__(
        self,
        *,
        fuente_id: str,
        tz_name: str = "America/Tijuana",
        db: AgentLocalDatabase,
        adapter: ZKTecoDeviceAdapter,
    ) -> None:
        self.fuente_id = fuente_id
        self.tz_name = tz_name
        self.db = db
        self.adapter = adapter

    def process_raw_record(self, record: RawClockAttendanceRecord) -> bool:
        resolved = resolve_device_timestamp(
            record.timestamp_local,
            tz_name=self.tz_name,
            fold=record.fold,
        )
        tipo_marca = MARCA_ZK_MAP.get(record.punch_code, "CHECADA")
        tipo_verificacion = VERIFICACION_ZK_MAP.get(record.status_code, "HUELLA")

        return self.db.enqueue_punch(
            fuente_id=self.fuente_id,
            codigo_empleado=record.user_id.strip(),
            ts_utc=resolved.ts_utc,
            ts_dispositivo_local=resolved.ts_dispositivo_local,
            ambigua=resolved.ambigua,
            tipo_marca=tipo_marca,
            tipo_verificacion=tipo_verificacion,
        )

    def reconcile_missing_punches(self) -> int:
        """
        Reconciliación periódica (cada 30 min): lee del reloj desde el último
        timestamp local registrado hacia adelante e inserta de forma idempotente
        cualquier checada no capturada por `live_capture`.
        """
        since_ts = self.db.get_last_reconciled_ts(self.fuente_id)
        records = self.adapter.get_attendance_since(since_ts)
        inserted = 0
        latest_ts = since_ts

        for rec in records:
            if self.process_raw_record(rec):
                inserted += 1
            if latest_ts is None or rec.timestamp_local > latest_ts:
                latest_ts = rec.timestamp_local

        if latest_ts is not None:
            self.db.set_last_reconciled_ts(self.fuente_id, latest_ts)

        return inserted
