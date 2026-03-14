#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Grudge Studio — Secret Rotation
# Rotates JWT_SECRET, INTERNAL_API_KEY, LAUNCH_TOKEN_SECRET and restarts
# affected containers. Backs up .env before writing.
# Run: bash /opt/grudge-studio-backend/scripts/rotate-secrets.sh [--dry-run]
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

ENV_FILE="/opt/grudge-studio-backend/.env"
BACKUP_DIR="/opt/grudge-studio-backend/backups/env"
DRY_RUN=false

[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true

echo "════════════════════════════════════════════════════"
echo "  Grudge Studio — Secret Rotation"
[[ "$DRY_RUN" == true ]] && echo "  ⚡ DRY RUN — no changes will be made"
echo "════════════════════════════════════════════════════"
echo ""

if [ ! -f "$ENV_FILE" ]; then
  echo "❌ $ENV_FILE not found"
  exit 1
fi

# Generate a 64-char hex secret
gen_secret() {
  openssl rand -hex 32
}

# Secrets to rotate
ROTATE_KEYS=(
  JWT_SECRET
  INTERNAL_API_KEY
  LAUNCH_TOKEN_SECRET
)

# Backup current .env
mkdir -p "$BACKUP_DIR"
STAMP=$(date +%Y%m%d-%H%M%S)
cp "$ENV_FILE" "$BACKUP_DIR/.env.${STAMP}"
echo "📦 Backed up .env → $BACKUP_DIR/.env.${STAMP}"
echo ""

# Rotate each secret
for key in "${ROTATE_KEYS[@]}"; do
  OLD=$(grep "^${key}=" "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '"' | xargs)
  NEW=$(gen_secret)

  if [[ "$DRY_RUN" == true ]]; then
    echo "  🔄 $key — would rotate (current: ${#OLD} chars → new: ${#NEW} chars)"
  else
    # Use sed to replace the value in-place
    if grep -q "^${key}=" "$ENV_FILE"; then
      sed -i "s|^${key}=.*|${key}=${NEW}|" "$ENV_FILE"
      echo "  ✅ $key — rotated (${#OLD} → ${#NEW} chars)"
    else
      echo "${key}=${NEW}" >> "$ENV_FILE"
      echo "  ✅ $key — added (new, ${#NEW} chars)"
    fi
  fi
done

echo ""

if [[ "$DRY_RUN" == true ]]; then
  echo "Dry run complete — no services restarted."
  exit 0
fi

# Restart affected containers
echo "▶ Restarting services..."
CONTAINERS=(
  grudge-id
  game-api
  account-api
  launcher-api
  ws-service
  ai-agent-service
)

for ctr in "${CONTAINERS[@]}"; do
  ID=$(docker ps -qf "name=${ctr}" 2>/dev/null || true)
  if [ -n "$ID" ]; then
    docker restart "$ID" >/dev/null 2>&1
    echo "  🔄 $ctr — restarted"
  else
    echo "  ⏭️  $ctr — not running, skipped"
  fi
done

echo ""
echo "════════════════════════════════════════════════════"
echo "  ✅ Rotation complete"
echo "  📋 Run audit-secrets.sh to verify"
echo "════════════════════════════════════════════════════"
