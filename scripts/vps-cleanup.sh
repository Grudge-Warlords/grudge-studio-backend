#!/bin/bash
# Grudge Studio VPS Cleanup — Best Practices
# Stops duplicate docker-compose containers, syncs Coolify as source of truth

set -e
echo "=== STEP 1: Stop all docker-compose containers ==="
cd /opt/grudge-studio-backend
docker compose down 2>/dev/null || true
echo "Docker-compose stack stopped"

echo ""
echo "=== STEP 2: Verify only Coolify containers remain ==="
docker ps --format "table {{.Names}}\t{{.Status}}" | grep -E "l7kwyeg|coolify" || echo "No Coolify containers?"

echo ""
echo "=== STEP 3: Update Coolify CORS origins ==="
COOLIFY_ENV="/data/coolify/services/l7kwyegn8qmocpfweql206ep/.env"
# Check if client/wallet already in CORS
if grep -q "client.grudge-studio.com" "$COOLIFY_ENV"; then
  echo "CORS already has client.grudge-studio.com"
else
  # Update CORS line to include new subdomains + all frontends
  sed -i 's|CORS_ORIGINS=.*|CORS_ORIGINS=https://grudgewarlords.com,https://www.grudgewarlords.com,https://grudge-studio.com,https://grudgestudio.com,https://client.grudge-studio.com,https://wallet.grudge-studio.com,https://grudge-platform.vercel.app,https://grudgeplatform.com,https://www.grudgeplatform.com,https://grudachain.grudgestudio.com,https://grudachain.grudge-studio.com,https://grudachain-rho.vercel.app,https://dash.grudge-studio.com,https://warlord-crafting-suite.vercel.app,https://grudgedot-launcher.vercel.app,https://gruda-wars.vercel.app,https://grudge-engine-web.vercel.app,https://starwaygruda-webclient-as2n.vercel.app,https://grim-armada-web.vercel.app,https://grudge-angeler.vercel.app,https://grudge-rts.vercel.app,https://grudge-studio-dash.vercel.app,https://nexus-nemesis-game.vercel.app,https://grudge-pvp-server.vercel.app,https://grudge-origins.vercel.app,https://app.puter.com,https://molochdagod.github.io|' "$COOLIFY_ENV"
  echo "CORS updated with all origins"
fi

echo ""
echo "=== STEP 4: Add DOMAIN_CLIENT + DOMAIN_WALLET if missing ==="
grep -q "DOMAIN_CLIENT" "$COOLIFY_ENV" || echo "DOMAIN_CLIENT=client.grudge-studio.com" >> "$COOLIFY_ENV"
grep -q "DOMAIN_WALLET" "$COOLIFY_ENV" || echo "DOMAIN_WALLET=wallet.grudge-studio.com" >> "$COOLIFY_ENV"
echo "Domain vars present"

echo ""
echo "=== STEP 5: Recreate grudge-id + game-api to pick up new env ==="
cd /data/coolify/services/l7kwyegn8qmocpfweql206ep
docker compose stop grudge-id game-api 2>/dev/null
docker compose rm -f grudge-id game-api 2>/dev/null
docker compose up -d grudge-id game-api
echo "Services recreated"

echo ""
echo "=== STEP 6: Wait for health (20s) ==="
sleep 20

echo ""
echo "=== STEP 7: Health checks ==="
curl -sf https://id.grudge-studio.com/health && echo "" || echo "id: DOWN"
curl -sf https://api.grudge-studio.com/health && echo "" || echo "api: DOWN"
curl -sf https://ws.grudge-studio.com/health && echo "" || echo "ws: DOWN"
curl -sf https://launcher.grudge-studio.com/health && echo "" || echo "launcher: DOWN"
curl -sf https://assets.grudge-studio.com/health && echo "" || echo "assets: DOWN"

echo ""
echo "=== STEP 8: Verify auth env vars in grudge-id ==="
docker exec grudge-id-l7kwyegn8qmocpfweql206ep env | grep -cE "GOOGLE|GITHUB|TWILIO|ANTHROPIC|CROSSMINT_SERVER"
echo "auth env vars found"

echo ""
echo "=== STEP 9: Final container list ==="
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | head -20

echo ""
echo "=== CLEANUP COMPLETE ==="
