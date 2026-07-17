<?php

declare(strict_types=1);

require_once __DIR__ . '/../config/db.php';

final class MenuController
{
    private const MAX_UPLOAD_BYTES = 2097152; // 2 MB
    private const MAX_IMAGE_WIDTH = 3000;
    private const MAX_IMAGE_HEIGHT = 3000;

    public function index(): void
    {
        try {
            $pdo = db();
            $stmt = $pdo->query('SELECT id, name, category, description, price, image, created_at, updated_at FROM menu_items ORDER BY id DESC');

            $this->jsonResponse([
                'success' => true,
                'data' => $stmt->fetchAll(),
            ]);
        } catch (Throwable $e) {
            $this->jsonResponse([
                'success' => false,
                'message' => 'Failed to fetch menu items.',
            ], 500);
        }
    }

    public function show(int $id): void
    {
        try {
            $pdo = db();
            $stmt = $pdo->prepare('SELECT id, name, category, description, price, image, created_at, updated_at FROM menu_items WHERE id = :id LIMIT 1');
            $stmt->execute(['id' => $id]);
            $row = $stmt->fetch();

            if (!$row) {
                $this->jsonResponse([
                    'success' => false,
                    'message' => 'Menu item not found.',
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
                'message' => 'Failed to fetch menu item.',
            ], 500);
        }
    }

    public function store(array $payload): void
    {
        if (!$this->requireAdmin()) {
            return;
        }
        $name = trim((string)($payload['name'] ?? ''));
        $category = trim((string)($payload['category'] ?? 'meal'));
        $description = isset($payload['description']) ? trim((string)$payload['description']) : null;
        $price = isset($payload['price']) ? (float)$payload['price'] : 0.0;
        $image = isset($payload['image']) ? trim((string)$payload['image']) : null;

        if ($name === '' || $price <= 0) {
            $this->jsonResponse([
                'success' => false,
                'message' => 'Valid name and price are required.',
            ], 422);
            return;
        }

        if ($description !== null && $description !== '') {
            $description = substr($description, 0, 1000);
        } else {
            $description = null;
        }

        try {
            $pdo = db();
            $stmt = $pdo->prepare(
                'INSERT INTO menu_items (name, category, description, price, image, created_at, updated_at) VALUES (:name, :category, :description, :price, :image, NOW(), NOW())'
            );

            $stmt->execute([
                'name' => $name,
                'category' => $category,
                'description' => $description,
                'price' => $price,
                'image' => $image,
            ]);

            $this->show((int)$pdo->lastInsertId());
        } catch (Throwable $e) {
            $this->jsonResponse([
                'success' => false,
                'message' => 'Failed to create menu item.',
            ], 500);
        }
    }

    public function update(int $id, array $payload): void
    {
        if (!$this->requireAdmin()) {
            return;
        }
        $name = isset($payload['name']) ? trim((string)$payload['name']) : null;
        $category = isset($payload['category']) ? trim((string)$payload['category']) : null;
        $description = array_key_exists('description', $payload) ? trim((string)$payload['description']) : null;
        $price = array_key_exists('price', $payload) ? (float)$payload['price'] : null;
        $image = array_key_exists('image', $payload) ? trim((string)$payload['image']) : null;

        if ($name !== null && $name === '') {
            $this->jsonResponse([
                'success' => false,
                'message' => 'Name cannot be empty.',
            ], 422);
            return;
        }

        if ($price !== null && $price <= 0) {
            $this->jsonResponse([
                'success' => false,
                'message' => 'Price must be greater than 0.',
            ], 422);
            return;
        }

        try {
            $pdo = db();

            $exists = $pdo->prepare('SELECT id FROM menu_items WHERE id = :id LIMIT 1');
            $exists->execute(['id' => $id]);
            if (!$exists->fetch()) {
                $this->jsonResponse([
                    'success' => false,
                    'message' => 'Menu item not found.',
                ], 404);
                return;
            }

            $fields = [];
            $params = ['id' => $id];

            if ($name !== null) {
                $fields[] = 'name = :name';
                $params['name'] = $name;
            }
            if ($category !== null) {
                $fields[] = 'category = :category';
                $params['category'] = $category;
            }
            if (array_key_exists('description', $payload)) {
                $fields[] = 'description = :description';
                $params['description'] = ($description !== null && $description !== '') ? substr($description, 0, 1000) : null;
            }
            if ($price !== null) {
                $fields[] = 'price = :price';
                $params['price'] = $price;
            }
            if (array_key_exists('image', $payload)) {
                $fields[] = 'image = :image';
                $params['image'] = $image;
            }

            if ($fields === []) {
                $this->jsonResponse([
                    'success' => false,
                    'message' => 'No updatable fields provided.',
                ], 422);
                return;
            }

            $fields[] = 'updated_at = NOW()';

            $stmt = $pdo->prepare('UPDATE menu_items SET ' . implode(', ', $fields) . ' WHERE id = :id');
            $stmt->execute($params);

            $this->show($id);
        } catch (Throwable $e) {
            $this->jsonResponse([
                'success' => false,
                'message' => 'Failed to update menu item.',
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
            $stmt = $pdo->prepare('DELETE FROM menu_items WHERE id = :id');
            $stmt->execute(['id' => $id]);

            if ($stmt->rowCount() === 0) {
                $this->jsonResponse([
                    'success' => false,
                    'message' => 'Menu item not found.',
                ], 404);
                return;
            }

            $this->jsonResponse([
                'success' => true,
                'message' => 'Menu item deleted successfully.',
            ]);
        } catch (Throwable $e) {
            $this->jsonResponse([
                'success' => false,
                'message' => 'Failed to delete menu item.',
            ], 500);
        }
    }

    public function uploadImage(): void
    {
        if (!$this->requireAdmin()) {
            return;
        }

        $file = $_FILES['image'] ?? null;
        if (!is_array($file) || !isset($file['tmp_name'], $file['name'], $file['error'])) {
            $this->jsonResponse([
                'success' => false,
                'message' => 'Image file is required.',
            ], 422);
            return;
        }

        if ((int)$file['error'] !== UPLOAD_ERR_OK) {
            $this->jsonResponse([
                'success' => false,
                'message' => 'Image upload failed.',
            ], 422);
            return;
        }

        $size = isset($file['size']) ? (int)$file['size'] : 0;
        if ($size < 1 || $size > self::MAX_UPLOAD_BYTES) {
            $this->jsonResponse([
                'success' => false,
                'message' => 'Image must be between 1 byte and 2 MB.',
            ], 422);
            return;
        }

        $tmpPath = (string)$file['tmp_name'];
        if ($tmpPath === '' || !is_uploaded_file($tmpPath)) {
            $this->jsonResponse([
                'success' => false,
                'message' => 'Invalid uploaded file.',
            ], 422);
            return;
        }

        $mime = '';
        if (function_exists('finfo_open')) {
            $finfo = finfo_open(FILEINFO_MIME_TYPE);
            if ($finfo !== false) {
                $mime = (string)finfo_file($finfo, $tmpPath);
                finfo_close($finfo);
            }
        }

        $allowed = [
            'image/jpeg' => 'jpg',
            'image/png' => 'png',
            'image/webp' => 'webp',
        ];
        if (!array_key_exists($mime, $allowed)) {
            $this->jsonResponse([
                'success' => false,
                'message' => 'Only JPG, PNG, and WEBP images are allowed.',
            ], 422);
            return;
        }

        $imageInfo = @getimagesize($tmpPath);
        if (!is_array($imageInfo) || empty($imageInfo[0]) || empty($imageInfo[1])) {
            $this->jsonResponse([
                'success' => false,
                'message' => 'Uploaded file is not a valid image.',
            ], 422);
            return;
        }

        $width = (int)$imageInfo[0];
        $height = (int)$imageInfo[1];
        if ($width < 1 || $height < 1 || $width > self::MAX_IMAGE_WIDTH || $height > self::MAX_IMAGE_HEIGHT) {
            $this->jsonResponse([
                'success' => false,
                'message' => 'Image dimensions exceed the allowed limit.',
            ], 422);
            return;
        }

        $uploadDir = __DIR__ . '/../public/uploads/menu';
        if (!is_dir($uploadDir) && !mkdir($uploadDir, 0755, true) && !is_dir($uploadDir)) {
            $this->jsonResponse([
                'success' => false,
                'message' => 'Unable to prepare upload directory.',
            ], 500);
            return;
        }

        $filename = 'menu_' . date('Ymd_His') . '_' . bin2hex(random_bytes(6)) . '.' . $allowed[$mime];
        $target = $uploadDir . DIRECTORY_SEPARATOR . $filename;
        $saved = $this->storeSanitizedImage($tmpPath, $mime, $target);
        if (!$saved && !move_uploaded_file($tmpPath, $target)) {
            $this->jsonResponse([
                'success' => false,
                'message' => 'Unable to save uploaded image.',
            ], 500);
            return;
        }

        $imagePath = '/backend/public/uploads/menu/' . $filename;
        $this->jsonResponse([
            'success' => true,
            'message' => 'Image uploaded successfully.',
            'data' => [
                'image' => $imagePath,
            ],
        ], 201);
    }

    private function jsonResponse(array $data, int $statusCode = 200): void
    {
        http_response_code($statusCode);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
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

    private function storeSanitizedImage(string $tmpPath, string $mime, string $target): bool
    {
        if (!function_exists('imagecreatetruecolor')) {
            return false;
        }

        $image = match ($mime) {
            'image/jpeg' => function_exists('imagecreatefromjpeg') ? @imagecreatefromjpeg($tmpPath) : false,
            'image/png' => function_exists('imagecreatefrompng') ? @imagecreatefrompng($tmpPath) : false,
            'image/webp' => function_exists('imagecreatefromwebp') ? @imagecreatefromwebp($tmpPath) : false,
            default => false,
        };

        if (!$image) {
            return false;
        }

        $width = (int)imagesx($image);
        $height = (int)imagesy($image);
        if ($width < 1 || $height < 1) {
            imagedestroy($image);
            return false;
        }

        $canvas = imagecreatetruecolor($width, $height);
        if (!$canvas) {
            imagedestroy($image);
            return false;
        }

        imagealphablending($canvas, false);
        imagesavealpha($canvas, true);
        $transparent = imagecolorallocatealpha($canvas, 0, 0, 0, 127);
        imagefilledrectangle($canvas, 0, 0, $width, $height, $transparent);
        imagecopy($canvas, $image, 0, 0, 0, 0, $width, $height);

        $written = match ($mime) {
            'image/jpeg' => imagejpeg($canvas, $target, 85),
            'image/png' => imagepng($canvas, $target, 6),
            'image/webp' => function_exists('imagewebp') ? imagewebp($canvas, $target, 85) : false,
            default => false,
        };

        imagedestroy($canvas);
        imagedestroy($image);

        return $written && is_file($target) && filesize($target) > 0;
    }
}
