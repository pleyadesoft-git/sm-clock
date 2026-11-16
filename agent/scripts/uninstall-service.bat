@echo off
setlocal enabledelayedexpansion

net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [ERROR] Este script requiere privilegios de Administrador.
    echo Por favor haz clic derecho en este archivo y selecciona "Ejecutar como administrador".
    pause
    exit /b 1
)

echo ========================================================
echo  SM-Clock - Desinstalador de Servicio de Windows
echo ========================================================

set "SERVICE_NAME=SMClockAgent"
set "SCRIPT_DIR=%~dp0"

:: Buscar NSSM
set "NSSM_EXE="
if exist "%SCRIPT_DIR%nssm.exe" (
    set "NSSM_EXE=%SCRIPT_DIR%nssm.exe"
) else if exist "%SCRIPT_DIR%..\nssm.exe" (
    set "NSSM_EXE=%SCRIPT_DIR%..\nssm.exe"
) else (
    where nssm >nul 2>&1
    if %errorLevel% equ 0 (
        set "NSSM_EXE=nssm"
    )
)

echo [1/3] Deteniendo servicio o proceso del agente...
if defined NSSM_EXE (
    "%NSSM_EXE%" stop "%SERVICE_NAME%" >nul 2>&1
    "%NSSM_EXE%" remove "%SERVICE_NAME%" confirm >nul 2>&1
) else (
    sc.exe stop "%SERVICE_NAME%" >nul 2>&1
    sc.exe delete "%SERVICE_NAME%" >nul 2>&1
)

echo [2/3] Eliminando tarea programada si existe...
schtasks /end /tn "%SERVICE_NAME%" >nul 2>&1
schtasks /delete /tn "%SERVICE_NAME%" /f >nul 2>&1

echo [3/3] Finalizando procesos remanentes si existieran...
taskkill /F /IM sm-clock-agent.exe >nul 2>&1

echo.
echo ========================================================
echo  Servicio desinstalado correctamente.
echo ========================================================
pause
