from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Sequence

from ..db import QueuedPunch


@dataclass
class ContpaqiMovimiento:
    codigo_empleado: str
    fecha: str  # YYYY-MM-DD o YYYYMMDD
    clave_incidencia: str  # REG, RET, HE2, HE3, etc.
    cantidad: float = 1.0


class CONTPAQiLayoutGenerator:
    """
    Generador de layout TXT para CONTPAQi Nóminas (`MovimientosDyHporperiodo.cfg`).
    Formato: CodigoEmpleado,Fecha(YYYYMMDD),ClaveIncidencia,Cantidad
    Escribe de forma atómica vía `.tmp` -> rename para evitar lecturas parciales
    por parte del sistema CONTPAQi.
    """

    def __init__(
        self,
        encoding: str = "windows-1252",
        line_ending: str = "\r\n",
    ) -> None:
        self.encoding = encoding
        self.line_ending = line_ending

    def render(self, movimientos: Sequence[ContpaqiMovimiento]) -> str:
        lines: list[str] = ["CodigoEmpleado,Fecha(YYYYMMDD),ClaveIncidencia,Cantidad"]
        for m in movimientos:
            f_clean = m.fecha.replace("-", "").replace("/", "").strip()
            # Formato estándar YYYYMMDD
            if len(f_clean) == 8:
                fecha_formatted = f_clean
            else:
                fecha_formatted = datetime.strptime(m.fecha.strip(), "%Y-%m-%d").strftime("%Y%m%d")
            cant_str = f"{m.cantidad:.2f}"
            lines.append(f"{m.codigo_empleado.strip()},{fecha_formatted},{m.clave_incidencia.strip()},{cant_str}")
        return self.line_ending.join(lines) + self.line_ending

    def write_atomic(self, target_path: str | Path, movimientos: Sequence[ContpaqiMovimiento]) -> Path:
        target = Path(target_path)
        target.parent.mkdir(parents=True, exist_ok=True)
        tmp_target = target.with_suffix(target.suffix + ".tmp")

        content = self.render(movimientos)
        tmp_target.write_bytes(content.encode(self.encoding, errors="replace"))

        # Rename atómico
        os.replace(tmp_target, target)
        return target


class TRESSLayoutGenerator:
    """
    Generador de layout TXT/CSV para Sistema TRESS (Checadas de asistencia).
    Formato: NoEmpleado,Fecha(DD/MM/YYYY),Hora(HH:MM:SS),Terminal
    Escribe de forma atómica vía `.tmp` -> rename.
    """

    def __init__(
        self,
        encoding: str = "windows-1252",
        line_ending: str = "\r\n",
        default_terminal: str = "01",
    ) -> None:
        self.encoding = encoding
        self.line_ending = line_ending
        self.default_terminal = default_terminal

    def render(self, punches: Sequence[QueuedPunch], terminal_code: str | None = None) -> str:
        lines: list[str] = ["NoEmpleado,Fecha(DD/MM/YYYY),Hora(HH:MM:SS),Terminal"]
        term = terminal_code or self.default_terminal

        for p in punches:
            # ts_dispositivo_local: 'YYYY-MM-DD HH:MM:SS'
            parts = p.ts_dispositivo_local.strip().split(" ")
            if len(parts) >= 2:
                d_parts = parts[0].split("-")
                if len(d_parts) == 3:
                    fecha_dmy = f"{d_parts[2]}/{d_parts[1]}/{d_parts[0]}"
                else:
                    fecha_dmy = parts[0]
                hora = parts[1]
            else:
                fecha_dmy = "01/01/2026"
                hora = "00:00:00"

            lines.append(f"{p.codigo_empleado.strip()},{fecha_dmy},{hora},{term}")

        return self.line_ending.join(lines) + self.line_ending

    def write_atomic(
        self,
        target_path: str | Path,
        punches: Sequence[QueuedPunch],
        terminal_code: str | None = None,
    ) -> Path:
        target = Path(target_path)
        target.parent.mkdir(parents=True, exist_ok=True)
        tmp_target = target.with_suffix(target.suffix + ".tmp")

        content = self.render(punches, terminal_code=terminal_code)
        tmp_target.write_bytes(content.encode(self.encoding, errors="replace"))

        # Rename atómico
        os.replace(tmp_target, target)
        return target
