from __future__ import annotations

import hashlib
import hmac
import json
import random
import secrets
import time
from typing import Any, Callable

from .db import AgentLocalDatabase


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


class CloudSyncClient:
    """
    Sincronizador del Agente Local hacia la API de la nube (`/api/v1/agente/*`).
    - Envía lotes de hasta 500 checadas firmados con HMAC-SHA256 + timestamp + nonce.
    - Solo marca `sincronizado=1` en SQLite local cuando el servidor responde 200 OK.
    """

    def __init__(
        self,
        *,
        db: AgentLocalDatabase,
        agente_id: str,
        credencial_token: str,
        transport_post: Callable[[str, str, dict[str, str]], tuple[int, dict[str, Any]]],
    ) -> None:
        self.db = db
        self.agente_id = agente_id
        self.credencial_token = credencial_token
        self.transport_post = transport_post

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

        status_code, _ = self.transport_post(
            "/api/v1/agente/checadas",
            raw_body,
            headers,
        )
        if status_code == 200:
            return self.db.mark_batch_synced([p.id for p in pending])
        return 0
