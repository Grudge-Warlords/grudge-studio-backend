# Grudge Studio Backend

Full-stack microservices backend for **grudgewarlords.com** and **grudgestudio.com**.

Built with Node.js · Docker · MySQL 8 · Redis 7 · nginx · Solana

---

## Service Map

| Service | Port | Domain | Description |
|---|---|---|---|
| **grudge-id** | 3001 | `id.grudgestudio.com` | Unified identity — Discord OAuth, Web3Auth, JWT |
| **wallet-service** | 3002 | *(internal only)* | Server-side Solana HD wallets (BIP44) |
| **game-api** | 3003 | `api.grudgestudio.com` | GAME_API_GRUDA — characters, missions, crews, inventory, professions, gouldstones |
| **ai-agent** | 3004 | *(internal only)* | Dynamic missions, Gouldstone behavior profiles, faction intel |
| **account-api** | 3005 | `account.grudgestudio.com` | User profiles, social, achievements, Puter cloud |
| **launcher-api** | 3006 | `launcher.grudgestudio.com` | Version manifest, computer registration, launch tokens |
| **grudge-headless** | 7777 | `ws.grudgestudio.com` | Game server WebSocket |

---

## Quick Start

### Local development

```bash
# 1. Clone
git clone https://github.com/MolochDaGod/grudge-studio-backend.git
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
| [docs/VPS.md](docs/VPS.md) | VPS deployment guide (Ubuntu, Docker, SSL, DNS) |
| [docs/API.md](docs/API.md) | Full API reference for all services |
| [docs/LAUNCHER.md](docs/LAUNCHER.md) | Game launcher integration guide |
| [docs/PUTER.md](docs/PUTER.md) | Puter cloud integration guide |

---

## Environment Variables

See [`.env.example`](.env.example) for all required variables.

Critical ones to set before first run:

```
JWT_SECRET                  # 64+ char random string
INTERNAL_API_KEY            # service-to-service auth
LAUNCH_TOKEN_SECRET         # one-time game launch tokens
WALLET_MASTER_SEED          # 24-word BIP39 mnemonic
DISCORD_CLIENT_ID / SECRET
WEB3AUTH_CLIENT_ID
OBJECT_STORAGE_*            # S3-compatible (R2, B2, AWS)
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

```
Internet
   │
   ▼
nginx (80/443)
   ├── id.grudgestudio.com      → grudge-id:3001
   ├── api.grudgestudio.com     → game-api:3003
   ├── account.grudgestudio.com → account-api:3005
   ├── launcher.grudgestudio.com→ launcher-api:3006
   └── ws.grudgestudio.com      → grudge-headless:7777

Internal (grudge-net Docker bridge — NOT exposed):
   game-api     → ai-agent:3004   (AI missions)
   grudge-id    → wallet-service:3002 (wallet creation)
   game-api     → account-api:3005  (achievement awards)
   launcher-api → grudge-headless  (launch token validation)

Data:
   All services → MySQL:3306 (grudge_game)
   game-api     → Redis:6379 (session cache)
```

---

## Deployment

Pushes to `main` automatically deploy via GitHub Actions (`.github/workflows/deploy.yml`).

Required GitHub Secrets:
- `DEPLOY_SSH_KEY` — private key for VPS SSH
- `VPS_HOST` — `74.208.155.229`
- `VPS_USER` — your VPS user (e.g. `root`)

---

## Tech Stack

- **Runtime**: Node.js 20
- **Framework**: Express 4
- **Database**: MySQL 8.0 (mysql2/promise)
- **Cache**: Redis 7 (ioredis)
- **Auth**: JWT (jsonwebtoken), Discord OAuth2, Web3Auth
- **Blockchain**: Solana (@solana/web3.js), BIP44 HD wallets (bip39, hdkey, tweetnacl)
- **Storage**: S3-compatible via @aws-sdk/client-s3
- **Proxy**: nginx (TLS via Let's Encrypt / certbot)
- **Containers**: Docker + Docker Compose v2
- **CI/CD**: GitHub Actions → rsync → VPS
