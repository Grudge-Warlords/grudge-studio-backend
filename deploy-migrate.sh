#!/usr/bin/env bash
set -e

BASE=/opt/grudge-studio-backend
PASS=$(grep MYSQL_ROOT_PASSWORD $BASE/.env | cut -d= -f2 | tr -d '\r\n')

echo "=== Applying SQL migrations ==="
docker exec grudge-mysql mysql -uroot -p"$PASS" grudge_game < $BASE/mysql/init/04-economy.sql
echo "04-economy OK"
docker exec grudge-mysql mysql -uroot -p"$PASS" grudge_game < $BASE/mysql/init/05-crafting.sql
echo "05-crafting OK"
docker exec grudge-mysql mysql -uroot -p"$PASS" grudge_game < $BASE/mysql/init/06-world.sql
echo "06-world OK"

echo "=== Rebuilding containers ==="
cd $BASE
docker compose build game-api grudge-id ws-service
docker compose up -d game-api grudge-id ws-service

echo "=== Verifying health ==="
sleep 5
curl -sf https://api.grudge-studio.com/health && echo " api OK" || echo " api FAIL"
curl -sf https://id.grudge-studio.com/health && echo " id OK" || echo " id FAIL"
curl -sf https://ws.grudge-studio.com/health && echo " ws OK" || echo " ws FAIL"

echo "=== Done ==="
