<#
.SYNOPSIS
  Install or update yt-cipher (YouTube signature / n-parameter solver) under <repo>\yt-cipher.

.DESCRIPTION
  youtube-source no longer deciphers YouTube player scripts itself; Lavalink asks a
  yt-cipher server instead (plugins.youtube.remoteCipher in application.yml).
  This follows the official kikkia/yt-cipher Dockerfile, without Docker:
    1. installs Deno via winget if missing
    2. clones (or updates) https://github.com/kikkia/yt-cipher into <repo>\yt-cipher
    3. fetches yt-dlp/ejs at the commit pinned in yt-cipher's Dockerfile and patches it
    4. pre-downloads the Deno dependencies into <repo>\yt-cipher\.deno (DENO_DIR)
  Safe to re-run. install-services.ps1 calls it and runs the server as the "YtCipher" service.
#>
$ErrorActionPreference = "Stop"
$repo = (Resolve-Path "$PSScriptRoot\..").Path
$dir = Join-Path $repo "yt-cipher"
$ejs = Join-Path $dir "ejs"
$marker = Join-Path $dir ".ejs-commit"

function Refresh-Path {
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                [Environment]::GetEnvironmentVariable("Path", "User")
}

function Invoke-Native([string]$exe, [string[]]$arguments) {
    & $exe @arguments
    if ($LASTEXITCODE -ne 0) { throw "'$exe $($arguments -join ' ')' failed (exit $LASTEXITCODE)." }
}

# --- Deno ---
$deno = Get-Command deno -ErrorAction SilentlyContinue
if (-not $deno) {
    Write-Host "Deno not found - installing via winget..." -ForegroundColor Yellow
    # Machine scope keeps deno.exe outside a user profile (the service runs as LocalSystem).
    winget install --id DenoLand.Deno -e --scope machine --silent --accept-source-agreements --accept-package-agreements
    if ($LASTEXITCODE -ne 0) {
        winget install --id DenoLand.Deno -e --silent --accept-source-agreements --accept-package-agreements
    }
    Refresh-Path
    $deno = Get-Command deno -ErrorAction SilentlyContinue
    if (-not $deno) { throw "Deno was installed but isn't on PATH yet. Open a NEW PowerShell and re-run." }
}
$deno = $deno.Source
Write-Host "Deno: $deno"

# --- yt-cipher sources ---
if (Test-Path (Join-Path $dir ".git")) {
    Write-Host "Updating yt-cipher..."
    Invoke-Native "git" @("-C", $dir, "pull", "--ff-only")
} else {
    Write-Host "Cloning yt-cipher..."
    Invoke-Native "git" @("clone", "--depth", "1", "https://github.com/kikkia/yt-cipher.git", $dir)
}

# --- ejs at the commit yt-cipher pins in its Dockerfile, patched for Deno ---
$dockerfile = Get-Content (Join-Path $dir "Dockerfile") -Raw
$m = [regex]::Match($dockerfile, 'ARG\s+EJS_COMMIT=([0-9a-fA-F]{7,40})')
if (-not $m.Success) { throw "Could not find 'ARG EJS_COMMIT=' in yt-cipher's Dockerfile - its build steps changed." }
$ejsCommit = $m.Groups[1].Value
$current = if (Test-Path $marker) { (Get-Content $marker -Raw).Trim() } else { "" }

if ($current -ne $ejsCommit -or -not (Test-Path $ejs)) {
    Write-Host "Fetching yt-dlp/ejs $ejsCommit..."
    if (Test-Path $ejs) { Remove-Item $ejs -Recurse -Force }
    Invoke-Native "git" @("init", "-q", $ejs)
    Invoke-Native "git" @("-C", $ejs, "remote", "add", "origin", "https://github.com/yt-dlp/ejs.git")
    Invoke-Native "git" @("-C", $ejs, "fetch", "-q", "--depth", "1", "origin", $ejsCommit)
    Invoke-Native "git" @("-C", $ejs, "checkout", "-q", "--detach", "FETCH_HEAD")
    Push-Location $dir
    try { Invoke-Native $deno @("run", "--allow-read", "--allow-write", "./scripts/patch-ejs.ts") }
    finally { Pop-Location }
    Set-Content -Path $marker -Value $ejsCommit -Encoding ASCII
} else {
    Write-Host "ejs already at $ejsCommit."
}

# --- dependencies into a cache shared with the service (DENO_DIR) ---
New-Item -ItemType Directory -Force -Path (Join-Path $dir "player_cache") | Out-Null
$env:DENO_DIR = Join-Path $dir ".deno"
$env:DENO_NO_UPDATE_CHECK = "1"
Push-Location $dir
try {
    & $deno install --entrypoint server.ts worker.ts
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "Pre-caching dependencies failed (exit $LASTEXITCODE); the service downloads them on first start."
    }
} finally { Pop-Location }

Write-Host "yt-cipher ready in $dir" -ForegroundColor Green
