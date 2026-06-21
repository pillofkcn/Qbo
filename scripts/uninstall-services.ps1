<#
.SYNOPSIS
  Stop and remove the Lavalink + DiscordMusicBot Windows services.
.DESCRIPTION
  Run from an elevated (Administrator) PowerShell.
#>
$ErrorActionPreference = "SilentlyContinue"

$admin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
    ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw "Please run this script in an elevated (Administrator) PowerShell." }

foreach ($name in @("DiscordMusicBot", "Lavalink", "SpotifyTokener")) {
    if (Get-Service $name -ErrorAction SilentlyContinue) {
        Write-Host "Removing service '$name'..." -ForegroundColor Yellow
        & nssm stop $name | Out-Null
        & nssm remove $name confirm | Out-Null
    } else {
        Write-Host "Service '$name' not installed — skipping."
    }
}
Write-Host "Done." -ForegroundColor Green
