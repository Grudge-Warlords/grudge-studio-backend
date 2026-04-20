-- ─────────────────────────────────────────────────────────────
-- GRUDGE STUDIO — RTS Match History Schema (14)
-- Used by: Gruda Armada / grudge-warlords-rts
-- Routes: /rts-matches (game-api)
-- ─────────────────────────────────────────────────────────────
USE grudge_game;

CREATE TABLE IF NOT EXISTS rts_matches (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  winner_grudge_id  VARCHAR(36)  NOT NULL,
  loser_grudge_id   VARCHAR(36)  NULL,
  mode              VARCHAR(32)  NOT NULL DEFAULT 'classic',
  duration_s        INT UNSIGNED NOT NULL DEFAULT 0,
  map_seed          VARCHAR(64)  NULL,
  -- JSON: { kills, buildings_destroyed, units_trained, resources_mined }
  stats_json        JSON         NULL,
  created_at        TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (winner_grudge_id) REFERENCES users(grudge_id) ON DELETE CASCADE,
  INDEX idx_winner  (winner_grudge_id, created_at DESC),
  INDEX idx_loser   (loser_grudge_id,  created_at DESC),
  INDEX idx_mode    (mode, created_at DESC)
);
