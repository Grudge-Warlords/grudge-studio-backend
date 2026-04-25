# Migrate `id.grudge-studio.com` (and siblings) to Cloudflare Tunnel

**Why:** HTTP 521 on every Traefik-routed subdomain means Cloudflare can't
reach the VPS origin (Traefik down / port 443 closed / wrong DNS A record).
`api.grudge-studio.com` is the only host that survived because it already
runs through a Cloudflare Tunnel (see `grudge-backend`). This runbook
extends that pattern to the rest of the stack.

## What changed in this repo
- `docker-compose.yml` — new `cloudflared` service under the
  `tunnel` profile (opt-in, additive — Traefik labels untouched for rollback).
- `cloudflared/config.yml` — source-of-truth ingress map. Mirror it in the
  Cloudflare dashboard's Public Hostnames tab.
- `.env.example` — added `CLOUDFLARE_TUNNEL_TOKEN`.

## One-time setup

### 1. Create the tunnel
1. <https://one.dash.cloudflare.com> → **Networks → Tunnels**.
2. **Create a tunnel** → **Cloudflared** → name it `grudge-studio` → save.
3. Copy the install **token** (the long base64 after `--token`).

### 2. Token onto the VPS
```bash
ssh root@<vps>
cd /opt/grudge-studio-backend
nano .env
# add: CLOUDFLARE_TUNNEL_TOKEN=eyJhIjoi...
```

### 3. Public Hostnames
In the tunnel's **Public Hostname** tab, add one row per service (use the
docker-compose service name on `grudge-net`):

| Subdomain    | Type | Service URL              |
|--------------|------|--------------------------|
| id           | HTTP | `grudge-id:3001`         |
| api          | HTTP | `game-api:3003`          |
| account      | HTTP | `account-api:3005`       |
| launcher     | HTTP | `launcher-api:3006`      |
| assets-api   | HTTP | `asset-service:3008`     |
| ws           | HTTP | `ws-service:3007`        |
| status       | HTTP | `uptime-kuma:3001`       |
| bridge       | HTTP | `grudge-bridge:4000`     |
| portal-api   | HTTP | `portal-api:5000`        |

> Cloudflare auto-creates a CNAME for each hostname. **Delete any existing
> A records** for these subdomains in the DNS tab first, otherwise the
> dashboard refuses to add the route.

### 4. Start the tunnel
```bash
cd /opt/grudge-studio-backend
docker compose --profile tunnel pull cloudflared
docker compose --profile tunnel up -d cloudflared
docker logs -f grudge-cloudflared   # expect "Registered tunnel connection"
```

### 5. Smoke test
```bash
for h in id api account launcher assets-api ws status bridge portal-api; do
  printf '%-12s -> ' "$h"
  curl -sS -o /dev/null -w '%{http_code}\n' "https://${h}.grudge-studio.com/health" || echo timeout
done
```
All should be 200/301/302 — never 521.

### 6. Verify auth
Open <https://id.grudge-studio.com/auth>. The stock login page
(`services/grudge-id/public/auth.html`) should render and:
- **Continue as Guest** → 200 from `/api/auth/guest`
- **Sign in with Grudge** (Puter bridge) → success
- **Sign in with Discord/Google/GitHub** → OAuth round-trip works

## Rollback
1. `docker compose stop cloudflared`
2. Recreate the deleted A records pointing at the VPS public IP.
3. Traefik resumes serving the same hostnames (its labels were never removed).

## Why this fixes 521 permanently
- Cloudflare Tunnel is **outbound-only**. The VPS dials Cloudflare; no
  inbound ports / firewall rules / Let's Encrypt certs to manage.
- Traefik can stay running for non-public services or as a fallback —
  this change is additive (`profiles: [tunnel]`), not destructive.

## Services intentionally NOT tunneled
`mysql`, `redis`, `wallet-service`, `ai-agent`, `portal-postgres`,
`grudge-headless` — internal-only or game-server traffic.
