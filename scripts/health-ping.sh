#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Grudge Studio — Hourly Health-Check Ping
#
# Hits /health on every service. If any fail after 3 retries,
# sends a Discord alert.
#
# Designed to run via cron every hour.
# ─────────────────────────────────────────────────────────────────────────────

set -uo pipefail

ENV_FILE="/opt/grudge-studio-backend/.env"

# ── Load Discord webhook ─────────────────────────────────────────────────────
DISCORD_WEBHOOK=""
if [ -f "$ENV_FILE" ]; then
  DISCORD_WEBHOOK=$(grep "^DISCORD_SYSTEM_WEBHOOK_TOKEN=" "$ENV_FILE" | cut -d= -f2- | tr -d '"' | tr -d "'" | xargs)
fi

# ── Service endpoints (internal ports) ───────────────────────────────────────
declare -A SERVICES=(
  [grudge-id]=3001
  [wallet-service]=3002
  [game-api]=3003
  [ai-agent]=3004
  [account-api]=3005
  [launcher-api]=3006
  [ws-service]=3007
  [asset-service]=3008
)

FAILED=()
STATUS_LINES=""
DATE=$(date '+%Y-%m-%d %H:%M UTC')

for SVC in "${!SERVICES[@]}"; do
  PORT=${SERVICES[$SVC]}
  OK=false

  for ATTEMPT in 1 2 3; do
    if curl -sf --max-time 5 "http://localhost:$PORT/health" > /dev/null 2>&1; then
      OK=true
      break
    fi
    sleep 2
  done

  if $OK; then
    STATUS_LINES+="✅ $SVC (:$PORT)\n"
  else
    STATUS_LINES+="❌ $SVC (:$PORT) — DOWN\n"
    FAILED+=("$SVC")
  fi
done

# ── Log output ───────────────────────────────────────────────────────────────
echo "$DATE — ${#FAILED[@]} failures"
echo -e "$STATUS_LINES"

# ── Discord alert (only on failure) ──────────────────────────────────────────
if [ ${#FAILED[@]} -gt 0 ] && [ -n "$DISCORD_WEBHOOK" ]; then
  FAILED_LIST=$(printf ', ' "${FAILED[@]}")
  FAILED_LIST=${FAILED_LIST%, }  # trim trailing comma

  curl -sf -X POST "$DISCORD_WEBHOOK" \
    -H "Content-Type: application/json" \
    -d "{
      \"embeds\": [{
        \"title\": \"🚨 Grudge Studio — Service Down!\",
        \"color\": 15158332,
        \"description\": \"Health check failed for: **${FAILED_LIST}**\",
        \"fields\": [
          {\"name\": \"Failed Services\", \"value\": \"${#FAILED[@]} of ${#SERVICES[@]}\", \"inline\": true},
          {\"name\": \"Action\", \"value\": \"Check VPS: \`docker compose ps\`\", \"inline\": true}
        ],
        \"footer\": {\"text\": \"$(hostname) — $DATE\"}
      }]
    }" > /dev/null 2>&1 || true
fi
