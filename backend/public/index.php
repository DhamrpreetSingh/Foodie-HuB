<?php

declare(strict_types=1);

require_once __DIR__ . '/../config/env.php';
// Load shared defaults first, then allow local secrets to override them.
$envDefault = __DIR__ . '/../.env';
$envLocal = __DIR__ . '/../.env.local';
loadEnv($envDefault);
loadEnv($envLocal);

require_once __DIR__ . '/../routes/categoryRoutes.php';
require_once __DIR__ . '/../routes/menuRoutes.php';
require_once __DIR__ . '/../routes/orderRoutes.php';
require_once __DIR__ . '/../routes/userRoutes.php';

main();

function main(): void
{
    configureSession();
    if (session_status() !== PHP_SESSION_ACTIVE) {
        session_start();
    }

    $request = buildRequestContext();
    ensureCsrfToken();

    setDefaultHeaders($request['request_id']);
    setCsrfHeader();
    setCorsHeaders();

    if ($request['method'] === 'OPTIONS') {
        http_response_code(204);
        exit;
    }

    try {
        enforceTrustedOrigin($request);
        enforceRouteRateLimit($request);
        if ($request['path'] === '/' || $request['path'] === '') {
            jsonResponse([
                'success' => true,
                'message' => 'Food Ordering API is running.',
                'api_base' => '/api',
                'api_version' => 'v1',
                'request_id' => $request['request_id'],
                'timestamp' => gmdate('c'),
            ]);
        }

        if (isHealthPath($request['path'])) {
            jsonResponse([
                'success' => true,
                'message' => 'Backend is running.',
                'request_id' => $request['request_id'],
                'timestamp' => gmdate('c'),
            ]);
        }

        $routes = routeDefinitions();

        if (dispatchRoute($request, $routes)) {
            return;
        }

        $allowedMethods = findAllowedMethodsForPath($request['path'], $routes);
        if ($allowedMethods !== []) {
            methodNotAllowed($allowedMethods);
        }

        throw new HttpException('Route not found.', 404);
    } catch (HttpException $e) {
        jsonResponse([
            'success' => false,
            'message' => $e->getMessage(),
            'request_id' => $request['request_id'],
            'timestamp' => gmdate('c'),
        ], $e->getStatusCode());
    } catch (Throwable $e) {
        $debug = filter_var(getenv('APP_DEBUG') ?: 'false', FILTER_VALIDATE_BOOLEAN);

        jsonResponse([
            'success' => false,
            'message' => 'Internal server error.',
            'request_id' => $request['request_id'],
            'timestamp' => gmdate('c'),
            'error' => $debug ? $e->getMessage() : null,
        ], 500);
    }
}

function routeDefinitions(): array
{
    $apiPrefix = '#^/api(?:/v1)?';

    return array_merge(
        categoryRoutes($apiPrefix),
        menuRoutes($apiPrefix),
        orderRoutes($apiPrefix),
        userRoutes($apiPrefix)
    );
}

function dispatchRoute(array $request, array $routes): bool
{
    foreach ($routes as $route) {
        if (!preg_match($route['pattern'], $request['path'], $matches)) {
            continue;
        }

        $allowed = explode('|', $route['method']);
        if (!in_array($request['method'], $allowed, true)) {
            continue;
        }

        $params = [];
        foreach ($matches as $key => $value) {
            if (is_string($key)) {
                $params[$key] = $value;
            }
        }

        $handler = $route['handler'];
        $handler($params);
        return true;
    }

    return false;
}

function findAllowedMethodsForPath(string $path, array $routes): array
{
    $methods = [];

    foreach ($routes as $route) {
        if (preg_match($route['pattern'], $path)) {
            foreach (explode('|', $route['method']) as $method) {
                $methods[$method] = true;
            }
        }
    }

    ksort($methods);

    return array_keys($methods);
}

function requestPayload(): array
{
    static $cached = null;
    if (is_array($cached)) {
        return $cached;
    }

    $contentType = strtolower((string)($_SERVER['CONTENT_TYPE'] ?? ''));

    if (str_contains($contentType, 'application/json')) {
        $raw = rawRequestBody();

        if (!is_string($raw) || trim($raw) === '') {
            return $cached = [];
        }

        $decoded = json_decode($raw, true);
        if (!is_array($decoded)) {
            throw new HttpException('Invalid JSON body.', 400);
        }

        return $cached = $decoded;
    }

    if (!empty($_POST)) {
        return $cached = $_POST;
    }

    $raw = rawRequestBody();
    if (!is_string($raw) || trim($raw) === '') {
        return $cached = [];
    }

    parse_str($raw, $parsed);

    return $cached = (is_array($parsed) ? $parsed : []);
}

function rawRequestBody(): string
{
    static $raw = null;
    if ($raw !== null) {
        return $raw;
    }

    $read = file_get_contents('php://input');
    $raw = is_string($read) ? $read : '';
    return $raw;
}

function buildRequestContext(): array
{
    return [
        'method' => detectMethod(),
        'path' => requestPath(),
        'request_id' => requestId(),
    ];
}

function detectMethod(): string
{
    $method = strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET'));

    if ($method !== 'POST') {
        return $method;
    }

    $override = $_POST['_method'] ?? $_SERVER['HTTP_X_HTTP_METHOD_OVERRIDE'] ?? null;
    if (!is_string($override) || trim($override) === '') {
        return $method;
    }

    $override = strtoupper(trim($override));

    return in_array($override, ['PUT', 'PATCH', 'DELETE'], true) ? $override : $method;
}

function requestPath(): string
{
    $uriPath = parse_url((string)($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH);
    $uriPath = is_string($uriPath) ? $uriPath : '/';

    $scriptName = str_replace('\\', '/', (string)($_SERVER['SCRIPT_NAME'] ?? ''));
    $scriptDir = rtrim(str_replace('\\', '/', dirname($scriptName)), '/');

    $path = $uriPath;

    if ($scriptDir !== '' && $scriptDir !== '/' && str_starts_with($path, $scriptDir)) {
        $path = substr($path, strlen($scriptDir));
    }

    if (str_starts_with($path, '/index.php')) {
        $path = substr($path, strlen('/index.php'));
    }

    $path = '/' . ltrim($path, '/');

    return rtrim($path, '/') ?: '/';
}

function requestId(): string
{
    $incoming = trim((string)($_SERVER['HTTP_X_REQUEST_ID'] ?? ''));
    if ($incoming !== '') {
        return substr($incoming, 0, 80);
    }

    try {
        return bin2hex(random_bytes(8));
    } catch (Throwable $e) {
        return uniqid('req_', true);
    }
}

function isHealthPath(string $path): bool
{
    return in_array($path, ['/health', '/api/health', '/api/v1/health'], true);
}

function methodNotAllowed(array $allowed): void
{
    sort($allowed);
    header('Allow: ' . implode(', ', $allowed));
    throw new HttpException('Method not allowed.', 405);
}

function setDefaultHeaders(string $requestId): void
{
    header('X-Request-Id: ' . $requestId);
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: no-referrer');
    header('X-Frame-Options: SAMEORIGIN');
    header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    header('Permissions-Policy: geolocation=(), microphone=(), camera=()');
}

function setCsrfHeader(): void
{
    header('X-CSRF-Token: ' . csrfToken());
}

function setCorsHeaders(): void
{
    $allowedOrigins = allowedOrigins();

    $origin = (string)($_SERVER['HTTP_ORIGIN'] ?? '');

    if ($origin !== '' && in_array($origin, $allowedOrigins, true)) {
        header('Access-Control-Allow-Origin: ' . $origin);
        header('Vary: Origin');
    } elseif (!empty($allowedOrigins)) {
        header('Access-Control-Allow-Origin: ' . $allowedOrigins[0]);
    }

    header('Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With, X-HTTP-Method-Override, X-Request-Id, X-CSRF-Token');
    header('Access-Control-Allow-Credentials: true');
    header('Access-Control-Expose-Headers: X-Request-Id, X-CSRF-Token');
    header('Access-Control-Max-Age: 86400');
}

function allowedOrigins(): array
{
    $defaultOrigins = [
        'http://localhost',
        'http://localhost:3000',
        'http://127.0.0.1',
        'http://127.0.0.1:3000',
    ];

    $allowedRaw = trim((string)(getenv('ALLOWED_ORIGINS') ?: ''));
    if ($allowedRaw === '') {
        return $defaultOrigins;
    }

    return array_values(array_filter(array_map('trim', explode(',', $allowedRaw))));
}

function configureSession(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }

    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
    ini_set('session.cookie_httponly', '1');

    $isHttps = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (strtolower((string)($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https');
    ini_set('session.cookie_secure', $isHttps ? '1' : '0');

    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/',
        'secure' => $isHttps,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
}

function enforceTrustedOrigin(array $request): void
{
    if (in_array($request['method'], ['GET', 'HEAD', 'OPTIONS'], true)) {
        return;
    }

    $origin = trim((string)($_SERVER['HTTP_ORIGIN'] ?? ''));
    if ($origin !== '') {
        if (!in_array($origin, allowedOrigins(), true)) {
            throw new HttpException('Untrusted origin.', 403);
        }
        return;
    }

    $fetchSite = strtolower(trim((string)($_SERVER['HTTP_SEC_FETCH_SITE'] ?? '')));
    if ($fetchSite !== '' && !in_array($fetchSite, ['same-origin', 'same-site', 'none'], true)) {
        throw new HttpException('Cross-site request blocked.', 403);
    }
}

function enforceRouteRateLimit(array $request): void
{
    $rules = [
        ['method' => 'POST', 'pattern' => '#^/api(?:/v1)?/users/login/?$#', 'max' => 10, 'window' => 60],
        ['method' => 'POST', 'pattern' => '#^/api(?:/v1)?/users/signup/send-otp/?$#', 'max' => 5, 'window' => 300],
        ['method' => 'POST', 'pattern' => '#^/api(?:/v1)?/users/signup/verify-otp/?$#', 'max' => 10, 'window' => 300],
        ['method' => 'POST', 'pattern' => '#^/api(?:/v1)?/users/google/verify-otp/?$#', 'max' => 10, 'window' => 300],
    ];

    foreach ($rules as $rule) {
        if ($request['method'] !== $rule['method']) {
            continue;
        }
        if (!preg_match($rule['pattern'], $request['path'])) {
            continue;
        }
        applyRateLimit((string)$rule['pattern'], (int)$rule['max'], (int)$rule['window']);
        applyIdentifierRateLimit($request, $rule);
        return;
    }
}

function applyIdentifierRateLimit(array $request, array $rule): void
{
    $payload = requestPayload();
    $keys = [];

    foreach (['email', 'username', 'login'] as $field) {
        $value = strtolower(trim((string)($payload[$field] ?? '')));
        if ($value !== '') {
            $keys[] = $field . ':' . $value;
        }
    }

    $phoneDigits = preg_replace('/\D+/', '', (string)($payload['phone'] ?? '')) ?: '';
    if ($phoneDigits !== '') {
        $keys[] = 'phone:' . $phoneDigits;
    }

    $keys = array_values(array_unique($keys));
    foreach ($keys as $key) {
        applyRateLimit((string)$rule['pattern'] . '|identifier|' . $key, max(3, (int)$rule['max'] - 2), (int)$rule['window']);
    }
}

function applyRateLimit(string $bucket, int $maxAttempts, int $windowSeconds): void
{
    $ip = clientIpForRateLimit();
    if ($ip === '') {
        return;
    }

    $now = time();
    $window = (int)floor($now / max(1, $windowSeconds));
    $dir = rtrim(sys_get_temp_dir(), '\\/') . DIRECTORY_SEPARATOR . 'foodiehub_rate_limits';
    if (!is_dir($dir)) {
        @mkdir($dir, 0700, true);
    }

    $key = hash('sha256', $bucket . '|' . $ip . '|' . $window);
    $path = $dir . DIRECTORY_SEPARATOR . $key . '.json';

    $count = 0;
    if (is_file($path)) {
        $raw = (string)file_get_contents($path);
        $decoded = json_decode($raw, true);
        if (is_array($decoded) && isset($decoded['count'])) {
            $count = (int)$decoded['count'];
        }
    }

    $count++;
    @file_put_contents($path, json_encode([
        'count' => $count,
        'updated_at' => $now,
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), LOCK_EX);

    if ($count > $maxAttempts) {
        throw new HttpException('Too many requests. Please try again later.', 429);
    }
}

function clientIpForRateLimit(): string
{
    $keys = ['HTTP_CF_CONNECTING_IP', 'HTTP_X_FORWARDED_FOR', 'REMOTE_ADDR'];
    foreach ($keys as $key) {
        $raw = trim((string)($_SERVER[$key] ?? ''));
        if ($raw === '') {
            continue;
        }
        if ($key === 'HTTP_X_FORWARDED_FOR') {
            $parts = array_map('trim', explode(',', $raw));
            $raw = (string)($parts[0] ?? '');
        }
        if ($raw !== '') {
            return substr($raw, 0, 45);
        }
    }

    return '';
}

function ensureCsrfToken(): void
{
    if (!empty($_SESSION['csrf_token']) && is_string($_SESSION['csrf_token'])) {
        return;
    }

    try {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    } catch (Throwable $e) {
        $_SESSION['csrf_token'] = hash('sha256', uniqid('csrf_', true));
    }
}

function csrfToken(): string
{
    ensureCsrfToken();
    return (string)($_SESSION['csrf_token'] ?? '');
}

function enforceCsrfProtection(array $request): void
{
    if (!in_array($request['method'], ['POST', 'PUT', 'PATCH', 'DELETE'], true)) {
        return;
    }

    if ($request['path'] === '/api/csrf' || $request['path'] === '/api/v1/csrf') {
        return;
    }

    $provided = trim((string)($_SERVER['HTTP_X_CSRF_TOKEN'] ?? ''));
    $expected = csrfToken();
    if ($provided === '' || $expected === '' || !hash_equals($expected, $provided)) {
        throw new HttpException('CSRF token mismatch.', 419);
    }
}

function jsonResponse(array $data, int $statusCode = 200): void
{
    setHttpStatus($statusCode);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function setHttpStatus(int $statusCode): void
{
    $known = [
        200 => 'OK',
        201 => 'Created',
        204 => 'No Content',
        400 => 'Bad Request',
        401 => 'Unauthorized',
        403 => 'Forbidden',
        404 => 'Not Found',
        405 => 'Method Not Allowed',
        409 => 'Conflict',
        419 => 'Authentication Timeout',
        422 => 'Unprocessable Entity',
        429 => 'Too Many Requests',
        500 => 'Internal Server Error',
    ];

    if (isset($known[$statusCode])) {
        $protocol = isset($_SERVER['SERVER_PROTOCOL']) && is_string($_SERVER['SERVER_PROTOCOL'])
            ? $_SERVER['SERVER_PROTOCOL']
            : 'HTTP/1.1';
        header($protocol . ' ' . $statusCode . ' ' . $known[$statusCode], true, $statusCode);
        return;
    }

    http_response_code($statusCode);
}

final class HttpException extends RuntimeException
{
    private int $statusCode;

    public function __construct(string $message, int $statusCode)
    {
        parent::__construct($message);
        $this->statusCode = $statusCode;
    }

    public function getStatusCode(): int
    {
        return $this->statusCode;
    }
}
