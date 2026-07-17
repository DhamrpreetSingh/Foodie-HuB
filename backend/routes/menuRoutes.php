<?php

declare(strict_types=1);

require_once __DIR__ . '/../controllers/menuController.php';

function menuRoutes(string $apiPrefix): array
{
    return [
        [
            'method' => 'POST',
            'pattern' => $apiPrefix . '/menu/list/?$#',
            'handler' => static function (array $params): void {
                (new MenuController())->index();
            },
        ],
        [
            'method' => 'POST',
            'pattern' => $apiPrefix . '/menu/upload-image/?$#',
            'handler' => static function (array $params): void {
                (new MenuController())->uploadImage();
            },
        ],
        [
            'method' => 'POST',
            'pattern' => $apiPrefix . '/menu/?$#',
            'handler' => static function (array $params): void {
                (new MenuController())->store(requestPayload());
            },
        ],
        [
            'method' => 'POST',
            'pattern' => $apiPrefix . '/menu/get/(?P<id>\d+)/?$#',
            'handler' => static function (array $params): void {
                (new MenuController())->show((int)$params['id']);
            },
        ],
        [
            'method' => 'PUT|PATCH',
            'pattern' => $apiPrefix . '/menu/(?P<id>\d+)/?$#',
            'handler' => static function (array $params): void {
                (new MenuController())->update((int)$params['id'], requestPayload());
            },
        ],
        [
            'method' => 'DELETE',
            'pattern' => $apiPrefix . '/menu/(?P<id>\d+)/?$#',
            'handler' => static function (array $params): void {
                (new MenuController())->destroy((int)$params['id']);
            },
        ],
    ];
}
