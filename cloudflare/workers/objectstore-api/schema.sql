-- ObjectStore D1 schema
-- Run: npx wrangler d1 execute grudge-objectstore --file=./schema.sql

CREATE TABLE IF NOT EXISTS assets (
  id          TEXT PRIMARY KEY,
  r2_key      TEXT NOT NULL UNIQUE,
  filename    TEXT NOT NULL,
  mime        TEXT NOT NULL DEFAULT 'application/octet-stream',
  size        INTEGER NOT NULL DEFAULT 0,
  sha256      TEXT,
  category    TEXT NOT NULL DEFAULT 'other',
  tags        TEXT NOT NULL DEFAULT '[]',        -- JSON array
  visibility  TEXT NOT NULL DEFAULT 'public',   -- 'public' | 'private'
  metadata    TEXT NOT NULL DEFAULT '{}',        -- JSON object
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_assets_category   ON assets(category);
CREATE INDEX IF NOT EXISTS idx_assets_visibility ON assets(visibility);
CREATE INDEX IF NOT EXISTS idx_assets_created    ON assets(created_at DESC);
