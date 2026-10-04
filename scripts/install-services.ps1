<#
.SYNOPSIS
  Install or update Qbo on the home server as three auto-starting Windows services
  (visible in services.msc). Re-run after every `git pull` to update.

.DESCRIPTION
  One command does everything (no Docker; everything native for lowest audio latency):
    1. installs missing prerequisites via winget (JDK 21, Node.js LTS, NSSM)
    2. stops the services, runs `npm ci`
    3. downloads Lavalink.jar if missing, builds spotify-tokener if missing
    4. syncs lavalink\application.yml from application.example.yml (old copy backed up)
    5. (re)registers the services via NSSM - start at boot, restart on crash:
         "SpotifyTokener"  -> bin\spotify-tokener.exe        (anon token on 127.0.0.1:8080)
         "Lavalink"        -> java -Xmx1g -jar Lavalink.jar  (in lavalink\)
         "DiscordMusicBot" -> node --import tsx src\index.ts (repo root, depends on Lavalink)
    6. starts them and checks Lavalink answers and which plugin versions it loaded
  Environment variables are injected from the project .env file.

  If the window isn't elevated, the script reopens itself as Administrator.

.PARAMETER LavalinkVersion
  Lavalink release to download when lavalink\Lavalink.jar is missing (default 4.2.2).

.PARAMETER KeepLavalinkConfig
  Don't overwrite lavalink\application.yml from application.example.yml.

.EXAMPLE
  cd <repo> ; git pull
  powershell -ExecutionPolicy Bypass -File .\scripts\install-services.ps1
#>
param(
    [string]$LavalinkVersion = "4.2.2",
    [switch]$KeepLavalinkConfig
)
$ErrorActionPreference = "Stop"

# --- elevate if needed (keeps the new window open so the output stays readable) ---
$admin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
    ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
    $argList = @("-NoProfile", "-NoExit", "-ExecutionPolicy", "Bypass", "-File", "`"$PSCommandPath`"")
    if ($PSBoundParameters.ContainsKey("LavalinkVersion")) { $argList += @("-LavalinkVersion", $LavalinkVersion) }
    if ($KeepLavalinkConfig) { $argList += "-KeepLavalinkConfig" }
    Start-Process powershell.exe -Verb RunAs -ArgumentList $argList
    Write-Host "Continuing in a new Administrator window..." -ForegroundColor Yellow
    return
}

$repo = (Resolve-Path "$PSScriptRoot\..").Path
$lavalinkDir = Join-Path $repo "lavalink"
$services = @("DiscordMusicBot", "Lavalink", "SpotifyTokener")   # stop order

function Step($text) { Write-Host "`n==> $text" -ForegroundColor Cyan }

function Refresh-Path {
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                [Environment]::GetEnvironmentVariable("Path", "User")
}

function Winget-Install($id) {
    Write-Host "Installing $id via winget..." -ForegroundColor Yellow
    winget install --id $id -e --silent --accept-source-agreements --accept-package-agreements
    Refresh-Path
}

# Java major version of a java.exe (0 if it can't be run). "1.8.0_x" -> 8, "21.0.5" -> 21.
function Get-JavaMajor([string]$exe) {
    try {
        $psi = New-Object System.Diagnostics.ProcessStartInfo $exe, "-version"
        $psi.UseShellExecute = $false
        $psi.RedirectStandardError = $true
        $psi.RedirectStandardOutput = $true
        $p = [System.Diagnostics.Process]::Start($psi)
        $text = $p.StandardError.ReadToEnd() + $p.StandardOutput.ReadToEnd()
        $p.WaitForExit()
    } catch { return 0 }
    $m = [regex]::Match($text, 'version "(\d+)(?:\.(\d+))?')
    if (-not $m.Success) { return 0 }
    $major = [int]$m.Groups[1].Value
    if ($major -eq 1 -and $m.Groups[2].Success) { $major = [int]$m.Groups[2].Value }
    return $major
}

# Lavalink 4 needs Java 17+. PATH often points at an old Java 8, so look at JDK folders first.
function Find-Java {
    $candidates = @()
    if ($env:JAVA_HOME) { $candidates += Join-Path $env:JAVA_HOME "bin\java.exe" }
    foreach ($root in @("C:\Program Files\Eclipse Adoptium", "C:\Program Files\Zulu",
                        "C:\Program Files\Microsoft", "C:\Program Files\Java", "C:\Program Files\Amazon Corretto")) {
        if (Test-Path $root) {
            $candidates += Get-ChildItem $root -Directory | Sort-Object Name -Descending |
                ForEach-Object { Join-Path $_.FullName "bin\java.exe" }
        }
    }
    $onPath = Get-Command java -ErrorAction SilentlyContinue
    if ($onPath) { $candidates += $onPath.Source }
    foreach ($c in $candidates) {
        if ((Test-Path $c) -and ((Get-JavaMajor $c) -ge 17)) { return $c }
    }
    return $null
}

function Find-Node {
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if (-not $cmd) { return $null }
    $major = [int](((& $cmd.Source --version) -replace '^v', '') -split '\.')[0]
    if ($major -lt 22) { return $null }
    return $cmd.Source
}

function Find-Nssm {
    $cmd = Get-Command nssm -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    foreach ($p in @("C:\Program Files\nssm\win64\nssm.exe", "C:\nssm\win64\nssm.exe")) {
        if (Test-Path $p) { return $p }
    }
    return $null
}

# ---------------------------------------------------------------------------
Step "Checking prerequisites"
$java = Find-Java
if (-not $java) { Winget-Install "EclipseAdoptium.Temurin.21.JDK"; $java = Find-Java }
if (-not $java) { throw "JDK 17+ not found even after installing Temurin 21. Open a NEW PowerShell and re-run." }
Write-Host "Java (v$(Get-JavaMajor $java)): $java"

$node = Find-Node
if (-not $node) { Winget-Install "OpenJS.NodeJS.LTS"; $node = Find-Node }
if (-not $node) { throw "Node.js 22+ not found even after installing it. Open a NEW PowerShell and re-run." }
Write-Host "Node ($(& $node --version)): $node"

$nssm = Find-Nssm
if (-not $nssm) { Winget-Install "NSSM.NSSM"; $nssm = Find-Nssm }
if (-not $nssm) { throw "NSSM not found even after installing it. Open a NEW PowerShell and re-run." }
Write-Host "NSSM: $nssm"

$envFile = Join-Path $repo ".env"
if (-not (Test-Path $envFile)) { throw ".env missing. Copy .env.example to .env and fill it in." }

# --- parse .env into NAME=VALUE entries (NSSM injects them into the services) ---
$envEntries = @()
$envMap = @{}
foreach ($line in Get-Content $envFile) {
    $t = $line.Trim()
    if ($t -eq "" -or $t.StartsWith("#")) { continue }
    $idx = $t.IndexOf("=")
    if ($idx -lt 1) { continue }
    $key = $t.Substring(0, $idx).Trim()
    $val = $t.Substring($idx + 1).Trim()
    if ($val.Length -ge 2 -and (($val.StartsWith('"') -and $val.EndsWith('"')) -or ($val.StartsWith("'") -and $val.EndsWith("'")))) {
        $val = $val.Substring(1, $val.Length - 2)
    }
    if ($val -ne "") { $envEntries += "$key=$val"; $envMap[$key] = $val }
}
if (-not $envMap["LAVALINK_PASSWORD"]) { throw "LAVALINK_PASSWORD is empty in .env." }

# ---------------------------------------------------------------------------
Step "Stopping running services"
foreach ($name in $services) {
    if (Get-Service $name -ErrorAction SilentlyContinue) {
        & $nssm stop $name | Out-Null
        Write-Host "stopped $name"
    }
}

Step "Installing npm dependencies (npm ci)"
Push-Location $repo
try {
    & npm ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed (exit $LASTEXITCODE)." }
} finally { Pop-Location }

Step "Lavalink files"
if (-not (Test-Path (Join-Path $lavalinkDir "Lavalink.jar"))) {
    & (Join-Path $PSScriptRoot "get-lavalink.ps1") -Version $LavalinkVersion
} else {
    Write-Host "Lavalink.jar present."
}

$example = Join-Path $lavalinkDir "application.example.yml"
$config = Join-Path $lavalinkDir "application.yml"
if ($KeepLavalinkConfig -and (Test-Path $config)) {
    Write-Host "Keeping existing application.yml (-KeepLavalinkConfig)."
} elseif (-not (Test-Path $config)) {
    Copy-Item $example $config
    Write-Host "Created application.yml from application.example.yml."
} elseif ((Get-FileHash $example).Hash -ne (Get-FileHash $config).Hash) {
    $backup = "$config.bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    Copy-Item $config $backup
    Copy-Item $example $config -Force
    Write-Host "Updated application.yml from application.example.yml (old copy: $(Split-Path $backup -Leaf))."
} else {
    Write-Host "application.yml already up to date."
}

Step "spotify-tokener"
$tokener = Join-Path $repo "bin\spotify-tokener.exe"
if (-not (Test-Path $tokener)) { & (Join-Path $PSScriptRoot "get-tokener.ps1") }
if (-not (Test-Path $tokener)) { throw "bin\spotify-tokener.exe missing - run .\scripts\get-tokener.ps1 and check its output." }
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
if (-not (Test-Path $chrome)) { throw "Chrome missing at $chrome (needed by spotify-tokener). Install: winget install Google.Chrome" }
Write-Host "Tokener present."

# ---------------------------------------------------------------------------
New-Item -ItemType Directory -Force -Path (Join-Path $lavalinkDir "logs") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $repo "logs") | Out-Null

function Install-Service($name, $display, $description, $app, $params, $workdir, $envExtra, $depends) {
    if (-not (Get-Service $name -ErrorAction SilentlyContinue)) {
        & $nssm install $name $app | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "nssm install $name failed (exit $LASTEXITCODE)." }
    }
    & $nssm set $name Application $app | Out-Null
    if ($params) { & $nssm set $name AppParameters $params | Out-Null } else { & $nssm reset $name AppParameters | Out-Null }
    & $nssm set $name AppDirectory $workdir | Out-Null
    & $nssm set $name DisplayName $display | Out-Null
    & $nssm set $name Description $description | Out-Null
    & $nssm set $name Start SERVICE_AUTO_START | Out-Null          # start at boot, no login needed
    & $nssm set $name AppExit Default Restart | Out-Null           # restart whenever it exits
    & $nssm set $name AppRestartDelay 5000 | Out-Null              # e.g. network not up yet after boot
    & $nssm set $name AppStdout (Join-Path $workdir "logs\$name.out.log") | Out-Null
    & $nssm set $name AppStderr (Join-Path $workdir "logs\$name.err.log") | Out-Null
    & $nssm set $name AppRotateFiles 1 | Out-Null
    & $nssm set $name AppRotateOnline 1 | Out-Null
    & $nssm set $name AppRotateBytes 10485760 | Out-Null
    if ($envExtra.Count -gt 0) { & $nssm set $name AppEnvironmentExtra $envExtra | Out-Null }
    if ($depends) { & $nssm set $name DependOnService $depends | Out-Null } else { & $nssm reset $name DependOnService | Out-Null }
    Write-Host "configured $name"
}

Step "Registering services (automatic start at boot)"
Install-Service "SpotifyTokener" "Qbo - Spotify tokener" "Anonymous Spotify token for LavaSrc on 127.0.0.1:8080." `
    $tokener "" $repo @("SPOTIFY_TOKENER_ADDR=127.0.0.1:8080", "SPOTIFY_TOKENER_CHROME_PATH=$chrome") $null
Install-Service "Lavalink" "Qbo - Lavalink" "Lavalink audio node for the Qbo Discord bot (port 2333)." `
    $java "-Xmx1g -jar Lavalink.jar" $lavalinkDir $envEntries $null
Install-Service "DiscordMusicBot" "Qbo - Discord bot" "Qbo Discord music bot (Node.js)." `
    $node "--import tsx `"$repo\src\index.ts`"" $repo ($envEntries + "NODE_ENV=production") "Lavalink"

# ---------------------------------------------------------------------------
Step "Starting services"
& $nssm start SpotifyTokener | Out-Null
& $nssm start Lavalink | Out-Null

$port = if ($envMap["LAVALINK_PORT"]) { $envMap["LAVALINK_PORT"] } else { "2333" }
$headers = @{ Authorization = $envMap["LAVALINK_PASSWORD"] }
Write-Host "Waiting for Lavalink on port $port (first start downloads plugins)..."
$version = $null
$deadline = (Get-Date).AddSeconds(180)
while (-not $version -and (Get-Date) -lt $deadline) {
    try { $version = Invoke-RestMethod -Uri "http://127.0.0.1:$port/version" -Headers $headers -TimeoutSec 3 }
    catch { Start-Sleep -Seconds 3 }
}
if (-not $version) {
    Write-Host "`nLavalink did not answer within 3 minutes. Last log lines:" -ForegroundColor Red
    foreach ($log in @("Lavalink.err.log", "Lavalink.out.log")) {
        $path = Join-Path $lavalinkDir "logs\$log"
        if (Test-Path $path) { Write-Host "--- $log ---"; Get-Content $path -Tail 25 }
    }
    throw "Lavalink failed to start."
}
$info = Invoke-RestMethod -Uri "http://127.0.0.1:$port/v4/info" -Headers $headers -TimeoutSec 5
Write-Host "Lavalink $version (JVM $($info.jvm)) - plugins:" -ForegroundColor Green
$info.plugins | ForEach-Object { Write-Host "  $($_.name) $($_.version)" }

& $nssm start DiscordMusicBot | Out-Null
Start-Sleep -Seconds 10

Step "Status"
Get-Service $services | Sort-Object Name | Format-Table Name, DisplayName, Status, StartType -AutoSize
$botLog = Join-Path $repo "logs\DiscordMusicBot.out.log"
if (Test-Path $botLog) {
    $tail = Get-Content $botLog -Tail 40
    if ($tail -match "lavalink node connected") {
        Write-Host "Bot is connected to Lavalink." -ForegroundColor Green
    } else {
        Write-Host "Bot hasn't reported 'lavalink node connected' yet - last log lines:" -ForegroundColor Yellow
        $tail | Select-Object -Last 15
    }
}

Write-Host "`nDone. The services start automatically after every reboot (services.msc -> 'Qbo - ...')." -ForegroundColor Green
Write-Host "  Update later : git pull ; powershell -ExecutionPolicy Bypass -File .\scripts\install-services.ps1"
Write-Host "  Restart      : nssm restart Lavalink ; nssm restart DiscordMusicBot"
Write-Host "  Logs         : $lavalinkDir\logs  and  $repo\logs"
