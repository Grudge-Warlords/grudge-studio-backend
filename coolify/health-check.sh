#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# Grudge Studio — Service Health Check
# Run manually or via cron: */5 * * * * /opt/grudge-studio-backend/coolify/health-check.sh
# ═══════════════════════════════════════════════════════════════

BACKEND_DIR="${BACKEND_DIR:-/opt/grudge-studio-backend}"
LOG_FILE="/var/log/grudge-health.log"
AUTO_RESTART="${AUTO_RESTART:-false}"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"; }

# Services to check: name, port, health endpoint
declare -A SERVICES=(
  ["grudge-id"]="3001:/health"
  ["game-api"]="3003:/health"
  ["account-api"]="3005:/health"
  ["launcher-api"]="3006:/health"
  ["ws-service"]="3007:/health"
  ["asset-service"]="3008:/health"
)

# Internal-only services (no HTTP endpoint, check container status)
INTERNAL_SERVICES=("wallet-service" "ai-agent-service")

# Infrastructure services
INFRA_SERVICES=("mysql" "redis" "uptime-kuma")

FAILED=0
TOTAL=0

log "═══ Health Check Starting ═══"

# ── Check HTTP services ───────────────────────────────────────
for svc in "${!SERVICES[@]}"; do
  IFS=':' read -r port path <<< "${SERVICES[$svc]}"
  TOTAL=$((TOTAL + 1))
  
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "http://localhost:${port}${path}" 2>/dev/null)
  
  if [ "$HTTP_CODE" = "200" ]; then
    log "  ✓ $svc (port $port) — OK"
  else
    FAILED=$((FAILED + 1))
    log "  ✗ $svc (port $port) — FAILED (HTTP $HTTP_CODE)"
    
    if [ "$AUTO_RESTART" = "true" ]; then
      log "    → Restarting $svc..."
      cd "$BACKEND_DIR" && docker compose restart "$svc" 2>>"$LOG_FILE"
      sleep 5
      # Re-check
      HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "http://localhost:${port}${path}" 2>/dev/null)
      if [ "$HTTP_CODE" = "200" ]; then
        log "    → $svc recovered after restart"
        FAILED=$((FAILED - 1))
      else
        log "    → $svc STILL DOWN after restart"
      fi
    fi
  fi
done

# ── Check internal services (container status only) ───────────
for svc in "${INTERNAL_SERVICES[@]}"; do
  TOTAL=$((TOTAL + 1))
  STATUS=$(docker inspect --format='{{.State.Status}}' "$svc" 2>/dev/null || echo "not_found")
  
  if [ "$STATUS" = "running" ]; then
    log "  ✓ $svc — running"
  else
    FAILED=$((FAILED + 1))
    log "  ✗ $svc — $STATUS"
    
    if [ "$AUTO_RESTART" = "true" ]; then
      log "    → Restarting $svc..."
      cd "$BACKEND_DIR" && docker compose restart "$svc" 2>>"$LOG_FILE"
    fi
  fi
done

# ── Check infrastructure ─────────────────────────────────────
for svc in "${INFRA_SERVICES[@]}"; do
  TOTAL=$((TOTAL + 1))
  STATUS=$(docker inspect --format='{{.State.Status}}' "$svc" 2>/dev/null || echo "not_found")
  
  if [ "$STATUS" = "running" ]; then
    log "  ✓ $svc — running"
  else
    FAILED=$((FAILED + 1))
    log "  ✗ $svc — $STATUS (CRITICAL)"
    
    if [ "$AUTO_RESTART" = "true" ]; then
      log "    → Restarting $svc..."
      cd "$BACKEND_DIR" && docker compose restart "$svc" 2>>"$LOG_FILE"
    fi
  fi
done

# ── Check disk space ─────────────────────────────────────────
DISK_USED=$(df / | awk 'NR==2 {print $5}' | sed 's/%//')
if [ "$DISK_USED" -gt 85 ]; then
  log "  ⚠ Disk usage: ${DISK_USED}% — consider pruning Docker images"
  log "    → Run: docker system prune -af --volumes"
fi

# ── Summary ───────────────────────────────────────────────────
log "═══ Health Check Complete: $((TOTAL - FAILED))/$TOTAL services healthy ═══"

if [ "$FAILED" -gt 0 ]; then
  exit 1
fi
exit 0
