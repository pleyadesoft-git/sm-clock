from __future__ import annotations

from datetime import datetime, timezone

from .. import __version__
from ..db import AgentLocalDatabase

LOCAL_DIAGNOSTIC_HOST = "127.0.0.1"
LOCAL_DIAGNOSTIC_PORT = 8085


def get_diagnostic_status(
    db: AgentLocalDatabase,
    *,
    agente_id: str | None = None,
    tz_name: str = "America/Tijuana",
) -> dict[str, object]:
    """
    Genera el estado de diagnóstico local servido exclusivamente en 127.0.0.1:8085.
    """
    return {
        "bind": f"{LOCAL_DIAGNOSTIC_HOST}:{LOCAL_DIAGNOSTIC_PORT}",
        "version": __version__,
        "agente_id": agente_id,
        "zona_horaria": tz_name,
        "sqlite_journal_mode": db.get_journal_mode(),
        "cola_pendiente": db.count_pending(),
        "ts_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
