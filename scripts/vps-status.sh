#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# Grudge Studio — VPS Status Dashboard
# Single command to check the health of all services and infra.
#
# Usage (on VPS):
#   bash /opt/grudge-studio-backend/scripts/vps-status.sh
#   bash /opt/grudge-studio-backend/scripts/vps-status.sh --json
# ═══════════════════════════════════════════════════════════════
set -uo pipefail

BACKEND_DIR="${BACKEND_DIR:-/opt/grudge-studio-backend}"
PROJECT="grudge-studio-backend"
COMPOSE="docker compose -p $PROJECT"
JSON_MODE=false

[[ "${1:-}" == "--json" ]] && JSON_MODE=true

# Colors (disabled in JSON mode)
if [ "$JSON_MODE" = false ]; then
  GREEN='\033[0;32m'
  RED='\033[0;31m'
  YELLOW='\033[0;33m'
  CYAN='\033[0;36m'
  NC='\033[0m'
else
  GREEN="" RED="" YELLOW="" CYAN="" NC=""
fi

# ── Service port map ──────────────────────────────────────
declare -A SVC_PORTS=(
  [grudge-id]=3001
  [wallet-service]=3002
  [game-api]=3003
  [ai-agent]=3004
  [account-api]=3005
  [launcher-api]=3006
  [ws-service]=3007
  [asset-service]=3008
)

SERVICES="grudge-id wallet-service game-api ai-agent account-api launcher-api ws-service asset-service"

echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
echo -e "${CYAN} GRUDGE STUDIO — VPS STATUS DASHBOARD${NC}"
echo -e "${CYAN} $(date)${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"

# ══════════════════════════════════════════════════════════
# 1. Container Status
# ══════════════════════════════════════════════════════════
echo ""
echo -e "${CYAN}━━━ 1. CONTAINER STATUS ━━━${NC}"
$COMPOSE ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || echo "  No compose stack running"

# Check headless separately (profile-gated)
HEADLESS_STATUS=$(docker inspect --format='{{.State.Status}}' grudge-headless 2>/dev/null || echo "not deployed")
HEADLESS_HEALTH=$(docker inspect --format='{{.State.Health.Status}}' grudge-headless 2>/dev/null || echo "n/a")
echo ""
echo "  grudge-headless: $HEADLESS_STATUS (health: $HEADLESS_HEALTH)"

# ══════════════════════════════════════════════════════════
# 2. Service Health Endpoints
# ══════════════════════════════════════════════════════════
echo ""
echo -e "${CYAN}━━━ 2. HEALTH ENDPOINTS ━━━${NC}"
TOTAL=0
HEALTHY=0

for SVC in $SERVICES; do
  PORT=${SVC_PORTS[$SVC]:-}
  TOTAL=$((TOTAL + 1))

  if [ -n "$PORT" ]; then
    RESPONSE=$(curl -sf --max-time 5 "http://localhost:$PORT/health" 2>/dev/null || echo "DOWN")
    if [ "$RESPONSE" != "DOWN" ]; then
      echo -e "  ${GREEN}✅${NC} $SVC (:$PORT) — $RESPONSE"
      HEALTHY=$((HEALTHY + 1))
    else
      echo -e "  ${RED}❌${NC} $SVC (:$PORT) — DOWN"
    fi
  else
    RUNNING=$(docker inspect --format='{{.State.Running}}' "$SVC" 2>/dev/null || echo "false")
    if [ "$RUNNING" = "true" ]; then
      echo -e "  ${GREEN}✅${NC} $SVC — running (no HTTP health)"
      HEALTHY=$((HEALTHY + 1))
    else
      echo -e "  ${RED}❌${NC} $SVC — not running"
    fi
  fi
done

echo ""
echo "  Summary: $HEALTHY/$TOTAL services healthy"

# ══════════════════════════════════════════════════════════
# 3. Database Status
# ══════════════════════════════════════════════════════════
echo ""
echo -e "${CYAN}━━━ 3. DATABASE (MySQL) ━━━${NC}"

MYSQL_CONTAINER="grudge-mysql"
MYSQL_RUNNING=$(docker inspect --format='{{.State.Running}}' "$MYSQL_CONTAINER" 2>/dev/null || echo "false")

if [ "$MYSQL_RUNNING" = "true" ]; then
  # Get connection count
  CONNECTIONS=$(docker exec "$MYSQL_CONTAINER" bash -c 'mysql -u root -p"$MYSQL_ROOT_PASSWORD" -sN -e "SELECT COUNT(*) FROM information_schema.processlist;" 2>/dev/null' || echo "?")
  MAX_CONN=$(docker exec "$MYSQL_CONTAINER" bash -c 'mysql -u root -p"$MYSQL_ROOT_PASSWORD" -sN -e "SHOW VARIABLES LIKE \"max_connections\";" 2>/dev/null' | awk '{print $2}' || echo "?")
  TABLE_COUNT=$(docker exec "$MYSQL_CONTAINER" bash -c 'mysql -u root -p"$MYSQL_ROOT_PASSWORD" grudge_game -sN -e "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=\"grudge_game\";" 2>/dev/null' || echo "?")
  USER_COUNT=$(docker exec "$MYSQL_CONTAINER" bash -c 'mysql -u root -p"$MYSQL_ROOT_PASSWORD" grudge_game -sN -e "SELECT COUNT(*) FROM users;" 2>/dev/null' || echo "?")
  DB_SIZE=$(docker exec "$MYSQL_CONTAINER" bash -c 'mysql -u root -p"$MYSQL_ROOT_PASSWORD" -sN -e "SELECT ROUND(SUM(data_length + index_length) / 1024 / 1024, 2) FROM information_schema.TABLES WHERE table_schema = \"grudge_game\";" 2>/dev/null' || echo "?")

  echo -e "  ${GREEN}✅${NC} MySQL running"
  echo "  Connections: $CONNECTIONS / $MAX_CONN"
  echo "  Tables: $TABLE_COUNT | Users: $USER_COUNT"
  echo "  DB size: ${DB_SIZE} MB"
else
  echo -e "  ${RED}❌${NC} MySQL is NOT running"
fi

# ══════════════════════════════════════════════════════════
# 4. Redis Status
# ══════════════════════════════════════════════════════════
echo ""
echo -e "${CYAN}━━━ 4. CACHE (Redis) ━━━${NC}"

REDIS_CONTAINER="grudge-redis"
REDIS_RUNNING=$(docker inspect --format='{{.State.Running}}' "$REDIS_CONTAINER" 2>/dev/null || echo "false")

if [ "$REDIS_RUNNING" = "true" ]; then
  # Try reading password from .env
  REDIS_PW=""
  if [ -f "$BACKEND_DIR/.env" ]; then
    REDIS_PW=$(grep "^REDIS_PASSWORD=" "$BACKEND_DIR/.env" 2>/dev/null | cut -d= -f2 | tr -d '"' || true)
  fi
  AUTH_FLAG=""
  [ -n "$REDIS_PW" ] && AUTH_FLAG="-a $REDIS_PW"

  REDIS_PING=$(docker exec "$REDIS_CONTAINER" redis-cli $AUTH_FLAG PING 2>/dev/null || echo "FAIL")
  REDIS_MEM=$(docker exec "$REDIS_CONTAINER" redis-cli $AUTH_FLAG INFO memory 2>/dev/null | grep "used_memory_human" | cut -d: -f2 | tr -d '\r' || echo "?")
  REDIS_KEYS=$(docker exec "$REDIS_CONTAINER" redis-cli $AUTH_FLAG DBSIZE 2>/dev/null | grep -o '[0-9]*' || echo "?")
  REDIS_UPTIME=$(docker exec "$REDIS_CONTAINER" redis-cli $AUTH_FLAG INFO server 2>/dev/null | grep "uptime_in_days" | cut -d: -f2 | tr -d '\r' || echo "?")

  if [ "$REDIS_PING" = "PONG" ]; then
    echo -e "  ${GREEN}✅${NC} Redis running (PONG)"
  else
    echo -e "  ${YELLOW}⚠${NC}  Redis running but PING failed (auth issue?)"
  fi
  echo "  Memory: $REDIS_MEM | Keys: $REDIS_KEYS | Uptime: ${REDIS_UPTIME} days"
else
  echo -e "  ${RED}❌${NC} Redis is NOT running"
fi

# ══════════════════════════════════════════════════════════
# 5. Disk Usage
# ══════════════════════════════════════════════════════════
echo ""
echo -e "${CYAN}━━━ 5. DISK USAGE ━━━${NC}"

DISK_USED=$(df / | awk 'NR==2 {print $5}')
DISK_AVAIL=$(df -h / | awk 'NR==2 {print $4}')
echo "  Root filesystem: $DISK_USED used, $DISK_AVAIL available"
echo ""
echo "  Docker disk usage:"
docker system df 2>/dev/null | sed 's/^/    /'

# ══════════════════════════════════════════════════════════
# 6. SSL Certificate Expiry
# ══════════════════════════════════════════════════════════
echo ""
echo -e "${CYAN}━━━ 6. SSL CERTIFICATES ━━━${NC}"

DOMAINS="id.grudge-studio.com api.grudge-studio.com account.grudge-studio.com launcher.grudge-studio.com ws.grudge-studio.com"

for DOMAIN in $DOMAINS; do
  EXPIRY=$(echo | openssl s_client -servername "$DOMAIN" -connect "$DOMAIN:443" 2>/dev/null | openssl x509 -noout -dates 2>/dev/null | grep notAfter | cut -d= -f2)
  if [ -n "$EXPIRY" ]; then
    DAYS_LEFT=$(( ( $(date -d "$EXPIRY" +%s 2>/dev/null || echo 0) - $(date +%s) ) / 86400 ))
    if [ "$DAYS_LEFT" -gt 30 ]; then
      echo -e "  ${GREEN}✅${NC} $DOMAIN — expires $EXPIRY ($DAYS_LEFT days)"
    elif [ "$DAYS_LEFT" -gt 7 ]; then
      echo -e "  ${YELLOW}⚠${NC}  $DOMAIN — expires $EXPIRY ($DAYS_LEFT days)"
    else
      echo -e "  ${RED}❌${NC} $DOMAIN — expires $EXPIRY ($DAYS_LEFT days!)"
    fi
  else
    echo -e "  ${YELLOW}⚠${NC}  $DOMAIN — could not check (DNS or cert issue)"
  fi
done

# ══════════════════════════════════════════════════════════
# 7. Recent Backups
# ══════════════════════════════════════════════════════════
echo ""
echo -e "${CYAN}━━━ 7. BACKUPS ━━━${NC}"

BACKUP_DIR="/opt/grudge-backups"
if [ -d "$BACKUP_DIR" ]; then
  LATEST=$(ls -t "$BACKUP_DIR"/*.sql.gz 2>/dev/null | head -1)
  if [ -n "$LATEST" ]; then
    BACKUP_TIME=$(stat -c %y "$LATEST" 2>/dev/null | cut -d. -f1)
    BACKUP_SIZE=$(du -sh "$LATEST" | cut -f1)
    echo "  Latest: $(basename "$LATEST") ($BACKUP_SIZE, $BACKUP_TIME)"
    BACKUP_COUNT=$(ls "$BACKUP_DIR"/*.sql.gz 2>/dev/null | wc -l)
    echo "  Total backups: $BACKUP_COUNT"
  else
    echo -e "  ${YELLOW}⚠${NC}  No backups found in $BACKUP_DIR"
  fi
else
  echo -e "  ${YELLOW}⚠${NC}  Backup directory $BACKUP_DIR does not exist"
  echo "  Run: bash scripts/install-cron.sh to set up automated backups"
fi

# ══════════════════════════════════════════════════════════
# 8. System Resources
# ══════════════════════════════════════════════════════════
echo ""
echo -e "${CYAN}━━━ 8. SYSTEM RESOURCES ━━━${NC}"

# Memory
MEM_TOTAL=$(free -h | awk '/^Mem:/ {print $2}')
MEM_USED=$(free -h | awk '/^Mem:/ {print $3}')
MEM_PCT=$(free | awk '/^Mem:/ {printf "%.0f", $3/$2 * 100}')
echo "  Memory: $MEM_USED / $MEM_TOTAL ($MEM_PCT%)"

# CPU load
LOAD=$(uptime | awk -F'load average:' '{print $2}' | xargs)
CPU_CORES=$(nproc)
echo "  Load avg: $LOAD ($CPU_CORES cores)"

# Uptime
echo "  Uptime: $(uptime -p)"

echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
echo -e "${CYAN} STATUS CHECK COMPLETE${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
echo ""
