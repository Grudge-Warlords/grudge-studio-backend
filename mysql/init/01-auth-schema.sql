-- ============================================================
-- Grudge ID — Auth Schema
-- Runs on first docker compose up via mysql init scripts.
-- ============================================================

CREATE TABLE IF NOT EXISTS `users` (
  `id`            INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  `grudge_id`     VARCHAR(32)     NOT NULL,
  `username`      VARCHAR(64)     DEFAULT NULL,
  `display_name`  VARCHAR(64)     NOT NULL DEFAULT 'Player',
  `email`         VARCHAR(255)    DEFAULT NULL,
  `password_hash` VARCHAR(255)    DEFAULT NULL,
  `phone`         VARCHAR(20)     DEFAULT NULL,
  `avatar_url`    TEXT            DEFAULT NULL,
  `is_guest`      TINYINT(1)      NOT NULL DEFAULT 0,
  `faction`       VARCHAR(32)     DEFAULT NULL,
  `is_premium`    TINYINT(1)      NOT NULL DEFAULT 0,
  `created_at`    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_grudge_id` (`grudge_id`),
  UNIQUE KEY `uq_username` (`username`),
  UNIQUE KEY `uq_email` (`email`),
  UNIQUE KEY `uq_phone` (`phone`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `user_providers` (
  `id`            INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  `user_id`       INT UNSIGNED    NOT NULL,
  `provider`      ENUM('puter','discord','google','github','wallet','phone','email','guest')
                                  NOT NULL,
  `provider_uid`  VARCHAR(255)    NOT NULL,
  `provider_data` JSON            DEFAULT NULL,
  `linked_at`     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_provider_uid` (`provider`, `provider_uid`),
  INDEX `idx_user_id` (`user_id`),
  CONSTRAINT `fk_up_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `sessions` (
  `id`             INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  `user_id`        INT UNSIGNED    NOT NULL,
  `refresh_token`  VARCHAR(512)    NOT NULL,
  `expires_at`     TIMESTAMP       NOT NULL,
  `created_at`     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_refresh_token` (`refresh_token`),
  INDEX `idx_session_user` (`user_id`),
  INDEX `idx_session_expires` (`expires_at`),
  CONSTRAINT `fk_session_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
