-- ═══════════════════════════════════════════════════
-- Migration 023: Password reset token columns
-- Adds reset_token + reset_token_expires to users table
-- for the /auth/forgot-password → /auth/reset-password flow.
-- ═══════════════════════════════════════════════════

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS reset_token       VARCHAR(64)  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS reset_token_expires DATETIME   DEFAULT NULL;

-- Index for fast token lookup (no full-table scan on reset)
CREATE INDEX IF NOT EXISTS idx_users_reset_token ON users (reset_token);
