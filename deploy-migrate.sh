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
echo "=== Rolling deploy ==="
# Rebuild in dependency order — each service stays up while next builds
SERVICES="ai-agent wallet-service account-api launcher-api asset-service game-api grudge-id ws-service"

for SVC in $SERVICES; do
  echo "  ▶ $SVC"
  DOCKER_BUILDKIT=1 docker compose build --build-arg BUILDKIT_INLINE_CACHE=1 $SVC
  docker compose up -d --no-deps $SVC
  sleep 2
done

echo ""
echo "=== Pruning old images ==="
docker image prune -f
docker container prune -f

echo ""
echo "=== Health checks ==="
sleep 10
FAIL=0

check() {
  local NAME=$1 PORT=$2
  for i in 1 2 3; do
    if curl -sf http://localhost:$PORT/health > /dev/null 2>&1; then
      echo "  ✅ $NAME"; return 0
    fi
    sleep 4
  done
  echo "  ❌ $NAME (port $PORT) FAILED"
  FAIL=$((FAIL+1))
}

check grudge-id    3001
check game-api     3003
check ai-agent     3004
check account-api  3005
check launcher-api 3006
check ws-service   3007
check asset-service 3008

echo ""
if [[ $FAIL -eq 0 ]]; then
  echo "=== All services healthy. Deploy complete! ==="
else
  echo "=== WARNING: $FAIL service(s) failed health check ==="
  exit 1
fi
