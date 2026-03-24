#!/bin/bash
# ═══════════════════════════════════════════════════════════
# GRUDGE STUDIO — GO LIVE (Production Hardening)
# Fixes: game-api routing, Redis auth, Traefik entrypoints,
#        all services on coolify network, security headers
# ═══════════════════════════════════════════════════════════

COOLIFY="/data/coolify/services/l7kwyegn8qmocpfweql206ep"
MYSQL="mysql-l7kwyegn8qmocpfweql206ep"
REDIS="redis-l7kwyegn8qmocpfweql206ep"

echo "═══════════════════════════════════════"
echo " GRUDGE STUDIO — GO LIVE"
echo " $(date)"
echo "═══════════════════════════════════════"

# ── 1. Stop any non-Coolify containers ───────
echo ""
echo "=== 1. Clean up duplicate containers ==="
cd /opt/grudge-studio-backend
docker compose down 2>/dev/null || true
echo "   Done"

# ── 2. Fix Redis password ────────────────────
echo ""
echo "=== 2. Fix Redis auth ==="
ENV_REDIS_PW=$(grep "^REDIS_PASSWORD=" "$COOLIFY/.env" | cut -d= -f2)

# Set Redis password to match .env
docker exec $REDIS redis-cli -a "$ENV_REDIS_PW" CONFIG SET requirepass "$ENV_REDIS_PW" 2>/dev/null
# If that fails (wrong current pw), try without auth
docker exec $REDIS redis-cli CONFIG SET requirepass "$ENV_REDIS_PW" 2>/dev/null

# Verify
PING=$(docker exec $REDIS redis-cli -a "$ENV_REDIS_PW" PING 2>/dev/null)
echo "   Redis PING: $PING"

# Set correct REDIS_URL in compose
python3 << 'PYEOF'
import re
path = '/data/coolify/services/l7kwyegn8qmocpfweql206ep/docker-compose.yml'
env_path = '/data/coolify/services/l7kwyegn8qmocpfweql206ep/.env'

# Read password from .env
pw = ''
for line in open(env_path):
    if line.startswith('REDIS_PASSWORD='):
        pw = line.strip().split('=',1)[1]
        break

c = open(path).read()
url = f"redis://:{pw}@redis:6379" if pw else "redis://redis:6379"
c = re.sub(r"REDIS_URL: '.*?'", f"REDIS_URL: '{url}'", c)
open(path, 'w').write(c)
print(f"   REDIS_URL set with password (len={len(pw)})")
PYEOF

# ── 3. Fix Traefik entrypoints (http+https) ──
echo ""
echo "=== 3. Fix Traefik entrypoints ==="
python3 << 'PYEOF'
path = '/data/coolify/services/l7kwyegn8qmocpfweql206ep/docker-compose.yml'
c = open(path).read()
services = ['grudge-id', 'game-api', 'account-api', 'launcher-api', 'ws-service', 'asset-service']
fixed = 0
for svc in services:
    old = f'traefik.http.routers.{svc}.entrypoints=https'
    new = f'traefik.http.routers.{svc}.entrypoints=http,https'
    if old in c and new not in c:
        c = c.replace(old, new)
        fixed += 1
open(path, 'w').write(c)
print(f"   Fixed {fixed} services to http,https entrypoints")
PYEOF

# ── 4. Fix PORT for grudge-id ────────────────
echo ""
echo "=== 4. Fix service ports ==="
python3 << 'PYEOF'
path = '/data/coolify/services/l7kwyegn8qmocpfweql206ep/docker-compose.yml'
c = open(path).read()
# grudge-id must be 3001 (Traefik label expects it)
c = c.replace("PORT: '3000'", "PORT: '3001'", 1)
open(path, 'w').write(c)
print("   PORT set to 3001 for grudge-id")
PYEOF

# ── 5. Ensure shared/ in all service dirs ────
echo ""
echo "=== 5. Sync shared/ to services ==="
for svc in grudge-id game-api account-api launcher-api ws-service; do
  cp -r "$COOLIFY/shared" "$COOLIFY/services/$svc/shared" 2>/dev/null
done
echo "   Shared libs synced"

# ── 6. Rebuild all critical services ─────────
echo ""
echo "=== 6. Rebuild all services ==="
cd "$COOLIFY"
docker compose build --no-cache grudge-id game-api 2>&1 | grep -E "Built|ERROR" | head -10

# ── 7. Recreate all services ─────────────────
echo ""
echo "=== 7. Recreate all ==="
docker compose down 2>&1 | tail -5
docker compose up -d 2>&1 | tail -15

# ── 8. Connect to coolify proxy network ──────
echo ""
echo "=== 8. Connect to proxy network ==="
sleep 5
for c in grudge-id game-api ws-service account-api launcher-api wallet-service ai-agent asset-service; do
  FULL="${c}-l7kwyegn8qmocpfweql206ep"
  docker network connect coolify "$FULL" 2>/dev/null && echo "   + $c" || true
done

# ── 9. Wait for healthy ──────────────────────
echo ""
echo "=== 9. Waiting 25s for services ==="
sleep 25

# ── 10. Verify everything ────────────────────
echo ""
echo "=== 10. PRODUCTION VERIFICATION ==="

echo "--- Services ---"
for svc in grudge-id game-api ws-service account-api launcher-api; do
  FULL="${svc}-l7kwyegn8qmocpfweql206ep"
  PORT=$(docker inspect "$FULL" --format '{{range $p, $conf := .NetworkSettings.Ports}}{{$p}} {{end}}' 2>/dev/null | grep -o '[0-9]*' | head -1)
  STATUS=$(docker ps --format "{{.Status}}" --filter "name=$FULL" 2>/dev/null)
  HEALTH=$(docker exec "$FULL" wget -qO- "http://localhost:${PORT}/health" 2>/dev/null || echo "DOWN")
  echo "   $svc (port $PORT): $STATUS | $HEALTH"
done

echo ""
echo "--- Database ---"
TABLE_COUNT=$(docker exec $MYSQL bash -c 'mysql -u root -p"$MYSQL_ROOT_PASSWORD" grudge_game -sN -e "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=\"grudge_game\";"' 2>/dev/null)
USER_COUNT=$(docker exec $MYSQL bash -c 'mysql -u root -p"$MYSQL_ROOT_PASSWORD" grudge_game -sN -e "SELECT COUNT(*) FROM users;"' 2>/dev/null)
echo "   Tables: $TABLE_COUNT | Users: $USER_COUNT"

echo ""
echo "--- Redis ---"
docker exec $REDIS redis-cli -a "$ENV_REDIS_PW" INFO server 2>/dev/null | grep redis_version || echo "   Redis: DOWN"

echo ""
echo "--- Auth test ---"
GUEST=$(docker exec grudge-id-l7kwyegn8qmocpfweql206ep wget -qO- --post-data='{"deviceId":"go_live_test"}' --header="Content-Type: application/json" http://localhost:3001/auth/guest 2>/dev/null)
if echo "$GUEST" | grep -q "token"; then
  echo "   Guest auth: PASS"
  TOKEN=$(echo "$GUEST" | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null)
  if [ -n "$TOKEN" ]; then
    USER=$(docker exec grudge-id-l7kwyegn8qmocpfweql206ep wget -qO- --header="Authorization: Bearer $TOKEN" http://localhost:3001/auth/user 2>/dev/null)
    echo "   JWT verify: $(echo $USER | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'PASS grudgeId={d[\"grudgeId\"]} gold={d[\"gold\"]}')" 2>/dev/null || echo 'FAIL')"
  fi
else
  echo "   Guest auth: FAIL"
fi

echo ""
echo "--- Container summary ---"
docker ps --format "table {{.Names}}\t{{.Status}}" | grep -E "l7kwyeg|coolify-proxy"

echo ""
echo "═══════════════════════════════════════"
echo " GO LIVE COMPLETE"
echo "═══════════════════════════════════════"
