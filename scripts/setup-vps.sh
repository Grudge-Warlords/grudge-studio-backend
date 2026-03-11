#!/bin/bash
# ─────────────────────────────────────────────────────────────
# Grudge Studio — VPS First-Time Setup Script
# Run on Ubuntu 22.04 LTS as root:
#   bash <(curl -fsSL https://raw.githubusercontent.com/MolochDaGod/grudge-studio-backend/main/scripts/setup-vps.sh)
# ─────────────────────────────────────────────────────────────

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

DEPLOY_DIR="/opt/grudge-studio-backend"
REPO_URL="https://github.com/MolochDaGod/grudge-studio-backend.git"

echo -e "${CYAN}"
echo "  ╔══════════════════════════════════════════╗"
echo "  ║    GRUDGE STUDIO — VPS SETUP SCRIPT      ║"
echo "  ╚══════════════════════════════════════════╝"
echo -e "${NC}"

# ── 1. System update ─────────────────────────────────────────
echo -e "${YELLOW}[1/9] Updating system packages...${NC}"
apt-get update -qq && apt-get upgrade -y -qq
apt-get install -y -qq curl git ufw nano

# ── 2. Install Docker ─────────────────────────────────────────
echo -e "${YELLOW}[2/9] Installing Docker...${NC}"
if ! command -v docker &>/dev/null; then
  curl -fsSL https://get.docker.com | sh
  echo -e "${GREEN}✓ Docker installed${NC}"
else
  echo -e "${GREEN}✓ Docker already installed: $(docker --version)${NC}"
fi

if ! docker compose version &>/dev/null; then
  apt-get install -y -qq docker-compose-plugin
fi
echo -e "${GREEN}✓ Docker Compose: $(docker compose version --short)${NC}"

# ── 3. Firewall ───────────────────────────────────────────────
echo -e "${YELLOW}[3/9] Configuring firewall...${NC}"
ufw --force enable
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 7777/tcp
ufw allow 7777/udp
echo -e "${GREEN}✓ Firewall configured${NC}"

# ── 4. Clone / update repo ────────────────────────────────────
echo -e "${YELLOW}[4/9] Setting up deployment directory...${NC}"
if [ -d "$DEPLOY_DIR/.git" ]; then
  echo "  Existing repo found — pulling latest..."
  git -C "$DEPLOY_DIR" pull origin main
else
  mkdir -p "$DEPLOY_DIR"
  git clone "$REPO_URL" "$DEPLOY_DIR"
fi
echo -e "${GREEN}✓ Repo ready at $DEPLOY_DIR${NC}"

# ── 5. Install Node.js (for gen-secrets script) ───────────────
echo -e "${YELLOW}[5/9] Checking Node.js...${NC}"
if ! command -v node &>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
fi
echo -e "${GREEN}✓ Node.js $(node -v)${NC}"

# ── 6. Create .env ────────────────────────────────────────────
echo -e "${YELLOW}[6/9] Setting up .env...${NC}"
cd "$DEPLOY_DIR"

if [ -f ".env" ]; then
  echo -e "${GREEN}✓ .env already exists — skipping generation${NC}"
  echo -e "  To update: nano $DEPLOY_DIR/.env"
else
  echo "  Generating secrets..."
  node scripts/gen-secrets.js > .env
  echo "" >> .env
  echo "# ── YOU MUST FILL IN THESE VALUES ──" >> .env
  echo "DISCORD_CLIENT_ID=REPLACE_ME" >> .env
  echo "DISCORD_CLIENT_SECRET=REPLACE_ME" >> .env
  echo "DISCORD_REDIRECT_URI=https://id.grudgestudio.com/auth/discord/callback" >> .env
  echo "WEB3AUTH_CLIENT_ID=REPLACE_ME" >> .env
  echo "WALLET_MASTER_SEED=REPLACE_ME_24_WORD_MNEMONIC" >> .env
  echo "SOLANA_RPC_URL=https://api.mainnet-beta.solana.com" >> .env
  echo "OBJECT_STORAGE_ENDPOINT=REPLACE_ME" >> .env
  echo "OBJECT_STORAGE_BUCKET=grudge-studio-assets" >> .env
  echo "OBJECT_STORAGE_KEY=REPLACE_ME" >> .env
  echo "OBJECT_STORAGE_SECRET=REPLACE_ME" >> .env
  echo "OBJECT_STORAGE_REGION=us-east-1" >> .env
  echo "OBJECT_STORAGE_PUBLIC_URL=https://assets.grudgestudio.com" >> .env
  echo "CORS_ORIGINS=https://grudgewarlords.com,https://grudgestudio.com,https://account.grudgestudio.com,https://launcher.grudgestudio.com,https://app.puter.com" >> .env
  echo "PUTER_APP_ID=REPLACE_ME" >> .env
  echo "DOMAIN_ID=id.grudgestudio.com" >> .env
  echo "DOMAIN_API=api.grudgestudio.com" >> .env
  echo "DOMAIN_ACCOUNT=account.grudgestudio.com" >> .env
  echo "DOMAIN_LAUNCHER=launcher.grudgestudio.com" >> .env
  echo "DOMAIN_WS=ws.grudgestudio.com" >> .env
  echo "MAX_PLAYERS=22" >> .env

  echo -e "${RED}"
  echo "  ┌─────────────────────────────────────────────────────┐"
  echo "  │  ACTION REQUIRED: Edit .env before starting!        │"
  echo "  │  nano $DEPLOY_DIR/.env            │"
  echo "  │  Fill in: DISCORD_*, WEB3AUTH_*, WALLET_MASTER_SEED │"
  echo "  │  OBJECT_STORAGE_*, PUTER_APP_ID                     │"
  echo "  └─────────────────────────────────────────────────────┘"
  echo -e "${NC}"
  read -p "Press ENTER after you've edited .env to continue..."
fi

# ── 7. Set up SSH deploy key ──────────────────────────────────
echo -e "${YELLOW}[7/9] Setting up GitHub Actions deploy key...${NC}"
if [ ! -f "$HOME/.ssh/grudge_deploy" ]; then
  ssh-keygen -t ed25519 -C "grudge-deploy-$(hostname)" -f "$HOME/.ssh/grudge_deploy" -N ""
  cat "$HOME/.ssh/grudge_deploy.pub" >> "$HOME/.ssh/authorized_keys"
  chmod 600 "$HOME/.ssh/authorized_keys"
  echo -e "${GREEN}✓ Deploy key created${NC}"
  echo -e "${CYAN}"
  echo "  ┌─────────────────────────────────────────────────────┐"
  echo "  │  Add this PRIVATE key to GitHub Secrets             │"
  echo "  │  Repo → Settings → Secrets → DEPLOY_SSH_KEY         │"
  echo "  └─────────────────────────────────────────────────────┘"
  echo -e "${NC}"
  cat "$HOME/.ssh/grudge_deploy"
  echo ""
  read -p "Press ENTER after you've saved the key to GitHub Secrets..."
else
  echo -e "${GREEN}✓ Deploy key already exists${NC}"
fi

# ── 8. Start services ─────────────────────────────────────────
echo -e "${YELLOW}[8/9] Starting services...${NC}"
cd "$DEPLOY_DIR"
docker compose up --build -d

echo "  Waiting for services to be healthy..."
sleep 20

HEALTHY=true
for PORT in 3001 3003 3004 3005 3006; do
  if curl -sf "http://localhost:$PORT/health" > /dev/null 2>&1; then
    echo -e "  ${GREEN}✓ Port $PORT healthy${NC}"
  else
    echo -e "  ${RED}✗ Port $PORT not responding${NC}"
    HEALTHY=false
  fi
done

if [ "$HEALTHY" = false ]; then
  echo -e "${RED}Some services failed to start. Check logs:${NC}"
  echo "  docker compose logs -f"
fi

# ── 9. SSL (optional, requires DNS to be configured first) ────
echo -e "${YELLOW}[9/9] SSL setup...${NC}"
echo ""
echo -e "${CYAN}To issue SSL certificates, first ensure DNS is configured:${NC}"
echo "  id.grudgestudio.com       → 74.208.155.229"
echo "  api.grudgestudio.com      → 74.208.155.229"
echo "  account.grudgestudio.com  → 74.208.155.229"
echo "  launcher.grudgestudio.com → 74.208.155.229"
echo "  ws.grudgestudio.com       → 74.208.155.229"
echo ""
echo "Then run:"
echo -e "${YELLOW}"
echo "  apt install -y certbot"
echo "  docker compose stop nginx"
echo "  certbot certonly --standalone \\"
echo "    -d id.grudgestudio.com \\"
echo "    -d api.grudgestudio.com \\"
echo "    -d account.grudgestudio.com \\"
echo "    -d launcher.grudgestudio.com \\"
echo "    -d ws.grudgestudio.com \\"
echo "    --email your@email.com --agree-tos --non-interactive"
echo "  docker compose up -d nginx"
echo -e "${NC}"

# ── Done ──────────────────────────────────────────────────────
echo -e "${GREEN}"
echo "  ╔══════════════════════════════════════════╗"
echo "  ║   GRUDGE STUDIO SETUP COMPLETE!          ║"
echo "  ╠══════════════════════════════════════════╣"
echo "  ║  Health checks:                          ║"
echo "  ║  curl http://localhost:3001/health       ║"
echo "  ║  curl http://localhost:3003/health       ║"
echo "  ║  curl http://localhost:3005/health       ║"
echo "  ║  curl http://localhost:3006/health       ║"
echo "  ╠══════════════════════════════════════════╣"
echo "  ║  Logs: docker compose logs -f            ║"
echo "  ║  Docs: $DEPLOY_DIR/docs/     ║"
echo "  ╚══════════════════════════════════════════╝"
echo -e "${NC}"
