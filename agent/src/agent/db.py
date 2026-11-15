from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Sequence


@dataclass(frozen=True)
class QueuedPunch:
    id: int
    fuente_id: str
    codigo_empleado: str
    ts_utc: str
    ts_dispositivo_local: str
    ambigua: bool
    tipo_marca: str
    tipo_verificacion: str | None
    sincronizado: bool


@dataclass(frozen=True)
class LocalEmployee:
    empleado_id: str
    codigo_empleado: str
    nombre_completo: str
    activo: bool
    updated_at: str


class AgentLocalDatabase:
    """
    Base de datos SQLite local en modo WAL (`PRAGMA journal_mode=WAL;`).
    Almacena las checadas pendientes (`sincronizado=0`) cuando no hay internet
    y solo las marca como `sincronizado=1` tras recibir confirmación 200 OK de la nube.
    """

    def __init__(self, db_path: str | Path) -> None:
        self.db_path = str(db_path)
        # Asegurar directorio padre
        p = Path(self.db_path)
        if p.parent and not p.parent.exists():
            p.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(self.db_path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._init_schema()

    def _init_schema(self) -> None:
        cur = self._conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL;")
        cur.execute("PRAGMA synchronous=NORMAL;")
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS cola_checadas (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                fuente_id TEXT NOT NULL,
                codigo_empleado TEXT NOT NULL,
                ts_utc TEXT NOT NULL,
                ts_dispositivo_local TEXT NOT NULL,
                ambigua INTEGER NOT NULL DEFAULT 0,
                tipo_marca TEXT NOT NULL DEFAULT 'CHECADA',
                tipo_verificacion TEXT,
                sincronizado INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE (fuente_id, codigo_empleado, ts_utc)
            );
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_cola_pendientes
            ON cola_checadas (sincronizado, id ASC);
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS estado_reconciliacion (
                fuente_id TEXT PRIMARY KEY,
                ultimo_ts_local TEXT NOT NULL
            );
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS agente_config (
                clave TEXT PRIMARY KEY,
                valor TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS cat_empleados (
                empleado_id TEXT PRIMARY KEY,
                codigo_empleado TEXT NOT NULL UNIQUE,
                nombre_completo TEXT NOT NULL,
                activo INTEGER NOT NULL DEFAULT 1,
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS envios_destino_local (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                destino TEXT NOT NULL,
                archivo_o_url TEXT NOT NULL,
                registros_procesados INTEGER NOT NULL,
                estatus TEXT NOT NULL,
                error_detalle TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            """
        )
        self._conn.commit()

    def get_journal_mode(self) -> str:
        cur = self._conn.cursor()
        row = cur.execute("PRAGMA journal_mode;").fetchone()
        return str(row[0]).lower() if row else ""

    def enqueue_punch(
        self,
        *,
        fuente_id: str,
        codigo_empleado: str,
        ts_utc: str,
        ts_dispositivo_local: str,
        ambigua: bool = False,
        tipo_marca: str = "CHECADA",
        tipo_verificacion: str | None = "HUELLA",
    ) -> bool:
        """
        Inserta una checada de manera idempotente en SQLite local.
        Retorna True si fue insertada como nueva o False si ya existía.
        """
        cur = self._conn.cursor()
        cur.execute(
            """
            INSERT OR IGNORE INTO cola_checadas (
                fuente_id,
                codigo_empleado,
                ts_utc,
                ts_dispositivo_local,
                ambigua,
                tipo_marca,
                tipo_verificacion,
                sincronizado
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 0);
            """,
            (
                fuente_id,
                codigo_empleado.strip(),
                ts_utc,
                ts_dispositivo_local.strip(),
                1 if ambigua else 0,
                tipo_marca,
                tipo_verificacion,
            ),
        )
        self._conn.commit()
        return cur.rowcount > 0

    def fetch_pending_batch(self, limit: int = 500) -> list[QueuedPunch]:
        safe_limit = max(1, min(500, limit))
        cur = self._conn.cursor()
        rows = cur.execute(
            """
            SELECT
                id,
                fuente_id,
                codigo_empleado,
                ts_utc,
                ts_dispositivo_local,
                ambigua,
                tipo_marca,
                tipo_verificacion,
                sincronizado
            FROM cola_checadas
            WHERE sincronizado = 0
            ORDER BY id ASC
            LIMIT ?;
            """,
            (safe_limit,),
        ).fetchall()

        return [
            QueuedPunch(
                id=int(r["id"]),
                fuente_id=str(r["fuente_id"]),
                codigo_empleado=str(r["codigo_empleado"]),
                ts_utc=str(r["ts_utc"]),
                ts_dispositivo_local=str(r["ts_dispositivo_local"]),
                ambigua=bool(r["ambigua"]),
                tipo_marca=str(r["tipo_marca"]),
                tipo_verificacion=(
                    str(r["tipo_verificacion"])
                    if r["tipo_verificacion"] is not None
                    else None
                ),
                sincronizado=bool(r["sincronizado"]),
            )
            for r in rows
        ]

    def get_recent_punches(self, limit: int = 50) -> list[QueuedPunch]:
        safe_limit = max(1, min(500, limit))
        cur = self._conn.cursor()
        rows = cur.execute(
            """
            SELECT
                id,
                fuente_id,
                codigo_empleado,
                ts_utc,
                ts_dispositivo_local,
                ambigua,
                tipo_marca,
                tipo_verificacion,
                sincronizado
            FROM cola_checadas
            ORDER BY id DESC
            LIMIT ?;
            """,
            (safe_limit,),
        ).fetchall()

        return [
            QueuedPunch(
                id=int(r["id"]),
                fuente_id=str(r["fuente_id"]),
                codigo_empleado=str(r["codigo_empleado"]),
                ts_utc=str(r["ts_utc"]),
                ts_dispositivo_local=str(r["ts_dispositivo_local"]),
                ambigua=bool(r["ambigua"]),
                tipo_marca=str(r["tipo_marca"]),
                tipo_verificacion=(
                    str(r["tipo_verificacion"])
                    if r["tipo_verificacion"] is not None
                    else None
                ),
                sincronizado=bool(r["sincronizado"]),
            )
            for r in rows
        ]

    def mark_batch_synced(self, ids: Sequence[int]) -> int:
        if not ids:
            return 0
        placeholders = ",".join("?" for _ in ids)
        cur = self._conn.cursor()
        cur.execute(
            f"UPDATE cola_checadas SET sincronizado = 1 WHERE id IN ({placeholders});",
            tuple(ids),
        )
        self._conn.commit()
        return cur.rowcount

    def count_pending(self) -> int:
        cur = self._conn.cursor()
        row = cur.execute(
            "SELECT COUNT(*) FROM cola_checadas WHERE sincronizado = 0;"
        ).fetchone()
        return int(row[0]) if row else 0

    def count_total(self) -> int:
        cur = self._conn.cursor()
        row = cur.execute("SELECT COUNT(*) FROM cola_checadas;").fetchone()
        return int(row[0]) if row else 0

    def get_last_reconciled_ts(self, fuente_id: str) -> str | None:
        cur = self._conn.cursor()
        row = cur.execute(
            "SELECT ultimo_ts_local FROM estado_reconciliacion WHERE fuente_id = ?;",
            (fuente_id,),
        ).fetchone()
        return str(row["ultimo_ts_local"]) if row else None

    def set_last_reconciled_ts(self, fuente_id: str, ultimo_ts_local: str) -> None:
        cur = self._conn.cursor()
        cur.execute(
            """
            INSERT INTO estado_reconciliacion (fuente_id, ultimo_ts_local)
            VALUES (?, ?)
            ON CONFLICT(fuente_id) DO UPDATE SET ultimo_ts_local = excluded.ultimo_ts_local;
            """,
            (fuente_id, ultimo_ts_local),
        )
        self._conn.commit()

    # Configuración local clave-valor
    def get_config(self, clave: str, default: str | None = None) -> str | None:
        cur = self._conn.cursor()
        row = cur.execute(
            "SELECT valor FROM agente_config WHERE clave = ?;",
            (clave,),
        ).fetchone()
        return str(row["valor"]) if row else default

    def set_config(self, clave: str, valor: str) -> None:
        cur = self._conn.cursor()
        cur.execute(
            """
            INSERT INTO agente_config (clave, valor, updated_at)
            VALUES (?, ?, datetime('now'))
            ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor, updated_at = excluded.updated_at;
            """,
            (clave, valor),
        )
        self._conn.commit()

    # Catálogo de empleados local
    def upsert_empleados(self, empleados: Sequence[dict[str, Any]]) -> int:
        if not empleados:
            return 0
        cur = self._conn.cursor()
        count = 0
        for emp in empleados:
            cur.execute(
                """
                INSERT INTO cat_empleados (empleado_id, codigo_empleado, nombre_completo, activo, updated_at)
                VALUES (?, ?, ?, ?, datetime('now'))
                ON CONFLICT(empleado_id) DO UPDATE SET
                    codigo_empleado = excluded.codigo_empleado,
                    nombre_completo = excluded.nombre_completo,
                    activo = excluded.activo,
                    updated_at = excluded.updated_at;
                """,
                (
                    str(emp["id"]),
                    str(emp["codigo_empleado"]).strip(),
                    str(emp.get("nombre_completo", "")).strip(),
                    1 if emp.get("activo", True) else 0,
                ),
            )
            count += 1
        self._conn.commit()
        return count

    def get_empleado_by_codigo(self, codigo_empleado: str) -> LocalEmployee | None:
        cur = self._conn.cursor()
        row = cur.execute(
            "SELECT empleado_id, codigo_empleado, nombre_completo, activo, updated_at FROM cat_empleados WHERE codigo_empleado = ?;",
            (codigo_empleado.strip(),),
        ).fetchone()
        if not row:
            return None
        return LocalEmployee(
            empleado_id=str(row["empleado_id"]),
            codigo_empleado=str(row["codigo_empleado"]),
            nombre_completo=str(row["nombre_completo"]),
            activo=bool(row["activo"]),
            updated_at=str(row["updated_at"]),
        )

    # Registro de envíos a destino local (CONTPAQi, TRESS, RH4000)
    def log_destino_envio(
        self,
        *,
        destino: str,
        archivo_o_url: str,
        registros_procesados: int,
        estatus: str,
        error_detalle: str | None = None,
    ) -> int:
        cur = self._conn.cursor()
        cur.execute(
            """
            INSERT INTO envios_destino_local (
                destino, archivo_o_url, registros_procesados, estatus, error_detalle
            ) VALUES (?, ?, ?, ?, ?);
            """,
            (destino, archivo_o_url, registros_procesados, estatus, error_detalle),
        )
        self._conn.commit()
        return cur.lastrowid or 0

    def close(self) -> None:
        self._conn.close()
