#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Grudge Studio — Cloudflare Workers deploy script (VPS / Linux)
#
# Usage:
#   export CLOUDFLARE_API_TOKEN=cfxxx
#   bash scripts/deploy-workers.sh              # deploy all
#   bash scripts/deploy-workers.sh ai-hub       # deploy one
#   bash scripts/deploy-workers.sh ai-hub secret VPS_INTERNAL_KEY
#
# Required token permissions (create at dash.cloudflare.com/profile/api-tokens):
#   Account > Workers Scripts > Edit
#   Account > Workers KV Storage > Edit
#   Account > D1 > Edit
#   Zone > Workers Routes > Edit
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

WORKERS_DIR="$(dirname "$0")/../cloudflare/workers"
ACCOUNT_ID="ee475864561b02d4588180b8b9acf694"

# Colours
RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "  ${GREEN}✓${NC}  $1"; }
err()  { echo -e "  ${RED}✗${NC}  $1"; }
step() { echo -e "\n  ${CYAN}>>  $1${NC}"; }

# Workers to deploy (in order)
WORKERS=("ai-hub" "dashboard" "auth-gateway" "health-ping" "r2-cdn" "site")

TARGET="${1:-all}"  # optional: specific worker name
MODE="${2:-deploy}"  # deploy | secret
SECRET_NAME="${3:-}"

# ── Require wrangler ──────────────────────────────────────────────────────────
if ! command -v wrangler &>/dev/null; then
  if ! command -v npx &>/dev/null; then
    err "wrangler/npx not found. Run: npm install -g wrangler"
    exit 1
  fi
  WRANGLER="npx wrangler"
else
  WRANGLER="wrangler"
fi

# ── Require token for deploy/secret ──────────────────────────────────────────
if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  err "CLOUDFLARE_API_TOKEN is not set."
  echo "  Export it before running:"
  echo "  export CLOUDFLARE_API_TOKEN=cfxxx"
  echo ""
  echo "  Create token at: https://dash.cloudflare.com/profile/api-tokens"
  echo "  Required permissions:"
  echo "    Account > Workers Scripts > Edit"
  echo "    Account > Workers KV Storage > Edit"
  echo "    Account > D1 > Edit"
  echo "    Zone > Workers Routes > Edit"
  exit 1
fi

echo -e "\n ${CYAN}Grudge Studio — Cloudflare Workers Deploy (VPS)${NC}"
echo " Account: $ACCOUNT_ID"

# Inject VPS_INTERNAL_KEY into ai-hub and dashboard at deploy time (from local .env)
inject_internal_key() {
  local worker_dir="$1"
  local key_val
  key_val=$(grep '^INTERNAL_API_KEY=' /opt/grudge-studio-backend/.env 2>/dev/null | cut -d= -f2 || echo "")
  if [[ -n "$key_val" ]]; then
    echo "  Injecting VPS_INTERNAL_KEY secret..."
    echo "$key_val" | (cd "$worker_dir" && $WRANGLER secret put VPS_INTERNAL_KEY) && \
      ok "VPS_INTERNAL_KEY secret set" || \
      echo -e "  ${YELLOW}⚠  Could not set VPS_INTERNAL_KEY — set manually${NC}"
  fi
}

deploy_worker() {
  local name="$1"
  local dir="$WORKERS_DIR/$name"

  if [[ ! -d "$dir" ]]; then
    err "$name: directory not found at $dir"
    return 1
  fi

  step "Deploying $name"
  cd "$dir"
  $WRANGLER deploy && ok "$name deployed" || { err "$name deploy failed"; return 1; }

  # Auto-inject secrets for workers that need internal key
  if [[ "$name" == "ai-hub" || "$name" == "dashboard" ]]; then
    inject_internal_key "$dir"
  fi
}

# ── Secret mode ───────────────────────────────────────────────────────────────
if [[ "$MODE" == "secret" ]]; then
  if [[ -z "$SECRET_NAME" ]]; then
    err "Provide secret name: bash deploy-workers.sh <worker> secret <SECRET_NAME>"
    exit 1
  fi
  dir="$WORKERS_DIR/$TARGET"
  step "Setting $SECRET_NAME on $TARGET"
  cd "$dir"
  $WRANGLER secret put "$SECRET_NAME" && ok "$SECRET_NAME set on $TARGET" || err "Failed"
  exit 0
fi

# ── Deploy mode ───────────────────────────────────────────────────────────────
if [[ "$TARGET" == "all" ]]; then
  for w in "${WORKERS[@]}"; do
    deploy_worker "$w" || true  # continue on failure
  done
else
  deploy_worker "$TARGET"
fi

echo -e "\n${GREEN}Workers deploy complete.${NC}"
echo ""
echo "Next: verify at https://dash.cloudflare.com/$(echo $ACCOUNT_ID)/workers/overview"
