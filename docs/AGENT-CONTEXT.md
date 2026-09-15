# Agent Context — grudge-studio-backend

*The file every AI agent should read before touching this repo. Last updated 2026-04-28.*

This is a condensed, AI-friendly summary. For full operational details see `GRUDGE-STUDIO-FLOWS.md` (kept locally by the human operator) and the per-topic docs in `docs/`.

## What this repo is
The **canonical backend** for Grudge Studio. Source of truth for user accounts, game logic, asset metadata, and the deployment bridge. Lives at `https://github.com/Grudge-Warlords/grudge-studio-backend`. Production deploy is on a Linux VPS at `74.208.155.229` under `/opt/grudge-studio-backend/`, fronted by a Cloudflare Tunnel and 8 Docker services.

## Architecture in one paragraph
Public traffic enters via Cloudflare DNS to either (a) a Cloudflare Worker for `assets.`, `objectstore.`, or `ai.` subdomains, or (b) a Cloudflare Tunnel container (`grudge-cloudflared`) that routes by Docker service name to a backend container. Backend is 8 Node services + MySQL 8.0 + Redis 7, all on the `grudge-studio-backend_grudge-net` Docker network. **MySQL `grudge_game` is the single canonical user-account store** (see "Critical rules" below). Cloudflare R2 bucket `grudge-assets` is the single canonical asset store.

## Subdomain → service map
| Subdomain | Service | Notes |
|---|---|---|
| `id.grudge-studio.com` | `grudge-id` :3001 | Auth/identity/JWT issuer. ALL login flows. |
| `api.grudge-studio.com` | `game-api` :3003 | Game logic, characters, inventory, missions, combat. |
| `account.grudge-studio.com` | `account-api` :3005 | Profiles, social, link-game. |
| `launcher.grudge-studio.com` | `launcher-api` :3006 | Launcher patch manifests. |
| `wallet.grudge-studio.com` | `wallet-service` :3002 | Solana wallet linking. |
| `ws.grudge-studio.com` | `ws-service` :3007 | Real-time WebSocket. |
| `assets.grudge-studio.com` | CF Worker `grudge-asset-cdn` | Reads R2 bucket `grudge-assets`. |
| `objectstore.grudge-studio.com` | CF Worker `grudgeassets` | Asset upload + metadata API. |
| `ai.grudge-studio.com` | CF Worker `grudge-ai-hub` | Behind Cloudflare Access. |
| `dash.grudge-studio.com` | Coolify | Admin dashboard. |
| `client.grudge-studio.com` | placeholder → `grudge-id` | Decide intent later. |

## Critical rules (do not violate)

### 1. Single canonical account DB — MySQL `grudge_game`
Read **`docs/ACCOUNT-DATABASE-RULES.md`** before touching anything that creates or updates user accounts. TL;DR:
- All user account writes go to MySQL `grudge_game` via the `grudge-id` service.
- Forbidden in account-writing services: `pg`, `postgres`, `@supabase/*`, `@neondatabase/*` imports.
- Forbidden env vars: `GRUDGE_ACCOUNT_DB`, `NEON_DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` pointing at neon.tech/supabase.co.
- Enforced by `shared/validate-env.js::validateCanonicalDB()` (runtime) and `.github/workflows/db-discipline.yml` (CI).

### 2. No secrets in code or git history
GitHub's secret scanner + Copilot have been auto-PRing fixes for hardcoded credentials. Don't paste API keys, tokens, JWT secrets, wallet seeds, or DB passwords anywhere except a `.env` file (which is `.gitignore`d). If you need a secret, reference it via `process.env.<NAME>` and document the var in `.env.example`.

### 3. Use Docker service names, not `localhost:PORT`, in cross-service URLs
Cloudflare Tunnel ingress (`/etc/cloudflared/config.yml` on VPS) uses `http://grudge-id:3001` style — Docker service names. Same for any container-to-container HTTP. `localhost:PORT` only works for things bound to the host (Coolify on 8000, grudge-bridge on 4000).

### 4. .env is gitignored. Keep it that way.
The repo's `.gitignore` excludes `.env`, `*.env*` (except `.env.example`), `*.pem`, `*.key`, `cloudflare/credentials.json`, `cloudflared.deb`, `*.bak`. Don't add anything that exposes secrets.

## Service inventory
| Service | Path | Status | Wired? |
|---|---|---|---|
| `grudge-id` | `services/grudge-id/` | ✅ healthy | ✅ validateCanonicalDB |
| `game-api` | `services/game-api/` | ✅ healthy | ✅ validateCanonicalDB |
| `account-api` | `services/account-api/` | ✅ healthy | ✅ validateCanonicalDB |
| `launcher-api` | `services/launcher-api/` | ✅ healthy | ✅ validateCanonicalDB |
| `ws-service` | `services/ws-service/` | ✅ healthy | ✅ validateCanonicalDB |
| `asset-service` | `services/asset-service/` | ✅ healthy | ✅ validateCanonicalDB |
| `wallet-service` | `services/wallet-service/` | ⚠️ "unhealthy" but working (cosmetic) | ✅ validateCanonicalDB |
| `grudge-bridge` | `services/grudge-bridge/` (TypeScript) | ✅ | ❌ TODO — TS wire-up needed |
| `ai-agent` | `services/ai-agent/` | ✅ | n/a (no user accounts) |
| `grudge-headless` | `services/grudge-headless/` | ✅ | n/a |
| `puter-workers` | `services/puter-workers/` | ✅ | exempted (uses Puter SDK) |

## Common AI-agent pitfalls
1. **Adding a new account-DB connection** "for convenience" — always rejected by CI + runtime. Use MySQL `grudge_game` only.
2. **Pasting secrets into code** — GitHub's scanner WILL find them and Copilot will PR a removal. Just use env vars.
3. **Calling backend services via `localhost:PORT`** — works only if you happen to be on the host. Use Docker service names.
4. **Modifying `/etc/cloudflared/config.yml` without backing up** — always cp to `config.yml.bak.<timestamp>` first. Tunnel routing is the only way the public reaches the backend.
5. **Pushing to a stale branch** — origin frequently has security-cleanup commits that aren't on the VPS. Always `git fetch && git rebase origin/main` before pushing.
6. **Assuming containers reflect on-disk source** — they don't until rebuilt. Source changes go live on `docker compose build <service>` + `up -d`.
7. **Adding a new service without updating `docs/ACCOUNT-DATABASE-RULES.md` per-service table** — CI may pass but the rule is incomplete. Always update the table when adding services in `services/`.

## Pre-task checklist (run mentally before changes)
- Does this change touch user-account creation or auth? → Read `docs/ACCOUNT-DATABASE-RULES.md` first.
- Does this change add a new service? → Add it to the rules table; call `validateCanonicalDB({ serviceName: 'X' })` in its `index.js`.
- Does this change add a new subdomain? → Update `/etc/cloudflared/config.yml` AND the subdomain table above.
- Does this change handle secrets? → Stay in `.env` / `process.env.*`. Never paste literals.
- Will this require rebuilding a container? → State that in the PR description.
- Did you fetch + rebase against `origin/main` before committing? → Yes.

## Useful commands
```bash
# Sanity ping all subdomains
for h in id api account launcher client wallet ws assets dash ai objectstore ; do
  printf "%-32s " "$h.grudge-studio.com"
  curl -s -o /dev/null -w "HTTP %{http_code}  %{time_total}s\n" --max-time 5 \
    "https://$h.grudge-studio.com/health"
done

# Check current canonical DB user count
ssh grudge-vps 'docker exec grudge-mysql mysql -uroot \
  -p"$(docker exec grudge-mysql sh -c "echo \$MYSQL_ROOT_PASSWORD")" \
  -e "USE grudge_game; SELECT COUNT(*) FROM users;"'

# Tail a service's logs
ssh grudge-vps 'docker logs -f grudge-id --tail 50'

# Rebuild a single service after source change
ssh grudge-vps 'cd /opt/grudge-studio-backend && \
  docker compose -f docker-compose.yml -f docker-compose.override.yml \
  build account-api && \
  docker compose -f docker-compose.yml -f docker-compose.override.yml \
  up -d account-api'

# Validate cloudflared ingress YAML before applying
ssh grudge-vps 'python3 -c "import yaml; yaml.safe_load(open(\"/etc/cloudflared/config.yml\"))"'
```

## Files an AI agent should pin / reference
| Path | Why |
|---|---|
| `docs/AGENT-CONTEXT.md` (this file) | Single-page mental model. |
| `docs/ACCOUNT-DATABASE-RULES.md` | The rule that prevents the duplicate-account-DB regression. |
| `shared/validate-env.js` | Where the runtime guardrail lives. Extend, don't bypass. |
| `.github/workflows/db-discipline.yml` | CI guardrail. Keep up to date if you add services. |
| `docker-compose.yml` + `docker-compose.override.yml` | Service definitions + healthchecks. |
| `/etc/cloudflared/config.yml` (on VPS) | Public traffic ingress. **Not in this repo** — managed on the VPS host. |

## What's intentionally NOT in this repo
- The Cloudflare Tunnel credentials (`cloudflare/credentials.json`) — kept on the VPS host, gitignored.
- The Cloudflare Tunnel ingress config (`/etc/cloudflared/config.yml`) — host-managed, also gitignored if symlinked.
- Per-environment `.env` files — gitignored. Use `.env.example` to communicate the required vars.
- VPS root passwords, GitHub PATs, API keys — none of these belong anywhere in source.

## Open issues (snapshot 2026-04-28)
1. 51 Dependabot vulnerabilities (32 high, 18 moderate, 1 low) — triage at https://github.com/Grudge-Warlords/grudge-studio-backend/security/dependabot
2. Leaked `GITHUB_TOKEN` in operator's `.env` needs rotation (no longer in `.git/config` after today's cleanup, but still in env).
3. 35 stale Neon Postgres users awaiting migration (script outline in `ACCOUNT-DATABASE-RULES.md`).
4. Supabase project to delete (never went live).
5. `grudge-bridge` validateCanonicalDB wire-up (TypeScript service — needs `import` syntax instead of `require`).
6. `wallet-service` healthcheck cosmetic 403 issue.
7. `client.grudge-studio.com` placeholder routing.
