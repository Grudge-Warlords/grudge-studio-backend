# ═══════════════════════════════════════════════════════════════
# GRUDGE STUDIO — Environment Variable Validator
# Checks .env against .env.example for missing or placeholder values
# Usage: .\scripts\hub-env-check.ps1
# ═══════════════════════════════════════════════════════════════

param(
    [switch]$Fix  # Interactive mode to fill missing values
)

$GRUDGE_ROOT = "D:\GrudgeLink\OneDrive\Desktop\grudge-studio-backend"
$envPath = Join-Path $GRUDGE_ROOT ".env"
$examplePath = Join-Path $GRUDGE_ROOT ".env.example"

Write-Host "`n=== GRUDGE STUDIO ENV CHECK ===" -ForegroundColor Cyan

# ─── LOAD FILES ────────────────────────────────────────────────
if (-not (Test-Path $examplePath)) {
    Write-Host "  ERROR: .env.example not found at $examplePath" -ForegroundColor Red
    return
}

$exampleLines = Get-Content $examplePath
$envExists = Test-Path $envPath

if (-not $envExists) {
    Write-Host "  WARNING: .env file does not exist!" -ForegroundColor Red
    Write-Host "  Run: node scripts/gen-secrets.js > .env" -ForegroundColor Yellow
    Write-Host "  Or:  Copy .env.example to .env and fill values" -ForegroundColor Yellow
    return
}

$envLines = Get-Content $envPath

# ─── PARSE VARS ────────────────────────────────────────────────
function Parse-EnvFile {
    param([string[]]$Lines)
    $vars = @{}
    foreach ($line in $Lines) {
        $trimmed = $line.Trim()
        if ($trimmed -and -not $trimmed.StartsWith("#") -and $trimmed.Contains("=")) {
            $eqIdx = $trimmed.IndexOf("=")
            $key = $trimmed.Substring(0, $eqIdx).Trim()
            $value = $trimmed.Substring($eqIdx + 1).Trim()
            $vars[$key] = $value
        }
    }
    return $vars
}

$exampleVars = Parse-EnvFile $exampleLines
$envVars = Parse-EnvFile $envLines

# ─── PLACEHOLDER PATTERNS ─────────────────────────────────────
$placeholders = @(
    "change_me",
    "your_",
    "sk-...",
    "sk-ant-...",
    "xai-...",
    "pplx-...",
    "msy_...",
    "hf_...",
    "tsk_...",
    "github_pat_...",
    "24_word_bip39"
)

# ─── CHECK ─────────────────────────────────────────────────────
$missing = @()
$placeholder = @()
$empty = @()
$valid = @()

foreach ($key in $exampleVars.Keys) {
    if (-not $envVars.ContainsKey($key)) {
        $missing += $key
    } elseif ([string]::IsNullOrWhiteSpace($envVars[$key])) {
        $empty += $key
    } else {
        $isPlaceholder = $false
        foreach ($p in $placeholders) {
            if ($envVars[$key] -like "*$p*") {
                $isPlaceholder = $true
                break
            }
        }
        if ($isPlaceholder) {
            $placeholder += $key
        } else {
            $valid += $key
        }
    }
}

# ─── REPORT ────────────────────────────────────────────────────
Write-Host "`n  VALID:       $($valid.Count) variables set" -ForegroundColor Green

if ($missing.Count -gt 0) {
    Write-Host "  MISSING:     $($missing.Count) variables not in .env" -ForegroundColor Red
    foreach ($m in $missing) {
        Write-Host "    - $m" -ForegroundColor DarkGray
    }
}

if ($empty.Count -gt 0) {
    Write-Host "  EMPTY:       $($empty.Count) variables with no value" -ForegroundColor Yellow
    foreach ($e in $empty) {
        Write-Host "    - $e" -ForegroundColor DarkGray
    }
}

if ($placeholder.Count -gt 0) {
    Write-Host "  PLACEHOLDER: $($placeholder.Count) variables still have template values" -ForegroundColor Yellow
    foreach ($p in $placeholder) {
        Write-Host "    - $p = $($envVars[$p])" -ForegroundColor DarkGray
    }
}

# ─── SECURITY CHECKS ──────────────────────────────────────────
Write-Host "`n  SECURITY:" -ForegroundColor Yellow

# Check .gitignore
$gitignorePath = Join-Path $GRUDGE_ROOT ".gitignore"
if (Test-Path $gitignorePath) {
    $gitignore = Get-Content $gitignorePath -Raw
    $mustIgnore = @(".env", ".env.local", "*.pem", "*.key", "node_modules")
    foreach ($pattern in $mustIgnore) {
        if ($gitignore -match [regex]::Escape($pattern)) {
            Write-Host "    [OK]   .gitignore has '$pattern'" -ForegroundColor Green
        } else {
            Write-Host "    [WARN] .gitignore missing '$pattern'" -ForegroundColor Red
        }
    }
} else {
    Write-Host "    [FAIL] No .gitignore found!" -ForegroundColor Red
}

# Check for secrets in git history (quick check)
$gitSecrets = git -C $GRUDGE_ROOT log --all --oneline -10 --diff-filter=A -- "*.env" ".env" 2>$null
if ($gitSecrets) {
    Write-Host "    [WARN] .env may have been committed in git history!" -ForegroundColor Red
    Write-Host "           Run: git log --all --oneline --diff-filter=A -- .env" -ForegroundColor DarkGray
} else {
    Write-Host "    [OK]   No .env found in recent git history" -ForegroundColor Green
}

# ─── SUMMARY ──────────────────────────────────────────────────
$total = $exampleVars.Count
$issues = $missing.Count + $empty.Count + $placeholder.Count
Write-Host "`n  ─────────────────────────────────────────────" -ForegroundColor DarkCyan
if ($issues -eq 0) {
    Write-Host "  ALL CLEAR: $total/$total variables configured" -ForegroundColor Green
} else {
    Write-Host "  $issues issue(s) found out of $total variables" -ForegroundColor Red
    Write-Host "  Run with -Fix flag for interactive mode" -ForegroundColor DarkGray
}
Write-Host ""
