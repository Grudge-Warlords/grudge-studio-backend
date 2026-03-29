-- ─────────────────────────────────────────────
-- 12 — Player Islands (home bases)
-- Migrated from grudge-wars Neon PostgreSQL
-- ─────────────────────────────────────────────
USE grudge_game;

CREATE TABLE IF NOT EXISTS player_islands (
  id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  grudge_id           VARCHAR(36) NOT NULL,
  name                VARCHAR(128) NOT NULL,
  zone_data           JSON DEFAULT NULL,
  conquer_progress    JSON DEFAULT NULL,
  quest_progress      JSON DEFAULT NULL,
  unlocked_locations  JSON DEFAULT NULL,
  harvest_state       JSON DEFAULT NULL,
  created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_islands_grudge (grudge_id),
  FOREIGN KEY (grudge_id) REFERENCES users(grudge_id) ON DELETE CASCADE
);
