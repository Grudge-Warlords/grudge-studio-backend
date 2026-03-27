-- ═══════════════════════════════════════════════════════════════
-- Gruda Armada — Campaign Mode Tables
-- Run: mysql -u root -p grudge_studio < migrations/020_campaign_tables.sql
-- ═══════════════════════════════════════════════════════════════

-- Campaign save state (one per player, upserted on every save)
CREATE TABLE IF NOT EXISTS campaign_saves (
  grudge_id        VARCHAR(64) NOT NULL PRIMARY KEY,
  sector_seed      VARCHAR(128) NOT NULL DEFAULT '',
  commander_name   VARCHAR(128) NOT NULL DEFAULT 'Commander',
  commander_portrait VARCHAR(512) DEFAULT '',
  commander_spec   VARCHAR(32) NOT NULL DEFAULT 'forge',
  game_time_elapsed DOUBLE NOT NULL DEFAULT 0,

  -- Full JSON blobs for complex state
  progress_json           JSON,     -- CampaignProgress object
  resources_json          JSON,     -- Record<team, PlayerResources>
  upgrades_json           JSON,     -- Record<team, TeamUpgrades>
  tech_json               JSON,     -- Record<team, string[]> researched nodes
  active_events_json      JSON,     -- CampaignEvent[] currently active
  completed_event_ids_json JSON,    -- string[] resolved event UUIDs

  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_campaign_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Captain's Log entries (append-only journal)
CREATE TABLE IF NOT EXISTS campaign_log (
  uuid               CHAR(36) NOT NULL PRIMARY KEY,
  campaign_grudge_id VARCHAR(64) NOT NULL,
  category           VARCHAR(32) NOT NULL,   -- discovery, battle, conquest, diplomacy, ai_event, story_beat, commander
  title              VARCHAR(256) NOT NULL,
  body               TEXT,
  metadata           JSON,
  planet_uuid        CHAR(36) DEFAULT NULL,
  ship_uuid          CHAR(36) DEFAULT NULL,
  created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_log_player (campaign_grudge_id, created_at),
  INDEX idx_log_category (campaign_grudge_id, category),
  CONSTRAINT fk_log_campaign FOREIGN KEY (campaign_grudge_id)
    REFERENCES campaign_saves(grudge_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Campaign events (procedural AI events with player choices)
CREATE TABLE IF NOT EXISTS campaign_events (
  uuid               CHAR(36) NOT NULL PRIMARY KEY,
  campaign_grudge_id VARCHAR(64) NOT NULL,
  event_type         VARCHAR(64) NOT NULL,   -- distress_signal, pirate_raid, trade_offer, etc.
  title              VARCHAR(256) NOT NULL DEFAULT '',
  description        TEXT,
  choice_taken       TINYINT DEFAULT NULL,    -- index into choices array, NULL = unresolved
  outcome_json       JSON,                    -- CampaignEventOutcome of chosen option
  created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_event_player (campaign_grudge_id, created_at),
  CONSTRAINT fk_event_campaign FOREIGN KEY (campaign_grudge_id)
    REFERENCES campaign_saves(grudge_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Campaign titles (milestones earned by player — never deleted)
CREATE TABLE IF NOT EXISTS campaign_titles (
  grudge_id  VARCHAR(64) NOT NULL,
  title_key  VARCHAR(64) NOT NULL,
  earned_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (grudge_id, title_key),
  INDEX idx_title_key (title_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Add campaign_title display column to users table (if not exists)
-- This stores the player's selected display title from campaign achievements
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS campaign_title VARCHAR(64) DEFAULT NULL
  AFTER avatar_url;
