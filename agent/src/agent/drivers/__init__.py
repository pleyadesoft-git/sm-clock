"""Drivers de captura de asistencia para el Agente Local."""

from .base import BaseClockDriver
from .hikvision import (
    HikvisionDriver,
    RawHikvisionEvent,
    parse_acs_event_search_json,
    parse_alert_stream_json,
    parse_alert_stream_xml,
    parse_terminal_export_csv,
)
from .tacloud import (
    RawTACloudPunch,
    TACloudDriver,
    parse_oauth_token,
    parse_punchlogs_json,
    parse_tacloud_15col_csv,
)
from .zkteco import (
    RawClockAttendanceRecord,
    ZKTecoDriver,
    parse_adms_payload,
    parse_attlog_dat,
    parse_live_socket_event,
    parse_pyzk_json,
    parse_zktime_csv,
)

__all__ = [
    "BaseClockDriver",
    "ZKTecoDriver",
    "RawClockAttendanceRecord",
    "parse_attlog_dat",
    "parse_zktime_csv",
    "parse_pyzk_json",
    "parse_adms_payload",
    "parse_live_socket_event",
    "HikvisionDriver",
    "RawHikvisionEvent",
    "parse_acs_event_search_json",
    "parse_alert_stream_json",
    "parse_alert_stream_xml",
    "parse_terminal_export_csv",
    "TACloudDriver",
    "RawTACloudPunch",
    "parse_oauth_token",
    "parse_tacloud_15col_csv",
    "parse_punchlogs_json",
]
