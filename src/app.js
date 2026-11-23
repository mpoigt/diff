'use strict';

/**
 * Сборка Express-приложения.
 *
 * ПОРЯДОК middleware критичен для безопасности — он выстроен от самых
 * дешёвых и общих проверок к самым дорогим:
 *
 *   1. trust proxy          — учитывать адрес клиента только за доверенным прокси.
 *   2. helmet               — заголовки безопасности, включая CSP (№13)
 *                             и X-Frame-Options: DENY (№18).
 *   3. httpLogger           — лог запросов и подозрительных ответов.
 *   4. CORS white list      — №22, до разбора тела: чужой origin
 *                             отсекается максимально рано.
 *   5. globalLimiter        — обязательная мера: лимит запросов с одного IP.
 *   6. requireJsonContentType — №15, проверка Content-Type до парсинга.
 *   7. express.json({limit}) — №12, ограничение размера тела (DoS).
 *   8. cookieParser         — нужен для refresh-токена из httpOnly cookie (№5).
 *   9. sanitizeBody         — №19, удаление HTML-тегов из метаданных.
 *  10. маршруты             — внутри: authenticate -> roleGuard -> validate.
 *  11. notFound + errorHandler — 404 и generic errors (№24).
 *
 * Статические файлы (демо-страница) отдаются ПОСЛЕ лимитеров, но до API,
 * и не требуют аутентификации.
 */

const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');

const config = require('./config/env');
const securityHeaders = require('./middleware/securityHeaders');
const { corsMiddleware } = require('./middleware/corsWhitelist');
const httpLogger = require('./middleware/logger');
const requireJsonContentType = require('./middleware/contentType');
const { sanitizeBody } = require('./middleware/sanitize');
const { globalLimiter } = require('./middleware/rateLimiters');
const notFound = require('./middleware/notFound');
const errorHandler = require('./middleware/errorHandler');

const authRoutes = require('./routes/auth.routes');
const usersRoutes = require('./routes/users.routes');
const adminRoutes = require('./routes/admin.routes');
const diffsRoutes = require('./routes/diffs.routes');

const app = express();

// ── 1. Учитываем X-Forwarded-For только от явно доверенных прокси ────────────
app.set('trust proxy', config.trustedProxies);
// Не сообщаем клиенту, на чём написан сервер
app.disable('x-powered-by');
// Жёсткий роутинг: /api/diffs и /api/diffs/ — один и тот же маршрут
app.set('strict routing', false);

// ── 2. Заголовки безопасности: helmet + CSP (№13) + X-Frame-Options (№18) ───
app.use(securityHeaders);

// ── 3. Логирование запросов ─────────────────────────────────────────────────
app.use(httpLogger);

// ── 4. CORS с белым списком доменов (№22) ───────────────────────────────────
app.use(corsMiddleware);

// ── 5. Глобальный rate limiting (обязательная мера) ─────────────────────────
app.use(globalLimiter);

// ── 6. Валидация Content-Type: только application/json (№15) ────────────────
app.use(requireJsonContentType);

// ── 7. Разбор тела с ограничением размера (№12 — защита от DoS) ─────────────
// Тело больше BODY_LIMIT (по умолчанию 100 КБ) отвергается с 413 ДО того,
// как сервер потратит память на его разбор.
app.use(express.json({ limit: config.security.bodyLimit, strict: true }));
app.use(express.urlencoded({ extended: false, limit: config.security.bodyLimit }));

// ── 8. Cookie: нужны для refresh-токена (№5) ────────────────────────────────
app.use(cookieParser());

// ── 9. Санитизация входных данных: удаление HTML-тегов (№19) ────────────────
app.use(sanitizeBody);

// ── Статика демо-страницы ───────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '..', 'public'), {
  // dotfiles deny: даже случайно положенный в public/.env не отдастся
  dotfiles: 'deny',
  index: 'index.html',
  maxAge: config.isProduction ? '1h' : 0,
}));

// ── Служебные эндпоинты ─────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: Math.round(process.uptime()), env: config.nodeEnv });
});

app.get('/API.md', (req, res) => {
  res.type('text/plain').sendFile(path.join(__dirname, '..', 'API.md'));
});

app.get('/api', (req, res) => {
  res.json({
    service: 'Diff Service API',
    version: '2.0.0',
    description: 'REST API сервиса сравнения файлов с аутентификацией и ролевой моделью',
    docs: '/API.md',
    endpoints: {
      auth: [
        'POST   /auth/register',
        'POST   /auth/login',
        'GET    /auth/me                (Bearer)',
        'POST   /auth/refresh           (httpOnly cookie)',
        'POST   /auth/logout',
        'POST   /auth/logout-all        (Bearer)',
        'GET    /auth/sessions          (Bearer)',
        'POST   /auth/forgot-password',
        'POST   /auth/reset-password',
        'POST   /auth/change-password   (Bearer)',
      ],
      diffs: [
        'GET    /api/diffs              (публично)',
        'GET    /api/diffs/stats        (публично)',
        'GET    /api/diffs/slug/:slug   (публично)',
        'GET    /api/diffs/:id          (публично)',
        'GET    /api/diffs/:id/patch    (публично)',
        'POST   /api/diffs              (user+)',
        'PUT    /api/diffs/:id          (владелец | moderator+)',
        'PATCH  /api/diffs/:id          (владелец | moderator+)',
        'DELETE /api/diffs/:id          (admin)',
      ],
      users: [
        'GET    /api/users              (moderator+)',
        'GET    /api/users/:id          (сам | moderator+)',
        'PATCH  /api/users/:id/role     (admin)',
        'POST   /api/users/:id/unlock   (admin)',
        'DELETE /api/users/:id          (admin)',
      ],
      admin: [
        'GET    /api/admin/audit-log    (admin)',
        'GET    /api/admin/security     (admin)',
      ],
    },
  });
});

// ── 10. Маршруты ────────────────────────────────────────────────────────────
// Эндпоинты аутентификации доступны по двум путям: /auth/* (как в задании)
// и /api/auth/* (единый префикс для фронтенда).
app.use('/auth', authRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/diffs', diffsRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/admin', adminRoutes);

// ── 11. 404 и обработчик ошибок — всегда последними ─────────────────────────
app.use(notFound);
app.use(errorHandler);

module.exports = app;
