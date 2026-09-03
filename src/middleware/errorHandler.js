'use strict';

/**
 * Глобальный обработчик ошибок Express.
 * Отличается от обычного middleware наличием четырёх аргументов (err, req, res, next),
 * поэтому подключается последним — после всех маршрутов.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // Ошибка парсинга JSON от express.json()
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Тело запроса не является корректным JSON' });
  }

  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Тело запроса слишком большое' });
  }

  const status = err.status || 500;

  if (status >= 500) {
    console.error('[error]', err.stack || err.message);
  }

  const body = {
    error: status >= 500 ? 'Внутренняя ошибка сервера' : err.message,
  };
  if (err.details) body.details = err.details;

  return res.status(status).json(body);
}

module.exports = errorHandler;
