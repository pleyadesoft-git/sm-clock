# Agente Local Python (`agent/`)

Agente ligero en **Python 3.12 + FastAPI + SQLite** que corre como servicio en Windows en la red local del cliente para:
1. Capturar checadas en tiempo real desde relojes **ZKTeco** (`pyzk`, puerto 4370) y **Hikvision** (`ISAPI alertStream`).
2. Encolar eventos localmente en SQLite (`WAL` activo) con tolerancia a desconexiones de internet.
3. Enviar lotes firmados con HMAC-SHA256 + timestamp + nonce a la nube (`POST /api/v1/agente/checadas`).
4. Ejecutar reconciliaciones periódicas cada 30 minutos para cubrir huecos.
5. Exportar layouts locales hacia CONTPAQi Nóminas / Sistema TRESS cuando aplique.

> **Estado en Fase 0:** Esqueleto de directorio reservado. La implementación completa del agente y su simulador de reloj se realiza en la **Fase 1** según `docs/AGENT-LOCAL.md`.

## Comandos previstos (Fase 1+)
```bash
cd agent
pytest
```
