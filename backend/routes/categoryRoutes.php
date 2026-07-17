<?php

declare(strict_types=1);

require_once __DIR__ . '/../controllers/categoryController.php';

function categoryRoutes(string $apiPrefix): array
{
    return [
        [
            'method' => 'GET',
            'pattern' => $apiPrefix . '/categories/?$#',
            'handler' => static function (array $params): void {
                (new CategoryController())->index();
            },
        ],
        [
            'method' => 'POST',
            'pattern' => $apiPrefix . '/categories/?$#',
            'handler' => static function (array $params): void {
                (new CategoryController())->store(requestPayload());
            },
        ],
        [
            'method' => 'GET',
            'pattern' => $apiPrefix . '/categories/(?P<id>\d+)/?$#',
            'handler' => static function (array $params): void {
                (new CategoryController())->show((int)$params['id']);
            },
        ],
        [
            'method' => 'PUT|PATCH',
            'pattern' => $apiPrefix . '/categories/(?P<id>\d+)/?$#',
            'handler' => static function (array $params): void {
                (new CategoryController())->update((int)$params['id'], requestPayload());
            },
        ],
        [
            'method' => 'DELETE',
            'pattern' => $apiPrefix . '/categories/(?P<id>\d+)/?$#',
            'handler' => static function (array $params): void {
                (new CategoryController())->destroy((int)$params['id']);
            },
        ],
    ];
}
