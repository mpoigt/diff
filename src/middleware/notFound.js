'use strict';

const ApiError = require('./ApiError');

/**
 * Срабатывает, если ни один маршрут не подошёл: отдаём 404 в едином JSON-формате.
 */
function notFound(req, res, next) {
  next(ApiError.notFound(`Маршрут ${req.method} ${req.originalUrl} не найден`));
}

module.exports = notFound;
