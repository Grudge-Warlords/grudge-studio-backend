-- ─────────────────────────────────────────────────────────────
-- GRUDGE STUDIO — Hero Ships Schema (15)
-- One ship per player. GLB binary stored in R2/object-storage.
-- Meta (name, voxelCount, gridData) stored here.
-- Routes: /hero-ship (game-api)
-- ─────────────────────────────────────────────────────────────
USE grudge_game;

CREATE TABLE IF NOT EXISTS hero_ships (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  grudge_id    VARCHAR(36)   NOT NULL UNIQUE,
  name         VARCHAR(128)  NOT NULL DEFAULT 'Custom Hero',
  voxel_count  INT UNSIGNED  NOT NULL DEFAULT 0,
  -- JSON grid metadata for client rendering hints
  grid_data    JSON          NULL,
  created_at   TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (grudge_id) REFERENCES users(grudge_id) ON DELETE CASCADE,
  INDEX idx_grudge_id (grudge_id)
);
