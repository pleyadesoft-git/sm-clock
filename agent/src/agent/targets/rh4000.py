from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Callable

from ..db import AgentLocalDatabase, QueuedPunch
from ..sync import compute_backoff_seconds


@dataclass
class RH4000Config:
    client_domain: str  # ej. "empresa" -> https://empresa.rh4000.com
    bearer_token: str
    company_code: str = "001"
    access_point_code: str = "001"
    timeout_seconds: float = 10.0


class RH4000Client:
    """
    Cliente REST para la API de RH4000.
    Endpoint: `POST https://{cliente}.rh4000.com/api/v1/Employees/{codigo}/Attendance`
    """

    def __init__(
        self,
        config: RH4000Config,
        db: AgentLocalDatabase | None = None,
        transport_post: Callable[[str, dict[str, str], str], tuple[int, str]] | None = None,
    ) -> None:
        self.config = config
        self.db = db
        self.transport_post = transport_post

    def build_url(self, employee_code: str) -> str:
        domain = self.config.client_domain.strip().lower()
        if not domain.startswith("http"):
            base = f"https://{domain}.rh4000.com"
        else:
            base = domain.rstrip("/")
        return f"{base}/api/v1/Employees/{employee_code.strip()}/Attendance"

    def build_payload(self, punch: QueuedPunch) -> dict[str, Any]:
        access_type = "1" if punch.tipo_marca.upper() == "ENTRADA" else "2"
        # eventDate en formato local ISO: YYYY-MM-DDTHH:MM:SS
        event_date = punch.ts_dispositivo_local.strip().replace(" ", "T")
        return {
            "companyCode": self.config.company_code,
            "employeeCode": punch.codigo_empleado.strip(),
            "accessPointCode": self.config.access_point_code,
            "eventDate": event_date,
            "accessType": access_type,
            "maskFlag": "2",
            "temperature": "",
        }

    def dispatch_punch(self, punch: QueuedPunch, max_retries: int = 3) -> bool:
        url = self.build_url(punch.codigo_empleado)
        payload = self.build_payload(punch)
        raw_body = json.dumps(payload, separators=(",", ":"))
        headers = {
            "Authorization": f"Bearer {self.config.bearer_token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "X-Idempotency-Key": f"rh4000_{punch.fuente_id}_{punch.codigo_empleado}_{punch.ts_utc}",
        }

        success = False
        last_error: str | None = None

        for attempt in range(max_retries):
            try:
                if self.transport_post:
                    status_code, resp_text = self.transport_post(url, headers, raw_body)
                else:
                    import httpx
                    resp = httpx.post(url, headers=headers, content=raw_body, timeout=self.config.timeout_seconds)
                    status_code, resp_text = resp.status_code, resp.text

                if status_code in (200, 201):
                    success = True
                    break
                else:
                    last_error = f"HTTP {status_code}: {resp_text}"
            except Exception as exc:
                last_error = str(exc)

            if attempt < max_retries - 1:
                import time
                time.sleep(compute_backoff_seconds(attempt, base=0.1, cap=2.0))

        if self.db:
            self.db.log_destino_envio(
                destino="RH4000",
                archivo_o_url=url,
                registros_procesados=1 if success else 0,
                estatus="ENVIADO" if success else "ERROR",
                error_detalle=last_error,
            )

        return success
