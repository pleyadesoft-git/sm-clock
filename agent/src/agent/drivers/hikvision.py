from __future__ import annotations

import csv
import io
import json
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Protocol, Sequence

from ..config import resolve_device_timestamp
from ..db import AgentLocalDatabase
from .base import BaseClockDriver


@dataclass(frozen=True)
class RawHikvisionEvent:
    employee_no: str
    timestamp_raw: str
    attendance_status: str  # checkIn, checkOut, breakIn, breakOut, etc.
    verify_mode: str  # face, fingerPrint, card, pw
    card_no: str = ""
    minor_event: int = 0
    device_name: str = ""


# --- Mapeos oficiales según docs/fixtures/README.md §1 ---

def map_hikvision_marca(status: str) -> str:
    s = status.strip().lower()
    if s in ("checkin", "breakin", "entrada"):
        return "ENTRADA"
    if s in ("checkout", "breakout", "salida"):
        return "SALIDA"
    return "CHECADA"


def map_hikvision_verificacion(verify_mode: str, minor: int = 0) -> str:
    v = verify_mode.strip().lower()
    if v in ("face", "rostro") or minor == 75:
        return "ROSTRO"
    if v in ("fingerprint", "huella") or minor == 38:
        return "HUELLA"
    if v in ("card", "tarjeta") or minor == 1:
        return "TARJETA"
    if v in ("pw", "pin", "password") or minor == 8:
        return "PIN"
    return "API"


def normalize_hikvision_timestamp(raw_ts: str) -> tuple[str, str | None]:
    """
    Normaliza el timestamp de Hikvision.
    Ej: '2026-11-14T08:01:23-08:00' ->
      ts_dispositivo_local = '2026-11-14 08:01:23'
      ts_utc = '2026-11-14T16:01:23.000Z'
    """
    raw = raw_ts.strip()
    if "T" in raw and ("+" in raw or raw.count("-") >= 3 or raw.endswith("Z")):
        # ISO con zona horaria
        try:
            dt = datetime.fromisoformat(raw)
            local_str = dt.strftime("%Y-%m-%d %H:%M:%S")
            utc_dt = dt.astimezone(datetime.now().astimezone().tzinfo)  # convert aware
            utc_str = dt.astimezone(datetime.fromtimestamp(0, tz=datetime.now().astimezone().tzinfo).tzinfo)
            from datetime import timezone
            utc_iso = dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
            return local_str, utc_iso
        except Exception:
            pass

    clean_str = raw.replace("T", " ")
    if len(clean_str) > 19:
        clean_str = clean_str[:19]
    return clean_str, None


# --- Parsers de fixtures Hikvision ---

def parse_acs_event_search_json(data_or_path: str | Path | dict[str, Any]) -> list[RawHikvisionEvent]:
    """
    Parsea respuesta JSON de `POST /ISAPI/AccessControl/AcsEvent?format=json`.
    Estructura: AcsEvent.InfoList[]
    """
    if isinstance(data_or_path, dict):
        payload = data_or_path
    elif isinstance(data_or_path, Path) or (isinstance(data_or_path, str) and "\n" not in data_or_path and Path(data_or_path).exists()):
        payload = json.loads(Path(data_or_path).read_text(encoding="utf-8"))
    else:
        payload = json.loads(str(data_or_path))

    info_list = payload.get("AcsEvent", {}).get("InfoList", [])
    records: list[RawHikvisionEvent] = []
    for item in info_list:
        emp_no = str(item.get("employeeNoString", "")).strip() or str(item.get("cardNo", "")).strip()
        ts = str(item.get("time", "")).strip()
        if not emp_no or not ts:
            continue
        records.append(
            RawHikvisionEvent(
                employee_no=emp_no,
                timestamp_raw=ts,
                attendance_status=str(item.get("attendanceStatus", "")),
                verify_mode=str(item.get("currentVerifyMode", "")),
                card_no=str(item.get("cardNo", "")),
                minor_event=int(item.get("minor", 0)),
                device_name=str(item.get("name", "")),
            )
        )
    return records


def parse_alert_stream_json(data_or_path: str | Path | dict[str, Any]) -> RawHikvisionEvent | None:
    """Parsea evento individual multipart / alertStream en JSON."""
    if isinstance(data_or_path, dict):
        payload = data_or_path
    elif isinstance(data_or_path, Path) or (isinstance(data_or_path, str) and "\n" not in data_or_path and Path(data_or_path).exists()):
        payload = json.loads(Path(data_or_path).read_text(encoding="utf-8"))
    else:
        payload = json.loads(str(data_or_path))

    event_data = payload.get("AccessControllerEvent", {})
    emp_no = str(event_data.get("employeeNoString", "")).strip() or str(event_data.get("cardNo", "")).strip()
    ts = str(payload.get("dateTime", "")).strip()
    if not emp_no or not ts:
        return None

    return RawHikvisionEvent(
        employee_no=emp_no,
        timestamp_raw=ts,
        attendance_status=str(event_data.get("attendanceStatus", "")),
        verify_mode=str(event_data.get("currentVerifyMode", "")),
        card_no=str(event_data.get("cardNo", "")),
        minor_event=int(event_data.get("subEventType", 0)),
        device_name=str(event_data.get("deviceName", "")),
    )


def parse_alert_stream_xml(xml_or_path: str | Path) -> RawHikvisionEvent | None:
    """Parsea evento individual alertStream en XML legado."""
    if isinstance(xml_or_path, Path) or (isinstance(xml_or_path, str) and "\n" not in xml_or_path and Path(xml_or_path).exists()):
        xml_text = Path(xml_or_path).read_text(encoding="utf-8")
    else:
        xml_text = str(xml_or_path)

    try:
        # Remover namespaces si vienen en el XML para facilitar búsqueda
        root = ET.fromstring(xml_text)
        ns = ""
        if "}" in root.tag:
            ns = root.tag.split("}")[0] + "}"

        date_time_el = root.find(f"{ns}dateTime")
        ts = date_time_el.text.strip() if date_time_el is not None and date_time_el.text else ""

        event_el = root.find(f"{ns}AccessControllerEvent")
        if event_el is None:
            return None

        def get_child_text(tag: str) -> str:
            child = event_el.find(f"{ns}{tag}")
            return child.text.strip() if child is not None and child.text else ""

        emp_no = get_child_text("employeeNoString") or get_child_text("cardNo")
        if not emp_no or not ts:
            return None

        minor_str = get_child_text("subEventType")
        minor = int(minor_str) if minor_str.isdigit() else 0

        return RawHikvisionEvent(
            employee_no=emp_no,
            timestamp_raw=ts,
            attendance_status=get_child_text("attendanceStatus"),
            verify_mode=get_child_text("currentVerifyMode"),
            card_no=get_child_text("cardNo"),
            minor_event=minor,
            device_name=get_child_text("deviceName"),
        )
    except Exception:
        return None


def parse_terminal_export_csv(content_or_path: str | Path) -> list[RawHikvisionEvent]:
    """
    Parsea exportación CSV directa de terminal Hikvision / iVMS-4200.
    Header: No.,Time,Card No.,Employee No.,Name,Department,Device Name,Event Point,Event Type,Verification Mode,Attendance Status
    """
    if isinstance(content_or_path, Path) or (isinstance(content_or_path, str) and "\n" not in content_or_path and Path(content_or_path).exists()):
        text = Path(content_or_path).read_text(encoding="utf-8")
    else:
        text = str(content_or_path)

    records: list[RawHikvisionEvent] = []
    reader = csv.DictReader(io.StringIO(text))
    for row in reader:
        emp_no = row.get("Employee No.", "").strip() or row.get("Card No.", "").strip()
        ts = row.get("Time", "").strip()
        if not emp_no or not ts:
            continue
        records.append(
            RawHikvisionEvent(
                employee_no=emp_no,
                timestamp_raw=ts,
                attendance_status=row.get("Attendance Status", ""),
                verify_mode=row.get("Verification Mode", ""),
                card_no=row.get("Card No.", ""),
                device_name=row.get("Device Name", ""),
            )
        )
    return records


class HikvisionDeviceAdapter(Protocol):
    def search_events(self, start_time: str | None) -> Sequence[RawHikvisionEvent]: ...
    def is_connected(self) -> bool: ...


class HikvisionDriver(BaseClockDriver):
    """
    Driver Hikvision ISAPI (Digest Auth) con captura en vivo vía alertStream
    y reconciliación periódica cada 30 min vía AcsEvent search.
    """

    def __init__(
        self,
        *,
        fuente_id: str,
        nombre: str = "Terminal Hikvision",
        tz_name: str = "America/Tijuana",
        db: AgentLocalDatabase,
        adapter: HikvisionDeviceAdapter | None = None,
    ) -> None:
        super().__init__(fuente_id=fuente_id, nombre=nombre, tipo="HIKVISION", tz_name=tz_name)
        self.db = db
        self.adapter = adapter
        self.conectado = True

    def test_connection(self) -> tuple[bool, str]:
        if self.adapter and hasattr(self.adapter, "is_connected"):
            connected = bool(self.adapter.is_connected())
        else:
            connected = True
        self.conectado = connected
        self.ultimo_error = None if connected else "No se pudo conectar a terminal Hikvision ISAPI"
        return (connected, "Conexión exitosa a Hikvision ISAPI" if connected else "Fallo de conexión")

    def process_raw_event(self, event: RawHikvisionEvent) -> bool:
        local_ts, explicit_utc = normalize_hikvision_timestamp(event.timestamp_raw)
        if explicit_utc:
            # Viene con offset ISO exacto
            from ..config import is_ambiguous_local_time
            from zoneinfo import ZoneInfo
            naive_dt = datetime.strptime(local_ts, "%Y-%m-%d %H:%M:%S")
            ambigua = is_ambiguous_local_time(naive_dt, ZoneInfo(self.tz_name))
            ts_utc = explicit_utc
        else:
            resolved = resolve_device_timestamp(local_ts, tz_name=self.tz_name)
            ts_utc = resolved.ts_utc
            ambigua = resolved.ambigua

        tipo_marca = map_hikvision_marca(event.attendance_status)
        tipo_verificacion = map_hikvision_verificacion(event.verify_mode, event.minor_event)

        inserted = self.db.enqueue_punch(
            fuente_id=self.fuente_id,
            codigo_empleado=event.employee_no.strip(),
            ts_utc=ts_utc,
            ts_dispositivo_local=local_ts,
            ambigua=ambigua,
            tipo_marca=tipo_marca,
            tipo_verificacion=tipo_verificacion,
        )
        self.ultimo_evento_ts = local_ts
        return inserted

    def reconcile_missing_punches(self) -> int:
        if not self.adapter:
            return 0
        try:
            since_ts = self.db.get_last_reconciled_ts(self.fuente_id)
            events = self.adapter.search_events(since_ts)
            inserted = 0
            latest_ts = since_ts

            for ev in events:
                if self.process_raw_event(ev):
                    inserted += 1
                local_ts, _ = normalize_hikvision_timestamp(ev.timestamp_raw)
                if latest_ts is None or local_ts > latest_ts:
                    latest_ts = local_ts

            if latest_ts is not None:
                self.db.set_last_reconciled_ts(self.fuente_id, latest_ts)

            self.conectado = True
            self.ultimo_error = None
            return inserted
        except Exception as exc:
            self.conectado = False
            self.ultimo_error = f"Error en reconciliación Hikvision: {exc}"
            return 0

    def send_employee_message(self, employee_no: str, message: str) -> tuple[bool, str]:
        """
        Envía un mensaje personalizado / prompt a una terminal Hikvision ISAPI
        para mostrarse al empleado al autenticar su rostro/huella, si el modelo lo soporta.
        """
        clean_emp = employee_no.strip()
        clean_msg = message.strip()[:240]
        if not clean_emp or not clean_msg:
            return (False, "Número de empleado o mensaje vacío")
        try:
            if self.adapter and hasattr(self.adapter, "set_employee_prompt"):
                ok = bool(self.adapter.set_employee_prompt(clean_emp, clean_msg))
                return (
                    ok,
                    "Mensaje ISAPI configurado en terminal Hikvision"
                    if ok
                    else "La terminal Hikvision no aceptó el mensaje en pantalla",
                )
            return (False, "El modelo Hikvision no soporta mensajes personalizados ISAPI; usar fallback")
        except Exception as exc:
            return (False, f"Error enviando mensaje a Hikvision ISAPI: {exc}")

