-- ═══════════════════════════════════════════════════════════════
-- GRUDGE STUDIO — Canonical Identity Enforcement
-- Run: mysql -u root -p grudge_game < migrations/025_canonical_identity.sql
-- Safe to re-run (idempotent). Target: MySQL 8.0.
-- ═══════════════════════════════════════════════════════════════
--
-- Enforces the "one human = one canonical Grudge ID" model in the
-- existing data so it matches the refactored grudge-id service:
--
--   • grudge_id stays a UUID v4 (unchanged here — code now always mints
--     UUIDs via accounts.generateGrudgeId()).
--   • puter_id is the SINGLE canonical column for a real Puter UUID.
--     - Fabricated `GRUDGE-xxxx` placeholders (written by the old auth
--       routes) are cleared to NULL — they were never real Puter accounts
--       and only polluted the unique index.
--     - The duplicate `puter_uuid` column (added by 10-oauth-providers for
--       links.js) is consolidated back into puter_id and DEPRECATED.
--   • Credential columns are UNIQUE so the DB backstops the app-level
--     single-canonical-ID checks.
--
-- See services/grudge-id/docs/ACCOUNT_LINKING.md for the full model.
-- ═══════════════════════════════════════════════════════════════

USE grudge_game;

-- ── 1. Clear fabricated puter_id placeholders ────────────────────────────────
-- These came from the old `puter_id = 'GRUDGE-' + grudge_id[0..8]` hack.
UPDATE users
   SET puter_id = NULL
 WHERE puter_id LIKE 'GRUDGE-%';

-- ── 2. Consolidate deprecated puter_uuid → canonical puter_id ─────────────────
-- Only backfill where puter_id is empty AND the value won't collide with a
-- puter_id already held by another row (avoids a UNIQUE violation mid-statement).
UPDATE users
   SET puter_id = puter_uuid
 WHERE puter_id IS NULL
   AND puter_uuid IS NOT NULL
   AND puter_uuid NOT IN (
     SELECT p FROM (SELECT puter_id AS p FROM users WHERE puter_id IS NOT NULL) AS taken
   );

-- ── 3. Harden uniqueness on credential columns ───────────────────────────────
-- Stored-proc pattern with error handlers = idempotent on MySQL 8 (which has
-- no CREATE INDEX IF NOT EXISTS). 1061 = index exists, 1062 = duplicate values
-- already present (leave the index non-unique in that case — the app's
-- /identity/link-auth + /auth/links conflict checks still protect it).
DROP PROCEDURE IF EXISTS _migrate_025;
DELIMITER //
CREATE PROCEDURE _migrate_025()
BEGIN
  DECLARE CONTINUE HANDLER FOR 1061 BEGIN END; -- duplicate index name
  DECLARE CONTINUE HANDLER FOR 1062 BEGIN END; -- duplicate values — skip
  DECLARE CONTINUE HANDLER FOR 1060 BEGIN END; -- duplicate column
  DECLARE CONTINUE HANDLER FOR 1091 BEGIN END; -- drop target missing

  -- Ensure the canonical auth columns exist. Migration 021 was authored with
  -- MariaDB-only `ADD COLUMN IF NOT EXISTS` and never applied on MySQL 8, so
  -- these may be missing. The 1060 handler makes the ADDs idempotent.
  ALTER TABLE users ADD COLUMN web3auth_id VARCHAR(256) DEFAULT NULL;
  ALTER TABLE users ADD COLUMN is_temp     TINYINT(1) NOT NULL DEFAULT 0
    COMMENT 'Puter temp account: 1=guest (auto-created), 0=claimed';

  -- puter_id is already UNIQUE from 01-schema; re-assert defensively.
  ALTER TABLE users ADD UNIQUE INDEX uniq_users_puter_id (puter_id);

  -- web3auth_id → UNIQUE so one Web3Auth identity maps to at most one Grudge ID.
  ALTER TABLE users ADD UNIQUE INDEX uniq_users_web3auth_id (web3auth_id);
END //
DELIMITER ;
CALL _migrate_025();
DROP PROCEDURE IF EXISTS _migrate_025;

-- ── 4. puter_uuid is now DEPRECATED ──────────────────────────────────────────
-- Left in place (read-only) for backward compatibility. No application code
-- writes it anymore. Once every environment is confirmed migrated, drop it:
--     ALTER TABLE users DROP COLUMN puter_uuid;

-- ── 5. Verification ──────────────────────────────────────────────────────────
SELECT
  COUNT(*)                                              AS total_users,
  SUM(puter_id IS NOT NULL)                             AS with_real_puter_id,
  SUM(puter_id LIKE 'GRUDGE-%')                         AS remaining_fabricated,
  SUM(puter_uuid IS NOT NULL AND puter_id IS NULL)      AS unmigrated_puter_uuid
FROM users;
