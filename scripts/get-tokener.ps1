<#
.SYNOPSIS
  Build the native spotify-tokener binary into bin\spotify-tokener.exe (no Docker).

.DESCRIPTION
  Spotify playlists/albums need an anonymous (web-player) token. We serve it locally
  with topi314/spotify-tokener on 127.0.0.1:8080 (LavaSrc customTokenEndpoint). This
  script installs Go + Chrome if missing, builds the tokener via 'go install', and
  copies the binary to <repo>\bin\ so install-services.ps1 can run it as a service.

  Run from the repo root:  ./scripts/get-tokener.ps1
  After Go/Chrome get installed you may need a NEW PowerShell so 'go' is on PATH.
#>
$ErrorActionPreference = "Stop"
$repo = (Resolve-Path "$PSScriptRoot\..").Path
$binDir = Join-Path $repo "bin"
$target = Join-Path $binDir "spotify-tokener.exe"

function Have($name) { [bool](Get-Command $name -ErrorAction SilentlyContinue) }
function Refresh-Path {
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                [Environment]::GetEnvironmentVariable("Path", "User")
}

# --- Go ---
if (-not (Have "go")) {
    Write-Host "Go not found - installing via winget..." -ForegroundColor Yellow
    winget install --id GoLang.Go -e --accept-source-agreements --accept-package-agreements
    Refresh-Path
    if (-not (Have "go")) {
        throw "Go was installed but isn't on PATH yet. Open a NEW PowerShell and re-run this script."
    }
}

# --- Chrome (runtime dependency of the tokener) ---
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
if (-not (Test-Path $chrome)) {
    Write-Host "Chrome not found - installing via winget..." -ForegroundColor Yellow
    winget install --id Google.Chrome -e --accept-source-agreements --accept-package-agreements
}
if (-not (Test-Path $chrome)) {
    Write-Warning "Chrome not found at $chrome. If it's elsewhere, set SPOTIFY_TOKENER_CHROME_PATH accordingly."
}

# --- build ---
Write-Host "Building spotify-tokener via 'go install'..." -ForegroundColor Cyan
go install github.com/topi314/spotify-tokener@master
if ($LASTEXITCODE -ne 0) { throw "go install failed (exit $LASTEXITCODE)." }

$gobin = (& go env GOBIN)
if (-not $gobin) { $gobin = Join-Path (& go env GOPATH) "bin" }
$built = Join-Path $gobin "spotify-tokener.exe"
if (-not (Test-Path $built)) { throw "Built binary not found at $built" }

New-Item -ItemType Directory -Force -Path $binDir | Out-Null
Copy-Item -Force $built $target
Write-Host "`nSaved -> $target" -ForegroundColor Green
Write-Host "Test it before installing the service:" -ForegroundColor Green
Write-Host "  $target"
Write-Host "  Invoke-RestMethod http://localhost:8080/api/token   # should return a JSON token"
