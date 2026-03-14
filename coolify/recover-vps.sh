#!/usr/bin/env bash
set -euo pipefail

# ═══════════════════════════════════════════════════════════════
# Grudge Studio — VPS Recovery Script
# Run via VPS provider console (IONOS KVM/VNC) when SSH is down
#
# Common failure modes this addresses:
#   - Coolify Traefik consuming all RAM → OOM kills sshd
#   - Docker consuming all disk → services crash
#   - Firewall misconfiguration → SSH blocked
#   - SSL cert renewal failed → HTTPS down
# ═══════════════════════════════════════════════════════════════

echo "═══ Grudge Studio — VPS Recovery ═══"
echo ""

BACKEND_DIR="/opt/grudge-studio-backend"

# ── Step 1: Restore SSH access ────────────────────────────────
echo ">>> Restoring SSH access..."
systemctl restart sshd 2>/dev/null || service ssh restart 2>/dev/null || true
ufw allow ssh 2>/dev/null || true
echo "  SSH service restarted"

# ── Step 2: Check/free memory ─────────────────────────────────
echo ">>> Memory status:"
free -h
echo ""

MEM_AVAIL=$(awk '/MemAvailable/ {print $2}' /proc/meminfo)
if [ "$MEM_AVAIL" -lt 204800 ]; then  # Less than 200MB
  echo "  ⚠ LOW MEMORY — stopping non-critical containers..."
  # Stop services in reverse priority (keep MySQL/Redis running)
  for svc in uptime-kuma grudge-headless ai-agent-service asset-service ws-service launcher-api; do
    docker stop "$svc" 2>/dev/null || true
  done
  echo "  Freed memory. Remaining services: grudge-id, game-api, account-api, wallet-service, mysql, redis"
fi

# ── Step 3: Check/free disk ───────────────────────────────────
echo ">>> Disk status:"
df -h /
echo ""

DISK_USED=$(df / | awk 'NR==2 {print $5}' | sed 's/%//')
if [ "$DISK_USED" -gt 90 ]; then
  echo "  ⚠ DISK NEARLY FULL — cleaning up..."
  # Docker cleanup
  docker system prune -af 2>/dev/null || true
  # Clear old logs
  truncate -s 0 /var/log/grudge-health.log 2>/dev/null || true
  find /var/log -name '*.gz' -delete 2>/dev/null || true
  journalctl --vacuum-time=1d 2>/dev/null || true
  echo "  Cleanup done. New disk status:"
  df -h /
fi

# ── Step 4: Restart Docker ────────────────────────────────────
echo ">>> Restarting Docker daemon..."
systemctl restart docker
sleep 5

# ── Step 5: Restart Coolify ──────────────────────────────────
echo ">>> Restarting Coolify..."
if [ -f /data/coolify/source/docker-compose.yml ]; then
  cd /data/coolify/source
  docker compose --env-file .env -f docker-compose.yml -f docker-compose.prod.yml up -d --remove-orphans
  echo "  Coolify restarted"
else
  echo "  Coolify not found — run setup-vps.sh first"
fi

# ── Step 6: Restart Grudge services ──────────────────────────
echo ">>> Restarting Grudge Studio services..."
if [ -d "$BACKEND_DIR" ]; then
  cd "$BACKEND_DIR"
  docker compose down --remove-orphans 2>/dev/null || true
  sleep 3
  docker compose up -d
  sleep 10
  docker compose ps
else
  echo "  Backend not found at $BACKEND_DIR — clone it first"
fi

# ── Step 7: Verify SSL certs ─────────────────────────────────
echo ""
echo ">>> SSL certificate check..."
for domain in id.grudge-studio.com api.grudge-studio.com account.grudge-studio.com; do
  EXPIRY=$(echo | openssl s_client -servername "$domain" -connect "$domain":443 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
  if [ -n "$EXPIRY" ]; then
    echo "  $domain → expires $EXPIRY"
  else
    echo "  $domain → ✗ NO CERT (Traefik may need restart or DNS not pointing here)"
  fi
done

# ── Summary ───────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════"
echo "  RECOVERY COMPLETE"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "  Try SSH: ssh -i ~/.ssh/coolify_vps grudge_deploy@$(hostname -I | awk '{print $1}')"
echo "  Services: docker compose -f $BACKEND_DIR/docker-compose.yml ps"
echo "  Logs:     docker compose -f $BACKEND_DIR/docker-compose.yml logs -f --tail=50"
echo ""
echo "  If SSH still fails:"
echo "    1. Check: ufw status"
echo "    2. Check: cat /etc/ssh/sshd_config | grep -E 'Port|PasswordAuth|PubkeyAuth'"
echo "    3. Temp fix: ufw disable && systemctl restart sshd"
echo ""
