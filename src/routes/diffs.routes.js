'use strict';

/**
 * Маршруты основной сущности — сравнения файлов.
 *
 * Сводка прав доступа:
 *
 *   метод  путь                     доступ
 *   ───────────────────────────────────────────────────────────────────────
 *   GET    /api/diffs                публично (токен не нужен)
 *   GET    /api/diffs/:id            публично
 *   GET    /api/diffs/:id/patch      публично
 *   POST   /api/diffs                аутентифицированный (любая роль)
 *   PUT    /api/diffs/:id            владелец или moderator / admin
 *   PATCH  /api/diffs/:id            владелец или moderator / admin
 *   DELETE /api/diffs/:id            только admin
 *
 * Валидация стоит на каждом эндпоинте: тело — Joi-схемой, :id — как UUID,
 * строка запроса — отдельной схемой listQuery (мера №29).
 */

const express = require('express');
const controller = require('../controllers/diffs.controller');
const validate = require('../middleware/validate');
const schemas = require('../validation/diff.schemas');
const { idParam } = require('../validation/common');
const { authenticate } = require('../middleware/authenticate');
const { roleGuard, ownerOrRole } = require('../middleware/roleGuard');
const { userLimiter, writeLimiter } = require('../middleware/rateLimiters');
const { detectInjectionInQuery } = require('../middleware/sanitize');
const audit = require('../middleware/audit');

const router = express.Router();

// ─── Публичное чтение ────────────────────────────────────────────────────────
// authenticate({ optional: true }) — токен необязателен, но если он есть,
// запись в логах будет привязана к пользователю
router.get(
  '/',
  authenticate({ optional: true }),
  detectInjectionInQuery,
  validate(schemas.listQuery, 'query'),
  controller.getAll,
);

router.get(
  '/:id',
  validate(idParam, 'params'),
  controller.getOne,
);

router.get(
  '/:id/patch',
  validate(idParam, 'params'),
  controller.getPatch,
);

// ─── Создание: любой аутентифицированный пользователь ────────────────────────
router.post(
  '/',
  authenticate(),
  roleGuard('user'),          // минимальная роль — user
  userLimiter,                // мера №25: лимит по user ID
  writeLimiter,
  validate(schemas.createDiff),
  controller.create,
);

// ─── Изменение: владелец либо moderator/admin ────────────────────────────────
router.put(
  '/:id',
  authenticate(),
  roleGuard('user'),
  writeLimiter,
  validate(idParam, 'params'),
  validate(schemas.replaceDiff),
  ownerOrRole(controller.loadDiff, 'ownerId', 'moderator'),
  controller.replace,
);

router.patch(
  '/:id',
  authenticate(),
  roleGuard('user'),
  writeLimiter,
  validate(idParam, 'params'),
  validate(schemas.patchDiff),
  ownerOrRole(controller.loadDiff, 'ownerId', 'moderator'),
  controller.patch,
);

// ─── Удаление: только администратор + запись в audit log (мера №7) ───────────
router.delete(
  '/:id',
  authenticate(),
  roleGuard('admin'),
  writeLimiter,
  validate(idParam, 'params'),
  audit('DIFF_DELETED', { targetType: 'Diff' }),
  controller.remove,
);

module.exports = router;
