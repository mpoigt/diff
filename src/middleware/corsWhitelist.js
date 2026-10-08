'use strict';

/**
 * Мера №22 — CORS с белым списком доменов.
 *
 * Было (лабораторная 1): Access-Control-Allow-Origin: * — API мог вызвать
 * любой сайт из браузера пользователя.
 * Стало: список разрешённых origin-ов берётся из CORS_WHITELIST в .env;
 * всё остальное получает отказ. Вместе с credentials: true это обязательно:
 * по спецификации CORS нельзя одновременно использовать '*' и передавать
 * cookie — а refresh-токен у нас живёт именно в cookie.
 *
 * Запросы без заголовка Origin (Postman, curl, серверные интеграции,
 * same-origin переходы) пропускаются: CORS — это ограничение браузера,
 * а не механизм аутентификации, и блокировать им консольные клиенты
 * бессмысленно. Реальный доступ всё равно решает JWT.
 */

const cors = require('cors');
const config = require('../config/env');
const { logSuspicious } = require('../utils/logger');

const whitelist = config.security.corsWhitelist;

const corsMiddleware = cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (whitelist.includes(origin)) return callback(null, true);

    // Чужой origin — пишем в security-лог: возможна попытка CSRF/кражи данных
    logSuspicious('CORS_ORIGIN_REJECTED', undefined, { origin });
    return callback(null, false);
  },
  // Разрешаем браузеру отправлять и принимать cookie (refresh-токен)
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset', 'Location'],
  maxAge: 600, // кешировать preflight 10 минут
  optionsSuccessStatus: 204,
});

module.exports = { corsMiddleware, whitelist };
