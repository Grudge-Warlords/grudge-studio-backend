# ═══════════════════════════════════════════════════════════════════════
# Grudge Studio — Windows Bridge Service Installer
#
# Installs grudge-bridge as a permanent Windows Service via NSSM so it
# survives reboots and restarts automatically on crash.
#
# Run AS ADMINISTRATOR on the Windows VPS (DESKTOP-AA5O5QR / 26.228.21.150)
#
# Usage:
#   Set-ExecutionPolicy RemoteSigned -Scope Process
#   .\scripts\windows\install-bridge-service.ps1
#
# Requirements:
#   - Node.js 18+ installed (https://nodejs.org)
#   - NSSM downloaded or auto-downloaded by this script
#   - Radmin VPN running and connected to Linux VPS (26.228.21.150)
#   - Edit the CONFIGURATION section below before running
# ═══════════════════════════════════════════════════════════════════════

#Requires -RunAsAdministrator

# ── CONFIGURATION — Edit these before running ─────────────────────────
$BRIDGE_DIR      = "C:\grudge-bridge"           # Where to clone/put bridge code
$NODE_EXE        = "C:\Program Files\nodejs\node.exe"  # Path to node.exe
$SERVICE_NAME    = "GrudgeBridge"
$LOG_DIR         = "C:\grudge-bridge\logs"

# ── Bridge environment variables ─────────────────────────────────────
# NODE_ROLE must be "replica" on the Windows VPS
$env_vars = @{
    NODE_ENV         = "production"
    PORT             = "4000"
    NODE_ROLE        = "replica"
    NODE_NAME        = "windows-vps"
    # Linux VPS is the primary — Radmin IP preferred, public IP fallback
    # Format: "radmin:26.x.x.x|pub:74.208.155.229:4000"
    PEER_NODES       = "radmin:26.228.21.150|pub:74.208.155.229:4000"
    # ⚠ Fill these in — copy from Linux VPS .env
    BRIDGE_API_KEY   = "REPLACE_WITH_BRIDGE_API_KEY"
    MYSQL_HOST       = "localhost"       # Local MySQL if you have one, or Linux VPS IP
    MYSQL_PORT       = "3306"
    MYSQL_DATABASE   = "grudge_game"
    MYSQL_USER       = "grudge_admin"
    MYSQL_PASSWORD   = "REPLACE_WITH_DB_PASS"
    MYSQL_CONTAINER  = ""               # Empty on Windows — no Docker exec
    R2_ENDPOINT      = "REPLACE_WITH_R2_ENDPOINT"
    R2_BUCKET        = "grudge-assets"
    R2_KEY           = "REPLACE_WITH_R2_KEY"
    R2_SECRET        = "REPLACE_WITH_R2_SECRET"
    VALIDATOR_ENABLED = "false"         # Disable validator on replica (primary runs it)
    LEGION_ENABLED   = "true"
    GRD17_HMAC_SECRET = "REPLACE_WITH_HMAC_SECRET"
    GEMINI_API_KEY   = "REPLACE_WITH_GEMINI_KEY"
    COMPOSE_DIR      = $BRIDGE_DIR
    DISCORD_WEBHOOK_URL = "REPLACE_WITH_DISCORD_WEBHOOK"
}

# ═══════════════════════════════════════════════════════════════════════
# Script body — no changes needed below
# ═══════════════════════════════════════════════════════════════════════

Write-Host "═══ Grudge Bridge — Windows Service Installer ═══" -ForegroundColor Cyan
Write-Host ""

# ── 1. Validate Node.js ──────────────────────────────────────────────
if (-not (Test-Path $NODE_EXE)) {
    Write-Error "Node.js not found at $NODE_EXE — install from https://nodejs.org"
    exit 1
}
$nodeVersion = & $NODE_EXE --version
Write-Host "✓ Node.js $nodeVersion found" -ForegroundColor Green

# ── 2. Install/find NSSM ─────────────────────────────────────────────
$nssmPath = "C:\Tools\nssm\nssm.exe"
if (-not (Test-Path $nssmPath)) {
    Write-Host "Downloading NSSM..." -ForegroundColor Yellow
    $nssmDir = "C:\Tools\nssm"
    New-Item -ItemType Directory -Force -Path $nssmDir | Out-Null
    $nssmZip = "$env:TEMP\nssm.zip"
    Invoke-WebRequest -Uri "https://nssm.cc/release/nssm-2.24.zip" -OutFile $nssmZip
    Expand-Archive -Path $nssmZip -DestinationPath $nssmDir -Force
    # Move the 64-bit binary up
    Move-Item "$nssmDir\nssm-2.24\win64\nssm.exe" "$nssmDir\nssm.exe" -Force
    Remove-Item "$nssmDir\nssm-2.24" -Recurse -Force
    Remove-Item $nssmZip
    Write-Host "✓ NSSM installed at $nssmPath" -ForegroundColor Green
} else {
    Write-Host "✓ NSSM found at $nssmPath" -ForegroundColor Green
}

# ── 3. Ensure bridge code exists ─────────────────────────────────────
if (-not (Test-Path "$BRIDGE_DIR\dist\index.js")) {
    Write-Error "Bridge dist not found at $BRIDGE_DIR\dist\index.js"
    Write-Host "  Clone and build the bridge first:"
    Write-Host "  git clone https://github.com/Grudge-Warlords/grudge-studio-backend $BRIDGE_DIR"
    Write-Host "  cd $BRIDGE_DIR\services\grudge-bridge && npm install && npm run build"
    exit 1
}

# ── 4. Create log directory ───────────────────────────────────────────
New-Item -ItemType Directory -Force -Path $LOG_DIR | Out-Null
Write-Host "✓ Log directory: $LOG_DIR" -ForegroundColor Green

# ── 5. Remove existing service if present ────────────────────────────
$existing = Get-Service -Name $SERVICE_NAME -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Removing existing $SERVICE_NAME service..." -ForegroundColor Yellow
    & $nssmPath stop $SERVICE_NAME 2>$null
    & $nssmPath remove $SERVICE_NAME confirm
    Start-Sleep 2
}

# ── 6. Install service ────────────────────────────────────────────────
Write-Host "Installing $SERVICE_NAME service..." -ForegroundColor Yellow

$bridgeScript = "$BRIDGE_DIR\services\grudge-bridge\dist\index.js"
& $nssmPath install $SERVICE_NAME $NODE_EXE $bridgeScript
& $nssmPath set $SERVICE_NAME AppDirectory "$BRIDGE_DIR\services\grudge-bridge"
& $nssmPath set $SERVICE_NAME DisplayName "Grudge Bridge (replica)"
& $nssmPath set $SERVICE_NAME Description "Grudge Studio 3-node bridge replica — inter-node comms, heartbeat, legion"
& $nssmPath set $SERVICE_NAME Start SERVICE_AUTO_START

# ── 7. Set environment variables ─────────────────────────────────────
Write-Host "Setting environment variables..." -ForegroundColor Yellow
foreach ($kv in $env_vars.GetEnumerator()) {
    & $nssmPath set $SERVICE_NAME AppEnvironmentExtra "$($kv.Key)=$($kv.Value)"
}

# ── 8. Configure logging ──────────────────────────────────────────────
& $nssmPath set $SERVICE_NAME AppStdout "$LOG_DIR\bridge-stdout.log"
& $nssmPath set $SERVICE_NAME AppStderr "$LOG_DIR\bridge-stderr.log"
& $nssmPath set $SERVICE_NAME AppRotateFiles 1
& $nssmPath set $SERVICE_NAME AppRotateSeconds 86400     # Rotate daily
& $nssmPath set $SERVICE_NAME AppRotateBytes 10485760    # 10MB max

# ── 9. Restart on failure ─────────────────────────────────────────────
& $nssmPath set $SERVICE_NAME AppExit Default Restart
& $nssmPath set $SERVICE_NAME AppRestartDelay 5000       # 5s before restart

# ── 10. Start the service ─────────────────────────────────────────────
Write-Host "Starting $SERVICE_NAME..." -ForegroundColor Yellow
& $nssmPath start $SERVICE_NAME
Start-Sleep 3

$svc = Get-Service -Name $SERVICE_NAME -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -eq "Running") {
    Write-Host "" 
    Write-Host "═══ ✅ GrudgeBridge service installed and running! ═══" -ForegroundColor Green
    Write-Host "  Health: http://localhost:4000/api/bridge/health"
    Write-Host "  Logs:   $LOG_DIR"
    Write-Host "  Manage: nssm edit GrudgeBridge"
    Write-Host ""
    Write-Host "  Next: verify Radmin VPN is connected to Linux VPS (26.228.21.150)"
    Write-Host "  Then: check Linux VPS bridge logs for heartbeat from windows-vps"
} else {
    Write-Error "Service failed to start. Check logs at $LOG_DIR"
    Write-Host "  Debug: & '$nssmPath' status $SERVICE_NAME"
    exit 1
}
