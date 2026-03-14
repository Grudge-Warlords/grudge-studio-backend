# Coolify Deployment Guide — Grudge Studio Backend

## Architecture Overview

```
Internet → Cloudflare (DNS proxy) → VPS (Traefik → Docker containers)
                                        └─ Coolify manages Traefik + deploys
```

**VPS**: IONOS (Linux) — runs Coolify, Traefik, and all backend services
**Frontend**: Vercel — serves all web apps (dashboard, crafting suite, etc.)
**DNS**: Cloudflare — proxied A records pointing to VPS origin IP

## Service Map

| Service | Port | Domain | Visibility |
|---------|------|--------|------------|
| grudge-id | 3001 | id.grudge-studio.com | Public |
| wallet-service | 3002 | — | Internal |
| game-api | 3003 | api.grudge-studio.com | Public |
| ai-agent | 3004 | — | Internal |
| account-api | 3005 | account.grudge-studio.com | Public |
| launcher-api | 3006 | launcher.grudge-studio.com | Public |
| ws-service | 3007 | ws.grudge-studio.com | Public |
| asset-service | 3008 | assets-api.grudge-studio.com | Public |
| grudge-headless | 7777 | — | Game server |
| MySQL | 3306 | — | Internal |
| Redis | 6379 | — | Internal |
| Uptime Kuma | 3001 | status.grudge-studio.com | Public |

## Coolify Setup Steps

### 1. Fresh VPS Bootstrap

```bash
# From your local machine (PowerShell):
scp -i ~/.ssh/coolify_vps coolify/setup-vps.sh grudge_deploy@YOUR_VPS_IP:/tmp/
ssh -i ~/.ssh/coolify_vps grudge_deploy@YOUR_VPS_IP 'sudo bash /tmp/setup-vps.sh'
```

### 2. Coolify Web UI Configuration

1. Open `http://YOUR_VPS_IP:8000` and create admin account
2. Go to **Servers** → Add your VPS as localhost (it's already local)
3. Go to **Projects** → Create "Grudge Studio"
4. Add **Environment**: "Production"

### 3. Deploy via Coolify (Option A — Recommended)

1. In Coolify: **New Resource** → **Docker Compose**
2. Connect GitHub repo: `MolochDaGod/grudge-studio-backend`
3. Set compose file to: `docker-compose.yml` 
4. Add all `.env` variables in Coolify's Environment section
5. Enable **Auto Deploy** on push to `main` branch
6. Deploy

### 4. Deploy via CLI (Option B — Manual)

```bash
ssh -i ~/.ssh/coolify_vps grudge_deploy@YOUR_VPS_IP
cd /opt/grudge-studio-backend
# Edit .env with real values
nano .env
# Deploy with production overrides
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

## Cloudflare DNS Records

All records should be **proxied** (orange cloud) for DDoS protection:

```
Type  Name         Content          Proxy
A     id           YOUR_VPS_IP      Proxied
A     api          YOUR_VPS_IP      Proxied
A     account      YOUR_VPS_IP      Proxied
A     launcher     YOUR_VPS_IP      Proxied
A     ws           YOUR_VPS_IP      Proxied (WebSocket)
A     assets-api   YOUR_VPS_IP      Proxied
A     status       YOUR_VPS_IP      Proxied
```

**Important**: For `ws` (WebSocket), enable WebSockets in Cloudflare:
- SSL/TLS → Edge Certificates → Always Use HTTPS ✓
- Network → WebSockets → ON

For `dash.grudge-studio.com` — this points to Vercel (`76.76.21.21`), NOT the VPS.

## Cloudflare SSL Settings

Since Traefik handles Let's Encrypt certs:
- SSL/TLS mode: **Full (strict)**
- Edge Certificates: Always Use HTTPS ✓
- Minimum TLS: 1.2

## Monitoring

### Health Check Cron

```bash
# Add to crontab on VPS:
sudo crontab -e

# Check every 5 minutes, auto-restart failed services
*/5 * * * * AUTO_RESTART=true /opt/grudge-studio-backend/coolify/health-check.sh >> /var/log/grudge-health.log 2>&1
```

### Uptime Kuma

Accessible at `status.grudge-studio.com` — add monitors for:
- Each public service endpoint (`/health`)
- MySQL (TCP 3306)
- Redis (TCP 6379)

## Daily Maintenance

```bash
# View logs for a specific service
docker compose logs -f --tail=50 game-api

# Restart a single service
docker compose restart grudge-id

# Full redeploy
./coolify/deploy.sh

# Force rebuild (after Dockerfile changes)
./coolify/deploy.sh --rebuild

# Emergency recovery
sudo bash coolify/recover-vps.sh
```

## Resource Budget (~3.8GB RAM VPS)

```
MySQL:          512MB (limit)
Redis:          128MB
game-api:       512MB
ai-agent:       512MB  
grudge-headless:1024MB
Other 6 svcs:   256MB each = 1536MB
Uptime Kuma:    256MB
Coolify+Traefik:~512MB (system)
─────────────────────────
Total reserved: ~4.5GB → swap handles overflow
```

Swap (4GB) covers spikes. If memory is tight, stop `ai-agent-service` and
`grudge-headless` first — they're the heaviest and least critical for core API.
