<?php

declare(strict_types=1);

require_once __DIR__ . '/../controllers/orderController.php';

function orderRoutes(string $apiPrefix): array
{
    return [
        [
            'method' => 'POST',
            'pattern' => $apiPrefix . '/orders/list/?$#',
            'handler' => static function (array $params): void {
                (new OrderController())->index();
            },
        ],
        [
            'method' => 'POST',
            'pattern' => $apiPrefix . '/orders/?$#',
            'handler' => static function (array $params): void {
                (new OrderController())->store(requestPayload());
            },
        ],
        [
            'method' => 'POST',
            'pattern' => $apiPrefix . '/orders/razorpay/order/?$#',
            'handler' => static function (array $params): void {
                (new OrderController())->createRazorpayOrder(requestPayload());
            },
        ],
        [
            'method' => 'POST',
            'pattern' => $apiPrefix . '/orders/get/(?P<id>\d+)/?$#',
            'handler' => static function (array $params): void {
                (new OrderController())->show((int)$params['id']);
            },
        ],
        [
            'method' => 'PUT|PATCH',
            'pattern' => $apiPrefix . '/orders/(?P<id>\d+)/status/?$#',
            'handler' => static function (array $params): void {
                $payload = requestPayload();
                $status = trim((string)($payload['status'] ?? ''));
                (new OrderController())->updateStatus((int)$params['id'], $status);
            },
        ],
        [
            'method' => 'DELETE',
            'pattern' => $apiPrefix . '/orders/(?P<id>\d+)/?$#',
            'handler' => static function (array $params): void {
                (new OrderController())->destroy((int)$params['id']);
            },
        ],
    ];
}
