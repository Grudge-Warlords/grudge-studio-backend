#!/bin/bash
MYSQL="mysql-l7kwyegn8qmocpfweql206ep"
COOLIFY="/data/coolify/services/l7kwyegn8qmocpfweql206ep"

echo "═══════════════════════════════════════"
echo " FIX: Run all init scripts + fix Redis"
echo "═══════════════════════════════════════"

# ── 1. Run all SQL init scripts ──────────────
echo ""
echo "=== 1. Running all init SQL scripts ==="
for sql in /tmp/0*.sql /tmp/1*.sql; do
  if [ -f "$sql" ]; then
    NAME=$(basename "$sql")
    cat "$sql" | docker exec -i $MYSQL bash -c 'mysql -u root -p"$MYSQL_ROOT_PASSWORD"' 2>/dev/null
    EXIT=$?
    if [ $EXIT -eq 0 ]; then
      echo "   OK  $NAME"
    else
      echo "   ERR $NAME (exit $EXIT)"
    fi
  fi
done

# ── 2. Verify all tables ────────────────────
echo ""
echo "=== 2. All tables ==="
docker exec $MYSQL bash -c 'mysql -u root -p"$MYSQL_ROOT_PASSWORD" grudge_game -e "SHOW TABLES;"' 2>/dev/null

# ── 3. Fix Redis — check if password needed ─
echo ""
echo "=== 3. Fix Redis for game-api ==="
REDIS="redis-l7kwyegn8qmocpfweql206ep"

# Test if Redis needs auth
REDIS_PING=$(docker exec $REDIS redis-cli PING 2>/dev/null)
if [ "$REDIS_PING" = "PONG" ]; then
  echo "   Redis has NO auth — use passwordless URL"
  REDIS_URL="redis://redis:6379"
else
  # Try with password from .env
  REDIS_PW=$(grep "^REDIS_PASSWORD=" "$COOLIFY/.env" | cut -d= -f2)
  REDIS_AUTH=$(docker exec $REDIS redis-cli -a "$REDIS_PW" PING 2>/dev/null)
  if [ "$REDIS_AUTH" = "PONG" ]; then
    echo "   Redis needs password — using from .env"
    REDIS_URL="redis://:${REDIS_PW}@redis:6379"
  else
    echo "   Redis auth failed — setting password"
    docker exec $REDIS redis-cli CONFIG SET requirepass "$REDIS_PW" 2>/dev/null
    REDIS_URL="redis://:${REDIS_PW}@redis:6379"
  fi
fi

# Update compose with correct Redis URL
python3 -c "
import re
path = '$COOLIFY/docker-compose.yml'
c = open(path).read()
# Replace any REDIS_URL line
c = re.sub(r\"REDIS_URL: '.*?'\", \"REDIS_URL: '$REDIS_URL'\", c)
open(path, 'w').write(c)
print('   Compose REDIS_URL set to: $REDIS_URL')
" 2>/dev/null

# ── 4. Rebuild + restart game-api ────────────
echo ""
echo "=== 4. Rebuild game-api ==="
cd "$COOLIFY"

# Copy shared to game-api too
cp -r shared services/game-api/shared 2>/dev/null

# Fix require path in game-api index.js
sed -i "s|require('../../shared/cors')|require('../shared/cors')|g" services/game-api/src/index.js 2>/dev/null
sed -i "s|require('./shared/cors')|require('../shared/cors')|g" services/game-api/src/index.js 2>/dev/null

# Update game-api Dockerfile to include shared
python3 -c "
path = '$COOLIFY/services/game-api/Dockerfile'
c = open(path).read()
if 'COPY shared' not in c:
    c = c.replace('COPY src ./src', 'COPY shared ./shared\nCOPY src ./src')
    open(path, 'w').write(c)
    print('   game-api Dockerfile patched')
else:
    print('   game-api Dockerfile OK')
" 2>/dev/null

docker compose build --no-cache game-api 2>&1 | tail -3
docker compose stop game-api 2>/dev/null
docker compose rm -f game-api 2>/dev/null
docker compose up -d game-api 2>&1 | tail -5
docker network connect coolify game-api-l7kwyegn8qmocpfweql206ep 2>/dev/null || true

# ── 5. Wait and verify ──────────────────────
echo ""
echo "=== 5. Waiting 20s ==="
sleep 20

echo ""
echo "=== 6. Final checks ==="
echo "--- Table count ---"
docker exec $MYSQL bash -c 'mysql -u root -p"$MYSQL_ROOT_PASSWORD" grudge_game -sN -e "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=\"grudge_game\";"' 2>/dev/null
echo " tables"

echo "--- Service health ---"
docker exec grudge-id-l7kwyegn8qmocpfweql206ep wget -qO- http://localhost:3001/health 2>/dev/null && echo "" || echo "grudge-id: DOWN"
docker exec game-api-l7kwyegn8qmocpfweql206ep wget -qO- http://localhost:3003/health 2>/dev/null && echo "" || echo "game-api: DOWN"

echo "--- game-api logs ---"
docker logs game-api-l7kwyegn8qmocpfweql206ep --tail 5 2>&1

echo ""
echo "═══════════════════════════════════════"
echo " ALL FIXES COMPLETE"
echo "═══════════════════════════════════════"
