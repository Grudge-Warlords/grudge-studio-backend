#!/bin/bash
set -e
cd /opt/grudge-studio-backend

PW=$(grep "^MYSQL_PASSWORD=" .env | cut -d= -f2)
echo "=== Setting grudge_admin password ==="
docker exec grudge-mysql bash -c "mysql -u root -p\"\${MYSQL_ROOT_PASSWORD}\" -e \"ALTER USER 'grudge_admin'@'%' IDENTIFIED WITH mysql_native_password BY '${PW}'; FLUSH PRIVILEGES;\""

echo "=== Testing connection ==="
docker exec grudge-mysql bash -c "mysql -u grudge_admin -p'${PW}' grudge_game -e 'SELECT COUNT(*) as user_count FROM users;'"

echo "=== Restarting grudge-id + game-api ==="
docker compose restart grudge-id game-api

echo "=== Waiting 15s ==="
sleep 15

echo "=== Health checks ==="
curl -sf https://id.grudge-studio.com/health && echo "" || echo "id: DOWN"
curl -sf https://api.grudge-studio.com/health && echo "" || echo "api: DOWN"
echo "=== DONE ==="
