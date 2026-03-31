---
name: grudge-studio-architecture
description: |
  Grudge Studio game studio infrastructure architecture, service map, and deployment guide.
  Use this skill when working on ANY Grudge Studio project — backend services, frontend apps,
  auth, wallet, game integration, Docker, VPS, Vercel, or Cloudflare configuration.
  Covers: grudge-studio-backend, grudge-wars (WCS), GDevelopAssistant, grudachain, grudge-platform,
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
| game-api | 3003 | api.grudge-studio.com | Game data: characters, inventory, missions, factions, combat, economy, GDevelop proxy target |
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

## Vercel Frontend Deployments (22 projects)

| Project | Domain | What |
|---------|--------|------|
| grudge-builder | grudgewarlords.com | Main game portal (StarWayGRUDA-WebClient) |
| grudachain | grudachain.grudgestudio.com | Nexus hub — link directory for all apps |
| grudge-platform | grudge-platform.vercel.app | App Launcher, ops dashboard |
| gdevelop-assistant | gdevelop-assistant.vercel.app | Dev tools, AI chat, 20+ games, editors |
| warlord-crafting-suite | warlord-crafting-suite.vercel.app | WCS game systems (grudge-wars repo) |
| the-engine | grudge-studio.com | Landing page / marketing |
| auth-gateway | id.grudge-studio.com | Auth SSO (Vercel serverless, proxies to VPS grudge-id) |
| grudge-studio-dash | dash.grudge-studio.com | Dashboard |
| star-way-gruda-web-client | play.grudge-studio.com | 3D game client |
| objectstore | objectstore.vercel.app | Game data API mirror |
| grudge-game-data-hub | info.grudge-studio.com | Game info |
| dungeon-crawler-quest | dungeon-crawler-quest.vercel.app | 3D dungeon game |
| grim-armada-web | grim-armada-web.vercel.app | Ship game |
| tge-billing | tge-billing.vercel.app | Billing |

THC-Labz (separate brand, do not modify):
thc-labz-battle, thc-dope-budz, thc-labz-site, growerz-collection, market-app, thc-growerz-nft-sdk, thc-dope-budz-client

## Cloudflare DNS (grudge-studio.com managed via Cloudflare)

Backend subdomains → Cloudflare Tunnel → VPS Docker containers
Frontend subdomains → CNAME → Vercel

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
| GDevelopAssistant | Dev tools frontend (React 18, Vite) |
| grudachain | Nexus hub (vanilla HTML) |
| grudge-platform | App launcher (vanilla HTML) |
| StarWayGRUDA-WebClient | 3D game client |
| grudge-builder | Main portal (grudgewarlords.com) |
| ObjectStore | Game data JSON API (GitHub Pages) |
| phantom-connect-sdk | Reference — Phantom wallet SDK |

## Environment Variables (VPS .env)

Critical keys (never expose):
- JWT_SECRET — shared across grudge-id, game-api, account-api, launcher-api
- MYSQL_ROOT_PASSWORD, MYSQL_PASSWORD
- INTERNAL_API_KEY — inter-service auth
- WALLET_MASTER_SEED — HD wallet derivation seed
- DISCORD_CLIENT_ID/SECRET, GOOGLE_CLIENT_ID/SECRET, GITHUB_CLIENT_ID/SECRET
- PHANTOM_APP_ID (656b4ef2-7acc-44fe-bec7-4b288cfdd2e9)
- OBJECT_STORAGE_ENDPOINT/KEY/SECRET (Cloudflare R2)
