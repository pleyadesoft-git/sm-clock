# SM-Clock Agente Local - Script PowerShell de Registro como Servicio
# Requiere ejecutar como Administrador

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Error "Este script requiere privilegios de Administrador. Ejecuta PowerShell como Administrador."
    exit 1
}

$ServiceName = "SMClockAgent"
$DisplayName = "SM-Clock Agente Local de Asistencia"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$AgentDir = Split-Path -Parent $ScriptDir
Set-Location $AgentDir

$ExePath = Join-Path $AgentDir "dist\sm-clock-agent.exe"
if (-not (Test-Path $ExePath)) {
    $ExePath = Join-Path $AgentDir "sm-clock-agent.exe"
    if (-not (Test-Path $ExePath)) {
        Write-Error "No se encontró el ejecutable sm-clock-agent.exe. Compílalo con scripts\build-exe.bat."
        exit 1
    }
}

$LogDir = Join-Path $AgentDir "logs"
if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}

Write-Host "Configurando servicio $ServiceName..." -ForegroundColor Cyan

# Comprobar si ya existe el servicio
$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Deteniendo y eliminando versión previa del servicio..." -ForegroundColor Yellow
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
    & sc.exe delete $ServiceName | Out-Null
    Start-Sleep -Seconds 2
}

# Registrar servicio con sc.exe
$binPath = "`"$ExePath`" run"
& sc.exe create $ServiceName binPath= $binPath start= auto DisplayName= $DisplayName
& sc.exe description $ServiceName "Agente Local de Asistencia SM-Clock. Sincroniza relojes ZKTeco y Hikvision con la nube."
& sc.exe failure $ServiceName reset= 86400 actions= restart/60000/restart/60000/restart/60000
& sc.exe start $ServiceName

Start-Sleep -Seconds 2
$status = Get-Service -Name $ServiceName
Write-Host "Estado del servicio: $($status.Status)" -ForegroundColor Green
Write-Host "UI de Diagnóstico: http://127.0.0.1:8085" -ForegroundColor Cyan
