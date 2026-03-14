#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Grudge Studio — Install Cron Jobs on VPS
#
# Idempotent — safe to re-run. Installs:
#   1. Daily MySQL+Redis backup at 3am UTC
#   2. Hourly health-check ping to all services
#
# Usage:
#   sudo bash /opt/grudge-studio-backend/scripts/install-cron.sh
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

BASE="/opt/grudge-studio-backend"
CRON_ID="# grudge-studio-cron"
CRON_FILE="/etc/cron.d/grudge-studio"

echo "▶ Installing Grudge Studio cron jobs..."

cat > "$CRON_FILE" <<EOF
# Grudge Studio — Automated Tasks
# Managed by install-cron.sh — do not edit manually
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# Daily backup at 3am UTC (MySQL + Redis → local + R2)
0 3 * * * root $BASE/scripts/backup-vps.sh >> /var/log/grudge-backup.log 2>&1

# Hourly health-check ping (hits all /health endpoints, alerts Discord)
15 * * * * root $BASE/scripts/health-ping.sh >> /var/log/grudge-health.log 2>&1

# Weekly log rotation (keep 4 weeks)
0 4 * * 0 root find /var/log/grudge-*.log -size +10M -exec truncate -s 0 {} \;
EOF

chmod 644 "$CRON_FILE"

# Make scripts executable
chmod +x "$BASE/scripts/backup-vps.sh" 2>/dev/null || true
chmod +x "$BASE/scripts/health-ping.sh" 2>/dev/null || true

# Ensure log files exist
touch /var/log/grudge-backup.log /var/log/grudge-health.log

echo "✅ Cron jobs installed at $CRON_FILE"
echo ""
echo "  • Daily 3:00 UTC — backup-vps.sh"
echo "  • Hourly :15    — health-ping.sh"
echo "  • Weekly Sun    — log rotation"
echo ""
echo "Verify with: cat $CRON_FILE"
