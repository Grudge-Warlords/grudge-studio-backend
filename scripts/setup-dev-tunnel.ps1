<#
.SYNOPSIS
    Configures Cloudflare dev subdomains to route through the local tunnel
    to DESKTOP-AA5O5QR's Grudge backend services.

.DESCRIPTION
    1. Creates CNAME DNS records for dev-api, dev-id, dev-ws in grudge-studio.com
    2. Prints instructions for adding tunnel ingress rules in Zero Trust dashboard

.USAGE
    # Set your Cloudflare API token first:
    $env:CF_API_TOKEN = "your-cloudflare-api-token"
    powershell -ExecutionPolicy Bypass -File setup-dev-tunnel.ps1

.NOTES
    Tunnel is remotely-managed (token-based) so ingress rules must be
    configured in the Cloudflare Zero Trust dashboard after DNS is set up.
#>

$ErrorActionPreference = "Stop"

# ── Configuration ──────────────────────────────────────────
$CF_ZONE_ID    = "e8c0c2ee3063f24eb31affddabf9730a"  # grudge-studio.com
$CF_ACCOUNT_ID = "ee475864561b02d4588180b8b9acf694"
$TUNNEL_ID     = "efb308d2-e308-4072-ab70-c068f70ab5c7"  # from tunnel token
$TUNNEL_CNAME  = "$TUNNEL_ID.cfargotunnel.com"

# Dev subdomains to create
$devRecords = @(
    @{ Name = "dev-api"; Comment = "Dev → Game API via local tunnel" },
    @{ Name = "dev-id";  Comment = "Dev → Grudge ID via local tunnel" },
    @{ Name = "dev-ws";  Comment = "Dev → WebSocket via local tunnel" },
    @{ Name = "dev-account"; Comment = "Dev → Account API via local tunnel" }
)

# ── Validate API Token ────────────────────────────────────
if (-not $env:CF_API_TOKEN) {
    Write-Host "`n[ERROR] CF_API_TOKEN not set." -ForegroundColor Red
    Write-Host "Get one from: https://dash.cloudflare.com/profile/api-tokens"
    Write-Host 'Set it:  $env:CF_API_TOKEN = "your-token-here"'
    Write-Host ""
    exit 1
}

$headers = @{
    "Authorization" = "Bearer $env:CF_API_TOKEN"
    "Content-Type"  = "application/json"
}

Write-Host "`n=== Grudge Studio — Dev Tunnel Setup ===" -ForegroundColor Cyan
Write-Host "Zone:   grudge-studio.com ($CF_ZONE_ID)"
Write-Host "Tunnel: $TUNNEL_ID"
Write-Host ""

# ── Step 1: Create DNS CNAME Records ─────────────────────
Write-Host "── Step 1: DNS Records ──" -ForegroundColor Yellow

foreach ($rec in $devRecords) {
    $fqdn = "$($rec.Name).grudge-studio.com"
    Write-Host "  Creating $fqdn → $TUNNEL_CNAME ..." -NoNewline

    $body = @{
        type    = "CNAME"
        name    = $rec.Name
        content = $TUNNEL_CNAME
        proxied = $true
        comment = $rec.Comment
    } | ConvertTo-Json

    try {
        $resp = Invoke-RestMethod `
            -Uri "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/dns_records" `
            -Method POST `
            -Headers $headers `
            -Body $body

        if ($resp.success) {
            Write-Host " OK" -ForegroundColor Green
        } else {
            Write-Host " FAILED: $($resp.errors | ConvertTo-Json -Compress)" -ForegroundColor Red
        }
    } catch {
        $err = $_.ErrorDetails.Message | ConvertFrom-Json -ErrorAction SilentlyContinue
        if ($err.errors[0].code -eq 81057) {
            Write-Host " ALREADY EXISTS" -ForegroundColor Yellow
        } else {
            Write-Host " ERROR: $($_.Exception.Message)" -ForegroundColor Red
        }
    }
}

# ── Step 2: Print Tunnel Ingress Config ───────────────────
Write-Host "`n── Step 2: Tunnel Ingress Rules ──" -ForegroundColor Yellow
Write-Host @"

Since this tunnel is remotely-managed (token-based), add these
ingress rules in the Cloudflare Zero Trust dashboard:

  1. Go to: https://one.dash.cloudflare.com/$CF_ACCOUNT_ID/networks/tunnels/$TUNNEL_ID
  2. Click "Configure" → "Public Hostname" tab
  3. Add these routes:

  ┌────────────────────────────────────┬─────────────────────────────────────┐
  │ Public Hostname                    │ Service (use Radmin or LAN IP)      │
  ├────────────────────────────────────┼─────────────────────────────────────┤
  │ dev-api.grudge-studio.com          │ http://26.228.21.150:3003           │
  │ dev-id.grudge-studio.com           │ http://26.228.21.150:3001           │
  │ dev-ws.grudge-studio.com           │ http://26.228.21.150:3007           │
  │ dev-account.grudge-studio.com      │ http://26.228.21.150:3005           │
  └────────────────────────────────────┴─────────────────────────────────────┘
  (LAN alternative: replace 26.228.21.150 with 10.0.0.217)

  For dev-ws, also enable WebSocket under "Additional Settings"

"@ -ForegroundColor White

Write-Host "=== Done ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "After configuring tunnel routes, test with:"
Write-Host "  curl https://dev-api.grudge-studio.com/health"
Write-Host "  curl https://dev-id.grudge-studio.com/health"
Write-Host ""
