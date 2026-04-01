# GRUDGE STUDIO — R2 Asset Upload (Sequential with --remote)
# Uses wrangler r2 object put --remote to upload to actual R2 (not local dev)
# Preserves full directory structure. Assigns UUID-based keys for dedup.
#
# Usage: .\scripts\upload-to-r2.ps1 [category]
# Categories: sprites effects icons ui backgrounds heroes audio ships starway dev_models all

param([string]$Category = "sprites")

$BUCKET  = "grudge-assets"
$DESKTOP = "C:\Users\david\Desktop"
$CDN     = "https://assets.grudge-studio.com"

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

$toRun = if ($Category -eq "all") { $SOURCES.GetEnumerator() } `
         else { $SOURCES.GetEnumerator() | Where-Object { $_.Key -eq $Category } }

if (-not $toRun) { Write-Host "Unknown: $Category. Try: $($SOURCES.Keys -join ', '), all"; exit 1 }

$ok=0; $skip=0; $fail=0; $start=Get-Date

foreach ($entry in $toRun) {
    $src    = $entry.Value.src
    $prefix = $entry.Value.prefix
    $exts   = $entry.Value.exts

    if (-not (Test-Path $src)) { Write-Host "⚠️ Skipping $($entry.Key) — not found: $src"; continue }

    $files = Get-ChildItem $src -Recurse -File -Include $exts -ErrorAction SilentlyContinue
    Write-Host "`n📁  $($entry.Key): $($files.Count) files → $BUCKET/$prefix/"

    foreach ($f in $files) {
        # Build R2 key preserving subdirectory structure, lowercase, spaces→hyphens
        $rel   = $f.FullName.Substring($src.Length).TrimStart('\').Replace('\','/')
        $rel   = $rel.ToLower() -replace '\s+','-'
        $r2Key = "$prefix/$rel"

        # Check if already exists via CDN HEAD (skip if 200)
        $head = curl.exe -s -o NUL -w "%{http_code}" -X HEAD "$CDN/$r2Key" 2>$null
        if ($head -eq "200") { $skip++; Write-Host "  ⏭ $r2Key"; continue }

        $out = & npx wrangler r2 object put "$BUCKET/$r2Key" --file "$($f.FullName)" --remote 2>&1
        if ($LASTEXITCODE -eq 0) {
            $ok++
            Write-Host "  ✅ [$ok] $r2Key"
        } else {
            $fail++
            Write-Host "  ❌ $r2Key — $($out[-1])" -ForegroundColor Red
        }
    }
}

$mins = [Math]::Round(((Get-Date)-$start).TotalMinutes,1)
Write-Host "`n──────────────────────────────────────"
Write-Host "✅ Uploaded: $ok  ⏭ Skipped: $skip  ❌ Failed: $fail"
Write-Host "⏱  Time: $mins minutes"
Write-Host "🌐 CDN:  $CDN"
