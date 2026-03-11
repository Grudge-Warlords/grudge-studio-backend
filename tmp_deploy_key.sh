#!/bin/bash
set -e
GITHUB_TOKEN=$(grep '^GITHUB_TOKEN=' /opt/grudge-studio-backend/.env | cut -d= -f2 | tr -d '"')
PUBKEY='ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQCkQgOC/pGOtL2+U6p7/3xSdQ+csRxgwv7BkD5wNEr8nkkl4cU84uQ+AqV6/FotqrSUBnfpqh+b9eRy4IEA4gCnoWEdk9WfR+dK2vImBP4SXBux6D7HQ3NiXubOKpdqie0a9t34fO5R+uL18dD4xii8Q/CbsLwfDkMjQHj+uICdNWxdJWpQKjXOxPjKejdYmgZztlZM4eCCxW81E+kYfFDWljf2N0FLHlDGGMQDD4rABp7JyqMBxH92MSGiVDh76IhDVzatjaaqAJHo6Y62UjV+X/hMiwQE4/+VyEGPXYIDtVlMTGV64hPIuBaSGdgMYfdGmU/pz3hdBLA0uAvg8BRr coolify-generated-ssh-key'

PAYLOAD=$(jq -n --arg key "$PUBKEY" '{"title":"Coolify VPS Deploy Key","key":$key,"read_only":true}')

echo "=== Adding deploy key to GitHub ==="
RESPONSE=$(curl -s -X POST \
  -H "Authorization: token $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/MolochDaGod/grudge-studio-backend/keys \
  -d "$PAYLOAD")

KEY_ID=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id','ERROR'))" 2>/dev/null)
MSG=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('message','ok'))" 2>/dev/null)
echo "KEY_ID: $KEY_ID"
echo "MSG: $MSG"

echo ""
echo "=== Creating GitHub Webhook ==="
WEBHOOK_PAYLOAD=$(jq -n '{
  "name": "web",
  "active": true,
  "events": ["push"],
  "config": {
    "url": "http://74.208.155.229:8000/webhooks/source/github",
    "content_type": "json",
    "insecure_ssl": "0"
  }
}')

WH_RESPONSE=$(curl -s -X POST \
  -H "Authorization: token $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/MolochDaGod/grudge-studio-backend/hooks \
  -d "$WEBHOOK_PAYLOAD")

WH_ID=$(echo "$WH_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id','ERROR'))" 2>/dev/null)
WH_MSG=$(echo "$WH_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('message','ok'))" 2>/dev/null)
echo "WEBHOOK_ID: $WH_ID"
echo "WEBHOOK_MSG: $WH_MSG"
