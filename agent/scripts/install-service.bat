@echo off
setlocal enabledelayedexpansion

:: Verificar permisos de Administrador
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [ERROR] Este script requiere privilegios de Administrador.
    echo Por favor haz clic derecho en este archivo y selecciona "Ejecutar como administrador".
    pause
    exit /b 1
)

echo ========================================================
echo  SM-Clock - Instalador de Servicio de Windows
echo ========================================================

set "SERVICE_NAME=SMClockAgent"
set "DISPLAY_NAME=SM-Clock Agente Local de Asistencia"
set "AGENT_DIR=%~dp0\.."
cd /d "%AGENT_DIR%"

set "EXE_PATH=%AGENT_DIR%\dist\sm-clock-agent.exe"
if not exist "%EXE_PATH%" (
    if exist "%AGENT_DIR%\sm-clock-agent.exe" (
        set "EXE_PATH=%AGENT_DIR%\sm-clock-agent.exe"
    ) else (
        echo [ERROR] No se encontro el ejecutable sm-clock-agent.exe.
        echo Compilalo primero con 'scripts\build-exe.bat' o colocalo en la carpeta del agente.
        pause
        exit /b 1
    )
)

if not exist "%AGENT_DIR%\logs" (
    mkdir "%AGENT_DIR%\logs"
)

:: Verificar si NSSM esta disponible en la carpeta o PATH
set "NSSM_EXE=%AGENT_DIR%\scripts\nssm.exe"
if not exist "%NSSM_EXE%" (
    where nssm >nul 2>&1
    if %errorLevel% equ 0 (
        set "NSSM_EXE=nssm"
    ) else (
        set "NSSM_EXE="
    )
)

if defined NSSM_EXE (
    echo [1/4] Deteniendo servicio previo si existe...
    "%NSSM_EXE%" stop "%SERVICE_NAME%" >nul 2>&1
    "%NSSM_EXE%" remove "%SERVICE_NAME%" confirm >nul 2>&1

    echo [2/4] Registrando servicio con NSSM...
    "%NSSM_EXE%" install "%SERVICE_NAME%" "%EXE_PATH%" "run"
    "%NSSM_EXE%" set "%SERVICE_NAME%" AppDirectory "%AGENT_DIR%"
    "%NSSM_EXE%" set "%SERVICE_NAME%" DisplayName "%DISPLAY_NAME%"
    "%NSSM_EXE%" set "%SERVICE_NAME%" Description "Captura checadas de relojes ZKTeco y Hikvision y las envia al SaaS SM-Clock."
    "%NSSM_EXE%" set "%SERVICE_NAME%" Start SERVICE_AUTO_START
    "%NSSM_EXE%" set "%SERVICE_NAME%" AppStdout "%AGENT_DIR%\logs\agent.log"
    "%NSSM_EXE%" set "%SERVICE_NAME%" AppStderr "%AGENT_DIR%\logs\agent_error.log"
    "%NSSM_EXE%" set "%SERVICE_NAME%" AppRotateFiles 1
    "%NSSM_EXE%" set "%SERVICE_NAME%" AppRotateOnline 1
    "%NSSM_EXE%" set "%SERVICE_NAME%" AppRotateBytes 10485760

    echo [3/4] Iniciando servicio de Windows...
    "%NSSM_EXE%" start "%SERVICE_NAME%"
) else (
    echo [INFO] NSSM no encontrado. Instalando mediante Windows sc.exe nativo...
    sc.exe stop "%SERVICE_NAME%" >nul 2>&1
    sc.exe delete "%SERVICE_NAME%" >nul 2>&1

    sc.exe create "%SERVICE_NAME%" binPath= "\"%EXE_PATH%\" run" start= auto DisplayName= "%DISPLAY_NAME%"
    sc.exe description "%SERVICE_NAME%" "Captura checadas de relojes ZKTeco y Hikvision y las envia al SaaS SM-Clock."
    sc.exe failure "%SERVICE_NAME%" reset= 86400 actions= restart/60000/restart/60000/restart/60000
    sc.exe start "%SERVICE_NAME%"
)

echo [4/4] Verificando estado del servicio...
sc.exe query "%SERVICE_NAME%"

echo.
echo ========================================================
echo  INSTALACION COMPLETADA
echo ========================================================
echo El agente se esta ejecutando en segundo plano como servicio.
echo Accede a la UI de diagnostico en el navegador:
echo   http://127.0.0.1:8085
echo Logs en:
echo   %AGENT_DIR%\logs\agent.log
echo ========================================================
pause
