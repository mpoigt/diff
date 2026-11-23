'use strict';

/**
 * Ограничение частоты запросов (express-rate-limit).
 *
 * Четыре уровня:
 *   globalLimiter — обязательная мера: 300 запросов / 15 мин с одного IP
 *                   на весь /api. Защита от скана и простого флуда.
 *   authLimiter   — 10 запросов / 15 мин на /auth/login, /auth/register,
 *                   /auth/forgot-password. Это ещё один рубеж против
 *                   подбора пароля — работает ДО обращения к БД и бьёт
 *                   по IP, тогда как блокировка аккаунта (мера №6) бьёт
 *                   по конкретному пользователю.
 *   userLimiter   — мера №25: лимит на user ID, а не на IP. 60 изменяющих
 *                   запросов / 15 мин. Нужен, потому что за одним NAT/прокси
 *                   сидит много людей (ограничивать их общим IP-лимитом
 *                   несправедливо), а один аккаунт из множества IP иначе
 *                   обходит IP-лимит.
 *   writeLimiter  — отдельный, более строгий лимит на POST/PUT/PATCH/DELETE.
 *
 * Превышение любого лимита пишется в security-лог («массовые запросы»
 * из требований задания) и возвращает 429 с заголовком Retry-After.
 */

const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const config = require('../config/env');
const { logSuspicious } = require('../utils/logger');

const windowMs = config.security.rateLimitWindowMinutes * 60 * 1000;

/** Общий обработчик превышения: лог + единообразный JSON. */
function makeHandler(eventName) {
  return (req, res, next, options) => {
    logSuspicious(eventName, req, {
      limit: options.limit,
      windowMinutes: config.security.rateLimitWindowMinutes,
      key: req.user ? `user:${req.user.id}` : `ip:${req.ip}`,
    });
    res.status(options.statusCode).json({
      error: 'Слишком много запросов. Повторите попытку позже.',
      retryAfterSeconds: Math.ceil(windowMs / 1000),
    });
  };
}

const common = {
  windowMs,
  standardHeaders: 'draft-7', // RateLimit-* заголовки по актуальному черновику RFC
  legacyHeaders: false,
};

/** Глобальный лимит по IP. */
const globalLimiter = rateLimit({
  ...common,
  limit: config.security.rateLimitMax,
  handler: makeHandler('RATE_LIMIT_GLOBAL'),
});

/** Жёсткий лимит на эндпоинты аутентификации. */
const authLimiter = rateLimit({
  ...common,
  limit: config.security.authRateLimitMax,
  // Неудачные попытки тоже считаем — иначе подбор пароля не ограничивается
  skipSuccessfulRequests: false,
  handler: makeHandler('RATE_LIMIT_AUTH'),
});

/** Мера №25: ключ — идентификатор пользователя, с фоллбэком на IP. */
const userLimiter = rateLimit({
  ...common,
  limit: config.security.userRateLimitMax,
  // ipKeyGenerator нормализует IPv6 (/64-подсеть), иначе лимит обходится
  // простой сменой последних групп адреса
  keyGenerator: (req) => (req.user ? `user:${req.user.id}` : `ip:${ipKeyGenerator(req.ip)}`),
  handler: makeHandler('RATE_LIMIT_PER_USER'),
});

/** Строгий лимит на изменяющие операции. */
const writeLimiter = rateLimit({
  ...common,
  limit: Math.max(20, Math.floor(config.security.userRateLimitMax / 2)),
  keyGenerator: (req) => (req.user ? `user:${req.user.id}` : `ip:${ipKeyGenerator(req.ip)}`),
  handler: makeHandler('RATE_LIMIT_WRITE'),
});

module.exports = { globalLimiter, authLimiter, userLimiter, writeLimiter };
