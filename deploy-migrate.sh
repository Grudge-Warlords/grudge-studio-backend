#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# Grudge Studio — Full Deploy + Migrate
# Run on VPS:  bash /opt/grudge-studio-backend/deploy-migrate.sh
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail

BASE=/opt/grudge-studio-backend
cd $BASE

# Optional: pull latest code if git repo is set up
if [[ -d .git ]]; then
  echo "=== Pulling latest code ==="
  git pull origin main
fi

echo ""
echo "=== Running SQL migrations ==="
bash $BASE/scripts/migrate.sh

echo ""
echo "=== Rolling deploy with health gate ==="
# Rebuild in dependency order — each service stays up while next builds
PROJECT="grudge-studio-backend"
COMPOSE="docker compose -p $PROJECT"
SERVICES="ai-agent wallet-service account-api launcher-api asset-service game-api grudge-id ws-service"

declare -A SVC_PORTS=(
  [grudge-id]=3001 [game-api]=3003 [ai-agent]=3004
  [account-api]=3005 [launcher-api]=3006 [ws-service]=3007
  [asset-service]=3008
)

DEPLOY_FAILED=false

for SVC in $SERVICES; do
  echo "  ▶ $SVC"

  # Tag current image as :previous
  IMG=$(docker inspect --format='{{.Config.Image}}' "$SVC" 2>/dev/null || true)
  if [ -n "$IMG" ] && [ "$IMG" != "<no value>" ]; then
    docker tag "$IMG" "${IMG%%:*}:previous" 2>/dev/null || true
  fi

  # Build and start
  DOCKER_BUILDKIT=1 $COMPOSE build --build-arg BUILDKIT_INLINE_CACHE=1 $SVC
  $COMPOSE up -d --no-deps $SVC

  # Health gate
  PORT=${SVC_PORTS[$SVC]:-}
  HEALTHY=false
  if [ -n "$PORT" ]; then
    for i in 1 2 3 4 5 6; do
      sleep 5
      if curl -sf --max-time 5 http://localhost:$PORT/health > /dev/null 2>&1; then
        HEALTHY=true; break
      fi
      echo "    attempt $i/6..."
    done
  else
    # No HTTP port — just check container is running
    sleep 5
    RUNNING=$(docker inspect --format='{{.State.Running}}' "$SVC" 2>/dev/null || echo "false")
    [ "$RUNNING" = "true" ] && HEALTHY=true
  fi

  if $HEALTHY; then
    echo "    ✅ $SVC healthy"
  else
    echo "    ❌ $SVC FAILED — rolling back"
    PREV=$(docker images --format '{{.Repository}}:{{.Tag}}' | grep "${SVC}.*:previous" | head -1)
    if [ -n "$PREV" ]; then
      docker stop "$SVC" 2>/dev/null || true
      docker rm "$SVC" 2>/dev/null || true
      docker tag "$PREV" "${PREV%%:*}:latest" 2>/dev/null || true
      $COMPOSE up -d --no-deps --no-build "$SVC"
      echo "    ↩ rolled back to :previous"
    else
      $COMPOSE restart "$SVC" || true
      echo "    ⚠ no :previous — restarted"
    fi
    DEPLOY_FAILED=true
  fi
done

echo ""
echo "=== Pruning old images ==="
$COMPOSE up -d --remove-orphans 2>/dev/null || true
docker image prune -f
docker container prune -f

echo ""
echo "=== Final status ==="
$COMPOSE ps --format "table {{.Name}}\t{{.Status}}"

echo ""
if [ "$DEPLOY_FAILED" = true ]; then
  echo "=== ⚠ Deploy completed WITH ROLLBACKS — check logs ==="
  exit 1
else
  echo "=== ✅ All services healthy. Deploy complete! ==="
fi
