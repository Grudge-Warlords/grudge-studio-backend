-- ─────────────────────────────────────────────────────────────
-- GRUDGE STUDIO — PvP Lobby System Schema (07)
-- Depends on: 01-schema.sql (users, characters, crews)
-- Modes: duel (1v1), crew_battle (team), arena_ffa (free-for-all)
-- ─────────────────────────────────────────────────────────────
USE grudge_game;

-- ─── PVP LOBBIES ─────────────────────────────────────────────
-- One row per lobby instance. lobby_code is the short join code.
CREATE TABLE IF NOT EXISTS pvp_lobbies (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  lobby_code        VARCHAR(8)   NOT NULL UNIQUE,       -- e.g. "GRD-7F2A"
  mode              ENUM('duel','crew_battle','arena_ffa') NOT NULL DEFAULT 'duel',
  island            VARCHAR(64)  NOT NULL DEFAULT 'spawn',
  host_grudge_id    VARCHAR(36)  NOT NULL,
  status            ENUM('waiting','ready','in_progress','finished','cancelled') NOT NULL DEFAULT 'waiting',
  max_players       TINYINT UNSIGNED NOT NULL DEFAULT 2,
  -- JSON: { friendly_fire, time_limit_s, respawns, wager_gold }
  settings          JSON DEFAULT (JSON_OBJECT()),
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  started_at        TIMESTAMP NULL,
  finished_at       TIMESTAMP NULL,
  FOREIGN KEY (host_grudge_id) REFERENCES users(grudge_id) ON DELETE CASCADE,
  INDEX idx_status  (status, created_at DESC),
  INDEX idx_host    (host_grudge_id),
  INDEX idx_island  (island, status)
);

-- ─── PVP LOBBY PLAYERS ───────────────────────────────────────
-- Tracks which players are in a lobby and their ready state.
CREATE TABLE IF NOT EXISTS pvp_lobby_players (
  lobby_id          BIGINT UNSIGNED NOT NULL,
  grudge_id         VARCHAR(36) NOT NULL,
  char_id           BIGINT UNSIGNED NOT NULL,
  team              TINYINT UNSIGNED NOT NULL DEFAULT 0,  -- 0=FFA, 1=red, 2=blue
  is_ready          BOOLEAN NOT NULL DEFAULT FALSE,
  joined_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (lobby_id, grudge_id),
  FOREIGN KEY (lobby_id)  REFERENCES pvp_lobbies(id)  ON DELETE CASCADE,
  FOREIGN KEY (grudge_id) REFERENCES users(grudge_id) ON DELETE CASCADE,
  FOREIGN KEY (char_id)   REFERENCES characters(id)   ON DELETE CASCADE,
  INDEX idx_lobby   (lobby_id, is_ready)
);

-- ─── PVP MATCHES ─────────────────────────────────────────────
-- Immutable record of every completed match.
CREATE TABLE IF NOT EXISTS pvp_matches (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  lobby_id          BIGINT UNSIGNED NOT NULL,
  mode              ENUM('duel','crew_battle','arena_ffa') NOT NULL,
  island            VARCHAR(64)  NOT NULL,
  winner_grudge_id  VARCHAR(36)  NULL,         -- NULL for team wins or draws
  winner_team       TINYINT UNSIGNED NULL,     -- 1 or 2 for crew_battle
  duration_ms       INT UNSIGNED DEFAULT 0,
  -- JSON: { kills[], damage_dealt{}, healing_done{}, z_key_triggers{} }
  match_data        JSON DEFAULT (JSON_OBJECT()),
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (lobby_id) REFERENCES pvp_lobbies(id) ON DELETE CASCADE,
  INDEX idx_winner  (winner_grudge_id, created_at DESC),
  INDEX idx_mode    (mode, created_at DESC)
);

-- ─── PVP RATINGS ─────────────────────────────────────────────
-- ELO rating per player per mode. Default 1200 (standard ELO baseline).
CREATE TABLE IF NOT EXISTS pvp_ratings (
  grudge_id         VARCHAR(36) NOT NULL,
  mode              ENUM('duel','crew_battle','arena_ffa') NOT NULL,
  rating            INT NOT NULL DEFAULT 1200,
  wins              INT UNSIGNED DEFAULT 0,
  losses            INT UNSIGNED DEFAULT 0,
  draws             INT UNSIGNED DEFAULT 0,
  streak            INT DEFAULT 0,            -- positive = win streak, negative = loss streak
  peak_rating       INT NOT NULL DEFAULT 1200,
  updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (grudge_id, mode),
  FOREIGN KEY (grudge_id) REFERENCES users(grudge_id) ON DELETE CASCADE,
  INDEX idx_rating  (mode, rating DESC)
);
