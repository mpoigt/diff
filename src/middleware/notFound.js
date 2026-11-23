'use strict';

const ApiError = require('./ApiError');
const { logSuspicious } = require('../utils/logger');

/**
 * 404 для неизвестных маршрутов.
 *
 * Обращения к типовым «сканерным» путям (/.env, /wp-login.php, /admin.php)
 * отмечаем в security-логе: это признак автоматического сканирования.
 * Текст ответа не содержит списка доступных маршрутов — не помогаем
 * перечислять API.
 */

const SCANNER_PATTERNS = [
  /\.env$/i, /\.git/i, /wp-(login|admin|content)/i, /phpmyadmin/i,
  /\.(php|asp|aspx|jsp)$/i, /\/(config|backup|dump)\.(json|sql|zip)$/i,
  /\.\./,
];

function notFound(req, res, next) {
  if (SCANNER_PATTERNS.some((pattern) => pattern.test(req.originalUrl))) {
    logSuspicious('SCANNER_PROBE', req);
  }
  next(ApiError.notFound(`Маршрут ${req.method} ${req.path} не найден`));
}

module.exports = notFound;
