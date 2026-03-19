# Grudge Studio — System Reference (AGENTS.md)

## Single Backend — Always Use These

### Auth (ALL apps must use)
Primary gateway: `https://auth-gateway-otb8qmmyd-grudgenexus.vercel.app`
- Redirect: `window.location.href = GATEWAY + '?return=' + encodeURIComponent(window.location.href)`
- Redirects back to app with auth stored in localStorage
- Keys: `grudge_auth_token` (JWT), `grudge_user_id`, `grudge_id` (UUID), `grudge_username`

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
- Create new auth flows — use the gateway
- Use `uuidv4()` for entity IDs
- Hardcode asset URLs — use CDN helpers
- Use Replit — use Vercel for web apps
