# ─────────────────────────────────────────────────────────────────────────────
# Grudge Studio — Publish Game Data to R2
#
# Validates JSON files, uploads to Cloudflare R2 via rclone, and flushes
# the game-api Redis cache so players get fresh data immediately.
#
# Usage:
#   .\scripts\publish-game-data.ps1 [-DataDir .\game-data] [-Category weapons]
#
# Prereqs:
#   - rclone installed and configured (config\rclone.conf with R2 remote)
#   - INTERNAL_API_KEY env var set (for cache flush)
# ─────────────────────────────────────────────────────────────────────────────
param(
    [string]$DataDir = "$PSScriptRoot\..\game-data",
    [string]$Category = "",          # empty = all categories
    [string]$R2Bucket = "grudge-assets",
    [string]$R2Prefix = "game-data/api/v1",
    [string]$GameApiUrl = "https://api.grudge-studio.com",
    [string]$RcloneConfig = "$PSScriptRoot\..\config\rclone.conf"
)

$ErrorActionPreference = "Stop"
$CATEGORIES = @("weapons", "armor", "materials", "consumables", "skills", "professions", "races", "classes", "factions", "attributes", "bosses", "enemies")

Write-Host "════════════════════════════════════════════════════" -ForegroundColor DarkYellow
Write-Host "  Grudge Studio — Publish Game Data" -ForegroundColor Yellow
Write-Host "════════════════════════════════════════════════════" -ForegroundColor DarkYellow

# ── 1. Determine which categories to publish ──────────────────────────────────
$toPublish = if ($Category) { @($Category) } else { $CATEGORIES }

# ── 2. Validate JSON files ────────────────────────────────────────────────────
Write-Host "`n▶ Validating JSON files..." -ForegroundColor Cyan
$errors = @()
foreach ($cat in $toPublish) {
    $file = Join-Path $DataDir "$cat.json"
    if (-not (Test-Path $file)) {
        Write-Host "  ⚠ $cat.json not found — skipping" -ForegroundColor Yellow
        continue
    }
    try {
        $json = Get-Content $file -Raw | ConvertFrom-Json
        $count = if ($json -is [array]) { $json.Count } else { ($json.PSObject.Properties | Measure-Object).Count }
        Write-Host "  ✅ $cat.json — $count entries" -ForegroundColor Green
    } catch {
        Write-Host "  ❌ $cat.json — INVALID JSON: $_" -ForegroundColor Red
        $errors += $cat
    }
}

if ($errors.Count -gt 0) {
    Write-Host "`n❌ Aborting — $($errors.Count) files have invalid JSON" -ForegroundColor Red
    exit 1
}

# ── 3. Upload to R2 via rclone ────────────────────────────────────────────────
Write-Host "`n▶ Uploading to R2 ($R2Bucket/$R2Prefix/)..." -ForegroundColor Cyan

if (-not (Get-Command rclone -ErrorAction SilentlyContinue)) {
    Write-Host "  ❌ rclone not found — install with: winget install Rclone.Rclone" -ForegroundColor Red
    exit 1
}

foreach ($cat in $toPublish) {
    $file = Join-Path $DataDir "$cat.json"
    if (-not (Test-Path $file)) { continue }

    $dest = "r2:$R2Bucket/$R2Prefix/$cat.json"
    if (Test-Path $RcloneConfig) {
        rclone copyto $file $dest --config $RcloneConfig --s3-no-check-bucket 2>&1
    } else {
        # Fallback: use env vars for R2 credentials
        $env:RCLONE_CONFIG_R2_TYPE = "s3"
        $env:RCLONE_CONFIG_R2_PROVIDER = "Cloudflare"
        $env:RCLONE_CONFIG_R2_ENDPOINT = "https://$($env:CF_ACCOUNT_ID).r2.cloudflarestorage.com"
        $env:RCLONE_CONFIG_R2_ACCESS_KEY_ID = $env:OBJECT_STORAGE_KEY
        $env:RCLONE_CONFIG_R2_SECRET_ACCESS_KEY = $env:OBJECT_STORAGE_SECRET
        $env:RCLONE_CONFIG_R2_REGION = "auto"
        rclone copyto $file $dest --s3-no-check-bucket 2>&1
    }

    if ($LASTEXITCODE -eq 0) {
        Write-Host "  ✅ $cat.json → R2" -ForegroundColor Green
    } else {
        Write-Host "  ❌ $cat.json upload failed" -ForegroundColor Red
    }
}

# ── 4. Flush Redis cache ─────────────────────────────────────────────────────
Write-Host "`n▶ Flushing game-data cache..." -ForegroundColor Cyan

$apiKey = $env:INTERNAL_API_KEY
if (-not $apiKey) {
    Write-Host "  ⚠ INTERNAL_API_KEY not set — skipping cache flush" -ForegroundColor Yellow
    Write-Host "    Caches will expire naturally in 5 minutes" -ForegroundColor DarkGray
} else {
    try {
        $resp = Invoke-RestMethod -Uri "$GameApiUrl/game-data/cache/flush" -Method POST -Headers @{ "x-internal-key" = $apiKey } -ErrorAction Stop
        Write-Host "  ✅ Cache flushed ($($resp.flushed) categories)" -ForegroundColor Green
    } catch {
        Write-Host "  ⚠ Cache flush failed: $_ — caches expire in 5min" -ForegroundColor Yellow
    }
}

Write-Host "`n════════════════════════════════════════════════════" -ForegroundColor DarkYellow
Write-Host "  Publish complete" -ForegroundColor Green
Write-Host "════════════════════════════════════════════════════" -ForegroundColor DarkYellow
