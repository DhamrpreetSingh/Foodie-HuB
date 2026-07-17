<?php

declare(strict_types=1);

require_once __DIR__ . '/../config/db.php';

final class CategoryController
{
    public function index(): void
    {
        try {
            $pdo = db();
            $stmt = $pdo->query('SELECT id, name, description, image_url, is_active, created_at, updated_at FROM categories ORDER BY id DESC');
            $rows = $stmt->fetchAll();

            $this->jsonResponse([
                'success' => true,
                'data' => $rows,
            ]);
        } catch (Throwable $e) {
            $this->jsonResponse([
                'success' => false,
                'message' => 'Failed to fetch categories.',
            ], 500);
        }
    }

    public function show(int $id): void
    {
        try {
            $pdo = db();
            $stmt = $pdo->prepare('SELECT id, name, description, image_url, is_active, created_at, updated_at FROM categories WHERE id = :id LIMIT 1');
            $stmt->execute(['id' => $id]);
            $row = $stmt->fetch();

            if (!$row) {
                $this->jsonResponse([
                    'success' => false,
                    'message' => 'Category not found.',
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
                'message' => 'Failed to fetch category.',
            ], 500);
        }
    }

    public function store(array $payload): void
    {
        $name = trim((string)($payload['name'] ?? ''));
        $description = isset($payload['description']) ? trim((string)$payload['description']) : null;
        $imageUrl = isset($payload['image_url']) ? trim((string)$payload['image_url']) : null;
        $isActive = array_key_exists('is_active', $payload) ? (int)(bool)$payload['is_active'] : 1;

        if ($name === '') {
            $this->jsonResponse([
                'success' => false,
                'message' => 'Category name is required.',
            ], 422);
            return;
        }

        try {
            $pdo = db();
            $stmt = $pdo->prepare(
                'INSERT INTO categories (name, description, image_url, is_active, created_at, updated_at) VALUES (:name, :description, :image_url, :is_active, NOW(), NOW())'
            );

            $stmt->execute([
                'name' => $name,
                'description' => $description,
                'image_url' => $imageUrl,
                'is_active' => $isActive,
            ]);

            $this->show((int)$pdo->lastInsertId());
        } catch (Throwable $e) {
            $this->jsonResponse([
                'success' => false,
                'message' => 'Failed to create category.',
            ], 500);
        }
    }

    public function update(int $id, array $payload): void
    {
        $name = isset($payload['name']) ? trim((string)$payload['name']) : null;
        $description = array_key_exists('description', $payload) ? trim((string)$payload['description']) : null;
        $imageUrl = array_key_exists('image_url', $payload) ? trim((string)$payload['image_url']) : null;
        $isActive = array_key_exists('is_active', $payload) ? (int)(bool)$payload['is_active'] : null;

        if ($name !== null && $name === '') {
            $this->jsonResponse([
                'success' => false,
                'message' => 'Category name cannot be empty.',
            ], 422);
            return;
        }

        try {
            $pdo = db();

            $existing = $pdo->prepare('SELECT id FROM categories WHERE id = :id LIMIT 1');
            $existing->execute(['id' => $id]);
            if (!$existing->fetch()) {
                $this->jsonResponse([
                    'success' => false,
                    'message' => 'Category not found.',
                ], 404);
                return;
            }

            $fields = [];
            $params = ['id' => $id];

            if ($name !== null) {
                $fields[] = 'name = :name';
                $params['name'] = $name;
            }
            if (array_key_exists('description', $payload)) {
                $fields[] = 'description = :description';
                $params['description'] = $description;
            }
            if (array_key_exists('image_url', $payload)) {
                $fields[] = 'image_url = :image_url';
                $params['image_url'] = $imageUrl;
            }
            if ($isActive !== null) {
                $fields[] = 'is_active = :is_active';
                $params['is_active'] = $isActive;
            }

            if ($fields === []) {
                $this->jsonResponse([
                    'success' => false,
                    'message' => 'No updatable fields provided.',
                ], 422);
                return;
            }

            $fields[] = 'updated_at = NOW()';

            $sql = 'UPDATE categories SET ' . implode(', ', $fields) . ' WHERE id = :id';
            $stmt = $pdo->prepare($sql);
            $stmt->execute($params);

            $this->show($id);
        } catch (Throwable $e) {
            $this->jsonResponse([
                'success' => false,
                'message' => 'Failed to update category.',
            ], 500);
        }
    }

    public function destroy(int $id): void
    {
        try {
            $pdo = db();
            $stmt = $pdo->prepare('DELETE FROM categories WHERE id = :id');
            $stmt->execute(['id' => $id]);

            if ($stmt->rowCount() === 0) {
                $this->jsonResponse([
                    'success' => false,
                    'message' => 'Category not found.',
                ], 404);
                return;
            }

            $this->jsonResponse([
                'success' => true,
                'message' => 'Category deleted successfully.',
            ]);
        } catch (Throwable $e) {
            $this->jsonResponse([
                'success' => false,
                'message' => 'Failed to delete category.',
            ], 500);
        }
    }

    private function jsonResponse(array $data, int $statusCode = 200): void
    {
        http_response_code($statusCode);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }
}
