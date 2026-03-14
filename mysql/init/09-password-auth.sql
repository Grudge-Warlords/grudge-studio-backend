-- ─────────────────────────────────────────────
-- 09 — Add username/password auth support to users
-- ─────────────────────────────────────────────
USE grudge_game;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_hash  VARCHAR(255) DEFAULT NULL AFTER email,
  ADD COLUMN IF NOT EXISTS display_name   VARCHAR(64)  DEFAULT NULL AFTER password_hash,
  ADD COLUMN IF NOT EXISTS is_guest       BOOLEAN      DEFAULT FALSE AFTER display_name,
  ADD COLUMN IF NOT EXISTS gold           BIGINT UNSIGNED DEFAULT 1000 AFTER is_guest,
  ADD COLUMN IF NOT EXISTS gbux_balance   INT UNSIGNED DEFAULT 0    AFTER gold;
