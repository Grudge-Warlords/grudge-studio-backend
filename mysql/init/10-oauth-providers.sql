-- ─────────────────────────────────────────────
-- 10 — Add OAuth provider columns to users
-- ─────────────────────────────────────────────
USE grudge_game;

ALTER TABLE users
  ADD COLUMN puter_uuid      VARCHAR(128) UNIQUE DEFAULT NULL AFTER puter_id,
  ADD COLUMN puter_username  VARCHAR(64)  DEFAULT NULL AFTER puter_uuid,
  ADD COLUMN google_id       VARCHAR(64)  UNIQUE DEFAULT NULL AFTER puter_username,
  ADD COLUMN github_id       VARCHAR(64)  UNIQUE DEFAULT NULL AFTER google_id,
  ADD COLUMN phone           VARCHAR(32)  UNIQUE DEFAULT NULL AFTER github_id,
  ADD COLUMN avatar_url      VARCHAR(512) DEFAULT NULL AFTER phone;
