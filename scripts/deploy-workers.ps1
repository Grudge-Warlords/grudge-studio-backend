#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Grudge Studio — Cloudflare Workers deploy + local dev script (Windows)

.DESCRIPTION
  Deploys all Cloudflare Workers to production, or runs them locally for dev.
  Workers live in: cloudflare/workers/<name>/

  Required env vars (set before running):
    $env:CLOUDFLARE_API_TOKEN  — Token with permissions:
        Account > Workers Scripts > Edit
        Account > Workers KV Storage > Edit
        Account > D1 > Edit
        Zone > Workers Routes > Edit
    (Get one at: https://dash.cloudflare.com/profile/api-tokens)

.EXAMPLES
  # Deploy all workers to production:
  $env:CLOUDFLARE_API_TOKEN="cfxxx" ; .\scripts\deploy-workers.ps1 -Mode deploy

  # Run ai-hub locally (Miniflare simulation, no token needed):
  .\scripts\deploy-workers.ps1 -Mode dev -Worker ai-hub

  # Set secret on deployed worker:
  $env:CLOUDFLARE_API_TOKEN="cfxxx" ; .\scripts\deploy-workers.ps1 -Mode secret -Worker ai-hub -Secret VPS_INTERNAL_KEY
#>

param(
  [ValidateSet("deploy","dev","secret","status")]
  [string]$Mode = "deploy",

  [ValidateSet("ai-hub","dashboard","auth-gateway","health-ping","r2-cdn","site","all")]
  [string]$Worker = "all",

  [string]$Secret = ""
)

$WORKERS_DIR = "$PSScriptRoot\..\cloudflare\workers"
$ACCOUNT_ID  = "ee475864561b02d4588180b8b9acf694"

# ── Worker definitions ────────────────────────────────────────────────────────
$WORKERS = @(
  @{ name="ai-hub";       route="ai.grudge-studio.com";      secrets=@("VPS_INTERNAL_KEY") },
  @{ name="dashboard";    route="dash.grudge-studio.com";    secrets=@("VPS_INTERNAL_KEY","ADMIN_API_KEY") },
  @{ name="auth-gateway"; route="auth.grudge-studio.com";   secrets=@("JWT_SECRET") },
  @{ name="health-ping";  route="";                          secrets=@() },
  @{ name="r2-cdn";       route="assets.grudge-studio.com"; secrets=@("R2_SECRET") },
  @{ name="site";         route="grudge-studio.com";         secrets=@() }
)

function Write-Step { param([string]$msg) Write-Host "`n  >> $msg" -ForegroundColor Cyan }
function Write-Ok   { param([string]$msg) Write-Host "  ✓  $msg" -ForegroundColor Green }
function Write-Err  { param([string]$msg) Write-Host "  ✗  $msg" -ForegroundColor Red }

# ── Require wrangler ──────────────────────────────────────────────────────────
$wrangler = Get-Command "wrangler" -ErrorAction SilentlyContinue
if (-not $wrangler) {
  $wrangler = Get-Command "npx" -ErrorAction SilentlyContinue
  if (-not $wrangler) {
    Write-Err "wrangler / npx not found. Run: npm install -g wrangler"
    exit 1
  }
  function Invoke-Wrangler { npx wrangler @args }
} else {
  function Invoke-Wrangler { wrangler @args }
}

# ── Status mode ───────────────────────────────────────────────────────────────
if ($Mode -eq "status") {
  Write-Host "`n Cloudflare Workers — DNS routing map" -ForegroundColor White
  Write-Host " ─────────────────────────────────────" -ForegroundColor DarkGray
  foreach ($w in $WORKERS) {
    $route = if ($w.route) { $w.route } else { "(workers.dev only)" }
    Write-Host "  $($w.name.PadRight(16)) → $route"
  }
  Write-Host ""
  exit 0
}

# ── Require token for deploy/secret ──────────────────────────────────────────
if ($Mode -in @("deploy","secret") -and -not $env:CLOUDFLARE_API_TOKEN) {
  Write-Err "CLOUDFLARE_API_TOKEN is not set."
  Write-Host "  Get one at: https://dash.cloudflare.com/profile/api-tokens"
  Write-Host "  Required permissions:"
  Write-Host "    Account > Workers Scripts > Edit"
  Write-Host "    Account > Workers KV Storage > Edit"
  Write-Host "    Account > D1 > Edit"
  Write-Host "    Zone > Workers Routes > Edit"
  exit 1
}

# ── Filter workers ────────────────────────────────────────────────────────────
$targets = if ($Worker -eq "all") { $WORKERS } else { $WORKERS | Where-Object { $_.name -eq $Worker } }
if (-not $targets) { Write-Err "Worker '$Worker' not found."; exit 1 }

# ── Deploy mode ───────────────────────────────────────────────────────────────
if ($Mode -eq "deploy") {
  Write-Host "`n Grudge Studio — Cloudflare Workers Deploy" -ForegroundColor White
  Write-Host " Account: $ACCOUNT_ID" -ForegroundColor DarkGray

  foreach ($w in $targets) {
    $dir = Join-Path $WORKERS_DIR $w.name
    if (-not (Test-Path $dir)) { Write-Err "$($w.name): directory not found at $dir"; continue }

    Write-Step "Deploying $($w.name) → $($w.route)"
    Push-Location $dir
    try {
      npx wrangler deploy
      if ($LASTEXITCODE -eq 0) {
        Write-Ok "$($w.name) deployed"
        # Remind about secrets
        if ($w.secrets.Count -gt 0) {
          Write-Host "  ⚠  Remember to set secrets:" -ForegroundColor Yellow
          $w.secrets | ForEach-Object { Write-Host "     npx wrangler secret put $_ (in $($w.name)/)" }
        }
      } else {
        Write-Err "$($w.name) deploy failed (exit $LASTEXITCODE)"
      }
    } finally {
      Pop-Location
    }
  }
}

# ── Dev mode ──────────────────────────────────────────────────────────────────
if ($Mode -eq "dev") {
  if ($targets.Count -gt 1) {
    Write-Host "Dev mode runs one worker at a time. Specify -Worker <name>" -ForegroundColor Yellow
    exit 1
  }
  $w = $targets[0]
  $dir = Join-Path $WORKERS_DIR $w.name
  Write-Host "`n Starting local dev: $($w.name)" -ForegroundColor Cyan
  Write-Host " URL: http://localhost:8787" -ForegroundColor DarkGray
  Write-Host " Workers AI, D1, KV are simulated via Miniflare`n" -ForegroundColor DarkGray
  Push-Location $dir
  try {
    # --local = fully local simulation, no Cloudflare calls
    npx wrangler dev --local
  } finally {
    Pop-Location
  }
}

# ── Secret mode ───────────────────────────────────────────────────────────────
if ($Mode -eq "secret") {
  if (-not $Secret) { Write-Err "Specify -Secret <NAME>"; exit 1 }
  foreach ($w in $targets) {
    $dir = Join-Path $WORKERS_DIR $w.name
    Write-Step "Setting secret $Secret on $($w.name)"
    Push-Location $dir
    try {
      # Prompt securely — wrangler reads from stdin
      npx wrangler secret put $Secret
      if ($LASTEXITCODE -eq 0) { Write-Ok "$Secret set on $($w.name)" }
      else                      { Write-Err "Failed to set secret on $($w.name)" }
    } finally {
      Pop-Location
    }
  }
}

Write-Host ""
