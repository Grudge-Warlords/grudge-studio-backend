-- ─────────────────────────────────────────────
-- Migration 002: Add missing auth + profile columns to users table
-- Required for: phone auth, Google/GitHub OAuth, Puter, guest accounts, economy
-- Run: mysql -u grudge_admin -p grudge_game < mysql/migrations/002-add-auth-columns.sql
-- ─────────────────────────────────────────────

USE grudge_game;

-- Password-based auth
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255) DEFAULT NULL AFTER email;
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name VARCHAR(64) DEFAULT NULL AFTER username;

-- Phone auth (Twilio Verify)
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(20) UNIQUE DEFAULT NULL AFTER email;

-- Avatar
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT DEFAULT NULL AFTER display_name;

-- Google OAuth
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id VARCHAR(64) UNIQUE DEFAULT NULL AFTER discord_tag;

-- GitHub OAuth
ALTER TABLE users ADD COLUMN IF NOT EXISTS github_id VARCHAR(64) UNIQUE DEFAULT NULL AFTER google_id;

-- Puter Cloud
ALTER TABLE users ADD COLUMN IF NOT EXISTS puter_uuid VARCHAR(128) UNIQUE DEFAULT NULL AFTER puter_id;
ALTER TABLE users ADD COLUMN IF NOT EXISTS puter_username VARCHAR(64) DEFAULT NULL AFTER puter_uuid;

-- Guest flag
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_guest BOOLEAN DEFAULT FALSE AFTER is_banned;

-- Economy
ALTER TABLE users ADD COLUMN IF NOT EXISTS gold BIGINT DEFAULT 1000 AFTER class;
ALTER TABLE users ADD COLUMN IF NOT EXISTS gbux_balance BIGINT DEFAULT 0 AFTER gold;

-- Indexes for login lookups
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
CREATE INDEX IF NOT EXISTS idx_users_google ON users(google_id);
CREATE INDEX IF NOT EXISTS idx_users_github ON users(github_id);
CREATE INDEX IF NOT EXISTS idx_users_puter_uuid ON users(puter_uuid);
