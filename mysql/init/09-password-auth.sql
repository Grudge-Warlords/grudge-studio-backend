-- ─────────────────────────────────────────────
-- 09 — Add username/password auth support to users
-- ─────────────────────────────────────────────
USE grudge_game;

ALTER TABLE users
  ADD COLUMN password_hash  VARCHAR(255) DEFAULT NULL AFTER email,
  ADD COLUMN display_name   VARCHAR(64)  DEFAULT NULL AFTER password_hash,
  ADD COLUMN is_guest       BOOLEAN      DEFAULT FALSE AFTER display_name,
  ADD COLUMN gold           BIGINT UNSIGNED DEFAULT 1000 AFTER is_guest,
  ADD COLUMN gbux_balance   INT UNSIGNED DEFAULT 0    AFTER gold;
