-- Migration: auth + order audit
-- Migration: add username support and audit/event tables for auth + orders
-- Run this on existing foodiehub_core database.

USE `foodiehub_core`;

-- Ensure users.username exists
SET @col_exists := (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'users'
      AND COLUMN_NAME = 'username'
);
SET @sql := IF(
    @col_exists = 0,
    'ALTER TABLE users ADD COLUMN username VARCHAR(60) NOT NULL DEFAULT '''' AFTER id',
    'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Fill empty usernames for legacy records before applying unique index
UPDATE users
SET username = CONCAT('user-', id)
WHERE username IS NULL OR TRIM(username) = '';

-- Ensure unique index on username exists
SET @idx_exists := (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'users'
      AND INDEX_NAME = 'uq_users_username'
);
SET @sql := IF(
    @idx_exists = 0,
    'ALTER TABLE users ADD UNIQUE KEY uq_users_username (username)',
    'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS `auth_login_events` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT UNSIGNED NULL,
  `identifier` VARCHAR(190) NOT NULL,
  `role` VARCHAR(20) NULL,
  `login_method` VARCHAR(30) NOT NULL DEFAULT 'password',
  `success` TINYINT(1) NOT NULL DEFAULT 0,
  `failure_reason` VARCHAR(190) NULL,
  `ip_address` VARCHAR(45) NULL,
  `user_agent` VARCHAR(255) NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_auth_login_events_user_id` (`user_id`),
  KEY `idx_auth_login_events_identifier` (`identifier`),
  KEY `idx_auth_login_events_success` (`success`),
  KEY `idx_auth_login_events_created_at` (`created_at`),
  CONSTRAINT `fk_auth_login_events_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
    ON UPDATE CASCADE
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `user_registration_events` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT UNSIGNED NOT NULL,
  `username` VARCHAR(60) NOT NULL,
  `email` VARCHAR(190) NOT NULL,
  `role` VARCHAR(20) NOT NULL DEFAULT 'user',
  `source` VARCHAR(30) NOT NULL DEFAULT 'register',
  `ip_address` VARCHAR(45) NULL,
  `user_agent` VARCHAR(255) NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_registration_events_user_id` (`user_id`),
  KEY `idx_user_registration_events_email` (`email`),
  KEY `idx_user_registration_events_source` (`source`),
  KEY `idx_user_registration_events_created_at` (`created_at`),
  CONSTRAINT `fk_user_registration_events_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
    ON UPDATE CASCADE
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `order_events` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `order_id` INT UNSIGNED NOT NULL,
  `user_id` INT UNSIGNED NULL,
  `event_type` VARCHAR(40) NOT NULL DEFAULT 'placed',
  `status` VARCHAR(40) NULL,
  `total` DECIMAL(10,2) NULL,
  `ip_address` VARCHAR(45) NULL,
  `user_agent` VARCHAR(255) NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_order_events_order_id` (`order_id`),
  KEY `idx_order_events_user_id` (`user_id`),
  KEY `idx_order_events_event_type` (`event_type`),
  KEY `idx_order_events_created_at` (`created_at`),
  CONSTRAINT `fk_order_events_order`
    FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`)
    ON UPDATE CASCADE
    ON DELETE CASCADE,
  CONSTRAINT `fk_order_events_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
    ON UPDATE CASCADE
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- Migration: user profile + addresses
-- 2026-02-16: User profile + addresses persistence
-- Adds:
-- - user_profiles: age + settings JSON per user
-- - user_addresses: saved addresses per user

CREATE TABLE IF NOT EXISTS `user_profiles` (
  `user_id` INT UNSIGNED NOT NULL,
  `age` INT UNSIGNED NULL,
  `settings_json` LONGTEXT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`),
  CONSTRAINT `fk_user_profiles_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
    ON UPDATE CASCADE
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `user_addresses` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT UNSIGNED NOT NULL,
  `label` VARCHAR(60) NOT NULL,
  `line` VARCHAR(255) NOT NULL,
  `city` VARCHAR(100) NOT NULL,
  `zip` VARCHAR(20) NOT NULL,
  `is_default` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_addresses_user_id` (`user_id`),
  KEY `idx_user_addresses_default` (`is_default`),
  CONSTRAINT `fk_user_addresses_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
    ON UPDATE CASCADE
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;




