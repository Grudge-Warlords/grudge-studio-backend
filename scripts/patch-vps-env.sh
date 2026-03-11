#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Grudge Studio — VPS .env patch script
# Run this ON the VPS to add/update all new Cloudflare + R2 variables.
#
# Usage:
#   scp scripts/patch-vps-env.sh root@74.208.155.229:/tmp/
#   ssh root@74.208.155.229 'bash /tmp/patch-vps-env.sh'
# ─────────────────────────────────────────────────────────────────────────────

ENV_FILE="/opt/grudge-studio-backend/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not found. Copy your .env to the VPS first."
  exit 1
fi

# Helper: upsert a key=value in .env (adds if missing, replaces if present)
upsert() {
  local key="$1"
  local val="$2"
  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$ENV_FILE"
    echo "  updated: $key"
  else
    echo "" >> "$ENV_FILE"
    echo "${key}=${val}" >> "$ENV_FILE"
    echo "  added:   $key"
  fi
}

echo "Patching $ENV_FILE ..."

# ── Cloudflare R2 ─────────────────────────────────────────────────────────────
upsert "OBJECT_STORAGE_REGION"     "auto"
upsert "OBJECT_STORAGE_PUBLIC_URL" "https://pub-e7fcf1fd4c9946ecb84b3766bbc7b50d.r2.dev"
upsert "CF_ACCOUNT_ID"             "ee475864561b02d4588180b8b9acf694"

# ── Cloudflare KV ─────────────────────────────────────────────────────────────
upsert "CF_KV_RATE_LIMIT_ID"       "35be1828b2124f82abdc770293177165"

# ── CDN / system URLs ─────────────────────────────────────────────────────────
upsert "GRUDGE_CDN_URL"            "https://assets.grudge-studio.com"
upsert "GRUDGE_IDENTITY_API"       "https://id.grudge-studio.com"
upsert "GRUDGE_GAME_API"           "https://api.grudge-studio.com"
upsert "GRUDGE_ACCOUNT_API"        "https://account.grudge-studio.com"
upsert "GRUDGE_ASSETS_URL"         "https://assets.grudge-studio.com"
upsert "CF_D1_DATABASE_ID"         "8fcb111b-fcee-4f4e-b0d5-59ad416ee3b9"

# ── Domains ───────────────────────────────────────────────────────────────────
upsert "DOMAIN_ID"                 "id.grudge-studio.com"
upsert "DOMAIN_API"                "api.grudge-studio.com"
upsert "DOMAIN_ACCOUNT"            "account.grudge-studio.com"
upsert "DOMAIN_LAUNCHER"           "launcher.grudge-studio.com"
upsert "DOMAIN_WS"                 "ws.grudge-studio.com"
upsert "DOMAIN_DASH"               "dash.grudge-studio.com"

# ── CORS ──────────────────────────────────────────────────────────────────────
upsert "CORS_ORIGINS"              "https://grudgewarlords.com,https://grudge-studio.com,https://grudgestudio.com,https://grudachain.grudge-studio.com,https://dash.grudge-studio.com"

# ── Discord redirect URI ──────────────────────────────────────────────────────
upsert "DISCORD_REDIRECT_URI"      "https://id.grudge-studio.com/auth/discord/callback"

# ── Turnstile keys (fill these in manually from dash.cloudflare.com) ──────────
# upsert "CF_TURNSTILE_SITE_KEY"   "YOUR_SITE_KEY_HERE"
# upsert "CF_TURNSTILE_SECRET_KEY" "YOUR_SECRET_KEY_HERE"

echo ""
echo "Done. Restart services:"
echo "  docker compose -f /opt/grudge-studio-backend/docker-compose.yml up -d --force-recreate"
echo ""
echo "NOTE: CF_TURNSTILE_SITE_KEY and CF_TURNSTILE_SECRET_KEY must be set manually."
echo "      Get them from: https://dash.cloudflare.com → Turnstile → Add Site"
