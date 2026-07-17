<?php

declare(strict_types=1);

require_once __DIR__ . '/../config/db.php';

final class UserController
{
    private const OTP_TTL_MINUTES = 10;
    private const OTP_MAX_ATTEMPTS = 5;
    private const OTP_PURPOSE_SIGNUP_EMAIL = 'signup_email';
    private const BANNED_LOGIN_MESSAGE = "gh0\$t banned you for inappropriate activities in your account.";
    private const LOGIN_MAX_FAILURES = 5;
    private const LOGIN_LOCK_WINDOW_SECONDS = 900;

    public function index(): void
    {
        if (!$this->requireAdmin()) {
            return;
        }
        try {
            $pdo = db();
            $stmt = $pdo->query('SELECT id, username, name, email, phone, role, is_active, created_at, updated_at FROM users ORDER BY id DESC');

            $this->jsonResponse([
                'success' => true,
                'data' => $stmt->fetchAll(),
            ]);
        } catch (Throwable $e) {
            $this->jsonResponse([
                'success' => false,
                'message' => 'Failed to fetch users.',
            ], 500);
        }
    }

    public function show(int $id): void
    {
        if (!$this->requireAdmin()) {
            return;
        }
        try {
            $pdo = db();
            $stmt = $pdo->prepare('SELECT id, username, name, email, phone, role, is_active, created_at, updated_at FROM users WHERE id = :id LIMIT 1');
            $stmt->execute(['id' => $id]);
            $row = $stmt->fetch();

            if (!$row) {
                $this->jsonResponse([
                    'success' => false,
                    'message' => 'User not found.',
                ], 404);
                return;
            }

            $this->jsonResponse([
                'success' => true,
                'data' => $row,
            ]);
        } catch (Throwable $e) {
            $this->jsonResponse([
                'success' => false,
                'message' => 'Failed to fetch user.',
            ], 500);
        }
    }

    public function register(array $payload): void
    {
        $usernameInput = trim((string)($payload['username'] ?? ''));
        $name = trim((string)($payload['name'] ?? ''));
        $email = strtolower(trim((string)($payload['email'] ?? '')));
        $phone = isset($payload['phone']) ? trim((string)$payload['phone']) : null;
        $password = (string)($payload['password'] ?? '');
        $role = 'user';
        $isActive = 1;

        if ($name === '' || $email === '' || $password === '') {
            $this->jsonResponse([
                'success' => false,
                'message' => 'Name, email and password are required.',
            ], 422);
            return;
        }

        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $this->jsonResponse([
                'success' => false,
                'message' => 'Invalid email format.',
            ], 422);
            return;
        }

        if (strlen($password) < 6) {
            $this->jsonResponse([
                'success' => false,
                'message' => 'Password must be at least 6 characters.',
            ], 422);
            return;
        }

        try {
            $pdo = db();
            $username = $this->generateUniqueUsername($pdo, $usernameInput !== '' ? $usernameInput : $email);

            $exists = $pdo->prepare('SELECT id FROM users WHERE email = :email LIMIT 1');
            $exists->execute(['email' => $email]);
            if ($exists->fetch()) {
                $this->jsonResponse([
                    'success' => false,
                    'message' => 'Email already exists.',
                ], 409);
                return;
            }

            $hash = password_hash($password, PASSWORD_DEFAULT);

            $stmt = $pdo->prepare(
                'INSERT INTO users (username, name, email, phone, password_hash, role, is_active, created_at, updated_at)
                 VALUES (:username, :name, :email, :phone, :password_hash, :role, :is_active, NOW(), NOW())'
            );

            $stmt->execute([
                'username' => $username,
                'name' => $name,
                'email' => $email,
                'phone' => $phone,
                'password_hash' => $hash,
                'role' => $role,
                'is_active' => $isActive,
            ]);

            $userId = (int)$pdo->lastInsertId();
            $this->logRegistrationEvent($pdo, $userId, $username, $email, $role, 'register');
            $this->jsonResponse([
                'success' => true,
                'message' => 'User registered successfully.',
                'data' => [
                    'id' => $userId,
                    'username' => $username,
                    'name' => $name,
                    'email' => $email,
                    'phone' => $phone,
                    'role' => $role,
                    'is_active' => $isActive,
                ],
            ], 201);
        } catch (Throwable $e) {
            $this->jsonResponse([
                'success' => false,
                'message' => 'Failed to register user.',
            ], 500);
        }
    }

    public function login(array $payload): void
    {
        $identifier = trim((string)($payload['email'] ?? $payload['username'] ?? $payload['login'] ?? ''));
        $email = strtolower($identifier);
        $password = (string)($payload['password'] ?? '');
        $loginLock = $this->loginLockState($identifier);

        if ($identifier === '' || $password === '') {
            $this->jsonResponse([
                'success' => false,
                'message' => 'Username/email and password are required.',
            ], 422);
            return;
        }

        if ($loginLock['locked']) {
            $remaining = max(1, (int)ceil(((int)$loginLock['locked_until'] - time()) / 60));
            $this->jsonResponse([
                'success' => false,
                'message' => 'Too many failed login attempts. Try again in ' . $remaining . ' minute(s).',
            ], 429);
            return;
        }

        try {
            $pdo = db();
            $stmt = $pdo->prepare(
                'SELECT id, username, name, email, phone, password_hash, role, is_active
                 FROM users
                 WHERE email = :email OR username = :username
                 LIMIT 1'
            );
            $stmt->execute([
                'email' => $email,
                'username' => $identifier,
            ]);
            $user = $stmt->fetch();

            if (!$user || empty($user['password_hash']) || !password_verify($password, (string)$user['password_hash'])) {
                $this->recordLoginFailure($identifier);
                $this->logLoginEvent($pdo, null, $identifier, null, 'password', false, 'invalid_credentials');
                $this->jsonResponse([
                    'success' => false,
                    'message' => 'Invalid username/email or password.',
                ], 401);
                return;
            }

            if ((int)($user['is_active'] ?? 1) !== 1) {
                $this->recordLoginFailure($identifier);
                $this->logLoginEvent($pdo, (int)$user['id'], $identifier, (string)$user['role'], 'password', false, 'inactive_account');
                $this->jsonResponse([
                    'success' => false,
                    'message' => self::BANNED_LOGIN_MESSAGE,
                ], 403);
                return;
            }

            $this->logLoginEvent($pdo, (int)$user['id'], $identifier, (string)$user['role'], 'password', true, null);
            $this->clearLoginFailures($identifier);
            unset($user['password_hash']);
            $this->rotateSessionId();

            $_SESSION['auth_user'] = [
                'id' => (int)$user['id'],
                'username' => (string)($user['username'] ?? ''),
                'name' => (string)($user['name'] ?? 'User'),
                'email' => (string)($user['email'] ?? ''),
                'phone' => (string)($user['phone'] ?? ''),
                'role' => (string)($user['role'] ?? 'user'),
                'is_active' => (int)($user['is_active'] ?? 1),
            ];

            $this->jsonResponse([
                'success' => true,
                'message' => 'Login successful.',
                'data' => $user,
            ]);
        } catch (Throwable $e) {
            $this->jsonResponse([
                'success' => false,
                'message' => 'Failed to login user.',
            ], 500);
        }
    }

    public function me(): void
    {
        $user = $_SESSION['auth_user'] ?? null;
        if (!is_array($user) || empty($user['email'])) {
            $this->jsonResponse([
                'success' => false,
                'message' => 'Not authenticated.',
            ], 401);
            return;
        }

        $this->jsonResponse([
            'success' => true,
            'data' => $user,
        ]);
    }

    public function profileShow(): void
    {
        $auth = $this->requireUser();
        if ($auth === null) {
            return;
        }

        try {
            $pdo = db();
            $stmt = $pdo->prepare(
                'SELECT age, settings_json
                 FROM user_profiles
                 WHERE user_id = :user_id
                 LIMIT 1'
            );
            $stmt->execute(['user_id' => (int)$auth['id']]);
            $row = $stmt->fetch();

            $settings = null;
            if (is_array($row) && !empty($row['settings_json'])) {
                $decoded = json_decode((string)$row['settings_json'], true);
                $settings = is_array($decoded) ? $decoded : null;
            }

            $this->jsonResponse([
                'success' => true,
                'data' => [
                    'id' => (int)$auth['id'],
                    'username' => (string)($auth['username'] ?? ''),
                    'name' => (string)($auth['name'] ?? 'User'),
                    'email' => (string)($auth['email'] ?? ''),
                    'phone' => (string)($auth['phone'] ?? ''),
                    'role' => (string)($auth['role'] ?? 'user'),
                    'age' => is_array($row) && $row['age'] !== null ? (int)$row['age'] : null,
                    'settings' => $settings,
                ],
            ]);
        } catch (Throwable $e) {
            $this->jsonResponse([
                'success' => false,
                'message' => 'Failed to load profile.',
            ], 500);
        }
    }

    public function profileUpdate(array $payload): void
    {
        $auth = $this->requireUser();
        if ($auth === null) {
            return;
        }

        $name = array_key_exists('name', $payload) ? trim((string)$payload['name']) : '';
        $email = array_key_exists('email', $payload) ? strtolower(trim((string)$payload['email'])) : '';
        $phone = array_key_exists('phone', $payload) ? trim((string)$payload['phone']) : '';
        $age = array_key_exists('age', $payload) ? (int)$payload['age'] : null;
        $settings = array_key_exists('settings', $payload) ? $payload['settings'] : null;

        if ($name === '' || $email === '') {
            $this->jsonResponse([
                'success' => false,
                'message' => 'Name and email are required.',
            ], 422);
            return;
        }
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $this->jsonResponse([
                'success' => false,
                'message' => 'Invalid email format.',
            ], 422);
            return;
        }
        if ($age !== null && ($age < 13 || $age > 100)) {
            $this->jsonResponse([
                'success' => false,
                'message' => 'Age should be between 13 and 100.',
            ], 422);
            return;
        }

        if ($settings !== null && !is_array($settings)) {
            $this->jsonResponse([
                'success' => false,
                'message' => 'Invalid settings payload.',
            ], 422);
            return;
        }

        $settingsJson = $settings !== null ? json_encode($settings, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) : null;

        try {
            $pdo = db();
            $pdo->beginTransaction();

            // Update main user fields in users table
            $stmt = $pdo->prepare(
                'UPDATE users
                 SET name = :name, email = :email, phone = :phone, updated_at = NOW()
                 WHERE id = :id
                 LIMIT 1'
            );
            $stmt->execute([
                'name' => $name,
                'email' => $email,
                'phone' => $phone === '' ? null : $phone,
                'id' => (int)$auth['id'],
            ]);

            // Upsert into user_profiles
            $stmt2 = $pdo->prepare(
                'INSERT INTO user_profiles (user_id, age, settings_json, created_at, updated_at)
                 VALUES (:user_id, :age, :settings_json, NOW(), NOW())
                 ON DUPLICATE KEY UPDATE
                   age = VALUES(age),
                   settings_json = VALUES(settings_json),
                   updated_at = NOW()'
            );
            $stmt2->execute([
                'user_id' => (int)$auth['id'],
                'age' => $age,
                'settings_json' => $settingsJson,
            ]);

            $pdo->commit();

            // Update auth session to reflect new profile values
            $_SESSION['auth_user']['name'] = $name;
            $_SESSION['auth_user']['email'] = $email;
            $_SESSION['auth_user']['phone'] = $phone;

            $this->jsonResponse([
                'success' => true,
                'message' => 'Profile updated.',
                'data' => [
                    'id' => (int)$auth['id'],
                    'username' => (string)($auth['username'] ?? ''),
                    'name' => $name,
                    'email' => $email,
                    'phone' => $phone,
                    'role' => (string)($auth['role'] ?? 'user'),
                    'age' => $age,
                    'settings' => $settings,
                ],
            ]);
        } catch (Throwable $e) {
            try { $pdo->rollBack(); } catch (Throwable $e2) { }
            $this->jsonResponse([
                'success' => false,
                'message' => 'Failed to update profile.',
            ], 500);
        }
    }

    public function addressesIndex(): void
    {
        $auth = $this->requireUser();
        if ($auth === null) {
            return;
        }

        try {
            $pdo = db();
            $stmt = $pdo->prepare(
                'SELECT id, label, line, city, zip, is_default
                 FROM user_addresses
                 WHERE user_id = :user_id
                 ORDER BY is_default DESC, id DESC
                 LIMIT 50'
            );
            $stmt->execute(['user_id' => (int)$auth['id']]);
            $rows = $stmt->fetchAll();
            $list = [];
            foreach ($rows as $row) {
                if (!is_array($row)) {
                    continue;
                }
                $list[] = [
                    'id' => (string)$row['id'],
                    'label' => (string)($row['label'] ?? ''),
                    'line' => (string)($row['line'] ?? ''),
                    'city' => (string)($row['city'] ?? ''),
                    'zip' => (string)($row['zip'] ?? ''),
                    'isDefault' => ((int)($row['is_default'] ?? 0)) === 1,
                ];
            }

            $this->jsonResponse([
                'success' => true,
                'data' => $list,
            ]);
        } catch (Throwable $e) {
            $this->jsonResponse([
                'success' => false,
                'message' => 'Failed to load addresses.',
            ], 500);
        }
    }

    public function addressesReplace(array $payload): void
    {
        $auth = $this->requireUser();
        if ($auth === null) {
            return;
        }

        $list = $payload['addresses'] ?? $payload['data'] ?? null;
        if (!is_array($list)) {
            $this->jsonResponse([
                'success' => false,
                'message' => 'Invalid addresses payload.',
            ], 422);
            return;
        }

        if (count($list) > 12) {
            $this->jsonResponse([
                'success' => false,
                'message' => 'Too many addresses (max 12).',
            ], 422);
            return;
        }

        // Normalize and validate
        $normalized = [];
        foreach ($list as $item) {
            if (!is_array($item)) {
                continue;
            }
            $label = trim((string)($item['label'] ?? ''));
            $line = trim((string)($item['line'] ?? ''));
            $city = trim((string)($item['city'] ?? ''));
            $zip = trim((string)($item['zip'] ?? ''));
            $isDefault = !empty($item['isDefault']);

            if ($label === '' || $line === '' || $city === '' || $zip === '') {
                $this->jsonResponse([
                    'success' => false,
                    'message' => 'Address fields are required (label, line, city, zip).',
                ], 422);
                return;
            }

            $normalized[] = [
                'label' => substr($label, 0, 60),
                'line' => substr($line, 0, 255),
                'city' => substr($city, 0, 100),
                'zip' => substr($zip, 0, 20),
                'is_default' => $isDefault ? 1 : 0,
            ];
        }

        if ($normalized === []) {
            // Allow clearing all
            $normalized = [];
        } else {
            // Ensure exactly one default, prefer first marked, otherwise first.
            $defaultIndex = null;
            foreach ($normalized as $i => $addr) {
                if ($addr['is_default'] === 1) {
                    $defaultIndex = $i;
                    break;
                }
            }
            foreach ($normalized as $i => $addr) {
                $normalized[$i]['is_default'] = 0;
            }
            $pick = $defaultIndex !== null ? $defaultIndex : 0;
            $normalized[$pick]['is_default'] = 1;
        }

        $pdo = null;
        try {
            $pdo = db();
            $pdo->beginTransaction();
            $stmt = $pdo->prepare('DELETE FROM user_addresses WHERE user_id = :user_id');
            $stmt->execute(['user_id' => (int)$auth['id']]);

            if ($normalized !== []) {
                $ins = $pdo->prepare(
                    'INSERT INTO user_addresses (user_id, label, line, city, zip, is_default, created_at, updated_at)
                     VALUES (:user_id, :label, :line, :city, :zip, :is_default, NOW(), NOW())'
                );
                foreach ($normalized as $addr) {
                    $ins->execute([
                        'user_id' => (int)$auth['id'],
                        'label' => $addr['label'],
                        'line' => $addr['line'],
                        'city' => $addr['city'],
                        'zip' => $addr['zip'],
                        'is_default' => $addr['is_default'],
                    ]);
                }
            }

            $pdo->commit();

            $this->addressesIndex();
        } catch (Throwable $e) {
            try { if ($pdo) { $pdo->rollBack(); } } catch (Throwable $e2) { }
            $this->jsonResponse([
                'success' => false,
                'message' => 'Failed to save addresses.',
            ], 500);
        }
    }

    public function logout(): void
    {
        $_SESSION = [];
        if (session_status() === PHP_SESSION_ACTIVE) {
            session_regenerate_id(true);
        }
        $this->jsonResponse([
            'success' => true,
            'message' => 'Logged out.',
        ]);
    }

    public function guestStart(): void
    {
        $guestId = bin2hex(random_bytes(6));
        $email = 'guest-' . $guestId . '@foodiehub.local';
        $this->rotateSessionId();

        $_SESSION['auth_user'] = [
            'id' => 0,
            'username' => 'guest',
            'name' => 'Guest User',
            'email' => $email,
            'phone' => '',
            'role' => 'guest',
            'is_active' => 1,
        ];

        try {
            $pdo = db();
            $this->logLoginEvent($pdo, null, $email, 'guest', 'guest', true, null);
        } catch (Throwable $e) {
            // Guest session should not fail due to audit logging.
        }

        $this->jsonResponse([
            'success' => true,
            'message' => 'Guest session started.',
            'data' => $_SESSION['auth_user'],
        ]);
    }

    public function listLoginEvents(array $payload): void
    {
        if (!$this->requireAdmin()) {
            return;
        }
        $limit = isset($payload['limit']) ? (int)$payload['limit'] : 50;
        if ($limit < 1) {
            $limit = 1;
        }
        if ($limit > 200) {
            $limit = 200;
        }

        try {
            $pdo = db();
            $stmt = $pdo->prepare(
                'SELECT
                    e.id,
                    e.user_id,
                    e.identifier,
                    e.role,
                    e.login_method,
                    e.success,
                    e.failure_reason,
                    e.ip_address,
                    e.user_agent,
                    e.created_at,
                    u.username AS user_username,
                    u.name AS user_name
                 FROM auth_login_events e
                 LEFT JOIN users u ON u.id = e.user_id
                 ORDER BY e.id DESC
                 LIMIT :limit'
            );
            $stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
            $stmt->execute();

            $this->jsonResponse([
                'success' => true,
                'data' => $stmt->fetchAll(),
            ]);
        } catch (Throwable $e) {
            $this->jsonResponse([
                'success' => false,
                'message' => 'Failed to fetch login events.',
            ], 500);
        }
    }

    public function listRegistrationEvents(array $payload): void
    {
        if (!$this->requireAdmin()) {
            return;
        }
        $limit = isset($payload['limit']) ? (int)$payload['limit'] : 50;
        if ($limit < 1) {
            $limit = 1;
        }
        if ($limit > 200) {
            $limit = 200;
        }

        try {
            $pdo = db();
            $stmt = $pdo->prepare(
                'SELECT
                    e.id,
                    e.user_id,
                    e.username,
                    e.email,
                    e.role,
                    e.source,
                    e.ip_address,
                    e.user_agent,
                    e.created_at,
                    u.name AS user_name
                 FROM user_registration_events e
                 LEFT JOIN users u ON u.id = e.user_id
                 ORDER BY e.id DESC
                 LIMIT :limit'
            );
            $stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
            $stmt->execute();

            $this->jsonResponse([
                'success' => true,
                'data' => $stmt->fetchAll(),
            ]);
        } catch (Throwable $e) {
            $this->jsonResponse([
                'success' => false,
                'message' => 'Failed to fetch registration events.',
            ], 500);
        }
    }

    public function clearAuditEvents(array $payload): void
    {
        if (!$this->requireAdmin()) {
            return;
        }
        $scope = strtolower(trim((string)($payload['scope'] ?? 'all')));
        if (!in_array($scope, ['all', 'logins', 'registrations'], true)) {
            $scope = 'all';
        }

        try {
            $pdo = db();
            $deleted = [
                'logins' => 0,
                'registrations' => 0,
            ];

            if ($scope === 'all' || $scope === 'logins') {
                $deleted['logins'] = (int)$pdo->exec('DELETE FROM auth_login_events');
            }

            if ($scope === 'all' || $scope === 'registrations') {
                $deleted['registrations'] = (int)$pdo->exec('DELETE FROM user_registration_events');
            }

            $this->jsonResponse([
                'success' => true,
                'message' => 'Audit reports cleared successfully.',
                'data' => [
                    'scope' => $scope,
                    'deleted' => $deleted,
                ],
            ]);
        } catch (Throwable $e) {
            $this->jsonResponse([
                'success' => false,
                'message' => 'Failed to clear audit reports.',
            ], 500);
        }
    }

    public function googleStart(): void
    {
        $clientId = trim((string)(getenv('GOOGLE_CLIENT_ID') ?: ''));
        $redirectUri = trim((string)(getenv('GOOGLE_REDIRECT_URI') ?: ''));
        $frontendAuthUrl = trim((string)(getenv('FRONTEND_AUTH_URL') ?: 'http://localhost/Food-ordering-site/frontend/Account/form.html'));

        if ($clientId === '' || $redirectUri === '') {
            $this->redirectToFrontendWithError($frontendAuthUrl, 'Google OAuth is not configured.');
            return;
        }

        $state = bin2hex(random_bytes(16));
        $_SESSION['google_oauth_state'] = $state;

        $query = http_build_query([
            'client_id' => $clientId,
            'redirect_uri' => $redirectUri,
            'response_type' => 'code',
            'scope' => 'openid email profile',
            'state' => $state,
            'prompt' => 'select_account',
            'access_type' => 'online',
        ]);

        header('Location: https://accounts.google.com/o/oauth2/v2/auth?' . $query, true, 302);
        exit;
    }

    public function googleCallback(): void
    {
        $frontendAuthUrl = trim((string)(getenv('FRONTEND_AUTH_URL') ?: 'http://localhost/Food-ordering-site/frontend/Account/form.html'));
        $redirectUri = trim((string)(getenv('GOOGLE_REDIRECT_URI') ?: ''));
        $clientId = trim((string)(getenv('GOOGLE_CLIENT_ID') ?: ''));
        $clientSecret = trim((string)(getenv('GOOGLE_CLIENT_SECRET') ?: ''));

        $code = trim((string)($_GET['code'] ?? ''));
        $state = trim((string)($_GET['state'] ?? ''));
        $expectedState = trim((string)($_SESSION['google_oauth_state'] ?? ''));

        if ($code === '' || $state === '' || $expectedState === '' || !hash_equals($expectedState, $state)) {
            $this->redirectToFrontendWithError($frontendAuthUrl, 'Invalid Google OAuth state.');
            return;
        }
        unset($_SESSION['google_oauth_state']);

        if ($clientId === '' || $clientSecret === '' || $redirectUri === '') {
            $this->redirectToFrontendWithError($frontendAuthUrl, 'Google OAuth is not configured.');
            return;
        }

        $token = $this->googleExchangeCodeForToken($code, $clientId, $clientSecret, $redirectUri);
        if (!$token || empty($token['access_token'])) {
            $this->redirectToFrontendWithError($frontendAuthUrl, 'Unable to get Google access token.');
            return;
        }

        $googleUser = $this->googleFetchUser((string)$token['access_token']);
        $email = strtolower(trim((string)($googleUser['email'] ?? '')));
        $name = trim((string)($googleUser['name'] ?? 'Google User'));

        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $this->redirectToFrontendWithError($frontendAuthUrl, 'Google account email not available.');
            return;
        }

        $otp = str_pad((string)random_int(0, 999999), 6, '0', STR_PAD_LEFT);

        try {
            $pdo = db();
            $stmt = $pdo->prepare(
                'INSERT INTO user_email_otps (email, otp_hash, purpose, meta_json, expires_at, attempts, used_at, created_at)
                 VALUES (:email, :otp_hash, :purpose, :meta_json, DATE_ADD(NOW(), INTERVAL 10 MINUTE), 0, NULL, NOW())'
            );
            $stmt->execute([
                'email' => $email,
                'otp_hash' => password_hash($otp, PASSWORD_DEFAULT),
                'purpose' => 'google_login',
                'meta_json' => json_encode(['name' => $name], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            ]);
        } catch (Throwable $e) {
            $this->redirectToFrontendWithError($frontendAuthUrl, 'Unable to create OTP.');
            return;
        }

        $mailSent = $this->sendOtpMail($email, $name, $otp);
        if (!$mailSent && !$this->isLocalMode()) {
            $this->redirectToFrontendWithError($frontendAuthUrl, 'Unable to send OTP email.');
            return;
        }

        $query = http_build_query([
            'mode' => 'google-otp',
            'email' => $email,
            'demo_otp' => $mailSent ? null : $otp,
        ]);
        header('Location: ' . $frontendAuthUrl . '?' . $query, true, 302);
        exit;
    }

    public function googleVerifyOtp(array $payload): void
    {
        $email = strtolower(trim((string)($payload['email'] ?? '')));
        $otp = trim((string)($payload['otp'] ?? ''));

        if (!filter_var($email, FILTER_VALIDATE_EMAIL) || !preg_match('/^\d{6}$/', $otp)) {
            $this->jsonResponse([
                'success' => false,
                'message' => 'Valid email and 6-digit OTP are required.',
            ], 422);
            return;
        }

        try {
            $pdo = db();
            $stmt = $pdo->prepare(
                'SELECT id, email, otp_hash, meta_json, attempts, expires_at, used_at
                 FROM user_email_otps
                 WHERE email = :email AND purpose = :purpose
                 ORDER BY id DESC
                 LIMIT 1'
            );
            $stmt->execute([
                'email' => $email,
                'purpose' => 'google_login',
            ]);
            $row = $stmt->fetch();

            if (!$row) {
                $this->jsonResponse([
                    'success' => false,
                    'message' => 'OTP not found. Please continue with Google again.',
                ], 404);
                return;
            }

            if (!empty($row['used_at'])) {
                $this->jsonResponse([
                    'success' => false,
                    'message' => 'OTP already used. Please continue with Google again.',
                ], 409);
                return;
            }

            if ((int)($row['attempts'] ?? 0) >= self::OTP_MAX_ATTEMPTS) {
                $this->jsonResponse([
                    'success' => false,
                    'message' => 'Too many wrong OTP attempts. Please continue with Google again.',
                ], 429);
                return;
            }

            $expiresAt = strtotime((string)$row['expires_at']);
            if (!$expiresAt || $expiresAt < time()) {
                $this->jsonResponse([
                    'success' => false,
                    'message' => 'OTP expired. Please continue with Google again.',
                ], 410);
                return;
            }

            if (!password_verify($otp, (string)$row['otp_hash'])) {
                $pdo->prepare('UPDATE user_email_otps SET attempts = attempts + 1 WHERE id = :id')->execute(['id' => $row['id']]);
                $this->jsonResponse([
                    'success' => false,
                    'message' => 'Incorrect OTP.',
                ], 401);
                return;
            }

            $meta = json_decode((string)($row['meta_json'] ?? ''), true);
            $name = trim((string)($meta['name'] ?? 'Google User'));
            if ($name === '') {
                $name = 'Google User';
            }

            $existing = $pdo->prepare('SELECT id, username, name, email, phone, role, is_active FROM users WHERE email = :email LIMIT 1');
            $existing->execute(['email' => $email]);
            $user = $existing->fetch();

            if (!$user) {
                $username = $this->generateUniqueUsername($pdo, $email);
                $passwordPlaceholder = bin2hex(random_bytes(16));
                $insert = $pdo->prepare(
                    'INSERT INTO users (username, name, email, phone, password_hash, role, is_active, created_at, updated_at)
                     VALUES (:username, :name, :email, :phone, :password_hash, :role, :is_active, NOW(), NOW())'
                );
                $insert->execute([
                    'username' => $username,
                    'name' => $name,
                    'email' => $email,
                    'phone' => null,
                    'password_hash' => password_hash($passwordPlaceholder, PASSWORD_DEFAULT),
                    'role' => 'user',
                    'is_active' => 1,
                ]);
                $userId = (int)$pdo->lastInsertId();
                $fetch = $pdo->prepare('SELECT id, username, name, email, phone, role, is_active FROM users WHERE id = :id LIMIT 1');
                $fetch->execute(['id' => $userId]);
                $user = $fetch->fetch();
                $this->logRegistrationEvent($pdo, $userId, $username, $email, 'user', 'google_otp');
            }

            if (!$user || (int)($user['is_active'] ?? 0) !== 1) {
                $this->jsonResponse([
                    'success' => false,
                    'message' => self::BANNED_LOGIN_MESSAGE,
                ], 403);
                return;
            }

            $pdo->prepare('UPDATE user_email_otps SET used_at = NOW() WHERE id = :id')->execute(['id' => $row['id']]);
            $this->logLoginEvent($pdo, (int)$user['id'], $email, (string)$user['role'], 'google_otp', true, null);
            $this->rotateSessionId();

            $_SESSION['auth_user'] = [
                'id' => (int)$user['id'],
                'username' => (string)($user['username'] ?? ''),
                'name' => (string)($user['name'] ?? 'User'),
                'email' => (string)($user['email'] ?? $email),
                'phone' => (string)($user['phone'] ?? ''),
                'role' => (string)($user['role'] ?? 'user'),
                'is_active' => (int)($user['is_active'] ?? 1),
            ];

            $this->jsonResponse([
                'success' => true,
                'message' => 'Google OTP verified. Login successful.',
                'data' => [
                    'id' => (int)$user['id'],
                    'username' => (string)($user['username'] ?? ''),
                    'name' => (string)$user['name'],
                    'email' => (string)$user['email'],
                    'phone' => (string)($user['phone'] ?? ''),
                    'role' => (string)$user['role'],
                ],
            ]);
        } catch (Throwable $e) {
            $this->jsonResponse([
                'success' => false,
                'message' => 'Failed to verify OTP.',
            ], 500);
        }
    }

    public function signupSendOtp(array $payload): void
    {
        $name = trim((string)($payload['name'] ?? ''));
        $age = (int)($payload['age'] ?? 0);
        $email = strtolower(trim((string)($payload['email'] ?? '')));
        $phoneRaw = trim((string)($payload['phone'] ?? ''));
        $phoneDigits = $this->normalizePhoneDigits($phoneRaw);

        if ($name === '' || $age < 13 || $age > 100 || !filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($phoneDigits) < 10 || strlen($phoneDigits) > 15) {
            $this->jsonResponse([
                'success' => false,
                'message' => 'Name, age, valid email, and valid phone are required.',
            ], 422);
            return;
        }

        try {
            $pdo = db();

            $existsByEmail = $pdo->prepare('SELECT id FROM users WHERE email = :email LIMIT 1');
            $existsByEmail->execute(['email' => $email]);
            if ($existsByEmail->fetch()) {
                $this->jsonResponse([
                    'success' => false,
                    'message' => 'Email already exists. Please login.',
                ], 409);
                return;
            }

            if ($this->phoneExists($pdo, $phoneDigits)) {
                $this->jsonResponse([
                    'success' => false,
                    'message' => 'Phone number already registered.',
                ], 409);
                return;
            }

            $otp = str_pad((string)random_int(0, 999999), 6, '0', STR_PAD_LEFT);
            $meta = [
                'name' => $name,
                'age' => $age,
                'phone_digits' => $phoneDigits,
            ];

            $pdo->prepare(
                'UPDATE user_email_otps
                 SET used_at = NOW()
                 WHERE email = :email AND purpose = :purpose AND used_at IS NULL'
            )->execute([
                'email' => $email,
                'purpose' => self::OTP_PURPOSE_SIGNUP_EMAIL,
            ]);

            $insert = $pdo->prepare(
                'INSERT INTO user_email_otps (email, otp_hash, purpose, meta_json, expires_at, attempts, used_at, created_at)
                 VALUES (:email, :otp_hash, :purpose, :meta_json, DATE_ADD(NOW(), INTERVAL 10 MINUTE), 0, NULL, NOW())'
            );
            $insert->execute([
                'email' => $email,
                'otp_hash' => password_hash($otp, PASSWORD_DEFAULT),
                'purpose' => self::OTP_PURPOSE_SIGNUP_EMAIL,
                'meta_json' => json_encode($meta, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            ]);

            $mailSent = $this->sendSignupOtpMail($email, $name, $otp);
            if (!$mailSent && !$this->isLocalMode()) {
                $this->jsonResponse([
                    'success' => false,
                    'message' => 'Unable to send OTP email. Please try again later.',
                ], 503);
                return;
            }

            $this->jsonResponse([
                'success' => true,
                'message' => $mailSent
                    ? 'OTP sent to your email address.'
                    : 'Email delivery is unavailable in local mode. Use the demo OTP shown on screen.',
                'data' => [
                    'masked_phone' => $this->maskPhone($phoneDigits),
                    'masked_email' => $this->maskEmail($email),
                    'expires_in_minutes' => self::OTP_TTL_MINUTES,
                    'demo_otp' => $mailSent ? null : $otp,
                ],
            ]);
        } catch (Throwable $e) {
            $this->jsonResponse([
                'success' => false,
                'message' => 'Failed to send signup OTP.',
            ], 500);
        }
    }

    public function signupVerifyOtp(array $payload): void
    {
        $email = strtolower(trim((string)($payload['email'] ?? '')));
        $phoneDigits = $this->normalizePhoneDigits((string)($payload['phone'] ?? ''));
        $otp = trim((string)($payload['otp'] ?? ''));

        if (!filter_var($email, FILTER_VALIDATE_EMAIL) || !preg_match('/^\d{6}$/', $otp) || strlen($phoneDigits) < 10 || strlen($phoneDigits) > 15) {
            $this->jsonResponse([
                'success' => false,
                'message' => 'Valid email, phone number and 6-digit OTP are required.',
            ], 422);
            return;
        }

        try {
            $pdo = db();
            $stmt = $pdo->prepare(
                'SELECT id, email, otp_hash, meta_json, attempts, expires_at, used_at
                 FROM user_email_otps
                 WHERE email = :email AND purpose = :purpose
                 ORDER BY id DESC
                 LIMIT 1'
            );
            $stmt->execute([
                'email' => $email,
                'purpose' => self::OTP_PURPOSE_SIGNUP_EMAIL,
            ]);
            $row = $stmt->fetch();

            if (!$row) {
                $this->jsonResponse([
                    'success' => false,
                    'message' => 'OTP not found. Please request OTP again.',
                ], 404);
                return;
            }

            if (!empty($row['used_at'])) {
                $this->jsonResponse([
                    'success' => false,
                    'message' => 'OTP already used. Please request OTP again.',
                ], 409);
                return;
            }

            if ((int)($row['attempts'] ?? 0) >= self::OTP_MAX_ATTEMPTS) {
                $this->jsonResponse([
                    'success' => false,
                    'message' => 'Too many wrong OTP attempts. Please request OTP again.',
                ], 429);
                return;
            }

            $expiresAt = strtotime((string)$row['expires_at']);
            if (!$expiresAt || $expiresAt < time()) {
                $this->jsonResponse([
                    'success' => false,
                    'message' => 'OTP expired. Please request OTP again.',
                ], 410);
                return;
            }

            if (!password_verify($otp, (string)$row['otp_hash'])) {
                $pdo->prepare('UPDATE user_email_otps SET attempts = attempts + 1 WHERE id = :id')->execute(['id' => $row['id']]);
                $this->jsonResponse([
                    'success' => false,
                    'message' => 'Incorrect OTP.',
                ], 401);
                return;
            }

            $meta = json_decode((string)($row['meta_json'] ?? ''), true);
            $name = trim((string)($meta['name'] ?? 'User'));
            $age = (int)($meta['age'] ?? 18);
            $otpPhoneDigits = $this->normalizePhoneDigits((string)($meta['phone_digits'] ?? ''));
            if ($otpPhoneDigits === '' || $otpPhoneDigits !== $phoneDigits) {
                $this->jsonResponse([
                    'success' => false,
                    'message' => 'Phone number does not match OTP request.',
                ], 422);
                return;
            }

            $existsByEmail = $pdo->prepare('SELECT id FROM users WHERE email = :email LIMIT 1');
            $existsByEmail->execute(['email' => $email]);
            if ($existsByEmail->fetch()) {
                $pdo->prepare('UPDATE user_email_otps SET used_at = NOW() WHERE id = :id')->execute(['id' => $row['id']]);
                $this->jsonResponse([
                    'success' => false,
                    'message' => 'Account already exists for this email. Please login.',
                ], 409);
                return;
            }

            if ($this->phoneExists($pdo, $phoneDigits)) {
                $pdo->prepare('UPDATE user_email_otps SET used_at = NOW() WHERE id = :id')->execute(['id' => $row['id']]);
                $this->jsonResponse([
                    'success' => false,
                    'message' => 'Phone number already registered. Please login.',
                ], 409);
                return;
            }

            if ($name === '') {
                $name = 'User';
            }
            if ($age < 13 || $age > 100) {
                $age = 18;
            }

            $username = $this->generateUniqueUsername($pdo, $email);
            $passwordPlaceholder = bin2hex(random_bytes(16));
            $insert = $pdo->prepare(
                'INSERT INTO users (username, name, email, phone, password_hash, role, is_active, created_at, updated_at)
                 VALUES (:username, :name, :email, :phone, :password_hash, :role, :is_active, NOW(), NOW())'
            );
            $insert->execute([
                'username' => $username,
                'name' => $name,
                'email' => $email,
                'phone' => $phoneDigits,
                'password_hash' => password_hash($passwordPlaceholder, PASSWORD_DEFAULT),
                'role' => 'user',
                'is_active' => 1,
            ]);

            $userId = (int)$pdo->lastInsertId();
            $fetch = $pdo->prepare('SELECT id, username, name, email, phone, role, is_active FROM users WHERE id = :id LIMIT 1');
            $fetch->execute(['id' => $userId]);
            $user = $fetch->fetch();
            $this->logRegistrationEvent($pdo, $userId, $username, $email, 'user', 'signup_email_otp');

            $pdo->prepare('UPDATE user_email_otps SET used_at = NOW() WHERE id = :id')->execute(['id' => $row['id']]);
            $this->logLoginEvent($pdo, (int)($user['id'] ?? 0), $email, (string)($user['role'] ?? 'user'), 'signup_email_otp', true, null);
            $this->rotateSessionId();

            $_SESSION['auth_user'] = [
                'id' => (int)($user['id'] ?? 0),
                'username' => (string)($user['username'] ?? ''),
                'name' => (string)($user['name'] ?? $name),
                'email' => (string)($user['email'] ?? $email),
                'phone' => (string)($user['phone'] ?? $phoneDigits),
                'role' => (string)($user['role'] ?? 'user'),
                'is_active' => (int)($user['is_active'] ?? 1),
            ];

            $this->jsonResponse([
                'success' => true,
                'message' => 'OTP verified. Account created successfully.',
                'data' => [
                    'id' => (int)($user['id'] ?? 0),
                    'username' => (string)($user['username'] ?? ''),
                    'name' => (string)($user['name'] ?? $name),
                    'email' => (string)($user['email'] ?? $email),
                    'phone' => (string)($user['phone'] ?? $phoneDigits),
                    'role' => (string)($user['role'] ?? 'user'),
                    'age' => $age,
                ],
            ]);
        } catch (Throwable $e) {
            $this->jsonResponse([
                'success' => false,
                'message' => 'Failed to verify signup OTP.',
            ], 500);
        }
    }

    public function update(int $id, array $payload): void
    {
        if (!$this->requireAdmin()) {
            return;
        }
        $authUser = $_SESSION['auth_user'] ?? null;
        $username = isset($payload['username']) ? trim((string)$payload['username']) : null;
        $name = isset($payload['name']) ? trim((string)$payload['name']) : null;
        $email = isset($payload['email']) ? strtolower(trim((string)$payload['email'])) : null;
        $phone = array_key_exists('phone', $payload) ? trim((string)$payload['phone']) : null;
        $role = isset($payload['role']) ? trim((string)$payload['role']) : null;
        $isActive = array_key_exists('is_active', $payload) ? (int)(bool)$payload['is_active'] : null;
        $password = array_key_exists('password', $payload) ? (string)$payload['password'] : null;

        if ($name !== null && $name === '') {
            $this->jsonResponse([
                'success' => false,
                'message' => 'Name cannot be empty.',
            ], 422);
            return;
        }

        if ($username !== null && !$this->isValidUsername($username)) {
            $this->jsonResponse([
                'success' => false,
                'message' => 'Invalid username format.',
            ], 422);
            return;
        }

        if ($email !== null && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $this->jsonResponse([
                'success' => false,
                'message' => 'Invalid email format.',
            ], 422);
            return;
        }

        if ($password !== null && strlen($password) < 6) {
            $this->jsonResponse([
                'success' => false,
                'message' => 'Password must be at least 6 characters.',
            ], 422);
            return;
        }

        $allowedRoles = ['user', 'admin', 'guest'];
        if ($role !== null && !in_array($role, $allowedRoles, true)) {
            $role = 'user';
        }

        if ($isActive === 0 && is_array($authUser) && (int)($authUser['id'] ?? 0) === $id) {
            $this->jsonResponse([
                'success' => false,
                'message' => 'You cannot block your own admin account.',
            ], 422);
            return;
        }

        try {
            $pdo = db();

            $exists = $pdo->prepare('SELECT id, role FROM users WHERE id = :id LIMIT 1');
            $exists->execute(['id' => $id]);
            $targetUser = $exists->fetch();
            if (!$targetUser) {
                $this->jsonResponse([
                    'success' => false,
                    'message' => 'User not found.',
                ], 404);
                return;
            }

            if ($isActive !== null && (string)($targetUser['role'] ?? 'user') === 'admin') {
                $this->jsonResponse([
                    'success' => false,
                    'message' => 'Admin accounts cannot be blocked or unblocked.',
                ], 422);
                return;
            }

            if ($email !== null) {
                $conflict = $pdo->prepare('SELECT id FROM users WHERE email = :email AND id <> :id LIMIT 1');
                $conflict->execute([
                    'email' => $email,
                    'id' => $id,
                ]);
                if ($conflict->fetch()) {
                    $this->jsonResponse([
                        'success' => false,
                        'message' => 'Email already in use.',
                    ], 409);
                    return;
                }
            }

            if ($username !== null) {
                $conflict = $pdo->prepare('SELECT id FROM users WHERE username = :username AND id <> :id LIMIT 1');
                $conflict->execute([
                    'username' => $username,
                    'id' => $id,
                ]);
                if ($conflict->fetch()) {
                    $this->jsonResponse([
                        'success' => false,
                        'message' => 'Username already in use.',
                    ], 409);
                    return;
                }
            }

            $fields = [];
            $params = ['id' => $id];

            if ($name !== null) {
                $fields[] = 'name = :name';
                $params['name'] = $name;
            }
            if ($username !== null) {
                $fields[] = 'username = :username';
                $params['username'] = $username;
            }
            if ($email !== null) {
                $fields[] = 'email = :email';
                $params['email'] = $email;
            }
            if (array_key_exists('phone', $payload)) {
                $fields[] = 'phone = :phone';
                $params['phone'] = $phone;
            }
            if ($role !== null) {
                $fields[] = 'role = :role';
                $params['role'] = $role;
            }
            if ($isActive !== null) {
                $fields[] = 'is_active = :is_active';
                $params['is_active'] = $isActive;
            }
            if ($password !== null) {
                $fields[] = 'password_hash = :password_hash';
                $params['password_hash'] = password_hash($password, PASSWORD_DEFAULT);
            }

            if ($fields === []) {
                $this->jsonResponse([
                    'success' => false,
                    'message' => 'No updatable fields provided.',
                ], 422);
                return;
            }

            $fields[] = 'updated_at = NOW()';

            $stmt = $pdo->prepare('UPDATE users SET ' . implode(', ', $fields) . ' WHERE id = :id');
            $stmt->execute($params);

            $this->show($id);
        } catch (Throwable $e) {
            $this->jsonResponse([
                'success' => false,
                'message' => 'Failed to update user.',
            ], 500);
        }
    }

    public function destroy(int $id): void
    {
        if (!$this->requireAdmin()) {
            return;
        }
        try {
            $pdo = db();
            $stmt = $pdo->prepare('DELETE FROM users WHERE id = :id');
            $stmt->execute(['id' => $id]);

            if ($stmt->rowCount() === 0) {
                $this->jsonResponse([
                    'success' => false,
                    'message' => 'User not found.',
                ], 404);
                return;
            }

            $this->jsonResponse([
                'success' => true,
                'message' => 'User deleted successfully.',
            ]);
        } catch (Throwable $e) {
            $this->jsonResponse([
                'success' => false,
                'message' => 'Failed to delete user.',
            ], 500);
        }
    }

    private function jsonResponse(array $data, int $statusCode = 200): void
    {
        http_response_code($statusCode);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }

    private function rotateSessionId(): void
    {
        if (session_status() === PHP_SESSION_ACTIVE) {
            session_regenerate_id(true);
        }
    }

    private function requireAdmin(): bool
    {
        $user = $_SESSION['auth_user'] ?? null;
        if (!is_array($user) || (($user['role'] ?? '') !== 'admin')) {
            $this->jsonResponse([
                'success' => false,
                'message' => 'Admin access required.',
            ], 403);
            return false;
        }
        return true;
    }

    private function requireUser(): ?array
    {
        $user = $_SESSION['auth_user'] ?? null;
        if (!is_array($user) || empty($user['email'])) {
            $this->jsonResponse([
                'success' => false,
                'message' => 'Not authenticated.',
            ], 401);
            return null;
        }
        if ((string)($user['role'] ?? '') === 'guest' || (int)($user['id'] ?? 0) <= 0) {
            $this->jsonResponse([
                'success' => false,
                'message' => 'User login required.',
            ], 403);
            return null;
        }
        return $user;
    }

    private function redirectToFrontendWithError(string $frontendAuthUrl, string $message): void
    {
        $url = $frontendAuthUrl . '?' . http_build_query([
            'mode' => 'signup',
            'oauth_error' => $message,
        ]);
        header('Location: ' . $url, true, 302);
        exit;
    }

    private function googleExchangeCodeForToken(string $code, string $clientId, string $clientSecret, string $redirectUri): ?array
    {
        $response = $this->httpPostForm('https://oauth2.googleapis.com/token', [
            'code' => $code,
            'client_id' => $clientId,
            'client_secret' => $clientSecret,
            'redirect_uri' => $redirectUri,
            'grant_type' => 'authorization_code',
        ]);

        if (!is_array($response)) {
            return null;
        }

        return $response;
    }

    private function googleFetchUser(string $accessToken): ?array
    {
        $url = 'https://www.googleapis.com/oauth2/v2/userinfo?access_token=' . urlencode($accessToken);
        $response = $this->httpGetJson($url);

        return is_array($response) ? $response : null;
    }

    private function httpPostForm(string $url, array $fields): ?array
    {
        $body = http_build_query($fields);
        $headers = ['Content-Type: application/x-www-form-urlencoded'];

        return $this->httpRequestJson($url, 'POST', $headers, $body);
    }

    private function httpGetJson(string $url): ?array
    {
        return $this->httpRequestJson($url, 'GET', [], null);
    }

    private function httpRequestJson(string $url, string $method, array $headers, ?string $body): ?array
    {
        if (function_exists('curl_init')) {
            $ch = curl_init($url);
            if (!$ch) {
                return null;
            }

            curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($ch, CURLOPT_TIMEOUT, 20);
            curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
            if ($headers !== []) {
                curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
            }
            if ($body !== null) {
                curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
            }

            $raw = curl_exec($ch);
            $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);

            if (!is_string($raw) || $code < 200 || $code >= 300) {
                return null;
            }

            $decoded = json_decode($raw, true);
            return is_array($decoded) ? $decoded : null;
        }

        $context = stream_context_create([
            'http' => [
                'method' => $method,
                'header' => implode("\r\n", $headers),
                'content' => $body ?? '',
                'timeout' => 20,
            ],
        ]);

        $raw = @file_get_contents($url, false, $context);
        if (!is_string($raw)) {
            return null;
        }

        $decoded = json_decode($raw, true);
        return is_array($decoded) ? $decoded : null;
    }

    private function isValidUsername(string $username): bool
    {
        $u = trim($username);
        if ($u === '' || strlen($u) < 3 || strlen($u) > 60) {
            return false;
        }
        return preg_match('/^[a-zA-Z0-9._$-]+$/', $u) === 1;
    }

    private function normalizeUsernameBase(string $value): string
    {
        $base = strtolower(trim($value));
        if (str_contains($base, '@')) {
            $base = explode('@', $base, 2)[0];
        }
        $base = preg_replace('/[^a-z0-9._$-]+/', '.', $base) ?: '';
        $base = trim($base, '._-$');
        if ($base === '' || strlen($base) < 3) {
            $base = 'user';
        }
        if (strlen($base) > 50) {
            $base = substr($base, 0, 50);
        }
        return $base;
    }

    private function generateUniqueUsername(PDO $pdo, string $preferred): string
    {
        $base = $this->normalizeUsernameBase($preferred);
        $candidate = $base;
        $suffix = 0;

        while ($this->usernameExists($pdo, $candidate)) {
            $suffix++;
            $candidate = substr($base, 0, max(1, 50 - strlen((string)$suffix) - 1)) . '-' . $suffix;
            if ($suffix > 9999) {
                $candidate = 'user-' . bin2hex(random_bytes(4));
                break;
            }
        }

        return $candidate;
    }

    private function usernameExists(PDO $pdo, string $username): bool
    {
        $stmt = $pdo->prepare('SELECT id FROM users WHERE username = :username LIMIT 1');
        $stmt->execute(['username' => $username]);
        return (bool)$stmt->fetch();
    }

    private function clientIp(): ?string
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

        return null;
    }

    private function loginLockState(string $identifier): array
    {
        $path = $this->loginAttemptPath($identifier);
        if (!is_file($path)) {
            return ['locked' => false, 'locked_until' => 0, 'failures' => 0];
        }

        $raw = (string)@file_get_contents($path);
        $data = json_decode($raw, true);
        if (!is_array($data)) {
            return ['locked' => false, 'locked_until' => 0, 'failures' => 0];
        }

        $now = time();
        $firstFailureAt = (int)($data['first_failure_at'] ?? 0);
        if ($firstFailureAt <= 0 || ($firstFailureAt + self::LOGIN_LOCK_WINDOW_SECONDS) < $now) {
            @unlink($path);
            return ['locked' => false, 'locked_until' => 0, 'failures' => 0];
        }

        $lockedUntil = (int)($data['locked_until'] ?? 0);
        if ($lockedUntil > $now) {
            return ['locked' => true, 'locked_until' => $lockedUntil, 'failures' => (int)($data['failures'] ?? 0)];
        }

        return ['locked' => false, 'locked_until' => 0, 'failures' => (int)($data['failures'] ?? 0)];
    }

    private function recordLoginFailure(string $identifier): void
    {
        $path = $this->loginAttemptPath($identifier);
        $now = time();
        $state = [
            'failures' => 0,
            'first_failure_at' => $now,
            'locked_until' => 0,
        ];

        if (is_file($path)) {
            $raw = (string)@file_get_contents($path);
            $decoded = json_decode($raw, true);
            if (is_array($decoded)) {
                $state = array_merge($state, $decoded);
            }
        }

        if (((int)$state['first_failure_at']) <= 0 || (((int)$state['first_failure_at']) + self::LOGIN_LOCK_WINDOW_SECONDS) < $now) {
            $state['failures'] = 0;
            $state['first_failure_at'] = $now;
            $state['locked_until'] = 0;
        }

        $state['failures'] = (int)$state['failures'] + 1;
        if ((int)$state['failures'] >= self::LOGIN_MAX_FAILURES) {
            $state['locked_until'] = $now + self::LOGIN_LOCK_WINDOW_SECONDS;
        }

        $dir = dirname($path);
        if (!is_dir($dir)) {
            @mkdir($dir, 0700, true);
        }
        @file_put_contents($path, json_encode($state, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), LOCK_EX);
    }

    private function clearLoginFailures(string $identifier): void
    {
        $path = $this->loginAttemptPath($identifier);
        if (is_file($path)) {
            @unlink($path);
        }
    }

    private function loginAttemptPath(string $identifier): string
    {
        $ip = $this->clientIp() ?? 'unknown';
        $key = strtolower(trim($identifier)) . '|' . $ip;
        $dir = rtrim(sys_get_temp_dir(), '\\/') . DIRECTORY_SEPARATOR . 'foodiehub_login_locks';
        return $dir . DIRECTORY_SEPARATOR . hash('sha256', $key) . '.json';
    }

    private function userAgent(): ?string
    {
        $ua = trim((string)($_SERVER['HTTP_USER_AGENT'] ?? ''));
        if ($ua === '') {
            return null;
        }

        return substr($ua, 0, 255);
    }

    private function logLoginEvent(
        PDO $pdo,
        ?int $userId,
        string $identifier,
        ?string $role,
        string $loginMethod,
        bool $success,
        ?string $failureReason
    ): void {
        try {
            $stmt = $pdo->prepare(
                'INSERT INTO auth_login_events
                 (user_id, identifier, role, login_method, success, failure_reason, ip_address, user_agent, created_at)
                 VALUES (:user_id, :identifier, :role, :login_method, :success, :failure_reason, :ip_address, :user_agent, NOW())'
            );
            $stmt->execute([
                'user_id' => $userId,
                'identifier' => substr(trim($identifier), 0, 190),
                'role' => $role !== null ? substr(trim($role), 0, 20) : null,
                'login_method' => substr(trim($loginMethod), 0, 30),
                'success' => $success ? 1 : 0,
                'failure_reason' => $failureReason !== null ? substr(trim($failureReason), 0, 190) : null,
                'ip_address' => $this->clientIp(),
                'user_agent' => $this->userAgent(),
            ]);
        } catch (Throwable $e) {
            // Auth flow should never fail because of audit logging.
        }
    }

    private function logRegistrationEvent(
        PDO $pdo,
        int $userId,
        string $username,
        string $email,
        string $role,
        string $source
    ): void {
        try {
            $stmt = $pdo->prepare(
                'INSERT INTO user_registration_events
                 (user_id, username, email, role, source, ip_address, user_agent, created_at)
                 VALUES (:user_id, :username, :email, :role, :source, :ip_address, :user_agent, NOW())'
            );
            $stmt->execute([
                'user_id' => $userId,
                'username' => substr(trim($username), 0, 60),
                'email' => substr(strtolower(trim($email)), 0, 190),
                'role' => substr(trim($role), 0, 20),
                'source' => substr(trim($source), 0, 30),
                'ip_address' => $this->clientIp(),
                'user_agent' => $this->userAgent(),
            ]);
        } catch (Throwable $e) {
            // Registration flow should never fail because of audit logging.
        }
    }

    private function normalizePhoneDigits(string $phone): string
    {
        return preg_replace('/\D+/', '', trim($phone)) ?: '';
    }

    private function maskPhone(string $phoneDigits): string
    {
        $digits = $this->normalizePhoneDigits($phoneDigits);
        if (strlen($digits) <= 4) {
            return '+' . str_repeat('*', strlen($digits));
        }
        return '+' . str_repeat('*', strlen($digits) - 4) . substr($digits, -4);
    }

    private function phoneExists(PDO $pdo, string $phoneDigits): bool
    {
        if ($phoneDigits === '') {
            return false;
        }

        $stmt = $pdo->query('SELECT phone FROM users WHERE phone IS NOT NULL AND phone <> ""');
        $rows = $stmt ? $stmt->fetchAll() : [];
        foreach ($rows as $row) {
            if ($this->normalizePhoneDigits((string)($row['phone'] ?? '')) === $phoneDigits) {
                return true;
            }
        }
        return false;
    }

    private function maskEmail(string $email): string
    {
        $email = strtolower(trim($email));
        $parts = explode('@', $email, 2);
        if (count($parts) !== 2) {
            return $email;
        }
        $local = $parts[0];
        $domain = $parts[1];
        if ($local === '') {
            return '*@' . $domain;
        }
        return substr($local, 0, 1) . str_repeat('*', max(strlen($local) - 1, 0)) . '@' . $domain;
    }

    private function sendSignupOtpMail(string $email, string $name, string $otp): bool
    {
        $appName = trim((string)(getenv('APP_NAME') ?: 'FoodieHub'));
        $from = $this->mailFromAddress();
        $subject = $appName . ' Signup OTP Verification';
        $message = "Hello {$name},\n\nYour OTP for {$appName} signup is: {$otp}\n\nThis OTP is valid for " . self::OTP_TTL_MINUTES . " minutes.\n\nIf this was not you, please ignore this email.";
        if ($this->sendMailViaResend($email, $subject, $message)) {
            return true;
        }

        $headers = 'From: ' . $from . "\r\n" .
            'Reply-To: ' . $from . "\r\n" .
            'X-Mailer: PHP/' . phpversion();

        // Avoid leaking PHP mail() warnings into API responses.
        return @mail($email, $subject, $message, $headers);
    }

    private function isLocalMode(): bool
    {
        $appEnv = strtolower(trim((string)(getenv('APP_ENV') ?: '')));
        if ($appEnv === 'local' || $appEnv === 'development' || $appEnv === 'dev') {
            return true;
        }

        return filter_var(getenv('APP_DEBUG') ?: 'false', FILTER_VALIDATE_BOOLEAN);
    }

    private function sendOtpMail(string $email, string $name, string $otp): bool
    {
        $appName = trim((string)(getenv('APP_NAME') ?: 'FoodieHub'));
        $from = $this->mailFromAddress();
        $subject = $appName . ' Google OTP Verification';
        $message = "Hello {$name},\n\nYour OTP for {$appName} login is: {$otp}\n\nThis OTP is valid for " . self::OTP_TTL_MINUTES . " minutes.\n\nIf this was not you, please ignore this email.";
        if ($this->sendMailViaResend($email, $subject, $message)) {
            return true;
        }

        $headers = 'From: ' . $from . "\r\n" .
            'Reply-To: ' . $from . "\r\n" .
            'X-Mailer: PHP/' . phpversion();

        // Avoid leaking PHP mail() warnings into API responses.
        return @mail($email, $subject, $message, $headers);
    }

    private function mailFromAddress(): string
    {
        $from = trim((string)(getenv('MAIL_FROM') ?: ''));
        if ($from !== '' && filter_var($from, FILTER_VALIDATE_EMAIL)) {
            return $from;
        }

        return 'no-reply@foodiehub.local';
    }

    private function resendFromAddress(): string
    {
        $configured = trim((string)(getenv('RESEND_FROM') ?: ''));
        if ($configured !== '' && filter_var($configured, FILTER_VALIDATE_EMAIL)) {
            return $configured;
        }

        // Resend's testing sender is safer than reusing a random MAIL_FROM address
        // that may not be verified with the API key's account.
        return 'onboarding@resend.dev';
    }

    private function sendMailViaResend(string $to, string $subject, string $text): bool
    {
        $apiKey = trim((string)(getenv('RESEND_API_KEY') ?: ''));
        if ($apiKey === '') {
            return false;
        }

        if (!function_exists('curl_init')) {
            return false;
        }

        $payload = json_encode([
            'from' => $this->resendFromAddress(),
            'to' => [$to],
            'subject' => $subject,
            'text' => $text,
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

        if (!is_string($payload) || $payload === '') {
            return false;
        }

        $ch = curl_init('https://api.resend.com/emails');
        if (!$ch) {
            return false;
        }

        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 20);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
        // Some local environments inject a broken proxy like 127.0.0.1:9.
        // Bypass proxy for direct Resend API calls so OTP email can work locally.
        curl_setopt($ch, CURLOPT_PROXY, '');
        curl_setopt($ch, CURLOPT_HTTPHEADER, [
            'Authorization: Bearer ' . $apiKey,
            'Content-Type: application/json',
        ]);

        curl_exec($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        return $code >= 200 && $code < 300;
    }
}
