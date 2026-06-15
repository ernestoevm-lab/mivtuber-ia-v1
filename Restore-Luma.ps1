param(
  [switch]$ListOnly
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackupDir = Join-Path $Root "backups"
$TempRoot = Join-Path ([System.IO.Path]::GetTempPath()) "luma-restore-tool"

$ExcludedDirs = @(
  "node_modules",
  "dist",
  "dist-server",
  ".git",
  ".local",
  "backups"
)

$ExcludedExtensions = @(
  ".vrm", ".glb", ".fbx", ".blend", ".psd",
  ".onnx", ".safetensors", ".gguf", ".bin", ".pt", ".pth", ".ckpt",
  ".wav", ".mp3", ".ogg", ".flac",
  ".mp4", ".mov", ".webm",
  ".zip", ".7z", ".rar", ".tar", ".gz"
)

function Write-Section([string]$Text) {
  Write-Host ""
  Write-Host $Text -ForegroundColor Cyan
}

function Format-Mb([long]$Bytes) {
  return "{0:N2} MB" -f ($Bytes / 1MB)
}

function Get-RelativePathForFile([string]$RootPath, [string]$Path) {
  $rootFull = [System.IO.Path]::GetFullPath($RootPath)
  if (-not $rootFull.EndsWith([System.IO.Path]::DirectorySeparatorChar)) {
    $rootFull += [System.IO.Path]::DirectorySeparatorChar
  }
  $pathFull = [System.IO.Path]::GetFullPath($Path)
  $rootUri = [System.Uri]::new($rootFull)
  $pathUri = [System.Uri]::new($pathFull)
  return [System.Uri]::UnescapeDataString($rootUri.MakeRelativeUri($pathUri).ToString()).Replace("/", "\")
}

function Get-ZipEntries([string]$ZipPath) {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
  try {
    return @($zip.Entries)
  } finally {
    $zip.Dispose()
  }
}

function Get-RestoreBackups {
  if (-not (Test-Path -LiteralPath $BackupDir)) { return @() }
  return @(Get-ChildItem -LiteralPath $BackupDir -File -Filter "luma-restore-*.zip" |
    Where-Object { $_.Name -notlike "luma-handoff-*" } |
    Sort-Object LastWriteTime -Descending)
}

function Test-LumaZip([string]$ExtractRoot) {
  $candidate = Get-ProjectRootFromExtract $ExtractRoot
  if (-not $candidate) { return $null }

  foreach ($required in @("package.json", "src", "server", "Start-Luma.ps1", "Stop-Luma.ps1")) {
    if (-not (Test-Path -LiteralPath (Join-Path $candidate $required))) {
      return $null
    }
  }
  return $candidate
}

function Get-ProjectRootFromExtract([string]$ExtractRoot) {
  if (Test-Path -LiteralPath (Join-Path $ExtractRoot "package.json")) {
    return $ExtractRoot
  }

  $dirs = @(Get-ChildItem -LiteralPath $ExtractRoot -Directory -Force)
  foreach ($dir in $dirs) {
    if (Test-Path -LiteralPath (Join-Path $dir.FullName "package.json")) {
      return $dir.FullName
    }
  }
  return $null
}

function Test-RestoreExcluded([string]$RelativePath, [bool]$RestoreSqlite) {
  $parts = $RelativePath -split "[\\/]"
  foreach ($dir in $ExcludedDirs) {
    if ($parts -contains $dir) { return $true }
  }

  if ($RelativePath -match '(^|\\)\.env$') { return $true }
  if ($RelativePath -match '(^|\\)\.env\.local$') { return $true }
  if ($RelativePath -match '(^|\\)\.env\..*\.local$') { return $true }

  if ($RelativePath -like "data\backgrounds\*") { return $true }

  $extension = [System.IO.Path]::GetExtension($RelativePath).ToLowerInvariant()
  if ($ExcludedExtensions -contains $extension) { return $true }

  if (@(".sqlite", ".sqlite3", ".db") -contains $extension -and -not $RestoreSqlite) {
    return $true
  }

  return $false
}

function New-BeforeRestoreBackup {
  $backupScript = Join-Path $Root "Backup-Luma.ps1"
  if (-not (Test-Path -LiteralPath $backupScript)) {
    throw "No existe Backup-Luma.ps1; no puedo crear backup de seguridad."
  }

  $before = @(Get-RestoreBackups | Select-Object -ExpandProperty FullName)
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $backupScript -Mode restore -NameSuffix "-before-restore"
  if ($LASTEXITCODE -ne 0) {
    throw "No se pudo crear el backup automatico previo a restaurar."
  }

  $after = @(Get-RestoreBackups | Where-Object { $_.Name -like "*-before-restore.zip" -and $before -notcontains $_.FullName } | Sort-Object LastWriteTime -Descending)
  if ($after.Count -gt 0) { return $after[0].FullName }

  $fallback = @(Get-RestoreBackups | Where-Object { $_.Name -like "*-before-restore.zip" } | Sort-Object LastWriteTime -Descending)
  if ($fallback.Count -gt 0) { return $fallback[0].FullName }

  throw "Se ejecuto Backup-Luma, pero no pude encontrar el backup before-restore."
}

function Stop-LumaSafely {
  $stopScript = Join-Path $Root "Stop-Luma.ps1"
  if (-not (Test-Path -LiteralPath $stopScript)) {
    Write-Warning "Stop-Luma.ps1 no existe. Continuo sin apagado automatico."
    return
  }
  Write-Host "Apagando Luma y descargando modelos de LM Studio..."
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $stopScript -Quiet
}

function Copy-RestoreFiles([string]$ProjectRoot, [bool]$RestoreSqlite) {
  $copied = 0
  foreach ($file in (Get-ChildItem -LiteralPath $ProjectRoot -Recurse -File -Force)) {
    $relative = Get-RelativePathForFile $ProjectRoot $file.FullName
    if (Test-RestoreExcluded $relative $RestoreSqlite) { continue }

    $destination = Join-Path $Root $relative
    $destinationDir = Split-Path -Parent $destination
    New-Item -ItemType Directory -Force -Path $destinationDir | Out-Null
    Copy-Item -LiteralPath $file.FullName -Destination $destination -Force
    $copied++
  }
  return $copied
}

function Invoke-ValidationAfterRestore {
  $installResult = "omitido"
  $checkResult = "no ejecutado"
  $buildResult = "no ejecutado"

  if (Test-Path -LiteralPath (Join-Path $Root "package-lock.json")) {
    Write-Section "Ejecutando npm.cmd install"
    & npm.cmd install
    $installResult = if ($LASTEXITCODE -eq 0) { "ok" } else { "fallo ($LASTEXITCODE)" }
  }

  Write-Section "Ejecutando npm.cmd run check"
  & npm.cmd run check
  $checkResult = if ($LASTEXITCODE -eq 0) { "ok" } else { "fallo ($LASTEXITCODE)" }

  Write-Section "Ejecutando npm.cmd run build"
  & npm.cmd run build
  $buildResult = if ($LASTEXITCODE -eq 0) { "ok" } else { "fallo ($LASTEXITCODE)" }

  return [pscustomobject]@{
    Install = $installResult
    Check = $checkResult
    Build = $buildResult
  }
}

function Show-RestoreMenu {
  $backups = Get-RestoreBackups
  Write-Section "Restore Luma"

  if ($backups.Count -eq 0) {
    Write-Host "No hay backups restaurables en backups/."
    return
  }

  for ($i = 0; $i -lt $backups.Count; $i++) {
    $item = $backups[$i]
    $entryCount = "?"
    try { $entryCount = [string]((Get-ZipEntries $item.FullName).Count) } catch {}
    "{0}. {1} | {2} | {3} | {4} archivos" -f ($i + 1), $item.LastWriteTime.ToString("yyyy-MM-dd HH:mm:ss"), $item.Name, (Format-Mb $item.Length), $entryCount | Write-Host
  }
  Write-Host "0. Cancelar"

  if ($ListOnly) { return }

  $choice = Read-Host "Elige un backup restaurable"
  if ($choice -eq "0" -or [string]::IsNullOrWhiteSpace($choice)) {
    Write-Host "Restauracion cancelada."
    return
  }
  $index = 0
  if (-not [int]::TryParse($choice, [ref]$index) -or $index -lt 1 -or $index -gt $backups.Count) {
    Write-Host "Opcion no valida. No se modifico nada." -ForegroundColor Yellow
    return
  }

  $selected = $backups[$index - 1]
  Write-Section "Advertencia"
  Write-Host "Esto reemplazara archivos del proyecto actual con el contenido del backup seleccionado." -ForegroundColor Yellow
  Write-Host "Backup seleccionado: $($selected.Name)"
  Write-Host "No se restauraran handoffs, .env, node_modules, builds, .git, .local, backups, modelos, audios, videos ni VRM/3D pesados."

  $extractDir = Join-Path $TempRoot ("restore-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
  if (Test-Path -LiteralPath $extractDir) {
    Remove-Item -LiteralPath $extractDir -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path $extractDir | Out-Null

  Write-Host "Validando ZIP..."
  Expand-Archive -LiteralPath $selected.FullName -DestinationPath $extractDir -Force
  $projectRoot = Test-LumaZip $extractDir
  if (-not $projectRoot) {
    Remove-Item -LiteralPath $extractDir -Recurse -Force
    Write-Host "Cancelado: el ZIP no parece un proyecto Luma valido." -ForegroundColor Red
    return
  }

  $hasSqlite = @(Get-ChildItem -LiteralPath $projectRoot -Recurse -File -Force |
    Where-Object { @(".sqlite", ".sqlite3", ".db") -contains $_.Extension.ToLowerInvariant() }).Count -gt 0

  $restoreSqlite = $false
  if ($hasSqlite) {
    $sqliteChoice = Read-Host "El backup trae SQLite. Restaurar base de datos SQLite tambien? [s/N]"
    $restoreSqlite = $sqliteChoice -match "^(s|si|sí|y|yes)$"
  }

  $confirm = Read-Host "Escribe RESTAURAR para continuar"
  if ($confirm -ne "RESTAURAR") {
    Remove-Item -LiteralPath $extractDir -Recurse -Force
    Write-Host "Restauracion cancelada. No se modifico nada." -ForegroundColor Yellow
    return
  }

  Stop-LumaSafely
  $safetyBackup = New-BeforeRestoreBackup

  Write-Section "Copiando archivos restaurados"
  $copied = Copy-RestoreFiles $projectRoot $restoreSqlite
  Remove-Item -LiteralPath $extractDir -Recurse -Force

  $validation = Invoke-ValidationAfterRestore

  Write-Section "Resultado"
  Write-Host "Backup restaurado: $($selected.FullName)"
  Write-Host "Backup de seguridad previo: $safetyBackup"
  Write-Host "SQLite restaurado: $restoreSqlite"
  Write-Host "Archivos copiados: $copied"
  Write-Host "npm install: $($validation.Install)"
  Write-Host "check: $($validation.Check)"
  Write-Host "build: $($validation.Build)"
  Write-Host "Para iniciar Luma: Start-Luma.bat" -ForegroundColor Green
}

Show-RestoreMenu
