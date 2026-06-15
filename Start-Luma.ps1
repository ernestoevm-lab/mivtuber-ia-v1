$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$OutputEncoding = [System.Text.UTF8Encoding]::new()
Add-Type -AssemblyName System.Net.Http

function Read-EnvFile {
  $path = Join-Path $Root ".env"
  $envMap = @{}
  if (Test-Path $path) {
    Get-Content $path | ForEach-Object {
      $line = $_.Trim()
      if (!$line -or $line.StartsWith("#") -or !$line.Contains("=")) { return }
      $parts = $line.Split("=", 2)
      $envMap[$parts[0].Trim()] = $parts[1].Trim().Trim('"').Trim("'")
    }
  }
  return $envMap
}

function Write-EnvFile($envMap) {
  $order = @(
    "LLM_PROVIDER",
    "LM_STUDIO_BASE_URL",
    "LM_STUDIO_API_MODE",
    "LM_STUDIO_MODEL",
    "LLM_MAX_TOKENS",
    "LLM_STORE_REASONING",
    "LLM_REASONING_MAX_CHARS",
    "LLM_REASONING_REPAIR_ENABLED",
    "LLM_REASONING_REPAIR_MAX_TOKENS",
    "LLM_REASONING_REPAIR_TEMPERATURE",
    "LM_STUDIO_REASONING_EFFORT",
    "OLLAMA_HOST",
    "OLLAMA_MODEL",
    "OLLAMA_FALLBACK_MODEL",
    "LM_STUDIO_GPU_OFFLOAD",
    "LM_STUDIO_CONTEXT_LENGTH",
    "LM_STUDIO_TTL",
    "PYTHON_BIN",
    "PIPER_BIN",
    "PIPER_MODEL",
    "PIPER_CONFIG",
    "PORT"
  )
  $lines = New-Object System.Collections.Generic.List[string]
  foreach ($key in $order) {
    if ($envMap.ContainsKey($key)) {
      $lines.Add("$key=$($envMap[$key])")
    }
  }
  foreach ($key in $envMap.Keys) {
    if ($order -notcontains $key) {
      $lines.Add("$key=$($envMap[$key])")
    }
  }
  Set-Content -Path (Join-Path $Root ".env") -Value $lines -Encoding UTF8
}

function Select-LmModel($currentModel) {
  $json = lms ls --llm --json | ConvertFrom-Json
  if (!$json -or $json.Count -eq 0) {
    Write-Host "No encontre modelos LLM en LM Studio." -ForegroundColor Yellow
    return $currentModel
  }

  Write-Host ""
  Write-Host "Modelos disponibles:" -ForegroundColor Cyan
  for ($i = 0; $i -lt $json.Count; $i++) {
    $model = $json[$i]
    $mark = if ($model.modelKey -eq $currentModel) { "*" } else { " " }
    Write-Host ("[{0}] {1} {2} ({3})" -f ($i + 1), $mark, $model.modelKey, $model.paramsString)
  }
  $choice = Read-Host "Elige numero de modelo o Enter para conservar '$currentModel'"
  if (!$choice) { return $currentModel }
  $index = [int]$choice - 1
  if ($index -lt 0 -or $index -ge $json.Count) {
    Write-Host "Opcion invalida; conservo $currentModel." -ForegroundColor Yellow
    return $currentModel
  }
  return $json[$index].modelKey
}

function Get-LoadedLmModels {
  try {
    return @(lms ps --json | ConvertFrom-Json)
  } catch {
    return @()
  }
}

function Get-LoadedIdentifierForModel($modelKey) {
  $loaded = Get-LoadedLmModels
  foreach ($model in $loaded) {
    if ($model.identifier -eq $modelKey) { return $model.identifier }
  }
  foreach ($model in $loaded) {
    if ($model.modelKey -eq $modelKey) { return $model.identifier }
  }
  return $null
}

function Invoke-NativeCommandCapture($executable, [string[]]$arguments) {
  $psi = [System.Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = $executable
  $psi.Arguments = ($arguments | ForEach-Object { ConvertTo-NativeArgument $_ }) -join " "
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.CreateNoWindow = $true

  $process = [System.Diagnostics.Process]::new()
  $process.StartInfo = $psi
  [void]$process.Start()
  $stdout = $process.StandardOutput.ReadToEnd()
  $stderr = $process.StandardError.ReadToEnd()
  $process.WaitForExit()
  return [PSCustomObject]@{
    ExitCode = $process.ExitCode
    StdOut = $stdout
    StdErr = $stderr
    CombinedOutput = (($stdout, $stderr) -join "`n").Trim()
  }
}

function ConvertTo-NativeArgument($argument) {
  $text = [string]$argument
  if ($text -notmatch '[\s"]') { return $text }
  return '"' + ($text.Replace('"', '\"')) + '"'
}

function Test-TcpPort($port) {
  try {
    $client = [System.Net.Sockets.TcpClient]::new()
    $task = $client.ConnectAsync("127.0.0.1", [int]$port)
    $ready = $task.Wait(350)
    $connected = $ready -and $client.Connected
    $client.Close()
    return $connected
  } catch {
    return $false
  }
}

function Test-BackendReady {
  try {
    $client = [System.Net.Http.HttpClient]::new()
    $client.Timeout = [TimeSpan]::FromSeconds(2)
    $text = $client.GetStringAsync("http://127.0.0.1:8787/api/status").GetAwaiter().GetResult()
    $client.Dispose()
    return $text -match '"ok"\s*:\s*true'
  } catch {
    return $false
  }
}

function Test-FrontendReady {
  try {
    $request = [System.Net.WebRequest]::Create("http://127.0.0.1:5173/")
    $request.Timeout = 2000
    $response = $request.GetResponse()
    $statusCode = [int]$response.StatusCode
    $response.Close()
    return $statusCode -eq 200
  } catch {
    return $false
  }
}

function Open-Luma {
  Start-Process "http://127.0.0.1:5173/"
}

function Wait-PortsFree($ports, $timeoutSeconds = 20) {
  $deadline = (Get-Date).AddSeconds($timeoutSeconds)
  do {
    $busy = @($ports | Where-Object { Test-TcpPort $_ })
    if ($busy.Count -eq 0) { return $true }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)
  return $false
}

function Stop-LumaClean {
  Write-Host "Deteniendo Luma activa..." -ForegroundColor Cyan
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root "Stop-Luma.ps1") -Quiet
  if (!(Wait-PortsFree @(5173, 8787) 25)) {
    Write-Host "No pude liberar 5173/8787 a tiempo. Ejecuta Stop-Luma.bat y revisa procesos abiertos." -ForegroundColor Red
    exit 1
  }
}

function Test-LmStudioOpenAiChat($modelId) {
  try {
    $body = @{
      model = $modelId
      messages = @(@{ role = "user"; content = "Responde solo: OK" })
      temperature = 0.1
      max_tokens = 8
      stream = $false
    } | ConvertTo-Json -Depth 5
    $response = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:1234/v1/chat/completions" -ContentType "application/json" -Body $body -TimeoutSec 8
    $text = [string]$response.choices[0].message.content
    return [bool]$text
  } catch {
    return $false
  }
}

function Start-LmStudioModel($modelKey) {
  Write-Host "Iniciando LM Studio server..." -ForegroundColor Cyan
  & lms server start | Out-Host

  $loadedIdentifier = Get-LoadedIdentifierForModel $modelKey
  if ($loadedIdentifier) {
    Write-Host "Modelo ya cargado como '$loadedIdentifier'. No lo cargo otra vez." -ForegroundColor Green
    return $loadedIdentifier
  }

  Write-Host "Cargando modelo $modelKey..." -ForegroundColor Cyan
  Write-Host "Esto puede tardar un poco. Si no hay memoria suficiente, continuare con fallback." -ForegroundColor DarkGray
  $loadArgs = @("load", $modelKey, "--identifier", $modelKey, "--parallel", "1", "--yes")
  if ($envMap["LM_STUDIO_GPU_OFFLOAD"]) {
    $loadArgs += @("--gpu", $envMap["LM_STUDIO_GPU_OFFLOAD"])
  }
  if ($envMap["LM_STUDIO_CONTEXT_LENGTH"]) {
    $loadArgs += @("--context-length", $envMap["LM_STUDIO_CONTEXT_LENGTH"])
  }
  if ($envMap["LM_STUDIO_TTL"]) {
    $loadArgs += @("--ttl", $envMap["LM_STUDIO_TTL"])
  }
  Write-Host ("lms " + ($loadArgs -join " ")) -ForegroundColor DarkGray
  $loadResult = Invoke-NativeCommandCapture "lms" $loadArgs
  $loadOutput = $loadResult.CombinedOutput
  $loadedIdentifier = Get-LoadedIdentifierForModel $modelKey
  if ($loadResult.ExitCode -eq 0 -or (($loadOutput -match "Model loaded successfully") -and $loadedIdentifier)) {
    if ($loadOutput) {
      Write-Host (($loadOutput.Trim()) -replace "`r?`n", " ") -ForegroundColor DarkGray
    }
    Write-Host "Modelo cargado correctamente." -ForegroundColor Green
    if ($loadedIdentifier) { return $loadedIdentifier }
    return $modelKey
  }

  Write-Host ""
  Write-Host "No se pudo cargar '$modelKey'." -ForegroundColor Yellow
  if ($loadOutput -match "insufficient system resources") {
    Write-Host "LM Studio reporto recursos insuficientes para este modelo." -ForegroundColor Yellow
  } elseif ($loadOutput) {
    Write-Host (($loadOutput.Trim()) -replace "`r?`n", " ") -ForegroundColor Yellow
  } else {
    Write-Host "lms load termino con codigo $($loadResult.ExitCode), sin salida adicional." -ForegroundColor Yellow
  }
  Write-Host "La app abrira de todos modos, pero respondera con fallback hasta que cargues un modelo." -ForegroundColor Yellow
  Write-Host "Opciones utiles: cerrar apps pesadas, descargar un modelo mas pequeno, o bajar guardrails en LM Studio si sabes lo que haces." -ForegroundColor Yellow
  return $null
}

$envMap = Read-EnvFile
if (!$envMap.ContainsKey("LLM_PROVIDER")) { $envMap["LLM_PROVIDER"] = "lmstudio" }
if (!$envMap.ContainsKey("LM_STUDIO_BASE_URL")) { $envMap["LM_STUDIO_BASE_URL"] = "http://127.0.0.1:1234/v1" }
if (!$envMap.ContainsKey("LM_STUDIO_API_MODE")) { $envMap["LM_STUDIO_API_MODE"] = "auto" }
if (!$envMap.ContainsKey("LM_STUDIO_MODEL")) { $envMap["LM_STUDIO_MODEL"] = "gemma-4-26b-a4b-it" }
if (!$envMap.ContainsKey("LLM_MAX_TOKENS")) { $envMap["LLM_MAX_TOKENS"] = "512" }
if (!$envMap.ContainsKey("LLM_STORE_REASONING")) { $envMap["LLM_STORE_REASONING"] = "true" }
if (!$envMap.ContainsKey("LLM_REASONING_MAX_CHARS")) { $envMap["LLM_REASONING_MAX_CHARS"] = "8000" }
if (!$envMap.ContainsKey("LLM_REASONING_REPAIR_ENABLED")) { $envMap["LLM_REASONING_REPAIR_ENABLED"] = "true" }
if (!$envMap.ContainsKey("LLM_REASONING_REPAIR_MAX_TOKENS")) { $envMap["LLM_REASONING_REPAIR_MAX_TOKENS"] = "512" }
if (!$envMap.ContainsKey("LLM_REASONING_REPAIR_TEMPERATURE")) { $envMap["LLM_REASONING_REPAIR_TEMPERATURE"] = "0.1" }
if (!$envMap.ContainsKey("LM_STUDIO_REASONING_EFFORT")) { $envMap["LM_STUDIO_REASONING_EFFORT"] = "low" }
if (!$envMap.ContainsKey("PYTHON_BIN")) { $envMap["PYTHON_BIN"] = "python" }

Write-Host ""
Write-Host "Encender Luma" -ForegroundColor Cyan
$frontendReady = Test-FrontendReady
$backendReady = Test-BackendReady
$frontendPortBusy = Test-TcpPort 5173
$backendPortBusy = Test-TcpPort 8787
$lmStudioReady = Test-TcpPort 1234

if ($frontendPortBusy -or $backendPortBusy) {
  Write-Host ""
  Write-Host "Detecte servicios activos:" -ForegroundColor Yellow
  Write-Host "Frontend 5173: $(if ($frontendReady) { 'listo' } elseif ($frontendPortBusy) { 'ocupado' } else { 'libre' })"
  Write-Host "Backend 8787:  $(if ($backendReady) { 'listo' } elseif ($backendPortBusy) { 'ocupado' } else { 'libre' })"
  Write-Host "LM Studio 1234: $(if ($lmStudioReady) { 'activo' } else { 'apagado/no responde' })"
  Write-Host ""
  Write-Host "1. Abrir Luma existente"
  Write-Host "2. Reiniciar Luma limpia"
  Write-Host "3. Cancelar"
  $runningChoice = Read-Host "Opcion"
  if (!$runningChoice) { $runningChoice = "1" }
  if ($runningChoice -eq "1") {
    if ($frontendReady -and $backendReady) {
      Open-Luma
      exit 0
    }
    if ($frontendReady -and !$backendReady) {
      Write-Host "El frontend responde, pero el backend no esta listo. Usa Reiniciar Luma limpia." -ForegroundColor Yellow
      exit 1
    }
    if ($backendReady -and !$frontendReady) {
      Write-Host "El backend responde, pero el frontend no esta listo. Usa Reiniciar Luma limpia." -ForegroundColor Yellow
      exit 1
    }
    Write-Host "El puerto 5173 esta ocupado, pero no parece ser Luma lista. Usa Reiniciar Luma limpia." -ForegroundColor Yellow
    exit 1
  }
  if ($runningChoice -eq "2") {
    Stop-LumaClean
  } else {
    Write-Host "Cancelado."
    exit 0
  }
}

Write-Host "1. Iniciar Luma sin cargar modelo"
Write-Host "   Para UI, OBS, pruebas rapidas o fallback. No carga modelo en LM Studio."
Write-Host "2. Iniciar Luma y cargar modelo guardado: $($envMap["LM_STUDIO_MODEL"])"
Write-Host "   Usa LM Studio y carga el modelo configurado."
Write-Host "3. Elegir modelo de LM Studio y cargarlo"
Write-Host "   Lista modelos disponibles, guarda el elegido y lo carga."
Write-Host "4. Reiniciar Luma limpia"
Write-Host "   Detiene frontend/backend, descarga modelos de LM Studio, detiene LM Studio server y reinicia en puertos fijos."
Write-Host "5. Salir"
$choice = Read-Host "Opcion"
if (!$choice) { $choice = "1" }

if ($choice -eq "5") {
  Write-Host "Cancelado."
  exit 0
}

if ($choice -eq "4") {
  Stop-LumaClean
  $choice = "1"
}

if ($choice -eq "3") {
  $envMap["LM_STUDIO_MODEL"] = Select-LmModel $envMap["LM_STUDIO_MODEL"]
}
Write-EnvFile $envMap

if (!(Test-Path (Join-Path $Root "node_modules"))) {
  Write-Host "Instalando dependencias npm..." -ForegroundColor Cyan
  npm.cmd install
}

if (!(Test-Path (Join-Path $Root "dist-server/server/index.js"))) {
  Write-Host "Compilando por primera vez..." -ForegroundColor Cyan
  npm.cmd run build
}

if ($choice -eq "2" -or $choice -eq "3") {
  if ($envMap["LM_STUDIO_MODEL"] -match "26b" -and !$envMap["LM_STUDIO_GPU_OFFLOAD"]) {
    Write-Host "Aviso: gemma-4-26b puede superar 12 GB de VRAM y usar RAM/CPU. Para stream conviene un 7B/8B/12B cuantizado o configurar LM_STUDIO_GPU_OFFLOAD=max." -ForegroundColor Yellow
  }
  $loadedIdentifier = Start-LmStudioModel $envMap["LM_STUDIO_MODEL"]
  if ($loadedIdentifier) {
    $envMap["LM_STUDIO_MODEL"] = $loadedIdentifier
    $envMap["LLM_PROVIDER"] = "lmstudio"
    if (Test-LmStudioOpenAiChat $loadedIdentifier) {
      $envMap["LM_STUDIO_API_MODE"] = "openai"
      $envMap["LM_STUDIO_BASE_URL"] = "http://127.0.0.1:1234/v1"
    }
    Write-EnvFile $envMap
    Write-Host "Modelo configurado para Luma: $loadedIdentifier" -ForegroundColor Green
  }
}

if ((Test-TcpPort 5173) -or (Test-TcpPort 8787)) {
  Write-Host "No inicio otra instancia porque 5173 o 8787 siguen ocupados. Ejecuta Stop-Luma.bat o elige Reiniciar Luma limpia." -ForegroundColor Red
  exit 1
}

Write-Host "Iniciando app local..." -ForegroundColor Cyan
$env:LUMA_PROMPT_BROWSER = "1"
npm.cmd run dev
