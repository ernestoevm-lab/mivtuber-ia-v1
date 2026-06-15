param(
  [switch]$KeepLmStudio,
  [switch]$UnloadModelsOnly,
  [switch]$CloseLmStudioGui,
  [switch]$Quiet
)

$ErrorActionPreference = "Continue"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

$pidFile = Join-Path $Root "data\run\luma-pids.json"

function Test-Command($name) {
  return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

function Stop-Pid($processId, $label) {
  if (!$processId) { return }
  $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
  if (!$process) { return }
  if (!$Quiet) { Write-Host "Deteniendo $label PID $processId..." -ForegroundColor Cyan }
  Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
}

function Stop-KokoroWorker {
  $workers = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
      $_.CommandLine -and
      $_.CommandLine.Contains("kokoro_worker.py") -and
      $_.CommandLine.Contains($Root)
    }
  foreach ($worker in $workers) {
    Stop-Pid $worker.ProcessId "worker de voz Kokoro"
  }
}

function Unload-LmStudioModels {
  if (!(Test-Command "lms")) {
    if (!$Quiet) { Write-Host "No encontre 'lms' en PATH; no puedo descargar modelos de LM Studio." -ForegroundColor Yellow }
    return
  }
  if (!$Quiet) { Write-Host "Descargando modelos de LM Studio..." -ForegroundColor Cyan }
  try {
    lms unload --all | Out-Host
  } catch {
    if (!$Quiet) { Write-Host "No pude descargar modelos de LM Studio o no habia modelos cargados." -ForegroundColor Yellow }
  }
}

function Stop-LmStudioServer {
  if (!(Test-Command "lms")) {
    if (!$Quiet) { Write-Host "No encontre 'lms' en PATH; no puedo detener LM Studio server." -ForegroundColor Yellow }
    return
  }
  if (!$Quiet) { Write-Host "Deteniendo LM Studio server..." -ForegroundColor Cyan }
  try {
    lms server stop | Out-Host
  } catch {
    if (!$Quiet) { Write-Host "LM Studio server ya estaba apagado o no respondio." -ForegroundColor Yellow }
  }
}

function Stop-LmStudioGui {
  if (!$CloseLmStudioGui) { return }
  if (!$Quiet) { Write-Host "Cerrando app grafica de LM Studio..." -ForegroundColor Cyan }
  Get-Process -ErrorAction SilentlyContinue |
    Where-Object { $_.ProcessName -like "LM Studio*" -or $_.ProcessName -like "LM-Studio*" } |
    ForEach-Object { Stop-Pid $_.Id "LM Studio GUI" }
}

if (!$Quiet) {
  Write-Host ""
  Write-Host "Apagar Luma" -ForegroundColor Cyan
}

if ($UnloadModelsOnly) {
  Unload-LmStudioModels
  if (!$Quiet) { Write-Host "Modelos descargados. Luma/frontend/backend no fueron detenidos." -ForegroundColor Green }
  exit 0
}

if (Test-Path $pidFile) {
  try {
    $state = Get-Content $pidFile -Raw | ConvertFrom-Json
    foreach ($child in $state.children) {
      Stop-Pid $child.pid "proceso de Luma"
    }
    Stop-Pid $state.parentPid "supervisor de Luma"
  } catch {
    if (!$Quiet) { Write-Host "No pude leer $pidFile; usare puertos como respaldo." -ForegroundColor Yellow }
  }
  Remove-Item -Force $pidFile -ErrorAction SilentlyContinue
}

Stop-KokoroWorker

$ports = @(5173, 8787)
$listeners = netstat -ano | Select-String ($ports -join "|")
foreach ($line in $listeners) {
  $text = $line.ToString()
  if ($text -notmatch "LISTENING") { continue }
  $parts = ($text -split "\s+") | Where-Object { $_ -ne "" }
  $processId = [int]$parts[-1]
  Stop-Pid $processId "puerto local"
}

if (!$KeepLmStudio) {
  Unload-LmStudioModels
  Stop-LmStudioServer
  Stop-LmStudioGui
} elseif (!$Quiet) {
  Write-Host "LM Studio se dejo encendido." -ForegroundColor Yellow
}

if (!$Quiet) {
  Write-Host "Luma apagada correctamente." -ForegroundColor Green
}
