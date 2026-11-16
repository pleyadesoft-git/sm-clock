# SM-Clock Agente Local - Script PowerShell de Registro como Servicio
# Requiere ejecutar como Administrador

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Error "Este script requiere privilegios de Administrador. Ejecuta PowerShell como Administrador."
    exit 1
}

$ServiceName = "SMClockAgent"
$DisplayName = "SM-Clock Agente Local de Asistencia"

$ScriptDir = $PSScriptRoot
if (-not $ScriptDir) {
    $ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
}

$ExePath = Join-Path $ScriptDir "sm-clock-agent.exe"
if (-not (Test-Path $ExePath)) {
    $ExePath = Join-Path $ScriptDir "dist\sm-clock-agent.exe"
}
if (-not (Test-Path $ExePath)) {
    $ParentDir = Split-Path -Parent $ScriptDir
    $ExePath = Join-Path $ParentDir "sm-clock-agent.exe"
    if (-not (Test-Path $ExePath)) {
        $ExePath = Join-Path $ParentDir "dist\sm-clock-agent.exe"
    }
}

if (-not (Test-Path $ExePath)) {
    Write-Error "No se encontro el ejecutable sm-clock-agent.exe en $ScriptDir."
    exit 1
}

$AgentDir = Split-Path -Parent $ExePath
Set-Location $AgentDir

$LogDir = Join-Path $AgentDir "logs"
if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}

Write-Host "Configurando agente en $AgentDir..." -ForegroundColor Cyan

# Buscar NSSM
$NssmExe = Join-Path $AgentDir "nssm.exe"
if (-not (Test-Path $NssmExe)) {
    $NssmExe = (Get-Command nssm -ErrorAction SilentlyContinue)?.Source
}

if ($NssmExe -and (Test-Path $NssmExe)) {
    Write-Host "Registrando con NSSM Service Manager..." -ForegroundColor Cyan
    & $NssmExe stop $ServiceName *>$null
    & $NssmExe remove $ServiceName confirm *>$null
    & $NssmExe install $ServiceName "$ExePath" "run" "--no-browser"
    & $NssmExe set $ServiceName AppDirectory "$AgentDir"
    & $NssmExe set $ServiceName DisplayName "$DisplayName"
    & $NssmExe set $ServiceName Description "Agente Local de Asistencia SM-Clock. Sincroniza relojes ZKTeco y Hikvision con la nube."
    & $NssmExe set $ServiceName Start SERVICE_AUTO_START
    & $NssmExe set $ServiceName AppStdout (Join-Path $LogDir "agent.log")
    & $NssmExe set $ServiceName AppStderr (Join-Path $LogDir "agent_error.log")
    & $NssmExe start $ServiceName
} else {
    Write-Host "Registrando como Tarea Programada de Windows (SYSTEM)..." -ForegroundColor Yellow
    & schtasks /delete /tn $ServiceName /f *>$null
    & schtasks /create /tn $ServiceName /tr "`"$ExePath`" run --no-browser" /sc ONSTART /ru "SYSTEM" /rl HIGHEST /f
    & schtasks /run /tn $ServiceName
}

Start-Sleep -Seconds 2
Write-Host "Agente en ejecucion en segundo plano." -ForegroundColor Green
Write-Host "Abriendo interfaz grafica en http://127.0.0.1:8085 ..." -ForegroundColor Cyan
Start-Process "http://127.0.0.1:8085"
