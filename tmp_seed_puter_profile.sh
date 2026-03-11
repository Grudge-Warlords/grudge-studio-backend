#!/bin/bash
set -euo pipefail

npm install -g puter-cli >/dev/null 2>&1 || true

TOKEN="$(grep '^PUTER_AUTH_TOKEN=' /opt/grudge-studio-backend/.env | cut -d= -f2- | tr -d '"' | tr -d '\r')"
USERNAME="$(grep '^PUTER_USERNAME=' /opt/grudge-studio-backend/.env | cut -d= -f2- | tr -d '"' | tr -d '\r')"
[ -z "$USERNAME" ] && USERNAME="GRUDACHAIN"
UUID="22222222-2222-2222-2222-222222222222"

mkdir -p /root/.config/puter-cli-nodejs
cat > /root/.config/puter-cli-nodejs/config.json <<JSON
{
  "profiles": [
    {
      "name": "grudachain-deploy",
      "host": "https://puter.com",
      "username": "$USERNAME",
      "cwd": "/$USERNAME",
      "token": "$TOKEN",
      "uuid": "$UUID"
    }
  ],
  "selected_profile": "$UUID",
  "username": "$USERNAME",
  "cwd": "/$USERNAME"
}
JSON

echo "PROFILE_PATH=/root/.config/puter-cli-nodejs/config.json"
echo "PROFILE_NAME=grudachain-deploy"
puter sites || true
