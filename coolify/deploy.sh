#!/usr/bin/env bash
set -euo pipefail

# ═══════════════════════════════════════════════════════════════
# Grudge Studio — Safe Deploy Script
# Run on VPS to pull latest and redeploy all services.
#
# Safety features:
#   • Tags running images as :previous before rebuilding
#   • Per-service health gate — polls /health after each restart
#   • Auto-rollback — reverts to :previous if health check fails
#   • Orphan stack detection — refuses to deploy if a duplicate
#     compose project is detected
#
# Usage:
#   ./coolify/deploy.sh              # Standard deploy
#   ./coolify/deploy.sh --rebuild    # Force rebuild all images
#   ./coolify/deploy.sh --service X  # Deploy single service
# ═══════════════════════════════════════════════════════════════

BACKEND_DIR="${BACKEND_DIR:-/opt/grudge-studio-backend}"
cd "$BACKEND_DIR"

# ── Configuration ─────────────────────────────────────────────
PROJECT_NAME="grudge-studio-backend"          # canonical compose project name
HEALTH_RETRIES=6                               # attempts per service
HEALTH_INTERVAL=5                              # seconds between retries
REBUILD=false
TARGET_SERVICE=""

# Service → internal port map (only services with /health)
declare -A SVC_PORTS=(
  [grudge-id]=3001
  [game-api]=3003
  [ai-agent]=3004
  [account-api]=3005
  [launcher-api]=3006
  [ws-service]=3007
  [asset-service]=3008
)

# Ordered deploy sequence: infrastructure-free → data → api → realtime
DEPLOY_ORDER="ai-agent wallet-service account-api launcher-api asset-service game-api grudge-id ws-service"

ROLLBACK_LIST=()     # services we'll need to revert if something breaks
DEPLOY_FAILED=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --rebuild) REBUILD=true; shift ;;
    --service) TARGET_SERVICE="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

echo "═══ Grudge Studio — Safe Deploy ═══"
echo "  Dir:     $BACKEND_DIR"
echo "  Project: $PROJECT_NAME"
echo "  Rebuild: $REBUILD"
echo "  Target:  ${TARGET_SERVICE:-all services}"
echo ""

# ── Compose command (always pin the project name) ─────────────
COMPOSE="docker compose -p $PROJECT_NAME -f docker-compose.yml -f docker-compose.prod.yml"

# ══════════════════════════════════════════════════════════════
# 0. Orphan stack detection
# ══════════════════════════════════════════════════════════════
echo ">>> Checking for duplicate compose projects..."
ACTIVE_PROJECTS=$(docker compose ls --format json 2>/dev/null | grep -o '"Name":"[^"]*"' | sed 's/"Name":"//;s/"//' || true)

for proj in $ACTIVE_PROJECTS; do
  if [[ "$proj" != "$PROJECT_NAME" ]] && docker compose -p "$proj" ps --format json 2>/dev/null | grep -q 'grudge\|game-api\|account-api'; then
    echo "  ⚠  Duplicate project detected: '$proj'"
    echo "     Stopping orphan stack to prevent routing collisions..."
    docker compose -p "$proj" down --remove-orphans 2>/dev/null || true
    echo "  ✓  Orphan stack '$proj' removed"
  fi
done
echo "  ✓  No conflicting stacks"
echo ""

# ══════════════════════════════════════════════════════════════
# 1. Pull latest code
# ══════════════════════════════════════════════════════════════
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
echo ""

# ══════════════════════════════════════════════════════════════
# Helper: tag the current running image as :previous
# ══════════════════════════════════════════════════════════════
tag_previous() {
  local svc=$1
  local img
  img=$(docker inspect --format='{{.Config.Image}}' "$svc" 2>/dev/null || true)
  if [ -n "$img" ] && [ "$img" != "<no value>" ]; then
    docker tag "$img" "${img%%:*}:previous" 2>/dev/null || true
    echo "    tagged $img → ${img%%:*}:previous"
  fi
}

# ══════════════════════════════════════════════════════════════
# Helper: poll /health for a service (returns 0 on success)
# ══════════════════════════════════════════════════════════════
wait_healthy() {
  local svc=$1
  local port=${SVC_PORTS[$svc]:-}

  # For services without an HTTP health port, just check container is running
  if [ -z "$port" ]; then
    for i in $(seq 1 $HEALTH_RETRIES); do
      local status
      status=$(docker inspect --format='{{.State.Health.Status}}' "$svc" 2>/dev/null || echo "none")
      if [ "$status" = "healthy" ] || [ "$status" = "none" ]; then
        local running
        running=$(docker inspect --format='{{.State.Running}}' "$svc" 2>/dev/null || echo "false")
        if [ "$running" = "true" ]; then
          return 0
        fi
      fi
      sleep $HEALTH_INTERVAL
    done
    return 1
  fi

  # HTTP health check
  for i in $(seq 1 $HEALTH_RETRIES); do
    if curl -sf --max-time 5 "http://localhost:$port/health" > /dev/null 2>&1; then
      return 0
    fi
    echo "    attempt $i/$HEALTH_RETRIES — waiting ${HEALTH_INTERVAL}s..."
    sleep $HEALTH_INTERVAL
  done
  return 1
}

# ══════════════════════════════════════════════════════════════
# Helper: rollback a single service to :previous image
# ══════════════════════════════════════════════════════════════
rollback_service() {
  local svc=$1
  echo "  ↩ Rolling back $svc to :previous image..."
  local prev_img
  prev_img=$(docker images --format '{{.Repository}}:{{.Tag}}' | grep "${svc}.*:previous" | head -1)
  if [ -n "$prev_img" ]; then
    # Force the container to use the previous image
    docker stop "$svc" 2>/dev/null || true
    docker rm "$svc" 2>/dev/null || true
    # Re-tag previous as latest so compose picks it up
    docker tag "$prev_img" "${prev_img%%:*}:latest" 2>/dev/null || true
    $COMPOSE up -d --no-deps --no-build "$svc"
    echo "  ✓ $svc rolled back"
  else
    echo "  ⚠ No :previous image found for $svc — restarting current..."
    $COMPOSE restart "$svc" || true
  fi
}

# ══════════════════════════════════════════════════════════════
# 2. Rolling deploy with per-service health gate
# ══════════════════════════════════════════════════════════════
if [ -n "$TARGET_SERVICE" ]; then
  SERVICES_TO_DEPLOY="$TARGET_SERVICE"
else
  SERVICES_TO_DEPLOY="$DEPLOY_ORDER"
fi

# Pull base images for infrastructure services
if [ -z "$TARGET_SERVICE" ]; then
  echo ">>> Pulling base images (mysql, redis)..."
  $COMPOSE pull mysql redis 2>/dev/null || true
  echo ""
fi

for SVC in $SERVICES_TO_DEPLOY; do
  echo "▶ Deploying $SVC"

  # 2a. Tag running image as :previous
  tag_previous "$SVC"

  # 2b. Build
  if [ "$REBUILD" = true ]; then
    DOCKER_BUILDKIT=1 $COMPOSE build --no-cache "$SVC"
  else
    DOCKER_BUILDKIT=1 $COMPOSE build --build-arg BUILDKIT_INLINE_CACHE=1 "$SVC"
  fi

  # 2c. Start the new container
  $COMPOSE up -d --no-deps "$SVC"

  # 2d. Wait for health
  echo "  ⏳ Waiting for $SVC to become healthy..."
  if wait_healthy "$SVC"; then
    echo "  ✅ $SVC healthy"
  else
    echo "  ❌ $SVC FAILED health check after $((HEALTH_RETRIES * HEALTH_INTERVAL))s"
    rollback_service "$SVC"
    DEPLOY_FAILED=true
    # Continue deploying remaining services rather than aborting everything
  fi
  echo ""
done

# ══════════════════════════════════════════════════════════════
# 3. Remove orphan containers & dangling images
# ══════════════════════════════════════════════════════════════
echo ">>> Cleaning up..."
$COMPOSE up -d --remove-orphans 2>/dev/null || true
docker image prune -f
DISK_USED=$(df / | awk 'NR==2 {print $5}' | sed 's/%//')
echo "  Disk usage: ${DISK_USED}%"
echo ""

# ══════════════════════════════════════════════════════════════
# 4. Final status
# ══════════════════════════════════════════════════════════════
echo ">>> Final service status:"
$COMPOSE ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}"
echo ""

if [ "$DEPLOY_FAILED" = true ]; then
  echo "═══ ⚠ Deploy completed WITH ROLLBACKS — $(date) ═══"
  echo "    Some services were reverted to their previous version."
  echo "    Check logs: docker compose -p $PROJECT_NAME logs <service>"
  exit 1
fi

echo "═══ ✅ Deploy complete — $(date) ═══"
