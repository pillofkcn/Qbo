<#
.SYNOPSIS
  Install or update Qbo on the home server as auto-starting Windows services
  (visible in services.msc). Re-run after every `git pull` to update.

.DESCRIPTION
  One command does everything (no Docker; everything native for lowest audio latency):
    1. checks that Windows Smart App Control is off (it blocks spotify-tokener and the
       DAVE voice-encryption library Lavalink needs, so Discord would refuse the voice connection)
    2. installs missing prerequisites via winget (JDK 21, Node.js LTS, NSSM, Deno)
    3. stops the services, runs `npm ci`
    4. downloads Lavalink.jar / builds spotify-tokener if missing, installs or updates yt-cipher
    5. syncs lavalink\application.yml from application.example.yml (old copy backed up)
    6. (re)registers the services via NSSM - start at boot, restart on crash:
         "YtCipher"        -> deno run ... server.ts         (YouTube signature solver, 127.0.0.1:8001)
         "SpotifyTokener"  -> bin\spotify-tokener.exe        (anonymous Spotify token, 127.0.0.1:8080)
         "Lavalink"        -> java -Xmx1g -jar Lavalink.jar  (in lavalink\)
         "DiscordMusicBot" -> node --import tsx src\index.ts (repo root, depends on Lavalink)
    7. starts them, checks that each one answers and, on the first run, walks you through the
       one-time YouTube login (BURNER Google account); the token is saved to .env.local
  Environment variables come from .env plus the server-only .env.local (not in git; wins over .env).

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
$cipherDir = Join-Path $repo "yt-cipher"
$logDir = Join-Path $repo "logs"
$services = @("DiscordMusicBot", "Lavalink", "SpotifyTokener", "YtCipher")   # stop order

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

# "On" | "Off" | "Eval" | "unknown"
function Get-SmartAppControlState {
    try {
        $s = (Get-MpComputerStatus -ErrorAction Stop).SmartAppControlState
        if ($s) { return [string]$s }
    } catch {}
    $v = (Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy" -ErrorAction SilentlyContinue).VerifiedAndReputablePolicyState
    if ($v -eq 0) { return "Off" }
    if ($v -eq 1) { return "On" }
    if ($v -eq 2) { return "Eval" }
    return "unknown"
}

# True once anything answers on the URL (any HTTP status counts as "up").
function Wait-Http([string]$url, [int]$seconds) {
    $deadline = (Get-Date).AddSeconds($seconds)
    while ((Get-Date) -lt $deadline) {
        try {
            Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5 | Out-Null
            return $true
        } catch {
            if ($_.Exception.Response) { return $true }
            Start-Sleep -Seconds 2
        }
    }
    return $false
}

function Show-ServiceProblem([string]$name) {
    Write-Host "$name is not answering. Recent NSSM events and log lines:" -ForegroundColor Red
    Get-EventLog -LogName Application -Source nssm -Newest 60 -ErrorAction SilentlyContinue |
        Where-Object { $_.Message -match $name } | Select-Object -First 3 |
        ForEach-Object { Write-Host "  [$($_.TimeGenerated)] $($_.Message.Trim())" }
    foreach ($suffix in @("err", "out")) {
        $path = Join-Path $logDir "$name.$suffix.log"
        if (Test-Path $path) { Write-Host "--- $name.$suffix.log ---"; Get-Content $path -Tail 15 }
    }
}

# ---------------------------------------------------------------------------
Step "Checking Windows Smart App Control"
$sac = Get-SmartAppControlState
Write-Host "Smart App Control: $sac"
if ($sac -eq "On") {
    Write-Host ""
    Write-Host "Smart App Control blocks unsigned programs and native libraries on this PC:" -ForegroundColor Red
    Write-Host "  - spotify-tokener.exe can't start (Spotify links fail)" -ForegroundColor Red
    Write-Host "  - Lavalink can't load its DAVE voice-encryption library, so Discord rejects the" -ForegroundColor Red
    Write-Host "    voice connection (code 4017) and nothing can be heard" -ForegroundColor Red
    Write-Host "It has no per-app exceptions. Turn it off (only a Windows reinstall turns it back on):"
    Write-Host "  Windows Security > App & browser control > Smart App Control settings > Off"
    Write-Host "  (SK: Zabezpecenie Windows > Ovladanie aplikacii a prehliadaca > Nastavenia Smart App Control > Vypnute)"
    Write-Host "Then run this script again."
    throw "Smart App Control is on."
}

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

# --- .env + server-only .env.local -> NAME=VALUE entries (NSSM injects them into the services) ---
$envFile = Join-Path $repo ".env"
$localEnvFile = Join-Path $repo ".env.local"
if (-not (Test-Path $envFile)) { throw ".env missing. Copy .env.example to .env and fill it in." }

function Read-EnvFile([string]$path, $map) {
    foreach ($line in Get-Content $path) {
        $t = $line.Trim()
        if ($t -eq "" -or $t.StartsWith("#")) { continue }
        $idx = $t.IndexOf("=")
        if ($idx -lt 1) { continue }
        $key = $t.Substring(0, $idx).Trim()
        $val = $t.Substring($idx + 1).Trim()
        if ($val.Length -ge 2 -and (($val.StartsWith('"') -and $val.EndsWith('"')) -or ($val.StartsWith("'") -and $val.EndsWith("'")))) {
            $val = $val.Substring(1, $val.Length - 2)
        }
        if ($val -ne "") { $map[$key] = $val }
    }
}

# Generated secrets and the YouTube OAuth token stay on this server, outside git.
function Set-EnvLocal([string]$key, [string]$value) {
    $lines = @()
    if (Test-Path $localEnvFile) {
        $lines = @(Get-Content $localEnvFile | Where-Object { $_ -notmatch "^\s*$([regex]::Escape($key))\s*=" })
    }
    $lines += "$key=$value"
    Set-Content -Path $localEnvFile -Value $lines -Encoding ASCII
    $envMap[$key] = $value
}

function Get-EnvEntries { @($envMap.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) }

$envMap = [ordered]@{}
Read-EnvFile $envFile $envMap
if (Test-Path $localEnvFile) { Read-EnvFile $localEnvFile $envMap }
if (-not $envMap["LAVALINK_PASSWORD"]) { throw "LAVALINK_PASSWORD is empty in .env." }
if (-not $envMap["YT_CIPHER_PASSWORD"]) {
    Set-EnvLocal "YT_CIPHER_PASSWORD" ([guid]::NewGuid().ToString("N"))
    Write-Host "Generated YT_CIPHER_PASSWORD in .env.local."
}

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

Step "yt-cipher (YouTube signature solver)"
& (Join-Path $PSScriptRoot "get-yt-cipher.ps1")
Refresh-Path
$deno = (Get-Command deno -ErrorAction SilentlyContinue).Source
if (-not $deno) { throw "deno not found after get-yt-cipher.ps1 - open a NEW PowerShell and re-run." }

# ---------------------------------------------------------------------------
New-Item -ItemType Directory -Force -Path (Join-Path $lavalinkDir "logs") | Out-Null
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Install-Service($name, $display, $description, $app, $params, $workdir, $envExtra, $depends, $logs) {
    if (-not $logs) { $logs = Join-Path $workdir "logs" }
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
    & $nssm set $name AppStdout (Join-Path $logs "$name.out.log") | Out-Null
    & $nssm set $name AppStderr (Join-Path $logs "$name.err.log") | Out-Null
    & $nssm set $name AppRotateFiles 1 | Out-Null
    & $nssm set $name AppRotateOnline 1 | Out-Null
    & $nssm set $name AppRotateBytes 10485760 | Out-Null
    if ($envExtra.Count -gt 0) { & $nssm set $name AppEnvironmentExtra $envExtra | Out-Null }
    if ($depends) { & $nssm set $name DependOnService $depends | Out-Null } else { & $nssm reset $name DependOnService | Out-Null }
    Write-Host "configured $name"
}

Step "Registering services (automatic start at boot)"
$cipherEnv = @("API_TOKEN=$($envMap['YT_CIPHER_PASSWORD'])", "HOST=127.0.0.1", "PORT=8001",
               "DENO_DIR=$(Join-Path $cipherDir '.deno')", "DENO_NO_UPDATE_CHECK=1", "NO_COLOR=1")
Install-Service "YtCipher" "Qbo - yt-cipher" "YouTube signature solver for Lavalink (127.0.0.1:8001)." `
    $deno "run --allow-net --allow-read --allow-write --allow-env server.ts" $cipherDir $cipherEnv $null $logDir
Install-Service "SpotifyTokener" "Qbo - Spotify tokener" "Anonymous Spotify token for LavaSrc on 127.0.0.1:8080." `
    $tokener "" $repo @("SPOTIFY_TOKENER_ADDR=127.0.0.1:8080", "SPOTIFY_TOKENER_CHROME_PATH=$chrome") $null $logDir
Install-Service "Lavalink" "Qbo - Lavalink" "Lavalink audio node for the Qbo Discord bot (port 2333)." `
    $java "-Xmx1g -jar Lavalink.jar" $lavalinkDir (Get-EnvEntries) $null $null
Install-Service "DiscordMusicBot" "Qbo - Discord bot" "Qbo Discord music bot (Node.js)." `
    $node "--import tsx `"$repo\src\index.ts`"" $repo ((Get-EnvEntries) + "NODE_ENV=production") "Lavalink" $logDir

# ---------------------------------------------------------------------------
Step "Starting services"
& $nssm start YtCipher | Out-Null
& $nssm start SpotifyTokener | Out-Null
& $nssm start Lavalink | Out-Null

if (Wait-Http "http://127.0.0.1:8001/" 90) {
    Write-Host "yt-cipher is up." -ForegroundColor Green
} else {
    Show-ServiceProblem "YtCipher"
    Write-Host "YouTube playback will fail until yt-cipher runs." -ForegroundColor Yellow
}
if (Wait-Http "http://127.0.0.1:8080/" 30) {
    Write-Host "spotify-tokener is up." -ForegroundColor Green
} else {
    Show-ServiceProblem "SpotifyTokener"
    Write-Host "Spotify links won't load until the tokener runs." -ForegroundColor Yellow
}

$port = if ($envMap["LAVALINK_PORT"]) { $envMap["LAVALINK_PORT"] } else { "2333" }
$headers = @{ Authorization = $envMap["LAVALINK_PASSWORD"] }

function Wait-Lavalink([int]$seconds) {
    $deadline = (Get-Date).AddSeconds($seconds)
    while ((Get-Date) -lt $deadline) {
        try { return (Invoke-RestMethod -Uri "http://127.0.0.1:$port/version" -Headers $headers -TimeoutSec 3) }
        catch { Start-Sleep -Seconds 3 }
    }
    return $null
}

Write-Host "Waiting for Lavalink on port $port (first start downloads plugins)..."
$version = Wait-Lavalink 180
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

# --- one-time YouTube login: the plugin logs a device code, then the refresh token ---
if (-not $envMap["YT_OAUTH_REFRESH_TOKEN"]) {
    Step "YouTube login (one time, BURNER Google account)"
    $llLog = Join-Path $lavalinkDir "logs\Lavalink.out.log"
    $token = $null
    $shown = $false
    $codeDeadline = (Get-Date).AddSeconds(90)
    $loginDeadline = (Get-Date).AddMinutes(10)
    while ((Get-Date) -lt $loginDeadline -and ($shown -or (Get-Date) -lt $codeDeadline)) {
        $text = ""
        if (Test-Path $llLog) { $text = [string](Get-Content $llLog -Raw -ErrorAction SilentlyContinue) }
        $t = [regex]::Match($text, 'can be reused\. \((\S+)\)')
        if ($t.Success) { $token = $t.Groups[1].Value; break }
        if ($text -match 'device token has expired|Account linking was denied') { break }
        $c = [regex]::Match($text, 'go to (\S+) and enter code (\S+)')
        if ($c.Success -and -not $shown) {
            Write-Host ""
            Write-Host "  ==============================================================" -ForegroundColor Yellow
            Write-Host "   1. Open  $($c.Groups[1].Value)  (on your phone or any PC)" -ForegroundColor Yellow
            Write-Host "   2. Sign in with a BURNER Google account - NOT your main one" -ForegroundColor Yellow
            Write-Host "   3. Enter the code:  $($c.Groups[2].Value)   and allow access" -ForegroundColor Yellow
            Write-Host "  ==============================================================" -ForegroundColor Yellow
            Write-Host "  Waiting for the login (up to 10 minutes)..."
            $shown = $true
        }
        Start-Sleep -Seconds 3
    }
    if ($token) {
        Set-EnvLocal "YT_OAUTH_REFRESH_TOKEN" $token
        & $nssm set Lavalink AppEnvironmentExtra (Get-EnvEntries) | Out-Null
        & $nssm restart Lavalink | Out-Null
        if (-not (Wait-Lavalink 180)) { throw "Lavalink did not come back after saving the YouTube login - check lavalink\logs." }
        Write-Host "YouTube login saved to .env.local; Lavalink restarted with it." -ForegroundColor Green
    } elseif (-not $shown) {
        Write-Host "Lavalink printed no YouTube login code (is plugins.youtube.oauth enabled in application.yml?)." -ForegroundColor Yellow
    } else {
        Write-Host "No login within 10 minutes (or it was cancelled). Re-run this script for a new code;" -ForegroundColor Yellow
        Write-Host "YouTube won't play until the login is done." -ForegroundColor Yellow
    }
}

& $nssm start DiscordMusicBot | Out-Null
Start-Sleep -Seconds 10

Step "Status"
Get-Service $services | Sort-Object Name | Format-Table Name, DisplayName, Status, StartType -AutoSize
$botLog = Join-Path $logDir "DiscordMusicBot.out.log"
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
Write-Host "  Test         : /play https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3 (must be audible), then a YouTube search"
Write-Host "  Update later : git pull ; powershell -ExecutionPolicy Bypass -File .\scripts\install-services.ps1"
Write-Host "  Restart      : nssm restart Lavalink ; nssm restart DiscordMusicBot"
Write-Host "  Logs         : $lavalinkDir\logs  and  $logDir"
