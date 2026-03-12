-- ─────────────────────────────────────────────────────────────
-- GRUDGE STUDIO — World Schema (06)
-- Depends on: 01-schema.sql, 02-game-systems.sql
-- ─────────────────────────────────────────────────────────────
USE grudge_game;

-- ─── COMBAT LOG ──────────────────────────────────────────────
-- Immutable record of every combat encounter.
-- Written by game server (internal key). Readable by players.
CREATE TABLE IF NOT EXISTS combat_log (
  id                    BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  attacker_grudge_id    VARCHAR(36)  NOT NULL,
  defender_grudge_id    VARCHAR(36)  NULL,       -- NULL for PvE/boss fights
  defender_type         ENUM('player','ai','boss') NOT NULL DEFAULT 'ai',
  island                VARCHAR(64)  DEFAULT NULL,
  outcome               ENUM('attacker_win','defender_win','draw') NOT NULL,
  attacker_dmg_dealt    INT UNSIGNED DEFAULT 0,
  defender_dmg_dealt    INT UNSIGNED DEFAULT 0,
  -- JSON: { z_key_stacks, parry_count, parry_perfect, ability_used, worge_form }
  combat_data           JSON DEFAULT NULL,
  duration_ms           INT UNSIGNED DEFAULT 0,
  created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (attacker_grudge_id) REFERENCES users(grudge_id) ON DELETE CASCADE,
  INDEX idx_attacker     (attacker_grudge_id, created_at DESC),
  INDEX idx_island       (island, created_at DESC),
  INDEX idx_outcome      (attacker_grudge_id, outcome)
);

-- ─── ISLAND STATE ────────────────────────────────────────────
-- One row per island. Updated in real time by game server.
-- active_players: JSON array of grudge_ids currently on island.
-- resources: JSON map of resource_key → remaining_quantity.
CREATE TABLE IF NOT EXISTS island_state (
  island_key            VARCHAR(64)  NOT NULL PRIMARY KEY,
  display_name          VARCHAR(128) DEFAULT NULL,
  -- Crew control
  controlling_crew_id   BIGINT UNSIGNED NULL,
  claim_flag_planted_at TIMESTAMP NULL,
  -- Live state (updated by game server)
  active_players        JSON DEFAULT (JSON_ARRAY()),
  resources             JSON DEFAULT (JSON_OBJECT()),
  last_updated          TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (controlling_crew_id) REFERENCES crews(id) ON DELETE SET NULL,
  INDEX idx_crew (controlling_crew_id)
);

-- ─── SEED ISLANDS ────────────────────────────────────────────
INSERT IGNORE INTO island_state (island_key, display_name) VALUES
  ('spawn',            'Spawn Arena'),
  ('starter_island',   'Starter Island'),
  ('crusade_island',   'Crusade Island'),
  ('fabled_island',    'Fabled Island'),
  ('piglin_outpost',   'Piglin Outpost'),
  ('pirate_cove',      'Pirate Cove'),
  ('elven_grove',      'Elven Grove'),
  ('undead_wastes',    'Undead Wastes'),
  ('orc_stronghold',   'Orc Stronghold'),
  ('mage_tower',       'Mage Tower');
