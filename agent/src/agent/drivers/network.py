from __future__ import annotations

import socket
import time
from typing import Any


def probe_tcp_socket(
    host: str,
    port: int,
    timeout: float = 3.0,
) -> tuple[bool, str, float]:
    """
    Realiza una prueba de conexión TCP directa por socket (ej. puerto 4370 de ZKTeco).
    Calcula la latencia de red en milisegundos.
    """
    clean_host = host.strip()
    start_time = time.perf_counter()
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(timeout)
    try:
        sock.connect((clean_host, port))
        sock.close()
        latency_ms = (time.perf_counter() - start_time) * 1000.0
        return True, f"Conexión TCP exitosa a {clean_host}:{port}", round(latency_ms, 2)
    except socket.timeout:
        return False, f"Tiempo de espera agotado al conectar a {clean_host}:{port} ({timeout}s)", 0.0
    except ConnectionRefusedError:
        return False, f"Conexión rechazada por el dispositivo en {clean_host}:{port} (puerto cerrado)", 0.0
    except Exception as exc:
        return False, f"Fallo al conectar a {clean_host}:{port}: {exc}", 0.0
    finally:
        try:
            sock.close()
        except Exception:
            pass


def probe_device_connection(
    *,
    tipo: str,
    ip: str,
    puerto: int,
    usuario: str | None = None,
    password: str | None = None,
    comm_key: int = 0,
    timeout: float = 3.0,
) -> tuple[bool, str, float]:
    """
    Prueba de conexión viva adaptada según el tipo de dispositivo:
    - ZKTECO: Socket TCP en puerto 4370.
    - HIKVISION: Verificación de socket HTTP/HTTPS o endpoint ISAPI.
    - TACLOUD: Verificación de conectividad de host/API.
    """
    t = tipo.strip().upper()
    if t == "ZKTECO":
        port = puerto if puerto > 0 else 4370
        ok, msg, latency = probe_tcp_socket(ip, port, timeout=timeout)
        if ok and comm_key > 0:
            msg += f" (CommKey: {comm_key})"
        return ok, msg, latency

    elif t == "HIKVISION":
        port = puerto if puerto > 0 else 80
        # Primero probar si el socket TCP responde
        ok, msg, latency = probe_tcp_socket(ip, port, timeout=timeout)
        if not ok:
            return ok, msg, latency

        # Si responde TCP, intentar handshake HTTP básico
        try:
            import httpx
            scheme = "https" if port == 443 else "http"
            url = f"{scheme}://{ip}:{port}/ISAPI/System/status"
            auth = httpx.DigestAuth(usuario or "admin", password or "") if usuario else None
            resp = httpx.get(url, auth=auth, timeout=timeout, verify=False)
            latency_ms = resp.elapsed.total_seconds() * 1000.0
            if resp.status_code in (200, 401):  # 401 significa que ISAPI está vivo y solicitó autenticación
                return True, f"Terminal Hikvision ISAPI en línea (HTTP {resp.status_code})", round(latency_ms, 2)
            return True, f"Puerto {port} abierto en terminal Hikvision", latency
        except Exception:
            return True, f"Conexión TCP exitosa a terminal Hikvision en puerto {port}", latency

    elif t == "TACLOUD":
        # Probar resolución y conectividad HTTP
        try:
            import httpx
            start = time.perf_counter()
            target = ip if ip.startswith("http") else f"https://{ip}"
            resp = httpx.get(target, timeout=timeout)
            lat = (time.perf_counter() - start) * 1000.0
            return True, f"Servicio TA.Cloud alcanzable (HTTP {resp.status_code})", round(lat, 2)
        except Exception as exc:
            return False, f"No se pudo contactar TA.Cloud: {exc}", 0.0

    else:
        return probe_tcp_socket(ip, puerto, timeout=timeout)
