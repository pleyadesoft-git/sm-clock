"""Conectores de destino de nómina y RH para el Agente Local."""

from .layouts import (
    CONTPAQiLayoutGenerator,
    ContpaqiMovimiento,
    TRESSLayoutGenerator,
)
from .rh4000 import RH4000Client, RH4000Config

__all__ = [
    "CONTPAQiLayoutGenerator",
    "ContpaqiMovimiento",
    "TRESSLayoutGenerator",
    "RH4000Client",
    "RH4000Config",
]
