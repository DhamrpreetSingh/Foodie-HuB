<?php

declare(strict_types=1);

require_once __DIR__ . '/../controllers/userController.php';

function userRoutes(string $apiPrefix): array
{
    return [
        [
            'method' => 'GET',
            'pattern' => $apiPrefix . '/users/google/start/?$#',
            'handler' => static function (array $params): void {
                (new UserController())->googleStart();
            },
        ],
        [
            'method' => 'GET',
            'pattern' => $apiPrefix . '/users/google/callback/?$#',
            'handler' => static function (array $params): void {
                (new UserController())->googleCallback();
            },
        ],
        [
            'method' => 'POST',
            'pattern' => $apiPrefix . '/users/google/verify-otp/?$#',
            'handler' => static function (array $params): void {
                (new UserController())->googleVerifyOtp(requestPayload());
            },
        ],
        [
            'method' => 'POST',
            'pattern' => $apiPrefix . '/users/signup/send-otp/?$#',
            'handler' => static function (array $params): void {
                (new UserController())->signupSendOtp(requestPayload());
            },
        ],
        [
            'method' => 'POST',
            'pattern' => $apiPrefix . '/users/signup/verify-otp/?$#',
            'handler' => static function (array $params): void {
                (new UserController())->signupVerifyOtp(requestPayload());
            },
        ],
        [
            'method' => 'POST',
            'pattern' => $apiPrefix . '/users/list/?$#',
            'handler' => static function (array $params): void {
                (new UserController())->index();
            },
        ],
        [
            'method' => 'POST',
            'pattern' => $apiPrefix . '/users/?$#',
            'handler' => static function (array $params): void {
                (new UserController())->register(requestPayload());
            },
        ],
        [
            'method' => 'POST',
            'pattern' => $apiPrefix . '/users/register/?$#',
            'handler' => static function (array $params): void {
                (new UserController())->register(requestPayload());
            },
        ],
        [
            'method' => 'POST',
            'pattern' => $apiPrefix . '/users/login/?$#',
            'handler' => static function (array $params): void {
                (new UserController())->login(requestPayload());
            },
        ],
        [
            'method' => 'POST',
            'pattern' => $apiPrefix . '/users/guest/?$#',
            'handler' => static function (array $params): void {
                (new UserController())->guestStart();
            },
        ],
        [
            'method' => 'GET',
            'pattern' => $apiPrefix . '/users/me/?$#',
            'handler' => static function (array $params): void {
                (new UserController())->me();
            },
        ],
        [
            'method' => 'GET',
            'pattern' => $apiPrefix . '/users/profile/?$#',
            'handler' => static function (array $params): void {
                (new UserController())->profileShow();
            },
        ],
        [
            'method' => 'PUT|PATCH',
            'pattern' => $apiPrefix . '/users/profile/?$#',
            'handler' => static function (array $params): void {
                (new UserController())->profileUpdate(requestPayload());
            },
        ],
        [
            'method' => 'GET',
            'pattern' => $apiPrefix . '/users/addresses/?$#',
            'handler' => static function (array $params): void {
                (new UserController())->addressesIndex();
            },
        ],
        [
            'method' => 'PUT',
            'pattern' => $apiPrefix . '/users/addresses/?$#',
            'handler' => static function (array $params): void {
                (new UserController())->addressesReplace(requestPayload());
            },
        ],
        [
            'method' => 'POST',
            'pattern' => $apiPrefix . '/users/logout/?$#',
            'handler' => static function (array $params): void {
                (new UserController())->logout();
            },
        ],
        [
            'method' => 'POST',
            'pattern' => $apiPrefix . '/users/audit/logins/?$#',
            'handler' => static function (array $params): void {
                (new UserController())->listLoginEvents(requestPayload());
            },
        ],
        [
            'method' => 'POST',
            'pattern' => $apiPrefix . '/users/audit/registrations/?$#',
            'handler' => static function (array $params): void {
                (new UserController())->listRegistrationEvents(requestPayload());
            },
        ],
        [
            'method' => 'DELETE',
            'pattern' => $apiPrefix . '/users/audit/?$#',
            'handler' => static function (array $params): void {
                (new UserController())->clearAuditEvents(requestPayload());
            },
        ],
        [
            'method' => 'POST',
            'pattern' => $apiPrefix . '/users/get/(?P<id>\d+)/?$#',
            'handler' => static function (array $params): void {
                (new UserController())->show((int)$params['id']);
            },
        ],
        [
            'method' => 'PUT|PATCH',
            'pattern' => $apiPrefix . '/users/(?P<id>\d+)/?$#',
            'handler' => static function (array $params): void {
                (new UserController())->update((int)$params['id'], requestPayload());
            },
        ],
        [
            'method' => 'DELETE',
            'pattern' => $apiPrefix . '/users/(?P<id>\d+)/?$#',
            'handler' => static function (array $params): void {
                (new UserController())->destroy((int)$params['id']);
            },
        ],
    ];
}
