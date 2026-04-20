-- ─────────────────────────────────────────────
-- GRUDGE STUDIO — Database Schema
-- ─────────────────────────────────────────────

CREATE DATABASE IF NOT EXISTS grudge_game CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE grudge_game;

-- ─── GRUDGE ID / USERS ────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  grudge_id       VARCHAR(36) NOT NULL UNIQUE,   -- UUID v4
  username        VARCHAR(64) UNIQUE,
  email           VARCHAR(255) UNIQUE,
  password_hash   VARCHAR(256),
  display_name    VARCHAR(128),
  -- Auth providers
  discord_id      VARCHAR(32) UNIQUE,
  discord_tag     VARCHAR(64),
  wallet_address  VARCHAR(64) UNIQUE,            -- Web3Auth / client-side wallet
  -- Server-side wallet
  server_wallet_address VARCHAR(64) UNIQUE,
  server_wallet_index   INT UNSIGNED,            -- BIP44 derivation index
  -- Identity
  puter_id        VARCHAR(64) UNIQUE,            -- Grudge ecosystem puter ID
  faction         VARCHAR(32) DEFAULT NULL,
  race            VARCHAR(32) DEFAULT NULL,
  class           VARCHAR(32) DEFAULT NULL,
  -- Economy
  gold            INT UNSIGNED DEFAULT 1000,
  gbux_balance    INT UNSIGNED DEFAULT 0,
  -- Status
  is_guest        BOOLEAN DEFAULT FALSE,
  is_active       BOOLEAN DEFAULT TRUE,
  is_banned       BOOLEAN DEFAULT FALSE,
  ban_reason      TEXT,
  -- Meta
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  last_login      TIMESTAMP NULL
);

-- ─── CHARACTERS ───────────────────────────────
CREATE TABLE IF NOT EXISTS characters (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  grudge_id       VARCHAR(36) NOT NULL,
  name            VARCHAR(64) NOT NULL,
  race            VARCHAR(32) NOT NULL,
  class           VARCHAR(32) NOT NULL,
  level           INT UNSIGNED DEFAULT 1,
  faction         VARCHAR(32),
  -- Stats
  hp              INT UNSIGNED DEFAULT 100,
  max_hp          INT UNSIGNED DEFAULT 100,
  strength        INT UNSIGNED DEFAULT 10,
  dexterity       INT UNSIGNED DEFAULT 10,
  intelligence    INT UNSIGNED DEFAULT 10,
  -- Professions (levels 1-100)
  mining_lvl      INT UNSIGNED DEFAULT 0,
  fishing_lvl     INT UNSIGNED DEFAULT 0,
  woodcutting_lvl INT UNSIGNED DEFAULT 0,
  farming_lvl     INT UNSIGNED DEFAULT 0,
  hunting_lvl     INT UNSIGNED DEFAULT 0,
  -- Position
  island          VARCHAR(64) DEFAULT 'spawn',
  pos_x           FLOAT DEFAULT 0,
  pos_y           FLOAT DEFAULT 0,
  pos_z           FLOAT DEFAULT 0,
  -- Meta
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (grudge_id) REFERENCES users(grudge_id) ON DELETE CASCADE
);

-- ─── CREWS ────────────────────────────────────
CREATE TABLE IF NOT EXISTS crews (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name            VARCHAR(64) NOT NULL,
  faction         VARCHAR(32),
  base_island     VARCHAR(64),
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS crew_members (
  crew_id         BIGINT UNSIGNED NOT NULL,
  grudge_id       VARCHAR(36) NOT NULL,
  role            ENUM('captain','member','ai') DEFAULT 'member',
  joined_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (crew_id, grudge_id),
  FOREIGN KEY (crew_id) REFERENCES crews(id) ON DELETE CASCADE,
  FOREIGN KEY (grudge_id) REFERENCES users(grudge_id) ON DELETE CASCADE
);

-- ─── MISSIONS ─────────────────────────────────
CREATE TABLE IF NOT EXISTS missions (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  grudge_id       VARCHAR(36) NOT NULL,
  title           VARCHAR(128) NOT NULL,
  type            ENUM('harvesting','fighting','sailing','competing') NOT NULL,
  status          ENUM('active','completed','failed') DEFAULT 'active',
  reward_gold     INT UNSIGNED DEFAULT 0,
  reward_xp       INT UNSIGNED DEFAULT 0,
  started_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at    TIMESTAMP NULL,
  FOREIGN KEY (grudge_id) REFERENCES users(grudge_id) ON DELETE CASCADE
);

-- ─── WALLET INDEX COUNTER ─────────────────────
CREATE TABLE IF NOT EXISTS wallet_index (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  next_index      INT UNSIGNED DEFAULT 0
);
INSERT INTO wallet_index (next_index) VALUES (0)
  ON DUPLICATE KEY UPDATE next_index = next_index;
