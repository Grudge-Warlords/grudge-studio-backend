#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Grudge Studio — VPS Automated Backup
#
# Backs up MySQL database and optionally syncs R2 assets to a backup location.
# Designed to run via cron on the IONOS VPS.
#
# Usage:
#   bash /opt/grudge-studio-backend/scripts/backup-vps.sh
#
# Cron (daily at 3am UTC):
#   0 3 * * * /opt/grudge-studio-backend/scripts/backup-vps.sh >> /var/log/grudge-backup.log 2>&1
#
# Prereqs:
#   - docker running with grudge-mysql container
#   - .env at /opt/grudge-studio-backend/.env
#   - rclone installed (optional, for R2 sync)
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

ENV_FILE="/opt/grudge-studio-backend/.env"
BACKUP_DIR="/opt/grudge-studio-backend/backups"
RETENTION_DAYS=14
DATE=$(date +%Y-%m-%d_%H%M)
DISCORD_WEBHOOK=""

# ── Load .env ─────────────────────────────────────────────────────────────────
if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not found"
  exit 1
fi

get_env() { grep "^$1=" "$ENV_FILE" | cut -d= -f2- | tr -d '"' | tr -d "'" | xargs; }

MYSQL_ROOT_PASSWORD=$(get_env MYSQL_ROOT_PASSWORD)
MYSQL_DATABASE=$(get_env MYSQL_DATABASE)
DISCORD_WEBHOOK=$(get_env DISCORD_SYSTEM_WEBHOOK_TOKEN)

mkdir -p "$BACKUP_DIR"

echo "════════════════════════════════════════════════════"
echo "  Grudge Studio Backup — $DATE"
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

# ── 2. Clean old backups ─────────────────────────────────────────────────────
echo ""
echo "▶ Cleaning backups older than $RETENTION_DAYS days"
DELETED=$(find "$BACKUP_DIR" -name "*.sql.gz" -mtime +$RETENTION_DAYS -delete -print | wc -l)
echo "  Deleted: $DELETED old backups"

# ── 3. R2 asset backup (optional — requires rclone) ─────────────────────────
if command -v rclone &> /dev/null; then
  R2_KEY=$(get_env OBJECT_STORAGE_KEY)
  R2_SECRET=$(get_env OBJECT_STORAGE_SECRET)
  CF_ACCOUNT=$(get_env CF_ACCOUNT_ID)

  if [ -n "$R2_KEY" ] && [ -n "$R2_SECRET" ] && [ -n "$CF_ACCOUNT" ]; then
    echo ""
    echo "▶ Syncing R2 avatars → local backup"

    export RCLONE_CONFIG_R2_TYPE=s3
    export RCLONE_CONFIG_R2_PROVIDER=Cloudflare
    export RCLONE_CONFIG_R2_ENDPOINT="https://${CF_ACCOUNT}.r2.cloudflarestorage.com"
    export RCLONE_CONFIG_R2_ACCESS_KEY_ID="$R2_KEY"
    export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$R2_SECRET"
    export RCLONE_CONFIG_R2_REGION=auto

    R2_BACKUP="$BACKUP_DIR/r2-avatars"
    mkdir -p "$R2_BACKUP"

    rclone sync r2:grudge-assets/avatars "$R2_BACKUP" \
      --transfers 8 --checkers 16 --fast-list --quiet

    R2_COUNT=$(find "$R2_BACKUP" -type f | wc -l)
    echo "  ✅ R2 avatars synced: $R2_COUNT files"
  else
    echo ""
    echo "  ⏭  R2 sync skipped (credentials not set)"
  fi
else
  echo ""
  echo "  ⏭  R2 sync skipped (rclone not installed)"
fi

# ── 4. Discord notification ──────────────────────────────────────────────────
if [ -n "$DISCORD_WEBHOOK" ]; then
  curl -sf -X POST "$DISCORD_WEBHOOK" \
    -H "Content-Type: application/json" \
    -d "{
      \"embeds\": [{
        \"title\": \"🗄️ Grudge Studio — Backup Complete\",
        \"color\": 4978687,
        \"fields\": [
          {\"name\": \"Database\", \"value\": \"$DUMP_SIZE\", \"inline\": true},
          {\"name\": \"Retention\", \"value\": \"${RETENTION_DAYS}d\", \"inline\": true},
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
