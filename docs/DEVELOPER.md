# Grudge Studio — Developer Guide

Welcome to the Grudge Studio platform. This guide covers everything you need to integrate with Grudge Warlords backend services.

---

## Quick Start

**Base URLs:**
- API: `https://api.grudge-studio.com`
- Auth: `https://id.grudge-studio.com`
- Assets: `https://assets-api.grudge-studio.com`
- Asset CDN: `https://assets.grudge-studio.com`
- Object Storage: `https://objectstore.grudge-studio.com`
- WebSocket: `wss://ws.grudge-studio.com`
- AI Lab: `https://lab.grudge-studio.com`

---

## Authentication

All API calls (except public endpoints) require a JWT in the `Authorization` header:

```
Authorization: Bearer <token>
```

### Register / Login

```http
POST https://id.grudge-studio.com/auth/register
Content-Type: application/json

{
  "username": "player1",
  "email": "player1@example.com",
  "password": "..."
}
```

```http
POST https://id.grudge-studio.com/auth/login
Content-Type: application/json

{
  "email": "player1@example.com",
  "password": "..."
}
```

Response:
```json
{
  "token": "eyJ...",
  "user": { "grudge_id": "GRD-abc123", "username": "player1" }
}
```

### Discord OAuth

```
GET https://id.grudge-studio.com/auth/discord
```
Redirects to Discord, then returns a Grudge JWT.

### Web3Auth / Solana Wallet

```http
POST https://id.grudge-studio.com/auth/web3
Content-Type: application/json

{
  "wallet_address": "...",
  "signature": "...",
  "message": "..."
}
```

### Puter Bridge (AI Lab)

```http
POST https://api.grudge-studio.com/auth/puter-bridge
Content-Type: application/json

{
  "puterToken": "..."
}
```

---

## Characters

### Create a Character

```http
POST https://api.grudge-studio.com/characters
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Kael",
  "race": "human",
  "class": "warrior"
}
```

### Get Character

```http
GET https://api.grudge-studio.com/characters/:id
Authorization: Bearer <token>
```

### Equipment / Inventory

```http
GET  https://api.grudge-studio.com/characters/:id/equipment
POST https://api.grudge-studio.com/characters/:id/equip
POST https://api.grudge-studio.com/characters/:id/unequip
GET  https://api.grudge-studio.com/characters/:id/inventory
```

---

## AI Agent

All AI endpoints are proxied through game-api at `/ai/*`. They require JWT auth and are rate-limited to 30 requests/min per user.

### Code Review

```http
POST https://api.grudge-studio.com/ai/dev/review
Authorization: Bearer <token>
Content-Type: application/json

{
  "code": "public class MySkill : ScriptableSkill { ... }",
  "language": "csharp",
  "context": "uMMORPG skill addon"
}
```

### Lore Generation

```http
POST https://api.grudge-studio.com/ai/lore/generate
Authorization: Bearer <token>
Content-Type: application/json

{
  "type": "quest",
  "context": { "faction": "corsairs", "level": 15, "location": "Fabled Island" }
}
```

Types: `quest`, `npc_dialogue`, `item_description`, `boss_encounter`, `location`, `event`

### Balance Analysis

```http
POST https://api.grudge-studio.com/ai/balance/analyze
Authorization: Bearer <token>
Content-Type: application/json

{
  "type": "combat",
  "context": { "class": "warrior", "level": 30 }
}
```

Types: `combat`, `economy`, `progression`, `gear`

### 3D Art Prompt

```http
POST https://api.grudge-studio.com/ai/art/prompt
Authorization: Bearer <token>
Content-Type: application/json

{
  "description": "dark fantasy war hammer",
  "style": "voxel",
  "target": "meshy"
}
```

Targets: `meshy`, `tripo`, `text2vox`

### Companion Interaction

```http
POST https://api.grudge-studio.com/ai/companion/interact
Authorization: Bearer <token>
Content-Type: application/json

{
  "companion_id": "gould-123",
  "situation": "approaching enemy fortress",
  "player_class": "ranger",
  "companion_class": "mage"
}
```

### Mission Generation

```http
POST https://api.grudge-studio.com/ai/mission/generate
Authorization: Bearer <token>
Content-Type: application/json

{
  "faction": "corsairs",
  "level": 20,
  "type": "combat",
  "useLLM": true
}
```

### LLM Status

```http
GET https://api.grudge-studio.com/ai/llm/status
Authorization: Bearer <token>
```

---

## WebSocket

Connect via Socket.IO:

```js
import { io } from 'socket.io-client';

const socket = io('wss://ws.grudge-studio.com', {
  auth: { token: '<JWT>' }
});

socket.on('connect', () => console.log('Connected:', socket.id));
socket.on('player:move', (data) => { /* { x, y, z, rotation } */ });
socket.on('combat:hit', (data) => { /* { attacker, target, damage, skill } */ });
socket.on('chat:message', (data) => { /* { from, channel, text } */ });

// Emit player movement
socket.emit('player:move', { x: 10, y: 0, z: 20, rotation: 90 });

// Join zone channel
socket.emit('zone:join', { zone: 'fabled-island' });
```

### Events Reference

**Client → Server:**
- `player:move` — position update
- `combat:action` — attack, skill, dodge
- `chat:send` — chat message
- `zone:join` / `zone:leave`

**Server → Client:**
- `player:move` — other player movement
- `combat:hit` / `combat:death` — combat events
- `chat:message` — incoming chat
- `faction:event` — faction activity updates
- `world:event` — server-wide events

---

## Asset Pipeline

### Upload Flow

1. Request a presigned URL:
```http
POST https://assets-api.grudge-studio.com/assets/presign
Authorization: Bearer <token>
Content-Type: application/json

{
  "filename": "sword_model.glb",
  "contentType": "model/gltf-binary",
  "category": "weapons",
  "tags": ["sword", "melee", "warrior"]
}
```

Response:
```json
{
  "uuid": "asset-abc123",
  "uploadUrl": "https://...",
  "key": "weapons/asset-abc123/sword_model.glb"
}
```

2. Upload file to the presigned URL:
```http
PUT <uploadUrl>
Content-Type: model/gltf-binary

<binary data>
```

3. Confirm upload:
```http
POST https://assets-api.grudge-studio.com/assets/asset-abc123/complete
Authorization: Bearer <token>
```

### Retrieve Assets

```http
GET https://assets-api.grudge-studio.com/assets?category=weapons&search=sword
Authorization: Bearer <token>
```

CDN direct URL: `https://assets.grudge-studio.com/<key>`

### ObjectStore SDK

```js
import { R2Client } from '@grudge-studio/objectstore-sdk';

const client = new R2Client({
  baseUrl: 'https://objectstore.grudge-studio.com'
});

// List 3D models
const models = await client.listModels({ category: 'characters' });

// Get a specific model
const model = await client.getModel('model-uuid');
```

---

## Factions & Crafting

### Faction Info

```http
GET https://api.grudge-studio.com/ai/faction/intel
Authorization: Bearer <token>
```

### Faction Recommendations

```http
GET https://api.grudge-studio.com/ai/faction/recommend/:grudge_id
Authorization: Bearer <token>
```

### Crafting (Planned)

Crafting endpoints are under development. They will follow the pattern:
```
POST /crafting/recipe
POST /crafting/craft
GET  /crafting/recipes?profession=blacksmithing&tier=3
```

---

## Error Handling

All errors follow this format:
```json
{
  "error": "Short error code",
  "message": "Human-readable description",
  "status": 400
}
```

Common status codes:
- `400` — Bad request / validation error
- `401` — Missing or invalid JWT
- `403` — Insufficient permissions
- `404` — Resource not found
- `429` — Rate limit exceeded (AI endpoints: 30/min)
- `500` — Internal server error

---

## Rate Limits

- **AI endpoints** (`/ai/*`): 30 requests/min per user
- **General API**: 100 requests/min per user
- **Asset uploads**: 10 uploads/min per user

---

## Local Development

```bash
# Clone
git clone https://github.com/MolochDaGod/grudge-studio-backend.git
cd grudge-studio-backend

# Install all services
npm install

# Start everything (requires Docker for MySQL/Redis)
docker-compose up -d mysql redis
npm run dev
```

Services start on:
- game-api → `http://localhost:3001`
- auth-service → `http://localhost:3002`
- asset-service → `http://localhost:3003`
- ai-agent → `http://localhost:3004`
- ws-service → `http://localhost:3005`

See `docs/SETUP.md` for full environment variable configuration.
