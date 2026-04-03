# ═══════════════════════════════════════════════════════════════════════
# Grudge Studio — Windows Firewall: Lock Bridge Port 4000
#
# Port 4000 (grudge-bridge) must ONLY be accessible from:
#   - Radmin VPN range: 26.0.0.0/8   (encrypted VPN overlay)
#   - ZeroTier range:   10.147.17.0/24 (fallback VPN)
#   - Localhost:        127.0.0.1 (local health checks)
#
# The bridge uses Bearer token auth, but without this firewall rule
# the port is still exposed to the public internet — anyone can hit it.
#
# Run AS ADMINISTRATOR on the Windows VPS.
# ═══════════════════════════════════════════════════════════════════════

#Requires -RunAsAdministrator

$RULE_NAME_ALLOW = "GrudgeBridge-Allow-VPN"
$RULE_NAME_BLOCK = "GrudgeBridge-Block-Public"
$BRIDGE_PORT     = 4000

Write-Host "═══ Grudge Bridge — Firewall Hardening ═══" -ForegroundColor Cyan
Write-Host ""

# ── Remove old rules if they exist ────────────────────────────────────
Remove-NetFirewallRule -DisplayName $RULE_NAME_ALLOW -ErrorAction SilentlyContinue
Remove-NetFirewallRule -DisplayName $RULE_NAME_BLOCK -ErrorAction SilentlyContinue
Write-Host "✓ Cleaned up old rules" -ForegroundColor Green

# ── Rule 1: ALLOW port 4000 from VPN ranges + localhost ───────────────
# Radmin VPN uses the 26.0.0.0/8 space.
# ZeroTier uses a configurable range — update if your ZeroTier network differs.
New-NetFirewallRule `
    -DisplayName  $RULE_NAME_ALLOW `
    -Description  "Grudge Bridge: allow TCP 4000 only from Radmin VPN and ZeroTier" `
    -Direction    Inbound `
    -Protocol     TCP `
    -LocalPort    $BRIDGE_PORT `
    -RemoteAddress @(
        "26.0.0.0/8",        # Radmin VPN full range
        "10.147.17.0/24",    # ZeroTier (update to your network range)
        "127.0.0.1"          # Localhost (health checks, cron)
    ) `
    -Action       Allow `
    -Profile      Any `
    -Enabled      True | Out-Null

Write-Host "✓ ALLOW rule created — port $BRIDGE_PORT from Radmin/ZeroTier/localhost" -ForegroundColor Green

# ── Rule 2: BLOCK everything else on port 4000 ────────────────────────
New-NetFirewallRule `
    -DisplayName  $RULE_NAME_BLOCK `
    -Description  "Grudge Bridge: block all other inbound on TCP 4000" `
    -Direction    Inbound `
    -Protocol     TCP `
    -LocalPort    $BRIDGE_PORT `
    -RemoteAddress Any `
    -Action       Block `
    -Profile      Any `
    -Enabled      True | Out-Null

Write-Host "✓ BLOCK rule created — all other inbound on port $BRIDGE_PORT" -ForegroundColor Green
Write-Host ""

# Windows processes firewall rules in priority order: Allow wins over Block
# when the source IP matches the Allow rule's RemoteAddress.
# So: Radmin/ZeroTier → allowed; everyone else → blocked.

# ── Verify rules are active ────────────────────────────────────────────
Write-Host "Active rules for port $BRIDGE_PORT :" -ForegroundColor Yellow
Get-NetFirewallRule | Where-Object { $_.DisplayName -like "GrudgeBridge*" } | ForEach-Object {
    $filter = $_ | Get-NetFirewallPortFilter -ErrorAction SilentlyContinue
    $addrFilter = $_ | Get-NetFirewallAddressFilter -ErrorAction SilentlyContinue
    Write-Host "  $($_.DisplayName): $($_.Action) — Remote: $($addrFilter.RemoteAddress -join ', ')"
}

Write-Host ""
Write-Host "═══ ✅ Firewall hardened ═══" -ForegroundColor Green
Write-Host "  Bridge port 4000 is now only reachable from Radmin VPN + ZeroTier"
Write-Host "  Test from Linux VPS: curl http://26.228.21.150:4000/api/bridge/health"
Write-Host ""
Write-Host "  To verify block works, try from a non-VPN machine:"
Write-Host "  curl http://<windows-public-ip>:4000/api/bridge/health  (should time out)"
Write-Host ""
Write-Host "  If you need to update ZeroTier range:"
Write-Host "  Remove-NetFirewallRule -DisplayName '$RULE_NAME_ALLOW'"
Write-Host "  Then re-run this script with updated 10.x.x.x/24 range"
