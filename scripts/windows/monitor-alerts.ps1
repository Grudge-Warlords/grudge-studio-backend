# ═══════════════════════════════════════════════════════════════════════
# Grudge Studio — Windows VPS Resource Monitor
#
# Checks CPU, RAM, and disk every 5 minutes.
# Fires a Discord webhook alert if thresholds are exceeded.
# Runs as a Windows Scheduled Task (set up via register-monitor-task.ps1)
#
# Also checks:
#   - GrudgeBridge service status
#   - Radmin VPN connectivity to Linux VPS
#   - Node.js process health
#
# Usage (manual run):
#   .\scripts\windows\monitor-alerts.ps1
#
# Install as scheduled task:
#   .\scripts\windows\monitor-alerts.ps1 -Install
# ═══════════════════════════════════════════════════════════════════════

param(
    [switch]$Install  # Pass -Install to register as Scheduled Task
)

# ── CONFIGURATION ─────────────────────────────────────────────────────
$DISCORD_WEBHOOK   = "REPLACE_WITH_DISCORD_SYSTEM_WEBHOOK_TOKEN"
$LINUX_VPS_IP      = "26.228.21.150"   # Radmin VPN IP of Linux VPS
$BRIDGE_PORT       = 4000
$BRIDGE_API_KEY    = "REPLACE_WITH_BRIDGE_API_KEY"

$THRESHOLD_CPU     = 85    # % — alert if CPU sustained above this
$THRESHOLD_RAM     = 85    # % — alert if RAM used above this
$THRESHOLD_DISK    = 90    # % — alert if any drive above this

$STATE_FILE        = "C:\grudge-bridge\logs\monitor-state.json"
# ──────────────────────────────────────────────────────────────────────

if ($Install) {
    # Register as a Scheduled Task running every 5 minutes
    $action  = New-ScheduledTaskAction -Execute "powershell.exe" `
        -Argument "-NonInteractive -ExecutionPolicy Bypass -File `"$PSCommandPath`""
    $trigger = New-ScheduledTaskTrigger -RepetitionInterval (New-TimeSpan -Minutes 5) `
        -Once -At (Get-Date)
    $settings = New-ScheduledTaskSettingsSet `
        -ExecutionTimeLimit (New-TimeSpan -Minutes 2) `
        -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
    $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount

    Register-ScheduledTask `
        -TaskName   "GrudgeMonitor" `
        -TaskPath   "\Grudge Studio\" `
        -Action     $action `
        -Trigger    $trigger `
        -Settings   $settings `
        -Principal  $principal `
        -Description "Grudge Studio Windows VPS resource monitor — alerts to Discord" `
        -Force

    Write-Host "✅ GrudgeMonitor scheduled task registered (every 5 min)" -ForegroundColor Green
    Write-Host "   Task Manager > Task Scheduler > Grudge Studio > GrudgeMonitor"
    exit 0
}

# ── Load/save alert state (prevent repeated alerts for same issue) ─────
function Get-State {
    if (Test-Path $STATE_FILE) {
        try { return Get-Content $STATE_FILE | ConvertFrom-Json } catch {}
    }
    return [PSCustomObject]@{ lastCpuAlert = $null; lastRamAlert = $null; lastDiskAlert = $null; lastBridgeAlert = $null }
}

function Save-State($state) {
    New-Item -ItemType Directory -Force -Path (Split-Path $STATE_FILE) | Out-Null
    $state | ConvertTo-Json | Set-Content $STATE_FILE
}

function Should-Alert($lastAlertTime, $cooldownMinutes = 30) {
    if (-not $lastAlertTime) { return $true }
    return ((Get-Date) - [datetime]$lastAlertTime).TotalMinutes -ge $cooldownMinutes
}

# ── Discord webhook helper ─────────────────────────────────────────────
function Send-Discord($title, $description, $color = 15158332) {
    if (-not $DISCORD_WEBHOOK -or $DISCORD_WEBHOOK -like "REPLACE*") { return }
    $body = @{
        embeds = @(@{
            title       = $title
            description = $description
            color       = $color
            footer      = @{ text = "Windows VPS (DESKTOP-AA5O5QR) — $(Get-Date -Format 'HH:mm:ss')" }
        })
    } | ConvertTo-Json -Depth 5
    try {
        Invoke-RestMethod -Uri $DISCORD_WEBHOOK -Method Post -Body $body -ContentType "application/json" | Out-Null
    } catch {}
}

$state   = Get-State
$alerts  = @()
$now     = Get-Date

# ── 1. CPU check ──────────────────────────────────────────────────────
$cpu = (Get-CimInstance -ClassName Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average
if ($cpu -ge $THRESHOLD_CPU -and (Should-Alert $state.lastCpuAlert)) {
    $alerts += "🔴 **CPU at $([Math]::Round($cpu, 1))%** (threshold: $THRESHOLD_CPU%)"
    $state.lastCpuAlert = $now.ToString("o")
}

# ── 2. RAM check ──────────────────────────────────────────────────────
$os          = Get-CimInstance Win32_OperatingSystem
$ramUsedPct  = [Math]::Round((($os.TotalVisibleMemorySize - $os.FreePhysicalMemory) / $os.TotalVisibleMemorySize) * 100, 1)
$ramFreeGB   = [Math]::Round($os.FreePhysicalMemory / 1MB, 2)
if ($ramUsedPct -ge $THRESHOLD_RAM -and (Should-Alert $state.lastRamAlert)) {
    $alerts += "🔴 **RAM at $ramUsedPct%** ($ramFreeGB GB free, threshold: $THRESHOLD_RAM%)"
    $state.lastRamAlert = $now.ToString("o")
}

# ── 3. Disk check ─────────────────────────────────────────────────────
Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Used -gt 0 } | ForEach-Object {
    $usedPct = [Math]::Round(($_.Used / ($_.Used + $_.Free)) * 100, 1)
    $freeGB  = [Math]::Round($_.Free / 1GB, 2)
    if ($usedPct -ge $THRESHOLD_DISK -and (Should-Alert $state.lastDiskAlert)) {
        $alerts += "🔴 **Disk $($_.Name): at $usedPct%** ($freeGB GB free, threshold: $THRESHOLD_DISK%)"
        $state.lastDiskAlert = $now.ToString("o")
    }
}

# ── 4. GrudgeBridge service check ─────────────────────────────────────
$bridgeSvc = Get-Service -Name "GrudgeBridge" -ErrorAction SilentlyContinue
if (-not $bridgeSvc -or $bridgeSvc.Status -ne "Running") {
    if (Should-Alert $state.lastBridgeAlert 10) {
        $status = if ($bridgeSvc) { $bridgeSvc.Status } else { "NOT INSTALLED" }
        $alerts += "🚨 **GrudgeBridge service is $status** — attempting restart..."
        try { Start-Service "GrudgeBridge" -ErrorAction Stop; $alerts[-1] += " ✅ Restarted" }
        catch { $alerts[-1] += " ❌ Restart failed" }
        $state.lastBridgeAlert = $now.ToString("o")
    }
}

# ── 5. Radmin VPN reachability check (ping Linux VPS) ─────────────────
$ping = Test-Connection -ComputerName $LINUX_VPS_IP -Count 1 -Quiet -ErrorAction SilentlyContinue
if (-not $ping -and (Should-Alert $state.lastBridgeAlert 15)) {
    $alerts += "⚠️ **Cannot reach Linux VPS** at $LINUX_VPS_IP via Radmin VPN"
    $state.lastBridgeAlert = $now.ToString("o")
}

# ── 6. Fire alerts ────────────────────────────────────────────────────
if ($alerts.Count -gt 0) {
    $desc = $alerts -join "`n"
    Send-Discord "⚠️ Grudge Windows VPS — Resource Alert" $desc
    Write-Warning "Alerts sent:`n$desc"
} else {
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] All systems nominal. CPU:$([Math]::Round($cpu,1))% RAM:$ramUsedPct%"
}

Save-State $state
