@echo off
setlocal enabledelayedexpansion

echo ========================================================
echo  SM-Clock Agente Local - Compilador de Ejecutable (.exe)
echo ========================================================

cd /d "%~dp0\.."

if not exist ".venv\Scripts\activate.bat" (
    echo [ERROR] No se encontro el entorno virtual en .venv.
    echo Crealo primero con: py -3.12 -m venv .venv
    pause
    exit /b 1
)

echo [1/3] Activando entorno virtual...
call .venv\Scripts\activate.bat

echo [2/3] Instalando dependencias de compilacion...
pip install -e ".[dev]" pyinstaller

echo [3/3] Compilando con PyInstaller (agent.spec)...
pyinstaller --clean -y agent.spec

if exist "dist\sm-clock-agent.exe" (
    echo.
    echo ========================================================
    echo  COMPILACION EXITOSA: dist\sm-clock-agent.exe
    echo ========================================================
    echo Puedes copiar 'dist\sm-clock-agent.exe' a la maquina cliente
    echo y ejecutar 'scripts\install-service.bat' como Administrador.
) else (
    echo [ERROR] Ocurrio un error durante la compilacion.
)

pause
