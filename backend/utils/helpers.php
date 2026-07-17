<?php

declare(strict_types=1);

if (!function_exists('app_now_utc')) {
    function app_now_utc(): string
    {
        return gmdate('c');
    }
}

if (!function_exists('app_env')) {
    function app_env(string $key, mixed $default = null): mixed
    {
        $value = getenv($key);
        if ($value === false) {
            return $default;
        }

        return $value;
    }
}

if (!function_exists('app_env_bool')) {
    function app_env_bool(string $key, bool $default = false): bool
    {
        $value = app_env($key, null);
        if ($value === null) {
            return $default;
        }

        $parsed = filter_var($value, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);

        return $parsed ?? $default;
    }
}

if (!function_exists('app_json_input')) {
    function app_json_input(): array
    {
        $raw = file_get_contents('php://input');
        if (!is_string($raw) || trim($raw) === '') {
            return [];
        }

        $decoded = json_decode($raw, true);

        return is_array($decoded) ? $decoded : [];
    }
}

if (!function_exists('app_request_data')) {
    function app_request_data(): array
    {
        $contentType = strtolower((string)($_SERVER['CONTENT_TYPE'] ?? ''));

        if (str_contains($contentType, 'application/json')) {
            return app_json_input();
        }

        if (!empty($_POST) && is_array($_POST)) {
            return $_POST;
        }

        $raw = file_get_contents('php://input');
        if (!is_string($raw) || trim($raw) === '') {
            return [];
        }

        parse_str($raw, $parsed);

        return is_array($parsed) ? $parsed : [];
    }
}

if (!function_exists('app_get_str')) {
    function app_get_str(array $data, string $key, string $default = ''): string
    {
        if (!array_key_exists($key, $data)) {
            return $default;
        }

        return trim((string)$data[$key]);
    }
}

if (!function_exists('app_get_int')) {
    function app_get_int(array $data, string $key, int $default = 0): int
    {
        if (!array_key_exists($key, $data)) {
            return $default;
        }

        return (int)$data[$key];
    }
}

if (!function_exists('app_get_float')) {
    function app_get_float(array $data, string $key, float $default = 0.0): float
    {
        if (!array_key_exists($key, $data)) {
            return $default;
        }

        return (float)$data[$key];
    }
}

if (!function_exists('app_is_email')) {
    function app_is_email(string $value): bool
    {
        return filter_var(trim($value), FILTER_VALIDATE_EMAIL) !== false;
    }
}

if (!function_exists('app_is_positive_id')) {
    function app_is_positive_id(int $id): bool
    {
        return $id > 0;
    }
}

if (!function_exists('app_password_hash')) {
    function app_password_hash(string $password): string
    {
        return password_hash($password, PASSWORD_DEFAULT);
    }
}

if (!function_exists('app_password_verify')) {
    function app_password_verify(string $password, string $hash): bool
    {
        return password_verify($password, $hash);
    }
}

if (!function_exists('app_json_response')) {
    function app_json_response(array $payload, int $statusCode = 200): never
    {
        http_response_code($statusCode);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        exit;
    }
}

if (!function_exists('app_success')) {
    function app_success(mixed $data = null, string $message = 'OK', int $statusCode = 200): never
    {
        app_json_response(
            [
                'success' => true,
                'message' => $message,
                'data' => $data,
                'timestamp' => app_now_utc(),
            ],
            $statusCode
        );
    }
}

if (!function_exists('app_error')) {
    function app_error(string $message, int $statusCode = 400, mixed $errors = null): never
    {
        app_json_response(
            [
                'success' => false,
                'message' => $message,
                'errors' => $errors,
                'timestamp' => app_now_utc(),
            ],
            $statusCode
        );
    }
}
