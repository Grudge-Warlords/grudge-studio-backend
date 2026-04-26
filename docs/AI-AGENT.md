# AI Agent — Service Documentation

The AI agent (`ai-agent`, port 3004) is the LLM-powered intelligence layer for Grudge Studio. It handles code review, game balance analysis, lore generation, 3D art prompts, dynamic missions, companion dialogue, and faction intel.

---

## Architecture

```
External clients (AI Lab, dashboards)
    │
    └── api.grudge-studio.com/ai/*   (JWT auth)
            │
            ▼
        game-api (proxy with x-internal-key)
            │
            ▼
        ai-agent:3004  (internal only)
            │
            ├── LLM Provider (Anthropic → OpenAI → DeepSeek)
            ├── System Prompts (per-role)
            ├── Game Context (systemContext.js)
            └── Template Fallback (deterministic)
```

External clients NEVER call ai-agent directly. All requests go through game-api's `/ai/*` proxy, which adds the `x-internal-key` header.

---

## LLM Provider Fallback Chain

The provider layer (`src/llm/provider.js`) tries each LLM in order:

1. **Anthropic** (Claude) — best for code review, balance analysis
2. **OpenAI** (GPT-4o) — best for structured output, art prompts
3. **DeepSeek** (V3) — cost-effective fallback
4. **Template** — deterministic fallback if all LLMs fail

Each provider is only attempted if its API key is set in the environment:

```
ANTHROPIC_API_KEY=sk-ant-...your-key-here...
OPENAI_API_KEY=sk-...your-key-here...
DEEPSEEK_API_KEY=...your-key-here...
```

### Key Functions

- `chat(messages, opts)` — returns raw text response
- `chatJSON(messages, opts)` — returns parsed JSON with `{ data, raw, provider, model, usage, fallback }`
- `getProviderStatus()` — returns which providers are configured and reachable
- `getGameContext()` — returns the full Grudge game context for prompts

---

## Route Groups

### 1. Dev Routes (`/ai/dev/*`)

| Endpoint | Method | Purpose |
|---|---|---|
| `/ai/dev/review` | POST | Review code for bugs, performance, patterns |
| `/ai/dev/generate` | POST | Generate game code (C#/Unity/uMMORPG) |

### 2. Balance Routes (`/ai/balance/*`)

| Endpoint | Method | Purpose |
|---|---|---|
| `/ai/balance/analyze` | POST | Analyze combat, economy, progression, gear balance |

### 3. Lore Routes (`/ai/lore/*`)

| Endpoint | Method | Purpose |
|---|---|---|
| `/ai/lore/generate` | POST | Generate quest text, NPC dialogue, item descriptions, boss encounters, locations, events |

### 4. Art Routes (`/ai/art/*`)

| Endpoint | Method | Purpose |
|---|---|---|
| `/ai/art/prompt` | POST | Generate optimized prompts for Meshy, Tripo, text2vox |

### 5. Mission Routes (`/ai/mission/*`)

| Endpoint | Method | Purpose |
|---|---|---|
| `/ai/mission/generate` | POST | Generate dynamic missions (LLM or template) |

### 6. Companion Routes (`/ai/companion/*`)

| Endpoint | Method | Purpose |
|---|---|---|
| `/ai/companion/interact` | POST | Generate companion dialogue for situations |
| `/ai/companion/assign` | POST | Assign behavior profile to a Gouldstone |
| `/ai/companion/profiles/:class` | GET | List available styles for a class |

### 7. Faction Routes (`/ai/faction/*`)

| Endpoint | Method | Purpose |
|---|---|---|
| `/ai/faction/intel` | GET | Faction activity summary from DB |
| `/ai/faction/recommend/:grudge_id` | GET | Recommend missions based on standing |

### 8. Diagnostics

| Endpoint | Method | Purpose |
|---|---|---|
| `/ai/llm/status` | GET | Provider configuration and availability |
| `/ai/context` | GET | Full game system context |

---

## System Prompts

System prompts are in `src/llm/prompts.js`. Each role has a dedicated prompt that includes Grudge game context:

| Role | Key | Purpose |
|---|---|---|
| Dev | `PROMPTS.dev()` | Code review/generation with uMMORPG patterns |
| Balance | `PROMPTS.balance()` | Game balance with class/gear/economy knowledge |
| Lore | `PROMPTS.lore()` | Dark fantasy lore with faction/race context |
| Art | `PROMPTS.art()` | 3D model prompts for voxel/game-ready assets |
| Mission | `PROMPTS.mission()` | Dynamic mission generation with templates |
| Companion | `PROMPTS.companion()` | Gouldstone AI companion dialogue |
| Faction | `PROMPTS.faction()` | Faction intel and recommendations |

---

## Adding a New AI Agent Role

1. Add a system prompt in `src/llm/prompts.js`:
```js
exports.myRole = () => `You are a ... for Grudge Warlords.\n${getGameContext()}`;
```

2. Create a route file `src/routes/my-role.js`:
```js
const { chatJSON } = require('../llm/provider');
const PROMPTS = require('../llm/prompts');

router.post('/endpoint', async (req, res, next) => {
  const result = await chatJSON([
    { role: 'system', content: PROMPTS.myRole() },
    { role: 'user', content: `...` },
  ]);
  res.json(result.data || { raw: result.raw });
});
```

3. Register in `src/index.js`:
```js
const myRoutes = require('./routes/my-role');
app.use('/ai/my-role', myRoutes);
```

4. Add the proxy route to game-api — the generic `/ai/*` proxy forwards automatically.

---

## Data Dependencies

- **MySQL** — balance analysis queries `combat_log`, `gold_transactions`, `profession_progress`
- **Redis** — not currently used by ai-agent (available via `REDIS_URL`)
- **systemContext.js** — static game data (classes, races, weapons, etc.)
- **behaviorProfiles.js** — companion behavior templates
- **missionTemplates.js** — mission structure templates

---

## Environment Variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `PORT` | No | `3004` | Service port |
| `INTERNAL_API_KEY` | Yes | — | Service-to-service auth |
| `DB_HOST` | Yes | — | MySQL host |
| `ANTHROPIC_API_KEY` | No | — | Claude API key |
| `OPENAI_API_KEY` | No | — | GPT-4o API key |
| `DEEPSEEK_API_KEY` | No | — | DeepSeek API key |

---

## GRUDA Legion AI Hub (Edge Gateway)

The VPS ai-agent is now fronted by a Cloudflare Worker at `ai.grudge-studio.com` that provides:
- **Workers AI** (Llama 3.1, SDXL, BGE embeddings) as the primary inference layer
- **Automatic escalation** to the VPS ai-agent for roles that need heavier models (dev, balance, art, faction)
- **D1 usage logging**, **KV rate limiting**, and **admin APIs**
- **API key auth** (SHA-256 hashed keys stored in D1)

Clients should use the **GRUDA Legion SDK** instead of calling the VPS directly:
- **Hub repo**: https://github.com/MolochDaGod/grudge-ai-hub
- **SDK repo**: https://github.com/MolochDaGod/gruda-legion-sdk
- **Worker config**: `cloudflare/workers/ai-hub/`

### SDK Usage (Browser + Puter.js)

```html
<script src="https://js.puter.com/v2/"></script>
<script src="https://cdn.jsdelivr.net/gh/MolochDaGod/gruda-legion-sdk@main/src/legion.js"></script>
<script src="https://cdn.jsdelivr.net/gh/MolochDaGod/gruda-legion-sdk@main/src/puter-legion.js"></script>
<script>
  const ai = new PuterLegion({ apiKey: 'YOUR_KEY', puterFallback: true });
  ai.lore('Write a quest about a cursed island').then(r => console.log(r.response));
</script>
```

### SDK Usage (Node.js / grudgeDot Assistant)

```js
const { GrudaLegionNode } = require('gruda-legion-sdk');
const legion = new GrudaLegionNode({ apiKey: process.env.LEGION_HUB_API_KEY });
const reply = await legion.dev('Review this combat formula for bugs');
```

---

## Babylon AI Workers (BabylonJS 9 + Havok Specialists)

**Cloudflare Worker:** `babylon-ai-workers.grudge.workers.dev`  
**Source:** `D:\GrudgeStudio\babylon-ai-workers`  
**Integrated via:** AI Hub at `ai.grudge-studio.com/v1/agents/havok/chat` and `sage/chat`

Two domain-specialist workers with Vectorize RAG over BabylonJS 9 API documentation. Unlike the general ai-agent (which uses Anthropic/OpenAI/DeepSeek), these use Workers AI + Vectorize for fast, domain-specific answers.

### Architecture

```
Client (editor, game page, SDK)
    │
    ├── Direct: babylon-ai-workers.grudge.workers.dev/havok
    │
    ├── Via AI Hub: ai.grudge-studio.com/v1/agents/havok/chat  (auth required)
    │
    └── Via grudgeDot: /api/gruda-legion/babylon/havok  (proxied)
            │
            ▼
        babylon-ai-workers (Cloudflare Worker)
            │
            ├── Vectorize (bge-base-en-v1.5 embeddings → semantic search)
            ├── KV (cached responses + learned patterns)
            ├── R2 (full API doc pages)
            └── Workers AI (llama-3.1-70b-instruct)
```

### Workers

| Worker | Role | Endpoint | Domain |
|---|---|---|---|
| Havok Scholar | Physics specialist | `/havok` | PhysicsCharacterController, HavokPlugin, collision, constraints, rigid bodies |
| Babylon Sage | Rendering specialist | `/sage` | PBRMaterial, AnimationGroup, SceneLoader, terrain, post-processing, VFX |

### Endpoints

```
POST /havok    — Ask Havok Scholar { question, context?, code? }
POST /sage     — Ask Babylon Sage { question, context?, code? }
POST /learn    — Ingest new API docs { title, content, domain, url?, category? }
GET  /search   — Semantic search ?q=query&domain=physics|rendering|all
GET  /health   — Health check
```

Response format:
```json
{
  "answer": "Working BabylonJS 9 code and explanation...",
  "worker": "havok-scholar",
  "source": "rag+llm",
  "model": "llama-3.1-70b-instruct"
}
```

### Knowledge Base

8 ingested BabylonJS 9 API docs (vectorized via bge-base-en-v1.5):
- PhysicsCharacterController, HavokPlugin, Character Controller State Machine
- DefaultRenderingPipeline, Animation Retargeting, TerrainMaterial
- SSAO2 Rendering Pipeline, SceneLoader.ImportMeshAsync

To ingest more docs: `npm run ingest` (set `WORKER_URL` to the deployed worker URL)

### Client SDK

Drop-in `grudge-babylon-sdk.js` for any editor or game page:

```html
<script src="/grudge-babylon-sdk.js"></script>
<script>
  // Auto-routes physics vs rendering
  const { answer } = await BabylonAI.ask('How do I set up character jump with Havok?');
  // Or target a specific worker
  const physics = await BabylonAI.askHavok('Explain checkSupport vs calculateMovement');
  const render  = await BabylonAI.askSage('Best post-processing for outdoor terrain?');
  // Semantic search
  const results = await BabylonAI.search('animation retargeting', 'rendering');
</script>
```
