-- ─────────────────────────────────────────────
-- 10 — Add OAuth provider columns to users (idempotent)
-- ─────────────────────────────────────────────
USE grudge_game;

DROP PROCEDURE IF EXISTS _migrate_10;
DELIMITER //
CREATE PROCEDURE _migrate_10()
BEGIN
  DECLARE CONTINUE HANDLER FOR 1060 BEGIN END; -- ignore duplicate column
  ALTER TABLE users ADD COLUMN puter_uuid      VARCHAR(128) UNIQUE DEFAULT NULL AFTER puter_id;
  ALTER TABLE users ADD COLUMN puter_username  VARCHAR(64)  DEFAULT NULL AFTER puter_uuid;
  ALTER TABLE users ADD COLUMN google_id       VARCHAR(64)  UNIQUE DEFAULT NULL AFTER puter_username;
  ALTER TABLE users ADD COLUMN github_id       VARCHAR(64)  UNIQUE DEFAULT NULL AFTER google_id;
  ALTER TABLE users ADD COLUMN github_username  VARCHAR(64)  DEFAULT NULL AFTER github_id;
  ALTER TABLE users ADD COLUMN phone           VARCHAR(32)  UNIQUE DEFAULT NULL AFTER github_username;
  ALTER TABLE users ADD COLUMN avatar_url      VARCHAR(512) DEFAULT NULL AFTER phone;
END //
DELIMITER ;
CALL _migrate_10();
DROP PROCEDURE IF EXISTS _migrate_10;
