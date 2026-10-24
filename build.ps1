# Startet den Build der Auslieferungspakete (siehe docs/BUILD.md).
#
#   .\build.ps1                  beide Pakete   -> dist\docker und dist\windows-portable
#   .\build.ps1 -Target Docker   nur Docker
#   .\build.ps1 -Target Portable nur Windows portable (inkl. ZIP)
#   .\build.ps1 -Zip             beide Pakete und zusätzlich die ZIP-Datei der portablen Variante
#   .\build.ps1 -Ffmpeg <Pfad>   ffmpeg.exe für die portable Variante (Standard: tools\bin\ffmpeg.exe)
#   .\build.ps1 -WithData        zusätzlich die schon importierten Spieldaten (public\gamedata) einpacken - nur für eigene Tests!
#   .\build.ps1 -Install         vorher "npm install" ausführen
#
# Die Pakete enthalten KEINE Spieldaten. Beim ersten Start übergibt man nur die beiden Original-ISO-Images; die Einrichtung
# (Datenübernahme und Umwandlung der Videos) läuft dann automatisch (siehe README.txt in den Paketen).
#
# Falls PowerShell das Skript blockiert:  powershell -ExecutionPolicy Bypass -File .\build.ps1
[CmdletBinding()]
param(
  [ValidateSet('All', 'Docker', 'Portable')][string]$Target = 'All',
  [switch]$Zip,
  [switch]$WithData,
  [string]$Ffmpeg = '',
  [switch]$Install
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { throw 'Node.js wurde nicht gefunden (Version 24 oder neuer, https://nodejs.org). Es wird nur zum Bauen benötigt, nicht zum Ausführen der fertigen Pakete.' }
if ([int]((& node --version).TrimStart('v').Split('.')[0]) -lt 22) { throw "Node $(& node --version) ist zu alt, benötigt wird Version 22 oder neuer (empfohlen 24)." }

if ($Install -or -not (Test-Path -LiteralPath 'node_modules')) {
  Write-Host '== npm install'
  & npm install
  if ($LASTEXITCODE -ne 0) { throw 'npm install ist fehlgeschlagen.' }
}

$buildArgs = @('tools/build-dist.ts', '--target', $Target.ToLower())
if ($Zip -or $Target -eq 'Portable') { $buildArgs += '--zip' }
if ($WithData) { $buildArgs += '--with-data' }
if ($Ffmpeg) { $buildArgs += @('--ffmpeg', $Ffmpeg) }

Write-Host "== node $($buildArgs -join ' ')"
& node @buildArgs
if ($LASTEXITCODE -ne 0) { throw "Der Build ist fehlgeschlagen (Exit-Code $LASTEXITCODE)." }

Write-Host ''
Write-Host 'Ergebnis:'
Get-ChildItem -LiteralPath 'dist' | ForEach-Object {
  $size = if ($_.PSIsContainer) { (Get-ChildItem -LiteralPath $_.FullName -Recurse -File | Measure-Object Length -Sum).Sum } else { $_.Length }
  '  {0,-34} {1,8:N1} MB' -f $_.Name, ($size / 1MB)
}
Write-Host ''
if ($Target -ne 'Portable') { Write-Host '  Docker:    cd dist\docker ; docker compose up -d --build   (http://localhost:8080)' }
if ($Target -ne 'Docker') { Write-Host '  Portable:  dist\windows-portable\BattleIsle3.bat doppelklicken' }
