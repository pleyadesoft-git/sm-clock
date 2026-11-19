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


@dataclass(frozen=True)
class LocalClockRecord:
    id: str
    nombre: str
    tipo: str  # 'ZKTECO' | 'HIKVISION' | 'TACLOUD'
    ip: str
    puerto: int
    comm_key: int
    usuario: str | None
    password_cifrada: str | None
    activo: bool
    ultimo_ping: str | None
    ultimo_error: str | None
    created_at: str
    updated_at: str
    sucursal_id: str | None = None
    clave: str | None = None


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
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS fuentes_locales (
                id TEXT PRIMARY KEY,
                nombre TEXT NOT NULL,
                tipo TEXT NOT NULL CHECK (tipo IN ('ZKTECO', 'HIKVISION', 'TACLOUD')),
                ip TEXT NOT NULL DEFAULT '127.0.0.1',
                puerto INTEGER NOT NULL DEFAULT 4370,
                comm_key INTEGER NOT NULL DEFAULT 0,
                usuario TEXT,
                password_cifrada TEXT,
                activo INTEGER NOT NULL DEFAULT 1,
                ultimo_ping TEXT,
                ultimo_error TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                sucursal_id TEXT,
                clave TEXT
            );
            """
        )
        try:
            cur.execute("ALTER TABLE fuentes_locales ADD COLUMN sucursal_id TEXT;")
        except sqlite3.OperationalError:
            pass
        try:
            cur.execute("ALTER TABLE fuentes_locales ADD COLUMN clave TEXT;")
        except sqlite3.OperationalError:
            pass
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS sesiones_auth (
                token TEXT PRIMARY KEY,
                email TEXT NOT NULL,
                nombre TEXT NOT NULL,
                rol TEXT NOT NULL,
                tenant_id TEXT,
                expira_en TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS notificaciones_disparadas_local (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                mensaje_id TEXT NOT NULL,
                codigo_empleado TEXT NOT NULL,
                nombre_empleado TEXT NOT NULL,
                tipo_marca TEXT NOT NULL DEFAULT 'CHECADA',
                titulo TEXT NOT NULL,
                mensaje TEXT NOT NULL,
                texto_voz TEXT NOT NULL,
                reproducir_audio INTEGER NOT NULL DEFAULT 1,
                canal_utilizado TEXT NOT NULL DEFAULT 'AGENTE_AUDIO_VISUAL',
                estatus_entrega TEXT NOT NULL DEFAULT 'ENTREGADO_DISPOSITIVO',
                whatsapp_web_url TEXT,
                ts_utc TEXT NOT NULL,
                leida INTEGER NOT NULL DEFAULT 0,
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

    # --- CRUD de Fuentes Locales (Relojes ZKTeco, Hikvision, TA.Cloud) ---

    def list_fuentes_locales(self, only_active: bool = False) -> list[LocalClockRecord]:
        cur = self._conn.cursor()
        query = "SELECT * FROM fuentes_locales"
        if only_active:
            query += " WHERE activo = 1"
        query += " ORDER BY nombre ASC;"

        rows = cur.execute(query).fetchall()
        return [
            LocalClockRecord(
                id=str(r["id"]),
                nombre=str(r["nombre"]),
                tipo=str(r["tipo"]),
                ip=str(r["ip"]),
                puerto=int(r["puerto"]),
                comm_key=int(r["comm_key"]),
                usuario=str(r["usuario"]) if r["usuario"] is not None else None,
                password_cifrada=str(r["password_cifrada"]) if r["password_cifrada"] is not None else None,
                activo=bool(r["activo"]),
                ultimo_ping=str(r["ultimo_ping"]) if r["ultimo_ping"] is not None else None,
                ultimo_error=str(r["ultimo_error"]) if r["ultimo_error"] is not None else None,
                created_at=str(r["created_at"]),
                updated_at=str(r["updated_at"]),
                sucursal_id=str(r["sucursal_id"]) if "sucursal_id" in r.keys() and r["sucursal_id"] is not None else None,
                clave=str(r["clave"]) if "clave" in r.keys() and r["clave"] is not None else None,
            )
            for r in rows
        ]

    def get_fuente_local(self, clock_id: str) -> LocalClockRecord | None:
        cur = self._conn.cursor()
        row = cur.execute(
            "SELECT * FROM fuentes_locales WHERE id = ?;",
            (clock_id.strip(),),
        ).fetchone()
        if not row:
            return None
        return LocalClockRecord(
            id=str(row["id"]),
            nombre=str(row["nombre"]),
            tipo=str(row["tipo"]),
            ip=str(row["ip"]),
            puerto=int(row["puerto"]),
            comm_key=int(row["comm_key"]),
            usuario=str(row["usuario"]) if row["usuario"] is not None else None,
            password_cifrada=str(row["password_cifrada"]) if row["password_cifrada"] is not None else None,
            activo=bool(row["activo"]),
            ultimo_ping=str(row["ultimo_ping"]) if row["ultimo_ping"] is not None else None,
            ultimo_error=str(row["ultimo_error"]) if row["ultimo_error"] is not None else None,
            created_at=str(row["created_at"]),
            updated_at=str(row["updated_at"]),
            sucursal_id=str(row["sucursal_id"]) if "sucursal_id" in row.keys() and row["sucursal_id"] is not None else None,
            clave=str(row["clave"]) if "clave" in row.keys() and row["clave"] is not None else None,
        )

    def upsert_fuente_local(
        self,
        *,
        clock_id: str,
        nombre: str,
        tipo: str,
        ip: str = "127.0.0.1",
        puerto: int = 4370,
        comm_key: int = 0,
        usuario: str | None = None,
        password_cifrada: str | None = None,
        activo: bool = True,
        sucursal_id: str | None = None,
        clave: str | None = None,
    ) -> str:
        cur = self._conn.cursor()
        clean_id = clock_id.strip()

        # Si no se pasó nueva password_cifrada pero ya existía una, conservarla
        if password_cifrada is None:
            existing = self.get_fuente_local(clean_id)
            if existing:
                password_cifrada = existing.password_cifrada
                if sucursal_id is None:
                    sucursal_id = existing.sucursal_id
                if clave is None:
                    clave = existing.clave

        cur.execute(
            """
            INSERT INTO fuentes_locales (
                id, nombre, tipo, ip, puerto, comm_key, usuario, password_cifrada, activo, sucursal_id, clave, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(id) DO UPDATE SET
                nombre = excluded.nombre,
                tipo = excluded.tipo,
                ip = excluded.ip,
                puerto = excluded.puerto,
                comm_key = excluded.comm_key,
                usuario = excluded.usuario,
                password_cifrada = excluded.password_cifrada,
                activo = excluded.activo,
                sucursal_id = coalesce(excluded.sucursal_id, fuentes_locales.sucursal_id),
                clave = coalesce(excluded.clave, fuentes_locales.clave),
                updated_at = excluded.updated_at;
            """,
            (
                clean_id,
                nombre.strip(),
                tipo.strip().upper(),
                ip.strip(),
                puerto,
                comm_key,
                usuario.strip() if usuario else None,
                password_cifrada,
                1 if activo else 0,
                sucursal_id.strip() if sucursal_id else None,
                clave.strip() if clave else None,
            ),
        )
        self._conn.commit()
        return clean_id

    def delete_fuente_local(self, clock_id: str) -> bool:
        cur = self._conn.cursor()
        cur.execute("DELETE FROM fuentes_locales WHERE id = ?;", (clock_id.strip(),))
        self._conn.commit()
        return cur.rowcount > 0

    def update_fuente_ping_status(
        self, clock_id: str, ok: bool, error: str | None = None
    ) -> None:
        cur = self._conn.cursor()
        cur.execute(
            """
            UPDATE fuentes_locales
            SET ultimo_ping = datetime('now'),
                ultimo_error = ?,
                updated_at = datetime('now')
            WHERE id = ?;
            """,
            (None if ok else (error or "Fallo de conexión"), clock_id.strip()),
        )
        self._conn.commit()

    def create_auth_session(
        self,
        *,
        email: str,
        nombre: str,
        rol: str,
        tenant_id: str | None = None,
        ttl_hours: int = 12,
    ) -> str:
        import secrets
        from datetime import datetime, timedelta, timezone

        token = f"sess_{secrets.token_hex(24)}"
        expira_dt = datetime.now(timezone.utc) + timedelta(hours=ttl_hours)
        expira_en = expira_dt.isoformat()

        cur = self._conn.cursor()
        cur.execute(
            """
            INSERT INTO sesiones_auth (token, email, nombre, rol, tenant_id, expira_en)
            VALUES (?, ?, ?, ?, ?, ?);
            """,
            (token, email.strip().lower(), nombre.strip(), rol.strip(), tenant_id, expira_en),
        )
        self._conn.commit()
        return token

    def get_auth_session(self, token: str) -> dict[str, Any] | None:
        if not token:
            return None
        from datetime import datetime, timezone

        cur = self._conn.cursor()
        row = cur.execute(
            """
            SELECT token, email, nombre, rol, tenant_id, expira_en
            FROM sesiones_auth
            WHERE token = ?;
            """,
            (token.strip(),),
        ).fetchone()

        if not row:
            return None

        # Verificar expiración
        try:
            exp_clean = str(row["expira_en"]).replace("Z", "+00:00")
            exp_dt = datetime.fromisoformat(exp_clean)
            if datetime.now(timezone.utc) > exp_dt:
                self.delete_auth_session(token)
                return None
        except Exception:
            pass

        return {
            "token": row["token"],
            "email": row["email"],
            "nombre": row["nombre"],
            "rol": row["rol"],
            "tenant_id": row["tenant_id"],
            "expira_en": row["expira_en"],
        }

    def delete_auth_session(self, token: str) -> bool:
        cur = self._conn.cursor()
        cur.execute("DELETE FROM sesiones_auth WHERE token = ?;", (token.strip(),))
        self._conn.commit()
        return cur.rowcount > 0

    def get_emergency_pin(self) -> str:
        """PIN de emergencia para técnicos/admins locales si no hay internet."""
        pin = self.get_config("pin_emergencia")
        if not pin:
            return "123456"
        return pin

    def set_emergency_pin(self, new_pin: str) -> None:
        self.set_config("pin_emergencia", new_pin.strip())

    def record_triggered_notification(
        self,
        *,
        mensaje_id: str,
        codigo_empleado: str,
        nombre_empleado: str,
        tipo_marca: str,
        titulo: str,
        mensaje: str,
        texto_voz: str,
        reproducir_audio: bool = True,
        canal_utilizado: str = "AGENTE_AUDIO_VISUAL",
        estatus_entrega: str = "ENTREGADO_DISPOSITIVO",
        whatsapp_web_url: str | None = None,
        ts_utc: str | None = None,
    ) -> int:
        from datetime import datetime, timezone

        now_iso = ts_utc or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        cur = self._conn.cursor()
        cur.execute(
            """
            INSERT INTO notificaciones_disparadas_local (
                mensaje_id,
                codigo_empleado,
                nombre_empleado,
                tipo_marca,
                titulo,
                mensaje,
                texto_voz,
                reproducir_audio,
                canal_utilizado,
                estatus_entrega,
                whatsapp_web_url,
                ts_utc,
                leida
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0);
            """,
            (
                mensaje_id.strip(),
                codigo_empleado.strip(),
                nombre_empleado.strip(),
                tipo_marca.strip(),
                titulo.strip(),
                mensaje.strip(),
                texto_voz.strip(),
                1 if reproducir_audio else 0,
                canal_utilizado.strip(),
                estatus_entrega.strip(),
                whatsapp_web_url,
                now_iso,
            ),
        )
        self._conn.commit()
        return int(cur.lastrowid or 0)

    def list_recent_notifications(
        self, limit: int = 25, only_unread: bool = False
    ) -> list[dict[str, Any]]:
        safe_limit = max(1, min(100, limit))
        cur = self._conn.cursor()
        if only_unread:
            rows = cur.execute(
                """
                SELECT * FROM notificaciones_disparadas_local
                WHERE leida = 0
                ORDER BY id DESC
                LIMIT ?;
                """,
                (safe_limit,),
            ).fetchall()
        else:
            rows = cur.execute(
                """
                SELECT * FROM notificaciones_disparadas_local
                ORDER BY id DESC
                LIMIT ?;
                """,
                (safe_limit,),
            ).fetchall()

        return [
            {
                "id": int(r["id"]),
                "mensaje_id": str(r["mensaje_id"]),
                "codigo_empleado": str(r["codigo_empleado"]),
                "nombre_empleado": str(r["nombre_empleado"]),
                "tipo_marca": str(r["tipo_marca"]),
                "titulo": str(r["titulo"]),
                "mensaje": str(r["mensaje"]),
                "texto_voz": str(r["texto_voz"]),
                "reproducir_audio": bool(r["reproducir_audio"]),
                "canal_utilizado": str(r["canal_utilizado"]),
                "estatus_entrega": str(r["estatus_entrega"]),
                "whatsapp_web_url": (
                    str(r["whatsapp_web_url"])
                    if r["whatsapp_web_url"] is not None
                    else None
                ),
                "ts_utc": str(r["ts_utc"]),
                "leida": bool(r["leida"]),
                "created_at": str(r["created_at"]),
            }
            for r in rows
        ]

    def mark_notification_read(self, notif_id: int) -> bool:
        cur = self._conn.cursor()
        cur.execute(
            "UPDATE notificaciones_disparadas_local SET leida = 1 WHERE id = ?;",
            (int(notif_id),),
        )
        self._conn.commit()
        return cur.rowcount > 0

    def close(self) -> None:
        self._conn.close()
