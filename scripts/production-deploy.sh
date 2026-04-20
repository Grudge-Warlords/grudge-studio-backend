#!/bin/bash
# ═══════════════════════════════════════════════════════════
# GRUDGE STUDIO — Production Deployment (Best Practices)
# Run on VPS: bash /tmp/production-deploy.sh
# ═══════════════════════════════════════════════════════════

echo "═══════════════════════════════════════════"
echo " GRUDGE STUDIO PRODUCTION DEPLOY"
echo " $(date)"
echo "═══════════════════════════════════════════"
echo ""

# ── Step 1: Stop duplicate docker-compose stack ──────────
echo "=== 1. Stop duplicate docker-compose stack ==="
cd /opt/grudge-studio-backend
docker compose down 2>/dev/null || true
echo "   Non-Coolify containers stopped"

# ── Step 2: Pull latest code from GitHub ─────────────────
echo ""
echo "=== 2. Pull latest code ==="
cd /opt/grudge-studio-backend
git pull origin main 2>/dev/null || echo "   git pull skipped (not a git repo or no remote)"

# ── Step 3: Sync source to Coolify service directory ─────
echo ""
echo "=== 3. Sync source code to Coolify ==="
COOLIFY_DIR="/data/coolify/services/l7kwyegn8qmocpfweql206ep"
if [ -d "$COOLIFY_DIR" ]; then
  # Sync service source
  for svc in grudge-id game-api ai-agent account-api launcher-api ws-service wallet-service asset-service; do
    if [ -d "/opt/grudge-studio-backend/services/$svc/src" ]; then
      cp -r "/opt/grudge-studio-backend/services/$svc/src" "$COOLIFY_DIR/services/$svc/src" 2>/dev/null
      cp "/opt/grudge-studio-backend/services/$svc/package.json" "$COOLIFY_DIR/services/$svc/package.json" 2>/dev/null
      echo "   Synced $svc"
    fi
  done
  # Sync shared libs
  cp -r /opt/grudge-studio-backend/shared/* "$COOLIFY_DIR/shared/" 2>/dev/null
  echo "   Synced shared/"
else
  echo "   WARNING: Coolify directory not found"
fi

# ── Step 4: Fix Redis URL (no password needed) ───────────
echo ""
echo "=== 4. Verify Coolify compose config ==="
cd "$COOLIFY_DIR"
# Check Redis URL
REDIS_REFS=$(grep -c "grudge-redis" docker-compose.yml 2>/dev/null)
if [ "$REDIS_REFS" -gt 0 ]; then
  python3 -c "
c = open('docker-compose.yml').read()
c = c.replace('grudge-redis:6379', 'redis:6379')
open('docker-compose.yml','w').write(c)
print('   Fixed grudge-redis -> redis')
" 2>/dev/null
else
  echo "   Redis hostname OK"
fi

# ── Step 5: Verify .env has all auth vars ────────────────
echo ""
echo "=== 5. Verify auth env vars ==="
REQUIRED_VARS="DISCORD_CLIENT_ID GOOGLE_CLIENT_ID GITHUB_CLIENT_ID TWILIO_VERIFY_SID ANTHROPIC_API_KEY CROSSMINT_SERVER_API_KEY JWT_SECRET MYSQL_PASSWORD REDIS_PASSWORD"
MISSING=0
for var in $REQUIRED_VARS; do
  if grep -q "^${var}=" "$COOLIFY_DIR/.env" 2>/dev/null; then
    echo "   OK $var"
  else
    echo "   MISSING $var"
    MISSING=$((MISSING + 1))
  fi
done
echo "   $MISSING missing vars"

# ── Step 6: Rebuild and recreate critical services ───────
echo ""
echo "=== 6. Rebuild services ==="
cd "$COOLIFY_DIR"
docker compose build grudge-id game-api 2>&1 | tail -5
echo ""

echo "=== 7. Recreate services ==="
docker compose stop grudge-id game-api 2>/dev/null
docker compose rm -f grudge-id game-api 2>/dev/null
docker compose up -d 2>&1 | tail -15
echo ""

# ── Step 8: Connect to coolify proxy network ─────────────
echo "=== 8. Connect to proxy network ==="
for container in grudge-id game-api ws-service account-api launcher-api wallet-service ai-agent asset-service; do
  FULL="${container}-l7kwyegn8qmocpfweql206ep"
  docker network connect coolify "$FULL" 2>/dev/null && echo "   Connected $FULL" || echo "   $FULL already connected"
done

# ── Step 9: Wait for health ──────────────────────────────
echo ""
echo "=== 9. Waiting 20s for services ==="
sleep 20

# ── Step 10: Health checks ───────────────────────────────
echo ""
echo "=== 10. Health checks ==="
for svc in grudge-id game-api ws-service account-api launcher-api; do
  FULL="${svc}-l7kwyegn8qmocpfweql206ep"
  PORT=$(docker inspect "$FULL" --format '{{range $p, $conf := .NetworkSettings.Ports}}{{$p}} {{end}}' 2>/dev/null | grep -o '[0-9]*' | head -1)
  RESULT=$(docker exec "$FULL" wget -qO- "http://localhost:${PORT}/health" 2>/dev/null || echo "DOWN")
  echo "   $svc ($PORT): $RESULT"
done

echo ""
echo "=== 11. Auth env vars in grudge-id ==="
docker exec grudge-id-l7kwyegn8qmocpfweql206ep env 2>/dev/null | grep -cE "GOOGLE|GITHUB|TWILIO|ANTHROPIC|CROSSMINT_SERVER"
echo "   auth vars injected"

echo ""
echo "=== 12. Container status ==="
docker ps --format "table {{.Names}}\t{{.Status}}" | grep -E "l7kwyeg|coolify-proxy"

echo ""
echo "=== 13. Disk usage ==="
df -h / | tail -1
docker system df 2>/dev/null | head -5

echo ""
echo "═══════════════════════════════════════════"
echo " PRODUCTION DEPLOY COMPLETE"
echo "═══════════════════════════════════════════"
