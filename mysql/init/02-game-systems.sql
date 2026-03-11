-- ─────────────────────────────────────────────────────────────
-- GRUDGE STUDIO — Game Systems Schema (02)
-- Depends on: 01-schema.sql (users, characters, crews, missions)
-- ─────────────────────────────────────────────────────────────
USE grudge_game;

-- ─── INVENTORY ────────────────────────────────────────────────
-- Stores gear, weapons, armor, relics, capes per character.
-- 6 tiers for each type (cloth/leather/metal armor; 17 weapon types × 6).
-- Class/weapon restrictions enforced at API level.
CREATE TABLE IF NOT EXISTS inventory (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  grudge_id       VARCHAR(36) NOT NULL,
  char_id         BIGINT UNSIGNED NOT NULL,
  -- item_type narrows what slot/restrictions apply
  item_type       ENUM(
                    'weapon',       -- sword, bow, staff, dagger, spear, etc.
                    'armor',        -- cloth/leather/metal chest/legs/head/feet
                    'shield',       -- warrior only; has cooldown
                    'off_hand',     -- mage/worge off-hand relics
                    'relic',        -- trinkets, some have active abilities
                    'cape',         -- active effect + cooldown (no swapping in combat)
                    'tome',         -- mage/worge
                    'wand'          -- mage
                  ) NOT NULL,
  item_key        VARCHAR(128) NOT NULL,   -- e.g. "iron_sword_t2", "cloth_robe_t1"
  tier            TINYINT UNSIGNED DEFAULT 1,  -- 1-6
  equipped        BOOLEAN DEFAULT FALSE,
  slot            VARCHAR(32) DEFAULT NULL,    -- main_hand / off_hand / head / chest / legs / feet / cape / relic
  acquired_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (grudge_id) REFERENCES users(grudge_id) ON DELETE CASCADE,
  FOREIGN KEY (char_id)   REFERENCES characters(id)  ON DELETE CASCADE,
  INDEX idx_char (char_id),
  INDEX idx_owner (grudge_id)
);

-- ─── GOULDSTONES (AI Companion Clones) ───────────────────────
-- Players clone themselves into up to 15 AI companions.
-- Source: faction vendor purchase OR boss drop.
-- Snapshots character stats/gear/profession levels at clone time.
CREATE TABLE IF NOT EXISTS gouldstones (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  owner_grudge_id   VARCHAR(36) NOT NULL,
  name              VARCHAR(64) NOT NULL,
  race              VARCHAR(32) NOT NULL,
  class             VARCHAR(32) NOT NULL,
  level             INT UNSIGNED DEFAULT 1,
  -- JSON snapshots taken at clone time (immutable unless re-cloned)
  stats             JSON NOT NULL,   -- {hp, max_hp, strength, dexterity, intelligence}
  gear              JSON NOT NULL,   -- [{item_key, slot, tier, item_type}, ...]
  profession_levels JSON NOT NULL,   -- {mining, fishing, woodcutting, farming, hunting}
  -- AI behavior set by ai-agent service
  behavior_profile  VARCHAR(64) DEFAULT 'balanced',
  faction           VARCHAR(32) DEFAULT NULL,
  source            ENUM('vendor','boss_drop','crafted') DEFAULT 'vendor',
  is_active         BOOLEAN DEFAULT TRUE,
  deployed_island   VARCHAR(64) DEFAULT NULL,
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (owner_grudge_id) REFERENCES users(grudge_id) ON DELETE CASCADE,
  INDEX idx_owner_active (owner_grudge_id, is_active)
  -- Max 15 per player enforced at application level
);

-- ─── PROFESSION PROGRESS ─────────────────────────────────────
-- Tracks XP + milestones for all 5 harvesting professions per character.
-- Milestones unlock higher-tier resource harvesting:
--   Level 0-24  → Tier 1 (iron, basic fish, timber, wheat, boar)
--   Level 25-49 → Tier 2 (gold, deep fish, ironwood, shadowbloom, wyvern)
--   Level 50-74 → Tier 3 (crystal, storm kelp, eldertree, bloodroot, spectral elk)
--   Level 75-99 → Tier 4 (dragonstone, abyssal coral, godwood, stargrain, mammoth)
--   Level 100   → Tier 5 (elder/legendary resources)
-- The level columns on the characters table are kept in sync for fast reads.
CREATE TABLE IF NOT EXISTS profession_progress (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  char_id         BIGINT UNSIGNED NOT NULL,
  grudge_id       VARCHAR(36) NOT NULL,
  profession      ENUM('mining','fishing','woodcutting','farming','hunting') NOT NULL,
  xp              INT UNSIGNED DEFAULT 0,
  level           TINYINT UNSIGNED DEFAULT 0,   -- 0-100
  milestone       TINYINT UNSIGNED DEFAULT 0,   -- 0, 25, 50, 75, 100
  unlocked_tier   TINYINT UNSIGNED DEFAULT 1,   -- 1-5
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_char_prof (char_id, profession),
  FOREIGN KEY (char_id)   REFERENCES characters(id)  ON DELETE CASCADE,
  FOREIGN KEY (grudge_id) REFERENCES users(grudge_id) ON DELETE CASCADE,
  INDEX idx_char_all (char_id)
);
