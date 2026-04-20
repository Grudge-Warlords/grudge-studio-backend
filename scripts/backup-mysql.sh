#!/bin/bash
# Daily MySQL backup to MinIO
set -euo pipefail

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="/tmp/grudge_game_${TIMESTAMP}.sql.gz"

# Dump MySQL
docker exec grudge-mysql mysqldump \
  -u root -p"${MYSQL_ROOT_PASSWORD}" \
  --single-transaction \
  --routines \
  --triggers \
  grudge_game | gzip > "$BACKUP_FILE"

# Upload to MinIO
docker exec -i grudge-minio mc pipe local/grudge-game-data/backups/mysql/grudge_game_${TIMESTAMP}.sql.gz < "$BACKUP_FILE"

# Cleanup local
rm -f "$BACKUP_FILE"

# Keep only last 30 backups in MinIO
docker exec grudge-minio mc ls local/grudge-game-data/backups/mysql/ \
  | sort | head -n -30 | awk '{print $NF}' | while read f; do
    docker exec grudge-minio mc rm "local/grudge-game-data/backups/mysql/$f" 2>/dev/null || true
  done

echo "[$(date)] MySQL backup complete: grudge_game_${TIMESTAMP}.sql.gz"
