# Grudge Warlords Era Backend — System Reference (AGENTS.md)

> **RETIRED (2026-07):** This repo is **not** the live production backend. Agents must use
> **grudge-backend** (auth/API) and **GrudgeBuilder Railway** (game state Postgres SSOT).
> Fleet URLs: `GrudgeBuilder/shared/fleet/manifest.ts`. The content below is legacy reference only.

## Canonical production (use these, not this repo)

| Service | URL | Repo |
|---------|-----|------|
| Auth gateway | `https://id.grudge-studio.com` | grudge-backend |
| Unified API | `https://api.grudge-studio.com` | grudge-backend |
| Game state | `https://grudge-api-production-0d46.up.railway.app` | GrudgeBuilder |
| ObjectStore | `https://objectstore.grudge-studio.com/api/v1` | ObjectStore |
| Assets CDN | `https://assets.grudge-studio.com` | GrudgeBuilder workers/cdn |
| AI | `https://ai.grudge-studio.com` | grudge-ai-hub |

Health probes: `/api/health` on auth, api, and Railway; `/health` on objectstore and ai.

---

## Legacy VPS stack (archived — do not deploy)

### Auth (historical — was grudge-id in this repo)
Legacy auth source: `https://id.grudge-studio.com` (now served by **grudge-backend**, not grudge-id:3001).
- Issues the Grudge ID JWT consumed by every game service here.
- Storage keys: `grudge_auth_token` (JWT), `grudge_user_id`, `grudge_id` (UUID), `grudge_username`
- Legacy Vercel `auth-gateway-*` URLs are retired — do not introduce new auth gateways.

VPS Auth API: `https://id.grudge-studio.com`
- POST /auth/login, /auth/register, /auth/puter, /auth/wallet
- GET /auth/discord, /auth/google, /auth/github

Integration file: `grudge-auth.js` in this repo (drop-in client utility)

### VPS Services (74.208.155.229 via Cloudflare/Traefik)
- `https://id.grudge-studio.com` — auth (grudge-id, port 3001)
- `https://api.grudge-studio.com` — game API (game-api, port 3003)
- `https://account.grudge-studio.com` — accounts (account-api, port 3005)
- `https://assets-api.grudge-studio.com` — assets (asset-service, port 3008)
- `https://ws.grudge-studio.com` — websocket (ws-service, port 3007)
- `https://launcher.grudge-studio.com` — launcher (launcher-api, port 3006)

### Grudge UUID Format
`PREFIX-YYYYMMDDHHMMSS-XXXXXX-YYYYYYYY` (e.g. `USER-20260319233113-000001-1404462B`)
Never use uuidv4() or random IDs for game entities.

### Object Storage CDN
Primary: `https://assets.grudge-studio.com` (Cloudflare R2)
Fallback: `https://molochdagod.github.io/ObjectStore`
URL pattern: `{CDN}/{category}/{GRUDGE-UUID}.{ext}`

### Session Keys (localStorage)
- `grudge_auth_token` — Bearer JWT for all API calls
- `grudge_user_id` — numeric account ID
- `grudge_id` — Grudge UUID (USER-*)
- `grudge_username` — display name

### Do NOT
- Create new auth flows — use `id.grudge-studio.com`
- Use `uuidv4()` for entity IDs
- Hardcode asset URLs — use CDN helpers
- Use Replit — use Vercel for web apps
# Grudge Studio Backend — VPS Infrastructure

Created by **Racalvin The Pirate King**.

## SINGLE BACKEND SYSTEM

All Grudge Studio apps connect to ONE backend. Never create parallel auth or storage systems.
ObjectStore is the single source of truth for game data and assets.

### VPS Services (Docker / Coolify, `74.208.155.229`)
| Service | Public URL | Internal Port |
|---------|-----------|---------------|
| grudge-id | `https://id.grudge-studio.com` | 3001 |
| game-api | `https://api.grudge-studio.com` | 3003 |
| account-api | `https://account.grudge-studio.com` | 3005 |
| asset-service | `https://assets-api.grudge-studio.com` | 3008 |
| ws-service | `https://ws.grudge-studio.com` | 3007 |
| launcher-api | `https://launcher.grudge-studio.com` | 3006 |
| wallet-service | internal only | 3002 |
| ai-agent | internal only | 3004 |

### Auth (All Apps Use This)
Canonical auth source: `https://id.grudge-studio.com` (grudge-id). Legacy Vercel `auth-gateway-*`
URLs are retired — do not reintroduce them.
- Sets localStorage: `grudge_auth_token`, `grudge_user_id`, `grudge_id`, `grudge_username`

### Auth Endpoints (id.grudge-studio.com)
- `POST /auth/login` ? username/password
- `POST /auth/register` ? create account
- `GET  /auth/discord` ? Discord OAuth start
- `GET  /auth/discord/callback` ? Discord OAuth complete
- `POST /auth/puter` ? Puter SDK auth
- `POST /auth/wallet` ? Phantom wallet
- `GET  /auth/google` ? Google OAuth
- `GET  /auth/github` ? GitHub OAuth
- `GET  /health` ? health check

### Grudge UUID System
Format: `PREFIX-YYYYMMDDHHMMSS-XXXXXX-YYYYYYYY`
Example: `USER-20260319233113-000001-1404462B`
Module: `services/shared/uuid.js` (CommonJS)
```js
const { generate, isValid, parse } = require('../../shared/uuid');
const id = generate('asset', filename);  // ASST-...
```
NEVER use uuidv4() or Math.random() for entity IDs.

### Object Storage
CDN: `https://assets.grudge-studio.com` (Cloudflare R2, env: GRUDGE_CDN_URL)
Fallback: `https://molochdagod.github.io/ObjectStore`
Module: `services/shared/objectStore.js`
URL: `{CDN_BASE}/{category}/{GRUDGE-UUID}.{ext}`

### Shared Modules
- `services/shared/cors.js` ? CORS config for all services
- `services/shared/uuid.js` ? Grudge UUID generator
- `services/shared/objectStore.js` ? CDN URL resolution
- `services/shared/logEvent.js` ? event logging

### Database
- MySQL (Docker): `grudge_game` — the ONLY game/runtime database (Unity + WebGL + other games needing a game DB)
- portal-postgres (Docker): `rec0ded88` — used ONLY by the separate The-ENGINE portal-api, not game data
- Redis (Docker): sessions and caching
- Neon PostgreSQL / Supabase: removed — never reintroduce (single source of truth = MySQL `grudge_game`)

### Environment
All services: `NODE_ENV=production`
Trust proxy: `app.set('trust proxy', 1)` (NOT true)

### Game-API Routes (services/game-api/src/index.js)
All require JWT auth via shared/auth.js:
`/characters`, `/factions`, `/missions`, `/crews`, `/inventory`, `/professions`, `/gouldstones`, `/economy`, `/crafting`, `/combat`, `/islands`, `/arena`, `/player-islands`, `/pvp`, `/admin`

### Frontend Apps Connecting to This Backend
| App | URL | Rewrites to |
|-----|-----|------------|
| Grudge Warlords (Web Engine 1) | grudgewarlords.com | /api/game/* → api.grudge-studio.com |
| grudgeDot Assistant | grudgedot-launcher.vercel.app | Direct proxy in server/grudgeAuth.ts |
| Grudge Engine Web (Web Engine 2) | grudge-engine-web.vercel.app | Direct fetch to api.grudge-studio.com |
| Dashboard | dash.grudge-studio.com | Direct |

### Cloudflare Workers
| Worker | Domain | Purpose |
|--------|--------|---------|
| grudgeassets | objectstore.grudge-studio.com | R2 asset CRUD, 3D model API, conversion pipeline |
| grudge-ai-hub | ai.grudge-studio.com | AI agents, Workers AI, R2 storage |
| grudge-route-monitor | grudge-route-monitor.grudge.workers.dev | Health checks every 5 min |

### Local Development Stack
`docker-compose.local.yml` runs MySQL, Redis, grudge-id, account-api, wallet-service locally.
Exposed via Cloudflare Tunnel. Start: `scripts/start-local.ps1`

### Code Standards
- Node.js CommonJS in all VPS services
- Shared modules referenced as `require('../../shared/module')`
- Path from `src/routes/` = `../../../shared/` (3 hops to /app/shared/)
- Path from `src/` = `../../shared/` (2 hops to /app/shared/)
- NEVER bypass auth middleware. All routes go through requireAuth.
- NEVER trust client-provided grudge_id or role — extract from JWT.
- Use applyGold() from economy.js for ALL gold transactions (atomic).
- Rate limiting: 200 req/min global, 30 req/min economy, 60 req/min PvP.
