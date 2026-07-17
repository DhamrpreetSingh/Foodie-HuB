<?php

declare(strict_types=1);

require_once __DIR__ . '/../config/db.php';

final class OrderController
{
    private const RAZORPAY_BASE_URL = 'https://api.razorpay.com/v1';

    public function index(): void
    {
        $user = $this->authUser();
        if (!$user || ($user['role'] ?? '') === 'guest') {
            $this->jsonResponse([
                'success' => false,
                'message' => 'Not authenticated.',
            ], 401);
            return;
        }

        try {
            $pdo = db();
            if (($user['role'] ?? '') === 'admin') {
                $stmt = $pdo->query('SELECT id, user_id, full_name, phone, address, city, zip, payment_method, status, subtotal, delivery_fee, discount, total, notes, items_json, created_at, updated_at FROM orders ORDER BY id DESC');
            } else {
                $stmt = $pdo->prepare('SELECT id, user_id, full_name, phone, address, city, zip, payment_method, status, subtotal, delivery_fee, discount, total, notes, items_json, created_at, updated_at FROM orders WHERE user_id = :user_id ORDER BY id DESC');
                $stmt->execute(['user_id' => (int)($user['id'] ?? 0)]);
            }
            $rows = $stmt->fetchAll();

            $this->jsonResponse([
                'success' => true,
                'data' => array_map([$this, 'mapOrderRow'], $rows),
            ]);
        } catch (Throwable $e) {
            $this->jsonResponse([
                'success' => false,
                'message' => 'Failed to fetch orders.',
            ], 500);
        }
    }

    public function show(int $id): void
    {
        try {
            $user = $this->authUser();
            if (!$user || ($user['role'] ?? '') === 'guest') {
                $this->jsonResponse([
                    'success' => false,
                    'message' => 'Not authenticated.',
                ], 401);
                return;
            }

            $pdo = db();
            $stmt = $pdo->prepare('SELECT id, user_id, full_name, phone, address, city, zip, payment_method, status, subtotal, delivery_fee, discount, total, notes, items_json, created_at, updated_at FROM orders WHERE id = :id LIMIT 1');
            $stmt->execute(['id' => $id]);
            $row = $stmt->fetch();

            if (!$row) {
                $this->jsonResponse([
                    'success' => false,
                    'message' => 'Order not found.',
                ], 404);
                return;
            }

            $isAdmin = (($user['role'] ?? '') === 'admin');
            $isOwner = !$isAdmin && ((int)($row['user_id'] ?? 0) === (int)($user['id'] ?? 0));
            if (!$isAdmin && !$isOwner) {
                $this->jsonResponse([
                    'success' => false,
                    'message' => 'Forbidden.',
                ], 403);
                return;
            }

            $this->jsonResponse([
                'success' => true,
                'data' => $this->mapOrderRow($row),
            ]);
        } catch (Throwable $e) {
            $this->jsonResponse([
                'success' => false,
                'message' => 'Failed to fetch order.',
            ], 500);
        }
    }

    public function store(array $payload): void
    {
        $user = $this->authUser();
        if (!$user || ($user['role'] ?? '') === 'guest') {
            $this->jsonResponse([
                'success' => false,
                'message' => 'Login required to place orders.',
            ], 401);
            return;
        }

        $fullName = trim((string)($payload['full_name'] ?? $payload['fullName'] ?? ''));
        $phone = trim((string)($payload['phone'] ?? ''));
        $address = trim((string)($payload['address'] ?? ''));
        $city = trim((string)($payload['city'] ?? ''));
        $zip = trim((string)($payload['zip'] ?? ''));
        $paymentMethod = $this->normalizePaymentMethod((string)($payload['payment_method'] ?? $payload['payment'] ?? 'Cash on Delivery'));
        $status = 'Placed';
        $notes = isset($payload['notes']) ? trim((string)$payload['notes']) : null;
        $paymentGateway = strtolower(trim((string)($payload['payment_gateway'] ?? $payload['gateway'] ?? '')));

        $userId = (int)($user['id'] ?? 0);

        $deliveryFee = isset($payload['delivery_fee']) ? (float)$payload['delivery_fee'] : 0.0;
        $discount = isset($payload['discount']) ? (float)$payload['discount'] : 0.0;
        if (!is_finite($deliveryFee) || $deliveryFee < 0) {
            $deliveryFee = 0.0;
        }
        if (!is_finite($discount) || $discount < 0) {
            $discount = 0.0;
        }

        $items = $payload['items'] ?? [];
        if (!is_array($items)) {
            $items = [];
        }

        if ($fullName === '' || $phone === '' || $address === '' || $city === '' || $zip === '' || $items === []) {
            $this->jsonResponse([
                'success' => false,
                'message' => 'Valid customer details and items are required.',
            ], 422);
            return;
        }

        try {
            $pdo = db();

            [$normalizedItems, $subtotal] = $this->normalizeAndPriceItems($pdo, $items);
            if ($subtotal <= 0) {
                $this->jsonResponse([
                    'success' => false,
                    'message' => 'Order must contain at least one valid item.',
                ], 422);
                return;
            }

            if ($discount > $subtotal) {
                $discount = $subtotal;
            }
            $total = max(0.0, $subtotal + $deliveryFee - $discount);
            if ($total <= 0) {
                $this->jsonResponse([
                    'success' => false,
                    'message' => 'Order total must be greater than 0.',
                ], 422);
                return;
            }

            if ($this->isOnlinePaymentMethod($paymentMethod)) {
                if ($paymentGateway !== 'razorpay') {
                    $this->jsonResponse([
                        'success' => false,
                        'message' => 'Online payments must be completed through Razorpay.',
                    ], 422);
                    return;
                }

                if (!$this->razorpayConfigured()) {
                    $this->jsonResponse([
                        'success' => false,
                        'message' => 'Razorpay is not configured yet.',
                    ], 503);
                    return;
                }

                $razorpayOrderId = trim((string)($payload['razorpay_order_id'] ?? ''));
                $razorpayPaymentId = trim((string)($payload['razorpay_payment_id'] ?? ''));
                $razorpaySignature = trim((string)($payload['razorpay_signature'] ?? ''));

                if ($razorpayOrderId === '' || $razorpayPaymentId === '' || $razorpaySignature === '') {
                    $this->jsonResponse([
                        'success' => false,
                        'message' => 'Razorpay payment details are required.',
                    ], 422);
                    return;
                }

                if (!$this->verifyRazorpaySignature($razorpayOrderId, $razorpayPaymentId, $razorpaySignature)) {
                    $this->jsonResponse([
                        'success' => false,
                        'message' => 'Razorpay signature verification failed.',
                    ], 422);
                    return;
                }

                $razorpayOrder = $this->fetchRazorpayOrder($razorpayOrderId);
                if (!is_array($razorpayOrder)) {
                    $this->jsonResponse([
                        'success' => false,
                        'message' => 'Unable to verify Razorpay order.',
                    ], 502);
                    return;
                }

                if ((string)($razorpayOrder['id'] ?? '') !== $razorpayOrderId
                    || strtoupper((string)($razorpayOrder['currency'] ?? '')) !== 'INR'
                    || (int)($razorpayOrder['amount'] ?? 0) !== $this->toPaise($total)) {
                    $this->jsonResponse([
                        'success' => false,
                        'message' => 'Razorpay order amount verification failed.',
                    ], 422);
                    return;
                }

                $razorpayPayment = $this->fetchRazorpayPayment($razorpayPaymentId);
                if (!is_array($razorpayPayment)) {
                    $this->jsonResponse([
                        'success' => false,
                        'message' => 'Unable to verify Razorpay payment.',
                    ], 502);
                    return;
                }

                $paymentStatus = strtolower((string)($razorpayPayment['status'] ?? ''));
                if ((string)($razorpayPayment['order_id'] ?? '') !== $razorpayOrderId
                    || (int)($razorpayPayment['amount'] ?? 0) !== $this->toPaise($total)
                    || !in_array($paymentStatus, ['authorized', 'captured'], true)) {
                    $this->jsonResponse([
                        'success' => false,
                        'message' => 'Razorpay payment verification failed.',
                    ], 422);
                    return;
                }
            }

            $stmt = $pdo->prepare(
                'INSERT INTO orders (user_id, full_name, phone, address, city, zip, payment_method, status, subtotal, delivery_fee, discount, total, notes, items_json, created_at, updated_at)
                 VALUES (:user_id, :full_name, :phone, :address, :city, :zip, :payment_method, :status, :subtotal, :delivery_fee, :discount, :total, :notes, :items_json, NOW(), NOW())'
            );

            $stmt->execute([
                'user_id' => $userId,
                'full_name' => $fullName,
                'phone' => $phone,
                'address' => $address,
                'city' => $city,
                'zip' => $zip,
                'payment_method' => $paymentMethod,
                'status' => $status,
                'subtotal' => $subtotal,
                'delivery_fee' => $deliveryFee,
                'discount' => $discount,
                'total' => $total,
                'notes' => $notes,
                'items_json' => json_encode($normalizedItems, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            ]);

            $orderId = (int)$pdo->lastInsertId();
            $this->logOrderEvent($pdo, $orderId, $userId, 'placed', $status, $total);
            $this->show($orderId);
        } catch (Throwable $e) {
            $this->jsonResponse([
                'success' => false,
                'message' => 'Failed to create order.',
            ], 500);
        }
    }

    public function createRazorpayOrder(array $payload): void
    {
        $user = $this->authUser();
        if (!$user || ($user['role'] ?? '') === 'guest') {
            $this->jsonResponse([
                'success' => false,
                'message' => 'Login required to start Razorpay checkout.',
            ], 401);
            return;
        }

        if (!$this->razorpayConfigured()) {
            $this->jsonResponse([
                'success' => false,
                'message' => 'Razorpay is not configured yet. Add the test key ID and secret in backend/.env.local.',
            ], 503);
            return;
        }

        $paymentMethod = $this->normalizePaymentMethod((string)($payload['payment_method'] ?? $payload['payment'] ?? ''));
        if (!$this->isOnlinePaymentMethod($paymentMethod)) {
            $this->jsonResponse([
                'success' => false,
                'message' => 'Razorpay checkout is available only for Card and UPI payments.',
            ], 422);
            return;
        }

        $items = $payload['items'] ?? [];
        $deliveryFee = isset($payload['delivery_fee']) ? (float)$payload['delivery_fee'] : 0.0;
        $discount = isset($payload['discount']) ? (float)$payload['discount'] : 0.0;
        if (!is_array($items) || $items === []) {
            $this->jsonResponse([
                'success' => false,
                'message' => 'Order items are required for Razorpay checkout.',
            ], 422);
            return;
        }
        if (!is_finite($deliveryFee) || $deliveryFee < 0) {
            $deliveryFee = 0.0;
        }
        if (!is_finite($discount) || $discount < 0) {
            $discount = 0.0;
        }

        try {
            $pdo = db();
            [, $subtotal] = $this->normalizeAndPriceItems($pdo, $items);
            if ($subtotal <= 0) {
                $this->jsonResponse([
                    'success' => false,
                    'message' => 'Order must contain at least one valid item.',
                ], 422);
                return;
            }
            if ($discount > $subtotal) {
                $discount = $subtotal;
            }

            $total = max(0.0, $subtotal + $deliveryFee - $discount);
            if ($total <= 0) {
                $this->jsonResponse([
                    'success' => false,
                    'message' => 'Order total must be greater than 0.',
                ], 422);
                return;
            }

            $receipt = $this->buildRazorpayReceipt((int)($user['id'] ?? 0));
            $razorpayOrder = $this->razorpayRequest('POST', '/orders', [
                'amount' => $this->toPaise($total),
                'currency' => 'INR',
                'receipt' => $receipt,
                'notes' => [
                    'app' => 'FoodieHub',
                    'payment_method' => $paymentMethod,
                    'user_id' => (string)((int)($user['id'] ?? 0)),
                ],
            ]);

            if (!is_array($razorpayOrder) || empty($razorpayOrder['id'])) {
                $this->jsonResponse([
                    'success' => false,
                    'message' => 'Unable to create Razorpay order.',
                ], 502);
                return;
            }

            $this->jsonResponse([
                'success' => true,
                'data' => [
                    'key_id' => $this->razorpayKeyId(),
                    'order_id' => (string)$razorpayOrder['id'],
                    'amount' => (int)($razorpayOrder['amount'] ?? $this->toPaise($total)),
                    'currency' => (string)($razorpayOrder['currency'] ?? 'INR'),
                    'receipt' => (string)($razorpayOrder['receipt'] ?? $receipt),
                    'name' => 'FoodieHub',
                    'description' => 'Food order payment',
                    'prefill' => [
                        'name' => (string)($user['name'] ?? 'FoodieHub User'),
                        'email' => (string)($user['email'] ?? ''),
                        'contact' => (string)($user['phone'] ?? ''),
                    ],
                ],
            ]);
        } catch (Throwable $e) {
            $this->jsonResponse([
                'success' => false,
                'message' => 'Failed to initialize Razorpay checkout.',
            ], 500);
        }
    }

    public function updateStatus(int $id, string $status): void
    {
        if (!$this->requireAdmin()) {
            return;
        }
        $status = trim($status);
        if ($status === '') {
            $this->jsonResponse([
                'success' => false,
                'message' => 'Status is required.',
            ], 422);
            return;
        }

        try {
            $pdo = db();
            $stmt = $pdo->prepare('UPDATE orders SET status = :status, updated_at = NOW() WHERE id = :id');
            $stmt->execute([
                'id' => $id,
                'status' => $status,
            ]);

            if ($stmt->rowCount() === 0) {
                $this->jsonResponse([
                    'success' => false,
                    'message' => 'Order not found or unchanged.',
                ], 404);
                return;
            }

            $this->logOrderEvent($pdo, $id, null, 'status_updated', $status, null);
            $this->show($id);
        } catch (Throwable $e) {
            $this->jsonResponse([
                'success' => false,
                'message' => 'Failed to update order status.',
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
            $stmt = $pdo->prepare('DELETE FROM orders WHERE id = :id');
            $stmt->execute(['id' => $id]);

            if ($stmt->rowCount() === 0) {
                $this->jsonResponse([
                    'success' => false,
                    'message' => 'Order not found.',
                ], 404);
                return;
            }

            $this->jsonResponse([
                'success' => true,
                'message' => 'Order deleted successfully.',
            ]);
        } catch (Throwable $e) {
            $this->jsonResponse([
                'success' => false,
                'message' => 'Failed to delete order.',
            ], 500);
        }
    }

    private function mapOrderRow(array $row): array
    {
        $items = [];
        if (!empty($row['items_json']) && is_string($row['items_json'])) {
            $decoded = json_decode($row['items_json'], true);
            if (is_array($decoded)) {
                $items = $decoded;
            }
        }

        $row['items'] = $items;
        unset($row['items_json']);

        return $row;
    }

    private function jsonResponse(array $data, int $statusCode = 200): void
    {
        http_response_code($statusCode);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }

    private function authUser(): ?array
    {
        $user = $_SESSION['auth_user'] ?? null;
        return is_array($user) ? $user : null;
    }

    private function requireAdmin(): bool
    {
        $user = $this->authUser();
        if (!$user || (($user['role'] ?? '') !== 'admin')) {
            $this->jsonResponse([
                'success' => false,
                'message' => 'Admin access required.',
            ], 403);
            return false;
        }
        return true;
    }

    private function normalizePaymentMethod(string $paymentMethod): string
    {
        $value = trim($paymentMethod);
        if ($value === 'Cash' || $value === 'Cash on Delivery') {
            return 'Cash on Delivery';
        }
        if ($value === 'UPI') {
            return 'UPI';
        }
        return 'Card';
    }

    private function isOnlinePaymentMethod(string $paymentMethod): bool
    {
        return in_array($paymentMethod, ['Card', 'UPI'], true);
    }

    /**
     * Normalize client items and compute subtotal from menu_items when available.
     * If menu_items has no match for a given line, falls back to the client-provided price.
     *
     * Returns: [items, subtotal]
     */
    private function normalizeAndPriceItems(PDO $pdo, array $items): array
    {
        $clean = [];
        $names = [];

        foreach ($items as $raw) {
            if (!is_array($raw)) {
                continue;
            }
            $name = trim((string)($raw['name'] ?? ''));
            $qty = (int)($raw['quantity'] ?? 1);
            $clientPrice = isset($raw['price']) ? (float)$raw['price'] : 0.0;
            if ($name === '' || $qty < 1 || $qty > 99) {
                continue;
            }
            if (!is_finite($clientPrice) || $clientPrice < 0) {
                $clientPrice = 0.0;
            }

            $names[] = strtolower($name);
            $clean[] = [
                'id' => isset($raw['id']) ? (string)$raw['id'] : '',
                'name' => $name,
                'quantity' => $qty,
                'client_price' => $clientPrice,
                'image' => isset($raw['image']) ? (string)$raw['image'] : '',
                'category' => isset($raw['category']) ? (string)$raw['category'] : '',
            ];
        }

        $priceMap = [];
        $uniqueNames = array_values(array_unique(array_filter($names, static fn($v) => $v !== '')));
        if ($uniqueNames !== []) {
            // Build dynamic IN list for PDO.
            $placeholders = implode(',', array_fill(0, count($uniqueNames), '?'));
            $stmt = $pdo->prepare('SELECT name, price FROM menu_items WHERE LOWER(name) IN (' . $placeholders . ')');
            $stmt->execute($uniqueNames);
            foreach ($stmt->fetchAll() as $row) {
                $key = strtolower((string)($row['name'] ?? ''));
                $priceMap[$key] = (float)($row['price'] ?? 0);
            }
        }

        $subtotal = 0.0;
        $out = [];
        foreach ($clean as $line) {
            $key = strtolower($line['name']);
            $unit = array_key_exists($key, $priceMap) ? (float)$priceMap[$key] : (float)$line['client_price'];
            if (!is_finite($unit) || $unit <= 0) {
                continue;
            }
            $lineTotal = $unit * (int)$line['quantity'];
            $subtotal += $lineTotal;

            $out[] = [
                'id' => (string)$line['id'],
                'name' => (string)$line['name'],
                'price' => $unit,
                'quantity' => (int)$line['quantity'],
                'total' => $lineTotal,
                'price_source' => array_key_exists($key, $priceMap) ? 'menu_items' : 'client',
                'image' => (string)$line['image'],
                'category' => (string)$line['category'],
            ];
        }

        return [$out, $subtotal];
    }

    private function razorpayConfigured(): bool
    {
        return $this->razorpayKeyId() !== '' && $this->razorpayKeySecret() !== '';
    }

    private function razorpayKeyId(): string
    {
        return trim((string)(getenv('RAZORPAY_KEY_ID') ?: ''));
    }

    private function razorpayKeySecret(): string
    {
        return trim((string)(getenv('RAZORPAY_KEY_SECRET') ?: ''));
    }

    private function toPaise(float $amount): int
    {
        return (int)round(max(0, $amount) * 100);
    }

    private function buildRazorpayReceipt(int $userId): string
    {
        $base = 'fh_' . max(0, $userId) . '_' . date('YmdHis');
        try {
            $suffix = bin2hex(random_bytes(3));
        } catch (Throwable $e) {
            $suffix = substr(hash('sha256', uniqid('fh_receipt_', true)), 0, 6);
        }
        return substr($base . '_' . $suffix, 0, 40);
    }

    private function verifyRazorpaySignature(string $orderId, string $paymentId, string $signature): bool
    {
        $secret = $this->razorpayKeySecret();
        if ($secret === '' || $orderId === '' || $paymentId === '' || $signature === '') {
            return false;
        }

        $generated = hash_hmac('sha256', $orderId . '|' . $paymentId, $secret);
        return hash_equals($generated, $signature);
    }

    private function fetchRazorpayOrder(string $orderId): ?array
    {
        return $this->razorpayRequest('GET', '/orders/' . rawurlencode($orderId), null);
    }

    private function fetchRazorpayPayment(string $paymentId): ?array
    {
        return $this->razorpayRequest('GET', '/payments/' . rawurlencode($paymentId), null);
    }

    private function razorpayRequest(string $method, string $path, ?array $payload): ?array
    {
        $keyId = $this->razorpayKeyId();
        $keySecret = $this->razorpayKeySecret();
        if ($keyId === '' || $keySecret === '') {
            return null;
        }

        $url = rtrim(self::RAZORPAY_BASE_URL, '/') . '/' . ltrim($path, '/');
        $headers = ['Accept: application/json'];
        $body = null;

        if ($payload !== null) {
            $body = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            if (!is_string($body)) {
                return null;
            }
            $headers[] = 'Content-Type: application/json';
        }

        if (function_exists('curl_init')) {
            $ch = curl_init($url);
            if (!$ch) {
                return null;
            }

            curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($ch, CURLOPT_TIMEOUT, 25);
            curl_setopt($ch, CURLOPT_CUSTOMREQUEST, strtoupper($method));
            curl_setopt($ch, CURLOPT_USERPWD, $keyId . ':' . $keySecret);
            curl_setopt($ch, CURLOPT_HTTPAUTH, CURLAUTH_BASIC);
            curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
            if ($body !== null) {
                curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
            }

            $raw = curl_exec($ch);
            $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);

            if (!is_string($raw) || $status < 200 || $status >= 300) {
                return null;
            }

            $decoded = json_decode($raw, true);
            return is_array($decoded) ? $decoded : null;
        }

        $context = stream_context_create([
            'http' => [
                'method' => strtoupper($method),
                'header' => implode("\r\n", array_merge(
                    $headers,
                    ['Authorization: Basic ' . base64_encode($keyId . ':' . $keySecret)]
                )),
                'content' => $body ?? '',
                'timeout' => 25,
                'ignore_errors' => true,
            ],
        ]);

        $raw = @file_get_contents($url, false, $context);
        if (!is_string($raw) || $raw === '') {
            return null;
        }

        $decoded = json_decode($raw, true);
        return is_array($decoded) ? $decoded : null;
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

    private function userAgent(): ?string
    {
        $ua = trim((string)($_SERVER['HTTP_USER_AGENT'] ?? ''));
        if ($ua === '') {
            return null;
        }

        return substr($ua, 0, 255);
    }

    private function logOrderEvent(PDO $pdo, int $orderId, ?int $userId, string $eventType, ?string $status, ?float $total): void
    {
        try {
            $stmt = $pdo->prepare(
                'INSERT INTO order_events
                 (order_id, user_id, event_type, status, total, ip_address, user_agent, created_at)
                 VALUES (:order_id, :user_id, :event_type, :status, :total, :ip_address, :user_agent, NOW())'
            );
            $stmt->execute([
                'order_id' => $orderId,
                'user_id' => $userId,
                'event_type' => substr(trim($eventType), 0, 40),
                'status' => $status !== null ? substr(trim($status), 0, 40) : null,
                'total' => $total,
                'ip_address' => $this->clientIp(),
                'user_agent' => $this->userAgent(),
            ]);
        } catch (Throwable $e) {
            // Order flow should not fail because of audit logging.
        }
    }
}
