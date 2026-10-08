'use strict';

/**
 * Маршруты аутентификации.
 *
 * Порядок middleware в каждой цепочке не случаен:
 *   authLimiter  — сначала отсекаем флуд, не трогая БД (дешёвая проверка);
 *   validate     — потом проверяем формат данных;
 *   controller   — и только затем работаем с БД и bcrypt (дорогая операция).
 *
 * Так подбор пароля упирается в rate limit раньше, чем успеет нагрузить
 * сервер вычислением bcrypt-хешей.
 */

const express = require('express');
const controller = require('../controllers/auth.controller');
const validate = require('../middleware/validate');
const schemas = require('../validation/auth.schemas');
const { authenticate } = require('../middleware/authenticate');
const { authLimiter, userLimiter } = require('../middleware/rateLimiters');

const router = express.Router();

// POST /auth/register — регистрация. Роль всегда 'user'.
router.post(
  '/register',
  authLimiter,
  validate(schemas.register),
  controller.register,
);

// POST /auth/login — выдача JWT (+ refresh-токен в httpOnly cookie)
router.post(
  '/login',
  authLimiter,
  validate(schemas.login),
  controller.login,
);

// GET /auth/me — информация о текущем пользователе, требует токен
router.get(
  '/me',
  authenticate(),
  controller.me,
);

// POST /auth/refresh — обновление access-токена по cookie (мера №5)
router.post('/refresh', authLimiter, controller.refresh);

// POST /auth/logout — закрыть текущую сессию
router.post('/logout', controller.logout);

// POST /auth/logout-all — закрыть все сессии пользователя (мера №20)
router.post('/logout-all', authenticate(), controller.logoutAll);

// GET /auth/sessions — список своих активных сессий (мера №20)
router.get('/sessions', authenticate(), controller.sessions);

// POST /auth/forgot-password — запрос токена сброса пароля (мера №16)
router.post(
  '/forgot-password',
  authLimiter,
  validate(schemas.forgotPassword),
  controller.forgotPassword,
);

// POST /auth/reset-password — установка нового пароля по токену (мера №16)
router.post(
  '/reset-password',
  authLimiter,
  validate(schemas.resetPassword),
  controller.resetPassword,
);

// POST /auth/change-password — смена пароля авторизованным пользователем
router.post(
  '/change-password',
  authenticate(),
  userLimiter,
  validate(schemas.changePassword),
  controller.changePassword,
);

module.exports = router;
