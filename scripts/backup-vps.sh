#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Grudge Studio — VPS Automated Backup (v2)
#
# Backs up MySQL + Redis, uploads off-site to Cloudflare R2,
# optionally syncs R2 assets to a backup location.
#
# Usage:
#   bash /opt/grudge-studio-backend/scripts/backup-vps.sh
#
# Cron (daily at 3am UTC — installed by install-cron.sh):
#   0 3 * * * /opt/grudge-studio-backend/scripts/backup-vps.sh >> /var/log/grudge-backup.log 2>&1
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

ENV_FILE="/opt/grudge-studio-backend/.env"
BACKUP_DIR="/opt/grudge-studio-backend/backups"
RETENTION_LOCAL=14
RETENTION_R2=30
DATE=$(date +%Y-%m-%d_%H%M)
DISCORD_WEBHOOK=""
R2_STATUS="skipped"
REDIS_STATUS="skipped"

# ── Load .env ─────────────────────────────────────────────────────────────────
if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not found"
  exit 1
fi

get_env() { grep "^$1=" "$ENV_FILE" | cut -d= -f2- | tr -d '"' | tr -d "'" | xargs; }

MYSQL_ROOT_PASSWORD=$(get_env MYSQL_ROOT_PASSWORD)
MYSQL_DATABASE=$(get_env MYSQL_DATABASE)
REDIS_PASSWORD=$(get_env REDIS_PASSWORD)
DISCORD_WEBHOOK=$(get_env DISCORD_SYSTEM_WEBHOOK_TOKEN)

mkdir -p "$BACKUP_DIR"

echo "════════════════════════════════════════════════════"
echo "  Grudge Studio Backup v2 — $DATE"
echo "════════════════════════════════════════════════════"

# ── 1. MySQL dump ─────────────────────────────────────────────────────────────
DUMP_FILE="$BACKUP_DIR/grudge_game_${DATE}.sql.gz"
echo ""
echo "▶ MySQL dump → $DUMP_FILE"

docker exec grudge-mysql mysqldump \
  -uroot -p"$MYSQL_ROOT_PASSWORD" \
  --single-transaction \
  --routines \
  --triggers \
  --set-gtid-purged=OFF \
  "$MYSQL_DATABASE" | gzip > "$DUMP_FILE"

DUMP_SIZE=$(du -h "$DUMP_FILE" | cut -f1)
echo "  ✅ MySQL dump: $DUMP_SIZE"

# ── 2. Redis RDB snapshot ────────────────────────────────────────────────────
echo ""
echo "▶ Redis RDB backup"
if docker exec grudge-redis redis-cli -a "$REDIS_PASSWORD" BGSAVE 2>/dev/null | grep -q "Background saving started\|already in progress"; then
  sleep 3  # wait for BGSAVE
  REDIS_RDB="$BACKUP_DIR/redis_${DATE}.rdb"
  docker cp grudge-redis:/data/dump.rdb "$REDIS_RDB" 2>/dev/null && {
    REDIS_SIZE=$(du -h "$REDIS_RDB" | cut -f1)
    REDIS_STATUS="✅ $REDIS_SIZE"
    echo "  ✅ Redis RDB: $REDIS_SIZE"
  } || {
    REDIS_STATUS="⚠️ copy failed"
    echo "  ⚠️ Could not copy dump.rdb from container"
  }
else
  REDIS_STATUS="⚠️ BGSAVE failed"
  echo "  ⚠️ Redis BGSAVE command failed"
fi

# ── 3. Clean old LOCAL backups ───────────────────────────────────────────────
echo ""
echo "▶ Cleaning local backups older than $RETENTION_LOCAL days"
DELETED_SQL=$(find "$BACKUP_DIR" -name "*.sql.gz" -mtime +$RETENTION_LOCAL -delete -print | wc -l)
DELETED_RDB=$(find "$BACKUP_DIR" -name "*.rdb" -mtime +$RETENTION_LOCAL -delete -print | wc -l)
DELETED=$((DELETED_SQL + DELETED_RDB))
echo "  Deleted: $DELETED old backups"

# ── 4. Off-site backup to Cloudflare R2 ──────────────────────────────────────
if command -v rclone &> /dev/null; then
  R2_KEY=$(get_env OBJECT_STORAGE_KEY)
  R2_SECRET=$(get_env OBJECT_STORAGE_SECRET)
  CF_ACCOUNT=$(get_env CF_ACCOUNT_ID)

  if [ -n "$R2_KEY" ] && [ -n "$R2_SECRET" ] && [ -n "$CF_ACCOUNT" ]; then
    echo ""
    echo "▶ Uploading to R2 (grudge-backups bucket)"

    export RCLONE_CONFIG_R2_TYPE=s3
    export RCLONE_CONFIG_R2_PROVIDER=Cloudflare
    export RCLONE_CONFIG_R2_ENDPOINT="https://${CF_ACCOUNT}.r2.cloudflarestorage.com"
    export RCLONE_CONFIG_R2_ACCESS_KEY_ID="$R2_KEY"
    export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$R2_SECRET"
    export RCLONE_CONFIG_R2_REGION=auto

    # Upload MySQL dump
    rclone copy "$DUMP_FILE" r2:grudge-backups/mysql/ --quiet && {
      echo "  ✅ MySQL dump uploaded to R2"
    } || {
      echo "  ⚠️ MySQL R2 upload failed"
    }

    # Upload Redis RDB (if exists)
    if [ -f "$REDIS_RDB" ]; then
      rclone copy "$REDIS_RDB" r2:grudge-backups/redis/ --quiet && {
        echo "  ✅ Redis RDB uploaded to R2"
      } || {
        echo "  ⚠️ Redis R2 upload failed"
      }
    fi

    # Prune old R2 backups (keep RETENTION_R2 days)
    echo "  ▶ Pruning R2 backups older than $RETENTION_R2 days"
    rclone delete r2:grudge-backups/mysql/ --min-age "${RETENTION_R2}d" --quiet 2>/dev/null || true
    rclone delete r2:grudge-backups/redis/ --min-age "${RETENTION_R2}d" --quiet 2>/dev/null || true

    # Optional: Sync R2 avatars locally
    R2_BACKUP="$BACKUP_DIR/r2-avatars"
    mkdir -p "$R2_BACKUP"
    rclone sync r2:grudge-assets/avatars "$R2_BACKUP" \
      --transfers 8 --checkers 16 --fast-list --quiet 2>/dev/null || true
    R2_COUNT=$(find "$R2_BACKUP" -type f 2>/dev/null | wc -l)

    R2_STATUS="✅ uploaded (${R2_COUNT} avatars synced)"
    echo "  ✅ R2 sync complete: $R2_COUNT avatar files"
  else
    echo ""
    echo "  ⏭  R2 off-site backup skipped (credentials not set)"
    R2_STATUS="⏭ credentials missing"
  fi
else
  echo ""
  echo "  ⏭  R2 off-site backup skipped (rclone not installed)"
  R2_STATUS="⏭ rclone not installed"
fi

# ── 5. Discord notification ──────────────────────────────────────────────────
if [ -n "$DISCORD_WEBHOOK" ]; then
  curl -sf -X POST "$DISCORD_WEBHOOK" \
    -H "Content-Type: application/json" \
    -d "{
      \"embeds\": [{
        \"title\": \"🗄️ Grudge Studio — Backup Complete\",
        \"color\": 4978687,
        \"fields\": [
          {\"name\": \"MySQL Dump\", \"value\": \"$DUMP_SIZE\", \"inline\": true},
          {\"name\": \"Redis RDB\", \"value\": \"$REDIS_STATUS\", \"inline\": true},
          {\"name\": \"Off-site (R2)\", \"value\": \"$R2_STATUS\", \"inline\": true},
          {\"name\": \"Local Retention\", \"value\": \"${RETENTION_LOCAL}d local / ${RETENTION_R2}d R2\", \"inline\": true},
          {\"name\": \"Old Removed\", \"value\": \"$DELETED\", \"inline\": true}
        ],
        \"footer\": {\"text\": \"VPS: $(hostname) — $DATE\"}
      }]
    }" > /dev/null 2>&1 || true
fi

echo ""
echo "════════════════════════════════════════════════════"
echo "  Backup complete"
echo "════════════════════════════════════════════════════"
