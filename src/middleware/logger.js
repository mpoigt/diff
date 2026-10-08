'use strict';

/**
 * HTTP-лог запросов + базовая эвристика «подозрительности».
 *
 * Помимо обычной строки «метод, путь, статус, время», сюда вынесена
 * фиксация ответов со статусами 401/403/429: по заданию требуется
 * логировать попытки доступа к чужим ресурсам и массовые запросы.
 * Сами детали (кто, какой ресурс) пишут соответствующие middleware;
 * здесь — сводная запись по результату.
 *
 * В лог НЕ попадают: тело запроса, заголовок Authorization, cookie.
 * Иначе пароли и токены оказались бы в открытом виде в файлах логов.
 */

const { logger, securityLogger, clientIp } = require('../utils/logger');

const SUSPICIOUS_STATUSES = new Set([401, 403, 415, 423, 429]);

function httpLogger(req, res, next) {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    const meta = {
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      durationMs: Number(ms.toFixed(1)),
      ip: clientIp(req),
      userId: req.user?.id,
    };

    const line = `${req.method} ${req.originalUrl} -> ${res.statusCode} (${ms.toFixed(1)} ms)`;

    if (res.statusCode >= 500) logger.error(line, meta);
    else if (SUSPICIOUS_STATUSES.has(res.statusCode)) {
      logger.warn(line, meta);
      securityLogger.warn('SUSPICIOUS_RESPONSE', { event: 'SUSPICIOUS_RESPONSE', ...meta });
    } else logger.info(line, meta);
  });

  next();
}

module.exports = httpLogger;
