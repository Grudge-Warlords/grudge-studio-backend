---
name: grudge-studio-architecture
description: |
  Grudge Studio game studio infrastructure architecture, service map, and deployment guide.
  Use this skill when working on ANY Grudge Studio project — backend services, frontend apps,
  auth, wallet, game integration, Docker, VPS, Vercel, or Cloudflare configuration.
  Covers: grudge-studio-backend, grudge-wars (WCS), grudgedot-launcher, grudachain, grudge-platform,
  StarWayGRUDA-WebClient, grudge-builder, ObjectStore, GRUDA-Node, grim-armada-web.
---

# Grudge Studio Architecture

Created by Racalvin The Pirate King. All backend runs on VPS. All frontends on Vercel.

## VPS Backend (Docker Compose — single source of truth)

Repository: `grudge-studio-backend` (github.com/Grudge-Warlords/grudge-studio-backend)

All services share `grudge-net` Docker network + MySQL database. Traefik (via Coolify) handles TLS + routing.

| Service | Port | Domain | Role |
|---------|------|--------|------|
| grudge-id | 3001 | id.grudge-studio.com | Auth: login, register, guest, Discord/Google/GitHub OAuth, Phantom wallet, Puter, phone SMS. Issues JWTs. |
| game-api | 3003 | api.grudge-studio.com | Game data: characters, inventory, missions, factions, combat, economy, grudgeDot proxy target |
| account-api | 3005 | account.grudge-studio.com | Profiles, social, achievements, object storage (R2) |
| launcher-api | 3006 | launcher.grudge-studio.com | Version manifest, computer registration, launch tokens |
| ws-service | 3007 | ws.grudge-studio.com | Real-time WebSocket (Socket.IO): /game, /crew, /global namespaces |
| asset-service | 3008 | assets-api.grudge-studio.com | Upload, metadata, conversions, export bundles |
| wallet-service | 3002 | internal only | HD wallet derivation + Phantom Server SDK. Called by grudge-id on account creation. |
| ai-agent | 3004 | internal only | Dynamic missions, companions, faction intel (Anthropic/OpenAI/Gemini) |
| grudge-bridge | 4000 | bridge.grudge-studio.com | 3-node VPS ops: backups, dumps, SHA verification, deploy orchestration |
| uptime-kuma | 3001* | status.grudge-studio.com | Service health monitoring dashboard |
| portal-api | 5000 | portal-api.grudge-studio.com | Gaming portal backend (The Engine) |
| mysql | 3306 | internal | Primary database (accounts, characters, items, gold, factions) |
| redis | 6379 | internal | Cache, session store, pub/sub for ws-service |
| grudge-headless | 7777 | internal | Unity Linux game server (profile-gated, not always running) |

### Auth Flow (all apps use this)
```
Player → Any Grudge App → id.grudge-studio.com/auth/{method}
  Methods: /login, /register, /guest, /discord, /google, /github, /wallet, /puter, /phone-send, /phone-verify
  Response: { success, token (JWT), grudgeId, username }
  Storage: localStorage key "grudge_auth_token"
```

### Wallet Integration
- Frontend: `@phantom/browser-sdk` or `@phantom/react-sdk`
- App ID: `656b4ef2-7acc-44fe-bec7-4b288cfdd2e9`
- Backend: `@phantom/server-sdk` in wallet-service for game rewards, signing
- Every Grudge account gets a server-side HD wallet (BIP44 m/44'/501'/{index}'/0')

### Cross-App SSO
- `grudge-sso.js` intercepts cross-app link clicks, appends ?token=...&username=...&grudge_id=...
- All apps capture inbound tokens from URL params on boot
- Shared localStorage keys: grudge_auth_token, grudge_id, grudge_username, grudge_user_id

## Vercel Frontend Deployments

With custom domains:
- grudgewarlords.com → grudge-builder — Main game portal / entry point
- grudge-studio.com → the-engine — Landing page / marketing site
- id.grudge-studio.com → auth-gateway — Vercel serverless proxy to VPS grudge-id. Auth SSO pages
- dash.grudge-studio.com → grudge-studio-dash — Admin dashboard
- play.grudge-studio.com → star-way-gruda-web-client — 3D game client (BabylonJS)
- info.grudge-studio.com → grudge-game-data-hub — Game info / wiki
- grudachain.grudgestudio.com → grudachain — Nexus hub, link directory
- apps.grudge-studio.com → grudge-platform — App launcher, ops dashboard
- dcq.grudge-studio.com → dungeon-crawler-quest — 3D dungeon game
- armada.grudge-studio.com → grim-armada-web — Ship battle game

Pending custom domain (fix build first):
- wcs.grudge-studio.com → grudge-wars — WCS / Grudge Warlords game (fix build error before assigning)
- dev.grudge-studio.com → grudgedot-launcher — Dev tools, AI chat, editors (fix build error before assigning)

Other Vercel (no custom domain needed):
- objectstore.vercel.app → objectstore — Game data API mirror (canonical: molochdagod.github.io/ObjectStore)
- tge-billing.vercel.app → tge-billing — Billing

THC-Labz (separate brand, DO NOT TOUCH):
thc-labz-battle, thc-dope-budz, thc-labz-site, growerz-collection, market-app, thc-growerz-nft-sdk, thc-dope-budz-client

## Cloudflare Workers

- assets.grudge-studio.com → r2-cdn worker — R2 CDN serving game assets
- wallet.grudge-studio.com → site worker — Wallet info/connect page
- ai.grudge-studio.com → ai-hub worker — AI agents, Gemini/Anthropic gateway
- objectstore.grudge-studio.com → objectstore-api worker — R2 metadata API (needs DNS fix)

Removed routes (2026-03-31 audit):
- grudge-studio.com/* — was conflicting with Vercel the-engine (removed from site worker)
- dash.grudge-studio.com/* — was conflicting with Vercel grudge-studio-dash (removed from dashboard worker)
- client.grudge-studio.com/* — redundant with play.grudge-studio.com (removed from site worker)
- auth.grudge-studio.com/* — dead, auth is at id.grudge-studio.com (removed from auth-gateway worker)

## Cloudflare DNS (grudge-studio.com managed via Cloudflare)

Backend subdomains → Cloudflare Tunnel → VPS Docker containers
Frontend subdomains → CNAME → cname.vercel-dns.com
Worker subdomains → Worker routes (zone e8c0c2ee3063f24eb31affddabf9730a)

DNS records needed (add in Cloudflare dashboard):
- apps CNAME → cname.vercel-dns.com (proxied)
- dcq CNAME → cname.vercel-dns.com (proxied)
- armada CNAME → cname.vercel-dns.com (proxied)
- wcs CNAME → cname.vercel-dns.com (proxied) — after build fix
- dev CNAME → cname.vercel-dns.com (proxied) — after build fix
- portal-api CNAME → tunnel UUID (same as api record) — for portal-api VPS service
- assets-api CNAME → tunnel UUID (same as api record) — for asset-service VPS service

## Local Development (Windows)

Docker Desktop runs ONLY for local dev:
- grudge-id + grudge-mysql (local auth testing)
- cloudflared (tunnel for dev)
- portainer_agent (Docker UI)

NO production traffic goes through local machine.

## Key Repositories

| Repo | What |
|------|------|
| grudge-studio-backend | Docker compose, all backend services |
| grudge-wars (GrudgeWars) | WCS frontend (React 19, Vite) |
| grudgedot-launcher | Dev tools frontend (React 18, Vite) |
| grudachain | Nexus hub (vanilla HTML) |
| grudge-platform | App launcher (vanilla HTML) |
| StarWayGRUDA-WebClient | 3D game client |
| grudge-builder | Main portal (grudgewarlords.com) |
| ObjectStore | Game data JSON API (GitHub Pages) |
| phantom-connect-sdk | Reference — Phantom wallet SDK |

## Game Server Architecture (Real-time + PvP)

Already built in docker-compose:

### ws-service (port 3007, ws.grudge-studio.com)
Socket.IO server with 4 namespaces:
- `/game` — Island rooms. Players join by island, get player:join/leave, combat:z_key events.
- `/crew` — Crew chat rooms. crew:message relay within crew groups.
- `/pvp` — PvP lobbies. join_lobby, leave_lobby, ready, action relay (attack/parry/dodge/z_key/ability/worge_form/hit/death/position). Supports headless server push via pvp:game_state and pvp:server_match_end.
- `/global` — Faction standings, announcements, mission completions.

All namespaces use JWT auth middleware. Redis pub/sub bridges events from game-api and ai-agent.

### PvP Server Manager (in game-api)
Manages headless Unity game server pool via Redis:
- Servers register with heartbeat (30s TTL)
- `allocateServer(lobby_code, player_count)` assigns idle server
- `markInMatch()`, `releaseServer()`, `deregisterServer()`
- Matchmaking worker in ws-service runs every 2s, pairs players within ±150 ELO
- Match modes: duel, crew_battle, arena_ffa

### grudge-headless (port 7777, profile-gated)
Unity Linux dedicated game server. Connects to ws-service via internal Socket.IO.
Pushes authoritative game state, submits match results via pvp:server_match_end.
Requires `bin/` upload (not in git). Start with: `docker compose --profile gameserver up -d grudge-headless`

### What's NOT running but should be:
1. **redis** — Required by ws-service (pub/sub), game-api (cache, queues, server pool). Start on VPS.
2. **grudge-headless** — Unity server binary needs to be uploaded to VPS services/grudge-headless/bin/
3. **Chat system** — crew:message in /crew namespace works but needs:
   - Message persistence (currently ephemeral)
   - DM/whisper support
   - Global chat channel
   - Chat history API endpoint in game-api
   - Profanity filter
4. **Spectator mode** — /game namespace has island rooms but no spectator join without auth
5. **Server scaling** — Currently single headless server. For production need:
   - Multiple grudge-headless instances with unique server_ids
   - Server pool monitoring in uptime-kuma
   - Auto-scaling based on queue depth

## Environment Variables (VPS .env)

Critical keys (never expose):
- JWT_SECRET — shared across grudge-id, game-api, account-api, launcher-api
- MYSQL_ROOT_PASSWORD, MYSQL_PASSWORD
- INTERNAL_API_KEY — inter-service auth
- WALLET_MASTER_SEED — HD wallet derivation seed
- DISCORD_CLIENT_ID/SECRET, GOOGLE_CLIENT_ID/SECRET, GITHUB_CLIENT_ID/SECRET
- PHANTOM_APP_ID (656b4ef2-7acc-44fe-bec7-4b288cfdd2e9)
- OBJECT_STORAGE_ENDPOINT/KEY/SECRET (Cloudflare R2)
