from __future__ import annotations

import hashlib
import hmac
import json
import logging
import random
import secrets
import time
from datetime import datetime, timezone
from typing import Any, Callable

from .db import AgentLocalDatabase

logger = logging.getLogger("sm_clock_agent.sync")


def sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def compute_agent_hmac_signature(
    *,
    credencial_token: str,
    timestamp: str,
    nonce: str,
    raw_body: str,
) -> str:
    """
    Calcula la firma HMAC-SHA256 idéntica a `computeAgentHmacSignature` en Node.js:
    llave derivada = `sha256_hex(credencial_token)` (= `token_hash` almacenado en nube),
    mensaje canónico = f"{timestamp}.{nonce}.{raw_body}".
    """
    token_hash = sha256_hex(credencial_token)
    canonical = f"{timestamp}.{nonce}.{raw_body}"
    return hmac.new(
        token_hash.encode("utf-8"),
        canonical.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def build_signed_headers(
    *,
    agente_id: str,
    credencial_token: str,
    raw_body: str,
    timestamp: int | None = None,
    nonce: str | None = None,
) -> dict[str, str]:
    ts_str = str(timestamp if timestamp is not None else int(time.time()))
    nonce_str = nonce if nonce is not None else f"nonce_{secrets.token_hex(12)}"
    signature = compute_agent_hmac_signature(
        credencial_token=credencial_token,
        timestamp=ts_str,
        nonce=nonce_str,
        raw_body=raw_body,
    )
    return {
        "Authorization": f"Bearer {credencial_token}",
        "Content-Type": "application/json",
        "Accept": "application/json",
        "x-agent-id": agente_id,
        "x-agent-timestamp": ts_str,
        "x-agent-nonce": nonce_str,
        "x-agent-signature": signature,
    }


def compute_backoff_seconds(attempt: int, base: float = 1.0, cap: float = 60.0) -> float:
    """Backoff exponencial con jitter para reintentos ante corte de internet."""
    exp = min(cap, base * (2 ** max(0, attempt)))
    jitter = random.uniform(0.0, 0.25 * exp)
    return min(cap, exp + jitter)


def check_clock_drift(server_ts_iso: str, max_drift_seconds: float = 120.0) -> tuple[float, bool]:
    """
    Compara el reloj del equipo local con el timestamp UTC devuelto por el servidor.
    Retorna (drift_segundos, alerta_desvio).
    Alerta si hay desvío mayor a 2 minutos (>120 s).
    """
    try:
        # server_ts_iso: ISO 8601 UTC
        srv_clean = server_ts_iso.replace("Z", "+00:00")
        srv_dt = datetime.fromisoformat(srv_clean)
        local_dt = datetime.now(timezone.utc)
        drift = abs((local_dt - srv_dt).total_seconds())
        is_alert = drift > max_drift_seconds
        return drift, is_alert
    except Exception:
        return 0.0, False


class CloudSyncClient:
    """
    Sincronizador del Agente Local hacia la API de la nube (`/api/v1/agente/*`).
    - Enrolamiento con código de un solo uso.
    - Envío de latidos cada 60 s con detección de desvío de reloj.
    - Envío de lotes de hasta 500 checadas firmados con HMAC-SHA256.
    - Sincronización de catálogo de empleados (07:05 y 14:05).
    """

    def __init__(
        self,
        *,
        db: AgentLocalDatabase,
        agente_id: str,
        credencial_token: str,
        server_url: str = "http://127.0.0.1:3000",
        transport_post: Callable[[str, str, dict[str, str]], tuple[int, dict[str, Any]]] | None = None,
    ) -> None:
        self.db = db
        self.agente_id = agente_id
        self.credencial_token = credencial_token
        self.server_url = server_url.rstrip("/")
        self.transport_post = transport_post
        self.ultimo_latido_ts: str | None = None
        self.ultimo_drift_segundos: float = 0.0
        self.alerta_desvio_reloj: bool = False
        self.last_alerts: dict[str, float] = {}

    def _execute_post(self, path: str, raw_body: str, headers: dict[str, str]) -> tuple[int, dict[str, Any]]:
        if self.transport_post:
            return self.transport_post(path, raw_body, headers)
        try:
            import httpx
            full_url = f"{self.server_url}{path}"
            resp = httpx.post(full_url, headers=headers, content=raw_body, timeout=10.0)
            try:
                data = resp.json()
            except Exception:
                data = {"text": resp.text}
            return resp.status_code, data
        except Exception as exc:
            logger.warning("Error de transporte en POST %s: %s", path, exc)
            return 503, {"error": str(exc)}

    def flush_pending_batch(self, max_batch_size: int = 500) -> int:
        pending = self.db.fetch_pending_batch(limit=min(500, max_batch_size))
        if not pending:
            return 0

        lote_id = f"lote_{int(time.time())}_{pending[0].id}_{pending[-1].id}"
        payload = {
            "lote_id": lote_id,
            "checadas": [
                {
                    "fuente_id": p.fuente_id,
                    "codigo_empleado": p.codigo_empleado,
                    "ts_utc": p.ts_utc,
                    "ts_dispositivo_local": p.ts_dispositivo_local,
                    "ambigua": p.ambigua,
                    "tipo_marca": p.tipo_marca,
                    "tipo_verificacion": p.tipo_verificacion,
                }
                for p in pending
            ],
        }
        raw_body = json.dumps(payload, separators=(",", ":"))
        headers = build_signed_headers(
            agente_id=self.agente_id,
            credencial_token=self.credencial_token,
            raw_body=raw_body,
        )

        status_code, resp_data = self._execute_post(
            "/api/v1/agente/checadas",
            raw_body,
            headers,
        )
        if status_code == 200:
            synced_count = self.db.mark_batch_synced([p.id for p in pending])
            if "servidor_ts_utc" in resp_data:
                drift, alert = check_clock_drift(str(resp_data["servidor_ts_utc"]))
                self.ultimo_drift_segundos = drift
                self.alerta_desvio_reloj = alert
            return synced_count
        return 0

    def send_heartbeat(
        self,
        version: str = "1.0.0",
        fuentes_estado: list[dict[str, Any]] | None = None,
    ) -> bool:
        """
        Envía latido cada 60 s a `/api/v1/agente/latido` con versión, timestamp local,
        cola pendiente y estado de salud de cada reloj conectado.
        """
        payload = {
            "version": version,
            "ts_local_agente": datetime.now().isoformat(),
            "cola_pendiente": self.db.count_pending(),
            "fuentes_estado": fuentes_estado or [],
        }
        raw_body = json.dumps(payload, separators=(",", ":"))
        headers = build_signed_headers(
            agente_id=self.agente_id,
            credencial_token=self.credencial_token,
            raw_body=raw_body,
        )

        status_code, resp_data = self._execute_post(
            "/api/v1/agente/latido",
            raw_body,
            headers,
        )
        if status_code == 200:
            self.ultimo_latido_ts = datetime.now(timezone.utc).isoformat()
            if "servidor_ts_utc" in resp_data:
                drift, alert = check_clock_drift(str(resp_data["servidor_ts_utc"]))
                self.ultimo_drift_segundos = drift
                self.alerta_desvio_reloj = alert
                if alert:
                    logger.warning("ALERTA DESVÍO DE RELOJ: El reloj local difiere %.1f s del servidor (>120s)", drift)
            return True
        return False

    def sync_employees(self) -> int:
        """
        Descarga catálogo de empleados del tenant desde la nube (`/api/v1/agente/sync-empleados`)
        y actualiza la caché local SQLite.
        """
        raw_body = json.dumps({"agente_id": self.agente_id}, separators=(",", ":"))
        headers = build_signed_headers(
            agente_id=self.agente_id,
            credencial_token=self.credencial_token,
            raw_body=raw_body,
        )

        status_code, resp_data = self._execute_post(
            "/api/v1/agente/sync-empleados",
            raw_body,
            headers,
        )
        if status_code == 200 and "empleados" in resp_data:
            empleados_list = resp_data.get("empleados", [])
            return self.db.upsert_empleados(empleados_list)
        return 0

    def report_error(
        self,
        tipo_error: str,
        mensaje: str,
        detalle: str | None = None,
        fuente_id: str | None = None,
        dispositivo: str | None = None,
        force: bool = False,
    ) -> bool:
        """
        Notifica una alerta de error del agente a la aplicación web (/api/v1/agente/alertas).
        La aplicación envía un correo con el detalle a los Super-Admin y al Admin del tenant
        utilizando la configuración SMTP del tenant.
        Incluye un cooldown de 120s por tipo_error + fuente_id para no saturar bandejas.
        """
        key = f"{tipo_error}:{fuente_id or ''}"
        now = time.time()
        last = self.last_alerts.get(key, 0.0)
        if not force and (now - last < 120.0):
            logger.info("Alerta %s en periodo de enfriamiento (<120s), omitiendo reenvío", key)
            return False

        payload = {
            "origen": "AGENTE_LOCAL",
            "tipo_error": tipo_error,
            "mensaje": mensaje,
            "detalle": detalle,
            "fuente_id": fuente_id,
            "dispositivo": dispositivo,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        raw_body = json.dumps(payload, separators=(",", ":"))
        headers = build_signed_headers(
            agente_id=self.agente_id,
            credencial_token=self.credencial_token,
            raw_body=raw_body,
        )
        status_code, resp_data = self._execute_post("/api/v1/agente/alertas", raw_body, headers)
        if status_code in (200, 201):
            self.last_alerts[key] = now
            logger.warning("Alerta de error enviada a la nube (%s): %s", tipo_error, mensaje)
            return True
        else:
            logger.error("Fallo al enviar alerta de error (%s): HTTP %s - %s", tipo_error, status_code, resp_data)
            return False

    def test_endpoint_latido(self, version: str = "1.0.0") -> dict[str, Any]:
        """Prueba de diagnóstico interactiva para /api/v1/agente/latido."""
        t0 = time.perf_counter()
        payload = {
            "version": version,
            "ts_local_agente": datetime.now().isoformat(),
            "cola_pendiente": self.db.count_pending(),
            "fuentes_estado": [],
        }
        raw_body = json.dumps(payload, separators=(",", ":"))
        headers = build_signed_headers(
            agente_id=self.agente_id,
            credencial_token=self.credencial_token,
            raw_body=raw_body,
        )
        status_code, resp_data = self._execute_post("/api/v1/agente/latido", raw_body, headers)
        lat_ms = round((time.perf_counter() - t0) * 1000, 2)

        drift = 0.0
        alert = False
        if "server_ts_utc" in resp_data:
            drift, alert = check_clock_drift(str(resp_data["server_ts_utc"]))
        elif "servidor_ts_utc" in resp_data:
            drift, alert = check_clock_drift(str(resp_data["servidor_ts_utc"]))

        return {
            "endpoint": "/api/v1/agente/latido",
            "ok": status_code == 200,
            "status_code": status_code,
            "latencia_ms": lat_ms,
            "drift_segundos": drift,
            "alerta_desvio_reloj": alert,
            "respuesta": resp_data,
        }

    def test_endpoint_checadas(self) -> dict[str, Any]:
        """Prueba de diagnóstico interactiva para /api/v1/agente/checadas con firma HMAC."""
        import uuid
        t0 = time.perf_counter()
        now_dt = datetime.now()
        local_ts_str = now_dt.strftime("%Y-%m-%d %H:%M:%S")
        utc_ts_str = datetime.now(timezone.utc).isoformat()
        dummy_fuente = "00000000-0000-0000-0000-000000000001"

        payload = {
            "lote_id": f"diag_test_{int(time.time())}_{uuid.uuid4().hex[:8]}",
            "checadas": [
                {
                    "fuente_id": dummy_fuente,
                    "codigo_empleado": "TEST_DIAG_01",
                    "ts_utc": utc_ts_str,
                    "ts_dispositivo_local": local_ts_str,
                    "ambigua": False,
                    "tipo_marca": "CHECADA",
                    "tipo_verificacion": "API",
                }
            ],
        }
        raw_body = json.dumps(payload, separators=(",", ":"))
        headers = build_signed_headers(
            agente_id=self.agente_id,
            credencial_token=self.credencial_token,
            raw_body=raw_body,
        )
        status_code, resp_data = self._execute_post("/api/v1/agente/checadas", raw_body, headers)
        lat_ms = round((time.perf_counter() - t0) * 1000, 2)

        return {
            "endpoint": "/api/v1/agente/checadas",
            "ok": status_code == 200,
            "status_code": status_code,
            "latencia_ms": lat_ms,
            "respuesta": resp_data,
        }

    def test_endpoint_empleados(self) -> dict[str, Any]:
        """Prueba de diagnóstico interactiva para /api/v1/agente/sync-empleados."""
        t0 = time.perf_counter()
        raw_body = json.dumps({"agente_id": self.agente_id}, separators=(",", ":"))
        headers = build_signed_headers(
            agente_id=self.agente_id,
            credencial_token=self.credencial_token,
            raw_body=raw_body,
        )
        status_code, resp_data = self._execute_post("/api/v1/agente/sync-empleados", raw_body, headers)
        lat_ms = round((time.perf_counter() - t0) * 1000, 2)
        count = 0
        if status_code == 200 and "empleados" in resp_data:
            count = self.db.upsert_empleados(resp_data.get("empleados", []))

        return {
            "endpoint": "/api/v1/agente/sync-empleados",
            "ok": status_code == 200,
            "status_code": status_code,
            "latencia_ms": lat_ms,
            "empleados_actualizados": count,
            "respuesta": resp_data,
        }



def enroll_agent_with_code(
    *,
    codigo_enrolamiento: str,
    nombre_agente: str,
    server_url: str = "http://127.0.0.1:3000",
    version: str = "1.0.0",
    hostname: str | None = None,
    transport_post: Callable[[str, str, dict[str, str]], tuple[int, dict[str, Any]]] | None = None,
) -> dict[str, Any] | None:
    """
    Canjea el código de enrolamiento de un solo uso en `POST /api/v1/agente/enrolar`.
    Devuelve los datos del nuevo agente (`agente_id`, `credencial_token`, `tenant_id`, `zona_horaria`).
    """
    payload = {
        "codigo_enrolamiento": codigo_enrolamiento.strip(),
        "nombre_agente": nombre_agente.strip(),
        "version": version,
        "hostname": hostname,
    }
    raw_body = json.dumps(payload, separators=(",", ":"))
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
    }

    if transport_post:
        status_code, data = transport_post("/api/v1/agente/enrolar", raw_body, headers)
    else:
        try:
            import httpx
            full_url = f"{server_url.rstrip('/')}/api/v1/agente/enrolar"
            resp = httpx.post(full_url, headers=headers, content=raw_body, timeout=15.0)
            status_code = resp.status_code
            data = resp.json()
        except Exception as exc:
            logger.error("Fallo al enrolar agente contra %s: %s", server_url, exc)
            return None

    if status_code in (200, 201) and "credencial_token" in data:
        return data
    return None


def verify_technician_credentials(
    *,
    email: str,
    password: str,
    server_url: str = "http://127.0.0.1:3000",
    agente_id: str | None = None,
    transport_post: Callable[[str, str, dict[str, str]], tuple[int, dict[str, Any]]] | None = None,
) -> tuple[bool, str, dict[str, Any] | None]:
    """
    Verifica las credenciales de un Super-Admin o Admin del Tenant en la nube
    mediante POST /api/v1/agente/verificar-tecnico.
    """
    payload: dict[str, Any] = {
        "email": email.strip(),
        "password": password,
    }
    if agente_id:
        payload["agente_id"] = agente_id.strip()

    raw_body = json.dumps(payload, separators=(",", ":"))
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
    }

    if transport_post:
        status_code, data = transport_post("/api/v1/agente/verificar-tecnico", raw_body, headers)
    else:
        try:
            import httpx
            full_url = f"{server_url.rstrip('/')}/api/v1/agente/verificar-tecnico"
            resp = httpx.post(full_url, headers=headers, content=raw_body, timeout=10.0)
            status_code = resp.status_code
            try:
                data = resp.json()
            except Exception:
                data = {"error": resp.text}
        except Exception as exc:
            return False, f"Error de conexión con el servidor: {exc}", None

    if status_code == 200 and data.get("ok"):
        return True, "Acceso concedido", data.get("usuario")
    return False, data.get("error", "Credenciales inválidas"), None

