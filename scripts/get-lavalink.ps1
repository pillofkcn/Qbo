<#
.SYNOPSIS
  Download Lavalink.jar into the lavalink/ folder.

.DESCRIPTION
  Fetches the latest Lavalink v4 release from GitHub (or a pinned version) and
  saves it as lavalink/Lavalink.jar. Lavalink downloads its own plugins on first
  boot from application.yml, so this only needs the single jar.

.PARAMETER Version
  A release tag like "4.2.2", or "latest" (default).

.EXAMPLE
  ./scripts/get-lavalink.ps1
  ./scripts/get-lavalink.ps1 -Version 4.2.2
#>
param(
    [string]$Version = "latest"
)

$ErrorActionPreference = "Stop"
$repo = (Resolve-Path "$PSScriptRoot\..").Path
$lavalinkDir = Join-Path $repo "lavalink"
$target = Join-Path $lavalinkDir "Lavalink.jar"

if (-not (Test-Path $lavalinkDir)) {
    New-Item -ItemType Directory -Path $lavalinkDir | Out-Null
}

if ($Version -eq "latest") {
    Write-Host "Querying GitHub for the latest Lavalink v4 release..."
    $release = Invoke-RestMethod -Uri "https://api.github.com/repos/lavalink-devs/Lavalink/releases/latest" `
        -Headers @{ "User-Agent" = "discord-music-bot" }
    $tag = $release.tag_name
    $asset = $release.assets | Where-Object { $_.name -eq "Lavalink.jar" } | Select-Object -First 1
    if (-not $asset) { throw "Could not find Lavalink.jar in the latest release ($tag)." }
    $url = $asset.browser_download_url
} else {
    $tag = $Version
    $url = "https://github.com/lavalink-devs/Lavalink/releases/download/$tag/Lavalink.jar"
}

Write-Host "Downloading Lavalink $tag from:`n  $url"
Invoke-WebRequest -Uri $url -OutFile $target -Headers @{ "User-Agent" = "discord-music-bot" }
Write-Host "Saved -> $target" -ForegroundColor Green

if (-not (Test-Path (Join-Path $lavalinkDir "application.yml"))) {
    Write-Host "`nReminder: copy lavalink/application.example.yml -> lavalink/application.yml and fill it in." -ForegroundColor Yellow
}
