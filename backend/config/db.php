<?php

declare(strict_types=1);

function db(): PDO
{
    static $pdo = null;

    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $host = getenv('DB_HOST') ?: '127.0.0.1';
    $port = getenv('DB_PORT') ?: '3306';
    $name = getenv('DB_NAME') ?: 'foodiehub_core';
    $user = getenv('DB_USER') ?: 'root';
    $pass = getenv('DB_PASS');
    if ($pass === false) {
        $pass = '';
    }

    $dsn = sprintf('mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4', $host, $port, $name);

    $pdo = new PDO(
        $dsn,
        $user,
        $pass,
        [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]
    );

       try {
        ensureSchema($pdo);
    } catch (Throwable $e) {
        // DB connection should not fail because of bootstrap attempts.
    }
    $seedDefaults = filter_var(getenv('SEED_DEFAULT_ACCOUNTS') ?: 'false', FILTER_VALIDATE_BOOLEAN);
    if ($seedDefaults) {
        try {
            ensureDefaultAccounts($pdo);
        } catch (Throwable $e) {
            // Do not fail app boot if seeding check fails.
        }
    }

    return $pdo;
}

function ensureSchema(PDO $pdo): void
{
    static $ran = false;
    if ($ran) {
        return;
    }
    $ran = true;

    // If core tables exist, assume schema is already installed.
    try {
        $stmt = $pdo->query("SHOW TABLES LIKE 'users'");
        $hasUsers = $stmt && (bool)$stmt->fetchColumn();
        $stmt2 = $pdo->query("SHOW TABLES LIKE 'orders'");
        $hasOrders = $stmt2 && (bool)$stmt2->fetchColumn();
        $stmt3 = $pdo->query("SHOW TABLES LIKE 'auth_login_events'");
        $hasAudit = $stmt3 && (bool)$stmt3->fetchColumn();
        $stmt4 = $pdo->query("SHOW TABLES LIKE 'user_profiles'");
        $hasProfiles = $stmt4 && (bool)$stmt4->fetchColumn();
        $stmt5 = $pdo->query("SHOW TABLES LIKE 'user_addresses'");
        $hasAddresses = $stmt5 && (bool)$stmt5->fetchColumn();
        if ($hasUsers && $hasOrders && $hasAudit && $hasProfiles && $hasAddresses) {
            // Keep lightweight compatibility migrations running even when core schema exists.
            ensureMenuDescriptionColumn($pdo);
            return;
        }
    } catch (Throwable $e) {
        // Continue to attempt schema install below.
    }

    $sqlDir = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'sql' . DIRECTORY_SEPARATOR;
    $schemaPaths = [
        $sqlDir . 'DB_Part_1.sql',
        $sqlDir . 'DB_Part_2.sql',
    ];

    foreach ($schemaPaths as $schemaPath) {
        if (!is_file($schemaPath)) {
            continue;
        }

        $sql = (string)file_get_contents($schemaPath);
        $sql = preg_replace('/^\xEF\xBB\xBF/', '', $sql); // strip BOM if present

        // Split into statements. SQL parts contain CREATE/ALTER/UPDATE statements only.
        $statements = preg_split("/;\\s*\\r?\\n/", $sql) ?: [];
        foreach ($statements as $statement) {
            $statement = trim($statement);
            if ($statement === '' || str_starts_with($statement, '--')) {
                continue;
            }
            $pdo->exec($statement);
        }
    }

    ensureMenuDescriptionColumn($pdo);
}

function ensureMenuDescriptionColumn(PDO $pdo): void
{
    try {
        $stmt = $pdo->query("SHOW COLUMNS FROM `menu_items` LIKE 'description'");
        $hasDescription = $stmt && (bool)$stmt->fetchColumn();
        if ($hasDescription) {
            return;
        }

        $pdo->exec("ALTER TABLE `menu_items` ADD COLUMN `description` TEXT NULL AFTER `category`");
    } catch (Throwable $e) {
        // Best-effort migration only.
    }
}

function ensureDefaultAccounts(PDO $pdo): void
{
    // Demo users shown in frontend login form.
    $pdo->exec(
        "INSERT INTO `users` (`username`, `name`, `email`, `phone`, `password_hash`, `role`, `is_active`, `created_at`, `updated_at`)
         SELECT 'pizzalover', 'Pizza Lover', 'pizzalover@foodiehub.com', '9876543210', '$2y$10\$d4yMzOiyAjqrQXQ.rGobRe.dVwC1dZCgzW5EtpJI8mjl/YspV1gva', 'user', 1, NOW(), NOW()
         WHERE NOT EXISTS (
           SELECT 1 FROM `users` WHERE `email` = 'pizzalover@foodiehub.com' OR `username` = 'pizzalover'
         )"
    );

    $pdo->exec(
        "INSERT INTO `users` (`username`, `name`, `email`, `phone`, `password_hash`, `role`, `is_active`, `created_at`, `updated_at`)
         SELECT 'burgerbite', 'Burger Bite', 'burgerbite@foodiehub.com', '9876501234', '$2y$10\$m4fn7SjleO07NqwnDz5CJeG7jahu4PhvTZZwsFOh3lKI3wNOcG2lW', 'user', 1, NOW(), NOW()
         WHERE NOT EXISTS (
           SELECT 1 FROM `users` WHERE `email` = 'burgerbite@foodiehub.com' OR `username` = 'burgerbite'
         )"
    );

    // Admin account for admin portal.
    $pdo->exec(
        "INSERT INTO `users` (`username`, `name`, `email`, `phone`, `password_hash`, `role`, `is_active`, `created_at`, `updated_at`)
         SELECT 'gh0\$t', 'FoodieHub Admin', 'admin@foodiehub.com', '', '$2y$10\$GQZI3KkIWtK1ek6iOzyWTeXN//5P45sETgWdQyKZNjk7zHO37msAW', 'admin', 1, NOW(), NOW()
         WHERE NOT EXISTS (
           SELECT 1 FROM `users` WHERE `email` = 'admin@foodiehub.com' OR `username` = 'gh0\$t'
         )"
    );
}
