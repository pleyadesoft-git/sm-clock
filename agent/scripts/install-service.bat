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
echo  SM-Clock - Instalador de Servicio de Windows (x64)
echo ========================================================

set "SERVICE_NAME=SMClockAgent"
set "DISPLAY_NAME=SM-Clock Agente Local de Asistencia"

:: Deteccion inteligente de la carpeta del ejecutable
set "SCRIPT_DIR=%~dp0"
set "EXE_PATH="
set "AGENT_DIR="

if exist "%SCRIPT_DIR%sm-clock-agent.exe" (
    set "AGENT_DIR=%SCRIPT_DIR%"
    set "EXE_PATH=%SCRIPT_DIR%sm-clock-agent.exe"
) else if exist "%SCRIPT_DIR%dist\sm-clock-agent.exe" (
    set "AGENT_DIR=%SCRIPT_DIR%"
    set "EXE_PATH=%SCRIPT_DIR%dist\sm-clock-agent.exe"
) else if exist "%SCRIPT_DIR%..\sm-clock-agent.exe" (
    set "AGENT_DIR=%SCRIPT_DIR%..\"
    set "EXE_PATH=%SCRIPT_DIR%..\sm-clock-agent.exe"
) else if exist "%SCRIPT_DIR%..\dist\sm-clock-agent.exe" (
    set "AGENT_DIR=%SCRIPT_DIR%..\"
    set "EXE_PATH=%SCRIPT_DIR%..\dist\sm-clock-agent.exe"
)

if not defined EXE_PATH (
    echo [ERROR] No se encontro sm-clock-agent.exe.
    echo Asegurate de descomprimir todos los archivos del .ZIP en la misma carpeta.
    echo Carpeta actual: %SCRIPT_DIR%
    pause
    exit /b 1
)

cd /d "%AGENT_DIR%"
set "AGENT_DIR=%CD%"

echo Carpeta de instalacion: %AGENT_DIR%
echo Archivo ejecutable:     %EXE_PATH%

if not exist "%AGENT_DIR%\logs" (
    mkdir "%AGENT_DIR%\logs"
)

:: Buscar NSSM (Service Manager) en la carpeta local o en el PATH
set "NSSM_EXE="
if exist "%AGENT_DIR%\nssm.exe" (
    set "NSSM_EXE=%AGENT_DIR%\nssm.exe"
) else if exist "%SCRIPT_DIR%nssm.exe" (
    set "NSSM_EXE=%SCRIPT_DIR%nssm.exe"
) else if exist "%AGENT_DIR%\scripts\nssm.exe" (
    set "NSSM_EXE=%AGENT_DIR%\scripts\nssm.exe"
) else (
    where nssm >nul 2>&1
    if %errorLevel% equ 0 (
        set "NSSM_EXE=nssm"
    )
)

if defined NSSM_EXE (
    echo.
    echo [1/3] Configurando como Servicio de Windows (via NSSM)...
    "%NSSM_EXE%" stop "%SERVICE_NAME%" >nul 2>&1
    "%NSSM_EXE%" remove "%SERVICE_NAME%" confirm >nul 2>&1

    "%NSSM_EXE%" install "%SERVICE_NAME%" "%EXE_PATH%" "run" "--no-browser"
    "%NSSM_EXE%" set "%SERVICE_NAME%" AppDirectory "%AGENT_DIR%"
    "%NSSM_EXE%" set "%SERVICE_NAME%" DisplayName "%DISPLAY_NAME%"
    "%NSSM_EXE%" set "%SERVICE_NAME%" Description "Captura checadas de relojes ZKTeco y Hikvision y las envia al SaaS SM-Clock."
    "%NSSM_EXE%" set "%SERVICE_NAME%" Start SERVICE_AUTO_START
    "%NSSM_EXE%" set "%SERVICE_NAME%" AppStdout "%AGENT_DIR%\logs\agent.log"
    "%NSSM_EXE%" set "%SERVICE_NAME%" AppStderr "%AGENT_DIR%\logs\agent_error.log"
    "%NSSM_EXE%" set "%SERVICE_NAME%" AppRotateFiles 1
    "%NSSM_EXE%" set "%SERVICE_NAME%" AppRotateOnline 1
    "%NSSM_EXE%" set "%SERVICE_NAME%" AppRotateBytes 10485760

    echo [2/3] Iniciando servicio de Windows...
    "%NSSM_EXE%" start "%SERVICE_NAME%"
    sc.exe query "%SERVICE_NAME%"
) else (
    echo.
    echo [1/3] NSSM no encontrado. Registrando como Tarea Programada de Inicio Automatico (SYSTEM)...
    schtasks /delete /tn "%SERVICE_NAME%" /f >nul 2>&1
    schtasks /create /tn "%SERVICE_NAME%" /tr "\"%EXE_PATH%\" run --no-browser" /sc ONSTART /ru "SYSTEM" /rl HIGHEST /f
    echo [2/3] Iniciando tarea en segundo plano...
    schtasks /run /tn "%SERVICE_NAME%"
)

echo [3/3] Abriendo panel web en el navegador...
timeout /t 2 >nul
start http://127.0.0.1:8085

echo.
echo ========================================================
echo  INSTALACION COMPLETADA EXITOSAMENTE
echo ========================================================
echo El agente se esta ejecutando en segundo plano.
echo Interfaz grafica disponible en:
echo   http://127.0.0.1:8085
echo.
echo Puedes ingresar con tus credenciales de Super-Admin o
echo con el PIN de emergencia offline: 123456
echo ========================================================
pause
