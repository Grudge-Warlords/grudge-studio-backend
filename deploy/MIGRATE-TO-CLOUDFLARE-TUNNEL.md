# Migrate `id.grudge-studio.com` (and siblings) to Cloudflare Tunnel

**Status:** REQUIRED — Traefik/Coolify origin is unreachable, all subdomains
except `api.grudge-studio.com` are returning HTTP 521.
`api.grudge-studio.com` stays up because it's already tunneled from
`F:\GitHub\grudge-backend\docker-compose.yml`. We're extending that same
pattern to the rest of the stack.

## What changed in this repo
- `cloudflared/config.yml` — source-of-truth ingress map (also usable for
  local-config tunnels). Mirror this in the Cloudflare dashboard.
- `docker-compose.yml` — new `cloudflared` service; all Traefik labels and
  `coolify` network memberships commented out on public services.
- `.env.example` — added `CLOUDFLARE_TUNNEL_TOKEN`.

## One-time Cloudflare setup
### 1. Create the tunnel
1. Go to <https://one.dash.cloudflare.com> → **Networks → Tunnels**.
2. Click **Create a tunnel** → **Cloudflared**.
3. Name it `grudge-studio` → **Save tunnel**.
4. On the "Install and run" screen, copy the full **token** (the long
   base64 string after `--token`). Do **not** copy the whole command.

### 2. Put the token on the VPS
SSH to the VPS and:
```bash
cd /opt/grudge-studio-backend
# Edit .env and add:
#   CLOUDFLARE_TUNNEL_TOKEN=eyJhIjoi...   (paste full token)
nano .env
```

### 3. Add Public Hostnames in the dashboard
In the tunnel's **Public Hostname** tab, add one row per service. The
`Service` URL uses the docker-compose service name because `cloudflared`
runs on the same `grudge-net` bridge:

| Subdomain  | Domain             | Path | Type  | URL                        |
|------------|--------------------|------|-------|----------------------------|
| id         | grudge-studio.com  | /    | HTTP  | `grudge-id:3001`           |
| api        | grudge-studio.com  | /    | HTTP  | `game-api:3003`            |
| account    | grudge-studio.com  | /    | HTTP  | `account-api:3005`         |
| launcher   | grudge-studio.com  | /    | HTTP  | `launcher-api:3006`        |
| assets-api | grudge-studio.com  | /    | HTTP  | `asset-service:3008`       |
| ws         | grudge-studio.com  | /    | HTTP  | `ws-service:3007`          |
| status     | grudge-studio.com  | /    | HTTP  | `uptime-kuma:3001`         |
| bridge     | grudge-studio.com  | /    | HTTP  | `grudge-bridge:4000`       |

> Cloudflare will auto-create the CNAME DNS records for each hostname
> pointing at the tunnel. If an old `A` record exists for any of these
> (pointing at the VPS IP), **delete it first** in the DNS tab or the
> dashboard will refuse to add the tunnel route.

### 4. Start the tunnel
```bash
cd /opt/grudge-studio-backend
docker compose pull cloudflared
docker compose up -d cloudflared

# Verify
docker logs -f grudge-cloudflared  # should show "Registered tunnel connection"
```

### 5. Smoke-test from anywhere
```bash
curl -sS -o /dev/null -w 'id:       %{http_code}\n' https://id.grudge-studio.com/health
curl -sS -o /dev/null -w 'account:  %{http_code}\n' https://account.grudge-studio.com/health
curl -sS -o /dev/null -w 'launcher: %{http_code}\n' https://launcher.grudge-studio.com/health
curl -sS -o /dev/null -w 'ws:       %{http_code}\n' https://ws.grudge-studio.com/health
curl -sS -o /dev/null -w 'assets:   %{http_code}\n' https://assets-api.grudge-studio.com/health
curl -sS -o /dev/null -w 'status:   %{http_code}\n' https://status.grudge-studio.com/
curl -sS -o /dev/null -w 'bridge:   %{http_code}\n' https://bridge.grudge-studio.com/health
```
All should return 200/301/302 — not 521.

### 6. Confirm login page loads
Open <https://id.grudge-studio.com/auth> — the stock sign-in page
(`services/grudge-id/public/auth.html`) should render. Click **Sign in
with Discord** or **Continue as Guest** to verify the backend routes
respond.

## Rollback
If anything breaks, you can switch back to Traefik by:
1. Uncommenting the `labels:` blocks and `- coolify` network entries in
   `docker-compose.yml`.
2. Commenting the `cloudflared` service (or `docker compose stop
   cloudflared`).
3. Deleting the public hostnames in the Cloudflare dashboard so DNS
   falls back to the old A records (or recreating the A records
   pointing at the VPS IP).

## Why this fixes the 521
- HTTP 521 = "Cloudflare couldn't connect to origin." Our old origin
  required TCP :443 to reach Traefik on the VPS. Any firewall hiccup,
  Traefik crash, or bad DNS A record causes 521 instantly.
- Cloudflare Tunnel is **outbound-only** — the VPS opens a long-lived
  connection out to Cloudflare. No inbound ports. No Let's Encrypt
  certs to manage. No exposed IP. 521 becomes impossible as long as the
  `cloudflared` container is alive.

## Related services intentionally NOT tunneled
- `mysql`, `redis`, `wallet-service`, `ai-agent` — internal only, never
  reachable from the public internet. Leave them on `grudge-net` with
  no labels.
