#!/usr/bin/env bash
set -euo pipefail

# ═══════════════════════════════════════════════════════════════
# Grudge Studio — Deploy Script
# Run on VPS to pull latest and redeploy all services
#
# Usage:
#   ./coolify/deploy.sh              # Standard deploy
#   ./coolify/deploy.sh --rebuild    # Force rebuild all images
#   ./coolify/deploy.sh --service X  # Deploy single service
# ═══════════════════════════════════════════════════════════════

BACKEND_DIR="${BACKEND_DIR:-/opt/grudge-studio-backend}"
cd "$BACKEND_DIR"

REBUILD=false
TARGET_SERVICE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --rebuild) REBUILD=true; shift ;;
    --service) TARGET_SERVICE="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

echo "═══ Grudge Studio — Deploying ═══"
echo "  Dir: $BACKEND_DIR"
echo "  Rebuild: $REBUILD"
echo "  Target: ${TARGET_SERVICE:-all services}"
echo ""

# ── 1. Pull latest code ──────────────────────────────────────
echo ">>> Pulling latest code..."
git fetch origin
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

if [ "$LOCAL" != "$REMOTE" ]; then
  echo "  New commits detected, pulling..."
  git pull origin main
  echo "  Updated to $(git rev-parse --short HEAD)"
else
  echo "  Already up to date ($(git rev-parse --short HEAD))"
fi

# ── 2. Build and deploy ──────────────────────────────────────
COMPOSE_CMD="docker compose -f docker-compose.yml -f docker-compose.prod.yml"

if [ -n "$TARGET_SERVICE" ]; then
  echo ">>> Deploying $TARGET_SERVICE..."
  if [ "$REBUILD" = true ]; then
    $COMPOSE_CMD build --no-cache "$TARGET_SERVICE"
  fi
  $COMPOSE_CMD up -d --no-deps "$TARGET_SERVICE"
else
  echo ">>> Deploying all services..."
  if [ "$REBUILD" = true ]; then
    $COMPOSE_CMD build --no-cache
  fi
  $COMPOSE_CMD pull  # Pull pre-built images (mysql, redis, etc.)
  $COMPOSE_CMD up -d --remove-orphans
fi

# ── 3. Wait and verify ───────────────────────────────────────
echo ""
echo ">>> Waiting for services to start..."
sleep 10

echo ">>> Service status:"
$COMPOSE_CMD ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}"

# ── 4. Run health check ──────────────────────────────────────
echo ""
if [ -f "$BACKEND_DIR/coolify/health-check.sh" ]; then
  echo ">>> Running health check..."
  bash "$BACKEND_DIR/coolify/health-check.sh" || true
fi

# ── 5. Docker cleanup ────────────────────────────────────────
echo ""
echo ">>> Cleaning up old images..."
docker image prune -f
DISK_USED=$(df / | awk 'NR==2 {print $5}' | sed 's/%//')
echo "  Disk usage: ${DISK_USED}%"

echo ""
echo "═══ Deploy complete — $(date) ═══"
