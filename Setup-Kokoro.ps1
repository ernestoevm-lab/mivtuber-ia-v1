$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$OutputEncoding = [System.Text.UTF8Encoding]::new()

$VenvDir = Join-Path $Root ".local\kokoro-venv"
$VenvPython = Join-Path $VenvDir "Scripts\python.exe"
$HfHome = Join-Path $Root ".local\huggingface"

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
    "LM_STUDIO_MODEL",
    "OLLAMA_HOST",
    "OLLAMA_MODEL",
    "OLLAMA_FALLBACK_MODEL",
    "PYTHON_BIN",
    "KOKORO_PYTHON",
    "KOKORO_VOICE",
    "KOKORO_LANG",
    "KOKORO_SPEED",
    "KOKORO_HF_HOME",
    "PORT"
  )
  $lines = New-Object System.Collections.Generic.List[string]
  foreach ($key in $order) {
    if ($envMap.ContainsKey($key)) {
      $lines.Add("$key=$($envMap[$key])")
    }
  }
  foreach ($key in $envMap.Keys) {
    if ($order -notcontains $key -and !$key.StartsWith("PIPER_")) {
      $lines.Add("$key=$($envMap[$key])")
    }
  }
  Set-Content -Path (Join-Path $Root ".env") -Value $lines -Encoding UTF8
}

Write-Host ""
Write-Host "Instalando Kokoro local para Luma" -ForegroundColor Cyan

if (!(Test-Path $VenvPython)) {
  Write-Host "Creando entorno local en .local\kokoro-venv..." -ForegroundColor Cyan
  python -m venv $VenvDir
}

Write-Host "Instalando Kokoro y dependencias dentro del entorno local..." -ForegroundColor Cyan
& $VenvPython -m pip install --upgrade pip
& $VenvPython -m pip install "kokoro>=0.9.2" soundfile

New-Item -ItemType Directory -Force -Path $HfHome | Out-Null

$envMap = Read-EnvFile
if (!$envMap.ContainsKey("LLM_PROVIDER")) { $envMap["LLM_PROVIDER"] = "lmstudio" }
if (!$envMap.ContainsKey("LM_STUDIO_BASE_URL")) { $envMap["LM_STUDIO_BASE_URL"] = "http://127.0.0.1:1234/v1" }
if (!$envMap.ContainsKey("LM_STUDIO_MODEL")) { $envMap["LM_STUDIO_MODEL"] = "gemma-4-26b-a4b-it" }
if (!$envMap.ContainsKey("PYTHON_BIN")) { $envMap["PYTHON_BIN"] = "python" }
$envMap["KOKORO_PYTHON"] = $VenvPython
$envMap["KOKORO_VOICE"] = "jf_alpha"
$envMap["KOKORO_LANG"] = "e"
$envMap["KOKORO_SPEED"] = "0.95"
$envMap["KOKORO_HF_HOME"] = $HfHome
if (!$envMap.ContainsKey("PORT")) { $envMap["PORT"] = "8787" }
Write-EnvFile $envMap

Write-Host ""
Write-Host "Kokoro quedo configurado para Luma." -ForegroundColor Green
Write-Host "Voz inicial: jf_alpha (JP kawaii leyendo espanol)"
Write-Host "La primera prueba puede descargar pesos de Kokoro en .local\huggingface."
Write-Host "Reinicia Luma con Stop-Luma.bat y Start-Luma.bat para usar Kokoro."
