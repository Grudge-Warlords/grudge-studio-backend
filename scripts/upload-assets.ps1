# GRUDGE STUDIO — Parallel R2 Asset Upload
# Uses wrangler r2 object put via 20 parallel workers
# No S3 credentials needed — uses wrangler OAuth token
#
# Usage:
#   .\scripts\upload-assets.ps1 sprites
#   .\scripts\upload-assets.ps1 models
#   .\scripts\upload-assets.ps1 all

param([string]$Category = "all")

$BUCKET      = "grudge-assets"
$DESKTOP     = "C:\Users\david\Desktop"
$WORKERS     = 20   # parallel wrangler processes
$WRANGLER    = "npx wrangler"

# ── Asset sources ─────────────────────────────────────────────────────────────
$SOURCES = @{
    sprites     = @{ src="$DESKTOP\grudge-wars\public\sprites";      prefix="sprites/characters"; exts=@("*.png","*.jpg","*.gif") }
    effects     = @{ src="$DESKTOP\grudge-wars\public\effects";      prefix="sprites/effects";   exts=@("*.png","*.jpg") }
    icons       = @{ src="$DESKTOP\grudge-wars\public\icons";        prefix="icons";             exts=@("*.png","*.jpg","*.svg") }
    ui          = @{ src="$DESKTOP\grudge-wars\public\ui";           prefix="ui";                exts=@("*.png","*.jpg") }
    backgrounds = @{ src="$DESKTOP\grudge-wars\public\backgrounds";  prefix="backgrounds";       exts=@("*.png","*.jpg") }
    heroes      = @{ src="$DESKTOP\grudge-wars\public\heroes";       prefix="heroes";            exts=@("*.png","*.jpg") }
    audio       = @{ src="$DESKTOP\grudge-wars\public\audio";        prefix="audio";             exts=@("*.mp3","*.ogg","*.wav") }
    ships       = @{ src="$DESKTOP\grim-armada-web\public\models";   prefix="models/ships";      exts=@("*.glb","*.fbx","*.gltf") }
    starway     = @{ src="$DESKTOP\StarWayGRUDA-WebClient\public";   prefix="models/starway";    exts=@("*.glb","*.fbx","*.gltf") }
    dev_models  = @{ src="$DESKTOP\GDevelopAssistant\client\public"; prefix="models/dev";        exts=@("*.glb") }
}

# ── Pick categories ────────────────────────────────────────────────────────────
$toRun = if ($Category -eq "all") { $SOURCES.GetEnumerator() } `
         else { $SOURCES.GetEnumerator() | Where-Object { $_.Key -eq $Category } }

if (-not $toRun) {
    Write-Host "Unknown category: $Category"
    Write-Host "Available: $($SOURCES.Keys -join ', '), all"
    exit 1
}

# ── Collect all files ─────────────────────────────────────────────────────────
$allTasks = [System.Collections.Generic.List[hashtable]]::new()

foreach ($entry in $toRun) {
    $src    = $entry.Value.src
    $prefix = $entry.Value.prefix
    $exts   = $entry.Value.exts

    if (-not (Test-Path $src)) {
        Write-Host "⚠️  Skipping $($entry.Key) — path not found: $src"
        continue
    }

    $files = Get-ChildItem $src -Recurse -File -Include $exts -ErrorAction SilentlyContinue
    Write-Host "📁  $($entry.Key): $($files.Count) files → $BUCKET/$prefix/"

    foreach ($f in $files) {
        $rel    = $f.FullName.Replace("$src\", "").Replace("\", "/")
        $r2Key  = "$prefix/$rel"
        $allTasks.Add(@{ file=$f.FullName; key=$r2Key; cat=$entry.Key })
    }
}

$total = $allTasks.Count
Write-Host "`n🚀  Starting upload: $total files with $WORKERS parallel workers`n"

# ── Parallel upload ────────────────────────────────────────────────────────────
$uploaded = 0
$failed   = 0
$start    = Get-Date

# Split into chunks for worker batches
$batchSize = [Math]::Ceiling($total / $WORKERS)
$batches   = for ($i = 0; $i -lt $total; $i += $batchSize) {
    , ($allTasks | Select-Object -Skip $i -First $batchSize)
}

$jobs = @()
foreach ($batch in $batches) {
    $jobs += Start-Job -ScriptBlock {
        param($tasks, $bucket)
        $results = @()
        foreach ($t in $tasks) {
            try {
                $out = & npx wrangler r2 object put "$bucket/$($t.key)" --file "$($t.file)" 2>&1
                if ($LASTEXITCODE -eq 0) {
                    $results += @{ status="ok"; key=$t.key }
                } else {
                    $results += @{ status="fail"; key=$t.key; err=$out }
                }
            } catch {
                $results += @{ status="fail"; key=$t.key; err=$_.Exception.Message }
            }
        }
        return $results
    } -ArgumentList $batch, $BUCKET
}

Write-Host "⏳  $($jobs.Count) workers running..."

# ── Progress monitor ──────────────────────────────────────────────────────────
$done = 0
while ($jobs | Where-Object { $_.State -eq "Running" }) {
    $completed = ($jobs | Where-Object { $_.State -ne "Running" }).Count
    $pct = [Math]::Round($completed / $jobs.Count * 100, 0)
    Write-Progress -Activity "Uploading to R2" -Status "$completed/$($jobs.Count) workers done ($pct%)" -PercentComplete $pct
    Start-Sleep 3
}

Write-Progress -Activity "Uploading to R2" -Completed

# ── Collect results ────────────────────────────────────────────────────────────
foreach ($job in $jobs) {
    $results = Receive-Job $job
    foreach ($r in $results) {
        if ($r.status -eq "ok") { $uploaded++ }
        else {
            $failed++
            Write-Host "  ❌ $($r.key): $($r.err)" -ForegroundColor Red
        }
    }
    Remove-Job $job
}

$elapsed = (Get-Date) - $start
Write-Host ""
Write-Host "─────────────────────────────────────────────────────────"
Write-Host "✅  Uploaded:  $uploaded files"
Write-Host "❌  Failed:    $failed"
Write-Host "⏱️   Time:      $([Math]::Round($elapsed.TotalMinutes, 1)) minutes"
Write-Host ""
Write-Host "🌐  CDN:       https://assets.grudge-studio.com"
Write-Host "🗄   Browse:    https://objectstore.grudge-studio.com/v1/assets"
