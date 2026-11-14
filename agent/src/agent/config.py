from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from zoneinfo import ZoneInfo


@dataclass(frozen=True)
class ResolvedTimestamp:
    ts_utc: str
    ts_dispositivo_local: str
    ambigua: bool


def is_ambiguous_local_time(naive_dt: datetime, tz: ZoneInfo) -> bool:
    """
    Detecta si `naive_dt` cae en la hora repetida del cambio de horario de otoño
    (ej. primer domingo de noviembre de 01:00 a 01:59:59 en America/Tijuana).
    En Python `zoneinfo`, si `utcoffset()` difiere entre `fold=0` y `fold=1`,
    el instante local ocurrió dos veces.
    """
    dt_fold0 = naive_dt.replace(tzinfo=tz, fold=0)
    dt_fold1 = naive_dt.replace(tzinfo=tz, fold=1)
    return dt_fold0.utcoffset() != dt_fold1.utcoffset()


def resolve_device_timestamp(
    ts_dispositivo_local: str,
    tz_name: str = "America/Tijuana",
    fold: int = 0,
) -> ResolvedTimestamp:
    """
    Convierte el timestamp sin zona horaria entregado por el reloj ZKTeco/Hikvision
    (formato 'YYYY-MM-DD HH:MM:SS') a UTC ISO-8601 usando la zona horaria del sitio
    (`America/Tijuana` por defecto) y marca `ambigua=True` cuando cae en la hora
    repetida de otoño.
    """
    clean_str = ts_dispositivo_local.strip().replace("T", " ")
    naive_dt = datetime.strptime(clean_str, "%Y-%m-%d %H:%M:%S")
    tz = ZoneInfo(tz_name)

    ambigua = is_ambiguous_local_time(naive_dt, tz)
    safe_fold = 1 if (ambigua and fold == 1) else 0
    aware_local = naive_dt.replace(tzinfo=tz, fold=safe_fold)
    utc_dt = aware_local.astimezone(timezone.utc)

    ts_utc_iso = utc_dt.strftime("%Y-%m-%dT%H:%M:%S.000Z")
    return ResolvedTimestamp(
        ts_utc=ts_utc_iso,
        ts_dispositivo_local=clean_str,
        ambigua=ambigua,
    )
