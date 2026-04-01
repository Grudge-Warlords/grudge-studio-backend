#!/bin/bash
set -euo pipefail

TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Trigger Redis BGSAVE
docker exec grudge-redis redis-cli -a "${REDIS_PASSWORD}" BGSAVE

# Wait for save
sleep 5

# Copy RDB file
docker cp grudge-redis:/data/dump.rdb /tmp/redis_${TIMESTAMP}.rdb

# Upload to MinIO
docker exec -i grudge-minio mc pipe local/grudge-game-data/backups/redis/redis_${TIMESTAMP}.rdb < /tmp/redis_${TIMESTAMP}.rdb

# Cleanup
rm -f /tmp/redis_${TIMESTAMP}.rdb

# Keep last 14
docker exec grudge-minio mc ls local/grudge-game-data/backups/redis/ \
  | sort | head -n -14 | awk '{print $NF}' | while read f; do
    docker exec grudge-minio mc rm "local/grudge-game-data/backups/redis/$f" 2>/dev/null || true
  done

echo "[$(date)] Redis backup complete: redis_${TIMESTAMP}.rdb"
