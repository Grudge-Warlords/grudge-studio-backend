# Cloudflare Free Services — Grudge Studio

Account ID: `ee475864561b02d4588180b8b9acf694`

All services below are **free tier** — no credit card required for basic usage.

---

## Free Tier Limits (reference)

| Service | Free Limit |
|---|---|
| Workers | 100K requests/day |
| R2 Storage | 10 GB stored, 1M Class A ops/mo, 10M Class B ops/mo |
| R2 Egress | **$0 always** (zero egress fees) |
| Workers KV | 100K reads/day, 1K writes/day, 1 GB stored |
| D1 (SQLite) | 5M rows read/day, 100K rows write/day, 5 GB stored |
| Pages | Unlimited sites, 500 builds/month |
| Turnstile | Unlimited challenges |
| Image Transforms | 5K unique transforms/month (via `cdn-cgi/image`) |
| DNS + CDN | Always free |
| DDoS protection | Always free |

---

## 1. R2 CDN Worker — `assets.grudgestudio.com`

Replaces the rate-limited `pub-*.r2.dev` URL with a production-grade CDN.

### Deploy steps

```bash
# From cloudflare/workers/r2-cdn/
npm install

# 1. Create the KV namespace for rate limiting
npx wrangler kv namespace create "GRUDGE_RATE_LIMIT"
# → Copy the returned `id` into wrangler.toml [[kv_namespaces]] id field

# 2. Login to Cloudflare (first time only)
npx wrangler login

# 3. Deploy
npx wrangler deploy
# → Worker live at: https://grudge-r2-cdn.grudge.workers.dev

# 4. Add custom domain
#    Dashboard → Workers & Pages → grudge-r2-cdn → Settings → Domains & Routes
#    Add: assets.grudgestudio.com
#    OR in DNS: assets  CNAME  grudge-r2-cdn.grudge.workers.dev  (Proxied ☁️)

# 5. Update backend .env
#    OBJECT_STORAGE_PUBLIC_URL=https://assets.grudgestudio.com

# 6. Test
curl https://assets.grudgestudio.com/avatars/<grudge_id>/<hash>.webp
```

### What it does
- Serves R2 files via **native R2 binding** — no S3 API call, zero egress cost
- **Cache API**: caches responses at Cloudflare's edge, drastically reducing R2 Class B reads
- **KV rate limiting**: 120 req/60s per IP (fires in background, doesn't add latency)
- **Immutable cache headers** for hashed files (avatars, game assets)
- **Short cache** for mutable paths: `manifests/`, `versions/`, `config/`, `patches/`
- Full **CORS** support for all Grudge Studio domains
- **ETag / If-None-Match** support — 304 Not Modified for unchanged assets
- Security headers: `X-Content-Type-Options`, `Referrer-Policy`

### URL examples
```
https://assets.grudgestudio.com/avatars/abc-123/a1b2c3d4.webp
https://assets.grudgestudio.com/game-assets/ui/hotbar.png
https://assets.grudgestudio.com/manifests/latest.json     ← 5 min cache
https://assets.grudgestudio.com/versions/1.0.3.json       ← 5 min cache
```

### Image Transforms (5K free/month)
When grudgestudio.com DNS is proxied through Cloudflare (orange ☁️), you can use
Cloudflare's image optimization URL format for avatars without extra setup:

```
https://assets.grudgestudio.com/cdn-cgi/image/format=auto,width=128,height=128,fit=cover/avatars/<grudge_id>/<hash>.png
```

Frontend helper:
```ts
function avatarUrl(path: string, width = 128) {
  return `https://assets.grudgestudio.com/cdn-cgi/image/format=auto,width=${width}/${path}`;
}
```

---

## 2. Turnstile — Bot Protection on Auth

Protects `/auth/wallet` (and any future auth endpoints) from bot signups and brute force.
Free tier: **unlimited** challenges.

### Dashboard setup (one-time)
1. https://dash.cloudflare.com → **Turnstile** → **Add Site**
2. Name: `Grudge Studio Auth`
3. Domains: `grudgestudio.com`, `grudgewarlords.com`
4. Widget type: **Managed** (invisible — no user friction)
5. Copy:
   - **Site Key** → `CF_TURNSTILE_SITE_KEY` in `.env` + frontend `VITE_CF_TURNSTILE_SITE_KEY`
   - **Secret Key** → `CF_TURNSTILE_SECRET_KEY` in `.env`

### Frontend integration (wallet login form)
```html
<!-- In your login page <head> -->
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>

<!-- In your login form -->
<div class="cf-turnstile" data-sitekey="{{ VITE_CF_TURNSTILE_SITE_KEY }}"></div>
```

```ts
// On form submit — get the token and include in POST body
const token = window.turnstile?.getResponse();

await fetch('https://id.grudgestudio.com/auth/wallet', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    wallet_address: address,
    web3auth_token:  web3token,
    cf_turnstile_token: token,   // ← required in production
  }),
});
```

### Backend behavior
- **Production** (`NODE_ENV=production`): token required, rejects bots with 403
- **Development** (no `CF_TURNSTILE_SECRET_KEY`): skips check, fails open
- Fails open if Cloudflare's API is unreachable (never blocks real users)

---

## 3. Workers KV — Use Cases

KV is globally distributed, eventually consistent. Best for:

### Rate limiting (already used in CDN Worker)
```js
// Per-IP counter with TTL
await env.KV.put(`rl:${ip}`, String(count + 1), { expirationTtl: 60 });
```

### Session token cache (future — reduce DB hits)
Cache Grudge JWT validation at the edge so the VPS isn't hit on every auth check:
```js
// Cache validated session for 5 minutes
await env.KV.put(`session:${jwtHash}`, JSON.stringify(payload), { expirationTtl: 300 });
```

### Feature flags / maintenance mode
```js
const maintenance = await env.KV.get('flag:maintenance');
if (maintenance === 'true') return new Response('Down for maintenance', { status: 503 });
```

---

## 4. D1 — SQLite at the Edge (Future)

Free: 5M rows read/day, 100K rows write/day, 5 GB stored.

Best suited for:
- **Game leaderboards** — globally fast reads, no VPS hit
- **Lightweight read replicas** for hot game data (character stats, faction rankings)
- Per-island or per-faction databases (D1 is designed for many small DBs)

Not a replacement for Neon PostgreSQL — use both together (Neon for writes, D1 for fast reads).

```bash
# Create a leaderboard database
npx wrangler d1 create grudge-leaderboards

# Add to wrangler.toml:
# [[d1_databases]]
# binding = "LEADERBOARDS"
# database_name = "grudge-leaderboards"
# database_id = "<returned-id>"
```

---

## 5. Pages — Free Frontend Hosting

Deploy the game clients (warlord-crafting-suite, grudachain.grudgestudio.com) to Pages:
- Unlimited sites, 500 builds/month, automatic Git-connected deploys
- Preview URLs for every PR branch
- Custom domains + free SSL

```bash
# From Warlord-Crafting-Suite root:
npx wrangler pages deploy dist --project-name grudge-warlords

# Or connect via Dashboard → Pages → Create Project → Connect Git
# Framework: Vite | Build command: npm run build | Output dir: dist
```

Suggested deployments:
| Project | Pages name | Domain |
|---|---|---|
| Warlord-Crafting-Suite | grudge-warlords | grudgewarlords.com |
| grudachain frontend | grudge-chain | grudachain.grudgestudio.com |

---

## 6. Queues + R2 Event Notifications (Future)

Process avatar uploads asynchronously (resize, validate, update DB) without blocking
the upload response.

```
Player uploads avatar → account-api → R2 (grudgedata)
                                          ↓ R2 Event Notification
                                       Queue (grudge-uploads)
                                          ↓ Consumer Worker
                                       Validate + tag in DB
```

Setup:
```bash
# Create queue
npx wrangler queues create grudge-uploads

# In R2 dashboard: grudgedata → Event Notifications → Add notification
# Event: object:create  |  Queue: grudge-uploads
```

---

## 7. DNS & CDN Best Practices

Ensure these domains are proxied through Cloudflare (orange cloud ☁️) in DNS:

| Domain | Type | Target |
|---|---|---|
| grudgestudio.com | A | VPS IP (74.208.155.229) |
| grudgewarlords.com | A | VPS IP |
| id.grudgestudio.com | A | VPS IP |
| api.grudgestudio.com | A | VPS IP |
| account.grudgestudio.com | A | VPS IP |
| launcher.grudgestudio.com | A | VPS IP |
| assets.grudgestudio.com | CNAME | grudge-r2-cdn.grudge.workers.dev |

When proxied (☁️):
- Free DDoS protection (L3/L4/L7)
- Cloudflare CDN cache for static responses
- Automatic HTTPS / SSL termination
- Image Transforms enabled (`cdn-cgi/image/`)
- Real visitor IPs in `CF-Connecting-IP` header

---

## 8. WAF (Web Application Firewall) — Free Rules

Free tier: **5 custom rules**. Suggested rules for Grudge Studio:

Dashboard → Websites → grudgestudio.com → Security → WAF → Create Rule

| Rule | Expression | Action |
|---|---|---|
| Block non-CF traffic to API | `not cf.client.bot_score > 0 and http.request.uri.path contains "/auth/wallet" and not cf.connecting.ip in {trusted}` | Block |
| Rate limit login attempts | `http.request.uri.path eq "/auth/wallet"` | Rate limit: 10 req/min/IP |
| Block bad bots | `cf.client.bot_score lt 30` | Managed Challenge |
| Allow game clients only | `http.host eq "api.grudgestudio.com"` | Allow (whitelist known origins via headers) |

---

## 9. Workers AI (Free Quota)

Free: ~10K neurons/day (varies by model).

Can supplement the `ai-agent` service for lightweight inference:
- NPC dialogue generation (small models like `@cf/meta/llama-3-8b-instruct`)
- Item description generation
- Faction behavior text

```js
// In a Worker:
const response = await env.AI.run('@cf/meta/llama-3-8b-instruct', {
  messages: [{ role: 'user', content: 'Generate a quest for a Pirate faction NPC' }],
});
```

Bind in `wrangler.toml`:
```toml
[ai]
binding = "AI"
```

---

## Summary — What's Already Done

| Service | Status | Details |
|---|---|---|
| R2 bucket `grudgedata` | ✅ Created | Eastern North America |
| R2 credentials | ✅ In `.env` | `OBJECT_STORAGE_KEY/SECRET` |
| CDN Worker code | ✅ Written | `cloudflare/workers/r2-cdn/` |
| Turnstile middleware | ✅ Written | `services/grudge-id/src/middleware/turnstile.js` |
| Turnstile on `/auth/wallet` | ✅ Applied | `grudge-id` route |
| CDN Worker deployed | ⏳ Pending | Run `npx wrangler deploy` |
| KV namespace created | ⏳ Pending | Run `npx wrangler kv namespace create` |
| Turnstile site keys | ⏳ Pending | Create at dash.cloudflare.com |
| `assets.grudgestudio.com` DNS | ⏳ Pending | After Worker deploy |
