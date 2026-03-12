# ═══════════════════════════════════════════════════════════════
# GRUDGE STUDIO — Hub Deploy
# Usage: .\scripts\hub-deploy.ps1 -Service game-api
#        .\scripts\hub-deploy.ps1 -Service all
#        .\scripts\hub-deploy.ps1 -Worker dashboard
# ═══════════════════════════════════════════════════════════════

param(
    [ValidateSet("grudge-id","wallet-service","game-api","ai-agent","account-api","launcher-api","ws-service","all")]
    [string]$Service,

    [ValidateSet("site","dashboard","r2-cdn")]
    [string]$Worker,

    [switch]$NoPush,
    [switch]$DryRun
)

$GRUDGE_ROOT = "D:\GrudgeLink\OneDrive\Desktop\grudge-studio-backend"
$VPS_IP = "74.208.155.229"
$VPS_PATH = "/opt/grudge-studio-backend"

if (-not $Service -and -not $Worker) {
    Write-Host "Usage:" -ForegroundColor Cyan
    Write-Host "  .\hub-deploy.ps1 -Service game-api     # Deploy a Docker service"
    Write-Host "  .\hub-deploy.ps1 -Service all           # Deploy all services"
    Write-Host "  .\hub-deploy.ps1 -Worker dashboard      # Deploy a CF worker"
    Write-Host "  .\hub-deploy.ps1 -Service game-api -NoPush  # Skip git push"
    Write-Host "  .\hub-deploy.ps1 -Service game-api -DryRun  # Show commands only"
    return
}

function Run-Step {
    param([string]$Label, [string]$Command, [switch]$IsRemote)
    Write-Host "  [$Label]" -ForegroundColor Yellow -NoNewline

    if ($DryRun) {
        Write-Host " (dry-run) $Command" -ForegroundColor DarkGray
        return
    }

    Write-Host " $Command" -ForegroundColor DarkGray
    if ($IsRemote) {
        ssh root@$VPS_IP $Command
    } else {
        Invoke-Expression $Command
    }

    if ($LASTEXITCODE -ne 0) {
        Write-Host "  FAILED at step: $Label" -ForegroundColor Red
        return
    }
}

# ─── DEPLOY DOCKER SERVICE ─────────────────────────────────────
if ($Service) {
    Write-Host "`n=== DEPLOYING SERVICE: $Service ===" -ForegroundColor Cyan
    $timestamp = Get-Date -Format "HH:mm:ss"
    Write-Host "  Started: $timestamp" -ForegroundColor DarkGray

    # Step 1: Git push
    if (-not $NoPush) {
        Run-Step -Label "GIT PUSH" -Command "git -C `"$GRUDGE_ROOT`" push origin main"
    }

    # Step 2: Pull on VPS
    Run-Step -Label "GIT PULL" -Command "cd $VPS_PATH && git pull" -IsRemote

    if ($Service -eq "all") {
        # Full rebuild
        Run-Step -Label "BUILD ALL" -Command "cd $VPS_PATH && docker compose build" -IsRemote
        Run-Step -Label "RESTART ALL" -Command "cd $VPS_PATH && docker compose up -d" -IsRemote
    } else {
        # Single service
        Run-Step -Label "BUILD" -Command "cd $VPS_PATH && docker compose build $Service" -IsRemote
        Run-Step -Label "RESTART" -Command "cd $VPS_PATH && docker compose up -d $Service" -IsRemote
    }

    # Step 3: Verify
    Run-Step -Label "VERIFY" -Command "cd $VPS_PATH && docker compose ps $Service" -IsRemote

    Write-Host "`n  Deploy complete at $(Get-Date -Format 'HH:mm:ss')" -ForegroundColor Green
}

# ─── DEPLOY CLOUDFLARE WORKER ──────────────────────────────────
if ($Worker) {
    $configPath = "$GRUDGE_ROOT\cloudflare\workers\$Worker\wrangler.toml"

    Write-Host "`n=== DEPLOYING WORKER: $Worker ===" -ForegroundColor Cyan

    if (-not (Test-Path $configPath)) {
        Write-Host "  ERROR: wrangler.toml not found at $configPath" -ForegroundColor Red
        return
    }

    if ($DryRun) {
        Write-Host "  (dry-run) npx wrangler deploy --config `"$configPath`"" -ForegroundColor DarkGray
    } else {
        npx wrangler deploy --config $configPath
    }

    Write-Host "`n  Worker deploy complete." -ForegroundColor Green
}
