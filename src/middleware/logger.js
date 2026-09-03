'use strict';

/**
 * Простейший логгер запросов: метод, путь, статус ответа и время обработки.
 */
function logger(req, res, next) {
  const start = Date.now();

  res.on('finish', () => {
    const ms = Date.now() - start;
    console.log(`${req.method} ${req.originalUrl} -> ${res.statusCode} (${ms} ms)`);
  });

  next();
}

module.exports = logger;
