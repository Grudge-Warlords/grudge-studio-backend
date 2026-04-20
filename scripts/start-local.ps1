# ═══════════════════════════════════════════════════════════════════════════════
# GRUDGE STUDIO — Local Account Infrastructure Startup
# Starts: MySQL, Redis, grudge-id, account-api, wallet-service
# Exposes: via Cloudflare Tunnel to id.grudge-studio.com, account.grudge-studio.com
# ═══════════════════════════════════════════════════════════════════════════════

$ErrorActionPreference = "Continue"
$BackendDir = "C:\Users\david\Desktop\grudge-studio-backend"

Write-Host "═══════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  GRUDGE STUDIO — Local Account Infrastructure" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# ── Step 1: Check prerequisites ──────────────────────────────────────
Write-Host "[1/4] Checking prerequisites..." -ForegroundColor Yellow

$dockerOk = $false
try { docker --version | Out-Null; $dockerOk = $true } catch {}
if (-not $dockerOk) {
    Write-Host "  ERROR: Docker not found. Install Docker Desktop first." -ForegroundColor Red
    exit 1
}
Write-Host "  Docker: OK" -ForegroundColor Green

$cfOk = $false
try { cloudflared --version | Out-Null; $cfOk = $true } catch {}
if (-not $cfOk) {
    Write-Host "  WARNING: cloudflared not found. Tunnel won't start." -ForegroundColor Yellow
    Write-Host "  Install: winget install Cloudflare.cloudflared" -ForegroundColor Yellow
} else {
    Write-Host "  cloudflared: OK" -ForegroundColor Green
}

# Check .env exists
if (-not (Test-Path "$BackendDir\.env")) {
    Write-Host "  ERROR: .env file not found at $BackendDir\.env" -ForegroundColor Red
    exit 1
}
Write-Host "  .env: OK" -ForegroundColor Green
Write-Host ""

# ── Step 2: Start Docker services ────────────────────────────────────
Write-Host "[2/4] Starting Docker services..." -ForegroundColor Yellow
docker compose -f "$BackendDir\docker-compose.local.yml" --env-file "$BackendDir\.env" up -d --build

if ($LASTEXITCODE -ne 0) {
    Write-Host "  ERROR: Docker compose failed." -ForegroundColor Red
    exit 1
}
Write-Host "  Services starting..." -ForegroundColor Green
Write-Host ""

# ── Step 3: Wait for health checks ──────────────────────────────────
Write-Host "[3/4] Waiting for services to be healthy..." -ForegroundColor Yellow
$maxWait = 120
$waited = 0

while ($waited -lt $maxWait) {
    $healthy = 0
    $services = @("grudge-mysql-local", "grudge-redis-local", "grudge-id-local", "account-api-local", "wallet-service-local")
    
    foreach ($svc in $services) {
        $status = docker inspect --format='{{.State.Health.Status}}' $svc 2>$null
        if ($status -eq "healthy") { $healthy++ }
    }
    
    if ($healthy -ge 3) {
        Write-Host "  $healthy/$($services.Count) services healthy" -ForegroundColor Green
        break
    }
    
    Start-Sleep -Seconds 5
    $waited += 5
    Write-Host "  Waiting... ($waited`s, $healthy healthy)" -ForegroundColor Gray
}

# Quick health probe
Write-Host ""
$endpoints = @(
    @{ Name = "grudge-id";    URL = "http://localhost:3001/health" },
    @{ Name = "account-api";  URL = "http://localhost:3005/health" },
    @{ Name = "wallet-service"; URL = "http://localhost:3002/health" }
)

foreach ($ep in $endpoints) {
    try {
        $r = Invoke-WebRequest -Uri $ep.URL -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop
        Write-Host "  $($ep.Name): $($r.StatusCode) OK" -ForegroundColor Green
    } catch {
        Write-Host "  $($ep.Name): DOWN" -ForegroundColor Red
    }
}
Write-Host ""

# ── Step 4: Start Cloudflare Tunnel ──────────────────────────────────
if ($cfOk) {
    Write-Host "[4/4] Starting Cloudflare Tunnel..." -ForegroundColor Yellow
    Write-Host "  Tunnel routes:" -ForegroundColor Gray
    Write-Host "    id.grudge-studio.com      -> localhost:3001" -ForegroundColor Gray
    Write-Host "    account.grudge-studio.com  -> localhost:3005" -ForegroundColor Gray
    Write-Host ""
    Write-Host "  NOTE: You must configure tunnel ingress rules in Cloudflare Zero Trust dashboard." -ForegroundColor Yellow
    Write-Host "  Go to: https://one.dash.cloudflare.com -> Networks -> Tunnels" -ForegroundColor Yellow
    Write-Host "  Create or edit a tunnel, add these public hostnames:" -ForegroundColor Yellow
    Write-Host "    id.grudge-studio.com      -> http://localhost:3001" -ForegroundColor Yellow
    Write-Host "    account.grudge-studio.com  -> http://localhost:3005" -ForegroundColor Yellow
    Write-Host ""
    
    # If tunnel token is set in .env, start cloudflared with it
    $tunnelToken = Select-String -Path "$BackendDir\.env" -Pattern "^CLOUDFLARE_TUNNEL_TOKEN=" | ForEach-Object {
        $_.Line -replace "^CLOUDFLARE_TUNNEL_TOKEN=", ""
    }
    
    if ($tunnelToken) {
        Write-Host "  Starting cloudflared with existing tunnel token..." -ForegroundColor Green
        Write-Host "  Press Ctrl+C to stop the tunnel (services keep running)." -ForegroundColor Gray
        Write-Host ""
        # Run in foreground so user can see logs and Ctrl+C to stop
        cloudflared tunnel run --token $tunnelToken
    } else {
        Write-Host "  No CLOUDFLARE_TUNNEL_TOKEN found in .env." -ForegroundColor Yellow
        Write-Host "  Create a tunnel at https://one.dash.cloudflare.com and add the token to .env" -ForegroundColor Yellow
    }
} else {
    Write-Host "[4/4] Skipping Cloudflare Tunnel (cloudflared not installed)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "═══════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  Local services running!" -ForegroundColor Green
Write-Host "  grudge-id:      http://localhost:3001" -ForegroundColor White
Write-Host "  account-api:    http://localhost:3005" -ForegroundColor White
Write-Host "  wallet-service: http://localhost:3002" -ForegroundColor White
Write-Host "  MySQL:          localhost:3306" -ForegroundColor White
Write-Host "  Redis:          localhost:6379" -ForegroundColor White
Write-Host "" 
Write-Host "  Stop: docker compose -f docker-compose.local.yml down" -ForegroundColor Gray
Write-Host "═══════════════════════════════════════════════" -ForegroundColor Cyan
