#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# Grudge Studio — Headless Game Server Deploy
# Builds and deploys the Unity Linux game server container.
#
# Usage:
#   bash scripts/deploy-headless.sh              # Standard deploy
#   bash scripts/deploy-headless.sh --rebuild    # Force rebuild
#   bash scripts/deploy-headless.sh --stop       # Stop the server
#   bash scripts/deploy-headless.sh --logs       # Tail server logs
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

BACKEND_DIR="${BACKEND_DIR:-/opt/grudge-studio-backend}"
cd "$BACKEND_DIR"

PROJECT="grudge-studio-backend"
COMPOSE="docker compose -p $PROJECT -f docker-compose.yml -f docker-compose.prod.yml --profile gameserver"
SVC="grudge-headless"
BIN_PATH="services/grudge-headless/bin/GrudgeLinuxServer.x86_64"

HEALTH_RETRIES=8        # more retries — Unity takes longer to boot
HEALTH_INTERVAL=10      # seconds between retries
REBUILD=false

# ── Parse args ─────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --rebuild) REBUILD=true; shift ;;
    --stop)
      echo ">>> Stopping $SVC..."
      $COMPOSE stop $SVC
      echo "✅ $SVC stopped"
      exit 0
      ;;
    --logs)
      $COMPOSE logs -f $SVC
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

echo "═══ Grudge Headless — Deploy ═══"
echo "  Dir:     $BACKEND_DIR"
echo "  Project: $PROJECT"
echo "  Rebuild: $REBUILD"
echo ""

# ── 0. Verify binary exists ───────────────────────────────
if [ ! -f "$BIN_PATH" ]; then
  echo "❌ ERROR: Unity server binary not found at $BIN_PATH"
  echo ""
  echo "Upload it first:"
  echo "  scp -r /path/to/LinuxBuild/* root@$(hostname -I | awk '{print $1}'):$BACKEND_DIR/services/grudge-headless/bin/"
  echo ""
  echo "Or from Windows:"
  echo "  bash scripts/upload-headless-binary.sh D:\\path\\to\\LinuxBuild"
  exit 1
fi

echo "  Binary:  $BIN_PATH ($(du -sh "$BIN_PATH" | cut -f1))"
echo ""

# ── 1. Tag current image as :previous ─────────────────────
echo ">>> Tagging current image as :previous..."
IMG=$(docker inspect --format='{{.Config.Image}}' "$SVC" 2>/dev/null || true)
if [ -n "$IMG" ] && [ "$IMG" != "<no value>" ]; then
  docker tag "$IMG" "${IMG%%:*}:previous" 2>/dev/null || true
  echo "  Tagged $IMG → ${IMG%%:*}:previous"
else
  echo "  No existing image found (first deploy)"
fi
echo ""

# ── 2. Build ──────────────────────────────────────────────
echo ">>> Building $SVC..."
if [ "$REBUILD" = true ]; then
  DOCKER_BUILDKIT=1 $COMPOSE build --no-cache "$SVC"
else
  DOCKER_BUILDKIT=1 $COMPOSE build --build-arg BUILDKIT_INLINE_CACHE=1 "$SVC"
fi
echo ""

# ── 3. Start ──────────────────────────────────────────────
echo ">>> Starting $SVC..."
$COMPOSE up -d --no-deps "$SVC"
echo ""

# ── 4. Health gate (process-based) ────────────────────────
echo ">>> Waiting for $SVC to become healthy..."
HEALTHY=false

for i in $(seq 1 $HEALTH_RETRIES); do
  sleep $HEALTH_INTERVAL

  # Check if the Unity process is running inside the container
  if docker exec "$SVC" pgrep -f GrudgeLinuxServer > /dev/null 2>&1; then
    HEALTHY=true
    break
  fi

  # Also check Docker's own health status
  DOCKER_HEALTH=$(docker inspect --format='{{.State.Health.Status}}' "$SVC" 2>/dev/null || echo "none")
  if [ "$DOCKER_HEALTH" = "healthy" ]; then
    HEALTHY=true
    break
  fi

  echo "  ⏳ attempt $i/$HEALTH_RETRIES — not ready yet..."
done

echo ""

if [ "$HEALTHY" = true ]; then
  echo "✅ $SVC is healthy and running!"
  echo ""
  echo "  Status: $(docker inspect --format='{{.State.Status}}' "$SVC")"
  echo "  Uptime: $(docker inspect --format='{{.State.StartedAt}}' "$SVC")"
  echo "  Players: max ${MAX_PLAYERS:-22}"
  echo "  Port: 7777 (TCP+UDP)"
else
  echo "❌ $SVC FAILED health check after $((HEALTH_RETRIES * HEALTH_INTERVAL))s"
  echo ""

  # Show last 20 lines of logs for debugging
  echo ">>> Last 20 lines of logs:"
  docker logs --tail 20 "$SVC" 2>&1 || true
  echo ""

  # Rollback
  echo ">>> Rolling back to :previous image..."
  PREV=$(docker images --format '{{.Repository}}:{{.Tag}}' | grep "${SVC}.*:previous" | head -1)
  if [ -n "$PREV" ]; then
    docker stop "$SVC" 2>/dev/null || true
    docker rm "$SVC" 2>/dev/null || true
    docker tag "$PREV" "${PREV%%:*}:latest" 2>/dev/null || true
    $COMPOSE up -d --no-deps --no-build "$SVC"
    echo "  ↩ Rolled back to $PREV"
  else
    echo "  ⚠ No :previous image found — restarting current..."
    $COMPOSE restart "$SVC" || true
  fi
  exit 1
fi

# ── 5. Final status ──────────────────────────────────────
echo ""
echo ">>> Container status:"
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" --filter "name=$SVC"
echo ""
echo "═══ ✅ Headless deploy complete — $(date) ═══"
