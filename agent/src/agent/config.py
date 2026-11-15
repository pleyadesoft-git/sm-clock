from __future__ import annotations

import base64
import os
import platform
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC


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


# --- Almacenamiento seguro de tokens (DPAPI en Windows, AES-GCM / PBKDF2 en Unix/Mac) ---

def _get_machine_key() -> bytes:
    """Deriva una clave de cifrado ligada a la máquina para entornos sin DPAPI."""
    node = platform.node().encode("utf-8")
    salt = b"sm-clock-agent-device-salt-2026"
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=100_000,
    )
    key = base64.urlsafe_b64encode(kdf.derive(node))
    return key


def protect_secret(secret_text: str) -> str:
    """
    Cifra un secreto. En Windows usa DPAPI vía ctypes/crypt32 si está disponible;
    en otros sistemas operativos usa PBKDF2 + Fernet con salt fijo por máquina.
    """
    if sys.platform == "win32":
        try:
            import ctypes
            import ctypes.wintypes

            class DATA_BLOB(ctypes.Structure):
                _fields_ = [
                    ("cbData", ctypes.wintypes.DWORD),
                    ("pbData", ctypes.POINTER(ctypes.c_char)),
                ]

            crypt32 = ctypes.windll.crypt32
            data_in = secret_text.encode("utf-8")
            blob_in = DATA_BLOB(len(data_in), ctypes.cast(ctypes.create_string_buffer(data_in), ctypes.POINTER(ctypes.c_char)))
            blob_out = DATA_BLOB()
            if crypt32.CryptProtectData(ctypes.byref(blob_in), "SMClockToken", None, None, None, 0, ctypes.byref(blob_out)):
                encrypted_bytes = ctypes.string_at(blob_out.pbData, blob_out.cbData)
                ctypes.windll.kernel32.LocalFree(blob_out.pbData)
                return "dpapi:" + base64.b64encode(encrypted_bytes).decode("ascii")
        except Exception:
            pass

    fernet = Fernet(_get_machine_key())
    encrypted = fernet.encrypt(secret_text.encode("utf-8"))
    return "fernet:" + encrypted.decode("ascii")


def unprotect_secret(protected_text: str) -> str:
    """Descifra el secreto cifrado con `protect_secret`."""
    if not protected_text:
        return ""
    if protected_text.startswith("dpapi:") and sys.platform == "win32":
        try:
            import ctypes
            import ctypes.wintypes

            class DATA_BLOB(ctypes.Structure):
                _fields_ = [
                    ("cbData", ctypes.wintypes.DWORD),
                    ("pbData", ctypes.POINTER(ctypes.c_char)),
                ]

            crypt32 = ctypes.windll.crypt32
            raw_bytes = base64.b64decode(protected_text[6:])
            blob_in = DATA_BLOB(len(raw_bytes), ctypes.cast(ctypes.create_string_buffer(raw_bytes), ctypes.POINTER(ctypes.c_char)))
            blob_out = DATA_BLOB()
            if crypt32.CryptUnprotectData(ctypes.byref(blob_in), None, None, None, None, 0, ctypes.byref(blob_out)):
                decrypted_bytes = ctypes.string_at(blob_out.pbData, blob_out.cbData)
                ctypes.windll.kernel32.LocalFree(blob_out.pbData)
                return decrypted_bytes.decode("utf-8")
        except Exception:
            pass

    if protected_text.startswith("fernet:"):
        token_data = protected_text[7:].encode("ascii")
        fernet = Fernet(_get_machine_key())
        return fernet.decrypt(token_data).decode("utf-8")

    # Si viene en texto plano (migración)
    return protected_text


@dataclass
class ClockConfig:
    fuente_id: str
    nombre: str
    tipo: str  # 'ZKTECO' | 'HIKVISION' | 'TACLOUD'
    ip: str = "127.0.0.1"
    puerto: int = 4370
    comm_key: int = 0
    usuario: str = ""
    password: str = ""
    activo: bool = True
    parametros: dict[str, Any] = field(default_factory=dict)


@dataclass
class AgentSettings:
    agente_id: str = ""
    credencial_token: str = ""
    tenant_id: str = ""
    tenant_code: str = ""
    nombre_agente: str = "Agente Local"
    server_url: str = "http://127.0.0.1:3000"
    zona_horaria: str = "America/Tijuana"
    db_path: str = "agent.sqlite"
    batch_interval_seconds: int = 5
    reconciliation_interval_minutes: int = 30
    heartbeat_interval_seconds: int = 60
    diagnostic_host: str = "127.0.0.1"
    diagnostic_port: int = 8085
    relojes: list[ClockConfig] = field(default_factory=list)
