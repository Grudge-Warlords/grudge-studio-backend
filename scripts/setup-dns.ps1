#!/usr/bin/env pwsh
# ─────────────────────────────────────────────────────────────────────────────
# Grudge Studio — Cloudflare DNS Setup
# Adds all required DNS records for grudge-studio.com
#
# Usage:
#   .\scripts\setup-dns.ps1 -Token YOUR_CF_API_TOKEN
#
# Get your token:
#   https://dash.cloudflare.com/profile/api-tokens
#   → Create Token → Edit zone DNS (or use Global API Key)
# ─────────────────────────────────────────────────────────────────────────────
param(
  [Parameter(Mandatory=$true)]
  [string]$Token
)

$ZONE_ID  = "e8c0c2ee3063f24eb31affddabf9730a"
$VPS_IP   = "74.208.155.229"
$HEADERS  = @{
  "Authorization" = "Bearer $Token"
  "Content-Type"  = "application/json"
}
$BASE     = "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records"

# ── DNS records to create ────────────────────────────────────────────────────
# proxied = true  → traffic goes through Cloudflare (DDoS, TLS, caching)
# proxied = false → DNS only (bypass Cloudflare)
$records = @(
  # VPS backend services — all proxied through Cloudflare
  @{ type="A"; name="id";         content=$VPS_IP; proxied=$true;  comment="Grudge Identity API" },
  @{ type="A"; name="api";        content=$VPS_IP; proxied=$true;  comment="Grudge Game API" },
  @{ type="A"; name="account";    content=$VPS_IP; proxied=$true;  comment="Grudge Account API" },
  @{ type="A"; name="launcher";   content=$VPS_IP; proxied=$true;  comment="Grudge Launcher API" },
  @{ type="A"; name="ws";         content=$VPS_IP; proxied=$true;  comment="Grudge WebSocket (game server)" },
  @{ type="A"; name="assets-api"; content=$VPS_IP; proxied=$true;  comment="Grudge Asset Service" },
  @{ type="A"; name="bridge";     content=$VPS_IP; proxied=$true;  comment="Grudge Bridge (backup/deploy/mesh)" },
  @{ type="A"; name="status";     content=$VPS_IP; proxied=$true;  comment="Uptime Kuma status dashboard" },

  # Cloudflare Workers — CNAME to workers.dev (proxied so route triggers)
  @{ type="CNAME"; name="dash";   content="grudge-dashboard.grudge.workers.dev"; proxied=$true;  comment="Backend dashboard Worker" },

  # Root domain → grudgewarlords.com redirect placeholder
  @{ type="A"; name="@";         content=$VPS_IP; proxied=$true;  comment="Root domain" },
  @{ type="CNAME"; name="www";   content="grudge-studio.com";     proxied=$true;  comment="www redirect" }
)

Write-Host "`n⚔  Grudge Studio — Cloudflare DNS Setup`n" -ForegroundColor Yellow
Write-Host "Zone: grudge-studio.com  ($ZONE_ID)`n"

# ── Fetch existing records to avoid duplicates ────────────────────────────────
$existing = Invoke-RestMethod -Uri "$BASE`?per_page=100" -Headers $HEADERS
$existingNames = $existing.result | ForEach-Object { "$($_.type):$($_.name)" }

$created  = 0
$skipped  = 0
$failed   = 0

foreach ($rec in $records) {
  $fullName = if ($rec.name -eq "@") { "grudge-studio.com" } else { "$($rec.name).grudge-studio.com" }
  $key      = "$($rec.type):$fullName"

  if ($existingNames -contains $key) {
    Write-Host "  SKIP   $($rec.type.PadRight(5)) $fullName  (already exists)" -ForegroundColor DarkGray
    $skipped++
    continue
  }

  $body = @{
    type    = $rec.type
    name    = $rec.name
    content = $rec.content
    proxied = $rec.proxied
    ttl     = 1  # 1 = Auto (required when proxied=true)
    comment = $rec.comment
  } | ConvertTo-Json

  try {
    $resp = Invoke-RestMethod -Uri $BASE -Method POST -Headers $HEADERS -Body $body
    if ($resp.success) {
      $proxy = if ($rec.proxied) { "[proxied]" } else { "[dns-only]" }
      Write-Host "  CREATE $($rec.type.PadRight(5)) $fullName → $($rec.content)  $proxy" -ForegroundColor Green
      $created++
    } else {
      Write-Host "  ERROR  $fullName — $($resp.errors | ConvertTo-Json -Compress)" -ForegroundColor Red
      $failed++
    }
  } catch {
    Write-Host "  ERROR  $fullName — $($_.Exception.Message)" -ForegroundColor Red
    $failed++
  }
}

Write-Host "`n─────────────────────────────────────────────────────────"
Write-Host "  Created : $created" -ForegroundColor Green
Write-Host "  Skipped : $skipped" -ForegroundColor DarkGray
if ($failed -gt 0) {
  Write-Host "  Failed  : $failed" -ForegroundColor Red
}
Write-Host "`nNext steps:" -ForegroundColor Yellow
Write-Host "  1. Turn OFF Development Mode when testing is done"
Write-Host "  2. Set DASH_API_KEY secret:  cd cloudflare/workers/dashboard && npx wrangler secret put DASH_API_KEY"
Write-Host "  3. Restart VPS: ssh root@74.208.155.229 'docker compose -f /opt/grudge-studio-backend/docker-compose.yml up -d --force-recreate'"
Write-Host "  4. Update Discord OAuth redirect URI to https://id.grudge-studio.com/auth/discord/callback"
Write-Host "  5. Add CF_TURNSTILE keys when ready (dash.cloudflare.com → Turnstile)"
Write-Host ""
