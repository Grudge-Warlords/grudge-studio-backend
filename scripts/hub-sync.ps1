# ═══════════════════════════════════════════════════════════════
# GRUDGE STUDIO — Hub Sync
# Pulls latest code and installs dependencies across all workspaces
# Usage: .\scripts\hub-sync.ps1
# ═══════════════════════════════════════════════════════════════

$GRUDGE_ROOT = "D:\GrudgeLink\OneDrive\Desktop\grudge-studio-backend"

Write-Host "`n=== GRUDGE STUDIO SYNC ===" -ForegroundColor Cyan

# ─── GIT STATUS ────────────────────────────────────────────────
Write-Host "`n  [GIT] Checking status..." -ForegroundColor Yellow
$status = git -C $GRUDGE_ROOT status --porcelain
if ($status) {
    Write-Host "  WARNING: You have uncommitted changes:" -ForegroundColor Red
    $status | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
    $confirm = Read-Host "  Continue with pull? (y/n)"
    if ($confirm -ne "y") {
        Write-Host "  Aborted." -ForegroundColor Yellow
        return
    }
}

# ─── GIT PULL ──────────────────────────────────────────────────
Write-Host "`n  [GIT] Pulling latest from main..." -ForegroundColor Yellow
git -C $GRUDGE_ROOT pull origin main
if ($LASTEXITCODE -ne 0) {
    Write-Host "  Git pull failed. Resolve conflicts and retry." -ForegroundColor Red
    return
}

# ─── NPM INSTALL ──────────────────────────────────────────────
Write-Host "`n  [NPM] Installing dependencies (all workspaces)..." -ForegroundColor Yellow
npm install --prefix $GRUDGE_ROOT --workspaces --include-workspace-root
if ($LASTEXITCODE -ne 0) {
    Write-Host "  npm install failed." -ForegroundColor Red
    return
}

# ─── SERVICE SUMMARY ──────────────────────────────────────────
Write-Host "`n  [SERVICES] Workspace status:" -ForegroundColor Yellow
$workspaces = @(
    "services\grudge-id",
    "services\wallet-service",
    "services\game-api",
    "services\ai-agent",
    "services\account-api",
    "services\launcher-api"
)
foreach ($ws in $workspaces) {
    $pkgPath = Join-Path $GRUDGE_ROOT "$ws\package.json"
    if (Test-Path $pkgPath) {
        $pkg = Get-Content $pkgPath | ConvertFrom-Json
        $hasNodeModules = Test-Path (Join-Path $GRUDGE_ROOT "$ws\node_modules")
        $icon = if ($hasNodeModules) { "[OK]" } else { "[!!]" }
        $color = if ($hasNodeModules) { "Green" } else { "Red" }
        Write-Host "    $icon $($pkg.name) v$($pkg.version)" -ForegroundColor $color
    } else {
        Write-Host "    [??] $ws — no package.json" -ForegroundColor DarkGray
    }
}

Write-Host "`n  Sync complete at $(Get-Date -Format 'HH:mm:ss')" -ForegroundColor Green
Write-Host ""
