<#
.SYNOPSIS
  Register Lavalink + the Discord bot + spotify-tokener as auto-starting Windows
  services via NSSM (no Docker; everything native for lowest audio latency).

.DESCRIPTION
  Creates three services that start at boot (before login), restart on crash, and
  run headless on the home server:
    - "SpotifyTokener"    -> bin\spotify-tokener.exe          (anon token on 127.0.0.1:8080)
    - "Lavalink"          -> java -Xmx1g -jar Lavalink.jar    (in lavalink/)
    - "DiscordMusicBot"   -> node --import tsx src/index.ts   (in repo root)
  Environment variables are injected from the project .env file.

  Run this from an ELEVATED (Administrator) PowerShell.

.PREREQUISITES
  - JDK 21        : winget install EclipseAdoptium.Temurin.21.JDK
  - Node.js 22+   : winget install OpenJS.NodeJS.LTS
  - NSSM          : winget install NSSM.NSSM   (or choco install nssm)
  - npm install   (run once in the repo so node_modules + tsx exist)
  - lavalink/Lavalink.jar present (run scripts/get-lavalink.ps1)
  - bin/spotify-tokener.exe present + Chrome installed (run scripts/get-tokener.ps1)
  - lavalink/application.yml and .env filled in
#>
$ErrorActionPreference = "Stop"

# ── must be admin ────────────────────────────────────────────────────────
$admin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
    ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw "Please run this script in an elevated (Administrator) PowerShell." }

$repo = (Resolve-Path "$PSScriptRoot\..").Path
$lavalinkDir = Join-Path $repo "lavalink"

# ── tool checks ──────────────────────────────────────────────────────────
function Require-Command($name, $hint) {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    if (-not $cmd) { throw "$name not found. $hint" }
    return $cmd.Source
}
$java = Require-Command "java" "Install JDK 21: winget install EclipseAdoptium.Temurin.21.JDK"
$node = Require-Command "node" "Install Node 22+: winget install OpenJS.NodeJS.LTS"
Require-Command "nssm" "Install NSSM: winget install NSSM.NSSM" | Out-Null

if (-not (Test-Path (Join-Path $lavalinkDir "Lavalink.jar"))) {
    throw "lavalink/Lavalink.jar missing. Run: ./scripts/get-lavalink.ps1"
}
if (-not (Test-Path (Join-Path $lavalinkDir "application.yml"))) {
    throw "lavalink/application.yml missing. Copy application.example.yml and fill it in."
}
if (-not (Test-Path (Join-Path $repo ".env"))) {
    throw ".env missing. Copy .env.example to .env and fill it in."
}
if (-not (Test-Path (Join-Path $repo "node_modules"))) {
    throw "node_modules missing. Run 'npm install' in the repo first."
}
$tokener = Join-Path $repo "bin\spotify-tokener.exe"
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
if (-not (Test-Path $tokener)) {
    throw "bin\spotify-tokener.exe missing. Run: ./scripts/get-tokener.ps1"
}
if (-not (Test-Path $chrome)) {
    throw "Chrome missing at $chrome (needed by spotify-tokener). Install: winget install Google.Chrome"
}

# ── parse .env into NAME=VALUE entries ───────────────────────────────────
$envEntries = @()
foreach ($line in Get-Content (Join-Path $repo ".env")) {
    $t = $line.Trim()
    if ($t -eq "" -or $t.StartsWith("#")) { continue }
    $idx = $t.IndexOf("=")
    if ($idx -lt 1) { continue }
    $key = $t.Substring(0, $idx).Trim()
    $val = $t.Substring($idx + 1).Trim()
    if ($val -ne "") { $envEntries += "$key=$val" }
}

New-Item -ItemType Directory -Force -Path (Join-Path $lavalinkDir "logs") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $repo "logs") | Out-Null

function Install-Service($name, $app, $params, $workdir, $envExtra, $depends) {
    if (Get-Service $name -ErrorAction SilentlyContinue) {
        Write-Host "Service '$name' exists — reconfiguring..." -ForegroundColor Yellow
        & nssm stop $name | Out-Null
    } else {
        & nssm install $name $app
    }
    & nssm set $name Application $app
    & nssm set $name AppParameters $params
    & nssm set $name AppDirectory $workdir
    & nssm set $name Start SERVICE_AUTO_START
    & nssm set $name AppStdout (Join-Path $workdir "logs\$name.out.log")
    & nssm set $name AppStderr (Join-Path $workdir "logs\$name.err.log")
    & nssm set $name AppRotateFiles 1
    & nssm set $name AppRotateBytes 10485760
    if ($envExtra.Count -gt 0) { & nssm set $name AppEnvironmentExtra $envExtra }
    if ($depends) { & nssm set $name DependOnService $depends }
}

Write-Host "`nInstalling 'SpotifyTokener' service..." -ForegroundColor Cyan
$tokenerEnv = @("SPOTIFY_TOKENER_ADDR=127.0.0.1:8080", "SPOTIFY_TOKENER_CHROME_PATH=$chrome")
Install-Service "SpotifyTokener" $tokener "" $repo $tokenerEnv $null

Write-Host "Installing 'Lavalink' service..." -ForegroundColor Cyan
Install-Service "Lavalink" $java "-Xmx1g -jar Lavalink.jar" $lavalinkDir $envEntries $null

Write-Host "Installing 'DiscordMusicBot' service..." -ForegroundColor Cyan
$botParams = "--import tsx `"$repo\src\index.ts`""
$botEnv = $envEntries + "NODE_ENV=production"
Install-Service "DiscordMusicBot" $node $botParams $repo $botEnv "Lavalink"

Write-Host "`nStarting services..." -ForegroundColor Cyan
& nssm start SpotifyTokener
& nssm start Lavalink
Start-Sleep -Seconds 8   # give Lavalink a head start to load plugins
& nssm start DiscordMusicBot

Write-Host "`nDone. Manage with:" -ForegroundColor Green
Write-Host "  nssm restart SpotifyTokener ; nssm restart Lavalink ; nssm restart DiscordMusicBot"
Write-Host "  nssm status  SpotifyTokener ; nssm status  Lavalink ; nssm status  DiscordMusicBot"
Write-Host "  Logs: $lavalinkDir\logs  and  $repo\logs"
Write-Host "  Tokener check: Invoke-RestMethod http://localhost:8080/api/token"
