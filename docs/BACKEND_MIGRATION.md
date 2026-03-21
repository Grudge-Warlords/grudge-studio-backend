# Backend Migration — Complete Reference
**Date:** March 21, 2026
**Status:** ✅ COMPLETE — All deployments unified on single VPS backend

---

## What Changed

Every Grudge Studio frontend, game, and service was migrated to use a **single canonical backend** running on VPS `74.208.155.229` via Docker/Coolify.

### The Canonical Backend
- **Auth:** `https://id.grudge-studio.com` (Grudge ID service, MySQL 8)
- **Game API:** `https://api.grudge-studio.com` (GAME_API_GRUDA)
- **Account:** `https://account.grudge-studio.com`
- **Launcher:** `https://launcher.grudge-studio.com`
- **WebSocket:** `https://ws.grudge-studio.com`
- **Assets CDN:** `https://assets.grudge-studio.com` (Cloudflare R2)
- **DB:** MySQL 8.0 (`grudge_game`) — single source of truth
- **Cache:** Redis 7 for sessions, pub/sub, matchmaking

### What Was Removed
- **Neon PostgreSQL** — was used by grudge-platform and auth-gateway Vercel functions
- **Supabase** — was referenced in auth-gateway and grudachain
- **Railway PostgreSQL** — was used by grudge-studio monorepo (`gruda-legion-production.up.railway.app`)
- **Replit Object Storage** — was used by WCS (`grudge-crafting.replit.app`)
- **Vercel serverless functions doing direct DB queries** — replaced with VPS API proxies

---

## Dead URLs — NEVER USE THESE

These URLs are **permanently dead**. If you see them in any code, replace immediately:

| Dead URL | Replace With | Notes |
|----------|-------------|-------|
| `auth-gateway-flax.vercel.app` | `id.grudge-studio.com` | Repo archived, redirects to VPS |
| `gruda-legion-production.up.railway.app` | `api.grudge-studio.com` | Railway service deleted |
| `grudge-crafting.replit.app` | `api.grudge-studio.com` | Replit abandoned |
| Any `DATABASE_URL=postgresql://...` | Remove — use VPS API calls | No more direct DB from frontends |

---

## Repos Modified During Migration

### Code Changes (auth/API rewrites)
1. **grudge-platform** — 16 Vercel API functions → VPS proxy (PR #57)
2. **grudachain** — 5 files: server.js, app.config.ts, LobbyRoom.ts, IslandRoom.ts, index.html
3. **grudge-studio** (monorepo) — 17 files: puter-deploy HTMLs, ECOSYSTEM.md, configs, workers, docs
4. **auth-gateway** — Deprecated: all routes → 301 redirect to `id.grudge-studio.com`. Repo **ARCHIVED**.

### Config/Env Changes
5. **grudge-studio** monorepo — `.env.example` updated (DATABASE_URL removed, GRUDGE_*_URL added)
6. **grudge-studio** monorepo — `railway.toml` updated (PostgreSQL service removed)
7. **grudge-studio** monorepo — `vercel.json` updated (env vars point to VPS)
8. **grim-armada-web** — `.env.example` created pointing to VPS
9. **grudge-studio-backend** — `docker-compose.yml` CORS updated with 7 new origins

### Vercel Env Vars Set
10. **grudge-platform** Vercel project — `GRUDGE_AUTH_URL`, `GRUDGE_API_URL`, `GRUDGE_ACCOUNT_URL` added

### VPS Deployment
11. **VPS** — `docker compose up -d` with new CORS, all 6 services healthy

---

## How Frontend Auth Works Now

Every frontend follows this pattern:

```
User → Frontend (Vercel/Cloudflare/Puter)
         ↓ (fetch)
       id.grudge-studio.com/auth/login  (or /register, /guest, /discord, /wallet, /verify)
         ↓ (JWT)
       api.grudge-studio.com/...        (game data with Bearer token)
         ↓
       ws.grudge-studio.com             (real-time with JWT auth)
```

### For Vercel Frontends (proxy pattern)
If a Vercel app needs `/api/*` routes for backwards compatibility, use the proxy pattern from `grudge-platform/api/_grudge-proxy.js`:
```javascript
const { proxyToGrudge } = require('./_grudge-proxy');
module.exports = async (req, res) => proxyToGrudge('/auth/login', req, res);
```

### For Direct Frontends (React/Three.js apps)
Call VPS directly:
```javascript
const AUTH_URL = import.meta.env.VITE_BACKEND_URL || 'https://api.grudge-studio.com';
const res = await fetch(`${AUTH_URL}/auth/login`, { method: 'POST', body: JSON.stringify({...}) });
```

---

## CORS — Adding New Frontends

When deploying a new frontend to Vercel/Cloudflare/Puter:
1. Add its origin to `CORS_ORIGINS` in `docker-compose.yml` line 19
2. Push to GitHub: `git push origin main`
3. Deploy to VPS: `ssh -i ~/.ssh/grudge_deploy root@74.208.155.229 "cd /opt/grudge-studio-backend && git pull && docker compose up -d"`

---

## Verification Commands

```bash
# Check VPS services are healthy
ssh -i ~/.ssh/grudge_deploy root@74.208.155.229 "docker ps --format 'table {{.Names}}\t{{.Status}}'"

# Test auth endpoint
curl https://id.grudge-studio.com/health

# Test game API
curl https://api.grudge-studio.com/health

# Scan repos for dead URLs (should return 0 results excluding archived/docs)
# On GitHub: search "auth-gateway-flax.vercel.app user:MolochDaGod"
```
