#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Opens Windows Firewall for Grudge Studio backend services on the LAN.
    Run this on DESKTOP-AA5O5QR to allow GrudgeYonko (and other LAN machines) to reach Docker services.

.USAGE
    # Copy to DESKTOP-AA5O5QR and run in elevated PowerShell:
    powershell -ExecutionPolicy Bypass -File open-lan-firewall.ps1
#>

$ErrorActionPreference = "Stop"

$rules = @(
    @{ Name = "Grudge - Identity API (3001)";   Port = 3001 },
    @{ Name = "Grudge - Wallet Service (3002)";  Port = 3002 },
    @{ Name = "Grudge - Game API (3003)";        Port = 3003 },
    @{ Name = "Grudge - AI Agent (3004)";        Port = 3004 },
    @{ Name = "Grudge - Account API (3005)";     Port = 3005 },
    @{ Name = "Grudge - Launcher API (3006)";    Port = 3006 },
    @{ Name = "Grudge - WebSocket (3007)";       Port = 3007 },
    @{ Name = "Grudge - Asset Service (3008)";   Port = 3008 },
    @{ Name = "Grudge - Uptime Kuma (3009)";     Port = 3009 },
    @{ Name = "Grudge - MySQL Dev (3306)";       Port = 3306 },
    @{ Name = "Grudge - Redis Dev (6379)";       Port = 6379 }
)

$subnets = @(
    "10.0.0.0/24",    # Local LAN
    "26.0.0.0/8"      # Radmin VPN
)

Write-Host "`n=== Grudge Studio — LAN Firewall Setup ===" -ForegroundColor Cyan
Write-Host "Allowing inbound TCP from: $($subnets -join ', ')`n"

foreach ($rule in $rules) {
    $existing = Get-NetFirewallRule -DisplayName $rule.Name -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Host "  [SKIP] $($rule.Name) — already exists" -ForegroundColor Yellow
    } else {
        New-NetFirewallRule `
            -DisplayName $rule.Name `
            -Direction Inbound `
            -Protocol TCP `
            -LocalPort $rule.Port `
            -RemoteAddress $subnets `
            -Action Allow `
            -Profile Private,Domain `
            -Group "Grudge Studio" `
            -Description "Allow LAN + Radmin VPN access to Grudge backend service" | Out-Null
        Write-Host "  [OK]   $($rule.Name)" -ForegroundColor Green
    }
}

Write-Host "`n=== Done. Ports open for LAN access. ===" -ForegroundColor Cyan
Write-Host "Test from GrudgeYonko (LAN):    curl http://10.0.0.217:3003/health"
Write-Host "Test from GrudgeYonko (Radmin):  curl http://26.228.21.150:3003/health`n"
