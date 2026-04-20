-- ─────────────────────────────────────────────
-- 13 — GRUDA Node Device Pairing
-- Copied from migrations/022_devices.sql into init/
-- so fresh Docker deploys have the table.
-- ─────────────────────────────────────────────
USE grudge_game;

CREATE TABLE IF NOT EXISTS grudge_devices (
  id            VARCHAR(36)  NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  code          VARCHAR(6)   NOT NULL UNIQUE,          -- 6-char pairing code shown on device
  device_id     VARCHAR(128) NOT NULL,                 -- hardware/software device identifier
  device_name   VARCHAR(64)  DEFAULT 'GRUDA Node',
  device_type   VARCHAR(32)  DEFAULT 'node',           -- node | mobile | desktop | web
  grudge_id     VARCHAR(36)  DEFAULT NULL,             -- set when approved
  status        ENUM('pending','approved','expired','revoked') NOT NULL DEFAULT 'pending',
  ip            VARCHAR(64)  DEFAULT NULL,
  paired_at     DATETIME     DEFAULT NULL,
  last_seen     DATETIME     DEFAULT NULL,
  expires_at    DATETIME     NOT NULL,                 -- code expiry (10 min from generation)
  created_at    DATETIME     NOT NULL DEFAULT NOW(),

  INDEX idx_code       (code),
  INDEX idx_grudge_id  (grudge_id),
  INDEX idx_device_id  (device_id),
  INDEX idx_status     (status),
  CONSTRAINT fk_device_user FOREIGN KEY (grudge_id) REFERENCES users(grudge_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
