# Grudge Studio Backend

Full-stack microservices backend for **grudgewarlords.com** and **grudge-studio.com** —
the single source of truth for Grudge Studio identity, game APIs, real-time WebSockets,
asset pipeline, launcher, and Cloudflare/Puter integrations.

Built with Node.js · Docker · MySQL 8 · Redis 7 · Cloudflare Tunnel · Solana · Puter

> **Consolidated repo.** The previous `grudge-backend` (PostgreSQL/Drizzle prototype)
> has been retired. All active development happens here. If you have a clone of the
> old repo, delete it to avoid confusion.

---

## Service Map

| Service | Port | Domain | Description |
|---|---|---|---|
| **grudge-id** | 3001 | `id.grudge-studio.com` | Unified identity — Discord OAuth, Web3Auth, JWT, Puter bridge |
| **wallet-service** | 3002 | *(internal only)* | Server-side Solana HD wallets (BIP44) |
| **game-api** | 3003 | `api.grudge-studio.com` | GAME_API_GRUDA — characters, missions, crews, inventory, professions, gouldstones |
| **ai-agent** | 3004 | `api.grudge-studio.com/ai/*` | LLM-powered AI pipeline — code review, balance analysis, lore gen, art prompts, dynamic missions, companion dialogue (Anthropic → OpenAI → DeepSeek → template fallback) |
| **account-api** | 3005 | `account.grudge-studio.com` | User profiles, social, achievements, R2 asset storage |
| **launcher-api** | 3006 | `launcher.grudge-studio.com` | Version manifest (60s TTL cache), computer registration, launch tokens |
| **asset-service** | 3008 | `assets-api.grudge-studio.com` | Asset upload, metadata, conversions, export bundles, ObjectStore sync |
| **ws-service** | 3007 | `ws.grudge-studio.com` | Real-time WebSocket (Socket.IO) — island rooms, crew chat, PvP, global events |
| **grudge-headless** | 7777 | `ws.grudge-studio.com:7777` | Unity game server (Mirror) |
| **AI Lab** | — | `lab.grudge-studio.com` | Browser-based dev tool — 8-panel AI workbench (Puter.js + Grudge backend) |

---

## Cloudflare Integration

### R2 Object Storage
- **Bucket**: `grudge-assets`
- **S3 endpoint**: `https://ee475864561b02d4588180b8b9acf694.r2.cloudflarestorage.com`
- **Catalog URI**: `https://catalog.cloudflarestorage.com/ee475864561b02d4588180b8b9acf694/grudge-assets`
- **Public CDN base**: `https://pub-e7fcf1fd4c9946ecb84b3766bbc7b50d.r2.dev`
- Region must be set to `auto` — R2 does not use `us-east-1`
- `account-api` uploads avatars/assets with `ContentDisposition: inline`, immutable cache headers, and per-user R2 metadata

### Workers CDN
- Source: `cloudflare/workers/r2-cdn/`
- R2 native binding (zero egress cost), KV-backed rate limiting, 30-day edge cache
- Custom domain: `assets.grudge-studio.com` → CNAME the Worker
- Deploy: `cd cloudflare/workers/r2-cdn && npx wrangler deploy`

### Turnstile
- Applied to `POST /auth/wallet` in `grudge-id`
- Middleware: `services/grudge-id/src/middleware/turnstile.js`
- Env: `CF_TURNSTILE_SITE_KEY`, `CF_TURNSTILE_SECRET_KEY`

See [`cloudflare/README.md`](cloudflare/README.md) for the full best-practices guide.

---

## Puter Integration

### Puter Bridge Auth
`grudge-id` exposes `POST /auth/puter-bridge` — exchanges a Puter KV session for a Grudge Studio JWT.
Called by `grudge-server-worker.js` at `POST /api/auth/grudge-bridge`, allowing Puter-hosted clients to authenticate with the full backend.

### App Config (`puter/config/app-urls.json`)
```json
{
  "auth": {
    "authUrl": "https://id.grudge-studio.com",
    "discordEndpoint": "/auth/discord",
    "logoutEndpoint": "/auth/logout",
    "verifyEndpoint": "/auth/verify",
    "puterBridgeEndpoint": "/auth/puter-bridge"
  }
}
```

### Puter Worker (`grudge-server-worker.js` v4.0.0)
- SHA-256 password hashing via `crypto.subtle` (auto-migrates legacy djb2 on login)
- CORS restricted to known origins (no wildcard)
- Per-user KV keys: `grudge_user_{id}` (no race conditions on shared arrays)
- `POST /api/auth/grudge-bridge` — Puter session → Grudge JWT
- `POST /api/admin/purge-sessions` — expired session cleanup

---

## Quick Start

### Local development

```bash
# 1. Clone
git clone https://github.com/Grudge-Warlords/grudge-studio-backend.git
cd grudge-studio-backend

# 2. Install all workspace deps
npm run install:all

# 3. Generate secrets + .env
node scripts/gen-secrets.js > .env
# Then fill in the remaining values (Discord, Web3Auth, wallet seed)

# 4. Start MySQL + Redis
npm run docker:deps

# 5. Start all 6 services with hot reload
npm run dev
```

### Production (Docker)

```bash
npm run docker:prod
# or
docker compose up --build -d
```

### Docker dev mode (hot reload in containers)

```bash
npm run docker:dev
```

---

## npm Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Start all services locally via nodemon (concurrently) |
| `npm run dev:account` | Start only account-api |
| `npm run dev:launcher` | Start only launcher-api |
| `npm run dev:game` | Start only game-api |
| `npm run dev:id` | Start only grudge-id |
| `npm run docker:deps` | Start MySQL + Redis only |
| `npm run docker:dev` | Full docker dev stack (hot reload) |
| `npm run docker:prod` | Full docker prod stack |
| `npm run docker:logs` | Tail all container logs |
| `npm run docker:down` | Stop all containers |
| `npm run secrets:gen` | Print a fresh `.env` to stdout |

---

## Documentation

| Doc | Description |
|---|---|
| [docs/SETUP.md](docs/SETUP.md) | Complete local + first-time setup walkthrough |
| [docs/VPS.md](docs/VPS.md) | VPS deployment guide (Ubuntu, Docker, SSL, DNS, rollback) |
| [docs/API.md](docs/API.md) | Full API reference for all services |
| [docs/LAUNCHER.md](docs/LAUNCHER.md) | Game launcher integration guide |
| [docs/PUTER.md](docs/PUTER.md) | Puter cloud integration guide |

---

## Environment Variables

See [`.env.example`](.env.example) for all required variables.

Critical ones to set before first run:

```
# Auth
JWT_SECRET                   # 64+ char random string
INTERNAL_API_KEY             # service-to-service auth
LAUNCH_TOKEN_SECRET          # one-time game launch tokens

# Blockchain
WALLET_MASTER_SEED           # 24-word BIP39 mnemonic

# OAuth
DISCORD_CLIENT_ID
DISCORD_CLIENT_SECRET
WEB3AUTH_CLIENT_ID

# Cloudflare R2
OBJECT_STORAGE_KEY           # R2 Access Key ID
OBJECT_STORAGE_SECRET        # R2 Secret Access Key
OBJECT_STORAGE_REGION        # always "auto" for R2
OBJECT_STORAGE_PUBLIC_URL    # https://pub-e7fcf1fd4c9946ecb84b3766bbc7b50d.r2.dev
CF_ACCOUNT_ID

# Cloudflare Turnstile
CF_TURNSTILE_SITE_KEY
CF_TURNSTILE_SECRET_KEY

# Cloudflare KV
CF_KV_RATE_LIMIT_ID          # from: npx wrangler kv namespace create "GRUDGE_RATE_LIMIT"

# Puter
PUTER_AUTH_TOKEN
PUTER_USERNAME               # GRUDACHAIN
```

Generate most of them automatically:
```bash
node scripts/gen-secrets.js > .env
```

---

## Database

MySQL 8.0 — `grudge_game` database. Schema is applied automatically on first `docker compose up` from:

| File | Contents |
|---|---|
| `mysql/init/01-schema.sql` | users, characters, crews, missions, wallet_index |
| `mysql/init/02-game-systems.sql` | inventory, gouldstones, profession_progress |
| `mysql/init/03-platform.sql` | user_profiles, friendships, notifications, achievements, launcher_versions, computer_registrations, launch_tokens, cloud_saves |

---

## Architecture

Public ingress runs through **Cloudflare Tunnel** (`cloudflared`, outbound-only).
No inbound ports / Let's Encrypt / nginx required. Traefik labels are still present
on each service for legacy/rollback but are not the primary path.

```
Internet
  │
  ▼
Cloudflare Edge (WAF + TLS) — Zone: grudge-studio.com
  │  outbound-only tunnel (cloudflared container, profile: tunnel)
  ▼
grudge-net (Docker bridge)
  ├── id.grudge-studio.com         → grudge-id:3001
  ├── api.grudge-studio.com        → game-api:3003
  ├── account.grudge-studio.com    → account-api:3005
  ├── launcher.grudge-studio.com   → launcher-api:3006
  ├── assets-api.grudge-studio.com → asset-service:3008
  ├── ws.grudge-studio.com         → ws-service:3007
  ├── status.grudge-studio.com     → uptime-kuma:3001
  ├── bridge.grudge-studio.com     → grudge-bridge:4000
  ├── portal-api.grudge-studio.com → portal-api:5000
  └── assets.grudge-studio.com     → Cloudflare Worker (R2 CDN, separate)

External integrations:
  app.puter.com / *.puter.site  → grudge-id:3001 (/auth/puter-bridge)
  Puter KV                     ← grudge-server-worker.js (v4.0.0)

Internal-only (grudge-net — never tunneled):
  game-api      → ai-agent:3004        (AI missions + behavior)
  grudge-id     → wallet-service:3002  (wallet creation)
  game-api      → account-api:3005     (achievement awards)
  launcher-api  → grudge-headless      (launch token validation)
  portal-api    → portal-postgres:5432 (rec0ded88 portal data)

Data:
  All services  → MySQL:3306 (grudge_game)
  portal-api    → Postgres:5432 (rec0ded88)
  game-api      → Redis:6379 (session cache)
  account-api   → Cloudflare R2 (avatars, assets)
  launcher-api  → Cloudflare R2 CDN (game bundles via cdn_base)
```

### Public ingress — Cloudflare Tunnel

The `cloudflared` service is gated by the `tunnel` Compose profile so it only
starts when explicitly enabled. To bring up public ingress:

```bash
# 1. Set the tunnel token (one-time, get from one.dash.cloudflare.com)
echo 'CLOUDFLARE_TUNNEL_TOKEN=eyJhIjoi...' >> .env

# 2. Start the tunnel
docker compose --profile tunnel up -d cloudflared

# 3. Verify
docker logs -f grudge-cloudflared   # expect "Registered tunnel connection"
```

Ingress map: [`cloudflared/config.yml`](cloudflared/config.yml).
Full migration runbook (DNS cleanup, public hostnames, smoke tests, rollback):
[`deploy/MIGRATE-TO-CLOUDFLARE-TUNNEL.md`](deploy/MIGRATE-TO-CLOUDFLARE-TUNNEL.md).

---

## Deployment

Manual dispatch via GitHub Actions (`.github/workflows/deploy.yml`).

### Safety features

All deploy paths (CI, `coolify/deploy.sh`, `deploy-migrate.sh`) include:

- **Orphan stack detection** — scans for duplicate compose projects and removes them before deploying to prevent Traefik routing collisions
- **Pinned project name** — all compose commands use `-p grudge-studio-backend` so only one stack is ever active
- **`:previous` image tagging** — before rebuilding each service, the running image is tagged as `:previous`
- **Per-service health gate** — after restarting each service, polls `/health` (6 retries × 5s = 30s max)
- **Auto-rollback** — if a service fails its health check, it is automatically reverted to the `:previous` image
- **Rolling deploy** — services are deployed one at a time so the rest stay up during updates

### Deploy commands

```bash
# On VPS — standard safe deploy
bash /opt/grudge-studio-backend/coolify/deploy.sh

# On VPS — deploy + run SQL migrations
bash /opt/grudge-studio-backend/deploy-migrate.sh

# On VPS — force rebuild all images
bash /opt/grudge-studio-backend/coolify/deploy.sh --rebuild

# On VPS — deploy a single service
bash /opt/grudge-studio-backend/coolify/deploy.sh --service grudge-id
```

### Rollback

```bash
# Rollback one service to its previous image
bash scripts/rollback.sh grudge-id

# Rollback multiple services
bash scripts/rollback.sh grudge-id game-api account-api

# Rollback ALL services
bash scripts/rollback.sh --all

# List available :previous images
bash scripts/rollback.sh --list
```

### Required GitHub Secrets

- `DEPLOY_SSH_KEY` — private key for VPS SSH
- `VPS_HOST` — `74.208.155.229`
- `VPS_USER` — your VPS user (e.g. `root`)

### Puter launcher deploy (direct API fallback)

If `puter-cli` is unstable, deploy launcher files directly with `@heyputer/puter.js`:

```bash
ssh root@74.208.155.229
cat >/tmp/puter_deploy_api.mjs <<'EOF'
import fs from 'node:fs/promises';
import { puter } from '@heyputer/puter.js';

const env = await fs.readFile('/opt/grudge-studio-backend/.env', 'utf8');
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1] || '').replace(/^\"|\"$/g, '').trim();
const token = get('PUTER_AUTH_TOKEN');
const username = get('PUTER_USERNAME') || 'GRUDACHAIN';
const subdomain = 'grudge-launcher-xu9q5';
const remoteDir = `/${username}/sites/${subdomain}/deployment`;

puter.setAuthToken(token);
await puter.fs.mkdir(remoteDir, { dedupeName: true, createMissingParents: true });
await puter.fs.write(`${remoteDir}/index.html`, await fs.readFile('/opt/grudge-launcher-site/index.html', 'utf8'), { overwrite: true, createMissingParents: true });
await puter.fs.write(`${remoteDir}/favicon.svg`, await fs.readFile('/opt/grudge-launcher-site/favicon.svg', 'utf8'), { overwrite: true, createMissingParents: true });
try { await puter.hosting.create(subdomain, remoteDir); } catch { await puter.hosting.update(subdomain, remoteDir); }
console.log(`https://${subdomain}.puter.site`);
EOF

cd /tmp
npm i @heyputer/puter.js
node /tmp/puter_deploy_api.mjs
```

---

## Tech Stack

- **Runtime**: Node.js 20
- **Framework**: Express 4
- **Database**: MySQL 8.0 (mysql2/promise)
- **Cache**: Redis 7 (ioredis)
- **Auth**: JWT, Discord OAuth2, Web3Auth, Puter bridge
- **Blockchain**: Solana (@solana/web3.js), BIP44 HD wallets (bip39, hdkey, tweetnacl)
- **Storage**: Cloudflare R2 via @aws-sdk/client-s3 (region: `auto`)
- **CDN**: Cloudflare Workers + Cache API + KV rate limiting
- **Bot Protection**: Cloudflare Turnstile
- **Proxy**: nginx (TLS via Let's Encrypt / certbot)
- **Containers**: Docker + Docker Compose v2
- **CI/CD**: GitHub Actions → rsync → VPS
