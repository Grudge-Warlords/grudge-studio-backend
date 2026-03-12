#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# Grudge Studio — Idempotent SQL Migration Runner
#
# Usage:  bash scripts/migrate.sh
#
# - Reads MYSQL_ROOT_PASSWORD + MYSQL_DATABASE from /opt/grudge-studio-backend/.env
# - Applies every mysql/init/*.sql file in alphabetical order
# - Tracks applied migrations in grudge_migrations table (never re-runs)
# - Safe to run multiple times (idempotent)
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail

BASE=/opt/grudge-studio-backend
ENV_FILE="$BASE/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "[migrate] ERROR: $ENV_FILE not found" >&2
  exit 1
fi

# Parse .env (ignores comments and empty lines)
get_env() { grep -E "^${1}=" "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '\r\n'; }

PASS=$(get_env MYSQL_ROOT_PASSWORD)
DB=$(get_env MYSQL_DATABASE)
DB=${DB:-grudge_game}

if [[ -z "$PASS" ]]; then
  echo "[migrate] ERROR: MYSQL_ROOT_PASSWORD not set in .env" >&2
  exit 1
fi

MYSQL="docker exec grudge-mysql mysql -uroot -p${PASS} ${DB}"

# ── Ensure migration tracking table exists ─────────────────────────
$MYSQL -e "
CREATE TABLE IF NOT EXISTS grudge_migrations (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  filename   VARCHAR(255) NOT NULL UNIQUE,
  applied_at DATETIME     NOT NULL DEFAULT NOW()
);" 2>/dev/null || {
  echo "[migrate] WARNING: Could not create migrations table (MySQL may still be starting)" >&2
}

# ── Run each file ──────────────────────────────────────────────────
APPLIED=0
SKIPPED=0
FAILED=0

for FILE in $(ls "$BASE/mysql/init/"*.sql 2>/dev/null | sort); do
  FNAME=$(basename "$FILE")

  # Check if already applied
  COUNT=$($MYSQL -sN -e "SELECT COUNT(*) FROM grudge_migrations WHERE filename='$FNAME';" 2>/dev/null || echo "0")

  if [[ "$COUNT" =~ ^[0-9]+$ ]] && [[ "$COUNT" -gt 0 ]]; then
    echo "[migrate] SKIP  $FNAME (already applied)"
    SKIPPED=$((SKIPPED+1))
    continue
  fi

  echo "[migrate] APPLY $FNAME ..."
  if docker exec -i grudge-mysql mysql -uroot -p"${PASS}" "${DB}" < "$FILE" 2>&1; then
    $MYSQL -e "INSERT IGNORE INTO grudge_migrations (filename) VALUES ('$FNAME');" 2>/dev/null
    echo "[migrate] OK    $FNAME"
    APPLIED=$((APPLIED+1))
  else
    echo "[migrate] FAIL  $FNAME" >&2
    FAILED=$((FAILED+1))
  fi
done

echo ""
echo "[migrate] Done: ${APPLIED} applied, ${SKIPPED} skipped, ${FAILED} failed"
[[ $FAILED -eq 0 ]] || exit 1
