#!/bin/bash
set -euo pipefail

APP_DIR="/opt/grudge-launcher-site"
mkdir -p "$APP_DIR"

# Copy files from repo tar upload location if present
if [ -f /opt/grudge-studio-backend/puter-deploy/grudge-launcher/index.html ]; then
  cp /opt/grudge-studio-backend/puter-deploy/grudge-launcher/index.html "$APP_DIR/index.html"
  cp /opt/grudge-studio-backend/puter-deploy/grudge-launcher/favicon.svg "$APP_DIR/favicon.svg"
fi

# If not present, fail clearly
if [ ! -f "$APP_DIR/index.html" ]; then
  echo "ERROR: index.html not found at $APP_DIR"
  exit 1
fi

PUTER_AUTH_TOKEN="$(grep '^PUTER_AUTH_TOKEN=' /opt/grudge-studio-backend/.env | cut -d= -f2 | tr -d '"' | tr -d '\r')"
PUTER_USERNAME="$(grep '^PUTER_USERNAME=' /opt/grudge-studio-backend/.env | cut -d= -f2 | tr -d '"' | tr -d '\r')"
[ -z "$PUTER_USERNAME" ] && PUTER_USERNAME="GRUDACHAIN"

npm install -g puter-cli >/dev/null 2>&1 || true

mkdir -p /root/.config/puter-cli-nodejs
cat > /root/.config/puter-cli-nodejs/config.json <<JSON
{
  "profiles": [
    {
      "host": "https://puter.com",
      "username": "$PUTER_USERNAME",
      "cwd": "/$PUTER_USERNAME",
      "token": "$PUTER_AUTH_TOKEN",
      "uuid": "11111111-1111-1111-1111-111111111111"
    }
  ],
  "selected_profile": "11111111-1111-1111-1111-111111111111",
  "username": "$PUTER_USERNAME",
  "cwd": "/$PUTER_USERNAME"
}
JSON

cd "$APP_DIR"
puter site deploy "$APP_DIR" grudge-launcher-xu9q5
