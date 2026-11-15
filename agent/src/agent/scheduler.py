from __future__ import annotations

import logging
from typing import Any, Sequence

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from .db import AgentLocalDatabase
from .drivers.base import BaseClockDriver
from .sync import CloudSyncClient

logger = logging.getLogger("sm_clock_agent.scheduler")


class AgentScheduler:
    """
    Planificador de tareas en segundo plano del Agente Local mediante APScheduler:
    1. Envío periódico de lotes de checadas (cada 5 s).
    2. Latido a la nube (cada 60 s) con estado de fuentes y detección de desvío de reloj.
    3. Reconciliación de relojes (cada 30 min) aislando fallos entre dispositivos.
    4. Sincronización de catálogo de empleados (07:05 y 14:05 hrs).
    """

    def __init__(
        self,
        *,
        db: AgentLocalDatabase,
        sync_client: CloudSyncClient,
        drivers: Sequence[BaseClockDriver] | None = None,
        batch_interval_seconds: int = 5,
        heartbeat_interval_seconds: int = 60,
        reconciliation_interval_minutes: int = 30,
        version: str = "1.0.0",
    ) -> None:
        self.db = db
        self.sync_client = sync_client
        self.drivers: list[BaseClockDriver] = list(drivers or [])
        self.batch_interval_seconds = max(1, batch_interval_seconds)
        self.heartbeat_interval_seconds = max(10, heartbeat_interval_seconds)
        self.reconciliation_interval_minutes = max(1, reconciliation_interval_minutes)
        self.version = version
        self._scheduler = BackgroundScheduler(daemon=True)

    def register_driver(self, driver: BaseClockDriver) -> None:
        self.drivers.append(driver)

    def job_flush_batch(self) -> int:
        try:
            return self.sync_client.flush_pending_batch()
        except Exception as exc:
            logger.error("Error al enviar lote a la nube: %s", exc)
            return 0

    def job_heartbeat(self) -> bool:
        try:
            fuentes_estado: list[dict[str, Any]] = [
                {
                    "fuente_id": d.fuente_id,
                    "conectado": d.conectado,
                    "ultimo_error": d.ultimo_error,
                }
                for d in self.drivers
            ]
            return self.sync_client.send_heartbeat(
                version=self.version,
                fuentes_estado=fuentes_estado,
            )
        except Exception as exc:
            logger.error("Error enviando latido: %s", exc)
            return False

    def job_reconcile_all_clocks(self) -> dict[str, int]:
        """
        Ejecuta la reconciliación periódica (cada 30 min).
        Aislamiento: si un reloj falla o está caído, no bloquea a los demás.
        """
        results: dict[str, int] = {}
        for driver in self.drivers:
            try:
                inserted = driver.reconcile_missing_punches()
                results[driver.fuente_id] = inserted
            except Exception as exc:
                logger.error("Fallo al reconciliar reloj %s (%s): %s", driver.nombre, driver.fuente_id, exc)
                results[driver.fuente_id] = -1
        return results

    def job_sync_employees(self) -> int:
        try:
            return self.sync_client.sync_employees()
        except Exception as exc:
            logger.error("Error al sincronizar empleados: %s", exc)
            return 0

    def start(self) -> None:
        # Job 1: Envío de lotes cada N segundos
        self._scheduler.add_job(
            self.job_flush_batch,
            trigger=IntervalTrigger(seconds=self.batch_interval_seconds),
            id="job_flush_batch",
            replace_existing=True,
            max_instances=1,
            coalesce=True,
        )

        # Job 2: Latido cada 60 s
        self._scheduler.add_job(
            self.job_heartbeat,
            trigger=IntervalTrigger(seconds=self.heartbeat_interval_seconds),
            id="job_heartbeat",
            replace_existing=True,
            max_instances=1,
            coalesce=True,
        )

        # Job 3: Reconciliación cada 30 min
        self._scheduler.add_job(
            self.job_reconcile_all_clocks,
            trigger=IntervalTrigger(minutes=self.reconciliation_interval_minutes),
            id="job_reconcile",
            replace_existing=True,
            max_instances=1,
            coalesce=True,
        )

        # Job 4: Catálogo de empleados a las 07:05 y 14:05 hrs
        self._scheduler.add_job(
            self.job_sync_employees,
            trigger=CronTrigger(hour="7,14", minute="5"),
            id="job_sync_employees",
            replace_existing=True,
            max_instances=1,
            coalesce=True,
        )

        self._scheduler.start()
        logger.info("AgentScheduler iniciado con éxito.")

    def stop(self) -> None:
        if self._scheduler.running:
            self._scheduler.shutdown(wait=False)
            logger.info("AgentScheduler detenido.")

    def is_running(self) -> bool:
        return self._scheduler.running
