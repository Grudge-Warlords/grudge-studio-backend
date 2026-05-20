# Grudge Studio — Master Backend Context
**For AI Assistants, Agents, and Developers**
Version: 2.0 | VPS: `74.208.155.229` | Last updated: March 2026

---

> **How to use this doc**
> Paste the relevant section(s) from this file into any AI tool, IDE agent (Cursor, Copilot, Warp Oz, etc.), or chat to instantly give it full context on the Grudge Studio infrastructure. Each section is self-contained.

---

## 1. Quick Paste — AI Prompt Block

Paste this entire block at the start of any AI session that needs backend context:

```
You are working on the Grudge Studio game backend for Grudge Warlords.

INFRASTRUCTURE:
- VPS: 74.208.155.229 (Debian/Ubuntu, Docker + Coolify)
- GitHub repo: https://github.com/MolochDaGod/grudge-studio-backend
- Cloudflare zone: e8c0c2ee3063f24eb31affddabf9730a (grudge-studio.com)
- Cloudflare account: ee475864561b02d4588180b8b9acf694

LIVE ENDPOINTS:
- https://grudge-studio.com          — Main site (Cloudflare Worker)
- https://id.grudge-studio.com       — Identity / Auth API  (port 3001)
- https://api.grudge-studio.com      — Game API / GAME_API_GRUDA (port 3003) — branded landing page + favicon
- https://account.grudge-studio.com  — Account / Profile API (port 3005)
- https://launcher.grudge-studio.com — Launcher / Patch API (port 3006)
- https://ws.grudge-studio.com       — WebSocket / Socket.IO (port 3007)
- https://assets.grudge-studio.com   — R2 CDN Worker (Cloudflare R2)
- https://dash.grudge-studio.com     — Admin Dashboard (Cloudflare Worker)

STATIC DATA (ObjectStore):
- https://molochdagod.github.io/ObjectStore — GitHub Pages static JSON API
- /api/v1/weapons.json, armor.json, materials.json, races.json, classes.json,
  factions.json, skills.json, professions.json, attributes.json, consumables.json

TECH STACK:
- Node.js 20, Express, MySQL 8, Redis 7, Socket.IO 4.7
- Docker Compose, Coolify (self-hosted PaaS), Traefik reverse proxy
- Cloudflare Workers, R2 (object storage), D1 (dashboard DB), KV (rate limiting)
- Solana / Web3Auth for wallet auth

AUTH:
- All external API calls need: Authorization: Bearer <JWT>
- JWT issued by https://id.grudge-studio.com/auth/web3auth or /auth/discord
- Internal service calls use header: x-internal-key: <INTERNAL_API_KEY>

DEPLOYMENT PATH:
- Edit code locally → git push → SCP to VPS or docker compose rebuild
- VPS path: /opt/grudge-studio-backend/
- docker compose file at /opt/grudge-studio-backend/docker-compose.yml
- Secrets in /opt/grudge-studio-backend/.env (never commit)

INTERNAL NETWORK:
- Services communicate via Docker network "grudge-net"
- wallet-service and ai-agent are internal only (no external exposure)
- MySQL: grudge-mysql:3306, Redis: grudge-redis:6379
```

---

## 2. Full Service Map

| Service | Container | Port | URL | Network |
|---------|-----------|------|-----|---------|
| Grudge Identity | `grudge-id` | 3001 | id.grudge-studio.com | external |
| Wallet Service | `wallet-service` | 3002 | (internal only) | internal |
| Game API | `game-api` | 3003 | api.grudge-studio.com | external | Serves branded landing page at `/`, favicon at `/favicon.png` |
| AI Agent | `ai-agent` | 3004 | (internal only) | internal |
| Account API | `account-api` | 3005 | account.grudge-studio.com | external |
| Launcher API | `launcher-api` | 3006 | launcher.grudge-studio.com | external |
| WebSocket | `ws-service` | 3007 | ws.grudge-studio.com | external |
| MySQL | `grudge-mysql` | 3306 | (internal only) | internal |
| Redis | `grudge-redis` | 6379 | (internal only) | internal |
| Headless Server | `grudge-headless` | 7777 | (gameserver profile only) | internal |

**Cloudflare Workers** (no VPS — deployed via `npx wrangler deploy`):

| Worker | Route | Config |
|--------|-------|--------|
| `grudge-studio-site` | grudge-studio.com/* | cloudflare/workers/site/ |
| `grudge-dashboard` | dash.grudge-studio.com/* | cloudflare/workers/dashboard/ |
| `grudge-r2-cdn` | assets.grudge-studio.com/* | cloudflare/workers/r2-cdn/ |

---

## 3. Authentication Reference

### JWT Auth (Player-Facing)
```
POST https://id.grudge-studio.com/auth/web3auth
Body: { idToken: "<Web3Auth ID token>", wallet: "<solana_pubkey>" }

POST https://id.grudge-studio.com/auth/discord
Body: { code: "<Discord OAuth code>" }

Response: { token: "<JWT>", grudge_id: "<uuid>", ... }
```
Use the returned `token` as `Authorization: Bearer <token>` on all API calls.

JWT payload contains: `{ grudge_id, wallet, roles[], iat, exp }`

### Internal API Key (Service-to-Service)
```
Header: x-internal-key: <INTERNAL_API_KEY>
```
Used for Game API internal routes: `/economy/award`, `/combat/log`, `/islands/:key/claim`, `/crafting/:id/complete`.

### Turnstile (Bot Protection)
```
Header: x-cf-turnstile-response: <turnstile_token>
```
Required on auth endpoints when `CF_TURNSTILE_SECRET_KEY` is set in .env.

---

## 4. Game API — Endpoint Reference

**Base URL:** `https://api.grudge-studio.com`

### Root / Status
```
GET  /                               — Branded landing page (HTML) with favicon
GET  /health                         — { status: 'ok', service: 'game-api', version: '2.0.0' }
GET  /favicon.png                    — Grudge Studio favicon (static, 7d cache)
```

### Economy
```
GET  /economy/balance?char_id=X      — Gold balance + last 20 transactions
POST /economy/spend                  — Deduct gold (purchase | craft_cost)
POST /economy/transfer               — Player-to-player transfer (max 100k)
POST /economy/award  [INTERNAL]      — Award gold (missions, events)
```

### Crafting
```
GET  /crafting/recipes               — All 80+ recipes (?class=warrior&tier=3)
GET  /crafting/queue                 — Player's active crafting queue
POST /crafting/start                 — Start crafting (validates class, prof level, gold)
PATCH /crafting/:id/complete [INT]   — Complete a craft, deliver item
DELETE /crafting/:id                 — Cancel craft, refund gold
```

### Combat
```
POST /combat/log  [INTERNAL]         — Record combat result, fires achievements
GET  /combat/history?char_id=X       — Combat history for a character
GET  /combat/leaderboard             — Top 25 by kills
```

### PvP (v2)
```
GET  /pvp/lobbies                    — Open lobbies (?mode=duel|crew_battle|arena_ffa&limit=N)
POST /pvp/lobbies                    — Create lobby { mode, island, is_private }
GET  /pvp/lobbies/:code              — Lobby detail
POST /pvp/lobbies/:code/join         — Join lobby
POST /pvp/lobbies/:code/ready        — Toggle ready
POST /pvp/lobbies/:code/leave        — Leave lobby
POST /pvp/lobbies/:code/start [INT]  — Force-start lobby (internal)
GET  /pvp/queue                      — Player's current queue status
POST /pvp/queue                      — Join matchmaking queue { mode }
DELETE /pvp/queue                    — Leave matchmaking queue
GET  /pvp/leaderboard                — ELO rankings (?mode=duel&limit=10)
GET  /pvp/match/:id                  — Match detail
POST /pvp/match/:id/result [INT]     — Submit match result + ELO update

Modes: duel (2p) · crew_battle (up to 10) · arena_ffa (up to 16)
ELO:   K=32, default 1200, floor 100, queue range ±150, TTL 300s
Codes: GRD-XXXX format
```

### Islands (10 islands: island_1 through island_10)
```
GET   /islands                       — All islands + current state
GET   /islands/:key                  — Single island detail
PATCH /islands/:key/claim  [INT]     — Claim island for crew
PATCH /islands/:key/players [INT]    — Update active player list
PATCH /islands/:key/resources [INT]  — Update resource state
```

### Missions
```
GET  /missions                       — Active missions for user
POST /missions                       — Create mission (AI-generated)
PATCH /missions/:id/complete         — Complete mission, triggers gold award
DELETE /missions/:id                 — Abandon mission
```

### Crews
```
GET  /crews                          — Player's current crew
POST /crews/create                   — Create crew (3-5 members)
POST /crews/:id/join                 — Request to join crew
POST /crews/:id/leave                — Leave crew
POST /crews/:id/claim-base           — Claim island base with Pirate Claim flag
```

### Characters
```
GET  /characters                     — All characters for authenticated user
POST /characters                     — Create character (race + class selection)
GET  /characters/:id                 — Character detail + stats
PATCH /characters/:id                — Update character
```

---

## 5. WebSocket Events — Socket.IO

**URL:** `wss://ws.grudge-studio.com`

### Connect with Auth
```javascript
const socket = io('https://ws.grudge-studio.com/game', {
  auth: { token: '<JWT>' }
});
```

### Namespaces

**`/game`** — Island game rooms
```javascript
socket.emit('join-island', { island_key: 'island_1' });
socket.on('island-update', (data) => { /* island state change */ });
socket.on('player-joined', (data) => { /* player entered island */ });
socket.on('player-left', (data) => { /* player left island */ });
socket.on('z-battle-cry', (data) => { /* Z key broadcast */ });
```

**`/crew`** — Crew coordination
```javascript
socket.on('crew-event', (data) => { /* crew joined/left/claimed */ });
```

**`/global`** — Server-wide broadcasts
```javascript
socket.on('mission-complete', (data) => { /* any player completed mission */ });
socket.on('island-claimed', (data) => { /* crew claimed an island */ });
socket.on('combat-result', (data) => { /* PvP outcome */ });
```

**`/pvp`** — PvP lobby & matchmaking (v2)
```javascript
const pvp = io('https://ws.grudge-studio.com/pvp', { auth: { token: '<JWT>' } });

// Lobby
pvp.emit('join_lobby',  { lobby_code });      // join via code
pvp.emit('leave_lobby', { lobby_code });
pvp.emit('ready',       { lobby_code });

// Match events (server → client)
pvp.on('lobby_update',   (data) => { /* player list, ready status */ });
pvp.on('countdown',      ({ seconds }) => { /* 3-2-1 */ });
pvp.on('match_start',    ({ match_id, players }) => { /* match begins */ });
pvp.on('match_end',      ({ winner_id, elo_changes }) => { /* result */ });

// Matchmaking queue
pvp.emit('join_queue',  { mode: 'duel' });
pvp.on('queue_matched', ({ lobby_code }) => { /* auto-join lobby code */ });

// In-match action relay
pvp.emit('action', { match_id, type, payload });
pvp.on('opponent_action', (action) => { /* relay from opponent */ });
```

### Redis Event Channels (pub/sub bridge)
```
grudge:event:mission     — Mission completions
grudge:event:combat      — Combat logs
grudge:event:island      — Island state changes
grudge:event:crew        — Crew events
grudge:event:z-cry       — Z-key battle cry
grudge:event:global      — Broadcast events
grudge:event:pvp_lobby   — Lobby state changes (created/joined/ready/left)
grudge:event:pvp_start   — Match started
grudge:event:pvp_result  — Match result + ELO deltas
grudge:event:pvp_queue   — Matchmaking pair found

Matchmaking queue keys (Redis sorted sets, scored by ELO):
  pvp:queue:duel · pvp:queue:crew_battle · pvp:queue:arena_ffa
```

---

## 6. ObjectStore — Static Game Data

**Source of Truth for all game item definitions.**

Base URL: `https://molochdagod.github.io/ObjectStore`

### JSON Endpoints
```
/api/v1/weapons.json      — 17 weapon categories, 816+ items, T0-T8
/api/v1/armor.json        — Armor slots (helm, chest, boots, gloves, etc.)
/api/v1/materials.json    — Ore, wood, cloth, leather, gems, essence
/api/v1/consumables.json  — Potions, food, bandages, grenades
/api/v1/skills.json       — Weapon skill trees
/api/v1/professions.json  — Miner, Forester, Mystic, Chef, Engineer
/api/v1/races.json        — Human, Orc, Elf, Undead, Barbarian, Dwarf
/api/v1/classes.json      — Warrior, Mage, Ranger, Worge
/api/v1/factions.json     — Crusade, Legion, Fabled
/api/v1/attributes.json   — STR, INT, VIT, DEX, END, WIS, AGI, TAC
/api/v1/bosses.json       — Boss definitions and loot tables
/api/v1/enemies.json      — Enemy/mob definitions
```

### Usage in Code
```javascript
// Fetch weapons
const res = await fetch('https://molochdagod.github.io/ObjectStore/api/v1/weapons.json');
const { categories } = await res.json();
const swords = categories.swords.items;

// Icon URLs
const iconUrl = `https://molochdagod.github.io/ObjectStore/icons/weapons/Sword_01.png`;
```

### GRUDGE UUID System
```
Format: {PREFIX}-{TIMESTAMP}-{SEQUENCE}-{HASH}
Example: ITEM-20260225120000-000001-A1B2C3D4

Prefixes: ITEM, HERO, MATL, EQIP, ABIL, RECP, NODE, MOBS, BOSS, MISS
```

### Tier Color System
```
T1 Bronze  #8b7355 — Common
T2 Silver  #a8a8a8 — Uncommon
T3 Blue    #4a9eff — Rare
T4 Purple  #9d4dff — Epic
T5 Red     #ff4d4d — Legendary
T6 Orange  #ffaa00 — Mythic
T7 Gold    #d4a84b — Ancient
T8 Shimmer #f0d890 — Legendary Artifact (animated)
```

---

## 7. AI Agent — Internal Service

**URL (internal only):** `http://ai-agent:3004`  
**Access:** `x-internal-key` header required from other services

### Routes
```
GET  /health
GET  /ai/context             — Full system context JSON (game rules, factions, etc.)
POST /ai/mission/generate    — Generate a mission for a player
POST /ai/companion/interact  — AI companion dialogue / action
GET  /ai/faction/intel       — Faction-level mission + behavioral data
```

### Mission Generation (called by game-api)
```javascript
// game-api calls internally:
const mission = await fetch('http://ai-agent:3004/ai/mission/generate', {
  method: 'POST',
  headers: { 'x-internal-key': process.env.INTERNAL_API_KEY },
  body: JSON.stringify({ grudge_id, faction, level, type })
});
```

---

## 8. Database Schema Overview

**Database:** `grudge_game` (MySQL 8.0)

### Core Tables
```sql
users            — grudge_id (UUID), wallet, discord_id, roles, banned
characters       — id, grudge_id, name, race, class, level, gold, stats JSON
character_wallets — server-side Solana wallets per character
sessions         — JWT session tracking
```

### Economy (04-economy.sql)
```sql
characters.gold        — BIGINT column added
gold_transactions      — grudge_id, char_id, amount, type, ref_id, balance_after, note
```

### Crafting (05-crafting.sql)
```sql
crafting_recipes   — 80+ recipes (weapon, armor, cape, relic) T1-T6 with profession reqs
crafting_queue     — Active crafting jobs with completion timer
```

### Combat + World (06-world.sql)
```sql
combat_log     — attacker, defender, outcome, combat_data JSON
island_state   — 10 islands, controlling_crew_id, active_players JSON, resources JSON
```

### Missions + Crews
```sql
missions       — id, grudge_id, char_id, type, objectives JSON, rewards JSON, status
crews          — id, name, leader_id, members JSON, faction, base_island
crew_members   — crew_id, grudge_id, role
```

---

## 9. Coolify + VPS Server Management

### What is Coolify?
Coolify is the self-hosted PaaS running on the VPS. It manages Docker containers via SSH and provides the web UI for deployments, environment variables, and server health.

### Access
- **Coolify Dashboard:** `http://74.208.155.229:8000` (or configured domain)
- **VPS SSH:** `ssh root@74.208.155.229`
- **Proxy:** `coolify-proxy` (Traefik) — handles all TLS/routing
- **Docker network shared with Coolify:** `coolify` (external)

### OpenSSH Configuration (Coolify Best Practices)

Based on https://coolify.io/docs/knowledge-base/server/openssh:

**Required `/etc/ssh/sshd_config` settings:**
```
PubkeyAuthentication yes
PermitRootLogin prohibit-password
```

**Key rules:**
- SSH key must be **Ed25519** type
- Key must have **no passphrase** (Coolify automation requires unattended SSH)
- Key must have **no 2FA** on the SSH user
- Key stored at `/data/coolify/ssh/keys/` with ownership `chown 9999`

**CRITICAL:** Add your SSH keys to `~/.ssh/authorized_keys` BEFORE setting
`PermitRootLogin prohibit-password` — or you'll lock yourself out.

### Adding a New Remote Server / Legion Node

To add a second VPS or legion node to Coolify management:

**Step 1 — On the new server, install OpenSSH:**
```bash
apt update && apt install -y openssh-server
systemctl enable --now ssh
```

**Step 2 — Configure SSH on new server:**
```bash
nano /etc/ssh/sshd_config
# Set:
# PubkeyAuthentication yes
# PermitRootLogin prohibit-password
systemctl restart ssh
```

**Step 3 — On the Coolify server (main VPS), generate an SSH key:**
```bash
ssh-keygen -t ed25519 -a 100 \
  -f /data/coolify/ssh/keys/id.root@legion-node-1 \
  -q -N "" -C root@coolify
chown 9999 /data/coolify/ssh/keys/id.root@legion-node-1
```

**Step 4 — Authorize Coolify's key on the new server:**
```bash
# Run on the new server:
mkdir -p ~/.ssh
# Paste the public key from the Coolify server:
# cat /data/coolify/ssh/keys/id.root@legion-node-1.pub
echo "<public_key_contents>" >> ~/.ssh/authorized_keys
chmod 700 ~/.ssh
chmod 600 ~/.ssh/authorized_keys
```

**Step 5 — Add the server in Coolify dashboard:**
1. Go to **Servers** → **+ Add Server**
2. Enter IP address of new server
3. Select the private key generated in Step 3
4. Click **Validate Server & Install Docker Engine**
5. Status should show **Proxy Running** ✅

**Step 6 — Deploy services to the node:**
- In Coolify, go to your application
- Under **Server**, select the new remote server
- Redeploy

### VPS Quick Commands
```bash
# SSH into VPS
ssh root@74.208.155.229

# Check all containers
docker ps

# View logs for a service
docker logs game-api --tail 50 -f

# Rebuild and restart a service
cd /opt/grudge-studio-backend
docker compose build game-api
docker compose up -d game-api

# Rebuild all services
docker compose build
docker compose up -d

# Apply a new SQL migration
PASS=$(grep MYSQL_ROOT_PASSWORD .env | cut -d= -f2)
docker exec grudge-mysql mysql -uroot -p"$PASS" grudge_game < mysql/init/07-new.sql

# Check Traefik routing
docker logs coolify-proxy --tail 30

# Environment file (NEVER commit)
nano /opt/grudge-studio-backend/.env
```

---

## 10. Environment Variables Reference

**File:** `/opt/grudge-studio-backend/.env`

| Variable | Description | Where Used |
|----------|-------------|------------|
| `MYSQL_ROOT_PASSWORD` | MySQL root password | MySQL, migrations |
| `MYSQL_DATABASE` | DB name (`grudge_game`) | All services |
| `MYSQL_USER` | DB app user | All services |
| `MYSQL_PASSWORD` | DB app password | All services |
| `JWT_SECRET` | 256-bit secret for JWT signing | grudge-id, game-api, account-api, launcher-api |
| `INTERNAL_API_KEY` | Service-to-service auth key | All services |
| `REDIS_PASSWORD` | Redis auth | game-api, ws-service |
| `DISCORD_CLIENT_ID` | Discord OAuth app ID | grudge-id |
| `DISCORD_CLIENT_SECRET` | Discord OAuth secret | grudge-id |
| `DISCORD_REDIRECT_URI` | `https://id.grudge-studio.com/auth/discord/callback` | grudge-id |
| `WEB3AUTH_CLIENT_ID` | Web3Auth client ID | grudge-id |
| `WALLET_MASTER_SEED` | BIP39 seed for HD wallet derivation | wallet-service |
| `SOLANA_RPC_URL` | Solana RPC (mainnet or devnet) | wallet-service |
| `LAUNCH_TOKEN_SECRET` | Signs launcher one-time tokens | launcher-api |
| `CF_TURNSTILE_SECRET_KEY` | Cloudflare Turnstile secret | grudge-id |
| `CF_TURNSTILE_SITE_KEY` | Cloudflare Turnstile site key | grudge-id (passed to clients) |
| `OBJECT_STORAGE_ENDPOINT` | R2 S3-compat endpoint | account-api, launcher-api |
| `OBJECT_STORAGE_BUCKET` | R2 bucket name (`grudge-assets`) | account-api, launcher-api |
| `OBJECT_STORAGE_KEY` | R2 access key ID | account-api, launcher-api |
| `OBJECT_STORAGE_SECRET` | R2 secret access key | account-api, launcher-api |
| `OBJECT_STORAGE_PUBLIC_URL` | `https://assets.grudge-studio.com` | account-api, launcher-api |
| `CORS_ORIGINS` | Comma-separated allowed origins | All services |
| `MAX_PLAYERS` | Max headless server slots (default 22) | grudge-headless |

**Cloudflare Workers secrets** (set via `npx wrangler secret put`):
```
DASH_API_KEY   → Internal API key for dashboard worker
```

---

## 11. Deployment Workflow

### Standard Code Deploy
```bash
# Local: edit code
git add .
git commit -m "feat: description"
git push origin main

# VPS: pull and rebuild
ssh root@74.208.155.229 "cd /opt/grudge-studio-backend && git pull && docker compose build game-api && docker compose up -d game-api"
```

### Cloudflare Worker Deploy
```bash
# From workers/site/ or workers/dashboard/ or workers/r2-cdn/
npx wrangler deploy --config cloudflare/workers/site/wrangler.toml
```

### New SQL Migration
1. Create file: `mysql/init/07-yourname.sql` (use `IF NOT EXISTS` guards)
2. SCP to VPS: `scp mysql/init/07-yourname.sql root@74.208.155.229:/opt/grudge-studio-backend/mysql/init/`
3. Apply: SSH + docker exec command above

### Full Rebuild
```bash
ssh root@74.208.155.229 "cd /opt/grudge-studio-backend && git pull && bash deploy-migrate.sh"
```

---

## 12. Game Design Context (for AI Content Generation)

### Races
Human, Orc, Elf, Undead, Barbarian, Dwarf

### Classes
- **Warrior** — Shields, swords, 2h weapons. Stamina system. Parry/block/charge. AoE + group invincibility.
- **Mage** — Staffs, tomes, wands, maces. Teleport blocks (max 10). Elemental builds.
- **Ranger** — Bows, crossbows, guns, daggers, spears. RMB+LMB parry → counter dash.
- **Worge** — 3 forms: Bear (tank), Raptor (stealth), Large Bird (flyable/mountable). Staffs, spears, bows.

### Factions
- **Crusade** — Allied with Human, Elf
- **Legion** — Allied with Orc, Undead
- **Fabled** — Allied with Barbarian, Dwarf

### Key Systems
- **Economy:** Gold currency, `applyGold()` on all transactions
- **Crafting:** 80+ recipes T1-T6, profession level requirements (Miner, Forester, Mystic, Chef, Engineer)
- **Islands:** 10 islands, crew base claiming with Pirate Claim flag
- **Missions:** AI-generated, faction-based, 4 types (harvest, fight, sail, compete), 11/day per crew
- **Gouldstone:** Item that creates AI clone companion with original player stats (up to 15 allies)
- **Z-key Combat:** Random chat bubble, stacking buffs, PvP trigger, WebSocket broadcast
- **Hotbar:** Slots 1-4 skills, slot 5 empty, slots 6-8 consumables
- **PvP Lobbies:** Duel (2p), Crew Battle (10p), Arena FFA (16p) — ELO rating, `GRD-XXXX` codes, `/pvp` Socket.IO namespace
- **Dashboard v2:** Cookie-based session auth (`POST /login`), 7 tabs (Overview/Servers/PvP Arena/Players/Storage/Events/Economy)

### Weapon Types (17 total)
Swords, 2H Swords, Axes (1H), Axes (2H), Daggers, Spears, Bows, Crossbows, Guns, Staffs, Wands, Tomes, Maces, Hammers, Shields, Relics, Capes

### Armor Sets (6 types × 3 tiers each)
Cloth, Leather, Metal — each with Helm, Chest, Legs, Boots, Gloves, Belt

---

## 13. Legion Node — What It Is

A **Legion Node** is a second VPS/server added to Coolify that can run:
- A headless Unity game server instance (`grudge-headless` Docker profile)
- Additional game-api replicas for load distribution
- Island-specific server clusters (one node per island region)
- WebSocket shards for high player counts

### Connecting a Legion Node to Existing Backend

The node must:
1. Join Docker network `coolify` (added by Coolify automatically after validation)
2. Have access to `REDIS_URL` pointing at the primary VPS Redis (`grudge-redis:6379`)
   - For cross-node: expose Redis on a private IP or use Redis Cloud
3. Share `JWT_SECRET` and `INTERNAL_API_KEY` from the same `.env`
4. Route traffic through the primary Traefik or its own Traefik with subdomain

### Recommended Legion Node Services
```yaml
# What to run on a legion node
services:
  - ws-service (WebSocket shards for specific island groups)
  - grudge-headless (Unity server for island gameplay)
  - game-api (read-only replica for heavy query loads)
```

---

## 14. Frontend → Backend Integration Status

All frontends should authenticate via `id.grudge-studio.com` and call `api.grudge-studio.com` for game data.

| Frontend | Auth Backend | Game Data Backend | Status |
|----------|-------------|-------------------|--------|
| grudge-platform.vercel.app | Own Vercel functions (`/api/login`) | N/A | ⚠ Should forward to `id.grudge-studio.com` |
| grudgewarlords.com | Own Vercel API (`/api/auth/*`) | Own Vercel API | ⚠ Should connect to VPS for game data |
| warlord-crafting-suite.vercel.app | auth-gateway-flax.vercel.app (Neon) | `grudge-crafting.replit.app` (DEAD) | ❌ Needs VPS migration |
| gdevelop-assistant.vercel.app | auth-gateway-flax.vercel.app (Neon) | `gruda-legion-production.up.railway.app` (DEAD) | ❌ Needs VPS migration |
| grudachain.grudgestudio.com | N/A | Static links only | ✅ OK |
| dash.grudge-studio.com | Cloudflare Worker + `DASH_API_KEY` | VPS APIs | ✅ OK |

### Required CORS_ORIGINS (VPS .env)
```
https://grudgewarlords.com,https://grudge-studio.com,https://grudgestudio.com,https://grudge-platform.vercel.app,https://grudachain.grudgestudio.com,https://dash.grudge-studio.com,https://warlord-crafting-suite.vercel.app,https://gdevelop-assistant.vercel.app,https://app.puter.com
```

### Dead Service References to Replace
| Old URL (DEAD) | Replace With | Affected Projects |
|----------------|-------------|--------------------|
| `gruda-legion-production.up.railway.app` | `api.grudge-studio.com` | GDevelopAssistant (`shared/grudachain.ts`) |
| `grudge-crafting.replit.app` | `api.grudge-studio.com` | WCS (`client/src/lib/api.ts`) |
| `auth-gateway-flax.vercel.app` (Neon) | `id.grudge-studio.com` (VPS MySQL) | GDevelopAssistant, WCS |

---

## 15. Useful Links

| Resource | URL |
|----------|-----|
| GitHub Repo | https://github.com/MolochDaGod/grudge-studio-backend |
| Live Site | https://grudge-studio.com |
| Platform Hub | https://grudge-platform.vercel.app |
| Dashboard | https://dash.grudge-studio.com |
| API Health | https://api.grudge-studio.com/health |
| WS Health | https://ws.grudge-studio.com/health |
| ObjectStore | https://molochdagod.github.io/ObjectStore |
| Coolify Docs (SSH) | https://coolify.io/docs/knowledge-base/server/openssh |
| Warlord Crafting Suite | https://warlord-crafting-suite.vercel.app |
| GDevelop Assistant | https://gdevelop-assistant.vercel.app |
| Grudge Warlords Game | https://grudgewarlords.com |
