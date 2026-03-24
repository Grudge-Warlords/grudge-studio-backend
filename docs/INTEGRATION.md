# Frontend Integration Guide

## Quick Start

Every Grudge Studio frontend uses the same pattern:

```html
<script src="https://js.puter.com/v2/"></script>
<script src="/grudge-sdk.js"></script>
<script>
  // Auto-init (handles OAuth callbacks + saved tokens + Puter auto-login)
  const loggedIn = await Grudge.auth.init();
  if (!loggedIn) {
    // Show login UI
  }
</script>
```

## SDK Reference

### Auth (`Grudge.auth`)

| Method | Description |
|--------|-------------|
| `Grudge.auth.init()` | Auto-initialize from URL token, session, or Puter. Returns `true` if logged in. |
| `Grudge.auth.login(identifier, password)` | Email/username + password login |
| `Grudge.auth.register(username, password, email?)` | Create new account → Grudge ID + server wallet + 1000 gold |
| `Grudge.auth.guest()` | Instant guest account (500 gold) |
| `Grudge.auth.discord(redirectUri?)` | Discord OAuth redirect |
| `Grudge.auth.google(redirectUri?)` | Google OAuth redirect |
| `Grudge.auth.github(redirectUri?)` | GitHub OAuth redirect |
| `Grudge.auth.puter()` | Puter cloud login |
| `Grudge.auth.wallet(address, web3authToken)` | Phantom/Web3Auth wallet login |
| `Grudge.auth.getUser()` | Fetch fresh user profile from server |
| `Grudge.auth.user()` | Return cached user object |
| `Grudge.auth.isLoggedIn()` | Check if token exists |
| `Grudge.auth.token()` | Get raw JWT |
| `Grudge.auth.logout()` | Clear session + server logout |

### Game API (`Grudge.api`)

| Method | Description |
|--------|-------------|
| `Grudge.api.get(path)` | Authenticated GET to `api.grudge-studio.com` |
| `Grudge.api.post(path, body)` | Authenticated POST |
| `Grudge.api.recipes(class?, tier?)` | Get crafting recipes |
| `Grudge.api.leaderboard()` | Combat leaderboard |
| `Grudge.api.islands()` | All island states |
| `Grudge.api.missions()` | Player's active missions |
| `Grudge.api.balance(charId)` | Gold balance + transactions |

### AI (`Grudge.ai`)

| Method | Description |
|--------|-------------|
| `Grudge.ai.chat(message, opts?)` | Chat with AI (Puter free → backend fallback) |
| `Grudge.ai.stream(message, opts?)` | Stream AI response (async generator) |
| `Grudge.ai.image(prompt)` | Generate image from text |

### Cloud Storage (`Grudge.cloud`)

| Method | Description |
|--------|-------------|
| `Grudge.cloud.save(key, value)` | Save to Puter KV (free) |
| `Grudge.cloud.load(key)` | Load from Puter KV |
| `Grudge.cloud.saveFile(name, data)` | Save file to Puter cloud storage |

## Environment Variables

All frontends use the same `.env`:

```
VITE_AUTH_URL=https://id.grudge-studio.com
VITE_API_URL=https://api.grudge-studio.com
VITE_WS_URL=wss://ws.grudge-studio.com
VITE_ASSETS_URL=https://assets.grudge-studio.com
```

**NEVER add database URLs to frontend .env files.**

## Architecture

```
Browser → grudge-sdk.js → id.grudge-studio.com (auth)
                        → api.grudge-studio.com (game data)
                        → ws.grudge-studio.com (real-time)
                        → puter.ai.chat() (free AI)
                        → puter.kv (free cloud storage)
```
