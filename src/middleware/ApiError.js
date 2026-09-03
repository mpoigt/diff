'use strict';

/**
 * Ошибка приложения с явным HTTP-статусом.
 * Пробрасывается через next(err) в глобальный обработчик ошибок.
 */
class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    if (details) this.details = details;
  }

  static badRequest(message, details) {
    return new ApiError(400, message, details);
  }

  static notFound(message) {
    return new ApiError(404, message);
  }
}

module.exports = ApiError;
