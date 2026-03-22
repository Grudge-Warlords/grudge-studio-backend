-- ══════════════════════════════════════════════════════════════
-- GRUDA Legion AI Hub — D1 Schema
-- ══════════════════════════════════════════════════════════════

-- API keys for authenticated access
CREATE TABLE IF NOT EXISTS api_keys (
  id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name       TEXT NOT NULL,
  key_hash   TEXT NOT NULL UNIQUE,
  scope      TEXT NOT NULL DEFAULT 'user',   -- 'user' | 'admin'
  tier       TEXT NOT NULL DEFAULT 'free',   -- 'free' | 'pro' | 'internal'
  rpm_limit  INTEGER NOT NULL DEFAULT 60,
  enabled    INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used  TEXT
);

-- Agent role configurations (system prompts, model defaults, escalation policy)
CREATE TABLE IF NOT EXISTS agent_roles (
  role          TEXT PRIMARY KEY,
  display_name  TEXT NOT NULL,
  description   TEXT,
  system_prompt TEXT NOT NULL,
  model         TEXT NOT NULL DEFAULT '@cf/meta/llama-3.1-8b-instruct',
  temperature   REAL NOT NULL DEFAULT 0.7,
  max_tokens    INTEGER NOT NULL DEFAULT 1024,
  escalate_to_vps INTEGER NOT NULL DEFAULT 0,  -- 1 = always forward to VPS ai-agent
  enabled       INTEGER NOT NULL DEFAULT 1,
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Request logs for analytics
CREATE TABLE IF NOT EXISTS request_logs (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  request_id  TEXT NOT NULL,
  api_key_id  TEXT,
  role        TEXT,
  provider    TEXT NOT NULL,   -- 'workers-ai' | 'vps-anthropic' | 'vps-openai' | 'vps-deepseek' | 'fallback'
  model       TEXT,
  status      TEXT NOT NULL,   -- 'ok' | 'error' | 'escalated' | 'rate-limited'
  latency_ms  INTEGER,
  tokens_in   INTEGER,
  tokens_out  INTEGER,
  error       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_logs_created ON request_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_logs_role    ON request_logs(role, created_at);
CREATE INDEX IF NOT EXISTS idx_logs_key     ON request_logs(api_key_id, created_at);

-- Seed default agent roles
INSERT OR IGNORE INTO agent_roles (role, display_name, description, system_prompt, escalate_to_vps) VALUES
  ('general',   'General Assistant',   'General-purpose game dev chat',
   'You are the GRUDA Legion AI assistant for Grudge Studio, a dark fantasy MMO game development studio. Help with game development questions, debugging, and creative ideas. Be concise and technical.',
   0),
  ('dev',       'Code Review',         'Code review, bug analysis, generation',
   'You are an expert game developer reviewing code for Grudge Warlords, a dark fantasy MMO built with Unity/uMMORPG. Focus on bugs, performance, and game-specific patterns.',
   1),
  ('balance',   'Balance Analyst',     'Combat, economy, progression analysis',
   'You are a game balance analyst for Grudge Warlords. Analyze combat formulas, economy flows, progression curves, and gear balance. Use the WCS 8-stat system.',
   1),
  ('lore',      'Lore Writer',         'Quest text, NPC dialogue, item descriptions',
   'You are a dark fantasy lore writer for Grudge Warlords. Generate quest text, NPC dialogue, item descriptions, boss encounters, and location descriptions with a gritty, souls-like tone.',
   0),
  ('art',       'Art Director',        '3D model prompts for Meshy, text2vox',
   'You are a 3D art director for Grudge Warlords. Generate optimized prompts for voxel and low-poly game-ready 3D models via Meshy, Tripo, or text2vox. Focus on dark fantasy aesthetic.',
   1),
  ('mission',   'Mission Designer',    'Dynamic mission generation',
   'You are a mission designer for Grudge Warlords. Generate dynamic missions with objectives, rewards, enemy compositions, and narrative hooks. Use the faction and crew systems.',
   0),
  ('companion', 'Companion AI',        'Gouldstone companion dialogue',
   'You are a Gouldstone AI companion in Grudge Warlords. Generate in-character dialogue for combat, exploration, crafting, and social situations. Match the companion behavior profile.',
   0),
  ('faction',   'Faction Intel',       'Faction activity and recommendations',
   'You are a faction intelligence officer for Grudge Warlords. Analyze faction standings, recommend missions, and provide strategic intel based on player progress.',
   1);
