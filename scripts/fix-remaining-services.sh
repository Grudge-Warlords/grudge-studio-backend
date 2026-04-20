#!/bin/bash
COOLIFY="/data/coolify/services/l7kwyegn8qmocpfweql206ep"
cd "$COOLIFY"

echo "=== Fix remaining services (without full down) ==="

# Recreate each service individually — preserves network
for svc in game-api ws-service account-api launcher-api; do
  echo ""
  echo "--- Recreating $svc ---"
  docker compose stop $svc 2>/dev/null
  docker compose rm -f $svc 2>/dev/null
  docker compose up -d $svc 2>&1 | tail -3
  docker network connect coolify "${svc}-l7kwyegn8qmocpfweql206ep" 2>/dev/null || true
done

echo ""
echo "=== Waiting 25s ==="
sleep 25

echo ""
echo "=== Health checks ==="
for svc in grudge-id game-api ws-service account-api launcher-api; do
  FULL="${svc}-l7kwyegn8qmocpfweql206ep"
  PORT=$(docker inspect "$FULL" --format '{{range $p, $conf := .NetworkSettings.Ports}}{{$p}} {{end}}' 2>/dev/null | grep -o '[0-9]*' | head -1)
  HEALTH=$(docker exec "$FULL" wget -qO- "http://localhost:${PORT}/health" 2>/dev/null || echo "DOWN")
  echo "  $svc: $HEALTH"
done

echo ""
echo "=== Proxy connectivity ==="
docker exec coolify-proxy wget -qO- --timeout=5 http://grudge-id-l7kwyegn8qmocpfweql206ep:3001/health 2>/dev/null && echo "  proxy->id: OK" || echo "  proxy->id: FAIL"
docker exec coolify-proxy wget -qO- --timeout=5 http://game-api-l7kwyegn8qmocpfweql206ep:3003/health 2>/dev/null && echo "  proxy->api: OK" || echo "  proxy->api: FAIL"
docker exec coolify-proxy wget -qO- --timeout=5 http://ws-service-l7kwyegn8qmocpfweql206ep:3007/health 2>/dev/null && echo "  proxy->ws: OK" || echo "  proxy->ws: FAIL"
docker exec coolify-proxy wget -qO- --timeout=5 http://launcher-api-l7kwyegn8qmocpfweql206ep:3006/health 2>/dev/null && echo "  proxy->launcher: OK" || echo "  proxy->launcher: FAIL"

echo ""
echo "=== DONE ==="
