<?php

declare(strict_types=1);

require_once __DIR__ . '/BaseModel.php';

final class UserModel extends BaseModel
{
    public function all(bool $includeInactive = true): array
    {
        $sql = 'SELECT id, name, email, phone, role, is_active, created_at, updated_at
                FROM users';
        $params = [];

        if (!$includeInactive) {
            $sql .= ' WHERE is_active = :is_active';
            $params['is_active'] = 1;
        }

        $sql .= ' ORDER BY id DESC';

        return array_map([$this, 'normalizePublicRow'], $this->fetchAll($sql, $params));
    }

    public function findById(int $id): ?array
    {
        $row = $this->fetchOne(
            'SELECT id, name, email, phone, role, is_active, created_at, updated_at
             FROM users
             WHERE id = :id
             LIMIT 1',
            ['id' => $id]
        );

        return $row ? $this->normalizePublicRow($row) : null;
    }

    public function findByEmail(string $email, bool $withPasswordHash = false): ?array
    {
        $email = strtolower(trim($email));
        if ($email === '') {
            return null;
        }

        $fields = $withPasswordHash
            ? 'id, name, email, phone, password_hash, role, is_active, created_at, updated_at'
            : 'id, name, email, phone, role, is_active, created_at, updated_at';

        $row = $this->fetchOne(
            'SELECT ' . $fields . ' FROM users WHERE email = :email LIMIT 1',
            ['email' => $email]
        );

        if (!$row) {
            return null;
        }

        if ($withPasswordHash) {
            $row['id'] = (int)$row['id'];
            $row['is_active'] = (int)($row['is_active'] ?? 0);
            return $row;
        }

        return $this->normalizePublicRow($row);
    }

    public function create(array $data): array
    {
        $payload = $this->sanitizePayload($data, true);

        $existing = $this->findByEmail((string)$payload['email']);
        if ($existing) {
            throw new InvalidArgumentException('Email already exists.');
        }

        $this->execute(
            'INSERT INTO users (name, email, phone, password_hash, role, is_active, created_at, updated_at)
             VALUES (:name, :email, :phone, :password_hash, :role, :is_active, NOW(), NOW())',
            $payload
        );

        $created = $this->findById((int)$this->pdo->lastInsertId());
        if (!$created) {
            throw new RuntimeException('Failed to load created user.');
        }

        return $created;
    }

    public function authenticate(string $email, string $password): ?array
    {
        $user = $this->findByEmail($email, true);
        if (!$user) {
            return null;
        }

        if ((int)($user['is_active'] ?? 0) !== 1) {
            return null;
        }

        $hash = (string)($user['password_hash'] ?? '');
        if ($hash === '' || !password_verify($password, $hash)) {
            return null;
        }

        unset($user['password_hash']);

        return $this->normalizePublicRow($user);
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

        if (array_key_exists('email', $payload)) {
            $existing = $this->findByEmail((string)$payload['email']);
            if ($existing && (int)$existing['id'] !== $id) {
                throw new InvalidArgumentException('Email already in use.');
            }
        }

        $fields = [];
        $params = ['id' => $id];

        foreach ($payload as $key => $value) {
            $fields[] = $key . ' = :' . $key;
            $params[$key] = $value;
        }

        $fields[] = 'updated_at = NOW()';

        $this->execute(
            'UPDATE users SET ' . implode(', ', $fields) . ' WHERE id = :id',
            $params
        );

        return $this->findById($id);
    }

    public function deleteById(int $id): bool
    {
        return $this->execute('DELETE FROM users WHERE id = :id', ['id' => $id]) > 0;
    }

    private function sanitizePayload(array $data, bool $isCreate): array
    {
        $name = array_key_exists('name', $data) ? trim((string)$data['name']) : null;
        $email = array_key_exists('email', $data) ? strtolower(trim((string)$data['email'])) : null;
        $phone = array_key_exists('phone', $data) ? trim((string)$data['phone']) : null;
        $password = array_key_exists('password', $data) ? (string)$data['password'] : null;
        $role = array_key_exists('role', $data) ? trim((string)$data['role']) : null;
        $isActive = array_key_exists('is_active', $data) ? (int)(bool)$data['is_active'] : null;

        if ($isCreate) {
            if ($name === null || $name === '') {
                throw new InvalidArgumentException('Name is required.');
            }
            if ($email === null || $email === '') {
                throw new InvalidArgumentException('Email is required.');
            }
            if ($password === null || $password === '') {
                throw new InvalidArgumentException('Password is required.');
            }
        }

        if ($name !== null && $name === '') {
            throw new InvalidArgumentException('Name cannot be empty.');
        }

        if ($email !== null) {
            if ($email === '') {
                throw new InvalidArgumentException('Email cannot be empty.');
            }
            if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
                throw new InvalidArgumentException('Invalid email format.');
            }
        }

        if ($password !== null && $password !== '' && strlen($password) < 6) {
            throw new InvalidArgumentException('Password must be at least 6 characters.');
        }

        $allowedRoles = ['user', 'admin', 'guest'];
        if ($role !== null && !in_array($role, $allowedRoles, true)) {
            $role = 'user';
        }

        $payload = [];

        if ($name !== null) {
            $payload['name'] = $name;
        }
        if ($email !== null) {
            $payload['email'] = $email;
        }
        if (array_key_exists('phone', $data)) {
            $payload['phone'] = $phone === '' ? null : $phone;
        } elseif ($isCreate) {
            $payload['phone'] = null;
        }
        if ($password !== null && $password !== '') {
            $payload['password_hash'] = password_hash($password, PASSWORD_DEFAULT);
        } elseif ($isCreate) {
            throw new InvalidArgumentException('Password is required.');
        }
        if ($isCreate) {
            $payload['role'] = ($role !== null && $role !== '') ? $role : 'user';
            $payload['is_active'] = $isActive ?? 1;
        } else {
            if ($role !== null) {
                $payload['role'] = ($role === '') ? 'user' : $role;
            }
            if ($isActive !== null) {
                $payload['is_active'] = $isActive;
            }
        }

        return $payload;
    }

    private function normalizePublicRow(array $row): array
    {
        unset($row['password_hash']);

        $row['id'] = (int)$row['id'];
        $row['is_active'] = (int)($row['is_active'] ?? 0);

        return $row;
    }
}
