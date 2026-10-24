# Erstellt ein Release auf GitHub (https://github.com/BennoKrause/BattleIsle3Web).
#
#   .\release.ps1 -Version 0.3.0                         Release mit automatisch erzeugten Notizen (Commits seit dem letzten Tag)
#   .\release.ps1 -Version 0.3.0 -Notes notizen.md       Release-Notizen aus einer Datei
#   .\release.ps1 -Version 0.3.0 -Final                  als normales Release statt als Vorabversion
#   .\release.ps1 -Version 0.3.0 -SkipTests              ohne Unit- und Browser-Tests
#   .\release.ps1 -Version 0.3.0 -DryRun                 alles bauen und prüfen, aber nichts committen, pushen oder hochladen
#
# Ablauf: sauberer Arbeitsstand auf master → Tests → Version in package.json → Pakete bauen (build-dist, ohne Spieldaten)
# → ZIPs auf Spieldaten prüfen → Commit, Tag, Push von master, develop nachziehen → GitHub-Release anlegen → ZIPs hochladen.
#
# Zugang zu GitHub: die GitHub-CLI (gh), falls installiert, sonst die Zugangsdaten, mit denen git pusht
# (git credential). Das Token wird nicht ausgegeben.
#
# Falls PowerShell das Skript blockiert:  powershell -ExecutionPolicy Bypass -File .\release.ps1 -Version 0.3.0
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidatePattern('^\d+\.\d+\.\d+$')][string]$Version,
  [string]$Notes = '',
  [switch]$Final,
  [switch]$SkipTests,
  [switch]$DryRun,
  [string]$Repo = 'BennoKrause/BattleIsle3Web'
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$tag = "v$Version"

function Step($text) { Write-Host ''; Write-Host "== $text" -ForegroundColor Cyan }
# Windows PowerShell 5.1 turns stderr output of programs into errors while ErrorActionPreference is Stop
function Quiet([scriptblock]$block) {
  $old = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { & $block } finally { $ErrorActionPreference = $old }
}
function Run($exe, [string[]]$argList) {
  & $exe @argList
  if ($LASTEXITCODE -ne 0) { throw "$exe $($argList -join ' ') ist fehlgeschlagen (Exit-Code $LASTEXITCODE)." }
}

# ------------------------------------------------------------------ Vorprüfungen
Step 'Vorprüfungen'
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'git wurde nicht gefunden.' }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js wurde nicht gefunden.' }
$branch = (& git rev-parse --abbrev-ref HEAD).Trim()
if ($branch -ne 'master') { throw "Releases werden von master erstellt (aktuell: $branch)." }
$dirty = & git status --porcelain
if ($dirty) { throw "Der Arbeitsstand ist nicht sauber. Bitte zuerst committen:`n$($dirty -join "`n")" }
Quiet { & git fetch --quiet origin 2>$null }
if ((& git tag --list $tag)) { throw "Den Tag $tag gibt es schon." }
$behind = (& git rev-list --count 'HEAD..origin/master').Trim()
if ($behind -ne '0') { throw "master ist $behind Commit(s) hinter origin/master. Bitte zuerst aktualisieren (git pull)." }
if ($Notes -and -not (Test-Path -LiteralPath $Notes)) { throw "Notizdatei nicht gefunden: $Notes" }
Write-Host "Release $tag aus $branch$(if ($DryRun) { ' (Probelauf)' })"

# ------------------------------------------------------------------ Tests
if (-not $SkipTests) {
  Step 'Unit-Tests'
  Run npx @('vitest', 'run')
  Step 'Browser-Tests'
  Run npx @('playwright', 'test')
}

# ------------------------------------------------------------------ Version und Pakete
Step "Version $Version in package.json"
$pkgPath = Join-Path $PSScriptRoot 'package.json'
$pkg = [System.IO.File]::ReadAllText($pkgPath)
$pkgNew = [regex]::Replace($pkg, '"version":\s*"[^"]*"', "`"version`": `"$Version`"", 1)
[System.IO.File]::WriteAllText($pkgPath, $pkgNew, (New-Object System.Text.UTF8Encoding $false))

Step 'Pakete bauen (ohne Spieldaten)'
Run node @('tools/build-dist.ts', '--target', 'all', '--zip')
$dist = Join-Path $PSScriptRoot 'dist'
$portableZip = Join-Path $dist 'BattleIsle3-windows-portable.zip'
$dockerZip = Join-Path $dist 'BattleIsle3-docker.zip'
if (Test-Path -LiteralPath $dockerZip) { Remove-Item -LiteralPath $dockerZip -Force }
$tar = Join-Path $env:SystemRoot 'System32\tar.exe'
Run $tar @('-a', '-c', '-f', $dockerZip, '-C', $dist, 'docker')

Step 'Pakete auf Spieldaten prüfen'
$forbidden = '(?i)(gamedata/.+|\.(lib|mis|mid|wav|avi|mp4|iso|3do|pbm)$)'
foreach ($zip in @($portableZip, $dockerZip)) {
  $entries = & $tar -tf $zip
  $hits = $entries | Where-Object { $_ -match $forbidden }
  if ($hits) { throw "In $zip stecken Spieldaten:`n$($hits -join "`n")" }
  '  {0,-36} {1,8:N1} MB  ok' -f (Split-Path $zip -Leaf), ((Get-Item $zip).Length / 1MB)
}

# ------------------------------------------------------------------ Release-Notizen
if ($Notes) {
  $body = [System.IO.File]::ReadAllText((Resolve-Path $Notes))
} else {
  $last = Quiet { & git describe --tags --abbrev=0 2>$null }
  $range = if ($last) { "$("$last".Trim())..HEAD" } else { 'HEAD' }
  $log = & git log $range --pretty=format:'- %s' --no-merges | Where-Object { $_ -notmatch '^- Version \d' }
  $body = @"
Browser-Umsetzung von **Battle Isle 3 – Schatten des Imperators**.

**Die Pakete enthalten keine Spieldaten.** Gebraucht werden die beiden eigenen Original-CDs als ``.iso``-Images; beim ersten Start übernimmt die Einrichtung die Daten und wandelt die Videos um.

- **BattleIsle3-windows-portable.zip** – Windows, ohne Installation: entpacken und die beiden ISO-Images auf ``BattleIsle3.bat`` ziehen.
- **BattleIsle3-docker.zip** – ISO-Images in den Ordner ``iso`` legen, ``docker compose up -d --build``, http://localhost:8080 öffnen.

### Änderungen

$($log -join "`n")

FFmpeg ist freie Software (GPL, https://ffmpeg.org). Battle Isle ist eine Marke der jeweiligen Rechteinhaber; dieses Projekt ist ein nicht-kommerzielles Hobbyprojekt.
"@
}

if ($DryRun) {
  Step 'Probelauf beendet'
  & git checkout -- package.json
  Write-Host 'Nichts wurde committet, gepusht oder hochgeladen. Release-Notizen:'
  Write-Host $body
  exit 0
}

# ------------------------------------------------------------------ Commit, Tag, Push
Step 'Commit, Tag und Push'
Run git @('add', 'package.json')
& git diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
  Run git @('commit', '-q', '-m', "Version $Version")
}
Run git @('tag', '-a', $tag, '-m', "Battle Isle 3 Browser $tag")
Run git @('push', '-q', 'origin', 'master')
Run git @('push', '-q', 'origin', $tag)
# develop auf den Stand von master bringen
Run git @('checkout', '-q', 'develop')
try {
  Run git @('merge', '-q', '--ff-only', 'master')
  Run git @('push', '-q', 'origin', 'develop')
} finally {
  Run git @('checkout', '-q', 'master')
}

# ------------------------------------------------------------------ GitHub-Release
Step 'GitHub-Release anlegen'
$notesFile = Join-Path $env:TEMP "bi3-release-$Version.md"
[System.IO.File]::WriteAllText($notesFile, $body, (New-Object System.Text.UTF8Encoding $false))
$title = "Battle Isle 3 Browser $tag"

if (Get-Command gh -ErrorAction SilentlyContinue) {
  $ghArgs = @('release', 'create', $tag, $portableZip, $dockerZip, '--repo', $Repo, '--title', $title, '--notes-file', $notesFile)
  if (-not $Final) { $ghArgs += '--prerelease' }
  Run gh $ghArgs
  $url = "https://github.com/$Repo/releases/tag/$tag"
} else {
  # Token aus dem Git-Anmeldespeicher (wie beim Push)
  $cred = Quiet { "protocol=https`nhost=github.com`n`n" | & git credential fill 2>$null }
  $token = ($cred | Where-Object { $_ -like 'password=*' }) -replace '^password=', ''
  if (-not $token) { throw 'Kein GitHub-Zugang gefunden (weder gh noch gespeicherte git-Anmeldedaten).' }
  $headers = @{ Authorization = "Bearer $token"; Accept = 'application/vnd.github+json'; 'User-Agent' = 'bi3-release' }
  $payload = @{ tag_name = $tag; name = $title; body = $body; draft = $false; prerelease = (-not $Final) } | ConvertTo-Json -Depth 3
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $release = Invoke-RestMethod -Method Post -Uri "https://api.github.com/repos/$Repo/releases" -Headers $headers `
    -Body ([System.Text.Encoding]::UTF8.GetBytes($payload)) -ContentType 'application/json; charset=utf-8'
  foreach ($zip in @($portableZip, $dockerZip)) {
    $name = Split-Path $zip -Leaf
    Write-Host "  lade $name hoch …"
    $null = Invoke-RestMethod -Method Post -Uri "https://uploads.github.com/repos/$Repo/releases/$($release.id)/assets?name=$name" `
      -Headers $headers -InFile $zip -ContentType 'application/zip'
  }
  $url = $release.html_url
}
Remove-Item -LiteralPath $notesFile -Force -ErrorAction SilentlyContinue

Step 'Fertig'
Write-Host "Release ${tag}: $url" -ForegroundColor Green
