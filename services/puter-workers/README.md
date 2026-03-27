# GRUDGE STUDIO — Puter Serverless Workers

Workers run on Puter's infrastructure. No servers to manage, no Docker, no deploys to the VPS.

## Why Workers?

| | VPS ai-agent | Puter Worker |
|---|---|---|
| Pays for AI | GRUDACHAIN (our cost) | **Player's Puter account (PIP revenue)** |
| Infrastructure | Our VPS | Puter's global edge |
| Scaling | Limited | Unlimited |
| Cold starts | None (always on) | Minimal |

**Use Puter Workers when you want `user.puter.ai` (player pays → we earn PIP).**
**Use the VPS ai-agent for backend/admin operations where GRUDACHAIN should pay.**

## Workers

| File | URL | Purpose |
|---|---|---|
| `legion-chat.js` | `grudge-legion-chat.puter.site` | GRD-17 Legion AI chat, PIP-billed |

## Deploying legion-chat.js

### Option A: Puter Desktop UI
1. Open [puter.com](https://puter.com) as the **GRUDACHAIN** account
2. Upload `legion-chat.js` to your Puter Desktop
3. Right-click the file → **Publish as Worker**
4. Set URL slug: `grudge-legion-chat`
5. Worker is live at `https://grudge-legion-chat.puter.site/api/chat`

### Option B: Puter CLI
```bash
npm install -g @heyputer/puter-cli
puter-cli auth  # opens browser, logs in as GRUDACHAIN
puter-cli worker deploy legion-chat.js --name grudge-legion-chat
```

## Using legion-chat from a Grudge game

```javascript
// Client-side call — passes the signed-in player's Puter context
const response = await puter.workers.exec('grudge-legion-chat', {
  path: '/api/chat',
  method: 'POST',
  body: JSON.stringify({
    message:  'Design a level 10 quest for a Worge ranger',
    core:     'grd27',  // GRD-17 core selection
    grudgeId: user.grudgeId,
  }),
});
// AI charged to PLAYER's Puter account → PIP revenue for GRUDGE STUDIO
```

## PIP Analytics

Workers store daily engagement stats in GRUDACHAIN's own `me.puter.kv`:

```
Key: grudge_pip_engagement_2026-03-26
Value: { total: 142, pipCount: 138, byCore: { grd17: 89, grd27: 31, ... } }
```

Read your analytics:
```javascript
// As GRUDACHAIN (server-side or Puter Worker with me context)
const stats = await me.puter.kv.get('grudge_pip_engagement_2026-03-26');
```

## Adding More Workers

Copy the pattern from `legion-chat.js`:
- Use `user.puter.ai` for player-billing (PIP revenue)
- Use `me.puter.kv` for GRUDACHAIN analytics/state
- Export routes using `router.get/post(path, handler)`
