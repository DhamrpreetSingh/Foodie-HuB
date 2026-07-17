<?php

declare(strict_types=1);

require_once __DIR__ . '/BaseModel.php';

final class MenuModel extends BaseModel
{
    public function all(?string $category = null): array
    {
        $sql = 'SELECT id, name, category, price, image, created_at, updated_at
                FROM menu_items';
        $params = [];

        if ($category !== null && trim($category) !== '') {
            $sql .= ' WHERE category = :category';
            $params['category'] = trim($category);
        }

        $sql .= ' ORDER BY id DESC';

        return array_map([$this, 'normalizeRow'], $this->fetchAll($sql, $params));
    }

    public function findById(int $id): ?array
    {
        $row = $this->fetchOne(
            'SELECT id, name, category, price, image, created_at, updated_at
             FROM menu_items
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
            'INSERT INTO menu_items (name, category, price, image, created_at, updated_at)
             VALUES (:name, :category, :price, :image, NOW(), NOW())',
            $payload
        );

        $created = $this->findById((int)$this->pdo->lastInsertId());
        if (!$created) {
            throw new RuntimeException('Failed to load created menu item.');
        }

        return $created;
    }

    public function updateById(int $id, array $data): ?array
    {
        if (!$this->findById($id)) {
            return null;
        }

        $payload = $this->sanitizePayload($data, false);
        if ($payload === []) {
            throw new InvalidArgumentException('No updatable fields provided.');
        }

        $fields = [];
        $params = ['id' => $id];

        foreach ($payload as $key => $value) {
            $fields[] = $key . ' = :' . $key;
            $params[$key] = $value;
        }

        $fields[] = 'updated_at = NOW()';

        $this->execute(
            'UPDATE menu_items SET ' . implode(', ', $fields) . ' WHERE id = :id',
            $params
        );

        return $this->findById($id);
    }

    public function deleteById(int $id): bool
    {
        return $this->execute('DELETE FROM menu_items WHERE id = :id', ['id' => $id]) > 0;
    }

    private function sanitizePayload(array $data, bool $isCreate): array
    {
        $name = array_key_exists('name', $data) ? trim((string)$data['name']) : null;
        $category = array_key_exists('category', $data) ? trim((string)$data['category']) : null;
        $price = array_key_exists('price', $data) ? (float)$data['price'] : null;
        $image = array_key_exists('image', $data) ? trim((string)$data['image']) : null;

        if ($isCreate && ($name === null || $name === '')) {
            throw new InvalidArgumentException('Menu item name is required.');
        }
        if ($name !== null && $name === '') {
            throw new InvalidArgumentException('Menu item name cannot be empty.');
        }
        if ($isCreate && ($price === null || $price <= 0)) {
            throw new InvalidArgumentException('Menu item price must be greater than 0.');
        }
        if ($price !== null && $price <= 0) {
            throw new InvalidArgumentException('Menu item price must be greater than 0.');
        }

        $payload = [];

        if ($name !== null) {
            $payload['name'] = $name;
        }
        if ($isCreate) {
            $payload['category'] = ($category !== null && $category !== '') ? $category : 'meal';
        } elseif ($category !== null) {
            $payload['category'] = $category === '' ? 'meal' : $category;
        }
        if ($price !== null) {
            $payload['price'] = $price;
        }
        if (array_key_exists('image', $data)) {
            $payload['image'] = $image === '' ? null : $image;
        } elseif ($isCreate) {
            $payload['image'] = null;
        }

        return $payload;
    }

    private function normalizeRow(array $row): array
    {
        $row['id'] = (int)$row['id'];
        $row['price'] = (float)$row['price'];

        return $row;
    }
}
