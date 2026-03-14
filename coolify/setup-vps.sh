#!/usr/bin/env bash
set -euo pipefail

# ═══════════════════════════════════════════════════════════════
# Grudge Studio — Coolify VPS Bootstrap
# Run on a fresh Ubuntu 22.04/24.04 LTS VPS as root
#
# Usage:
#   ssh root@YOUR_VPS_IP 'bash -s' < coolify/setup-vps.sh
#
# What this does:
#   1. System updates + swap (for 3.8GB RAM VPS)
#   2. Installs Docker + Docker Compose
#   3. Installs Coolify
#   4. Configures firewall (UFW)
#   5. Sets up SSH key auth
#   6. Clones grudge-studio-backend repo
#   7. Creates .env from gen-secrets.js
# ═══════════════════════════════════════════════════════════════

echo "═══ Grudge Studio — VPS Bootstrap ═══"
echo "Detected: $(uname -a)"
echo ""

# ── 1. System updates ─────────────────────────────────────────
echo ">>> Step 1: System updates..."
apt-get update -y && apt-get upgrade -y
apt-get install -y curl git wget unzip htop ufw jq

# ── 2. Add swap (4GB) for builds ──────────────────────────────
echo ">>> Step 2: Configuring swap..."
if [ ! -f /swapfile ]; then
  fallocate -l 4G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  # Optimize for server workload
  sysctl vm.swappiness=10
  echo 'vm.swappiness=10' >> /etc/sysctl.conf
  echo "  Swap: 4GB created and enabled"
else
  echo "  Swap: already exists, skipping"
fi

# ── 3. Install Docker if missing ──────────────────────────────
echo ">>> Step 3: Docker..."
if ! command -v docker &>/dev/null; then
  curl -fsSL https://get.docker.com | bash
  systemctl enable --now docker
  echo "  Docker installed: $(docker --version)"
else
  echo "  Docker already installed: $(docker --version)"
fi

# ── 4. Firewall ───────────────────────────────────────────────
echo ">>> Step 4: Firewall (UFW)..."
ufw allow ssh
ufw allow 80/tcp    # HTTP (Traefik/Coolify)
ufw allow 443/tcp   # HTTPS (Traefik/Coolify)
ufw allow 8000/tcp  # Coolify dashboard
ufw allow 6001/tcp  # Coolify websocket
ufw allow 7777/tcp  # Unity game server
ufw allow 7777/udp  # Unity game server UDP
ufw --force enable
echo "  UFW rules applied"

# ── 5. Install Coolify ────────────────────────────────────────
echo ">>> Step 5: Installing Coolify..."
if [ ! -f /data/coolify/source/docker-compose.yml ]; then
  curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
  echo "  Coolify installed — access at http://$(hostname -I | awk '{print $1}'):8000"
else
  echo "  Coolify already installed, checking for updates..."
  cd /data/coolify/source
  docker compose --env-file .env -f docker-compose.yml -f docker-compose.prod.yml pull
  docker compose --env-file .env -f docker-compose.yml -f docker-compose.prod.yml up -d --remove-orphans
  echo "  Coolify updated"
fi

# Wait for Coolify to be ready
echo "  Waiting for Coolify to start..."
sleep 15

# ── 6. Clone Grudge Studio backend ───────────────────────────
echo ">>> Step 6: Grudge Studio backend..."
BACKEND_DIR="/opt/grudge-studio-backend"
if [ ! -d "$BACKEND_DIR" ]; then
  git clone https://github.com/MolochDaGod/grudge-studio-backend.git "$BACKEND_DIR"
  echo "  Cloned to $BACKEND_DIR"
else
  cd "$BACKEND_DIR"
  git pull origin main
  echo "  Updated $BACKEND_DIR"
fi

# ── 7. Generate .env if missing ──────────────────────────────
if [ ! -f "$BACKEND_DIR/.env" ]; then
  echo ">>> Step 7: Generating .env..."
  cd "$BACKEND_DIR"
  if [ -f scripts/gen-secrets.js ]; then
    node scripts/gen-secrets.js > .env
    echo "  Generated .env with random secrets"
    echo "  ⚠  IMPORTANT: Edit .env to add your Discord, Web3Auth, Wallet, and Cloudflare credentials"
  else
    cp .env.example .env
    echo "  Copied .env.example → .env"
    echo "  ⚠  IMPORTANT: Edit ALL values in .env before deploying"
  fi
else
  echo ">>> Step 7: .env already exists, skipping"
fi

# ── 8. Ensure the Coolify network exists ─────────────────────
echo ">>> Step 8: Docker network..."
docker network create coolify 2>/dev/null || echo "  Network 'coolify' already exists"

# ── Summary ───────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════"
echo "  SETUP COMPLETE"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "  Coolify UI:  http://$(hostname -I | awk '{print $1}'):8000"
echo "  Backend dir: $BACKEND_DIR"
echo ""
echo "  Next steps:"
echo "  1. Open Coolify UI and create your admin account"
echo "  2. Edit $BACKEND_DIR/.env with real credentials"
echo "  3. Run: cd $BACKEND_DIR && docker compose up -d"
echo "  4. Verify: docker compose ps"
echo "  5. Add your GitHub repo in Coolify for auto-deploys"
echo ""
echo "  DNS: Point these to $(hostname -I | awk '{print $1}') in Cloudflare:"
echo "    id.grudge-studio.com"
echo "    api.grudge-studio.com"
echo "    account.grudge-studio.com"
echo "    launcher.grudge-studio.com"
echo "    ws.grudge-studio.com"
echo "    assets-api.grudge-studio.com"
echo "    status.grudge-studio.com"
echo ""
