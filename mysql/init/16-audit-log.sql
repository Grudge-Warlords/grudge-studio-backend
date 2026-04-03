-- ─────────────────────────────────────────────────────────────
-- GRUDGE STUDIO — Audit Log & Dash Events Schema (16)
-- audit_log: immutable record of sensitive admin actions
-- dash_events: lightweight event log for deploy/restart history
-- ─────────────────────────────────────────────────────────────
USE grudge_game;

-- Append-only audit log for bans, role changes, economy mutations
CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  actor_id    VARCHAR(36)   NULL,        -- grudge_id of admin who acted (NULL = system)
  target_id   VARCHAR(36)   NULL,        -- grudge_id of affected user (if applicable)
  action      VARCHAR(64)   NOT NULL,    -- e.g. 'ban', 'role_change', 'economy_spend'
  details     JSON          NULL,        -- { old_value, new_value, reason }
  ip_address  VARCHAR(45)   NULL,
  created_at  TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_actor   (actor_id,  created_at DESC),
  INDEX idx_target  (target_id, created_at DESC),
  INDEX idx_action  (action,    created_at DESC)
);

-- Lightweight deploy/service event history (dash Deploy page)
CREATE TABLE IF NOT EXISTS dash_events (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  event_type  VARCHAR(32)   NOT NULL,   -- 'deploy', 'restart', 'rollback', 'health_fail'
  service     VARCHAR(64)   NOT NULL,   -- e.g. 'game-api', 'grudge-id'
  status      VARCHAR(16)   NOT NULL DEFAULT 'ok',  -- 'ok', 'failed', 'rolled_back'
  actor       VARCHAR(64)   NULL,        -- GitHub actor or 'system'
  commit_sha  VARCHAR(40)   NULL,
  details     TEXT          NULL,
  created_at  TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_service   (service,    created_at DESC),
  INDEX idx_eventtype (event_type, created_at DESC)
);
