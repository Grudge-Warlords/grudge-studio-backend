#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# Grudge Studio — Upload Unity Headless Binary to VPS
#
# Uploads the Unity Linux server build to the VPS and optionally
# triggers a rebuild of the grudge-headless container.
#
# Usage:
#   bash scripts/upload-headless-binary.sh /path/to/LinuxBuild
#   bash scripts/upload-headless-binary.sh /path/to/LinuxBuild --deploy
#   bash scripts/upload-headless-binary.sh /path/to/LinuxBuild --host 74.208.155.229
#
# The source directory should contain at minimum:
#   GrudgeLinuxServer.x86_64
#   GrudgeLinuxServer_Data/
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

VPS_HOST="${VPS_HOST:-74.208.155.229}"
VPS_USER="${VPS_USER:-root}"
REMOTE_DIR="/opt/grudge-studio-backend/services/grudge-headless/bin"
DEPLOY_AFTER=false
SOURCE_DIR=""

# ── Parse args ─────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --deploy) DEPLOY_AFTER=true; shift ;;
    --host) VPS_HOST="$2"; shift 2 ;;
    --user) VPS_USER="$2"; shift 2 ;;
    *)
      if [ -z "$SOURCE_DIR" ]; then
        SOURCE_DIR="$1"
      else
        echo "Unknown option: $1"
        exit 1
      fi
      shift
      ;;
  esac
done

if [ -z "$SOURCE_DIR" ]; then
  echo "Usage: upload-headless-binary.sh /path/to/LinuxBuild [--deploy] [--host IP]"
  echo ""
  echo "Options:"
  echo "  --deploy   Rebuild and restart the container after upload"
  echo "  --host IP  VPS IP address (default: 74.208.155.229)"
  echo "  --user U   SSH user (default: root)"
  exit 1
fi

# ── Validate source ───────────────────────────────────────
if [ ! -d "$SOURCE_DIR" ]; then
  echo "❌ ERROR: Source directory not found: $SOURCE_DIR"
  exit 1
fi

BINARY="$SOURCE_DIR/GrudgeLinuxServer.x86_64"
if [ ! -f "$BINARY" ]; then
  # Also check for other common Unity build names
  BINARY=$(find "$SOURCE_DIR" -maxdepth 1 -name "*.x86_64" -type f | head -1)
  if [ -z "$BINARY" ]; then
    echo "❌ ERROR: No .x86_64 binary found in $SOURCE_DIR"
    echo "   Expected: GrudgeLinuxServer.x86_64"
    exit 1
  fi
  echo "⚠ Found binary: $(basename "$BINARY") (expected GrudgeLinuxServer.x86_64)"
fi

BUILD_SIZE=$(du -sh "$SOURCE_DIR" | cut -f1)
echo "═══ Upload Headless Binary ═══"
echo "  Source:  $SOURCE_DIR ($BUILD_SIZE)"
echo "  Target:  $VPS_USER@$VPS_HOST:$REMOTE_DIR"
echo "  Deploy:  $DEPLOY_AFTER"
echo ""

# ── 1. Create remote directory ────────────────────────────
echo ">>> Ensuring remote directory exists..."
ssh "$VPS_USER@$VPS_HOST" "mkdir -p $REMOTE_DIR"

# ── 2. Upload via rsync ──────────────────────────────────
echo ">>> Uploading binary ($BUILD_SIZE)..."
rsync -avz --progress \
  --delete \
  "$SOURCE_DIR/" \
  "$VPS_USER@$VPS_HOST:$REMOTE_DIR/"

echo ""

# ── 3. Set permissions ────────────────────────────────────
echo ">>> Setting executable permissions..."
ssh "$VPS_USER@$VPS_HOST" "chmod +x $REMOTE_DIR/*.x86_64 2>/dev/null || true; chmod +x $REMOTE_DIR/*.sh 2>/dev/null || true"

# ── 4. Verify ─────────────────────────────────────────────
echo ">>> Verifying upload..."
REMOTE_SIZE=$(ssh "$VPS_USER@$VPS_HOST" "du -sh $REMOTE_DIR | cut -f1")
REMOTE_BIN=$(ssh "$VPS_USER@$VPS_HOST" "ls $REMOTE_DIR/*.x86_64 2>/dev/null | head -1")

if [ -n "$REMOTE_BIN" ]; then
  echo "  ✅ Binary uploaded: $REMOTE_BIN ($REMOTE_SIZE)"
else
  echo "  ❌ No .x86_64 binary found on remote after upload"
  exit 1
fi
echo ""

# ── 5. Optionally deploy ─────────────────────────────────
if [ "$DEPLOY_AFTER" = true ]; then
  echo ">>> Triggering headless deploy..."
  ssh "$VPS_USER@$VPS_HOST" "bash /opt/grudge-studio-backend/scripts/deploy-headless.sh"
else
  echo "Binary uploaded. To deploy:"
  echo "  ssh $VPS_USER@$VPS_HOST 'bash /opt/grudge-studio-backend/scripts/deploy-headless.sh'"
fi

echo ""
echo "═══ ✅ Upload complete — $(date) ═══"
