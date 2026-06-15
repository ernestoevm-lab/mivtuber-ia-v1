$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$shortcutDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
$shortcutPath = Join-Path $shortcutDir "MiVTuberAI.lnk"
$appFolder = Join-Path $shortcutDir "MiVTuberAI"
$folderShortcutPath = Join-Path $appFolder "MiVTuberAI.lnk"
$targetPath = Join-Path $root "Start-Luma.bat"
$iconPath = Join-Path $root "public\icons\mivtuberai.ico"

if (-not (Test-Path -LiteralPath $targetPath)) {
  throw "No encontre Start-Luma.bat en $root"
}

New-Item -ItemType Directory -Force -Path $shortcutDir | Out-Null
New-Item -ItemType Directory -Force -Path $appFolder | Out-Null

$shell = New-Object -ComObject WScript.Shell

foreach ($path in @($shortcutPath, $folderShortcutPath)) {
  $shortcut = $shell.CreateShortcut($path)
  $shortcut.TargetPath = $targetPath
  $shortcut.WorkingDirectory = $root
  $shortcut.IconLocation = $iconPath
  $shortcut.Description = "Inicia Luma, tu MiVTuberAI local."
  $shortcut.Save()
}

try {
  $shellApp = New-Object -ComObject Shell.Application
  $shellApp.NameSpace($shortcutDir).Self.InvokeVerb("refresh")
} catch {
  Write-Host "No pude refrescar el cache visual de Windows, pero el acceso directo fue creado." -ForegroundColor Yellow
}

Write-Host "Acceso directo instalado:"
Write-Host $shortcutPath
Write-Host $folderShortcutPath
Write-Host ""
Write-Host "Ahora puedes buscar MiVTuberAI desde Inicio o la barra de tareas. Windows Search puede tardar unos segundos en indexarlo."
