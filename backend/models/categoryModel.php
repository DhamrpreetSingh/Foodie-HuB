<?php

declare(strict_types=1);

require_once __DIR__ . '/BaseModel.php';

final class CategoryModel extends BaseModel
{
    public function all(bool $onlyActive = false): array
    {
        $sql = 'SELECT id, name, description, image_url, is_active, created_at, updated_at
                FROM categories';
        $params = [];

        if ($onlyActive) {
            $sql .= ' WHERE is_active = :is_active';
            $params['is_active'] = 1;
        }

        $sql .= ' ORDER BY id DESC';

        return array_map([$this, 'normalizeRow'], $this->fetchAll($sql, $params));
    }

    public function findById(int $id): ?array
    {
        $row = $this->fetchOne(
            'SELECT id, name, description, image_url, is_active, created_at, updated_at
             FROM categories
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
            'INSERT INTO categories (name, description, image_url, is_active, created_at, updated_at)
             VALUES (:name, :description, :image_url, :is_active, NOW(), NOW())',
            $payload
        );

        $created = $this->findById((int)$this->pdo->lastInsertId());
        if (!$created) {
            throw new RuntimeException('Failed to load created category.');
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
            'UPDATE categories SET ' . implode(', ', $fields) . ' WHERE id = :id',
            $params
        );

        return $this->findById($id);
    }

    public function deleteById(int $id): bool
    {
        return $this->execute('DELETE FROM categories WHERE id = :id', ['id' => $id]) > 0;
    }

    private function sanitizePayload(array $data, bool $isCreate): array
    {
        $name = array_key_exists('name', $data) ? trim((string)$data['name']) : null;
        $description = array_key_exists('description', $data) ? trim((string)$data['description']) : null;
        $imageUrl = array_key_exists('image_url', $data) ? trim((string)$data['image_url']) : null;
        $isActive = array_key_exists('is_active', $data) ? (int)(bool)$data['is_active'] : null;

        if ($isCreate && ($name === null || $name === '')) {
            throw new InvalidArgumentException('Category name is required.');
        }
        if ($name !== null && $name === '') {
            throw new InvalidArgumentException('Category name cannot be empty.');
        }

        $payload = [];

        if ($name !== null) {
            $payload['name'] = $name;
        }
        if (array_key_exists('description', $data)) {
            $payload['description'] = $description === '' ? null : $description;
        }
        if (array_key_exists('image_url', $data)) {
            $payload['image_url'] = $imageUrl === '' ? null : $imageUrl;
        }
        if ($isCreate) {
            $payload['is_active'] = $isActive ?? 1;
        } elseif ($isActive !== null) {
            $payload['is_active'] = $isActive;
        }

        return $payload;
    }

    private function normalizeRow(array $row): array
    {
        $row['id'] = (int)$row['id'];
        $row['is_active'] = (int)($row['is_active'] ?? 0);

        return $row;
    }
}
