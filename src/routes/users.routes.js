'use strict';

/**
 * Маршруты администрирования пользователей.
 *
 *   GET    /api/users            — moderator и выше
 *   GET    /api/users/:id        — свой профиль либо moderator и выше
 *   PATCH  /api/users/:id/role   — только admin   + audit log
 *   POST   /api/users/:id/unlock — только admin   + audit log
 *   DELETE /api/users/:id        — только admin   + audit log
 *
 * Все действия администратора проходят через middleware audit() (мера №7):
 * в журнал попадают и успешные операции, и отказы (403/404).
 */

const express = require('express');
const controller = require('../controllers/users.controller');
const validate = require('../middleware/validate');
const schemas = require('../validation/user.schemas');
const { idParam } = require('../validation/common');
const { authenticate } = require('../middleware/authenticate');
const { roleGuard } = require('../middleware/roleGuard');
const { userLimiter, writeLimiter } = require('../middleware/rateLimiters');
const { detectInjectionInQuery } = require('../middleware/sanitize');
const audit = require('../middleware/audit');

const router = express.Router();

// Все маршруты этого роутера требуют аутентификации
router.use(authenticate(), userLimiter);

// GET /api/users — модерация: список пользователей
router.get(
  '/',
  roleGuard('moderator'),
  detectInjectionInQuery,
  validate(schemas.listUsersQuery, 'query'),
  audit('USERS_LIST_VIEWED', { targetType: 'User' }),
  controller.list,
);

// GET /api/users/:id — свой профиль или профиль любого (для moderator+)
router.get(
  '/:id',
  validate(idParam, 'params'),
  controller.getOne,
);

// PATCH /api/users/:id/role — только администратор
router.patch(
  '/:id/role',
  roleGuard('admin'),
  writeLimiter,
  validate(idParam, 'params'),
  validate(schemas.updateRole),
  audit('USER_ROLE_CHANGED', {
    targetType: 'User',
    metadata: (req) => ({ requestedRole: req.body.role }),
  }),
  controller.updateRole,
);

// POST /api/users/:id/unlock — снять блокировку входа (мера №6)
router.post(
  '/:id/unlock',
  roleGuard('admin'),
  writeLimiter,
  validate(idParam, 'params'),
  audit('USER_UNLOCKED', { targetType: 'User' }),
  controller.unlock,
);

// DELETE /api/users/:id — только администратор
router.delete(
  '/:id',
  roleGuard('admin'),
  writeLimiter,
  validate(idParam, 'params'),
  audit('USER_DELETED', { targetType: 'User' }),
  controller.remove,
);

module.exports = router;
