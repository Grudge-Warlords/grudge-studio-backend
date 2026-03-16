# Grudge Studio — VPS Deployment Guide

## VPS Hosts

| Host | OS | IP | Role |
|---|---|---|---|
| **VPS1** | Ubuntu Linux | `74.208.155.229` | Primary — Docker, all services |
| **VPS2** | Windows Server | `74.208.174.62` | Secondary — bootstrap target |

Both require credentials stored in GitHub Secrets (never hardcoded):
- `VPS_HOST` — target IP
- `VPS_USER` — SSH username
- `VPS_PASSWORD` — SSH password
- `GH_DEPLOY_TOKEN` — GitHub PAT for cloning

Primary target: **74.208.155.229** (Ubuntu)

---

## 1. First-time VPS preparation

SSH into the server:
```bash
ssh root@74.208.155.229
```

Update the system:
```bash
apt update && apt upgrade -y
apt install -y curl git ufw
```

---

## 2. Install Docker + Docker Compose

```bash
# Install Docker
curl -fsSL https://get.docker.com | sh

# Add your user to the docker group (if not root)
usermod -aG docker $USER

# Verify
docker --version
docker compose version
```

---

## 3. Firewall rules

```bash
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 7777/tcp    # game server
ufw allow 7777/udp    # game server UDP
ufw enable
ufw status
```

> Ports 3001-3006 are **not** opened externally — they are only accessible through nginx.

---

## 4. Create deploy directory and clone repo

```bash
mkdir -p /opt/grudge-studio-backend
cd /opt/grudge-studio-backend

git clone https://github.com/MolochDaGod/grudge-studio-backend.git .
```

---

## 5. Create the `.env` file

The `.env` is **never committed** to git. You must create it manually on the server.

```bash
cd /opt/grudge-studio-backend

# Option A: copy from your local machine via WinSCP
# Upload your local .env to /opt/grudge-studio-backend/.env

# Option B: generate fresh secrets on the server
node scripts/gen-secrets.js > .env
# Then edit with nano:
nano .env
```

Fill in all values from [docs/SETUP.md](SETUP.md#3-generate-your-env).

Verify it's complete:
```bash
grep -E "^(JWT_SECRET|INTERNAL_API_KEY|DISCORD_CLIENT_ID|WALLET_MASTER_SEED|MYSQL_PASSWORD)" .env
```

---

## 6. First run

```bash
cd /opt/grudge-studio-backend
docker compose up --build -d
```

Watch logs:
```bash
docker compose logs -f
```

Check all services are healthy:
```bash
curl -sf http://localhost:3001/health && echo "grudge-id OK"
curl -sf http://localhost:3003/health && echo "game-api OK"
curl -sf http://localhost:3004/health && echo "ai-agent OK"
curl -sf http://localhost:3005/health && echo "account-api OK"
curl -sf http://localhost:3006/health && echo "launcher-api OK"
```

---

## 7. DNS setup

Point these A records at `74.208.155.229`:

| Subdomain | Type | Value |
|---|---|---|
| `id.grudgestudio.com` | A | 74.208.155.229 |
| `api.grudgestudio.com` | A | 74.208.155.229 |
| `account.grudgestudio.com` | A | 74.208.155.229 |
| `launcher.grudgestudio.com` | A | 74.208.155.229 |
| `ws.grudgestudio.com` | A | 74.208.155.229 |

Wait for DNS to propagate (usually 1-5 minutes with Cloudflare, up to 48h elsewhere).

Verify:
```bash
dig +short id.grudgestudio.com
# should return: 74.208.155.229
```

---

## 8. SSL / TLS with Let's Encrypt

Once DNS is propagated, run certbot to issue certificates:

```bash
# Install certbot (if not already present)
apt install -y certbot python3-certbot-nginx

# Stop nginx temporarily so certbot can use port 80
docker compose stop nginx

# Issue certificates for all subdomains
certbot certonly --standalone \
  -d id.grudgestudio.com \
  -d api.grudgestudio.com \
  -d account.grudgestudio.com \
  -d launcher.grudgestudio.com \
  -d ws.grudgestudio.com \
  --email your@email.com \
  --agree-tos \
  --non-interactive

# Restart nginx
docker compose up -d nginx
```

Certificates are stored in `/etc/letsencrypt/live/` and are volume-mounted into the nginx container.

Auto-renewal runs via the certbot container in docker-compose. To manually renew:
```bash
docker compose run --rm certbot renew
docker compose restart nginx
```

---

## 9. GitHub Actions auto-deploy setup

Every push to `main` auto-deploys. Add these secrets in your GitHub repo under **Settings → Secrets and variables → Actions**:

| Secret | Value |
|---|---|
| `VPS_HOST` | `74.208.155.229` |
| `VPS_USER` | `root` (or your user) |
| `DEPLOY_SSH_KEY` | Contents of your VPS private key (the `-----BEGIN...` block) |

### Generate an SSH deploy key (if you don't have one)

On the VPS:
```bash
ssh-keygen -t ed25519 -C "grudge-deploy" -f ~/.ssh/grudge_deploy -N ""
cat ~/.ssh/grudge_deploy.pub >> ~/.ssh/authorized_keys
cat ~/.ssh/grudge_deploy   # copy this — paste into GitHub secret DEPLOY_SSH_KEY
```

---

## 10. Updating the server manually

If GitHub Actions fails or you need to force a redeploy:

```bash
cd /opt/grudge-studio-backend
git pull origin main
docker compose build --no-cache
docker compose up -d --remove-orphans
docker system prune -f
```

---

## 11. Useful maintenance commands

```bash
# View all container status
docker compose ps

# Tail logs for a specific service
docker compose logs -f account-api
docker compose logs -f launcher-api
docker compose logs -f game-api

# Restart a single service
docker compose restart account-api

# Connect to MySQL
docker exec -it grudge-mysql mysql -u grudge_admin -p grudge_game

# Connect to Redis
docker exec -it grudge-redis redis-cli -a $REDIS_PASSWORD

# Check disk usage
docker system df

# Clean up unused images / stopped containers
docker system prune -f
```

---

## 12. Backup MySQL data

```bash
# Dump to file
docker exec grudge-mysql mysqldump -u grudge_admin -p"$MYSQL_PASSWORD" grudge_game > backup_$(date +%Y%m%d).sql

# Restore from file
docker exec -i grudge-mysql mysql -u grudge_admin -p"$MYSQL_PASSWORD" grudge_game < backup_20260101.sql
```

---

## 13. Monitoring / health check cron

Add this to crontab (`crontab -e`) to auto-restart dead services:

```bash
*/5 * * * * cd /opt/grudge-studio-backend && docker compose up -d 2>/dev/null
```

---

## Quick reference — all ports

| Port | Service | Exposed? |
|---|---|---|
| 80 | nginx (HTTP → HTTPS redirect) | YES |
| 443 | nginx (HTTPS) | YES |
| 3001 | grudge-id | nginx only |
| 3002 | wallet-service | internal only |
| 3003 | game-api | nginx only |
| 3004 | ai-agent | internal only |
| 3005 | account-api | nginx only |
| 3006 | launcher-api | nginx only |
| 3306 | MySQL | internal only |
| 6379 | Redis | internal only |
| 7777 | grudge-headless (game server) | YES (TCP+UDP) |
