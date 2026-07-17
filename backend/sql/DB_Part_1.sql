-- Database.sql
-- Unified SQL for FoodieHub (single-file setup)
-- Includes reset + schema + migrations.

CREATE DATABASE IF NOT EXISTS `foodiehub_core`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `foodiehub_core`;

SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS `order_events`;
DROP TABLE IF EXISTS `user_registration_events`;
DROP TABLE IF EXISTS `auth_login_events`;
DROP TABLE IF EXISTS `user_addresses`;
DROP TABLE IF EXISTS `user_profiles`;
DROP TABLE IF EXISTS `user_email_otps`;
DROP TABLE IF EXISTS `orders`;
DROP TABLE IF EXISTS `menu_items`;
DROP TABLE IF EXISTS `categories`;
DROP TABLE IF EXISTS `users`;
SET FOREIGN_KEY_CHECKS = 1;

-- Base schema

-- Food Ordering Site database schema
-- Target DB: foodiehub_core (MySQL/MariaDB, utf8mb4)

CREATE DATABASE IF NOT EXISTS `foodiehub_core`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `foodiehub_core`;

-- Users: app authentication + role management
CREATE TABLE IF NOT EXISTS `users` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `username` VARCHAR(60) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `email` VARCHAR(190) NOT NULL,
  `phone` VARCHAR(25) NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `role` ENUM('user', 'admin', 'guest') NOT NULL DEFAULT 'user',
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_username` (`username`),
  UNIQUE KEY `uq_users_email` (`email`),
  KEY `idx_users_role` (`role`),
  KEY `idx_users_active` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Categories: logical menu grouping for admin/front-end filters
CREATE TABLE IF NOT EXISTS `categories` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(120) NOT NULL,
  `description` TEXT NULL,
  `image_url` VARCHAR(255) NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_categories_name` (`name`),
  KEY `idx_categories_active` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Menu items: product catalog for ordering
CREATE TABLE IF NOT EXISTS `menu_items` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(150) NOT NULL,
  `category` VARCHAR(60) NOT NULL DEFAULT 'meal',
  `price` DECIMAL(10,2) NOT NULL,
  `image` VARCHAR(255) NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_menu_items_category` (`category`),
  KEY `idx_menu_items_price` (`price`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Orders: checkout snapshots + lifecycle status
CREATE TABLE IF NOT EXISTS `orders` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT UNSIGNED NULL,
  `full_name` VARCHAR(120) NOT NULL,
  `phone` VARCHAR(25) NOT NULL,
  `address` VARCHAR(255) NOT NULL,
  `city` VARCHAR(100) NOT NULL,
  `zip` VARCHAR(20) NOT NULL,
  `payment_method` VARCHAR(60) NOT NULL DEFAULT 'Cash on Delivery',
  `status` VARCHAR(40) NOT NULL DEFAULT 'Placed',
  `subtotal` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `delivery_fee` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `discount` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `total` DECIMAL(10,2) NOT NULL,
  `notes` TEXT NULL,
  `items_json` LONGTEXT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_orders_user_id` (`user_id`),
  KEY `idx_orders_status` (`status`),
  KEY `idx_orders_created_at` (`created_at`),
  CONSTRAINT `fk_orders_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
    ON UPDATE CASCADE
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Email OTPs: Google OAuth email verification
CREATE TABLE IF NOT EXISTS `user_email_otps` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `email` VARCHAR(190) NOT NULL,
  `otp_hash` VARCHAR(255) NOT NULL,
  `purpose` VARCHAR(40) NOT NULL DEFAULT 'google_login',
  `meta_json` LONGTEXT NULL,
  `expires_at` DATETIME NOT NULL,
  `attempts` INT UNSIGNED NOT NULL DEFAULT 0,
  `used_at` DATETIME NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_email_otps_email` (`email`),
  KEY `idx_user_email_otps_purpose` (`purpose`),
  KEY `idx_user_email_otps_expires` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- User profiles: extra profile fields + settings per user
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

-- Saved addresses: per-user address book for faster checkout
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

-- Login events: track every user/admin authentication attempt
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

-- Registration events: track created accounts and source
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

-- Order events: track order placement lifecycle
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

-- Default seed users for demo login flows (idempotent)
INSERT INTO `users` (`username`, `name`, `email`, `phone`, `password_hash`, `role`, `is_active`, `created_at`, `updated_at`)
SELECT 'pizzalover', 'Pizza Lover', 'pizzalover@foodiehub.com', '9876543210', '$2y$10$d4yMzOiyAjqrQXQ.rGobRe.dVwC1dZCgzW5EtpJI8mjl/YspV1gva', 'user', 1, NOW(), NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM `users` WHERE `email` = 'pizzalover@foodiehub.com' OR `username` = 'pizzalover'
);

INSERT INTO `users` (`username`, `name`, `email`, `phone`, `password_hash`, `role`, `is_active`, `created_at`, `updated_at`)
SELECT 'burgerbite', 'Burger Bite', 'burgerbite@foodiehub.com', '9876501234', '$2y$10$m4fn7SjleO07NqwnDz5CJeG7jahu4PhvTZZwsFOh3lKI3wNOcG2lW', 'user', 1, NOW(), NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM `users` WHERE `email` = 'burgerbite@foodiehub.com' OR `username` = 'burgerbite'
);

INSERT INTO `users` (`username`, `name`, `email`, `phone`, `password_hash`, `role`, `is_active`, `created_at`, `updated_at`)
SELECT 'gh0$t', 'FoodieHub Admin', 'admin@foodiehub.com', '', '$2y$10$GQZI3KkIWtK1ek6iOzyWTeXN//5P45sETgWdQyKZNjk7zHO37msAW', 'admin', 1, NOW(), NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM `users` WHERE `email` = 'admin@foodiehub.com' OR `username` = 'gh0$t'
);

