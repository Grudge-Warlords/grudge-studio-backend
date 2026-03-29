-- ─────────────────────────────────────────────
-- 11 — Arena System (PvP teams & battles)
-- Migrated from grudge-wars Neon PostgreSQL
-- ─────────────────────────────────────────────
USE grudge_game;

-- ─── ARENA TEAMS ──────────────────────────────
CREATE TABLE IF NOT EXISTS arena_teams (
  team_id         VARCHAR(64) PRIMARY KEY,
  owner_id        VARCHAR(36) NOT NULL,          -- grudge_id of team owner
  owner_name      VARCHAR(128) NOT NULL DEFAULT 'Unknown Warlord',
  status          VARCHAR(32) NOT NULL DEFAULT 'ranked',
  heroes          JSON NOT NULL,                 -- array of hero objects
  hero_count      INT UNSIGNED NOT NULL DEFAULT 0,
  avg_level       INT UNSIGNED NOT NULL DEFAULT 1,
  share_token     VARCHAR(64) DEFAULT NULL,
  snapshot_hash   VARCHAR(64) DEFAULT NULL,
  wins            INT UNSIGNED NOT NULL DEFAULT 0,
  losses          INT UNSIGNED NOT NULL DEFAULT 0,
  total_battles   INT UNSIGNED NOT NULL DEFAULT 0,
  rewards         JSON NOT NULL DEFAULT (JSON_OBJECT('gold', 0, 'resources', 0, 'equipment', JSON_ARRAY())),
  demoted_at      TIMESTAMP NULL,
  demote_reason   TEXT,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_arena_teams_wins (wins DESC),
  INDEX idx_arena_teams_owner (owner_id),
  INDEX idx_arena_teams_status (status)
);

-- ─── ARENA BATTLES ────────────────────────────
CREATE TABLE IF NOT EXISTS arena_battles (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  battle_id       VARCHAR(64) NOT NULL,
  team_id         VARCHAR(64) NOT NULL,
  challenger_name VARCHAR(128) NOT NULL DEFAULT 'Arena Challenger',
  result          VARCHAR(32) NOT NULL,          -- 'win', 'loss', 'draw'
  battle_log      JSON DEFAULT NULL,             -- optional battle replay data
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_arena_battles_team (team_id),
  INDEX idx_arena_battles_created (created_at DESC)
);
