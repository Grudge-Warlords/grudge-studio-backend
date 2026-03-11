-- ─────────────────────────────────────────────────────────────────
-- GRUDGE STUDIO — Platform Schema (03)
-- Depends on: 01-schema.sql (users, characters)
-- Covers: Account, Launcher, Puter Cloud
-- ─────────────────────────────────────────────────────────────────
USE grudge_game;

-- ─── EXTENDED USER PROFILES ──────────────────────────────────────
-- One-to-one with users. Created lazily on first profile update.
CREATE TABLE IF NOT EXISTS user_profiles (
  grudge_id       VARCHAR(36) NOT NULL PRIMARY KEY,
  avatar_url      VARCHAR(512) DEFAULT NULL,   -- CDN URL via ObjectStore S3
  bio             TEXT DEFAULT NULL,
  social_links    JSON DEFAULT NULL,           -- {twitter, discord_tag, twitch, youtube}
  country         VARCHAR(4)  DEFAULT NULL,    -- ISO 3166-1 alpha-2
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (grudge_id) REFERENCES users(grudge_id) ON DELETE CASCADE
);

-- ─── FRIENDSHIPS / SOCIAL GRAPH ──────────────────────────────────
CREATE TABLE IF NOT EXISTS friendships (
  id                   BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  requester_grudge_id  VARCHAR(36) NOT NULL,
  addressee_grudge_id  VARCHAR(36) NOT NULL,
  status               ENUM('pending','accepted','blocked') DEFAULT 'pending',
  created_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_pair (requester_grudge_id, addressee_grudge_id),
  FOREIGN KEY (requester_grudge_id) REFERENCES users(grudge_id) ON DELETE CASCADE,
  FOREIGN KEY (addressee_grudge_id) REFERENCES users(grudge_id) ON DELETE CASCADE,
  INDEX idx_addressee (addressee_grudge_id, status)
);

-- ─── NOTIFICATIONS ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  grudge_id   VARCHAR(36) NOT NULL,
  type        VARCHAR(64) NOT NULL,   -- e.g. 'friend_request', 'achievement', 'crew_invite'
  payload     JSON DEFAULT NULL,      -- arbitrary context data
  is_read     BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (grudge_id) REFERENCES users(grudge_id) ON DELETE CASCADE,
  INDEX idx_user_unread (grudge_id, is_read, created_at)
);

-- ─── ACHIEVEMENTS ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS achievements_def (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ach_key     VARCHAR(128) NOT NULL UNIQUE,  -- e.g. 'first_kill', 'level_50', 'gouldstone_x15'
  name        VARCHAR(128) NOT NULL,
  description TEXT,
  icon_url    VARCHAR(512) DEFAULT NULL,
  points      SMALLINT UNSIGNED DEFAULT 10,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_achievements (
  grudge_id       VARCHAR(36) NOT NULL,
  achievement_key VARCHAR(128) NOT NULL,
  earned_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (grudge_id, achievement_key),
  FOREIGN KEY (grudge_id) REFERENCES users(grudge_id) ON DELETE CASCADE,
  FOREIGN KEY (achievement_key) REFERENCES achievements_def(ach_key) ON DELETE CASCADE
);

-- Seed starter achievement definitions
INSERT IGNORE INTO achievements_def (ach_key, name, description, points) VALUES
  ('first_login',       'Welcome to Grudge',      'Log in for the first time.',                          10),
  ('first_character',   'Hero Born',               'Create your first character.',                        10),
  ('level_10',          'Getting Started',         'Reach level 10 with any character.',                  25),
  ('level_50',          'Battle-Hardened',         'Reach level 50 with any character.',                  50),
  ('level_100',         'Warlord',                 'Reach max level 100 with any character.',            100),
  ('first_crew',        'Crew Up',                 'Join or create a crew.',                              15),
  ('claim_base',        'Homestead',               'Claim a pirate base for your crew.',                  30),
  ('gouldstone_x1',     'The Clone',               'Deploy your first Gouldstone companion.',             20),
  ('gouldstone_x15',    'Legion',                  'Have 15 active Gouldstone companions.',               75),
  ('profession_25',     'Apprentice',              'Reach level 25 in any profession.',                   20),
  ('profession_100',    'Grandmaster',             'Reach level 100 in any profession.',                 100),
  ('first_kill',        'Blood on My Hands',       'Win your first combat encounter.',                    10),
  ('launcher_install',  'Ready to Launch',         'Register your computer with the Grudge Launcher.',    10),
  ('puter_sync',        'Cloud Warrior',           'Sync a character save to Puter Cloud.',               15);

-- ─── LAUNCHER — VERSION MANIFEST ─────────────────────────────────
CREATE TABLE IF NOT EXISTS launcher_versions (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  version         VARCHAR(32) NOT NULL UNIQUE,    -- e.g. "1.0.0", "1.2.3-beta"
  channel         ENUM('stable','beta','dev') DEFAULT 'stable',
  -- Platform download URLs (presigned or direct CDN)
  windows_url     VARCHAR(1024) DEFAULT NULL,
  windows_sha256  VARCHAR(64)   DEFAULT NULL,
  mac_url         VARCHAR(1024) DEFAULT NULL,
  mac_sha256      VARCHAR(64)   DEFAULT NULL,
  linux_url       VARCHAR(1024) DEFAULT NULL,
  linux_sha256    VARCHAR(64)   DEFAULT NULL,
  -- Meta
  patch_notes     TEXT DEFAULT NULL,
  min_version     VARCHAR(32)   DEFAULT NULL,     -- minimum version that can auto-update from
  is_current      BOOLEAN DEFAULT FALSE,
  published_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ─── COMPUTER REGISTRATIONS ───────────────────────────────────────
-- One Grudge ID can register multiple machines (cap enforced at API level: 5).
CREATE TABLE IF NOT EXISTS computer_registrations (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  grudge_id         VARCHAR(36) NOT NULL,
  computer_id       VARCHAR(128) NOT NULL UNIQUE,   -- stable client-generated ID (UUID stored on disk)
  fingerprint_hash  VARCHAR(64) DEFAULT NULL,        -- SHA-256(mac+drive+cpu) sent at registration
  platform          VARCHAR(32) DEFAULT NULL,        -- 'windows', 'mac', 'linux'
  label             VARCHAR(64) DEFAULT NULL,        -- user-settable nickname e.g. "Gaming PC"
  launcher_version  VARCHAR(32) DEFAULT NULL,        -- version installed at registration
  first_seen        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_seen         TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  is_revoked        BOOLEAN DEFAULT FALSE,
  FOREIGN KEY (grudge_id) REFERENCES users(grudge_id) ON DELETE CASCADE,
  INDEX idx_owner (grudge_id, is_revoked)
);

-- ─── LAUNCH TOKENS ────────────────────────────────────────────────
-- One-time short-lived tokens used by game client to auth against grudge-headless.
CREATE TABLE IF NOT EXISTS launch_tokens (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  grudge_id     VARCHAR(36) NOT NULL,
  token         VARCHAR(256) NOT NULL UNIQUE,   -- signed JWT (LAUNCH_TOKEN_SECRET)
  computer_id   VARCHAR(128) DEFAULT NULL,
  expires_at    TIMESTAMP NOT NULL,
  used          BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (grudge_id) REFERENCES users(grudge_id) ON DELETE CASCADE,
  INDEX idx_token_lookup (token, used, expires_at)
);

-- ─── PUTER CLOUD SAVE METADATA ───────────────────────────────────
-- Tracks what game saves are synced to each user's Puter cloud.
-- Actual file I/O is done client-side via puter.js SDK.
-- Backend records metadata for discovery / cross-device listing.
CREATE TABLE IF NOT EXISTS cloud_saves (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  grudge_id   VARCHAR(36) NOT NULL,
  char_id     BIGINT UNSIGNED DEFAULT NULL,     -- NULL = account-level save
  save_key    VARCHAR(128) NOT NULL,            -- e.g. 'autosave', 'checkpoint_1', 'export'
  puter_path  VARCHAR(512) NOT NULL,            -- e.g. '/grudge/GRUDGE-abc123/saves/char_7/autosave.json'
  size_bytes  INT UNSIGNED DEFAULT 0,
  checksum    VARCHAR(64)  DEFAULT NULL,        -- SHA-256 of save contents (set by client)
  synced_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_char_save (grudge_id, char_id, save_key),
  FOREIGN KEY (grudge_id) REFERENCES users(grudge_id) ON DELETE CASCADE,
  FOREIGN KEY (char_id)   REFERENCES characters(id)  ON DELETE SET NULL,
  INDEX idx_user_saves (grudge_id, synced_at)
);
