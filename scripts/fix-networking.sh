#!/bin/bash
# Fix networking: connect Coolify service containers to the main coolify proxy network
# Fix: rate-limit trust proxy header

echo "=== Connect containers to coolify proxy network ==="
for container in grudge-id game-api ws-service account-api launcher-api wallet-service ai-agent asset-service; do
  FULL="${container}-l7kwyegn8qmocpfweql206ep"
  if docker ps --format '{{.Names}}' | grep -q "$FULL"; then
    docker network connect coolify "$FULL" 2>/dev/null && echo "  Connected $FULL to coolify" || echo "  $FULL already on coolify"
  fi
done

echo ""
echo "=== Verify grudge-id networks ==="
docker inspect grudge-id-l7kwyegn8qmocpfweql206ep --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}'

echo ""
echo "=== Containers on coolify network ==="
docker network inspect coolify --format '{{range .Containers}}{{.Name}} {{end}}'

echo ""
echo "=== Test internal connectivity ==="
curl -sf http://grudge-id-l7kwyegn8qmocpfweql206ep:3001/health 2>/dev/null && echo "internal:3001 OK" || echo "internal:3001 FAIL"

echo ""
echo "=== Wait 10s for Traefik to discover ==="
sleep 10

echo ""
echo "=== External health checks ==="
curl -sf https://id.grudge-studio.com/health && echo "" || echo "id: DOWN"
curl -sf https://api.grudge-studio.com/health && echo "" || echo "api: DOWN"
curl -sf https://ws.grudge-studio.com/health && echo "" || echo "ws: DOWN"
curl -sf https://launcher.grudge-studio.com/health && echo "" || echo "launcher: DOWN"

echo ""
echo "=== DONE ==="
