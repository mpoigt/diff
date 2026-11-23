'use strict';

/**
 * Мера №15 — валидация Content-Type.
 *
 * Для запросов с телом (POST/PUT/PATCH) требуем ровно application/json.
 * Зачем: формы HTML умеют отправлять только application/x-www-form-urlencoded,
 * multipart/form-data и text/plain, и такие запросы браузер считает
 * «простыми» — они уходят на чужой домен БЕЗ preflight-проверки CORS.
 * Требование application/json заставляет браузер делать preflight,
 * который наш CORS-белый список отклонит, то есть простая CSRF-форма
 * вида <form action="http://api/..."> перестаёт работать.
 *
 * Попутно отсекаем запросы вообще без Content-Type и с «пустым» телом,
 * присланным как text/plain.
 */

const ApiError = require('./ApiError');
const { logSuspicious } = require('../utils/logger');

const METHODS_WITH_BODY = new Set(['POST', 'PUT', 'PATCH']);

function requireJsonContentType(req, res, next) {
  if (!METHODS_WITH_BODY.has(req.method)) return next();

  // Запрос без тела (Content-Length: 0) — пропускаем, его отклонит валидатор
  const length = req.get('content-length');
  if ((length === '0' || length === undefined) && !req.get('content-type')) {
    return next();
  }

  if (!req.is('application/json')) {
    logSuspicious('INVALID_CONTENT_TYPE', req, { contentType: req.get('content-type') || null });
    return next(ApiError.unsupportedMediaType(
      'Поддерживается только Content-Type: application/json',
    ));
  }

  return next();
}

module.exports = requireJsonContentType;
