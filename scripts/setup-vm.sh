#!/bin/bash
# ─────────────────────────────────────────────────
# Grudge Studio — Fresh Ubuntu 22.04 VPS Setup
# Run as root: bash setup-vm.sh
# ─────────────────────────────────────────────────
set -e

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Grudge Studio VPS Bootstrap${NC}"
echo -e "${BLUE}========================================${NC}"

# ── 1. System update ──────────────────────────
echo -e "${YELLOW}[1/6] Updating system...${NC}"
apt-get update -qq && apt-get upgrade -y -qq

# ── 2. Install Docker ─────────────────────────
echo -e "${YELLOW}[2/6] Installing Docker...${NC}"
apt-get install -y ca-certificates curl gnupg
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update -qq
apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
systemctl enable docker
systemctl start docker
echo -e "${GREEN}✓ Docker installed${NC}"

# ── 3. Firewall ───────────────────────────────
echo -e "${YELLOW}[3/6] Configuring UFW firewall...${NC}"
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp   comment 'SSH'
ufw allow 80/tcp   comment 'HTTP'
ufw allow 443/tcp  comment 'HTTPS'
ufw allow 7777/tcp comment 'Grudge Game TCP'
ufw allow 7777/udp comment 'Grudge Game UDP'
ufw --force enable
echo -e "${GREEN}✓ Firewall configured${NC}"

# ── 4. Create deploy user ─────────────────────
echo -e "${YELLOW}[4/6] Creating deploy user...${NC}"
if ! id "grudge" &>/dev/null; then
    useradd -m -s /bin/bash grudge
    usermod -aG docker grudge
    echo -e "${GREEN}✓ 'grudge' user created and added to docker group${NC}"
else
    echo -e "${GREEN}✓ 'grudge' user already exists${NC}"
fi

mkdir -p /home/grudge/.ssh
# Copy authorized_keys from root if exists
[ -f /root/.ssh/authorized_keys ] && cp /root/.ssh/authorized_keys /home/grudge/.ssh/
chown -R grudge:grudge /home/grudge/.ssh
chmod 700 /home/grudge/.ssh
chmod 600 /home/grudge/.ssh/authorized_keys 2>/dev/null || true

# ── 5. Create project directories ─────────────
echo -e "${YELLOW}[5/6] Setting up project directories...${NC}"
mkdir -p /opt/grudge-studio-backend
chown grudge:grudge /opt/grudge-studio-backend
echo -e "${GREEN}✓ /opt/grudge-studio-backend ready${NC}"

# ── 6. SSL Bootstrap (HTTP-only until certs issued) ──
echo -e "${YELLOW}[6/6] Creating initial nginx HTTP-only config...${NC}"
# TLS certs will be issued after DNS is pointed at this server
# Run: docker compose run --rm certbot certonly --webroot -w /var/www/certbot -d id.grudgestudio.com -d api.grudgestudio.com -d ws.grudgestudio.com
echo -e "${GREEN}✓ To issue TLS certs after DNS is set up, run:${NC}"
echo "   docker compose run --rm certbot certonly --webroot -w /var/www/certbot \\"
echo "     -d id.grudgestudio.com -d api.grudgestudio.com -d ws.grudgestudio.com"

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  VPS Setup Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Next steps:"
echo "  1. Point DNS A records for id/api/ws.grudgestudio.com → $(curl -s ifconfig.me)"
echo "  2. Upload .env file to /opt/grudge-studio-backend/"
echo "  3. Upload grudge-headless binary to services/grudge-headless/bin/"
echo "  4. Run: cd /opt/grudge-studio-backend && docker compose up -d"
echo "  5. Issue TLS certs (see above)"
