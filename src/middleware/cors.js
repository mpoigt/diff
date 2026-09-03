'use strict';

/**
 * Минимальная поддержка CORS без внешних зависимостей.
 * В реальном проекте обычно ставят пакет `cors`: app.use(cors({ origin: 'http://localhost:5173' })).
 * Здесь нужна для будущей интеграции с React-фронтендом из 1 части курса.
 */
function cors(req, res, next) {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Предварительный (preflight) запрос браузера не доходит до маршрутов
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  return next();
}

module.exports = cors;
