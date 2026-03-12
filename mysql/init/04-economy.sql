-- ─────────────────────────────────────────────────────────────
-- GRUDGE STUDIO — Economy Schema (04)
-- Depends on: 01-schema.sql (users, characters)
-- ─────────────────────────────────────────────────────────────
USE grudge_game;

-- ─── ADD GOLD TO CHARACTERS ──────────────────────────────────
-- Migration-safe: only adds column if it doesn't already exist
SET @exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'grudge_game'
    AND TABLE_NAME   = 'characters'
    AND COLUMN_NAME  = 'gold'
);
SET @sql = IF(@exists = 0,
  'ALTER TABLE characters ADD COLUMN gold BIGINT UNSIGNED NOT NULL DEFAULT 0',
  'SELECT 1 -- gold column already exists'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ─── GOLD TRANSACTIONS ────────────────────────────────────────
-- Full audit trail for every gold change. Immutable append-only.
CREATE TABLE IF NOT EXISTS gold_transactions (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  grudge_id       VARCHAR(36)      NOT NULL,
  char_id         BIGINT UNSIGNED  NOT NULL,
  -- Positive = credit, negative = debit
  amount          BIGINT           NOT NULL,
  type            ENUM(
                    'mission_reward',  -- completing a mission
                    'purchase',        -- buying from vendor/shop
                    'craft_cost',      -- crafting material fee
                    'transfer_in',     -- received from another player
                    'transfer_out',    -- sent to another player
                    'admin_grant',     -- admin awarded gold
                    'admin_deduct'     -- admin removed gold
                  ) NOT NULL,
  ref_id          VARCHAR(128) DEFAULT NULL,  -- e.g. mission id, craft queue id
  balance_after   BIGINT UNSIGNED NOT NULL,
  note            VARCHAR(255)     DEFAULT NULL,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (grudge_id) REFERENCES users(grudge_id) ON DELETE CASCADE,
  FOREIGN KEY (char_id)   REFERENCES characters(id)   ON DELETE CASCADE,
  INDEX idx_char_history (char_id, created_at DESC),
  INDEX idx_user_history (grudge_id, created_at DESC)
);
