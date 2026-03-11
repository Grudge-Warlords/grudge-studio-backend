# Grudge Studio — Setup Guide

This guide covers everything from a fresh clone to a fully running local dev environment.

---

## Prerequisites

| Tool | Version | Install |
|---|---|---|
| Node.js | 20+ | https://nodejs.org |
| Docker Desktop | Latest | https://www.docker.com/products/docker-desktop |
| Git | Any | https://git-scm.com |

Verify installs:
```bash
node -v        # v20.x.x
docker -v      # Docker version 24+
docker compose version  # v2.x
```

---

## 1. Clone the repo

```bash
git clone https://github.com/MolochDaGod/grudge-studio-backend.git
cd grudge-studio-backend
```

---

## 2. Install all dependencies

The repo uses npm workspaces. One command installs all 6 services:

```bash
npm run install:all
```

---

## 3. Generate your `.env`

```bash
node scripts/gen-secrets.js > .env
```

This auto-generates `JWT_SECRET`, `INTERNAL_API_KEY`, `LAUNCH_TOKEN_SECRET`, `REDIS_PASSWORD`, and `MYSQL_ROOT_PASSWORD`.

Then open `.env` and fill in the remaining values:

### Discord OAuth
1. Go to https://discord.com/developers/applications
2. Create an app → OAuth2 → add redirect: `https://id.grudgestudio.com/auth/discord/callback`
3. Copy Client ID + Client Secret into `.env`

```env
DISCORD_CLIENT_ID=your_client_id
DISCORD_CLIENT_SECRET=your_client_secret
DISCORD_REDIRECT_URI=https://id.grudgestudio.com/auth/discord/callback
```

### Web3Auth (Solana wallet login)
1. Go to https://dashboard.web3auth.io
2. Create a project → copy Client ID

```env
WEB3AUTH_CLIENT_ID=your_web3auth_client_id
```

### Solana wallet seed (server-side HD wallets)
Generate a fresh 24-word BIP39 mnemonic — **keep this secret and back it up**:

```bash
node -e "const {generateMnemonic}=require('bip39');console.log(generateMnemonic(256))"
```

```env
WALLET_MASTER_SEED=word1 word2 word3 ... word24
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
```

### Object Storage (S3-compatible)
Works with Cloudflare R2, Backblaze B2, AWS S3, or your ObjectStore:

```env
OBJECT_STORAGE_ENDPOINT=https://s3.your-provider.com
OBJECT_STORAGE_BUCKET=grudge-studio-assets
OBJECT_STORAGE_KEY=your_access_key
OBJECT_STORAGE_SECRET=your_secret_key
OBJECT_STORAGE_REGION=us-east-1
OBJECT_STORAGE_PUBLIC_URL=https://assets.grudgestudio.com
```

### CORS Origins
Add every frontend URL that needs to call the backend:

```env
CORS_ORIGINS=https://grudgewarlords.com,https://grudgestudio.com,https://account.grudgestudio.com,https://launcher.grudgestudio.com,https://app.puter.com
```

### Puter App ID
Register your app at https://puter.com/dev (optional for local dev):

```env
PUTER_APP_ID=your_puter_app_id
```

---

## 4. Start local development

### Option A — Local Node processes (fastest, no Docker needed for services)

Start MySQL + Redis in Docker, then run services natively:

```bash
# Terminal 1 — start DB + cache
npm run docker:deps

# Terminal 2 — all 6 services with hot reload
npm run dev
```

Services start on:
- grudge-id: http://localhost:3001
- wallet-service: http://localhost:3002
- game-api: http://localhost:3003
- ai-agent: http://localhost:3004
- account-api: http://localhost:3005
- launcher-api: http://localhost:3006

### Option B — Full Docker dev stack

```bash
npm run docker:dev
```

All services run in containers with volume-mounted `src/` for hot reload.

### Option C — Run a single service

```bash
npm run dev:game      # game-api only
npm run dev:account   # account-api only
npm run dev:launcher  # launcher-api only
npm run dev:id        # grudge-id only
```

---

## 5. Verify it's working

```bash
curl http://localhost:3001/health
# {"status":"ok","service":"grudge-id"}

curl http://localhost:3003/health
# {"status":"ok","service":"game-api","version":"2.0.0"}

curl http://localhost:3005/health
# {"status":"ok","service":"account-api","version":"1.0.0"}

curl http://localhost:3006/health
# {"status":"ok","service":"launcher-api","version":"1.0.0"}
```

---

## 6. First-time database setup

The MySQL init scripts run automatically when the `grudge-mysql` container first starts. If you need to reset the database:

```bash
docker compose down -v   # WARNING: destroys all data
docker compose up -d mysql
```

To connect to MySQL directly:
```bash
docker exec -it grudge-mysql mysql -u grudge_admin -p grudge_game
# password: value of MYSQL_PASSWORD in your .env
```

---

## 7. Production build

```bash
npm run docker:prod
```

This builds all services with the `production` Dockerfile target (no devDependencies, no nodemon).

---

## 8. GitHub Actions auto-deploy

Every push to `main` deploys to your VPS automatically. See [docs/VPS.md](VPS.md) for VPS setup and required GitHub Secrets.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `Error: DB not initialized` | MySQL container not healthy yet — wait 15s and retry |
| `CORS error in browser` | Add your frontend URL to `CORS_ORIGINS` in `.env` |
| `Invalid or expired token` | JWT_SECRET mismatch between services — all services must share the same value |
| `Wallet creation failed` | Check WALLET_MASTER_SEED is set and INTERNAL_API_KEY matches between grudge-id and wallet-service |
| `S3 upload failed` | Check OBJECT_STORAGE_* values — endpoint must include `https://` |
| Port already in use | Another process is on that port — `netstat -ano | findstr :3001` (Windows) |
