# ═══════════════════════════════════════════════════════════════
# GRUDGE STUDIO — Hub Health Check
# Usage: .\scripts\hub-health.ps1
# ═══════════════════════════════════════════════════════════════

param(
    [switch]$Verbose,
    [switch]$JsonOutput
)

$GRUDGE_ROOT = "D:\GrudgeLink\OneDrive\Desktop\grudge-studio-backend"
$VPS_IP = "74.208.155.229"

$results = @()

function Check-Endpoint {
    param([string]$Name, [string]$Url, [string]$Category)
    try {
        $sw = [System.Diagnostics.Stopwatch]::StartNew()
        $r = Invoke-WebRequest -Uri $Url -Method GET -TimeoutSec 10 -UseBasicParsing -ErrorAction Stop
        $sw.Stop()
        $result = @{
            Name = $Name; Url = $Url; Category = $Category
            Status = "OK"; Code = $r.StatusCode; Latency = $sw.ElapsedMilliseconds
        }
    } catch {
        $result = @{
            Name = $Name; Url = $Url; Category = $Category
            Status = "FAIL"; Code = 0; Latency = -1; Error = $_.Exception.Message
        }
    }
    return $result
}

Write-Host "`n╔══════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║     GRUDGE STUDIO — HUB HEALTH CHECK        ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host "  Time: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss UTC' -AsUTC)`n" -ForegroundColor DarkGray

# ─── VPS CONNECTIVITY ──────────────────────────────────────────
Write-Host "  [VPS] " -NoNewline -ForegroundColor Yellow
$ping = Test-Connection $VPS_IP -Count 2 -Quiet
if ($ping) {
    Write-Host "REACHABLE ($VPS_IP)" -ForegroundColor Green
} else {
    Write-Host "UNREACHABLE ($VPS_IP)" -ForegroundColor Red
}

# ─── LOCAL DOCKER ──────────────────────────────────────────────
Write-Host "`n  LOCAL DOCKER:" -ForegroundColor Yellow
$dockerRunning = docker info 2>$null
if ($LASTEXITCODE -eq 0) {
    $containers = docker compose -f "$GRUDGE_ROOT\docker-compose.yml" ps --format "{{.Name}} {{.State}}" 2>$null
    if ($containers) {
        foreach ($line in $containers -split "`n") {
            if ($line.Trim()) {
                $parts = $line.Trim() -split "\s+"
                $name = $parts[0]
                $state = if ($parts.Count -gt 1) { $parts[1] } else { "unknown" }
                $color = if ($state -eq "running") { "Green" } else { "Red" }
                Write-Host "    [$state] $name" -ForegroundColor $color
            }
        }
    } else {
        Write-Host "    No containers running" -ForegroundColor DarkGray
    }
} else {
    Write-Host "    Docker Desktop not running" -ForegroundColor Red
}

# ─── API ENDPOINTS ─────────────────────────────────────────────
Write-Host "`n  API ENDPOINTS:" -ForegroundColor Yellow
$apis = @(
    @("Identity API",  "https://id.grudge-studio.com/health"),
    @("Game API",      "https://api.grudge-studio.com/health"),
    @("Account API",   "https://account.grudge-studio.com/health"),
    @("Launcher API",  "https://launcher.grudge-studio.com/health"),
    @("WebSocket",     "https://ws.grudge-studio.com/health")
)
foreach ($api in $apis) {
    $r = Check-Endpoint -Name $api[0] -Url $api[1] -Category "API"
    $results += $r
    if ($r.Status -eq "OK") {
        $color = if ($r.Latency -lt 500) { "Green" } elseif ($r.Latency -lt 2000) { "Yellow" } else { "Red" }
        Write-Host "    [OK]   $($r.Name) ($($r.Code)) $($r.Latency)ms" -ForegroundColor $color
    } else {
        Write-Host "    [FAIL] $($r.Name) — $($r.Error)" -ForegroundColor Red
    }
}

# ─── CLOUDFLARE WORKERS ───────────────────────────────────────
Write-Host "`n  CLOUDFLARE WORKERS:" -ForegroundColor Yellow
$workers = @(
    @("Main Site",   "https://grudge-studio.com"),
    @("Dashboard",   "https://dash.grudge-studio.com"),
    @("Assets CDN",  "https://assets.grudge-studio.com")
)
foreach ($w in $workers) {
    $r = Check-Endpoint -Name $w[0] -Url $w[1] -Category "Worker"
    $results += $r
    if ($r.Status -eq "OK") {
        Write-Host "    [OK]   $($r.Name) ($($r.Code)) $($r.Latency)ms" -ForegroundColor Green
    } else {
        Write-Host "    [FAIL] $($r.Name) — $($r.Error)" -ForegroundColor Red
    }
}

# ─── EXTERNAL SERVICES ────────────────────────────────────────
Write-Host "`n  EXTERNAL SERVICES:" -ForegroundColor Yellow
$external = @(
    @("ObjectStore",     "https://molochdagod.github.io/ObjectStore/api/v1/classes.json"),
    @("Warlord Suite",   "https://warlord-crafting-suite.vercel.app"),
    @("Grudge Warlords", "https://grudgewarlords.com")
)
foreach ($e in $external) {
    $r = Check-Endpoint -Name $e[0] -Url $e[1] -Category "External"
    $results += $r
    if ($r.Status -eq "OK") {
        Write-Host "    [OK]   $($r.Name) ($($r.Code)) $($r.Latency)ms" -ForegroundColor Green
    } else {
        Write-Host "    [FAIL] $($r.Name) — $($r.Error)" -ForegroundColor Red
    }
}

# ─── DNS CHECK ─────────────────────────────────────────────────
Write-Host "`n  DNS RESOLUTION:" -ForegroundColor Yellow
$domains = @("grudge-studio.com", "id.grudge-studio.com", "api.grudge-studio.com", "dash.grudge-studio.com", "ws.grudge-studio.com")
foreach ($d in $domains) {
    try {
        $dns = Resolve-DnsName $d -ErrorAction Stop | Select-Object -First 1
        Write-Host "    [OK]   $d -> $($dns.IPAddress ?? $dns.NameHost ?? 'resolved')" -ForegroundColor Green
    } catch {
        Write-Host "    [FAIL] $d — DNS resolution failed" -ForegroundColor Red
    }
}

# ─── SUMMARY ──────────────────────────────────────────────────
$pass = ($results | Where-Object { $_.Status -eq "OK" }).Count
$fail = ($results | Where-Object { $_.Status -eq "FAIL" }).Count
$total = $results.Count

Write-Host "`n  ─────────────────────────────────────────────" -ForegroundColor DarkCyan
$color = if ($fail -eq 0) { "Green" } else { "Red" }
Write-Host "  RESULT: $pass/$total passed" -ForegroundColor $color
if ($fail -gt 0) {
    Write-Host "  FAILURES: $fail service(s) down" -ForegroundColor Red
}
Write-Host ""

# ─── JSON OUTPUT ───────────────────────────────────────────────
if ($JsonOutput) {
    $results | ConvertTo-Json -Depth 3 | Out-File "$GRUDGE_ROOT\scripts\health-report.json" -Encoding UTF8
    Write-Host "  JSON report saved to scripts/health-report.json" -ForegroundColor DarkGray
}
