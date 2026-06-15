param(
  [ValidateSet("menu", "restore", "handoff", "both", "list")]
  [string]$Mode = "menu",
  [string]$NameSuffix = ""
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackupDir = Join-Path $Root "backups"
$DocsDir = Join-Path $Root "docs"
$TempRoot = Join-Path ([System.IO.Path]::GetTempPath()) "luma-backup-tool"
$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"

$SecretPatterns = @(
  "api_key",
  "apikey",
  "token",
  "secret",
  "password",
  "bearer",
  "oauth",
  "client_secret",
  "access_token",
  "refresh_token",
  "OPENAI_API_KEY",
  "TWITCH_CLIENT_SECRET",
  "YOUTUBE_API_KEY",
  "KICK_CLIENT_SECRET"
)

$ExcludedExtensions = @(
  ".log", ".zip", ".7z", ".rar", ".tar", ".gz",
  ".wav", ".mp3", ".ogg", ".flac",
  ".mp4", ".mov", ".webm",
  ".vrm", ".glb", ".fbx", ".blend", ".psd",
  ".onnx", ".safetensors", ".gguf", ".bin", ".pt", ".pth", ".ckpt"
  , ".pyc"
)

$AlwaysExcludedDirs = @(
  "node_modules",
  "dist",
  "dist-server",
  ".git",
  ".local",
  "backups",
  "logs",
  "tmp",
  "temp",
  ".cache",
  ".vite"
  , "__pycache__"
)

function Write-Section([string]$Text) {
  Write-Host ""
  Write-Host $Text -ForegroundColor Cyan
}

function Get-RelativePathForFile([string]$Path) {
  $rootFull = [System.IO.Path]::GetFullPath($Root)
  if (-not $rootFull.EndsWith([System.IO.Path]::DirectorySeparatorChar)) {
    $rootFull += [System.IO.Path]::DirectorySeparatorChar
  }
  $pathFull = [System.IO.Path]::GetFullPath($Path)
  $rootUri = [System.Uri]::new($rootFull)
  $pathUri = [System.Uri]::new($pathFull)
  return [System.Uri]::UnescapeDataString($rootUri.MakeRelativeUri($pathUri).ToString()).Replace("/", "\")
}

function Test-PathExcluded([string]$RelativePath, [string]$Kind) {
  $parts = $RelativePath -split "[\\/]"
  foreach ($dir in $AlwaysExcludedDirs) {
    if ($parts -contains $dir) { return $true }
  }

  if ($RelativePath -match '(^|\\)\.env$') { return $true }
  if ($RelativePath -match '(^|\\)\.env\.local$') { return $true }
  if ($RelativePath -match '(^|\\)\.env\..*\.local$') { return $true }

  if ($Kind -eq "handoff" -and $parts[0] -eq "data") { return $true }
  if ($Kind -eq "restore" -and $RelativePath -like "data\backgrounds\*") { return $true }

  $extension = [System.IO.Path]::GetExtension($RelativePath).ToLowerInvariant()
  if ($ExcludedExtensions -contains $extension) { return $true }

  if ($Kind -eq "handoff" -and @(".sqlite", ".sqlite3", ".db") -contains $extension) { return $true }

  return $false
}

function Add-TreeFiles([System.Collections.Generic.List[string]]$Files, [string]$RelativeDir, [string]$Kind) {
  $dir = Join-Path $Root $RelativeDir
  if (-not (Test-Path -LiteralPath $dir)) { return }

  Get-ChildItem -LiteralPath $dir -Recurse -File -Force | ForEach-Object {
    $relative = Get-RelativePathForFile $_.FullName
    if (-not (Test-PathExcluded $relative $Kind)) {
      if (-not $Files.Contains($_.FullName)) {
        [void]$Files.Add($_.FullName)
      }
    }
  }
}

function Add-RootFile([System.Collections.Generic.List[string]]$Files, [string]$Name, [string]$Kind) {
  $path = Join-Path $Root $Name
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return }
  $relative = Get-RelativePathForFile $path
  if (Test-PathExcluded $relative $Kind) { return }
  if (-not $Files.Contains($path)) {
    [void]$Files.Add($path)
  }
}

function Add-RootGlob([System.Collections.Generic.List[string]]$Files, [string]$Pattern, [string]$Kind) {
  Get-ChildItem -LiteralPath $Root -Filter $Pattern -File -Force -ErrorAction SilentlyContinue | ForEach-Object {
    $relative = Get-RelativePathForFile $_.FullName
    if (-not (Test-PathExcluded $relative $Kind)) {
      if (-not $Files.Contains($_.FullName)) {
        [void]$Files.Add($_.FullName)
      }
    }
  }
}

function Add-PublicRootAssets([System.Collections.Generic.List[string]]$Files, [string]$Kind) {
  $publicDir = Join-Path $Root "public"
  if (-not (Test-Path -LiteralPath $publicDir)) { return }
  foreach ($pattern in @("*.svg", "*.png", "*.ico")) {
    Get-ChildItem -LiteralPath $publicDir -Filter $pattern -File -Force -ErrorAction SilentlyContinue | ForEach-Object {
      $relative = Get-RelativePathForFile $_.FullName
      if (-not (Test-PathExcluded $relative $Kind)) {
        if (-not $Files.Contains($_.FullName)) {
          [void]$Files.Add($_.FullName)
        }
      }
    }
  }
}

function Add-SqliteFiles([System.Collections.Generic.List[string]]$Files) {
  $dataDir = Join-Path $Root "data"
  if (-not (Test-Path -LiteralPath $dataDir)) { return }
  $maxBytes = 50MB
  Get-ChildItem -LiteralPath $dataDir -File -Force -ErrorAction SilentlyContinue |
    Where-Object { @(".sqlite", ".sqlite3", ".db") -contains $_.Extension.ToLowerInvariant() } |
    ForEach-Object {
      if ($_.Length -le $maxBytes) {
        if (-not $Files.Contains($_.FullName)) {
          [void]$Files.Add($_.FullName)
        }
      } else {
        Write-Warning "SQLite omitido por tamano: $($_.Name)"
      }
    }
}

function Get-CandidateFiles([string]$Kind) {
  $files = [System.Collections.Generic.List[string]]::new()

  foreach ($dir in @("src", "server", "shared", "scripts", "docs", "config")) {
    Add-TreeFiles $files $dir $Kind
  }

  if ($Kind -eq "restore") {
    Add-TreeFiles $files "public\icons" $Kind
    Add-PublicRootAssets $files $Kind
    Add-SqliteFiles $files
  }

  foreach ($name in @(
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "README.md",
    ".env.example",
    ".gitignore",
    "index.html",
    "Start-Luma.bat",
    "Start-Luma.ps1",
    "Stop-Luma.bat",
    "Stop-Luma.ps1",
    "Backup-Luma.bat",
    "Backup-Luma.ps1",
    "Setup-Kokoro.bat",
    "Setup-Kokoro.ps1",
    "Install-MiVTuberAI-Shortcut.bat",
    "Install-MiVTuberAI-Shortcut.ps1"
  )) {
    Add-RootFile $files $name $Kind
  }

  foreach ($glob in @("vite.config.*", "eslint.config.*")) {
    Add-RootGlob $files $glob $Kind
  }

  return $files
}

function Find-SecretMatches([System.Collections.Generic.List[string]]$Files) {
  $matches = @()
  $regex = [regex]::new(($SecretPatterns | ForEach-Object { [regex]::Escape($_) }) -join "|", [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)

  foreach ($file in $Files) {
    $relative = Get-RelativePathForFile $file
    $extension = [System.IO.Path]::GetExtension($file).ToLowerInvariant()
    if (@(".png", ".ico", ".sqlite", ".sqlite3", ".db") -contains $extension) { continue }

    try {
      $content = Get-Content -LiteralPath $file -Raw -ErrorAction Stop
      if ($regex.IsMatch($content)) {
        $matches += [pscustomobject]@{
          Path = $relative
          IsConfig = $relative -like "config\*"
        }
      }
    } catch {
      Write-Warning "No se pudo revisar secretos en: $relative"
    }
  }

  return $matches
}

function Copy-FilesToStage([System.Collections.Generic.List[string]]$Files, [string]$StageDir) {
  foreach ($file in $Files) {
    $relative = Get-RelativePathForFile $file
    $destination = Join-Path $StageDir $relative
    $destinationDir = Split-Path -Parent $destination
    New-Item -ItemType Directory -Force -Path $destinationDir | Out-Null
    Copy-Item -LiteralPath $file -Destination $destination -Force
  }
}

function Get-ZipEntries([string]$ZipPath) {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
  try {
    return @($zip.Entries | Sort-Object Length -Descending | ForEach-Object {
      [pscustomobject]@{
        Name = $_.FullName
        Length = $_.Length
      }
    })
  } finally {
    $zip.Dispose()
  }
}

function Show-LargestZipEntries([string]$ZipPath, [int]$Count) {
  Write-Host ""
  Write-Host "Archivos mas pesados dentro del ZIP:" -ForegroundColor Yellow
  Get-ZipEntries $ZipPath | Select-Object -First $Count | ForEach-Object {
    "{0,8:N1} KB  {1}" -f ($_.Length / 1KB), $_.Name
  } | Write-Host
}

function Format-Mb([long]$Bytes) {
  return ("{0:N2} MB" -f ($Bytes / 1MB))
}

function Write-PackageManifest([string]$Kind, [string]$ZipName, [long]$ZipSize, [int]$FileCount, [bool]$IncludesSqlite, [object[]]$SecretMatches) {
  $manifestPath = if ($Kind -eq "restore") {
    Join-Path $DocsDir "RESTORE_POINT_MANIFEST.md"
  } else {
    Join-Path $DocsDir "HANDOFF_PACKAGE_MANIFEST.md"
  }

  $title = if ($Kind -eq "restore") { "Restore point de Luma" } else { "Handoff liviano de Luma" }
  $purpose = if ($Kind -eq "restore") {
    "Paquete restaurable para volver el proyecto a este estado si algo se rompe."
  } else {
    "Paquete liviano para revision tecnica con ChatGPT; no es una instalacion restaurable completa."
  }
  $sqliteLine = if ($IncludesSqlite) { "Si, incluye SQLite pequeno de data/." } else { "No incluye SQLite." }
  $secretLine = if ($SecretMatches.Count -gt 0) {
    "Se encontraron palabras sensibles en nombres de variables o documentación, pero no se detectaron valores reales de secretos. Revisar antes de compartir públicamente."
  } else {
    "No se detectaron coincidencias por palabras sensibles en archivos incluidos."
  }
  $included = if ($Kind -eq "restore") {
    "- src/, server/, shared/, scripts/, docs/, config/, public/icons/, assets pequenos de public/, scripts Windows y archivos raiz necesarios."
  } else {
    "- src/, server/, shared/, scripts/, docs/, config/ sanitizable, scripts Windows y archivos raiz necesarios."
  }
  $excluded = if ($Kind -eq "restore") {
    "- Excluye node_modules/, dist/, dist-server/, .git/, .local/, backups/, builds, caches, .env, audios, videos, modelos, VRM/3D y fondos pesados."
  } else {
    "- Excluye data/, node_modules/, dist/, dist-server/, .git/, .local/, backups/, .env, bases SQLite, audios, videos, modelos, builds y avatar VRM."
  }

  $restoreInstructions = if ($Kind -eq "restore") {
@"

## Restauracion breve

1. Apagar Luma con Stop-Luma.bat.
2. Extraer el ZIP en una carpeta limpia.
3. Ejecutar npm.cmd install.
4. Validar con npm.cmd run check y npm.cmd run build.
5. Restaurar manualmente .env, modelos, audios, fondos pesados o public/avatar/luma.vrm si se usan.
"@
  } else {
@"

## Advertencia

Este paquete no incluye node_modules, data, .env, .local, modelos, builds ni avatar VRM pesado. No sirve para restaurar una instalacion completa.
"@
  }

  $dateText = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  $sizeText = Format-Mb $ZipSize
  $fileText = [string]$FileCount
  $archiveText = "backups/$ZipName"
  $content = @"
# $title

- Fecha/hora: $dateText
- Tipo de paquete: $Kind
- Archivo: $archiveText
- Propósito: $purpose
- Tamaño final: $sizeText
- Número aproximado de archivos: $fileText
- SQLite: $sqliteLine
- Revisión de secretos: $secretLine

## Carpetas incluidas

$included

## Exclusiones

$excluded

## Comandos de validacion recomendados

    npm.cmd run check
    npm.cmd run build
$restoreInstructions
"@

  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($manifestPath, $content, $utf8NoBom)
}

function New-LumaPackage([ValidateSet("restore", "handoff")] [string]$Kind) {
  New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
  New-Item -ItemType Directory -Force -Path $DocsDir | Out-Null
  New-Item -ItemType Directory -Force -Path $TempRoot | Out-Null

  $prefix = if ($Kind -eq "restore") { "luma-restore" } else { "luma-handoff" }
  $safeSuffix = if ($NameSuffix) { $NameSuffix -replace '[^A-Za-z0-9_-]', '-' } else { "" }
  $zipName = "$prefix-$Timestamp$safeSuffix.zip"
  $zipPath = Join-Path $BackupDir $zipName
  $stage = Join-Path $TempRoot "$prefix-$Timestamp"

  if (Test-Path -LiteralPath $stage) {
    Remove-Item -LiteralPath $stage -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path $stage | Out-Null

  Write-Section "Creando paquete $Kind..."

  $files = Get-CandidateFiles $Kind
  $secretMatches = @(Find-SecretMatches $files)

  if ($Kind -eq "handoff" -and ($secretMatches | Where-Object { $_.IsConfig }).Count -gt 0) {
    Write-Warning "Hay coincidencias por nombres sensibles en config. No se imprimen valores; revisa el manifest antes de compartir."
  }

  $includesSqlite = $false
  foreach ($file in $files) {
    $ext = [System.IO.Path]::GetExtension($file).ToLowerInvariant()
    if (@(".sqlite", ".sqlite3", ".db") -contains $ext) { $includesSqlite = $true }
  }

  Write-PackageManifest $Kind $zipName 0 $files.Count $includesSqlite $secretMatches

  $files = Get-CandidateFiles $Kind
  $secretMatches = @(Find-SecretMatches $files)

  Copy-FilesToStage $files $stage

  if (Test-Path -LiteralPath $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
  }
  Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $zipPath -CompressionLevel Optimal -Force

  $zipInfo = Get-Item -LiteralPath $zipPath
  $fileCount = (Get-ZipEntries $zipPath).Count
  Write-PackageManifest $Kind $zipName $zipInfo.Length $fileCount $includesSqlite $secretMatches

  Remove-Item -LiteralPath $stage -Recurse -Force
  New-Item -ItemType Directory -Force -Path $stage | Out-Null
  $files = Get-CandidateFiles $Kind
  Copy-FilesToStage $files $stage
  Remove-Item -LiteralPath $zipPath -Force
  Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $zipPath -CompressionLevel Optimal -Force
  Remove-Item -LiteralPath $stage -Recurse -Force

  $zipInfo = Get-Item -LiteralPath $zipPath
  $fileCount = (Get-ZipEntries $zipPath).Count

  if ($Kind -eq "handoff" -and $zipInfo.Length -gt 50MB) {
    Show-LargestZipEntries $zipPath 30
    throw "El handoff pesa mas de 50 MB. Revisa exclusiones antes de entregarlo."
  }

  if ($Kind -eq "restore" -and $zipInfo.Length -gt 200MB) {
    Show-LargestZipEntries $zipPath 30
    $answer = Read-Host "El restore pesa mas de 200 MB. Escribe SI para conservarlo"
    if ($answer -ne "SI") {
      Remove-Item -LiteralPath $zipPath -Force
      throw "Restore cancelado por control de tamano."
    }
  }

  Write-Host "Paquete creado: $zipPath" -ForegroundColor Green
  Write-Host "Tamano: $(Format-Mb $zipInfo.Length)"
  Write-Host "Archivos: $fileCount"
  if ($secretMatches.Count -gt 0) {
    Write-Warning "Se detectaron $($secretMatches.Count) archivo(s) con coincidencias por nombres sensibles. No se imprimieron valores."
  } else {
    Write-Host "Revision de secretos: sin coincidencias." -ForegroundColor Green
  }
  Show-LargestZipEntries $zipPath 20

  return [pscustomobject]@{
    Kind = $Kind
    Path = $zipPath
    Size = $zipInfo.Length
    FileCount = $fileCount
  }
}

function Show-Backups {
  New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
  Write-Section "Backups existentes"
  $items = @(Get-ChildItem -LiteralPath $BackupDir -File -Filter "*.zip" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)
  if ($items.Count -eq 0) {
    Write-Host "No hay backups todavia."
    return
  }
  $items | ForEach-Object {
    "{0}  {1,9}  {2}" -f $_.LastWriteTime.ToString("yyyy-MM-dd HH:mm:ss"), (Format-Mb $_.Length), $_.Name
  } | Write-Host
}

function Show-Menu {
  while ($true) {
    Write-Section "Luma Backup Tool"
    Write-Host "1. Crear backup restaurable"
    Write-Host "2. Crear handoff liviano para ChatGPT"
    Write-Host "3. Crear ambos"
    Write-Host "4. Listar backups existentes"
    Write-Host "5. Restaurar un backup"
    Write-Host "6. Salir"
    $choice = Read-Host "Elige una opcion"

    switch ($choice) {
      "1" { New-LumaPackage "restore" | Out-Null }
      "2" { New-LumaPackage "handoff" | Out-Null }
      "3" {
        New-LumaPackage "restore" | Out-Null
        New-LumaPackage "handoff" | Out-Null
      }
      "4" { Show-Backups }
      "5" {
        $restoreScript = Join-Path $Root "Restore-Luma.ps1"
        if (Test-Path -LiteralPath $restoreScript) {
          & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $restoreScript
        } else {
          Write-Host "Restore-Luma.ps1 no existe todavia." -ForegroundColor Yellow
        }
      }
      "6" { return }
      default { Write-Host "Opcion no valida." -ForegroundColor Yellow }
    }
  }
}

switch ($Mode) {
  "restore" { New-LumaPackage "restore" | Out-Null }
  "handoff" { New-LumaPackage "handoff" | Out-Null }
  "both" {
    New-LumaPackage "restore" | Out-Null
    New-LumaPackage "handoff" | Out-Null
  }
  "list" { Show-Backups }
  default { Show-Menu }
}
