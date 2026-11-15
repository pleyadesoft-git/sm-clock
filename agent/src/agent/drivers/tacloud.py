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


@dataclass(frozen=True)
class RawTACloudPunch:
    codigo_empleado: str
    nombre_completo: str
    fecha_hora_local: str
    tipo_checada: str  # Entrada, Salida, Sin Checada
    codigo_incidencia: str  # REG, RT, FALTA, RDS, HE2, HE3
    minutos_retardo: int = 0
    horas_trabajadas: float = 0.0
    horas_extra: float = 0.0
    dispositivo: str = ""
    numero_serie: str = ""
    metodo_verificacion: str = "API"
    fecha_hora_utc: str | None = None


# --- Parsers de fixtures TA.Cloud ---

def parse_oauth_token(data_or_path: str | Path | dict[str, Any]) -> dict[str, Any]:
    """Parsea respuesta OAuth2 `/token` de TA.Cloud."""
    if isinstance(data_or_path, dict):
        return data_or_path
    if isinstance(data_or_path, Path) or (isinstance(data_or_path, str) and "\n" not in data_or_path and Path(data_or_path).exists()):
        return json.loads(Path(data_or_path).read_text(encoding="utf-8"))
    return json.loads(str(data_or_path))


def parse_tacloud_15col_csv(content_or_path: str | Path) -> list[RawTACloudPunch]:
    """
    Parsea la exportación genérica de 15 columnas de TA.Cloud.
    Columnas:
    NumeroEmpleado,NombreCompleto,Fecha,Hora,TipoChecada,CodigoIncidencia,MinutosRetardo,HorasTrabajadas,HorasExtra,Dispositivo,NumeroSerie,Departamento,Puesto,Turno,Estatus
    """
    if isinstance(content_or_path, Path) or (isinstance(content_or_path, str) and "\n" not in content_or_path and Path(content_or_path).exists()):
        text = Path(content_or_path).read_text(encoding="utf-8")
    else:
        text = str(content_or_path)

    records: list[RawTACloudPunch] = []
    reader = csv.DictReader(io.StringIO(text))
    for row in reader:
        emp_no = row.get("NumeroEmpleado", "").strip()
        fecha = row.get("Fecha", "").strip()
        hora = row.get("Hora", "").strip()
        tipo_checada = row.get("TipoChecada", "").strip()
        cod_incidencia = row.get("CodigoIncidencia", "").strip().upper()

        if not emp_no or not fecha or not hora:
            continue

        # Si es una "FALTA" o "Sin Checada" con hora 00:00:00, es una incidencia sin checada física real
        if tipo_checada.lower() == "sin checada" and cod_incidencia == "FALTA":
            continue

        local_ts = f"{fecha} {hora}"
        retardo = int(row.get("MinutosRetardo", 0) or 0)
        try:
            h_trab = float(row.get("HorasTrabajadas", 0) or 0)
        except ValueError:
            h_trab = 0.0
        try:
            h_extra = float(row.get("HorasExtra", 0) or 0)
        except ValueError:
            h_extra = 0.0

        records.append(
            RawTACloudPunch(
                codigo_empleado=emp_no,
                nombre_completo=row.get("NombreCompleto", "").strip(),
                fecha_hora_local=local_ts,
                tipo_checada=tipo_checada,
                codigo_incidencia=cod_incidencia,
                minutos_retardo=retardo,
                horas_trabajadas=h_trab,
                horas_extra=h_extra,
                dispositivo=row.get("Dispositivo", "").strip(),
                numero_serie=row.get("NumeroSerie", "").strip(),
                metodo_verificacion="API",
            )
        )
    return records


def parse_punchlogs_json(data_or_path: str | Path | dict[str, Any]) -> list[RawTACloudPunch]:
    """
    Parsea endpoint REST `/api/v1/punchlogs` de TA.Cloud.
    Estructura: datos[ { id, codigoEmpleado, nombre, fechaHoraLocal, fechaHoraUtc, tipoChecada, metodoVerificacion, codigoIncidencia, minutosRetardo } ]
    """
    if isinstance(data_or_path, dict):
        payload = data_or_path
    elif isinstance(data_or_path, Path) or (isinstance(data_or_path, str) and "\n" not in data_or_path and Path(data_or_path).exists()):
        payload = json.loads(Path(data_or_path).read_text(encoding="utf-8"))
    else:
        payload = json.loads(str(data_or_path))

    datos = payload.get("datos", [])
    records: list[RawTACloudPunch] = []
    for item in datos:
        emp_no = str(item.get("codigoEmpleado", "")).strip()
        local_ts = str(item.get("fechaHoraLocal", "")).strip()
        if not emp_no or not local_ts:
            continue
        records.append(
            RawTACloudPunch(
                codigo_empleado=emp_no,
                nombre_completo=str(item.get("nombre", "")).strip(),
                fecha_hora_local=local_ts,
                fecha_hora_utc=item.get("fechaHoraUtc"),
                tipo_checada=str(item.get("tipoChecada", "CHECADA")),
                codigo_incidencia=str(item.get("codigoIncidencia", "REG")),
                minutos_retardo=int(item.get("minutosRetardo", 0)),
                metodo_verificacion=str(item.get("metodoVerificacion", "API")),
                dispositivo=str(item.get("dispositivoNombre", "")),
                numero_serie=str(item.get("dispositivoSerial", "")),
            )
        )
    return records


class TACloudAdapter(Protocol):
    def fetch_punches_since(self, since_ts: str | None) -> Sequence[RawTACloudPunch]: ...
    def is_connected(self) -> bool: ...


class TACloudDriver(BaseClockDriver):
    """
    Driver TA.Cloud con integración OAuth2 y reconciliación periódica
    desde exportación genérica de 15 columnas o punchlogs.
    """

    def __init__(
        self,
        *,
        fuente_id: str,
        nombre: str = "Conector TA.Cloud",
        tz_name: str = "America/Tijuana",
        db: AgentLocalDatabase,
        adapter: TACloudAdapter | None = None,
    ) -> None:
        super().__init__(fuente_id=fuente_id, nombre=nombre, tipo="TACLOUD", tz_name=tz_name)
        self.db = db
        self.adapter = adapter
        self.conectado = True

    def test_connection(self) -> tuple[bool, str]:
        if self.adapter and hasattr(self.adapter, "is_connected"):
            connected = bool(self.adapter.is_connected())
        else:
            connected = True
        self.conectado = connected
        self.ultimo_error = None if connected else "No se pudo autenticar con TA.Cloud OAuth2"
        return (connected, "Conexión exitosa a TA.Cloud API" if connected else "Fallo de conexión")

    def process_raw_punch(self, punch: RawTACloudPunch) -> bool:
        tipo_checada_clean = punch.tipo_checada.strip().lower()
        if "entrada" in tipo_checada_clean:
            tipo_marca = "ENTRADA"
        elif "salida" in tipo_checada_clean:
            tipo_marca = "SALIDA"
        else:
            tipo_marca = "CHECADA"

        if punch.fecha_hora_utc:
            from ..config import is_ambiguous_local_time
            from datetime import datetime
            from zoneinfo import ZoneInfo
            naive_dt = datetime.strptime(punch.fecha_hora_local, "%Y-%m-%d %H:%M:%S")
            ambigua = is_ambiguous_local_time(naive_dt, ZoneInfo(self.tz_name))
            ts_utc = punch.fecha_hora_utc
        else:
            resolved = resolve_device_timestamp(punch.fecha_hora_local, tz_name=self.tz_name)
            ts_utc = resolved.ts_utc
            ambigua = resolved.ambigua

        # Normalizar tipo de verificación
        v = punch.metodo_verificacion.upper()
        if "ROSTRO" in v or "FACE" in v:
            tipo_verif = "ROSTRO"
        elif "HUELLA" in v or "FINGERPRINT" in v:
            tipo_verif = "HUELLA"
        elif "TARJETA" in v or "CARD" in v:
            tipo_verif = "TARJETA"
        elif "PIN" in v:
            tipo_verif = "PIN"
        else:
            tipo_verif = "API"

        inserted = self.db.enqueue_punch(
            fuente_id=self.fuente_id,
            codigo_empleado=punch.codigo_empleado.strip(),
            ts_utc=ts_utc,
            ts_dispositivo_local=punch.fecha_hora_local,
            ambigua=ambigua,
            tipo_marca=tipo_marca,
            tipo_verificacion=tipo_verif,
        )
        self.ultimo_evento_ts = punch.fecha_hora_local
        return inserted

    def reconcile_missing_punches(self) -> int:
        if not self.adapter:
            return 0
        try:
            since_ts = self.db.get_last_reconciled_ts(self.fuente_id)
            punches = self.adapter.fetch_punches_since(since_ts)
            inserted = 0
            latest_ts = since_ts

            for p in punches:
                if self.process_raw_punch(p):
                    inserted += 1
                if latest_ts is None or p.fecha_hora_local > latest_ts:
                    latest_ts = p.fecha_hora_local

            if latest_ts is not None:
                self.db.set_last_reconciled_ts(self.fuente_id, latest_ts)

            self.conectado = True
            self.ultimo_error = None
            return inserted
        except Exception as exc:
            self.conectado = False
            self.ultimo_error = f"Error en reconciliación TA.Cloud: {exc}"
            return 0
