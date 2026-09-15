#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Grudge Studio — Restore MySQL from Cloudflare R2 Backup
#
# Downloads a backup from R2 and restores it into the grudge-mysql container.
# By default restores the latest daily backup; pass a filename to restore a
# specific backup.
#
# Usage:
#   bash /opt/grudge-studio-backend/scripts/restore-from-r2.sh
#   bash /opt/grudge-studio-backend/scripts/restore-from-r2.sh grudge-mysql-20260319-030000.sql.gz
#   bash /opt/grudge-studio-backend/scripts/restore-from-r2.sh --weekly
#
# Prerequisites:
#   apt install -y awscli
#   aws configure --profile grudge-r2 (same as backup-to-r2.sh)
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── Configuration ──────────────────────────────────────────────────────────────
ENV_FILE="${ENV_FILE:-/opt/grudge-studio-backend/.env}"

R2_BUCKET="grudge-assets"
R2_PREFIX="backups/mysql"
R2_ENDPOINT="https://ee475864561b02d4588180b8b9acf694.r2.cloudflarestorage.com"
R2_PROFILE="${R2_PROFILE:-grudge-r2}"

RESTORE_DIR="/tmp/grudge-restore"
MYSQL_CONTAINER="grudge-mysql"

# ── Load DB credentials from .env ──────────────────────────────────────────────
MYSQL_ROOT_PASSWORD=""
MYSQL_DATABASE="grudge_game"
if [ -f "$ENV_FILE" ]; then
  MYSQL_ROOT_PASSWORD=$(grep "^MYSQL_ROOT_PASSWORD=" "$ENV_FILE" | cut -d= -f2- | tr -d '"' | tr -d "'" | xargs)
  MYSQL_DATABASE=$(grep "^MYSQL_DATABASE=" "$ENV_FILE" | cut -d= -f2- | tr -d '"' | tr -d "'" | xargs)
fi

if [ -z "$MYSQL_ROOT_PASSWORD" ]; then
  echo "❌ MYSQL_ROOT_PASSWORD not found in $ENV_FILE"
  exit 1
fi

echo "════════════════════════════════════════════════════"
echo "  Grudge Studio — Restore from R2"
echo "  $(date '+%Y-%m-%d %H:%M UTC')"
echo "════════════════════════════════════════════════════"
echo ""

# ── Determine which backup to restore ──────────────────────────────────────────
SUBFOLDER="daily"
SPECIFIC_FILE=""

if [ "${1:-}" = "--weekly" ]; then
  SUBFOLDER="weekly"
  shift
elif [ -n "${1:-}" ]; then
  SPECIFIC_FILE="$1"
fi

if [ -z "$SPECIFIC_FILE" ]; then
  echo "▶ Listing latest $SUBFOLDER backups from R2..."
  LATEST=$(aws s3 ls "s3://${R2_BUCKET}/${R2_PREFIX}/${SUBFOLDER}/" \
    --endpoint-url "$R2_ENDPOINT" \
    --profile "$R2_PROFILE" 2>/dev/null | sort -r | head -1 | awk '{print $4}')

  if [ -z "$LATEST" ]; then
    echo "❌ No backups found in s3://${R2_BUCKET}/${R2_PREFIX}/${SUBFOLDER}/"
    exit 1
  fi
  SPECIFIC_FILE="$LATEST"
  echo "  Latest: $SPECIFIC_FILE"
fi

R2_PATH="${R2_PREFIX}/${SUBFOLDER}/${SPECIFIC_FILE}"

# ── Download ───────────────────────────────────────────────────────────────────
mkdir -p "$RESTORE_DIR"
LOCAL_FILE="${RESTORE_DIR}/${SPECIFIC_FILE}"

echo ""
echo "▶ Downloading s3://${R2_BUCKET}/${R2_PATH}..."
aws s3 cp \
  "s3://${R2_BUCKET}/${R2_PATH}" \
  "$LOCAL_FILE" \
  --endpoint-url "$R2_ENDPOINT" \
  --profile "$R2_PROFILE"

SIZE=$(du -h "$LOCAL_FILE" | cut -f1)
echo "  ✅ Downloaded: ${SPECIFIC_FILE} (${SIZE})"

# ── Safety confirmation ────────────────────────────────────────────────────────
echo ""
echo "⚠️  WARNING: This will DROP and recreate the '${MYSQL_DATABASE}' database."
echo "   Container: ${MYSQL_CONTAINER}"
echo "   Backup:    ${SPECIFIC_FILE}"
echo ""
read -p "Type 'RESTORE' to proceed: " CONFIRM

if [ "$CONFIRM" != "RESTORE" ]; then
  echo "❌ Aborted."
  rm -f "$LOCAL_FILE"
  exit 1
fi

# ── Restore ────────────────────────────────────────────────────────────────────
echo ""
echo "▶ Restoring ${SPECIFIC_FILE} into ${MYSQL_CONTAINER}..."

# Drop and recreate database
docker exec "$MYSQL_CONTAINER" mysql -uroot -p"$MYSQL_ROOT_PASSWORD" \
  -e "DROP DATABASE IF EXISTS \`${MYSQL_DATABASE}\`; CREATE DATABASE \`${MYSQL_DATABASE}\`;"

# Decompress and pipe into MySQL
gunzip -c "$LOCAL_FILE" | docker exec -i "$MYSQL_CONTAINER" mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"

echo "  ✅ Database restored successfully"

# ── Verify ─────────────────────────────────────────────────────────────────────
echo ""
echo "▶ Verifying restore..."
TABLE_COUNT=$(docker exec "$MYSQL_CONTAINER" mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE" \
  -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${MYSQL_DATABASE}';")
USER_COUNT=$(docker exec "$MYSQL_CONTAINER" mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE" \
  -N -e "SELECT COUNT(*) FROM users;" 2>/dev/null || echo "N/A")

echo "  Tables: ${TABLE_COUNT}"
echo "  Users:  ${USER_COUNT}"

# ── Cleanup ────────────────────────────────────────────────────────────────────
rm -f "$LOCAL_FILE"

echo ""
echo "════════════════════════════════════════════════════"
echo "  ✅ Restore complete — ${MYSQL_DATABASE} restored from ${SPECIFIC_FILE}"
echo ""
echo "  Next steps:"
echo "    docker compose restart game-api account-api grudge-id"
echo "════════════════════════════════════════════════════"
