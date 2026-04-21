# GRUDA Legion AI Hub

Centralized AI gateway for all Grudge Studio apps at `ai.grudge-studio.com`.

## Architecture

```
Grudge Apps (grudgeDot, WCS, Engine, etc.)
    │
    └── ai.grudge-studio.com (Cloudflare Worker)
            │
            ├── Workers AI (primary — Llama 3.1, SDXL, BGE embeddings)
            ├── D1 (role config, usage logs, API keys)
            ├── KV (rate limiting, maintenance flags)
            └── VPS ai-agent fallback (Anthropic → OpenAI → DeepSeek)
                via api.grudge-studio.com/ai/*
```

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | Public | Health + upstream VPS status |
| GET | `/v1/agents` | Public | List all agent roles |
| POST | `/v1/chat` | API key | General chat |
| POST | `/v1/agents/:role/chat` | API key | Role-specialized chat |
| POST | `/v1/image/generate` | API key | Stable Diffusion XL image gen |
| POST | `/v1/embed` | API key | BGE text embeddings |
| GET | `/v1/admin/usage` | Admin | Usage analytics |
| GET | `/v1/admin/health` | Admin | Provider diagnostics |
| GET | `/v1/admin/config` | Admin | Agent role config |
| PUT | `/v1/admin/config/:role` | Admin | Update role config |

## Agent Roles

| Role | Model | Escalates to VPS |
|------|-------|------------------|
| general | Llama 3.1 8B | No |
| dev | Llama 3.1 8B → Anthropic | Yes |
| balance | Llama 3.1 8B → Anthropic | Yes |
| lore | Llama 3.1 8B | No |
| art | Llama 3.1 8B → OpenAI | Yes |
| mission | Llama 3.1 8B | No |
| companion | Llama 3.1 8B | No |
| faction | Llama 3.1 8B → Anthropic | Yes |

## First-Time Deploy

### 1. Create D1 database

```bash
cd cloudflare/workers/ai-hub
npx wrangler d1 create grudge-ai-hub
# Copy the returned database_id into wrangler.toml
```

### 2. Apply schema

```bash
npx wrangler d1 execute grudge-ai-hub --file=schema.sql
```

### 3. Create KV namespace

```bash
npx wrangler kv namespace create "AI_HUB_KV"
# Copy the returned id into wrangler.toml
```

### 4. Set secrets

```bash
# VPS internal key (matches INTERNAL_API_KEY on VPS docker-compose)
npx wrangler secret put VPS_INTERNAL_KEY
```

### 5. Deploy

```bash
npx wrangler deploy
```

### 6. DNS setup

In Cloudflare dashboard for `grudge-studio.com`:

```
ai   AAAA   100::   (Proxied ☁️)
```

The Worker route `ai.grudge-studio.com/*` in `wrangler.toml` handles the rest.

### 7. Create your first API key

```bash
# Generate a key
API_KEY=$(openssl rand -hex 32)
echo "Your API key: $API_KEY"

# Hash it
KEY_HASH=$(echo -n "$API_KEY" | sha256sum | cut -d' ' -f1)

# Insert into D1
npx wrangler d1 execute grudge-ai-hub --command="INSERT INTO api_keys (name, key_hash, scope, tier, rpm_limit) VALUES ('admin', '$KEY_HASH', 'admin', 'internal', 300)"
```

### 8. Test

```bash
curl https://ai.grudge-studio.com/health

curl -X POST https://ai.grudge-studio.com/v1/chat \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello from Grudge Studio"}'
```

## Usage from grudgeDot Assistant

Set in `.env`:

```
LEGION_HUB_API_KEY=<your-api-key>
LEGION_HUB_URL=https://ai.grudge-studio.com
```

The `LegionHubProvider` in `server/services/ai/providers/legionHub.ts` will be used as the primary AI provider, with Grok as fallback.

## Maintenance Mode

```bash
# Enable
npx wrangler kv key put --namespace-id=<KV_ID> "flag:maintenance" "true"

# Disable
npx wrangler kv key delete --namespace-id=<KV_ID> "flag:maintenance"
```
