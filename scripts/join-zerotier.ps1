#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Join a Grudge Studio ZeroTier network.
    Run on any machine (GrudgeYonko, DESKTOP-AA5O5QR) as admin.

.USAGE
    # Replace NETWORK_ID with your ZeroTier network ID
    powershell -ExecutionPolicy Bypass -File join-zerotier.ps1 -NetworkId "a1b2c3d4e5f6g7h8"
#>

param(
    [Parameter(Mandatory=$true)]
    [string]$NetworkId
)

$ErrorActionPreference = "Stop"

Write-Host "`n=== Grudge Studio — ZeroTier Join ===" -ForegroundColor Cyan

# Check ZeroTier is running
$svc = Get-Service ZeroTierOneService -ErrorAction SilentlyContinue
if (-not $svc -or $svc.Status -ne "Running") {
    Write-Host "[ERROR] ZeroTier service not running. Install from https://www.zerotier.com/download/" -ForegroundColor Red
    exit 1
}

# Get current info
Write-Host "Node info:" -ForegroundColor Yellow
& "C:\ProgramData\ZeroTier\One\zerotier-one_x64.exe" -q info

# Join network
Write-Host "`nJoining network $NetworkId ..." -ForegroundColor Yellow
& "C:\ProgramData\ZeroTier\One\zerotier-one_x64.exe" -q join $NetworkId

Start-Sleep -Seconds 2

# Show network status
Write-Host "`nNetwork status:" -ForegroundColor Yellow
& "C:\ProgramData\ZeroTier\One\zerotier-one_x64.exe" -q listnetworks

Write-Host "`n=== Done ===" -ForegroundColor Cyan
Write-Host "Now authorize this node in the ZeroTier dashboard:"
Write-Host "  https://my.zerotier.com/network/$NetworkId"
Write-Host ""
Write-Host "Suggested IPs:"
Write-Host "  GrudgeYonko:        10.147.17.1"
Write-Host "  DESKTOP-AA5O5QR:    10.147.17.2"
Write-Host "  VPS:                10.147.17.10"
Write-Host ""
