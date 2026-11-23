'use strict';

/**
 * Ошибка приложения с привязанным HTTP-статусом.
 *
 * Флаг isOperational отличает «ожидаемую» ошибку (неверный ввод, нет прав)
 * от неожидаемого сбоя. В production наружу отдаётся текст только
 * операционных ошибок, всё остальное превращается в generic-сообщение
 * «Внутренняя ошибка сервера» (мера №24) — чтобы не раскрывать стек,
 * имена таблиц, пути файлов и версии библиотек.
 */

class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.isOperational = true;
    if (details) this.details = details;
  }

  static badRequest(message, details) { return new ApiError(400, message, details); }

  static unauthorized(message = 'Требуется аутентификация') { return new ApiError(401, message); }

  static forbidden(message = 'Недостаточно прав для выполнения операции') { return new ApiError(403, message); }

  static notFound(message = 'Ресурс не найден') { return new ApiError(404, message); }

  static conflict(message) { return new ApiError(409, message); }

  static unsupportedMediaType(message) { return new ApiError(415, message); }

  static locked(message, details) { return new ApiError(423, message, details); }

  static tooManyRequests(message) { return new ApiError(429, message); }

  static internal(message = 'Внутренняя ошибка сервера') {
    const error = new ApiError(500, message);
    error.isOperational = false;
    return error;
  }
}

module.exports = ApiError;
