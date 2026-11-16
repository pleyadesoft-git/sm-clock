@echo off
setlocal
title SM-Clock Agente Local (Consola Interactiva)
echo ========================================================
echo  Iniciando SM-Clock Agente Local en primer plano...
echo ========================================================

set "SCRIPT_DIR=%~dp0"
set "EXE_PATH="

if exist "%SCRIPT_DIR%sm-clock-agent.exe" (
    set "EXE_PATH=%SCRIPT_DIR%sm-clock-agent.exe"
) else if exist "%SCRIPT_DIR%dist\sm-clock-agent.exe" (
    set "EXE_PATH=%SCRIPT_DIR%dist\sm-clock-agent.exe"
) else if exist "%SCRIPT_DIR%..\sm-clock-agent.exe" (
    set "EXE_PATH=%SCRIPT_DIR%..\sm-clock-agent.exe"
) else if exist "%SCRIPT_DIR%..\dist\sm-clock-agent.exe" (
    set "EXE_PATH=%SCRIPT_DIR%..\dist\sm-clock-agent.exe"
)

if not defined EXE_PATH (
    echo [ERROR] No se encontro sm-clock-agent.exe
    echo Descomprime todo el contenido del .ZIP en una sola carpeta.
    pause
    exit /b 1
)

"%EXE_PATH%" run
pause
