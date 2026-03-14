#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Grudge Studio — Secret Audit
# Checks .env for missing, placeholder, or weak values.
# Run: bash /opt/grudge-studio-backend/scripts/audit-secrets.sh
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

ENV_FILE="${1:-/opt/grudge-studio-backend/.env}"
WARN=0
FAIL=0

echo "════════════════════════════════════════════════════"
echo "  Grudge Studio — Secret Audit"
echo "════════════════════════════════════════════════════"
echo ""

if [ ! -f "$ENV_FILE" ]; then
  echo "❌ $ENV_FILE not found"
  exit 1
fi

# Required secrets that must not be empty
REQUIRED=(
  JWT_SECRET
  INTERNAL_API_KEY
  LAUNCH_TOKEN_SECRET
  MYSQL_ROOT_PASSWORD
  DISCORD_CLIENT_ID
  DISCORD_CLIENT_SECRET
  OBJECT_STORAGE_KEY
  OBJECT_STORAGE_SECRET
  CF_ACCOUNT_ID
)

# Check required vars
echo "▶ Checking required variables..."
for var in "${REQUIRED[@]}"; do
  val=$(grep "^${var}=" "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'" | xargs)
  if [ -z "$val" ]; then
    echo "  ❌ $var — MISSING or empty"
    FAIL=$((FAIL+1))
  elif [ ${#val} -lt 8 ]; then
    echo "  ⚠️  $var — suspiciously short (${#val} chars)"
    WARN=$((WARN+1))
  else
    echo "  ✅ $var — set (${#val} chars)"
  fi
done

# Check for common placeholder values
echo ""
echo "▶ Checking for placeholder values..."
while IFS='=' read -r key val; do
  [[ "$key" =~ ^#.*$ ]] && continue
  [[ -z "$key" ]] && continue
  val=$(echo "$val" | tr -d '"' | tr -d "'" | xargs)
  case "$val" in
    changeme|password|secret|example|placeholder|TODO|FIXME|xxx|your_*|replace_*)
      echo "  ⚠️  $key = '$val' — looks like a placeholder"
      WARN=$((WARN+1))
      ;;
  esac
done < "$ENV_FILE"

# Check JWT_SECRET strength
echo ""
echo "▶ Checking secret strength..."
JWT=$(grep "^JWT_SECRET=" "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '"' | xargs)
if [ -n "$JWT" ] && [ ${#JWT} -lt 32 ]; then
  echo "  ⚠️  JWT_SECRET is only ${#JWT} chars — recommend 64+"
  WARN=$((WARN+1))
else
  echo "  ✅ JWT_SECRET length OK"
fi

# Summary
echo ""
echo "════════════════════════════════════════════════════"
if [ $FAIL -gt 0 ]; then
  echo "  ❌ $FAIL critical issues, $WARN warnings"
  exit 1
elif [ $WARN -gt 0 ]; then
  echo "  ⚠️  $WARN warnings, 0 critical issues"
else
  echo "  ✅ All secrets look good"
fi
echo "════════════════════════════════════════════════════"
