'use strict';

/**
 * Централизованный обработчик ошибок.
 *
 * Мера №24 — «подробные ошибки только в разработке, в продакшене generic».
 * Логика такая:
 *   - операционные ошибки (ApiError: 400/401/403/404/409/415/423/429)
 *     отдаются с их текстом в любом окружении — пользователю нужно знать,
 *     что именно он прислал не так;
 *   - любая НЕожидаемая ошибка (баг в коде, недоступная БД, ошибка драйвера)
 *     в production превращается в {"error": "Внутренняя ошибка сервера",
 *     "requestId": "..."} без стека, SQL-запроса и имён таблиц. Подробности
 *     уходят только в лог-файл, а пользователю остаётся requestId, по которому
 *     администратор найдёт запись в логе.
 *   - в development тот же ответ дополняется полями message/stack — иначе
 *     отлаживать невозможно.
 *
 * Почему это важно: сообщение вроде
 *   «relation "users" does not exist» или «ECONNREFUSED 127.0.0.1:5432»
 * раскрывает СУБД, схему и топологию — готовая разведка для атакующего
 * (OWASP A05:2021 Security Misconfiguration).
 */

const crypto = require('crypto');
const { ValidationError, UniqueConstraintError, DatabaseError } = require('sequelize');
const ApiError = require('./ApiError');
const config = require('../config/env');
const { logger, errorLogger, clientIp } = require('../utils/logger');

/** Приведение ошибок Sequelize к ApiError с понятным текстом. */
function normalize(err) {
  if (err instanceof ApiError) return err;

  // Нарушение уникальности email при регистрации
  if (err instanceof UniqueConstraintError) {
    const fields = Object.keys(err.fields || {});
    if (fields.includes('email')) {
      return ApiError.conflict('Пользователь с таким email уже зарегистрирован');
    }
    return ApiError.conflict('Запись с такими данными уже существует');
  }

  // Встроенные валидаторы модели (второй рубеж после Joi)
  if (err instanceof ValidationError) {
    return ApiError.badRequest(
      'Некорректные данные запроса',
      err.errors.map((item) => item.message),
    );
  }

  // Ошибка самой БД: текст наружу не отдаём никогда — в нём бывает SQL
  if (err instanceof DatabaseError) {
    return ApiError.internal();
  }

  // Битый JSON в теле запроса
  if (err.type === 'entity.parse.failed') {
    return ApiError.badRequest('Тело запроса не является корректным JSON');
  }

  // Мера №12: тело больше лимита
  if (err.type === 'entity.too.large') {
    const limitError = new ApiError(413, `Тело запроса превышает допустимый размер (${config.security.bodyLimit})`);
    return limitError;
  }

  if (err.type === 'charset.unsupported' || err.type === 'encoding.unsupported') {
    return ApiError.badRequest('Неподдерживаемая кодировка тела запроса');
  }

  return ApiError.internal();
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const error = normalize(err);
  const status = error.status || 500;
  const requestId = crypto.randomUUID();

  // Полная информация — только в лог-файл (logs/error-*.log, мера №30)
  if (status >= 500) {
    const payload = {
      requestId,
      method: req.method,
      url: req.originalUrl,
      ip: clientIp(req),
      userId: req.user?.id,
      originalMessage: err.message,
      stack: err.stack,
      sql: err.sql,
    };
    logger.error(`Необработанная ошибка: ${err.message}`, payload);
    errorLogger.error(`Необработанная ошибка: ${err.message}`, payload);
  }

  const body = { error: error.message };

  if (error.details) body.details = error.details;

  if (status >= 500) {
    // Generic error: никаких подробностей наружу
    body.error = 'Внутренняя ошибка сервера';
    body.requestId = requestId;
    if (!config.isProduction) {
      body.devMessage = err.message;
      body.devStack = (err.stack || '').split('\n').slice(0, 6);
    }
  }

  if (status === 429 && error.retryAfterSeconds) {
    res.set('Retry-After', String(error.retryAfterSeconds));
  }

  res.status(status).json(body);
}

module.exports = errorHandler;
