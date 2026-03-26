-- ═══════════════════════════════════════════════════════════════
-- GRUDGE STUDIO — Puter Identity & PIP Onboarding Migration
-- Run: mysql -u root -p grudge_game < migrations/021_puter_identity.sql
-- Safe to re-run: all changes use IF NOT EXISTS / IF EXISTS guards
-- ═══════════════════════════════════════════════════════════════
--
-- Adds Puter account linkage to the users table, enabling:
--   • Automatic guest Puter accounts on first visit (is_temp=1)
--   • Grudge ID seeded from Puter UUID
--   • Multi-auth linking (Discord + wallet + web3auth → one Grudge ID)
--   • PIP revenue tracking via puter_id engagement
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Core Puter identity columns ───────────────────────────────────────────

-- puter_id: the Puter account UUID that seeds this Grudge ID
-- Every player gets one — temp accounts have is_temp=1
ALTER TABLE users
  MODIFY COLUMN puter_id VARCHAR(128) DEFAULT NULL;

-- is_temp: 1 = auto-created temp Puter account (guest player)
--          0 = permanent Puter account (claimed with email)
-- Temp players still generate PIP revenue for GRUDGE STUDIO
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_temp TINYINT(1) NOT NULL DEFAULT 0
    COMMENT 'Puter temp account: 1=guest (auto-created), 0=claimed account';

-- ── 2. Additional auth linkage columns ───────────────────────────────────────

-- web3auth_id: Web3Auth sub (JWT subject claim)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS web3auth_id VARCHAR(256) DEFAULT NULL
    COMMENT 'Web3Auth sub claim — links Web3Auth login to Grudge ID';

-- email: for accounts claimed from temp (or email-registered)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email VARCHAR(255) DEFAULT NULL
    COMMENT 'Email — set when temp user claims account or registers by email';

-- ── 3. Indices for fast lookups ───────────────────────────────────────────────

-- Fast puter_id → grudge_id lookup (used on every autoOnboard() call)
CREATE INDEX IF NOT EXISTS idx_users_puter_id
  ON users(puter_id);

-- Fast is_temp filter (for analytics: how many guests vs members)
CREATE INDEX IF NOT EXISTS idx_users_is_temp
  ON users(is_temp);

-- Fast web3auth_id lookup
CREATE INDEX IF NOT EXISTS idx_users_web3auth_id
  ON users(web3auth_id);

-- Fast email lookup (unique — one Grudge ID per email)
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email
  ON users(email);

-- ── 4. PIP analytics table ────────────────────────────────────────────────────
-- Tracks player Puter engagement events for PIP revenue monitoring.
-- This is GRUDGE STUDIO internal — Puter pays us based on engagement,
-- so we track it ourselves to verify monthly payments.

CREATE TABLE IF NOT EXISTS puter_engagement (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  grudge_id      VARCHAR(64) NOT NULL,
  puter_id       VARCHAR(128) NOT NULL,
  event_type     ENUM(
    'ai_chat',      -- puter.ai.chat() call
    'kv_write',     -- puter.kv.set() call
    'fs_write',     -- puter.fs.write() call
    'auth_create',  -- new Puter account created
    'account_claim' -- temp → permanent upgrade
  ) NOT NULL,
  core_id        VARCHAR(64) DEFAULT NULL  COMMENT 'GRD-17 core used (grd17, grd27, etc.)',
  is_temp_user   TINYINT(1)  NOT NULL DEFAULT 1,
  metadata       JSON        DEFAULT NULL,
  created_at     TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_pe_grudge   (grudge_id, created_at),
  INDEX idx_pe_puter    (puter_id, created_at),
  INDEX idx_pe_type     (event_type, created_at),
  INDEX idx_pe_month    (created_at)  -- for monthly PIP reporting

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Puter engagement events — used to verify monthly PIP revenue';

-- ── 5. Verification ───────────────────────────────────────────────────────────
SELECT
  COLUMN_NAME,
  COLUMN_TYPE,
  IS_NULLABLE,
  COLUMN_DEFAULT,
  COLUMN_COMMENT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME   = 'users'
  AND COLUMN_NAME IN ('puter_id', 'is_temp', 'web3auth_id', 'email')
ORDER BY ORDINAL_POSITION;
