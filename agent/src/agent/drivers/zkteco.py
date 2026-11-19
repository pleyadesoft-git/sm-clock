from __future__ import annotations

import csv
import io
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol, Sequence

from ..config import resolve_device_timestamp
from ..db import AgentLocalDatabase
from .base import BaseClockDriver

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
    4: "ENTRADA",
    5: "SALIDA",
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


# --- Parsers de fixtures y protocolos ZKTeco ---

def parse_attlog_dat(content_or_path: str | Path) -> list[RawClockAttendanceRecord]:
    """
    Parsea archivo de volcado directo USB `1_attlog.dat` (delimitado por tabuladores).
    Estructura típica de firmware ZKTeco:
    PIN \t Time \t VerifyType \t PunchCode \t WorkCode \t Reserved
    """
    if isinstance(content_or_path, Path) or (isinstance(content_or_path, str) and "\n" not in content_or_path and Path(content_or_path).exists()):
        text = Path(content_or_path).read_text(encoding="utf-8")
    else:
        text = str(content_or_path)

    records: list[RawClockAttendanceRecord] = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        parts = line.split("\t")
        if len(parts) >= 2:
            user_id = parts[0].strip()
            ts = parts[1].strip()
            # En 1_attlog.dat: col 2 es verify_type (15=rostro, 1=huella), col 3 es punch_code (0=in, 1=out)
            verify_type = int(parts[2].strip()) if len(parts) > 2 and parts[2].strip().isdigit() else 1
            punch_code = int(parts[3].strip()) if len(parts) > 3 and parts[3].strip().isdigit() else 0
            records.append(
                RawClockAttendanceRecord(
                    user_id=user_id,
                    timestamp_local=ts,
                    punch_code=punch_code,
                    status_code=verify_type,
                )
            )
    return records


def parse_zktime_csv(content_or_path: str | Path) -> list[RawClockAttendanceRecord]:
    """
    Parsea archivo CSV exportado desde ZKTime.Net / BioTime.
    Columnas: "User ID","Name","Time","State","Verify Type","WorkCode"
    """
    if isinstance(content_or_path, Path) or (isinstance(content_or_path, str) and "\n" not in content_or_path and Path(content_or_path).exists()):
        text = Path(content_or_path).read_text(encoding="utf-8")
    else:
        text = str(content_or_path)

    records: list[RawClockAttendanceRecord] = []
    reader = csv.DictReader(io.StringIO(text))
    for row in reader:
        user_id = row.get("User ID", "").strip()
        ts = row.get("Time", "").strip()
        state = row.get("State", "").strip().lower()
        v_type = row.get("Verify Type", "").strip().lower()

        # Mapeo de estado
        punch_code = 1 if "out" in state or "salida" in state else 0

        # Mapeo de verificación
        if "face" in v_type or "rostro" in v_type:
            status_code = 15
        elif "card" in v_type or "tarjeta" in v_type:
            status_code = 2
        elif "pw" in v_type or "pin" in v_type or "password" in v_type:
            status_code = 0
        else:
            status_code = 1  # Fingerprint

        if user_id and ts:
            records.append(
                RawClockAttendanceRecord(
                    user_id=user_id,
                    timestamp_local=ts,
                    punch_code=punch_code,
                    status_code=status_code,
                )
            )
    return records


def parse_pyzk_json(content_or_path: str | Path | list[dict[str, Any]]) -> list[RawClockAttendanceRecord]:
    """
    Parsea lista de diccionarios devueltos por el SDK Standalone `pyzk` (`get_attendance()`).
    Campos: uid, user_id, timestamp, status (0=in, 1=out), punch (código de verificación).
    """
    if isinstance(content_or_path, list):
        data = content_or_path
    elif isinstance(content_or_path, Path) or (isinstance(content_or_path, str) and "\n" not in content_or_path and Path(content_or_path).exists()):
        data = json.loads(Path(content_or_path).read_text(encoding="utf-8"))
    else:
        data = json.loads(str(content_or_path))

    records: list[RawClockAttendanceRecord] = []
    for item in data:
        user_id = str(item.get("user_id", "")).strip()
        ts = str(item.get("timestamp", "")).strip()
        punch_code = int(item.get("status", 0))
        # En pyzk: el campo 'punch' suele contener el tipo de verificación (15=rostro, 1=huella, 2=tarjeta)
        status_code = int(item.get("punch", 1))
        if user_id and ts:
            records.append(
                RawClockAttendanceRecord(
                    user_id=user_id,
                    timestamp_local=ts,
                    punch_code=punch_code,
                    status_code=status_code,
                )
            )
    return records


def parse_adms_payload(content_or_path: str | Path) -> list[RawClockAttendanceRecord]:
    """
    Parsea payload enviado por protocolo ADMS / iClock push (`POST /iclock/cdata`).
    Tab-separated: PIN \t Time \t PunchCode \t VerifyType \t WorkCode \t Reserved
    """
    if isinstance(content_or_path, Path) or (isinstance(content_or_path, str) and "\n" not in content_or_path and Path(content_or_path).exists()):
        text = Path(content_or_path).read_text(encoding="utf-8")
    else:
        text = str(content_or_path)

    records: list[RawClockAttendanceRecord] = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        parts = line.split("\t")
        if len(parts) >= 2:
            user_id = parts[0].strip()
            ts = parts[1].strip()
            punch_code = int(parts[2].strip()) if len(parts) > 2 and parts[2].strip().isdigit() else 0
            verify_type = int(parts[3].strip()) if len(parts) > 3 and parts[3].strip().isdigit() else 1
            records.append(
                RawClockAttendanceRecord(
                    user_id=user_id,
                    timestamp_local=ts,
                    punch_code=punch_code,
                    status_code=verify_type,
                )
            )
    return records


def parse_live_socket_event(data: dict[str, Any]) -> RawClockAttendanceRecord | None:
    """Parsea evento individual emitido en tiempo real por el socket ZKTeco (`EF_ATTLOG`)."""
    user_id = str(data.get("user_id", "")).strip()
    ts = str(data.get("timestamp", "")).strip()
    if not user_id or not ts:
        return None
    verify_type = int(data.get("verify_type", 1))
    punch_code = int(data.get("verify_state", 0))
    return RawClockAttendanceRecord(
        user_id=user_id,
        timestamp_local=ts,
        punch_code=punch_code,
        status_code=verify_type,
    )


class ZKTecoDeviceAdapter(Protocol):
    def get_attendance_since(
        self, since_timestamp_local: str | None
    ) -> Sequence[RawClockAttendanceRecord]: ...

    def is_connected(self) -> bool: ...


class ZKTecoDriver(BaseClockDriver):
    """
    Driver ZKTeco con captura en vivo y reconciliación periódica cada 30 minutos
    desde el último timestamp procesado hacia adelante.
    """

    def __init__(
        self,
        *,
        fuente_id: str,
        nombre: str = "Reloj ZKTeco",
        tz_name: str = "America/Tijuana",
        db: AgentLocalDatabase,
        adapter: ZKTecoDeviceAdapter,
    ) -> None:
        super().__init__(fuente_id=fuente_id, nombre=nombre, tipo="ZKTECO", tz_name=tz_name)
        self.db = db
        self.adapter = adapter
        self.conectado = True

    def test_connection(self) -> tuple[bool, str]:
        try:
            if hasattr(self.adapter, "is_connected"):
                connected = bool(self.adapter.is_connected())
            else:
                connected = True
            self.conectado = connected
            self.ultimo_error = None if connected else "No se pudo establecer conexión TCP al reloj"
            return (connected, "Conexión exitosa al reloj ZKTeco" if connected else "Fallo de conexión")
        except Exception as exc:
            self.conectado = False
            self.ultimo_error = str(exc)
            return (False, f"Error conectando a ZKTeco: {exc}")

    def process_raw_record(self, record: RawClockAttendanceRecord) -> bool:
        resolved = resolve_device_timestamp(
            record.timestamp_local,
            tz_name=self.tz_name,
            fold=record.fold,
        )
        tipo_marca = MARCA_ZK_MAP.get(record.punch_code, "CHECADA")
        tipo_verificacion = VERIFICACION_ZK_MAP.get(record.status_code, "HUELLA")

        inserted = self.db.enqueue_punch(
            fuente_id=self.fuente_id,
            codigo_empleado=record.user_id.strip(),
            ts_utc=resolved.ts_utc,
            ts_dispositivo_local=resolved.ts_dispositivo_local,
            ambigua=resolved.ambigua,
            tipo_marca=tipo_marca,
            tipo_verificacion=tipo_verificacion,
        )
        self.ultimo_evento_ts = record.timestamp_local
        return inserted

    def reconcile_missing_punches(self) -> int:
        """
        Reconciliación periódica (cada 30 min): lee del reloj desde el último
        timestamp local registrado hacia adelante e inserta de forma idempotente
        cualquier checada no capturada por `live_capture`.
        """
        try:
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

            self.conectado = True
            self.ultimo_error = None
            return inserted
        except Exception as exc:
            self.conectado = False
            self.ultimo_error = f"Error en reconciliación: {exc}"
            return 0

    def send_employee_message(self, user_id: str, message: str, duration_minutes: int = 1440) -> tuple[bool, str]:
        """
        Envía un mensaje personal (SMS / Personal Message) a la pantalla del reloj ZKTeco
        asociado al código de empleado (`user_id`), si el firmware/dispositivo lo permite.
        """
        clean_uid = user_id.strip()
        clean_msg = message.strip()[:240]
        if not clean_uid or not clean_msg:
            return (False, "Código de empleado o mensaje vacío")
        try:
            if hasattr(self.adapter, "set_user_sms"):
                ok = bool(self.adapter.set_user_sms(clean_uid, clean_msg, duration_minutes))
                return (
                    ok,
                    "Mensaje cargado en pantalla ZKTeco" if ok else "El reloj ZKTeco rechazó el mensaje SMS",
                )
            return (False, "El modelo ZKTeco no soporta SMS en pantalla; usar fallback SMTP/WhatsApp")
        except Exception as exc:
            return (False, f"Error enviando SMS a ZKTeco: {exc}")

