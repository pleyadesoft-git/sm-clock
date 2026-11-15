from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


class BaseClockDriver(ABC):
    """
    Clase base abstracta para drivers de recolección de asistencia
    (ZKTeco, Hikvision, TA.Cloud).
    """

    def __init__(self, fuente_id: str, nombre: str, tipo: str, tz_name: str = "America/Tijuana") -> None:
        self.fuente_id = fuente_id
        self.nombre = nombre
        self.tipo = tipo
        self.tz_name = tz_name
        self.ultimo_evento_ts: str | None = None
        self.ultimo_error: str | None = None
        self.conectado: bool = False

    @abstractmethod
    def test_connection(self) -> tuple[bool, str]:
        """Prueba la conexión al dispositivo o servicio."""
        ...

    @abstractmethod
    def reconcile_missing_punches(self) -> int:
        """
        Reconciliación periódica (cada 30 min): recupera eventos históricos
        desde el último timestamp procesado y los inserta de manera idempotente
        en la base local SQLite.
        """
        ...

    def get_status(self) -> dict[str, Any]:
        """Devuelve el estado de salud del driver para el latido y la UI de diagnóstico."""
        return {
            "fuente_id": self.fuente_id,
            "nombre": self.nombre,
            "tipo": self.tipo,
            "conectado": self.conectado,
            "ultimo_evento_ts": self.ultimo_evento_ts,
            "ultimo_error": self.ultimo_error,
        }
