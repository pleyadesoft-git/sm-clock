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
set "AGENT_DIR=%~dp0\.."

set "NSSM_EXE=%AGENT_DIR%\scripts\nssm.exe"
if not exist "%NSSM_EXE%" (
    where nssm >nul 2>&1
    if %errorLevel% equ 0 (
        set "NSSM_EXE=nssm"
    ) else (
        set "NSSM_EXE="
    )
)

echo [1/2] Deteniendo servicio %SERVICE_NAME%...
if defined NSSM_EXE (
    "%NSSM_EXE%" stop "%SERVICE_NAME%" >nul 2>&1
    "%NSSM_EXE%" remove "%SERVICE_NAME%" confirm >nul 2>&1
) else (
    sc.exe stop "%SERVICE_NAME%" >nul 2>&1
    sc.exe delete "%SERVICE_NAME%" >nul 2>&1
)

echo [2/2] Servicio eliminado correctamente.
echo ========================================================
pause
