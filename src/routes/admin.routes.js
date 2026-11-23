'use strict';

/**
 * Административные маршруты.
 *
 *   GET /api/admin/audit-log — журнал действий администраторов (мера №7)
 *   GET /api/admin/security  — сводка включённых мер безопасности
 *                              (удобно для скриншотов в отчёте)
 */

const express = require('express');
const controller = require('../controllers/users.controller');
const validate = require('../middleware/validate');
const schemas = require('../validation/user.schemas');
const { authenticate } = require('../middleware/authenticate');
const { roleGuard } = require('../middleware/roleGuard');
const { userLimiter } = require('../middleware/rateLimiters');
const { detectInjectionInQuery } = require('../middleware/sanitize');
const audit = require('../middleware/audit');
const config = require('../config/env');
const { whitelist } = require('../middleware/corsWhitelist');

const router = express.Router();

router.use(authenticate(), roleGuard('admin'), userLimiter);

// GET /api/admin/audit-log?action=&actorId=&limit=&offset=
router.get(
  '/audit-log',
  detectInjectionInQuery,
  validate(schemas.auditQuery, 'query'),
  audit('AUDIT_LOG_VIEWED'),
  controller.auditLog,
);

// GET /api/admin/security — какие параметры безопасности сейчас активны.
// Секреты (JWT_SECRET, пароль БД) НЕ возвращаются — только настройки.
router.get('/security', audit('SECURITY_CONFIG_VIEWED'), (req, res) => {
  res.json({
    environment: config.nodeEnv,
    genericErrors: config.isProduction,
    passwordPolicy: {
      minLength: 8,
      requires: ['строчная буква', 'заглавная буква', 'цифра', 'спецсимвол'],
    },
    bcryptRounds: config.security.bcryptRounds,
    bruteForce: {
      maxAttempts: config.security.loginMaxAttempts,
      lockMinutes: config.security.loginLockMinutes,
    },
    jwt: {
      accessTtl: config.jwt.accessTtl,
      refreshTtl: config.jwt.refreshTtl,
      refreshStorage: 'httpOnly cookie, sameSite=strict',
      maxSessionsPerUser: config.security.maxSessionsPerUser,
    },
    rateLimit: {
      windowMinutes: config.security.rateLimitWindowMinutes,
      globalPerIp: config.security.rateLimitMax,
      authPerIp: config.security.authRateLimitMax,
      perUser: config.security.userRateLimitMax,
    },
    bodyLimit: config.security.bodyLimit,
    corsWhitelist: whitelist,
    resetTokenTtlMinutes: config.security.resetTokenTtlMinutes,
  });
});

module.exports = router;
