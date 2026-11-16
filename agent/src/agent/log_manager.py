from __future__ import annotations

import collections
from datetime import datetime, timezone
import logging
from typing import Any


class AgentLogEntry:
    def __init__(
        self,
        timestamp: str,
        level: str,
        logger_name: str,
        message: str,
        traceback: str | None = None,
    ) -> None:
        self.timestamp = timestamp
        self.level = level
        self.logger_name = logger_name
        self.message = message
        self.traceback = traceback

    def to_dict(self) -> dict[str, Any]:
        return {
            "timestamp": self.timestamp,
            "level": self.level,
            "logger": self.logger_name,
            "message": self.message,
            "traceback": self.traceback,
        }


class MemoryLogHandler(logging.Handler):
    """
    Handler en memoria que retiene hasta los últimos max_entries registros
    para ser consultados en tiempo real desde la API local o interfaz Electron.
    """

    def __init__(self, max_entries: int = 1000) -> None:
        super().__init__()
        self._buffer: collections.deque[AgentLogEntry] = collections.deque(maxlen=max_entries)

    def emit(self, record: logging.LogRecord) -> None:
        try:
            msg = self.format(record)
            tb = None
            if record.exc_info:
                tb = self.formatException(record.exc_info)
            ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            entry = AgentLogEntry(
                timestamp=ts,
                level=record.levelname,
                logger_name=record.name,
                message=msg,
                traceback=tb,
            )
            self._buffer.append(entry)
        except Exception:
            self.handleError(record)

    def get_logs(
        self,
        level: str | None = None,
        search: str | None = None,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        entries = list(self._buffer)
        if level:
            lvl_clean = level.strip().upper()
            entries = [e for e in entries if e.level == lvl_clean]
        if search:
            query = search.strip().lower()
            entries = [e for e in entries if query in e.message.lower() or query in e.logger_name.lower()]
        # Más recientes primero
        entries = entries[::-1]
        return [e.to_dict() for e in entries[:limit]]

    def get_counts(self) -> dict[str, int]:
        total = len(self._buffer)
        errors = sum(1 for e in self._buffer if e.level in ("ERROR", "CRITICAL"))
        warnings = sum(1 for e in self._buffer if e.level == "WARNING")
        infos = sum(1 for e in self._buffer if e.level == "INFO")
        return {
            "total": total,
            "errors": errors,
            "warnings": warnings,
            "infos": infos,
        }

    def clear(self) -> None:
        self._buffer.clear()


# Instancia singleton para compartir en el agente
GLOBAL_LOG_HANDLER = MemoryLogHandler(max_entries=1000)
GLOBAL_LOG_HANDLER.setFormatter(logging.Formatter("%(message)s"))

# Conectar al logger raíz de Python para capturar todo
logging.getLogger().addHandler(GLOBAL_LOG_HANDLER)
