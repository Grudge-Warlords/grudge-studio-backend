# Grudge Studio — API Reference

All services use **JSON** for request/response bodies.

## Authentication

Most endpoints require a **Grudge ID JWT** in the `Authorization` header:
```
Authorization: Bearer <jwt_token>
```

Internal service-to-service calls use:
```
x-internal-key: <INTERNAL_API_KEY>
```

---

## Base URLs

| Service | Production | Local |
|---|---|---|
| grudge-id | `https://id.grudgestudio.com` | `http://localhost:3001` |
| game-api | `https://api.grudgestudio.com` | `http://localhost:3003` |
| account-api | `https://account.grudgestudio.com` | `http://localhost:3005` |
| launcher-api | `https://launcher.grudgestudio.com` | `http://localhost:3006` |

---

## grudge-id — Identity & Auth (port 3001)

### Service Info
```
GET /
→ { service, version, description, endpoints, docs }
```

### Health
```
GET /health
→ { status, service }
```

### Discord OAuth
```
GET  /auth/discord           → redirect to Discord login
GET  /auth/discord/callback  → exchange code, return JWT
```

### Web3Auth (wallet login)
```
POST /auth/web3auth
Body: { token: "<web3auth_id_token>" }
→ { jwt, grudge_id, username, is_new_user }
```

### Get current user
```
GET  /identity/me
Auth: Bearer JWT
→ { grudge_id, username, email, discord_tag, wallet_address, server_wallet_address, puter_id, faction, race, class }
```

### Update user
```
PATCH /identity/me
Auth: Bearer JWT
Body: { username?, faction?, race?, class? }
→ { ok: true }
```

---

## game-api — GAME_API_GRUDA (port 3003)

### Health
```
GET /health
→ { status, service, version }
```

### Characters
```
GET    /characters              — list your characters
POST   /characters              — create character { name, race, class }
GET    /characters/:id          — get single character
PATCH  /characters/:id/stats    — game server writes back stats (internal)
DELETE /characters/:id          — delete character
```

### Factions
```
GET /factions/list              — all factions
GET /factions/leaderboard       — top factions by XP
GET /factions/:name             — faction detail
POST /factions/:name/join       — join a faction
```

### Missions
```
GET    /missions                — your active missions
POST   /missions                — create mission { title, type, char_id }
PATCH  /missions/:id/complete   — complete mission, distribute XP
PATCH  /missions/:id/fail       — mark mission failed
```
**Mission types:** `harvesting` | `fighting` | `sailing` | `competing`

### Crews
```
GET    /crews                   — your crew
POST   /crews                   — create crew { name, faction? }
GET    /crews/:id               — crew + members
POST   /crews/:id/join          — join crew
DELETE /crews/:id/leave         — leave crew
PATCH  /crews/:id/claim-base    — claim pirate base { island }
PATCH  /crews/:id/captain       — transfer captain { new_captain_grudge_id } (internal)
```

### Inventory
```
GET    /inventory               — your inventory (optionally ?char_id=X)
POST   /inventory               — add item { char_id, item_type, item_key, tier?, slot? }
PATCH  /inventory/:id/equip     — equip item
PATCH  /inventory/:id/unequip   — unequip item
DELETE /inventory/:id           — remove item
```
**Item types:** `weapon` | `armor` | `shield` | `off_hand` | `relic` | `cape` | `tome` | `wand`

### Professions
```
GET  /professions/:char_id                     — all profession levels for a character
POST /professions/:char_id/xp                  — add XP { profession, xp }
GET  /professions/:char_id/:profession         — single profession detail + milestone
```
**Professions:** `mining` | `fishing` | `woodcutting` | `farming` | `hunting`

**Milestone tiers:**
- 0-24 → Tier 1 | 25-49 → Tier 2 | 50-74 → Tier 3 | 75-99 → Tier 4 | 100 → Tier 5

### Gouldstones (AI Companions)
```
GET    /gouldstones                   — your Gouldstone companions (max 15)
POST   /gouldstones/clone             — clone a character { char_id, name? }
PATCH  /gouldstones/:id/behavior      — set behavior { behavior_profile }
PATCH  /gouldstones/:id/deploy        — deploy to island { island }
PATCH  /gouldstones/:id/recall        — recall from island
DELETE /gouldstones/:id               — destroy companion
```
**Behavior profiles:** `balanced` | `aggressive` | `defensive` | `harvester` | `scout`

---

## account-api — Account & Social (port 3005)

### Health
```
GET /health
→ { status, service, version }
```

### Profile
```
GET   /profile/:grudge_id          — public profile (no auth required)
PATCH /profile/:grudge_id          — update own profile (auth required)
      Body: { bio?, social_links?, country? }
      social_links: { twitter?, discord_tag?, twitch?, youtube? }

POST  /profile/avatar              — upload avatar image (multipart/form-data)
      Field: avatar (image file, max 2MB)
      Auth: Bearer JWT
→ { avatar_url }
```

### Friends
```
GET    /friends                       — your friends + pending requests
POST   /friends/request               — send friend request { grudge_id }
PATCH  /friends/:id                   — respond to request { action: "accept"|"decline"|"block" }
DELETE /friends/:grudge_id            — unfriend or remove block
```

### Notifications
```
GET   /notifications                  — your last 50 notifications (?unread=1 for unread only)
PATCH /notifications/:id/read         — mark one as read
PATCH /notifications/read-all         — mark all as read

POST  /notifications                  — push notification (internal only)
      Body: { grudge_id, type, payload? }
```
**Notification types (examples):** `friend_request` | `achievement` | `crew_invite` | `mission_complete`

### Achievements
```
GET  /achievements/defs               — all achievement definitions (public)
GET  /achievements/mine               — your earned achievements + total points (auth)
GET  /achievements/:grudge_id         — another user's achievements (public)

POST /achievements/award              — award achievement (internal only)
     Body: { grudge_id, achievement_key }
     — idempotent, auto-posts notification
```

**Built-in achievement keys:**
`first_login` · `first_character` · `level_10` · `level_50` · `level_100`
`first_crew` · `claim_base` · `gouldstone_x1` · `gouldstone_x15`
`profession_25` · `profession_100` · `first_kill` · `launcher_install` · `puter_sync`

### Sessions (registered computers)
```
GET    /sessions                          — list your registered computers
PATCH  /sessions/:computer_id/label       — rename a computer { label }
DELETE /sessions/:computer_id             — revoke a computer
```

### Puter Cloud Bridge
```
GET    /puter/link                     — get your puter_id + path namespaces
→ { puter_id, saves_path, exports_path, screenshots_path }

POST   /puter/saves                    — record a cloud save
       Body: { char_id?, save_key, puter_path, size_bytes?, checksum? }

GET    /puter/saves/:char_id           — list saves for character (use "account" for account-level)

DELETE /puter/saves/:id                — remove save record (does NOT delete from Puter)
```

---

## launcher-api — Game Launcher (port 3006)

### Health
```
GET /health
→ { status, service, version }
```

### Version Manifest
```
GET /manifest?channel=stable           — current version + presigned download URLs
→ {
    version, channel, min_version, published_at, patch_notes,
    downloads: {
      windows: { url, sha256 },
      mac: { url, sha256 },
      linux: { url, sha256 }
    }
  }

GET /manifest/history                  — last 10 versions (changelog)
```
**Channels:** `stable` (default) | `beta` | `dev`

### Version Management (internal only)
```
POST   /versions                       — publish new version
       Body: { version, channel?, set_current?, windows_url?, windows_sha256?,
               mac_url?, mac_sha256?, linux_url?, linux_sha256?,
               patch_notes?, min_version? }

PATCH  /versions/:version/current      — promote version to current for its channel
```

### Computer Registration
```
POST /register-computer                — register this machine with Grudge Launcher (auth)
     Body: { computer_id, fingerprint_hash?, platform?, launcher_version?, label? }
     — max 5 computers per account
     — awards 'launcher_install' achievement on first registration
→ { computer_id, registered: true|false, refreshed?: true }
```

### Launch Tokens
```
POST /launch-token                     — get a one-time game launch token (auth, 5min TTL)
     Body: { computer_id? }
→ { token, expires_at }

GET  /validate-launch-token?token=X    — validate + consume token (internal only)
→ { valid, grudge_id, username, faction, race, class }

GET  /entitlement                      — check if user has game access (auth)
→ { has_access, tier, grudge_id }
```

---

## ai-agent — AI Systems (port 3004)

AI agent endpoints are accessible externally via the game-api proxy at `api.grudgestudio.com/ai/*` (requires JWT auth). Internally, services call ai-agent directly at port 3004 with `x-internal-key`.

The AI agent uses a fallback chain: **Anthropic → OpenAI → DeepSeek → template**. If no LLM API keys are configured, all endpoints gracefully fall back to deterministic template-based responses.

### LLM Status
```
GET /ai/llm/status                     — provider diagnostics
→ { providers: { anthropic: { configured, model }, openai: {...}, deepseek: {...} } }
```

### Game Context
```
GET /ai/context                        — full game system context (classes, races, weapons, etc.)
→ { version, races, classes, factions, professions, ... }
```

### Code Review & Generation
```
POST /ai/dev/review                    — review code for bugs/perf/patterns
     Body: { code, language?, focus? }
→ { review, suggestions[], severity, provider, model }

POST /ai/dev/generate                  — generate game code
     Body: { description, language?, framework? }
→ { code, explanation, provider, model }
```

### Balance Analysis
```
POST /ai/balance/analyze               — analyze game balance
     Body: { area: "combat"|"economy"|"professions"|"gear", context? }
→ { analysis, suggestions[], data_points, provider, model }
```

### Lore Generation
```
POST /ai/lore/generate                 — generate game lore/content
     Body: { type: "quest"|"dialogue"|"item_description"|"boss"|"location"|"event", context, tone? }
→ { title, content, tags[], provider, model }
```

### 3D Art Prompts
```
POST /ai/art/prompt                    — generate optimized 3D model prompts
     Body: { description, engine: "meshy"|"tripo"|"text2vox", style? }
→ { prompt, engine, settings{}, provider, model }
```

### Dynamic Missions (LLM-enhanced)
```
POST /ai/mission/generate              — generate missions for a player
     Body: { grudge_id, faction, level, profession_levels?, useLLM? }
→ [{ title, type, description, reward_gold, reward_xp, difficulty }]
```
**Mission types:** `harvesting` | `fighting` | `sailing` | `competing`

### Companion Dialogue (LLM-enhanced)
```
POST /ai/companion/interact            — generate companion dialogue
     Body: { class, style?, faction?, situation: "combat"|"idle"|"harvesting"|"sailing"|"travel", context?, player_name? }
→ { dialogue, action_hint, emote, context, profile, source: "llm"|"fallback" }

POST /ai/companion/assign              — assign behavior profile
     Body: { class, style?, faction? }
→ { combat_style, dialogue_tone, faction_dialogue, behavior_flags }

GET  /ai/companion/profiles/:class     — get available styles for a class
```

### Faction Intel
```
GET  /ai/faction/intel                 — faction activity summary
GET  /ai/faction/recommend/:grudge_id  — recommend missions based on faction standing
```

---

## Common Error Responses

```json
{ "error": "Unauthorized" }           // 401 — missing or invalid JWT
{ "error": "Forbidden" }              // 403 — wrong internal key or wrong user
{ "error": "User not found" }         // 404
{ "error": "Too many requests." }     // 429 — rate limited
{ "error": "Internal server error" }  // 500
```

---

## Rate Limits

| Service | Endpoint | Limit |
|---|---|---|
| grudge-id | `/auth/*` | 20 req / 15 min |
| account-api | All | 120 req / 15 min |
| account-api | `POST /profile/avatar` | 20 uploads / hour |
| launcher-api | All | 60 req / 15 min |
| launcher-api | `/launch-token` | 10 req / 5 min |
