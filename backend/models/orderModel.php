<?php

declare(strict_types=1);

require_once __DIR__ . '/BaseModel.php';

final class OrderModel extends BaseModel
{
    public function all(?int $userId = null): array
    {
        $sql = 'SELECT id, user_id, full_name, phone, address, city, zip, payment_method, status,
                       subtotal, delivery_fee, discount, total, notes, items_json, created_at, updated_at
                FROM orders';
        $params = [];

        if ($userId !== null) {
            $sql .= ' WHERE user_id = :user_id';
            $params['user_id'] = $userId;
        }

        $sql .= ' ORDER BY id DESC';

        return array_map([$this, 'normalizeRow'], $this->fetchAll($sql, $params));
    }

    public function findById(int $id): ?array
    {
        $row = $this->fetchOne(
            'SELECT id, user_id, full_name, phone, address, city, zip, payment_method, status,
                    subtotal, delivery_fee, discount, total, notes, items_json, created_at, updated_at
             FROM orders
             WHERE id = :id
             LIMIT 1',
            ['id' => $id]
        );

        return $row ? $this->normalizeRow($row) : null;
    }

    public function create(array $data): array
    {
        $payload = $this->sanitizePayload($data, true);

        $this->execute(
            'INSERT INTO orders
                (user_id, full_name, phone, address, city, zip, payment_method, status, subtotal, delivery_fee, discount, total, notes, items_json, created_at, updated_at)
             VALUES
                (:user_id, :full_name, :phone, :address, :city, :zip, :payment_method, :status, :subtotal, :delivery_fee, :discount, :total, :notes, :items_json, NOW(), NOW())',
            $payload
        );

        $created = $this->findById((int)$this->pdo->lastInsertId());
        if (!$created) {
            throw new RuntimeException('Failed to load created order.');
        }

        return $created;
    }

    public function updateStatus(int $id, string $status): ?array
    {
        $status = trim($status);
        if ($status === '') {
            throw new InvalidArgumentException('Order status is required.');
        }

        if (!$this->findById($id)) {
            return null;
        }

        $this->execute(
            'UPDATE orders SET status = :status, updated_at = NOW() WHERE id = :id',
            [
                'id' => $id,
                'status' => $status,
            ]
        );

        return $this->findById($id);
    }

    public function deleteById(int $id): bool
    {
        return $this->execute('DELETE FROM orders WHERE id = :id', ['id' => $id]) > 0;
    }

    private function sanitizePayload(array $data, bool $isCreate): array
    {
        $fullName = trim((string)($data['full_name'] ?? $data['fullName'] ?? ''));
        $phone = trim((string)($data['phone'] ?? ''));
        $address = trim((string)($data['address'] ?? ''));
        $city = trim((string)($data['city'] ?? ''));
        $zip = trim((string)($data['zip'] ?? ''));
        $paymentMethod = trim((string)($data['payment_method'] ?? $data['payment'] ?? 'Cash on Delivery'));
        $status = trim((string)($data['status'] ?? 'Placed'));
        $userId = array_key_exists('user_id', $data) ? (int)$data['user_id'] : null;
        $subtotal = isset($data['subtotal']) ? (float)$data['subtotal'] : 0.0;
        $deliveryFee = isset($data['delivery_fee']) ? (float)$data['delivery_fee'] : 0.0;
        $discount = isset($data['discount']) ? (float)$data['discount'] : 0.0;
        $total = isset($data['total']) ? (float)$data['total'] : 0.0;
        $notes = array_key_exists('notes', $data) ? trim((string)$data['notes']) : null;
        $items = is_array($data['items'] ?? null) ? $data['items'] : [];

        if ($isCreate && ($fullName === '' || $phone === '' || $address === '' || $city === '' || $zip === '')) {
            throw new InvalidArgumentException('Customer details are required.');
        }
        if ($isCreate && $total <= 0) {
            throw new InvalidArgumentException('Order total must be greater than 0.');
        }

        return [
            'user_id' => $userId,
            'full_name' => $fullName,
            'phone' => $phone,
            'address' => $address,
            'city' => $city,
            'zip' => $zip,
            'payment_method' => $paymentMethod === '' ? 'Cash on Delivery' : $paymentMethod,
            'status' => $status === '' ? 'Placed' : $status,
            'subtotal' => $subtotal,
            'delivery_fee' => $deliveryFee,
            'discount' => $discount,
            'total' => $total,
            'notes' => $notes === '' ? null : $notes,
            'items_json' => json_encode($items, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        ];
    }

    private function normalizeRow(array $row): array
    {
        $items = [];
        if (!empty($row['items_json']) && is_string($row['items_json'])) {
            $decoded = json_decode($row['items_json'], true);
            if (is_array($decoded)) {
                $items = $decoded;
            }
        }

        $row['id'] = (int)$row['id'];
        $row['user_id'] = isset($row['user_id']) ? (int)$row['user_id'] : null;
        $row['subtotal'] = (float)$row['subtotal'];
        $row['delivery_fee'] = (float)$row['delivery_fee'];
        $row['discount'] = (float)$row['discount'];
        $row['total'] = (float)$row['total'];
        $row['items'] = $items;
        unset($row['items_json']);

        return $row;
    }
}
