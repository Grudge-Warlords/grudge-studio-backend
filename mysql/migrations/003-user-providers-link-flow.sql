-- ============================================================
-- Migration 02 — user_providers: link-providers flow
-- ------------------------------------------------------------
-- Adds OPTIONAL columns and an index needed by the new
-- /auth/links/* endpoints (find-by-provider-email at link time,
-- last-login telemetry per linked provider).
--
-- Safe properties:
--   * Idempotent — re-running on an already-migrated DB is a no-op.
--   * Additive only — no DROP, no RENAME, no data loss.
--   * Does NOT modify existing rows; only widens the schema.
--
-- The unique constraint that guarantees "one provider account
-- maps to exactly one Grudge ID" already exists in 01-auth-schema:
--     UNIQUE KEY uq_provider_uid (provider, provider_uid)
-- so no constraint changes are needed here.
-- ============================================================

-- ── Add provider_email (used for implicit-attach by verified email
--    when a user signs in via a NEW provider that exposes an email
--    matching their existing primary email).
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'user_providers'
    AND COLUMN_NAME  = 'provider_email'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE `user_providers` ADD COLUMN `provider_email` VARCHAR(255) DEFAULT NULL AFTER `provider_uid`',
  'SELECT "provider_email already present" AS msg');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── Add last_login_at (per-provider telemetry — when did the user
--    last successfully sign in via this specific link?)
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'user_providers'
    AND COLUMN_NAME  = 'last_login_at'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE `user_providers` ADD COLUMN `last_login_at` DATETIME DEFAULT NULL',
  'SELECT "last_login_at already present" AS msg');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── Index on provider_email so the implicit-attach lookup
--    (SELECT ... FROM user_providers WHERE provider_email = ?)
--    stays fast as the table grows.
SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'user_providers'
    AND INDEX_NAME   = 'idx_provider_email'
);
SET @sql := IF(@idx_exists = 0,
  'CREATE INDEX `idx_provider_email` ON `user_providers` (`provider_email`)',
  'SELECT "idx_provider_email already present" AS msg');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── Defensive: ensure idx_user_id exists (it's already in 01-auth-schema
--    but creating idempotently in case someone reset the DB without
--    running the original schema).
SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'user_providers'
    AND INDEX_NAME   = 'idx_user_id'
);
SET @sql := IF(@idx_exists = 0,
  'CREATE INDEX `idx_user_id` ON `user_providers` (`user_id`)',
  'SELECT "idx_user_id already present" AS msg');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
