-- ─────────────────────────────────────────────
-- 09 — Add username/password auth support to users (idempotent)
-- ─────────────────────────────────────────────
USE grudge_game;

DROP PROCEDURE IF EXISTS _migrate_09;
DELIMITER //
CREATE PROCEDURE _migrate_09()
BEGIN
  DECLARE CONTINUE HANDLER FOR 1060 BEGIN END; -- ignore duplicate column
  ALTER TABLE users ADD COLUMN password_hash  VARCHAR(255) DEFAULT NULL AFTER email;
  ALTER TABLE users ADD COLUMN display_name   VARCHAR(64)  DEFAULT NULL AFTER password_hash;
  ALTER TABLE users ADD COLUMN is_guest       BOOLEAN      DEFAULT FALSE AFTER display_name;
  ALTER TABLE users ADD COLUMN gold           BIGINT UNSIGNED DEFAULT 1000 AFTER is_guest;
  ALTER TABLE users ADD COLUMN gbux_balance   INT UNSIGNED DEFAULT 0    AFTER gold;
END //
DELIMITER ;
CALL _migrate_09();
DROP PROCEDURE IF EXISTS _migrate_09;
