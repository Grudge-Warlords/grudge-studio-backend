# Grudge Studio SDK — Complete System Reference

> **Single source of truth** for authentication, databases, storage, wallets,
> chains, device protocols, and everything in between.
> Every game, frontend, ESP32 node, and AI agent uses this.

---

## Table of Contents

1. [Identity — The One Login](#identity)
2. [Authentication Methods](#auth-methods)
3. [Databases](#databases)
4. [Object Storage](#storage)
5. [Wallets & Chains](#wallets)
6. [Cloudflare Services](#cloudflare)
7. [API Endpoints](#api-endpoints)
8. [GRD-17 Device Protocol](#grd17)
9. [SDK Usage (Frontend)](#sdk-frontend)
10. [SDK Usage (Backend)](#sdk-backend)
11. [What NOT to Do](#never)

---

## 1. Identity — The One Login <a name="identity"></a>

**Grudge ID = Puter ID. They are the same thing.**

A Grudge ID is a UUID derived from a Puter account (or directly generated on first login).
Every player has exactly one Grudge ID that persists across all games, devices, and sessions.

```
grudge_id:  4dd3a18d-32ca-478d-9579-524482dc6106  (UUID, permanent)
puter_id:   GRUDGE-4DD3A18D                        (short display ID)
puter_uuid: jzo9PhJbTmSIoCECG1AuhA==               (Puter platform UUID)
```

### What gets created on first login:
| Field | Value | Source |
|---|---|---|
| `grudge_id` | UUID v4 | Generated on register |
| `puter_id` | `GRUDGE-{first8}` | Derived from grudge_id |
| `puter_uuid` | Puter's UUID | From Puter platform |
| `server_wallet_address` | Solana address | Auto-created via wallet-service |
| `server_wallet_index` | HD derivation index | From WALLET_MASTER_SEED |

### The JWT payload (shared across ALL services):
```json
{
  "grudge_id": "4dd3a18d-...",
  "puter_id": "GRUDGE-4DD3A18D",
  "username": "WarlordName",
  "discord_id": "123456789",
  "wallet_address": "8xK...mE",
  "server_wallet_address": "CqBUsmu2xmaPciuahTr6sbxRs5hXAEeFfks922T...",
  "iat": 1748000000,
  "exp": 1748604800
}
```

---

## 2. Authentication Methods <a name="auth-methods"></a>

> **Rule:** The frontend shows ONE login button — "Connect Grudge ID".
> Puter is the transport. Discord/Google/GitHub are social connectors.
> Never show separate "Login with Puter" AND "Login with Grudge" buttons.

### 2a. Puter (Primary — Grudge ID)

```javascript
// Frontend (any game)
const result = await puter.auth.signIn();
const { uuid, username } = result;

// Exchange for Grudge JWT
const resp = await fetch('https://id.grudge-studio.com/auth/puter', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ puterUuid: uuid, puterUsername: username }),
});
const { token, grudgeId } = await resp.json();
localStorage.setItem('grudge_auth_token', token);
localStorage.setItem('grudge_id', grudgeId);
```

### 2b. Discord OAuth

```
Redirect:  GET  https://id.grudge-studio.com/auth/discord/start?return=<your-page>
Callback:  GET  https://id.grudge-studio.com/auth/discord/callback
Exchange:  POST https://id.grudge-studio.com/auth/discord/exchange
           Body: { code, redirect_uri }
```

### 2c. Google OAuth

```
Redirect:  GET  https://id.grudge-studio.com/auth/google/start?return=<your-page>
Callback:  GET  https://id.grudge-studio.com/auth/google/callback
Exchange:  POST https://id.grudge-studio.com/auth/google/exchange
```

### 2d. GitHub OAuth

```
Redirect:  GET  https://id.grudge-studio.com/auth/github/start?return=<your-page>
Callback:  GET  https://id.grudge-studio.com/auth/github/callback
Exchange:  POST https://id.grudge-studio.com/auth/github/exchange
```

### 2e. Username / Password (legacy)

```javascript
POST https://id.grudge-studio.com/auth/login
Body: { username, password }
// Returns: { token, grudgeId, user }
```

### 2f. Web3Auth (Wallet Login)

```javascript
// Uses Web3Auth Sapphire Mainnet
const web3auth = new Web3Auth({
  clientId: 'BEKCs2rTgMEhYytYCkGAU8...',  // mainnet
  web3AuthNetwork: 'sapphire_mainnet',
});
// After login, exchange ID token:
POST https://id.grudge-studio.com/auth/wallet
Body: { wallet_address, web3auth_token }
```

### 2g. Guest (device / anonymous)

```javascript
POST https://id.grudge-studio.com/auth/guest
Body: { deviceId, username? }
// Returns a guest grudge_id. Can upgrade to full account later.
```

### 2h. Phone (Twilio Verify)

```javascript
POST https://id.grudge-studio.com/auth/phone-send   { phone }
POST https://id.grudge-studio.com/auth/phone-verify { phone, code }
```

### 2i. SSO Check (cross-app)

```
GET https://id.grudge-studio.com/auth/sso-check?return=<your-app-url>
```
Checks for existing `grudge_sso` cookie. If valid → redirects to your app
with `?sso_token=...`. If not → redirects to `?sso_required=true`.

**Allowed return URLs:** Any `*.grudge-studio.com`, `*.grudgewarlords.com`,
`*.grudgeplatform.io`, `*.vercel.app` (grudge prefix), `*.grudge.workers.dev`,
`*.puter.site`, `grudgwarlords.com`

### Token Storage (canonical keys)

```javascript
// ALWAYS use these exact localStorage keys:
localStorage.setItem('grudge_auth_token',   token);    // JWT
localStorage.setItem('grudge_id',           grudgeId); // UUID
localStorage.setItem('grudge_username',     username);
localStorage.setItem('grudge_wallet_address', address); // if known

// Legacy aliases (read but don't write new code to set):
// grudge_session_token, grudge_user_id, grudge-session
```

---

## 3. Databases <a name="databases"></a>

### 3a. MySQL — Primary Game DB (VPS)

- **Host:** `mysql-l7kwyegn8qmocpfweql206ep` (Docker, internal)
- **User:** `grudge_admin` | **DB:** `grudge_game`
- **External access:** Via `game-api` service only (never direct)
- **Contents:** users, characters, inventory, islands, crafting, PvP, arena, missions

```javascript
// Access via grudge-id or game-api services:
const { getDB } = require('./db');
const db = getDB();
const [rows] = await db.execute('SELECT * FROM users WHERE grudge_id = ?', [grudgeId]);
```

**Tables:** `users`, `characters`, `inventory`, `crafting_queue`, `islands`,
`pvp_matches`, `arena_teams`, `arena_battles`, `crews`, `missions`, `wallet_index`,
`device_pairings`, `grudge_devices`, `computer_registrations`

### 3b. PostgreSQL — GrudgeWars / Accounts (Neon)

- **URL:** `postgresql://neondb_owner:...@ep-lingering-bread...neon.tech/neondb`
- **Contents:** accounts, characters, crafting_jobs, inventory_items, arena
- **Used by:** `grudge-wars` Vercel app, server.js backend

### 3c. Cloudflare D1 — Edge Databases

| Database | ID | Used by |
|---|---|---|
| `grudge-objectstore` | `8fc367a8-...` | objectstore-api worker |
| `grudge-ai-hub` | `42ada55e-...` | ai-hub worker |
| `grudge-game-state` | `9b66919f-...` | Available for edge game state |

```javascript
// In Workers:
const result = await env.DB.prepare('SELECT * FROM assets WHERE id = ?').bind(id).all();
```

### 3d. Cloudflare KV — Edge Key-Value

| Namespace | ID | Purpose |
|---|---|---|
| `AI_HUB_KV` | `486553dfacdc40b394e630b1cdfa97d6` | AI rate limits + flags |
| `GRUDGE_SESSIONS` | `66bb16deda8641d1a078afe0129f8737` | Edge session tokens |
| `GRUDGE_ANALYTICS` | `7a9706102f4e4be18dc4cef7a3d36f7a` | Game event counters |
| `GRUDGEWARS_CACHE` | `9d257d944ac44b5d964da33c23b14e13` | Leaderboard cache |
| `GRUDGEWARS_RATE_LIMIT` | `147bb3ba81464409805f2328a0d8302f` | Rate limiting |

```javascript
// In Workers:
await env.GRUDGE_SESSIONS.put(`session:${grudgeId}`, token, { expirationTtl: 604800 });
const session = await env.GRUDGE_SESSIONS.get(`session:${grudgeId}`);
```

### 3e. Cloudflare Queues — Async Jobs

| Queue | Purpose |
|---|---|
| `grudge-nft-mint` | Async cNFT minting via Crossmint |
| `grudge-webhooks` | Discord/external webhook delivery |
| `grudge-game-events` | Game event logging (battles, loot, crafting) |

```javascript
// Producer (any Worker):
await env.NFT_QUEUE.send({ type: 'mint', grudgeId, characterId, metadata });

// Consumer Worker:
export default {
  async queue(batch, env) {
    for (const msg of batch.messages) {
      const { type, grudgeId } = msg.body;
      // process...
      msg.ack();
    }
  }
};
```

---

## 4. Object Storage <a name="storage"></a>

### 4a. Cloudflare R2

| Bucket | Purpose | Public URL |
|---|---|---|
| `grudge-assets` | Game assets, sprites, audio, models | `https://assets.grudge-studio.com/{key}` |
| `objectstore-assets` | ObjectStore API metadata storage | Internal only |

**Public dev URL:** `https://pub-e7fcf1fd4c9946ecb84b3766bbc7b50d.r2.dev/{key}`

**API:** `https://objectstore.grudge-studio.com`
```
GET  /health               — health check
GET  /v1/assets            — list/search (public, no auth)
GET  /v1/assets/:id        — get metadata
GET  /v1/assets/:id/file   — stream file (public, no auth)
POST /v1/assets            — upload (X-API-Key required)
DELETE /v1/assets/:id      — delete (X-API-Key required)
```

Write API key = `INTERNAL_API_KEY` value.

### 4b. Puter Cloud Storage

```javascript
// Puter provides free unlimited cloud storage per user
await puter.fs.write('/GRUDACHAIN/saves/player.json', JSON.stringify(gameState));
const file = await puter.fs.read('/GRUDACHAIN/saves/player.json');
```

Used for: game saves, character exports, personal asset storage.

---

## 5. Wallets & Chains <a name="wallets"></a>

### Solana

- **Network:** Mainnet Beta
- **RPC:** `https://mainnet.helius-rpc.com/?api-key=08c34701-8900-412f-8174-b3c568cc5930`
- **WS:** `wss://mainnet.helius-rpc.com/?api-key=...`
- **GBUX Token:** `55TpSoMNxbfsNJ9U1dQoo9H3dRtDmjBZVMcKqvU2nray`
- **Explorer:** https://solscan.io

### Server-Side Wallets (Auto-created)

Every Grudge account gets a server-side Solana wallet at registration:

```
POST https://wallet.grudge-studio.com/wallet/create
X-Internal-Key: <INTERNAL_API_KEY>
Body: { grudge_id }
Returns: { address, index }
```

Wallets are HD-derived from `WALLET_MASTER_SEED` (BIP39).
The index is stored in `server_wallet_index` column of `users` table.

### Client-Side Wallets

| Method | SDK | Notes |
|---|---|---|
| Web3Auth | `web3auth.io` | Social login → wallet |
| Phantom/Solflare | Browser extension | Native Solana |
| Crossmint | `crossmint.com` | Custodial, email-linked |

### Crossmint NFTs

```javascript
// Mint cNFT character
const result = await crossmintWalletService.mintCharacterNFT(
  character,        // Character object
  imageUrl,         // HTTPS URL
  recipientWallet,  // Solana address
  true,             // compressed = true (cNFT)
);
```

**Collections:**
- Characters: `5061318d-ff65-4893-ac4b-9b28efb18ace`
- Islands: `18d0e641-8713-4d5b-9a1d-ba67c516a3ce`

### Polygon

- **RPC:** `https://polygon-rpc.com`
- **Admin wallet:** `0x40761c004d8eb8c58a1d584df08b497946939f2d721a74384a6cf54149e4046d`

---

## 6. Cloudflare Services <a name="cloudflare"></a>

### Account
- **ID:** `ee475864561b02d4588180b8b9acf694`
- **Zone:** `e8c0c2ee3063f24eb31affddabf9730a` (grudge-studio.com)

### Deployed Workers

| Worker | URL | Purpose |
|---|---|---|
| `grudge-ai-hub` | `ai.grudge-studio.com` | AI chat, Llama 3.1, rate-limited |
| `grudge-dashboard` | `dash.grudge-studio.com` | Admin dashboard proxy |
| `grudge-auth-gateway` | `auth.grudge-studio.com` | Auth edge gateway |
| `grudge-health-ping` | workers.dev | Service health monitor |
| `grudge-r2-cdn` | `assets.grudge-studio.com` | R2 CDN (read-only) |
| `grudge-objectstore-api` | `objectstore.grudge-studio.com` | Asset upload/list API |
| `grudgeproduction` | `grudgeplatform.io` | GrudgeWars production |

### Cloudflare Access (Add these in dashboard)

For `dash.cloudflare.com/zero-trust` → Access → Applications:

| App | Domain | Policy | Why |
|---|---|---|---|
| Studio Dashboard | `dash.grudge-studio.com` | Email: admin | Protect Coolify |
| AI Hub Admin | `ai.grudge-studio.com/v1/admin/*` | Service token | Admin AI routes only |
| VPS API Internal | `api.grudge-studio.com` | Service token | M2M only |

> **Do NOT** put Access in front of `id.grudge-studio.com` — players can't auth if auth is behind auth.

To set up: `CF_API_TOKEN=<token_with_zero_trust_edit> node scripts/setup-cloudflare-access.js`

### What's Available (Not yet used)

| Service | Free Limit | Use Case |
|---|---|---|
| **Cloudflare Pages** | Unlimited bandwidth | Deploy frontends vs Vercel |
| **Workers Analytics Engine** | 100K datapoints/day | Game event tracking |
| **Cloudflare Tunnel** | Free | Hide VPS IP, no port exposure |
| **Vectorize** | 5M vectors | Semantic item/asset search |
| **Email Routing** | Free | @grudge-studio.com emails |
| **Bot Management** (Turnstile) | Free | Login CAPTCHA |
| **Durable Objects** | Paid | Real-time game rooms |

---

## 7. API Endpoints <a name="api-endpoints"></a>

### Identity Service (`id.grudge-studio.com`)

```
GET  /health
POST /auth/puter           { puterUuid, puterUsername }
POST /auth/wallet          { wallet_address, web3auth_token }
GET  /auth/discord/start
GET  /auth/google/start
GET  /auth/github/start
POST /auth/login           { username, password }
POST /auth/register        { username, email, password }
POST /auth/guest           { deviceId }
GET  /auth/me              Bearer <token>
GET  /auth/sso-check       ?return=<url>
POST /auth/verify          { sessionToken }
```

### Game API (`api.grudge-studio.com`)

```
GET  /health
GET  /api/characters                      Bearer
POST /api/characters                      Bearer
GET  /api/characters/:id                  Bearer
POST /api/devices/register                Bearer
POST /api/devices/heartbeat               X-Device-Token
GET  /api/devices                         Bearer
POST /api/economy/transfer                Bearer
POST /device/auth/request                 (ESP32, no auth)
GET  /device/auth/poll?code=XXXXXX        (ESP32, no auth)
POST /device/auth/approve                 Bearer
```

### Account API (`account.grudge-studio.com`)

```
GET  /health
GET  /api/account/profile                 Bearer
PATCH /api/account/profile                Bearer
GET  /api/account/friends                 Bearer
```

### Wallet Service (`wallet.grudge-studio.com`)

```
GET  /health
POST /wallet/create                       X-Internal-Key
GET  /wallet/:address/balance             X-Internal-Key
POST /wallet/transfer                     X-Internal-Key
```

### AI Hub (`ai.grudge-studio.com`)

```
GET  /health
GET  /v1/agents
POST /v1/chat                             X-API-Key
POST /v1/agents/:role/chat                X-API-Key
GET  /v1/admin/usage                      X-API-Key (admin)
GET  /v1/admin/health                     X-API-Key (admin)
```

### ObjectStore (`objectstore.grudge-studio.com`)

```
GET  /health
GET  /v1/assets                           (public)
GET  /v1/assets/:id                       (public)
GET  /v1/assets/:id/file                  (public)
POST /v1/assets                           X-API-Key
DELETE /v1/assets/:id                     X-API-Key
```

---

## 8. GRD-17 Device Protocol <a name="grd17"></a>

### Hardware Spec
- **Platform:** ESP32-S3 or ESP32-C3
- **Type identifier:** `ESP32-GRD17`
- **NVS keys:** `device_token`, `grudge_id`, `wallet_pubkey`

### Boot Sequence

```cpp
// 1. Generate or load keypair from NVS
Keypair kp = loadOrGenerateKeypair();

// 2. Show 6-char pairing code on display
String code = generateCode(); // 6 uppercase alphanum

// 3. Register pairing code with game-api
POST https://api.grudge-studio.com/device/auth/request
Body: { code, deviceId: chipId, walletPubkey: kp.publicKey }

// 4. Poll for user approval
while (status != "approved") {
  GET https://api.grudge-studio.com/device/auth/poll?code=<code>
  delay(3000); // poll every 3s
}
// On approval: token = response.token, grudgeId = response.grudgeId

// 5. Store to NVS
nvs_set_str("device_token", token);
nvs_set_str("grudge_id", grudgeId);

// 6. Register as device (optional, for firmware tracking)
POST https://api.grudge-studio.com/api/devices/register
Authorization: Bearer <token>
Body: { publicKey, firmwareVersion: "1.4.0", hardwareType: "ESP32-GRD17" }
```

### Heartbeat Loop (every 30s)

```cpp
POST https://api.grudge-studio.com/api/devices/heartbeat
X-Device-Token: <device_token>
Body: {
  blockHeight: latestBlock,
  uptime: millis() / 1000,
  peerCount: WiFi.RSSI(),
  rssi: WiFi.RSSI(),
  firmwareVersion: "1.4.0"
}
```

### WebSocket Auth (game events)

```cpp
// When DEV_MODE=0, use device token instead of account token:
ws.setExtraHeaders("X-Device-Token: " + deviceToken);
ws.connect("wss://ws.grudge-studio.com");
```

### Firmware Version History

| Version | Changes |
|---|---|
| `1.0.0-browser` | Browser firmware (DevicePortal.jsx) |
| `1.0.0` | Initial ESP32 release, basic pairing |
| `1.1.0` | Added heartbeat, NVS storage |
| `1.2.0` | WebSocket auth with device token |
| `1.3.0` | Block height reporting, peer count |
| `1.4.0` | Helius RPC integration, SOL balance |

---

## 9. SDK Usage — Frontend <a name="sdk-frontend"></a>

### Installation (via CDN or npm)

```html
<!-- CDN (grudge-wars) -->
<script src="https://grudgewarlords.com/grudge-sdk.js"></script>

<!-- or import -->
import { GrudgeSDK } from '@grudge/sdk';
```

### Minimal Login Flow

```javascript
// 1. Check for existing session
const token = localStorage.getItem('grudge_auth_token');
if (token) {
  // Verify it's still valid
  const resp = await fetch('https://id.grudge-studio.com/auth/me', {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (resp.ok) { /* already logged in */ }
}

// 2. If no session, SSO check (catches cross-app sessions)
const ssoCheck = await fetch(
  `https://id.grudge-studio.com/auth/sso-check?return=${encodeURIComponent(location.href)}`
);
// If returns {sso_required: true}, show login button

// 3. Login button: pick ONE method
// Option A: Puter (best)
const { uuid } = await puter.auth.signIn();
// Option B: SSO redirect to id.grudge-studio.com
location.href = `https://id.grudge-studio.com/auth/discord/start?return=${encodeURIComponent(location.href)}`;
```

### Fetch with Auth

```javascript
async function grudgeFetch(path, opts = {}) {
  const token = localStorage.getItem('grudge_auth_token');
  return fetch(`https://api.grudge-studio.com${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  });
}
```

### Environment Variables (all frontends)

```env
VITE_AUTH_URL=https://id.grudge-studio.com
VITE_API_URL=https://api.grudge-studio.com
VITE_ACCOUNT_URL=https://account.grudge-studio.com
VITE_WALLET_URL=https://wallet.grudge-studio.com
VITE_LAUNCHER_URL=https://launcher.grudge-studio.com
VITE_WS_URL=wss://ws.grudge-studio.com
VITE_AI_URL=https://ai.grudge-studio.com
VITE_ASSETS_URL=https://assets.grudge-studio.com
VITE_OBJECTSTORE_URL=https://objectstore.grudge-studio.com
VITE_R2_PUBLIC_URL=https://pub-e7fcf1fd4c9946ecb84b3766bbc7b50d.r2.dev
VITE_GBUX_TOKEN_ADDRESS=55TpSoMNxbfsNJ9U1dQoo9H3dRtDmjBZVMcKqvU2nray
VITE_WEB3AUTH_NETWORK=sapphire_mainnet
VITE_HELIUS_API_KEY=08c34701-8900-412f-8174-b3c568cc5930
```

---

## 10. SDK Usage — Backend <a name="sdk-backend"></a>

### Verify a Grudge JWT (Node.js)

```javascript
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET;

function verifyGrudgeToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
    // Returns: { grudge_id, username, discord_id, wallet_address, ... }
  } catch {
    return null;
  }
}

// Express middleware
function requireAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const payload = verifyGrudgeToken(token);
  if (!payload) return res.status(401).json({ error: 'Invalid token' });
  req.user = payload;
  next();
}
```

### Internal Service-to-Service Calls

```javascript
// Any VPS service calling another VPS service:
fetch('https://wallet.grudge-studio.com/wallet/create', {
  method: 'POST',
  headers: {
    'x-internal-key': process.env.INTERNAL_API_KEY,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ grudge_id }),
});
```

### Cloudflare Worker Auth

```javascript
// Workers verifying a Grudge JWT at the edge:
import jwt from '@tsndr/cloudflare-worker-jwt';

async function verifyToken(token) {
  return await jwt.verify(token, JWT_SECRET, { algorithm: 'HS256' });
}
```

---

## 11. What NOT To Do <a name="never"></a>

| Never | Instead |
|---|---|
| Direct DB connection from frontend | Go through the API services |
| Show "Login with Puter" AND "Login with Grudge" | One button: "Connect Grudge ID" |
| Store JWT in cookie without httpOnly | Use `grudge_sso` httpOnly cookie set by grudge-id, or localStorage |
| Use Neon/PostgreSQL for new game data | Use MySQL on VPS (primary) or D1 at edge |
| Use Supabase (removed) | MySQL VPS or Neon for specific projects |
| Point VITE_AUTH_URL to api.grudge-studio.com | Always use `id.grudge-studio.com` for auth |
| Expose INTERNAL_API_KEY to frontend | Server-side only |
| Create new login systems | Use the Grudge ID unified system |
| Store wallet private keys in DB | Wallet service only, derived from master seed |
| Use Replit object storage | Use R2 via objectstore.grudge-studio.com |
| `DEFAULT_AUTH_REDIRECT` pointing to `/auth` | Point to `/` to avoid redirect loops |

---

## New Cloudflare Resources (2026-03-27)

| Resource | ID | Ready |
|---|---|---|
| Queue: `grudge-nft-mint` | grudge-nft-mint | ✅ |
| Queue: `grudge-webhooks` | grudge-webhooks | ✅ |
| Queue: `grudge-game-events` | grudge-game-events | ✅ |
| D1: `grudge-game-state` | `9b66919f-c94a-4ddd-8733-07896261df6a` | ✅ |
| KV: `GRUDGE_SESSIONS` | `66bb16deda8641d1a078afe0129f8737` | ✅ |
| KV: `GRUDGE_ANALYTICS` | `7a9706102f4e4be18dc4cef7a3d36f7a` | ✅ |
| Cloudflare Access | needs CF Zero Trust token | ⏳ |
| Cloudflare Tunnel | needs `cloudflared` on VPS | ⏳ |

---

## Cloudflare Access — Dashboard Setup

Go to `dash.cloudflare.com` → Zero Trust → Access → Applications:

1. **Add application** → Self-hosted
2. Add these:

| Name | Domain | Session | Policy |
|---|---|---|---|
| Studio Dash | `dash.grudge-studio.com` | 8h | Email: your email |
| AI Hub | `ai.grudge-studio.com` | 8h | Email: your email |
| (Service token) | — | — | Allow service token on each app |

Then run: `node scripts/setup-cloudflare-access.js` with a Zero Trust token.

---

## 12. Cloudflare Zero Trust — The Login Page <a name="zero-trust"></a>

**Team domain:** `grudgestudio.cloudflareaccess.com`
**Login page:** `https://grudgestudio.cloudflareaccess.com` (free, branded, hosted by Cloudflare)

This is the correct entry point for any Grudge web app that needs auth. Cloudflare handles
Discord/Google/GitHub OAuth — no custom OAuth code needed in your app.

### Identity Providers configured
| Provider | ID | Type |
|---|---|---|
| Google | `b00a86c9-b668-483a-8ef7-5926e6ff20a2` | google |
| GitHub | `7674fcea-eb22-4c98-a4fb-cb22347ddfdb` | github |
| One-Time PIN | (existing) | onetimepin |

**Discord OAuth** — add `https://grudgestudio.cloudflareaccess.com/cdn-cgi/access/callback`
as a redirect URI in your Discord developer app to enable Discord through CF Access.

### Access Applications
| App | Domain | AUD Tag |
|---|---|---|
| Grudge Studio Dashboard | `dash.grudge-studio.com` | `cdd3ad7ba2cf2ff3b1d9adfd2760ba0ca5caebbee80885a5359fb5a879572a22` |
| Grudge AI Hub | `ai.grudge-studio.com` | `3328a5aa868f61973b8f74890e984f2ab2f209bb15118ee99da6b61cba306038` |

### JWT Validation (in Workers / VPS routes)
When CF Access protects a route, every request includes `Cf-Access-Jwt-Assertion` header.
```javascript
// Workers (already wired in cfAccess.js)
const JWKS = createRemoteJWKSet(
  new URL('https://grudgestudio.cloudflareaccess.com/cdn-cgi/access/certs')
);
const { payload } = await jwtVerify(token, JWKS, {
  issuer: 'https://grudgestudio.cloudflareaccess.com',
  audience: POLICY_AUD, // the app's AUD tag above
});
// payload.email = user's verified email
```

### Service Token (Vercel → VPS M2M)
```
CF-Access-Client-Id: bd7fefdfafce2e7eef33d66b1e56b7c0.access
CF-Access-Client-Secret: c96c4c9806bcdc2ec7908f62170777b5ec6c9e7d1b7cbb8b0bf10c7e4a83faf8
```
Add these headers on any service-to-service call instead of `x-internal-key`.

### What CF Access does NOT replace
- `id.grudge-studio.com` — still needed for player Grudge JWT issuance (API tokens)
- `grudge_auth_token` — still the player session token for game API calls
- CF Access is the **front door** for web browsers; your backend API still issues
  Grudge JWTs for in-game/mobile use

---

*Last updated: 2026-03-27 | Grudge Studio by Racalvin The Pirate King*
