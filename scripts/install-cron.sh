#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Grudge Studio — Install Cron Jobs on VPS
#
# Idempotent — safe to re-run. Installs:
#   1. MySQL backup every 6 hours (local + R2)
#   2. Full VPS backup daily at 3am UTC
#   3. Health check every 5 minutes with auto-restart
#   4. Hourly health ping to Discord
#   5. Daily log cleanup
#   6. Weekly Docker cleanup
#   7. Daily VPS status report
#
# Usage:
#   sudo bash /opt/grudge-studio-backend/scripts/install-cron.sh
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

BASE="/opt/grudge-studio-backend"
CRON_FILE="/etc/cron.d/grudge-studio"
BACKUP_DIR="/opt/grudge-backups"
LOG_DIR="/var/log"

echo "▶ Installing Grudge Studio cron jobs..."
echo ""

# ── Create backup directory ───────────────────────────────
mkdir -p "$BACKUP_DIR"
echo "  Backup directory: $BACKUP_DIR"

# ── Create the MySQL backup script ───────────────────────
cat > "$BASE/scripts/backup-mysql.sh" <<'BACKUP_EOF'
#!/usr/bin/env bash
# Quick MySQL backup — called by cron every 6 hours
set -uo pipefail

BACKUP_DIR="/opt/grudge-backups"
BACKEND_DIR="/opt/grudge-studio-backend"
MYSQL_CONTAINER="grudge-mysql"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/grudge_game_${TIMESTAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

echo "[$(date)] Starting MySQL backup..."

# Dump and compress
if docker exec "$MYSQL_CONTAINER" bash -c 'mysqldump -u root -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines --triggers grudge_game' 2>/dev/null | gzip > "$BACKUP_FILE"; then
  SIZE=$(du -sh "$BACKUP_FILE" | cut -f1)
  echo "[$(date)] ✅ Backup saved: $BACKUP_FILE ($SIZE)"
else
  echo "[$(date)] ❌ Backup FAILED"
  rm -f "$BACKUP_FILE"
  exit 1
fi

# Upload to R2 if backup-to-r2.sh exists
if [ -f "$BACKEND_DIR/scripts/backup-to-r2.sh" ]; then
  bash "$BACKEND_DIR/scripts/backup-to-r2.sh" "$BACKUP_FILE" 2>&1 || echo "  ⚠ R2 upload failed (non-fatal)"
fi

# Retain last 28 backups (7 days × 4 per day)
ls -t "$BACKUP_DIR"/grudge_game_*.sql.gz 2>/dev/null | tail -n +29 | xargs rm -f 2>/dev/null || true

REMAINING=$(ls "$BACKUP_DIR"/*.sql.gz 2>/dev/null | wc -l)
echo "[$(date)] Retention: $REMAINING backups on disk"
BACKUP_EOF
chmod +x "$BASE/scripts/backup-mysql.sh"
echo "  Created: scripts/backup-mysql.sh"

# ── Create the auto-restart health check ─────────────────
cat > "$BASE/scripts/health-autorestart.sh" <<'HEALTH_EOF'
#!/usr/bin/env bash
# Quick health check with auto-restart — runs every 5 min
set -uo pipefail

BACKEND_DIR="/opt/grudge-studio-backend"
PROJECT="grudge-studio-backend"
COMPOSE="docker compose -p $PROJECT"

declare -A SVC_PORTS=(
  [grudge-id]=3001
  [game-api]=3003
  [account-api]=3005
  [launcher-api]=3006
  [ws-service]=3007
  [asset-service]=3008
)

RESTARTED=""

for SVC in "${!SVC_PORTS[@]}"; do
  PORT=${SVC_PORTS[$SVC]}
  if ! curl -sf --max-time 5 "http://localhost:$PORT/health" > /dev/null 2>&1; then
    # Double-check: is the container even running?
    RUNNING=$(docker inspect --format='{{.State.Running}}' "$SVC" 2>/dev/null || echo "false")
    if [ "$RUNNING" != "true" ]; then
      echo "[$(date)] ❌ $SVC is DOWN — restarting..."
      cd "$BACKEND_DIR" && $COMPOSE up -d --no-deps "$SVC" 2>/dev/null
      RESTARTED="$RESTARTED $SVC"
    else
      # Container running but unhealthy — retry once more
      sleep 5
      if ! curl -sf --max-time 5 "http://localhost:$PORT/health" > /dev/null 2>&1; then
        echo "[$(date)] ⚠ $SVC unhealthy — restarting..."
        cd "$BACKEND_DIR" && $COMPOSE restart "$SVC" 2>/dev/null
        RESTARTED="$RESTARTED $SVC"
      fi
    fi
  fi
done

if [ -n "$RESTARTED" ]; then
  echo "[$(date)] Restarted:$RESTARTED"
fi
HEALTH_EOF
chmod +x "$BASE/scripts/health-autorestart.sh"
echo "  Created: scripts/health-autorestart.sh"

# ── Install the cron file ─────────────────────────────────
cat > "$CRON_FILE" <<EOF
# ═══════════════════════════════════════════════════════════
# Grudge Studio — Automated Tasks
# Managed by install-cron.sh — do not edit manually
# Re-run: sudo bash $BASE/scripts/install-cron.sh
# ═══════════════════════════════════════════════════════════
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# ── Backups ───────────────────────────────────────────────
# MySQL backup every 6 hours (local + R2, retains 28 = 7 days)
0 */6 * * * root $BASE/scripts/backup-mysql.sh >> $LOG_DIR/grudge-backup.log 2>&1

# Full VPS backup daily at 3am UTC (MySQL + Redis + volumes)
0 3 * * * root $BASE/scripts/backup-vps.sh >> $LOG_DIR/grudge-backup.log 2>&1

# ── Monitoring ────────────────────────────────────────────
# Health check every 5 min — auto-restarts failed services
*/5 * * * * root $BASE/scripts/health-autorestart.sh >> $LOG_DIR/grudge-health.log 2>&1

# Hourly health ping — hits all endpoints, alerts Discord
15 * * * * root $BASE/scripts/health-ping.sh >> $LOG_DIR/grudge-health.log 2>&1

# Daily status report at 8am UTC
0 8 * * * root $BASE/scripts/vps-status.sh >> $LOG_DIR/grudge-status.log 2>&1

# ── Cleanup ───────────────────────────────────────────────
# Daily log rotation — truncate logs over 50MB
0 4 * * * root find $LOG_DIR/grudge-*.log -size +50M -exec truncate -s 0 {} \;

# Weekly Docker cleanup — prune unused images, stopped containers
0 5 * * 0 root docker image prune -f >> $LOG_DIR/grudge-cleanup.log 2>&1 && docker container prune -f >> $LOG_DIR/grudge-cleanup.log 2>&1

# Monthly old backup cleanup — remove backups older than 30 days
0 6 1 * * root find $BACKUP_DIR -name '*.sql.gz' -mtime +30 -delete 2>/dev/null
EOF

chmod 644 "$CRON_FILE"

# Make all scripts executable
for script in backup-vps.sh backup-mysql.sh backup-to-r2.sh health-ping.sh health-autorestart.sh vps-status.sh deploy-headless.sh; do
  chmod +x "$BASE/scripts/$script" 2>/dev/null || true
done

# Ensure log files exist
touch $LOG_DIR/grudge-backup.log $LOG_DIR/grudge-health.log $LOG_DIR/grudge-status.log $LOG_DIR/grudge-cleanup.log

echo ""
echo "✅ Cron jobs installed at $CRON_FILE"
echo ""
echo "  Backups:"
echo "    • Every 6h    — MySQL backup (scripts/backup-mysql.sh)"
echo "    • Daily 3am   — Full VPS backup (scripts/backup-vps.sh)"
echo ""
echo "  Monitoring:"
echo "    • Every 5min  — Health auto-restart (scripts/health-autorestart.sh)"
echo "    • Hourly :15  — Health ping + Discord alert (scripts/health-ping.sh)"
echo "    • Daily 8am   — Status report (scripts/vps-status.sh)"
echo ""
echo "  Cleanup:"
echo "    • Daily 4am   — Log rotation (50MB cap)"
echo "    • Weekly Sun   — Docker image/container prune"
echo "    • Monthly 1st — Old backup cleanup (30 day retention)"
echo ""
echo "  Backup dir: $BACKUP_DIR"
echo "  Logs: $LOG_DIR/grudge-*.log"
echo ""
echo "Verify with: cat $CRON_FILE"
