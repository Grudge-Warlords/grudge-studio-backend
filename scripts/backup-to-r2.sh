#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Grudge Studio — MySQL Backup to Cloudflare R2
# Dumps MySQL, compresses, uploads to R2 for offsite disaster recovery.
# Keeps last 7 daily + last 4 weekly backups in R2.
#
# Prerequisites on VPS:
#   apt install -y awscli
#   aws configure --profile grudge-r2
#     AWS Access Key ID:      (R2 token key ID)
#     AWS Secret Access Key:  (R2 token secret)
#     Default region:         auto
#     Default output:         json
#
# Cron (add to VPS):
#   0 5 * * * /opt/grudge-studio-backend/scripts/backup-to-r2.sh >> /var/log/grudge-backup-r2.log 2>&1
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── Configuration ──────────────────────────────────────────────────────────────
MYSQL_HOST="${MYSQL_HOST:-grudge-mysql}"
MYSQL_PORT="${MYSQL_PORT:-3306}"
MYSQL_USER="${MYSQL_USER:-root}"
MYSQL_PASS="${MYSQL_ROOT_PASSWORD:-}"
MYSQL_DB="${MYSQL_DB:-grudge_game}"

R2_BUCKET="grudge-assets"
R2_PREFIX="backups/mysql"
R2_ENDPOINT="https://ee475864561b02d4588180b8b9acf694.r2.cloudflarestorage.com"
R2_PROFILE="${R2_PROFILE:-grudge-r2}"

BACKUP_DIR="/tmp/grudge-backup"
KEEP_DAILY=7
KEEP_WEEKLY=4

# ── Timestamps ─────────────────────────────────────────────────────────────────
NOW=$(date +%Y%m%d-%H%M%S)
DOW=$(date +%u)  # 1=Monday, 7=Sunday
FILENAME="grudge-mysql-${NOW}.sql.gz"

echo "════════════════════════════════════════════════════"
echo "  Grudge Studio — Backup to R2"
echo "  ${NOW}"
echo "════════════════════════════════════════════════════"

# ── Dump MySQL ─────────────────────────────────────────────────────────────────
mkdir -p "$BACKUP_DIR"
echo "▶ Dumping ${MYSQL_DB}..."

mysqldump \
  -h "$MYSQL_HOST" \
  -P "$MYSQL_PORT" \
  -u "$MYSQL_USER" \
  ${MYSQL_PASS:+-p"$MYSQL_PASS"} \
  --single-transaction \
  --routines \
  --triggers \
  --events \
  "$MYSQL_DB" | gzip > "${BACKUP_DIR}/${FILENAME}"

SIZE=$(du -h "${BACKUP_DIR}/${FILENAME}" | cut -f1)
echo "  ✅ Dump complete: ${FILENAME} (${SIZE})"

# ── Upload to R2 (daily) ──────────────────────────────────────────────────────
echo "▶ Uploading to R2: ${R2_PREFIX}/daily/${FILENAME}"
aws s3 cp \
  "${BACKUP_DIR}/${FILENAME}" \
  "s3://${R2_BUCKET}/${R2_PREFIX}/daily/${FILENAME}" \
  --endpoint-url "$R2_ENDPOINT" \
  --profile "$R2_PROFILE" \
  --quiet

echo "  ✅ Daily backup uploaded"

# ── Weekly backup (Sunday) ─────────────────────────────────────────────────────
if [ "$DOW" -eq 7 ]; then
  WEEKLY_NAME="grudge-mysql-weekly-${NOW}.sql.gz"
  echo "▶ Uploading weekly backup: ${R2_PREFIX}/weekly/${WEEKLY_NAME}"
  aws s3 cp \
    "${BACKUP_DIR}/${FILENAME}" \
    "s3://${R2_BUCKET}/${R2_PREFIX}/weekly/${WEEKLY_NAME}" \
    --endpoint-url "$R2_ENDPOINT" \
    --profile "$R2_PROFILE" \
    --quiet
  echo "  ✅ Weekly backup uploaded"
fi

# ── Prune old daily backups ────────────────────────────────────────────────────
echo "▶ Pruning old daily backups (keeping ${KEEP_DAILY})..."
DAILY_LIST=$(aws s3 ls "s3://${R2_BUCKET}/${R2_PREFIX}/daily/" \
  --endpoint-url "$R2_ENDPOINT" \
  --profile "$R2_PROFILE" 2>/dev/null | sort -r | awk '{print $4}')

COUNT=0
for f in $DAILY_LIST; do
  COUNT=$((COUNT + 1))
  if [ $COUNT -gt $KEEP_DAILY ]; then
    echo "  🗑️  Removing ${f}"
    aws s3 rm "s3://${R2_BUCKET}/${R2_PREFIX}/daily/${f}" \
      --endpoint-url "$R2_ENDPOINT" \
      --profile "$R2_PROFILE" \
      --quiet
  fi
done

# ── Prune old weekly backups ───────────────────────────────────────────────────
echo "▶ Pruning old weekly backups (keeping ${KEEP_WEEKLY})..."
WEEKLY_LIST=$(aws s3 ls "s3://${R2_BUCKET}/${R2_PREFIX}/weekly/" \
  --endpoint-url "$R2_ENDPOINT" \
  --profile "$R2_PROFILE" 2>/dev/null | sort -r | awk '{print $4}')

COUNT=0
for f in $WEEKLY_LIST; do
  COUNT=$((COUNT + 1))
  if [ $COUNT -gt $KEEP_WEEKLY ]; then
    echo "  🗑️  Removing ${f}"
    aws s3 rm "s3://${R2_BUCKET}/${R2_PREFIX}/weekly/${f}" \
      --endpoint-url "$R2_ENDPOINT" \
      --profile "$R2_PROFILE" \
      --quiet
  fi
done

# ── Cleanup local temp ────────────────────────────────────────────────────────
rm -f "${BACKUP_DIR}/${FILENAME}"
echo ""
echo "════════════════════════════════════════════════════"
echo "  ✅ Backup complete — ${SIZE} uploaded to R2"
echo "════════════════════════════════════════════════════"
